import { formatRelativeTime, truncate } from "@/lib/utils";
import type {
  ChannelAccountSnapshot,
  ChannelDefinition,
  ChannelUiMetaEntry,
  ChannelsStatusSnapshot,
  ConfigSchemaResponse,
  ConfigSnapshot,
  ConfigSnapshotIssue,
  ConfigUiHint,
  ConfigUiHints,
  JsonRecord,
  JsonSchema,
  NostrProfile,
  StatusItem,
} from "./channel-types";

export const DEFAULT_CHANNEL_ORDER = [
  "whatsapp",
  "telegram",
  "discord",
  "googlechat",
  "slack",
  "signal",
  "imessage",
  "nostr",
] as const;

export const CHANNEL_FALLBACK_META: Record<
  string,
  { label: string; detail: string; systemImage?: string }
> = {
  whatsapp: {
    label: "WhatsApp",
    detail: "Link WhatsApp Web and monitor connection health.",
    systemImage: "message.circle.fill",
  },
  telegram: {
    label: "Telegram",
    detail: "Bot status and channel configuration.",
    systemImage: "paperplane.fill",
  },
  discord: {
    label: "Discord",
    detail: "Bot status and channel configuration.",
    systemImage: "bubble.left.and.bubble.right.fill",
  },
  googlechat: {
    label: "Google Chat",
    detail: "Chat API webhook status and channel configuration.",
    systemImage: "message.fill",
  },
  slack: {
    label: "Slack",
    detail: "Socket mode status and channel configuration.",
    systemImage: "number.square.fill",
  },
  signal: {
    label: "Signal",
    detail: "signal-cli status and channel configuration.",
    systemImage: "message.badge.fill",
  },
  imessage: {
    label: "iMessage",
    detail: "macOS bridge status and channel configuration.",
    systemImage: "message.fill",
  },
  nostr: {
    label: "Nostr",
    detail: "Decentralized DMs via Nostr relays.",
    systemImage: "network",
  },
};

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

export function readString(
  record: JsonRecord | null | undefined,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

export function readNumber(
  record: JsonRecord | null | undefined,
  key: string,
): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readBoolean(
  record: JsonRecord | null | undefined,
  key: string,
): boolean | null {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

export function readStringArray(
  record: JsonRecord | null | undefined,
  key: string,
): string[] | null {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : null;
}

export function cloneJsonRecord(value: JsonRecord | null | undefined): JsonRecord {
  if (!value) {
    return {};
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value) as JsonRecord;
  }
  return JSON.parse(JSON.stringify(value)) as JsonRecord;
}

function normalizeAccount(raw: unknown): ChannelAccountSnapshot | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
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

export function normalizeChannelsSnapshot(raw: unknown): ChannelsStatusSnapshot {
  const obj = asRecord(raw);
  const channelsRecord = asRecord(obj?.channels) ?? {};
  const accountsRecord = asRecord(obj?.channelAccounts) ?? {};
  const meta = Array.isArray(obj?.channelMeta)
    ? obj.channelMeta
        .map((entry) => {
          const record = asRecord(entry);
          const id = readString(record, "id");
          if (!id) {
            return null;
          }
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
    channelLabels: (asRecord(obj?.channelLabels) as Record<string, string> | null) ?? {},
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
        Array.isArray(value)
          ? value
              .map((entry) => normalizeAccount(entry))
              .filter(Boolean) as ChannelAccountSnapshot[]
          : [],
      ]),
    ),
    channelDefaultAccountId:
      (asRecord(obj?.channelDefaultAccountId) as Record<string, string> | null) ?? {},
  };
}

