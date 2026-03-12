import type { ConnectionState } from "@/lib/gateway/types";
import { useAppPreferencesStore, isChineseLanguage } from "@/features/preferences/store";

interface StatusBadgeProps {
  status: ConnectionState | "running" | "idle" | "error";
  label?: string;
  size?: "sm" | "md";
}

const statusConfig: Record<string, { color: string; label: string }> = {
  connected: { color: "bg-status-connected", label: "Connected" },
  connecting: { color: "bg-status-warning", label: "Connecting" },
  authenticating: { color: "bg-status-warning", label: "Authenticating" },
  reconnecting: { color: "bg-status-warning", label: "Reconnecting" },
  pairing_required: { color: "bg-amber-500", label: "Pairing Required" },
  disconnected: { color: "bg-status-disconnected", label: "Disconnected" },
  error: { color: "bg-status-error", label: "Error" },
  running: { color: "bg-status-running", label: "Running" },
  idle: { color: "bg-status-idle", label: "Idle" },
};

export function StatusBadge({ status, label, size = "sm" }: StatusBadgeProps) {
  const language = useAppPreferencesStore((store) => store.language);
  const isChinese = isChineseLanguage(language);
  const config = statusConfig[status] ?? statusConfig.disconnected;
  const localizeLabel = (value: string) =>
    isChinese
      ? ({
          Connected: "已连接",
          Connecting: "连接中",
          Authenticating: "认证中",
          Reconnecting: "重连中",
          "Pairing Required": "等待配对",
          Disconnected: "未连接",
          Error: "错误",
          Running: "运行中",
          Idle: "空闲",
          Linked: "已绑定",
          "Not linked": "未绑定",
          Invalid: "无效",
          Ready: "就绪",
        }[value] ?? value)
      : value;
  const displayLabel = localizeLabel(label ?? config.label);

  return (
    <div className={`inline-flex items-center gap-1.5 ${size === "sm" ? "text-xs" : "text-sm"}`}>
      <span
        className={`inline-block rounded-full ${config.color} ${
          size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5"
        } ${status === "connecting" || status === "authenticating" || status === "reconnecting" ? "animate-pulse" : ""}`}
      />
      <span className="text-text-secondary">{displayLabel}</span>
    </div>
  );
}
