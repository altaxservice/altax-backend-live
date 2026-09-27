-- Firm-wide reusable Manual JE templates. v3_coa (the chart of accounts) is a
-- single shared table across every client (see accounting.routes.ts's GET
-- /coa), so a template's account names are valid for any client, not just
-- the one it was saved from -- templates are intentionally NOT client-scoped.
-- Stores structure only (account + memo pattern), never dollar amounts --
-- those differ entry to entry, so the user fills them in each time it's used.
CREATE TABLE IF NOT EXISTS altax.v3_je_templates (
  template_id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description_template VARCHAR(500),
  lines JSONB NOT NULL,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
