-- Firm Notes — a shared follow-up notebook for admin/staff, separate from
-- Tasks and separate from the per-client activity log (v3_client_activity_log,
-- the "Client Note"/"Firm Note" buttons). Real owner request: while working
-- through client tasks, staff need somewhere to jot a quick reminder ("this
-- client is missing something," "come back and invoice them") that isn't a
-- formal Task, then review/resolve/delete it later from ONE central place —
-- not by visiting each client individually, which the activity log has no
-- way to do (every route against it is scoped to one client_id).
--
-- Visibility is role-based, not author-based, per two rounds of owner
-- clarification: staff don't need notes hidden from each other (default
-- visibility='firm', shared with the whole team), but the owner's own notes
-- as admin genuinely are different from staff notes and need to stay
-- separate (visibility='admin', visible only to admin accounts — enforced
-- server-side in staffNotes.routes.ts, never trusted from client input).
CREATE TABLE IF NOT EXISTS altax.v3_staff_notes (
    note_id VARCHAR(64) PRIMARY KEY,
    author_email VARCHAR(255) NOT NULL,
    author_name VARCHAR(255),
    client_id VARCHAR(64) REFERENCES altax.v3_clients(client_id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    visibility VARCHAR(16) NOT NULL DEFAULT 'firm' CHECK (visibility IN ('firm', 'admin')),
    -- Free text with datalist suggestions on the frontend (Billing, Missing
    -- Info, Follow-up, General) — advisory, not a hard constraint, same
    -- philosophy as v3_clients.industry_category.
    category VARCHAR(64),
    status VARCHAR(16) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Done')),
    remind_at DATE,
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_staff_notes_status ON altax.v3_staff_notes(status, remind_at);
CREATE INDEX IF NOT EXISTS idx_v3_staff_notes_client ON altax.v3_staff_notes(client_id);

-- Widen the existing per-reader read-state table (sql/065_activity_reads.sql,
-- already used for "Client Note"/"Task Note" unread counters) to also cover
-- staff_note, instead of building a second read-tracking mechanism.
ALTER TABLE altax.v3_activity_reads DROP CONSTRAINT IF EXISTS v3_activity_reads_entity_type_check;
ALTER TABLE altax.v3_activity_reads ADD CONSTRAINT v3_activity_reads_entity_type_check CHECK (entity_type IN ('client_note', 'task_note', 'staff_note'));
