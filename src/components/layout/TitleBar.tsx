import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useConnectionStore } from "@/features/connection/store";

function statusText(state: string): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "pairing_required":
      return "Pairing Required";
    case "error":
      return "Error";
    default:
      return "Disconnected";
  }
}

export function TitleBar() {
  const state = useConnectionStore((s) => s.state);
  const appWindow = getCurrentWindow();
  const dotClass =
    state === "connected"
      ? "status-dot connected"
      : state === "error" || state === "disconnected"
        ? "status-dot error"
        : "status-dot";

  return (
    <header data-tauri-drag-region className="topbar no-select">
      <div data-tauri-drag-region className="topbar-left">
        <div className="brand" data-tauri-drag-region>
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-title" data-tauri-drag-region>
            OpenClaw
          </span>
        </div>
        <span className="topbar-status-pill">
          <span className={dotClass} />
          <span>{statusText(state)}</span>
        </span>
      </div>

      <div data-tauri-drag-region className="topbar-spacer" />

      <div className="window-controls no-drag">
        <button className="window-btn" onClick={() => appWindow.minimize()} title="最小化">
          <Minus size={14} />
        </button>
        <button className="window-btn" onClick={() => appWindow.toggleMaximize()} title="全屏/还原">
          <Square size={12} />
        </button>
        <button className="window-btn close" onClick={() => appWindow.close()} title="关闭">
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
