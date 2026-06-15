export interface Workspace {
  id: string;
  name: string;
  path: string;
}

export interface WorkflowMeta {
  id: string;
  name: string;
  version: number;
}

export type NodeType = "input" | "prompt" | "agent" | "output" | "notion-input" | "notion-output" | "workflow-ref";

export interface AgentTool {
  id: string;
  enabled: boolean;
  params?: Record<string, string>;
}

export interface NodeConfig {
  // input
  paths?: string[];
  // prompt
  prompt?: string;
  prompt_source?: "inline" | "file";
  prompt_file?: string;
  model?: string;
  backend?: string;
  temperature?: number;
  // agent
  task?: string;
  task_source?: "inline" | "file";
  task_file?: string;
  agent_system_prompt?: string;
  max_iterations?: number;
  agent_tools?: AgentTool[];
  show_reasoning?: boolean;
  // output
  filename?: string;
  // notion-input
  page_url?: string;
  page_title?: string;
  // notion-output
  database_url?: string;
  title_template?: string;
  // workflow-ref
  ref_workflow_id?: string;
  ref_workflow_name?: string;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  config: NodeConfig;
}

export interface WorkflowEdge {
  source: string;
  target: string;
}

export interface Workflow {
  id: string;
  name: string;
  version: number;
  workspace_id: string;
  created_at?: string;
  updated_at?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface RunSummary {
  id: string;
  workflow_id: string;
  timestamp: string;
  duration_ms: number;
  status: string;
  model: string;
  token_count: number;
}

export type Staleness = "fresh" | "stale" | "never";

export interface NodeStaleness {
  [nodeId: string]: Staleness;
}

export interface RunRecord extends RunSummary {
  workspace_id: string;
  input_snapshot: Record<string, string>;
  prompt_snapshot: Record<string, string>;
  output_content: string;
  node_outputs?: Record<string, string>;
  git_commit_hash?: string;
}

export interface GitStatus {
  is_repo: boolean;
  branch: string;
  clean: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface GitCommit {
  hash: string;
  short_hash: string;
  message: string;
  timestamp: string;
  author: string;
}
