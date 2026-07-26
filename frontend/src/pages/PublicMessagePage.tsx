import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";

interface PublicMessage {
  subject: string;
  messageEnglish: string | null;
  messageArabic: string | null;
  clientName: string;
  sentAt: string | null;
  channel: string;
}

/**
 * Public, no-login "view this message online" page — where the link in a long
 * SMS/WhatsApp send (see communications.routes.ts) actually points. Gives the
 * recipient a real, working English/Arabic toggle, which a plain text message
 * can never do — the whole reason this page exists is that SMS/WhatsApp can't
 * carry a multi-page bilingual report in a readable way. Deliberately outside
 * <ProtectedRoute> in App.tsx, same as PublicContractPage/PublicInvoicePage:
 * access is gated by the opaque token in the URL, not a portal login.
 */
export function PublicMessagePage() {
  const { token } = useParams<{ token: string }>();
  const [message, setMessage] = useState<PublicMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"english" | "arabic">("english");

  useEffect(() => {
    if (!token) return;
    api.get<{ message: PublicMessage }>(`/public/messages/${token}`)
      .then((r) => {
        setMessage(r.message);
        setLang(r.message.messageEnglish ? "english" : "arabic");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this message."));
  }, [token]);

  const pageStyle = { maxWidth: 640, margin: "40px auto", padding: "0 20px", fontFamily: "inherit" };

  if (error) return <div style={pageStyle}><ErrorBanner error={error} /></div>;
  if (!message) return <div style={pageStyle}><div className="spinner-wrap">Loading…</div></div>;

  const hasEnglish = !!message.messageEnglish;
  const hasArabic = !!message.messageArabic;
  const body = lang === "arabic" ? message.messageArabic : message.messageEnglish;

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "var(--muted-fg, #6b7280)" }}>{message.clientName}</div>
          <h1 style={{ fontSize: 20, margin: "4px 0 0" }}>{message.subject}</h1>
        </div>
        {hasEnglish && hasArabic && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button type="button" className={`btn btn-sm ${lang === "english" ? "btn-primary" : ""}`} onClick={() => setLang("english")}>English</button>
            <button type="button" className={`btn btn-sm ${lang === "arabic" ? "btn-primary" : ""}`} onClick={() => setLang("arabic")}>العربية</button>
          </div>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 20 }}>
        {message.sentAt ? new Date(message.sentAt).toLocaleString() : ""}
      </p>
      <div
        className="card"
        dir={lang === "arabic" ? "rtl" : "ltr"}
        style={{
          fontSize: 14, lineHeight: lang === "arabic" ? 1.9 : 1.7, whiteSpace: "pre-wrap",
          textAlign: lang === "arabic" ? "right" : "left",
        }}
      >
        {body || <span className="muted">No message text.</span>}
      </div>
    </div>
  );
}
