import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import { FolderOpen, Terminal, X, GitBranch, Search, ChevronDown, ChevronUp, ChevronRight, Loader, Sparkles, FolderInput } from "lucide-react";
import { buildFileTree, getFilePaths, type FTNode } from "./fileTree";
import { useStore } from "./store";
import { listFiles, readFile, writeFile, updateWorkflow, searchNotionPages, generatePrompt, pickFolder } from "./api";
import { NotionIcon } from "./icons/NotionIcon";
import type { WorkflowNode, NodeConfig } from "./types";

const BACKENDS: { id: string; label: string; models: string[] }[] = [
  {
    id: "claude-cli",
    label: "Claude Code CLI",
    models: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  },
  {
    id: "anthropic-api",
    label: "Anthropic API",
    models: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  },
  {
    id: "openai-api",
    label: "OpenAI API",
    models: ["gpt-4o", "gpt-4o-mini", "o3", "o4-mini", "o1"],
  },
  {
    id: "gemini-api",
    label: "Gemini API",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
  },
  {
    id: "codex-cli",
    label: "Codex CLI",
    models: ["codex"],
  },
];

const NODE_META = {
  input:           { icon: <FolderOpen size={14} strokeWidth={1.75} />,  label: "Input Files" },
  prompt:          { icon: "✦",                                           label: "LLM Prompt" },
  agent:           { icon: <Terminal size={14} strokeWidth={1.75} />,    label: "Agent" },
  output:          { icon: "↓",                                           label: "Save Output" },
  "notion-input":  { icon: <NotionIcon size={16} />, label: "Notion Page" },
  "notion-output": { icon: <NotionIcon size={16} />, label: "Notion Output" },
  "workflow-ref":  { icon: <GitBranch size={14} strokeWidth={1.75} />,   label: "Workflow Input" },
};

export function Inspector() {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  const workflow = useStore((s) => s.activeWorkflow);
  const setWorkflow = useStore((s) => s.setActiveWorkflow);
  const [files, setFiles] = useState<string[]>([]);

  const node = workflow?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  function refreshFiles() {
    if (!workflow) return;
    listFiles(workflow.workspace_id).then(setFiles).catch(() => setFiles([]));
  }

  useEffect(() => {
    refreshFiles();
  }, [workflow?.workspace_id]);

  if (!node || !workflow) {
    return (
      <div className="inspector-empty">
        <span>Click a node to configure</span>
      </div>
    );
  }

  async function patchConfig(patch: Partial<NodeConfig>) {
    if (!workflow) return;
    const updated = {
      ...workflow,
      nodes: workflow.nodes.map((n) =>
        n.id === selectedNodeId ? { ...n, config: { ...n.config, ...patch } } : n
      ),
    };
    try {
      const saved = await updateWorkflow(workflow.workspace_id, workflow.id, updated);
      setWorkflow(saved);
    } catch {
      setWorkflow(updated);
    }
  }

  const meta = NODE_META[node.type];

  return (
    <div className="inspector">
      <div className="inspector-header">
        <div className={`inspector-header-icon ${node.type}`}>{meta.icon}</div>
        <div className="inspector-header-title">{meta.label}</div>
        <button className="inspector-close" onClick={() => setSelectedNodeId(null)}><X size={14} /></button>
      </div>

      <div className="inspector-body">
        {node.type === "input"         && <InputFields        node={node} files={files} patch={patchConfig} />}
        {node.type === "prompt"        && <PromptFields       node={node} files={files} patch={patchConfig} workspaceId={workflow.workspace_id} refreshFiles={refreshFiles} />}
        {node.type === "agent"         && <AgentFields        node={node} files={files} patch={patchConfig} workspaceId={workflow.workspace_id} refreshFiles={refreshFiles} />}
        {node.type === "output"        && <OutputFields       node={node} patch={patchConfig} />}
        {node.type === "notion-input"  && <NotionInputFields  node={node} patch={patchConfig} />}
        {node.type === "notion-output" && <NotionOutputFields node={node} patch={patchConfig} />}
        {node.type === "workflow-ref"  && <WorkflowRefFields  node={node} patch={patchConfig} />}
      </div>
    </div>
  );
}

