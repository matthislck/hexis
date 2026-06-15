import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { FolderOpen, GitBranch, Terminal, X, ChevronDown, ChevronUp } from "lucide-react";
import { NotionIcon } from "./icons/NotionIcon";
import { useStore } from "./store";
import { updateWorkflow } from "./api";
import { InputNode } from "./nodes/InputNode";
import { PromptNode } from "./nodes/PromptNode";
import { AgentNode } from "./nodes/AgentNode";
import { OutputNode } from "./nodes/OutputNode";
import { NotionInputNode } from "./nodes/NotionInputNode";
import { NotionOutputNode } from "./nodes/NotionOutputNode";
import { WorkflowRefNode } from "./nodes/WorkflowRefNode";
import type { NodeType, WorkflowNode } from "./types";

const nodeTypes = { input: InputNode, prompt: PromptNode, agent: AgentNode, output: OutputNode, "notion-input": NotionInputNode, "notion-output": NotionOutputNode, "workflow-ref": WorkflowRefNode };

const NODE_MENU_ITEMS: { type: NodeType; icon: React.ReactNode; label: string; sub: string }[] = [
  { type: "input",         icon: <FolderOpen size={14} strokeWidth={1.75} />,  label: "Input Files",    sub: "Read files from workspace" },
  { type: "prompt",        icon: "✦",                                           label: "LLM Prompt",     sub: "Call a chat model with a prompt" },
  { type: "agent",         icon: <Terminal size={14} strokeWidth={1.75} />,    label: "Agent",          sub: "Run a coding agent in the workspace" },
  { type: "output",        icon: "↓",                                           label: "Save Output",    sub: "Write result to a file" },
  { type: "notion-input",  icon: <NotionIcon size={15} />,                      label: "Notion Page",    sub: "Read a Notion page" },
  { type: "notion-output", icon: <NotionIcon size={15} />,                      label: "Notion Output",  sub: "Create page in Notion DB" },
  { type: "workflow-ref",  icon: <GitBranch size={14} strokeWidth={1.75} />,   label: "Workflow Input", sub: "Use output of another workflow" },
];

function wfToFlow(wfNodes: WorkflowNode[]): Node[] {
  return wfNodes.map((n) => ({
    id: n.id, type: n.type, position: n.position, data: { config: n.config },
  }));
}

interface CtxMenu { x: number; y: number; flowX: number; flowY: number }

function RunPanel() {
  const isRunning = useStore((s) => s.isRunning);
  const runOutput = useStore((s) => s.runOutput);
  const runStatus = useStore((s) => s.runStatus);
  const showRunPanel = useStore((s) => s.showRunPanel);
  const setShowRunPanel = useStore((s) => s.setShowRunPanel);
  const lastRun = useStore((s) => s.lastRun);
  const [collapsed, setCollapsed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current && !collapsed) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [runOutput, collapsed]);

  if (!isRunning && !showRunPanel) return null;

  const meta = !isRunning && lastRun
    ? `${(lastRun.duration_ms / 1000).toFixed(1)}s${lastRun.token_count > 0 ? ` · ${lastRun.token_count.toLocaleString()} tokens` : ""}`
    : runStatus;

  return (
    <div className={`run-panel ${collapsed ? "collapsed" : ""}`}>
      <div className="run-panel-header">
        {isRunning && <div className="run-panel-dot" />}
        <span className="run-panel-status">{meta}</span>
        <button className="run-panel-btn" onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
        <button className="run-panel-btn" onClick={() => setShowRunPanel(false)} title="Close">
          <X size={11} />
        </button>
      </div>
      {!collapsed && (
        <div className="run-panel-body" ref={bodyRef}>
          <pre className="run-output-text">{runOutput || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Waiting…</span>}</pre>
        </div>
      )}
    </div>
  );
}

