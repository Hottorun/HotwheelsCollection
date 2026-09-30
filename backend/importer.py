"""Spreadsheet import sessions: the state and the matching behind the review screen.

Importing a 2,500-row sheet is not one action, it is a few thousand small
decisions taken over days, so the queue lives in Postgres rather than in a
browser tab. A row carries its parsed spreadsheet values, the candidates found
for it, and what was eventually done with it; closing the tab loses nothing and
reopening resumes exactly where the last decision was made.

Candidates come from two places. The local catalogue is checked first — a car
that is already there must not be created a second time, and one already in the
collection should show up saying so. Then the wiki: its search finds the casting
page, and that page's version table is what actually answers the question the
spreadsheet poses, because a row says "blue, 2015" and the casting has twenty
colours across twenty years. Each version becomes its own candidate, scored on
how well it matches the row, so approving the top card is usually the right
answer and the alternatives are one keystroke away.

Nothing here reaches the network itself. The wiki functions live in main.py and
are passed in, which keeps this module importable — and its scoring testable —
without a running app.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Any, Awaitable, Callable, Optional

import db

log = logging.getLogger("importer")

# ─── Schema ──────────────────────────────────────────────────────────────────
# Applied by migrations.run() on every boot, and by migration/schema.sql on a
# fresh database. Keep every statement idempotent.

DDL = [
    """
    CREATE TABLE IF NOT EXISTS import_batch (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        source_name text NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS import_row (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id         uuid NOT NULL REFERENCES import_batch (id) ON DELETE CASCADE,
        user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        sheet            text NOT NULL,
        row_index        integer NOT NULL,
        position         integer NOT NULL,
        raw              jsonb NOT NULL,
        marker           text NOT NULL DEFAULT 'none',
        status           text NOT NULL DEFAULT 'pending',
        candidates       jsonb,
        candidate_state  text NOT NULL DEFAULT 'empty',
        match            jsonb,
        decided_at       timestamptz
    )
    """,
    "CREATE INDEX IF NOT EXISTS import_row_batch_idx ON import_row (batch_id, position)",
    "CREATE INDEX IF NOT EXISTS import_row_queue_idx ON import_row (batch_id, status, position)",
    "CREATE INDEX IF NOT EXISTS import_batch_user_idx ON import_batch (user_id, created_at DESC)",
]

# pending      — waiting for a decision
# imported     — a car was added to the collection from this row, by this tool
# skipped      — deliberately passed over (not a Hot Wheels car, a duplicate, …)
# already_done — green in the sheet: imported by hand before this tool existed
# later        — parked, to come back to
STATUSES = ("pending", "imported", "skipped", "already_done", "later")

# Rows still needing attention, in the order the review screen serves them.
OPEN_STATUSES = ("pending", "later")


# ─── Name normalising and scoring ────────────────────────────────────────────

_SYNONYMS = {
    "vw": "volkswagen",
    "chevy": "chevrolet",
    "merc": "mercedes",
    "mercedes-benz": "mercedes",
    "benz": "mercedes",
    "lambo": "lamborghini",
    "porsche": "porsche",
    "corvette": "corvette",
}


def normalise_name(name: str) -> str:
    """Lowercase, punctuation-free, year-prefix-free — for comparing names only.

    The sheet writes year prefixes half a dozen ways ("`69", "'69", "69", "1969")
    and the wiki writes them with a curly quote, so the prefix is stripped from
    both sides rather than tried to be matched.
    """
    text = name.lower()
    text = re.sub(r"[`'‘’\"]", "", text)
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    text = re.sub(r"^(19|20)?\d{2}\s+", "", text)
    words = [_SYNONYMS.get(w, w) for w in text.split()]
    return " ".join(words)


def name_similarity(a: str, b: str) -> float:
    left, right = normalise_name(a), normalise_name(b)
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    ratio = SequenceMatcher(None, left, right).ratio()
    # Token containment rescues "nissan skyline gt r 32" against the wiki's
    # longer "nissan skyline gt-r (bnr32)", which character ratio underrates.
    left_words, right_words = set(left.split()), set(right.split())
    overlap = len(left_words & right_words) / max(1, min(len(left_words), len(right_words)))
    return max(ratio, overlap * 0.95)


_COLOR_WORDS = re.compile(r"[a-z]+")


def colour_overlap(sheet_colour: str, candidate_colour: str) -> float:
    """How much two free-text colour descriptions agree, 0..1.

    Both sides are lists in practice — "yellow and black" in the sheet, "Black
    with red tampos" on the wiki — so this compares word sets rather than strings.
    """
    if not sheet_colour or not candidate_colour:
        return 0.0
    stop = {"and", "with", "the", "metalflake", "metallic", "spectraflame", "pearl", "colors", "color"}
    left = {w for w in _COLOR_WORDS.findall(sheet_colour.lower()) if w not in stop and len(w) > 2}
    right = {w for w in _COLOR_WORDS.findall(candidate_colour.lower()) if w not in stop and len(w) > 2}
    if not left or not right:
        return 0.0
    return len(left & right) / len(left)


def score_candidate(row: dict, candidate: dict) -> tuple[int, list[str]]:
    """0..100 plus the reasons, which the review screen shows under the card.

    Weighted so that name carries the decision and year and colour break ties:
    a row only reaches this function with candidates for roughly the right
    casting, and what is actually being chosen is which release it is.
    """
    reasons: list[str] = []
    similarity = name_similarity(row.get("name") or "", candidate.get("name") or "")
    score = 55.0 * similarity
    if similarity >= 0.995:
        reasons.append("name matches exactly")
    elif similarity >= 0.8:
        reasons.append("name is close")

    row_year, candidate_year = row.get("year"), candidate.get("year")
    if row_year and candidate_year:
        gap = abs(int(row_year) - int(candidate_year))
        if gap == 0:
            score += 22
            reasons.append(f"year matches ({candidate_year})")
        elif gap == 1:
            score += 9
            reasons.append(f"year off by one ({candidate_year})")
        else:
            score -= min(10, gap)
    elif candidate_year and not row_year:
        reasons.append(f"sheet has no year (this is {candidate_year})")

    overlap = colour_overlap(row.get("color") or "", candidate.get("color") or "")
    if overlap >= 0.99:
        score += 15
        reasons.append("colour matches")
    elif overlap > 0:
        score += 15 * overlap
        reasons.append("colour partly matches")

    set_name = (row.get("set_name") or "").strip()
    candidate_series = (candidate.get("series_name") or "").strip()
    if set_name and candidate_series:
        if name_similarity(set_name, candidate_series) >= 0.8:
            score += 12
            reasons.append("series matches the sheet")

    if row.get("treasure_hunt") and candidate.get("treasure_hunt"):
        score += 4
        reasons.append("treasure hunt on both sides")

    return max(0, min(100, round(score))), reasons


# ─── Candidate sources ───────────────────────────────────────────────────────

def catalogue_candidates(user_id: str, row: dict, limit: int = 6) -> list[dict]:
    """Cars already in the catalogue, so nothing gets created twice.

    A hit the collection already holds is the most useful answer of all: it means
    the row is done and the review screen can say so instead of offering to add a
    duplicate.
    """
    query = (row.get("query") or row.get("name") or "").strip()
    if len(query) < 2:
        return []
    found = db.query(
        """
        SELECT c.*,
               s.name AS series_name,
               s.type AS series_type,
               uc.id  AS collection_id,
               uc.amount_owned
        FROM all_cars c
        LEFT JOIN series s ON s.id = c.series_id
        LEFT JOIN user_collection uc ON uc.allcars_id = c.id AND uc.user_id = %s
        WHERE similarity(c.name, %s) >= 0.28 OR c.name ILIKE %s
        ORDER BY similarity(c.name, %s) DESC
        LIMIT %s
        """,
        (user_id, query, f"%{query}%", query, limit * 2),
    )

    candidates = []
    for car in found:
        candidate = {
            "key": f"catalogue:{car['id']}",
            "source": "collection" if car.get("collection_id") else "catalogue",
            "car_id": str(car["id"]),
            "collection_id": str(car["collection_id"]) if car.get("collection_id") else None,
            "amount_owned": car.get("amount_owned"),
            "name": car["name"],
            "year": car.get("year"),
            "color": car.get("primary_color"),
            "series_name": car.get("series_name"),
            "series_number": car.get("series_number"),
            "set_number": car.get("set_number"),
            "toy_number": car.get("toy_number"),
            "car_type": car.get("car_type"),
            "treasure_hunt": bool(car.get("treasure_hunt")),
            "image_url": car.get("image_url"),
            "url": None,
        }
        score, reasons = score_candidate(row, candidate)
        # The catalogue is the cheaper, safer answer, so a match there outranks an
        # equally good wiki version rather than sitting below it by coin toss.
        candidate["score"] = min(100, score + 3)
        candidate["reasons"] = (["already in your collection"] if candidate["collection_id"]
                               else ["already in the catalogue"]) + reasons
        candidates.append(candidate)

    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates[:limit]


async def wiki_candidates(
    row: dict,
    *,
    search: Callable[[str], Awaitable[list[dict]]],
    detail: Callable[[str], Awaitable[dict]],
    query: Optional[str] = None,
    pages: int = 2,
    limit: int = 10,
) -> list[dict]:
    """Search the wiki, then expand the best casting pages into their versions."""
    term = (query or row.get("query") or row.get("name") or "").strip()
    if len(term) < 2:
        return []

    try:
        hits = await search(term)
    except Exception as exc:  # a lookup failure must not lose the row
        log.warning("wiki search failed for %r: %s", term, exc)
        return []

    # Only the closest pages are worth a second request each.
    ranked = sorted(
        (h for h in hits if h.get("url")),
        key=lambda h: name_similarity(row.get("name") or term, h.get("name") or ""),
        reverse=True,
    )

    candidates: list[dict] = []
    for hit in ranked[:pages]:
        page_name = hit.get("name") or ""
        page_url = hit.get("url")
        versions: list[dict] = []
        page_image = hit.get("image_url")
        try:
            data = await detail(page_url)
            versions = data.get("versions") or []
            page_image = data.get("image_url") or page_image
            page_name = data.get("name") or page_name
        except Exception as exc:
            log.warning("wiki page failed for %r: %s", page_url, exc)

        if not versions:
            # No version table (or the page failed): the casting itself is still a
            # usable answer, just without a release to pin it to.
            candidate = {
                "key": f"wiki:{page_url}",
                "source": "wiki",
                "car_id": None,
                "collection_id": None,
                "name": page_name,
                "year": hit.get("year"),
                "color": None,
                "series_name": hit.get("series_name"),
                "series_number": None,
                "set_number": None,
                "toy_number": None,
                "car_type": hit.get("car_type") or "mainline",
                "treasure_hunt": bool(hit.get("treasure_hunt")),
                "image_url": page_image,
                "url": page_url,
            }
            candidate["score"], candidate["reasons"] = score_candidate(row, candidate)
            candidates.append(candidate)
            continue

        for version in versions:
            candidate = {
                "key": f"wiki:{page_url}:{version.get('year')}:{version.get('color')}:{version.get('series_name')}",
                "source": "wiki",
                "car_id": None,
                "collection_id": None,
                "name": page_name,
                "year": version.get("year"),
                "color": version.get("color") or None,
                "series_name": version.get("series_name") or None,
                "series_number": version.get("series_number"),
                "series_total": version.get("series_total"),
                "set_number": version.get("set_number"),
                "toy_number": version.get("toy_number"),
                "car_type": version.get("car_type") or "mainline",
                "treasure_hunt": bool(row.get("treasure_hunt")),
                "image_url": version.get("photo_url") or page_image,
                "url": page_url,
            }
            candidate["score"], candidate["reasons"] = score_candidate(row, candidate)
            candidates.append(candidate)

    candidates.sort(key=lambda c: c["score"], reverse=True)

    # One casting can have a hundred near-identical versions; showing more than a
    # couple per page is noise, and the review screen only has room for a handful.
    seen: dict[str, int] = {}
    trimmed: list[dict] = []
    for candidate in candidates:
        page = candidate.get("url") or ""
        if seen.get(page, 0) >= 6:
            continue
        seen[page] = seen.get(page, 0) + 1
        trimmed.append(candidate)
        if len(trimmed) >= limit:
            break
    return trimmed


async def build_candidates(
    user_id: str,
    row: dict,
    *,
    search: Callable[[str], Awaitable[list[dict]]],
    detail: Callable[[str], Awaitable[dict]],
    query: Optional[str] = None,
) -> list[dict]:
    """Everything worth offering for one row, best first."""
    local = catalogue_candidates(user_id, row)

    # A row the sheet itself says is not a Hot Wheels car (Matchbox, Majorette,
    # Mini GT) or never identified has nothing to find on the wiki. Skipping the
    # lookup keeps the queue moving instead of spending two requests on a miss.
    skip_wiki = bool(row.get("unidentified")) or (bool(row.get("other_brand")) and query is None)
    remote = [] if skip_wiki else await wiki_candidates(
        row, search=search, detail=detail, query=query
    )

    combined = local + remote
    combined.sort(key=lambda c: c["score"], reverse=True)
    return combined[:14]


# ─── Batches ─────────────────────────────────────────────────────────────────

def create_batch(user_id: str, source_name: str, rows: list[dict]) -> dict:
    """Store a parsed sheet as a reviewable batch.

    Rows the sheet marks green were imported by hand already, so they start as
    already_done: visible, countable, but out of the queue. Everything else is
    pending, including the orange "couldn't find it" rows — those are exactly the
    ones worth another try with better matching.
    """
    batch = db.insert("import_batch", {"user_id": user_id, "source_name": source_name})
    if not rows:
        return batch

    values = []
    for position, row in enumerate(rows):
        marker = row.get("marker") or "none"
        status = "already_done" if marker == "green" else "pending"
        values.append((
            batch["id"], user_id, row["sheet"], row["row_index"], position,
            json.dumps(row), marker, status,
        ))

    with db.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO import_row
                (batch_id, user_id, sheet, row_index, position, raw, marker, status)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s)
            """,
            values,
        )
    return batch


