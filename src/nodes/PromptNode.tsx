import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Sparkles } from "lucide-react";
import { useStore } from "../store";
import { StaleBadge } from "./StaleBadge";

export function PromptNode({ id, data, selected }: NodeProps) {
  const cfg = (data as { config: { prompt?: string; prompt_source?: string; prompt_file?: string; model?: string } }).config ?? {};
  const staleness = useStore((s) => s.staleness[id]);
  const isRunning = useStore((s) => s.runningNodeId === id);
  const model = cfg.model?.replace("claude-", "").replace("-20251001", "") ?? "claude";
  const sub = cfg.prompt_source === "file" && cfg.prompt_file
    ? cfg.prompt_file.split("/").pop()?.replace(/\.(md|txt|prompt)$/, "") ?? cfg.prompt_file
    : model;

  return (
    <div className={`hx-node hx-node--prompt ${selected ? "selected" : ""} ${isRunning ? "running" : ""}`}>
      <div className="hx-node-header">
        <span className="hx-node-icon-sm"><Sparkles size={12} strokeWidth={1.75} /></span>
        <span className="hx-node-title">Prompt</span>
        <span className="hx-node-status prompt" />
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
