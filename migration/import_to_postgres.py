#!/usr/bin/env python3
"""Load the Supabase export into the new Postgres database.

    python3 migration/import_to_postgres.py --database-url postgresql://user:pw@nas:5432/hotwheels

Needs psycopg (`pip install 'psycopg[binary]'`). Run it from your laptop against
the NAS with the db port published, or inside the backend container where
DATABASE_URL is already set.

What it does, in one transaction:
  1. creates the two user accounts, preserving their original UUIDs so every
     user_collection / wishlist row still points at the right person
  2. inserts series -> all_cars -> user_collection -> wishlist, in FK order
  3. rewrites image_url from Supabase Storage URLs to local /images/<id>.<ext>

Idempotent: rows are upserted by primary key, so re-running fixes a partial run
rather than duplicating. Passwords are only set for accounts that don't exist yet.

Copying the image files themselves is separate — see the docker cp step in
migration/README.md.
"""

import argparse
import getpass
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

try:
    import psycopg
except ImportError:
    raise SystemExit("psycopg is required:  pip install 'psycopg[binary]'")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPORT_DIR = os.path.join(ROOT, "migration", "export")

# Column order per table. Anything the export has that isn't listed is dropped,
# which keeps a stray Supabase-internal field from breaking the insert.
COLUMNS = {
    "series": ["id", "name", "year", "type", "total_count", "cars_list", "image_url", "created_at"],
    "all_cars": ["id", "name", "series_id", "year", "barcode", "primary_color", "set_number",
                 "series_number", "image_url", "treasure_hunt", "car_type", "toy_number", "created_at"],
    "user_collection": ["id", "user_id", "allcars_id", "amount_owned", "carded", "condition",
                        "notes", "date_acquired", "created_at"],
    "wishlist": ["id", "user_id", "allcars_id", "priority", "notes", "created_at"],
}

# Supabase storage public URLs look like:
#   https://<ref>.supabase.co/storage/v1/object/public/car-images/<uuid>.jpg
_STORAGE_RE = re.compile(
    r"^https?://[^/]+/storage/v1/object/public/car-images/([^?]+)(\?.*)?$"
)


def load(name):
    path = os.path.join(EXPORT_DIR, f"{name}.json")
    if not os.path.exists(path):
        raise SystemExit(f"missing {path} — run migration/export_supabase.py first")
    with open(path) as fh:
        return json.load(fh)


def local_image_url(url):
    """Supabase Storage URL -> /images/<file>. Other URLs (wiki, collecthw) pass through."""
    if not url:
        return url, False
    m = _STORAGE_RE.match(url)
    if not m:
        return url, False
    return "/images/" + m.group(1), True


def upsert(cur, table, rows):
    if not rows:
        print(f"  {table:<16} 0 rows (nothing to do)")
        return 0
    cols = COLUMNS[table]
    placeholders = ", ".join(["%s"] * len(cols))
    collist = ", ".join(cols)
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != "id")
    statement = (
        f"INSERT INTO {table} ({collist}) VALUES ({placeholders}) "
        f"ON CONFLICT (id) DO UPDATE SET {updates}"
    )
    values = [tuple(r.get(c) for c in cols) for r in rows]
    cur.executemany(statement, values)
    print(f"  {table:<16} {len(rows)} rows")
    return len(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--database-url",
        default=os.getenv("DATABASE_URL"),
        help="target Postgres URL (defaults to $DATABASE_URL)",
    )
    parser.add_argument(
        "--password",
        action="append",
        default=[],
        metavar="EMAIL=PASSWORD",
        help="set an account password non-interactively; repeatable",
    )
    args = parser.parse_args()

    if not args.database_url:
        raise SystemExit("pass --database-url or set DATABASE_URL")

    from passwords import hash_password

    users = load("auth_users")
    series = load("series")
    all_cars = load("all_cars")
    collection = load("user_collection")
    wishlist = load("wishlist")

    preset = {}
    for pair in args.password:
        email, _, pw = pair.partition("=")
        preset[email.strip().lower()] = pw

    # Rewrite storage URLs before touching the database.
    rewritten = 0
    for row in all_cars:
        row["image_url"], changed = local_image_url(row.get("image_url"))
        rewritten += changed
    for row in series:
        row["image_url"], changed = local_image_url(row.get("image_url"))
        rewritten += changed

    with psycopg.connect(args.database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users")
            existing_ids = {str(r[0]) for r in cur.fetchall()}

            print("Users:")
            for u in users:
                if u["id"] in existing_ids:
                    print(f"  {u['email']:<28} already exists, password unchanged")
                    continue
                email = u["email"]
                pw = preset.get(email.lower())
                while not pw:
                    pw = getpass.getpass(f"  new password for {email}: ")
                    if len(pw) < 8:
                        print("    too short — use at least 8 characters")
                        pw = None
                        continue
                    if pw != getpass.getpass("  confirm: "):
                        print("    didn't match, try again")
                        pw = None
                cur.execute(
                    "INSERT INTO users (id, email, password_hash, created_at)"
                    " VALUES (%s, %s, %s, COALESCE(%s, now()))",
                    (u["id"], email, hash_password(pw), u.get("created_at")),
                )
                print(f"  {email:<28} created")

            # FK order matters: series before cars, cars before collection/wishlist.
            print("Tables:")
            upsert(cur, "series", series)
            upsert(cur, "all_cars", all_cars)
            upsert(cur, "user_collection", collection)
            upsert(cur, "wishlist", wishlist)

            print("Verifying:")
            for table in ["users", "series", "all_cars", "user_collection", "wishlist"]:
                cur.execute(f"SELECT count(*) FROM {table}")
                print(f"  {table:<16} {cur.fetchone()[0]} rows in database")

            cur.execute(
                "SELECT count(*) FROM all_cars WHERE image_url LIKE '/images/%'"
            )
            print(f"  local image_urls  {cur.fetchone()[0]}")

        conn.commit()

    print(f"\nDone. Rewrote {rewritten} image URLs to local paths.")
    print("Next: copy migration/export/car-images/ into the car-images volume")
    print("      (see migration/README.md).")


if __name__ == "__main__":
    main()
