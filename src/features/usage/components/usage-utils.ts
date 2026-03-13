export type TimeZoneMode = "local" | "utc";

export type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  missingCostEntries: number;
};

export type MessageCounts = {
  total: number;
  user: number;
  assistant: number;
  toolCalls: number;
  toolResults: number;
  errors: number;
};

export type ToolUsage = {
  totalCalls: number;
  uniqueTools: number;
  tools: Array<{ name: string; count: number }>;
};

export type UsageDailyBreakdown = {
  date: string;
  tokens: number;
  cost: number;
};

export type UsageDailyMessageCounts = {
  date: string;
  total: number;
  user: number;
  assistant: number;
  toolCalls: number;
  toolResults: number;
  errors: number;
};

export type UsageLatencyStats = {
  count: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
};

export type UsageDailyLatency = UsageLatencyStats & { date: string };

export type UsageModelUsage = {
  provider?: string;
  model?: string;
  count: number;
  totals: UsageTotals;
};

export type UsageDailyModelUsage = {
  date: string;
  provider?: string;
  model?: string;
  tokens: number;
  cost: number;
  count: number;
};

export type UsageContextWeight = {
  systemPrompt: {
    chars: number;
  };
  skills: {
    promptChars: number;
    entries: Array<{
      name: string;
      blockChars: number;
    }>;
  };
  tools: {
    listChars: number;
    schemaChars: number;
    entries: Array<{
      name: string;
      summaryChars: number;
      schemaChars: number;
    }>;
  };
  injectedWorkspaceFiles: Array<{
    path: string;
    injectedChars: number;
  }>;
};

export type SessionUsage = UsageTotals & {
  sessionId?: string;
  sessionFile?: string;
  firstActivity?: number;
  lastActivity?: number;
  durationMs?: number;
  activityDates?: string[];
  dailyBreakdown?: UsageDailyBreakdown[];
  dailyMessageCounts?: UsageDailyMessageCounts[];
  dailyLatency?: UsageDailyLatency[];
  dailyModelUsage?: UsageDailyModelUsage[];
  messageCounts?: MessageCounts;
  toolUsage?: ToolUsage;
  modelUsage?: UsageModelUsage[];
  latency?: UsageLatencyStats;
};

export type UsageAggregateEntry = {
  count?: number;
  totals: UsageTotals;
};

export type UsageModelAggregateEntry = UsageAggregateEntry & {
  provider?: string;
  model?: string;
};

export type UsageAgentAggregateEntry = UsageAggregateEntry & {
  agentId: string;
};

export type UsageChannelAggregateEntry = UsageAggregateEntry & {
  channel: string;
};

export type UsageDailyAggregate = {
  date: string;
  tokens: number;
  cost: number;
  messages: number;
  toolCalls: number;
  errors: number;
};

export type SessionUsageEntry = {
  key: string;
  label?: string;
  sessionId?: string;
  updatedAt?: number;
  agentId?: string;
  channel?: string;
  chatType?: string;
  origin?: {
    label?: string;
    provider?: string;
    surface?: string;
    chatType?: string;
    from?: string;
    to?: string;
    accountId?: string;
    threadId?: string | number;
  };
  modelOverride?: string;
  providerOverride?: string;
  modelProvider?: string;
  model?: string;
  contextWeight?: UsageContextWeight | null;
  usage: SessionUsage | null;
};

export type UsageAggregates = {
  messages: MessageCounts;
  tools: ToolUsage;
  byModel: UsageModelAggregateEntry[];
  byProvider: UsageModelAggregateEntry[];
  byAgent: UsageAgentAggregateEntry[];
  byChannel: UsageChannelAggregateEntry[];
  latency?: UsageLatencyStats;
  dailyLatency?: UsageDailyLatency[];
  modelDaily?: UsageDailyModelUsage[];
  daily: UsageDailyAggregate[];
};

export type SessionsUsageResult = {
  updatedAt: number;
  startDate: string;
  endDate: string;
  sessions: SessionUsageEntry[];
  totals: UsageTotals;
  aggregates: UsageAggregates;
};

export type CostUsageSummary = {
  updatedAt: number;
  days: number;
  daily: Array<UsageTotals & { date: string }>;
  totals: UsageTotals;
};

export type SessionUsageTimePoint = {
  timestamp: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
  cumulativeTokens: number;
  cumulativeCost: number;
};

export type SessionUsageTimeSeries = {
  sessionId?: string;
  points: SessionUsageTimePoint[];
};

export type SessionLogRole = "user" | "assistant" | "tool" | "toolResult";

export type SessionLogEntry = {
  timestamp: number;
  role: SessionLogRole;
  content: string;
  tokens?: number;
  cost?: number;
};

export type UsageSnapshot = {
  sessions: SessionsUsageResult;
  cost: CostUsageSummary | null;
  loadedAt: number;
};

export type UsageQueryTerm = {
  key?: string;
  value: string;
  raw: string;
};

export type UsageQueryResult<TSession> = {
  sessions: TSession[];
  warnings: string[];
};

type UsageSessionQueryTarget = {
  key: string;
  label?: string;
  sessionId?: string;
  agentId?: string;
  channel?: string;
  chatType?: string;
  modelProvider?: string;
  providerOverride?: string;
  origin?: { provider?: string };
  model?: string;
  contextWeight?: unknown;
  usage?: {
    totalTokens?: number;
    totalCost?: number;
    messageCounts?: { total?: number; errors?: number };
    toolUsage?: { totalCalls?: number; tools?: Array<{ name: string }> };
    modelUsage?: Array<{ provider?: string; model?: string }>;
  } | null;
};

type LatencyTotalsLike = {
  count: number;
  sum: number;
  min: number;
  max: number;
  p95Max: number;
};

const QUERY_KEYS = new Set([
  "agent",
  "channel",
  "chat",
  "provider",
  "model",
  "tool",
  "label",
  "key",
  "session",
  "id",
  "has",
  "mintokens",
  "maxtokens",
  "mincost",
  "maxcost",
  "minmessages",
  "maxmessages",
]);

const CHARS_PER_TOKEN = 4;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown> | null, key: string): string | undefined {
  return typeof record?.[key] === "string" ? (record[key] as string) : undefined;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | undefined {
  return typeof record?.[key] === "number" ? (record[key] as number) : undefined;
}

export function createEmptyTotals(): UsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    missingCostEntries: 0,
  };
}

export function addUsageTotals(target: UsageTotals, source: Partial<UsageTotals>) {
  target.input += source.input ?? 0;
  target.output += source.output ?? 0;
  target.cacheRead += source.cacheRead ?? 0;
  target.cacheWrite += source.cacheWrite ?? 0;
  target.totalTokens += source.totalTokens ?? 0;
  target.totalCost += source.totalCost ?? 0;
  target.inputCost += source.inputCost ?? 0;
  target.outputCost += source.outputCost ?? 0;
  target.cacheReadCost += source.cacheReadCost ?? 0;
  target.cacheWriteCost += source.cacheWriteCost ?? 0;
  target.missingCostEntries += source.missingCostEntries ?? 0;
  return target;
}

