import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Check, FileText, Folder, GitBranch, ArrowUp, Sparkles, Pencil, Settings2, Trash2 } from "lucide-react";
import { useStore } from "./store";
import {
  getWorkspaces, addWorkspace, deleteWorkspace,
  listWorkflows, createWorkflow, getWorkflow, deleteWorkflow,
  listFiles, readFile, createFile, deleteFile,
  listRuns,
  getNotionToken, getAnthropicKey, getOpenaiKey, getGeminiKey,
  getGitStatus, getGitLog, initGitRepo, gitCommit,
  generateWorkflow, pickFolder, getDefaultRoot, listPrompts,
} from "./api";
import { TemplatePicker } from "./TemplatePicker";
import type { WorkflowTemplate } from "./templates";
import { buildFileTree, type FTNode } from "./fileTree";

type Panel = "workflows" | "files" | "prompts" | "git";

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const {
    workspaces, setWorkspaces,
    activeWorkspaceId, setActiveWorkspace,
    workflows, setWorkflows,
    activeWorkflow, setActiveWorkflow,
    setRuns,
    openFileTab, activeTabPath, closeFileTab,
    gitStatus, gitLog, setGitStatus, setGitLog,
  } = useStore();

  const [activePanel, setActivePanel] = useState<Panel>("workflows");
  const [committing, setCommitting] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [creatingFile, setCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [prompts, setPrompts] = useState<{ path: string; used_in: { id: string; name: string }[] }[]>([]);
  const [creatingPrompt, setCreatingPrompt] = useState(false);
  const [newPromptName, setNewPromptName] = useState("");

  const newWorkflowTrigger = useStore((s) => s.newWorkflowTrigger);
  const [wsOpen, setWsOpen] = useState(false);
  const [addingWs, setAddingWs] = useState(false);
  const [wsName, setWsName] = useState("");
  const [wsPath, setWsPath] = useState("");
  const [wsCustomPath, setWsCustomPath] = useState(false);
  const [defaultRoot, setDefaultRoot] = useState("");
  const [deletingWsId, setDeletingWsId] = useState<string | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  async function pickWsFolder() {
    const { path } = await pickFolder();
    if (path) {
      setWsPath(path);
      if (!wsName) setWsName(path.split(/[/\\]/).filter(Boolean).pop() ?? "");
    }
  }

  function openAddWs() {
    setAddingWs(true);
    setWsCustomPath(false);
    setWsPath("");
    setWsName("");
    getDefaultRoot().then((r) => setDefaultRoot(r.path)).catch(() => {});
  }
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const wsRef = useRef<HTMLDivElement>(null);

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);

  useEffect(() => {
    getWorkspaces().then(setWorkspaces).catch(() => {});
  }, []);

  useEffect(() => {
    if (newWorkflowTrigger > 0) setShowTemplatePicker(true);
  }, [newWorkflowTrigger]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    listWorkflows(activeWorkspaceId).then(setWorkflows).catch(() => setWorkflows([]));
    listPrompts(activeWorkspaceId).then(setPrompts).catch(() => setPrompts([]));
    listRuns(activeWorkspaceId).then(setRuns).catch(() => setRuns([]));
    listFiles(activeWorkspaceId).then(setWorkspaceFiles).catch(() => setWorkspaceFiles([]));
    refreshGit(activeWorkspaceId);
    const store = useStore.getState();
    getNotionToken(activeWorkspaceId).then((r) => store.setNotionToken(r.token)).catch(() => {});
    getAnthropicKey(activeWorkspaceId).then((r) => store.setAnthropicKey(r.key)).catch(() => {});
    getOpenaiKey(activeWorkspaceId).then((r) => store.setOpenaiKey(r.key)).catch(() => {});
    getGeminiKey(activeWorkspaceId).then((r) => store.setGeminiKey(r.key)).catch(() => {});
  }, [activeWorkspaceId]);

  async function refreshGit(wid: string) {
    getGitStatus(wid).then(setGitStatus).catch(() => setGitStatus(null));
    getGitLog(wid).then(setGitLog).catch(() => setGitLog([]));
  }

  async function handleInitGit() {
    if (!activeWorkspaceId) return;
    await initGitRepo(activeWorkspaceId);
    refreshGit(activeWorkspaceId);
  }

  async function handleManualCommit() {
    if (!activeWorkspaceId || !commitMsg.trim()) return;
    setCommitting(true);
    try {
      await gitCommit(activeWorkspaceId, commitMsg.trim());
      setCommitMsg("");
      refreshGit(activeWorkspaceId);
    } finally {
      setCommitting(false);
    }
  }

  async function handleSelectFile(path: string) {
    if (!activeWorkspaceId) return;
    try {
      const f = await readFile(activeWorkspaceId, path);
      openFileTab(f.path, f.content);
    } catch {}
  }

  async function handleCreateFile() {
    if (!activeWorkspaceId || !newFileName.trim()) return;
    const name = newFileName.trim();
    try {
      await createFile(activeWorkspaceId, name);
      const files = await listFiles(activeWorkspaceId);
      setWorkspaceFiles(files);
      setCreatingFile(false);
      setNewFileName("");
      openFileTab(name, "");
    } catch (e) { alert(String(e)); }
  }

  async function handleDeleteFile(path: string) {
    if (!activeWorkspaceId) return;
    // Normalize to forward slashes so the URL is valid on Windows
    const normalizedPath = path.replace(/\\/g, "/");
    try {
      await deleteFile(activeWorkspaceId, normalizedPath);
      // Remove immediately — don't wait for a re-fetch
      setWorkspaceFiles((prev) => prev.filter((f) => f.replace(/\\/g, "/") !== normalizedPath));
      closeFileTab(path);
      // Re-fetch in background to stay in sync
      listFiles(activeWorkspaceId).then(setWorkspaceFiles).catch(() => {});
    } catch (e) { alert(String(e)); }
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wsRef.current && !wsRef.current.contains(e.target as Node)) setWsOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleDeleteWorkspace(wid: string) {
    try {
      await deleteWorkspace(wid);
      const next = workspaces.filter((w) => w.id !== wid);
      setWorkspaces(next);
      if (activeWorkspaceId === wid) setActiveWorkspace(next[0]?.id ?? null);
      setDeletingWsId(null);
      setDeleteConfirmName("");
    } catch (e) { alert(String(e)); }
  }

  async function handleAddWorkspace() {
    if (!wsName) return;
    try {
      const ws = await addWorkspace(wsName, wsCustomPath ? wsPath : "");
      setWorkspaces([...workspaces, ws]);
      setActiveWorkspace(ws.id);
      setAddingWs(false);
      setWsName(""); setWsPath("");
      setWsOpen(false);
    } catch (e) { alert(String(e)); }
  }

  async function handleSelectWorkflow(wfid: string) {
    if (!activeWorkspaceId) return;
    const wf = await getWorkflow(activeWorkspaceId, wfid);
    setActiveWorkflow(wf);
  }

  async function handleNewWorkflow(template: WorkflowTemplate | null = null) {
    if (!activeWorkspaceId) return;
    setShowTemplatePicker(false);
    let payload: Record<string, unknown>;
    if (template) {
      const idMap: Record<string, string> = {};
      template.nodes.forEach((_, i) => { idMap[`node_${i}`] = `node_${Date.now() + i}`; });
      payload = {
        name: template.name,
        nodes: template.nodes.map((n, i) => ({
          id: idMap[`node_${i}`],
          type: n.type,
          position: n.position,
          config: n.config,
        })),
        edges: template.edges.map((e) => ({
          source: idMap[e.source] ?? e.source,
          target: idMap[e.target] ?? e.target,
        })),
      };
    } else {
      payload = { name: "Untitled workflow", nodes: [], edges: [] };
    }
    const wf = await createWorkflow(activeWorkspaceId, payload);
    setWorkflows([...workflows, { id: wf.id, name: wf.name, version: wf.version }]);
    setActiveWorkflow(wf);
  }

  async function handleGenerateWorkflow(description: string) {
    if (!activeWorkspaceId) return;
    const generated = await generateWorkflow(activeWorkspaceId, description);
    setShowTemplatePicker(false);
    const wf = await createWorkflow(activeWorkspaceId, generated);
    setWorkflows([...workflows, { id: wf.id, name: wf.name, version: wf.version }]);
    setActiveWorkflow(wf);
  }

  async function handleCreatePromptFile() {
    if (!activeWorkspaceId || !newPromptName.trim()) return;
    let name = newPromptName.trim();
    if (!name.endsWith(".prompt.md")) name = name.replace(/\.md$/, "") + ".prompt.md";
    if (!name.includes("/")) name = `prompts/${name}`;
    try {
      await createFile(activeWorkspaceId, name);
      const files = await listFiles(activeWorkspaceId);
      setWorkspaceFiles(files);
      const updated = await import("./api").then((m) => m.listPrompts(activeWorkspaceId));
      setPrompts(updated);
      setCreatingPrompt(false);
      setNewPromptName("");
      openFileTab(name, "");
    } catch (e) { alert(String(e)); }
  }

  async function handleDeleteWorkflow(wfid: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!activeWorkspaceId || !confirm("Delete this workflow?")) return;
    await deleteWorkflow(activeWorkspaceId, wfid);
    setWorkflows(workflows.filter((w) => w.id !== wfid));
    if (activeWorkflow?.id === wfid) setActiveWorkflow(null);
  }

  return (
    <div className="sidebar">

      {/* ── Activity bar ── */}
      <div className="activity-bar">
        <button
          className={`activity-btn ${activePanel === "workflows" ? "active" : ""}`}
          onClick={() => setActivePanel("workflows")}
          title="Workflows"
        >
          <svg width="19" height="19" viewBox="0 0 18 18" fill="none">
            <rect x="1.5" y="1.5" width="15" height="15" rx="3" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M5.5 7h7M5.5 11h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
        <button
          className={`activity-btn ${activePanel === "files" ? "active" : ""}`}
          onClick={() => setActivePanel("files")}
          title="Explorer"
        >
          <FileText size={19} strokeWidth={1.6} />
        </button>
        <button
          className={`activity-btn ${activePanel === "prompts" ? "active" : ""}`}
          onClick={() => setActivePanel("prompts")}
          title="Prompts"
        >
          <Sparkles size={19} strokeWidth={1.6} />
        </button>
        <button
          className={`activity-btn ${activePanel === "git" ? "active" : ""}`}
          onClick={() => { setActivePanel("git"); if (activeWorkspaceId) refreshGit(activeWorkspaceId); }}
          title="Git"
        >
          <GitBranch size={19} strokeWidth={1.6} />
          {gitStatus?.is_repo && !gitStatus.clean && <span className="activity-badge" />}
        </button>
        <div className="activity-spacer" />
        <button className="activity-btn" onClick={onOpenSettings} title="Settings">
          <Settings2 size={19} strokeWidth={1.6} />
        </button>
      </div>

      {/* ── Sidebar panel ── */}
      <div className="sidebar-panel">

        {/* Workspace picker */}
        <div className="ws-selector-wrap" ref={wsRef}>
          <button className="ws-selector" onClick={() => setWsOpen((v) => !v)}>
            <span className="ws-selector-icon">{activeWs?.name?.[0]?.toUpperCase() ?? "W"}</span>
            <span className="ws-selector-name">{activeWs?.name ?? "Select workspace"}</span>
            <ChevronDown size={12} className={`ws-chevron ${wsOpen ? "open" : ""}`} />
          </button>

          {wsOpen && (
            <div className="ws-dropdown">
              {workspaces.map((w) => (
                <div key={w.id} className="ws-dropdown-row">
                  {deletingWsId === w.id ? (
                    <div className="ws-delete-confirm">
                      <span className="ws-delete-confirm-label">Type <strong>{w.name}</strong> to delete</span>
                      <input
                        className="ctrl"
                        autoFocus
                        value={deleteConfirmName}
                        onChange={(e) => setDeleteConfirmName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && deleteConfirmName === w.name) handleDeleteWorkspace(w.id);
                          if (e.key === "Escape") { setDeletingWsId(null); setDeleteConfirmName(""); }
                        }}
                        placeholder={w.name}
                      />
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          className="btn btn-sm"
                          style={{ flex: 1, color: "#f87171", borderColor: "rgba(248,113,113,0.3)" }}
                          disabled={deleteConfirmName !== w.name}
                          onClick={() => handleDeleteWorkspace(w.id)}
                        >
                          Delete
                        </button>
                        <button className="btn btn-sm" onClick={() => { setDeletingWsId(null); setDeleteConfirmName(""); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="ws-dropdown-item"
                      onClick={() => { setActiveWorkspace(w.id); setWsOpen(false); }}
                    >
                      <span className="ws-dropdown-icon">{w.name[0].toUpperCase()}</span>
                      <span className="ws-dropdown-name">{w.name}</span>
                      {w.id === activeWorkspaceId && <Check size={12} className="ws-dropdown-check" />}
                      <button
                        className="ws-delete-btn"
                        title="Delete workspace"
                        onClick={(e) => { e.stopPropagation(); setDeletingWsId(w.id); setDeleteConfirmName(""); }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <div className="ws-dropdown-divider" />
              {addingWs ? (
                <div className="ws-add-form">
                  <input
                    className="ctrl"
                    placeholder="Workspace name"
                    value={wsName}
                    autoFocus
                    onChange={(e) => setWsName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddWorkspace(); if (e.key === "Escape") setAddingWs(false); }}
                  />
                  {defaultRoot && !wsCustomPath && (
                    <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", padding: "1px 2px" }}>
                      {defaultRoot}\{wsName || "…"}
                    </div>
                  )}
                  {wsCustomPath && (
                    <div style={{ display: "flex", gap: 5 }}>
                      <div
                        className="ctrl ctrl-mono"
                        style={{ flex: 1, cursor: "pointer", fontSize: 11, color: wsPath ? "var(--text-primary)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        onClick={pickWsFolder}
                      >
                        {wsPath || "Choose folder…"}
                      </div>
                      <button className="btn btn-sm" onClick={pickWsFolder}><Folder size={11} /></button>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleAddWorkspace} disabled={!wsName}>Add</button>
                    <button className="btn btn-sm" onClick={() => setWsCustomPath((v) => !v)} title="Custom folder">
                      <Folder size={11} />
                    </button>
                    <button className="btn btn-sm" onClick={() => setAddingWs(false)}>✕</button>
                  </div>
                </div>
              ) : (
                <button className="ws-dropdown-item ws-add-btn" onClick={openAddWs}>
                  <Plus size={12} />
                  <span>New workspace</span>
                </button>
              )}
            </div>
          )}
        </div>

        {activeWorkspaceId && (
          <>
            {/* Panel header */}
            <div className="panel-header">
              <span className="panel-title">
                {activePanel === "workflows" ? "Workflows" : activePanel === "files" ? "Explorer" : activePanel === "prompts" ? "Prompts" : "Git"}
              </span>
              {activePanel === "workflows" && (
                <button className="panel-action" onClick={() => setShowTemplatePicker(true)} title="New workflow">
                  <Plus size={12} />
                </button>
              )}
              {activePanel === "files" && !creatingFile && (
                <button className="panel-action" onClick={() => setCreatingFile(true)} title="New file">
                  <Plus size={12} />
                </button>
              )}
              {activePanel === "prompts" && !creatingPrompt && (
                <button className="panel-action" onClick={() => { setCreatingPrompt(true); setNewPromptName(""); }} title="New prompt">
                  <Plus size={12} />
                </button>
              )}
              {activePanel === "git" && !gitStatus?.is_repo && (
                <button className="panel-action" onClick={handleInitGit} title="git init">
                  <GitBranch size={12} />
                </button>
              )}
            </div>

            {/* Scrollable content */}
            <div className="sidebar-body">

              {activePanel === "workflows" && (
                workflows.length === 0
                  ? <span className="sb-empty">No workflows yet</span>
                  : workflows.map((wf) => (
                    <div
                      key={wf.id}
                      className={`sidebar-item ${activeWorkflow?.id === wf.id ? "active" : ""}`}
                      onClick={() => handleSelectWorkflow(wf.id)}
                    >
                      <span className="sidebar-item-name">{wf.name}</span>
                      <button className="sidebar-item-del" onClick={(e) => handleDeleteWorkflow(wf.id, e)}>✕</button>
                    </div>
                  ))
              )}

              {activePanel === "files" && (
                <>
                  {workspaceFiles.length === 0 && !creatingFile
                    ? <span className="sb-empty">No files yet</span>
                    : <SidebarFileTree
                        nodes={buildFileTree(workspaceFiles)}
                        depth={0}
                        selectedFilePath={activeTabPath}
                        onSelect={handleSelectFile}
                        onDelete={handleDeleteFile}
                      />
                  }
                  {creatingFile && (
                    <div className="sb-inline-create">
                      <input
                        className="sb-inline-input"
                        placeholder="filename.md"
                        value={newFileName}
                        autoFocus
                        onChange={(e) => setNewFileName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCreateFile();
                          if (e.key === "Escape") { setCreatingFile(false); setNewFileName(""); }
                        }}
                      />
                    </div>
                  )}
                </>
              )}

              {activePanel === "prompts" && (
                <>
                  {prompts.length === 0 && !creatingPrompt
                    ? <span className="sb-empty">No .prompt.md files yet</span>
                    : prompts.map((p) => {
                        const name = p.path.split(/[/\\]/).pop() ?? p.path;
                        const displayName = name.replace(/\.prompt\.md$/, "");
                        return (
                          <div
                            key={p.path}
                            className={`sidebar-item prompt-item ${activeTabPath === p.path ? "active" : ""}`}
                            onClick={() => handleSelectFile(p.path)}
                          >
                            <div className="prompt-item-header">
                              <Sparkles size={10} strokeWidth={1.8} style={{ opacity: 0.55, flexShrink: 0 }} />
                              <span className="sidebar-item-name">{displayName}</span>
                            </div>
                            {p.used_in.length > 0 && (
                              <div className="prompt-used-in">
                                {p.used_in.map((wf) => (
                                  <span key={wf.id} className="prompt-badge">{wf.name}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                  }
                  {creatingPrompt && (
                    <div className="sb-inline-create">
                      <input
                        className="sb-inline-input"
                        placeholder="name.prompt.md"
                        value={newPromptName}
                        autoFocus
                        onChange={(e) => setNewPromptName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCreatePromptFile();
                          if (e.key === "Escape") { setCreatingPrompt(false); setNewPromptName(""); }
                        }}
                      />
                    </div>
                  )}
                </>
              )}

              {activePanel === "git" && (
                !gitStatus?.is_repo ? (
                  <span className="sb-empty">No repository — click ⎇ to init</span>
                ) : gitLog.length === 0 ? (
                  <span className="sb-empty">No commits yet</span>
                ) : (
                  gitLog.map((c) => {
                    const isHexis = c.message.startsWith("hexis:");
                    return (
                      <div key={c.hash} className={`git-feed-item ${isHexis ? "hexis" : ""}`}>
                        <div className="git-feed-top">
                          <span className="git-feed-icon">{isHexis ? "✦" : "○"}</span>
                          <span className="git-feed-msg">
                            {isHexis ? c.message.replace(/^hexis:\s*/, "") : c.message}
                          </span>
                        </div>
                        <div className="git-feed-meta">
                          <code className="git-feed-hash">{c.short_hash}</code>
                          <span className="git-feed-time">{relativeTime(c.timestamp)}</span>
                        </div>
                      </div>
                    );
                  })
                )
              )}
            </div>

            {/* Git commit footer */}
            {activePanel === "git" && gitStatus?.is_repo && !gitStatus.clean && (
              <div className="git-commit-footer">
                <input
                  className="git-commit-input"
                  placeholder="Commit message…"
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleManualCommit(); }}
                />
                <button
                  className="git-commit-send"
                  onClick={handleManualCommit}
                  disabled={committing || !commitMsg.trim()}
                  title="Commit"
                >
                  <ArrowUp size={12} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showTemplatePicker && (
        <TemplatePicker
          onSelect={(t) => handleNewWorkflow(t)}
          onGenerate={handleGenerateWorkflow}
          onClose={() => setShowTemplatePicker(false)}
        />
      )}
    </div>
  );
}

interface ContextMenu { x: number; y: number; path: string }

function SidebarFileTree({ nodes, depth, selectedFilePath, onSelect, onDelete, focusedPath, setFocusedPath, contextMenu, setContextMenu }: {
  nodes: FTNode[];
  depth: number;
  selectedFilePath: string | null;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  focusedPath?: string | null;
  setFocusedPath?: (p: string | null) => void;
  contextMenu?: ContextMenu | null;
  setContextMenu?: (m: ContextMenu | null) => void;
}) {
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({});
  const [localFocused, setLocalFocused] = useState<string | null>(null);
  const [localCtxMenu, setLocalCtxMenu] = useState<ContextMenu | null>(null);

  const isRoot = depth === 0;
  const focused = isRoot ? localFocused : (focusedPath ?? null);
  const setFocused = isRoot ? setLocalFocused : (setFocusedPath ?? setLocalFocused);
  const ctxMenu = isRoot ? localCtxMenu : (contextMenu ?? null);
  const setCtxMenu = isRoot ? setLocalCtxMenu : (setContextMenu ?? setLocalCtxMenu);

  useEffect(() => {
    if (!isRoot) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Delete" && focused) {
        e.preventDefault();
        onDelete(focused);
      }
    }
    function onMouseDown(e: MouseEvent) {
      if (localCtxMenu && !(e.target as Element).closest(".ft-context-menu")) {
        setLocalCtxMenu(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [isRoot, focused, localCtxMenu, onDelete]);

  const toggle = (path: string) => setOpenDirs((s) => ({ ...s, [path]: !s[path] }));

  return (
    <>
      {nodes.map((node) => {
        if (node.type === "dir") {
          const isOpen = openDirs[node.path] ?? true;
          return (
            <div key={node.path}>
              <div
                className="ft-row"
                style={{ paddingLeft: 8 + depth * 12 }}
                onClick={() => toggle(node.path)}
              >
                <span className={`ft-chevron ${isOpen ? "open" : ""}`}>
                  <ChevronRight size={9} />
                </span>
                <Folder size={11} strokeWidth={1.75} style={{ opacity: 0.55, flexShrink: 0 }} />
                <span className="ft-name">{node.name}</span>
              </div>
              {isOpen && (
                <SidebarFileTree
                  nodes={node.children}
                  depth={depth + 1}
                  selectedFilePath={selectedFilePath}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  focusedPath={focused}
                  setFocusedPath={setFocused}
                  contextMenu={ctxMenu}
                  setContextMenu={setCtxMenu}
                />
              )}
            </div>
          );
        }
        return (
          <div
            key={node.path}
            className={`ft-row ${selectedFilePath === node.path ? "active" : ""} ${focused === node.path ? "ft-focused" : ""}`}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => { setFocused(node.path); onSelect(node.path); }}
            onContextMenu={(e) => {
              e.preventDefault();
              setFocused(node.path);
              setCtxMenu({ x: e.clientX, y: e.clientY, path: node.path });
            }}
          >
            <span className="ft-chevron leaf"><ChevronRight size={9} /></span>
            <FileText size={11} strokeWidth={1.75} style={{ opacity: 0.55, flexShrink: 0 }} />
            <span className="ft-name">{node.name}</span>
          </div>
        );
      })}
      {isRoot && ctxMenu && (
        <div
          className="ft-context-menu"
          style={{ position: "fixed", top: ctxMenu.y, left: ctxMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="ft-ctx-item ft-ctx-danger"
            onClick={() => { setCtxMenu(null); onDelete(ctxMenu.path); }}
          >
            <Trash2 size={11} />
            Move to Trash
          </button>
        </div>
      )}
    </>
  );
}
