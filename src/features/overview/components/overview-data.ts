import {
  buildDateInterpretationParams,
  createDefaultDateRange,
  isLegacyDateInterpretationUnsupportedError,
  normalizeCostUsageSummary,
  normalizeSessionsUsageResult,
  type CostUsageSummary,
  type SessionsUsageResult,
} from "@/features/usage/components/usage-utils";
import { gateway } from "@/lib/gateway";

export type JsonRecord = Record<string, unknown>;

export type OverviewSessionItem = {
  key: string;
  title: string;
  updatedAt: number | null;
  messageCount: number;
  agentId: string | null;
};

export type OverviewModelItem = {
  id: string;
  provider: string | null;
  model: string | null;
  label: string;
};

export type OverviewData = {
  loadedAt: number;
  issues: string[];
  status: JsonRecord | null;
  health: JsonRecord | null;
  heartbeat: JsonRecord | null;
  presenceCount: number;
  sessionsCount: number | null;
  sessions: OverviewSessionItem[];
  cronEnabled: boolean | null;
  cronJobs: number | null;
  cronNextWakeAtMs: number | null;
  lastChannelsRefresh: number | null;
  channelsOnline: number;
  channelsTotal: number;
  usageSessions: SessionsUsageResult | null;
  usageCost: CostUsageSummary | null;
  models: OverviewModelItem[];
};

const USAGE_SESSION_LIMIT = 200;
const TIMESTAMP_KEYS = new Set([
  "lastProbeAt",
  "lastStartAt",
  "lastConnectedAt",
  "lastInboundAt",
  "lastOutboundAt",
  "updatedAt",
  "updated_at",
  "timestamp",
  "ts",
]);

export function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

export function readBoolean(record: JsonRecord | null | undefined, key: string): boolean | null {
  return typeof record?.[key] === "boolean" ? (record[key] as boolean) : null;
}

export function readNumber(record: JsonRecord | null | undefined, key: string): number | null {
  return typeof record?.[key] === "number" && Number.isFinite(record[key])
    ? (record[key] as number)
    : null;
}

export function readString(record: JsonRecord | null | undefined, key: string): string | null {
  return typeof record?.[key] === "string" ? (record[key] as string) : null;
}

function readArray(record: JsonRecord | null | undefined, key: string): unknown[] {
  return Array.isArray(record?.[key]) ? (record[key] as unknown[]) : [];
}

function parseAgentIdFromKey(key: string): string | null {
  const match = key.match(/^agent:([^:]+):/);
  return match?.[1] ?? null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeSessionItem(value: unknown): OverviewSessionItem | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const key = firstString(record.key, record.sessionKey, record.sessionId, record.session_id, record.id);
  if (!key) {
    return null;
  }

  const title =
    firstString(record.title, record.name, record.label, record.displayName, record.derivedTitle, record.subject) ??
    key;
  const updatedAt =
    readNumber(record, "updatedAt") ??
    readNumber(record, "updated_at") ??
    readNumber(record, "updated") ??
    readNumber(record, "lastActivity") ??
    null;
  const messageCountRaw = record.messageCount ?? record.message_count ?? record.messages;
  const messageCount = typeof messageCountRaw === "number" && Number.isFinite(messageCountRaw) ? messageCountRaw : 0;
  const agentId =
    firstString(record.agentId, record.agent_id, record.agent) ?? parseAgentIdFromKey(key) ?? null;

  return {
    key,
    title,
    updatedAt,
    messageCount,
    agentId,
  };
}

function extractSessionItems(raw: unknown): { count: number | null; sessions: OverviewSessionItem[] } {
  const record = asRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : readArray(record, "sessions").length > 0
      ? readArray(record, "sessions")
      : readArray(record, "items").length > 0
        ? readArray(record, "items")
        : readArray(record, "data").length > 0
          ? readArray(record, "data")
          : readArray(record, "list").length > 0
            ? readArray(record, "list")
            : readArray(record, "result");

  const sessions = list
    .map((entry) => normalizeSessionItem(entry))
    .filter((entry): entry is OverviewSessionItem => entry !== null)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));

  return {
    count: readNumber(record, "count") ?? sessions.length,
    sessions,
  };
}

function extractPresenceCount(raw: unknown): number {
  if (Array.isArray(raw)) {
    return raw.length;
  }
  const record = asRecord(raw);
  return readNumber(record, "count") ?? readArray(record, "entries").length ?? 0;
}

