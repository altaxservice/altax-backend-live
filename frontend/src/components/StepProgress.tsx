import { ArrowRight, Check } from "lucide-react";

export interface StepProgressStep {
  n: number;
  label: string;
  desc?: string;
}

/**
 * Numbered-circle step-progress strip — same visual language as
 * PipelinePage.tsx's own PipelineSteps() (numbered circles, connecting
 * arrows, a highlighted "you are here" step), generalized into a shared
 * component instead of a one-off hardcoded to 4 pipeline stages. Anything
 * with a real gated multi-step flow (the Ownership Transfer wizard today,
 * others later) can reuse this instead of re-deriving the same strip.
 *
 * `current` is the step being shown right now. `maxReached` (defaults to
 * `current`) is the furthest step the user has actually validated their way
 * to — steps at or before it render as clickable when `onSelect` is passed,
 * so backward navigation is free but jumping ahead past validated data
 * isn't possible from the strip itself.
 */
export function StepProgress({ steps, current, maxReached, onSelect }: {
  steps: StepProgressStep[];
  current: number;
  maxReached?: number;
  onSelect?: (n: number) => void;
}) {
  const reachable = maxReached ?? current;
  return (
    <div
      className="step-progress"
      style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 14, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-2, #f8fafc)" }}
    >
      {steps.map((s, i) => {
        const state: "done" | "active" | "upcoming" = s.n < current ? "done" : s.n === current ? "active" : "upcoming";
        const clickable = !!onSelect && s.n !== current && s.n <= reachable;
        const circleBg = state === "upcoming" ? "var(--line)" : "var(--teal)";
        const circleColor = state === "upcoming" ? "var(--ink)" : "#fff";
        return (
          <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelect!(s.n)}
              aria-current={state === "active" ? "step" : undefined}
              title={clickable ? `Back to ${s.label}` : undefined}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "none", border: "none", padding: 0,
                cursor: clickable ? "pointer" : "default",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                  background: circleBg, color: circleColor, fontSize: 11, fontWeight: 800,
                }}
              >
                {state === "done" ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : s.n}
              </span>
              <span>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: state === "active" ? 800 : 700, lineHeight: 1.2, color: "var(--ink)" }}>{s.label}</span>
                {s.desc && <span className="muted" style={{ display: "block", fontSize: 11, lineHeight: 1.2 }}>{s.desc}</span>}
              </span>
            </button>
            {i < steps.length - 1 && <ArrowRight size={14} strokeWidth={2} aria-hidden="true" className="muted" style={{ margin: "0 4px" }} />}
          </div>
        );
      })}
    </div>
  );
}
