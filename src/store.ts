import { create } from "zustand";
import type { Workspace, Workflow, WorkflowMeta, RunSummary, RunRecord, NodeStaleness, GitStatus, GitCommit } from "./types";

export interface Toast {
  id: string;
  type: "success" | "error" | "warning";
  message: string;
  sub?: string;
}

interface AppState {
  // Workspaces
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  setWorkspaces: (ws: Workspace[]) => void;
  setActiveWorkspace: (id: string | null) => void;

  // Workflows
  workflows: WorkflowMeta[];
  activeWorkflow: Workflow | null;
  setWorkflows: (wf: WorkflowMeta[]) => void;
  setActiveWorkflow: (wf: Workflow | null) => void;

  // Inspector
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;

  // Run state
  isRunning: boolean;
  runOutput: string;
  runStatus: string;
  setIsRunning: (v: boolean) => void;
  appendRunOutput: (text: string) => void;
  setRunStatus: (msg: string) => void;
  clearRunOutput: () => void;

  // Run history
  runs: RunSummary[];
  activeRun: RunRecord | null;
  setRuns: (runs: RunSummary[]) => void;
  setActiveRun: (run: RunRecord | null) => void;

  // Last completed run (for output viewer)
  lastRun: RunRecord | null;
  setLastRun: (r: RunRecord | null) => void;

  // Currently executing node
  runningNodeId: string | null;
  setRunningNodeId: (id: string | null) => void;

  // Run panel visibility
  showRunPanel: boolean;
  setShowRunPanel: (v: boolean) => void;

  // Tab system — left pane
  openTabs: string[];
  activeTabPath: string | null;
  tabInitContents: Record<string, string>;
  openFileTab: (path: string, content: string) => void;
  closeFileTab: (path: string) => void;
  setActiveTabPath: (p: string | null) => void;
  updateTabSavedContent: (path: string, content: string) => void;
  saveTrigger: number;
  triggerSave: () => void;

  // Right split pane
  rightTabs: string[];
  rightActiveTabPath: string | null;
  showRightPane: boolean;
  moveTabToRight: (path: string) => void;
  moveTabFromRight: (path: string) => void;
  closeTabInRight: (path: string) => void;
  closeRightPane: () => void;
  setRightActiveTabPath: (p: string | null) => void;

  // Staleness
  staleness: NodeStaleness;
  setStaleness: (s: NodeStaleness) => void;

