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
import { LANGUAGE_OPTIONS, useAppPreferencesStore } from "@/features/preferences/store";
import { gateway } from "@/lib/gateway";
import type { ConnectionState, GatewayConfig } from "@/lib/gateway/types";
import { cn, truncate } from "@/lib/utils";
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
import { getOverviewCopy, type OverviewCopy } from "./overview-copy";
import "./overview.css";

const OVERVIEW_QUERY_KEY = ["gateway-overview"] as const;
const DEFAULT_GATEWAY_NAME = "Gateway";
const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
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

function formatDurationHuman(durationMs: number | null | undefined, copy: OverviewCopy): string {
  if (!durationMs || durationMs <= 0) {
    return copy.na;
  }

  const totalSeconds = Math.floor(durationMs / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(copy.zeroSeconds === "0秒" ? `${days}天` : `${days}d`);
  if (hours > 0) parts.push(copy.zeroSeconds === "0秒" ? `${hours}小时` : `${hours}h`);
  if (minutes > 0) parts.push(copy.zeroSeconds === "0秒" ? `${minutes}分` : `${minutes}m`);
  if (seconds > 0 && parts.length === 0) parts.push(copy.zeroSeconds === "0秒" ? `${seconds}秒` : `${seconds}s`);

  return parts.slice(0, 2).join(" ") || copy.zeroSeconds;
}

function formatRelativeTimestamp(timestamp: number | null | undefined, locale: string, copy: OverviewCopy): string {
  if (!timestamp || Number.isNaN(timestamp)) {
    return copy.na;
  }

  const diff = timestamp - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

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

  return new Date(timestamp).toLocaleString(locale);
}

function formatCount(value: number | null | undefined, locale: string, copy: OverviewCopy): string {
  return value == null ? copy.na : value.toLocaleString(locale);
}

function formatCompactCount(value: number | null | undefined, locale: string, copy: OverviewCopy): string {
  if (value == null) return copy.na;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString(locale);
}

function formatNextRun(timestamp: number | null | undefined, locale: string, copy: OverviewCopy): string {
  return timestamp ? formatRelativeTimestamp(timestamp, locale, copy) : copy.na;
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

function connectionLabel(state: ConnectionState, copy: OverviewCopy): string {
  switch (state) {
    case "connected":
      return copy.connectionStates.online;
    case "connecting":
      return copy.connectionStates.connecting;
    case "authenticating":
      return copy.connectionStates.authenticating;
    case "pairing_required":
      return copy.connectionStates.pairingRequired;
    case "error":
      return copy.connectionStates.error;
    case "reconnecting":
      return copy.connectionStates.reconnecting;
    case "disconnected":
    default:
      return copy.connectionStates.offline;
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

function resolveHealthLabel(tone: AlertTone, copy: OverviewCopy): string {
  switch (tone) {
    case "ok":
      return copy.healthLabels.ok;
    case "danger":
      return copy.healthLabels.danger;
    case "warn":
      return copy.healthLabels.warn;
    case "info":
    default:
      return copy.healthLabels.info;
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

function getChartBars(data: OverviewData | undefined, locale: string) {
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
      label: new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { weekday: "short" }),
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

function getTopModels(data: OverviewData | undefined, copy: OverviewCopy): Array<UsageModelAggregateEntry & { label: string; share: number }> {
  const byModel = data?.usageSessions?.aggregates.byModel ?? [];
  const totalTokens = byModel.reduce((sum, entry) => sum + (entry.totals.totalTokens ?? 0), 0);
  return [...byModel]
    .sort((left, right) => (right.totals.totalTokens ?? 0) - (left.totals.totalTokens ?? 0))
    .slice(0, 5)
    .map((entry) => ({
      ...entry,
      label: [entry.provider, entry.model].filter(Boolean).join("/") || copy.modelUnspecified,
      share: totalTokens > 0 ? ((entry.totals.totalTokens ?? 0) / totalTokens) * 100 : 0,
    }));
}

function getProviderSummary(data: OverviewData | undefined, copy: OverviewCopy): Array<{ label: string; tokens: number }> {
  return [...(data?.usageSessions?.aggregates.byProvider ?? [])]
    .sort((left, right) => (right.totals.totalTokens ?? 0) - (left.totals.totalTokens ?? 0))
    .slice(0, 4)
    .map((entry) => ({
      label: entry.provider || copy.providerUnknown,
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
  copy: OverviewCopy,
): AlertItem[] {
  const alerts: AlertItem[] = [];

  if (lastError) {
    alerts.push({
      id: "connection-error",
      tone: "danger",
      title: connectionState === "pairing_required" ? copy.alerts.pairingRequired : copy.alerts.gatewayConnectionIssue,
      detail: lastError,
    });
  }

  if (lastErrorCode && AUTH_REQUIRED_CODES.has(lastErrorCode)) {
    alerts.push({
      id: "auth-required",
      tone: "warn",
      title: copy.alerts.authenticationRequired,
      detail: copy.alerts.authenticationRequiredDetail,
    });
  }

  if (healthTone === "danger") {
    alerts.push({
      id: "health-degraded",
      tone: "danger",
      title: copy.alerts.healthChecksDegraded,
      detail: copy.alerts.healthChecksDegradedDetail,
    });
  }

  if ((data?.issues.length ?? 0) > 0) {
    alerts.push({
      id: "partial-refresh",
      tone: "warn",
      title: copy.alerts.partialDataRefresh,
      detail: copy.alerts.partialDataRefreshDetail(data?.issues.length ?? 0),
    });
  }

  if (activeConfig && !activeConfig.token.trim() && !isTrustedProxy(readString(asRecord(gateway.authResult?.snapshot), "authMode"))) {
    alerts.push({
      id: "token-missing",
      tone: "info",
      title: copy.alerts.tokenNotStored,
      detail: copy.alerts.tokenNotStoredDetail,
    });
  }

  if ((data?.models.length ?? 0) === 0 && connectionState === "connected") {
    alerts.push({
      id: "models-empty",
      tone: "warn",
      title: copy.alerts.noModelsCatalog,
      detail: copy.alerts.noModelsCatalogDetail,
    });
  }

  if ((data?.cronEnabled ?? null) === false) {
    alerts.push({
      id: "cron-disabled",
      tone: "info",
      title: copy.alerts.cronDisabled,
      detail: copy.alerts.cronDisabledDetail,
    });
  }

  return alerts.slice(0, 5);
}

function buildTimeline(data: OverviewData | undefined, heartbeatAt: number | null, locale: string, copy: OverviewCopy): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const session of data?.sessions.slice(0, 5) ?? []) {
    if (!session.updatedAt) continue;
    items.push({
      id: `session-${session.key}`,
      kind: "session",
      title: session.title,
      detail: copy.timeline.sessionDetail(session.messageCount.toLocaleString(locale), session.agentId ?? copy.unassignedAgent),
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
      title: copy.timeline.heartbeatReceived,
      detail: copy.timeline.heartbeatDetail,
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
  const language = useAppPreferencesStore((store) => store.language);
  const setLanguage = useAppPreferencesStore((store) => store.setLanguage);
  const { data: agentDirectory } = useAgentsDirectory();

  const [gatewayUrlDraft, setGatewayUrlDraft] = useState(DEFAULT_GATEWAY_URL);
  const [tokenDraft, setTokenDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [sessionKeyDraft, setSessionKeyDraft] = useState("main");
  const [isConnecting, setIsConnecting] = useState(false);
  const [, setLiveTick] = useState(0);
  const copy = getOverviewCopy(language);
  const locale = language;

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
  const uptime = formatDurationHuman(readNumber(snapshot, "uptimeMs") ?? readNumber(statusRecord, "uptimeMs"), copy);
  const tickIntervalMs = readNumber(asRecord(snapshot?.policy), "tickIntervalMs") ?? readNumber(statusPolicy, "tickIntervalMs");
  const tickInterval = tickIntervalMs != null ? `${tickIntervalMs}ms` : copy.na;
  const lastError = connectionError?.message ?? null;
  const lastErrorCode = connectionError?.code ?? null;
  const heartbeatAt = extractHeartbeatAt(overviewQuery.data?.heartbeat ?? null) ?? (gateway.lastEventAt || null);
  const healthTone = resolveHealthTone(healthRecord, statusRecord, connectionState, Boolean(lastError));
  const alerts = useMemo(
    () => createAlerts(overviewQuery.data, connectionState, lastError, lastErrorCode, activeConfig, healthTone, copy),
    [overviewQuery.data, connectionState, lastError, lastErrorCode, activeConfig, healthTone, copy],
  );
  const timeline = useMemo(
    () => buildTimeline(overviewQuery.data, heartbeatAt, locale, copy),
    [overviewQuery.data, heartbeatAt, locale, copy],
  );
  const chartBars = useMemo(() => getChartBars(overviewQuery.data, locale), [overviewQuery.data, locale]);
  const topModels = useMemo(() => getTopModels(overviewQuery.data, copy), [overviewQuery.data, copy]);
  const providerSummary = useMemo(() => getProviderSummary(overviewQuery.data, copy), [overviewQuery.data, copy]);

  const usageTotals = overviewQuery.data?.usageCost?.totals ?? overviewQuery.data?.usageSessions?.totals ?? null;
  const modelCatalogCount = overviewQuery.data?.models.length ?? 0;
  const activeModelCount = new Set(topModels.map((entry) => entry.label)).size;
  const totalMessages = overviewQuery.data?.usageSessions?.aggregates.messages.total ?? 0;
  const authMethods = gateway.authResult?.methods.length ?? 0;
  const authEvents = gateway.authResult?.events.length ?? 0;
  const connectionStatusLabel = connectionLabel(connectionState, copy);
  const refreshLabel = overviewQuery.data
    ? copy.hero.updated(formatRelativeTimestamp(overviewQuery.data.loadedAt, locale, copy))
    : copy.hero.waitingForData;

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
              <div>{copy.callouts.pairingNeedApproval}</div>
              <div className="overview-callout__code">
                <span>openclaw devices list</span>
                <span>openclaw devices approve &lt;requestId&gt;</span>
              </div>
              <a className="overview-link" href="https://docs.openclaw.ai/web/control-ui#device-pairing-first-connection" target="_blank" rel="noreferrer">
                {copy.callouts.devicePairingDocs}
              </a>
            </div>
          )}

          {shouldShowAuthHint(isConnected, lastError, lastErrorCode) && (
            <div className="overview-callout__stack">
              <div>
                {lastErrorCode && AUTH_REQUIRED_CODES.has(lastErrorCode)
                  ? copy.callouts.authRequired
                  : copy.callouts.authFailed}
              </div>
              <div className="overview-callout__code">
                <span>openclaw dashboard --no-open</span>
                <span>openclaw doctor --generate-gateway-token</span>
              </div>
              <a className="overview-link" href="https://docs.openclaw.ai/web/dashboard" target="_blank" rel="noreferrer">
                {copy.callouts.authDocs}
              </a>
            </div>
          )}

          {shouldShowInsecureContextHint(isConnected, lastError, lastErrorCode) && (
            <div className="overview-callout__stack">
              <div>{copy.callouts.insecureHttp}</div>
              <div>{copy.callouts.insecureHttpDetail}</div>
              <div className="overview-callout__links">
                <a className="overview-link" href="https://docs.openclaw.ai/gateway/tailscale" target="_blank" rel="noreferrer">
                  {copy.callouts.tailscaleDocs}
                </a>
                <span className="overview-muted">·</span>
                <a className="overview-link" href="https://docs.openclaw.ai/web/control-ui#insecure-http" target="_blank" rel="noreferrer">
                  {copy.callouts.insecureHttpDocs}
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
          {copy.callouts.partialRpc}
        </div>
      );
    }

    return <div className="overview-callout">{copy.callouts.channelsHint}</div>;
  })();

  return (
    <div className="overview-page">
      <section className="overview-hero">
        <div>
          <div className="overview-hero__eyebrow">{copy.hero.eyebrow}</div>
          <h2 className="overview-hero__title">{copy.hero.title}</h2>
          <p className="overview-hero__subtitle">
            {copy.hero.subtitle}
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
            {overviewQuery.isFetching ? copy.hero.refreshing : copy.hero.refresh}
          </button>
        </div>
      </section>

      <section className="overview-grid overview-grid--top">
        <div className="overview-card overview-card--access">
          <div className="overview-card__header">
            <div>
              <div className="overview-card__title">{copy.access.title}</div>
              <div className="overview-card__subtitle">{copy.access.subtitle}</div>
            </div>
            <div className="overview-inline-status">
              <span className={cn("overview-status-dot", `is-${connectionTone(connectionState)}`)} />
              {connectionStatusLabel}
            </div>
          </div>

          <div className="overview-profile-row">
            <label className="overview-field overview-field--compact">
              <span>{copy.access.profile}</span>
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
                {configs.length === 0 ? <option value="">{copy.access.noSavedProfiles}</option> : null}
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
              {copy.access.switchConfig}
            </button>
          </div>

          <div className="overview-form-grid">
            <label className="overview-field">
              <span>{copy.access.websocketUrl}</span>
              <input
                value={gatewayUrlDraft}
                onChange={(event) => setGatewayUrlDraft(event.target.value)}
                placeholder="ws://100.x.y.z:18789"
              />
            </label>

            {!trustedProxy && (
              <label className="overview-field">
                <span>{copy.access.gatewayToken}</span>
                <input
                  value={tokenDraft}
                  onChange={(event) => setTokenDraft(event.target.value)}
                  placeholder="OPENCLAW_GATEWAY_TOKEN"
                />
              </label>
            )}

            {!trustedProxy && (
              <label className="overview-field">
                <span>{copy.access.password}</span>
                <input
                  type="password"
                  value={passwordDraft}
                  onChange={(event) => setPasswordDraft(event.target.value)}
                  placeholder={copy.access.passwordPlaceholder}
                  disabled
                />
              </label>
            )}

            <label className="overview-field">
              <span>{copy.access.defaultSessionKey}</span>
              <input
                value={sessionKeyDraft}
                onChange={(event) => setSessionKeyDraft(event.target.value)}
                placeholder="main"
              />
            </label>

            <label className="overview-field">
              <span>{copy.access.language}</span>
              <select value={language} onChange={(event) => setLanguage(event.target.value)}>
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
              {isConnecting ? copy.access.connecting : copy.access.connect}
            </button>
            <button type="button" className="overview-btn" onClick={handleCreateSession} disabled={!isConnected}>
              <MessageSquarePlus size={14} />
              {copy.access.newSession}
            </button>
            <span className="overview-muted overview-actions-row__hint">
              {trustedProxy ? copy.access.trustedProxyHint : copy.access.sessionHint}
            </span>
          </div>
        </div>

        <div className="overview-card overview-card--snapshot">
          <div className="overview-card__header">
            <div>
              <div className="overview-card__title">{copy.snapshot.title}</div>
              <div className="overview-card__subtitle">{copy.snapshot.subtitle}</div>
            </div>
            <div className={cn("overview-health-badge", `is-${healthTone}`)}>
              <ShieldCheck size={14} />
              {resolveHealthLabel(healthTone, copy)}
            </div>
          </div>

          <div className="overview-status-grid">
            <div className="overview-status-card">
              <div className="overview-status-card__label">{copy.snapshot.gateway}</div>
              <div className="overview-status-card__value">
                <span className={cn("overview-status-dot", `is-${connectionTone(connectionState)}`)} />
                {connectionStatusLabel}
              </div>
              <div className="overview-status-card__meta">{activeConfig?.name ?? DEFAULT_GATEWAY_NAME}</div>
            </div>
            <div className="overview-status-card">
              <div className="overview-status-card__label">{copy.snapshot.connection}</div>
              <div className="overview-status-card__value">{gateway.runtimeContext.socketTransport === "tauri-plugin-websocket" ? copy.desktopWs : copy.webSocket}</div>
              <div className="overview-status-card__meta">{activeConfig?.url ?? DEFAULT_GATEWAY_URL}</div>
            </div>
            <div className="overview-status-card">
              <div className="overview-status-card__label">{copy.snapshot.health}</div>
              <div className="overview-status-card__value">{resolveHealthLabel(healthTone, copy)}</div>
              <div className="overview-status-card__meta">{readString(healthRecord, "status") ?? readString(healthRecord, "state") ?? copy.liveStatusProbe}</div>
            </div>
          </div>

          <div className="overview-stat-grid">
            <div className="overview-stat">
              <div className="overview-stat__label">{copy.snapshot.uptime}</div>
              <div className="overview-stat__value">{uptime}</div>
            </div>
            <div className="overview-stat">
              <div className="overview-stat__label">{copy.snapshot.tickInterval}</div>
              <div className="overview-stat__value">{tickInterval}</div>
            </div>
            <div className="overview-stat">
              <div className="overview-stat__label">{copy.snapshot.lastHeartbeat}</div>
              <div className="overview-stat__value">{formatRelativeTimestamp(heartbeatAt, locale, copy)}</div>
            </div>
            <div className="overview-stat">
              <div className="overview-stat__label">{copy.snapshot.channelsRefresh}</div>
              <div className="overview-stat__value">{formatRelativeTimestamp(overviewQuery.data?.lastChannelsRefresh, locale, copy)}</div>
            </div>
          </div>

          {snapshotCallout}
        </div>
      </section>

      <section className="overview-grid overview-grid--metrics">
        <div className="overview-card overview-card--metric">
          <div className="overview-metric__icon"><Sparkles size={16} /></div>
          <div className="overview-stat__label">{copy.metrics.activeSessions}</div>
          <div className="overview-stat__value">{formatCount(overviewQuery.data?.sessionsCount, locale, copy)}</div>
          <div className="overview-muted">{copy.metrics.activeSessionsDetail}</div>
        </div>
        <div className="overview-card overview-card--metric">
          <div className="overview-metric__icon"><Wifi size={16} /></div>
          <div className="overview-stat__label">{copy.metrics.presenceBeacons}</div>
          <div className="overview-stat__value">{formatCount(overviewQuery.data?.presenceCount, locale, copy)}</div>
          <div className="overview-muted">{copy.metrics.presenceBeaconsDetail}</div>
        </div>
        <div className="overview-card overview-card--metric">
          <div className="overview-metric__icon"><Gauge size={16} /></div>
          <div className="overview-stat__label">{copy.metrics.sevenDayTokens}</div>
          <div className="overview-stat__value">{formatCompactCount(usageTotals?.totalTokens, locale, copy)}</div>
          <div className="overview-muted">{copy.metrics.messagesInWindow(formatCount(totalMessages, locale, copy))}</div>
        </div>
        <div className="overview-card overview-card--metric">
          <div className="overview-metric__icon"><HardDrive size={16} /></div>
          <div className="overview-stat__label">{copy.metrics.usageCost}</div>
          <div className="overview-stat__value">{usageTotals ? formatCurrency(usageTotals.totalCost) : copy.na}</div>
          <div className="overview-muted">{copy.metrics.usageCostDetail}</div>
        </div>
        <div className="overview-card overview-card--metric">
          <div className="overview-metric__icon"><Bot size={16} /></div>
          <div className="overview-stat__label">{copy.metrics.modelCoverage}</div>
          <div className="overview-stat__value">{formatCount(activeModelCount || modelCatalogCount, locale, copy)}</div>
          <div className="overview-muted">{copy.metrics.modelCoverageDetail(formatCount(modelCatalogCount, locale, copy))}</div>
        </div>
        <div className="overview-card overview-card--metric">
          <div className="overview-metric__icon"><Activity size={16} /></div>
          <div className="overview-stat__label">{copy.metrics.channelsOnline}</div>
          <div className="overview-stat__value">{overviewQuery.data ? `${overviewQuery.data.channelsOnline}/${overviewQuery.data.channelsTotal}` : copy.na}</div>
          <div className="overview-muted">
            {copy.metrics.cronSummary(
              overviewQuery.data?.cronEnabled == null ? copy.na : overviewQuery.data.cronEnabled ? copy.metrics.cronEnabled : copy.metrics.cronDisabled,
              formatNextRun(overviewQuery.data?.cronNextWakeAtMs, locale, copy),
            )}
          </div>
        </div>
      </section>

      <section className="overview-grid overview-grid--middle">
        <div className="overview-card">
          <div className="overview-card__header">
            <div>
              <div className="overview-card__title">{copy.usage.title}</div>
              <div className="overview-card__subtitle">{copy.usage.subtitle}</div>
            </div>
            <div className="overview-inline-status">{usageTotals ? formatTokens(usageTotals.totalTokens) : copy.na}</div>
          </div>

          <div className="overview-chart">
            {chartBars.map((bar) => (
              <div key={bar.date} className="overview-chart__column">
                <div
                  className="overview-chart__bar-wrap"
                  title={copy.chart.tooltip(bar.label, formatTokens(bar.tokens), formatCurrency(bar.cost))}
                >
                  <div className="overview-chart__bar" style={{ height: `${bar.percent}%` }} />
                </div>
                <div className="overview-chart__value">{bar.tokens > 0 ? formatCompactCount(bar.tokens, locale, copy) : "—"}</div>
                <div className="overview-chart__label">{bar.label}</div>
              </div>
            ))}
          </div>

          <div className="overview-kpi-row">
            <div className="overview-kpi">
              <span>{copy.usage.messages}</span>
              <strong>{formatCount(totalMessages, locale, copy)}</strong>
            </div>
            <div className="overview-kpi">
              <span>{copy.usage.cost}</span>
              <strong>{usageTotals ? formatCurrency(usageTotals.totalCost) : copy.na}</strong>
            </div>
            <div className="overview-kpi">
              <span>{copy.usage.cacheRead}</span>
              <strong>{usageTotals ? formatTokens(usageTotals.cacheRead) : copy.na}</strong>
            </div>
          </div>
        </div>

        <div className="overview-card">
          <div className="overview-card__header">
            <div>
              <div className="overview-card__title">{copy.models.title}</div>
              <div className="overview-card__subtitle">{copy.models.subtitle}</div>
            </div>
            <div className="overview-inline-status">{copy.models.providersCount(providerSummary.length)}</div>
          </div>

          {topModels.length === 0 ? (
            <div className="overview-empty-inline">{copy.models.empty}</div>
          ) : (
            <div className="overview-distribution-list">
              {topModels.map((model) => (
                <div key={model.label} className="overview-distribution-row">
                  <div className="overview-distribution-row__top">
                    <div>
                      <div className="overview-distribution-row__label">{model.label}</div>
                      <div className="overview-muted">
                        {copy.models.tokensAndRuns(
                          formatTokens(model.totals.totalTokens ?? 0),
                          formatCount(model.count ?? 0, locale, copy),
                        )}
                      </div>
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
                  {provider.label} · {formatCompactCount(provider.tokens, locale, copy)}
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
              <div className="overview-card__title">{copy.quickActions.title}</div>
              <div className="overview-card__subtitle">{copy.quickActions.subtitle}</div>
            </div>
          </div>

          <div className="overview-actions-grid">
            <button type="button" className="overview-action-tile" onClick={handleCreateSession} disabled={!isConnected}>
              <MessageSquarePlus size={16} />
              <span>{copy.quickActions.newSession}</span>
              <small>{copy.quickActions.newSessionDetail}</small>
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
              <span>{copy.quickActions.switchConfig}</span>
              <small>{copy.quickActions.switchConfigDetail}</small>
            </button>
            <button type="button" className="overview-action-tile" onClick={() => navigate("/logs")}>
              <ScrollText size={16} />
              <span>{copy.quickActions.viewLogs}</span>
              <small>{copy.quickActions.viewLogsDetail}</small>
            </button>
            <button type="button" className="overview-action-tile" onClick={() => navigate("/settings")}>
              <FileCog size={16} />
              <span>{copy.quickActions.openConfig}</span>
              <small>{copy.quickActions.openConfigDetail}</small>
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
            <div className="overview-empty-inline">{copy.quickActions.noProfiles}</div>
          )}
        </div>

        <div className="overview-card">
          <div className="overview-card__header">
            <div>
              <div className="overview-card__title">{copy.notifications.title}</div>
              <div className="overview-card__subtitle">{copy.notifications.subtitle}</div>
            </div>
            <div className="overview-inline-status">{copy.notifications.activeCount(alerts.length)}</div>
          </div>

          {alerts.length === 0 ? (
            <div className="overview-empty-inline overview-empty-inline--success">
              <ShieldCheck size={16} />
              {copy.notifications.empty}
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
              <div className="overview-card__title">{copy.timeline.title}</div>
              <div className="overview-card__subtitle">{copy.timeline.subtitle}</div>
            </div>
            <div className="overview-inline-status">{copy.timeline.itemCount(timeline.length)}</div>
          </div>

          {timeline.length === 0 ? (
            <div className="overview-empty-inline">{copy.timeline.empty}</div>
          ) : (
            <div className="overview-timeline">
              {timeline.map((item) => (
                <div key={item.id} className="overview-timeline__item">
                  <div className={cn("overview-timeline__dot", `is-${item.kind}`)} />
                  <div className="overview-timeline__body">
                    <div className="overview-timeline__title">{item.title}</div>
                    <div className="overview-timeline__detail">{item.detail}</div>
                  </div>
                  <div className="overview-timeline__time">{formatRelativeTimestamp(item.timestamp, locale, copy)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="overview-card overview-card--notes">
          <div className="overview-card__header">
            <div>
              <div className="overview-card__title">{copy.notes.title}</div>
              <div className="overview-card__subtitle">{copy.notes.subtitle}</div>
            </div>
          </div>

          <div className="overview-note-grid">
            <div className="overview-note">
              <div className="overview-note__title">{copy.notes.tailscaleTitle}</div>
              <div className="overview-muted">{copy.notes.tailscaleDetail}</div>
            </div>
            <div className="overview-note">
              <div className="overview-note__title">{copy.notes.sessionTitle}</div>
              <div className="overview-muted">{copy.notes.sessionDetail}</div>
            </div>
            <div className="overview-note">
              <div className="overview-note__title">{copy.notes.cronTitle}</div>
              <div className="overview-muted">{copy.notes.cronDetail}</div>
            </div>
          </div>

          <div className="overview-runtime-grid">
            <div className="overview-runtime-row">
              <span><TerminalSquare size={14} /> {copy.notes.runtime}</span>
              <strong>{gateway.runtimeContext.clientId}/{gateway.runtimeContext.clientMode}</strong>
            </div>
            <div className="overview-runtime-row">
              <span><WifiOff size={14} /> {copy.notes.transport}</span>
              <strong>{gateway.runtimeContext.socketTransport}</strong>
            </div>
            <div className="overview-runtime-row">
              <span><ShieldCheck size={14} /> {copy.notes.authSurface}</span>
              <strong>{trustedProxy ? copy.trustedProxy : authMode ?? copy.tokenPassword}</strong>
            </div>
            <div className="overview-runtime-row">
              <span><Bot size={14} /> {copy.notes.methodsEvents}</span>
              <strong>{authMethods} / {authEvents}</strong>
            </div>
          </div>

          <div className="overview-session-list">
            {(overviewQuery.data?.sessions.slice(0, 4) ?? []).map((session) => (
              <button
                key={session.key}
                type="button"
                className="overview-session-row"
                title={copy.sessionList.title(session.title, session.messageCount.toLocaleString(locale))}
                onClick={() => {
                  selectSession(session.key);
                  navigate("/chat");
                }}
              >
                <div>
                  <div className="overview-session-row__title">{renderSessionTitle(session)}</div>
                  <div className="overview-muted">{copy.sessionList.meta(session.agentId ?? copy.noAgent, session.messageCount.toLocaleString(locale))}</div>
                </div>
                <div className="overview-session-row__time">{formatRelativeTimestamp(session.updatedAt, locale, copy)}</div>
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
