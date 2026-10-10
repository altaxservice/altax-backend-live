import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthContext";
import { useSelectedBusiness } from "../context/SelectedBusinessContext";

interface BusinessIntake {
  typicalCustomer: string; serviceArea: string;
  topCompetitors: string; competitiveEdge: string;
  customerAcquisition: string; currentMarketing: string;
  staffingLevel: string; staffingChallenges: string;
  topGoal: string; expansionPlans: string;
  dailyChallenge: string; financialConcerns: string;
  updatedBy: string | null; updatedAt: string | null;
}

const EMPTY_INTAKE: BusinessIntake = {
  typicalCustomer: "", serviceArea: "", topCompetitors: "", competitiveEdge: "",
  customerAcquisition: "", currentMarketing: "", staffingLevel: "", staffingChallenges: "",
  topGoal: "", expansionPlans: "", dailyChallenge: "", financialConcerns: "",
  updatedBy: null, updatedAt: null,
};

/** Same 12 questions/6 categories as staff's Business Intake card on the SWOT
 * Analysis tab — kept in sync by hand since this is a client-facing subset,
 * not a shared import (this page lives in the client bundle, ClientSwotSection
 * does not). */
const INTAKE_CATEGORIES: { title: string; questions: { key: keyof BusinessIntake; label: string }[] }[] = [
  { title: "Target Market & Customers", questions: [
    { key: "typicalCustomer", label: "Who is your typical customer? (age, income level, what they need)" },
    { key: "serviceArea", label: "What's your primary service area or neighborhood?" },
  ] },
  { title: "Competitive Position", questions: [
    { key: "topCompetitors", label: "Who are your top 1–2 competitors, and what do they do better or worse than you?" },
    { key: "competitiveEdge", label: "What makes a customer choose you over them?" },
  ] },
  { title: "Marketing & Customer Acquisition", questions: [
    { key: "customerAcquisition", label: "How do most new customers currently find you? (walk-in, referral, online, signage)" },
    { key: "currentMarketing", label: "Do you currently do any marketing (social media, flyers, promotions)? What's worked or not?" },
  ] },
  { title: "Staffing & Operations", questions: [
    { key: "staffingLevel", label: "How many employees do you have, and is that enough for current demand?" },
    { key: "staffingChallenges", label: "Is hiring, turnover, or workload capacity a challenge right now?" },
  ] },
  { title: "Business Goals", questions: [
    { key: "topGoal", label: "What's the #1 goal for this business over the next 12 months?" },
    { key: "expansionPlans", label: "Are you considering a new location, product/service line, or major purchase?" },
  ] },
  { title: "Known Challenges & Risks", questions: [
    { key: "dailyChallenge", label: "What's the biggest day-to-day headache in running this business right now?" },
    { key: "financialConcerns", label: "Anything financial or regulatory keeping you up at night? (lease renewal, new law, supplier change)" },
  ] },
];

export function MyBusinessPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { clientId: businessId } = useSelectedBusiness();
  const clientId = businessId || user?.clientId || "";
  const [intake, setIntake] = useState<BusinessIntake | null>(null);
  const [form, setForm] = useState<BusinessIntake>(EMPTY_INTAKE);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    if (!clientId) return;
    api.get<{ intake: BusinessIntake }>(`/clients/${clientId}/business-intake`)
      .then((res) => { setIntake(res.intake); setForm({ ...EMPTY_INTAKE, ...res.intake }); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your business profile."));
  }
  useEffect(load, [clientId]);

  function set(key: keyof BusinessIntake, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await api.patch(`/clients/${clientId}/business-intake`, form);
      toast("Saved. Your accountant will review your answers.");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your business profile.");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorBanner error={error} />;

  const allQs = INTAKE_CATEGORIES.flatMap((c) => c.questions);
  const answered = allQs.filter((q) => String(form[q.key] || "").trim()).length;
  const pct = Math.round((answered / allQs.length) * 100);
  const dirty = !!intake && allQs.some((q) => String(form[q.key] || "") !== String((intake as any)[q.key] || ""));

  return (
    <div>
      <div className="cc-hero">
        <div>
          <div className="cc-date" style={{ marginBottom: 2 }}>My Business</div>
          <h1 className="cc-hello" style={{ fontSize: 24 }}>Tell us about your business</h1>
          <div className="cc-date" style={{ maxWidth: 640 }}>
            These answers help your accountant tailor tax, staffing, marketing, and growth advice to your actual business — not generic tips. Nothing here is shared outside your firm relationship.
          </div>
        </div>
        <div className="cc-chips">
          <span className={`cc-chip ${answered === allQs.length ? "green" : "amber"}`}>{answered} of {allQs.length} answered</span>
          {intake?.updatedAt && <span className="cc-chip">Updated {new Date(intake.updatedAt).toLocaleDateString()}{intake.updatedBy ? ` · ${intake.updatedBy}` : ""}</span>}
        </div>
      </div>

      {!intake ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="mb-progress" aria-label={`${pct}% complete`}><span style={{ width: `${pct}%` }} /></div>
          <div className="mb-grid">
            {INTAKE_CATEGORIES.map((cat) => {
              const done = cat.questions.filter((q) => String(form[q.key] || "").trim()).length;
              return (
                <section className="mb-card" key={cat.title}>
                  <header>
                    <h2>{cat.title}</h2>
                    <span className={`mb-pill ${done === cat.questions.length ? "done" : ""}`}>{done}/{cat.questions.length}</span>
                  </header>
                  {cat.questions.map((q) => (
                    <div className="field" key={q.key}>
                      <label htmlFor={`mb-${q.key}`}>{q.label}</label>
                      <textarea id={`mb-${q.key}`} rows={3} value={form[q.key] as string} onChange={(e) => set(q.key, e.target.value)} />
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
          <div className="mb-savebar">
            <span className="muted" style={{ fontSize: 13 }}>{dirty ? "You have unsaved changes." : "All changes saved."}</span>
            <button type="button" className="btn btn-primary" disabled={saving || !dirty} onClick={handleSave}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
