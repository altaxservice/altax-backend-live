-- rendered_body was NOT NULL from v1, when every plan always carried CCP
-- content. Now that a plan can be Menu & Equipment-only (see
-- sql/132_haccp_plans_components.sql), renderPlanBody() legitimately returns
-- no body text when "haccp_plan" isn't a requested component — null is the
-- correct representation of "no CCP content for this plan", not an empty
-- string standing in for it.
ALTER TABLE altax.v3_haccp_plans ALTER COLUMN rendered_body DROP NOT NULL;
