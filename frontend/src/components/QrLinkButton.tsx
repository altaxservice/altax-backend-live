import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** A "QR code" button for a signing link: opens a large code the client scans with their phone camera to sign on their own phone. Nothing is sent anywhere; the code is drawn in the browser. */
export function QrLinkButton({ link, title = "Scan to sign" }: { link: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    QRCode.toDataURL(link, { width: 360, margin: 2, errorCorrectionLevel: "M" }).then((u) => { if (alive) setSrc(u); }).catch(() => { if (alive) setSrc(null); });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { alive = false; window.removeEventListener("keydown", onKey); };
  }, [open, link]);
  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>QR code</button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={title} onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface, #fff)", color: "var(--ink, #111)", borderRadius: 12, padding: 20, maxWidth: 420, width: "100%", textAlign: "center" }}>
            <h2 style={{ fontSize: 17, margin: "0 0 4px" }}>{title}</h2>
            <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>Point your phone camera at this code, then follow the link to read and sign. This code works only for this signer.</p>
            {src ? <img src={src} alt="QR code for the signing link" width={300} height={300} style={{ maxWidth: "100%", height: "auto", background: "#fff", borderRadius: 8 }} /> : <div className="spinner-wrap">Preparing the code…</div>}
            <div style={{ marginTop: 14 }}><button type="button" className="btn btn-primary" autoFocus onClick={() => setOpen(false)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}
