import asyncio
import gzip
import io
import json
import os
import re
import urllib.error
import urllib.request
from contextlib import asynccontextmanager
from datetime import date
from typing import Optional, Literal
from urllib.parse import quote, unquote, urlencode, urlparse

import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

import auth  # noqa: E402  — imported after load_dotenv so config is available
import db  # noqa: E402
import importer  # noqa: E402
import migrations  # noqa: E402
import sheet_import  # noqa: E402
from auth import get_current_user  # noqa: E402

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Open the connection pool up front so the first request doesn't pay for it,
    # and so a bad DATABASE_URL fails the container's healthcheck immediately
    # rather than surfacing as a confusing error on some later page load.
    db.open_pool()
    # Idempotent schema top-ups for databases that already exist — schema.sql
    # only runs when Postgres initialises an empty data directory.
    migrations.run()
    yield
    await _close_wiki_client()
    db.close_pool()


app = FastAPI(lifespan=lifespan)
_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Car images live on a mounted volume on the NAS instead of Supabase Storage.
IMAGE_DIR = os.getenv(
    "IMAGE_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "car-images")
)
os.makedirs(IMAGE_DIR, exist_ok=True)
app.mount("/images", StaticFiles(directory=IMAGE_DIR), name="images")


@app.get("/api/health")
def health():
    """Used by the Docker healthcheck and by uptime checks on the NAS."""
    try:
        db.query_one("SELECT 1 AS ok")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database unavailable: {exc}")
    return {"status": "ok"}


# ─── Auth ─────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


MIN_PASSWORD_LENGTH = 8


def _validate_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters",
        )


@app.post("/api/auth/login")
def login(body: LoginRequest):
    row = auth.authenticate(body.email, body.password)
    if not row:
        # Same message either way — don't reveal which addresses have accounts.
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = auth.create_token(str(row["id"]), row["email"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(row["id"]),
            "email": row["email"],
            "is_admin": row["is_admin"],
        },
    }


@app.get("/api/auth/me")
def read_me(user=Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "is_admin": user.is_admin}


@app.post("/api/auth/password", status_code=204)
def change_password(body: PasswordChangeRequest, user=Depends(get_current_user)):
    if not auth.authenticate(user.email, body.current_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    _validate_password(body.new_password)
    db.execute(
        "UPDATE users SET password_hash = %s WHERE id = %s",
        (auth.hash_password(body.new_password), user.id),
    )


# ─── Admin: user management ──────────────────────────────────────────────────
# Everything here requires an admin account. The point is to avoid hand-written
# SQL for routine account work.

class UserCreate(BaseModel):
    email: str
    password: str
    is_admin: bool = False


class AdminPasswordReset(BaseModel):
    new_password: str


class AdminUserUpdate(BaseModel):
    is_admin: bool


@app.get("/api/admin/users")
def list_users(admin=Depends(auth.require_admin)):
    return db.query(
        """
        SELECT u.id, u.email, u.is_admin, u.created_at,
               (SELECT count(*) FROM user_collection uc WHERE uc.user_id = u.id)::int
                   AS collection_count,
               (SELECT count(*) FROM wishlist w WHERE w.user_id = u.id)::int
                   AS wishlist_count
        FROM users u
        ORDER BY u.created_at NULLS FIRST, u.email
        """
    )


@app.post("/api/admin/users", status_code=201)
def create_user(body: UserCreate, admin=Depends(auth.require_admin)):
    email = body.email.strip()
    if "@" not in email or len(email) < 3:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    _validate_password(body.password)

    # Checked up front for a clear message; the unique index below is what
    # actually guarantees it under concurrent requests.
    if db.query_one("SELECT 1 FROM users WHERE lower(email) = lower(%s)", (email,)):
        raise HTTPException(status_code=409, detail="That email already has an account")

    try:
        row = db.query_one(
            "INSERT INTO users (email, password_hash, is_admin) VALUES (%s, %s, %s)"
            " RETURNING id, email, is_admin, created_at",
            (email, auth.hash_password(body.password), body.is_admin),
        )
    except Exception as exc:
        if db.is_unique_violation(exc):
            raise HTTPException(status_code=409, detail="That email already has an account")
        raise
    return {**row, "collection_count": 0, "wishlist_count": 0}


@app.post("/api/admin/users/{user_id}/password", status_code=204)
def admin_set_password(
    user_id: str, body: AdminPasswordReset, admin=Depends(auth.require_admin)
):
    _validate_password(body.new_password)
    try:
        updated = db.execute(
            "UPDATE users SET password_hash = %s WHERE id = %s",
            (auth.hash_password(body.new_password), user_id),
        )
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="User not found")
        raise
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(
    user_id: str, body: AdminUserUpdate, admin=Depends(auth.require_admin)
):
    # Refuse to remove your own admin rights: doing so would leave the admin
    # page unreachable, and getting back in would mean hand-written SQL.
    if user_id == admin.id and not body.is_admin:
        raise HTTPException(
            status_code=400, detail="You can't remove your own admin access"
        )
    try:
        row = db.query_one(
            "UPDATE users SET is_admin = %s WHERE id = %s"
            " RETURNING id, email, is_admin, created_at",
            (body.is_admin, user_id),
        )
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="User not found")
        raise
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return row


# ─── Pydantic Models ──────────────────────────────────────────────────────────

class CarCreate(BaseModel):
    name: str
    series_id: Optional[str] = None
    year: Optional[int] = None
    barcode: Optional[str] = None
    toy_number: Optional[str] = None
    primary_color: Optional[str] = None
    set_number: Optional[int] = None
    series_number: Optional[int] = None
    image_url: Optional[str] = None
    treasure_hunt: bool = False
    car_type: Optional[str] = None

class CarUpdate(BaseModel):
    name: Optional[str] = None
    series_id: Optional[str] = None
    year: Optional[int] = None
    barcode: Optional[str] = None
    toy_number: Optional[str] = None
    primary_color: Optional[str] = None
    set_number: Optional[int] = None
    series_number: Optional[int] = None
    image_url: Optional[str] = None
    treasure_hunt: Optional[bool] = None
    car_type: Optional[str] = None

class SeriesCreate(BaseModel):
    name: str
    year: Optional[int] = None
    type: Literal["mainline", "premium", "collector"] = "mainline"
    total_count: Optional[int] = None
    cars_list: Optional[list[str]] = None
    image_url: Optional[str] = None

class SeriesUpdate(BaseModel):
    name: Optional[str] = None
    year: Optional[int] = None
    type: Optional[Literal["mainline", "premium", "collector"]] = None
    total_count: Optional[int] = None
    cars_list: Optional[list[str]] = None
    image_url: Optional[str] = None

class CollectionCreate(BaseModel):
    allcars_id: str
    amount_owned: int = 1
    carded: bool = True
    condition: str = "mint"
    notes: Optional[str] = None
    date_acquired: Optional[date] = None

class CollectionUpdate(BaseModel):
    amount_owned: Optional[int] = None
    carded: Optional[bool] = None
    condition: Optional[str] = None
    notes: Optional[str] = None
    date_acquired: Optional[date] = None

class WishlistCreate(BaseModel):
    allcars_id: str
    priority: int = 0
    notes: Optional[str] = None

class WishlistUpdate(BaseModel):
    priority: Optional[int] = None
    notes: Optional[str] = None

class BarcodeRequest(BaseModel):
    barcode: str


# ─── Cars ─────────────────────────────────────────────────────────────────────

def _car_filters(
    search: Optional[str],
    series_id: Optional[str],
    year: Optional[int],
    treasure_hunt: Optional[bool],
    type: Optional[str],
) -> tuple[str, list]:
    """Build the shared WHERE clause for the car list and its count query.

    Mirrors the previous PostgREST filter chain exactly, including the trick where
    a year embedded in the search box ("2019 Camaro") is split into a year equality
    plus per-word name matches.
    """
    clauses: list[str] = []
    params: list = []

    if search:
        term = search.strip()
        year_match = re.search(r"\b(19|20)\d{2}\b", term)
        if year_match:
            clauses.append("c.year = %s")
            params.append(int(year_match.group(0)))
            name_term = re.sub(r"\b(19|20)\d{2}\b", " ", term)
            name_term = re.sub(r"[()'‘’\"`]", " ", name_term)
            name_term = re.sub(r"\s+", " ", name_term).strip()
            for part in name_term.split():
                if len(part) > 1:
                    clauses.append("c.name ILIKE %s")
                    params.append(f"%{part}%")
        else:
            clauses.append(
                "(c.name ILIKE %s OR c.toy_number ILIKE %s OR c.primary_color ILIKE %s)"
            )
            params.extend([f"%{term}%"] * 3)

    if series_id:
        clauses.append("c.series_id = %s")
        params.append(series_id)
    if year:
        clauses.append("c.year = %s")
        params.append(year)
    if treasure_hunt is not None:
        clauses.append("c.treasure_hunt = %s")
        params.append(treasure_hunt)
    if type:
        clauses.append("c.car_type ILIKE %s")
        params.append(f"%{type}%")

    return (" AND ".join(clauses) if clauses else "TRUE"), params


