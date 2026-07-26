import { useRef, useState, type DragEvent } from "react";

/**
 * One drag-and-drop + click-to-browse file picker, used everywhere the app accepts a
 * single file (Documents upload, message attachments, backup restore, the firm logo,
 * task/work-item file fields) — a single component means drag-and-drop behavior and
 * styling stay consistent across all of them instead of each screen reimplementing its
 * own <input type="file">.
 */
export function FileDropInput({ file, onChange, accept, hint }: {
  file: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onChange(dropped);
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
        onDrop={handleDrop}
        style={{
          border: `1.5px dashed ${dragging ? "var(--teal)" : "var(--line)"}`,
          borderRadius: 8,
          padding: "16px 12px",
          textAlign: "center",
          cursor: "pointer",
          background: dragging ? "var(--teal-soft)" : "var(--surface)",
          transition: "border-color 0.15s ease, background 0.15s ease",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          style={{ display: "none" }}
          onChange={(e) => onChange(e.target.files?.[0] || null)}
        />
        {file ? (
          <div style={{ fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span>{file.name} · {(file.size / 1024).toFixed(0)} KB</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={(e) => { e.stopPropagation(); onChange(null); if (inputRef.current) inputRef.current.value = ""; }}
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>
            Drag a file here, or click to browse{hint ? ` — ${hint}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}
