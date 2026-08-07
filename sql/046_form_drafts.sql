-- Generic autosave-draft store for the app's largest forms (Add/Edit Client,
-- the Gov Form / POA Form generator modals, Invoice editor, Employee edit,
-- New Work Item/Task, New Appointment, Batch Tasks). Losing 30+ minutes of
-- typing to an accidental tab close or a network hiccup was a standing
-- complaint — this table is what a per-form autosave hook (useFormDraft on
-- the frontend) reads/writes.
--
-- One row per (user, form_key): form_key is a caller-chosen string that
-- disambiguates both which form AND which record it's editing, e.g.
-- "add-client" (a single shared draft for the create flow) vs.
-- "edit-client:C-1234" (a distinct draft per client being edited) — so
-- editing two different clients in two tabs never collides. Scoped to
-- user_email (not device/browser) since the user chose server-side drafts
-- specifically so a draft follows them across devices.
--
-- Deliberately excluded: the Vault secret-entry form (tax-portal login
-- credentials) — that form's plaintext password field must never be
-- persisted anywhere outside the existing server-side encrypted column, so
-- it's never wired into this table.
CREATE TABLE IF NOT EXISTS altax.v3_form_drafts (
    draft_id VARCHAR(64) PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    form_key VARCHAR(255) NOT NULL,
    draft_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_v3_form_drafts_user_form ON altax.v3_form_drafts(user_email, form_key);