function normalizeTotals(value: unknown): UsageTotals {
  const record = asRecord(value);
  const fallback = createEmptyTotals();
  return {
    input: readNumber(record, "input") ?? fallback.input,
    output: readNumber(record, "output") ?? fallback.output,
    cacheRead: readNumber(record, "cacheRead") ?? fallback.cacheRead,
    cacheWrite: readNumber(record, "cacheWrite") ?? fallback.cacheWrite,
    totalTokens: readNumber(record, "totalTokens") ?? fallback.totalTokens,
    totalCost: readNumber(record, "totalCost") ?? fallback.totalCost,
    inputCost: readNumber(record, "inputCost") ?? fallback.inputCost,
    outputCost: readNumber(record, "outputCost") ?? fallback.outputCost,
    cacheReadCost: readNumber(record, "cacheReadCost") ?? fallback.cacheReadCost,
    cacheWriteCost: readNumber(record, "cacheWriteCost") ?? fallback.cacheWriteCost,
    missingCostEntries: readNumber(record, "missingCostEntries") ?? fallback.missingCostEntries,
  };
}

function normalizeMessageCounts(value: unknown): MessageCounts {
  const record = asRecord(value);
  return {
    total: readNumber(record, "total") ?? 0,
    user: readNumber(record, "user") ?? 0,
    assistant: readNumber(record, "assistant") ?? 0,
    toolCalls: readNumber(record, "toolCalls") ?? 0,
    toolResults: readNumber(record, "toolResults") ?? 0,
    errors: readNumber(record, "errors") ?? 0,
  };
}

function normalizeToolUsage(value: unknown): ToolUsage {
  const record = asRecord(value);
  const tools = Array.isArray(record?.tools)
    ? record.tools.flatMap((entry) => {
        const item = asRecord(entry);
        const name = readString(item, "name");
        if (!name) {
          return [];
        }
        return [{ name, count: readNumber(item, "count") ?? 0 }];
      })
    : [];

  return {
    totalCalls: readNumber(record, "totalCalls") ?? 0,
    uniqueTools: readNumber(record, "uniqueTools") ?? tools.length,
    tools,
  };
}

function normalizeLatency(value: unknown): UsageLatencyStats | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    count: readNumber(record, "count") ?? 0,
    avgMs: readNumber(record, "avgMs") ?? 0,
    minMs: readNumber(record, "minMs") ?? 0,
    maxMs: readNumber(record, "maxMs") ?? 0,
    p95Ms: readNumber(record, "p95Ms") ?? 0,
  };
}

function normalizeDailyLatency(value: unknown): UsageDailyLatency[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    const date = readString(item, "date");
    if (!date) {
      return [];
    }
    return [
      {
        date,
        count: readNumber(item, "count") ?? 0,
        avgMs: readNumber(item, "avgMs") ?? 0,
        minMs: readNumber(item, "minMs") ?? 0,
        maxMs: readNumber(item, "maxMs") ?? 0,
        p95Ms: readNumber(item, "p95Ms") ?? 0,
      },
    ];
  });
}

function normalizeModelUsage(value: unknown): UsageModelUsage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    if (!item) {
      return [];
    }
    return [
      {
        provider: readString(item, "provider"),
        model: readString(item, "model"),
        count: readNumber(item, "count") ?? 0,
        totals: normalizeTotals(item.totals),
      },
    ];
  });
}

function normalizeDailyBreakdown(value: unknown): UsageDailyBreakdown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    const date = readString(item, "date");
    if (!date) {
      return [];
    }
    return [
      {
        date,
        tokens: readNumber(item, "tokens") ?? 0,
        cost: readNumber(item, "cost") ?? 0,
      },
    ];
  });
}

function normalizeDailyMessageCounts(value: unknown): UsageDailyMessageCounts[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    const date = readString(item, "date");
    if (!date) {
      return [];
    }
    return [
      {
        date,
        total: readNumber(item, "total") ?? 0,
        user: readNumber(item, "user") ?? 0,
        assistant: readNumber(item, "assistant") ?? 0,
        toolCalls: readNumber(item, "toolCalls") ?? 0,
        toolResults: readNumber(item, "toolResults") ?? 0,
        errors: readNumber(item, "errors") ?? 0,
      },
    ];
  });
}

function normalizeDailyModelUsage(value: unknown): UsageDailyModelUsage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    const date = readString(item, "date");
    if (!date) {
      return [];
    }
    return [
      {
        date,
        provider: readString(item, "provider"),
        model: readString(item, "model"),
        tokens: readNumber(item, "tokens") ?? 0,
        cost: readNumber(item, "cost") ?? 0,
        count: readNumber(item, "count") ?? 0,
      },
    ];
  });
}

function normalizeContextWeight(value: unknown): UsageContextWeight | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const systemPrompt = asRecord(record.systemPrompt);
  const skills = asRecord(record.skills);
  const tools = asRecord(record.tools);

  return {
    systemPrompt: {
      chars: readNumber(systemPrompt, "chars") ?? 0,
    },
    skills: {
      promptChars: readNumber(skills, "promptChars") ?? 0,
      entries: Array.isArray(skills?.entries)
        ? skills.entries.flatMap((entry) => {
            const item = asRecord(entry);
            const name = readString(item, "name");
            if (!name) {
              return [];
            }
            return [{ name, blockChars: readNumber(item, "blockChars") ?? 0 }];
          })
        : [],
    },
    tools: {
      listChars: readNumber(tools, "listChars") ?? 0,
      schemaChars: readNumber(tools, "schemaChars") ?? 0,
      entries: Array.isArray(tools?.entries)
        ? tools.entries.flatMap((entry) => {
            const item = asRecord(entry);
            const name = readString(item, "name");
            if (!name) {
              return [];
            }
            return [
              {
                name,
                summaryChars: readNumber(item, "summaryChars") ?? 0,
                schemaChars: readNumber(item, "schemaChars") ?? 0,
              },
            ];
          })
        : [],
    },
    injectedWorkspaceFiles: Array.isArray(record.injectedWorkspaceFiles)
      ? record.injectedWorkspaceFiles.flatMap((entry) => {
          const item = asRecord(entry);
          const path = readString(item, "path");
          if (!path) {
            return [];
          }
          return [{ path, injectedChars: readNumber(item, "injectedChars") ?? 0 }];
        })
      : [],
  };
}

function normalizeSessionUsage(value: unknown): SessionUsage | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return {
    ...normalizeTotals(record),
    sessionId: readString(record, "sessionId"),
    sessionFile: readString(record, "sessionFile"),
    firstActivity: readNumber(record, "firstActivity"),
    lastActivity: readNumber(record, "lastActivity"),
    durationMs: readNumber(record, "durationMs"),
    activityDates: Array.isArray(record.activityDates)
      ? record.activityDates.filter((value): value is string => typeof value === "string")
      : [],
    dailyBreakdown: normalizeDailyBreakdown(record.dailyBreakdown),
    dailyMessageCounts: normalizeDailyMessageCounts(record.dailyMessageCounts),
    dailyLatency: normalizeDailyLatency(record.dailyLatency),
    dailyModelUsage: normalizeDailyModelUsage(record.dailyModelUsage),
    messageCounts: normalizeMessageCounts(record.messageCounts),
    toolUsage: normalizeToolUsage(record.toolUsage),
    modelUsage: normalizeModelUsage(record.modelUsage),
    latency: normalizeLatency(record.latency),
  };
}

