import { useRef, useState, type DragEvent } from "react";

/**
 * One drag-and-drop + click-to-browse file picker, used everywhere the app accepts a
 * file (Documents upload, message attachments, backup restore, the firm logo,
 * task/work-item file fields) — a single component means drag-and-drop behavior and
 * styling stay consistent across all of them instead of each screen reimplementing its
 * own <input type="file">.
 *
 * Two modes: the original single-file `file`/`onChange` pair, or multi-file via
 * `files`/`onFilesChange` — dropping/browsing in multi mode APPENDS to the selection
 * (each file individually removable), so a user can gather files from different
 * folders across several picks before uploading them all at once.
 */
export function FileDropInput({ file, onChange, files, onFilesChange, accept, hint }: {
  file?: File | null;
  onChange?: (file: File | null) => void;
  files?: File[];
  onFilesChange?: (files: File[]) => void;
  accept?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const multiple = Boolean(onFilesChange);
  const selected = multiple ? (files || []) : [];

  function addFiles(list: FileList | null | undefined) {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    if (multiple) {
      // Skip exact duplicates (same name+size) so re-dropping a folder doesn't double up.
      const next = [...selected];
      for (const f of incoming) {
        if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
      }
      onFilesChange!(next);
    } else {
      onChange?.(incoming[0]);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    addFiles(e.dataTransfer.files);
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
          multiple={multiple}
          style={{ display: "none" }}
          onChange={(e) => addFiles(e.target.files)}
        />
        {!multiple && file ? (
          <div style={{ fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span>{file.name} · {(file.size / 1024).toFixed(0)} KB</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={(e) => { e.stopPropagation(); onChange?.(null); if (inputRef.current) inputRef.current.value = ""; }}
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>
            {multiple
              ? `Drag files here, or click to browse${selected.length ? " — add more" : ""}${hint ? ` — ${hint}` : ""}`
              : `Drag a file here, or click to browse${hint ? ` — ${hint}` : ""}`}
          </div>
        )}
      </div>
      {multiple && selected.length > 0 && (
        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
          {selected.map((f, i) => (
            <div key={`${f.name}-${f.size}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "5px 10px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--paper)" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name} · {(f.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                className="link-button"
                style={{ color: "var(--danger, #cf222e)", flexShrink: 0 }}
                onClick={() => onFilesChange!(selected.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
