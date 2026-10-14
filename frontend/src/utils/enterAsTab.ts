import type { KeyboardEvent } from "react";

/**
 * For data-entry forms: pressing Enter in a field moves to the next field instead of submitting the form.
 * (Browsers submit a form on Enter in any number or text box — which saved and cleared a half-filled Sales Input.)
 * Enter still works normally in multi-line boxes and on buttons; on the last field it moves to the Save button, so the next
 * Enter (or click) is a deliberate save.
 */
export function enterAsTab(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  const el = e.target as HTMLElement;
  if (el.tagName === "TEXTAREA" || el.tagName === "BUTTON" || el.tagName === "A") return;
  if (el.tagName !== "INPUT" && el.tagName !== "SELECT") return;
  const type = (el as HTMLInputElement).type;
  if (type === "submit" || type === "button" || type === "checkbox" || type === "radio") { if (type !== "checkbox" && type !== "radio") return; }
  e.preventDefault();
  const root = e.currentTarget;
  const fields = Array.from(root.querySelectorAll<HTMLElement>("input, select, textarea, button[type=submit]")).filter((n) => {
    const i = n as HTMLInputElement;
    return !i.disabled && i.type !== "hidden" && i.tabIndex !== -1 && n.offsetParent !== null;
  });
  const next = fields[fields.indexOf(el) + 1];
  if (next) { next.focus(); if (next instanceof HTMLInputElement && next.type !== "checkbox" && next.type !== "radio") next.select?.(); }
}
