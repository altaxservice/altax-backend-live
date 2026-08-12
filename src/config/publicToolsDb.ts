import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

/**
 * Second, restricted connection pool for the public website tools (Business
 * Health Check, Entity Comparison, Document Checklist, etc.) — authenticated
 * as altax_public_app, a role with grants ONLY on the altax_public schema
 * (see sql/062_public_tools_schema.sql). It has zero access to the altax
 * schema where client records and encrypted SSN/EIN/bank fields live.
 *
 * Every module under src/modules/publicTools MUST import this pool, never
 * the main one from src/config/db.ts — that boundary is what makes the
 * isolation real. Deliberately no fallback to DATABASE_URL if this var is
 * missing: failing loudly here is the safe behavior, since a silent
 * fallback would be the one thing that could quietly undo the isolation.
 */
const connectionString = process.env.PUBLIC_TOOLS_DATABASE_URL;

export const publicToolsPool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30000,
});

publicToolsPool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("Unexpected error on idle public-tools Postgres client", err);
});

function assertConfigured() {
  if (!connectionString) {
    throw new Error(
      "PUBLIC_TOOLS_DATABASE_URL is not set — refusing to query. This pool must never fall back to the main database."
    );
  }
}

export async function publicToolsQuery<T = any>(text: string, params?: any[]): Promise<T[]> {
  assertConfigured();
  const result = await publicToolsPool.query(text, params);
  return result.rows as T[];
}

export async function publicToolsQueryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await publicToolsQuery<T>(text, params);
  return rows[0] ?? null;
}
