import { Router, Response } from "express";
import { query, queryOne, withTransaction } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient, getUserAliases } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import { ClientKeyRow, Reason, clusters, relatedTo, pairKey } from "./relatedClients";

/**
 * Owner groups — companies that belong to the same owner. Two halves:
 *  - SUGGESTIONS, computed on the fly from the owner's/company's phone, email and name (relatedClients.ts);
 *  - CONFIRMED groups, which staff create ("same owner"), name, edit and dismiss; a client is in at most one group.
 * Staff only see companies they have access to (assigned via tasks), exactly like the Clients list; admin sees everything.
 */
export const clientGroupsRouter = Router();

const COLS = `client_id, client_name, status, phone, email, company_contact_name, company_contact_phone, company_contact_email`;

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${Math.floor(100 + Math.random() * 900)}`;
}

/** The clients this user may see: everyone for admin, otherwise those with a task assigned to them. */
export async function loadScope(user: { role: string; email: string }): Promise<ClientKeyRow[]> {
  if (user.role === "admin") return query<ClientKeyRow>(`SELECT ${COLS} FROM altax.v3_clients ORDER BY client_name`);
  const aliases = Array.from(await getUserAliases(user.email));
  return query<ClientKeyRow>(
    `SELECT ${COLS} FROM altax.v3_clients WHERE client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[])) ORDER BY client_name`,
    [aliases]
  );
}

export async function loadDismissed(): Promise<Set<string>> {
  const rows = await query<{ client_a: string; client_b: string }>(`SELECT client_a, client_b FROM altax.v3_client_link_dismissed`);
  return new Set(rows.map((r) => `${r.client_a}|${r.client_b}`));
}

function fmtPhone(d: string): string { return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d; }
function shapeReasons(reasons: Reason[]) {
  return reasons.map((r) => ({ kind: r.kind, value: /phone/.test(r.kind) ? fmtPhone(r.value) : r.value, weight: r.weight }));
}

interface GroupRow { group_id: string; group_name: string }
async function groupOf(clientId: string): Promise<GroupRow | null> {
  return queryOne<GroupRow>(`SELECT g.group_id, g.group_name FROM altax.v3_client_group_members m JOIN altax.v3_client_groups g ON g.group_id = m.group_id WHERE m.client_id = $1`, [clientId]);
}
async function membersOf(groupId: string, scope: Set<string> | null) {
  const rows = await query<any>(
    `SELECT c.client_id, c.client_name, c.status FROM altax.v3_client_group_members m JOIN altax.v3_clients c ON c.client_id = m.client_id WHERE m.group_id = $1 ORDER BY c.client_name`, [groupId]);
  const visible = scope ? rows.filter((r) => scope.has(r.client_id)) : rows;
  return { members: visible.map((r) => ({ clientId: r.client_id, clientName: r.client_name, status: r.status })), hiddenCount: rows.length - visible.length };
}

/** Everything the "Related companies" panel needs for one client. */
clientGroupsRouter.get("/related/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = req.params.clientId;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const scope = await loadScope(req.user!);
  const target = (await queryOne<ClientKeyRow>(`SELECT ${COLS} FROM altax.v3_clients WHERE client_id = $1`, [clientId]));
  if (!target) return res.status(404).json({ error: "Client not found." });
  const scopeIds = req.user!.role === "admin" ? null : new Set(scope.map((c) => c.client_id));
  const g = await groupOf(clientId);
  const grp = g ? await membersOf(g.group_id, scopeIds) : null;
  const inGroup = new Set((grp?.members || []).map((m) => m.clientId));
  const dismissed = await loadDismissed();
  const found = relatedTo(target, scope, dismissed).filter((f) => !inGroup.has(f.client.client_id)).slice(0, 15);
  const groupRows = found.length ? await query<any>(`SELECT m.client_id, g.group_id, g.group_name FROM altax.v3_client_group_members m JOIN altax.v3_client_groups g ON g.group_id = m.group_id WHERE m.client_id = ANY($1::text[])`, [found.map((f) => f.client.client_id)]) : [];
  const otherGroup = new Map<string, { groupId: string; groupName: string }>(groupRows.map((r) => [r.client_id, { groupId: r.group_id, groupName: r.group_name }]));
  res.json({
    group: g ? { groupId: g.group_id, groupName: g.group_name, members: grp!.members, hiddenCount: grp!.hiddenCount } : null,
    suggestions: found.map((f) => ({ clientId: f.client.client_id, clientName: f.client.client_name, status: f.client.status, score: f.score, reasons: shapeReasons(f.reasons), otherGroup: otherGroup.get(f.client.client_id) || null })),
  });
}));

async function assertAccess(req: AuthedRequest, ids: string[]): Promise<string | null> {
  for (const id of ids) if (!(await canAccessClient(req.user!, id))) return `You do not have access to client ${id}.`;
  return null;
}

/** "Same owner": put clientId and the others in one group (merging any groups they were already in). */
clientGroupsRouter.post("/confirm", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.body?.clientId || "").trim();
  const others: string[] = Array.from(new Set((Array.isArray(req.body?.otherIds) ? req.body.otherIds : []).map((x: unknown) => String(x).trim()).filter(Boolean)));
  const ids = [clientId, ...others.filter((o) => o !== clientId)];
  if (!clientId || ids.length < 2) return res.status(400).json({ error: "Pick the company and at least one other company." });
  if (ids.length > 40) return res.status(400).json({ error: "That is too many companies for one group." });
  const denied = await assertAccess(req, ids); if (denied) return res.status(403).json({ error: denied });
  const existing = await query<any>(`SELECT client_id, client_name, company_contact_name FROM altax.v3_clients WHERE client_id = ANY($1::text[])`, [ids]);
  if (existing.length !== ids.length) return res.status(404).json({ error: "One of those clients was not found." });
  const me = req.user!.email;
  const requestedName = String(req.body?.groupName || "").trim().slice(0, 160);

  const groupId = await withTransaction(async (db) => {
    const cur = await db.queryOne<any>(`SELECT group_id FROM altax.v3_client_group_members WHERE client_id = $1`, [clientId]);
    let gid: string = cur?.group_id;
    if (!gid) {
      gid = `CG-${idSuffix()}`;
      const owner = existing.find((c) => c.client_id === clientId)?.company_contact_name;
      const name = requestedName || (owner ? `${String(owner).trim()} — companies` : `${existing.find((c) => c.client_id === clientId)!.client_name} group`);
      await db.query(`INSERT INTO altax.v3_client_groups (group_id, group_name, created_by) VALUES ($1,$2,$3)`, [gid, name.slice(0, 160), me]);
      await db.query(`INSERT INTO altax.v3_client_group_members (client_id, group_id, added_by) VALUES ($1,$2,$3)`, [clientId, gid, me]);
    } else if (requestedName) {
      await db.query(`UPDATE altax.v3_client_groups SET group_name = $2, updated_at = now() WHERE group_id = $1`, [gid, requestedName]);
    }
    for (const o of ids.filter((i) => i !== clientId)) {
      const og = await db.queryOne<any>(`SELECT group_id FROM altax.v3_client_group_members WHERE client_id = $1`, [o]);
      if (og && og.group_id !== gid) {
        // Merge: everyone in the other group joins this one.
        await db.query(`UPDATE altax.v3_client_group_members SET group_id = $1 WHERE group_id = $2`, [gid, og.group_id]);
        await db.query(`DELETE FROM altax.v3_client_groups WHERE group_id = $1`, [og.group_id]);
      } else if (!og) {
        await db.query(`INSERT INTO altax.v3_client_group_members (client_id, group_id, added_by) VALUES ($1,$2,$3)`, [o, gid, me]);
      }
    }
    return gid;
  });
  logAudit("Owner Groups", "CONFIRM", groupId, "members", "", ids.join(", "), `Confirmed as the same owner: ${ids.join(", ")}.`, me).catch(() => {});
  res.json({ ok: true, groupId });
}));

/** "Not related": never suggest this pair again. */
clientGroupsRouter.post("/dismiss", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const a = String(req.body?.clientId || "").trim(), b = String(req.body?.otherId || "").trim();
  if (!a || !b || a === b) return res.status(400).json({ error: "Pick two different companies." });
  const denied = await assertAccess(req, [a, b]); if (denied) return res.status(403).json({ error: denied });
  const [x, y] = pairKey(a, b);
  await query(`INSERT INTO altax.v3_client_link_dismissed (client_a, client_b, dismissed_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [x, y, req.user!.email]);
  logAudit("Owner Groups", "DISMISS", `${x}|${y}`, "pair", "", "", `Marked ${x} and ${y} as not related.`, req.user!.email).catch(() => {});
  res.json({ ok: true });
}));

