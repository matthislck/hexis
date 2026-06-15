import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Play, Loader } from "lucide-react";
import { Settings } from "./Settings";
import { useStore } from "./store";
import { streamRun, updateWorkflow, readFile, listRuns, getRun, getGitStatus, getGitLog, saveUserTemplate } from "./api";
import { Sidebar } from "./Sidebar";
import { TabArea } from "./TabArea";
import { Inspector } from "./Inspector";
import { RunView } from "./RunView";
import { ToastStack } from "./Toast";
import { computeStaleness } from "./staleness";
import "./App.css";

export default function App() {
  const {
    activeWorkflow, activeWorkspaceId,
    isRunning, setIsRunning,
    appendRunOutput, setRunStatus, clearRunOutput,
    setRuns, runs,
    selectedNodeId, setSelectedNodeId,
    setActiveRun, activeRun,
    addToast, triggerNewWorkflow,
    setStaleness, staleness,
    setRunningNodeId,
    setLastRun, lastRun,
    setShowRunPanel,
    activeTabPath,
    triggerSave,
    setGitStatus,
    setGitLog,
  } = useStore();

  // Cached file contents — updated when workflow changes or input paths change
  const fileContentsRef = useRef<Record<string, string>>({});

  // Heavy effect: fetch runs + read all input files when workflow ID changes
  useEffect(() => {
    if (!activeWorkflow || !activeWorkspaceId) return;
    (async () => {
      const runsData = await listRuns(activeWorkspaceId).catch(() => []);
      const lastRunRecord = runsData[0] ? await getRun(activeWorkspaceId, runsData[0].id).catch(() => null) : null;
      if (lastRunRecord) setLastRun(lastRunRecord);
      const filePaths = activeWorkflow.nodes
        .filter((n) => n.type === "input")
        .flatMap((n) => n.config.paths ?? []);
      const fileContents: Record<string, string> = {};
      await Promise.all(filePaths.map(async (p) => {
        const f = await readFile(activeWorkspaceId, p).catch(() => null);
        if (f) fileContents[p] = f.content;
      }));
      fileContentsRef.current = fileContents;
      setStaleness(computeStaleness(activeWorkflow, lastRunRecord, fileContents));
    })();
  }, [activeWorkflow?.id]);

  // Light effect: recompute staleness on any config change (prompt edits, path changes, etc.)
  // Uses cached lastRun + fileContents — no network calls needed for prompt-only changes
  const nodeConfigsKey = useMemo(
    () => activeWorkflow?.nodes.map((n) => `${n.id}:${JSON.stringify(n.config)}`).join("|") ?? "",
    [activeWorkflow?.nodes],
  );
  useEffect(() => {
    if (!activeWorkflow || !activeWorkspaceId) return;
    const inputPaths = activeWorkflow.nodes
      .filter((n) => n.type === "input")
      .flatMap((n) => n.config.paths ?? []);
    const missingPaths = inputPaths.filter((p) => !(p in fileContentsRef.current));
    if (missingPaths.length > 0) {
      // Input paths changed — read only the new files then recompute
      (async () => {
        const extra: Record<string, string> = {};
        await Promise.all(missingPaths.map(async (p) => {
          const f = await readFile(activeWorkspaceId, p).catch(() => null);
          if (f) extra[p] = f.content;
        }));
        fileContentsRef.current = { ...fileContentsRef.current, ...extra };
        setStaleness(computeStaleness(activeWorkflow, lastRun, fileContentsRef.current));
      })();
    } else {
      setStaleness(computeStaleness(activeWorkflow, lastRun, fileContentsRef.current));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeConfigsKey]);

  const stopRef = useRef<(() => void) | null>(null);
  const stalenessRef = useRef(staleness);
  useEffect(() => { stalenessRef.current = staleness; }, [staleness]);

  const handleRun = useCallback(() => {
    if (!activeWorkflow || !activeWorkspaceId || isRunning) return;
    clearRunOutput();
    setIsRunning(true);
    setRunStatus("Starting…");
    setShowRunPanel(true);

    stopRef.current = streamRun(
      activeWorkspaceId,
      activeWorkflow.id,
      (chunk) => appendRunOutput(chunk),
      (msg) => setRunStatus(msg),
      (record) => {
        setIsRunning(false);
        setRunStatus("");
        setRunningNodeId(null);
        setRuns([record, ...runs]);
        setLastRun(record);
        const secs = (record.duration_ms / 1000).toFixed(1);
        const tokens = record.token_count > 0 ? ` · ${record.token_count.toLocaleString()} tokens` : "";
        addToast({ type: "success", message: "Run complete", sub: `${secs}s${tokens}` });
        if (activeWorkflow) {
          // non-deterministic nodes always re-run; deterministic nodes are fresh after a successful run
          const ALWAYS_STALE = new Set(["agent", "notion-input", "notion-output", "workflow-ref"]);
          setStaleness(Object.fromEntries(
            activeWorkflow.nodes.map((n) => [n.id, ALWAYS_STALE.has(n.type) ? "stale" as const : "fresh" as const])
          ));
        }
        // refresh git state after run (auto-commit may have happened)
        if (activeWorkspaceId) {
          getGitStatus(activeWorkspaceId).then(setGitStatus).catch(() => {});
          getGitLog(activeWorkspaceId).then(setGitLog).catch(() => {});
        }
      },
      (err) => {
        setIsRunning(false);
        setRunStatus("");
        setRunningNodeId(null);
        addToast({ type: "error", message: "Run failed", sub: err });
      },
      (msg) => {
        addToast({ type: "warning", message: msg });
      },
      stalenessRef.current,
      (nid) => setRunningNodeId(nid),
    );
  }, [activeWorkflow, activeWorkspaceId, isRunning]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "r") { e.preventDefault(); handleRun(); }
      if (mod && e.key === "n") { e.preventDefault(); triggerNewWorkflow(); }
      if (mod && e.key === "s") { e.preventDefault(); triggerSave(); }
      if (e.key === "Escape") {
        if (activeRun) setActiveRun(null);
        else setSelectedNodeId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleRun, activeRun, selectedNodeId, triggerSave]);

  const [showSettings, setShowSettings] = useState(false);
  const [localName, setLocalName] = useState(activeWorkflow?.name ?? "");
  useEffect(() => { setLocalName(activeWorkflow?.name ?? ""); }, [activeWorkflow?.id]);

  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDesc, setTemplateDesc] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  async function handleSaveTemplate() {
    if (!activeWorkflow || !templateName.trim()) return;
    setSavingTemplate(true);
    try {
      const idToIndex: Record<string, number> = {};
      activeWorkflow.nodes.forEach((n, i) => { idToIndex[n.id] = i; });
      const nodes = activeWorkflow.nodes.map((n) => ({
        type: n.type,
        position: n.position,
        config: n.config as Record<string, unknown>,
      }));
      const edges = activeWorkflow.edges.map((e) => ({
        source: `node_${idToIndex[e.source] ?? e.source}`,
        target: `node_${idToIndex[e.target] ?? e.target}`,
      }));
      await saveUserTemplate({ name: templateName.trim(), description: templateDesc.trim(), nodes, edges });
      addToast({ type: "success", message: "Template saved" });
      setShowSaveTemplate(false);
      setTemplateName("");
      setTemplateDesc("");
    } catch (e) {
      addToast({ type: "error", message: "Failed to save template", sub: String(e) });
    }
    setSavingTemplate(false);
  }

  async function handleRename(name: string) {
    if (!activeWorkflow || !activeWorkspaceId) return;
    const updated = { ...activeWorkflow, name };
    try {
      await updateWorkflow(activeWorkspaceId, activeWorkflow.id, updated);
      const s = useStore.getState();
      s.setActiveWorkflow(updated);
      s.setWorkflows(s.workflows.map((w) => w.id === updated.id ? { ...w, name } : w));
    } catch {}
  }

  const showInspector = activeTabPath === null && !!selectedNodeId;

  return (
    <div className="app">
      <div className="main-layout">
        <Sidebar onOpenSettings={() => setShowSettings(true)} />
        <div className="content-area">
          {activeWorkflow && (
            <div className="content-topbar">
              <input
                className="workflow-name-input"
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                onBlur={() => handleRename(localName)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                placeholder="Workflow name"
              />
              <button
                className="btn btn-sm topbar-save-template-btn"
                onClick={() => { setTemplateName(localName); setTemplateDesc(""); setShowSaveTemplate(true); }}
                title="Save as template"
              >
                Save as template
              </button>
              <button
                className={`run-btn ${isRunning ? "running" : ""}`}
                onClick={handleRun}
                disabled={isRunning}
                title="Run (Ctrl+R)"
              >
                <span className="run-btn-icon">{isRunning ? <Loader size={13} className="spin" /> : <Play size={13} />}</span>
                {isRunning ? "Running…" : "Run"}
              </button>
            </div>
          )}
          <div className="content-body">
            <TabArea />
            {showInspector && <Inspector />}
          </div>
        </div>
      </div>

      {activeRun && <RunView />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {showSaveTemplate && (
        <div className="modal-backdrop" onClick={() => setShowSaveTemplate(false)}>
          <div className="save-template-modal" onClick={(e) => e.stopPropagation()}>
            <div className="save-template-header">
              <span>Save as template</span>
              <button className="inspector-close" onClick={() => setShowSaveTemplate(false)}>✕</button>
            </div>
            <div className="save-template-body">
              <label className="field-label">Name</label>
              <input
                className="ctrl"
                autoFocus
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Template name"
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveTemplate(); if (e.key === "Escape") setShowSaveTemplate(false); }}
              />
              <label className="field-label" style={{ marginTop: 8 }}>Description</label>
              <input
                className="ctrl"
                value={templateDesc}
                onChange={(e) => setTemplateDesc(e.target.value)}
                placeholder="What does this workflow do?"
                onKeyDown={(e) => { if (e.key === "Escape") setShowSaveTemplate(false); }}
              />
              <div className="save-template-actions">
                <button
                  className="btn btn-primary btn-sm"
                  style={{ flex: 1 }}
                  onClick={handleSaveTemplate}
                  disabled={!templateName.trim() || savingTemplate}
                >
                  {savingTemplate ? "Saving…" : "Save template"}
                </button>
                <button className="btn btn-sm" onClick={() => setShowSaveTemplate(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ToastStack />
    </div>
  );
}
