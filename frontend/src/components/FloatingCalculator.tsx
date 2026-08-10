import { useEffect, useRef, useState } from "react";
import { useEscapeToClose } from "../hooks/useEscapeToClose";

type Op = "+" | "−" | "×" | "÷";

function calc(a: number, b: number, op: Op): number {
  const raw = op === "+" ? a + b : op === "−" ? a - b : op === "×" ? a * b : b === 0 ? NaN : a / b;
  // Avoids the classic 0.1 + 0.2 = 0.30000000000000004 floating-point artifact
  // showing up on a display meant to be read at a glance, not audited.
  return Math.round(raw * 1e10) / 1e10;
}

/**
 * A plain arithmetic calculator, deliberately unrelated to the tax
 * calculators under Calculators (sales tax, quarterly safe-harbor) — those
 * compute a specific filing number from client data; this is just a
 * pocket-calculator for whatever's in front of you (checking a JE total,
 * a quick reconciliation). Lives in the topbar rather than a page or the
 * sidebar so it's one click away from anywhere, not just Accounting, and
 * its location alone keeps it from being confused with the tax tools.
 */
export function FloatingCalculator({ onClose }: { onClose: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState("0");
  const [stored, setStored] = useState<number | null>(null);
  const [pendingOp, setPendingOp] = useState<Op | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [justEvaluated, setJustEvaluated] = useState(false);

  useEffect(() => {
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
  }, []);

  function inputDigit(d: string) {
    if (waitingForOperand || justEvaluated) {
      setDisplay(d);
      setWaitingForOperand(false);
      setJustEvaluated(false);
    } else {
      setDisplay((prev) => (prev === "0" ? d : prev.length < 16 ? prev + d : prev));
    }
  }
  function inputDecimal() {
    if (waitingForOperand || justEvaluated) {
      setDisplay("0.");
      setWaitingForOperand(false);
      setJustEvaluated(false);
    } else if (!display.includes(".")) {
      setDisplay(display + ".");
    }
  }
  function clearAll() {
    setDisplay("0");
    setStored(null);
    setPendingOp(null);
    setWaitingForOperand(false);
    setJustEvaluated(false);
  }
  function backspace() {
    if (waitingForOperand || justEvaluated) return;
    setDisplay((prev) => (prev.length > 1 ? prev.slice(0, -1) : "0"));
  }
  function toggleSign() {
    setDisplay((prev) => (prev === "0" ? prev : prev.startsWith("-") ? prev.slice(1) : `-${prev}`));
  }
  function inputPercent() {
    setDisplay(String(Number(display) / 100));
  }
  function applyOp(next: Op | null) {
    const input = Number(display);
    if (Number.isNaN(input)) return clearAll();
    if (stored === null) {
      setStored(input);
    } else if (pendingOp && !waitingForOperand) {
      const result = calc(stored, input, pendingOp);
      setDisplay(Number.isNaN(result) ? "Error" : String(result));
      setStored(Number.isNaN(result) ? null : result);
    }
    setPendingOp(next);
    setWaitingForOperand(true);
    setJustEvaluated(next === null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (/^[0-9]$/.test(e.key)) return inputDigit(e.key);
    if (e.key === ".") return inputDecimal();
    if (e.key === "+") return applyOp("+");
    if (e.key === "-") return applyOp("−");
    if (e.key === "*") return applyOp("×");
    if (e.key === "/") { e.preventDefault(); return applyOp("÷"); }
    if (e.key === "Enter" || e.key === "=") return applyOp(null);
    if (e.key === "Backspace") return backspace();
    if (e.key.toLowerCase() === "c") return clearAll();
  }

  const KEYS: { label: string; onClick: () => void; variant?: "op" | "muted" | "equals" }[] = [
    { label: "AC", onClick: clearAll, variant: "muted" },
    { label: "±", onClick: toggleSign, variant: "muted" },
    { label: "⌫", onClick: backspace, variant: "muted" },
    { label: "÷", onClick: () => applyOp("÷"), variant: "op" },
    { label: "7", onClick: () => inputDigit("7") },
    { label: "8", onClick: () => inputDigit("8") },
    { label: "9", onClick: () => inputDigit("9") },
    { label: "×", onClick: () => applyOp("×"), variant: "op" },
    { label: "4", onClick: () => inputDigit("4") },
    { label: "5", onClick: () => inputDigit("5") },
    { label: "6", onClick: () => inputDigit("6") },
    { label: "−", onClick: () => applyOp("−"), variant: "op" },
    { label: "1", onClick: () => inputDigit("1") },
    { label: "2", onClick: () => inputDigit("2") },
    { label: "3", onClick: () => inputDigit("3") },
    { label: "+", onClick: () => applyOp("+"), variant: "op" },
    { label: "%", onClick: inputPercent, variant: "muted" },
    { label: "0", onClick: () => inputDigit("0") },
    { label: ".", onClick: inputDecimal },
    { label: "=", onClick: () => applyOp(null), variant: "equals" },
  ];

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="floating-calc-title"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed", top: 58, right: 16, zIndex: 500, width: 240,
        background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 12,
        boxShadow: "0 12px 32px rgba(0,0,0,0.18)", padding: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span id="floating-calc-title" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>Calculator</span>
        <button type="button" className="ghost-button btn-sm" aria-label="Close calculator" onClick={onClose} style={{ padding: "2px 8px" }}>×</button>
      </div>
      <div
        style={{
          background: "rgba(127,127,127,0.08)",
          border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", marginBottom: 8,
          textAlign: "right", fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: display.length > 10 ? 18 : 26, fontWeight: 700,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
      >
        {display}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {KEYS.map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={k.onClick}
            className={k.variant === "equals" ? "btn btn-primary" : k.variant === "op" ? "btn" : "ghost-button"}
            style={{ padding: "10px 0", fontSize: 15, fontWeight: k.variant ? 700 : 500 }}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