export function normalizeConfigSnapshot(raw: unknown): ConfigSnapshot {
  const obj = asRecord(raw);
  if (!obj) {
    return {
      raw: null,
      hash: null,
      valid: null,
      config: null,
      issues: [],
    };
  }

  const issues = Array.isArray(obj.issues)
    ? obj.issues
        .map((issue) => {
          const record = asRecord(issue);
          const path = readString(record, "path");
          const message = readString(record, "message");
          if (!path || !message) {
            return null;
          }
          return { path, message } satisfies ConfigSnapshotIssue;
        })
        .filter((issue): issue is ConfigSnapshotIssue => issue !== null)
    : [];

  return {
    path: readString(obj, "path"),
    exists: readBoolean(obj, "exists"),
    raw: readString(obj, "raw"),
    hash: readString(obj, "hash"),
    valid: readBoolean(obj, "valid"),
    config: asRecord(obj.config),
    issues,
  };
}

export function normalizeConfigSchemaResponse(raw: unknown): ConfigSchemaResponse | null {
  const obj = asRecord(raw);
  const schema = asRecord(obj?.schema) as JsonSchema | null;
  if (!schema) {
    return null;
  }
  return {
    schema,
    uiHints: (asRecord(obj?.uiHints) as ConfigUiHints | null) ?? {},
    version: readString(obj, "version") ?? undefined,
    generatedAt: readString(obj, "generatedAt") ?? undefined,
  };
}

export function resolveChannelOrder(snapshot: ChannelsStatusSnapshot | undefined | null) {
  if (snapshot?.channelMeta?.length) {
    return snapshot.channelMeta.map((entry) => entry.id);
  }
  if (snapshot?.channelOrder?.length) {
    return snapshot.channelOrder;
  }
  return [...DEFAULT_CHANNEL_ORDER];
}

export function resolveChannelMeta(
  snapshot: ChannelsStatusSnapshot | null | undefined,
  channelId: string,
) {
  const fromMeta = snapshot?.channelMeta.find((entry) => entry.id === channelId);
  if (fromMeta) {
    return {
      label: fromMeta.label,
      detail: fromMeta.detailLabel ?? CHANNEL_FALLBACK_META[channelId]?.detail ?? "Channel status and configuration.",
      systemImage:
        fromMeta.systemImage ??
        snapshot?.channelSystemImages?.[channelId] ??
        CHANNEL_FALLBACK_META[channelId]?.systemImage,
    };
  }
  return {
    label: snapshot?.channelLabels?.[channelId] ?? CHANNEL_FALLBACK_META[channelId]?.label ?? channelId,
    detail:
      snapshot?.channelDetailLabels?.[channelId] ??
      CHANNEL_FALLBACK_META[channelId]?.detail ??
      "Channel status and configuration.",
    systemImage:
      snapshot?.channelSystemImages?.[channelId] ?? CHANNEL_FALLBACK_META[channelId]?.systemImage,
  };
}

export function channelEnabled(
  status: JsonRecord | undefined,
  accounts: ChannelAccountSnapshot[],
) {
  if (
    readBoolean(status, "configured") ||
    readBoolean(status, "running") ||
    readBoolean(status, "connected")
  ) {
    return true;
  }
  return accounts.some((account) =>
    Boolean(
      account.configured || account.running || account.connected || account.linked,
    ),
  );
}

export function buildChannels(snapshot: ChannelsStatusSnapshot | null | undefined) {
  const order = resolveChannelOrder(snapshot);
  return [...order]
    .map((channelId, index) => {
      const status = snapshot?.channels[channelId];
      const accounts = snapshot?.channelAccounts[channelId] ?? [];
      const meta = resolveChannelMeta(snapshot, channelId);
      return {
        id: channelId,
        label: meta.label,
        detail: meta.detail,
        systemImage: meta.systemImage,
        status,
        accounts,
        defaultAccountId: snapshot?.channelDefaultAccountId[channelId],
        enabled: channelEnabled(status, accounts),
        order: index,
      };
    })
    .sort((left, right) => {
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1;
      }
      return left.order - right.order;
    })
    .map(({ order: _order, ...channel }: { order: number } & ChannelDefinition) => channel) satisfies ChannelDefinition[];
}

