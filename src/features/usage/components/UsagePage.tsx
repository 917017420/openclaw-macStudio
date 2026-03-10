import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, RefreshCw } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";
import { gateway } from "@/lib/gateway";
import { truncate } from "@/lib/utils";
import {
  addQueryToken,
  applySuggestionToQuery,
  buildAggregatesFromSessions,
  buildDateInterpretationParams,
  buildDailyCsv,
  buildPeakErrorHours,
  buildUsageMosaicStats,
  buildQuerySuggestions,
  buildSessionsCsv,
  buildUsageInsightStats,
  computeFilteredUsageFromTimeSeries,
  computeSessionValue,
  createDefaultDateRange,
  createEmptyTotals,
  downloadTextFile,
  extractQueryTerms,
  filterLogsByRange,
  filterSessionLogs,
  filterSessionsByQuery,
  formatCost,
  formatCurrency,
  formatDateTime,
  formatDayLabel,
  formatIsoDate,
  formatTokens,
  isLegacyDateInterpretationUnsupportedError,
  normalizeCostUsageSummary,
  normalizeLogs,
  normalizeQueryText,
  normalizeSessionsUsageResult,
  normalizeTimeSeries,
  parseToolSummary,
  removeQueryToken,
  sessionTouchesHours,
  setQueryTokensForKey,
  toggleListItem,
  type SessionLogRole,
  type SessionUsageEntry,
  type SessionUsageTimePoint,
  type TimeZoneMode,
  type UsageAggregates,
  type UsageTotals,
} from "./usage-utils";
import "./usage.css";

const USAGE_QUERY_KEY = "usage-dashboard";
const SESSION_LIMIT = 1000;

function formatDisplayValue(value: number, mode: "tokens" | "cost") {
  return mode === "tokens" ? formatTokens(value) : formatCost(value);
}

function useShiftToggle<T>(value: T, selected: T[], shiftKey: boolean) {
  if (shiftKey) {
    return toggleListItem(selected, value);
  }
  if (selected.length === 1 && selected[0] === value) {
    return [];
  }
  return [value];
}