def batch_summary(user_id: str, batch_id: str) -> Optional[dict]:
    batch = db.query_one(
        "SELECT * FROM import_batch WHERE id = %s AND user_id = %s", (batch_id, user_id)
    )
    if not batch:
        return None
    batch["sheets"] = db.query(
        """
        SELECT sheet,
               count(*)                                          AS total,
               count(*) FILTER (WHERE status = 'pending')         AS pending,
               count(*) FILTER (WHERE status = 'imported')        AS imported,
               count(*) FILTER (WHERE status = 'skipped')         AS skipped,
               count(*) FILTER (WHERE status = 'later')           AS later,
               count(*) FILTER (WHERE status = 'already_done')    AS already_done,
               count(*) FILTER (WHERE marker = 'amber')           AS amber,
               bool_or((raw ->> 'carded')::boolean)               AS carded,
               min(position)                                      AS first_position
        FROM import_row
        WHERE batch_id = %s
        GROUP BY sheet
        ORDER BY min(position)
        """,
        (batch_id,),
    )
    batch["totals"] = db.query_one(
        """
        SELECT count(*)                                       AS total,
               count(*) FILTER (WHERE status = 'pending')      AS pending,
               count(*) FILTER (WHERE status = 'imported')     AS imported,
               count(*) FILTER (WHERE status = 'skipped')      AS skipped,
               count(*) FILTER (WHERE status = 'later')        AS later,
               count(*) FILTER (WHERE status = 'already_done') AS already_done
        FROM import_row
        WHERE batch_id = %s
        """,
        (batch_id,),
    )
    return batch


