import type { ConnectionState } from "@/lib/gateway/types";

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
  const config = statusConfig[status] ?? statusConfig.disconnected;
  const displayLabel = label ?? config.label;

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
