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
 * admin = every client. client/employee = only their own assigned client (matches
 * legacy's explicit branches for those two roles). staff/general = only clients they
 * have at least one task assigned to them for — legacy derives this by running the
 * full per-role portal data filter and checking membership in the resulting client
 * list; querying task assignments directly is a narrower, safe subset of that same
 * rule (the same simplification already used for task-list scoping).
 */
export async function canAccessClient(
  user: { role: string; clientId?: string; email: string },
  clientId: string
): Promise<boolean> {
  if (user.role === "admin") return true;
  if (user.role === "client" || user.role === "employee") return user.clientId === clientId;

  const aliases = await getUserAliases(user.email);
  const rows = await query(
    `SELECT 1 FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]) AND client_id = $2 LIMIT 1`,
    [Array.from(aliases), clientId]
  );
  return rows.length > 0;
}