def list_batches(user_id: str) -> list[dict]:
    return db.query(
        """
        SELECT b.*,
               count(r.id)                                          AS total,
               count(r.id) FILTER (WHERE r.status = 'pending')       AS pending,
               count(r.id) FILTER (WHERE r.status = 'imported')      AS imported,
               count(r.id) FILTER (WHERE r.status = 'skipped')       AS skipped,
               count(r.id) FILTER (WHERE r.status = 'later')         AS later,
               count(r.id) FILTER (WHERE r.status = 'already_done')  AS already_done
        FROM import_batch b
        LEFT JOIN import_row r ON r.batch_id = b.id
        WHERE b.user_id = %s
        GROUP BY b.id
        ORDER BY b.created_at DESC
        """,
        (user_id,),
    )


def delete_batch(user_id: str, batch_id: str) -> int:
    """Drops the queue only. Cars and collection entries it created stay."""
    return db.delete("import_batch", "id = %s AND user_id = %s", (batch_id, user_id))


def set_sheet_carded(user_id: str, batch_id: str, sheet: str, carded: bool) -> int:
    """Fix a wrong carded/loose guess for a whole sheet.

    Only rows that have not been decided yet are touched — a car already imported
    as loose keeps whatever was actually recorded for it.
    """
    return db.execute(
        """
        UPDATE import_row
        SET raw = jsonb_set(raw, '{carded}', %s::jsonb)
        WHERE batch_id = %s AND user_id = %s AND sheet = %s
          AND status IN ('pending', 'later')
        """,
        ("true" if carded else "false", batch_id, user_id, sheet),
    )


