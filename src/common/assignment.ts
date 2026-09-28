import { query } from "../config/db";

/** Mirrors alTaxV3NormalizeText_: trim + lowercase. */
export function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Mirrors alTaxV3UserAliases_: the set of identity strings a task/record's AssignedTo
 * field may match for a given user — their email, plus name/userId from every v3_Users
 * row sharing that email (a person can have more than one portal-role row).
 */
export async function getUserAliases(email: string): Promise<Set<string>> {
  const aliases = new Set<string>();
  const normalizedEmail = normalizeText(email);
  if (normalizedEmail) aliases.add(normalizedEmail);

  const rows = await query<{ email: string; name: string; user_id: string }>(
    `SELECT email, name, user_id FROM altax.v3_users WHERE lower(email) = $1`,
    [normalizedEmail]
  );
  for (const row of rows) {
    for (const value of [row.email, row.name, row.user_id]) {
      const text = normalizeText(value);
      if (text) aliases.add(text);
    }
  }
  return aliases;
}

/** Mirrors alTaxV3AssignedToUser_: does record.assigned_to match one of the user's aliases? */
export function isAssignedToUser(assignedTo: unknown, aliases: Set<string>): boolean {
  const assigned = normalizeText(assignedTo);
  return !!assigned && aliases.has(assigned);
}

/**
 * Mirrors alTaxV3PortalClientAllowed_: does this user have access to this client?
 * admin = every client. employee = only their own assigned client (single-client,
 * unaffected by multi-business). client = any business linked via v3_user_clients
 * (sql/164_client_multi_business_links.sql) — a login can be linked to several
 * businesses and switch between them; assigned_client_id/clientId is only the
 * default business selected at login, not the full access boundary. staff/general
 * = only clients they have at least one task assigned to them for — legacy derives
 * this by running the full per-role portal data filter and checking membership in
 * the resulting client list; querying task assignments directly is a narrower, safe
 * subset of that same rule (the same simplification already used for task-list
 * scoping).
 */
export async function canAccessClient(
  user: { role: string; clientId?: string; email: string; sub?: string },
  clientId: string
): Promise<boolean> {
  if (user.role === "admin") return true;
  if (user.role === "employee") return user.clientId === clientId;
  if (user.role === "client") {
    if (!user.sub) return false;
    const rows = await query(
      `SELECT 1 FROM altax.v3_user_clients WHERE user_id = $1 AND client_id = $2 LIMIT 1`,
      [user.sub, clientId]
    );
    return rows.length > 0;
  }

  const aliases = await getUserAliases(user.email);
  const rows = await query(
    `SELECT 1 FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]) AND client_id = $2 LIMIT 1`,
    [Array.from(aliases), clientId]
  );
  return rows.length > 0;
}

/**
 * Resolves which business a request is scoped to now that a client login can be
 * linked to several (v3_user_clients). Prefers an explicitly requested clientId
 * (the frontend's active-business selection, sent per-request the same way staff
 * already sends their selected client — never trusted from the JWT), falling back
 * to the login's default business (user.clientId) when the caller didn't specify
 * one, so an older cached frontend build that never sends clientId keeps working
 * unchanged. Returns null when there's no usable clientId at all, or when the
 * resolved one fails canAccessClient — callers treat null exactly like "no access."
 */
export async function resolveActiveClientId(
  user: { role: string; clientId?: string; email: string; sub?: string },
  requestedClientId?: unknown
): Promise<string | null> {
  const requested = String(requestedClientId ?? "").trim();
  const clientId = requested || user.clientId || "";
  if (!clientId) return null;
  return (await canAccessClient(user, clientId)) ? clientId : null;
}
