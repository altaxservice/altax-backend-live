-- Real owner request, 2026-09-14: label assignments become private per
-- assigning staff member (a staff user only sees/removes labels THEY put
-- on a client/task; admin still sees every assignment from everyone) — see
-- labels.routes.ts's GET /for/* and DELETE routes for the new filtering.
--
-- The old PRIMARY KEY (entity_type, entity_id, label_id) only allowed ONE
-- assignment of a given label to a given entity system-wide, no matter who
-- assigned it -- two different staff members independently tagging the
-- same client "VIP" would collide (the second INSERT's ON CONFLICT DO
-- NOTHING would silently no-op against the first person's row, so the
-- second person would think they added it but never see it, since it's
-- not theirs). Widening the key to include assigned_by lets each person
-- who assigns a label keep their own independent row.
ALTER TABLE altax.v3_entity_labels ALTER COLUMN assigned_by SET NOT NULL;
ALTER TABLE altax.v3_entity_labels DROP CONSTRAINT v3_entity_labels_pkey;
ALTER TABLE altax.v3_entity_labels ADD PRIMARY KEY (entity_type, entity_id, label_id, assigned_by);
