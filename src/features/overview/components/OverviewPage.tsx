import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRightLeft,
  Bot,
  CircleAlert,
  Clock3,
  FileCog,
  Gauge,
  HardDrive,
  MessageSquarePlus,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useAgentsDirectory } from "@/features/chat/hooks/useAgents";
import { useChatStore } from "@/features/chat/store";
import {
  createDefaultDateRange,
  formatCurrency,
  formatTokens,
  type UsageModelAggregateEntry,
} from "@/features/usage/components/usage-utils";
import { useConnectionStore } from "@/features/connection/store";
import { gateway } from "@/lib/gateway";
import type { ConnectionState, GatewayConfig } from "@/lib/gateway/types";
import { cn, formatRelativeTime, truncate } from "@/lib/utils";
import {
  asRecord,
  loadOverview,
  readBoolean,
  readNumber,
  readString,
  type JsonRecord,
  type OverviewData,
  type OverviewSessionItem,
} from "./overview-data";
import "./overview.css";

const OVERVIEW_QUERY_KEY = ["gateway-overview"] as const;
const DEFAULT_GATEWAY_NAME = "Gateway";
const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
const LANGUAGE_STORAGE_KEY = "openclaw.desktop.overview.language";
const AUTH_REQUIRED_CODES = new Set([
  "AUTH_REQUIRED",
  "AUTH_TOKEN_MISSING",
  "AUTH_PASSWORD_MISSING",
  "AUTH_TOKEN_NOT_CONFIGURED",
  "AUTH_PASSWORD_NOT_CONFIGURED",
]);
const AUTH_FAILURE_CODES = new Set([
  ...AUTH_REQUIRED_CODES,
  "AUTH_UNAUTHORIZED",
  "AUTH_TOKEN_MISMATCH",
  "AUTH_PASSWORD_MISMATCH",
  "AUTH_DEVICE_TOKEN_MISMATCH",
  "AUTH_RATE_LIMITED",
  "AUTH_TAILSCALE_IDENTITY_MISSING",
  "AUTH_TAILSCALE_PROXY_MISSING",
  "AUTH_TAILSCALE_WHOIS_FAILED",
  "AUTH_TAILSCALE_IDENTITY_MISMATCH",
]);
const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "pt-BR", label: "Português (Brasil)" },
] as const;

type AlertTone = "danger" | "warn" | "info" | "ok";

type AlertItem = {
  id: string;
  tone: AlertTone;
  title: string;
  detail: string;
};

type TimelineItem = {
  id: string;
  kind: "session" | "event" | "heartbeat";
  title: string;
  detail: string;
  timestamp: number;
};

function normalizeLanguage(value: string | null | undefined): string {
  if (!value) {
    return "en";
  }
  const exact = LANGUAGE_OPTIONS.find((option) => option.value === value);
  if (exact) {
    return exact.value;
  }
  const base = value.split("-")[0]?.toLowerCase() ?? "en";
  return LANGUAGE_OPTIONS.find((option) => option.value.toLowerCase() === base)?.value ?? "en";
}

function getInitialLanguage(): string {
  if (typeof window === "undefined") {
    return "en";
  }
  try {
    return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? navigator.language);
  } catch {
    return normalizeLanguage(navigator.language);
  }
}

function formatDurationHuman(durationMs: number | null | undefined): string {
  if (!durationMs || durationMs <= 0) {
    return "n/a";
  }

  const totalSeconds = Math.floor(durationMs / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 && parts.length === 0) parts.push(`${seconds}s`);

  return parts.slice(0, 2).join(" ") || "0s";
}

function formatRelativeTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp || Number.isNaN(timestamp)) {
    return "n/a";
  }

  const diff = timestamp - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (abs < 60_000) {
    return rtf.format(Math.round(diff / 1_000), "second");
  }
  if (abs < 3_600_000) {
    return rtf.format(Math.round(diff / 60_000), "minute");
  }
  if (abs < 86_400_000) {
    return rtf.format(Math.round(diff / 3_600_000), "hour");
  }
  if (abs < 2_592_000_000) {
    return rtf.format(Math.round(diff / 86_400_000), "day");
  }

  return new Date(timestamp).toLocaleString();
}

function formatCount(value: number | null | undefined): string {
  return value == null ? "n/a" : value.toLocaleString();
}

function formatCompactCount(value: number | null | undefined): string {
  if (value == null) return "n/a";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function formatNextRun(timestamp: number | null | undefined): string {
  return timestamp ? formatRelativeTimestamp(timestamp) : "n/a";
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function isTrustedProxy(authMode: string | null): boolean {
  return authMode === "trusted-proxy";
}

function shouldShowPairingHint(connected: boolean, lastError: string | null, lastErrorCode: string | null): boolean {
  if (connected || !lastError) {
    return false;
  }
  return lastErrorCode === "PAIRING_REQUIRED" || lastError.toLowerCase().includes("pairing required");
}

function shouldShowAuthHint(connected: boolean, lastError: string | null, lastErrorCode: string | null): boolean {
  if (connected || !lastError) {
    return false;
  }
  if (lastErrorCode) {
    return AUTH_FAILURE_CODES.has(lastErrorCode);
  }
  const lower = lastError.toLowerCase();
  return lower.includes("unauthorized") || lower.includes("auth") || lower.includes("connect failed");
}

function shouldShowInsecureContextHint(
  connected: boolean,
  lastError: string | null,
  lastErrorCode: string | null,
): boolean {
  if (connected || !lastError) {
    return false;
  }
  if (typeof window !== "undefined" && window.isSecureContext) {
    return false;
  }
  if (lastErrorCode === "CONTROL_UI_DEVICE_IDENTITY_REQUIRED" || lastErrorCode === "DEVICE_IDENTITY_REQUIRED") {
    return true;
  }
  const lower = lastError.toLowerCase();
  return lower.includes("secure context") || lower.includes("device identity required");
}

function buildConnectPayload(config: GatewayConfig | null, gatewayUrl: string, token: string): Omit<GatewayConfig, "id"> {
  return {
    name: config?.name?.trim() || DEFAULT_GATEWAY_NAME,
    url: gatewayUrl.trim(),
    token: token.trim(),
    scopes: config?.scopes,
    deviceId: config?.deviceId,
    deviceToken: config?.deviceToken,
    isDefault: config?.isDefault,
  };
}

function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case "connected":
      return "Online";
    case "connecting":
      return "Connecting";
    case "authenticating":
      return "Authenticating";
    case "pairing_required":
      return "Pairing required";
    case "error":
      return "Error";
    case "reconnecting":
      return "Reconnecting";
    case "disconnected":
    default:
      return "Offline";
  }
}

