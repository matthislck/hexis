import { useStore } from "./store";

export function RunView() {
  const activeRun = useStore((s) => s.activeRun);
  const setActiveRun = useStore((s) => s.setActiveRun);

  if (!activeRun) return null;

  return (
    <div className="run-view-backdrop" onClick={() => setActiveRun(null)}>
      <div className="run-view" onClick={(e) => e.stopPropagation()}>
        <div className="run-view-header">
          <span className="run-view-title">Run record</span>
          <div className="run-view-chips">
            <span className="run-view-chip">{new Date(activeRun.timestamp).toLocaleString("de-DE")}</span>
            <span className="run-view-chip">{activeRun.duration_ms}ms</span>
            <span className="run-view-chip">{activeRun.model}</span>
            {activeRun.token_count > 0 && (
              <span className="run-view-chip">{activeRun.token_count.toLocaleString()} tokens</span>
            )}
          </div>
          <button className="inspector-close" style={{ marginLeft: "auto" }} onClick={() => setActiveRun(null)}>✕</button>
        </div>

        <div className="run-view-body">
          <section>
            <div className="run-section-title">Inputs</div>
            {Object.entries(activeRun.input_snapshot ?? {}).map(([path, content]) => (
              <details key={path} className="run-detail">
                <summary>{path}</summary>
                <pre className="run-detail-body">{content}</pre>
              </details>
            ))}
            {Object.keys(activeRun.input_snapshot ?? {}).length === 0 && (
              <span className="empty-state">No input files</span>
            )}
          </section>

          <section>
            <div className="run-section-title">Prompts</div>
            {Object.entries(activeRun.prompt_snapshot ?? {}).map(([nid, prompt]) => (
              <details key={nid} className="run-detail">
                <summary>Node {nid}</summary>
                <pre className="run-detail-body">{prompt}</pre>
              </details>
            ))}
          </section>

          <section>
            <div className="run-section-title">Output</div>
            <pre className="run-detail-body" style={{ borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              {activeRun.output_content || <span className="empty-state">No output</span>}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
