import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Terminal } from "lucide-react";
import { useStore } from "../store";
import { StaleBadge } from "./StaleBadge";

export function AgentNode({ id, data, selected }: NodeProps) {
  const cfg = (data as { config: { task?: string; task_source?: string; task_file?: string; model?: string } }).config ?? {};
  const staleness = useStore((s) => s.staleness[id]);
  const isRunning = useStore((s) => s.runningNodeId === id);

  const sub = cfg.task_source === "file" && cfg.task_file
    ? cfg.task_file.split("/").pop()?.replace(/\.(md|txt|prompt)$/, "") ?? cfg.task_file
    : cfg.task
      ? cfg.task.slice(0, 32) + (cfg.task.length > 32 ? "…" : "")
      : cfg.model?.replace("claude-", "").replace("-20251001", "") ?? "claude";

  return (
    <div className={`hx-node hx-node--agent ${selected ? "selected" : ""} ${isRunning ? "running" : ""}`}>
      <div className="hx-node-header">
        <span className="hx-node-icon-sm"><Terminal size={12} strokeWidth={1.75} /></span>
        <span className="hx-node-title">Agent</span>
        <span className="hx-node-status agent" />
      </div>
      <div className="hx-node-body">
        <div className="hx-node-sub">{sub}</div>
        <StaleBadge staleness={staleness} running={isRunning} />
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
