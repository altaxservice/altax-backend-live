import { api } from "../api/client";

/**
 * System-wide "remember what I typed" suggestions (direct owner ask, 2026-08-29):
 * type a value into a free-text field, and next time that same field is
 * encountered anywhere in the app, previously-used values show up as a native
 * browser suggestion dropdown. Same "no shared Input component here to retrofit,
 * so sweep the whole DOM once at startup and keep up via a MutationObserver"
 * approach as enforceSpellcheck.ts — see that file for why.
 *
 * Deliberately does NOT cover <textarea> — partly because <textarea> doesn't
 * support the `list`/<datalist> attribute at all, and partly because every
 * narrative Notes/Resolution/Comment field in this app (the ones that can hold
 * client-specific, sometimes confidential commentary) happens to already be a
 * <textarea>. Suggestions here are pooled firm-wide across all staff by field
 * label — appropriate for short, reused operational vocabulary (agency names,
 * notice types, a billing line's Description) but NOT for personal narrative
 * about one specific client, so the one narrative-labeled <input> found in this
 * app (a client Activity Timeline "Note" field) is excluded by label keyword
 * below rather than by type alone.
 *
 * Security: this app stores real client SSNs, EINs, and bank account/routing
 * numbers as plain text inputs in several places. Layered defense, each
 * independent of the others:
 *   1. type="password" / autoComplete="off"|"new-password" / data-no-suggest
 *      (fields already or newly marked sensitive)
 *   2. a broad keyword blocklist against the field's label/placeholder/id/name
 *   3. hand-curated data-no-suggest on the specific known SSN/EIN/bank/card
 *      fields that don't reliably match keywords (see ClientDetailPage.tsx,
 *      GenerateW4Modal.tsx, GenerateW9Modal.tsx, GenerateGovFormModal.tsx,
 *      EmployeeDetailPage.tsx)
 *   4. the backend independently rejects any value that's a 4-17 digit run
 *      (SSN/EIN/routing/account shape) regardless of which field it came from
 *
 * Also staff/admin only — this app's client and employee portals share the
 * same login system, and requireAuth alone (unlike requireRole) does not mean
 * staff. The role is re-read fresh before every network call rather than
 * cached, so a same-tab logout -> different-role login can't leave this
 * running under a stale permission.
 */

const FIELD_SELECTOR = 'input:not([type]), input[type="text"]';

const SENSITIVE_KEYWORDS = [
  "ssn", "social security", "ein", "tax id", "itin", "account number", "routing",
  "card number", "cvv", "cvc", "password", "secret", "api key", "token", "pin",
  "bank", "totp", "authenticator", "verification code", "recovery code", "2fa", "mfa",
  "swift", "iban",
];

// Fields holding personal/situational commentary about one specific client —
// pooling these firm-wide by label would leak that commentary across clients.
// Deliberately NOT "description" or "memo": every field in this app labeled
// that way (invoice/estimate/journal-entry line items, time entries) is
// reusable billing/operational vocabulary, not personal narrative — checked
// against every such label in the codebase before excluding, rather than
// guessing.
const NARRATIVE_KEYWORDS = ["note", "notes", "resolution", "comment", "comments"];

function currentRole(): string | null {
  try {
    const raw = sessionStorage.getItem("altax_user") || localStorage.getItem("altax_user");
    if (!raw) return null;
    return JSON.parse(raw)?.role || null;
  } catch {
    return null;
  }
}

function isStaffSession(): boolean {
  const role = currentRole();
  return role === "admin" || role === "staff";
}

function textFor(el: HTMLInputElement): string {
  const parts: string[] = [];
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent) parts.push(label.textContent);
  }
  const wrappingLabel = el.closest("label");
  if (wrappingLabel?.textContent) parts.push(wrappingLabel.textContent);
  if (el.placeholder) parts.push(el.placeholder);
  if (el.id) parts.push(el.id);
  if (el.name) parts.push(el.name);
  return parts.join(" ").toLowerCase();
}

