import { useStore } from "./store";

const ICONS = { success: "✓", error: "✕", warning: "⚠" };

export function ToastStack() {
  const toasts = useStore((s) => s.toasts);
  const removeToast = useStore((s) => s.removeToast);

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => removeToast(t.id)}>
          <span className="toast-icon">{ICONS[t.type]}</span>
          <div className="toast-body">
            <span className="toast-msg">{t.message}</span>
            {t.sub && <span className="toast-sub">{t.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
