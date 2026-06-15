import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useStore } from "../store";
import { StaleBadge } from "./StaleBadge";
import { NotionIcon } from "../icons/NotionIcon";

export function NotionOutputNode({ id, data, selected }: NodeProps) {
  const cfg = (data as { config: { database_url?: string; title_template?: string } }).config ?? {};
  const staleness = useStore((s) => s.staleness[id]);
  const isRunning = useStore((s) => s.runningNodeId === id);
  const label = cfg.database_url ? "Database configured" : "No database set";

  return (
    <div className={`hx-node hx-node--notion ${selected ? "selected" : ""} ${isRunning ? "running" : ""}`}>
      <div className="hx-node-header">
        <span className="hx-node-icon-sm" style={{ opacity: 0.8 }}><NotionIcon size={12} /></span>
        <span className="hx-node-title">Notion Output</span>
        <span className="hx-node-status notion" />
      </div>
      <div className="hx-node-body">
        <div className="hx-node-sub">{label}</div>
        <StaleBadge staleness={staleness} running={isRunning} />
      </div>
      <Handle type="target" position={Position.Left} />
    </div>
  );
}