# ─── Rows ────────────────────────────────────────────────────────────────────

def get_row(user_id: str, row_id: str) -> Optional[dict]:
    return db.query_one(
        "SELECT * FROM import_row WHERE id = %s AND user_id = %s", (row_id, user_id)
    )


def queue(
    user_id: str,
    batch_id: str,
    *,
    sheet: Optional[str] = None,
    status: str = "open",
    after_position: Optional[int] = None,
    limit: int = 25,
) -> list[dict]:
    """Rows in sheet order — the deck the review screen works through.

    `status` is "open" for everything still needing a decision, "all", or one of
    STATUSES to look back over what was done.
    """
    clauses = ["batch_id = %s", "user_id = %s"]
    params: list[Any] = [batch_id, user_id]
    if sheet:
        clauses.append("sheet = %s")
        params.append(sheet)
    if status == "open":
        clauses.append("status = ANY(%s)")
        params.append(list(OPEN_STATUSES))
    elif status != "all":
        clauses.append("status = %s")
        params.append(status)
    if after_position is not None:
        clauses.append("position > %s")
        params.append(after_position)

    params.append(max(1, min(limit, 100)))
    return db.query(
        f"SELECT * FROM import_row WHERE {' AND '.join(clauses)} ORDER BY position LIMIT %s",
        params,
    )


