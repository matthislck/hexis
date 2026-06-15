import type { Workflow, RunRecord, NodeStaleness, Staleness } from "./types";

/**
 * Computes a simple hash string for a value — used to detect changes.
 * Not cryptographic, just fast fingerprinting.
 */
function hash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function nodeFingerprint(workflow: Workflow, nodeId: string, fileContents: Record<string, string>): string | null {
  const node = workflow.nodes.find((n) => n.id === nodeId);
  if (!node) return "";

  if (node.type === "input") {
    const paths = node.config.paths ?? [];
    const contents = paths.map((p) => `${p}:${fileContents[p] ?? ""}`).join("|");
    return hash(contents);
  }

  if (node.type === "prompt") {
    const prompt = node.config.prompt ?? "";
    const model = node.config.model ?? "";
    const temp = String(node.config.temperature ?? 0.7);
    return hash(prompt + model + temp);
  }

  if (node.type === "output") {
    return hash((node.config.output_filename ?? node.config.filename) ?? "");
  }

  // agent, notion-input, notion-output, workflow-ref: non-deterministic / side-effectful
  // return null so they are always treated as stale
  return null;
}

/**
 * Given the last run record and the current workflow + file contents,
 * compute staleness for each node.
 *
 * A node is stale if:
 * - its own fingerprint changed since the last run, OR
 * - any upstream node is stale (transitive)
 */
export function computeStaleness(
  workflow: Workflow,
  lastRun: RunRecord | null,
  fileContents: Record<string, string>,
): NodeStaleness {
  const result: NodeStaleness = {};

  if (!lastRun) {
    // never run — all nodes are "never"
    for (const node of workflow.nodes) result[node.id] = "never";
    return result;
  }

  const savedFingerprints: Record<string, string> = JSON.parse(
    (lastRun as RunRecord & { fingerprints?: string }).fingerprints ?? "{}"
  );

  // topological order
  const children: Record<string, string[]> = {};
  const inDegree: Record<string, number> = {};
  for (const n of workflow.nodes) { children[n.id] = []; inDegree[n.id] = 0; }
  for (const e of workflow.edges) {
    children[e.source].push(e.target);
    inDegree[e.target]++;
  }
  const queue = workflow.nodes.filter((n) => inDegree[n.id] === 0).map((n) => n.id);
  const order: string[] = [];
  const q = [...queue];
  while (q.length) {
    const nid = q.shift()!;
    order.push(nid);
    for (const child of children[nid]) {
      inDegree[child]--;
      if (inDegree[child] === 0) q.push(child);
    }
  }

  for (const nid of order) {
    const current = nodeFingerprint(workflow, nid, fileContents);
    const saved = savedFingerprints[nid];

    // check if any upstream node is stale
    const upstreamStale = workflow.edges
      .filter((e) => e.target === nid)
      .some((e) => result[e.source] === "stale");

    let staleness: Staleness;
    // null fingerprint → non-deterministic node type → always stale
    if (current === null || upstreamStale || current !== saved) {
      staleness = "stale";
    } else {
      staleness = "fresh";
    }
    result[nid] = staleness;
  }

  return result;
}

/**
 * Builds fingerprints for all nodes to save alongside the run record.
 */
export function buildFingerprints(
  workflow: Workflow,
  fileContents: Record<string, string>,
): Record<string, string> {
  const fps: Record<string, string> = {};
  for (const node of workflow.nodes) {
    const fp = nodeFingerprint(workflow, node.id, fileContents);
    if (fp !== null) fps[node.id] = fp;
  }
  return fps;
}
