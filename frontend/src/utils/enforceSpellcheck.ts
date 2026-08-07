/**
 * Forces browser-native spellcheck/autocorrect on every free-text field in
 * the app, instead of relying on each browser's own default (which the user
 * reported not seeing in practice). There's no shared Input/Textarea
 * component here to retrofit — every field across 80+ files is a raw
 * <input>/<textarea> — so this runs once at startup and keeps up with the
 * whole app via a MutationObserver rather than requiring every future form
 * to remember the attribute.
 *
 * Scoped to genuinely free-text fields only (plain <textarea> and
 * <input type="text"> / no-type inputs) — SSN, EIN, dates, emails, numbers,
 * etc. are left alone, since autocorrect on an ID number would actively
 * corrupt it.
 */
const FREE_TEXT_SELECTOR = 'textarea, input:not([type]), input[type="text"]';

function apply(el: Element) {
  if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) return;
  if (el.getAttribute("spellcheck") !== "true") el.setAttribute("spellcheck", "true");
  // Non-standard but respected by Safari/iOS, which ignores plain `spellcheck`.
  if (!el.hasAttribute("autocorrect")) el.setAttribute("autocorrect", "on");
}

export function installSpellcheckEnforcement() {
  document.querySelectorAll(FREE_TEXT_SELECTOR).forEach(apply);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches(FREE_TEXT_SELECTOR)) apply(node);
        node.querySelectorAll(FREE_TEXT_SELECTOR).forEach(apply);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