async function loadUsageSnapshot(params: {
  startDate: string;
  endDate: string;
  timeZone: TimeZoneMode;
}) {
  const runRequests = async (includeDateInterpretation: boolean) => {
    const dateParams = buildDateInterpretationParams(params.timeZone, includeDateInterpretation);
    const [sessionsRaw, costRaw] = await Promise.all([
      gateway.request<unknown>("sessions.usage", {
        startDate: params.startDate,
        endDate: params.endDate,
        limit: SESSION_LIMIT,
        includeContextWeight: true,
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

function computeSessionTotals(sessions: SessionUsageEntry[]) {
  return sessions.reduce((acc, session) => {
    if (!session.usage) {
      return acc;
    }
    acc.input += session.usage.input;
    acc.output += session.usage.output;
    acc.cacheRead += session.usage.cacheRead;
    acc.cacheWrite += session.usage.cacheWrite;
    acc.totalTokens += session.usage.totalTokens;
    acc.totalCost += session.usage.totalCost;
    acc.inputCost += session.usage.inputCost;
    acc.outputCost += session.usage.outputCost;
    acc.cacheReadCost += session.usage.cacheReadCost;
    acc.cacheWriteCost += session.usage.cacheWriteCost;
    acc.missingCostEntries += session.usage.missingCostEntries;
    return acc;
  }, createEmptyTotals());
}

function computeDailyTotals(daily: Array<UsageTotals & { date: string }>, days: string[]) {
  return daily
    .filter((entry) => days.includes(entry.date))
    .reduce((acc, day) => {
      acc.input += day.input;
      acc.output += day.output;
      acc.cacheRead += day.cacheRead;
      acc.cacheWrite += day.cacheWrite;
      acc.totalTokens += day.totalTokens;
      acc.totalCost += day.totalCost;
      acc.inputCost += day.inputCost;
      acc.outputCost += day.outputCost;
      acc.cacheReadCost += day.cacheReadCost;
      acc.cacheWriteCost += day.cacheWriteCost;
      acc.missingCostEntries += day.missingCostEntries;
      return acc;
    }, createEmptyTotals());
}

function getBarHeight(value: number, max: number) {
  if (max <= 0) {
    return 0;
  }
  return Math.max((value / max) * 100, 2);
}

function buildCostBreakdown(totals: UsageTotals, mode: "tokens" | "cost") {
  const totalCost = totals.totalCost || 0;
  const totalTokens = totals.totalTokens || 1;
  const tokenPct = {
    output: (totals.output / totalTokens) * 100,
    input: (totals.input / totalTokens) * 100,
    cacheWrite: (totals.cacheWrite / totalTokens) * 100,
    cacheRead: (totals.cacheRead / totalTokens) * 100,
  };
  const costPct = {
    output: totalCost ? (totals.outputCost / totalCost) * 100 : 0,
    input: totalCost ? (totals.inputCost / totalCost) * 100 : 0,
    cacheWrite: totalCost ? (totals.cacheWriteCost / totalCost) * 100 : 0,
    cacheRead: totalCost ? (totals.cacheReadCost / totalCost) * 100 : 0,
  };
  return mode === "tokens"
    ? tokenPct
    : costPct;
}

function buildTimeSeriesView(points: SessionUsageTimePoint[], mode: "cumulative" | "per-turn") {
  return points.map((point) => ({
    timestamp: point.timestamp,
    totalTokens: mode === "cumulative" ? point.cumulativeTokens : point.totalTokens,
    totalCost: mode === "cumulative" ? point.cumulativeCost : point.cost,
    input: point.input,
    output: point.output,
    cacheRead: point.cacheRead,
    cacheWrite: point.cacheWrite,
  }));
}

export function UsagePage() {
  const isConnected = useConnectionStore((state) => state.state === "connected");
  const [dateRange, setDateRange] = useState(createDefaultDateRange);
  const [timeZone, setTimeZone] = useState<TimeZoneMode>("local");
  const [query, setQuery] = useState("");
  const [queryDraft, setQueryDraft] = useState("");
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [selectedHours, setSelectedHours] = useState<number[]>([]);
  const [chartMode, setChartMode] = useState<"tokens" | "cost">("tokens");
  const [dailyChartMode, setDailyChartMode] = useState<"total" | "by-type">("total");
  const [timeSeriesMode, setTimeSeriesMode] = useState<"cumulative" | "per-turn">("cumulative");
  const [timeSeriesBreakdownMode, setTimeSeriesBreakdownMode] = useState<
    "total" | "by-type"
  >("total");
  const [timeSeriesCursorStart, setTimeSeriesCursorStart] = useState<number | null>(null);
  const [timeSeriesCursorEnd, setTimeSeriesCursorEnd] = useState<number | null>(null);
  const [sessionSort, setSessionSort] = useState<
    "tokens" | "cost" | "recent" | "messages" | "errors"
  >("cost");
  const [sessionSortDir, setSessionSortDir] = useState<"asc" | "desc">("desc");
  const [recentSessions, setRecentSessions] = useState<string[]>([]);
  const [sessionsTab, setSessionsTab] = useState<"all" | "recent">("all");
  const [visibleColumns, setVisibleColumns] = useState<
    Array<"channel" | "agent" | "provider" | "model" | "messages" | "tools" | "errors" | "duration">
  >(["channel", "agent", "provider", "model", "messages", "tools", "errors", "duration"]);
  const [contextExpanded, setContextExpanded] = useState(false);
  const [headerPinned, setHeaderPinned] = useState(false);
  const [sessionLogsExpanded, setSessionLogsExpanded] = useState(false);
  const [logFilterRoles, setLogFilterRoles] = useState<SessionLogRole[]>([]);
  const [logFilterTools, setLogFilterTools] = useState<string[]>([]);
  const [logFilterHasTools, setLogFilterHasTools] = useState(false);
  const [logFilterQuery, setLogFilterQuery] = useState("");
  const columnOptions: Array<{ id: (typeof visibleColumns)[number]; label: string }> = [
    { id: "channel", label: "Channel" },
    { id: "agent", label: "Agent" },
    { id: "provider", label: "Provider" },
    { id: "model", label: "Model" },
    { id: "messages", label: "Messages" },
    { id: "tools", label: "Tools" },
    { id: "errors", label: "Errors" },
    { id: "duration", label: "Duration" },
  ];

  const usageQuery = useQuery({
    queryKey: [USAGE_QUERY_KEY, dateRange.startDate, dateRange.endDate, timeZone],
    queryFn: () =>
      loadUsageSnapshot({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        timeZone,
      }),
    enabled: isConnected,
  });

  const sessions = usageQuery.data?.sessions.sessions ?? [];
  const aggregates = usageQuery.data?.sessions.aggregates ?? null;
  const costDaily = usageQuery.data?.cost?.daily ?? [];
  const sessionsLimitReached = sessions.length >= SESSION_LIMIT;

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((left, right) => {
      const leftValue =
        chartMode === "tokens"
          ? left.usage?.totalTokens ?? 0
          : left.usage?.totalCost ?? 0;
      const rightValue =
        chartMode === "tokens"
          ? right.usage?.totalTokens ?? 0
          : right.usage?.totalCost ?? 0;
      return rightValue - leftValue;
    });
  }, [sessions, chartMode]);

  const dayFilteredSessions = useMemo(() => {
    if (selectedDays.length === 0) {
      return sortedSessions;
    }
    return sortedSessions.filter((session) => {
      if (session.usage?.activityDates?.length) {
        return session.usage.activityDates.some((date) => selectedDays.includes(date));
      }
      if (!session.updatedAt) {
        return false;
      }
      const date = new Date(session.updatedAt);
      const sessionDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate(),
      ).padStart(2, "0")}`;
      return selectedDays.includes(sessionDate);
    });
  }, [selectedDays, sortedSessions]);

  const hourFilteredSessions = useMemo(() => {
    if (selectedHours.length === 0) {
      return dayFilteredSessions;
    }
    return dayFilteredSessions.filter((session) =>
      sessionTouchesHours(session, selectedHours, timeZone),
    );
  }, [dayFilteredSessions, selectedHours, timeZone]);

  const queryResult = useMemo(
    () => filterSessionsByQuery(hourFilteredSessions, query),
    [hourFilteredSessions, query],
  );
  const filteredSessions = queryResult.sessions;
  const queryWarnings = queryResult.warnings;
  const querySuggestions = buildQuerySuggestions(queryDraft, sortedSessions, aggregates);
  const queryTerms = extractQueryTerms(query);

  const selectedValuesFor = (key: string) => {
    const normalized = normalizeQueryText(key);
    return queryTerms
      .filter((term) => normalizeQueryText(term.key ?? "") === normalized)
      .map((term) => term.value)
      .filter(Boolean);
  };

  const uniqueValues = (items: Array<string | undefined>) => {
    const set = new Set<string>();
    for (const item of items) {
      if (item) {
        set.add(item);
      }
    }
    return Array.from(set);
  };

  const agentOptions = uniqueValues(sortedSessions.map((session) => session.agentId)).slice(0, 12);
  const channelOptions = uniqueValues(sortedSessions.map((session) => session.channel)).slice(0, 12);
  const providerOptions = uniqueValues([
    ...sortedSessions.map((session) => session.modelProvider),
    ...sortedSessions.map((session) => session.providerOverride),
    ...(aggregates?.byProvider.map((entry) => entry.provider) ?? []),
  ]).slice(0, 12);
  const modelOptions = uniqueValues([
    ...sortedSessions.map((session) => session.model),
    ...(aggregates?.byModel.map((entry) => entry.model) ?? []),
  ]).slice(0, 12);
  const toolOptions = uniqueValues(aggregates?.tools.tools.map((tool) => tool.name) ?? []).slice(
    0,
    12,
  );

  const primarySelectedEntry =
    selectedSessions.length === 1
      ? sessions.find((session) => session.key === selectedSessions[0]) ??
        filteredSessions.find((session) => session.key === selectedSessions[0]) ??
        null
      : null;

  useEffect(() => {
    setTimeSeriesCursorStart(null);
    setTimeSeriesCursorEnd(null);
    setSessionLogsExpanded(false);
    setLogFilterRoles([]);
    setLogFilterTools([]);
    setLogFilterHasTools(false);
    setLogFilterQuery("");
  }, [primarySelectedEntry?.key]);

  const timeSeriesQuery = useQuery({
    queryKey: [USAGE_QUERY_KEY, "timeseries", primarySelectedEntry?.key],
    queryFn: async () =>
      normalizeTimeSeries(
        await gateway.request<unknown>("sessions.usage.timeseries", {
          key: primarySelectedEntry?.key,
        }),
      ),
    enabled: isConnected && Boolean(primarySelectedEntry?.key),
  });

  const logsQuery = useQuery({
    queryKey: [USAGE_QUERY_KEY, "logs", primarySelectedEntry?.key],
    queryFn: async () =>
      normalizeLogs(
        await gateway.request<unknown>("sessions.usage.logs", {
          key: primarySelectedEntry?.key,
          limit: 1000,
        }),
      ),
    enabled: isConnected && Boolean(primarySelectedEntry?.key),
  });

  const hasQuery = query.trim().length > 0;
  const hasDraftQuery = queryDraft.trim().length > 0;

  const sortedSessionList = useMemo(() => {
    const list = [...filteredSessions];
    list.sort((left, right) => {
      switch (sessionSort) {
        case "recent":
          return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
        case "messages":
          return (right.usage?.messageCounts?.total ?? 0) - (left.usage?.messageCounts?.total ?? 0);
        case "errors":
          return (right.usage?.messageCounts?.errors ?? 0) - (left.usage?.messageCounts?.errors ?? 0);
        case "cost":
        case "tokens":
        default:
          return (
            computeSessionValue(right, chartMode, selectedDays) -
            computeSessionValue(left, chartMode, selectedDays)
          );
      }
    });
    return sessionSortDir === "asc" ? list.reverse() : list;
  }, [filteredSessions, sessionSort, sessionSortDir, chartMode, selectedDays]);

  const sessionMap = useMemo(
    () => new Map(sessions.map((session) => [session.key, session])),
    [sessions],
  );
  const recentEntries = useMemo(
    () => recentSessions.map((key) => sessionMap.get(key)).filter(Boolean) as SessionUsageEntry[],
    [recentSessions, sessionMap],
  );

  const displayTotals = useMemo(() => {
    if (selectedSessions.length > 0) {
      return computeSessionTotals(
        filteredSessions.filter((session) => selectedSessions.includes(session.key)),
      );
    }
    if (selectedDays.length > 0 && selectedHours.length === 0) {
      return computeDailyTotals(costDaily, selectedDays);
    }
    if (selectedHours.length > 0 || hasQuery) {
      return computeSessionTotals(filteredSessions);
    }
    return usageQuery.data?.sessions.totals ?? null;
  }, [
    selectedSessions,
    filteredSessions,
    selectedDays,
    selectedHours,
    costDaily,
    hasQuery,
    usageQuery.data?.sessions.totals,
  ]);

  const displaySessionCount =
    selectedSessions.length > 0
      ? filteredSessions.filter((session) => selectedSessions.includes(session.key)).length
      : filteredSessions.length;

  const aggregateSessions = useMemo(() => {
    if (selectedSessions.length > 0) {
      return filteredSessions.filter((session) => selectedSessions.includes(session.key));
    }
    if (hasQuery || selectedHours.length > 0) {
      return filteredSessions;
    }
    if (selectedDays.length > 0) {
      return dayFilteredSessions;
    }
    return sortedSessions;
  }, [
    selectedSessions,
    filteredSessions,
    hasQuery,
    selectedHours.length,
    selectedDays.length,
    dayFilteredSessions,
    sortedSessions,
  ]);

  const activeAggregates = useMemo(
    () => buildAggregatesFromSessions(aggregateSessions, aggregates),
    [aggregateSessions, aggregates],
  );

  const filteredDaily = useMemo(() => {
    if (selectedSessions.length > 0) {
      const selectedEntries = filteredSessions.filter((session) =>
        selectedSessions.includes(session.key),
      );
      const allActivityDates = new Set<string>();
      for (const entry of selectedEntries) {
        for (const date of entry.usage?.activityDates ?? []) {
          allActivityDates.add(date);
        }
      }
      return allActivityDates.size > 0
        ? costDaily.filter((day) => allActivityDates.has(day.date))
        : costDaily;
    }
    return costDaily;
  }, [selectedSessions, filteredSessions, costDaily]);

  const insightStats = buildUsageInsightStats(aggregateSessions, displayTotals, activeAggregates);

  const hasMissingCost =
    (displayTotals?.missingCostEntries ?? 0) > 0 ||
    (displayTotals
      ? displayTotals.totalTokens > 0 &&
        displayTotals.totalCost === 0 &&
        displayTotals.input +
          displayTotals.output +
          displayTotals.cacheRead +
          displayTotals.cacheWrite >
          0
      : false);

  const timeSeriesPoints = timeSeriesQuery.data?.points ?? [];
  const timeSeriesView = buildTimeSeriesView(timeSeriesPoints, timeSeriesMode);
  const timeSeriesMax = Math.max(
    ...timeSeriesView.map((point) =>
      chartMode === "tokens" ? point.totalTokens : point.totalCost,
    ),
    chartMode === "tokens" ? 1 : 0.0001,
  );
  const mosaicStats = useMemo(
    () => buildUsageMosaicStats(aggregateSessions, timeZone),
    [aggregateSessions, timeZone],
  );

  const timeSeriesSelection =
    timeSeriesCursorStart != null && timeSeriesCursorEnd != null
      ? [Math.min(timeSeriesCursorStart, timeSeriesCursorEnd), Math.max(timeSeriesCursorStart, timeSeriesCursorEnd)]
      : null;

  const selectedRangeUsage =
    primarySelectedEntry?.usage && timeSeriesSelection
      ? computeFilteredUsageFromTimeSeries(
          primarySelectedEntry.usage,
          timeSeriesPoints,
          timeSeriesSelection[0],
          timeSeriesSelection[1],
        )
      : undefined;

  const rangeStartTimestamp =
    timeSeriesSelection && timeSeriesPoints[timeSeriesSelection[0]]
      ? timeSeriesPoints[timeSeriesSelection[0]].timestamp
      : null;
  const rangeEndTimestamp =
    timeSeriesSelection && timeSeriesPoints[timeSeriesSelection[1]]
      ? timeSeriesPoints[timeSeriesSelection[1]].timestamp
      : null;

  const filteredLogs = useMemo(() => {
    if (!logsQuery.data) {
      return [];
    }
    const ranged = filterLogsByRange(logsQuery.data, rangeStartTimestamp, rangeEndTimestamp);
    return filterSessionLogs(ranged, {
      roles: logFilterRoles,
      tools: logFilterTools,
      hasTools: logFilterHasTools,
      query: logFilterQuery,
    });
  }, [
    logsQuery.data,
    rangeStartTimestamp,
    rangeEndTimestamp,
    logFilterRoles,
    logFilterTools,
    logFilterHasTools,
    logFilterQuery,
  ]);

  const logToolOptions = useMemo(() => {
    if (logsQuery.data) {
      return uniqueValues(
        logsQuery.data.flatMap((entry) => parseToolSummary(entry.content).tools.map(([name]) => name)),
      );
    }
    return uniqueValues(primarySelectedEntry?.usage?.toolUsage?.tools.map((tool) => tool.name) ?? []);
  }, [logsQuery.data, primarySelectedEntry?.usage?.toolUsage?.tools]);

  if (!isConnected) {
    return (
      <div className="workspace-empty-state usage-page">
        <BarChart3 size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">Usage</h2>
        <p className="workspace-subtitle">Connect a gateway to inspect token, cost, and session usage analytics.</p>
      </div>
    );
  }

  const exportStamp = formatIsoDate(new Date());

  const renderFilterSelect = (key: string, label: string, options: string[]) => {
    if (options.length === 0) {
      return null;
    }
    const selected = selectedValuesFor(key);
    const selectedSet = new Set(selected.map((value) => normalizeQueryText(value)));
    const allSelected =
      options.length > 0 && options.every((value) => selectedSet.has(normalizeQueryText(value)));
    return (
      <details className="usage-filter-select">
        <summary>
          <span>{label}</span>
          <span className="usage-filter-badge">{selected.length > 0 ? selected.length : "All"}</span>
        </summary>
        <div className="usage-filter-popover">
          <div className="usage-filter-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setQueryDraft(setQueryTokensForKey(queryDraft, key, options));
              }}
              disabled={allSelected}
            >
              Select All
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setQueryDraft(setQueryTokensForKey(queryDraft, key, []));
              }}
              disabled={selected.length === 0}
            >
              Clear
            </Button>
          </div>
          <div className="usage-filter-options">
            {options.map((value) => {
              const checked = selectedSet.has(normalizeQueryText(value));
              return (
                <label key={value} className="usage-filter-option">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const token = `${key}:${value}`;
                      setQueryDraft(
                        event.target.checked
                          ? addQueryToken(queryDraft, token)
                          : removeQueryToken(queryDraft, token),
                      );
                    }}
                  />
                  <span>{value}</span>
                </label>
              );
            })}
          </div>
        </div>
      </details>
    );
  };

  return (
    <div className={`usage-page ${headerPinned ? "usage-page--pinned" : ""}`}>
      <div className="usage-page-header">
        <div className="usage-page-header__copy">
          <h2 className="workspace-title">Usage</h2>
          <p className="workspace-subtitle">
            See where tokens go, when sessions spike, and what drives cost.
          </p>
        </div>
        {displayTotals && (
          <div className="usage-page-header__metrics">
            <span className="usage-metric-badge">
              <strong>{formatTokens(displayTotals.totalTokens)}</strong> tokens
            </span>
            <span className="usage-metric-badge">
              <strong>{formatCost(displayTotals.totalCost)}</strong> cost
            </span>
            <span className="usage-metric-badge">
              <strong>{displaySessionCount}</strong> session{displaySessionCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      <Card className="usage-header" padding>
        <div className="usage-header__row">
          <div className="usage-header__title">
            <h3>Filters</h3>
            {usageQuery.isFetching && <span className="usage-refresh-indicator">Loading</span>}
            {sessions.length === 0 && !usageQuery.isFetching && (
              <span className="usage-query-hint">
                Select a date range and click Refresh to load usage.
              </span>
            )}
          </div>
          <div className="usage-header__actions">
            <button
              type="button"
              className={`usage-chip ${headerPinned ? "active" : ""}`}
              onClick={() => setHeaderPinned((current) => !current)}
            >
              {headerPinned ? "Pinned" : "Pin"}
            </button>
            <details className="usage-export-menu">
              <summary className="usage-chip">Export</summary>
              <div className="usage-export-popover">
                <div className="usage-export-list">
                  <button
                    type="button"
                    className="usage-export-item"
                    onClick={() =>
                      downloadTextFile(
                        `openclaw-usage-sessions-${exportStamp}.csv`,
                        buildSessionsCsv(filteredSessions),
                        "text/csv",
                      )
                    }
                    disabled={filteredSessions.length === 0}
                  >
                    Sessions CSV
                  </button>
                  <button
                    type="button"
                    className="usage-export-item"
                    onClick={() =>
                      downloadTextFile(
                        `openclaw-usage-daily-${exportStamp}.csv`,
                        buildDailyCsv(filteredDaily),
                        "text/csv",
                      )
                    }
                    disabled={filteredDaily.length === 0}
                  >
                    Daily CSV
                  </button>
                  <button
                    type="button"
                    className="usage-export-item"
                    onClick={() =>
                      downloadTextFile(
                        `openclaw-usage-${exportStamp}.json`,
                        JSON.stringify(
                          {
                            totals: displayTotals,
                            sessions: filteredSessions,
                            daily: filteredDaily,
                            aggregates: activeAggregates,
                          },
                          null,
                          2,
                        ),
                        "application/json",
                      )
                    }
                    disabled={filteredSessions.length === 0 && filteredDaily.length === 0}
                  >
                    JSON
                  </button>
                </div>
              </div>
            </details>
          </div>
        </div>

        <div className="usage-header__row">
          <div className="usage-controls">
            {selectedDays.length > 0 && (
              <span className="usage-filter-chip">
                Days: {selectedDays.length === 1 ? selectedDays[0] : `${selectedDays.length} days`}
                <button type="button" onClick={() => setSelectedDays([])}>
                  x
                </button>
              </span>
            )}
            {selectedHours.length > 0 && (
              <span className="usage-filter-chip">
                Hours: {selectedHours.length === 1 ? `${selectedHours[0]}:00` : `${selectedHours.length} hours`}
                <button type="button" onClick={() => setSelectedHours([])}>
                  x
                </button>
              </span>
            )}
            {selectedSessions.length > 0 && (
              <span className="usage-filter-chip">
                Session: {selectedSessions.length === 1 ? truncate(selectedSessions[0], 16) : `${selectedSessions.length} sessions`}
                <button type="button" onClick={() => setSelectedSessions([])}>
                  x
                </button>
              </span>
            )}
            <div className="usage-presets">
              {[
                { label: "Today", days: 1 },
                { label: "7d", days: 7 },
                { label: "30d", days: 30 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="usage-chip"
                  onClick={() => {
                    const end = new Date();
                    const start = new Date();
                    start.setDate(start.getDate() - (preset.days - 1));
                    setDateRange({
                      startDate: formatIsoDate(start),
                      endDate: formatIsoDate(end),
                    });
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <input
              type="date"
              className="usage-input"
              value={dateRange.startDate}
              onChange={(event) =>
                setDateRange((current) => ({ ...current, startDate: event.target.value }))
              }
            />
            <span className="usage-query-hint">to</span>
            <input
              type="date"
              className="usage-input"
              value={dateRange.endDate}
              onChange={(event) =>
                setDateRange((current) => ({ ...current, endDate: event.target.value }))
              }
            />
            <select
              className="usage-select"
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value as TimeZoneMode)}
            >
              <option value="local">Local</option>
              <option value="utc">UTC</option>
            </select>
            <div className="usage-toggle">
              <button
                type="button"
                className={chartMode === "tokens" ? "active" : ""}
                onClick={() => setChartMode("tokens")}
              >
                Tokens
              </button>
              <button
                type="button"
                className={chartMode === "cost" ? "active" : ""}
                onClick={() => setChartMode("cost")}
              >
                Cost
              </button>
            </div>
            <Button
              variant="secondary"
              onClick={() => usageQuery.refetch()}
              loading={usageQuery.isFetching}
            >
              <RefreshCw size={14} />
              Refresh
            </Button>
            {sessionsLimitReached && (
              <span className="usage-limit-indicator">
                Showing first {SESSION_LIMIT} sessions. Narrow range for complete results.
              </span>
            )}
          </div>
        </div>

        <div className="usage-query-panel">
          <div className="usage-query-bar">
            <input
              className="usage-query-input"
              type="text"
              value={queryDraft}
              placeholder="Filter sessions (e.g. key:agent:main:cron* model:gpt-4o has:errors minTokens:2000)"
              onChange={(event) => setQueryDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  setQuery(queryDraft.trim());
                }
              }}
            />
            <div className="usage-query-actions">
              <button
                type="button"
                className="usage-chip"
                disabled={usageQuery.isFetching || (!hasDraftQuery && !hasQuery)}
                onClick={() => setQuery(queryDraft.trim())}
              >
                Filter (client-side)
              </button>
              {(hasDraftQuery || hasQuery) && (
                <button
                  type="button"
                  className="usage-chip"
                  onClick={() => {
                    setQuery("");
                    setQueryDraft("");
                  }}
                >
                  Clear
                </button>
              )}
              <span className="usage-query-hint">
                {hasQuery
                  ? `${filteredSessions.length} of ${sessions.length} sessions match`
                  : `${sessions.length} sessions in range`}
              </span>
            </div>
          </div>
          <div className="usage-filter-row">
            {renderFilterSelect("agent", "Agent", agentOptions)}
            {renderFilterSelect("channel", "Channel", channelOptions)}
            {renderFilterSelect("provider", "Provider", providerOptions)}
            {renderFilterSelect("model", "Model", modelOptions)}
            {renderFilterSelect("tool", "Tool", toolOptions)}
            <span className="usage-query-hint">Tip: use filters or click bars to filter days.</span>
          </div>
          {queryTerms.length > 0 && (
            <div className="usage-query-chips">
              {queryTerms.map((term) => (
                <span key={term.raw} className="usage-query-chip">
                  {term.raw}
                  <button
                    type="button"
                    onClick={() => setQueryDraft(removeQueryToken(queryDraft, term.raw))}
                  >
                  x
                  </button>
                </span>
              ))}
            </div>
          )}
          {querySuggestions.length > 0 && (
            <div className="usage-query-suggestions">
              {querySuggestions.map((suggestion) => (
                <button
                  key={`${suggestion.label}-${suggestion.value}`}
                  type="button"
                  className="usage-suggestion"
                  onClick={() =>
                    setQueryDraft(applySuggestionToQuery(queryDraft, suggestion.value))
                  }
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          )}
          {queryWarnings.length > 0 && (
          <div className="usage-query-warning">{queryWarnings.join(" - ")}</div>
          )}
        </div>
      </Card>

      {usageQuery.error && (
        <div className="workspace-alert workspace-alert--error">{String(usageQuery.error)}</div>
      )}

      {displayTotals && (
        <Card className="usage-detail-card">
          <div className="usage-summary-grid">
            {(() => {
              const aggregatesToShow: UsageAggregates = activeAggregates;
              const avgTokens = aggregatesToShow.messages.total
                ? Math.round(displayTotals.totalTokens / aggregatesToShow.messages.total)
                : 0;
              const avgCost = aggregatesToShow.messages.total
                ? displayTotals.totalCost / aggregatesToShow.messages.total
                : 0;
              const cacheBase = displayTotals.input + displayTotals.cacheRead;
              const cacheHitRate = cacheBase > 0 ? displayTotals.cacheRead / cacheBase : 0;
              const errorRate =
                aggregatesToShow.messages.total > 0
                  ? (aggregatesToShow.messages.errors / aggregatesToShow.messages.total) * 100
                  : 0;
              const throughputTokens =
                insightStats.throughputTokensPerMin != null
                  ? formatTokens(Math.round(insightStats.throughputTokensPerMin))
                  : "-";
              const throughputCost =
                insightStats.throughputCostPerMin != null
                  ? formatCost(insightStats.throughputCostPerMin, 4)
                  : "-";
              return (
                <>
                  <div className="usage-summary-card">
                    <div className="usage-summary-title">Messages</div>
                    <div className="usage-summary-value">{aggregatesToShow.messages.total}</div>
                    <div className="usage-summary-sub">
                      {aggregatesToShow.messages.user} user - {aggregatesToShow.messages.assistant} assistant
                    </div>
                  </div>
                  <div className="usage-summary-card">
                    <div className="usage-summary-title">Tool Calls</div>
                    <div className="usage-summary-value">{aggregatesToShow.tools.totalCalls}</div>
                    <div className="usage-summary-sub">{aggregatesToShow.tools.uniqueTools} tools used</div>
                  </div>
                  <div className="usage-summary-card">
                    <div className="usage-summary-title">Errors</div>
                    <div className="usage-summary-value">{aggregatesToShow.messages.errors}</div>
                    <div className="usage-summary-sub">{aggregatesToShow.messages.toolResults} tool results</div>
                  </div>
                  <div className="usage-summary-card">
                    <div className="usage-summary-title">Avg Tokens / Msg</div>
                    <div className="usage-summary-value">{formatTokens(avgTokens)}</div>
                    <div className="usage-summary-sub">Across {aggregatesToShow.messages.total || 0} messages</div>
                  </div>
                  <div className="usage-summary-card">
                    <div className="usage-summary-title">Avg Cost / Msg</div>
                    <div className="usage-summary-value">{formatCost(avgCost, 4)}</div>
                    <div className="usage-summary-sub">
                      {formatCost(displayTotals.totalCost)} total{hasMissingCost ? " - cost missing for some sessions" : ""}
                    </div>
                  </div>
                  <div className="usage-summary-card">
                    <div className="usage-summary-title">Sessions</div>
                    <div className="usage-summary-value">{displaySessionCount}</div>
                    <div className="usage-summary-sub">of {sessions.length} in range</div>
                  </div>
                  <div className="usage-summary-card">
                    <div className="usage-summary-title">Throughput</div>
                    <div className="usage-summary-value">{throughputTokens} tok/min</div>
                    <div className="usage-summary-sub">{throughputCost} / min</div>
                  </div>
                  <div className="usage-summary-card">
                    <div className="usage-summary-title">Error Rate</div>
                    <div
                      className={`usage-summary-value ${
                        errorRate > 5 ? "bad" : errorRate > 1 ? "warn" : "good"
                      }`}
                    >
                      {errorRate.toFixed(2)}%
                    </div>
                    <div className="usage-summary-sub">
                      {aggregatesToShow.messages.errors} errors - {insightStats.avgDurationMs ? `${Math.round(insightStats.avgDurationMs / 1000)}s avg session` : "-"}
                    </div>
                  </div>
                  <div className="usage-summary-card">
                    <div className="usage-summary-title">Cache Hit Rate</div>
                    <div
                      className={`usage-summary-value ${
                        cacheHitRate > 0.6 ? "good" : cacheHitRate > 0.3 ? "warn" : "bad"
                      }`}
                    >
                      {cacheBase > 0 ? `${(cacheHitRate * 100).toFixed(1)}%` : "-"}
                    </div>
                    <div className="usage-summary-sub">
                      {formatTokens(displayTotals.cacheRead)} cached - {formatTokens(cacheBase)} prompt
                    </div>
                  </div>
                </>
              );
            })()}
          </div>

          <div className="usage-insights-grid" style={{ marginTop: "14px" }}>
            {[
              {
                title: "Top Models",
                items: activeAggregates.byModel.slice(0, 5).map((entry) => ({
                  label: entry.model ?? "unknown",
                  value: formatCost(entry.totals.totalCost),
                  sub: `${formatTokens(entry.totals.totalTokens)} - ${entry.count ?? 0} msgs`,
                })),
              },
              {
                title: "Top Providers",
                items: activeAggregates.byProvider.slice(0, 5).map((entry) => ({
                  label: entry.provider ?? "unknown",
                  value: formatCost(entry.totals.totalCost),
                  sub: `${formatTokens(entry.totals.totalTokens)} - ${entry.count ?? 0} msgs`,
                })),
              },
              {
                title: "Top Tools",
                items: activeAggregates.tools.tools.slice(0, 6).map((tool) => ({
                  label: tool.name,
                  value: `${tool.count}`,
                  sub: "calls",
                })),
              },
              {
                title: "Top Agents",
                items: activeAggregates.byAgent.slice(0, 5).map((entry) => ({
                  label: entry.agentId,
                  value: formatCost(entry.totals.totalCost),
                  sub: formatTokens(entry.totals.totalTokens),
                })),
              },
              {
                title: "Top Channels",
                items: activeAggregates.byChannel.slice(0, 5).map((entry) => ({
                  label: entry.channel,
                  value: formatCost(entry.totals.totalCost),
                  sub: formatTokens(entry.totals.totalTokens),
                })),
              },
              {
                title: "Peak Error Days",
                items: activeAggregates.daily
                  .filter((day) => day.messages > 0 && day.errors > 0)
                  .map((day) => ({
                    label: formatDayLabel(day.date),
                    value: `${((day.errors / day.messages) * 100).toFixed(2)}%`,
                    sub: `${day.errors} errors - ${day.messages} msgs - ${formatTokens(day.tokens)}`,
                  }))
                  .slice(0, 5),
              },
              {
                title: "Peak Error Hours",
                items: buildPeakErrorHours(aggregateSessions, timeZone),
              },
            ].map((section) => (
              <div key={section.title} className="usage-insight-card">
                <div className="usage-insight-title">{section.title}</div>
                {section.items.length === 0 ? (
                  <div className="usage-query-hint">No data</div>
                ) : (
                  <div className="usage-list">
                    {section.items.map((item) => (
                      <div key={`${section.title}-${item.label}`} className="usage-list-item">
                        <span>{item.label}</span>
                        <span className="usage-list-value">
                          <span>{item.value}</span>
                          {item.sub && <span className="usage-list-sub">{item.sub}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="usage-detail-card usage-mosaic">
        <div className="usage-mosaic__header">
          <div>
            <div className="usage-insight-title" style={{ fontSize: "14px", color: "var(--text)" }}>
              Activity by Time
            </div>
            <div className="usage-query-hint">
              Estimated from session spans. Time zone: {timeZone === "utc" ? "UTC" : "Local"}.
            </div>
          </div>
          <div className="usage-metric-badge">
            <strong>{formatTokens(mosaicStats.totalTokens)}</strong> tokens
          </div>
        </div>
        {!mosaicStats.hasData ? (
          <div className="usage-empty-panel">No timeline data yet.</div>
        ) : (
          <div className="usage-mosaic__grid">
            <div className="usage-daypart-grid">
              {mosaicStats.weekdayTotals.map((day) => {
                const maxWeekday = Math.max(...mosaicStats.weekdayTotals.map((entry) => entry.tokens), 1);
                const intensity = Math.min(day.tokens / maxWeekday, 1);
                const bg =
                  day.tokens > 0
                    ? `rgba(255, 77, 77, ${0.12 + intensity * 0.6})`
                    : "transparent";
                return (
                  <div key={day.label} className="usage-daypart-cell" style={{ background: bg }}>
                    <div className="usage-daypart-label">{day.label}</div>
                    <div className="usage-daypart-value">{formatTokens(day.tokens)}</div>
                  </div>
                );
              })}
            </div>
            <div>
              <div className="usage-hour-grid">
                {mosaicStats.hourTotals.map((value, hour) => {
                  const maxHour = Math.max(...mosaicStats.hourTotals, 1);
                  const intensity = Math.min(value / maxHour, 1);
                  const bg =
                    value > 0
                      ? `rgba(255, 77, 77, ${0.08 + intensity * 0.7})`
                      : "transparent";
                  const border =
                    intensity > 0.7
                      ? "rgba(255, 77, 77, 0.6)"
                      : "rgba(255, 77, 77, 0.2)";
                  const isSelected = selectedHours.includes(hour);
                  return (
                    <div
                      key={hour}
                      className={`usage-hour-cell ${isSelected ? "selected" : ""}`}
                      style={{ background: bg, borderColor: border }}
                      onClick={(event) =>
                        setSelectedHours(useShiftToggle(hour, selectedHours, event.shiftKey))
                      }
                    />
                  );
                })}
              </div>
              <div className="usage-hour-labels">
                <span>Midnight</span>
                <span>4am</span>
                <span>8am</span>
                <span>Noon</span>
                <span>4pm</span>
                <span>8pm</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      <div className="usage-grid">
        <Card className="usage-daily-card">
          <div className="usage-card-header">
            <div>
              <div className="usage-insight-title" style={{ fontSize: "14px", color: "var(--text)" }}>
                Daily {chartMode === "tokens" ? "Token" : "Cost"} Usage
              </div>
              <div className="usage-query-hint">
                {usageQuery.data?.cost?.days ?? 0} day window - loaded{" "}
                {usageQuery.data ? formatDateTime(usageQuery.data.loadedAt) : "just now"}
              </div>
            </div>
            <div className="usage-toggle">
              <button
                type="button"
                className={dailyChartMode === "total" ? "active" : ""}
                onClick={() => setDailyChartMode("total")}
              >
                Total
              </button>
              <button
                type="button"
                className={dailyChartMode === "by-type" ? "active" : ""}
                onClick={() => setDailyChartMode("by-type")}
              >
                By Type
              </button>
            </div>
          </div>
          <div className="usage-daily-body">
            {filteredDaily.length === 0 ? (
              <div className="usage-empty-panel">No usage snapshots were returned for this date range.</div>
            ) : (
              <>
                <div className="usage-bars">
                  {filteredDaily.map((day) => {
                    const value = chartMode === "tokens" ? day.totalTokens : day.totalCost;
                    const maxValue = Math.max(
                      ...filteredDaily.map((entry) =>
                        chartMode === "tokens" ? entry.totalTokens : entry.totalCost,
                      ),
                      chartMode === "tokens" ? 1 : 0.0001,
                    );
                    const isSelected = selectedDays.includes(day.date);
                    const height = getBarHeight(value, maxValue);
                    return (
                      <div
                        key={day.date}
                        className={`usage-bar-wrapper ${isSelected ? "selected" : ""}`}
                        onClick={(event) =>
                          setSelectedDays(useShiftToggle(day.date, selectedDays, event.shiftKey))
                        }
                      >
                        <div className="usage-bar-track">
                          {dailyChartMode === "by-type" ? (
                            <div className="usage-bar-stack" style={{ height: `${height}%` }}>
                              <div
                                className="usage-bar-segment output"
                                style={{
                                  flex:
                                    chartMode === "tokens"
                                      ? day.output || 1
                                      : day.outputCost || 0.0001,
                                }}
                              />
                              <div
                                className="usage-bar-segment input"
                                style={{
                                  flex:
                                    chartMode === "tokens"
                                      ? day.input || 1
                                      : day.inputCost || 0.0001,
                                }}
                              />
                              <div
                                className="usage-bar-segment cache-write"
                                style={{
                                  flex:
                                    chartMode === "tokens"
                                      ? day.cacheWrite || 1
                                      : day.cacheWriteCost || 0.0001,
                                }}
                              />
                              <div
                                className="usage-bar-segment cache-read"
                                style={{
                                  flex:
                                    chartMode === "tokens"
                                      ? day.cacheRead || 1
                                      : day.cacheReadCost || 0.0001,
                                }}
                              />
                            </div>
                          ) : (
                            <div className="usage-bar" style={{ height: `${height}%` }} />
                          )}
                        </div>
                        <div className="usage-bar-total">{formatDisplayValue(value, chartMode)}</div>
                        <div className="usage-bar-label">{formatDayLabel(day.date)}</div>
                      </div>
                    );
                  })}
                </div>
                {displayTotals && (
                  <div className="usage-breakdown">
                    <div className="usage-breakdown-bar">
                      {(() => {
                        const pct = buildCostBreakdown(displayTotals, chartMode);
                        return (
                          <>
                            <div
                              className="usage-breakdown-segment output"
                              style={{ width: `${pct.output.toFixed(1)}%` }}
                            />
                            <div
                              className="usage-breakdown-segment input"
                              style={{ width: `${pct.input.toFixed(1)}%` }}
                            />
                            <div
                              className="usage-breakdown-segment cache-write"
                              style={{ width: `${pct.cacheWrite.toFixed(1)}%` }}
                            />
                            <div
                              className="usage-breakdown-segment cache-read"
                              style={{ width: `${pct.cacheRead.toFixed(1)}%` }}
                            />
                          </>
                        );
                      })()}
                    </div>
                    <div className="usage-breakdown-legend">
                      <span>
                        <span className="usage-dot usage-bar-segment output" /> Output{" "}
                        {chartMode === "tokens"
                          ? formatTokens(displayTotals.output)
                          : formatCost(displayTotals.outputCost)}
                      </span>
                      <span>
                        <span className="usage-dot usage-bar-segment input" /> Input{" "}
                        {chartMode === "tokens"
                          ? formatTokens(displayTotals.input)
                          : formatCost(displayTotals.inputCost)}
                      </span>
                      <span>
                        <span className="usage-dot usage-bar-segment cache-write" /> Cache write{" "}
                        {chartMode === "tokens"
                          ? formatTokens(displayTotals.cacheWrite)
                          : formatCost(displayTotals.cacheWriteCost)}
                      </span>
                      <span>
                        <span className="usage-dot usage-bar-segment cache-read" /> Cache read{" "}
                        {chartMode === "tokens"
                          ? formatTokens(displayTotals.cacheRead)
                          : formatCost(displayTotals.cacheReadCost)}
                      </span>
                    </div>
                    <div className="usage-query-hint">
                      Total:{" "}
                      {chartMode === "tokens"
                        ? formatTokens(displayTotals.totalTokens)
                        : formatCost(displayTotals.totalCost)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>

        <Card className="usage-sessions-card">
          <div className="usage-card-header">
            <div>
              <div className="usage-insight-title" style={{ fontSize: "14px", color: "var(--text)" }}>
                Sessions
              </div>
              <div className="usage-query-hint">
                {filteredSessions.length} shown{sessions.length !== filteredSessions.length ? ` - ${sessions.length} total` : ""}
              </div>
            </div>
            <div className="usage-toggle">
              <button
                type="button"
                className={sessionsTab === "all" ? "active" : ""}
                onClick={() => setSessionsTab("all")}
              >
                All
              </button>
              <button
                type="button"
                className={sessionsTab === "recent" ? "active" : ""}
                onClick={() => setSessionsTab("recent")}
              >
                Recently viewed
              </button>
            </div>
          </div>
          <div className="usage-sessions-body">
            <div className="usage-sessions-meta">
              <div className="usage-summary-foot">
                <span className="usage-query-hint">
                  Avg{" "}
                  {formatDisplayValue(
                    filteredSessions.length
                      ? filteredSessions.reduce(
                          (sum, session) => sum + computeSessionValue(session, chartMode, selectedDays),
                          0,
                        ) / filteredSessions.length
                      : 0,
                    chartMode,
                  )}
                </span>
                <span className="usage-query-hint">
                  Errors{" "}
                  {filteredSessions.reduce(
                    (sum, session) => sum + (session.usage?.messageCounts?.errors ?? 0),
                    0,
                  )}
                </span>
              </div>
              <div className="usage-detail-actions">
                <details className="usage-filter-select">
                  <summary>
                    <span>Columns</span>
                    <span className="usage-filter-badge">{visibleColumns.length}</span>
                  </summary>
                  <div className="usage-filter-popover">
                    <div className="usage-filter-options">
                      {columnOptions.map((column) => (
                        <label key={column.id} className="usage-filter-option">
                          <input
                            type="checkbox"
                            checked={visibleColumns.includes(column.id)}
                            onChange={() =>
                              setVisibleColumns((current) => toggleListItem(current, column.id))
                            }
                          />
                          <span>{column.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </details>
                <label className="usage-query-hint">
                  Sort by{" "}
                  <select
                    className="usage-select"
                    value={sessionSort}
                    onChange={(event) =>
                      setSessionSort(
                        event.target.value as "tokens" | "cost" | "recent" | "messages" | "errors",
                      )
                    }
                  >
                    <option value="cost">Cost</option>
                    <option value="errors">Errors</option>
                    <option value="messages">Messages</option>
                    <option value="recent">Recent</option>
                    <option value="tokens">Tokens</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="usage-chip"
                  onClick={() => setSessionSortDir(sessionSortDir === "desc" ? "asc" : "desc")}
                >
                  {sessionSortDir === "desc" ? "Descending" : "Ascending"}
                </button>
                {selectedSessions.length > 0 && (
                  <button type="button" className="usage-chip" onClick={() => setSelectedSessions([])}>
                    Clear Selection
                  </button>
                )}
              </div>
            </div>

            <div className="usage-session-bars">
              {(sessionsTab === "recent" ? recentEntries : sortedSessionList)
                .slice(0, 50)
                .map((session) => {
                  const value = computeSessionValue(session, chartMode, selectedDays);
                  const isSelected = selectedSessions.includes(session.key);
                  const meta: Array<{ label: string; value: string }> = [];
                  if (visibleColumns.includes("channel") && session.channel) {
                    meta.push({ label: "Channel", value: session.channel });
                  }
                  if (visibleColumns.includes("agent") && session.agentId) {
                    meta.push({ label: "Agent", value: session.agentId });
                  }
                  if (
                    visibleColumns.includes("provider") &&
                    (session.modelProvider || session.providerOverride)
                  ) {
                    meta.push({
                      label: "Provider",
                      value: session.modelProvider ?? session.providerOverride ?? "-",
                    });
                  }
                  if (visibleColumns.includes("model") && session.model) {
                    meta.push({ label: "Model", value: session.model });
                  }
                  if (visibleColumns.includes("messages") && session.usage?.messageCounts) {
                    meta.push({ label: "Msgs", value: `${session.usage.messageCounts.total}` });
                  }
                  if (visibleColumns.includes("tools") && session.usage?.toolUsage) {
                    meta.push({ label: "Tools", value: `${session.usage.toolUsage.totalCalls}` });
                  }
                  if (
                    visibleColumns.includes("errors") &&
                    (session.usage?.messageCounts?.errors ?? 0) > 0
                  ) {
                    meta.push({ label: "Errors", value: `${session.usage?.messageCounts?.errors ?? 0}` });
                  }
                  if (visibleColumns.includes("duration") && session.usage?.durationMs) {
                    meta.push({ label: "Duration", value: `${Math.round(session.usage.durationMs / 1000)}s` });
                  }
                  return (
                    <div
                      key={session.key}
                      className={`usage-session-row ${isSelected ? "selected" : ""}`}
                      onClick={(event) => {
                        setSelectedSessions(useShiftToggle(session.key, selectedSessions, event.shiftKey));
                        setRecentSessions((current) => {
                          const next = [session.key, ...current.filter((entry) => entry !== session.key)];
                          return next.slice(0, 10);
                        });
                      }}
                    >
                      <div>
                        <div className="usage-session-row__title">
                          {session.label?.trim() || truncate(session.key, 42)}
                        </div>
                        <div className="usage-session-row__key mono">{truncate(session.key, 60)}</div>
                        {meta.length > 0 && (
                          <div className="usage-session-meta">
                            {meta.map((entry) => (
                              <span key={`${session.key}-${entry.label}`}>
                                {entry.label}: {entry.value}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="usage-session-row__value">
                        <strong>{formatDisplayValue(value, chartMode)}</strong>
                        <span>
                          {chartMode === "tokens"
                            ? formatCost(session.usage?.totalCost ?? 0)
                            : formatTokens(session.usage?.totalTokens ?? 0)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              {sessionsTab === "recent" && recentEntries.length === 0 && (
                <div className="usage-empty-panel">No recent sessions yet</div>
              )}
              {sessionsTab === "all" && sortedSessionList.length > 50 && (
                <div className="usage-query-hint">+{sortedSessionList.length - 50} more</div>
              )}
              {sessionsTab === "all" && filteredSessions.length === 0 && (
                <div className="usage-empty-panel">No sessions in this range</div>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Card className="usage-detail-panel">
        {primarySelectedEntry ? (
          <>
            <div className="usage-detail-header">
              <div className="usage-detail-title">
                <h3>{primarySelectedEntry.label?.trim() || "Session Detail"}</h3>
                <p>{truncate(primarySelectedEntry.key, 80)}</p>
                {selectedRangeUsage && <span className="usage-detail-badge">Filtered range</span>}
              </div>
              <div className="usage-detail-actions">
                <button type="button" className="usage-chip" onClick={() => setSelectedSessions([])}>
                  Close
                </button>
              </div>
            </div>
            <div className="usage-detail-body">
              <div className="usage-detail-grid">
                <div className="usage-detail-card">
                  <div className="usage-summary-cards">
                    {[
                      {
                        label: "Messages",
                        value: selectedRangeUsage?.messageCounts?.total ?? primarySelectedEntry.usage?.messageCounts?.total ?? 0,
                        sub: `${selectedRangeUsage?.messageCounts?.user ?? primarySelectedEntry.usage?.messageCounts?.user ?? 0} user - ${
                          selectedRangeUsage?.messageCounts?.assistant ?? primarySelectedEntry.usage?.messageCounts?.assistant ?? 0
                        } assistant`,
                      },
                      {
                        label: "Tool Calls",
                        value: primarySelectedEntry.usage?.toolUsage?.totalCalls ?? 0,
                        sub: `${primarySelectedEntry.usage?.toolUsage?.uniqueTools ?? 0} tools`,
                      },
                      {
                        label: "Errors",
                        value: primarySelectedEntry.usage?.messageCounts?.errors ?? 0,
                        sub: `${primarySelectedEntry.usage?.messageCounts?.toolResults ?? 0} tool results`,
                      },
                      {
                        label: "Duration",
                        value: primarySelectedEntry.usage?.durationMs
                          ? `${Math.round(primarySelectedEntry.usage.durationMs / 1000)}s`
                          : "-",
                        sub: `${formatDateTime(primarySelectedEntry.usage?.firstActivity)} -> ${formatDateTime(
                          primarySelectedEntry.usage?.lastActivity,
                        )}`,
                      },
                    ].map((item) => (
                      <div key={item.label} className="usage-summary-mini">
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                        <span>{item.sub}</span>
                      </div>
                    ))}
                  </div>

                  <div className="usage-timeseries-chart" style={{ marginTop: "16px" }}>
                    <div className="usage-detail-actions">
                      <div className="usage-toggle">
                        <button
                          type="button"
                          className={timeSeriesMode === "cumulative" ? "active" : ""}
                          onClick={() => setTimeSeriesMode("cumulative")}
                        >
                          Cumulative
                        </button>
                        <button
                          type="button"
                          className={timeSeriesMode === "per-turn" ? "active" : ""}
                          onClick={() => setTimeSeriesMode("per-turn")}
                        >
                          Per turn
                        </button>
                      </div>
                      <div className="usage-toggle">
                        <button
                          type="button"
                          className={timeSeriesBreakdownMode === "total" ? "active" : ""}
                          onClick={() => setTimeSeriesBreakdownMode("total")}
                        >
                          Total
                        </button>
                        <button
                          type="button"
                          className={timeSeriesBreakdownMode === "by-type" ? "active" : ""}
                          onClick={() => setTimeSeriesBreakdownMode("by-type")}
                        >
                          By type
                        </button>
                      </div>
                    </div>

                    {timeSeriesQuery.isLoading ? (
                      <div className="workspace-inline-status">Loading time series...</div>
                    ) : timeSeriesView.length > 0 ? (
                      <>
                        <div className="usage-timeseries-bars">
                          {timeSeriesView.map((point, index) => {
                            const value = chartMode === "tokens" ? point.totalTokens : point.totalCost;
                            const height = getBarHeight(value, timeSeriesMax);
                            const inRange =
                              timeSeriesSelection &&
                              index >= timeSeriesSelection[0] &&
                              index <= timeSeriesSelection[1];
                            return (
                              <div
                                key={`${point.timestamp}-${index}`}
                                className={`usage-timeseries-bar ${inRange ? "selected" : ""}`}
                                style={{ height: `${height}%` }}
                                onClick={(event) => {
                                  if (!event.shiftKey || timeSeriesCursorStart == null) {
                                    setTimeSeriesCursorStart(index);
                                    setTimeSeriesCursorEnd(index);
                                    return;
                                  }
                                  setTimeSeriesCursorEnd(index);
                                }}
                              >
                                {timeSeriesBreakdownMode === "by-type" && (
                                  <div className="usage-bar-stack" style={{ height: "100%" }}>
                                    <div className="usage-bar-segment output" style={{ flex: point.output || 1 }} />
                                    <div className="usage-bar-segment input" style={{ flex: point.input || 1 }} />
                                    <div className="usage-bar-segment cache-write" style={{ flex: point.cacheWrite || 1 }} />
                                    <div className="usage-bar-segment cache-read" style={{ flex: point.cacheRead || 1 }} />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="usage-timeseries-foot">
                          <span>
                            {timeSeriesSelection
                              ? `Range: ${formatDateTime(rangeStartTimestamp ?? undefined)} -> ${formatDateTime(
                                  rangeEndTimestamp ?? undefined,
                                )}`
                              : "Click a bar to set range. Shift-click to extend."}
                          </span>
                          <button
                            type="button"
                            className="usage-chip"
                            onClick={() => {
                              setTimeSeriesCursorStart(null);
                              setTimeSeriesCursorEnd(null);
                            }}
                          >
                            Clear range
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="usage-empty-panel">No time series data available for this session.</div>
                    )}
                  </div>
                </div>

                <div className="usage-detail-card">
                  <div className="usage-insight-title" style={{ fontSize: "14px", color: "var(--text)" }}>
                    Context & Tools
                  </div>
                  {primarySelectedEntry.contextWeight ? (
                    <>
                      <div className="usage-context-stack" style={{ marginTop: "12px" }}>
                        {(() => {
                          const system = primarySelectedEntry.contextWeight?.systemPrompt.chars ?? 0;
                          const skills = primarySelectedEntry.contextWeight?.skills.promptChars ?? 0;
                          const tools = (primarySelectedEntry.contextWeight?.tools.listChars ?? 0) +
                            (primarySelectedEntry.contextWeight?.tools.schemaChars ?? 0);
                          const files = primarySelectedEntry.contextWeight?.injectedWorkspaceFiles.reduce(
                            (sum, file) => sum + file.injectedChars,
                            0,
                          ) ?? 0;
                          const total = system + skills + tools + files || 1;
                          return (
                            <>
                              <div className="usage-context-segment usage-bar-segment output" style={{ width: `${(system / total) * 100}%` }} />
                              <div className="usage-context-segment usage-bar-segment input" style={{ width: `${(skills / total) * 100}%` }} />
                              <div className="usage-context-segment usage-bar-segment cache-write" style={{ width: `${(tools / total) * 100}%` }} />
                              <div className="usage-context-segment usage-bar-segment cache-read" style={{ width: `${(files / total) * 100}%` }} />
                            </>
                          );
                        })()}
                      </div>
                      <div className="usage-context-legend" style={{ marginTop: "10px" }}>
                        <span>
                          <span className="usage-dot usage-context-dot system" /> System
                        </span>
                        <span>
                          <span className="usage-dot usage-context-dot skills" /> Skills
                        </span>
                        <span>
                          <span className="usage-dot usage-context-dot tools" /> Tools
                        </span>
                        <span>
                          <span className="usage-dot usage-context-dot files" /> Files
                        </span>
                      </div>
                      <div className="usage-context-grid">
                        <div className="usage-context-card">
                          <h5>Skills</h5>
                          <div className="usage-context-list">
                            {(contextExpanded
                              ? primarySelectedEntry.contextWeight.skills.entries
                              : primarySelectedEntry.contextWeight.skills.entries.slice(0, 4)
                            ).map((entry) => (
                              <div
                                key={`skills-${entry.name}`}
                                className="usage-context-item"
                              >
                                <span className="mono">{entry.name}</span>
                                <span className="usage-list-sub">
                                  ~{Math.round(entry.blockChars / 4)} tokens
                                </span>
                              </div>
                            ))}
                          </div>
                          {primarySelectedEntry.contextWeight.skills.entries.length > 4 && (
                            <button
                              type="button"
                              className="usage-chip"
                              onClick={() => setContextExpanded((current) => !current)}
                            >
                              {contextExpanded ? "Collapse" : "Expand all"}
                            </button>
                          )}
                        </div>
                        <div className="usage-context-card">
                          <h5>Tools</h5>
                          <div className="usage-context-list">
                            {(contextExpanded
                              ? primarySelectedEntry.contextWeight.tools.entries
                              : primarySelectedEntry.contextWeight.tools.entries.slice(0, 4)
                            ).map((entry) => (
                              <div
                                key={`tools-${entry.name}`}
                                className="usage-context-item"
                              >
                                <span className="mono">{entry.name}</span>
                                <span className="usage-list-sub">
                                  ~{Math.round((entry.summaryChars + entry.schemaChars) / 4)} tokens
                                </span>
                              </div>
                            ))}
                          </div>
                          {primarySelectedEntry.contextWeight.tools.entries.length > 4 && (
                            <button
                              type="button"
                              className="usage-chip"
                              onClick={() => setContextExpanded((current) => !current)}
                            >
                              {contextExpanded ? "Collapse" : "Expand all"}
                            </button>
                          )}
                        </div>
                        <div className="usage-context-card">
                          <h5>Files</h5>
                          <div className="usage-context-list">
                            {(contextExpanded
                              ? primarySelectedEntry.contextWeight.injectedWorkspaceFiles
                              : primarySelectedEntry.contextWeight.injectedWorkspaceFiles.slice(0, 4)
                            ).map((entry) => (
                              <div
                                key={`files-${entry.path}`}
                                className="usage-context-item"
                              >
                                <span className="mono">{entry.path}</span>
                                <span className="usage-list-sub">
                                  ~{Math.round(entry.injectedChars / 4)} tokens
                                </span>
                              </div>
                            ))}
                          </div>
                          {primarySelectedEntry.contextWeight.injectedWorkspaceFiles.length > 4 && (
                            <button
                              type="button"
                              className="usage-chip"
                              onClick={() => setContextExpanded((current) => !current)}
                            >
                              {contextExpanded ? "Collapse" : "Expand all"}
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="usage-empty-panel">No context data available.</div>
                  )}
                </div>
              </div>

              <div className="usage-detail-card" style={{ marginTop: "16px" }}>
                <div className="usage-card-header" style={{ padding: "0 0 12px" }}>
                  <div>
                    <div className="usage-insight-title" style={{ fontSize: "14px", color: "var(--text)" }}>
                      Session Logs
                    </div>
                    <div className="usage-query-hint">
                      {filteredLogs.length} rows - {logsQuery.isFetching ? "Refreshing" : "Ready"}
                    </div>
                  </div>
                  <div className="usage-log-toolbar">
                    <div className="usage-log-filter-group">
                      {(["user", "assistant", "tool", "toolResult"] as SessionLogRole[]).map((role) => (
                        <button
                          key={role}
                          type="button"
                          className={`usage-role-chip ${
                            logFilterRoles.includes(role) ? "active" : ""
                          }`}
                          onClick={() => setLogFilterRoles(toggleListItem(logFilterRoles, role))}
                        >
                          {role}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`usage-role-chip ${logFilterHasTools ? "active" : ""}`}
                        onClick={() => setLogFilterHasTools((current) => !current)}
                      >
                        Has tools
                      </button>
                    </div>
                    <details className="usage-filter-select">
                      <summary>
                        <span>Tools</span>
                        <span className="usage-filter-badge">
                          {logFilterTools.length > 0 ? logFilterTools.length : "All"}
                        </span>
                      </summary>
                      <div className="usage-filter-popover">
                        <div className="usage-filter-actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setLogFilterTools(logToolOptions);
                            }}
                          >
                            Select All
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setLogFilterTools([]);
                            }}
                          >
                            Clear
                          </Button>
                        </div>
                        <div className="usage-filter-options">
                          {logToolOptions.map((tool) => (
                            <label key={tool} className="usage-filter-option">
                              <input
                                type="checkbox"
                                checked={logFilterTools.includes(tool)}
                                onChange={() =>
                                  setLogFilterTools(toggleListItem(logFilterTools, tool))
                                }
                              />
                              <span>{tool}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </details>
                    <input
                      className="usage-log-search"
                      type="text"
                      value={logFilterQuery}
                      placeholder="Search logs"
                      onChange={(event) => setLogFilterQuery(event.target.value)}
                    />
                    <button
                      type="button"
                      className="usage-chip"
                      onClick={() => {
                        setLogFilterRoles([]);
                        setLogFilterTools([]);
                        setLogFilterHasTools(false);
                        setLogFilterQuery("");
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                </div>

                {logsQuery.isLoading ? (
                  <div className="workspace-inline-status">Loading session logs...</div>
                ) : filteredLogs.length > 0 ? (
                  <div className="usage-log-list">
                    {(sessionLogsExpanded ? filteredLogs : filteredLogs.slice(-20)).map((entry) => (
                      <div key={`${entry.timestamp}-${entry.role}-${entry.content.slice(0, 16)}`} className="usage-log-row">
                        <span className={`usage-log-role usage-log-role--${entry.role}`}>{entry.role}</span>
                        <div className="usage-log-content">
                          <div className="usage-query-hint">{formatDateTime(entry.timestamp)}</div>
                          <p>{parseToolSummary(entry.content).cleanContent || entry.content}</p>
                        </div>
                        <div className="usage-log-meta">
                          <span>{entry.tokens != null ? formatTokens(entry.tokens) : "-"}</span>
                          <span>{entry.cost != null ? formatCurrency(entry.cost) : ""}</span>
                        </div>
                      </div>
                    ))}
                    {filteredLogs.length > 20 && (
                      <button
                        type="button"
                        className="usage-chip"
                        onClick={() => setSessionLogsExpanded((current) => !current)}
                      >
                        {sessionLogsExpanded ? "Collapse" : "Expand all"}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="usage-empty-panel">No session logs were returned.</div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="usage-empty-panel">
            Select a session to inspect details.
          </div>
        )}
      </Card>
    </div>
  );
}
