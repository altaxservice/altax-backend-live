export function ComingSoonPage({ title, note }: { title: string; note: string }) {
  return (
    <div className="command-panel">
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title">{title}</h2>
          <div className="command-panel-note">Not built yet</div>
        </div>
      </div>
      <p className="muted" style={{ padding: 16 }}>{note}</p>
    </div>
  );
}
