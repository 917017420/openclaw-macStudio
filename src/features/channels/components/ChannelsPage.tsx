import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Link2,
  LoaderCircle,
  LogOut,
  Play,
  QrCode,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";
import { Button, Card, StatusBadge } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";
import { gateway } from "@/lib/gateway";
import { formatRelativeTime, truncate } from "@/lib/utils";
import "./channels.css";

type JsonRecord = Record<string, unknown>;

type ProbeSummary = {
  ok?: boolean | null;
  status?: number | null;
  error?: string | null;
};

type ConfigSnapshotIssue = {
  path: string;
  message: string;
};

type ConfigSnapshot = {
  path?: string | null;
  exists?: boolean | null;
  raw?: string | null;
  hash?: string | null;
  valid?: boolean | null;
  config?: JsonRecord | null;
  issues?: ConfigSnapshotIssue[] | null;
};

type ChannelUiMetaEntry = {
  id: string;
  label: string;
  detailLabel?: string;
  systemImage?: string;
};

type ChannelAccountSnapshot = {
  accountId: string;
  name?: string | null;
  enabled?: boolean | null;
  configured?: boolean | null;
  linked?: boolean | null;
  running?: boolean | null;
  connected?: boolean | null;
  reconnectAttempts?: number | null;
  lastConnectedAt?: number | null;
  lastError?: string | null;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  lastProbeAt?: number | null;
  mode?: string | null;
  dmPolicy?: string | null;
  allowFrom?: string[] | null;
  tokenSource?: string | null;
  botTokenSource?: string | null;
  appTokenSource?: string | null;
  credentialSource?: string | null;
  audienceType?: string | null;
  audience?: string | null;
  webhookPath?: string | null;
  webhookUrl?: string | null;
  baseUrl?: string | null;
  allowUnmentionedGroups?: boolean | null;
  cliPath?: string | null;
  dbPath?: string | null;
  port?: number | null;
  publicKey?: string | null;
  profile?: JsonRecord | null;
  probe?: unknown;
};

type ChannelsStatusSnapshot = {
  ts: number;
  channelOrder: string[];
  channelLabels: Record<string, string>;
  channelDetailLabels: Record<string, string>;
  channelSystemImages: Record<string, string>;
  channelMeta: ChannelUiMetaEntry[];
  channels: Record<string, JsonRecord>;
  channelAccounts: Record<string, ChannelAccountSnapshot[]>;
  channelDefaultAccountId: Record<string, string>;
};

type ChannelDefinition = {
  id: string;
  label: string;
  detail: string;
  status: JsonRecord | undefined;
  accounts: ChannelAccountSnapshot[];
  defaultAccountId?: string;
  enabled: boolean;
};

type StatusItem = {
  label: string;
  value: string;
};

type FeedbackMessage = {
  kind: "error" | "info";
  message: string;
};

const CHANNELS_QUERY_KEY = ["channels-status"] as const;
const CONFIG_QUERY_KEY = ["gateway-config", "channels"] as const;

const DEFAULT_CHANNEL_ORDER = ["whatsapp", "telegram", "discord", "googlechat", "slack", "signal", "imessage", "nostr"] as const;

