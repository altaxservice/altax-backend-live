-- Manually-logged documents the firm has on file for a client that are NOT
-- an actual upload in this app -- e.g. a physical original kept in a filing
-- cabinet, a document mailed to an agency, or a copy the client keeps
-- themselves. Direct owner request, 2026-09-29: "What is the list of
-- documents we have on file for each client, what date it was received or
-- uploaded, who received or uploaded it, where is it -- even if it is not
-- in this app." Real v3_document_uploads rows already answer this for
-- in-app files (file_name/uploaded_at/uploaded_by, location is implicitly
-- "In Portal"); this table covers everything else, merged with those in the
-- same "Files on File" list on the client's Documents tab rather than a
-- separate screen.
CREATE TABLE IF NOT EXISTS altax.v3_client_document_register (
    register_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    document_name VARCHAR(255) NOT NULL,
    received_date DATE,
    received_by VARCHAR(255),
    location VARCHAR(255) NOT NULL,
    notes TEXT,
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_client_document_register_client ON altax.v3_client_document_register(client_id);
