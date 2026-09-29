-- Makes the Document Checklist cover letter editable per (client,
-- checklist) instead of a fixed template -- direct owner requests,
-- 2026-09-29: "Add Note, if you can make it smart and better please do,"
-- then "Make this cover sheet editable." Two free-text fields, both
-- persisted so they're typed once and print the same way on every reprint:
-- intro_text overrides the default opening sentence ("The following
-- documents are enclosed in support of this application:"), note is an
-- additional remark printed after the checklist ("Re-submission --
-- previous application denied for missing Pest Control Contract, now
-- included" / "Please expedite -- client's grand opening is 10/15"). The
-- RE: line stays auto-derived from real client/checklist data, not
-- editable -- it's already accurate and shouldn't drift from the record.
CREATE TABLE IF NOT EXISTS altax.v3_client_checklist_notes (
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    checklist_id VARCHAR(64) NOT NULL REFERENCES altax.v3_document_checklists(checklist_id) ON DELETE CASCADE,
    intro_text TEXT,
    note TEXT,
    updated_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, checklist_id)
);
