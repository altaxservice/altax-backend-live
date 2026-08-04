const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

async function main() {
  try {
    console.log("--- batch-drafts route query ---");
    const drafts = await pool.query(
      `SELECT * FROM altax.v3_task_batch_drafts WHERE status = $1 ORDER BY due_date ASC, period_label ASC`,
      ["Pending"]
    );
    console.log("rows:", drafts.rows.length);
    for (const draft of drafts.rows) {
      const rule = await pool.query(`SELECT * FROM altax.v3_task_rules WHERE rule_id = $1`, [draft.rule_id]);
      console.log("draft", draft.task_batch_draft_id, "rule found:", rule.rows.length > 0);
    }

    console.log("--- agent/summary route query ---");
    const activeRules = await pool.query(`SELECT rule_id FROM altax.v3_task_rules WHERE active = true`);
    console.log("active rules:", activeRules.rows.length);
    const pendingDrafts = await pool.query(`SELECT due_date FROM altax.v3_task_batch_drafts WHERE status = 'Pending'`);
    console.log("pending drafts:", pendingDrafts.rows.length);
    const settings = await pool.query(`SELECT auto_run_enabled FROM altax.v3_task_rules_agent_settings WHERE id = 'TRAGENT-1'`);
    console.log("settings row:", settings.rows);

    console.log("ALL QUERIES SUCCEEDED — no error reproduced.");
  } catch (err) {
    console.error("REPRODUCED ERROR:", err);
  } finally {
    await pool.end();
  }
}
main();
