import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Upload } from "lucide-react";
import { api, ApiError } from "../api/client";
import { useLanguage } from "../context/LanguageContext";
import { useNotify } from "./ConfirmProvider";
import { useToast } from "./Toast";
import { fileToBase64, MAX_UPLOAD_BYTES } from "../utils/file";

interface Upload { upload_id: string; notes: string | null; direction: string; status: string }

/** Last 6 full months + the current one: which bank statements have been sent, and a one-tap upload for the ones that haven't. Uploads are tagged "Bank statement YYYY-MM" so staff see exactly which month each belongs to. */
export function BankStatementsStrip({ clientId }: { clientId: string }) {
  const { t, lang } = useLanguage();
  const notify = useNotify();
  const toast = useToast();
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const targetMonth = useRef<string>("");

  const months = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(new Date().getFullYear(), new Date().getMonth() - 6 + i, 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString(lang === "ar" ? "ar" : "en-US", { month: "short", year: "2-digit" }), current: i === 6 };
  });

  const load = useCallback(() => {
    if (!clientId) return;
    api.get<{ uploads: Upload[] }>(`/documents/uploads?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => setSent(new Set(r.uploads.filter((u) => u.direction === "Client to Firm" && u.status !== "Removed").map((u) => String(u.notes || "").match(/^Bank statement (\d{4}-\d{2})/)?.[1]).filter(Boolean) as string[])))
      .catch(() => setSent(new Set()));
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  async function onFile(file: File | undefined) {
    const month = targetMonth.current;
    if (!file || !month) return;
    if (file.size > MAX_UPLOAD_BYTES) { await notify(t("bs.tooBig")); return; }
    setBusy(month);
    try {
      const fileData = await fileToBase64(file);
      await api.post("/documents/uploads", { clientId, fileData, fileName: file.name, mimeType: file.type || "application/pdf", notes: `Bank statement ${month}` });
      toast(t("bs.sent"));
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : t("bs.fail"));
    } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  }

  const missing = months.filter((m) => !m.current && !sent.has(m.key)).length;
  return (
    <section className="command-panel bs-strip" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <div><h2 className="command-panel-title">{t("bs.title")}</h2><div className="command-panel-note">{missing > 0 ? t("bs.missing").replace("{n}", String(missing)) : t("bs.allIn")}</div></div>
      </div>
      <div className="bs-months">
        {months.map((m) => {
          const done = sent.has(m.key);
          return (
            <div key={m.key} className={`bs-month${done ? " done" : ""}${m.current ? " current" : ""}`}>
              <b>{m.label}</b>
              {done
                ? <span className="bs-ok"><CheckCircle2 size={14} aria-hidden="true" /> {t("bs.received")}</span>
                : <button type="button" className="ghost-button btn-sm" disabled={busy === m.key} onClick={() => { targetMonth.current = m.key; fileRef.current?.click(); }}><Upload size={12} aria-hidden="true" /> {busy === m.key ? t("bs.sending") : m.current ? t("bs.upload") : t("bs.send")}</button>}
            </div>
          );
        })}
      </div>
      <input ref={fileRef} type="file" accept=".pdf,image/*,.csv,.xlsx,.xls" hidden onChange={(e) => onFile(e.target.files?.[0])} />
    </section>
  );
}
