import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, User, ListChecks, Receipt, FolderOpen, Users } from "lucide-react";
import { api, ApiError } from "../api/client";
import { useSelectedClient } from "../context/SelectedClientContext";

interface ClientHit { client_id: string; client_name: string; email: string | null; phone: string | null; status: string | null }
interface TaskHit { task_id: string; task_name: string; client_id: string; client_name: string; status: string; agency_due_date: string | null }
interface InvoiceHit { invoice_id: string; client_id: string; description: string | null; total_amount: number; status: string }
interface DocumentHit { request_id: string; client_id: string; client_name: string; requested_item: string; status: string; kind: "request" | "upload" }
interface EmployeeHit { employee_id: string; employee_name: string; client_id: string; client_name: string; status: string | null }
interface SearchResults { clients: ClientHit[]; tasks: TaskHit[]; invoices: InvoiceHit[]; documents: DocumentHit[]; employees: EmployeeHit[] }

/** One flattened, keyboard-navigable row — built the same way SearchResultsPage
 * builds its 5 separate tables, just merged into a single ordered list so arrow
 * keys can move through every hit regardless of type. */
interface Row { key: string; group: string; icon: typeof User; title: string; subtitle: string; go: () => void }

function buildRows(results: SearchResults, navigate: ReturnType<typeof useNavigate>, setSelectedClient: (id: string, name: string) => void): Row[] {
  const rows: Row[] = [];
  for (const c of results.clients) {
    rows.push({
      key: `client-${c.client_id}`, group: "Clients", icon: Users, title: c.client_name, subtitle: c.email || c.phone || c.status || "",
      go: () => { setSelectedClient(c.client_id, c.client_name); navigate(`/clients/${c.client_id}`); },
    });
  }
  for (const t of results.tasks) {
    rows.push({
      key: `task-${t.task_id}`, group: "Tasks", icon: ListChecks, title: t.task_name, subtitle: `${t.client_name} · ${t.status}`,
      go: () => { setSelectedClient(t.client_id, t.client_name); navigate(`/tasks/${t.task_id}`); },
    });
  }
  for (const i of results.invoices) {
    rows.push({
      key: `invoice-${i.invoice_id}`, group: "Invoices", icon: Receipt, title: i.invoice_id, subtitle: i.description || i.status,
      go: () => navigate(`/billing/${i.invoice_id}`),
    });
  }
  for (const d of results.documents) {
    rows.push({
      key: `doc-${d.kind}-${d.request_id}`, group: "Documents", icon: FolderOpen, title: d.requested_item, subtitle: `${d.client_name} · ${d.status}`,
      go: () => navigate(d.kind === "request" ? `/documents/${d.request_id}` : `/clients/${d.client_id}?tab=Documents`),
    });
  }
  for (const e of results.employees) {
    rows.push({
      key: `emp-${e.employee_id}`, group: "Employees", icon: User, title: e.employee_name, subtitle: e.client_name,
      go: () => navigate(`/employees/${e.employee_id}`),
    });
  }
  return rows;
}

/**
 * ⌘K / Ctrl+K command palette — sits on top of the same GET /search endpoint the
 * topbar's "Search All" already uses, so this isn't a second search implementation,
 * just a faster way to reach the first one without leaving the keyboard.
 */
export function CommandPalette() {
  const navigate = useNavigate();
  const { setSelectedClient } = useSelectedClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    // Lets the topbar's visible "⌘K" hint open the palette with a plain click too —
    // the keyboard shortcut alone is invisible to anyone who doesn't already know it's there.
    function onOpenEvent() { setOpen(true); }
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("open-command-palette", onOpenEvent);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("open-command-palette", onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults(null);
      setError(null);
      setActiveIndex(0);
      // Wait a frame for the modal to actually mount before focusing it.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) { setResults(null); return; }
    const handle = setTimeout(() => {
      api.get<SearchResults>(`/search?q=${encodeURIComponent(q)}`)
        .then((res) => { setResults(res); setActiveIndex(0); })
        .catch((err) => setError(err instanceof ApiError ? err.message : "Search failed."));
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open]);

  const rows = results ? buildRows(results, navigate, setSelectedClient) : [];

  function activate(row: Row) {
    row.go();
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, rows.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") { e.preventDefault(); if (rows[activeIndex]) activate(rows[activeIndex]); }
  }

  useEffect(() => {
    listRef.current?.querySelector(".cmdk-row-active")?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const q = query.trim();
  let lastGroup: string | undefined;

  return (
    <div className="modal-overlay" style={{ alignItems: "flex-start", paddingTop: "10vh" }} onClick={() => setOpen(false)}>
      <div className="modal-panel" style={{ width: "min(560px, 100%)", padding: 0, overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
          <Search size={18} color="var(--muted)" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search clients, tasks, invoices, documents, employees…"
            style={{ flex: 1, border: "none", outline: "none", fontSize: 15, background: "transparent", color: "var(--ink)" }}
          />
          <kbd style={{ fontSize: 11, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 4, padding: "2px 6px" }}>Esc</kbd>
        </div>
        <div ref={listRef} style={{ maxHeight: "50vh", overflowY: "auto" }}>
          {error && <p style={{ padding: 16, color: "var(--red)", fontSize: 13 }}>{error}</p>}
          {!error && q.length < 2 && <p className="muted" style={{ padding: 16, fontSize: 13 }}>Type at least 2 characters to search.</p>}
          {!error && q.length >= 2 && results === null && <p className="muted" style={{ padding: 16, fontSize: 13 }}>Searching…</p>}
          {!error && q.length >= 2 && results !== null && rows.length === 0 && <p className="muted" style={{ padding: 16, fontSize: 13 }}>No matches for "{q}".</p>}
          {rows.map((row, i) => {
            const showGroup = row.group !== lastGroup;
            lastGroup = row.group;
            const Icon = row.icon;
            return (
              <div key={row.key}>
                {showGroup && (
                  <div style={{ padding: "8px 18px 4px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)" }}>
                    {row.group}
                  </div>
                )}
                <div
                  className={i === activeIndex ? "cmdk-row-active" : ""}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => activate(row)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "9px 18px", cursor: "pointer",
                    background: i === activeIndex ? "var(--teal-soft)" : "transparent",
                  }}
                >
                  <Icon size={15} color="var(--muted)" aria-hidden="true" style={{ flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</div>
                    {row.subtitle && <div className="muted" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.subtitle}</div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
