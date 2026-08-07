function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Shown at the top of a form when useFormDraft finds a saved-but-never-submitted
 * draft. Deliberately a choice, not an automatic restore — see useFormDraft's
 * doc comment for why.
 */
export function DraftRestoreBanner({ updatedAt, onRestore, onDiscard }: { updatedAt: string; onRestore: () => void; onDiscard: () => void }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        border: "1px solid var(--blue)", background: "var(--blue-soft)", color: "var(--blue)",
        borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, fontWeight: 650,
      }}
    >
      <span>You have unsaved changes from {timeAgo(updatedAt)}.</span>
      <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button type="button" className="btn btn-sm" onClick={onRestore}>Restore</button>
        <button type="button" className="btn btn-sm" onClick={onDiscard}>Discard</button>
      </span>
    </div>
  );
}
