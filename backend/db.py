"""Postgres access layer — replaces the Supabase client.

Everything the app used to do through PostgREST (`supabase.table(...)`) happens
here as plain SQL over a psycopg connection pool.

The one non-obvious part is the nested-select emulation. PostgREST turns
`select("*, series(*)")` into a response where the related row is nested under a
`series` key, and the frontend types depend on that shape. The SELECT_* fragments
below rebuild exactly that shape with `to_jsonb`, so response bodies are
unchanged and the frontend needed no data-shape changes.

Note the `CASE WHEN <alias>.id IS NULL` guards: on a LEFT JOIN miss, `to_jsonb(s.*)`
returns an object full of nulls rather than SQL NULL, which would serialise as
`{"id": null, ...}` instead of `null` and break the frontend's falsy checks.
"""

import os
from contextlib import contextmanager
from typing import Any, Iterable, Optional

import psycopg
from dotenv import load_dotenv
from psycopg import sql
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

# Loaded here as well as in main so that importing db never depends on import
# order. In Docker the values come from the environment and this is a no-op.
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set (see backend/.env.example)")

# min_size=1 keeps one warm connection; the NAS Postgres is on the LAN so
# reconnects are cheap, but a warm socket keeps page loads snappy.
pool = ConnectionPool(
    DATABASE_URL,
    min_size=1,
    max_size=int(os.getenv("DB_POOL_MAX", "10")),
    kwargs={"row_factory": dict_row},
    open=False,
)


def open_pool() -> None:
    pool.open()
    pool.wait(timeout=30)


def close_pool() -> None:
    pool.close()


@contextmanager
def cursor():
    with pool.connection() as conn:
        with conn.cursor() as cur:
            yield cur


# ─── Query helpers ───────────────────────────────────────────────────────────

def query(statement, params: Optional[Iterable[Any]] = None) -> list[dict]:
    with cursor() as cur:
        cur.execute(statement, params)
        return cur.fetchall()


def query_one(statement, params: Optional[Iterable[Any]] = None) -> Optional[dict]:
    with cursor() as cur:
        cur.execute(statement, params)
        return cur.fetchone()


def execute(statement, params: Optional[Iterable[Any]] = None) -> int:
    with cursor() as cur:
        cur.execute(statement, params)
        return cur.rowcount


def insert(table: str, data: dict) -> dict:
    """INSERT ... RETURNING *, with column names composed safely."""
    columns = list(data.keys())
    statement = sql.SQL("INSERT INTO {table} ({cols}) VALUES ({vals}) RETURNING *").format(
        table=sql.Identifier(table),
        cols=sql.SQL(", ").join(sql.Identifier(c) for c in columns),
        vals=sql.SQL(", ").join(sql.Placeholder() for _ in columns),
    )
    with cursor() as cur:
        cur.execute(statement, [data[c] for c in columns])
        return cur.fetchone()


def update(table: str, data: dict, where: str, where_params: Iterable[Any]) -> list[dict]:
    """UPDATE ... RETURNING *. `where` is a trusted literal from this codebase,
    never user input; all values are still parameterised."""
    columns = list(data.keys())
    statement = sql.SQL("UPDATE {table} SET {assignments} WHERE {where} RETURNING *").format(
        table=sql.Identifier(table),
        assignments=sql.SQL(", ").join(
            sql.SQL("{} = {}").format(sql.Identifier(c), sql.Placeholder()) for c in columns
        ),
        where=sql.SQL(where),
    )
    with cursor() as cur:
        cur.execute(statement, [data[c] for c in columns] + list(where_params))
        return cur.fetchall()


def delete(table: str, where: str, where_params: Iterable[Any]) -> int:
    statement = sql.SQL("DELETE FROM {table} WHERE {where}").format(
        table=sql.Identifier(table),
        where=sql.SQL(where),
    )
    return execute(statement, list(where_params))


# ─── Nested-select fragments (PostgREST shape emulation) ─────────────────────

# Equivalent of: .select("*, series(*)")
SELECT_CAR_WITH_SERIES = """
    SELECT c.*,
           CASE WHEN s.id IS NULL THEN NULL ELSE to_jsonb(s.*) END AS series
    FROM all_cars c
    LEFT JOIN series s ON s.id = c.series_id
"""

# Equivalent of: .select("*, all_cars(*, series(*))") followed by the backend's
# manual all_cars -> car rename. Aliased straight to `car` so no rename is needed.
_CAR_JSON = """
    CASE WHEN c.id IS NULL THEN NULL
         ELSE to_jsonb(c.*) || jsonb_build_object(
                  'series',
                  CASE WHEN s.id IS NULL THEN NULL ELSE to_jsonb(s.*) END
              )
    END AS car
"""

SELECT_COLLECTION_WITH_CAR = f"""
    SELECT uc.*, {_CAR_JSON}
    FROM user_collection uc
    LEFT JOIN all_cars c ON c.id = uc.allcars_id
    LEFT JOIN series s ON s.id = c.series_id
"""

SELECT_WISHLIST_WITH_CAR = f"""
    SELECT w.*, {_CAR_JSON}
    FROM wishlist w
    LEFT JOIN all_cars c ON c.id = w.allcars_id
    LEFT JOIN series s ON s.id = c.series_id
"""


def is_invalid_uuid(exc: Exception) -> bool:
    """Postgres rejects malformed UUIDs at parse time. Supabase/PostgREST answered
    those with an empty result, and route handlers turn that into a 404 — so
    callers translate this error rather than letting it 500."""
    return isinstance(exc, psycopg.errors.InvalidTextRepresentation)


def is_fk_violation(exc: Exception) -> bool:
    """Raised when e.g. a collection entry references a car id that doesn't exist.
    The old schema had no enforced cascade, so this is newly possible."""
    return isinstance(exc, psycopg.errors.ForeignKeyViolation)
