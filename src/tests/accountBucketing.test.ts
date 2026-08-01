/**
 * Guards against exactly the bug class that shipped once already (see commit
 * c9a3b18 — "Fix Sales Tax counted as Revenue in reports"): reports.routes.ts
 * (backend) and ReportsPage.tsx (frontend) each keep their own independent copy of
 * the INCOME_TYPES/COGS_TYPES/EXPENSE_HINTS/ASSET_HINTS/LIABILITY_HINTS account
 * classification lists, because they're two separate build systems (a Node backend
 * and a Vite/browser frontend) with no shared package between them. There's nothing
 * stopping someone from editing one copy — adding a new GL account name to one
 * list — without remembering the other one exists, and the two would silently
 * disagree about what an account IS (income vs. liability vs. expense) again.
 *
 * A real shared module would be the correct long-term fix but needs a workspace/
 * monorepo restructuring across two independently-built projects — out of scope for
 * closing this specific drift risk today. This is the pragmatic middle ground: read
 * both source files as plain text (no cross-project import needed) and fail loudly
 * in CI the moment the two copies stop matching exactly, rather than finding out via
 * a report someone downloads later.
 *
 * No live server/database needed — this only reads local source files, so it's safe
 * to run in CI's typecheck-and-build job (see .github/workflows/ci.yml) alongside
 * every other push, not just the DB-backed integration-tests job.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

// Resolved from process.cwd(), not __dirname — the compiled test runs from dist/tests/,
// which has no .ts source files at all (tsc only emits .js there), so this reads the
// real source tree relative to the repo root that `npm test` always runs from.
const BACKEND_FILE = path.join(process.cwd(), "src", "modules", "reports", "reports.routes.ts");
const FRONTEND_FILE = path.join(process.cwd(), "frontend", "src", "pages", "ReportsPage.tsx");

const CONSTANT_NAMES = ["INCOME_TYPES", "COGS_TYPES", "EXPENSE_HINTS", "ASSET_HINTS", "LIABILITY_HINTS"] as const;

function extractConstant(sourceText: string, constantName: string, fileLabel: string): string[] {
  const match = sourceText.match(new RegExp(`const\\s+${constantName}\\s*=\\s*(\\[[^\\]]*\\])`));
  if (!match) throw new Error(`Could not find "const ${constantName} = [...]" in ${fileLabel}. Did it get renamed or restructured?`);
  const arrayLiteral = match[1];
  const strings: string[] = [];
  const stringRe = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = stringRe.exec(arrayLiteral))) strings.push(m[1]);
  return strings;
}

test("account-bucketing lists: backend and frontend copies stay identical", () => {
  const backendSource = fs.readFileSync(BACKEND_FILE, "utf8");
  const frontendSource = fs.readFileSync(FRONTEND_FILE, "utf8");

  for (const name of CONSTANT_NAMES) {
    const backendValues = extractConstant(backendSource, name, "reports.routes.ts");
    const frontendValues = extractConstant(frontendSource, name, "ReportsPage.tsx");
    assert.deepEqual(
      backendValues,
      frontendValues,
      `${name} has drifted between reports.routes.ts (${JSON.stringify(backendValues)}) and ReportsPage.tsx (${JSON.stringify(frontendValues)}) — ` +
        `update both together, they must classify GL accounts identically or the on-screen report and the downloaded PDF/CSV can disagree.`
    );
  }
});
