import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChatStore } from "@/features/chat/store";
import { useConnectionStore } from "@/features/connection/store";
import { gateway } from "@/lib/gateway";
import type { GatewayConfig } from "@/lib/gateway/types";
import "./overview.css";

type OverviewData = {
  loadedAt: number;
  issues: string[];
  status: Record<string, unknown> | null;
  presenceCount: number | null;
  sessionsCount: number | null;
  cronEnabled: boolean | null;
  cronJobs: number | null;
  cronNextWakeAtMs: number | null;
  lastChannelsRefresh: number | null;
};

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
  { value: "zh-CN", label: "简体中文 (Simplified Chinese)" },
  { value: "zh-TW", label: "繁體中文 (Traditional Chinese)" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "pt-BR", label: "Português (Brasil)" },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  return typeof record?.[key] === "boolean" ? (record[key] as boolean) : null;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  return typeof record?.[key] === "number" ? (record[key] as number) : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  return typeof record?.[key] === "string" ? (record[key] as string) : null;
}

function formatCount(value: number | null | undefined): string {
  return value == null ? "n/a" : value.toLocaleString();
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

function formatNextRun(timestamp: number | null | undefined): string {
  if (!timestamp) {
    return "n/a";
  }
  return formatRelativeTimestamp(timestamp);
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

async function loadOverview(): Promise<OverviewData> {
  const issues: string[] = [];

  async function safeRequest<T>(method: string, params: Record<string, unknown> = {}) {
    try {
      return await gateway.request<T>(method, params);
    } catch (error) {
      issues.push(`${method}: ${String(error)}`);
      return null;
    }
  }

  const loadedAt = Date.now();
  const [statusRaw, presenceRaw, sessionsRaw, channelsRaw, cronRaw] = await Promise.all([
    safeRequest<unknown>("status"),
    safeRequest<unknown>("system-presence"),
    safeRequest<unknown>("sessions.list", { limit: 1 }),
    safeRequest<unknown>("channels.status", { probe: false, timeoutMs: 5_000 }),
    safeRequest<unknown>("cron.status"),
  ]);

  const sessionsPayload = asRecord(sessionsRaw);
  const cron = asRecord(cronRaw);

  return {
    loadedAt,
    issues,
    status: asRecord(statusRaw),
    presenceCount: Array.isArray(presenceRaw) ? presenceRaw.length : null,
    sessionsCount: readNumber(sessionsPayload, "count"),
    cronEnabled: readBoolean(cron, "enabled"),
    cronJobs: readNumber(cron, "jobs"),
    cronNextWakeAtMs: readNumber(cron, "nextWakeAtMs"),
    lastChannelsRefresh: channelsRaw ? loadedAt : null,
  };
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

export function OverviewPage() {
  const connectionState = useConnectionStore((store) => store.state);
  const connectionError = useConnectionStore((store) => store.error);
  const configs = useConnectionStore((store) => store.configs);
  const activeConfigId = useConnectionStore((store) => store.activeConfigId);
  const addConfig = useConnectionStore((store) => store.addConfig);
  const updateConfig = useConnectionStore((store) => store.updateConfig);
  const setActiveConfig = useConnectionStore((store) => store.setActiveConfig);
  const connect = useConnectionStore((store) => store.connect);
  const selectedSessionId = useChatStore((store) => store.selectedSessionId);
  const selectSession = useChatStore((store) => store.selectSession);

  const [gatewayUrlDraft, setGatewayUrlDraft] = useState(DEFAULT_GATEWAY_URL);
  const [tokenDraft, setTokenDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [sessionKeyDraft, setSessionKeyDraft] = useState("main");
  const [languageDraft, setLanguageDraft] = useState(getInitialLanguage);
  const [isConnecting, setIsConnecting] = useState(false);

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
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, languageDraft);
    } catch {
      // Ignore local storage failures.
    }
  }, [languageDraft]);

  const overviewQuery = useQuery<OverviewData>({
    queryKey: OVERVIEW_QUERY_KEY,
    enabled: isConnected,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: loadOverview,
  });

  const snapshot = gateway.authResult?.snapshot as
    | {
        uptimeMs?: number;
        policy?: { tickIntervalMs?: number };
        authMode?: "none" | "token" | "password" | "trusted-proxy";
      }
    | undefined;
  const statusPolicy = asRecord(asRecord(overviewQuery.data?.status)?.policy);
  const authMode = snapshot?.authMode ?? readString(overviewQuery.data?.status ?? null, "authMode");
  const trustedProxy = isTrustedProxy(authMode);
  const uptime = formatDurationHuman(snapshot?.uptimeMs ?? readNumber(overviewQuery.data?.status ?? null, "uptimeMs"));
  const tickIntervalMs = snapshot?.policy?.tickIntervalMs ?? readNumber(statusPolicy, "tickIntervalMs");
  const tickInterval = tickIntervalMs != null ? `${tickIntervalMs}ms` : "n/a";
  const lastError = connectionError?.message ?? null;
  const lastErrorCode = connectionError?.code ?? null;
  const authRequired = lastErrorCode ? AUTH_REQUIRED_CODES.has(lastErrorCode) : false;

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
      // Connection errors are surfaced through the store and snapshot callout.
    } finally {
      setIsConnecting(false);
    }
  }

  const snapshotCallout = (() => {
    if (lastError) {
      return (
        <div className="overview-callout overview-callout--danger">
          <div>{lastError}</div>

          {shouldShowPairingHint(isConnected, lastError, lastErrorCode) && (
            <div className="overview-callout__stack">
              <div>This device needs pairing approval from the gateway host.</div>
              <div className="overview-callout__code">
                <span>openclaw devices list</span>
                <span>openclaw devices approve &lt;requestId&gt;</span>
              </div>
              <div className="overview-callout__small">
                On mobile? Copy the full URL (including <code>#token=...</code>) from <code>openclaw dashboard --no-open</code> on your desktop.
              </div>
              <a
                className="overview-link"
                href="https://docs.openclaw.ai/web/control-ui#device-pairing-first-connection"
                target="_blank"
                rel="noreferrer"
              >
                Docs: Device pairing
              </a>
            </div>
          )}

          {shouldShowAuthHint(isConnected, lastError, lastErrorCode) && (
            <div className="overview-callout__stack">
              <div>
                {authRequired
                  ? "This gateway requires auth. Add a token or password, then click Connect."
                  : "Auth failed. Re-copy a tokenized URL with openclaw dashboard --no-open, or update the token, then click Connect."}
              </div>
              <div className="overview-callout__code">
                <span>openclaw dashboard --no-open</span>
                <span>openclaw doctor --generate-gateway-token</span>
              </div>
              <a
                className="overview-link"
                href="https://docs.openclaw.ai/web/dashboard"
                target="_blank"
                rel="noreferrer"
              >
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
                <a
                  className="overview-link"
                  href="https://docs.openclaw.ai/gateway/tailscale"
                  target="_blank"
                  rel="noreferrer"
                >
                  Docs: Tailscale Serve
                </a>
                <span className="overview-muted">·</span>
                <a
                  className="overview-link"
                  href="https://docs.openclaw.ai/web/control-ui#insecure-http"
                  target="_blank"
                  rel="noreferrer"
                >
                  Docs: Insecure HTTP
                </a>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (overviewQuery.error) {
      return <div className="overview-callout overview-callout--danger">{String(overviewQuery.error)}</div>;
    }

    if (overviewQuery.data?.issues.length) {
      return (
        <div className="overview-callout">
          Some overview RPCs failed to refresh, so a few values may still be stale.
        </div>
      );
    }

    return (
      <div className="overview-callout">
        Use Channels to link WhatsApp, Telegram, Discord, Signal, or iMessage.
      </div>
    );
  })();

  return (
    <div className="overview-page">
      <section className="overview-grid overview-grid--top">
        <div className="overview-card overview-card--access">
          <div className="overview-card__title">Gateway Access</div>
          <div className="overview-card__subtitle">Where the dashboard connects and how it authenticates.</div>

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
              {isConnecting ? "Connecting…" : "Connect"}
            </button>
            <button
              type="button"
              className="overview-btn"
              onClick={() => {
                void overviewQuery.refetch();
              }}
              disabled={!isConnected || overviewQuery.isFetching}
            >
              {overviewQuery.isFetching ? "Refreshing…" : "Refresh"}
            </button>
            <span className="overview-muted overview-actions-row__hint">
              {trustedProxy ? "Authenticated via trusted proxy." : "Click Connect to apply connection changes."}
            </span>
          </div>
        </div>

        <div className="overview-card overview-card--snapshot">
          <div className="overview-card__title">Snapshot</div>
          <div className="overview-card__subtitle">Latest gateway handshake information.</div>

          <div className="overview-stat-grid">
            <div className="overview-stat">
              <div className="overview-stat__label">Status</div>
              <div className={`overview-stat__value ${isConnected ? "is-ok" : "is-warn"}`}>
                {isConnected ? "OK" : "Offline"}
              </div>
            </div>
            <div className="overview-stat">
              <div className="overview-stat__label">Uptime</div>
              <div className="overview-stat__value">{uptime}</div>
            </div>
            <div className="overview-stat">
              <div className="overview-stat__label">Tick Interval</div>
              <div className="overview-stat__value">{tickInterval}</div>
            </div>
            <div className="overview-stat">
              <div className="overview-stat__label">Last Channels Refresh</div>
              <div className="overview-stat__value">{formatRelativeTimestamp(overviewQuery.data?.lastChannelsRefresh)}</div>
            </div>
          </div>

          {snapshotCallout}
        </div>
      </section>

      <section className="overview-grid overview-grid--stats">
        <div className="overview-card overview-card--stat">
          <div className="overview-stat__label">Instances</div>
          <div className="overview-stat__value">{formatCount(overviewQuery.data?.presenceCount ?? (isConnected ? null : 0))}</div>
          <div className="overview-muted">Presence beacons in the last 5 minutes.</div>
        </div>

        <div className="overview-card overview-card--stat">
          <div className="overview-stat__label">Sessions</div>
          <div className="overview-stat__value">{formatCount(overviewQuery.data?.sessionsCount)}</div>
          <div className="overview-muted">Recent session keys tracked by the gateway.</div>
        </div>

        <div className="overview-card overview-card--stat">
          <div className="overview-stat__label">Cron</div>
          <div className="overview-stat__value">
            {overviewQuery.data?.cronEnabled == null ? "n/a" : overviewQuery.data.cronEnabled ? "Enabled" : "Disabled"}
          </div>
          <div className="overview-muted">
            Next wake {formatNextRun(overviewQuery.data?.cronNextWakeAtMs)}
            {overviewQuery.data?.cronJobs != null ? (
              <span className="overview-stat__meta"> · {overviewQuery.data.cronJobs.toLocaleString()} jobs</span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="overview-card overview-card--notes">
        <div className="overview-card__title">Notes</div>
        <div className="overview-card__subtitle">Quick reminders for remote control setups.</div>

        <div className="overview-note-grid">
          <div className="overview-note">
            <div className="overview-note__title">Tailscale serve</div>
            <div className="overview-muted">
              Prefer serve mode to keep the gateway on loopback with tailnet auth.
            </div>
          </div>
          <div className="overview-note">
            <div className="overview-note__title">Session hygiene</div>
            <div className="overview-muted">Use /new or sessions.patch to reset context.</div>
          </div>
          <div className="overview-note">
            <div className="overview-note__title">Cron reminders</div>
            <div className="overview-muted">Use isolated sessions for recurring runs.</div>
          </div>
        </div>
      </section>
    </div>
  );
}
