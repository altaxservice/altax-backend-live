-- The Baltimore City/County license application PDFs both have a real
-- "Owner"/"Applicant's Name" field distinct from a general contact person —
-- until now the generator filled that field with contact_person, which is
-- meant for day-to-day communication (e.g. a bookkeeper) and isn't
-- necessarily the legal owner/officer the government form actually asks for.
-- This adds a dedicated first-class column so staff enter it once and every
-- generated form pulls from the same value, distinct from contact_person and
-- from license_application_data.officerTitle (the owner's role, not name).
ALTER TABLE altax.v3_haccp_plans ADD COLUMN IF NOT EXISTS officer_owner_name VARCHAR(255);
