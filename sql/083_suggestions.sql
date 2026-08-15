-- Improvement Suggestions board — a shared, firm-internal idea list for Admin
-- and Staff (see src/modules/suggestions/suggestions.routes.ts). Anyone on the
-- team can post an idea; everyone sees the same open list; only Admin triages
-- status and leaves the admin_note that's shown back to everyone so ideas
-- visibly get looked at instead of disappearing into a private inbox.
--
-- No client_id — this is firm-internal, not client-scoped, so none of the
-- v3_ownership_transfers/canAccessClient-style scoping applies here.
--
-- submitted_by_name/email/role are captured from the authed user at submit
-- time (not user-entered, not a live FK to v3_users) — same
-- snapshot-at-the-time convention as other "who did this" fields elsewhere
-- in this app (e.g. created_by on v3_ownership_transfers), so a later name
-- change or deactivated account never rewrites what an old suggestion shows.
CREATE TABLE IF NOT EXISTS altax.v3_suggestions (
    suggestion_id       VARCHAR(64) PRIMARY KEY,
    title                VARCHAR(255) NOT NULL,
    description          TEXT,
    category             VARCHAR(100),
    submitted_by_name    VARCHAR(255),
    submitted_by_email   VARCHAR(255),
    submitted_by_role    VARCHAR(20),
    status               VARCHAR(30) NOT NULL DEFAULT 'New',
    admin_note           TEXT,
    status_updated_by    VARCHAR(255),
    status_updated_at    TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_suggestions_created_at ON altax.v3_suggestions (created_at DESC);