function CanvasInner() {
  const activeWorkflow = useStore((s) => s.activeWorkflow);
  const setActiveWorkflow = useStore((s) => s.setActiveWorkflow);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [menu, setMenu] = useState<CtxMenu | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    if (!activeWorkflow) { setNodes([]); setEdges([]); return; }
    setNodes(wfToFlow(activeWorkflow.nodes));
    setEdges(activeWorkflow.edges.map((e, i) => ({ id: `e${i}`, source: e.source, target: e.target })));
  }, [activeWorkflow?.id]);

  // Sync node data when configs change (e.g. Inspector patches).
  // Keyed by serialized configs so it doesn't re-run when persist updates positions.
  const nodeConfigsKey = activeWorkflow?.nodes
    .map((n) => `${n.id}:${JSON.stringify(n.config)}`).join("|") ?? "";
  useEffect(() => {
    if (!activeWorkflow) return;
    setNodes((nds) => nds.map((n) => {
      const wfNode = activeWorkflow.nodes.find((w) => w.id === n.id);
      return wfNode ? { ...n, data: { config: wfNode.config } } : n;
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeConfigsKey]);

  // Keep React Flow's selected flag in sync with our store
  useEffect(() => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === selectedNodeId })));
  }, [selectedNodeId]);

  // persist after any structural change
  const persist = useCallback(async (
    latestNodes: Node[] = nodes,
    latestEdges: Edge[] = edges,
  ) => {
    if (!activeWorkflow) return;
    const updated = {
      ...activeWorkflow,
      nodes: latestNodes.map((n) => ({
        id: n.id,
        type: n.type as NodeType,
        position: n.position,
        config: (n.data as { config: WorkflowNode["config"] }).config,
      })),
      edges: latestEdges.map((e) => ({ source: e.source, target: e.target })),
    };
    try {
      const saved = await updateWorkflow(activeWorkflow.workspace_id, activeWorkflow.id, updated);
      setActiveWorkflow(saved);
    } catch { /* silent */ }
  }, [activeWorkflow, nodes, edges]);

  const onConnect = useCallback(
    (c: Connection) => {
      const next = addEdge(c, edges);
      setEdges(next);
      persist(nodes, next);
    },
    [edges, nodes, persist, setEdges],
  );

  // right-click on pane → open menu
  const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    const bounds = wrapperRef.current?.getBoundingClientRect();
    const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setMenu({
      x: e.clientX - (bounds?.left ?? 0),
      y: e.clientY - (bounds?.top ?? 0),
      flowX: flowPos.x,
      flowY: flowPos.y,
    });
  }, [screenToFlowPosition]);

  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    setSelectedNodeId(selectedNodeId === node.id ? null : node.id);
  }, [selectedNodeId, setSelectedNodeId]);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setMenu(null);
  }, [setSelectedNodeId]);

  const addNode = useCallback(async (type: NodeType) => {
    if (!activeWorkflow || !menu) return;
    const newNode: Node = {
      id: `node_${Date.now()}`,
      type,
      position: { x: menu.flowX, y: menu.flowY },
      data: { config: {} },
    };
    const nextNodes = [...nodes, newNode];
    setNodes(nextNodes);
    setMenu(null);
    await persist(nextNodes, edges);
  }, [activeWorkflow, menu, nodes, edges, persist]);

  const onDeleteNode = useCallback(async (deletedNodes: Node[]) => {
    const ids = new Set(deletedNodes.map((n) => n.id));
    const nextEdges = edges.filter((e) => !ids.has(e.source) && !ids.has(e.target));
    await persist(nodes.filter((n) => !ids.has(n.id)), nextEdges);
  }, [nodes, edges, persist]);

  if (!activeWorkflow) {
    return <CanvasWelcome />;
  }

  return (
    <div className="canvas-wrapper" ref={wrapperRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeDragStop={() => persist()}
        onEdgesDelete={() => persist()}
        onNodesDelete={onDeleteNode}
        onPaneContextMenu={onPaneContextMenu}
        fitView
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        deleteKeyCode="Delete"
        nodeDragThreshold={5}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgba(255,255,255,0.18)" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => n.type === "input" ? "#3b82f6" : n.type === "prompt" ? "#a855f7" : n.type === "agent" ? "#f97316" : n.type === "workflow-ref" ? "#f59e0b" : "#10b981"}
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>

      {/* Context menu */}
      {menu && (
        <div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ctx-menu-header">Add node</div>
          {NODE_MENU_ITEMS.map((item) => (
            <button key={item.type} className="ctx-menu-item" onClick={() => addNode(item.type)}>
              <span className={`ctx-menu-icon ${item.type}`}>{item.icon}</span>
              <div className="ctx-menu-text">
                <span className="ctx-menu-label">{item.label}</span>
                <span className="ctx-menu-sub">{item.sub}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <RunPanel />
    </div>
  );
}

function CanvasWelcome() {
  const workspaces = useStore((s) => s.workspaces);
  const triggerNewWorkflow = useStore((s) => s.triggerNewWorkflow);
  const noWorkspace = workspaces.length === 0;

  return (
    <div className="canvas-welcome">
      <div className="canvas-welcome-inner">
        <div className="canvas-welcome-logo">ἕξις</div>
        <div className="canvas-welcome-tagline">
          LLM workflow automation — files, prompts, agents, outputs.
        </div>

        {noWorkspace ? (
          <div className="canvas-welcome-steps">
            <div className="canvas-welcome-step">
              <span className="canvas-welcome-step-num">1</span>
              <span>Click the workspace picker (top-left) → <strong>New workspace</strong></span>
            </div>
            <div className="canvas-welcome-step">
              <span className="canvas-welcome-step-num">2</span>
              <span>Point it to an existing folder with Markdown files, or add files to the new workspace folder</span>
            </div>
            <div className="canvas-welcome-step">
              <span className="canvas-welcome-step-num">3</span>
              <span>Create a workflow and connect Input → Prompt → Output</span>
            </div>
          </div>
        ) : (
          <div className="canvas-welcome-actions">
            <button className="canvas-welcome-btn" onClick={triggerNewWorkflow}>
              <span className="canvas-welcome-btn-icon">+</span>
              New workflow
            </button>
            <div className="canvas-welcome-hint">or press <kbd>⌘N</kbd></div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
