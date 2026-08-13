// BC-005 restore drill (2026-08-13). One-shot, not part of the tracked migration
// flow — exercises the *real* buildBackupObject() (reads DEV, via db.ts's normal
// DATABASE_URL_DEV routing) and then replicates POST /system/backup/restore's
// exact TRUNCATE + FK-topological-insert + setval logic, but against a local
// scratch Postgres database (altax_restore_drill) reached through a hardcoded
// connection string that never goes through db.ts — so this script can never
// resolve to dev or prod no matter what env vars are set.
import { Pool } from "pg";
import { buildBackupObject } from "../src/common/autoBackup";

const SCRATCH_URL = "postgresql://localhost:5432/altax_restore_drill";

async function main() {
  console.log("[drill] exporting real backup from DEV via buildBackupObject()...");
  const { backup, tableCount, totalRows } = await buildBackupObject("System (Restore Drill)");
  console.log(`[drill] exported ${tableCount} tables, ${totalRows} rows from DEV`);

  const scratch = new Pool({ connectionString: SCRATCH_URL });
  try {
    const liveTables = (await scratch.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'altax'`))
      .rows.map((t: any) => String(t.tablename));
    const data = (backup as any).data as Record<string, any[]>;
    const backupTables = Object.keys(data);
    const restorable = backupTables.filter((t) => liveTables.includes(t));
    const skippedFromBackup = backupTables.filter((t) => !liveTables.includes(t));
    const notInBackup = liveTables.filter((t) => !backupTables.includes(t));
    console.log(`[drill] restorable tables: ${restorable.length}; skipped (not in scratch schema): ${skippedFromBackup.length}; scratch tables absent from backup: ${notInBackup.length}`);
    if (skippedFromBackup.length) console.log(`[drill]   skipped: ${skippedFromBackup.join(", ")}`);
    if (notInBackup.length) console.log(`[drill]   not in backup: ${notInBackup.join(", ")}`);

    const fkRows = (await scratch.query(
      `SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
         FROM pg_constraint WHERE contype = 'f' AND connamespace = 'altax'::regnamespace`
    )).rows;
    const strip = (n: string) => n.replace(/^altax\./, "").replace(/"/g, "");
    const parentsOf = new Map<string, Set<string>>();
    for (const t of restorable) parentsOf.set(t, new Set());
    for (const fk of fkRows) {
      const child = strip(String(fk.child));
      const parent = strip(String(fk.parent));
      if (parentsOf.has(child) && restorable.includes(parent) && child !== parent) {
        parentsOf.get(child)!.add(parent);
      }
    }
    const ordered: string[] = [];
    const placed = new Set<string>();
    while (ordered.length < restorable.length) {
      const ready = restorable.filter((t) => !placed.has(t) && [...parentsOf.get(t)!].every((p) => placed.has(p)));
      if (ready.length === 0) {
        for (const t of restorable) if (!placed.has(t)) { ordered.push(t); placed.add(t); }
        break;
      }
      for (const t of ready) { ordered.push(t); placed.add(t); }
    }

    const client = await scratch.connect();
    const restoredCounts: Record<string, number> = {};
    try {
      await client.query("BEGIN");
      const truncateList = restorable.map((t) => `altax."${t}"`).join(", ");
      await client.query(`TRUNCATE ${truncateList} CASCADE`);

      for (const table of ordered) {
        const rows: any[] = Array.isArray(data[table]) ? data[table] : [];
        restoredCounts[table] = 0;
        if (rows.length === 0) continue;
        const liveColRows = (await client.query(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'altax' AND table_name = $1`,
          [table]
        )).rows as { column_name: string; data_type: string }[];
        const liveCols = liveColRows.map((r) => String(r.column_name));
        const jsonCols = new Set(liveColRows.filter((r) => r.data_type === "json" || r.data_type === "jsonb").map((r) => r.column_name));
        const cols = Object.keys(rows[0]).filter((c) => liveCols.includes(c));
        if (cols.length === 0) continue;
        const colSql = cols.map((c) => `"${c}"`).join(", ");
        const CHUNK = 200;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const params: any[] = [];
          const tuples = chunk.map((row) => {
            const placeholders = cols.map((c) => {
              const v = row[c];
              params.push(v !== null && typeof v === "object" && jsonCols.has(c) ? JSON.stringify(v) : v);
              return `$${params.length}`;
            });
            return `(${placeholders.join(", ")})`;
          });
          await client.query(`INSERT INTO altax."${table}" (${colSql}) VALUES ${tuples.join(", ")}`, params);
          restoredCounts[table] += chunk.length;
        }
      }

      const serials = (await client.query(
        `SELECT table_name, column_name, pg_get_serial_sequence('altax."' || table_name || '"', column_name) AS seq
           FROM information_schema.columns
          WHERE table_schema = 'altax' AND column_default LIKE 'nextval%'`
      )).rows.filter((r: any) => r.seq && restorable.includes(String(r.table_name)));
      for (const s of serials) {
        await client.query(
          `SELECT setval('${s.seq}', GREATEST((SELECT COALESCE(MAX("${s.column_name}"), 0) FROM altax."${s.table_name}"), 1))`
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const totalRestored = Object.values(restoredCounts).reduce((s, n) => s + n, 0);
    console.log(`\n[drill] restore complete: ${Object.keys(restoredCounts).length} tables, ${totalRestored} rows written to scratch DB.\n`);

    console.log("[drill] per-table comparison (source DEV export vs. scratch after restore):");
    const sourceCounts = (backup as any).rowCounts as Record<string, number>;
    let mismatches = 0;
    for (const table of Object.keys(sourceCounts).sort()) {
      const src = sourceCounts[table];
      const dst = restoredCounts[table] ?? (skippedFromBackup.includes(table) ? "SKIPPED" : 0);
      const ok = dst === src;
      if (!ok) mismatches++;
      if (!ok || src > 0) console.log(`  ${ok ? "OK  " : "MISMATCH"} ${table}: source=${src} restored=${dst}`);
    }
    console.log(`\n[drill] ${mismatches === 0 ? "ALL TABLES MATCH — restore drill PASSED." : `${mismatches} MISMATCHES — restore drill FAILED.`}`);
  } finally {
    await scratch.end();
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error("[drill] FAILED:", err); process.exit(1); });
