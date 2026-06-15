import type { Workspace, Workflow, WorkflowMeta, RunSummary, RunRecord, GitStatus, GitCommit } from "./types";
import type { WorkflowTemplate } from "./templates";

const BASE = "http://127.0.0.1:7799";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// Workspaces
export const getWorkspaces = () => req<Workspace[]>("GET", "/workspaces");
export const addWorkspace = (name: string, path = "") =>
  req<Workspace>("POST", "/workspaces", { name, path });
export const getDefaultRoot = () =>
  req<{ path: string }>("GET", "/workspaces/default-root");
export const deleteWorkspace = (id: string) =>
  req<{ ok: boolean }>("DELETE", `/workspaces/${id}`);

// Files
export const listFiles = (wid: string) =>
  req<string[]>("GET", `/workspaces/${wid}/files`);
export const readFile = (wid: string, path: string) =>
  req<{ path: string; content: string }>("GET", `/workspaces/${wid}/files/${path}`);
export const writeFile = (wid: string, path: string, content: string) =>
  req<{ ok: boolean }>("PUT", `/workspaces/${wid}/files/${path}`, { content });
export const createFile = (wid: string, path: string) =>
  req<{ ok: boolean }>("PUT", `/workspaces/${wid}/files/${path}`, { content: "" });
export const deleteFile = (wid: string, path: string) =>
  req<{ ok: boolean }>("DELETE", `/workspaces/${wid}/files/${path}`);

// Workflows
export const listWorkflows = (wid: string) =>
  req<WorkflowMeta[]>("GET", `/workspaces/${wid}/workflows`);
export const createWorkflow = (wid: string, data: Partial<Workflow>) =>
  req<Workflow>("POST", `/workspaces/${wid}/workflows`, data);
export const getWorkflow = (wid: string, wfid: string) =>
  req<Workflow>("GET", `/workspaces/${wid}/workflows/${wfid}`);
export const updateWorkflow = (wid: string, wfid: string, data: Workflow) =>
  req<Workflow>("PUT", `/workspaces/${wid}/workflows/${wfid}`, data);
export const deleteWorkflow = (wid: string, wfid: string) =>
  req<{ ok: boolean }>("DELETE", `/workspaces/${wid}/workflows/${wfid}`);

// API keys
export const getNotionToken = (wid: string) =>
  req<{ token: string }>("GET", `/workspaces/${wid}/notion-token`);
export const setNotionToken = (wid: string, token: string) =>
  req<{ ok: boolean }>("PUT", `/workspaces/${wid}/notion-token`, { token });

export const getAnthropicKey = (wid: string) =>
  req<{ key: string }>("GET", `/workspaces/${wid}/anthropic-key`);
export const setAnthropicKey = (wid: string, key: string) =>
  req<{ ok: boolean }>("PUT", `/workspaces/${wid}/anthropic-key`, { key });

export const getOpenaiKey = (wid: string) =>
  req<{ key: string }>("GET", `/workspaces/${wid}/openai-key`);
export const setOpenaiKey = (wid: string, key: string) =>
  req<{ ok: boolean }>("PUT", `/workspaces/${wid}/openai-key`, { key });

export const getGeminiKey = (wid: string) =>
  req<{ key: string }>("GET", `/workspaces/${wid}/gemini-key`);
export const setGeminiKey = (wid: string, key: string) =>
  req<{ ok: boolean }>("PUT", `/workspaces/${wid}/gemini-key`, { key });

// Notion page search
export const searchNotionPages = (wid: string, q: string) =>
  req<{ id: string; title: string; url: string }[]>("GET", `/workspaces/${wid}/notion/pages?q=${encodeURIComponent(q)}`);

// Runs
export const listRuns = (wid: string) =>
  req<RunSummary[]>("GET", `/workspaces/${wid}/runs`);
export const getRun = (wid: string, rid: string) =>
  req<RunRecord>("GET", `/workspaces/${wid}/runs/${rid}`);

// Git
export const getGitStatus = (wid: string) =>
  req<GitStatus>("GET", `/workspaces/${wid}/git/status`);
export const getGitLog = (wid: string) =>
  req<GitCommit[]>("GET", `/workspaces/${wid}/git/log`);
export const initGitRepo = (wid: string) =>
  req<{ ok: boolean }>("POST", `/workspaces/${wid}/git/init`);
export const gitCommit = (wid: string, message: string) =>
  req<{ ok: boolean; hash: string | null }>("POST", `/workspaces/${wid}/git/commit`, { message });

// Native folder picker
export const pickFolder = () => req<{ path: string }>("POST", "/pick-folder");

// Prompts
export const listPrompts = (wid: string) =>
  req<{ path: string; used_in: { id: string; name: string }[] }[]>("GET", `/workspaces/${wid}/prompts`);

// User Templates
export const listUserTemplates = () =>
  req<WorkflowTemplate[]>("GET", "/user-templates");
export const saveUserTemplate = (t: Omit<WorkflowTemplate, "id">) =>
  req<WorkflowTemplate>("POST", "/user-templates", t);
export const deleteUserTemplate = (tid: string) =>
  req<{ ok: boolean }>("DELETE", `/user-templates/${tid}`);

// Generate
export const generatePrompt = (wid: string, description: string) =>
  req<{ path: string; content: string }>("POST", `/workspaces/${wid}/generate/prompt`, { description });

export const generateWorkflow = (wid: string, description: string) =>
  req<{ name: string; nodes: unknown[]; edges: unknown[] }>("POST", `/workspaces/${wid}/generate/workflow`, { description });

// Streaming run
export function streamRun(
  wid: string,
  wfid: string,
  onChunk: (text: string) => void,
  onStatus: (msg: string) => void,
  onDone: (record: RunRecord) => void,
  onError: (msg: string) => void,
  onWarning?: (msg: string) => void,
  staleness?: Record<string, string>,
  onNodeStart?: (nid: string) => void,
): () => void {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BASE}/workspaces/${wid}/workflows/${wfid}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staleness: staleness ?? {} }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Run failed: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const evMatch = part.match(/^event: (\w+)/);
          const dataMatch = part.match(/\ndata: ([\s\S]+)$/);
          if (!evMatch || !dataMatch) continue;
          const ev = evMatch[1];
          const data = dataMatch[1].trim();
          if (ev === "chunk") onChunk(data);
          else if (ev === "status") onStatus(data);
          else if (ev === "skip") onStatus(`Skipped (fresh): ${data}`);
          else if (ev === "done") onDone(JSON.parse(data) as RunRecord);
          else if (ev === "error") onError(data);
          else if (ev === "warning") onWarning?.(data);
          else if (ev === "node_start") onNodeStart?.(data);
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== "AbortError") onError(String(e));
    }
  })();
  return () => controller.abort();
}
