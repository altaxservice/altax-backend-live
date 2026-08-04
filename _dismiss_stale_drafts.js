const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

async function main() {
  try {
    const preview = await pool.query(
      `SELECT task_batch_draft_id, task_type, period_label, due_date::date AS due_date
         FROM altax.v3_task_batch_drafts
        WHERE status = 'Pending' AND due_date::date < CURRENT_DATE
        ORDER BY due_date`
    );
    console.log(`About to dismiss ${preview.rows.length} stale (past-due) Pending draft(s):`);
    for (const r of preview.rows) console.log(`  - ${r.task_type} (${r.period_label}, due ${r.due_date.toISOString().slice(0, 10)})`);

    const result = await pool.query(
      `UPDATE altax.v3_task_batch_drafts
         SET status = 'Dismissed', dismissed_reason = 'Backfilled before the past-due guard existed — handled manually',
             dismissed_by = 'System (cleanup script)', dismissed_at = now(), updated_at = now()
       WHERE status = 'Pending' AND due_date::date < CURRENT_DATE
       RETURNING task_batch_draft_id`
    );
    console.log(`Dismissed ${result.rowCount} draft(s).`);

    const remaining = await pool.query(
      `SELECT task_type, period_label, due_date::date AS due_date FROM altax.v3_task_batch_drafts WHERE status = 'Pending' ORDER BY due_date`
    );
    console.log(`Remaining Pending draft(s): ${remaining.rows.length}`);
    for (const r of remaining.rows) console.log(`  - ${r.task_type} (${r.period_label}, due ${r.due_date.toISOString().slice(0, 10)})`);
  } catch (err) {
    console.error("ERROR:", err);
  } finally {
    await pool.end();
  }
}
main();
