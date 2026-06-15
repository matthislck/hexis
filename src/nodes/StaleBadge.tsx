import type { Staleness } from "../types";

const CONFIG: Record<Staleness, { label: string; cls: string }> = {
  fresh:  { label: "up to date", cls: "stale-fresh"  },
  stale:  { label: "stale",      cls: "stale-stale"  },
  never:  { label: "never run",  cls: "stale-never"  },
};

export function StaleBadge({ staleness, running }: { staleness?: Staleness; running?: boolean }) {
  if (running) return (
    <div className="stale-badge stale-running">
      <span className="stale-spinner" />
      <span className="stale-label">running</span>
    </div>
  );
  if (!staleness) return null;
  const { label, cls } = CONFIG[staleness];
  return (
    <div className={`stale-badge ${cls}`} title={label}>
      <span className="stale-dot">●</span>
      <span className="stale-label">{label}</span>
    </div>
  );
}
