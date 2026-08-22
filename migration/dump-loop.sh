#!/bin/sh
# Periodic pg_dump, run by the `db-dump` container.
#
# Backrest (or any file-based backup tool) must never snapshot Postgres's raw
# data directory while the server is running — the files are mid-write and the
# copy can restore to a corrupt database. A pg_dump is transactionally
# consistent, so this writes one on a schedule and lets Backrest back up the
# resulting files instead.
#
# Configured entirely by environment variables from docker-compose.yml.

set -eu

DUMP_DIR="${DUMP_DIR:-/dumps}"
INTERVAL="${DUMP_INTERVAL_SECONDS:-86400}"   # once a day
KEEP="${DUMP_KEEP:-8}"

mkdir -p "$DUMP_DIR"

while true; do
    stamp="$(date +%Y%m%d-%H%M%S)"
    target="$DUMP_DIR/hotwheels-$stamp.dump"

    # Write to a .partial name first and rename once complete. A rename is
    # atomic, so Backrest can never pick up a half-written dump mid-snapshot.
    if pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -Fc > "$target.partial" 2>/tmp/dump.err; then
        mv "$target.partial" "$target"
        echo "$(date "+%Y-%m-%dT%H:%M:%S") wrote $(basename "$target") ($(du -h "$target" | cut -f1))"

        # Prune old dumps, newest KEEP retained.
        ls -1t "$DUMP_DIR"/hotwheels-*.dump 2>/dev/null \
            | tail -n +$((KEEP + 1)) \
            | while read -r old; do
                  echo "$(date "+%Y-%m-%dT%H:%M:%S") pruning $(basename "$old")"
                  rm -f "$old"
              done
    else
        # Don't leave a partial behind to confuse the next run.
        rm -f "$target.partial"
        echo "$(date "+%Y-%m-%dT%H:%M:%S") DUMP FAILED: $(cat /tmp/dump.err)" >&2
    fi

    sleep "$INTERVAL"
done
