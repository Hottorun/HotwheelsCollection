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
| images | 411 files, 129 MB |

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

**Check the ports.** A NAS has a lot of ports already spoken for — both by the
OS itself and by other apps (on this NAS, UGOS takes 8000 and `upsnap` holds
8090). Pick free ones before starting:

```bash
for p in 18080 8000 8082 8095; do
  (sudo ss -tln | grep -q ":$p " && echo "$p TAKEN") || echo "$p free"
done
```

Set `FRONTEND_PORT` and `BACKEND_PORT` in `.env` to whatever came back free.

You can leave `ALLOWED_ORIGINS` alone when using the bundled frontend container:
the browser talks to the API on the same origin as the page, so CORS never
comes into it.

### 3. Start it

Either the UGREEN Docker UI or the command line works. Two rules keep them in
agreement, and breaking either is what causes the "CLI says nothing is running
while containers are obviously serving traffic" confusion:

**One compose file.** The repo ships `docker-compose.yml`. If the Docker UI has
generated its own `docker-compose.yaml` next to it, delete that one — otherwise
the UI and the CLI each edit a different file and your changes land in whichever
one you didn't deploy.

```bash
ls -la /volume2/docker/HotwheelsCollection/docker-compose.*
```

**One project name.** `docker-compose.yml` sets `name: hotwheels` at the top, so
the stack is called `hotwheels` no matter how it was started. Without that, the
CLI names the project after the directory while the UI picks its own, and you
end up with two independent copies of the same stack.

Via the UI: point the project at the existing directory and its
`docker-compose.yml` rather than pasting the YAML into the form — pasting makes
the UI write a new file, which is how the duplicate appears.

From the shell:

```bash
cd /volume2/docker/HotwheelsCollection
docker compose up -d --build
```

Containers started either way show up in the Docker app's container list and in
`docker compose ps`, because both are talking to the same Docker daemon about
the same project.

`migration/schema.sql` runs automatically the first time, creating the tables.

Three containers come up: `db`, `backend`, and `frontend`. **`frontend` is the
one you open in a browser** — it serves the app and proxies `/api` and `/images`
through to the backend.

```bash
docker compose ps                              # STATUS should say "healthy", not just "Up"
curl http://localhost:18080/api/health         # {"status":"ok"} — through the proxy
curl -I http://localhost:18080/                # 200, the app itself
```

Then open `http://NAS_IP:18080` in a browser.

> Opening the **backend** port directly (`http://NAS_IP:8000`) shows nothing but
> `{"detail":"Not Found"}`. That is correct — the backend has no page at `/`, it
> only answers `/api/*` and `/images/*`. The website is on `FRONTEND_PORT`.

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
docker compose exec backend sh -c 'ls /data/car-images | wc -l'   # expect 411
```

### 6. Open it

`http://NAS_IP:18080` — log in with the password you set in step 4.

Nothing to configure: the frontend container is built with `VITE_API_URL=""`, so
the app calls `/api/...` on its own origin and nginx forwards that to the backend.

<details>
<summary>If you'd rather keep the frontend on Netlify instead</summary>

Set `VITE_API_URL=http://NAS_IP:8000` in Netlify's environment variables, and add
that Netlify URL to `ALLOWED_ORIGINS` in `.env` — cross-origin means CORS now
applies. You can drop the `frontend` service from `docker-compose.yml` in that
case. Note this needs the backend port reachable from the internet, whereas the
bundled container only needs the one frontend port.

</details>

---

## Troubleshooting

**Nothing loads in the browser.** Check which port you're on. `BACKEND_PORT`
serves only `/api/*` and `/images/*`; a bare `/` there returns
`{"detail":"Not Found"}`, which is expected. The website is on `FRONTEND_PORT`.

**A container won't start / port already in use.** A NAS has many ports already
claimed — UGOS itself uses 8000, and other apps take more (`upsnap` sits on
8090). Find what's holding a port with `sudo ss -tlnp | grep :PORT`, then change
`FRONTEND_PORT` / `BACKEND_PORT` in `.env` and `docker compose up -d` again.

**CLI and UI disagree — `docker compose ps` is empty but containers are
running.** They're managing two different projects. See what actually exists:

```bash
docker compose ls -a                    # every project, and the file each uses
docker ps --format '{{.Names}}\t{{.Ports}}\t{{.Status}}'
```

If you see a project that isn't `hotwheels`, that's the stray one. Stop and
remove it (from the UI if the UI created it), delete any `docker-compose.yaml`
sitting beside the repo's `docker-compose.yml`, then start the stack again. With
`name: hotwheels` in the file, both the UI and the CLI land on the same project
from then on.

Removing containers is safe — the data lives in the named volumes, which
survive. Just don't pass `-v` to `docker compose down`, which would delete them.

**`Connection reset by peer` on a published port.** `ss` shows `docker-proxy`
holding the port, so it's bound, but the connection dies. Usually this is either
a stale `docker-proxy` from a container that no longer exists, or `localhost`
resolving to IPv6 `::1` and taking a different path than IPv4. Test explicitly:

```bash
curl -v http://127.0.0.1:PORT/api/health   # force IPv4
```

If IPv4 works and `localhost` doesn't, it was the IPv6 route. If neither works
while the container's own healthcheck passes, the port publish is stale —
`docker compose down && docker compose up -d` re-creates it.

**"Up" but not working.** `Up` only means the process started. Look for
`healthy` in `docker compose ps`, then:

```bash
docker compose logs backend --tail 50
docker compose logs frontend --tail 50
```

