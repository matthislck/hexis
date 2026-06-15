import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useStore } from "../store";
import { StaleBadge } from "./StaleBadge";
import { NotionIcon } from "../icons/NotionIcon";

export function NotionInputNode({ id, data, selected }: NodeProps) {
  const cfg = (data as { config: { page_url?: string } }).config ?? {};
  const staleness = useStore((s) => s.staleness[id]);
  const isRunning = useStore((s) => s.runningNodeId === id);
  const label = cfg.page_url ? "Page configured" : "No page set";

  return (
    <div className={`hx-node hx-node--notion ${selected ? "selected" : ""} ${isRunning ? "running" : ""}`}>
      <div className="hx-node-header">
        <span className="hx-node-icon-sm" style={{ opacity: 0.8 }}><NotionIcon size={12} /></span>
        <span className="hx-node-title">Notion Page</span>
        <span className="hx-node-status notion" />
      </div>
      <div className="hx-node-body">
        <div className="hx-node-sub">{label}</div>
        <StaleBadge staleness={staleness} running={isRunning} />
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
