-- Hard Audit finding, 2026-08-27: the public, unauthenticated pageview
-- beacon wrote through the main DB pool/role — the same one every PII
-- route (login, payroll, e-file) shares — instead of the sandboxed
-- altax_public role every other public/unauthenticated write path in this
-- app uses. This table already stores zero PII by design (no raw IP, no
-- raw user-agent, no cookies — see the table's original 113_page_views.sql
-- comment), so this isn't a data-exposure fix; it's closing a connection-
-- pool-exhaustion path where a flood of anonymous beacon traffic could
-- degrade availability for authenticated routes sharing the same 10-
-- connection pool.
CREATE TABLE IF NOT EXISTS altax_public.v3_page_views (
    view_id        BIGSERIAL PRIMARY KEY,
    path           VARCHAR(255) NOT NULL,
    referrer_host  VARCHAR(255),
    device_type    VARCHAR(20) NOT NULL DEFAULT 'desktop',
    visitor_hash   VARCHAR(64) NOT NULL,
    viewed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_page_views_viewed_at ON altax_public.v3_page_views(viewed_at);
CREATE INDEX IF NOT EXISTS idx_v3_page_views_path ON altax_public.v3_page_views(path);

-- Guarded so this migration is safe to run twice (the source table is gone
-- after the first run) — same pattern as 115_newsletter_sandboxed_double_optin.sql.
-- view_id isn't referenced anywhere else, so rows are carried over without
-- trying to preserve the original id.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'altax' AND table_name = 'v3_page_views') THEN
    INSERT INTO altax_public.v3_page_views (path, referrer_host, device_type, visitor_hash, viewed_at)
    SELECT path, referrer_host, device_type, visitor_hash, viewed_at FROM altax.v3_page_views;

    DROP TABLE altax.v3_page_views;
  END IF;
END $$;

GRANT SELECT, INSERT ON altax_public.v3_page_views TO altax_public_app;
GRANT USAGE, SELECT ON SEQUENCE altax_public.v3_page_views_view_id_seq TO altax_public_app;