@app.get("/api/cars")
def get_cars(
    search: Optional[str] = None,
    series_id: Optional[str] = None,
    year: Optional[int] = None,
    treasure_hunt: Optional[bool] = None,
    type: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    user=Depends(get_current_user),
):
    page = max(1, page)
    # Several pages (AllCarsPage, SeriesPage, AddCarModal) deliberately ask for
    # page_size=9999 to pull the whole catalogue in one go, so the ceiling has to
    # stay above that. It exists only to stop an absurd value allocating the world.
    page_size = max(1, min(page_size, 10000))
    where, params = _car_filters(search, series_id, year, treasure_hunt, type)

    try:
        # Count without the join — same optimisation as the previous version.
        total = db.query_one(
            f"SELECT count(*) AS n FROM all_cars c WHERE {where}", params
        )["n"]

        # ORDER BY is required for correct paging: without it Postgres may order
        # rows differently per page, silently duplicating or skipping cars.
        # Ascending created_at preserves the previous insertion-order feel.
        items = db.query(
            f"""{db.SELECT_CAR_WITH_SERIES}
                WHERE {where}
                ORDER BY c.created_at NULLS FIRST, c.id
                LIMIT %s OFFSET %s""",
            params + [page_size, page_size * (page - 1)],
        )
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=400, detail="Invalid series_id")
        raise

    return {
        "items": items,
        "total": total,
        "total_pages": max(1, -(-total // page_size)),
        "page": page,
        "page_size": page_size,
    }


@app.get("/api/cars/{car_id}")
def get_car(car_id: str, user=Depends(get_current_user)):
    try:
        result = db.query_one(f"{db.SELECT_CAR_WITH_SERIES} WHERE c.id = %s", (car_id,))
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Car not found")
        raise
    if not result:
        raise HTTPException(status_code=404, detail="Car not found")
    return result


async def _create_car_record(car: CarCreate) -> dict:
    """Insert a catalogue car and mirror its image locally.

    Shared by the create-car route and the sheet importer, so both get the same
    image handling — the importer creates thousands of cars and every one of them
    needs its wiki photo copied onto the NAS.
    """
    new_car = db.insert("all_cars", car.model_dump(exclude_none=True))

    # Mirror externally-hosted images into local storage so the catalogue keeps
    # working if the source site disappears or starts blocking hotlinks.
    if car.image_url and not _is_local_image(car.image_url):
        try:
            stored_url = await _fetch_and_store_image(str(new_car["id"]), car.image_url)
            if stored_url:
                db.update("all_cars", {"image_url": stored_url}, "id = %s", (new_car["id"],))
                new_car["image_url"] = stored_url
        except Exception:
            pass  # non-critical — keep original URL as fallback

    return new_car


@app.post("/api/cars", status_code=201)
async def create_car(car: CarCreate, user=Depends(get_current_user)):
    return await _create_car_record(car)


@app.put("/api/cars/{car_id}")
def update_car(car_id: str, car: CarUpdate, user=Depends(get_current_user)):
    updates = car.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        result = db.update("all_cars", updates, "id = %s", (car_id,))
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Car not found")
        raise
    if not result:
        raise HTTPException(status_code=404, detail="Car not found")
    return result[0]


@app.delete("/api/cars/{car_id}", status_code=204)
def delete_car(car_id: str, user=Depends(get_current_user)):
    # Collection and wishlist rows go with it via ON DELETE CASCADE, so unlike
    # the Supabase version this needs no manual cleanup queries first.
    try:
        db.delete("all_cars", "id = %s", (car_id,))
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Car not found")
        raise
    _delete_image_files(car_id)


# ─── Series ───────────────────────────────────────────────────────────────────

@app.get("/api/series")
def get_all_series(user=Depends(get_current_user)):
    """Series list annotated with how many of each the current user owns.

    The old version pulled the whole collection and counted in Python; the count
    is now a grouped join, which is both less code and one round trip.
    """
    return db.query(
        """
        SELECT s.*, COALESCE(owned.n, 0)::int AS owned_count
        FROM series s
        LEFT JOIN (
            SELECT c.series_id, count(DISTINCT uc.allcars_id) AS n
            FROM user_collection uc
            JOIN all_cars c ON c.id = uc.allcars_id
            WHERE uc.user_id = %s
            GROUP BY c.series_id
        ) owned ON owned.series_id = s.id
        ORDER BY s.created_at NULLS FIRST, s.id
        """,
        (user.id,),
    )


@app.get("/api/series/{series_id}")
def get_series(series_id: str, user=Depends(get_current_user)):
    try:
        series_row = db.query_one("SELECT * FROM series WHERE id = %s", (series_id,))
        if not series_row:
            raise HTTPException(status_code=404, detail="Series not found")

        cars = db.query(
            """
            SELECT c.*, (uc.id IS NOT NULL) AS owned
            FROM all_cars c
            LEFT JOIN user_collection uc
                   ON uc.allcars_id = c.id AND uc.user_id = %s
            WHERE c.series_id = %s
            ORDER BY c.series_number NULLS LAST, c.name
            """,
            (user.id, series_id),
        )
    except HTTPException:
        raise
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Series not found")
        raise

    return {**series_row, "cars": cars}


@app.post("/api/series", status_code=201)
def create_series(series: SeriesCreate, user=Depends(get_current_user)):
    return db.insert("series", series.model_dump(exclude_none=True))


@app.put("/api/series/{series_id}")
def update_series(series_id: str, series: SeriesUpdate, user=Depends(get_current_user)):
    updates = series.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        result = db.update("series", updates, "id = %s", (series_id,))
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Series not found")
        raise
    if not result:
        raise HTTPException(status_code=404, detail="Series not found")
    return result[0]


@app.delete("/api/series/{series_id}", status_code=204)
def delete_series(series_id: str, user=Depends(get_current_user)):
    # all_cars.series_id is ON DELETE SET NULL, so cars survive with no series.
    try:
        db.delete("series", "id = %s", (series_id,))
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Series not found")
        raise


# ─── Collection ───────────────────────────────────────────────────────────────

@app.get("/api/collection")
def get_collection(user=Depends(get_current_user)):
    # The joined car already comes back under a `car` key, so the old
    # all_cars -> car rename loop is gone.
    return db.query(
        f"{db.SELECT_COLLECTION_WITH_CAR} WHERE uc.user_id = %s"
        " ORDER BY uc.created_at DESC NULLS LAST, uc.id",
        (user.id,),
    )


@app.post("/api/collection", status_code=201)
def add_to_collection(entry: CollectionCreate, user=Depends(get_current_user)):
    payload = entry.model_dump(exclude_none=True)
    payload["user_id"] = user.id
    try:
        inserted = db.insert("user_collection", payload)
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=400, detail="Invalid car id")
        if db.is_fk_violation(exc):
            raise HTTPException(status_code=404, detail="Car not found")
        raise
    return db.query_one(
        f"{db.SELECT_COLLECTION_WITH_CAR} WHERE uc.id = %s", (inserted["id"],)
    )


@app.put("/api/collection/{entry_id}")
def update_collection_entry(entry_id: str, entry: CollectionUpdate, user=Depends(get_current_user)):
    updates = entry.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        result = db.update(
            "user_collection", updates, "id = %s AND user_id = %s", (entry_id, user.id)
        )
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Entry not found")
        raise
    if not result:
        raise HTTPException(status_code=404, detail="Entry not found")
    return result[0]


@app.delete("/api/collection/{entry_id}", status_code=204)
def remove_from_collection(entry_id: str, user=Depends(get_current_user)):
    try:
        db.delete("user_collection", "id = %s AND user_id = %s", (entry_id, user.id))
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Entry not found")
        raise


# ─── Wishlist ─────────────────────────────────────────────────────────────────

@app.get("/api/wishlist")
def get_wishlist(user=Depends(get_current_user)):
    return db.query(
        f"{db.SELECT_WISHLIST_WITH_CAR} WHERE w.user_id = %s"
        " ORDER BY w.priority NULLS LAST, w.id",
        (user.id,),
    )


@app.post("/api/wishlist", status_code=201)
def add_to_wishlist(entry: WishlistCreate, user=Depends(get_current_user)):
    payload = entry.model_dump(exclude_none=True)
    payload["user_id"] = user.id
    try:
        return db.insert("wishlist", payload)
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=400, detail="Invalid car id")
        if db.is_fk_violation(exc):
            raise HTTPException(status_code=404, detail="Car not found")
        raise


