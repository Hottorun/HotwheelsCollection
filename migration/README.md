# Moving off Supabase onto the NAS

Supabase free projects pause after 7 days of inactivity and need a manual restore.
Since cars get added in bursts, that pause kept getting hit. This moves the whole
backend onto the NAS: Postgres, the API, and the car images.

Supabase was doing three jobs, and each needed a replacement:

| Was | Now |
| --- | --- |
| Postgres via PostgREST | Postgres in Docker, plain SQL in `backend/db.py` |
| Supabase Auth | JWT issued by the backend (`backend/auth.py`) |
| Storage bucket `car-images` | A Docker volume, served at `/images` |

## What was exported

Already done, sitting in `migration/export/` (gitignored, 130 MB):

| | |
| --- | --- |
| series | 149 |
| all_cars | 392 |
| user_collection | 340 |
| wishlist | 0 |
| auth users | 2 |
| images | 412 files, 129 MB |

Verified before the cutover: every collection row points at a car that exists,
every car's `series_id` resolves, and all 392 referenced images are present.
(20 extra images are in the bucket, left over from deleted cars — harmless.)

Re-run `python3 migration/export_supabase.py` any time to refresh it; it skips
images already downloaded.

---

## Setup on the NAS

### 1. Get the code onto the NAS

Clone or copy the repo somewhere on the NAS, e.g. `/volume1/docker/hotwheels`.

### 2. Configure

```bash
cp .env.example .env
```

Fill in the two `CHANGE_ME` values. Generate each one with:

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Set `ALLOWED_ORIGINS` to wherever the frontend is served from. It must match the
browser's address bar exactly — scheme, host, and port — or the browser blocks
the API calls.

### 3. Start it

```bash
docker compose up -d
```

`migration/schema.sql` runs automatically the first time, creating the tables.
Check it came up:

```bash
docker compose ps
curl http://localhost:8000/api/health     # {"status":"ok"}
```

### 4. Import the data

The database port isn't published by default. Either run the import from inside
the container, or uncomment the `ports:` block on the `db` service in
`docker-compose.yml` and run it from your laptop.

From your laptop (needs `pip install 'psycopg[binary]'`):

```bash
python3 migration/import_to_postgres.py \
    --database-url postgresql://hotwheels:YOUR_PASSWORD@NAS_IP:5432/hotwheels
```

It will prompt for a new password for each of the two accounts
(`hottorun@pm.me` and `alinasuga@gmail.com`).

> **Why new passwords?** Supabase stores bcrypt hashes and doesn't expose them
> through its API, so the old ones can't come across. The user UUIDs *are*
> preserved, which is what actually matters — every collection row still belongs
> to the right person.

The script is safe to re-run; it upserts by primary key rather than duplicating,
and won't touch the password of an account that already exists.

### 5. Copy the images in

```bash
docker compose cp migration/export/car-images/. backend:/data/car-images/
docker compose exec backend sh -c 'ls /data/car-images | wc -l'   # expect 412
```

### 6. Point the frontend at it

In `frontend/.env`:

```
VITE_API_URL=http://NAS_IP:8000
```

Then `npm run build`. Remember to also set `VITE_API_URL` in Netlify's
environment variables if the frontend stays deployed there.

---

## Remote access

The API needs to be reachable from your phone when you're at a store. Two good
options, both free:

**Cloudflare Tunnel** — a public HTTPS hostname, no ports opened on your router.
Best if you want the site to just work on any device without setup. Run
`cloudflared` on the NAS pointed at `http://backend:8000`, then set
`ALLOWED_ORIGINS` and `VITE_API_URL` to the resulting hostname.

**Tailscale** — puts your phone and NAS on the same private network. Nothing is
exposed to the internet at all, which is the safer default, but every device that
uses the app has to be on your tailnet.

Whichever you pick, the app is now behind a login you control, so don't expose
port 8000 directly to the internet.

---

## Backups

This is the part self-hosting hands to you. Supabase isn't keeping a copy
anymore.

```bash
./migration/backup.sh /volume1/backups
```

Dumps the database, archives the images, verifies the dump is readable, and keeps
the newest 8 of each. Add it to the NAS task scheduler — weekly is plenty:

```
cd /volume1/docker/hotwheels && ./migration/backup.sh /volume1/backups
```

### Restoring

```bash
# Database
docker compose exec -T db psql -U hotwheels -d postgres \
    -c 'DROP DATABASE hotwheels;' -c 'CREATE DATABASE hotwheels;'
docker compose exec -T db pg_restore -U hotwheels -d hotwheels < backups/hotwheels-TIMESTAMP.dump

# Images
gunzip -c backups/car-images-TIMESTAMP.tar.gz | docker compose exec -T backend tar -xf - -C /data
```

Worth actually testing a restore once, while you still have the Supabase project
as a fallback.

---

## Decommissioning Supabase

Only after the app is fully working on the NAS: sign in, check the collection,
analytics, and images all load, add a car and upload a photo.

Keep the Supabase project around for a few weeks as a safety net — a paused
project costs nothing. `migration/export/` is your real backup either way.

When you're confident, delete the project. `backend/.env` still holds the old
`SUPABASE_URL` / `SUPABASE_SERVICE_KEY`; those are now unused and should be
removed once the project is gone.