function connectionTone(state: ConnectionState): AlertTone {
  switch (state) {
    case "connected":
      return "ok";
    case "connecting":
    case "authenticating":
    case "reconnecting":
      return "warn";
    case "pairing_required":
    case "error":
      return "danger";
    case "disconnected":
    default:
      return "warn";
  }
}

function resolveHealthTone(
  health: JsonRecord | null,
  status: JsonRecord | null,
  connectionState: ConnectionState,
  hasError: boolean,
): AlertTone {
  if (hasError || connectionState === "error") {
    return "danger";
  }

  const explicitHealthy =
    readBoolean(health, "healthy") ??
    readBoolean(health, "ok") ??
    readBoolean(status, "healthy") ??
    readBoolean(status, "ok");
  if (explicitHealthy === true) {
    return "ok";
  }
  if (explicitHealthy === false) {
    return "danger";
  }

  const healthState =
    readString(health, "status") ?? readString(health, "state") ?? readString(status, "status") ?? readString(status, "state");
  if (healthState) {
    const normalized = healthState.toLowerCase();
    if (["ok", "healthy", "ready", "passing"].includes(normalized)) {
      return "ok";
    }
    if (["warn", "warning", "degraded"].includes(normalized)) {
      return "warn";
    }
    if (["error", "fail", "failed", "critical", "unhealthy"].includes(normalized)) {
      return "danger";
    }
  }

  return connectionState === "connected" ? "ok" : "warn";
}

function resolveHealthLabel(tone: AlertTone): string {
  switch (tone) {
    case "ok":
      return "Healthy";
    case "danger":
      return "Degraded";
    case "warn":
      return "Checking";
    case "info":
    default:
      return "Unknown";
  }
}

function extractHeartbeatAt(heartbeat: JsonRecord | null): number | null {
  return (
    readNumber(heartbeat, "timestamp") ??
    readNumber(heartbeat, "ts") ??
    readNumber(heartbeat, "time") ??
    readNumber(heartbeat, "receivedAt") ??
    null
  );
}

function getChartBars(data: OverviewData | undefined) {
  const days = data?.usageSessions?.aggregates.daily ?? [];
  const costDaily = data?.usageCost?.daily ?? [];
  const fallbackRange = createDefaultDateRange(7);
  const result = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(fallbackRange.startDate);
    date.setDate(date.getDate() + index);
    const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    const sessionDay = days.find((entry) => entry.date === iso);
    const costDay = costDaily.find((entry) => entry.date === iso);
    return {
      date: iso,
      label: new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" }),
      tokens: sessionDay?.tokens ?? costDay?.totalTokens ?? 0,
      cost: sessionDay?.cost ?? costDay?.totalCost ?? 0,
      messages: sessionDay?.messages ?? 0,
    };
  });

  const maxTokens = Math.max(...result.map((entry) => entry.tokens), 1);
  return result.map((entry) => ({
    ...entry,
    percent: Math.max((entry.tokens / maxTokens) * 100, entry.tokens > 0 ? 8 : 0),
  }));
}

function getTopModels(data: OverviewData | undefined): Array<UsageModelAggregateEntry & { label: string; share: number }> {
  const byModel = data?.usageSessions?.aggregates.byModel ?? [];
  const totalTokens = byModel.reduce((sum, entry) => sum + (entry.totals.totalTokens ?? 0), 0);
  return [...byModel]
    .sort((left, right) => (right.totals.totalTokens ?? 0) - (left.totals.totalTokens ?? 0))
    .slice(0, 5)
    .map((entry) => ({
      ...entry,
      label: [entry.provider, entry.model].filter(Boolean).join("/") || "Unspecified model",
      share: totalTokens > 0 ? ((entry.totals.totalTokens ?? 0) / totalTokens) * 100 : 0,
    }));
}

function getProviderSummary(data: OverviewData | undefined): Array<{ label: string; tokens: number }> {
  return [...(data?.usageSessions?.aggregates.byProvider ?? [])]
    .sort((left, right) => (right.totals.totalTokens ?? 0) - (left.totals.totalTokens ?? 0))
    .slice(0, 4)
    .map((entry) => ({
      label: entry.provider || "unknown",
      tokens: entry.totals.totalTokens ?? 0,
    }));
}

