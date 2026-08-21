#!/usr/bin/env bash
# Back up the Hot Wheels stack: database dump + car images.
#
# Self-hosting means backups are now your job — Supabase is no longer holding a
# copy. Run this from the directory containing docker-compose.yml.
#
#   ./migration/backup.sh                  # writes to ./backups
#   ./migration/backup.sh /volume1/backups # or wherever you want them
#
# Schedule it in your NAS task scheduler (weekly is plenty for this):
#   cd /volume1/docker/hotwheels && ./migration/backup.sh /volume1/backups
#
# To restore, see migration/README.md.

set -euo pipefail

DEST="${1:-./backups}"
KEEP="${KEEP:-8}"          # how many previous backups to retain
STAMP="$(date +%Y%m%d-%H%M%S)"

# Read the compose project's DB credentials from .env
if [ -f .env ]; then
    # shellcheck disable=SC1091
    set -a; . ./.env; set +a
fi
DB_USER="${POSTGRES_USER:-hotwheels}"
DB_NAME="${POSTGRES_DB:-hotwheels}"

mkdir -p "$DEST"

echo "==> Dumping database ($DB_NAME)"
# -Fc is the compressed custom format, restored with pg_restore.
docker compose exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc \
    > "$DEST/hotwheels-$STAMP.dump"

echo "==> Archiving car images"
# Streamed straight out of the container so the volume path doesn't matter.
docker compose exec -T backend tar -cf - -C /data car-images \
    | gzip > "$DEST/car-images-$STAMP.tar.gz"

db_size=$(du -h "$DEST/hotwheels-$STAMP.dump" | cut -f1)
img_size=$(du -h "$DEST/car-images-$STAMP.tar.gz" | cut -f1)
echo "==> Wrote $DEST/hotwheels-$STAMP.dump ($db_size)"
echo "         $DEST/car-images-$STAMP.tar.gz ($img_size)"

# A dump that can't be read is not a backup — fail loudly if it's unreadable.
echo "==> Verifying dump is readable"
docker compose exec -T db pg_restore --list < "$DEST/hotwheels-$STAMP.dump" > /dev/null
echo "    ok"

echo "==> Pruning all but the newest $KEEP of each"
ls -1t "$DEST"/hotwheels-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
ls -1t "$DEST"/car-images-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --

echo "Backup complete."