clientGroupsRouter.patch("/:groupId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const name = String(req.body?.groupName || "").trim().slice(0, 160);
  if (!name) return res.status(400).json({ error: "Give the group a name." });
  const first = await queryOne<any>(`SELECT client_id FROM altax.v3_client_group_members WHERE group_id = $1 LIMIT 1`, [req.params.groupId]);
  if (!first) return res.status(404).json({ error: "Group not found." });
  const denied = await assertAccess(req, [first.client_id]); if (denied) return res.status(403).json({ error: denied });
  await query(`UPDATE altax.v3_client_groups SET group_name = $2, updated_at = now() WHERE group_id = $1`, [req.params.groupId, name]);
  res.json({ ok: true });
}));

/** Take one company out of its group; a group left with a single company is dissolved. */
clientGroupsRouter.delete("/:groupId/members/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const denied = await assertAccess(req, [req.params.clientId]); if (denied) return res.status(403).json({ error: denied });
  await query(`DELETE FROM altax.v3_client_group_members WHERE group_id = $1 AND client_id = $2`, [req.params.groupId, req.params.clientId]);
  const left = await query<any>(`SELECT client_id FROM altax.v3_client_group_members WHERE group_id = $1`, [req.params.groupId]);
  if (left.length < 2) await query(`DELETE FROM altax.v3_client_groups WHERE group_id = $1`, [req.params.groupId]);
  logAudit("Owner Groups", "REMOVE", req.params.groupId, "client", req.params.clientId, "", `Removed ${req.params.clientId} from its owner group.`, req.user!.email).catch(() => {});
  res.json({ ok: true });
}));