function createAlerts(
  data: OverviewData | undefined,
  connectionState: ConnectionState,
  lastError: string | null,
  lastErrorCode: string | null,
  activeConfig: GatewayConfig | null,
  healthTone: AlertTone,
): AlertItem[] {
  const alerts: AlertItem[] = [];

  if (lastError) {
    alerts.push({
      id: "connection-error",
      tone: "danger",
      title: connectionState === "pairing_required" ? "Pairing required" : "Gateway connection issue",
      detail: lastError,
    });
  }

  if (lastErrorCode && AUTH_REQUIRED_CODES.has(lastErrorCode)) {
    alerts.push({
      id: "auth-required",
      tone: "warn",
      title: "Authentication required",
      detail: "Provide a valid gateway token or trusted proxy session, then reconnect.",
    });
  }

  if (healthTone === "danger") {
    alerts.push({
      id: "health-degraded",
      tone: "danger",
      title: "Health checks degraded",
      detail: "The latest status/health snapshot indicates the gateway may not be serving requests cleanly.",
    });
  }

  if ((data?.issues.length ?? 0) > 0) {
    alerts.push({
      id: "partial-refresh",
      tone: "warn",
      title: "Partial data refresh",
      detail: `${data?.issues.length ?? 0} overview RPC calls failed, so some cards may be stale until the next refresh.`,
    });
  }

  if (activeConfig && !activeConfig.token.trim() && !isTrustedProxy(readString(asRecord(gateway.authResult?.snapshot), "authMode"))) {
    alerts.push({
      id: "token-missing",
      tone: "info",
      title: "Token not stored",
      detail: "This profile has no persisted token. Reconnect from a tokenized URL to streamline future access.",
    });
  }

  if ((data?.models.length ?? 0) === 0 && connectionState === "connected") {
    alerts.push({
      id: "models-empty",
      tone: "warn",
      title: "No models catalog reported",
      detail: "`models.list` returned empty. Verify providers are configured and reachable.",
    });
  }

  if ((data?.cronEnabled ?? null) === false) {
    alerts.push({
      id: "cron-disabled",
      tone: "info",
      title: "Cron is disabled",
      detail: "Scheduled automations are paused. Re-enable cron if you expect recurring tasks to run.",
    });
  }

  return alerts.slice(0, 5);
}

function buildTimeline(data: OverviewData | undefined, heartbeatAt: number | null): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const session of data?.sessions.slice(0, 5) ?? []) {
    if (!session.updatedAt) continue;
    items.push({
      id: `session-${session.key}`,
      kind: "session",
      title: session.title,
      detail: `${session.messageCount.toLocaleString()} messages · ${session.agentId ?? "unassigned agent"}`,
      timestamp: session.updatedAt,
    });
  }

  for (const event of gateway.recentEvents.slice(-5)) {
    items.push({
      id: `event-${event.event}-${event.time}`,
      kind: "event",
      title: event.event,
      detail: truncate(event.payloadSnippet, 96),
      timestamp: event.time,
    });
  }

  if (heartbeatAt) {
    items.push({
      id: `heartbeat-${heartbeatAt}`,
      kind: "heartbeat",
      title: "Heartbeat received",
      detail: "Gateway heartbeat updated the local client diagnostics.",
      timestamp: heartbeatAt,
    });
  }

  return items.sort((left, right) => right.timestamp - left.timestamp).slice(0, 8);
}

function renderSessionTitle(session: OverviewSessionItem) {
  return truncate(session.title || session.key, 56);
}

