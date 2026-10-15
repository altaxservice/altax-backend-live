/**
 * Finds companies that probably belong to the same owner, from what the firm already has on file: the owner's phone, email and name, and
 * the company's own phone and email. This is a SUGGESTION engine — a phone number shared by several companies may be a family or office
 * line, so staff confirm or dismiss each suggestion (see clientGroups.routes.ts). Pure functions here; the routes load the rows.
 */
export interface ClientKeyRow {
  client_id: string;
  client_name: string;
  status: string | null;
  phone: string | null;
  email: string | null;
  company_contact_name: string | null;
  company_contact_phone: string | null;
  company_contact_email: string | null;
}

export type ReasonKind = "owner phone" | "owner email" | "owner name" | "company phone" | "company email" | "owner phone is company phone" | "owner email is company email" | "owner is this client";
export interface Reason { kind: ReasonKind; value: string; weight: number }

export function normPhone(raw: unknown): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? ten : "";
}
export function normEmail(raw: unknown): string {
  const e = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
}
/** Lower-case words only; needs at least two words (a lone first name is not an identity) and 5+ letters. */
export function normName(raw: unknown): string {
  const n = String(raw ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  return n.split(" ").length >= 2 && n.replace(/ /g, "").length >= 5 ? n : "";
}

interface Keys { phone: string; email: string; ownerPhone: string; ownerEmail: string; ownerName: string; name: string }
export function keysOf(c: ClientKeyRow): Keys {
  return {
    phone: normPhone(c.phone), email: normEmail(c.email),
    ownerPhone: normPhone(c.company_contact_phone), ownerEmail: normEmail(c.company_contact_email), ownerName: normName(c.company_contact_name),
    name: normName(c.client_name),
  };
}

const eq = (a: string, b: string) => Boolean(a) && a === b;

/** Why two clients look related. Owner-to-owner matches are strongest; weight 3 = strong, 2 = medium. */
export function compare(a: ClientKeyRow, b: ClientKeyRow): Reason[] {
  const x = keysOf(a), y = keysOf(b);
  const r: Reason[] = [];
  if (eq(x.ownerPhone, y.ownerPhone)) r.push({ kind: "owner phone", value: x.ownerPhone, weight: 3 });
  if (eq(x.ownerEmail, y.ownerEmail)) r.push({ kind: "owner email", value: x.ownerEmail, weight: 3 });
  if (eq(x.ownerName, y.ownerName)) r.push({ kind: "owner name", value: x.ownerName, weight: 3 });
  if (eq(x.phone, y.phone)) r.push({ kind: "company phone", value: x.phone, weight: 2 });
  if (eq(x.email, y.email)) r.push({ kind: "company email", value: x.email, weight: 2 });
  if (!eq(x.ownerPhone, y.ownerPhone) && (eq(x.ownerPhone, y.phone) || eq(x.phone, y.ownerPhone))) r.push({ kind: "owner phone is company phone", value: eq(x.ownerPhone, y.phone) ? x.ownerPhone : x.phone, weight: 2 });
  if (!eq(x.ownerEmail, y.ownerEmail) && (eq(x.ownerEmail, y.email) || eq(x.email, y.ownerEmail))) r.push({ kind: "owner email is company email", value: eq(x.ownerEmail, y.email) ? x.ownerEmail : x.email, weight: 2 });
  // An individual who is a client under his own name (e.g. a personal return) and is the owner of the other company.
  if (eq(x.name, y.ownerName) || eq(y.name, x.ownerName)) r.push({ kind: "owner is this client", value: eq(x.name, y.ownerName) ? x.name : y.name, weight: 3 });
  return r;
}

export const pairKey = (a: string, b: string) => (a < b ? [a, b] : [b, a]) as [string, string];

/** Everyone in `all` related to `target` (excluding dismissed pairs), strongest first. */
export function relatedTo(target: ClientKeyRow, all: ClientKeyRow[], dismissed: Set<string>): { client: ClientKeyRow; reasons: Reason[]; score: number }[] {
  const out: { client: ClientKeyRow; reasons: Reason[]; score: number }[] = [];
  for (const c of all) {
    if (c.client_id === target.client_id) continue;
    if (dismissed.has(pairKey(target.client_id, c.client_id).join("|"))) continue;
    const reasons = compare(target, c);
    if (!reasons.length) continue;
    out.push({ client: c, reasons, score: reasons.reduce((s, r) => s + r.weight, 0) });
  }
  return out.sort((p, q) => q.score - p.score || p.client.client_name.localeCompare(q.client.client_name));
}

/** Connected clusters of related clients (for the firm-wide review list). */
export function clusters(all: ClientKeyRow[], dismissed: Set<string>): { ids: string[]; reasons: Reason[] }[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  for (const c of all) parent.set(c.client_id, c.client_id);
  const pairReasons = new Map<string, Reason[]>();
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (dismissed.has(pairKey(all[i].client_id, all[j].client_id).join("|"))) continue;
      const reasons = compare(all[i], all[j]);
      if (!reasons.length) continue;
      parent.set(find(all[i].client_id), find(all[j].client_id));
      pairReasons.set(`${all[i].client_id}|${all[j].client_id}`, reasons);
    }
  }
  const byRoot = new Map<string, string[]>();
  for (const c of all) { const r = find(c.client_id); byRoot.set(r, [...(byRoot.get(r) || []), c.client_id]); }
  const result: { ids: string[]; reasons: Reason[] }[] = [];
  for (const ids of byRoot.values()) {
    if (ids.length < 2) continue;
    const set = new Set(ids);
    const seen = new Map<string, Reason>();
    for (const [k, rs] of pairReasons) { const [a, b] = k.split("|"); if (set.has(a) && set.has(b)) for (const r of rs) seen.set(`${r.kind}:${r.value}`, r); }
    result.push({ ids, reasons: [...seen.values()].sort((p, q) => q.weight - p.weight).slice(0, 6) });
  }
  return result.sort((p, q) => q.ids.length - p.ids.length);
}