function normalizeModelAggregateEntries(value: unknown, kind: "model" | "provider") {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    if (!item) {
      return [];
    }
    return [
      {
        provider: readString(item, "provider"),
        model: kind === "model" ? readString(item, "model") : undefined,
        count: readNumber(item, "count"),
        totals: normalizeTotals(item.totals),
      },
    ];
  });
}

export function normalizeSessionsUsageResult(
  value: unknown,
  startDate: string,
  endDate: string,
): SessionsUsageResult {
  const record = asRecord(value);
  const sessions = Array.isArray(record?.sessions)
    ? record.sessions.flatMap((entry) => {
        const item = asRecord(entry);
        const key = readString(item, "key");
        if (!key) {
          return [];
        }
        const origin = asRecord(item?.origin);
        return [
          {
            key,
            label: readString(item, "label"),
            sessionId: readString(item, "sessionId"),
            updatedAt: readNumber(item, "updatedAt"),
            agentId: readString(item, "agentId"),
            channel: readString(item, "channel"),
            chatType: readString(item, "chatType"),
            origin: origin
              ? {
                  label: readString(origin, "label"),
                  provider: readString(origin, "provider"),
                  surface: readString(origin, "surface"),
                  chatType: readString(origin, "chatType"),
                  from: readString(origin, "from"),
                  to: readString(origin, "to"),
                  accountId: readString(origin, "accountId"),
                  threadId:
                    typeof origin.threadId === "string" || typeof origin.threadId === "number"
                      ? (origin.threadId as string | number)
                      : undefined,
                }
              : undefined,
            modelOverride: readString(item, "modelOverride"),
            providerOverride: readString(item, "providerOverride"),
            modelProvider: readString(item, "modelProvider"),
            model: readString(item, "model"),
            contextWeight: normalizeContextWeight(item?.contextWeight),
            usage: normalizeSessionUsage(item?.usage),
          },
        ];
      })
    : [];

  const aggregatesRecord = asRecord(record?.aggregates);

  return {
    updatedAt: readNumber(record, "updatedAt") ?? Date.now(),
    startDate: readString(record, "startDate") ?? startDate,
    endDate: readString(record, "endDate") ?? endDate,
    sessions,
    totals: normalizeTotals(record?.totals),
    aggregates: {
      messages: normalizeMessageCounts(aggregatesRecord?.messages),
      tools: normalizeToolUsage(aggregatesRecord?.tools),
      byModel: normalizeModelAggregateEntries(aggregatesRecord?.byModel, "model"),
      byProvider: normalizeModelAggregateEntries(aggregatesRecord?.byProvider, "provider"),
      byAgent: Array.isArray(aggregatesRecord?.byAgent)
        ? aggregatesRecord.byAgent.flatMap((entry) => {
            const item = asRecord(entry);
            const agentId = readString(item, "agentId");
            if (!agentId) {
              return [];
            }
            return [{ agentId, totals: normalizeTotals(item.totals) }];
          })
        : [],
      byChannel: Array.isArray(aggregatesRecord?.byChannel)
        ? aggregatesRecord.byChannel.flatMap((entry) => {
            const item = asRecord(entry);
            const channel = readString(item, "channel");
            if (!channel) {
              return [];
            }
            return [{ channel, totals: normalizeTotals(item.totals) }];
          })
        : [],
      latency: normalizeLatency(aggregatesRecord?.latency),
      dailyLatency: normalizeDailyLatency(aggregatesRecord?.dailyLatency),
      modelDaily: normalizeDailyModelUsage(aggregatesRecord?.modelDaily),
      daily: Array.isArray(aggregatesRecord?.daily)
        ? aggregatesRecord.daily.flatMap((entry) => {
            const item = asRecord(entry);
            const date = readString(item, "date");
            if (!date) {
              return [];
            }
            return [
              {
                date,
                tokens: readNumber(item, "tokens") ?? 0,
                cost: readNumber(item, "cost") ?? 0,
                messages: readNumber(item, "messages") ?? 0,
                toolCalls: readNumber(item, "toolCalls") ?? 0,
                errors: readNumber(item, "errors") ?? 0,
              },
            ];
          })
        : [],
    },
  };
}

export function normalizeCostUsageSummary(value: unknown): CostUsageSummary | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    updatedAt: readNumber(record, "updatedAt") ?? Date.now(),
    days: readNumber(record, "days") ?? 0,
    daily: Array.isArray(record.daily)
      ? record.daily.flatMap((entry) => {
          const item = asRecord(entry);
          const date = readString(item, "date");
          if (!date) {
            return [];
          }
          return [{ date, ...normalizeTotals(item) }];
        })
      : [],
    totals: normalizeTotals(record.totals),
  };
}

export function normalizeTimeSeries(value: unknown): SessionUsageTimeSeries {
  const record = asRecord(value);
  return {
    sessionId: readString(record, "sessionId"),
    points: Array.isArray(record?.points)
      ? record.points.flatMap((entry) => {
          const item = asRecord(entry);
          const timestamp = readNumber(item, "timestamp");
          if (timestamp == null) {
            return [];
          }
          return [
            {
              timestamp,
              input: readNumber(item, "input") ?? 0,
              output: readNumber(item, "output") ?? 0,
              cacheRead: readNumber(item, "cacheRead") ?? 0,
              cacheWrite: readNumber(item, "cacheWrite") ?? 0,
              totalTokens: readNumber(item, "totalTokens") ?? 0,
              cost: readNumber(item, "cost") ?? 0,
              cumulativeTokens: readNumber(item, "cumulativeTokens") ?? 0,
              cumulativeCost: readNumber(item, "cumulativeCost") ?? 0,
            },
          ];
        })
      : [],
  };
}

export function normalizeLogs(value: unknown): SessionLogEntry[] {
  const record = asRecord(value);
  if (!Array.isArray(record?.logs)) {
    return [];
  }
  return record.logs.flatMap((entry) => {
    const item = asRecord(entry);
    const timestamp = readNumber(item, "timestamp");
    const role = readString(item, "role");
    const content = readString(item, "content");
    if (
      timestamp == null ||
      !role ||
      !content ||
      (role !== "user" && role !== "assistant" && role !== "tool" && role !== "toolResult")
    ) {
      return [];
    }
    return [
      {
        timestamp,
        role,
        content,
        tokens: readNumber(item, "tokens"),
        cost: readNumber(item, "cost"),
      },
    ];
  });
}