def save_candidates(row_id: str, candidates: list[dict], query: str, state: str = "ready") -> None:
    db.execute(
        """
        UPDATE import_row
        SET candidates = %s::jsonb, candidate_state = %s
        WHERE id = %s
        """,
        (json.dumps({
            "items": candidates,
            "query": query,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }), state, row_id),
    )


def set_status(user_id: str, row_id: str, status: str) -> Optional[dict]:
    if status not in STATUSES:
        raise ValueError(f"unknown status {status!r}")
    updated = db.query_one(
        """
        UPDATE import_row
        SET status = %s,
            decided_at = CASE WHEN %s = 'pending' THEN NULL ELSE now() END
        WHERE id = %s AND user_id = %s
        RETURNING *
        """,
        (status, status, row_id, user_id),
    )
    return updated


# ─── Committing a decision ───────────────────────────────────────────────────

def _normalise_series(name: str) -> str:
    return re.sub(r"\b\d{4}\b", " ", re.sub(r"[^a-z0-9 ]", "", name.lower())).strip()


def resolve_series(name: str, series_type: str) -> tuple[Optional[str], bool]:
    """Find a series by name, ignoring case and year noise; create it if new.

    The sheet writes the same set a few ways ("factory fresh", "Factory Fresh"),
    so matching has to be loose or the series list ends up with duplicates.
    """
    name = (name or "").strip()
    if not name:
        return None, False
    target = _normalise_series(name)
    for existing in db.query("SELECT id, name FROM series"):
        if _normalise_series(existing["name"]) == target:
            return str(existing["id"]), False
    created = db.insert("series", {"name": name, "type": series_type or "mainline"})
    return str(created["id"]), True


def record_commit(row_id: str, match: dict) -> Optional[dict]:
    return db.query_one(
        """
        UPDATE import_row
        SET status = 'imported', match = %s::jsonb, decided_at = now()
        WHERE id = %s
        RETURNING *
        """,
        (json.dumps(match), row_id),
    )


