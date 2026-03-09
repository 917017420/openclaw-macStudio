import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, BarChart3, Coins, Database, MessageSquare, RefreshCw } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";
import { gateway } from "@/lib/gateway";
import { formatRelativeTime, truncate } from "@/lib/utils";

type TimeZoneMode = "local" | "utc";

type UsageTotals = {
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

type MessageCounts = {
  total: number;
  user: number;
  assistant: number;
  toolCalls: number;
  toolResults: number;
  errors: number;
};

type ToolUsage = {
  totalCalls: number;
  uniqueTools: number;
  tools: Array<{ name: string; count: number }>;
};

type UsageAggregateEntry = {
  id: string;
  label: string;
  sublabel?: string;
  totals: UsageTotals;
  count?: number;
};

type SessionUsageEntry = {
  key: string;
  label?: string;
  sessionId?: string;
  updatedAt?: number;
  agentId?: string;
  channel?: string;
  model?: string;
  modelProvider?: string;
  usage: (UsageTotals & {
    durationMs?: number;
    messageCounts?: MessageCounts;
    toolUsage?: ToolUsage;
  }) | null;
};

type SessionsUsageResult = {
  updatedAt: number;
  startDate: string;
  endDate: string;
  sessions: SessionUsageEntry[];
  totals: UsageTotals;
  aggregates: {
    messages: MessageCounts;
    tools: ToolUsage;
    byModel: UsageAggregateEntry[];
    byProvider: UsageAggregateEntry[];
    byAgent: UsageAggregateEntry[];
    byChannel: UsageAggregateEntry[];
    daily: Array<{ date: string; tokens: number; cost: number; messages: number; toolCalls: number; errors: number }>;
  };
};

type CostUsageSummary = {
  updatedAt: number;
  days: number;
  daily: Array<UsageTotals & { date: string }>;
  totals: UsageTotals;
};

type SessionUsageTimePoint = {
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

type SessionUsageTimeSeries = {
  sessionId?: string;
  points: SessionUsageTimePoint[];
};

type SessionLogEntry = {
  timestamp: number;
  role: "user" | "assistant" | "tool" | "toolResult";
  content: string;
  tokens?: number;
  cost?: number;
};

type UsageSnapshot = {
  sessions: SessionsUsageResult;
  cost: CostUsageSummary | null;
  loadedAt: number;
};

type GroupCardProps = {
  title: string;
  subtitle: string;
  entries: UsageAggregateEntry[];
  empty: string;
};

const USAGE_QUERY_KEY = "usage-dashboard";
const DEFAULT_DAYS = 7;
const SESSION_LIMIT = 200;

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

function defaultTotals(): UsageTotals {
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

function normalizeTotals(value: unknown): UsageTotals {
  const record = asRecord(value);
  const fallback = defaultTotals();
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
      if (!name) return [];
      return [{ name, count: readNumber(item, "count") ?? 0 }];
    })
    : [];

  return {
    totalCalls: readNumber(record, "totalCalls") ?? 0,
    uniqueTools: readNumber(record, "uniqueTools") ?? tools.length,
    tools,
  };
}

function normalizeAggregateEntries(
  value: unknown,
  config: { idKey?: string; labelKey: string; sublabelKey?: string },
): UsageAggregateEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const totals = normalizeTotals(record?.totals);
    const id = readString(record, config.idKey ?? config.labelKey) ?? readString(record, config.labelKey);
    const label = readString(record, config.labelKey) ?? id;

    if (!id || !label) {
      return [];
    }

    return [{
      id,
      label,
      sublabel: config.sublabelKey ? readString(record, config.sublabelKey) : undefined,
      count: readNumber(record, "count"),
      totals,
    }];
  });
}

