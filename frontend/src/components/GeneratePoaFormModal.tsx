import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import type { PoaRepresentative, PoaRepresentativeOption, PoaTaxMatter } from "../api/poaForms";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useFormDraft } from "../hooks/useFormDraft";
import { DraftRestoreBanner } from "../components/DraftRestoreBanner";

interface Meta {
  formTypes: { value: string; label: string }[];
  designations: Record<string, string[]>;
  suggestedFormsForService: Record<string, string[]>;
}

const EMPTY_MATTER: PoaTaxMatter = { description: "", taxForm: "", years: "" };

/**
 * Builds one Form 2848 / 8821 / 548 for a client. Picking a representative
 * from the dropdown auto-fills their name/PTIN/CAF/phone/email from what
 * they entered themselves under Preparer Info (account menu) or Users &
 * Access — nobody has to retype credentials that already live on their
 * account. Address, designation, jurisdiction, and license number are
 * per-filing (the same person can be "Unenrolled Return Preparer" on a
 * federal form and "Maryland Registered Individual Tax Preparer" on 548),
 * so those stay editable per row.
 */
export function GeneratePoaFormModal({ clientId, defaultFormType, editingFiling, onClose, onDone }: {
  clientId: string;
  defaultFormType?: string;
  /** Pass an existing Draft filing to edit it in place (PATCH) instead of creating a new one — form type is then locked to whatever the filing already is, same reasoning as GenerateGovFormModal's editingFiling. */
  editingFiling?: { filing_id: string; form_type: string; representatives: PoaRepresentative[]; tax_matters: PoaTaxMatter[]; retain_prior: boolean; notes: string | null };
  onClose: () => void;
  onDone: () => void;
}) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const isEditing = !!editingFiling;
  const [meta, setMeta] = useState<Meta | null>(null);
  const [repOptions, setRepOptions] = useState<PoaRepresentativeOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formType, setFormType] = useState(editingFiling?.form_type || defaultFormType || "2848");
  const [reps, setReps] = useState<PoaRepresentative[]>(editingFiling?.representatives || []);
  const [matters, setMatters] = useState<PoaTaxMatter[]>(
    editingFiling?.tax_matters?.length ? editingFiling.tax_matters : [{ ...EMPTY_MATTER }]
  );
  const [retainPrior, setRetainPrior] = useState(editingFiling?.retain_prior || false);
  const [notes, setNotes] = useState(editingFiling?.notes || "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Meta>("/poa-forms/meta"),
      api.get<{ representatives: PoaRepresentativeOption[] }>("/poa-forms/representatives"),
    ])
      .then(([m, r]) => { setMeta(m); setRepOptions(r.representatives); })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Could not load form options."));
  }, []);

  // Autosave — see GenerateGovFormModal's matching comment for the full
  // reasoning (same pattern: one draft slot per client+form-type when
  // creating, one slot per filing when editing).
  const draftFormKey = isEditing ? `poa-form-edit:${editingFiling!.filing_id}` : `poa-form:${clientId}:${formType}`;
  const { pendingDraft, draftChecked, saveDraft, clearDraft, dismissPendingDraft } = useFormDraft<{
    formType: string; reps: PoaRepresentative[]; matters: PoaTaxMatter[]; retainPrior: boolean; notes: string;
  }>(draftFormKey);

  function restoreDraft() {
    if (!pendingDraft) return;
    const d = pendingDraft.data;
    setFormType(d.formType);
    setReps(d.reps);
    setMatters(d.matters);
    setRetainPrior(d.retainPrior);
    setNotes(d.notes);
    dismissPendingDraft();
  }

  useEffect(() => {
    if (!draftChecked || pendingDraft) return;
    saveDraft({ formType, reps, matters, retainPrior, notes });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftChecked, pendingDraft, formType, reps, matters, retainPrior, notes]);

  const maxReps = formType === "548" || formType === "8821" ? 2 : 4;
  const maxMatters = 3;
  const designationOptions = meta?.designations[formType] || [];

  function addRepFromOption(userId: string) {
    if (!userId || !repOptions) return;
    const opt = repOptions.find((r) => r.user_id === userId);
    if (!opt) return;
    setReps((prev) => [...prev, {
      name: opt.name, address: "", ptin: opt.ptin || "", cafNumber: opt.caf_number || "",
      phone: opt.phone || "", email: opt.email || "", sendCopies: prev.length === 0,
      designation: "", jurisdiction: "Maryland", licenseNumber: opt.ptin || "",
    }]);
  }

  function patchRep(i: number, patch: Partial<PoaRepresentative>) {
    setReps((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function removeRep(i: number) {
    setReps((prev) => prev.filter((_, j) => j !== i));
  }

  function patchMatter(i: number, patch: Partial<PoaTaxMatter>) {
    setMatters((prev) => prev.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reps.length) { setSaveError("Add at least one representative."); return; }
    if (formType !== "8821" && reps.some((r) => !r.designation)) {
      setSaveError("Choose a designation for every representative — required for the Declaration of Representative section.");
      return;
    }
    const cleanMatters = matters.filter((m) => m.description.trim());
    if (!cleanMatters.length) { setSaveError("Add at least one tax matter."); return; }

    setSaving(true);
    setSaveError(null);
    try {
      if (isEditing) {
        await api.patch(`/poa-forms/${editingFiling!.filing_id}`, {
          representatives: reps, taxMatters: cleanMatters, retainPrior, notes: notes.trim() || undefined,
        });
      } else {
        await api.post(`/poa-forms/client/${clientId}`, {
          formType, representatives: reps, taxMatters: cleanMatters, retainPrior, notes: notes.trim() || undefined,
        });
      }
      clearDraft();
      onDone();
      onClose();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : `Could not ${isEditing ? "save" : "create"} this filing.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="generate-poa-form-title" style={{ maxWidth: 680, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="generate-poa-form-title">{isEditing ? "Edit Draft Authorization Form" : "Generate Authorization Form"}</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>

        {loadError && <ErrorBanner error={loadError} />}
        {!meta || !repOptions ? (
          <p className="muted">Loading…</p>
        ) : (
          <form onSubmit={handleSubmit}>
            {pendingDraft && (
              <DraftRestoreBanner updatedAt={pendingDraft.updatedAt} onRestore={restoreDraft} onDiscard={() => { clearDraft(); dismissPendingDraft(); }} />
            )}
            {saveError && <ErrorBanner error={saveError} />}

            <div className="field">
              <label htmlFor="pf-type">Form</label>
              <select id="pf-type" value={formType} disabled={isEditing} onChange={(e) => { setFormType(e.target.value); setReps([]); }}>
                {meta.formTypes.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              {isEditing && <p className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Form type can't be changed on an existing draft — delete it and generate a new one instead.</p>}
              <p className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                {formType === "8821" && "Info only — lets a representative view/receive tax information, no authority to act or represent."}
                {formType === "2848" && "Full representation before the IRS — the representative can act and speak on the client's behalf."}
                {formType === "548" && "Maryland Comptroller equivalent — for state tax matters (sales & use, MD income tax, etc.)."}
              </p>
            </div>

            <div className="field">
              <label htmlFor="pf-add-rep">Representative(s) <span className="muted">(up to {maxReps})</span></label>
              {reps.length < maxReps && (
                <select id="pf-add-rep" value="" onChange={(e) => addRepFromOption(e.target.value)}>
                  <option value="">+ Add a representative…</option>
                  {repOptions.map((r) => (
                    <option key={r.user_id} value={r.user_id}>
                      {r.name}{!r.ptin ? " — no PTIN on file" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {reps.map((rep, i) => (
              <div key={i} className="card" style={{ marginBottom: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong style={{ fontSize: 13 }}>{rep.name}</strong>
                  <button type="button" className="link-button" style={{ color: "var(--red)" }} onClick={() => removeRep(i)}>Remove</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor={`pf-rep-address-${i}`}>Address</label>
                    <input id={`pf-rep-address-${i}`} required value={rep.address} onChange={(e) => patchRep(i, { address: e.target.value })} placeholder="Street, City, State ZIP" />
                  </div>
                  {formType !== "8821" && (
                    <div className="field" style={{ margin: 0 }}>
                      <label htmlFor={`pf-rep-designation-${i}`}>Designation</label>
                      <select id={`pf-rep-designation-${i}`} required value={rep.designation} onChange={(e) => patchRep(i, { designation: e.target.value })}>
                        <option value="">Select…</option>
                        {designationOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  )}
                  {formType !== "8821" && (
                    <>
                      <div className="field" style={{ margin: 0 }}>
                        <label htmlFor={`pf-rep-jurisdiction-${i}`}>Jurisdiction</label>
                        <input id={`pf-rep-jurisdiction-${i}`} value={rep.jurisdiction} onChange={(e) => patchRep(i, { jurisdiction: e.target.value })} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label htmlFor={`pf-rep-license-number-${i}`}>License / Bar / PTIN Number</label>
                        <input id={`pf-rep-license-number-${i}`} value={rep.licenseNumber} onChange={(e) => patchRep(i, { licenseNumber: e.target.value })} />
                      </div>
                    </>
                  )}
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor={`pf-rep-ptin-${i}`}>PTIN</label>
                    <input id={`pf-rep-ptin-${i}`} value={rep.ptin} onChange={(e) => patchRep(i, { ptin: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor={`pf-rep-caf-number-${i}`}>CAF Number</label>
                    <input id={`pf-rep-caf-number-${i}`} value={rep.cafNumber} onChange={(e) => patchRep(i, { cafNumber: e.target.value })} placeholder="Leave blank if none yet" />
                  </div>
                </div>
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginTop: 8 }}>
                  <input type="checkbox" checked={Boolean(rep.sendCopies)} onChange={(e) => patchRep(i, { sendCopies: e.target.checked })} />
                  Send this representative copies of notices
                </label>
              </div>
            ))}

            <div className="field">
              <label>Tax Matters</label>
              {matters.map((m, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1.3fr 0.8fr 0.8fr", gap: 6, marginBottom: 6 }}>
                  <input placeholder="Type of tax (e.g. Income Tax)" value={m.description} onChange={(e) => patchMatter(i, { description: e.target.value })} />
                  <input placeholder="Form # (1040, 941…)" value={m.taxForm} onChange={(e) => patchMatter(i, { taxForm: e.target.value })} />
                  <input placeholder="Year(s)" value={m.years} onChange={(e) => patchMatter(i, { years: e.target.value })} />
                </div>
              ))}
              {matters.length < maxMatters && (
                <button type="button" className="btn btn-sm" onClick={() => setMatters((prev) => [...prev, { ...EMPTY_MATTER }])}>+ Add Row</button>
              )}
            </div>

            <div className="field">
              <label htmlFor="pf-notes">Additional acts / notes <span className="muted">(optional)</span></label>
              <textarea id="pf-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, margin: "4px 0 12px" }}>
              <input type="checkbox" checked={retainPrior} onChange={(e) => setRetainPrior(e.target.checked)} />
              Keep an earlier authorization in effect <span className="muted">(default: this replaces any prior one on file)</span>
            </label>

            <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
              This form must be signed by hand — {formType === "548" ? "Maryland has no online submission" : "an electronic signature is only valid if submitted through the IRS's own online portal"}.
              Preview, print, and get a wet signature; the app tracks when it's signed and how it was actually sent.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? (isEditing ? "Saving…" : "Generating…") : (isEditing ? "Save Changes" : "Generate")}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
