const fs = require("fs");
const { Pool } = require("pg");
require("dotenv").config();

const file = process.argv[2];
if (!file) {
  console.error("Usage: node _apply_migration.js sql/034_task_rules_agent.sql");
  process.exit(1);
}

const sql = fs.readFileSync(file, "utf8");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

async function main() {
  try {
    console.log("Connecting via DATABASE_URL host:", new URL(process.env.DATABASE_URL).host);
    await pool.query(sql);
    console.log("Migration applied successfully:", file);

    const check = await pool.query(
      `SELECT to_regclass('altax.v3_task_batch_drafts') AS t1, to_regclass('altax.v3_task_rules_agent_settings') AS t2`
    );
    console.log("Verification:", check.rows[0]);
  } catch (err) {
    console.error("MIGRATION FAILED:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
main();