function normalizeSessionsUsageResult(value: unknown, startDate: string, endDate: string): SessionsUsageResult {
  const record = asRecord(value);
  const sessions = Array.isArray(record?.sessions)
    ? record.sessions.flatMap((entry) => {
      const item = asRecord(entry);
      const key = readString(item, "key");
      if (!key) return [];
      const usageRecord = asRecord(item?.usage);
      const usage = usageRecord
        ? {
            ...normalizeTotals(usageRecord),
            durationMs: readNumber(usageRecord, "durationMs"),
            messageCounts: normalizeMessageCounts(usageRecord.messageCounts),
            toolUsage: normalizeToolUsage(usageRecord.toolUsage),
          }
        : null;

      return [{
        key,
        label: readString(item, "label"),
        sessionId: readString(item, "sessionId"),
        updatedAt: readNumber(item, "updatedAt"),
        agentId: readString(item, "agentId"),
        channel: readString(item, "channel"),
        model: readString(item, "model"),
        modelProvider: readString(item, "modelProvider"),
        usage,
      }];
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
      byModel: normalizeAggregateEntries(aggregatesRecord?.byModel, { idKey: "model", labelKey: "model", sublabelKey: "provider" }),
      byProvider: normalizeAggregateEntries(aggregatesRecord?.byProvider, { idKey: "provider", labelKey: "provider" }),
      byAgent: normalizeAggregateEntries(aggregatesRecord?.byAgent, { idKey: "agentId", labelKey: "agentId" }),
      byChannel: normalizeAggregateEntries(aggregatesRecord?.byChannel, { idKey: "channel", labelKey: "channel" }),
      daily: Array.isArray(aggregatesRecord?.daily)
        ? aggregatesRecord.daily.flatMap((entry) => {
          const item = asRecord(entry);
          const date = readString(item, "date");
          if (!date) return [];
          return [{
            date,
            tokens: readNumber(item, "tokens") ?? 0,
            cost: readNumber(item, "cost") ?? 0,
            messages: readNumber(item, "messages") ?? 0,
            toolCalls: readNumber(item, "toolCalls") ?? 0,
            errors: readNumber(item, "errors") ?? 0,
          }];
        })
        : [],
    },
  };
}

function normalizeCostUsageSummary(value: unknown): CostUsageSummary | null {
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
        if (!date) return [];
        return [{ date, ...normalizeTotals(item) }];
      })
      : [],
    totals: normalizeTotals(record.totals),
  };
}

function normalizeTimeSeries(value: unknown): SessionUsageTimeSeries {
  const record = asRecord(value);
  return {
    sessionId: readString(record, "sessionId"),
    points: Array.isArray(record?.points)
      ? record.points.flatMap((entry) => {
        const item = asRecord(entry);
        const timestamp = readNumber(item, "timestamp");
        if (timestamp == null) return [];
        return [{
          timestamp,
          input: readNumber(item, "input") ?? 0,
          output: readNumber(item, "output") ?? 0,
          cacheRead: readNumber(item, "cacheRead") ?? 0,
          cacheWrite: readNumber(item, "cacheWrite") ?? 0,
          totalTokens: readNumber(item, "totalTokens") ?? 0,
          cost: readNumber(item, "cost") ?? 0,
          cumulativeTokens: readNumber(item, "cumulativeTokens") ?? 0,
          cumulativeCost: readNumber(item, "cumulativeCost") ?? 0,
        }];
      })
      : [],
  };
}

function normalizeLogs(value: unknown): SessionLogEntry[] {
  const record = asRecord(value);
  if (!Array.isArray(record?.logs)) {
    return [];
  }

  return record.logs.flatMap((entry) => {
    const item = asRecord(entry);
    const timestamp = readNumber(item, "timestamp");
    const role = readString(item, "role");
    const content = readString(item, "content");
    if (timestamp == null || !content || !role) {
      return [];
    }
    if (role !== "user" && role !== "assistant" && role !== "tool" && role !== "toolResult") {
      return [];
    }
    return [{
      timestamp,
      role,
      content,
      tokens: readNumber(item, "tokens"),
      cost: readNumber(item, "cost"),
    }];
  });
}

