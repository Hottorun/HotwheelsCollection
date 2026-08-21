#!/usr/bin/env python3
"""Export everything out of Supabase: tables, auth users, and storage objects.

Stdlib only, so it runs on the system python without a working venv:
    python3 migration/export_supabase.py

Reads SUPABASE_URL / SUPABASE_SERVICE_KEY from backend/.env.
Writes JSON to migration/export/ and images to migration/export/car-images/.
Re-running is safe: images already downloaded are skipped.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(ROOT, "backend", ".env")
OUT_DIR = os.path.join(ROOT, "migration", "export")
IMG_DIR = os.path.join(OUT_DIR, "car-images")

TABLES = ["series", "all_cars", "user_collection", "wishlist"]
BUCKET = "car-images"
PAGE = 1000


def load_env(path):
    env = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def request(url, headers, method="GET", body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = resp.read()
    except urllib.error.HTTPError as exc:
        raise SystemExit(
            "HTTP %s on %s\n%s" % (exc.code, url, exc.read().decode("utf-8", "replace")[:500])
        )
    return payload if raw else json.loads(payload)


def export_table(base, headers, table):
    """Page through a table so we never depend on the server's default row cap."""
    rows = []
    while True:
        url = "%s/rest/v1/%s?select=*&order=id&offset=%d&limit=%d" % (
            base, table, len(rows), PAGE,
        )
        batch = request(url, headers)
        rows.extend(batch)
        if len(batch) < PAGE:
            break
    path = os.path.join(OUT_DIR, "%s.json" % table)
    with open(path, "w") as fh:
        json.dump(rows, fh, indent=2, ensure_ascii=False)
    print("  %-16s %5d rows -> %s" % (table, len(rows), os.path.relpath(path, ROOT)))
    return rows


def export_users(base, headers):
    """auth.users, so collection/wishlist user_id values still resolve after the move."""
    users = []
    page = 1
    while True:
        url = "%s/auth/v1/admin/users?page=%d&per_page=%d" % (base, page, 200)
        batch = request(url, headers).get("users", [])
        users.extend(batch)
        if len(batch) < 200:
            break
        page += 1
    slim = [
        {
            "id": u.get("id"),
            "email": u.get("email"),
            "created_at": u.get("created_at"),
            "last_sign_in_at": u.get("last_sign_in_at"),
        }
        for u in users
    ]
    path = os.path.join(OUT_DIR, "auth_users.json")
    with open(path, "w") as fh:
        json.dump(slim, fh, indent=2)
    print("  %-16s %5d users -> %s" % ("auth users", len(slim), os.path.relpath(path, ROOT)))
    for u in slim:
        print("      %s  %s" % (u["id"], u["email"]))
    return slim


def list_objects(base, headers):
    """Storage list is POST + paginated; keep asking until a short page comes back."""
    objects = []
    while True:
        body = {
            "prefix": "",
            "limit": PAGE,
            "offset": len(objects),
            "sortBy": {"column": "name", "order": "asc"},
        }
        batch = request(
            "%s/storage/v1/object/list/%s" % (base, BUCKET), headers, "POST", body
        )
        # A placeholder folder row has no metadata; skip those.
        batch = [o for o in batch if o.get("id")]
        objects.extend(batch)
        if len(batch) < PAGE:
            break
    return objects


def download_images(base, headers, objects):
    if not os.path.isdir(IMG_DIR):
        os.makedirs(IMG_DIR)
    downloaded = skipped = failed = 0
    total_bytes = 0
    for i, obj in enumerate(objects, 1):
        name = obj["name"]
        dest = os.path.join(IMG_DIR, name)
        expected = (obj.get("metadata") or {}).get("size")
        if os.path.exists(dest) and (expected is None or os.path.getsize(dest) == expected):
            skipped += 1
            total_bytes += os.path.getsize(dest)
            continue
        url = "%s/storage/v1/object/%s/%s" % (
            base, BUCKET, urllib.parse.quote(name),
        )
        try:
            blob = request(url, headers, raw=True)
        except SystemExit as exc:
            print("  ! failed %s: %s" % (name, str(exc).splitlines()[0]))
            failed += 1
            continue
        with open(dest, "wb") as fh:
            fh.write(blob)
        downloaded += 1
        total_bytes += len(blob)
        if i % 50 == 0 or i == len(objects):
            print("  ... %d/%d images" % (i, len(objects)))
    print(
        "  images: %d downloaded, %d already present, %d failed, %.1f MB total"
        % (downloaded, skipped, failed, total_bytes / 1048576.0)
    )
    return failed


def main():
    if not os.path.exists(ENV_PATH):
        raise SystemExit("missing %s" % ENV_PATH)
    env = load_env(ENV_PATH)
    base = (env.get("SUPABASE_URL") or "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_KEY")
    if not base or not key:
        raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_KEY not set in backend/.env")

    if not os.path.isdir(OUT_DIR):
        os.makedirs(OUT_DIR)

    headers = {"apikey": key, "Authorization": "Bearer %s" % key}

    print("Exporting from %s" % base)
    print("Tables:")
    counts = {t: len(export_table(base, headers, t)) for t in TABLES}

    print("Auth:")
    users = export_users(base, headers)

    print("Storage:")
    objects = list_objects(base, headers)
    manifest = os.path.join(OUT_DIR, "storage_objects.json")
    with open(manifest, "w") as fh:
        json.dump(objects, fh, indent=2)
    print("  %d objects listed in bucket '%s'" % (len(objects), BUCKET))
    failed = download_images(base, headers, objects)

    summary = {
        "source": base,
        "tables": counts,
        "auth_users": len(users),
        "storage_objects": len(objects),
        "images_failed": failed,
    }
    with open(os.path.join(OUT_DIR, "summary.json"), "w") as fh:
        json.dump(summary, fh, indent=2)

    print("\nSummary: %s" % json.dumps(summary))
    if failed:
        print("WARNING: %d image(s) failed to download - re-run to retry." % failed)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
