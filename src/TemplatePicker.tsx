import { useEffect, useState } from "react";
import { Loader, Trash2 } from "lucide-react";
import { TEMPLATES, type WorkflowTemplate } from "./templates";
import { listUserTemplates, deleteUserTemplate } from "./api";

interface Props {
  onSelect: (template: WorkflowTemplate | null) => void;
  onGenerate: (description: string) => Promise<void>;
  onClose: () => void;
}

export function TemplatePicker({ onSelect, onGenerate, onClose }: Props) {
  const [generating, setGenerating] = useState(false);
  const [desc, setDesc] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [error, setError] = useState("");
  const [userTemplates, setUserTemplates] = useState<WorkflowTemplate[]>([]);

  useEffect(() => {
    listUserTemplates().then(setUserTemplates).catch(() => {});
  }, []);

  async function handleDeleteUserTemplate(e: React.MouseEvent, tid: string) {
    e.stopPropagation();
    await deleteUserTemplate(tid).catch(() => {});
    setUserTemplates((prev) => prev.filter((t) => t.id !== tid));
  }

  async function handleGenerate() {
    if (!desc.trim()) return;
    setGenerating(true);
    setError("");
    try {
      await onGenerate(desc.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGenerating(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="template-picker" onClick={(e) => e.stopPropagation()}>
        <div className="template-picker-header">
          <span className="template-picker-title">New workflow</span>
          <button className="inspector-close" onClick={onClose}>✕</button>
        </div>

        <button className="template-item template-blank" onClick={() => onSelect(null)}>
          <div className="template-item-icon">+</div>
          <div className="template-item-text">
            <div className="template-item-name">Blank workflow</div>
            <div className="template-item-desc">Start from scratch</div>
          </div>
        </button>

        {showInput ? (
          <div style={{ padding: "6px 10px 10px" }}>
            <textarea
              className="ctrl"
              placeholder="Describe what this workflow should do…"
              value={desc}
              autoFocus
              rows={3}
              style={{ resize: "none", fontSize: 12, lineHeight: 1.5 }}
              onChange={(e) => setDesc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
                if (e.key === "Escape") { setShowInput(false); setDesc(""); setError(""); }
              }}
            />
            {error && (
              <div style={{ fontSize: 11, color: "#f87171", marginTop: 4 }}>{error}</div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button
                className="btn btn-primary btn-sm"
                style={{ flex: 1 }}
                onClick={handleGenerate}
                disabled={generating || !desc.trim()}
              >
                {generating
                  ? <><Loader size={10} className="spin" /> Generating…</>
                  : "Generate  ⌘↵"}
              </button>
              <button className="btn btn-sm" onClick={() => { setShowInput(false); setDesc(""); setError(""); }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="template-item template-blank" onClick={() => setShowInput(true)}>
            <div className="template-item-icon" style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>✦</div>
            <div className="template-item-text">
              <div className="template-item-name">Generate from description</div>
              <div className="template-item-desc">Let AI build the workflow for you</div>
            </div>
          </button>
        )}

        {userTemplates.length > 0 && (
          <>
            <div className="template-section-label">My Templates</div>
            {userTemplates.map((t) => (
              <button key={t.id} className="template-item" onClick={() => onSelect(t)}>
                <div className="template-item-icon" style={{ background: "rgba(16,185,129,0.12)", color: "#34d399" }}>★</div>
                <div className="template-item-text">
                  <div className="template-item-name">{t.name}</div>
                  <div className="template-item-desc">{t.description || "Custom template"}</div>
                </div>
                <button
                  className="template-item-delete"
                  onClick={(e) => handleDeleteUserTemplate(e, t.id)}
                  title="Delete template"
                >
                  <Trash2 size={12} />
                </button>
              </button>
            ))}
          </>
        )}

        {TEMPLATES.length > 0 && (
          <>
            <div className="template-section-label">LLM Prompts</div>
            {TEMPLATES.filter((t) => t.nodes.every((n) => n.type !== "agent")).map((t) => (
              <button key={t.id} className="template-item" onClick={() => onSelect(t)}>
                <div className="template-item-icon">✦</div>
                <div className="template-item-text">
                  <div className="template-item-name">{t.name}</div>
                  <div className="template-item-desc">{t.description}</div>
                </div>
              </button>
            ))}
            <div className="template-section-label">Agents</div>
            {TEMPLATES.filter((t) => t.nodes.some((n) => n.type === "agent")).map((t) => (
              <button key={t.id} className="template-item" onClick={() => onSelect(t)}>
                <div className="template-item-icon" style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>▸</div>
                <div className="template-item-text">
                  <div className="template-item-name">{t.name}</div>
                  <div className="template-item-desc">{t.description}</div>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
