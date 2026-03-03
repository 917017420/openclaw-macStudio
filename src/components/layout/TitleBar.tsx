import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StatusBadge } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";

export function TitleBar() {
  const state = useConnectionStore((s) => s.state);
  const appWindow = getCurrentWindow();

  return (
    <header
      data-tauri-drag-region
      className="no-select flex h-12 items-center justify-between border-b border-border bg-surface-0 px-4"
    >
      {/* macOS traffic lights spacing */}
      <div className="flex items-center gap-3 pl-16">
        <h1
          data-tauri-drag-region
          className="text-sm font-semibold text-text-primary"
        >
          OpenClaw
        </h1>
        <StatusBadge status={state} />
      </div>

      {/* Window controls (hidden on macOS with native controls) */}
      <div className="hidden items-center gap-1">
        <button
          className="rounded p-1.5 hover:bg-surface-2"
          onClick={() => appWindow.minimize()}
        >
          <Minus size={14} />
        </button>
        <button
          className="rounded p-1.5 hover:bg-surface-2"
          onClick={() => appWindow.toggleMaximize()}
        >
          <Square size={12} />
        </button>
        <button
          className="rounded p-1.5 hover:bg-status-error hover:text-white"
          onClick={() => appWindow.close()}
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
