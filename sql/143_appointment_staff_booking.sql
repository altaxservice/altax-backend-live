-- Whether this admin/staff account shows up as a choice on the public
-- client-facing appointment booking page. Defaults every existing active
-- account to bookable (opt-out, not opt-in) so nothing disappears from the
-- public page the moment this ships — staff can flip individual people off
-- later from Users & Access if they shouldn't take client meetings directly.
ALTER TABLE altax.v3_users ADD COLUMN IF NOT EXISTS bookable_publicly BOOLEAN NOT NULL DEFAULT true;