const CHANNEL_FALLBACK_META: Record<string, { label: string; detail: string }> = {
  whatsapp: { label: "WhatsApp", detail: "Link WhatsApp Web and monitor connection health." },
  telegram: { label: "Telegram", detail: "Bot status and channel configuration." },
  discord: { label: "Discord", detail: "Bot status and channel configuration." },
  googlechat: { label: "Google Chat", detail: "Chat API webhook status and channel configuration." },
  slack: { label: "Slack", detail: "Socket mode status and channel configuration." },
  signal: { label: "Signal", detail: "signal-cli status and channel configuration." },
  imessage: { label: "iMessage", detail: "macOS bridge status and channel configuration." },
  nostr: { label: "Nostr", detail: "Decentralized DMs via Nostr relays." },
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function readString(record: JsonRecord | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function readNumber(record: JsonRecord | null | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(record: JsonRecord | null | undefined, key: string): boolean | null {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function readStringArray(record: JsonRecord | null | undefined, key: string): string[] | null {
  const value = record?.[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : null;
}

function normalizeAccount(raw: unknown): ChannelAccountSnapshot | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  return {
    accountId: readString(obj, "accountId") ?? readString(obj, "id") ?? "default",
    name: readString(obj, "name"),
    enabled: readBoolean(obj, "enabled"),
    configured: readBoolean(obj, "configured"),
    linked: readBoolean(obj, "linked"),
    running: readBoolean(obj, "running"),
    connected: readBoolean(obj, "connected"),
    reconnectAttempts: readNumber(obj, "reconnectAttempts"),
    lastConnectedAt: readNumber(obj, "lastConnectedAt"),
    lastError: readString(obj, "lastError"),
    lastStartAt: readNumber(obj, "lastStartAt"),
    lastStopAt: readNumber(obj, "lastStopAt"),
    lastInboundAt: readNumber(obj, "lastInboundAt"),
    lastOutboundAt: readNumber(obj, "lastOutboundAt"),
    lastProbeAt: readNumber(obj, "lastProbeAt"),
    mode: readString(obj, "mode"),
    dmPolicy: readString(obj, "dmPolicy"),
    allowFrom: readStringArray(obj, "allowFrom"),
    tokenSource: readString(obj, "tokenSource"),
    botTokenSource: readString(obj, "botTokenSource"),
    appTokenSource: readString(obj, "appTokenSource"),
    credentialSource: readString(obj, "credentialSource"),
    audienceType: readString(obj, "audienceType"),
    audience: readString(obj, "audience"),
    webhookPath: readString(obj, "webhookPath"),
    webhookUrl: readString(obj, "webhookUrl"),
    baseUrl: readString(obj, "baseUrl"),
    allowUnmentionedGroups: readBoolean(obj, "allowUnmentionedGroups"),
    cliPath: readString(obj, "cliPath"),
    dbPath: readString(obj, "dbPath"),
    port: readNumber(obj, "port"),
    publicKey: readString(obj, "publicKey"),
    profile: asRecord(obj.profile),
    probe: obj.probe,
  };
}

function normalizeChannelsSnapshot(raw: unknown): ChannelsStatusSnapshot {
  const obj = asRecord(raw);
  const channelsRecord = asRecord(obj?.channels) ?? {};
  const accountsRecord = asRecord(obj?.channelAccounts) ?? {};
  const meta = Array.isArray(obj?.channelMeta)
    ? obj?.channelMeta
        .map((entry) => {
          const record = asRecord(entry);
          const id = readString(record, "id");
          if (!id) return null;
          return {
            id,
            label: readString(record, "label") ?? id,
            detailLabel: readString(record, "detailLabel") ?? undefined,
            systemImage: readString(record, "systemImage") ?? undefined,
          } satisfies ChannelUiMetaEntry;
        })
        .filter(Boolean) as ChannelUiMetaEntry[]
    : [];

  return {
    ts: readNumber(obj, "ts") ?? Date.now(),
    channelOrder: Array.isArray(obj?.channelOrder)
      ? obj.channelOrder.filter((value): value is string => typeof value === "string")
      : Object.keys(channelsRecord),
    channelLabels:
      (asRecord(obj?.channelLabels) as Record<string, string> | null) ?? {},
    channelDetailLabels:
      (asRecord(obj?.channelDetailLabels) as Record<string, string> | null) ?? {},
    channelSystemImages:
      (asRecord(obj?.channelSystemImages) as Record<string, string> | null) ?? {},
    channelMeta: meta,
    channels: Object.fromEntries(
      Object.entries(channelsRecord).map(([key, value]) => [key, asRecord(value) ?? {}]),
    ),
    channelAccounts: Object.fromEntries(
      Object.entries(accountsRecord).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map((entry) => normalizeAccount(entry)).filter(Boolean) as ChannelAccountSnapshot[] : [],
      ]),
    ),
    channelDefaultAccountId:
      (asRecord(obj?.channelDefaultAccountId) as Record<string, string> | null) ?? {},
  };
}

function normalizeConfigSnapshot(raw: unknown): ConfigSnapshot {
  const obj = asRecord(raw);
  if (!obj) {
    return { raw: null, hash: null, valid: null, config: null, issues: [] };
  }
  return {
    path: readString(obj, "path"),
    exists: readBoolean(obj, "exists"),
    raw: readString(obj, "raw"),
    hash: readString(obj, "hash"),
    valid: readBoolean(obj, "valid"),
    config: asRecord(obj.config),
    issues: Array.isArray(obj.issues)
      ? obj.issues
          .map((issue) => {
            const record = asRecord(issue);
            if (!record) return null;
            return {
              path: readString(record, "path") ?? "(unknown)",
              message: readString(record, "message") ?? JSON.stringify(issue),
            } satisfies ConfigSnapshotIssue;
          })
          .filter(Boolean) as ConfigSnapshotIssue[]
      : [],
  };
}

function cloneJsonRecord(value: JsonRecord | null | undefined): JsonRecord {
  return value ? JSON.parse(JSON.stringify(value)) as JsonRecord : {};
}

function resolveChannelOrder(snapshot: ChannelsStatusSnapshot | undefined) {
  if (snapshot?.channelMeta.length) {
    return snapshot.channelMeta.map((entry) => entry.id);
  }
  if (snapshot?.channelOrder.length) {
    return snapshot.channelOrder;
  }
  return [...DEFAULT_CHANNEL_ORDER];
}

function resolveChannelMeta(snapshot: ChannelsStatusSnapshot | undefined, channelId: string) {
  const meta = snapshot?.channelMeta.find((entry) => entry.id === channelId);
  const fallback = CHANNEL_FALLBACK_META[channelId];
  return {
    label: meta?.label ?? snapshot?.channelLabels[channelId] ?? fallback?.label ?? channelId,
    detail:
      meta?.detailLabel ??
      snapshot?.channelDetailLabels[channelId] ??
      fallback?.detail ??
      "Channel status and configuration.",
  };
}

function channelEnabled(status: JsonRecord | undefined, accounts: ChannelAccountSnapshot[]) {
  if (readBoolean(status, "configured") || readBoolean(status, "running") || readBoolean(status, "connected")) {
    return true;
  }
  return accounts.some((account) => Boolean(account.configured || account.running || account.connected || account.linked));
}

function formatBoolean(value: boolean | null | undefined) {
  if (value == null) return "n/a";
  return value ? "Yes" : "No";
}

function formatMaybeNumber(value: number | null | undefined) {
  return value == null ? "n/a" : value.toLocaleString();
}

function formatTimestamp(value: number | null | undefined) {
  return value ? formatRelativeTime(value) : "n/a";
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

function truncateMiddle(value: string | null | undefined, edge = 8) {
  if (!value) return "n/a";
  if (value.length <= edge * 2 + 3) return value;
  return `${value.slice(0, edge)}...${value.slice(-edge)}`;
}

function summarizeProbe(probe: unknown): string | null {
  const record = asRecord(probe);
  if (!record) return null;
  const summary: string[] = [];
  const ok = readBoolean(record, "ok");
  if (ok != null) {
    summary.push(ok ? "Probe ok" : "Probe failed");
  }
  const status = readNumber(record, "status");
  if (status != null) {
    summary.push(`status ${status}`);
  }
  const error = readString(record, "error");
  if (error) {
    summary.push(error);
  }
  const elapsedMs = readNumber(record, "elapsedMs");
  if (elapsedMs != null) {
    summary.push(`${elapsedMs}ms`);
  }
  return summary.length > 0 ? summary.join(" · ") : null;
}

function statusTone(status: JsonRecord | undefined): "connected" | "disconnected" | "error" {
  if (!status) return "disconnected";
  if (readBoolean(status, "connected")) return "connected";
  if (readString(status, "lastError")) return "error";
  return "disconnected";
}

function statusLabel(status: JsonRecord | undefined): string {
  if (!status) return "Unavailable";
  if (readBoolean(status, "connected")) return "Connected";
  if (readBoolean(status, "running")) return "Running";
  if (readBoolean(status, "linked")) return "Linked";
  if (readBoolean(status, "configured")) return "Configured";
  if (readString(status, "lastError")) return "Error";
  return "Disconnected";
}

function buildChannelConfigEditors(config: JsonRecord | null | undefined, channelIds: string[]) {
  const channels = asRecord(config?.channels) ?? {};
  return Object.fromEntries(
    channelIds.map((channelId) => {
      const value = asRecord(channels[channelId]) ?? {};
      return [channelId, JSON.stringify(value, null, 2)];
    }),
  ) as Record<string, string>;
}

function withChannelConfig(config: JsonRecord | null | undefined, channelId: string, value: JsonRecord) {
  const next = cloneJsonRecord(config);
  const channels = asRecord(next.channels) ?? {};
  next.channels = {
    ...channels,
    [channelId]: value,
  };
  return next;
}

function buildStatusItems(items: Array<[string, string | null | undefined]>) {
  return items
    .filter(([, value]) => value != null && value !== "")
    .map(([label, value]) => ({ label, value: value ?? "n/a" })) satisfies StatusItem[];
}

function renderStatusList(items: StatusItem[]) {
  if (items.length === 0) return null;
  return (
    <div className="channels-status-list">
      {items.map((item) => (
        <div key={`${item.label}-${item.value}`} className="channels-status-list__row">
          <span className="channels-label">{item.label}</span>
          <span>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function renderProbeCallout(status: JsonRecord | undefined) {
  const message = summarizeProbe(status?.probe);
  if (!message) return null;
  return <div className="workspace-alert channels-page__alert">{message}</div>;
}

function renderAccountFlags(account: ChannelAccountSnapshot) {
  const flags = [
    account.enabled ? "enabled" : null,
    account.configured ? "configured" : null,
    account.linked ? "linked" : null,
    account.running ? "running" : null,
    account.connected ? "connected" : null,
  ].filter(Boolean);
  return flags.length > 0 ? flags.join(" · ") : "no flags reported";
}

function renderAccountCards(accounts: ChannelAccountSnapshot[], channelId: string) {
  if (accounts.length === 0) return null;
  return (
    <div className="channels-account-card-list">
      {accounts.map((account, index) => {
        const probeRecord = asRecord(account.probe);
        const profileRecord = asRecord(account.profile);
        const title =
          channelId === "telegram"
            ? (() => {
                const bot = asRecord(probeRecord?.bot);
                const username = readString(bot, "username");
                return username ? `@${username}` : account.name ?? account.accountId ?? `Account ${index + 1}`;
              })()
            : channelId === "nostr"
              ? readString(profileRecord, "displayName") ??
                readString(profileRecord, "name") ??
                account.name ??
                account.accountId ??
                `Account ${index + 1}`
              : account.name ?? account.accountId ?? `Account ${index + 1}`;

        const details = buildStatusItems([
          ["Configured", formatBoolean(account.configured)],
          ["Running", formatBoolean(account.running)],
          ["Connected", formatBoolean(account.connected)],
          ["Last inbound", formatTimestamp(account.lastInboundAt)],
          ["Last probe", formatTimestamp(account.lastProbeAt)],
          channelId === "nostr" ? ["Public Key", truncateMiddle(account.publicKey)] : ["Flags", renderAccountFlags(account)],
        ]);

        return (
          <div key={`${channelId}-${account.accountId}-${index}`} className="channels-account-card">
            <div className="channels-account-card__header">
              <div>
                <div className="channels-account-card__title">{title}</div>
                <div className="channels-account-card__id mono">{account.accountId}</div>
              </div>
            </div>
            {renderStatusList(details)}
            {account.lastError && <div className="channels-account-card__error">{account.lastError}</div>}
          </div>
        );
      })}
    </div>
  );
}

function renderChannelSpecificSummary(channel: ChannelDefinition) {
  const status = channel.status;
  const primaryAccount = channel.accounts[0];
  const self = asRecord(status?.self);
  const profile = asRecord(primaryAccount?.profile) ?? asRecord(status?.profile);

  switch (channel.id) {
    case "whatsapp":
      return renderStatusList(
        buildStatusItems([
          ["Configured", formatBoolean(readBoolean(status, "configured"))],
          ["Linked", formatBoolean(readBoolean(status, "linked"))],
          ["Running", formatBoolean(readBoolean(status, "running"))],
          ["Connected", formatBoolean(readBoolean(status, "connected"))],
          ["Identity", readString(self, "jid") ?? readString(self, "e164")],
          ["Last connect", formatTimestamp(readNumber(status, "lastConnectedAt"))],
          ["Last message", formatTimestamp(readNumber(status, "lastMessageAt"))],
          ["Auth age", formatDurationHuman(readNumber(status, "authAgeMs"))],
          ["Reconnects", formatMaybeNumber(readNumber(status, "reconnectAttempts"))],
        ]),
      );
    case "telegram":
      if (channel.accounts.length > 1) return renderAccountCards(channel.accounts, channel.id);
      return renderStatusList(
        buildStatusItems([
          ["Configured", formatBoolean(readBoolean(status, "configured"))],
          ["Running", formatBoolean(readBoolean(status, "running"))],
          ["Mode", readString(status, "mode")],
          ["Token source", readString(status, "tokenSource")],
          ["Last start", formatTimestamp(readNumber(status, "lastStartAt"))],
          ["Last probe", formatTimestamp(readNumber(status, "lastProbeAt"))],
        ]),
      );
    case "discord":
      return renderStatusList(
        buildStatusItems([
          ["Configured", formatBoolean(readBoolean(status, "configured"))],
          ["Running", formatBoolean(readBoolean(status, "running"))],
          ["Token source", readString(status, "tokenSource")],
          ["Last start", formatTimestamp(readNumber(status, "lastStartAt"))],
          ["Last probe", formatTimestamp(readNumber(status, "lastProbeAt"))],
        ]),
      );
    case "googlechat":
      return renderStatusList(
        buildStatusItems([
          ["Configured", formatBoolean(readBoolean(status, "configured"))],
          ["Running", formatBoolean(readBoolean(status, "running"))],
          ["Credential", readString(status, "credentialSource")],
          [
            "Audience",
            [readString(status, "audienceType"), readString(status, "audience")].filter(Boolean).join(" · "),
          ],
          ["Webhook", readString(status, "webhookUrl") ?? readString(status, "webhookPath")],
          ["Last start", formatTimestamp(readNumber(status, "lastStartAt"))],
          ["Last probe", formatTimestamp(readNumber(status, "lastProbeAt"))],
        ]),
      );
    case "slack":
      return renderStatusList(
        buildStatusItems([
          ["Configured", formatBoolean(readBoolean(status, "configured"))],
          ["Running", formatBoolean(readBoolean(status, "running"))],
          ["Bot token", readString(status, "botTokenSource")],
          ["App token", readString(status, "appTokenSource")],
          ["Last start", formatTimestamp(readNumber(status, "lastStartAt"))],
          ["Last probe", formatTimestamp(readNumber(status, "lastProbeAt"))],
        ]),
      );
    case "signal":
      return renderStatusList(
        buildStatusItems([
          ["Configured", formatBoolean(readBoolean(status, "configured"))],
          ["Running", formatBoolean(readBoolean(status, "running"))],
          ["Base URL", readString(status, "baseUrl")],
          ["Last start", formatTimestamp(readNumber(status, "lastStartAt"))],
          ["Last probe", formatTimestamp(readNumber(status, "lastProbeAt"))],
        ]),
      );
    case "imessage":
      return renderStatusList(
        buildStatusItems([
          ["Configured", formatBoolean(readBoolean(status, "configured"))],
          ["Running", formatBoolean(readBoolean(status, "running"))],
          ["CLI path", readString(status, "cliPath")],
          ["DB path", readString(status, "dbPath")],
          ["Last start", formatTimestamp(readNumber(status, "lastStartAt"))],
          ["Last probe", formatTimestamp(readNumber(status, "lastProbeAt"))],
        ]),
      );
    case "nostr":
      if (channel.accounts.length > 1) return renderAccountCards(channel.accounts, channel.id);
      return (
        <>
          {renderStatusList(
            buildStatusItems([
              ["Configured", formatBoolean(readBoolean(status, "configured") ?? primaryAccount?.configured ?? null)],
              ["Running", formatBoolean(readBoolean(status, "running") ?? primaryAccount?.running ?? null)],
              ["Public Key", truncateMiddle(readString(status, "publicKey") ?? primaryAccount?.publicKey)],
              ["Last start", formatTimestamp(readNumber(status, "lastStartAt") ?? primaryAccount?.lastStartAt ?? null)],
            ]),
          )}
          {profile && (
            <div className="channels-profile-card">
              <div className="channels-profile-card__title">Profile</div>
              {renderStatusList(
                buildStatusItems([
                  ["Name", readString(profile, "name")],
                  ["Display", readString(profile, "displayName")],
                  ["NIP-05", readString(profile, "nip05")],
                  ["Website", readString(profile, "website")],
                ]),
              ) ?? <div className="workspace-subcopy">No profile published.</div>}
              {readString(profile, "about") && (
                <p className="channels-profile-card__about">{truncate(readString(profile, "about") ?? "", 220)}</p>
              )}
            </div>
          )}
        </>
      );
    default:
      return channel.accounts.length > 0
        ? renderAccountCards(channel.accounts, channel.id)
        : renderStatusList(
            buildStatusItems([
              ["Configured", formatBoolean(readBoolean(status, "configured"))],
              ["Linked", formatBoolean(readBoolean(status, "linked"))],
              ["Running", formatBoolean(readBoolean(status, "running"))],
              ["Connected", formatBoolean(readBoolean(status, "connected"))],
              ["Accounts", formatMaybeNumber(channel.accounts.length)],
            ]),
          );
  }
}

export function ChannelsPage() {
  const isConnected = useConnectionStore((state) => state.state === "connected");
  const [probe, setProbe] = useState(true);
  const [whatsAppBusy, setWhatsAppBusy] = useState(false);
  const [whatsAppMessage, setWhatsAppMessage] = useState<string | null>(null);
  const [whatsAppQrDataUrl, setWhatsAppQrDataUrl] = useState<string | null>(null);
  const [whatsAppLinked, setWhatsAppLinked] = useState<boolean | null>(null);
  const [configDraft, setConfigDraft] = useState<JsonRecord | null>(null);
  const [configEditors, setConfigEditors] = useState<Record<string, string>>({});
  const [configErrors, setConfigErrors] = useState<Record<string, string | null>>({});
  const [configBusyChannel, setConfigBusyChannel] = useState<string | null>(null);
  const [configFeedback, setConfigFeedback] = useState<FeedbackMessage | null>(null);
  const configHashRef = useRef<string | null>(null);

  const channelsQuery = useQuery<ChannelsStatusSnapshot>({
    queryKey: [...CHANNELS_QUERY_KEY, probe],
    enabled: isConnected,
    staleTime: 15_000,
    queryFn: async () => normalizeChannelsSnapshot(await gateway.request<unknown>("channels.status", { probe, timeoutMs: 8_000 })),
  });

  const configQuery = useQuery<ConfigSnapshot>({
    queryKey: CONFIG_QUERY_KEY,
    enabled: isConnected,
    staleTime: 15_000,
    queryFn: async () => normalizeConfigSnapshot(await gateway.request<unknown>("config.get")),
  });

  const channels = useMemo<ChannelDefinition[]>(() => {
    const snapshot = channelsQuery.data;
    const order = resolveChannelOrder(snapshot);
    return order
      .map((channelId, index) => {
        const status = snapshot?.channels[channelId];
        const accounts = snapshot?.channelAccounts[channelId] ?? [];
        const meta = resolveChannelMeta(snapshot, channelId);
        return {
          id: channelId,
          label: meta.label,
          detail: meta.detail,
          status,
          accounts,
          defaultAccountId: snapshot?.channelDefaultAccountId[channelId],
          enabled: channelEnabled(status, accounts),
          order: index,
        };
      })
      .toSorted((a, b) => {
        if (a.enabled !== b.enabled) {
          return a.enabled ? -1 : 1;
        }
        return a.order - b.order;
      })
      .map(({ order: _order, ...channel }) => channel);
  }, [channelsQuery.data]);

  const channelIdsKey = channels.map((channel) => channel.id).join("|");

  useEffect(() => {
    const nextConfig = cloneJsonRecord(configQuery.data?.config);
    const builtEditors = buildChannelConfigEditors(nextConfig, channels.map((channel) => channel.id));
    const hashChanged = configHashRef.current !== (configQuery.data?.hash ?? null);

    setConfigDraft(nextConfig);
    setConfigEditors((current) => {
      if (hashChanged) {
        return builtEditors;
      }
      const merged = { ...current };
      for (const [channelId, value] of Object.entries(builtEditors)) {
        if (!(channelId in merged)) {
          merged[channelId] = value;
        }
      }
      return merged;
    });
    if (hashChanged) {
      setConfigErrors({});
      configHashRef.current = configQuery.data?.hash ?? null;
    }
  }, [configQuery.data?.hash, channelIdsKey]);

  function requestRefresh(nextProbe = probe) {
    setConfigFeedback(null);
    if (nextProbe !== probe) {
      setProbe(nextProbe);
      return;
    }
    void channelsQuery.refetch();
  }

  async function startWhatsAppLogin(force: boolean) {
    setWhatsAppBusy(true);
    setConfigFeedback(null);
    try {
      const res = await gateway.request<{ message?: string; qrDataUrl?: string }>("web.login.start", {
        force,
        timeoutMs: 30_000,
      });
      setWhatsAppMessage(res.message ?? "Login started.");
      setWhatsAppQrDataUrl(res.qrDataUrl ?? null);
      setWhatsAppLinked(null);
      await channelsQuery.refetch();
    } catch (error) {
      setWhatsAppMessage(String(error));
    } finally {
      setWhatsAppBusy(false);
    }
  }

  async function waitWhatsAppLogin() {
    setWhatsAppBusy(true);
    setConfigFeedback(null);
    try {
      const res = await gateway.request<{ message?: string; connected?: boolean }>("web.login.wait", {
        timeoutMs: 120_000,
      });
      setWhatsAppMessage(res.message ?? "Login state updated.");
      setWhatsAppLinked(res.connected ?? null);
      if (res.connected) {
        setWhatsAppQrDataUrl(null);
      }
      await channelsQuery.refetch();
    } catch (error) {
      setWhatsAppMessage(String(error));
      setWhatsAppLinked(null);
    } finally {
      setWhatsAppBusy(false);
    }
  }

  async function logoutWhatsApp() {
    setWhatsAppBusy(true);
    setConfigFeedback(null);
    try {
      await gateway.request("channels.logout", { channel: "whatsapp" });
      setWhatsAppMessage("Logged out from WhatsApp.");
      setWhatsAppQrDataUrl(null);
      setWhatsAppLinked(false);
      await channelsQuery.refetch();
    } catch (error) {
      setWhatsAppMessage(String(error));
    } finally {
      setWhatsAppBusy(false);
    }
  }

  async function saveChannelConfig(channelId: string) {
    const snapshot = configQuery.data;
    const editorValue = configEditors[channelId] ?? "{}";
    if (!snapshot?.hash) {
      setConfigFeedback({ kind: "error", message: "Config hash missing. Reload config and retry." });
      return;
    }

    let parsedValue: JsonRecord;
    try {
      const parsed = editorValue.trim() ? JSON.parse(editorValue) : {};
      const record = asRecord(parsed);
      if (!record) {
        throw new Error("Channel config must be a JSON object.");
      }
      parsedValue = record;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConfigErrors((current) => ({ ...current, [channelId]: message }));
      return;
    }

    setConfigBusyChannel(channelId);
    setConfigErrors((current) => ({ ...current, [channelId]: null }));
    setConfigFeedback(null);

    try {
      const nextConfig = withChannelConfig(configDraft ?? snapshot.config ?? {}, channelId, parsedValue);
      await gateway.request("config.set", {
        raw: JSON.stringify(nextConfig, null, 2),
        baseHash: snapshot.hash,
      });
      setConfigDraft(nextConfig);
      setConfigFeedback({ kind: "info", message: `${channelId} config saved.` });
      await Promise.all([configQuery.refetch(), channelsQuery.refetch()]);
    } catch (error) {
      setConfigFeedback({ kind: "error", message: String(error) });
    } finally {
      setConfigBusyChannel(null);
    }
  }

  async function reloadChannelConfig(channelId: string) {
    setConfigBusyChannel(channelId);
    setConfigFeedback(null);
    try {
      const result = await configQuery.refetch();
      const nextConfig = cloneJsonRecord(result.data?.config);
      setConfigDraft(nextConfig);
      setConfigEditors((current) => ({
        ...current,
        [channelId]: buildChannelConfigEditors(nextConfig, [channelId])[channelId] ?? "{}",
      }));
      setConfigErrors((current) => ({ ...current, [channelId]: null }));
      setConfigFeedback({ kind: "info", message: `${channelId} config reloaded.` });
    } catch (error) {
      setConfigFeedback({ kind: "error", message: String(error) });
    } finally {
      setConfigBusyChannel(null);
    }
  }

  if (!isConnected) {
    return (
      <div className="workspace-empty-state channels-page channels-page--empty">
        <Radio size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">Channels</h2>
        <p className="workspace-subtitle">Connect a gateway to inspect channel health, login state, and config snippets.</p>
      </div>
    );
  }

  return (
    <div className="workspace-page channels-page">
      <div className="workspace-toolbar channels-toolbar">
        <div>
          <h2 className="workspace-title">Channels</h2>
          <p className="workspace-subtitle">
            Official-style channel workspace with per-surface status, account detail, WhatsApp login, and scoped config editing.
          </p>
        </div>
        <div className="workspace-toolbar__actions">
          <Button variant="ghost" onClick={() => requestRefresh(!probe)}>
            {probe ? "Deep Probe On" : "Fast Status"}
          </Button>
          <Button variant="secondary" onClick={() => requestRefresh(probe)} loading={channelsQuery.isFetching}>
            <RefreshCw size={14} />
            Refresh
          </Button>
          <Button variant="secondary" onClick={() => configQuery.refetch()} loading={configQuery.isFetching}>
            <RotateCcw size={14} />
            Reload Config
          </Button>
        </div>
      </div>

      {channelsQuery.error && <div className="workspace-alert workspace-alert--error">{String(channelsQuery.error)}</div>}
      {configQuery.error && <div className="workspace-alert workspace-alert--error">{String(configQuery.error)}</div>}
      {configFeedback && (
        <div className={`workspace-alert ${configFeedback.kind === "error" ? "workspace-alert--error" : "workspace-alert--info"}`}>
          {configFeedback.message}
        </div>
      )}

      {channelsQuery.isLoading ? (
        <div className="workspace-inline-status"><LoaderCircle size={16} className="spin" /> Loading channels…</div>
      ) : (
        <div className="channels-grid">
          {channels.map((channel) => {
            const lastError = readString(channel.status, "lastError");
            const accountCount = channel.accounts.length;
            const isSavingConfig = configBusyChannel === channel.id;

            return (
              <Card key={channel.id} className={`workspace-section channels-card ${channel.enabled ? "is-enabled" : "is-muted"}`}>
                <div className="channels-card__header">
                  <div>
                    <div className="channels-card__eyebrow">{channel.id}</div>
                    <h3>{channel.label}</h3>
                    <p>{channel.detail}</p>
                  </div>
                  <StatusBadge status={statusTone(channel.status)} label={statusLabel(channel.status)} />
                </div>

                <div className="channels-card__meta">
                  <span>{accountCount} account{accountCount === 1 ? "" : "s"}</span>
                  {channel.defaultAccountId && <span>default {channel.defaultAccountId}</span>}
                  <span>{channel.enabled ? "active" : "idle"}</span>
                </div>

                {renderChannelSpecificSummary(channel)}

                {lastError && <div className="workspace-alert workspace-alert--error channels-page__alert">{lastError}</div>}
                {renderProbeCallout(channel.status)}

                {channel.id === "whatsapp" && (
                  <>
                    {whatsAppMessage && <div className="workspace-alert workspace-alert--info channels-page__alert">{whatsAppMessage}</div>}
                    {whatsAppLinked !== null && (
                      <div className="channels-whatsapp-state">
                        <StatusBadge status={whatsAppLinked ? "connected" : "disconnected"} label={whatsAppLinked ? "Linked" : "Not linked"} />
                      </div>
                    )}
                    {whatsAppQrDataUrl && (
                      <div className="channels-qr-wrap">
                        <img src={whatsAppQrDataUrl} alt="WhatsApp QR code" />
                      </div>
                    )}
                    <div className="channels-actions">
                      <Button size="sm" onClick={() => startWhatsAppLogin(false)} loading={whatsAppBusy}>
                        <Play size={14} />
                        Show QR
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => startWhatsAppLogin(true)} loading={whatsAppBusy}>
                        <RefreshCw size={14} />
                        Relink
                      </Button>
                      <Button size="sm" variant="ghost" onClick={waitWhatsAppLogin} loading={whatsAppBusy}>
                        <Link2 size={14} />
                        Wait
                      </Button>
                      <Button size="sm" variant="danger" onClick={logoutWhatsApp} loading={whatsAppBusy}>
                        <LogOut size={14} />
                        Logout
                      </Button>
                    </div>
                  </>
                )}

                {channel.id !== "whatsapp" && (
                  <div className="channels-actions">
                    <Button size="sm" variant="secondary" onClick={() => requestRefresh(true)} loading={channelsQuery.isFetching && probe}>
                      <RefreshCw size={14} />
                      Probe
                    </Button>
                  </div>
                )}

                <div className="channels-config">
                  <div className="channels-config__header">
                    <div>
                      <h4>Config</h4>
                      <p>{configQuery.data?.path ?? "Gateway config"} · channels.{channel.id}</p>
                    </div>
                    <div className="channels-config__status">
                      <StatusBadge
                        status={configQuery.data?.valid === false ? "error" : "connected"}
                        label={configQuery.data?.valid === false ? "Invalid" : "Ready"}
                      />
                    </div>
                  </div>

                  <textarea
                    className="channels-config__editor mono"
                    value={configEditors[channel.id] ?? "{}"}
                    onChange={(event) => {
                      const value = event.target.value;
                      setConfigEditors((current) => ({ ...current, [channel.id]: value }));
                      setConfigErrors((current) => ({ ...current, [channel.id]: null }));
                    }}
                    spellCheck={false}
                    placeholder={`{ "enabled": true }`}
                  />

                  {configErrors[channel.id] && (
                    <div className="workspace-alert workspace-alert--error channels-page__alert">{configErrors[channel.id]}</div>
                  )}

                  <div className="channels-actions">
                    <Button size="sm" onClick={() => saveChannelConfig(channel.id)} loading={isSavingConfig}>
                      <Save size={14} />
                      Save
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => reloadChannelConfig(channel.id)} loading={isSavingConfig}>
                      <RotateCcw size={14} />
                      Reload
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="workspace-section channels-snapshot">
        <div className="workspace-section__header">
          <div>
            <h3>Channel Health</h3>
            <p>Raw `channels.status` snapshot from the gateway for parity checks and diagnostics.</p>
          </div>
          <div className="channels-snapshot__meta">
            <StatusBadge status={probe ? "connected" : "idle"} label={probe ? "Deep probe" : "Fast mode"} />
            <span className="workspace-meta">{channelsQuery.data ? `Updated ${formatRelativeTime(channelsQuery.data.ts)}` : "Waiting for data"}</span>
          </div>
        </div>

        <pre className="channels-snapshot__code">{JSON.stringify(channelsQuery.data ?? null, null, 2)}</pre>

        {configQuery.data?.issues && configQuery.data.issues.length > 0 && (
          <div className="channels-issues">
            {configQuery.data.issues.map((issue, index) => (
              <div key={`${issue.path}-${index}`} className="channels-issues__row">
                <strong>{issue.path}</strong>
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