function isExcluded(el: HTMLInputElement): boolean {
  if (el.type === "password") return true;
  const autoComplete = (el.autocomplete || el.getAttribute("autocomplete") || "").toLowerCase();
  if (autoComplete === "off" || autoComplete === "new-password") return true;
  if (el.hasAttribute("data-no-suggest")) return true;
  const text = textFor(el);
  if (SENSITIVE_KEYWORDS.some((k) => text.includes(k))) return true;
  if (NARRATIVE_KEYWORDS.some((k) => text.includes(k))) return true;
  return false;
}

/** Associated <label> text if present; otherwise, for a table-cell input with
 * no label (e.g. a repeating line-item row), the matching column's <th> text
 * via the input's real DOM column index — skipped if that table's header row
 * uses colSpan, rather than guess a possibly-wrong column. Falls back to
 * placeholder. Returns null (no confident key) rather than guess further. */
function deriveFieldKey(el: HTMLInputElement): string | null {
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const labelText = label?.textContent?.trim();
    if (labelText) return labelText;
  }
  const wrappingLabel = el.closest("label");
  const wrappingText = wrappingLabel?.textContent?.trim();
  if (wrappingText) return wrappingText;

  const td = el.closest("td");
  if (td) {
    const table = td.closest("table");
    const headerRow = table?.querySelector("thead tr") || table?.querySelector("tr");
    if (headerRow) {
      const headers = Array.from(headerRow.querySelectorAll("th"));
      const hasColSpan = headers.some((th) => th.colSpan > 1);
      if (!hasColSpan) {
        const th = headers[td.cellIndex];
        const thText = th?.textContent?.trim();
        if (thText) return thText;
      }
    }
  }

  if (el.placeholder?.trim()) return el.placeholder.trim();
  return null;
}

const suggestionCache = new Map<string, string[] | Promise<string[]>>();

async function suggestionsFor(fieldKey: string): Promise<string[]> {
  const cached = suggestionCache.get(fieldKey);
  if (cached) return cached;
  const promise = api
    .get<{ values: string[] }>(`/field-suggestions?fieldKey=${encodeURIComponent(fieldKey)}`)
    .then((r) => r.values)
    .catch(() => [] as string[]);
  suggestionCache.set(fieldKey, promise);
  const values = await promise;
  suggestionCache.set(fieldKey, values);
  return values;
}

let datalistCounter = 0;

async function attach(el: HTMLInputElement, fieldKey: string) {
  const values = await suggestionsFor(fieldKey);
  if (!values.length) return;
  // Re-check on every reuse — the same key can attach to a datalist a second
  // element already created (e.g. two "Agency" fields on different pages).
  let datalistId = el.getAttribute("data-suggest-list");
  if (!datalistId) {
    datalistId = `field-suggest-${datalistCounter++}`;
    const datalist = document.createElement("datalist");
    datalist.id = datalistId;
    for (const v of values) {
      const option = document.createElement("option");
      option.value = v;
      datalist.appendChild(option);
    }
    document.body.appendChild(datalist);
    el.setAttribute("list", datalistId);
    el.setAttribute("data-suggest-list", datalistId);
  }
}

function recordValue(fieldKey: string, value: string) {
  if (!isStaffSession()) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  api.post("/field-suggestions", { fieldKey, value: trimmed }).catch(() => {});
}

function process(el: Element) {
  if (!(el instanceof HTMLInputElement)) return;
  if (el.dataset.suggestBound) return;
  // Not gated at install time (see installFieldSuggestions — the app boots
  // before any login has happened, so a one-time check there would never see
  // a staff session). Checked here instead, at the moment a field is actually
  // encountered — in practice a login/logout always navigates to a different
  // page, so the newly-mounted DOM is freshly re-swept under the new role.
  if (!isStaffSession()) return;
  if (isExcluded(el)) return;
  const fieldKey = deriveFieldKey(el);
  if (!fieldKey) return;

  el.dataset.suggestBound = "1";
  attach(el, fieldKey);
  el.addEventListener("blur", () => recordValue(fieldKey, el.value));
}

export function installFieldSuggestions() {
  document.querySelectorAll(FIELD_SELECTOR).forEach(process);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches(FIELD_SELECTOR)) process(node);
        node.querySelectorAll(FIELD_SELECTOR).forEach(process);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