export function formatUtcOffset(timezoneOffsetMinutes: number) {
  const offsetFromUtcMinutes = -timezoneOffsetMinutes;
  const sign = offsetFromUtcMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetFromUtcMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  return minutes === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${minutes.toString().padStart(2, "0")}`;
}

export function buildDateInterpretationParams(
  timeZone: TimeZoneMode,
  includeDateInterpretation: boolean,
) {
  if (!includeDateInterpretation) {
    return {};
  }
  if (timeZone === "utc") {
    return { mode: "utc" as const };
  }
  return {
    mode: "specific" as const,
    utcOffset: formatUtcOffset(new Date().getTimezoneOffset()),
  };
}

export function isLegacyDateInterpretationUnsupportedError(err: unknown) {
  const message = String(err);
  return (
    /invalid sessions\.usage params/i.test(message) &&
    (/unexpected property ['"]mode['"]/i.test(message) ||
      /unexpected property ['"]utcoffset['"]/i.test(message))
  );
}

export function toDateInputValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

export function createDefaultDateRange(days = 1) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  return {
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(end),
  };
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 4,
  }).format(value);
}

export function formatCost(value: number, decimals = 2) {
  return `$${value.toFixed(decimals)}`;
}

export function formatTokens(value: number) {
  return Math.round(value).toLocaleString();
}

export function formatCompactTokens(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(Math.round(value));
}

export function formatDateTime(timestamp?: number) {
  if (!timestamp) {
    return "n/a";
  }
  return new Date(timestamp).toLocaleString();
}

export function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs <= 0) {
    return "-";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function formatIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function parseYmdDate(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    return null;
  }
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function formatDayLabel(dateStr: string) {
  const date = parseYmdDate(dateStr);
  if (!date) {
    return dateStr;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatFullDate(dateStr: string) {
  const date = parseYmdDate(dateStr);
  if (!date) {
    return dateStr;
  }
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatHourLabel(hour: number) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric" });
}

export function charsToTokens(chars: number) {
  return Math.round(chars / CHARS_PER_TOKEN);
}

export function pct(part: number, total: number) {
  if (!total || total <= 0) {
    return 0;
  }
  return (part / total) * 100;
}

export function downloadTextFile(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function toCsvRow(values: Array<string | number | undefined | null>) {
  return values
    .map((value) => {
      if (value == null) {
        return "";
      }
      return csvEscape(String(value));
    })
    .join(",");
}

export function buildSessionsCsv(sessions: SessionUsageEntry[]) {
  const rows = [
    toCsvRow([
      "key",
      "label",
      "agentId",
      "channel",
      "provider",
      "model",
      "updatedAt",
      "durationMs",
      "messages",
      "errors",
      "toolCalls",
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "totalTokens",
      "totalCost",
    ]),
  ];

  for (const session of sessions) {
    const usage = session.usage;
    rows.push(
      toCsvRow([
        session.key,
        session.label ?? "",
        session.agentId ?? "",
        session.channel ?? "",
        session.modelProvider ?? session.providerOverride ?? "",
        session.model ?? session.modelOverride ?? "",
        session.updatedAt ? new Date(session.updatedAt).toISOString() : "",
        usage?.durationMs ?? "",
        usage?.messageCounts?.total ?? "",
        usage?.messageCounts?.errors ?? "",
        usage?.toolUsage?.totalCalls ?? "",
        usage?.input ?? "",
        usage?.output ?? "",
        usage?.cacheRead ?? "",
        usage?.cacheWrite ?? "",
        usage?.totalTokens ?? "",
        usage?.totalCost ?? "",
      ]),
    );
  }

  return rows.join("\n");
}

export function buildDailyCsv(daily: Array<UsageTotals & { date: string }>) {
  const rows = [
    toCsvRow([
      "date",
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "totalTokens",
      "inputCost",
      "outputCost",
      "cacheReadCost",
      "cacheWriteCost",
      "totalCost",
    ]),
  ];

  for (const day of daily) {
    rows.push(
      toCsvRow([
        day.date,
        day.input,
        day.output,
        day.cacheRead,
        day.cacheWrite,
        day.totalTokens,
        day.inputCost,
        day.outputCost,
        day.cacheReadCost,
        day.cacheWriteCost,
        day.totalCost,
      ]),
    );
  }
  return rows.join("\n");
}

export const normalizeQueryText = (value: string) => value.trim().toLowerCase();

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function parseQueryNumber(value: string): number | null {
  let raw = value.trim().toLowerCase();
  if (!raw) {
    return null;
  }
  if (raw.startsWith("$")) {
    raw = raw.slice(1);
  }
  let multiplier = 1;
  if (raw.endsWith("k")) {
    multiplier = 1_000;
    raw = raw.slice(0, -1);
  } else if (raw.endsWith("m")) {
    multiplier = 1_000_000;
    raw = raw.slice(0, -1);
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed * multiplier : null;
}

export function extractQueryTerms(query: string): UsageQueryTerm[] {
  const rawTokens = query.match(/"[^"]+"|\S+/g) ?? [];
  return rawTokens.map((token) => {
    const cleaned = token.replace(/^"|"$/g, "");
    const idx = cleaned.indexOf(":");
    if (idx > 0) {
      return {
        key: cleaned.slice(0, idx),
        value: cleaned.slice(idx + 1),
        raw: cleaned,
      };
    }
    return { value: cleaned, raw: cleaned };
  });
}

function getSessionText(session: UsageSessionQueryTarget) {
  const items: Array<string | undefined> = [session.label, session.key, session.sessionId];
  return items.filter((item): item is string => Boolean(item)).map((item) => item.toLowerCase());
}

function getSessionProviders(session: UsageSessionQueryTarget) {
  const providers = new Set<string>();
  if (session.modelProvider) {
    providers.add(session.modelProvider.toLowerCase());
  }
  if (session.providerOverride) {
    providers.add(session.providerOverride.toLowerCase());
  }
  if (session.origin?.provider) {
    providers.add(session.origin.provider.toLowerCase());
  }
  for (const entry of session.usage?.modelUsage ?? []) {
    if (entry.provider) {
      providers.add(entry.provider.toLowerCase());
    }
  }
  return Array.from(providers);
}

function getSessionModels(session: UsageSessionQueryTarget) {
  const models = new Set<string>();
  if (session.model) {
    models.add(session.model.toLowerCase());
  }
  for (const entry of session.usage?.modelUsage ?? []) {
    if (entry.model) {
      models.add(entry.model.toLowerCase());
    }
  }
  return Array.from(models);
}

function getSessionTools(session: UsageSessionQueryTarget) {
  return (session.usage?.toolUsage?.tools ?? []).map((tool) => tool.name.toLowerCase());
}

export function matchesUsageQuery(session: UsageSessionQueryTarget, term: UsageQueryTerm) {
  const value = normalizeQueryText(term.value ?? "");
  if (!value) {
    return true;
  }
  if (!term.key) {
    return getSessionText(session).some((text) => text.includes(value));
  }
  const key = normalizeQueryText(term.key);
  switch (key) {
    case "agent":
      return session.agentId?.toLowerCase().includes(value) ?? false;
    case "channel":
      return session.channel?.toLowerCase().includes(value) ?? false;
    case "chat":
      return session.chatType?.toLowerCase().includes(value) ?? false;
    case "provider":
      return getSessionProviders(session).some((provider) => provider.includes(value));
    case "model":
      return getSessionModels(session).some((model) => model.includes(value));
    case "tool":
      return getSessionTools(session).some((tool) => tool.includes(value));
    case "label":
      return session.label?.toLowerCase().includes(value) ?? false;
    case "key":
    case "session":
    case "id":
      if (value.includes("*") || value.includes("?")) {
        const regex = globToRegex(value);
        return regex.test(session.key) || (session.sessionId ? regex.test(session.sessionId) : false);
      }
      return (
        session.key.toLowerCase().includes(value) ||
        (session.sessionId?.toLowerCase().includes(value) ?? false)
      );
    case "has":
      switch (value) {
        case "tools":
          return (session.usage?.toolUsage?.totalCalls ?? 0) > 0;
        case "errors":
          return (session.usage?.messageCounts?.errors ?? 0) > 0;
        case "context":
          return Boolean(session.contextWeight);
        case "usage":
          return Boolean(session.usage);
        case "model":
          return getSessionModels(session).length > 0;
        case "provider":
          return getSessionProviders(session).length > 0;
        default:
          return true;
      }
    case "mintokens": {
      const threshold = parseQueryNumber(value);
      return threshold == null ? true : (session.usage?.totalTokens ?? 0) >= threshold;
    }
    case "maxtokens": {
      const threshold = parseQueryNumber(value);
      return threshold == null ? true : (session.usage?.totalTokens ?? 0) <= threshold;
    }
    case "mincost": {
      const threshold = parseQueryNumber(value);
      return threshold == null ? true : (session.usage?.totalCost ?? 0) >= threshold;
    }
    case "maxcost": {
      const threshold = parseQueryNumber(value);
      return threshold == null ? true : (session.usage?.totalCost ?? 0) <= threshold;
    }
    case "minmessages": {
      const threshold = parseQueryNumber(value);
      return threshold == null ? true : (session.usage?.messageCounts?.total ?? 0) >= threshold;
    }
    case "maxmessages": {
      const threshold = parseQueryNumber(value);
      return threshold == null ? true : (session.usage?.messageCounts?.total ?? 0) <= threshold;
    }
    default:
      return true;
  }
}

export function filterSessionsByQuery<TSession extends UsageSessionQueryTarget>(
  sessions: TSession[],
  query: string,
): UsageQueryResult<TSession> {
  const terms = extractQueryTerms(query);
  if (terms.length === 0) {
    return { sessions, warnings: [] };
  }
  const warnings: string[] = [];
  for (const term of terms) {
    if (!term.key) {
      continue;
    }
    const normalizedKey = normalizeQueryText(term.key);
    if (!QUERY_KEYS.has(normalizedKey)) {
      warnings.push(`Unknown filter: ${term.key}`);
      continue;
    }
    if (term.value === "") {
      warnings.push(`Missing value for ${term.key}`);
    }
    if (normalizedKey === "has") {
      const allowed = new Set(["tools", "errors", "context", "usage", "model", "provider"]);
      if (term.value && !allowed.has(normalizeQueryText(term.value))) {
        warnings.push(`Unknown has:${term.value}`);
      }
    }
    if (
      ["mintokens", "maxtokens", "mincost", "maxcost", "minmessages", "maxmessages"].includes(
        normalizedKey,
      ) &&
      term.value &&
      parseQueryNumber(term.value) === null
    ) {
      warnings.push(`Invalid number for ${term.key}`);
    }
  }

  const filtered = sessions.filter((session) =>
    terms.every((term) => matchesUsageQuery(session, term)),
  );
  return { sessions: filtered, warnings };
}

export function buildQuerySuggestions(
  query: string,
  sessions: SessionUsageEntry[],
  aggregates?: UsageAggregates | null,
) {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const tokens = trimmed.length ? trimmed.split(/\s+/) : [];
  const lastToken = tokens.length ? tokens[tokens.length - 1] : "";
  const [rawKey, rawValue] = lastToken.includes(":")
    ? [lastToken.slice(0, lastToken.indexOf(":")), lastToken.slice(lastToken.indexOf(":") + 1)]
    : ["", ""];

  const key = rawKey.toLowerCase();
  const value = rawValue.toLowerCase();

  const unique = (items: Array<string | undefined>) => {
    const set = new Set<string>();
    for (const item of items) {
      if (item) {
        set.add(item);
      }
    }
    return Array.from(set);
  };

  const agents = unique(sessions.map((session) => session.agentId)).slice(0, 6);
  const channels = unique(sessions.map((session) => session.channel)).slice(0, 6);
  const providers = unique([
    ...sessions.map((session) => session.modelProvider),
    ...sessions.map((session) => session.providerOverride),
    ...(aggregates?.byProvider.map((entry) => entry.provider) ?? []),
  ]).slice(0, 6);
  const models = unique([
    ...sessions.map((session) => session.model),
    ...(aggregates?.byModel.map((entry) => entry.model) ?? []),
  ]).slice(0, 6);
  const tools = unique(aggregates?.tools.tools.map((tool) => tool.name) ?? []).slice(0, 6);

  if (!key) {
    return [
      { label: "agent:", value: "agent:" },
      { label: "channel:", value: "channel:" },
      { label: "provider:", value: "provider:" },
      { label: "model:", value: "model:" },
      { label: "tool:", value: "tool:" },
      { label: "has:errors", value: "has:errors" },
      { label: "has:tools", value: "has:tools" },
      { label: "minTokens:", value: "minTokens:" },
      { label: "maxCost:", value: "maxCost:" },
    ];
  }

  const suggestions: Array<{ label: string; value: string }> = [];
  const addValues = (prefix: string, values: string[]) => {
    for (const entry of values) {
      if (!value || entry.toLowerCase().includes(value)) {
        suggestions.push({ label: `${prefix}:${entry}`, value: `${prefix}:${entry}` });
      }
    }
  };

  switch (key) {
    case "agent":
      addValues("agent", agents);
      break;
    case "channel":
      addValues("channel", channels);
      break;
    case "provider":
      addValues("provider", providers);
      break;
    case "model":
      addValues("model", models);
      break;
    case "tool":
      addValues("tool", tools);
      break;
    case "has":
      for (const entry of ["errors", "tools", "context", "usage", "model", "provider"]) {
        if (!value || entry.includes(value)) {
          suggestions.push({ label: `has:${entry}`, value: `has:${entry}` });
        }
      }
      break;
    default:
      break;
  }
  return suggestions;
}

export function applySuggestionToQuery(query: string, suggestion: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return `${suggestion} `;
  }
  const tokens = trimmed.split(/\s+/);
  tokens[tokens.length - 1] = suggestion;
  return `${tokens.join(" ")} `;
}

export function addQueryToken(query: string, token: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return `${token} `;
  }
  const tokens = trimmed.split(/\s+/);
  const last = tokens[tokens.length - 1] ?? "";
  const tokenKey = token.includes(":") ? token.split(":")[0] : null;
  const lastKey = last.includes(":") ? last.split(":")[0] : null;
  if (last.endsWith(":") && tokenKey && lastKey === tokenKey) {
    tokens[tokens.length - 1] = token;
    return `${tokens.join(" ")} `;
  }
  if (tokens.includes(token)) {
    return `${tokens.join(" ")} `;
  }
  return `${tokens.join(" ")} ${token} `;
}

export function removeQueryToken(query: string, token: string) {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const next = tokens.filter((entry) => entry !== token);
  return next.length ? `${next.join(" ")} ` : "";
}

export function setQueryTokensForKey(query: string, key: string, values: string[]) {
  const normalizedKey = normalizeQueryText(key);
  const tokens = extractQueryTerms(query)
    .filter((term) => normalizeQueryText(term.key ?? "") !== normalizedKey)
    .map((term) => term.raw);
  for (const value of values) {
    tokens.push(`${key}:${value}`);
  }
  return tokens.length ? `${tokens.join(" ")} ` : "";
}

export function parseToolSummary(content: string) {
  const lines = content.split("\n");
  const toolCounts = new Map<string, number>();
  const nonToolLines: string[] = [];
  for (const line of lines) {
    const match = /^\[Tool:\s*([^\]]+)\]/.exec(line.trim());
    if (match) {
      const name = match[1];
      toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
      continue;
    }
    if (line.trim().startsWith("[Tool Result]")) {
      continue;
    }
    nonToolLines.push(line);
  }
  const tools = Array.from(toolCounts.entries()).sort((left, right) => right[1] - left[1]);
  const totalCalls = tools.reduce((sum, [, count]) => sum + count, 0);
  return {
    tools,
    summary:
      tools.length > 0
        ? `Tools: ${tools.map(([name, count]) => `${name}x${count}`).join(", ")} (${totalCalls} calls)`
        : "",
    cleanContent: nonToolLines.join("\n").trim(),
  };
}

function mergeUsageLatency(totals: LatencyTotalsLike, latency?: UsageLatencyStats) {
  if (!latency || latency.count <= 0) {
    return;
  }
  totals.count += latency.count;
  totals.sum += latency.avgMs * latency.count;
  totals.min = Math.min(totals.min, latency.minMs);
  totals.max = Math.max(totals.max, latency.maxMs);
  totals.p95Max = Math.max(totals.p95Max, latency.p95Ms);
}

function mergeUsageDailyLatency(
  dailyLatencyMap: Map<string, { date: string; count: number; sum: number; min: number; max: number; p95Max: number }>,
  dailyLatency?: UsageDailyLatency[] | null,
) {
  for (const day of dailyLatency ?? []) {
    const existing = dailyLatencyMap.get(day.date) ?? {
      date: day.date,
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: 0,
      p95Max: 0,
    };
    existing.count += day.count;
    existing.sum += day.avgMs * day.count;
    existing.min = Math.min(existing.min, day.minMs);
    existing.max = Math.max(existing.max, day.maxMs);
    existing.p95Max = Math.max(existing.p95Max, day.p95Ms);
    dailyLatencyMap.set(day.date, existing);
  }
}

export function buildAggregatesFromSessions(
  sessions: SessionUsageEntry[],
  fallback?: UsageAggregates | null,
): UsageAggregates {
  if (sessions.length === 0) {
    return (
      fallback ?? {
        messages: { total: 0, user: 0, assistant: 0, toolCalls: 0, toolResults: 0, errors: 0 },
        tools: { totalCalls: 0, uniqueTools: 0, tools: [] },
        byModel: [],
        byProvider: [],
        byAgent: [],
        byChannel: [],
        daily: [],
      }
    );
  }

  const messages: MessageCounts = {
    total: 0,
    user: 0,
    assistant: 0,
    toolCalls: 0,
    toolResults: 0,
    errors: 0,
  };
  const toolMap = new Map<string, number>();
  const modelMap = new Map<string, UsageModelAggregateEntry>();
  const providerMap = new Map<string, UsageModelAggregateEntry>();
  const agentMap = new Map<string, UsageTotals>();
  const channelMap = new Map<string, UsageTotals>();
  const dailyMap = new Map<string, UsageDailyAggregate>();
  const dailyLatencyMap = new Map<
    string,
    { date: string; count: number; sum: number; min: number; max: number; p95Max: number }
  >();
  const modelDailyMap = new Map<string, UsageDailyModelUsage>();
  const latencyTotals: LatencyTotalsLike = {
    count: 0,
    sum: 0,
    min: Number.POSITIVE_INFINITY,
    max: 0,
    p95Max: 0,
  };

  for (const session of sessions) {
    const usage = session.usage;
    if (!usage) {
      continue;
    }

    if (usage.messageCounts) {
      messages.total += usage.messageCounts.total;
      messages.user += usage.messageCounts.user;
      messages.assistant += usage.messageCounts.assistant;
      messages.toolCalls += usage.messageCounts.toolCalls;
      messages.toolResults += usage.messageCounts.toolResults;
      messages.errors += usage.messageCounts.errors;
    }

    if (usage.toolUsage) {
      for (const tool of usage.toolUsage.tools) {
        toolMap.set(tool.name, (toolMap.get(tool.name) ?? 0) + tool.count);
      }
    }

    if (usage.modelUsage) {
      for (const entry of usage.modelUsage) {
        const modelKey = `${entry.provider ?? "unknown"}::${entry.model ?? "unknown"}`;
        const modelExisting = modelMap.get(modelKey) ?? {
          provider: entry.provider,
          model: entry.model,
          count: 0,
          totals: createEmptyTotals(),
        };
        modelExisting.count = (modelExisting.count ?? 0) + entry.count;
        addUsageTotals(modelExisting.totals, entry.totals);
        modelMap.set(modelKey, modelExisting);

        const providerKey = entry.provider ?? "unknown";
        const providerExisting = providerMap.get(providerKey) ?? {
          provider: entry.provider,
          count: 0,
          totals: createEmptyTotals(),
        };
        providerExisting.count = (providerExisting.count ?? 0) + entry.count;
        addUsageTotals(providerExisting.totals, entry.totals);
        providerMap.set(providerKey, providerExisting);
      }
    }

    mergeUsageLatency(latencyTotals, usage.latency);

    if (session.agentId) {
      const totals = agentMap.get(session.agentId) ?? createEmptyTotals();
      addUsageTotals(totals, usage);
      agentMap.set(session.agentId, totals);
    }

    if (session.channel) {
      const totals = channelMap.get(session.channel) ?? createEmptyTotals();
      addUsageTotals(totals, usage);
      channelMap.set(session.channel, totals);
    }

    for (const day of usage.dailyBreakdown ?? []) {
      const daily = dailyMap.get(day.date) ?? {
        date: day.date,
        tokens: 0,
        cost: 0,
        messages: 0,
        toolCalls: 0,
        errors: 0,
      };
      daily.tokens += day.tokens;
      daily.cost += day.cost;
      dailyMap.set(day.date, daily);
    }

    for (const day of usage.dailyMessageCounts ?? []) {
      const daily = dailyMap.get(day.date) ?? {
        date: day.date,
        tokens: 0,
        cost: 0,
        messages: 0,
        toolCalls: 0,
        errors: 0,
      };
      daily.messages += day.total;
      daily.toolCalls += day.toolCalls;
      daily.errors += day.errors;
      dailyMap.set(day.date, daily);
    }

    mergeUsageDailyLatency(dailyLatencyMap, usage.dailyLatency);

    for (const day of usage.dailyModelUsage ?? []) {
      const key = `${day.date}::${day.provider ?? "unknown"}::${day.model ?? "unknown"}`;
      const existing = modelDailyMap.get(key) ?? {
        date: day.date,
        provider: day.provider,
        model: day.model,
        tokens: 0,
        cost: 0,
        count: 0,
      };
      existing.tokens += day.tokens;
      existing.cost += day.cost;
      existing.count += day.count;
      modelDailyMap.set(key, existing);
    }
  }

  return {
    messages,
    tools: {
      totalCalls: Array.from(toolMap.values()).reduce((sum, count) => sum + count, 0),
      uniqueTools: toolMap.size,
      tools: Array.from(toolMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count),
    },
    byModel: Array.from(modelMap.values()).sort(
      (left, right) =>
        right.totals.totalCost - left.totals.totalCost ||
        right.totals.totalTokens - left.totals.totalTokens,
    ),
    byProvider: Array.from(providerMap.values()).sort(
      (left, right) =>
        right.totals.totalCost - left.totals.totalCost ||
        right.totals.totalTokens - left.totals.totalTokens,
    ),
    byAgent: Array.from(agentMap.entries())
      .map(([agentId, totals]) => ({ agentId, totals }))
      .sort((left, right) => right.totals.totalCost - left.totals.totalCost),
    byChannel: Array.from(channelMap.entries())
      .map(([channel, totals]) => ({ channel, totals }))
      .sort((left, right) => right.totals.totalCost - left.totals.totalCost),
    latency:
      latencyTotals.count > 0
        ? {
            count: latencyTotals.count,
            avgMs: latencyTotals.sum / latencyTotals.count,
            minMs:
              latencyTotals.min === Number.POSITIVE_INFINITY ? 0 : latencyTotals.min,
            maxMs: latencyTotals.max,
            p95Ms: latencyTotals.p95Max,
          }
        : undefined,
    dailyLatency: Array.from(dailyLatencyMap.values())
      .map((entry) => ({
        date: entry.date,
        count: entry.count,
        avgMs: entry.count ? entry.sum / entry.count : 0,
        minMs: entry.min === Number.POSITIVE_INFINITY ? 0 : entry.min,
        maxMs: entry.max,
        p95Ms: entry.p95Max,
      }))
      .sort((left, right) => left.date.localeCompare(right.date)),
    modelDaily: Array.from(modelDailyMap.values()).sort(
      (left, right) => left.date.localeCompare(right.date) || right.cost - left.cost,
    ),
    daily: Array.from(dailyMap.values()).sort((left, right) => left.date.localeCompare(right.date)),
  };
}

export type UsageInsightStats = {
  durationSumMs: number;
  durationCount: number;
  avgDurationMs: number;
  throughputTokensPerMin?: number;
  throughputCostPerMin?: number;
  errorRate: number;
  peakErrorDay?: { date: string; errors: number; messages: number; rate: number };
};

export function buildUsageInsightStats(
  sessions: SessionUsageEntry[],
  totals: UsageTotals | null,
  aggregates: UsageAggregates,
): UsageInsightStats {
  let durationSumMs = 0;
  let durationCount = 0;
  for (const session of sessions) {
    const duration = session.usage?.durationMs ?? 0;
    if (duration > 0) {
      durationSumMs += duration;
      durationCount += 1;
    }
  }
  const avgDurationMs = durationCount ? durationSumMs / durationCount : 0;
  const throughputTokensPerMin =
    totals && durationSumMs > 0 ? totals.totalTokens / (durationSumMs / 60000) : undefined;
  const throughputCostPerMin =
    totals && durationSumMs > 0 ? totals.totalCost / (durationSumMs / 60000) : undefined;
  const errorRate = aggregates.messages.total
    ? aggregates.messages.errors / aggregates.messages.total
    : 0;
  const peakErrorDay = aggregates.daily
    .filter((day) => day.messages > 0 && day.errors > 0)
    .map((day) => ({
      date: day.date,
      errors: day.errors,
      messages: day.messages,
      rate: day.errors / day.messages,
    }))
    .sort((left, right) => right.rate - left.rate || right.errors - left.errors)[0];

  return {
    durationSumMs,
    durationCount,
    avgDurationMs,
    throughputTokensPerMin,
    throughputCostPerMin,
    errorRate,
    peakErrorDay,
  };
}

export function getZonedHour(date: Date, timeZone: TimeZoneMode) {
  return timeZone === "utc" ? date.getUTCHours() : date.getHours();
}

function getZonedWeekday(date: Date, timeZone: TimeZoneMode) {
  return timeZone === "utc" ? date.getUTCDay() : date.getDay();
}

export function setToHourEnd(date: Date, timeZone: TimeZoneMode) {
  const next = new Date(date);
  if (timeZone === "utc") {
    next.setUTCMinutes(59, 59, 999);
  } else {
    next.setMinutes(59, 59, 999);
  }
  return next;
}

export function sessionTouchesHours(session: SessionUsageEntry, hours: number[], timeZone: TimeZoneMode) {
  if (hours.length === 0) {
    return true;
  }
  const usage = session.usage;
  const start = usage?.firstActivity ?? session.updatedAt;
  const end = usage?.lastActivity ?? session.updatedAt;
  if (!start || !end) {
    return false;
  }
  const startMs = Math.min(start, end);
  const endMs = Math.max(start, end);
  let cursor = startMs;
  while (cursor <= endMs) {
    const date = new Date(cursor);
    const hour = getZonedHour(date, timeZone);
    if (hours.includes(hour)) {
      return true;
    }
    const nextHour = setToHourEnd(date, timeZone);
    const nextMs = Math.min(nextHour.getTime(), endMs);
    cursor = nextMs + 1;
  }
  return false;
}

export function buildPeakErrorHours(sessions: SessionUsageEntry[], timeZone: TimeZoneMode) {
  const hourErrors = Array.from({ length: 24 }, () => 0);
  const hourMessages = Array.from({ length: 24 }, () => 0);

  for (const session of sessions) {
    const usage = session.usage;
    if (!usage?.messageCounts || usage.messageCounts.total === 0) {
      continue;
    }
    const start = usage.firstActivity ?? session.updatedAt;
    const end = usage.lastActivity ?? session.updatedAt;
    if (!start || !end) {
      continue;
    }
    const startMs = Math.min(start, end);
    const endMs = Math.max(start, end);
    const durationMs = Math.max(endMs - startMs, 1);
    const totalMinutes = durationMs / 60000;
    let cursor = startMs;
    while (cursor < endMs) {
      const date = new Date(cursor);
      const hour = getZonedHour(date, timeZone);
      const nextHour = setToHourEnd(date, timeZone);
      const nextMs = Math.min(nextHour.getTime(), endMs);
      const minutes = Math.max((nextMs - cursor) / 60000, 0);
      const share = minutes / totalMinutes;
      hourErrors[hour] += usage.messageCounts.errors * share;
      hourMessages[hour] += usage.messageCounts.total * share;
      cursor = nextMs + 1;
    }
  }

  return hourMessages
    .map((messages, hour) => ({
      hour,
      rate: messages > 0 ? hourErrors[hour] / messages : 0,
      errors: hourErrors[hour],
      messages,
    }))
    .filter((entry) => entry.messages > 0 && entry.errors > 0)
    .sort((left, right) => right.rate - left.rate)
    .slice(0, 5)
    .map((entry) => ({
      label: formatHourLabel(entry.hour),
      value: `${(entry.rate * 100).toFixed(2)}%`,
      sub: `${Math.round(entry.errors)} errors - ${Math.round(entry.messages)} msgs`,
    }));
}

export type UsageMosaicStats = {
  hasData: boolean;
  totalTokens: number;
  hourTotals: number[];
  weekdayTotals: Array<{ label: string; tokens: number }>;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function buildUsageMosaicStats(
  sessions: SessionUsageEntry[],
  timeZone: TimeZoneMode,
): UsageMosaicStats {
  const hourTotals = Array.from({ length: 24 }, () => 0);
  const weekdayTotals = Array.from({ length: 7 }, () => 0);
  let totalTokens = 0;
  let hasData = false;

  for (const session of sessions) {
    const usage = session.usage;
    if (!usage || usage.totalTokens <= 0) {
      continue;
    }
    totalTokens += usage.totalTokens;
    const start = usage.firstActivity ?? session.updatedAt;
    const end = usage.lastActivity ?? session.updatedAt;
    if (!start || !end) {
      continue;
    }
    hasData = true;
    const startMs = Math.min(start, end);
    const endMs = Math.max(start, end);
    const durationMs = Math.max(endMs - startMs, 1);
    const totalMinutes = durationMs / 60000;
    let cursor = startMs;
    while (cursor < endMs) {
      const date = new Date(cursor);
      const hour = getZonedHour(date, timeZone);
      const weekday = getZonedWeekday(date, timeZone);
      const nextHour = setToHourEnd(date, timeZone);
      const nextMs = Math.min(nextHour.getTime(), endMs);
      const minutes = Math.max((nextMs - cursor) / 60000, 0);
      const share = minutes / totalMinutes;
      hourTotals[hour] += usage.totalTokens * share;
      weekdayTotals[weekday] += usage.totalTokens * share;
      cursor = nextMs + 1;
    }
  }

  return {
    hasData,
    totalTokens,
    hourTotals,
    weekdayTotals: WEEKDAYS.map((label, index) => ({
      label,
      tokens: weekdayTotals[index],
    })),
  };
}

export function computeSessionValue(
  session: SessionUsageEntry,
  mode: "tokens" | "cost",
  selectedDays: string[] = [],
) {
  const usage = session.usage;
  if (!usage) {
    return 0;
  }
  if (selectedDays.length > 0 && usage.dailyBreakdown?.length) {
    const filteredDays = usage.dailyBreakdown.filter((day) => selectedDays.includes(day.date));
    return mode === "tokens"
      ? filteredDays.reduce((sum, day) => sum + day.tokens, 0)
      : filteredDays.reduce((sum, day) => sum + day.cost, 0);
  }
  return mode === "tokens" ? usage.totalTokens : usage.totalCost;
}

export function filterLogsByRange(
  logs: SessionLogEntry[],
  rangeStart: number | null,
  rangeEnd: number | null,
) {
  if (rangeStart == null || rangeEnd == null) {
    return logs;
  }
  const lo = Math.min(rangeStart, rangeEnd);
  const hi = Math.max(rangeStart, rangeEnd);
  return logs.filter((log) => {
    const ts = log.timestamp < 1e12 ? log.timestamp * 1000 : log.timestamp;
    return ts >= lo && ts <= hi;
  });
}

export function filterSessionLogs(
  logs: SessionLogEntry[],
  filters: {
    roles: SessionLogRole[];
    tools: string[];
    hasTools: boolean;
    query: string;
  },
) {
  const toolNeedle = new Set(filters.tools.map((tool) => tool.toLowerCase()));
  const queryNeedle = filters.query.trim().toLowerCase();

  return logs.filter((log) => {
    if (filters.roles.length > 0 && !filters.roles.includes(log.role)) {
      return false;
    }
    const parsed = parseToolSummary(log.content);
    const toolNames = parsed.tools.map(([name]) => name.toLowerCase());
    if (filters.hasTools && toolNames.length === 0) {
      return false;
    }
    if (toolNeedle.size > 0 && !toolNames.some((tool) => toolNeedle.has(tool))) {
      return false;
    }
    if (queryNeedle) {
      const haystack = `${parsed.cleanContent} ${parsed.summary}`.toLowerCase();
      if (!haystack.includes(queryNeedle)) {
        return false;
      }
    }
    return true;
  });
}

export function computeFilteredUsageFromTimeSeries(
  baseUsage: SessionUsage,
  points: SessionUsageTimePoint[],
  startIndex: number | null,
  endIndex: number | null,
): SessionUsage | undefined {
  if (startIndex == null || endIndex == null || points.length === 0) {
    return undefined;
  }
  const lo = Math.max(0, Math.min(startIndex, endIndex));
  const hi = Math.min(points.length - 1, Math.max(startIndex, endIndex));
  const filtered = points.slice(lo, hi + 1);
  if (filtered.length === 0) {
    return undefined;
  }

  let totalTokens = 0;
  let totalCost = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;

  for (const point of filtered) {
    totalTokens += point.totalTokens;
    totalCost += point.cost;
    input += point.input;
    output += point.output;
    cacheRead += point.cacheRead;
    cacheWrite += point.cacheWrite;
    if (point.input > 0) {
      userMessages += 1;
    }
    if (point.output > 0) {
      assistantMessages += 1;
    }
  }

  return {
    ...baseUsage,
    totalTokens,
    totalCost,
    input,
    output,
    cacheRead,
    cacheWrite,
    durationMs: filtered[filtered.length - 1].timestamp - filtered[0].timestamp,
    firstActivity: filtered[0].timestamp,
    lastActivity: filtered[filtered.length - 1].timestamp,
    messageCounts: {
      total: filtered.length,
      user: userMessages,
      assistant: assistantMessages,
      toolCalls: 0,
      toolResults: 0,
      errors: 0,
    },
  };
}

export function toggleListItem<T>(items: T[], value: T) {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}
