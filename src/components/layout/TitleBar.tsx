import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useConnectionStore } from "@/features/connection/store";
import { isChineseLanguage, useAppPreferencesStore } from "@/features/preferences/store";

type WindowControls = Pick<
  ReturnType<typeof getCurrentWindow>,
  "minimize" | "toggleMaximize" | "close"
>;

const browserWindowControls: WindowControls = {
  minimize: async () => {},
  toggleMaximize: async () => {},
  close: async () => {},
};

function resolveWindowControls(): WindowControls {
  try {
    return getCurrentWindow();
  } catch {
    return browserWindowControls;
  }
}

function statusText(state: string, isChinese: boolean): string {
  switch (state) {
    case "connected":
      return isChinese ? "已连接" : "Connected";
    case "connecting":
      return isChinese ? "连接中" : "Connecting";
    case "reconnecting":
      return isChinese ? "重连中" : "Reconnecting";
    case "pairing_required":
      return isChinese ? "等待配对" : "Pairing Required";
    case "error":
      return isChinese ? "错误" : "Error";
    default:
      return isChinese ? "未连接" : "Disconnected";
  }
}

export function TitleBar() {
  const state = useConnectionStore((s) => s.state);
  const language = useAppPreferencesStore((store) => store.language);
  const isChinese = isChineseLanguage(language);
  const appWindow = resolveWindowControls();
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
          <span>{statusText(state, isChinese)}</span>
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
