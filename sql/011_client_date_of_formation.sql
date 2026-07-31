-- ---------------------------------------------------------------------------
-- Clients: date the business entity was formed/incorporated — collected on
-- the Add Client card alongside Entity Type/State, shown and editable on the
-- client's business profile. No such date was tracked anywhere before this.
-- ---------------------------------------------------------------------------
ALTER TABLE v3_clients ADD COLUMN IF NOT EXISTS date_of_formation DATE;