export function formatBoolean(value: boolean | null | undefined) {
  if (value == null) {
    return "n/a";
  }
  return value ? "Yes" : "No";
}

const RECENT_ACTIVITY_THRESHOLD_MS = 10 * 60 * 1000;

export function hasRecentActivity(account: ChannelAccountSnapshot): boolean {
  if (!account.lastInboundAt) {
    return false;
  }
  return Date.now() - account.lastInboundAt < RECENT_ACTIVITY_THRESHOLD_MS;
}

export function deriveRunningStatus(account: ChannelAccountSnapshot): "Yes" | "No" | "Active" {
  if (account.running) {
    return "Yes";
  }
  if (hasRecentActivity(account)) {
    return "Active";
  }
  return "No";
}

export function deriveConnectedStatus(
  account: ChannelAccountSnapshot,
): "Yes" | "No" | "Active" | "n/a" {
  if (account.connected === true) {
    return "Yes";
  }
  if (account.connected === false) {
    return "No";
  }
  if (hasRecentActivity(account)) {
    return "Active";
  }
  return "n/a";
}

export function formatMaybeNumber(value: number | null | undefined) {
  return value == null ? "n/a" : value.toLocaleString();
}

export function formatTimestamp(value: number | null | undefined) {
  return value ? formatRelativeTime(value) : "n/a";
}

export function formatDurationHuman(durationMs: number | null | undefined): string {
  if (!durationMs || durationMs <= 0) {
    return "n/a";
  }

  const totalSeconds = Math.floor(durationMs / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 && parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.slice(0, 2).join(" ") || "0s";
}

export function truncateMiddle(value: string | null | undefined, edge = 8) {
  if (!value) {
    return "n/a";
  }
  if (value.length <= edge * 2 + 3) {
    return value;
  }
  return `${value.slice(0, edge)}...${value.slice(-edge)}`;
}

export function summarizeProbe(probe: unknown): string | null {
  const record = asRecord(probe);
  if (!record) {
    return null;
  }
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

export function statusTone(
  status: JsonRecord | undefined,
): "connected" | "running" | "idle" | "error" {
  if (!status) {
    return "idle";
  }
  if (readBoolean(status, "connected")) {
    return "connected";
  }
  if (readBoolean(status, "running") || readBoolean(status, "linked")) {
    return "running";
  }
  if (readString(status, "lastError")) {
    return "error";
  }
  return "idle";
}

export function statusLabel(status: JsonRecord | undefined): string {
  if (!status) {
    return "Unavailable";
  }
  if (readBoolean(status, "connected")) {
    return "Connected";
  }
  if (readBoolean(status, "running")) {
    return "Running";
  }
  if (readBoolean(status, "linked")) {
    return "Linked";
  }
  if (readBoolean(status, "configured")) {
    return "Configured";
  }
  if (readString(status, "lastError")) {
    return "Error";
  }
  return "Disconnected";
}

export function serializeJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "null";
  }
}

export function resolveChannelConfigValue(
  config: JsonRecord | null | undefined,
  channelId: string,
): JsonRecord {
  if (!config) {
    return {};
  }
  const channels = asRecord(config.channels) ?? {};
  const nested = asRecord(channels[channelId]);
  if (nested) {
    return nested;
  }
  return asRecord(config[channelId]) ?? {};
}

export function buildChannelConfigValues(
  config: JsonRecord | null | undefined,
  channelIds: string[],
) {
  return Object.fromEntries(
    channelIds.map((channelId) => [
      channelId,
      cloneJsonRecord(resolveChannelConfigValue(config, channelId)),
    ]),
  ) as Record<string, JsonRecord>;
}

export function buildRawEditors(configs: Record<string, JsonRecord>) {
  return Object.fromEntries(
    Object.entries(configs).map(([channelId, value]) => [
      channelId,
      JSON.stringify(value, null, 2),
    ]),
  ) as Record<string, string>;
}

