import { useEffect, useRef, useState } from "react";

/**
 * Captures a signature from a Topaz USB signature pad (SigLite / SigGem, e.g. T-LBK460-HSB-R) through Topaz's free SigWeb service,
 * a small Windows program that must be installed on the computer the pad is plugged into (Windows 10 or later, Chrome/Edge/Firefox).
 * The page talks to it through Topaz's own SigWebTablet.js (served from /vendor/, loaded only when the button is used). The result is the
 * same PNG data URL the drawn-signature box produces, so the signing flow and the server do not change.
 * Not for remote desktop sessions (SigWeb does not support them).
 */
type W = Window & Record<string, any>;
const w = window as unknown as W;

let scriptPromise: Promise<void> | null = null;
function loadSigWebScript(): Promise<void> {
  if (typeof w.IsSigWebInstalled === "function") return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/vendor/SigWebTablet.js";
      s.onload = () => resolve();
      s.onerror = () => { scriptPromise = null; reject(new Error("Could not load the signature pad connector.")); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

const CANVAS_W = 500;
const CANVAS_H = 100;

export function isWindowsComputer(): boolean {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
}

export function TopazPadCapture({ onChange }: { onChange: (png: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timer = useRef<unknown>(null);
  const [state, setState] = useState<"idle" | "capturing" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);

  function stopCapture() {
    try { if (timer.current != null) w.SetTabletState(0, timer.current); } catch { /* the pad may already be gone */ }
    timer.current = null;
  }
  // Leave the pad in its normal state when the page closes or the component goes away.
  useEffect(() => () => { stopCapture(); try { if (typeof w.Reset === "function") w.Reset(); } catch { /* ignore */ } }, []);

  async function start() {
    setMessage(null);
    try {
      await loadSigWebScript();
      if (!w.IsSigWebInstalled()) {
        setMessage("The signature pad program (Topaz SigWeb) is not running on this computer. Install it from topazsystems.com/sigweb, plug in the pad, and if the browser asks to allow access to devices on your local network, choose Allow.");
        return;
      }
      const ctx = canvasRef.current!.getContext("2d")!;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      w.SetDisplayXSize(CANVAS_W); w.SetDisplayYSize(CANVAS_H);
      stopCapture();
      w.SetJustifyMode(0);
      w.ClearTablet();
      timer.current = w.SetTabletState(1, ctx, 50);
      setState("capturing");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not start the signature pad.");
    }
  }

  function clear() {
    try { w.ClearTablet(); } catch { /* ignore */ }
    const ctx = canvasRef.current?.getContext("2d");
    ctx?.clearRect(0, 0, CANVAS_W, CANVAS_H);
    onChange(null);
  }

  function done() {
    try {
      if (Number(w.NumberOfTabletPoints()) === 0) { setMessage("Please sign on the pad first."); return; }
      stopCapture();
      w.SetImageXSize(CANVAS_W); w.SetImageYSize(CANVAS_H); w.SetImagePenWidth(5);
      w.SigImageCallback = (str: string) => {
        if (!str) { setMessage("The signature could not be read from the pad. Please try again."); setState("idle"); return; }
        onChange(`data:image/png;base64,${str}`);
        setState("done");
        try { if (typeof w.Reset === "function") w.Reset(); } catch { /* ignore */ }
      };
      w.GetSigImageB64(w.SigImageCallback);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not read the signature pad.");
    }
  }

  function cancel() {
    stopCapture();
    try { if (typeof w.Reset === "function") w.Reset(); } catch { /* ignore */ }
    setState("idle");
    onChange(null);
  }

  return (
    <div style={{ marginTop: 8 }}>
      {state === "idle" && (
        <button type="button" className="btn btn-sm" onClick={start}>Sign on the signature pad</button>
      )}
      <div style={{ display: state === "capturing" ? "block" : "none" }}>
        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 6px" }}>Sign on the pad with its pen. Your signature appears here as you write.</p>
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} style={{ width: "100%", maxWidth: CANVAS_W, height: "auto", aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, border: "1px solid var(--line, #bbb)", borderRadius: 8, background: "#fff" }} aria-label="Signature from the signature pad" />
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={done}>Use this signature</button>
          <button type="button" className="btn btn-sm" onClick={clear}>Clear</button>
          <button type="button" className="btn btn-sm" onClick={cancel}>Cancel</button>
        </div>
      </div>
      {state === "done" && (
        <p style={{ fontSize: 12.5, margin: "6px 0 0" }}>Signature captured from the pad. <button type="button" className="btn btn-sm" onClick={() => { setState("idle"); onChange(null); }}>Sign again</button></p>
      )}
      {message && <p className="tender-warn" style={{ marginTop: 6, fontSize: 12.5 }}>{message}</p>}
    </div>
  );
}
