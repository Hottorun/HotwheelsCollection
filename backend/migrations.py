"""Tiny forward-only migration runner, applied at startup.

`migration/schema.sql` only runs when Postgres initialises an *empty* data
directory, so it can't help a database that already exists. Rather than asking
for hand-run SQL after every schema change, each change goes here as an
idempotent statement that is safe to execute on every boot.

Keep every statement idempotent (`IF NOT EXISTS`, `WHERE NOT EXISTS`, ...) —
they all run on each start, in order. Append new ones; don't edit old ones.
"""

import logging
import os

import db

log = logging.getLogger("migrations")

# Plain DDL, applied in order on every startup.
STATEMENTS = [
    # Admin flag, so user management can happen in the app instead of via SQL.
    """
    ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false
    """,
]


def _grant_configured_admin() -> None:
    """Promote ADMIN_EMAIL, so the first admin exists without touching SQL."""
    admin_email = (os.getenv("ADMIN_EMAIL") or "").strip()
    if not admin_email:
        return
    updated = db.execute(
        "UPDATE users SET is_admin = true"
        " WHERE lower(email) = lower(%s) AND is_admin = false",
        (admin_email,),
    )
    if updated:
        log.info("promoted %s to admin (ADMIN_EMAIL)", admin_email)


def _ensure_an_admin_exists() -> None:
    """Last-resort guard against locking yourself out of user management.

    If no account is an admin — because ADMIN_EMAIL was never set, or the address
    was mistyped — promote the oldest account. Without this the only way back in
    would be hand-written SQL, which is exactly what the admin page exists to
    avoid.
    """
    row = db.query_one("SELECT count(*) AS n FROM users WHERE is_admin")
    if row and row["n"]:
        return
    promoted = db.query_one(
        """
        UPDATE users SET is_admin = true
        WHERE id = (SELECT id FROM users ORDER BY created_at NULLS LAST, id LIMIT 1)
        RETURNING email
        """
    )
    if promoted:
        log.warning(
            "no admin account existed; promoted %s. Set ADMIN_EMAIL to choose "
            "deliberately.", promoted["email"],
        )


def run() -> None:
    for statement in STATEMENTS:
        db.execute(statement)
    _grant_configured_admin()
    _ensure_an_admin_exists()
