import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

export interface PendingDraft<T> {
  data: T;
  updatedAt: string;
}

/**
 * Server-side autosave for a form's in-progress state, keyed by `formKey`.
 * Pass null to disable (e.g. before an id the key depends on has loaded).
 *
 * On mount it checks for an existing draft and hands it back as
 * `pendingDraft` for the caller to offer a "Restore / Discard" choice — it
 * is NEVER applied automatically. Silently overwriting whatever the form
 * would otherwise show (a freshly opened blank form, or a record that's
 * since changed) would trade one data-loss bug for a worse one.
 *
 * saveDraft() is debounced — call it from a useEffect that watches the
 * form's live state. clearDraft() removes the saved draft; call it on
 * successful submit only, not on Cancel/Close — keeping the draft after an
 * accidental close is the entire point of this hook.
 */
export function useFormDraft<T>(formKey: string | null) {
  const [pendingDraft, setPendingDraft] = useState<PendingDraft<T> | null>(null);
  const [draftChecked, setDraftChecked] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef(formKey);
  keyRef.current = formKey;

  useEffect(() => {
    setPendingDraft(null);
    setDraftChecked(false);
    if (!formKey) { setDraftChecked(true); return; }
    let cancelled = false;
    api.get<{ draft: PendingDraft<T> | null }>(`/form-drafts/${encodeURIComponent(formKey)}`)
      .then((res) => { if (!cancelled) setPendingDraft(res.draft); })
      .catch(() => { /* no draft, or offline — fail silent, the form still works */ })
      .finally(() => { if (!cancelled) setDraftChecked(true); });
    return () => { cancelled = true; };
  }, [formKey]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const saveDraft = useCallback((data: T) => {
    const key = keyRef.current;
    if (!key) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.put(`/form-drafts/${encodeURIComponent(key)}`, { data }).catch(() => {});
    }, 1200);
  }, []);

  const clearDraft = useCallback(() => {
    const key = keyRef.current;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (!key) return;
    api.post(`/form-drafts/${encodeURIComponent(key)}/discard`).catch(() => {});
  }, []);

  const dismissPendingDraft = useCallback(() => setPendingDraft(null), []);

  return { pendingDraft, draftChecked, saveDraft, clearDraft, dismissPendingDraft };
}
