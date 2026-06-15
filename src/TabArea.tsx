import { useEffect, useRef, useState } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import { X, Save } from "lucide-react";
import { Canvas } from "./Canvas";
import { MarkdownEditor } from "./MarkdownEditor";
import { useStore } from "./store";
import { writeFile } from "./api";

function getLang(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    md: "markdown", markdown: "markdown",
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript",
    py: "python", json: "json",
    yaml: "yaml", yml: "yaml",
    css: "css", html: "html",
    sh: "shell", bash: "shell",
    txt: "plaintext",
  };
  return map[ext] ?? "plaintext";
}

// ── Reusable file editor panel ───────────────────────────────

function FileEditorPanel({ path, value, dirty, onChange, onSave, saveRef }: {
  path: string;
  value: string;
  dirty: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  saveRef: React.MutableRefObject<() => void>;
}) {
  function onMount(editor: Parameters<NonNullable<React.ComponentProps<typeof Editor>["onMount"]>>[0], monaco: Monaco) {
    editor.addAction({
      id: "hexis-save",
      label: "Save",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => saveRef.current(),
    });
  }

  const isMd = /\.md$/i.test(path);

  return (
    <div className="file-editor">
      <div className="file-editor-bar">
        <span className="file-editor-path">{path}</span>
        {isMd ? (
          <button
            className={`file-editor-save-btn ${dirty ? "dirty" : "saved"}`}
            onClick={onSave}
            title="Save (Ctrl+S)"
          >
            <Save size={11} /> {dirty ? "Save" : "Saved"}
          </button>
        ) : dirty ? (
          <button className="file-editor-save-btn dirty" onClick={onSave} title="Save (Ctrl+S)">
            <Save size={11} /> Save
          </button>
        ) : null}
      </div>
      <div className="file-editor-body">
        {isMd ? (
          <MarkdownEditor path={path} value={value} onChange={onChange} onSave={onSave} />
        ) : (
          <div
            style={{ height: "100%" }}
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}
          >
            <Editor
              key={path}
              height="100%"
              language={getLang(path)}
              theme="vs-dark"
              value={value}
              options={{
                fontSize: 13,
                fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
                minimap: { enabled: false },
                wordWrap: "on",
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                padding: { top: 14, bottom: 14 },
                renderLineHighlight: "gutter",
              }}
              onMount={onMount}
              onChange={(v) => onChange(v ?? "")}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reusable tab bar ─────────────────────────────────────────

interface TabItem {
  id: string;
  label: string;
  isCanvas?: boolean;
  dirty?: boolean;
}

function TabBar({ items, activeId, onActivate, onClose, draggingId, onDragStart, onDragEnd, onDropTab, showDropIndicator, extraEnd }: {
  items: TabItem[];
  activeId: string | null;
  onActivate: (id: string | null) => void;
  onClose?: (id: string) => void;
  draggingId?: string | null;
  onDragStart?: (id: string, e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDropTab?: (id: string) => void;
  showDropIndicator?: boolean;
  extraEnd?: React.ReactNode;
}) {
  const [barDropHover, setBarDropHover] = useState(false);

  return (
    <div
      className={`tab-bar ${showDropIndicator && barDropHover ? "tab-bar-drop" : ""}`}
      onDragOver={showDropIndicator ? (e) => { e.preventDefault(); setBarDropHover(true); } : undefined}
      onDragLeave={showDropIndicator ? () => setBarDropHover(false) : undefined}
      onDrop={showDropIndicator && onDropTab ? (e) => {
        e.preventDefault();
        setBarDropHover(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropTab(id);
      } : undefined}
    >
      {items.map((item) => (
        <button
          key={item.id}
          className={`tab ${(item.isCanvas ? activeId === null : activeId === item.id) ? "active" : ""} ${draggingId === item.id ? "dragging" : ""}`}
          onClick={() => onActivate(item.isCanvas ? null : item.id)}
          draggable={!item.isCanvas && !!onDragStart}
          onDragStart={!item.isCanvas && onDragStart ? (e) => {
            e.dataTransfer.setData("text/plain", item.id);
            e.dataTransfer.effectAllowed = "move";
            onDragStart(item.id, e);
          } : undefined}
          onDragEnd={onDragEnd}
          title={item.id}
        >
          {item.dirty && <span className="tab-dot" />}
          <span className="tab-label">{item.label}</span>
          {!item.isCanvas && onClose && (
            <span className="tab-close" role="button" onClick={(e) => { e.stopPropagation(); onClose(item.id); }}>
              <X size={11} />
            </span>
          )}
        </button>
      ))}
      {extraEnd}
    </div>
  );
}

// ── Main TabArea ─────────────────────────────────────────────

export function TabArea() {
  const openTabs           = useStore((s) => s.openTabs);
  const activeTabPath      = useStore((s) => s.activeTabPath);
  const setActiveTabPath   = useStore((s) => s.setActiveTabPath);
  const closeFileTab       = useStore((s) => s.closeFileTab);
  const tabInitContents    = useStore((s) => s.tabInitContents);
  const updateTabSaved     = useStore((s) => s.updateTabSavedContent);
  const rightTabs          = useStore((s) => s.rightTabs);
  const rightActiveTabPath = useStore((s) => s.rightActiveTabPath);
  const setRightActive     = useStore((s) => s.setRightActiveTabPath);
  const showRightPane      = useStore((s) => s.showRightPane);
  const moveTabToRight     = useStore((s) => s.moveTabToRight);
  const moveTabFromRight   = useStore((s) => s.moveTabFromRight);
  const closeTabInRight    = useStore((s) => s.closeTabInRight);
  const closeRightPane     = useStore((s) => s.closeRightPane);
  const activeWorkflow     = useStore((s) => s.activeWorkflow);
  const workspaceId        = useStore((s) => s.activeWorkspaceId);
  const saveTrigger        = useStore((s) => s.saveTrigger);

  // Shared edit state (persists while TabArea is mounted, keyed by file path)
  const [edits, setEdits] = useState<Record<string, string>>({});
  const edit = (path: string) => edits[path] ?? tabInitContents[path] ?? "";
  const isDirty = (path: string) => edit(path) !== (tabInitContents[path] ?? "");
  const setEdit = (path: string, v: string) => setEdits((e) => ({ ...e, [path]: v }));

  // Save refs (always point to current save function for each pane)
  const saveRefL = useRef<() => void>(() => {});
  const saveRefR = useRef<() => void>(() => {});

  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [splitHover, setSplitHover] = useState(false);

  // Pane resize state
  const [leftFlex, setLeftFlex] = useState(1); // right always flex:1, left = leftFlex
  const containerRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);

  // Initialize edits for newly opened tabs
  useEffect(() => {
    [...openTabs, ...rightTabs].forEach((path) => {
      if (!(path in edits) && path in tabInitContents) {
        setEdit(path, tabInitContents[path]);
      }
    });
  }, [openTabs, rightTabs, tabInitContents]);

  async function saveFile(path: string) {
    if (!workspaceId) return;
    const content = edit(path);
    await writeFile(workspaceId, path, content);
    updateTabSaved(path, content);
    // reflect saved state in edits so dirty clears
    setEdits((e) => ({ ...e, [path]: content }));
  }

  saveRefL.current = () => { if (activeTabPath) saveFile(activeTabPath); };
  saveRefR.current = () => { if (rightActiveTabPath) saveFile(rightActiveTabPath); };

  // Global Ctrl+S saves whichever pane last had focus
  useEffect(() => {
    if (saveTrigger <= 0) return;
    if (activeTabPath) saveFile(activeTabPath);
    if (rightActiveTabPath) saveFile(rightActiveTabPath);
  }, [saveTrigger]);

  // ── Resizer drag ────────────────────────────────────────────
  function onResizerMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const container = containerRef.current;
    if (!container) return;
    const totalW = container.offsetWidth - 4; // minus resizer
    const leftPane = container.querySelector(".tab-pane-left") as HTMLElement | null;
    const startLeftW = leftPane?.offsetWidth ?? totalW / 2;

    function onMove(me: MouseEvent) {
      const newLeft = Math.max(totalW * 0.2, Math.min(totalW * 0.8, startLeftW + (me.clientX - startX)));
      setLeftFlex(newLeft / (totalW - newLeft));
    }
    function onUp() {
      resizing.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ── Tab data ─────────────────────────────────────────────────
  const leftItems: TabItem[] = [
    { id: "canvas", label: activeWorkflow?.name ?? "Canvas", isCanvas: true },
    ...openTabs.map((p) => ({ id: p, label: p.split(/[\\/]/).pop() ?? p, dirty: isDirty(p) })),
  ];

  const rightItems: TabItem[] = rightTabs.map((p) => ({
    id: p, label: p.split(/[\\/]/).pop() ?? p, dirty: isDirty(p),
  }));

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="tab-area" ref={containerRef}>

      {/* ── Left pane ── */}
      <div
        className="tab-pane tab-pane-left"
        style={{ flex: showRightPane ? leftFlex : 1 }}
      >
        <TabBar
          items={leftItems}
          activeId={activeTabPath}
          onActivate={setActiveTabPath}
          onClose={(id) => closeFileTab(id)}
          draggingId={draggingId}
          onDragStart={(id) => setDraggingId(id)}
          onDragEnd={() => { setDraggingId(null); setSplitHover(false); }}
          showDropIndicator={showRightPane && !!draggingId && rightTabs.includes(draggingId)}
          onDropTab={(id) => { moveTabFromRight(id); setDraggingId(null); }}
        />

        {/* Canvas (always mounted to preserve React Flow state) */}
        <div style={{ display: activeTabPath === null ? "flex" : "none", flex: 1, overflow: "hidden", minWidth: 0 }}>
          <Canvas />
        </div>

        {/* Left file editor */}
        {activeTabPath !== null && (
          <FileEditorPanel
            path={activeTabPath}
            value={edit(activeTabPath)}
            dirty={isDirty(activeTabPath)}
            onChange={(v) => setEdit(activeTabPath, v)}
            onSave={() => saveFile(activeTabPath)}
            saveRef={saveRefL}
          />
        )}

        {/* Split drop zone — only when dragging a file tab and no right pane */}
        {draggingId && !showRightPane && (
          <div
            className={`split-zone ${splitHover ? "active" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setSplitHover(true); }}
            onDragLeave={() => setSplitHover(false)}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              if (id) moveTabToRight(id);
              setDraggingId(null);
              setSplitHover(false);
            }}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="1" y="2" width="8" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
              <rect x="13" y="2" width="8" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
            <span>Split Right</span>
          </div>
        )}
      </div>

      {/* ── Resizer ── */}
      {showRightPane && (
        <div className="pane-resizer" onMouseDown={onResizerMouseDown} />
      )}

      {/* ── Right pane ── */}
      {showRightPane && (
        <div className="tab-pane tab-pane-right" style={{ flex: 1 }}>
          <TabBar
            items={rightItems}
            activeId={rightActiveTabPath}
            onActivate={(id) => setRightActive(id)}
            onClose={(id) => closeTabInRight(id)}
            draggingId={draggingId}
            onDragStart={(id) => setDraggingId(id)}
            onDragEnd={() => setDraggingId(null)}
            showDropIndicator={!!draggingId && openTabs.includes(draggingId ?? "")}
            onDropTab={(id) => { moveTabToRight(id); setDraggingId(null); }}
            extraEnd={
              <button className="pane-close-btn" onClick={closeRightPane} title="Close split">
                <X size={13} />
              </button>
            }
          />

          {rightActiveTabPath && (
            <FileEditorPanel
              path={rightActiveTabPath}
              value={edit(rightActiveTabPath)}
              dirty={isDirty(rightActiveTabPath)}
              onChange={(v) => setEdit(rightActiveTabPath, v)}
              onSave={() => saveFile(rightActiveTabPath)}
              saveRef={saveRefR}
            />
          )}

          {!rightActiveTabPath && (
            <div className="pane-empty">
              <span>No file open</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