export function OverviewPage() {
  const navigate = useNavigate();
  const connectionState = useConnectionStore((store) => store.state);
  const connectionError = useConnectionStore((store) => store.error);
  const configs = useConnectionStore((store) => store.configs);
  const activeConfigId = useConnectionStore((store) => store.activeConfigId);
  const addConfig = useConnectionStore((store) => store.addConfig);
  const updateConfig = useConnectionStore((store) => store.updateConfig);
  const setActiveConfig = useConnectionStore((store) => store.setActiveConfig);
  const connect = useConnectionStore((store) => store.connect);
  const selectedSessionId = useChatStore((store) => store.selectedSessionId);
  const selectedAgentId = useChatStore((store) => store.selectedAgentId);
  const selectSession = useChatStore((store) => store.selectSession);
  const selectAgent = useChatStore((store) => store.selectAgent);
  const { data: agentDirectory } = useAgentsDirectory();

  const [gatewayUrlDraft, setGatewayUrlDraft] = useState(DEFAULT_GATEWAY_URL);
  const [tokenDraft, setTokenDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [sessionKeyDraft, setSessionKeyDraft] = useState("main");
  const [languageDraft, setLanguageDraft] = useState(getInitialLanguage);
  const [isConnecting, setIsConnecting] = useState(false);
  const [, setLiveTick] = useState(0);

  const isConnected = connectionState === "connected";
  const activeConfig = useMemo(
    () => configs.find((config) => config.id === activeConfigId) ?? configs[0] ?? null,
    [activeConfigId, configs],
  );

  useEffect(() => {
    setGatewayUrlDraft(activeConfig?.url ?? DEFAULT_GATEWAY_URL);
    setTokenDraft(activeConfig?.token ?? "");
  }, [activeConfig]);

  useEffect(() => {
    setSessionKeyDraft(selectedSessionId?.trim() || "main");
  }, [selectedSessionId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, languageDraft);
    } catch {
      // Ignore local storage failures.
    }
  }, [languageDraft]);

  useEffect(() => {
    let batchedTimer: number | null = null;
    const scheduleTick = () => {
      if (batchedTimer != null) {
        return;
      }
      batchedTimer = window.setTimeout(() => {
        batchedTimer = null;
        setLiveTick((value) => value + 1);
      }, 180);
    };

    const subscription = gateway.on("*", scheduleTick);
    const timer = window.setInterval(() => {
      setLiveTick((value) => value + 1);
    }, 60_000);

    return () => {
      subscription.unsubscribe();
      window.clearInterval(timer);
      if (batchedTimer != null) {
        window.clearTimeout(batchedTimer);
      }
    };
  }, []);

  const overviewQuery = useQuery<OverviewData>({
    queryKey: [...OVERVIEW_QUERY_KEY, activeConfigId ?? "none"],
    enabled: isConnected,
    staleTime: 10_000,
    refetchInterval: isConnected ? 20_000 : false,
    placeholderData: (previousData) => previousData,
    queryFn: loadOverview,
  });

  const showLoadingShell = overviewQuery.isLoading && !overviewQuery.data;

  const snapshot = asRecord(gateway.authResult?.snapshot);
  const statusRecord = overviewQuery.data?.status ?? snapshot;
  const healthRecord = overviewQuery.data?.health ?? null;
  const statusPolicy = asRecord(asRecord(statusRecord)?.policy);
  const authMode = readString(snapshot, "authMode") ?? readString(statusRecord, "authMode");
  const trustedProxy = isTrustedProxy(authMode);
  const uptime = formatDurationHuman(readNumber(snapshot, "uptimeMs") ?? readNumber(statusRecord, "uptimeMs"));
  const tickIntervalMs = readNumber(asRecord(snapshot?.policy), "tickIntervalMs") ?? readNumber(statusPolicy, "tickIntervalMs");
  const tickInterval = tickIntervalMs != null ? `${tickIntervalMs}ms` : "n/a";
  const lastError = connectionError?.message ?? null;
  const lastErrorCode = connectionError?.code ?? null;
  const heartbeatAt = extractHeartbeatAt(overviewQuery.data?.heartbeat ?? null) ?? (gateway.lastEventAt || null);
  const healthTone = resolveHealthTone(healthRecord, statusRecord, connectionState, Boolean(lastError));
  const alerts = useMemo(
    () => createAlerts(overviewQuery.data, connectionState, lastError, lastErrorCode, activeConfig, healthTone),
    [overviewQuery.data, connectionState, lastError, lastErrorCode, activeConfig, healthTone],
  );
  const timeline = useMemo(
    () => buildTimeline(overviewQuery.data, heartbeatAt),
    [overviewQuery.data, heartbeatAt],
  );
  const chartBars = useMemo(() => getChartBars(overviewQuery.data), [overviewQuery.data]);
  const topModels = useMemo(() => getTopModels(overviewQuery.data), [overviewQuery.data]);
  const providerSummary = useMemo(() => getProviderSummary(overviewQuery.data), [overviewQuery.data]);

  const usageTotals = overviewQuery.data?.usageCost?.totals ?? overviewQuery.data?.usageSessions?.totals ?? null;
  const modelCatalogCount = overviewQuery.data?.models.length ?? 0;
  const activeModelCount = new Set(topModels.map((entry) => entry.label)).size;
  const totalMessages = overviewQuery.data?.usageSessions?.aggregates.messages.total ?? 0;
  const authMethods = gateway.authResult?.methods.length ?? 0;
  const authEvents = gateway.authResult?.events.length ?? 0;
  const connectionStatusLabel = connectionLabel(connectionState);
  const refreshLabel = overviewQuery.data ? `Updated ${formatRelativeTime(overviewQuery.data.loadedAt)}` : "Waiting for data";

  async function handleConnect() {
    const nextUrl = gatewayUrlDraft.trim();
    const nextToken = tokenDraft.trim();
    const nextSessionKey = sessionKeyDraft.trim() || "main";

    if (!nextUrl) {
      return;
    }

    setIsConnecting(true);

    try {
      selectSession(nextSessionKey);

      if (activeConfig) {
        updateConfig(activeConfig.id, buildConnectPayload(activeConfig, nextUrl, nextToken));
        if (activeConfigId !== activeConfig.id) {
          setActiveConfig(activeConfig.id);
        }
        await connect(activeConfig.id);
      } else {
        const created = addConfig(buildConnectPayload(null, nextUrl, nextToken));
        setActiveConfig(created.id);
        await connect(created.id);
      }
    } catch {
      // Connection errors surface through the store and callout below.
    } finally {
      setIsConnecting(false);
    }
  }

  function handleCreateSession() {
    const preferredAgentId = selectedAgentId ?? agentDirectory?.defaultId ?? agentDirectory?.agents[0]?.id ?? null;
    if (!preferredAgentId) {
      navigate("/agents");
      return;
    }

    const draftSessionId = `agent:${preferredAgentId}:${crypto.randomUUID()}`;
    selectAgent(preferredAgentId);
    selectSession(draftSessionId);
    navigate("/chat");
  }

  async function handleSwitchConfig(configId: string) {
    const nextConfig = configs.find((config) => config.id === configId);
    if (!nextConfig) {
      return;
    }

    setActiveConfig(configId);
    if (connectionState === "connected" || connectionState === "connecting" || connectionState === "authenticating") {
      try {
        await connect(configId);
      } catch {
        // surfaced by store
      }
    }
  }

  const snapshotCallout = (() => {
    if (lastError) {
      return (
        <div className="overview-callout overview-callout--danger" aria-live="polite">
          <div>{lastError}</div>

          {shouldShowPairingHint(isConnected, lastError, lastErrorCode) && (
            <div className="overview-callout__stack">
              <div>This device needs pairing approval from the gateway host.</div>
              <div className="overview-callout__code">
                <span>openclaw devices list</span>
                <span>openclaw devices approve &lt;requestId&gt;</span>
              </div>
              <a className="overview-link" href="https://docs.openclaw.ai/web/control-ui#device-pairing-first-connection" target="_blank" rel="noreferrer">
                Docs: Device pairing
              </a>
            </div>
          )}

          {shouldShowAuthHint(isConnected, lastError, lastErrorCode) && (
            <div className="overview-callout__stack">
              <div>
                {lastErrorCode && AUTH_REQUIRED_CODES.has(lastErrorCode)
                  ? "The gateway requires authentication. Add a token or trusted proxy session, then reconnect."
                  : "Auth failed. Re-copy a tokenized URL with openclaw dashboard --no-open, or update the token, then click Connect."}
              </div>
              <div className="overview-callout__code">
                <span>openclaw dashboard --no-open</span>
                <span>openclaw doctor --generate-gateway-token</span>
              </div>
              <a className="overview-link" href="https://docs.openclaw.ai/web/dashboard" target="_blank" rel="noreferrer">
                Docs: Control UI auth
              </a>
            </div>
          )}

          {shouldShowInsecureContextHint(isConnected, lastError, lastErrorCode) && (
            <div className="overview-callout__stack">
              <div>
                This page is HTTP, so the browser blocks device identity. Use HTTPS through Tailscale Serve, or open <code>http://127.0.0.1:18789</code> on the gateway host.
              </div>
              <div>If you must stay on HTTP, set <code>gateway.controlUi.allowInsecureAuth: true</code> (token-only).</div>
              <div className="overview-callout__links">
                <a className="overview-link" href="https://docs.openclaw.ai/gateway/tailscale" target="_blank" rel="noreferrer">
                  Docs: Tailscale Serve
                </a>
                <span className="overview-muted">·</span>
                <a className="overview-link" href="https://docs.openclaw.ai/web/control-ui#insecure-http" target="_blank" rel="noreferrer">
                  Docs: Insecure HTTP
                </a>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (overviewQuery.error) {
      return <div className="overview-callout overview-callout--danger" aria-live="polite">{String(overviewQuery.error)}</div>;
    }

    if (overviewQuery.data?.issues.length) {
      return (
        <div className="overview-callout" aria-live="polite">
          Some overview RPCs failed to refresh, so a few panels may still be stale while the dashboard keeps the last good snapshot visible.
        </div>
      );
    }

    return <div className="overview-callout">Use Channels to link WhatsApp, Telegram, Discord, Signal, or iMessage and keep their health visible here.</div>;
  })();

  return (
    <div className="overview-page">
      <section className="overview-hero">
        <div>
          <div className="overview-hero__eyebrow">Control Surface</div>
          <h2 className="overview-hero__title">Overview</h2>
          <p className="overview-hero__subtitle">
            Official-style gateway command center with live health, usage, alerts, and quick actions.
          </p>
        </div>
        <div className="overview-hero__meta">
          <div className="overview-pill">
            <span className={cn("overview-status-dot", `is-${connectionTone(connectionState)}`)} />
            {connectionStatusLabel}
          </div>
          <div className="overview-pill">
            <Clock3 size={13} />
            {refreshLabel}
          </div>
          <button
            type="button"
            className="overview-btn"
            onClick={() => {
              void overviewQuery.refetch();
            }}
            disabled={!isConnected || overviewQuery.isFetching}
          >
            <RefreshCw size={14} className={overviewQuery.isFetching ? "spin" : undefined} />
            {overviewQuery.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

      <section className="overview-grid overview-grid--top">
        <div className="overview-card overview-card--access">
          <div className="overview-card__header">
            <div>
              <div className="overview-card__title">Gateway Access</div>
              <div className="overview-card__subtitle">Same connection surface as the official WebUI, with desktop-friendly profile switching.</div>
            </div>
            <div className="overview-inline-status">
              <span className={cn("overview-status-dot", `is-${connectionTone(connectionState)}`)} />
              {connectionStatusLabel}
            </div>
          </div>

          <div className="overview-profile-row">
            <label className="overview-field overview-field--compact">
              <span>Profile</span>
              <select
                value={activeConfig?.id ?? ""}
                onChange={(event) => {
                  const nextId = event.target.value;
                  if (nextId) {
                    setActiveConfig(nextId);
                  }
                }}
                disabled={configs.length === 0}
              >
                {configs.length === 0 ? <option value="">No saved profiles</option> : null}
                {configs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="overview-btn overview-btn--secondary"
              onClick={() => {
                if (activeConfig?.id) {
                  void handleSwitchConfig(activeConfig.id);
                }
              }}
              disabled={!activeConfig?.id || isConnecting}
            >
              <ArrowRightLeft size={14} />
              Switch Config
            </button>
          </div>

          <div className="overview-form-grid">
            <label className="overview-field">
              <span>WebSocket URL</span>
              <input
                value={gatewayUrlDraft}
                onChange={(event) => setGatewayUrlDraft(event.target.value)}
                placeholder="ws://100.x.y.z:18789"
              />
            </label>

            {!trustedProxy && (
              <label className="overview-field">
                <span>Gateway Token</span>
                <input
                  value={tokenDraft}
                  onChange={(event) => setTokenDraft(event.target.value)}
                  placeholder="OPENCLAW_GATEWAY_TOKEN"
                />
              </label>
            )}

            {!trustedProxy && (
              <label className="overview-field">
                <span>Password (not stored)</span>
                <input
                  type="password"
                  value={passwordDraft}
                  onChange={(event) => setPasswordDraft(event.target.value)}
                  placeholder="system or shared password"
                  disabled
                />
              </label>
            )}

            <label className="overview-field">
              <span>Default Session Key</span>
              <input
                value={sessionKeyDraft}
                onChange={(event) => setSessionKeyDraft(event.target.value)}
                placeholder="main"
              />
            </label>

            <label className="overview-field">
              <span>Language</span>
              <select value={languageDraft} onChange={(event) => setLanguageDraft(event.target.value)}>
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="overview-actions-row">
            <button
              type="button"
              className="overview-btn overview-btn--primary"
              onClick={() => {
                void handleConnect();
              }}
              disabled={isConnecting || gatewayUrlDraft.trim().length === 0}
            >
              <Wifi size={14} />
              {isConnecting ? "Connecting…" : "Connect"}
            </button>
            <button type="button" className="overview-btn" onClick={handleCreateSession} disabled={!isConnected}>
              <MessageSquarePlus size={14} />
              New Session
            </button>
            <span className="overview-muted overview-actions-row__hint">
              {trustedProxy ? "Authenticated via trusted proxy." : "Apply URL or token changes from here, then jump straight into a new session."}
            </span>
          </div>
        </div>

        <div className="overview-card overview-card--snapshot">
          <div className="overview-card__header">
            <div>
              <div className="overview-card__title">System Snapshot</div>
              <div className="overview-card__subtitle">Gateway, connection, and health at a glance, aligned with upstream overview semantics.</div>
            </div>
            <div className={cn("overview-health-badge", `is-${healthTone}`)}>
              <ShieldCheck size={14} />
              {resolveHealthLabel(healthTone)}
            </div>
          </div>

          <div className="overview-status-grid">
            <div className="overview-status-card">
              <div className="overview-status-card__label">Gateway</div>
              <div className="overview-status-card__value">
                <span className={cn("overview-status-dot", `is-${connectionTone(connectionState)}`)} />
                {connectionStatusLabel}
              </div>
              <div className="overview-status-card__meta">{activeConfig?.name ?? DEFAULT_GATEWAY_NAME}</div>
            </div>
            <div className="overview-status-card">
              <div className="overview-status-card__label">Connection</div>
              <div className="overview-status-card__value">{gateway.runtimeContext.socketTransport === "tauri-plugin-websocket" ? "Desktop WS" : "WebSocket"}</div>
              <div className="overview-status-card__meta">{activeConfig?.url ?? DEFAULT_GATEWAY_URL}</div>
            </div>
            <div className="overview-status-card">
              <div className="overview-status-card__label">Health</div>
              <div className="overview-status-card__value">{resolveHealthLabel(healthTone)}</div>
              <div className="overview-status-card__meta">{readString(healthRecord, "status") ?? readString(healthRecord, "state") ?? "Live status probe"}</div>
            </div>
          </div>

          <div className="overview-stat-grid">
            <div className="overview-stat">
              <div className="overview-stat__label">Uptime</div>
              <div className="overview-stat__value">{uptime}</div>
            </div>
            <div className="overview-stat">
              <div className="overview-stat__label">Tick Interval</div>
              <div className="overview-stat__value">{tickInterval}</div>
            </div>
            <div className="overview-stat">
              <div className="overview-stat__label">Last Heartbeat</div>
              <div className="overview-stat__value">{formatRelativeTimestamp(heartbeatAt)}</div>
            </div>
            <div className="overview-stat">
              <div className="overview-stat__label">Channels Refresh</div>
              <div className="overview-stat__value">{formatRelativeTimestamp(overviewQuery.data?.lastChannelsRefresh)}</div>
            </div>
          </div>

          {snapshotCallout}
        </div>
      </section>

      <section className="overview-grid overview-grid--metrics">
        <div className="overview-card overview-card--metric">
          <div className="overview-metric__icon"><Sparkles size={16} /></div>
          <div className="overview-stat__label">Active Sessions</div>
          <div className="overview-stat__value">{formatCount(overviewQuery.data?.sessionsCount)}</div>
          <div className="overview-muted">Recent session keys tracked by the gateway.</div>
        </div>
        <div className="overview-card overview-card--metric">
          <div className="overview-metric__icon"><Wifi size={16} /></div>
          <div className="overview-stat__label">Presence Beacons</div>
          <div className="overview-stat__value">{formatCount(overviewQuery.data?.presenceCount)}</div>
          <div className="overview-muted">Instances seen in the latest presence snapshot.</div>
        </div>
        <div className="overview-card overview-card--metric">
          <div className="overview-metric__icon"><Gauge size={16} /></div>
          <div className="overview-stat__label">7-Day Tokens</div>
          <div className="overview-stat__value">{formatCompactCount(usageTotals?.totalTokens)}</div>
          <div className="overview-muted">{formatCount(totalMessages)} messages in the current usage window.</div>
        </div>
        <div className="overview-card overview-card--metric">
          <div className="overview-metric__icon"><HardDrive size={16} /></div>
          <div className="overview-stat__label">Usage Cost</div>
          <div className="overview-stat__value">{usageTotals ? formatCurrency(usageTotals.totalCost) : "n/a"}</div>
          <div className="overview-muted">Input, output, cache read, and cache write blended cost.</div>
        </div>
        <div className="overview-card overview-card--metric">
          <div className="overview-metric__icon"><Bot size={16} /></div>
          <div className="overview-stat__label">Model Coverage</div>
          <div className="overview-stat__value">{formatCount(activeModelCount || modelCatalogCount)}</div>
          <div className="overview-muted">{formatCount(modelCatalogCount)} catalog models returned by `models.list`.</div>
        </div>
        <div className="overview-card overview-card--metric">
          <div className="overview-metric__icon"><Activity size={16} /></div>
          <div className="overview-stat__label">Channels Online</div>
          <div className="overview-stat__value">{overviewQuery.data ? `${overviewQuery.data.channelsOnline}/${overviewQuery.data.channelsTotal}` : "n/a"}</div>
          <div className="overview-muted">Cron {overviewQuery.data?.cronEnabled == null ? "n/a" : overviewQuery.data.cronEnabled ? "enabled" : "disabled"} · next run {formatNextRun(overviewQuery.data?.cronNextWakeAtMs)}</div>
        </div>
      </section>

      <section className="overview-grid overview-grid--middle">
        <div className="overview-card">
          <div className="overview-card__header">
            <div>
              <div className="overview-card__title">Token Usage</div>
              <div className="overview-card__subtitle">Seven-day token and cost trend, optimized for low-jank refreshes.</div>
            </div>
            <div className="overview-inline-status">{usageTotals ? formatTokens(usageTotals.totalTokens) : "n/a"}</div>
          </div>

          <div className="overview-chart">
            {chartBars.map((bar) => (
              <div key={bar.date} className="overview-chart__column">
                <div
                  className="overview-chart__bar-wrap"
                  title={`${bar.label}: ${formatTokens(bar.tokens)} tokens · ${formatCurrency(bar.cost)}`}
                >
                  <div className="overview-chart__bar" style={{ height: `${bar.percent}%` }} />
                </div>
                <div className="overview-chart__value">{bar.tokens > 0 ? formatCompactCount(bar.tokens) : "—"}</div>
                <div className="overview-chart__label">{bar.label}</div>
              </div>
            ))}
          </div>

          <div className="overview-kpi-row">
            <div className="overview-kpi">
              <span>Messages</span>
              <strong>{formatCount(totalMessages)}</strong>
            </div>
            <div className="overview-kpi">
              <span>Cost</span>
              <strong>{usageTotals ? formatCurrency(usageTotals.totalCost) : "n/a"}</strong>
            </div>
            <div className="overview-kpi">
              <span>Cache Read</span>
              <strong>{usageTotals ? formatTokens(usageTotals.cacheRead) : "n/a"}</strong>
            </div>
          </div>
        </div>

        <div className="overview-card">
          <div className="overview-card__header">
            <div>
              <div className="overview-card__title">Model Distribution</div>
              <div className="overview-card__subtitle">Top models by token share in the same usage window.</div>
            </div>
            <div className="overview-inline-status">{providerSummary.length} providers</div>
          </div>

          {topModels.length === 0 ? (
            <div className="overview-empty-inline">No model usage has been reported for the current window yet.</div>
          ) : (
            <div className="overview-distribution-list">
              {topModels.map((model) => (
                <div key={model.label} className="overview-distribution-row">
                  <div className="overview-distribution-row__top">
                    <div>
                      <div className="overview-distribution-row__label">{model.label}</div>
                      <div className="overview-muted">{formatTokens(model.totals.totalTokens ?? 0)} tokens · {formatCount(model.count ?? 0)} runs</div>
                    </div>
                    <div className="overview-distribution-row__share">{formatPercent(model.share)}</div>
                  </div>
                  <div className="overview-progress">
                    <div className="overview-progress__bar" style={{ width: `${Math.max(model.share, 6)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {providerSummary.length > 0 ? (
            <div className="overview-tag-row">
              {providerSummary.map((provider) => (
                <span key={provider.label} className="overview-tag">
                  {provider.label} · {formatCompactCount(provider.tokens)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="overview-grid overview-grid--bottom">
        <div className="overview-card">
          <div className="overview-card__header">
            <div>
              <div className="overview-card__title">Quick Actions</div>
              <div className="overview-card__subtitle">One-click entry points for the most common operator flows.</div>
            </div>
          </div>

          <div className="overview-actions-grid">
            <button type="button" className="overview-action-tile" onClick={handleCreateSession} disabled={!isConnected}>
              <MessageSquarePlus size={16} />
              <span>New Session</span>
              <small>Open chat with a fresh draft conversation.</small>
            </button>
            <button
              type="button"
              className="overview-action-tile"
              onClick={() => {
                if (activeConfig?.id) {
                  void handleSwitchConfig(activeConfig.id);
                }
              }}
              disabled={!activeConfig?.id}
            >
              <ArrowRightLeft size={16} />
              <span>Switch Config</span>
              <small>Reconnect using the selected gateway profile.</small>
            </button>
            <button type="button" className="overview-action-tile" onClick={() => navigate("/logs")}>
              <ScrollText size={16} />
              <span>View Logs</span>
              <small>Inspect recent gateway events buffered locally.</small>
            </button>
            <button type="button" className="overview-action-tile" onClick={() => navigate("/settings")}>
              <FileCog size={16} />
              <span>Open Config</span>
              <small>Jump to raw gateway config and auth metadata.</small>
            </button>
          </div>

          {configs.length > 0 ? (
            <div className="overview-profile-switcher">
              {configs.map((config) => {
                const isActive = config.id === activeConfig?.id;
                const isLive = isActive && connectionState === "connected";
                return (
                  <button
                    key={config.id}
                    type="button"
                    className={cn("overview-profile-chip", isActive && "is-active", isLive && "is-live")}
                    onClick={() => {
                      setActiveConfig(config.id);
                    }}
                  >
                    <span className={cn("overview-status-dot", isLive ? "is-ok" : "is-info")} />
                    <span>{config.name}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="overview-empty-inline">No saved gateway profiles yet. Add one from this page or the connection workspace.</div>
          )}
        </div>

        <div className="overview-card">
          <div className="overview-card__header">
            <div>
              <div className="overview-card__title">Alerts & Notifications</div>
              <div className="overview-card__subtitle">Warnings, auth hints, and operational reminders surfaced from live diagnostics.</div>
            </div>
            <div className="overview-inline-status">{alerts.length} active</div>
          </div>

          {alerts.length === 0 ? (
            <div className="overview-empty-inline overview-empty-inline--success">
              <ShieldCheck size={16} />
              No active alerts. Gateway health, auth, and usage signals look stable.
            </div>
          ) : (
            <div className="overview-alert-list" aria-live="polite">
              {alerts.map((alert) => (
                <div key={alert.id} className={cn("overview-alert", `is-${alert.tone}`)}>
                  <div className="overview-alert__title">
                    <CircleAlert size={15} />
                    {alert.title}
                  </div>
                  <div className="overview-alert__detail">{alert.detail}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="overview-grid overview-grid--timeline">
        <div className="overview-card">
          <div className="overview-card__header">
            <div>
              <div className="overview-card__title">Recent Activity</div>
              <div className="overview-card__subtitle">Merged timeline of recent sessions, gateway events, and heartbeat diagnostics.</div>
            </div>
            <div className="overview-inline-status">{timeline.length} items</div>
          </div>

          {timeline.length === 0 ? (
            <div className="overview-empty-inline">No recent activity yet. Connect a gateway and start a session to populate the timeline.</div>
          ) : (
            <div className="overview-timeline">
              {timeline.map((item) => (
                <div key={item.id} className="overview-timeline__item">
                  <div className={cn("overview-timeline__dot", `is-${item.kind}`)} />
                  <div className="overview-timeline__body">
                    <div className="overview-timeline__title">{item.title}</div>
                    <div className="overview-timeline__detail">{item.detail}</div>
                  </div>
                  <div className="overview-timeline__time">{formatRelativeTimestamp(item.timestamp)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="overview-card overview-card--notes">
          <div className="overview-card__header">
            <div>
              <div className="overview-card__title">Runtime Notes</div>
              <div className="overview-card__subtitle">Official-style operator reminders plus live desktop diagnostics.</div>
            </div>
          </div>

          <div className="overview-note-grid">
            <div className="overview-note">
              <div className="overview-note__title">Tailscale serve</div>
              <div className="overview-muted">Prefer Tailscale Serve to keep the gateway on loopback while preserving device auth and safer exposure.</div>
            </div>
            <div className="overview-note">
              <div className="overview-note__title">Session hygiene</div>
              <div className="overview-muted">Use a fresh draft session for context resets, or jump to Sessions to patch metadata and defaults.</div>
            </div>
            <div className="overview-note">
              <div className="overview-note__title">Cron reminders</div>
              <div className="overview-muted">Keep recurring tasks isolated from ad-hoc operator chats to preserve deterministic prompts and token accounting.</div>
            </div>
          </div>

          <div className="overview-runtime-grid">
            <div className="overview-runtime-row">
              <span><TerminalSquare size={14} /> Runtime</span>
              <strong>{gateway.runtimeContext.clientId}/{gateway.runtimeContext.clientMode}</strong>
            </div>
            <div className="overview-runtime-row">
              <span><WifiOff size={14} /> Transport</span>
              <strong>{gateway.runtimeContext.socketTransport}</strong>
            </div>
            <div className="overview-runtime-row">
              <span><ShieldCheck size={14} /> Auth surface</span>
              <strong>{trustedProxy ? "trusted-proxy" : authMode ?? "token/password"}</strong>
            </div>
            <div className="overview-runtime-row">
              <span><Bot size={14} /> Methods / Events</span>
              <strong>{authMethods} / {authEvents}</strong>
            </div>
          </div>

          <div className="overview-session-list">
            {(overviewQuery.data?.sessions.slice(0, 4) ?? []).map((session) => (
              <button
                key={session.key}
                type="button"
                className="overview-session-row"
                title={`${session.title} · ${session.messageCount.toLocaleString()} messages`}
                onClick={() => {
                  selectSession(session.key);
                  navigate("/chat");
                }}
              >
                <div>
                  <div className="overview-session-row__title">{renderSessionTitle(session)}</div>
                  <div className="overview-muted">{session.agentId ?? "no agent"} · {session.messageCount.toLocaleString()} messages</div>
                </div>
                <div className="overview-session-row__time">{formatRelativeTimestamp(session.updatedAt)}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {showLoadingShell ? (
        <section className="overview-grid overview-grid--metrics" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="overview-card overview-card--metric overview-skeleton-card">
              <div className="overview-skeleton overview-skeleton--icon" />
              <div className="overview-skeleton overview-skeleton--line short" />
              <div className="overview-skeleton overview-skeleton--line" />
              <div className="overview-skeleton overview-skeleton--line mid" />
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