**Login fails for a password you're sure is right.** The accounts only exist
after step 4. Check with:

```bash
docker compose exec db psql -U hotwheels -d hotwheels -c 'SELECT email FROM users;'
```

**Images 404 but data loads.** Step 5 didn't land. Verify:

```bash
docker compose exec backend sh -c 'ls /data/car-images | wc -l'   # expect 411
```

**Changed the frontend code and nothing changed.** The app is baked into the
image at build time, so a rebuild is required:

```bash
docker compose up -d --build frontend
```

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

There are two pieces of data, and they need different treatment:

| | Where | How to back it up |
| --- | --- | --- |
| Database | `pgdata` volume | **Never copy these files directly.** Use a dump. |
| Car images | `car-images` volume | Ordinary files, safe to copy as-is |

The database caveat is the important one. Postgres's data directory is
constantly mid-write, so a file-level snapshot of it can restore to a corrupt
database. A `pg_dump` is transactionally consistent, which is what you want.

### With Backrest

The `db-dump` container handles the dumping. It runs `pg_dump` on a schedule
(daily by default, `DUMP_INTERVAL_SECONDS` in `.env`) into `./backups/`, keeping
the newest `DUMP_KEEP`. It writes to a `.partial` file and renames on completion,
so Backrest can never catch a half-written dump.

That leaves Backrest with two plain directories to snapshot.

**1. Give Backrest access to both.** The dumps are a bind mount so they're
already visible on the NAS filesystem. The images live in a named volume, so
mount it into the Backrest container — read-only, since Backrest never needs to
write there:

```yaml
# in Backrest's own docker-compose.yml
services:
  backrest:
    image: garethgeorge/backrest:latest
    restart: unless-stopped
    volumes:
      - ./data:/data
      - ./config:/config
      - ./cache:/cache
      # What we actually want backed up:
      - /volume2/docker/HotwheelsCollection/backups:/userdata/hotwheels-db:ro
      - hotwheels_car-images:/userdata/hotwheels-images:ro
    environment:
      BACKREST_DATA: /data
      BACKREST_CONFIG: /config/config.json
    ports:
      - "9898:9898"

volumes:
  # Created by the hotwheels stack; `external` means don't make a new one.
  hotwheels_car-images:
    external: true
```

The volume name is the compose project name plus the volume name. Since
`docker-compose.yml` sets `name: hotwheels`, it's `hotwheels_car-images`.
Confirm with:

```bash
docker volume ls | grep car-images
```

**2. In the Backrest UI**, add a repo (external drive, another NAS, or a cloud
provider — restic supports B2, S3, and SFTP), then create a plan with both paths:

```
/userdata/hotwheels-db
/userdata/hotwheels-images
```

A daily schedule with a retention policy of something like 7 daily / 4 weekly /
6 monthly is sensible here. The images barely change and restic deduplicates, so
the repo stays small.

> Keep at least one copy off the NAS. A backup sitting on the same machine as the
> data protects against your mistakes but not against the machine dying.

### Restoring

Restore the files from Backrest first, then load them back:

```bash
# Database — from a restored dump file
docker compose exec -T db psql -U hotwheels -d postgres \
    -c 'DROP DATABASE hotwheels;' -c 'CREATE DATABASE hotwheels;'
docker compose exec -T db pg_restore -U hotwheels -d hotwheels < hotwheels-TIMESTAMP.dump

# Images — straight back into the volume
docker compose cp ./restored-images/. backend:/data/car-images/
```

### Manual one-off

`migration/backup.sh` still exists for an on-demand backup — it dumps, archives
the images, verifies the dump is readable, and prunes. Useful before an upgrade:

```bash
./migration/backup.sh /volume2/backups
```

Restoring from one of its archives:

```bash
docker compose exec -T db psql -U hotwheels -d postgres \
    -c 'DROP DATABASE hotwheels;' -c 'CREATE DATABASE hotwheels;'
docker compose exec -T db pg_restore -U hotwheels -d hotwheels < backups/hotwheels-TIMESTAMP.dump

gunzip -c backups/car-images-TIMESTAMP.tar.gz | docker compose exec -T backend tar -xf - -C /data
```

Worth actually testing a restore once, while you still have the Supabase project
as a fallback.

---

## Managing users

`hottorun@pm.me` is an admin (set by `ADMIN_EMAIL` in `.env`). Admins get a
**Users** entry in the sidebar, above Sign Out, leading to `/admin` where you can:

- create accounts, setting the initial password yourself
- reset anyone's password without knowing their old one
- grant or revoke admin access

The new-password fields show the password in plain text rather than masking it —
there's no email delivery configured, so you have to read it out to hand it over.

Two deliberate limitations:

- **You can't remove your own admin access.** That would make `/admin`
  unreachable and need SQL to undo.
- **There's no delete button.** Deleting a user cascades to their entire
  collection and wishlist. It's a genuinely destructive action, so it stays a
  deliberate database operation rather than a stray click.

`ADMIN_EMAIL` is re-applied on every backend start. If it's blank or misspelled,
the oldest account is promoted instead, so there is always a way back in.

---

## Decommissioning Supabase

Only after the app is fully working on the NAS: sign in, check the collection,
analytics, and images all load, add a car and upload a photo.

Keep the Supabase project around for a few weeks as a safety net — a paused
project costs nothing. `migration/export/` is your real backup either way.

When you're confident, delete the project. `backend/.env` still holds the old
`SUPABASE_URL` / `SUPABASE_SERVICE_KEY`; those are now unused and should be
removed once the project is gone.