/** Admin review list: every confirmed group, and clusters of unconfirmed companies that look related. */
clientGroupsRouter.get("/overview", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const all = await query<ClientKeyRow>(`SELECT ${COLS} FROM altax.v3_clients ORDER BY client_name`);
  const byId = new Map(all.map((c) => [c.client_id, c]));
  const memberRows = await query<any>(`SELECT m.client_id, g.group_id, g.group_name FROM altax.v3_client_group_members m JOIN altax.v3_client_groups g ON g.group_id = m.group_id`);
  const groupOfClient = new Map<string, { groupId: string; groupName: string }>(memberRows.map((r) => [r.client_id, { groupId: r.group_id, groupName: r.group_name }]));
  const groups = new Map<string, { groupId: string; groupName: string; members: { clientId: string; clientName: string; status: string | null }[] }>();
  for (const r of memberRows) {
    const g: { groupId: string; groupName: string; members: { clientId: string; clientName: string; status: string | null }[] } = groups.get(r.group_id) || { groupId: r.group_id, groupName: r.group_name, members: [] };
    const c = byId.get(r.client_id); if (c) g.members.push({ clientId: c.client_id, clientName: c.client_name, status: c.status });
    groups.set(r.group_id, g);
  }
  // A cluster is worth reviewing unless every company in it is already in the same confirmed group.
  const found = clusters(all, await loadDismissed()).filter((cl) => {
    const gids = cl.ids.map((id) => groupOfClient.get(id)?.groupId);
    return !gids.every((g) => g && g === gids[0]);
  });
  res.json({
    groups: [...groups.values()].sort((a, b) => a.groupName.localeCompare(b.groupName)),
    suggestions: found.map((cl) => ({
      reasons: shapeReasons(cl.reasons),
      clients: cl.ids.map((id) => { const c = byId.get(id)!; return { clientId: id, clientName: c.client_name, status: c.status, ownerName: c.company_contact_name, groupName: groupOfClient.get(id)?.groupName || null }; }),
    })),
  });
}));