  // Toasts
  toasts: Toast[];
  addToast: (t: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;

  // API keys (for current workspace)
  notionToken: string;
  setNotionToken: (t: string) => void;
  anthropicKey: string;
  setAnthropicKey: (k: string) => void;
  openaiKey: string;
  setOpenaiKey: (k: string) => void;
  geminiKey: string;
  setGeminiKey: (k: string) => void;

  // Git
  gitStatus: GitStatus | null;
  gitLog: GitCommit[];
  setGitStatus: (s: GitStatus | null) => void;
  setGitLog: (l: GitCommit[]) => void;

  // New workflow trigger (for Ctrl+N from App.tsx)
  newWorkflowTrigger: number;
  triggerNewWorkflow: () => void;
}

export const useStore = create<AppState>((set) => ({
  workspaces: [],
  activeWorkspaceId: null,
  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

  workflows: [],
  activeWorkflow: null,
  setWorkflows: (workflows) => set({ workflows }),
  setActiveWorkflow: (wf) => set({ activeWorkflow: wf }),

  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  isRunning: false,
  runOutput: "",
  runStatus: "",
  setIsRunning: (v) => set({ isRunning: v }),
  appendRunOutput: (text) => set((s) => ({ runOutput: s.runOutput + text })),
  setRunStatus: (msg) => set({ runStatus: msg }),
  clearRunOutput: () => set({ runOutput: "", runStatus: "" }),

  runs: [],
  activeRun: null,
  setRuns: (runs) => set({ runs }),
  setActiveRun: (run) => set({ activeRun: run }),

  lastRun: null,
  setLastRun: (r) => set({ lastRun: r }),

  runningNodeId: null,
  setRunningNodeId: (id) => set({ runningNodeId: id }),

  showRunPanel: false,
  setShowRunPanel: (v) => set({ showRunPanel: v }),

  openTabs: [],
  activeTabPath: null,
  tabInitContents: {},
  openFileTab: (path, content) => set((s) => {
    const already = s.openTabs.includes(path);
    if (already) return { activeTabPath: path };
    const tabs = [...s.openTabs];
    const afterIdx = s.activeTabPath ? tabs.indexOf(s.activeTabPath) : -1;
    tabs.splice(afterIdx + 1, 0, path);
    return {
      openTabs: tabs,
      activeTabPath: path,
      tabInitContents: { ...s.tabInitContents, [path]: content },
    };
  }),
  closeFileTab: (path) => set((s) => {
    const next = s.openTabs.filter((p) => p !== path);
    const contents = { ...s.tabInitContents };
    delete contents[path];
    const newActive = s.activeTabPath === path
      ? (next.length > 0 ? next[next.length - 1] : null)
      : s.activeTabPath;
    return { openTabs: next, tabInitContents: contents, activeTabPath: newActive };
  }),
  setActiveTabPath: (p) => set({ activeTabPath: p }),
  updateTabSavedContent: (path, content) => set((s) => ({
    tabInitContents: { ...s.tabInitContents, [path]: content },
  })),
  saveTrigger: 0,
  triggerSave: () => set((s) => ({ saveTrigger: s.saveTrigger + 1 })),

  rightTabs: [],
  rightActiveTabPath: null,
  showRightPane: false,
  moveTabToRight: (path) => set((s) => {
    const nextLeft = s.openTabs.filter((p) => p !== path);
    return {
      openTabs: nextLeft,
      activeTabPath: s.activeTabPath === path ? (nextLeft[nextLeft.length - 1] ?? null) : s.activeTabPath,
      rightTabs: s.rightTabs.includes(path) ? s.rightTabs : [...s.rightTabs, path],
      rightActiveTabPath: path,
      showRightPane: true,
    };
  }),
  moveTabFromRight: (path) => set((s) => {
    const nextRight = s.rightTabs.filter((p) => p !== path);
    return {
      rightTabs: nextRight,
      rightActiveTabPath: s.rightActiveTabPath === path ? (nextRight[nextRight.length - 1] ?? null) : s.rightActiveTabPath,
      showRightPane: nextRight.length > 0,
      openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
      activeTabPath: path,
    };
  }),
  closeTabInRight: (path) => set((s) => {
    const next = s.rightTabs.filter((p) => p !== path);
    const contents = { ...s.tabInitContents };
    delete contents[path];
    return {
      rightTabs: next,
      rightActiveTabPath: s.rightActiveTabPath === path ? (next[next.length - 1] ?? null) : s.rightActiveTabPath,
      showRightPane: next.length > 0,
      tabInitContents: contents,
    };
  }),
  closeRightPane: () => set((s) => {
    const toAdd = s.rightTabs.filter((p) => !s.openTabs.includes(p));
    return {
      openTabs: [...s.openTabs, ...toAdd],
      activeTabPath: s.activeTabPath ?? (toAdd[0] ?? null),
      rightTabs: [],
      rightActiveTabPath: null,
      showRightPane: false,
    };
  }),
  setRightActiveTabPath: (p) => set({ rightActiveTabPath: p }),

  staleness: {},
  setStaleness: (s) => set({ staleness: s }),

  toasts: [],
  addToast: (t) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 4000);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  notionToken: "",
  setNotionToken: (t) => set({ notionToken: t }),
  anthropicKey: "",
  setAnthropicKey: (k) => set({ anthropicKey: k }),
  openaiKey: "",
  setOpenaiKey: (k) => set({ openaiKey: k }),
  geminiKey: "",
  setGeminiKey: (k) => set({ geminiKey: k }),

  gitStatus: null,
  gitLog: [],
  setGitStatus: (s) => set({ gitStatus: s }),
  setGitLog: (l) => set({ gitLog: l }),

  newWorkflowTrigger: 0,
  triggerNewWorkflow: () => set((s) => ({ newWorkflowTrigger: s.newWorkflowTrigger + 1 })),
}));
