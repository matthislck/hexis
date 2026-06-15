import React, { useState } from "react";
import { X } from "lucide-react";
import { useStore } from "./store";
import { setNotionToken, setAnthropicKey, setOpenaiKey, setGeminiKey } from "./api";
import { NotionIcon } from "./icons/NotionIcon";

interface Props {
  onClose: () => void;
}

function KeyCard({
  icon, title, sub, placeholder, value, onChange, onSave, saving, saved, error, disabled, hint,
}: {
  icon: React.ReactNode; title: string; sub: string; placeholder: string;
  value: string; onChange: (v: string) => void; onSave: () => void;
  saving: boolean; saved: boolean; error: string; disabled: boolean; hint?: React.ReactNode;
}) {
  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <div className="settings-card-icon">{icon}</div>
        <div>
          <div className="settings-card-title">{title}</div>
          <div className="settings-card-sub">{sub}</div>
        </div>
        {value && !error && <div className="settings-badge connected">Connected</div>}
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            className="ctrl ctrl-mono"
            type="password"
            placeholder={placeholder}
            value={value}
            style={{ flex: 1 }}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            className={`btn btn-sm ${saved ? "" : "btn-primary"}`}
            onClick={onSave}
            disabled={disabled || saving}
          >
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save"}
          </button>
        </div>
        {error && <div style={{ fontSize: 11, color: "#f87171", marginTop: 5 }}>{error}</div>}
        {hint && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>{hint}</div>}
      </div>
    </div>
  );
}

export function Settings({ onClose }: Props) {
  const workspaceId = useStore((s) => s.activeWorkspaceId);

  const storeNotion = useStore((s) => s.notionToken);
  const setStoreNotion = useStore((s) => s.setNotionToken);
  const storeAnthropic = useStore((s) => s.anthropicKey);
  const setStoreAnthropic = useStore((s) => s.setAnthropicKey);
  const storeOpenai = useStore((s) => s.openaiKey);
  const setStoreOpenai = useStore((s) => s.setOpenaiKey);
  const storeGemini = useStore((s) => s.geminiKey);
  const setStoreGemini = useStore((s) => s.setGeminiKey);

  const [notionVal, setNotionVal] = useState(storeNotion);
  const [notionSaved, setNotionSaved] = useState(false);
  const [notionErr, setNotionErr] = useState("");
  const [notionSaving, setNotionSaving] = useState(false);

  const [anthropicVal, setAnthropicVal] = useState(storeAnthropic);
  const [anthropicSaved, setAnthropicSaved] = useState(false);
  const [anthropicErr, setAnthropicErr] = useState("");
  const [anthropicSaving, setAnthropicSaving] = useState(false);

  const [openaiVal, setOpenaiVal] = useState(storeOpenai);
  const [openaiSaved, setOpenaiSaved] = useState(false);
  const [openaiErr, setOpenaiErr] = useState("");
  const [openaiSaving, setOpenaiSaving] = useState(false);

  const [geminiVal, setGeminiVal] = useState(storeGemini);
  const [geminiSaved, setGeminiSaved] = useState(false);
  const [geminiErr, setGeminiErr] = useState("");
  const [geminiSaving, setGeminiSaving] = useState(false);

  async function save<T>(
    fn: () => Promise<T>,
    setStore: (v: string) => void, val: string,
    setSaving: (v: boolean) => void, setSaved: (v: boolean) => void, setErr: (v: string) => void,
  ) {
    if (!workspaceId) return;
    setSaving(true); setErr("");
    try { await fn(); setStore(val); setSaved(true); }
    catch (e) { setErr(`Save failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="inspector-close" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="settings-body">
          <div className="settings-section-label">API Keys</div>

          <KeyCard
            icon={<span style={{ fontWeight: 700 }}>A</span>}
            title="Anthropic API"
            sub="Use Claude models directly via API"
            placeholder="sk-ant-…"
            value={anthropicVal}
            onChange={(v) => { setAnthropicVal(v); setAnthropicSaved(false); }}
            onSave={() => save(() => setAnthropicKey(workspaceId!, anthropicVal), setStoreAnthropic, anthropicVal, setAnthropicSaving, setAnthropicSaved, setAnthropicErr)}
            saving={anthropicSaving} saved={anthropicSaved} error={anthropicErr}
            disabled={!workspaceId}
          />

          <KeyCard
            icon={<span style={{ fontWeight: 700 }}>⊞</span>}
            title="OpenAI API"
            sub="Use GPT-4o, o3, o4-mini and other OpenAI models"
            placeholder="sk-…"
            value={openaiVal}
            onChange={(v) => { setOpenaiVal(v); setOpenaiSaved(false); }}
            onSave={() => save(() => setOpenaiKey(workspaceId!, openaiVal), setStoreOpenai, openaiVal, setOpenaiSaving, setOpenaiSaved, setOpenaiErr)}
            saving={openaiSaving} saved={openaiSaved} error={openaiErr}
            disabled={!workspaceId}
          />

          <KeyCard
            icon={<span style={{ fontWeight: 700 }}>G</span>}
            title="Gemini API"
            sub="Use Gemini 2.5 Pro, Flash and other Google models"
            placeholder="AIza…"
            value={geminiVal}
            onChange={(v) => { setGeminiVal(v); setGeminiSaved(false); }}
            onSave={() => save(() => setGeminiKey(workspaceId!, geminiVal), setStoreGemini, geminiVal, setGeminiSaving, setGeminiSaved, setGeminiErr)}
            saving={geminiSaving} saved={geminiSaved} error={geminiErr}
            disabled={!workspaceId}
          />

          <div className="settings-section-label" style={{ marginTop: 16 }}>Integrations</div>

          <KeyCard
            icon={<NotionIcon size={18} />}
            title="Notion"
            sub="Read pages and write results to databases"
            placeholder="secret_…"
            value={notionVal}
            onChange={(v) => { setNotionVal(v); setNotionSaved(false); }}
            onSave={() => save(() => setNotionToken(workspaceId!, notionVal), setStoreNotion, notionVal, setNotionSaving, setNotionSaved, setNotionErr)}
            saving={notionSaving} saved={notionSaved} error={notionErr}
            disabled={!workspaceId}
            hint="After creating the integration, share each Notion page or database with it via the Share menu."
          />

          {!workspaceId && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
              API keys are stored per workspace — create or select a workspace first (sidebar top-left).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