function formatUtcOffset(timezoneOffsetMinutes: number): string {
  const offsetFromUtcMinutes = -timezoneOffsetMinutes;
  const sign = offsetFromUtcMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetFromUtcMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  return minutes === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${minutes.toString().padStart(2, "0")}`;
}

function buildDateInterpretationParams(timeZone: TimeZoneMode, includeDateInterpretation: boolean) {
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

function isLegacyDateInterpretationUnsupportedError(err: unknown): boolean {
  const message = String(err);
  return /invalid sessions\.usage params/i.test(message)
    && (/unexpected property ['"]mode['"]/i.test(message) || /unexpected property ['"]utcoffset['"]/i.test(message));
}

function toDateInputValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function createDefaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (DEFAULT_DAYS - 1));
  return {
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(end),
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 4,
  }).format(value);
}

function formatTokens(value: number) {
  return value.toLocaleString();
}

function formatDateTime(timestamp?: number) {
  if (timestamp == null) return "n/a";
  return new Date(timestamp).toLocaleString();
}

function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs <= 0) return "n/a";
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

async function loadUsageSnapshot(params: {
  startDate: string;
  endDate: string;
  timeZone: TimeZoneMode;
}): Promise<UsageSnapshot> {
  const runRequests = async (includeDateInterpretation: boolean) => {
    const dateParams = buildDateInterpretationParams(params.timeZone, includeDateInterpretation);

    const [sessionsRaw, costRaw] = await Promise.all([
      gateway.request<unknown>("sessions.usage", {
        startDate: params.startDate,
        endDate: params.endDate,
        limit: SESSION_LIMIT,
        ...dateParams,
      }),
      gateway.request<unknown>("usage.cost", {
        startDate: params.startDate,
        endDate: params.endDate,
        ...dateParams,
      }),
    ]);

    return {
      sessions: normalizeSessionsUsageResult(sessionsRaw, params.startDate, params.endDate),
      cost: normalizeCostUsageSummary(costRaw),
      loadedAt: Date.now(),
    } satisfies UsageSnapshot;
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

function buildStatCards(snapshot: UsageSnapshot | undefined) {
  const usageTotals = snapshot?.sessions.totals ?? defaultTotals();
  const costTotals = snapshot?.cost?.totals ?? usageTotals;
  const messages = snapshot?.sessions.aggregates.messages ?? normalizeMessageCounts(null);
  const tools = snapshot?.sessions.aggregates.tools ?? normalizeToolUsage(null);
  return [
    { label: "Tokens", value: formatTokens(usageTotals.totalTokens), hint: `${formatTokens(usageTotals.input)} in · ${formatTokens(usageTotals.output)} out`, icon: <Database size={16} /> },
    { label: "Cost", value: formatCurrency(costTotals.totalCost), hint: `${costTotals.missingCostEntries} missing cost entries`, icon: <Coins size={16} /> },
    { label: "Messages", value: formatTokens(messages.total), hint: `${formatTokens(messages.errors)} errors · ${formatTokens(messages.toolCalls)} tool calls`, icon: <MessageSquare size={16} /> },
    { label: "Tools", value: formatTokens(tools.totalCalls), hint: `${formatTokens(tools.uniqueTools)} unique tools`, icon: <Activity size={16} /> },
  ];
}

function sortAggregateEntries(entries: UsageAggregateEntry[]) {
  return [...entries].sort((left, right) => right.totals.totalTokens - left.totals.totalTokens);
}

function GroupCard({ title, subtitle, entries, empty }: GroupCardProps) {
  return (
    <Card className="workspace-section">
      <div className="workspace-section__header compact">
        <div>
          <h4>{title}</h4>
          <p>{subtitle}</p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="workspace-empty-inline">{empty}</div>
      ) : (
        <div className="usage-ranking-list">
          {entries.slice(0, 6).map((entry) => (
            <div key={entry.id} className="usage-ranking-row">
              <div>
                <div className="usage-ranking-row__title">{entry.label}</div>
                {entry.sublabel && <div className="workspace-subcopy">{entry.sublabel}</div>}
              </div>
              <div className="usage-ranking-row__meta">
                <strong>{formatTokens(entry.totals.totalTokens)}</strong>
                <span>{formatCurrency(entry.totals.totalCost)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function UsagePage() {
  const isConnected = useConnectionStore((state) => state.state === "connected");
  const [dateRange, setDateRange] = useState(createDefaultDateRange);
  const [timeZone, setTimeZone] = useState<TimeZoneMode>("local");
  const [sessionFilter, setSessionFilter] = useState("");
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);

  const usageQuery = useQuery({
    queryKey: [USAGE_QUERY_KEY, dateRange.startDate, dateRange.endDate, timeZone],
    queryFn: () => loadUsageSnapshot({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      timeZone,
    }),
    enabled: isConnected,
  });

  const sessions = usageQuery.data?.sessions.sessions ?? [];

  const filteredSessions = useMemo(() => {
    const needle = sessionFilter.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((session) => {
      return [session.key, session.label, session.agentId, session.channel, session.model, session.modelProvider]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [sessionFilter, sessions]);

  useEffect(() => {
    if (filteredSessions.length === 0) {
      setSelectedSessionKey(null);
      return;
    }
    if (!selectedSessionKey || !filteredSessions.some((session) => session.key === selectedSessionKey)) {
      setSelectedSessionKey(filteredSessions[0].key);
    }
  }, [filteredSessions, selectedSessionKey]);

  const selectedSession = useMemo(
    () => filteredSessions.find((session) => session.key === selectedSessionKey) ?? null,
    [filteredSessions, selectedSessionKey],
  );

  const timeSeriesQuery = useQuery({
    queryKey: [USAGE_QUERY_KEY, "timeseries", selectedSession?.key],
    queryFn: async () => normalizeTimeSeries(await gateway.request<unknown>("sessions.usage.timeseries", { key: selectedSession?.key })),
    enabled: isConnected && Boolean(selectedSession?.key),
  });

  const logsQuery = useQuery({
    queryKey: [USAGE_QUERY_KEY, "logs", selectedSession?.key],
    queryFn: async () => normalizeLogs(await gateway.request<unknown>("sessions.usage.logs", { key: selectedSession?.key, limit: 250 })),
    enabled: isConnected && Boolean(selectedSession?.key),
  });

  const statCards = buildStatCards(usageQuery.data);
  const byProvider = sortAggregateEntries(usageQuery.data?.sessions.aggregates.byProvider ?? []);
  const byModel = sortAggregateEntries(usageQuery.data?.sessions.aggregates.byModel ?? []);
  const byAgent = sortAggregateEntries(usageQuery.data?.sessions.aggregates.byAgent ?? []);
  const byChannel = sortAggregateEntries(usageQuery.data?.sessions.aggregates.byChannel ?? []);
  const daily = usageQuery.data?.cost?.daily ?? [];
  const peakDay = [...daily].sort((left, right) => right.totalTokens - left.totalTokens)[0] ?? null;
  const recentPoint = timeSeriesQuery.data?.points.at(-1);

  if (!isConnected) {
    return (
      <div className="workspace-empty-state">
        <BarChart3 size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">Usage</h2>
        <p className="workspace-subtitle">Connect a gateway to inspect token, cost, and session usage analytics.</p>
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <div className="workspace-toolbar">
        <div>
          <h2 className="workspace-title">Usage</h2>
          <p className="workspace-subtitle">
            Gateway-backed session analytics powered by `sessions.usage`, `usage.cost`, and per-session detail RPCs.
          </p>
        </div>

        <div className="workspace-toolbar__actions">
          <label className="session-field usage-field usage-field--compact">
            <span>Start</span>
            <input
              type="date"
              value={dateRange.startDate}
              onChange={(event) => setDateRange((current) => ({ ...current, startDate: event.target.value }))}
            />
          </label>
          <label className="session-field usage-field usage-field--compact">
            <span>End</span>
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(event) => setDateRange((current) => ({ ...current, endDate: event.target.value }))}
            />
          </label>
          <label className="session-field usage-field usage-field--compact">
            <span>Timezone</span>
            <select value={timeZone} onChange={(event) => setTimeZone(event.target.value as TimeZoneMode)}>
              <option value="local">Local</option>
              <option value="utc">UTC</option>
            </select>
          </label>
          <Button variant="secondary" onClick={() => usageQuery.refetch()} loading={usageQuery.isFetching}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        </div>
      </div>

      {usageQuery.error && (
        <div className="workspace-alert workspace-alert--error">{String(usageQuery.error)}</div>
      )}

      <div className="stats-grid stats-grid--overview usage-overview-grid">
        {statCards.map((card) => (
          <Card key={card.label} className="stat-card stat-card--overview usage-stat-card">
            <div className="stat-card__icon">{card.icon}</div>
            <span className="stat-card__label">{card.label}</span>
            <span className="stat-card__value">{card.value}</span>
            <span className="workspace-subcopy">{card.hint}</span>
          </Card>
        ))}
      </div>

      <div className="workspace-grid usage-grid-layout">
        <div className="usage-grid-layout__main">
          <Card className="workspace-section">
            <div className="workspace-section__header">
              <div>
                <h3>Daily Rollup</h3>
                <p>
                  {usageQuery.data?.cost?.days ?? 0} day window · loaded {usageQuery.data ? formatRelativeTime(usageQuery.data.loadedAt) : "just now"}
                </p>
              </div>
              <span className="workspace-meta">Session list capped at {SESSION_LIMIT}</span>
            </div>

            {daily.length === 0 ? (
              <div className="workspace-empty-inline">No usage snapshots were returned for this date range.</div>
            ) : (
              <div className="usage-daily-list">
                {daily.slice(-10).reverse().map((entry) => (
                  <div key={entry.date} className="usage-daily-row">
                    <div>
                      <div className="usage-ranking-row__title">{entry.date}</div>
                      <div className="workspace-subcopy">{formatCurrency(entry.totalCost)}</div>
                    </div>
                    <div className="usage-ranking-row__meta">
                      <strong>{formatTokens(entry.totalTokens)}</strong>
                      <span>{formatTokens(entry.output)} out</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {peakDay && (
              <div className="workspace-alert compact">
                Peak day: <strong>{peakDay.date}</strong> · {formatTokens(peakDay.totalTokens)} tokens · {formatCurrency(peakDay.totalCost)}
              </div>
            )}
          </Card>

          <div className="usage-group-grid">
            <GroupCard title="Providers" subtitle="Spend and token concentration by provider." entries={byProvider} empty="No provider usage returned." />
            <GroupCard title="Models" subtitle="Top models across the selected date range." entries={byModel} empty="No model usage returned." />
            <GroupCard title="Agents" subtitle="Which agents consumed the most context." entries={byAgent} empty="No agent totals returned." />
            <GroupCard title="Channels" subtitle="Session traffic by source channel." entries={byChannel} empty="No channel attribution returned." />
          </div>
        </div>

        <div className="usage-grid-layout__sidebar">
          <Card className="workspace-section">
            <div className="workspace-section__header">
              <div>
                <h3>Sessions</h3>
                <p>{filteredSessions.length} matching session{filteredSessions.length === 1 ? "" : "s"}</p>
              </div>
            </div>

            <label className="session-search">
              <BarChart3 size={14} />
              <input
                value={sessionFilter}
                onChange={(event) => setSessionFilter(event.target.value)}
                placeholder="Search by key, label, channel, model"
              />
            </label>

            {usageQuery.isLoading ? (
              <div className="workspace-inline-status">Loading usage…</div>
            ) : filteredSessions.length === 0 ? (
              <div className="workspace-empty-inline">No sessions match the current filters.</div>
            ) : (
              <div className="session-browser-list usage-session-list">
                {filteredSessions.map((session) => (
                  <button
                    key={session.key}
                    type="button"
                    className={`session-browser-row ${session.key === selectedSession?.key ? "active" : ""}`}
                    onClick={() => setSelectedSessionKey(session.key)}
                  >
                    <div className="session-browser-row__top">
                      <div>
                        <div className="usage-ranking-row__title">{session.label?.trim() || truncate(session.key, 40)}</div>
                        <div className="workspace-subcopy mono">{truncate(session.key, 54)}</div>
                      </div>
                      <div className="usage-ranking-row__meta">
                        <strong>{formatTokens(session.usage?.totalTokens ?? 0)}</strong>
                        <span>{formatCurrency(session.usage?.totalCost ?? 0)}</span>
                      </div>
                    </div>

                    <div className="detail-pills">
                      {session.agentId && <span className="detail-pill">agent:{session.agentId}</span>}
                      {session.channel && <span className="detail-pill">channel:{session.channel}</span>}
                      {session.model && <span className="detail-pill">model:{session.model}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card className="workspace-section">
            <div className="workspace-section__header">
              <div>
                <h3>{selectedSession?.label?.trim() || "Session Detail"}</h3>
                <p>{selectedSession ? truncate(selectedSession.key, 56) : "Select a session to inspect it."}</p>
              </div>
            </div>

            {selectedSession ? (
              <>
                <div className="overview-kv-list compact">
                  <div className="overview-kv-row"><span>Updated</span><strong>{formatDateTime(selectedSession.updatedAt)}</strong></div>
                  <div className="overview-kv-row"><span>Tokens</span><strong>{formatTokens(selectedSession.usage?.totalTokens ?? 0)}</strong></div>
                  <div className="overview-kv-row"><span>Cost</span><strong>{formatCurrency(selectedSession.usage?.totalCost ?? 0)}</strong></div>
                  <div className="overview-kv-row"><span>Messages</span><strong>{formatTokens(selectedSession.usage?.messageCounts?.total ?? 0)}</strong></div>
                  <div className="overview-kv-row"><span>Duration</span><strong>{formatDuration(selectedSession.usage?.durationMs)}</strong></div>
                  <div className="overview-kv-row"><span>Tool Calls</span><strong>{formatTokens(selectedSession.usage?.toolUsage?.totalCalls ?? 0)}</strong></div>
                </div>

                <div className="workspace-section__header compact">
                  <div>
                    <h4>Time Series</h4>
                    <p>`sessions.usage.timeseries` for this session.</p>
                  </div>
                  <span className="workspace-meta">{timeSeriesQuery.isFetching ? "Refreshing" : `${timeSeriesQuery.data?.points.length ?? 0} points`}</span>
                </div>

                {timeSeriesQuery.isLoading ? (
                  <div className="workspace-inline-status">Loading time series…</div>
                ) : timeSeriesQuery.data && timeSeriesQuery.data.points.length > 0 ? (
                  <>
                    <div className="stats-grid">
                      <div className="stat-card stat-card--compact">
                        <span className="stat-card__label">First Point</span>
                        <span className="stat-card__value">{formatDateTime(timeSeriesQuery.data.points[0]?.timestamp)}</span>
                      </div>
                      <div className="stat-card stat-card--compact">
                        <span className="stat-card__label">Latest Totals</span>
                        <span className="stat-card__value">{recentPoint ? `${formatTokens(recentPoint.cumulativeTokens)} · ${formatCurrency(recentPoint.cumulativeCost)}` : "n/a"}</span>
                      </div>
                    </div>

                    <div className="usage-timeseries-list">
                      {timeSeriesQuery.data.points.slice(-8).reverse().map((point) => (
                        <div key={point.timestamp} className="usage-timeseries-row">
                          <div>
                            <div className="usage-ranking-row__title">{new Date(point.timestamp).toLocaleString()}</div>
                            <div className="workspace-subcopy">{formatCurrency(point.cost)} this turn</div>
                          </div>
                          <div className="usage-ranking-row__meta">
                            <strong>{formatTokens(point.totalTokens)}</strong>
                            <span>{formatTokens(point.cumulativeTokens)} cumulative</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="workspace-empty-inline">No time series data was available for this session.</div>
                )}

                <div className="workspace-section__header compact">
                  <div>
                    <h4>Session Logs</h4>
                    <p>`sessions.usage.logs` from the underlying transcript.</p>
                  </div>
                  <span className="workspace-meta">{logsQuery.data?.length ?? 0} rows</span>
                </div>

                {logsQuery.isLoading ? (
                  <div className="workspace-inline-status">Loading session logs…</div>
                ) : logsQuery.data && logsQuery.data.length > 0 ? (
                  <div className="usage-log-list">
                    {logsQuery.data.slice(-12).reverse().map((entry) => (
                      <div key={`${entry.timestamp}-${entry.role}-${entry.content.slice(0, 16)}`} className="usage-log-row">
                        <span className={`chip usage-log-chip usage-log-chip--${entry.role}`}>{entry.role}</span>
                        <div>
                          <div className="workspace-subcopy">{new Date(entry.timestamp).toLocaleString()}</div>
                          <div className="usage-log-row__content">{entry.content}</div>
                        </div>
                        <div className="usage-ranking-row__meta">
                          <strong>{entry.tokens != null ? formatTokens(entry.tokens) : "—"}</strong>
                          <span>{entry.cost != null ? formatCurrency(entry.cost) : ""}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="workspace-empty-inline">No session logs were returned.</div>
                )}
              </>
            ) : (
              <div className="workspace-empty-inline">Pick a session from the list to inspect details.</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
