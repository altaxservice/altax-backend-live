import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";

/**
 * UX-015 (Hard Audit, 2026-08-13) — renders docs/MAINTENANCE_MANUAL.md
 * in-app so it's reachable without a code editor. Not a general markdown
 * renderer — a small, purpose-built parser for exactly the subset this one
 * document uses (headers, bold, hr, fenced code, pipe tables, lists,
 * paragraphs). Adding a full markdown library for one 12KB internal doc
 * wasn't worth the dependency weight.
 */
function renderMarkdownLite(md: string): ReactNode[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  function inline(text: string): ReactNode {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={idx}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`")) return <code key={idx}>{part.slice(1, -1)}</code>;
      return <span key={idx}>{part}</span>;
    });
  }

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    if (/^---+$/.test(line.trim())) { blocks.push(<hr key={key++} />); i++; continue; }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      if (level === 1) blocks.push(<h2 key={key++}>{text}</h2>);
      else if (level === 2) blocks.push(<h3 key={key++} style={{ marginTop: 28 }}>{text}</h3>);
      else blocks.push(<h4 key={key++}>{text}</h4>);
      i++;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { codeLines.push(lines[i]); i++; }
      i++; // skip closing fence
      blocks.push(<pre key={key++} className="card" style={{ padding: 12, overflowX: "auto", fontSize: 12.5 }}><code>{codeLines.join("\n")}</code></pre>);
      continue;
    }

    if (line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { tableLines.push(lines[i]); i++; }
      const rows = tableLines
        .filter((l) => !/^\|[\s:-]+\|$/.test(l.replace(/-{2,}/g, "-")))
        .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      const [headerRow, ...bodyRows] = rows;
      blocks.push(
        <div className="table-scroll" key={key++}>
          <table>
            <thead><tr>{headerRow.map((c, ci) => <th key={ci} scope="col">{inline(c)}</th>)}</tr></thead>
            <tbody>{bodyRows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      blocks.push(<ul key={key++}>{items.map((it, ii) => <li key={ii}>{inline(it)}</li>)}</ul>);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      blocks.push(<ol key={key++}>{items.map((it, ii) => <li key={ii}>{inline(it)}</li>)}</ol>);
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3})\s+/.test(lines[i]) && !/^---+$/.test(lines[i].trim()) && !lines[i].trim().startsWith("```") && !lines[i].trim().startsWith("|") && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(<p key={key++}>{inline(paraLines.join(" "))}</p>);
  }

  return blocks;
}

export function MaintenanceManualPage() {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ content: string }>("/system/maintenance-manual")
      .then((res) => setContent(res.content))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the maintenance manual."));
  }, []);

  if (error) return <ErrorBanner error={error} />;

  return (
    <div>
      <div className="portal-banner" style={{ marginBottom: 16 }}>
        <div className="topbar-eyebrow">Fix Center</div>
        <h2>Maintenance Manual</h2>
        <p>Written for someone with no programming background — what this app is, how it runs, and what to do when something breaks.</p>
      </div>
      {content === null && <div className="spinner-wrap">Loading…</div>}
      {content !== null && (
        <div className="card" style={{ padding: "24px 28px", maxWidth: 860, lineHeight: 1.6 }}>
          {renderMarkdownLite(content)}
        </div>
      )}
    </div>
  );
}
