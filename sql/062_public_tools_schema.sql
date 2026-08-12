-- Isolated infrastructure for public-facing website tools (Business Health Check,
-- Entity Comparison, Document Checklist, and any future public calculator/quiz).
--
-- This is a hard security boundary, not a naming convention: a brand-new schema
-- (altax_public) plus a brand-new, low-privilege Postgres role (altax_public_app)
-- that has ZERO grants anywhere in the altax schema — the schema holding every
-- client record, encrypted SSN/EIN/bank field, task, and invoice in the system.
-- Even a serious bug in the public-tools backend code cannot read or write
-- anything in altax.* , because Postgres itself will reject the query — the
-- guarantee lives at the database level, not in application code discipline.
--
-- IMPORTANT — run this once, then IMMEDIATELY change the placeholder password
-- from your own terminal (never commit the real password to this repo):
--   ALTER ROLE altax_public_app WITH PASSWORD '<a-long-random-value-you-generate>';
-- Then build the connection string for PUBLIC_TOOLS_DATABASE_URL using that new
-- password, the same host/port/database as DATABASE_URL, with ?sslmode=require.

CREATE SCHEMA IF NOT EXISTS altax_public;

CREATE TABLE IF NOT EXISTS altax_public.tool_leads (
  id SERIAL PRIMARY KEY,
  tool_name VARCHAR(60) NOT NULL,
  name VARCHAR(200),
  email VARCHAR(320),
  phone VARCHAR(40),
  -- Non-sensitive, tool-specific answers only (quiz scores, category tags,
  -- hypothetical entity-comparison inputs) — never SSN/EIN/bank/account data.
  -- Enforced by the route handler that writes here, not by the column itself.
  payload JSONB,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'altax_public_app') THEN
    CREATE ROLE altax_public_app WITH LOGIN PASSWORD 'CHANGE_ME_IMMEDIATELY_8dab268fc6d33bad';
  END IF;
END $$;

GRANT USAGE ON SCHEMA altax_public TO altax_public_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA altax_public TO altax_public_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA altax_public TO altax_public_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA altax_public GRANT SELECT, INSERT ON TABLES TO altax_public_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA altax_public GRANT USAGE, SELECT ON SEQUENCES TO altax_public_app;

-- Belt-and-suspenders on top of Postgres's default-deny: make the isolation
-- guarantee explicit and auditable in this migration, not implicit.
REVOKE ALL ON SCHEMA altax FROM altax_public_app;
REVOKE ALL ON SCHEMA altax_public FROM PUBLIC;