function InputFields({ node, files, patch }: { node: WorkflowNode; files: string[]; patch: (p: Partial<NodeConfig>) => void }) {
  const paths = node.config.paths ?? [];

  function toggleFiles(toToggle: string[], allSelected: boolean) {
    const next = allSelected
      ? paths.filter((p) => !toToggle.includes(p))
      : [...new Set([...paths, ...toToggle])];
    patch({ paths: next });
  }

  const tree = buildFileTree(files);

  return (
    <>
      <div className="field">
        <label className="field-label">Files & Folders</label>
        <div className="file-list">
          {files.length === 0
            ? <div style={{ padding: "8px 10px" }} className="empty-state">No files in workspace</div>
            : <InspectorFileTree nodes={tree} depth={0} paths={paths} onToggle={toggleFiles} />
          }
        </div>
      </div>

      {paths.length > 0 && (
        <div className="field">
          <label className="field-label">Selected</label>
          <div className="tag-list">
            {paths.map((p) => (
              <span key={p} className="tag">
                {p.split(/[/\\]/).pop()}
                <button className="tag-del" onClick={() => toggleFiles([p], true)}><X size={10} /></button>
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function InspectorFileTree({ nodes, depth, paths, onToggle }: {
  nodes: FTNode[];
  depth: number;
  paths: string[];
  onToggle: (files: string[], allSelected: boolean) => void;
}) {
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({});
  const toggleDir = (p: string) => setOpenDirs((s) => ({ ...s, [p]: !s[p] }));

  return (
    <>
      {nodes.map((node) => {
        if (node.type === "dir") {
          const filesUnder = getFilePaths(node);
          const allSel = filesUnder.length > 0 && filesUnder.every((f) => paths.includes(f));
          const someSel = filesUnder.some((f) => paths.includes(f));
          const isOpen = openDirs[node.path] ?? true;
          return (
            <div key={node.path}>
              <div className="ft-row" style={{ paddingLeft: 8 + depth * 12 }}>
                <IndeterminateCheckbox
                  checked={allSel}
                  indeterminate={someSel && !allSel}
                  onChange={() => onToggle(filesUnder, allSel)}
                />
                <button
                  className={`ft-chevron ${isOpen ? "open" : ""}`}
                  onClick={() => toggleDir(node.path)}
                >
                  <ChevronRight size={9} />
                </button>
                <span className="ft-name" onClick={() => toggleDir(node.path)}>{node.name}</span>
              </div>
              {isOpen && (
                <InspectorFileTree nodes={node.children} depth={depth + 1} paths={paths} onToggle={onToggle} />
              )}
            </div>
          );
        }
        return (
          <label key={node.path} className="ft-row" style={{ paddingLeft: 8 + depth * 12 }}>
            <input
              type="checkbox"
              className="ft-check"
              checked={paths.includes(node.path)}
              onChange={() => onToggle([node.path], paths.includes(node.path))}
            />
            <span className="ft-chevron leaf"><ChevronRight size={9} /></span>
            <span className="ft-name">{node.name}</span>
          </label>
        );
      })}
    </>
  );
}

function IndeterminateCheckbox({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate: boolean; onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" className="ft-check" checked={checked} onChange={onChange} />;
}

const RESERVED_VARS = new Set(["input", "previous_output", "timestamp"]);

function extractTemplateVars(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of text.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g)) {
    if (!RESERVED_VARS.has(m[1]) && !seen.has(m[1])) {
      seen.add(m[1]);
      result.push(m[1]);
    }
  }
  return result;
}

function PromptFields({ node, files, patch, workspaceId, refreshFiles }: {
  node: WorkflowNode;
  files: string[];
  patch: (p: Partial<NodeConfig>) => void;
  workspaceId: string;
  refreshFiles: () => void;
}) {
  const [localPrompt, setLocalPrompt] = useState(node.config.prompt ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const source = node.config.prompt_source ?? "inline";
  const promptFiles = files.filter((f) => /\.prompt\.md$/.test(f));
  const [genOpen, setGenOpen] = useState(false);
  const [genDesc, setGenDesc] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState("");
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("prompts/new_prompt.prompt.md");
  const [saveAsError, setSaveAsError] = useState("");
  const [fileContent, setFileContent] = useState<string | null>(null);

  useEffect(() => {
    setLocalPrompt(node.config.prompt ?? "");
  }, [node.id]);

  useEffect(() => {
    if (source === "file" && node.config.prompt_file) {
      readFile(workspaceId, node.config.prompt_file)
        .then((r) => setFileContent(r.content))
        .catch(() => setFileContent(null));
    } else {
      setFileContent(null);
    }
  }, [node.config.prompt_file, source]);

  const templateVars = extractTemplateVars(source === "file" ? (fileContent ?? "") : localPrompt);
  const templateVarValues: Record<string, string> = node.config.template_vars ?? {};

  function handlePromptChange(v: string) {
    setLocalPrompt(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => patch({ prompt: v }), 600);
  }

  async function handleGenerate() {
    if (!genDesc.trim()) return;
    setGenLoading(true);
    setGenError("");
    try {
      const result = await generatePrompt(workspaceId, genDesc.trim());
      refreshFiles();
      patch({ prompt_file: result.path, prompt_source: "file" });
      setGenOpen(false);
      setGenDesc("");
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenLoading(false);
    }
  }

  async function handleSaveAsFile() {
    let name = saveAsName.trim();
    if (!name) { setSaveAsError("Enter a filename."); return; }
    if (!name.endsWith(".prompt.md")) name = name.replace(/\.md$/, "") + ".prompt.md";
    if (!name.includes("/")) name = `prompts/${name}`;
    try {
      await writeFile(workspaceId, name, localPrompt);
      await refreshFiles();
      patch({ prompt_source: "file", prompt_file: name });
      setSaveAsOpen(false);
      setSaveAsName("prompts/new_prompt.prompt.md");
      setSaveAsError("");
    } catch (e) {
      setSaveAsError(e instanceof Error ? e.message : String(e));
    }
  }

  const backendId = node.config.backend ?? "claude-cli";
  const backend = BACKENDS.find((b) => b.id === backendId) ?? BACKENDS[0];
  const currentModel = node.config.model ?? backend.models[0];
  const validModel = backend.models.includes(currentModel) ? currentModel : backend.models[0];

  function handleBackendChange(id: string) {
    const b = BACKENDS.find((x) => x.id === id) ?? BACKENDS[0];
    patch({ backend: id, model: b.models[0] });
  }

  return (
    <>
      <div className="field">
        <label className="field-label">Backend</label>
        <div className="backend-tabs">
          {BACKENDS.map((b) => (
            <button
              key={b.id}
              className={`backend-tab ${b.id === backendId ? "active" : ""}`}
              onClick={() => handleBackendChange(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
        {(backendId === "claude-cli" || backendId === "codex-cli") && (
          <div className="backend-cli-hint">
            Requires <strong>{backendId === "claude-cli" ? "Claude Code" : "Codex"} CLI</strong> installed and authenticated.
            {backendId === "claude-cli" && <> Run <code>npm i -g @anthropic-ai/claude-code</code> then <code>claude login</code>.</>}
          </div>
        )}
      </div>

      <div className="field">
        <label className="field-label">Model</label>
        <select
          className="ctrl"
          value={validModel}
          onChange={(e) => patch({ model: e.target.value })}
        >
          {backend.models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div className="field">
        <label className="field-label">
          Temperature
          <span className="field-hint">{node.config.temperature ?? 0.7}</span>
        </label>
        <div className="range-row">
          <input
            type="range" className="ctrl" min={0} max={1} step={0.05}
            value={node.config.temperature ?? 0.7}
            onChange={(e) => patch({ temperature: parseFloat(e.target.value) })}
          />
        </div>
      </div>

      <div className="field" style={{ flex: 1 }}>
        <div className="prompt-source-row">
          <label className="field-label" style={{ flex: 1 }}>Prompt</label>
          <div className="prompt-source-toggle">
            <button
              className={`prompt-source-btn ${source === "inline" ? "active" : ""}`}
              onClick={() => patch({ prompt_source: "inline" })}
            >Inline</button>
            <button
              className={`prompt-source-btn ${source === "file" ? "active" : ""}`}
              onClick={() => patch({ prompt_source: "file" })}
            >File</button>
          </div>
        </div>

        {source === "file" ? (
          <>
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <select
                className="ctrl"
                style={{ flex: 1 }}
                value={node.config.prompt_file ?? ""}
                onChange={(e) => patch({ prompt_file: e.target.value })}
              >
                <option value="">— pick a file —</option>
                {promptFiles.map((f) => <option key={f} value={f}>{f}</option>)}
                {promptFiles.length === 0 && <option disabled>No .prompt.md files in workspace</option>}
              </select>
              <button
                className="btn btn-sm"
                title="Generate prompt file"
                style={{ flexShrink: 0, padding: "0 8px" }}
                onClick={() => setGenOpen((v) => !v)}
              >
                <Sparkles size={11} />
              </button>
            </div>
            {genOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
                <textarea
                  className="ctrl"
                  placeholder="Describe what this prompt should do…"
                  value={genDesc}
                  autoFocus
                  rows={3}
                  style={{ resize: "none", fontSize: 11, lineHeight: 1.5 }}
                  onChange={(e) => setGenDesc(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
                    if (e.key === "Escape") { setGenOpen(false); setGenDesc(""); setGenError(""); }
                  }}
                />
                {genError && <div style={{ fontSize: 10, color: "#f87171" }}>{genError}</div>}
                <div style={{ display: "flex", gap: 5 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ flex: 1 }}
                    onClick={handleGenerate}
                    disabled={genLoading || !genDesc.trim()}
                  >
                    {genLoading ? <><Loader size={10} className="spin" /> Generating…</> : "Generate  ⌘↵"}
                  </button>
                  <button className="btn btn-sm" onClick={() => { setGenOpen(false); setGenDesc(""); setGenError(""); }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="prompt-inline-hint">{"{{input}}  {{previous_output}}"}</div>
            <div
              className="monaco-wrap"
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
            >
              <Editor
                height="300px"
                defaultLanguage="markdown"
                theme="vs-dark"
                value={localPrompt}
                options={{
                  fontSize: 12,
                  fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
                  minimap: { enabled: false },
                  wordWrap: "on",
                  lineNumbers: "off",
                  scrollBeyondLastLine: false,
                  padding: { top: 10, bottom: 10 },
                  renderLineHighlight: "none",
                }}
                onChange={(v) => handlePromptChange(v ?? "")}
              />
            </div>
            {!saveAsOpen ? (
              <button
                className="btn btn-sm prompt-save-as-btn"
                onClick={() => { setSaveAsName("prompts/new_prompt.prompt.md"); setSaveAsError(""); setSaveAsOpen(true); }}
              >
                Save as prompt file…
              </button>
            ) : (
              <div className="prompt-save-as-form">
                <input
                  className="ctrl ctrl-mono"
                  autoFocus
                  value={saveAsName}
                  onChange={(e) => setSaveAsName(e.target.value)}
                  placeholder="prompts/my_prompt.prompt.md"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveAsFile();
                    if (e.key === "Escape") setSaveAsOpen(false);
                  }}
                />
                {saveAsError && <div className="prompt-save-as-error">{saveAsError}</div>}
                <div style={{ display: "flex", gap: 5 }}>
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleSaveAsFile}>
                    Save &amp; switch to file
                  </button>
                  <button className="btn btn-sm" onClick={() => setSaveAsOpen(false)}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {templateVars.length > 0 && (
        <div className="field">
          <label className="field-label">Variables</label>
          <div className="template-vars">
            {templateVars.map((v) => (
              <div key={v} className="template-var-row">
                <span className="template-var-name">{`{{${v}}}`}</span>
                <input
                  className="ctrl ctrl-mono template-var-input"
                  placeholder={`value…`}
                  value={templateVarValues[v] ?? ""}
                  onChange={(e) => patch({ template_vars: { ...templateVarValues, [v]: e.target.value } })}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <LastOutputSection nodeId={node.id} />
    </>
  );
}

const AGENT_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"];

interface ToolDef {
  id: string;
  name: string;
  description: string;
  params?: { key: string; label: string; placeholder?: string; type?: "string" | "number" }[];
}


function AgentFields({ node, files, patch, workspaceId, refreshFiles }: {
  node: WorkflowNode;
  files: string[];
  patch: (p: Partial<NodeConfig>) => void;
  workspaceId: string;
  refreshFiles: () => void;
}) {
  const [localTask, setLocalTask] = useState(node.config.task ?? "");
  const [localSysPrompt, setLocalSysPrompt] = useState(node.config.agent_system_prompt ?? "");
  const taskDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sysDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const source = node.config.task_source ?? "inline";
  const taskFiles = files.filter((f) => /\.prompt\.md$/.test(f));
  const [genOpen, setGenOpen] = useState(false);
  const [genDesc, setGenDesc] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState("");
  const [taskFileContent, setTaskFileContent] = useState<string | null>(null);
  const model = node.config.model ?? AGENT_MODELS[1];
  const maxIter = node.config.max_iterations ?? 10;
  const showReasoning = node.config.show_reasoning ?? false;

  useEffect(() => {
    setLocalTask(node.config.task ?? "");
    setLocalSysPrompt(node.config.agent_system_prompt ?? "");
  }, [node.id]);

  useEffect(() => {
    if (source === "file" && node.config.task_file) {
      readFile(workspaceId, node.config.task_file)
        .then((r) => setTaskFileContent(r.content))
        .catch(() => setTaskFileContent(null));
    } else {
      setTaskFileContent(null);
    }
  }, [node.config.task_file, source]);

  const taskTemplateVars = extractTemplateVars(source === "file" ? (taskFileContent ?? "") : localTask);
  const taskVarValues: Record<string, string> = node.config.template_vars ?? {};

  function handleTaskChange(v: string) {
    setLocalTask(v);
    if (taskDebounce.current) clearTimeout(taskDebounce.current);
    taskDebounce.current = setTimeout(() => patch({ task: v }), 600);
  }

  function handleSysPromptChange(v: string) {
    setLocalSysPrompt(v);
    if (sysDebounce.current) clearTimeout(sysDebounce.current);
    sysDebounce.current = setTimeout(() => patch({ agent_system_prompt: v }), 600);
  }

  async function handleGenerate() {
    if (!genDesc.trim()) return;
    setGenLoading(true);
    setGenError("");
    try {
      const result = await generatePrompt(workspaceId, genDesc.trim());
      refreshFiles();
      patch({ task_file: result.path, task_source: "file" });
      setGenOpen(false);
      setGenDesc("");
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenLoading(false);
    }
  }

  return (
    <>
      {/* ── Basis ── */}
      <div className="insp-section-label">Basis</div>

      <div className="field">
        <label className="field-label">Model</label>
        <select className="ctrl" value={model} onChange={(e) => patch({ model: e.target.value })}>
          {AGENT_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="backend-cli-hint">
          Runs via <strong>Claude Code CLI</strong> — needs <code>npm i -g @anthropic-ai/claude-code</code> and <code>claude login</code>.
        </div>
      </div>

      <div className="field">
        <label className="field-label">System Prompt</label>
        <div
          className="monaco-wrap"
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
        >
          <Editor
            height="110px"
            defaultLanguage="markdown"
            theme="vs-dark"
            value={localSysPrompt}
            options={{
              fontSize: 12,
              fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
              minimap: { enabled: false },
              wordWrap: "on",
              lineNumbers: "off",
              scrollBeyondLastLine: false,
              padding: { top: 8, bottom: 8 },
              renderLineHighlight: "none",
            }}
            onChange={(v) => handleSysPromptChange(v ?? "")}
          />
        </div>
      </div>

      <div className="field">
        <label className="field-label">
          Max Iterations
          <span className="field-hint">tool calls before abort</span>
        </label>
        <input
          type="number"
          className="ctrl"
          min={1} max={50}
          value={maxIter}
          onChange={(e) => patch({ max_iterations: Math.max(1, parseInt(e.target.value) || 1) })}
          style={{ width: 80 }}
        />
      </div>

      {/* ── Task ── */}
      <div className="insp-section-label">Task</div>

      <div className="field" style={{ flex: 1 }}>
        <div className="prompt-source-row">
          <label className="field-label" style={{ flex: 1 }}>Task</label>
          <div className="prompt-source-toggle">
            <button
              className={`prompt-source-btn ${source === "inline" ? "active" : ""}`}
              onClick={() => patch({ task_source: "inline" })}
            >Inline</button>
            <button
              className={`prompt-source-btn ${source === "file" ? "active" : ""}`}
              onClick={() => patch({ task_source: "file" })}
            >File</button>
          </div>
        </div>

        {source === "file" ? (
          <>
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <select
                className="ctrl"
                style={{ flex: 1 }}
                value={node.config.task_file ?? ""}
                onChange={(e) => patch({ task_file: e.target.value })}
              >
                <option value="">— pick a file —</option>
                {taskFiles.map((f) => <option key={f} value={f}>{f}</option>)}
                {taskFiles.length === 0 && <option disabled>No .prompt.md files in workspace</option>}
              </select>
              <button
                className="btn btn-sm"
                title="Generate task file"
                style={{ flexShrink: 0, padding: "0 8px" }}
                onClick={() => setGenOpen((v) => !v)}
              >
                <Sparkles size={11} />
              </button>
            </div>
            {genOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
                <textarea
                  className="ctrl"
                  placeholder="Describe what the agent should do…"
                  value={genDesc}
                  autoFocus
                  rows={3}
                  style={{ resize: "none", fontSize: 11, lineHeight: 1.5 }}
                  onChange={(e) => setGenDesc(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
                    if (e.key === "Escape") { setGenOpen(false); setGenDesc(""); setGenError(""); }
                  }}
                />
                {genError && <div style={{ fontSize: 10, color: "#f87171" }}>{genError}</div>}
                <div style={{ display: "flex", gap: 5 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ flex: 1 }}
                    onClick={handleGenerate}
                    disabled={genLoading || !genDesc.trim()}
                  >
                    {genLoading ? <><Loader size={10} className="spin" /> Generating…</> : "Generate  ⌘↵"}
                  </button>
                  <button className="btn btn-sm" onClick={() => { setGenOpen(false); setGenDesc(""); setGenError(""); }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="prompt-inline-hint">{"{{input}}  {{previous_output}}"}</div>
            <div
              className="monaco-wrap"
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
            >
              <Editor
                height="200px"
                defaultLanguage="markdown"
                theme="vs-dark"
                value={localTask}
                options={{
                  fontSize: 12,
                  fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
                  minimap: { enabled: false },
                  wordWrap: "on",
                  lineNumbers: "off",
                  scrollBeyondLastLine: false,
                  padding: { top: 10, bottom: 10 },
                  renderLineHighlight: "none",
                }}
                onChange={(v) => handleTaskChange(v ?? "")}
              />
            </div>
          </>
        )}
      </div>

      {/* ── Output ── */}
      <div className="insp-section-label">Output</div>
      <div className="field">
        <div className="tool-row-header">
          <label className="toggle">
            <input type="checkbox" checked={showReasoning} onChange={() => patch({ show_reasoning: !showReasoning })} />
            <span className="toggle-track" />
          </label>
          <div className="tool-info">
            <span className="tool-name">Show reasoning</span>
            <span className="tool-desc">Stream the full thought process, not just final output</span>
          </div>
        </div>
      </div>

      {taskTemplateVars.length > 0 && (
        <div className="field">
          <label className="field-label">Variables</label>
          <div className="template-vars">
            {taskTemplateVars.map((v) => (
              <div key={v} className="template-var-row">
                <span className="template-var-name">{`{{${v}}}`}</span>
                <input
                  className="ctrl ctrl-mono template-var-input"
                  placeholder="value…"
                  value={taskVarValues[v] ?? ""}
                  onChange={(e) => patch({ template_vars: { ...taskVarValues, [v]: e.target.value } })}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <LastOutputSection nodeId={node.id} />
    </>
  );
}

function LastOutputSection({ nodeId }: { nodeId: string }) {
  const lastRun = useStore((s) => s.lastRun);
  const [open, setOpen] = useState(true);

  const text = lastRun?.node_outputs?.[nodeId] ?? lastRun?.output_content ?? null;

  if (!text) return null;

  return (
    <div className="field">
      <button className="last-output-header" onClick={() => setOpen((v) => !v)}>
        <span className="field-label" style={{ flex: 1 }}>Last output</span>
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
      {open && (
        <div className="last-output-body">
          <div className="md-prose">
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

function OutputFields({ node, patch }: { node: WorkflowNode; patch: (p: Partial<NodeConfig>) => void }) {
  const folder = node.config.output_folder ?? "";
  const [localFilename, setLocalFilename] = useState(node.config.output_filename ?? "output_{{timestamp}}.md");

  useEffect(() => {
    setLocalFilename(node.config.output_filename ?? "output_{{timestamp}}.md");
  }, [node.id]);

  async function handlePickFolder() {
    const { path } = await pickFolder();
    if (path) patch({ output_folder: path });
  }

  return (
    <>
      <div className="field">
        <label className="field-label">Output folder</label>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <div
            className="ctrl ctrl-mono"
            style={{
              flex: 1, cursor: "pointer", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
              color: folder ? "var(--text-primary)" : "var(--text-muted)",
              fontSize: 11,
            }}
            onClick={handlePickFolder}
            title={folder || "Click to choose folder"}
          >
            {folder || "Click to choose…"}
          </div>
          <button className="btn btn-sm" onClick={handlePickFolder} title="Browse">
            <FolderOpen size={11} />
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field-label">
          Filename
          <span className="field-hint">{"{{timestamp}}"}</span>
        </label>
        <input
          className="ctrl ctrl-mono"
          value={localFilename}
          onChange={(e) => setLocalFilename(e.target.value)}
          onBlur={() => patch({ output_filename: localFilename })}
          placeholder="output_{{timestamp}}.md"
        />
      </div>

      <LastOutputSection nodeId={node.id} />
    </>
  );
}

function NotionSetupCallout() {
  return (
    <div className="notion-setup-callout">
      <div className="notion-setup-title">Notion not connected</div>
      <ol className="notion-setup-steps">
        <li>
          <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer" className="notion-setup-link">
            Create a Notion integration ↗
          </a>
          {" "}and copy the token
        </li>
        <li>Add it in <strong>Settings</strong> (gear icon, top right)</li>
        <li>In Notion: page → Share → invite your integration</li>
      </ol>
    </div>
  );
}

function NotionInputFields({ node, patch }: { node: WorkflowNode; patch: (p: Partial<NodeConfig>) => void }) {
  const hasToken = useStore((s) => !!s.notionToken);
  const workspaceId = useStore((s) => s.activeWorkspaceId);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; title: string; url: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedTitle = node.config.page_title;
  const selectedId = node.config.page_url;

  // close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function openAndSearch(q: string) {
    setQuery(q);
    setOpen(true);
    setSearchError("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!workspaceId) return;
      setLoading(true);
      try {
        const r = await searchNotionPages(workspaceId, q);
        setResults(r);
      } catch (e) {
        setResults([]);
        setSearchError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function selectPage(p: { id: string; title: string }) {
    patch({ page_url: p.id, page_title: p.title });
    setOpen(false);
    setQuery("");
  }

  function clearPage() {
    patch({ page_url: undefined, page_title: undefined });
  }

  return (
    <>
      {!hasToken && <NotionSetupCallout />}
      <div className="field" ref={wrapperRef} style={{ position: "relative" }}>
        <label className="field-label">Notion Page</label>

        {selectedId && selectedTitle ? (
          <div className="notion-selected-page">
            <NotionIcon size={16} />
            <span className="notion-selected-title">{selectedTitle}</span>
            <button className="tag-del" onClick={clearPage} title="Remove"><X size={12} /></button>
          </div>
        ) : (
          <div className="notion-search-wrap">
            <Search size={12} className="notion-search-icon" />
            <input
              className="ctrl notion-search-input"
              placeholder="Search pages…"
              value={query}
              onChange={(e) => openAndSearch(e.target.value)}
              onFocus={() => openAndSearch(query)}
              disabled={!hasToken}
            />
          </div>
        )}

        {open && !selectedId && (
          <div className="notion-dropdown">
            {loading && <div className="notion-dropdown-item notion-dropdown-hint">Searching…</div>}
            {!loading && searchError && (
              <div className="notion-dropdown-item notion-dropdown-hint" style={{ color: "#f87171" }}>{searchError}</div>
            )}
            {!loading && !searchError && results.length === 0 && (
              <div className="notion-dropdown-item notion-dropdown-hint">
                No pages found — make sure you've shared pages with your integration in Notion
              </div>
            )}
            {!loading && results.map((r) => (
              <button key={r.id} className="notion-dropdown-item" onClick={() => selectPage(r)}>
                <NotionIcon size={14} />
                <span className="notion-dd-title">{r.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function NotionOutputFields({ node, patch }: { node: WorkflowNode; patch: (p: Partial<NodeConfig>) => void }) {
  const hasToken = useStore((s) => !!s.notionToken);
  return (
    <>
      {!hasToken && <NotionSetupCallout />}
      <div className="field">
        <label className="field-label">Target Database URL</label>
        <input
          className="ctrl ctrl-mono"
          value={node.config.database_url ?? ""}
          onChange={(e) => patch({ database_url: e.target.value })}
          placeholder="https://notion.so/your-database-id"
        />
      </div>
      <div className="field">
        <label className="field-label">
          Page title
          <span className="field-hint">{"{{timestamp}}"}</span>
        </label>
        <input
          className="ctrl"
          value={node.config.title_template ?? "Hexis output {{timestamp}}"}
          onChange={(e) => patch({ title_template: e.target.value })}
          placeholder="Hexis output {{timestamp}}"
        />
      </div>
    </>
  );
}

function WorkflowRefFields({ node, patch }: { node: WorkflowNode; patch: (p: Partial<NodeConfig>) => void }) {
  const workflows = useStore((s) => s.workflows);
  const activeWorkflow = useStore((s) => s.activeWorkflow);
  const available = workflows.filter((w) => w.id !== activeWorkflow?.id);

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    const name = available.find((w) => w.id === id)?.name ?? "";
    patch({ ref_workflow_id: id || undefined, ref_workflow_name: name || undefined });
  }

  return (
    <div className="field">
      <label className="field-label">Source Workflow</label>
      <select
        className="ctrl"
        value={node.config.ref_workflow_id ?? ""}
        onChange={handleSelect}
      >
        <option value="">— select workflow —</option>
        {available.map((w) => (
          <option key={w.id} value={w.id}>{w.name}</option>
        ))}
      </select>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
        Injects the latest output of the selected workflow as input to this one.
      </div>
    </div>
  );
}