def add_or_increment_collection(user_id: str, car_id: str, entry: dict) -> tuple[dict, int, bool]:
    """Add a collection entry, or raise the count if that car is already there.

    Returns the entry, how much this import added to it, and whether the entry is
    new — which is what an undo needs in order to put a pre-existing count back
    instead of deleting a row the collection already had.
    """
    existing = db.query_one(
        "SELECT * FROM user_collection WHERE user_id = %s AND allcars_id = %s",
        (user_id, car_id),
    )
    amount = max(1, int(entry.get("amount_owned") or 1))
    if existing:
        updated = db.update(
            "user_collection",
            {"amount_owned": (existing.get("amount_owned") or 1) + amount},
            "id = %s",
            (existing["id"],),
        )
        return updated[0], amount, False

    created = db.insert("user_collection", {
        "user_id": user_id,
        "allcars_id": car_id,
        "amount_owned": amount,
        "carded": entry.get("carded", True),
        "condition": entry.get("condition") or "mint",
        "notes": entry.get("notes") or None,
    })
    return created, amount, True


def undo(user_id: str, row_id: str) -> Optional[dict]:
    """Put a committed row back to pending and unwind what it created.

    Only what this import made is removed. A collection entry that existed
    beforehand has its count put back instead of being deleted, and a car is only
    deleted when this row created it and nothing else points at it — otherwise an
    undo here would quietly delete a car the collection still uses.
    """
    row = get_row(user_id, row_id)
    if not row:
        return None
    match = row.get("match") or {}

    collection_id = match.get("collection_id")
    added = int(match.get("amount_added") or 0)
    if collection_id:
        entry = db.query_one(
            "SELECT * FROM user_collection WHERE id = %s AND user_id = %s",
            (collection_id, user_id),
        )
        if entry:
            if match.get("created_collection_entry"):
                db.delete("user_collection", "id = %s", (collection_id,))
            else:
                remaining = (entry.get("amount_owned") or 1) - added
                if remaining > 0:
                    db.update("user_collection", {"amount_owned": remaining}, "id = %s", (collection_id,))
                else:
                    db.delete("user_collection", "id = %s", (collection_id,))

    deleted_car = False
    car_id = match.get("car_id")
    if car_id and match.get("created_car"):
        still_used = db.query_one(
            """
            SELECT (SELECT count(*) FROM user_collection WHERE allcars_id = %s)
                 + (SELECT count(*) FROM wishlist WHERE allcars_id = %s) AS n
            """,
            (car_id, car_id),
        )
        if still_used and not still_used["n"]:
            db.delete("all_cars", "id = %s", (car_id,))
            deleted_car = True

    series_id = match.get("created_series_id")
    if series_id:
        orphan = db.query_one(
            "SELECT count(*) AS n FROM all_cars WHERE series_id = %s", (series_id,)
        )
        if orphan and not orphan["n"]:
            db.delete("series", "id = %s", (series_id,))

    restored = db.query_one(
        """
        UPDATE import_row
        SET status = 'pending', match = NULL, decided_at = NULL
        WHERE id = %s AND user_id = %s
        RETURNING *
        """,
        (row_id, user_id),
    )
    if restored:
        restored["deleted_car"] = deleted_car
    return restored


# ─── Prefetching ─────────────────────────────────────────────────────────────

# The review screen asks for the rows it is about to show, a windowful at a time,
# so the lookups for row 40 happen while row 30 is on screen. Three at a time is
# polite to the wiki and still finishes a window long before it is reached.
_prefetch_limit = asyncio.Semaphore(3)
_in_flight: set[str] = set()


async def prefetch_rows(
    user_id: str,
    row_ids: list[str],
    *,
    search: Callable[[str], Awaitable[list[dict]]],
    detail: Callable[[str], Awaitable[dict]],
) -> None:
    """Fill in candidates for rows that have none yet. Failures are recorded, not raised."""

    async def one(row_id: str) -> None:
        if row_id in _in_flight:
            return
        _in_flight.add(row_id)
        try:
            async with _prefetch_limit:
                row = get_row(user_id, row_id)
                if not row or row["candidate_state"] != "empty" or row["status"] not in OPEN_STATUSES:
                    return
                raw = row["raw"]
                try:
                    candidates = await build_candidates(user_id, raw, search=search, detail=detail)
                    save_candidates(row_id, candidates, raw.get("query") or "")
                except Exception as exc:
                    log.warning("prefetch failed for row %s: %s", row_id, exc)
                    save_candidates(row_id, [], raw.get("query") or "", state="error")
        finally:
            _in_flight.discard(row_id)

    await asyncio.gather(*(one(str(r)) for r in row_ids), return_exceptions=True)
