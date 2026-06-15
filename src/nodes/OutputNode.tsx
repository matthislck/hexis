import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Download } from "lucide-react";
import { useStore } from "../store";
import { StaleBadge } from "./StaleBadge";

export function OutputNode({ id, data, selected }: NodeProps) {
  const cfg = (data as { config: { filename?: string } }).config ?? {};
  const staleness = useStore((s) => s.staleness[id]);
  const isRunning = useStore((s) => s.runningNodeId === id);
  const filename = cfg.filename?.split("/").pop() ?? "output.md";

  return (
    <div className={`hx-node hx-node--output ${selected ? "selected" : ""} ${isRunning ? "running" : ""}`}>
      <div className="hx-node-header">
        <span className="hx-node-icon-sm"><Download size={12} strokeWidth={1.75} /></span>
        <span className="hx-node-title">Save Output</span>
        <span className="hx-node-status output" />
      </div>
      <div className="hx-node-body">
        <div className="hx-node-sub">{filename}</div>
        <StaleBadge staleness={staleness} running={isRunning} />
      </div>
      <Handle type="target" position={Position.Left} />
    </div>
  );
}