export function buildStatusItems(
  items: Array<[string, string | null | undefined]>,
) {
  return items
    .filter(([, value]) => value != null && value !== "")
    .map(([label, value]) => ({ label, value: value ?? "n/a" })) satisfies StatusItem[];
}

export function renderAccountFlags(account: ChannelAccountSnapshot) {
  const flags = [
    account.enabled ? "enabled" : null,
    account.configured ? "configured" : null,
    account.linked ? "linked" : null,
    account.running ? "running" : null,
    account.connected ? "connected" : null,
  ].filter(Boolean);
  return flags.length > 0 ? flags.join(" · ") : "no flags reported";
}

export function resolvePrimaryNostrProfile(
  channel: ChannelDefinition,
): NostrProfile | null {
  const primaryAccount = channel.accounts[0];
  return (
    (asRecord(primaryAccount?.profile) as NostrProfile | null) ??
    (asRecord(channel.status?.profile) as NostrProfile | null)
  );
}

export function createNostrProfileFormState(
  profile: NostrProfile | null | undefined,
) {
  const normalized: NostrProfile = {
    name: profile?.name ?? "",
    displayName: profile?.displayName ?? "",
    about: profile?.about ?? "",
    picture: profile?.picture ?? "",
    banner: profile?.banner ?? "",
    website: profile?.website ?? "",
    nip05: profile?.nip05 ?? "",
    lud16: profile?.lud16 ?? "",
  };

  return {
    values: normalized,
    original: { ...normalized },
    saving: false,
    importing: false,
    error: null,
    success: null,
    fieldErrors: {},
    showAdvanced: Boolean(
      normalized.banner || normalized.website || normalized.nip05 || normalized.lud16,
    ),
  };
}

export function parseNostrFieldErrors(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) {
    return {};
  }
  const errors: Record<string, string> = {};
  for (const entry of details) {
    if (typeof entry !== "string") {
      continue;
    }
    const [rawField, ...rest] = entry.split(":");
    if (!rawField || rest.length === 0) {
      continue;
    }
    const field = rawField.trim();
    const message = rest.join(":").trim();
    if (field && message) {
      errors[field] = message;
    }
  }
  return errors;
}

export function schemaType(schema: JsonSchema | null | undefined): string | undefined {
  if (!schema) {
    return undefined;
  }
  if (Array.isArray(schema.type)) {
    const filtered = schema.type.filter((entry) => entry !== "null");
    return filtered[0] ?? schema.type[0];
  }
  return schema.type;
}

export function defaultValue(schema?: JsonSchema | null): unknown {
  if (!schema) {
    return "";
  }
  if (schema.default !== undefined) {
    return schema.default;
  }
  const type = schemaType(schema);
  switch (type) {
    case "object":
      return {};
    case "array":
      return [];
    case "boolean":
      return false;
    case "number":
    case "integer":
      return 0;
    case "string":
      return "";
    default:
      return "";
  }
}

export function humanize(raw: string) {
  return raw
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/^./, (match) => match.toUpperCase());
}

export function pathKey(path: Array<string | number>) {
  return path.filter((segment): segment is string => typeof segment === "string").join(".");
}