@app.put("/api/wishlist/{entry_id}")
def update_wishlist_entry(entry_id: str, entry: WishlistUpdate, user=Depends(get_current_user)):
    updates = entry.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        result = db.update(
            "wishlist", updates, "id = %s AND user_id = %s", (entry_id, user.id)
        )
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Entry not found")
        raise
    if not result:
        raise HTTPException(status_code=404, detail="Entry not found")
    return result[0]


@app.delete("/api/wishlist/{entry_id}", status_code=204)
def remove_from_wishlist(entry_id: str, user=Depends(get_current_user)):
    try:
        db.delete("wishlist", "id = %s AND user_id = %s", (entry_id, user.id))
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Entry not found")
        raise


# ─── Analytics ────────────────────────────────────────────────────────────────

@app.get("/api/analytics")
def get_analytics(user=Depends(get_current_user)):
    collection = db.query(
        f"{db.SELECT_COLLECTION_WITH_CAR} WHERE uc.user_id = %s", (user.id,)
    )

    # Actual catalogue size per series, used when series.total_count is NULL.
    cars_per_series: dict[str, int] = {
        str(row["series_id"]): row["n"]
        for row in db.query(
            "SELECT series_id, count(*)::int AS n FROM all_cars"
            " WHERE series_id IS NOT NULL GROUP BY series_id"
        )
    }

    series_all = db.query("SELECT * FROM series")

    total_cars = sum(e["amount_owned"] for e in collection)
    treasure_hunts = sum(1 for e in collection if (e.get("car") or {}).get("treasure_hunt"))

    cars_by_type: dict[str, int] = {}
    for e in collection:
        car_type = (e.get("car") or {}).get("car_type") or "unknown"
        cars_by_type[car_type] = cars_by_type.get(car_type, 0) + e["amount_owned"]

    cars_by_year: dict[str, int] = {}
    for e in collection:
        year = str((e.get("car") or {}).get("year") or "unknown")
        cars_by_year[year] = cars_by_year.get(year, 0) + e["amount_owned"]

    # Condition breakdown
    cars_by_condition: dict[str, int] = {}
    for e in collection:
        cond = e.get("condition") or "unknown"
        amt = e.get("amount_owned", 1)
        cars_by_condition[cond] = cars_by_condition.get(cond, 0) + amt

    # Carded vs loose
    carded_count = sum(e.get("amount_owned", 1) for e in collection if e.get("carded", True))
    loose_count = sum(e.get("amount_owned", 1) for e in collection if not e.get("carded", True))

    # Top colors (top 8)
    color_counts: dict[str, int] = {}
    for e in collection:
        color = (e.get("car") or {}).get("primary_color")
        if color:
            bucket = _color_bucket(color)
            color_counts[bucket] = color_counts.get(bucket, 0) + e.get("amount_owned", 1)
    top_colors = sorted(color_counts.items(), key=lambda x: x[1], reverse=True)[:8]

    owned_per_series: dict[str, int] = {}
    for e in collection:
        sid = (e.get("car") or {}).get("series_id")
        if sid:
            owned_per_series[str(sid)] = owned_per_series.get(str(sid), 0) + 1

    series_completion = []
    for s in series_all:
        sid = str(s["id"])
        owned = owned_per_series.get(sid, 0)
        if owned == 0:
            continue
        # Fall back to the real car count when series.total_count is NULL
        total = s.get("total_count") or cars_per_series.get(sid, 0) or 0
        series_completion.append({
            "series": s,
            "owned": owned,
            "total": total,
            "percent": round(owned / total * 100, 1) if total else 0,
        })
    series_completion.sort(key=lambda x: x["percent"], reverse=True)

    total_cars_in_catalog = sum(cars_per_series.values())

    recently_added = db.query(
        f"{db.SELECT_COLLECTION_WITH_CAR} WHERE uc.user_id = %s"
        " ORDER BY uc.created_at DESC NULLS LAST, uc.id LIMIT 5",
        (user.id,),
    )

    return {
        "total_cars": total_cars,
        "total_series": len(owned_per_series),
        "treasure_hunts_count": treasure_hunts,
        "cars_by_type": cars_by_type,
        "cars_by_year": cars_by_year,
        "series_completion": series_completion,
        "recently_added": recently_added,
        "cars_by_condition": cars_by_condition,
        "carded_count": carded_count,
        "loose_count": loose_count,
        "top_colors": [{"color": k, "count": v} for k, v in top_colors],
        "total_cars_in_catalog": total_cars_in_catalog,
    }


# ─── Barcode ──────────────────────────────────────────────────────────────────

@app.post("/api/barcode/lookup")
def barcode_lookup(body: BarcodeRequest, user=Depends(get_current_user)):
    car = db.query_one(
        f"{db.SELECT_CAR_WITH_SERIES} WHERE c.barcode = %s LIMIT 1", (body.barcode,)
    )
    if not car:
        return {"found": False, "car": None}
    return {"found": True, "car": car}


# ─── Image Upload ─────────────────────────────────────────────────────────────

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
EXT_MAP = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def _image_url(car_id: str, ext: str) -> str:
    """Images are stored as a root-relative path rather than an absolute URL.

    The NAS is reachable under more than one host — a LAN address at home and a
    tunnel hostname when out at a store — and baking either one into the database
    would break the other. The frontend joins this onto its configured API base
    (see resolveImageUrl in frontend/src/lib/api.ts).
    """
    return f"/images/{car_id}.{ext}"


def _is_local_image(url: str) -> bool:
    return url.startswith("/images/")


def _image_path(car_id: str, ext: str) -> str:
    return os.path.join(IMAGE_DIR, f"{car_id}.{ext}")


def _delete_image_files(car_id: str) -> None:
    """Remove every stored variant for a car, whatever extension it was saved under."""
    for ext in EXT_MAP.values():
        try:
            os.remove(_image_path(car_id, ext))
        except FileNotFoundError:
            pass
        except OSError:
            pass


def _store_image_bytes(car_id: str, content: bytes, content_type: str) -> str:
    ext = EXT_MAP.get(content_type, "jpg")
    # Drop other extensions first so a png->jpg replacement leaves no stale file.
    for old_ext in EXT_MAP.values():
        if old_ext != ext:
            try:
                os.remove(_image_path(car_id, old_ext))
            except FileNotFoundError:
                pass
            except OSError:
                pass
    with open(_image_path(car_id, ext), "wb") as fh:
        fh.write(content)
    return _image_url(car_id, ext)


async def _fetch_and_store_image(car_id: str, url: str) -> Optional[str]:
    """Download an external image onto local storage. Returns the relative URL."""
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        resp = await client.get(url, headers=HEADERS)
        if resp.status_code != 200:
            return None

    if len(resp.content) > MAX_IMAGE_BYTES:
        return None

    content_type = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
    if content_type not in ALLOWED_IMAGE_TYPES:
        content_type = "image/jpeg"

    return _store_image_bytes(car_id, resp.content, content_type)


@app.post("/api/cars/{car_id}/image")
async def upload_car_image(
    car_id: str,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, or WebP images are allowed")

    content = await file.read()
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image must be under 5 MB")

    # Confirm the car exists before writing a file we would otherwise orphan.
    try:
        exists = db.query_one("SELECT id FROM all_cars WHERE id = %s", (car_id,))
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Car not found")
        raise
    if not exists:
        raise HTTPException(status_code=404, detail="Car not found")

    public_url = _store_image_bytes(car_id, content, file.content_type)
    db.update("all_cars", {"image_url": public_url}, "id = %s", (car_id,))
    return {"image_url": public_url}


@app.delete("/api/cars/{car_id}/image", status_code=204)
async def delete_car_image(car_id: str, user=Depends(get_current_user)):
    try:
        db.update("all_cars", {"image_url": None}, "id = %s", (car_id,))
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Car not found")
        raise
    _delete_image_files(car_id)

# ─── Scraping ─────────────────────────────────────────────────────────────────

WIKI_BASE = "https://hotwheels.fandom.com"
HEADERS = {"User-Agent": "HotWheelsTracker/1.0 (personal collection app)"}

CHW_BASE = "https://collecthw.com"
CHW_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Referer": "https://collecthw.com/",
}


