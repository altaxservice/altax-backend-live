const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

async function main() {
  try {
    const url = new URL(process.env.DATABASE_URL);
    console.log("Connecting via local .env DATABASE_URL host:", url.host);
    const check = await pool.query(
      `SELECT to_regclass('altax.v3_task_batch_drafts') AS t1, to_regclass('altax.v3_task_rules_agent_settings') AS t2`
    );
    console.log("Table check:", check.rows[0]);
    const rules = await pool.query(`SELECT count(*) FROM altax.v3_task_rules WHERE active = true`);
    console.log("Active rules visible from this connection:", rules.rows[0].count);
  } catch (err) {
    console.error("ERROR:", err);
  } finally {
    await pool.end();
  }
}
main();
