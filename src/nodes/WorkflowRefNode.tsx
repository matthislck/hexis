import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";
import { useStore } from "../store";
import { StaleBadge } from "./StaleBadge";

export function WorkflowRefNode({ id, data, selected }: NodeProps) {
  const cfg = (data as { config: { ref_workflow_id?: string; ref_workflow_name?: string } }).config ?? {};
  const staleness = useStore((s) => s.staleness[id]);
  const isRunning = useStore((s) => s.runningNodeId === id);
  const label = cfg.ref_workflow_name || (cfg.ref_workflow_id ? "Workflow linked" : "No workflow set");

  return (
    <div className={`hx-node hx-node--workflow-ref ${selected ? "selected" : ""} ${isRunning ? "running" : ""}`}>
      <div className="hx-node-header">
        <span className="hx-node-icon-sm"><GitBranch size={12} strokeWidth={1.75} /></span>
        <span className="hx-node-title">Workflow Input</span>
        <span className="hx-node-status workflow-ref" />
      </div>
      <div className="hx-node-body">
        <div className="hx-node-sub">{label}</div>
        <StaleBadge staleness={staleness} running={isRunning} />
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
