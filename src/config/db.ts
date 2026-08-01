import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Local dev (`npm run dev`) and the test suite (`npm test`) used to point at the exact
// same Neon instance as production — there was no separate dev/test database at all,
// so a mistaken local DELETE or a test run was a direct incident against real client
// SSNs/bank data. DATABASE_URL_DEV is an optional override: set it in your local .env
// to a separate Neon branch's connection string (Neon → branches → create branch from
// main → copy its connection string) and every local `npm run dev`/`npm test` run will
// use it instead, with zero change to how Railway/production connects (which only ever
// reads DATABASE_URL and never sees this var). Production is unaffected either way —
// this is purely additive.
const isProdRuntime = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_STATIC_URL);
const connectionString = (!isProdRuntime && process.env.DATABASE_URL_DEV) || process.env.DATABASE_URL;
if (!isProdRuntime && !process.env.DATABASE_URL_DEV) {
  // eslint-disable-next-line no-console
  console.warn(
    "\n[db] WARNING: no DATABASE_URL_DEV set — this local process is connected to the SAME database as production.\n" +
    "     Create a separate Neon branch for local dev/test and set DATABASE_URL_DEV in your .env to stop this.\n"
  );
}

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("Unexpected error on idle Postgres client", err);
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Same shape as the module-level query/queryOne, but bound to one transactional connection. */
export interface DbClient {
  query<T = any>(text: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(text: string, params?: any[]): Promise<T | null>;
}

/**
 * Runs `fn` against a single dedicated connection inside BEGIN/COMMIT, rolling back on
 * any thrown error (including one you throw yourself to enforce an invariant, e.g. a
 * payroll GL entry whose debits don't equal its credits). Added specifically because
 * multi-statement writes like postPayrollGl's 4-5 INSERTs were previously independent
 * pool.query() calls with no atomicity — a crash mid-sequence left a permanently
 * half-posted, unbalanced GL entry. Every caller that writes more than one related row
 * should go through this rather than the bare module-level query().
 */
export async function withTransaction<T>(fn: (db: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const db: DbClient = {
      query: async (text: string, params?: any[]) => (await client.query(text, params)).rows,
      queryOne: async (text: string, params?: any[]) => {
        const rows = (await client.query(text, params)).rows;
        return rows[0] ?? null;
      },
    };
    const result = await fn(db);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
