-- Self-hosted, privacy-first website analytics — direct owner request,
-- 2026-08-27: "the safest way" to see visitor counts and which pages/tools
-- get used most, explicitly choosing this over Google Analytics or any
-- other third-party tracker.
--
-- No PII is ever stored:
--   - No raw IP address. visitor_hash is SHA-256(ip + user-agent + today's
--     date + a fixed app salt), computed server-side and immediately
--     discarded — the IP itself never touches the database. Including
--     today's date in the hash input means it changes every day on its
--     own (no rotating secret to manage), so the SAME visitor gets the SAME
--     hash across multiple page views today (real "unique visitors today"
--     counting) but a DIFFERENT hash tomorrow (no cross-day tracking of any
--     individual, and the one-way hash can't be reversed back to an IP).
--   - No raw user-agent string stored either — only a derived device_type
--     ('mobile'/'desktop'), so no detailed browser/OS fingerprint sits in
--     the database.
--   - No cookies are set anywhere in this feature (see publicAnalytics.routes.ts).
--   - referrer_host is just the referring domain (e.g. "google.com"), never
--     a full URL — a full referrer URL can itself leak query-string data
--     from wherever the visitor came from.
CREATE TABLE IF NOT EXISTS altax.v3_page_views (
    view_id        BIGSERIAL PRIMARY KEY,
    path           VARCHAR(255) NOT NULL,
    referrer_host  VARCHAR(255),
    device_type    VARCHAR(20) NOT NULL DEFAULT 'desktop',
    visitor_hash   VARCHAR(64) NOT NULL,
    viewed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_page_views_viewed_at ON altax.v3_page_views(viewed_at);
CREATE INDEX IF NOT EXISTS idx_v3_page_views_path ON altax.v3_page_views(path);