function extractModels(raw: unknown): OverviewModelItem[] {
  const record = asRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : readArray(record, "models").length > 0
      ? readArray(record, "models")
      : readArray(record, "items").length > 0
        ? readArray(record, "items")
        : readArray(record, "data").length > 0
          ? readArray(record, "data")
          : readArray(record, "list").length > 0
            ? readArray(record, "list")
            : readArray(record, "result");

  return list
    .map((entry) => {
      const item = asRecord(entry);
      if (!item) {
        return null;
      }
      const provider = firstString(item.provider, item.providerId, item.vendor);
      const model = firstString(item.model, item.id, item.name);
      const label = [provider, model].filter(Boolean).join("/") || firstString(item.name, item.id) || "Unknown model";
      return {
        id: label,
        provider: provider ?? null,
        model: model ?? null,
        label,
      } satisfies OverviewModelItem;
    })
    .filter((entry): entry is OverviewModelItem => entry !== null);
}

function isChannelOnline(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  return (
    readBoolean(record, "connected") === true ||
    readBoolean(record, "running") === true ||
    readBoolean(record, "linked") === true
  );
}

function collectLatestTimestamp(value: unknown): number | null {
  if (Array.isArray(value)) {
    let latest: number | null = null;
    for (const entry of value) {
      const candidate = collectLatestTimestamp(entry);
      if (candidate != null && (latest == null || candidate > latest)) {
        latest = candidate;
      }
    }
    return latest;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  let latest: number | null = null;
  for (const [key, entry] of Object.entries(record)) {
    if (TIMESTAMP_KEYS.has(key) && typeof entry === "number" && Number.isFinite(entry)) {
      latest = latest == null || entry > latest ? entry : latest;
      continue;
    }
    if (entry && typeof entry === "object") {
      const candidate = collectLatestTimestamp(entry);
      if (candidate != null && (latest == null || candidate > latest)) {
        latest = candidate;
      }
    }
  }

  return latest;
}

function extractChannelSummary(raw: unknown): {
  channelsOnline: number;
  channelsTotal: number;
  lastChannelsRefresh: number | null;
} {
  const record = asRecord(raw);
  const channels = asRecord(record?.channels) ?? {};
  const entries = Object.values(channels);
  return {
    channelsOnline: entries.filter((entry) => isChannelOnline(entry)).length,
    channelsTotal: entries.length,
    lastChannelsRefresh: collectLatestTimestamp(record),
  };
}

async function loadUsageSnapshot() {
  const { startDate, endDate } = createDefaultDateRange(7);

  const runRequests = async (includeDateInterpretation: boolean) => {
    const dateParams = buildDateInterpretationParams("local", includeDateInterpretation);
    const [sessionsRaw, costRaw] = await Promise.all([
      gateway.request<unknown>("sessions.usage", {
        startDate,
        endDate,
        limit: USAGE_SESSION_LIMIT,
        includeContextWeight: true,
        ...dateParams,
      }),
      gateway.request<unknown>("usage.cost", {
        startDate,
        endDate,
        ...dateParams,
      }),
    ]);

    return {
      usageSessions: normalizeSessionsUsageResult(sessionsRaw, startDate, endDate),
      usageCost: normalizeCostUsageSummary(costRaw),
    };
  };

  try {
    return await runRequests(true);
  } catch (error) {
    if (isLegacyDateInterpretationUnsupportedError(error)) {
      return await runRequests(false);
    }
    throw error;
  }
}

export async function loadOverview(): Promise<OverviewData> {
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
  const [statusRaw, healthRaw, presenceRaw, sessionsRaw, channelsRaw, cronRaw, heartbeatRaw, modelsRaw, usage] =
    await Promise.all([
      safeRequest<unknown>("status"),
      safeRequest<unknown>("health"),
      safeRequest<unknown>("system-presence"),
      safeRequest<unknown>("sessions.list", { limit: 12, includeDerivedTitles: true }),
      safeRequest<unknown>("channels.status", { probe: false, timeoutMs: 5_000 }),
      safeRequest<unknown>("cron.status"),
      safeRequest<unknown>("last-heartbeat"),
      safeRequest<unknown>("models.list"),
      loadUsageSnapshot().catch((error) => {
        issues.push(`usage: ${String(error)}`);
        return null;
      }),
    ]);

  const cron = asRecord(cronRaw);
  const sessionSummary = extractSessionItems(sessionsRaw);
  const channelSummary = extractChannelSummary(channelsRaw);

  return {
    loadedAt,
    issues,
    status: asRecord(statusRaw),
    health: asRecord(healthRaw),
    heartbeat: asRecord(heartbeatRaw),
    presenceCount: extractPresenceCount(presenceRaw),
    sessionsCount: sessionSummary.count,
    sessions: sessionSummary.sessions,
    cronEnabled: readBoolean(cron, "enabled"),
    cronJobs: readNumber(cron, "jobs"),
    cronNextWakeAtMs: readNumber(cron, "nextWakeAtMs"),
    lastChannelsRefresh: channelSummary.lastChannelsRefresh,
    channelsOnline: channelSummary.channelsOnline,
    channelsTotal: channelSummary.channelsTotal,
    usageSessions: usage?.usageSessions ?? null,
    usageCost: usage?.usageCost ?? null,
    models: extractModels(modelsRaw),
  };
}