def _chw_img_url(gallery_image: str) -> str:
    """Convert GalleryImage field to full image URL."""
    if not gallery_image:
        return ""
    # Format: "uuid_{}.ext" → "https://images.collecthw.com/uuid_large.ext"
    parts = gallery_image.rsplit("_{}", 1)
    if len(parts) == 2:
        ext = parts[1].lstrip(".")
        return f"https://images.collecthw.com/{parts[0]}_large.{ext}"
    return ""


_COLOR_BUCKETS: list[tuple[str, tuple[str, ...]]] = [
    ("Black", ("black",)),
    ("White", ("white", "pearl")),
    ("Silver", ("silver", "chrome")),
    ("Gray", ("gray", "grey", "gunmetal")),
    ("Red", ("red", "maroon", "burgundy")),
    ("Blue", ("blue", "aqua", "cyan")),
    ("Green", ("green", "lime")),
    ("Yellow", ("yellow",)),
    ("Orange", ("orange",)),
    ("Purple", ("purple", "violet")),
    ("Pink", ("pink", "magenta")),
    ("Gold", ("gold",)),
    ("Brown", ("brown", "bronze", "copper")),
    ("Tan", ("tan", "beige", "cream")),
]


def _color_bucket(color: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", " ", color.lower()).strip()
    for label, keywords in _COLOR_BUCKETS:
        if any(re.search(rf"\b{re.escape(keyword)}\b", normalized) for keyword in keywords):
            return label
    return color.strip().title()


_PREMIUM_SERIES_KEYWORDS = [
    "boulevard", "car culture", "retro entertainment", "pop culture",
    "vintage racing club", "hw id", "pantone", "detroit muscle",
    "speed machines", "collector edition", "hw exotics", "hw premium",
    "modern classics", "hw braille",
]


def _chw_car_type(item: dict) -> str:
    if item.get("STH"):
        return "super treasure hunt"
    series = (item.get("Series") or "").lower()
    if any(kw in series for kw in _PREMIUM_SERIES_KEYWORDS):
        return "premium"
    if item.get("Mainline"):
        return "mainline"
    return "mainline"


def _chw_to_car(item: dict) -> dict:
    """Convert a collecthw API item to our ScrapedCar dict."""
    img = _chw_img_url(item.get("GalleryImage") or "")
    th = bool(item.get("TH") or item.get("STH"))
    try:
        year = int(item["Year"]) if item.get("Year") else None
    except (ValueError, TypeError):
        year = None
    try:
        series_num = int(item["SeriesNum"]) if item.get("SeriesNum") else None
    except (ValueError, TypeError):
        series_num = None
    try:
        set_num = int(item["Col"]) if item.get("Col") else None
    except (ValueError, TypeError):
        set_num = None

    return {
        "collecthw_id": str(item["id"]),
        "name": item.get("ModelName") or "",
        "year": year,
        "series_name": item.get("Series") or None,
        "primary_color": item.get("Color") or None,
        "image_url": img or None,
        "treasure_hunt": th,
        "car_type": _chw_car_type(item),
        "series_number": series_num,
        "set_number": set_num,
        "barcode": f"CHW-{item['id']}",
        "versions": [],
    }


_FEED_QUERIES = [
    # Iconic castings
    "Bone Shaker", "Twin Mill", "Deora", "Rodger Dodger", "Bread Box",
    "Dairy Delivery", "Ratbomb", "Street Creeper", "Rivited", "Nomad",
    # American muscle
    "Camaro", "Mustang", "Corvette", "Dodge Charger", "Dodge Challenger",
    "Impala", "El Camino", "Chevelle", "Firebird", "Barracuda",
    "GTO", "Cutlass", "Monte Carlo", "Buick", "Riviera",
    # European / exotics
    "Porsche", "Ferrari", "Lamborghini", "McLaren", "Bugatti",
    "BMW", "Audi", "Pagani", "Koenigsegg", "Alfa Romeo",
    "Lotus", "Jaguar", "Aston Martin", "Bentley", "Mercedes",
    # Japanese
    "Nissan", "Toyota Supra", "Honda", "Mazda RX", "Subaru",
    "Datsun", "Mitsubishi", "Acura", "Lexus", "Skyline",
    # Trucks & off-road
    "Jeep", "Ford Bronco", "Raptor", "Baja", "Monster",
    "Pickup", "Dump Truck", "Blazer", "Land Rover", "4x4",
    # Race & speed
    "Dragster", "Race Car", "Formula", "Indy", "Hot Rod",
    "Funny Car", "Top Fuel", "Sprint Car", "Dirt Modified",
    # Modern / EV
    "Tesla", "Ford GT", "Rivian", "Cybertruck", "Taycan",
    # Vans & utility
    "Custom", "Van", "Station Wagon", "Panel", "Delivery",
    # Classics & retro
    "Volkswagen", "Beetle", "Bus", "Cadillac", "Lincoln",
    "Thunderbird", "Galaxie", "Bel Air", "Roadster", "Speedster",
]

# In-memory cache for collecthw search results (TTL = 10 minutes)
import time as _time
_chw_cache: dict[str, tuple[list, float]] = {}
_CHW_CACHE_TTL = 600


async def _chw_search_cached(client: httpx.AsyncClient, q: str) -> list[dict]:
    """Cached wrapper around _chw_search. Avoids repeat calls for the same query."""
    now = _time.monotonic()
    entry = _chw_cache.get(q)
    if entry:
        results, ts = entry
        if now - ts < _CHW_CACHE_TTL:
            return results
    results = await _chw_search(client, q)
    _chw_cache[q] = (results, now)
    return results


_NON_CASTING_PATTERNS = re.compile(
    r"""
    ^\d{4}\s+hot\s+wheels\b  # starts like "2024 Hot Wheels..."
    | \bseries\b     # contains "series"
    | ^list\s+of\b   # "List of..."
    | \(disambiguation\)
    | ^hot\s+wheels\s+\(  # "Hot Wheels (film)"
    | \bcollections?\b
    | \bconvention\b
    | \bchampionship\b
    | \bassortment\b
    | \bgift\s+set\b
    | \btrack\s+set\b
    | \bsuperchargers?\b
    | \bplaysets?\b
    | \baccesories?\b
    | \b(?:\d+\s*)?packs?\b      # "5 Pack", "Gift Pack"
    """,
    re.VERBOSE | re.IGNORECASE,
)


def _is_casting_title(title: str) -> bool:
    """Return True if the title looks like an individual car casting page."""
    return not _NON_CASTING_PATTERNS.search(title)


_CHW_SKIP_KW = ["-pack", " pack", "gift set", "track set", "assortment", "playset"]


def _chw_is_car(item: dict) -> bool:
    name = (item.get("ModelName") or "").lower()
    series = (item.get("Series") or "").lower()
    return not any(kw in name or kw in series for kw in _CHW_SKIP_KW)


async def _chw_search(client: httpx.AsyncClient, q: str) -> list[dict]:
    """Query collecthw.com /find and return filtered ScrapedCar dicts."""
    try:
        resp = await client.get(
            f"{CHW_BASE}/find",
            params={"query": q},
            headers=CHW_HEADERS,
            timeout=10,
        )
        if resp.status_code != 200:
            return []
        items = resp.json()
        if not isinstance(items, list):
            return []
        return [_chw_to_car(i) for i in items if _chw_is_car(i)]
    except Exception:
        return []


async def _wiki_search(client: httpx.AsyncClient, q: str, limit: int = 10) -> list[dict]:
    """Search the Hot Wheels wiki and return ScrapedCar dicts (images from pageimages API)."""

    # Always try a direct page-title lookup first — it's exact and instant.
    # Covers hyphens (MediaWiki treats "-" as NOT in text search), year abbreviations
    # like '96/'69 (wiki uses curly U+2018 quote), and multi-word names like
    # "Lamborghini Veneno" that text search ranks behind broader results.
    # MediaWiki only auto-capitalises the FIRST letter of a title, so we must also
    # try a title-cased variant (each word's first letter uppercased) to handle
    # queries typed in lowercase.
    def _title_variants(s: str) -> list[str]:
        cleaned = re.sub(r"\s+", " ", s.strip())
        no_year = re.sub(r"^\d{4}\s+", "", cleaned).strip()
        no_wrapping_punct = re.sub(r"[\"`]", "", cleaned)
        bases = [cleaned, no_year, no_wrapping_punct]
        bases += [re.sub(r"\((['\u2018\u2019]?)([^)]+)\)", r"(\2)", b).strip() for b in bases]
        bases = [b for b in dict.fromkeys(bases) if b]

        variants: list[str] = []
        for source in bases:
            base = source.replace(" ", "_")
            titled = "_".join(w[:1].upper() + w[1:] for w in source.split()).replace(" ", "_")
            variants += [base, titled]
            if "'" in base:
                variants += [v.replace("'", "\u2018") for v in [base, titled]]
            if "\u2018" in base or "\u2019" in base:
                variants += [v.replace("\u2018", "'").replace("\u2019", "'") for v in [base, titled]]
        return list(dict.fromkeys(variants))

    try:
        for direct_title in _title_variants(q.strip()):
            tr = await client.get(
                f"{WIKI_BASE}/api.php",
                params={"action": "query", "titles": direct_title,
                        "redirects": "true", "prop": "pageimages", "pithumbsize": "300", "format": "json"},
                headers=HEADERS,
                timeout=10,
            )
            pages = tr.json().get("query", {}).get("pages", {})
            for pid, pd in pages.items():
                if int(pid) > 0 and _is_casting_title(pd.get("title", "")):
                    title = pd["title"]
                    thumb = pd.get("thumbnail", {})
                    return [{
                        "collecthw_id": pid,
                        "name": title,
                        "year": None, "series_name": None, "primary_color": None,
                        "image_url": thumb.get("source") if thumb else None,
                        "treasure_hunt": False, "car_type": "mainline",
                        "series_number": None, "set_number": None, "barcode": None,
                        "versions": [],
                        "url": f"{WIKI_BASE}/wiki/{title.replace(' ', '_')}",
                    }]
    except Exception:
        pass
    # Direct lookup found nothing — fall through to full-text search

    search_terms = list(dict.fromkeys([
        q.strip(),
        re.sub(r"^\d{4}\s+", "", q.strip()).strip(),
        re.sub(r"[()'\u2018\u2019\"`]", " ", q.strip()).strip(),
        re.sub(r"[()'\u2018\u2019\"`]", " ", re.sub(r"^\d{4}\s+", "", q.strip())).strip(),
    ]))

    data = None
    try:
        for term in [t for t in search_terms if t]:
            search_url = (
                f"{WIKI_BASE}/api.php"
                f"?action=query&list=search&srsearch={quote(term)}&srlimit={limit}&format=json"
            )
            resp = await client.get(search_url, headers=HEADERS, timeout=10)
            resp.raise_for_status()
            candidate = resp.json()
            if candidate.get("query", {}).get("search"):
                data = candidate
                break
    except Exception:
        return []
    if data is None:
        return []

    search_items = [
        item for item in data.get("query", {}).get("search", [])
        if _is_casting_title(item.get("title", ""))
    ]

    if not search_items:
        return []

    page_ids_str = "|".join(str(i["pageid"]) for i in search_items)
    try:
        tr = await client.get(
            f"{WIKI_BASE}/api.php"
            f"?action=query&pageids={page_ids_str}&prop=pageimages&pithumbsize=300&format=json",
            headers=HEADERS,
            timeout=10,
        )
        pages = tr.json().get("query", {}).get("pages", {})
    except Exception:
        pages = {}

    results = []
    for item in search_items:
        page_id = item.get("pageid")
        title = item.get("title", "")
        pd = pages.get(str(page_id), {})
        thumb = pd.get("thumbnail", {})
        results.append({
            "collecthw_id": str(page_id),
            "name": title,
            "year": None,
            "series_name": None,
            "primary_color": None,
            "image_url": thumb.get("source") if thumb else None,
            "treasure_hunt": False,
            "car_type": "mainline",
            "series_number": None,
            "set_number": None,
            "barcode": None,
            "versions": [],
            "url": f"{WIKI_BASE}/wiki/{title.replace(' ', '_')}",
        })
    return results


async def _wiki_random(client: httpx.AsyncClient, limit: int = 50) -> list[dict]:
    """Fetch truly random Hot Wheels casting pages from the wiki's random-page API."""
    try:
        resp = await client.get(
            f"{WIKI_BASE}/api.php",
            params={"action": "query", "list": "random", "rnnamespace": "0",
                    "rnlimit": str(min(limit, 500)), "format": "json"},
            headers=HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        pages = [
            p for p in resp.json().get("query", {}).get("random", [])
            if _is_casting_title(p.get("title", ""))
        ]
    except Exception:
        return []

    if not pages:
        return []

    # Batch-fetch thumbnails
    page_ids_str = "|".join(str(p["id"]) for p in pages)
    try:
        img_resp = await client.get(
            f"{WIKI_BASE}/api.php",
            params={"action": "query", "pageids": page_ids_str,
                    "prop": "pageimages", "pithumbsize": "300", "format": "json"},
            headers=HEADERS,
            timeout=10,
        )
        img_pages = img_resp.json().get("query", {}).get("pages", {})
    except Exception:
        img_pages = {}

    results = []
    for p in pages:
        title = p["title"]
        pid = str(p["id"])
        thumb = img_pages.get(pid, {}).get("thumbnail", {})
        results.append({
            "collecthw_id": f"wiki_{pid}",
            "name": title,
            "year": None,
            "series_name": None,
            "primary_color": None,
            "image_url": thumb.get("source") if thumb else None,
            "treasure_hunt": False,
            "car_type": "mainline",
            "series_number": None,
            "set_number": None,
            "barcode": None,
            "versions": [],
            "in_db": False,
            "url": f"{WIKI_BASE}/wiki/{quote(title.replace(' ', '_'))}",
        })
    return results


async def _wiki_by_year(client: httpx.AsyncClient, year: int, limit: int = 50) -> list[dict]:
    """Fetch Hot Wheels castings from a specific year using wiki category pages."""
    # The wiki organises releases into year categories — try common name formats
    candidate_categories = [
        f"{year}_Hot_Wheels",
        f"Hot_Wheels_{year}",
        f"{year}_Mainline_Hot_Wheels",
    ]

    pages: list[dict] = []
    for cat in candidate_categories:
        try:
            resp = await client.get(
                f"{WIKI_BASE}/api.php",
                params={
                    "action": "query",
                    "list": "categorymembers",
                    "cmtitle": f"Category:{cat}",
                    "cmlimit": str(min(limit * 4, 500)),
                    "cmtype": "page",
                    "format": "json",
                },
                headers=HEADERS,
                timeout=10,
            )
            members = resp.json().get("query", {}).get("categorymembers", [])
            car_pages = [m for m in members if _is_casting_title(m.get("title", ""))]
            if car_pages:
                pages = car_pages
                break
        except Exception:
            continue

    if not pages:
        return []

    # Batch-fetch thumbnails
    page_ids_str = "|".join(str(p["pageid"]) for p in pages[:limit * 3])
    try:
        img_resp = await client.get(
            f"{WIKI_BASE}/api.php",
            params={"action": "query", "pageids": page_ids_str,
                    "prop": "pageimages", "pithumbsize": "300", "format": "json"},
            headers=HEADERS,
            timeout=10,
        )
        img_pages = img_resp.json().get("query", {}).get("pages", {})
    except Exception:
        img_pages = {}

    results = []
    for p in pages[:limit * 3]:
        title = p["title"]
        pid = str(p["pageid"])
        thumb = img_pages.get(pid, {}).get("thumbnail", {})
        results.append({
            "collecthw_id": f"wiki_{pid}",
            "name": title,
            "year": year,
            "series_name": None,
            "primary_color": None,
            "image_url": thumb.get("source") if thumb else None,
            "treasure_hunt": False,
            "car_type": "mainline",
            "series_number": None,
            "set_number": None,
            "barcode": None,
            "versions": [],
            "in_db": False,
            "url": f"{WIKI_BASE}/wiki/{quote(title.replace(' ', '_'))}",
        })
    return results


@app.get("/api/scrape/feed")
async def scrape_feed(
    limit: int = 10,
    q: Optional[str] = None,
    year: Optional[int] = None,
    color: Optional[str] = None,
    car_type: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Return Hot Wheels castings.
    No filters → random wiki castings.
    Year only → wiki category for that year (reliable year browsing).
    Other filters → CollectHW text search + server-side filtering.
    """
    n = min(limit, 50)
    use_filters = any(v is not None and v != "" for v in [q, year, color, car_type])

    if not use_filters:
        async with _get_wiki_client() as client:
            pool = await _wiki_random(client, limit=max(n * 5, 50))

    elif year and not q and not color and not car_type:
        # Year-only: use wiki category — most reliable for year browsing
        async with _get_wiki_client() as client:
            pool = await _wiki_by_year(client, year, limit=max(n * 3, 30))

    elif q and not color and not car_type:
        # Name search: wiki search for reliable thumbnails + wiki URLs.
        # Wiki results are casting-level (no year field), so don't filter by year here —
        # the year filter is applied in the version detail view (pins matching versions to top).
        async with _get_wiki_client() as client:
            pool = await _wiki_search(client, q.strip(), limit=max(n * 3, 30))
            if not pool:
                pool = await _chw_search_cached(client, q.strip())

    else:
        # Color / car_type (and optional q/year) → CHW text search + post-filter
        query_parts = []
        if q:
            query_parts.append(q.strip())
        if color:
            query_parts.append(color.strip())
        # Don't include year in CHW text query — it doesn't match year fields
        search_q = " ".join(query_parts) if query_parts else "hot wheels"

        async with _get_wiki_client() as client:
            pool = await _chw_search_cached(client, search_q)

        if year:
            pool = [c for c in pool if c.get("year") == year]
        if color:
            cl = color.lower()
            pool = [c for c in pool if cl in (c.get("primary_color") or "").lower()]
        if car_type:
            ct = car_type.lower()
            pool = [c for c in pool if (c.get("car_type") or "").lower() == ct]

        # CHW images are hotlink-protected — supplement with wiki thumbnails for items
        # that have no image_url or whose collecthw image may not load in the browser.
        if pool:
            missing = [c for c in pool if not c.get("image_url")]
            if missing:
                try:
                    names_to_lookup = list({c["name"] for c in missing if c.get("name")})[:10]
                    async with _get_wiki_client() as client2:
                        wiki_results: list[dict] = []
                        for name in names_to_lookup:
                            wr = await _wiki_search(client2, name, limit=1)
                            wiki_results.extend(wr)
                    wiki_by_name = {w["name"].lower(): w for w in wiki_results}
                    for c in missing:
                        wm = wiki_by_name.get((c.get("name") or "").lower())
                        if wm and wm.get("image_url"):
                            c["image_url"] = wm["image_url"]
                        if wm and wm.get("url") and not c.get("url"):
                            c["url"] = wm["url"]
                except Exception:
                    pass

    if not pool:
        raise HTTPException(status_code=404, detail="No cars found matching those filters")

    # Mark cars whose name already exists in the DB
    try:
        names = [c["name"] for c in pool]
        existing = db.query(
            "SELECT name FROM all_cars WHERE name = ANY(%s)", (names,)
        )
        existing_names = {row["name"] for row in existing}
        for car in pool:
            car["in_db"] = car["name"] in existing_names
    except Exception:
        pass

    import random as _random
    _random.shuffle(pool)
    return pool[:n]


async def _toy_num_car_name(client: httpx.AsyncClient, page_title: str, code: str) -> Optional[str]:
    """Fetch a Hot Wheels list page and return the car name for the given toy number."""
    try:
        resp = await client.get(
            f"{WIKI_BASE}/api.php",
            params={"action": "parse", "page": page_title, "prop": "text", "format": "json"},
            headers=HEADERS,
            timeout=15,
        )
        html = resp.json()["parse"]["text"]["*"]
        soup = BeautifulSoup(html, "html.parser")
        for cell in soup.find_all(["td", "th"]):
            if _clean(cell.get_text()).upper() == code:
                row = cell.find_parent("tr")
                if not row:
                    continue
                for c in row.find_all(["td", "th"]):
                    link = c.find("a")
                    if link and _clean(c.get_text()) != code:
                        name = _clean(link.get_text())
                        if name and not name.startswith("List"):
                            return name
    except Exception:
        pass
    return None


@app.get("/api/toy-number/lookup")
async def toy_number_lookup(code: str, user=Depends(get_current_user)):
    """Look up a Hot Wheels car by its toy number / car code (e.g. CFH13).

    The 'List of YYYY Hot Wheels' pages are the canonical source for toy numbers.
    Full-text search finds the right list page; we parse its table to extract the
    car name, then do a direct wiki lookup for that casting.
    """
    code = code.strip().upper()
    if len(code) < 3:
        raise HTTPException(status_code=400, detail="Code too short")

    async with _get_wiki_client() as client:
        # Full-text wiki search — finds the "List of YYYY Hot Wheels" page that
        # contains this toy number in its table.
        try:
            resp = await client.get(
                f"{WIKI_BASE}/api.php",
                params={"action": "query", "list": "search", "srsearch": code,
                        "srwhat": "text", "srlimit": "10", "format": "json"},
                headers=HEADERS,
                timeout=10,
            )
            search_items = resp.json().get("query", {}).get("search", [])
        except Exception:
            raise HTTPException(status_code=404, detail="Lookup failed")

        # Find the "List of YYYY Hot Wheels ..." page — ignore everything else.
        list_hits = [r for r in search_items
                     if re.search(r"^List of \d{4} Hot Wheels", r.get("title", ""))]
        if not list_hits:
            raise HTTPException(status_code=404, detail="No car found for that code")

        list_title = list_hits[0]["title"].replace(" ", "_")
        car_name = await _toy_num_car_name(client, list_title, code)
        if not car_name:
            raise HTTPException(status_code=404, detail="No car found for that code")

        results = await _wiki_search(client, car_name, limit=3)
        if not results:
            raise HTTPException(status_code=404, detail="No car found for that code")
        return results


@app.get("/api/scrape/search")
async def scrape_search(q: str, user=Depends(get_current_user)):
    """Search for Hot Wheels castings via the wiki."""
    if not q or len(q.strip()) < 2:
        return []

    async with _get_wiki_client() as client:
        results = await _wiki_search(client, q.strip(), limit=15)

    return results


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


# Series keywords that indicate a premium-tier release
_PREMIUM_KEYWORDS = [
    "boulevard", "car culture", "retro entertainment", "pop culture",
    "vintage racing club", "hot wheels id", "pantone", "detroit muscle",
    "speed machines", "collector edition", "hw premium",
]


def _infer_car_type(series_name: str) -> Optional[str]:
    sl = series_name.lower()
    if any(kw in sl for kw in _PREMIUM_KEYWORDS):
        return "premium"
    return None


def _parse_series(raw: str) -> tuple[str, Optional[int], Optional[int]]:
    """Return (clean_series_name, series_number, series_total) from a raw wiki series cell."""
    # Pattern 1: "Name 3/10" or "Name3/10" → name, number=3, total=10
    m = re.search(r"(.+?)\s*(\d+)\s*/\s*(\d+)\s*$", raw)
    if m:
        return m.group(1).strip(), int(m.group(2)), int(m.group(3))
    # Pattern 2: "Name #123" or "Name#123" → name, number=123, no total
    m2 = re.search(r"(.+?)\s*#\s*(\d+)\s*$", raw)
    if m2:
        return m2.group(1).strip(), int(m2.group(2)), None
    return raw.strip(), None, None


def _parse_versions(soup: BeautifulSoup) -> list[dict]:
    """Parse the version tables on a casting page into a list of version dicts."""
    versions = []
    seen = set()  # deduplicate by (year, color, series)

    for table in soup.find_all("table", class_=re.compile(r"wikitable")):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue

        # Find column indices from header row
        headers = [_clean(th.get_text()).lower() for th in rows[0].find_all("th")]
        if "year" not in headers and "color" not in headers:
            continue

        def col(name: str) -> int:
            return next((i for i, h in enumerate(headers) if name in h), -1)

        year_idx = col("year")
        color_idx = col("color")
        series_idx = col("series")
        col_num_idx = col("col #")
        toy_idx = col("toy")
        photo_idx = col("photo")

        # Track rowspan carry-overs: {col_position: (remaining_rows, value)}
        rowspans: dict[int, tuple[int, str]] = {}

        for row in rows[1:]:
            cells = row.find_all(["td", "th"])
            if not cells:
                continue

            # Build full row resolving rowspans
            full: dict[int, str] = {}
            for pos, (remaining, val) in list(rowspans.items()):
                if remaining > 0:
                    full[pos] = val
                    rowspans[pos] = (remaining - 1, val)
                else:
                    del rowspans[pos]

            actual = 0
            for cell in cells:
                while actual in full:
                    actual += 1
                span = int(cell.get("rowspan", 1))

                # Get photo URL from lazy-loaded <a href>, else data-src
                img = cell.find("img")
                if img:
                    a = img.parent
                    photo_href = a.get("href", "") if a and a.name == "a" else ""
                    data_src = img.get("data-src", "")
                    val = photo_href or re.sub(r"/scale-to-width-down/\d+", "", data_src)
                else:
                    val = _clean(cell.get_text())

                full[actual] = val
                if span > 1:
                    rowspans[actual] = (span - 1, val)
                actual += 1

            year_raw = full.get(year_idx, "")
            if not year_raw or not re.match(r"\d{4}", str(year_raw)):
                continue

            try:
                year = int(re.search(r"\d{4}", year_raw).group())
            except Exception:
                continue

            color = full.get(color_idx, "") or ""
            series_raw = full.get(series_idx, "") or ""
            col_num = full.get(col_num_idx, "") or ""
            toy_raw = full.get(toy_idx, "") or "" if toy_idx >= 0 else ""
            photo = full.get(photo_idx, "") or ""

            series_name, series_number, series_total = _parse_series(series_raw)

            # Parse set_number from col_num e.g. "006/223" → 6
            set_number = None
            m2 = re.search(r"(\d+)\s*/\s*\d+", col_num)
            if m2:
                try:
                    set_number = int(m2.group(1))
                except Exception:
                    pass

            car_type = _infer_car_type(series_name)

            key = (year, color.lower(), series_name.lower())
            if key in seen:
                continue
            seen.add(key)

            # Clean toy number: strip whitespace, take first token if multiple
            toy_number = re.split(r"[\s/]", toy_raw.strip())[0].upper() if toy_raw.strip() else None

            versions.append({
                "year": year,
                "color": color,
                "series_name": series_name,
                "series_number": series_number,
                "series_total": series_total,
                "set_number": set_number,
                "toy_number": toy_number,
                "photo_url": photo,
                "car_type": car_type,
            })

    # Sort most recent first, cap at 150
    versions.sort(key=lambda v: v["year"], reverse=True)
    return versions[:150]


@app.get("/api/scrape/car")
async def scrape_car(url: str, user=Depends(get_current_user)):
    """Fetch structured car data from a Hot Wheels wiki page via the MediaWiki API."""
    return await _wiki_car_detail(url)


async def _wiki_car_detail(url: str) -> dict:
    """The body of /api/scrape/car, callable in-process.

    The sheet importer needs a casting page's version table for every row it
    looks up; going back out through its own HTTP API to get it would cost a
    round trip and an auth check per row.
    """
    # Extract page name from URL: ".../wiki/Bone_Shaker" → "Bone_Shaker"
    page_name = unquote(urlparse(url).path.split("/wiki/")[-1])
    if not page_name:
        raise HTTPException(status_code=400, detail="Invalid wiki URL")

    api_url = (
        f"{WIKI_BASE}/api.php"
        f"?action=parse&page={quote(page_name)}&redirects=true&prop=text|categories&format=json"
    )
    resp = await _get_wiki_client().get(api_url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    if "error" in data:
        raise HTTPException(status_code=404, detail="Page not found on wiki")

    html = data["parse"]["text"]["*"]
    categories = [c.get("*", "") for c in data["parse"].get("categories", [])]
    result: dict = {}

    # Name from parsed title (most reliable)
    result["name"] = data["parse"].get("title", "")

    soup = BeautifulSoup(html, "html.parser")

    # Portable infobox
    infobox = soup.find("aside", class_=re.compile(r"portable-infobox"))
    if infobox:
        # Image: use <a> href for full-size; fallback data-src with scale params stripped
        img_el = infobox.find("img")
        if img_el:
            link = img_el.parent
            if link and link.name == "a" and link.get("href"):
                result["image_url"] = link["href"]
            else:
                data_src = img_el.get("data-src", "") or img_el.get("src", "")
                result["image_url"] = re.sub(r"/scale-to-width-down/\d+", "", data_src)

        # Casting infobox fields: "Debut series", "Produced"
        for item in infobox.find_all("div", class_="pi-item"):
            label_el = item.find("h3", class_="pi-data-label")
            value_el = item.find("div", class_="pi-data-value")
            if not label_el or not value_el:
                continue
            label = _clean(label_el.get_text()).lower()
            value = _clean(value_el.get_text())

            if "produced" in label or "year" in label:
                try:
                    result["year"] = int(re.search(r"\d{4}", value).group())
                except Exception:
                    pass
            elif "debut series" in label or label == "series":
                result["series_name"] = value

    # Version list from sortable tables
    result["versions"] = _parse_versions(soup)

    return result


# ─── Sheet import ─────────────────────────────────────────────────────────────
# The collection was kept in a Numbers spreadsheet for years, and moving it in is
# a few thousand judgement calls ("is this the blue 2015 one?") that no amount of
# matching can make automatically. So the queue lives in Postgres and this API
# serves it one row at a time: importer.py holds the state and the scoring, these
# routes are the thin layer over it.

MAX_SHEET_BYTES = 25 * 1024 * 1024


class ImportSheetUpdate(BaseModel):
    carded: bool


class ImportPrefetch(BaseModel):
    row_ids: list[str]


class ImportStatusUpdate(BaseModel):
    status: Literal["pending", "skipped", "already_done", "later"]


class ImportCommit(BaseModel):
    """One approved row. Everything is explicit: the review screen sends what is
    on screen, including any edits, rather than the server re-deriving it."""
    name: str
    car_id: Optional[str] = None          # reuse a catalogue car instead of creating one
    candidate_key: Optional[str] = None   # which card was approved, for the record
    year: Optional[int] = None
    primary_color: Optional[str] = None
    series_name: Optional[str] = None
    series_type: Literal["mainline", "premium", "collector"] = "mainline"
    series_number: Optional[int] = None
    set_number: Optional[int] = None
    toy_number: Optional[str] = None
    car_type: Optional[str] = None
    treasure_hunt: bool = False
    image_url: Optional[str] = None
    add_to_collection: bool = True
    carded: bool = True
    condition: str = "mint"
    amount_owned: int = 1
    notes: Optional[str] = None


class _UrllibResponse:
    """The parts of an httpx response the wiki helpers actually use."""

    __slots__ = ("status_code", "text")

    def __init__(self, status_code: int, text: str):
        self.status_code = status_code
        self.text = text

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self) -> "_UrllibResponse":
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code} from the wiki")
        return self


class UrllibClient:
    """A stand-in for httpx.AsyncClient that fetches through urllib.

    Fandom sits behind Cloudflare, which currently answers httpx with 403 while
    letting urllib through from the same machine and address — it is the client
    fingerprint being turned away, not us. Since every lookup in the sheet
    importer depends on those requests, the wiki calls go through urllib in a
    worker thread instead. The interface matches the small part of httpx that the
    wiki helpers use, so their code is unchanged.
    """

    def __init__(self, timeout: float = 20.0):
        self._timeout = timeout

    @property
    def is_closed(self) -> bool:
        return False

    async def get(self, url: str, *, params=None, headers=None, timeout=None) -> _UrllibResponse:
        if params:
            url = f"{url}{'&' if '?' in url else '?'}{urlencode(params)}"
        request = urllib.request.Request(url, headers=headers or HEADERS)
        deadline = timeout or self._timeout

        def fetch() -> _UrllibResponse:
            try:
                with urllib.request.urlopen(request, timeout=deadline) as response:
                    body = response.read()
                    if response.headers.get("Content-Encoding") == "gzip":
                        body = gzip.decompress(body)
                    return _UrllibResponse(response.status, body.decode("utf-8", "replace"))
            except urllib.error.HTTPError as exc:
                return _UrllibResponse(exc.code, exc.read().decode("utf-8", "replace"))

        return await asyncio.to_thread(fetch)

    async def aclose(self) -> None:
        return None

    # Usable as `async with`, like the httpx client it replaces — but leaving the
    # block must not close it, since it is shared by every caller.
    async def __aenter__(self) -> "UrllibClient":
        return self

    async def __aexit__(self, *_exc) -> None:
        return None


# One client for wiki lookups, reused across the thousands the importer makes.
_wiki_client: Optional[UrllibClient] = None


def _get_wiki_client() -> UrllibClient:
    global _wiki_client
    if _wiki_client is None:
        _wiki_client = UrllibClient()
    return _wiki_client


async def _close_wiki_client() -> None:
    if _wiki_client is not None:
        await _wiki_client.aclose()


# Prefetch tasks outlive the request that started them, so they need a strong
# reference here — without one the event loop can garbage-collect a task
# mid-flight and the lookups silently stop happening.
_background_tasks: set[asyncio.Task] = set()


async def _import_search(q: str) -> list[dict]:
    return await _wiki_search(_get_wiki_client(), q, limit=8)


def _lookups() -> dict:
    return {"search": _import_search, "detail": _wiki_car_detail}


@app.post("/api/import/batches", status_code=201)
async def import_upload(file: UploadFile = File(...), user=Depends(get_current_user)):
    """Parse an uploaded sheet and open a review queue for it."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="That file is empty")
    if len(data) > MAX_SHEET_BYTES:
        raise HTTPException(status_code=413, detail="That file is larger than 25 MB")

    filename = file.filename or "sheet"
    try:
        # Parsing a Numbers document is a second or two of CPU — off the event
        # loop so it doesn't stall every other request in the meantime.
        rows = await asyncio.to_thread(sheet_import.parse, data, filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read that file: {exc}")

    if not rows:
        raise HTTPException(
            status_code=400,
            detail="No car rows found. The sheet needs a header row with at least a Name column.",
        )

    batch = importer.create_batch(user.id, filename, rows)
    return importer.batch_summary(user.id, str(batch["id"]))


@app.get("/api/import/batches")
def import_list_batches(user=Depends(get_current_user)):
    return importer.list_batches(user.id)


@app.get("/api/import/batches/{batch_id}")
def import_get_batch(batch_id: str, user=Depends(get_current_user)):
    try:
        batch = importer.batch_summary(user.id, batch_id)
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Import not found")
        raise
    if not batch:
        raise HTTPException(status_code=404, detail="Import not found")
    return batch


@app.delete("/api/import/batches/{batch_id}", status_code=204)
def import_delete_batch(batch_id: str, user=Depends(get_current_user)):
    """Closes the queue. Cars and collection entries already imported stay put."""
    try:
        deleted = importer.delete_batch(user.id, batch_id)
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Import not found")
        raise
    if not deleted:
        raise HTTPException(status_code=404, detail="Import not found")


@app.patch("/api/import/batches/{batch_id}/sheets/{sheet}")
def import_update_sheet(
    batch_id: str, sheet: str, body: ImportSheetUpdate, user=Depends(get_current_user)
):
    """Correct the carded/loose reading of a sheet, for rows not yet decided."""
    if not importer.batch_summary(user.id, batch_id):
        raise HTTPException(status_code=404, detail="Import not found")
    importer.set_sheet_carded(user.id, batch_id, sheet, body.carded)
    return importer.batch_summary(user.id, batch_id)


@app.get("/api/import/batches/{batch_id}/queue")
def import_queue(
    batch_id: str,
    sheet: Optional[str] = None,
    status: str = "open",
    after_position: Optional[int] = None,
    limit: int = 25,
    user=Depends(get_current_user),
):
    try:
        if not importer.batch_summary(user.id, batch_id):
            raise HTTPException(status_code=404, detail="Import not found")
        return importer.queue(
            user.id, batch_id,
            sheet=sheet, status=status, after_position=after_position, limit=limit,
        )
    except HTTPException:
        raise
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Import not found")
        raise


@app.post("/api/import/batches/{batch_id}/prefetch", status_code=202)
async def import_prefetch(batch_id: str, body: ImportPrefetch, user=Depends(get_current_user)):
    """Start looking up the rows the review screen is about to show.

    Returns immediately; results land in the rows themselves, so the screen picks
    them up on its next poll and the wait for row 40 already happened at row 30.
    """
    if not body.row_ids:
        return {"scheduled": 0}
    task = asyncio.create_task(
        importer.prefetch_rows(user.id, body.row_ids[:40], **_lookups())
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return {"scheduled": len(body.row_ids[:40])}


@app.get("/api/import/rows/{row_id}/candidates")
async def import_candidates(
    row_id: str,
    q: Optional[str] = None,
    refresh: bool = False,
    user=Depends(get_current_user),
):
    """Candidates for one row, computed now if they aren't cached yet.

    `q` re-runs the search with a different term — the sheet's own wording is
    sometimes too far off to find anything ("?(build up car)").
    """
    try:
        row = importer.get_row(user.id, row_id)
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Row not found")
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")

    cached = row.get("candidates") or {}
    if not refresh and not q and row["candidate_state"] == "ready":
        return cached

    query = (q or row["raw"].get("query") or "").strip()
    try:
        candidates = await importer.build_candidates(
            user.id, row["raw"], query=q or None, **_lookups()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Lookup failed: {exc}")
    importer.save_candidates(row_id, candidates, query)
    return (importer.get_row(user.id, row_id) or {}).get("candidates") or {}


@app.post("/api/import/rows/{row_id}/status")
def import_set_status(row_id: str, body: ImportStatusUpdate, user=Depends(get_current_user)):
    """Skip a row, park it for later, mark it done by hand, or put it back."""
    try:
        row = importer.set_status(user.id, row_id, body.status)
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Row not found")
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")
    return row


@app.post("/api/import/rows/{row_id}/commit")
async def import_commit(row_id: str, body: ImportCommit, user=Depends(get_current_user)):
    """Approve a row: add the car to the catalogue if needed, then to the collection.

    Committing per row rather than in one pass at the end is what makes the queue
    resumable — every decision is durable the moment it is made, and `undo` is
    there for the ones that were wrong.
    """
    try:
        row = importer.get_row(user.id, row_id)
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Row not found")
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")
    if row["status"] == "imported":
        raise HTTPException(status_code=409, detail="That row was already imported")

    created_series_id: Optional[str] = None
    created_car = False
    car_id = body.car_id

    if car_id:
        car = db.query_one("SELECT * FROM all_cars WHERE id = %s", (car_id,))
        if not car:
            raise HTTPException(status_code=404, detail="Car not found")
    else:
        series_id: Optional[str] = None
        if body.series_name:
            series_id, was_created = importer.resolve_series(body.series_name, body.series_type)
            if was_created:
                created_series_id = series_id
        car = await _create_car_record(CarCreate(
            name=body.name.strip(),
            series_id=series_id,
            year=body.year,
            toy_number=body.toy_number,
            primary_color=body.primary_color,
            set_number=body.set_number,
            series_number=body.series_number,
            image_url=body.image_url,
            treasure_hunt=body.treasure_hunt,
            car_type=body.car_type or ("treasure hunt" if body.treasure_hunt else body.series_type),
        ))
        car_id = str(car["id"])
        created_car = True

    match: dict = {
        "car_id": car_id,
        "created_car": created_car,
        "created_series_id": created_series_id,
        "candidate_key": body.candidate_key,
    }

    entry = None
    if body.add_to_collection:
        entry, amount_added, is_new = importer.add_or_increment_collection(user.id, car_id, {
            "amount_owned": body.amount_owned,
            "carded": body.carded,
            "condition": body.condition,
            "notes": body.notes,
        })
        match |= {
            "collection_id": str(entry["id"]),
            "amount_added": amount_added,
            "created_collection_entry": is_new,
        }

    updated = importer.record_commit(row_id, match)
    return {
        "row": updated,
        "car": db.query_one(f"{db.SELECT_CAR_WITH_SERIES} WHERE c.id = %s", (car_id,)),
        "collection_entry": entry,
    }


@app.post("/api/import/rows/{row_id}/undo")
def import_undo(row_id: str, user=Depends(get_current_user)):
    """Take back the last approval: the collection entry goes, and so does the car
    if this import created it and nothing else uses it."""
    try:
        row = importer.undo(user.id, row_id)
    except Exception as exc:
        if db.is_invalid_uuid(exc):
            raise HTTPException(status_code=404, detail="Row not found")
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")
    return row
