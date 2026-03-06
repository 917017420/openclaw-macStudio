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
      className="no-select flex h-12 items-center justify-between border-b border-border/80 bg-surface-1/95 px-4 backdrop-blur"
    >
      {/* macOS traffic lights spacing */}
      <div data-tauri-drag-region className="flex items-center gap-3 pl-16">
        <h1
          data-tauri-drag-region
          className="text-sm font-semibold tracking-wide text-text-primary"
        >
          OpenClaw
        </h1>
        <StatusBadge status={state} />
      </div>

      <div data-tauri-drag-region className="h-full flex-1" />

      {/* Window controls */}
      <div className="no-drag flex items-center gap-1.5">
        <button
          className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          onClick={() => appWindow.minimize()}
          title="最小化"
        >
          <Minus size={14} />
        </button>
        <button
          className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          onClick={() => appWindow.toggleMaximize()}
          title="全屏/还原"
        >
          <Square size={12} />
        </button>
        <button
          className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-status-error hover:text-white"
          onClick={() => appWindow.close()}
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
