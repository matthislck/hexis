import { Handle, Position, type NodeProps } from "@xyflow/react";
import { FolderOpen } from "lucide-react";
import { useStore } from "../store";
import { StaleBadge } from "./StaleBadge";

export function InputNode({ id, data, selected }: NodeProps) {
  const cfg = (data as { config: { paths?: string[] } }).config ?? {};
  const staleness = useStore((s) => s.staleness[id]);
  const isRunning = useStore((s) => s.runningNodeId === id);
  const paths = cfg.paths ?? [];

  return (
    <div className={`hx-node hx-node--input ${selected ? "selected" : ""} ${isRunning ? "running" : ""}`}>
      <div className="hx-node-header">
        <span className="hx-node-icon-sm"><FolderOpen size={12} strokeWidth={1.75} /></span>
        <span className="hx-node-title">Input Files</span>
        <span className="hx-node-status input" />
      </div>
      <div className="hx-node-body">
        <div className="hx-node-sub">
          {paths.length > 0 ? `${paths.length} file${paths.length > 1 ? "s" : ""} selected` : "No files selected"}
        </div>
        <StaleBadge staleness={staleness} running={isRunning} />
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