export function hintForPath(path: Array<string | number>, hints: ConfigUiHints) {
  const key = pathKey(path);
  const direct = hints[key];
  if (direct) {
    return direct;
  }
  const segments = key.split(".");
  for (const [hintKey, hint] of Object.entries(hints)) {
    if (!hintKey.includes("*")) {
      continue;
    }
    const hintSegments = hintKey.split(".");
    if (hintSegments.length !== segments.length) {
      continue;
    }
    let matches = true;
    for (let index = 0; index < segments.length; index += 1) {
      if (hintSegments[index] !== "*" && hintSegments[index] !== segments[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return hint;
    }
  }
  return undefined;
}

export function resolveSchemaNode(
  schema: JsonSchema | null | undefined,
  path: Array<string | number>,
): JsonSchema | null {
  let current = schema ?? null;
  for (const key of path) {
    if (!current) {
      return null;
    }
    const type = schemaType(current);
    if (type === "object") {
      const properties = current.properties ?? {};
      if (typeof key === "string" && properties[key]) {
        current = properties[key];
        continue;
      }
      if (
        typeof key === "string" &&
        current.additionalProperties &&
        typeof current.additionalProperties === "object"
      ) {
        current = current.additionalProperties;
        continue;
      }
      return null;
    }
    if (type === "array") {
      if (typeof key !== "number") {
        return null;
      }
      const items = Array.isArray(current.items) ? current.items[0] : current.items;
      current = items ?? null;
      continue;
    }
    return null;
  }
  return current;
}

export function getValueAtPath(
  value: unknown,
  path: Array<string | number>,
): unknown {
  let current = value;
  for (const segment of path) {
    if (current == null) {
      return undefined;
    }
    if (typeof segment === "number") {
      current = Array.isArray(current) ? current[segment] : undefined;
      continue;
    }
    current = asRecord(current)?.[segment];
  }
  return current;
}

export function setValueAtPath(
  currentValue: unknown,
  path: Array<string | number>,
  nextValue: unknown,
): unknown {
  if (path.length === 0) {
    return nextValue;
  }

  const [head, ...tail] = path;

  if (typeof head === "number") {
    const currentArray = Array.isArray(currentValue) ? [...currentValue] : [];
    if (tail.length === 0) {
      if (nextValue === undefined) {
        currentArray.splice(head, 1);
      } else {
        currentArray[head] = nextValue;
      }
      return currentArray;
    }
    currentArray[head] = setValueAtPath(currentArray[head], tail, nextValue);
    return currentArray;
  }

  const currentObject = asRecord(currentValue) ? { ...(currentValue as JsonRecord) } : {};
  if (tail.length === 0) {
    if (nextValue === undefined) {
      delete currentObject[head];
    } else {
      currentObject[head] = nextValue;
    }
    return currentObject;
  }
  currentObject[head] = setValueAtPath(currentObject[head], tail, nextValue);
  return currentObject;
}

export function formatChannelSummary(channel: ChannelDefinition) {
  const status = channel.status;
  const primaryAccount = channel.accounts[0];
  const self = asRecord(status?.self);
  const profile = resolvePrimaryNostrProfile(channel) as JsonRecord | null;

  switch (channel.id) {
    case "whatsapp":
      return buildStatusItems([
        ["Configured", formatBoolean(readBoolean(status, "configured"))],
        ["Linked", formatBoolean(readBoolean(status, "linked"))],
        ["Running", formatBoolean(readBoolean(status, "running"))],
        ["Connected", formatBoolean(readBoolean(status, "connected"))],
        ["Identity", readString(self, "jid") ?? readString(self, "e164")],
        ["Last connect", formatTimestamp(readNumber(status, "lastConnectedAt"))],
        ["Last message", formatTimestamp(readNumber(status, "lastMessageAt"))],
        ["Auth age", formatDurationHuman(readNumber(status, "authAgeMs"))],
        ["Reconnects", formatMaybeNumber(readNumber(status, "reconnectAttempts"))],
      ]);
    case "telegram":
      if (channel.accounts.length > 1) {
        return [];
      }
      return buildStatusItems([
        ["Configured", formatBoolean(readBoolean(status, "configured"))],
        ["Running", formatBoolean(readBoolean(status, "running"))],
        ["Mode", readString(status, "mode")],
        ["Token source", readString(status, "tokenSource")],
        ["Last start", formatTimestamp(readNumber(status, "lastStartAt"))],
        ["Last probe", formatTimestamp(readNumber(status, "lastProbeAt"))],
      ]);
    case "discord":
      return buildStatusItems([
        ["Configured", formatBoolean(readBoolean(status, "configured"))],
        ["Running", formatBoolean(readBoolean(status, "running"))],
        ["Token source", readString(status, "tokenSource")],
        ["Last start", formatTimestamp(readNumber(status, "lastStartAt"))],
        ["Last probe", formatTimestamp(readNumber(status, "lastProbeAt"))],
      ]);
    case "googlechat":
      return buildStatusItems([
        ["Configured", formatBoolean(readBoolean(status, "configured"))],
        ["Running", formatBoolean(readBoolean(status, "running"))],
        ["Credential", readString(status, "credentialSource")],
        [
          "Audience",
          [readString(status, "audienceType"), readString(status, "audience")]
            .filter(Boolean)
            .join(" · "),
        ],
        ["Webhook", readString(status, "webhookUrl") ?? readString(status, "webhookPath")],
        ["Last start", formatTimestamp(readNumber(status, "lastStartAt"))],
        ["Last probe", formatTimestamp(readNumber(status, "lastProbeAt"))],
      ]);
    case "slack":
      return buildStatusItems([
        ["Configured", formatBoolean(readBoolean(status, "configured"))],
        ["Running", formatBoolean(readBoolean(status, "running"))],
        ["Bot token", readString(status, "botTokenSource")],
        ["App token", readString(status, "appTokenSource")],
        ["Last start", formatTimestamp(readNumber(status, "lastStartAt"))],
        ["Last probe", formatTimestamp(readNumber(status, "lastProbeAt"))],
      ]);
    case "signal":
      return buildStatusItems([
        ["Configured", formatBoolean(readBoolean(status, "configured"))],
        ["Running", formatBoolean(readBoolean(status, "running"))],
        ["Base URL", readString(status, "baseUrl")],
        ["Last start", formatTimestamp(readNumber(status, "lastStartAt"))],
        ["Last probe", formatTimestamp(readNumber(status, "lastProbeAt"))],
      ]);
    case "imessage":
      return buildStatusItems([
        ["Configured", formatBoolean(readBoolean(status, "configured"))],
        ["Running", formatBoolean(readBoolean(status, "running"))],
        ["CLI path", readString(status, "cliPath")],
        ["DB path", readString(status, "dbPath")],
        ["Last start", formatTimestamp(readNumber(status, "lastStartAt"))],
        ["Last probe", formatTimestamp(readNumber(status, "lastProbeAt"))],
      ]);
    case "nostr":
      return buildStatusItems([
        [
          "Configured",
          formatBoolean(
            readBoolean(status, "configured") ?? primaryAccount?.configured ?? null,
          ),
        ],
        [
          "Running",
          formatBoolean(readBoolean(status, "running") ?? primaryAccount?.running ?? null),
        ],
        [
          "Public Key",
          truncateMiddle(readString(status, "publicKey") ?? primaryAccount?.publicKey),
        ],
        [
          "Last start",
          formatTimestamp(
            readNumber(status, "lastStartAt") ?? primaryAccount?.lastStartAt ?? null,
          ),
        ],
        [
          "Profile",
          profile ? truncate(String(profile.displayName ?? profile.name ?? "Profile"), 42) : null,
        ],
      ]);
    default:
      return buildStatusItems([
        ["Configured", formatBoolean(readBoolean(status, "configured"))],
        ["Linked", formatBoolean(readBoolean(status, "linked"))],
        ["Running", formatBoolean(readBoolean(status, "running"))],
        ["Connected", formatBoolean(readBoolean(status, "connected"))],
        ["Accounts", formatMaybeNumber(channel.accounts.length)],
      ]);
  }
}

export function schemaTags(schema: JsonSchema | null | undefined, hint?: ConfigUiHint) {
  const tags = new Set<string>();
  for (const tag of schema?.tags ?? []) {
    tags.add(tag);
  }
  for (const tag of schema?.["x-tags"] ?? []) {
    tags.add(tag);
  }
  for (const tag of hint?.tags ?? []) {
    tags.add(tag);
  }
  if (hint?.advanced) {
    tags.add("advanced");
  }
  return [...tags];
}
