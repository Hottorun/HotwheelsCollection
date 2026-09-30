-- Hot Wheels Collection Tracker — schema for self-hosted Postgres on the NAS.
--
-- Ported from the Supabase project. Differences from the original:
--   * auth.users is gone, so there is a real public.users table and the
--     user_id foreign keys point at it. The original Supabase user UUIDs are
--     preserved on import so user_collection/wishlist rows still resolve.
--   * No RLS. Every query goes through FastAPI, which scopes by user_id itself;
--     RLS was never enforced here anyway because the backend used the service key.
--
-- Safe to re-run: everything is IF NOT EXISTS.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fast ILIKE '%term%' on name/colour

-- ─── Users ───────────────────────────────────────────────────────────────────
-- password_hash is PBKDF2-HMAC-SHA256, formatted by backend/passwords.py as
--   pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64>
-- Supabase's bcrypt hashes are not carried over; passwords are set at import.

-- is_admin gates the user-management screen. Existing databases get this column
-- from backend/migrations.py instead, since this file only runs on a fresh one.
CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL,
    password_hash text NOT NULL,
    is_admin      boolean NOT NULL DEFAULT false,
    created_at    timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
    ON users (lower(email));

-- ─── Series ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS series (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    year        integer,
    type        text NOT NULL DEFAULT 'mainline',
    total_count integer,
    cars_list   text[],
    image_url   text,
    created_at  timestamptz DEFAULT now()
);

-- ─── All cars (the shared catalogue) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS all_cars (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    series_id     uuid REFERENCES series (id) ON DELETE SET NULL,
    year          integer,
    barcode       text,
    primary_color text,
    set_number    integer,
    series_number integer,
    image_url     text,
    treasure_hunt boolean DEFAULT false,
    car_type      text,
    toy_number    text,
    created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS all_cars_series_id_idx   ON all_cars (series_id);
CREATE INDEX IF NOT EXISTS all_cars_year_idx        ON all_cars (year);
CREATE INDEX IF NOT EXISTS all_cars_barcode_idx     ON all_cars (barcode);
CREATE INDEX IF NOT EXISTS all_cars_name_trgm_idx   ON all_cars USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS all_cars_toynum_trgm_idx ON all_cars USING gin (toy_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS all_cars_color_trgm_idx  ON all_cars USING gin (primary_color gin_trgm_ops);

-- ─── User collection ─────────────────────────────────────────────────────────
-- ON DELETE CASCADE replaces the manual pre-delete cleanup the backend used to
-- do by hand (old main.py:227-229) — Postgres does it correctly now.

CREATE TABLE IF NOT EXISTS user_collection (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid REFERENCES users (id) ON DELETE CASCADE,
    allcars_id    uuid REFERENCES all_cars (id) ON DELETE CASCADE,
    amount_owned  integer DEFAULT 1,
    carded        boolean DEFAULT true,
    condition     text DEFAULT 'mint',
    notes         text,
    date_acquired date,
    created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_collection_user_id_idx    ON user_collection (user_id);
CREATE INDEX IF NOT EXISTS user_collection_allcars_id_idx ON user_collection (allcars_id);
CREATE INDEX IF NOT EXISTS user_collection_created_at_idx ON user_collection (user_id, created_at DESC);

-- ─── Wishlist ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wishlist (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid REFERENCES users (id) ON DELETE CASCADE,
    allcars_id uuid REFERENCES all_cars (id) ON DELETE CASCADE,
    priority   integer DEFAULT 0,
    notes      text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wishlist_user_id_idx    ON wishlist (user_id);
CREATE INDEX IF NOT EXISTS wishlist_allcars_id_idx ON wishlist (allcars_id);

-- ─── Spreadsheet import queues ───────────────────────────────────────────────
-- Moving a 2,500-row Numbers sheet into the app is a few thousand small
-- decisions, so the queue is stored rather than held in a browser tab: see
-- backend/importer.py. Rows keep their parsed spreadsheet values, the candidates
-- found for them, and what was done with them, so a session can be left and
-- resumed. Existing databases get these from backend/migrations.py instead.

CREATE TABLE IF NOT EXISTS import_batch (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    source_name text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_row (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id        uuid NOT NULL REFERENCES import_batch (id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    sheet           text NOT NULL,
    row_index       integer NOT NULL,
    position        integer NOT NULL,
    raw             jsonb NOT NULL,
    marker          text NOT NULL DEFAULT 'none',
    status          text NOT NULL DEFAULT 'pending',
    candidates      jsonb,
    candidate_state text NOT NULL DEFAULT 'empty',
    match           jsonb,
    decided_at      timestamptz
);

CREATE INDEX IF NOT EXISTS import_row_batch_idx  ON import_row (batch_id, position);
CREATE INDEX IF NOT EXISTS import_row_queue_idx  ON import_row (batch_id, status, position);
CREATE INDEX IF NOT EXISTS import_batch_user_idx ON import_batch (user_id, created_at DESC);
