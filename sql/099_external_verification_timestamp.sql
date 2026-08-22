-- External verification (sql/095) originally recorded date-only ("checked
-- today"), which is ambiguous when more than one staff member checks the
-- same client on the same day — no way to tell which check is actually the
-- current one within that day. Widening to TIMESTAMPTZ preserves every
-- existing value (a bare DATE casts to that date's midnight, in this
-- session's timezone, converted to UTC — no data loss, just no retroactive
-- time-of-day precision for checks recorded before this migration) and lets
-- new checks (NOW() instead of CURRENT_DATE, see clients.routes.ts) carry a
-- real time.
ALTER TABLE altax.v3_clients
    ALTER COLUMN mdtaxconnect_verified_at TYPE TIMESTAMPTZ USING mdtaxconnect_verified_at::timestamptz,
    ALTER COLUMN md_business_express_verified_at TYPE TIMESTAMPTZ USING md_business_express_verified_at::timestamptz;
