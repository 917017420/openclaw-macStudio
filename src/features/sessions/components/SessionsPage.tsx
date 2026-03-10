import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowRight,
  FileText,
  LoaderCircle,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { SESSIONS_QUERY_KEY, messagesQueryKey } from "@/features/chat/hooks";
import { useConnectionStore } from "@/features/connection/store";
import { useChatStore } from "@/features/chat/store";
import { gateway } from "@/lib/gateway";
import { formatRelativeTime, truncate } from "@/lib/utils";
import { useSessionTranscript, useWorkspaceSessions } from "../hooks";
import type { SessionKind, SessionRow } from "../types";
import "./sessions.css";

type SessionDraft = {
  label: string;
  thinkingLevel: string;
  verboseLevel: string;
  reasoningLevel: string;
};

type SessionSort =
  | "updated-desc"
  | "updated-asc"
  | "title-asc"
  | "title-desc"
  | "tokens-desc";

type SessionGroupBy = "none" | "kind" | "provider" | "surface" | "activity";
type BusyAction = "save" | "rename" | "reset" | "archive" | "delete" | null;

interface SessionGroup {
  id: string;
  label: string;
  description: string;
  rows: SessionRow[];
}

const THINK_LEVELS = ["", "off", "minimal", "low", "medium", "high", "xhigh"] as const;
const BINARY_THINK_LEVELS = ["", "off", "on"] as const;
const VERBOSE_LEVELS = [
  { value: "", label: "inherit" },
  { value: "off", label: "off (explicit)" },
  { value: "on", label: "on" },
  { value: "full", label: "full" },
] as const;
const REASONING_LEVELS = ["", "off", "on", "stream"] as const;
const ACTIVITY_BUCKETS = ["Updated in hour", "Updated today", "Updated this week", "Older"] as const;

function normalizeProviderId(provider?: string | null): string {
  if (!provider) return "";
  const normalized = provider.trim().toLowerCase();
  if (normalized === "z.ai" || normalized === "z-ai") return "zai";
  return normalized;
}

function isBinaryThinkingProvider(provider?: string | null): boolean {
  return normalizeProviderId(provider) === "zai";
}

function resolveThinkLevelOptions(provider?: string | null): readonly string[] {
  return isBinaryThinkingProvider(provider) ? BINARY_THINK_LEVELS : THINK_LEVELS;
}

function withCurrentOption(options: readonly string[], current: string): string[] {
  if (!current) return [...options];
  return options.includes(current) ? [...options] : [...options, current];
}

function withCurrentLabeledOption(
  options: readonly { value: string; label: string }[],
  current: string,
): Array<{ value: string; label: string }> {
  if (!current) return [...options];
  return options.some((option) => option.value === current)
    ? [...options]
    : [...options, { value: current, label: `${current} (custom)` }];
}

function resolveThinkLevelDisplay(value: string, isBinary: boolean): string {
  if (!isBinary) return value;
  if (!value || value === "off") return value;
  return "on";
}

function resolveThinkLevelPatchValue(value: string, isBinary: boolean): string | null {
  if (!value) return null;
  if (!isBinary) return value;
  return value === "on" ? "low" : value;
}

function parseSessionAgentId(key: string): string | null {
  const match = key.match(/^agent:([^:]+):/);
  return match?.[1] ?? null;
}

function sessionKindLabel(kind: SessionKind): string {
  switch (kind) {
    case "direct":
      return "Direct";
    case "group":
      return "Group";
    case "global":
      return "Global";
    case "unknown":
    default:
      return "Unknown";
  }
}

function sessionTitle(row: SessionRow): string {
  return (
    row.label?.trim() ||
    row.displayName?.trim() ||
    row.derivedTitle?.trim() ||
    row.subject?.trim() ||
    row.key
  );
}

function sessionLabel(row: SessionRow): string {
  return row.label?.trim() || row.displayName?.trim() || row.derivedTitle?.trim() || "—";
}

function sessionSurface(row: SessionRow): string {
  return row.surface || row.channel || row.originLabel || "Unknown surface";
}

function sessionRoute(row: SessionRow): string {
  return row.room || row.groupChannel || row.space || row.subject || row.lastTo || "—";
}

function sessionModel(row: SessionRow): string {
  if (row.modelProvider && row.model) {
    return `${row.modelProvider}/${row.model}`;
  }
  return row.model || row.modelProvider || "inherit";
}

function sessionTokenTotal(row: SessionRow): number {
  return row.totalTokens ?? (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
}

function formatTokenCount(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "—";
}

function sessionTokenSummary(row: SessionRow): string {
  const total = sessionTokenTotal(row);
  return total > 0 ? total.toLocaleString() : "—";
}

function sessionTokenBreakdown(row: SessionRow): string {
  return `${(row.inputTokens ?? 0).toLocaleString()} in · ${(row.outputTokens ?? 0).toLocaleString()} out`;
}

function formatTimestamp(value: number | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "No timestamp recorded";
}

function transcriptSourceLabel(source: "history" | "preview"): string {
  return source === "history" ? "History" : "Preview";
}

function transcriptStatusLabel(status: "ok" | "empty" | "missing" | "error"): string {
  switch (status) {
    case "ok":
      return "Transcript ready";
    case "empty":
      return "Transcript is empty";
    case "missing":
      return "Transcript missing";
    case "error":
    default:
      return "Transcript unavailable";
  }
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function sessionSearchText(row: SessionRow): string {
  return [
    row.key,
    row.label,
    row.displayName,
    row.derivedTitle,
    row.subject,
    row.surface,
    row.channel,
    row.room,
    row.groupChannel,
    row.space,
    row.lastMessagePreview,
    row.model,
    row.modelProvider,
    row.sessionId,
    row.elevatedLevel,
    row.originLabel,
    row.sendPolicy,
    row.responseUsage,
    row.lastChannel,
    row.lastTo,
    row.lastAccountId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function sortSessions(rows: SessionRow[], sortBy: SessionSort): SessionRow[] {
  const sorted = [...rows];
  sorted.sort((left, right) => {
    switch (sortBy) {
      case "updated-asc":
        return (left.updatedAt ?? 0) - (right.updatedAt ?? 0);
      case "title-asc":
        return compareText(sessionTitle(left), sessionTitle(right));
      case "title-desc":
        return compareText(sessionTitle(right), sessionTitle(left));
      case "tokens-desc": {
        const tokenDelta = sessionTokenTotal(right) - sessionTokenTotal(left);
        return tokenDelta !== 0 ? tokenDelta : (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
      }
      case "updated-desc":
      default:
        return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    }
  });
  return sorted;
}

function buildDraft(row: SessionRow | null): SessionDraft {
  return {
    label: row?.label ?? "",
    thinkingLevel: row?.thinkingLevel ?? "",
    verboseLevel: row?.verboseLevel ?? "",
    reasoningLevel: row?.reasoningLevel ?? "",
  };
}

function draftsEqual(a: SessionDraft, b: SessionDraft): boolean {
  return (
    a.label === b.label &&
    a.thinkingLevel === b.thinkingLevel &&
    a.verboseLevel === b.verboseLevel &&
    a.reasoningLevel === b.reasoningLevel
  );
}

function nextSelectedKey(rows: SessionRow[], currentKey: string | null): string | null {
  if (rows.length === 0) return null;
  if (!currentKey) return rows[0]?.key ?? null;
  const currentIndex = rows.findIndex((row) => row.key === currentKey);
  if (currentIndex === -1) return rows[0]?.key ?? null;
  return rows[currentIndex + 1]?.key ?? rows[currentIndex - 1]?.key ?? null;
}

function sessionActivityBucket(row: SessionRow): (typeof ACTIVITY_BUCKETS)[number] {
  if (!row.updatedAt) return "Older";
  const age = Date.now() - row.updatedAt;
  if (age <= 60 * 60 * 1000) return "Updated in hour";
  if (age <= 24 * 60 * 60 * 1000) return "Updated today";
  if (age <= 7 * 24 * 60 * 60 * 1000) return "Updated this week";
  return "Older";
}

function groupOrder(label: string, groupBy: SessionGroupBy): number {
  if (groupBy === "kind") {
    return ["Direct", "Group", "Global", "Unknown"].indexOf(label);
  }
  if (groupBy === "activity") {
    return ACTIVITY_BUCKETS.indexOf(label as (typeof ACTIVITY_BUCKETS)[number]);
  }
  return Number.MAX_SAFE_INTEGER;
}

function groupSessions(rows: SessionRow[], groupBy: SessionGroupBy): SessionGroup[] {
  if (groupBy === "none") {
    return [{ id: "all", label: "All Sessions", description: `${rows.length} visible`, rows }];
  }

  const groups = new Map<string, SessionRow[]>();
  for (const row of rows) {
    const label =
      groupBy === "kind"
        ? sessionKindLabel(row.kind)
        : groupBy === "provider"
          ? row.modelProvider || "Inherited provider"
          : groupBy === "surface"
            ? sessionSurface(row)
            : sessionActivityBucket(row);
    const bucket = groups.get(label) ?? [];
    bucket.push(row);
    groups.set(label, bucket);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => {
      const leftOrder = groupOrder(left, groupBy);
      const rightOrder = groupOrder(right, groupBy);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return compareText(left, right);
    })
    .map(([label, groupedRows]) => ({
      id: `${groupBy}-${label}`,
      label,
      description: `${groupedRows.length} session${groupedRows.length === 1 ? "" : "s"}`,
      rows: groupedRows,
    }));
}

function sessionFacts(row: SessionRow): string[] {
  const facts = [sessionKindLabel(row.kind)];
  const surface = sessionSurface(row);
  if (surface) facts.push(surface);
  if (row.subject && row.subject !== sessionTitle(row)) facts.push(row.subject);
  if (row.room || row.groupChannel) facts.push(`room ${row.room || row.groupChannel}`);
  if (row.space) facts.push(`space ${row.space}`);
  if (row.modelProvider && row.model) facts.push(`${row.modelProvider}/${row.model}`);
  else if (row.model) facts.push(row.model);
  if (sessionTokenTotal(row) > 0) facts.push(`${sessionTokenTotal(row).toLocaleString()} tokens`);
  if (row.elevatedLevel) facts.push(`${row.elevatedLevel} privileges`);
  if (row.sendPolicy) facts.push(`send ${row.sendPolicy}`);
  if (row.responseUsage) facts.push(`usage ${row.responseUsage}`);
  if (row.systemSent) facts.push("system-originated");
  if (row.abortedLastRun) facts.push("aborted last run");
  return facts;
}

function percentage(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.max(4, Math.round((value / total) * 100))}%`;
}

export function SessionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const labelInputRef = useRef<HTMLInputElement | null>(null);
  const isConnected = useConnectionStore((state) => state.state === "connected");
  const activeChatSessionId = useChatStore((state) => state.selectedSessionId);
  const clearChatSession = useChatStore((state) => state.clearSession);
  const selectAgent = useChatStore((state) => state.selectAgent);
  const selectSession = useChatStore((state) => state.selectSession);

  const [activeMinutes, setActiveMinutes] = useState("1440");
  const [limit, setLimit] = useState("200");
  const [includeGlobal, setIncludeGlobal] = useState(true);
  const [includeUnknown, setIncludeUnknown] = useState(false);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | SessionKind>("all");
  const [sortBy, setSortBy] = useState<SessionSort>("updated-desc");
  const [groupBy, setGroupBy] = useState<SessionGroupBy>("kind");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<SessionDraft>(buildDraft(null));
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "info"; message: string } | null>(null);

  const sessionsQuery = useWorkspaceSessions({
    activeMinutes,
    limit,
    includeGlobal,
    includeUnknown,
  });

  const allSessions = sessionsQuery.data?.sessions ?? [];
  const visibleSessions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = allSessions.filter((session) => {
      if (kindFilter !== "all" && session.kind !== kindFilter) return false;
      return !needle || sessionSearchText(session).includes(needle);
    });
    return sortSessions(filtered, sortBy);
  }, [allSessions, kindFilter, search, sortBy]);

  const groupedSessions = useMemo(
    () => groupSessions(visibleSessions, groupBy),
    [groupBy, visibleSessions],
  );

  useEffect(() => {
    if (activeChatSessionId && visibleSessions.some((session) => session.key === activeChatSessionId)) {
      setSelectedKey((current) => current ?? activeChatSessionId);
      return;
    }
    if (!selectedKey || !visibleSessions.some((session) => session.key === selectedKey)) {
      setSelectedKey(visibleSessions[0]?.key ?? null);
    }
  }, [activeChatSessionId, selectedKey, visibleSessions]);

  const selectedSession = useMemo(
    () => visibleSessions.find((session) => session.key === selectedKey) ?? null,
    [selectedKey, visibleSessions],
  );

  useEffect(() => {
    setDraft(buildDraft(selectedSession));
    setFeedback(null);
  }, [selectedSession]);

  const transcriptQuery = useSessionTranscript(selectedSession?.key ?? null);
  const transcriptItems = useMemo(
    () => (transcriptQuery.data?.items ?? []).slice(-16),
    [transcriptQuery.data?.items],
  );

  const canOpenInChat = Boolean(selectedSession && parseSessionAgentId(selectedSession.key));
  const draftChanged = selectedSession ? !draftsEqual(draft, buildDraft(selectedSession)) : false;
  const renameChanged = selectedSession ? draft.label !== (selectedSession.label ?? "") : false;
  const serverCount = sessionsQuery.data?.count ?? allSessions.length;
  const sourceLabel = sessionsQuery.data?.path ? "Session store" : "Live gateway";
  const selectedPosition = selectedSession
    ? visibleSessions.findIndex((session) => session.key === selectedSession.key) + 1
    : 0;

  const summary = useMemo(() => {
    const total = visibleSessions.length;
    const direct = visibleSessions.filter((session) => session.kind === "direct").length;
    const group = visibleSessions.filter((session) => session.kind === "group").length;
    const global = visibleSessions.filter((session) => session.kind === "global").length;
    const unknown = visibleSessions.filter((session) => session.kind === "unknown").length;
    const aborted = visibleSessions.filter((session) => session.abortedLastRun).length;
    const recent = visibleSessions.filter((session) => sessionActivityBucket(session) !== "Older").length;
    const tokens = visibleSessions.reduce((sum, session) => sum + sessionTokenTotal(session), 0);
    const bucketCounts = ACTIVITY_BUCKETS.map((bucket) => ({
      label: bucket,
      count: visibleSessions.filter((session) => sessionActivityBucket(session) === bucket).length,
    }));
    const topTokenRows = [...visibleSessions]
      .filter((session) => sessionTokenTotal(session) > 0)
      .sort((left, right) => sessionTokenTotal(right) - sessionTokenTotal(left))
      .slice(0, 5);

    return {
      total,
      fetched: allSessions.length,
      hidden: Math.max(allSessions.length - total, 0),
      direct,
      group,
      global,
      unknown,
      aborted,
      recent,
      tokens,
      bucketCounts,
      topTokenRows,
    };
  }, [allSessions.length, visibleSessions]);

  const thinkLevels = useMemo(
    () => withCurrentOption(resolveThinkLevelOptions(selectedSession?.modelProvider), draft.thinkingLevel),
    [draft.thinkingLevel, selectedSession?.modelProvider],
  );
  const verboseLevels = useMemo(
    () => withCurrentLabeledOption(VERBOSE_LEVELS, draft.verboseLevel),
    [draft.verboseLevel],
  );
  const reasoningLevels = useMemo(
    () => withCurrentOption(REASONING_LEVELS, draft.reasoningLevel),
    [draft.reasoningLevel],
  );

  async function refreshWorkspaceData(sessionKey?: string | null) {
    const invalidations: Array<Promise<void>> = [
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["workspace-sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-session-transcript"] }),
    ];

    if (sessionKey) {
      invalidations.push(queryClient.invalidateQueries({ queryKey: messagesQueryKey(sessionKey) }));
    }

    await Promise.all(invalidations);
    await Promise.all([
      sessionsQuery.refetch(),
      sessionKey ? transcriptQuery.refetch() : Promise.resolve(transcriptQuery.data),
    ]);
  }

  function syncLocalChatSession(sessionKey: string, clearSelection: boolean) {
    clearChatSession(sessionKey);
    if (clearSelection && activeChatSessionId === sessionKey) {
      selectSession(null);
    }
  }

  function resetFilters() {
    setSearch("");
    setKindFilter("all");
    setSortBy("updated-desc");
    setGroupBy("kind");
    setActiveMinutes("1440");
    setLimit("200");
    setIncludeGlobal(true);
    setIncludeUnknown(false);
  }

  async function refreshAll() {
    setFeedback(null);
    await refreshWorkspaceData(selectedSession?.key ?? null);
  }

  async function renameSession() {
    if (!selectedSession) return;
    setBusyAction("rename");
    setFeedback(null);
    try {
      await gateway.request("sessions.patch", {
        key: selectedSession.key,
        label: draft.label.trim() || null,
      });
      setFeedback({
        type: "info",
        message: draft.label.trim()
          ? `Renamed ${selectedSession.key}.`
          : `Cleared custom label for ${selectedSession.key}.`,
      });
      await refreshWorkspaceData(selectedSession.key);
    } catch (error) {
      setFeedback({ type: "error", message: String(error) });
    } finally {
      setBusyAction(null);
    }
  }

  async function saveSessionDraft() {
    if (!selectedSession) return;
    setBusyAction("save");
    setFeedback(null);
    try {
      const isBinaryThinking = isBinaryThinkingProvider(selectedSession.modelProvider);
      await gateway.request("sessions.patch", {
        key: selectedSession.key,
        label: draft.label.trim() || null,
        thinkingLevel: resolveThinkLevelPatchValue(draft.thinkingLevel, isBinaryThinking),
        verboseLevel: draft.verboseLevel || null,
        reasoningLevel: draft.reasoningLevel || null,
      });
      setFeedback({ type: "info", message: `Saved overrides for ${selectedSession.key}.` });
      await refreshWorkspaceData(selectedSession.key);
    } catch (error) {
      setFeedback({ type: "error", message: String(error) });
    } finally {
      setBusyAction(null);
    }
  }

  async function resetSession() {
    if (!selectedSession) return;
    setBusyAction("reset");
    setFeedback(null);
    try {
      await gateway.request("sessions.reset", { key: selectedSession.key });
      syncLocalChatSession(selectedSession.key, false);
      setFeedback({ type: "info", message: `Reset ${selectedSession.key}.` });
      await refreshWorkspaceData(selectedSession.key);
    } catch (error) {
      setFeedback({ type: "error", message: String(error) });
    } finally {
      setBusyAction(null);
    }
  }

  async function removeSession(deleteTranscript: boolean) {
    if (!selectedSession || selectedSession.kind === "global") return;

    const actionLabel = deleteTranscript ? "Archive session" : "Delete session row";
    const description = deleteTranscript
      ? "Archives transcript files and removes the session entry."
      : "Removes the session entry without archiving transcript files.";
    const confirmed = window.confirm(`${actionLabel} \"${selectedSession.key}\"?\n\n${description}`);
    if (!confirmed) return;

    const deletedKey = selectedSession.key;
    const nextKey = nextSelectedKey(visibleSessions, deletedKey);
    setBusyAction(deleteTranscript ? "archive" : "delete");
    setFeedback(null);

    try {
      await gateway.request("sessions.delete", {
        key: deletedKey,
        deleteTranscript,
      });
      syncLocalChatSession(deletedKey, true);
      queryClient.removeQueries({ queryKey: messagesQueryKey(deletedKey) });
      setSelectedKey(nextKey === deletedKey ? null : nextKey);
      setFeedback({
        type: "info",
        message: deleteTranscript
          ? `Archived transcript and removed ${deletedKey}.`
          : `Removed session row ${deletedKey}.`,
      });
      await refreshWorkspaceData(nextKey);
    } catch (error) {
      setFeedback({ type: "error", message: String(error) });
    } finally {
      setBusyAction(null);
    }
  }

  function openInChat() {
    if (!selectedSession) return;
    const agentId = parseSessionAgentId(selectedSession.key);
    if (!agentId) return;
    selectAgent(agentId);
    selectSession(selectedSession.key);
    navigate("/chat");
  }

  const transcriptStatus = transcriptQuery.data?.status ?? "empty";
  const transcriptSource = transcriptQuery.data?.source ?? "preview";
  const chartMax = Math.max(summary.total, 1);
  const maxTopTokens = Math.max(...summary.topTokenRows.map((session) => sessionTokenTotal(session)), 1);

  return (
    <div className="sessions-page fade-in">
      <section className="sessions-card sessions-card--hero">
        <div className="sessions-card__row sessions-card__row--top">
          <div>
            <div className="sessions-card__eyebrow">Control Surface</div>
            <div className="sessions-card__title">Sessions</div>
            <div className="sessions-card__sub">Official-style session workspace for active keys, cached metrics, and per-session overrides.</div>
          </div>
          <div className="sessions-hero__actions">
            <button
              type="button"
              className="sessions-btn"
              onClick={refreshAll}
              disabled={!isConnected || sessionsQuery.isFetching}
            >
              {sessionsQuery.isFetching ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
              {sessionsQuery.isFetching ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="sessions-filters">
          <label className="sessions-field sessions-field--search">
            <span>Search</span>
            <div className="sessions-search">
              <Search size={14} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Key, label, preview, model, route"
              />
            </div>
          </label>

          <label className="sessions-field">
            <span>Kind</span>
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}>
              <option value="all">All</option>
              <option value="direct">Direct</option>
              <option value="group">Group</option>
              <option value="global">Global</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>

          <label className="sessions-field">
            <span>Sort</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SessionSort)}>
              <option value="updated-desc">Newest first</option>
              <option value="updated-asc">Oldest first</option>
              <option value="title-asc">Title A-Z</option>
              <option value="title-desc">Title Z-A</option>
              <option value="tokens-desc">Most tokens</option>
            </select>
          </label>

          <label className="sessions-field">
            <span>Group</span>
            <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as SessionGroupBy)}>
              <option value="kind">Kind</option>
              <option value="activity">Activity</option>
              <option value="provider">Provider</option>
              <option value="surface">Surface</option>
              <option value="none">None</option>
            </select>
          </label>

          <label className="sessions-field">
            <span>Active Within</span>
            <input value={activeMinutes} onChange={(event) => setActiveMinutes(event.target.value)} inputMode="numeric" />
          </label>

          <label className="sessions-field">
            <span>Row Limit</span>
            <input value={limit} onChange={(event) => setLimit(event.target.value)} inputMode="numeric" />
          </label>

          <label className="sessions-field sessions-field--checkbox">
            <input type="checkbox" checked={includeGlobal} onChange={(event) => setIncludeGlobal(event.target.checked)} />
            <span>Include global</span>
          </label>

          <label className="sessions-field sessions-field--checkbox">
            <input type="checkbox" checked={includeUnknown} onChange={(event) => setIncludeUnknown(event.target.checked)} />
            <span>Include unknown</span>
          </label>

          <div className="sessions-filters__actions">
            <button type="button" className="sessions-btn sessions-btn--ghost sessions-btn--sm" onClick={resetFilters}>
              <X size={14} />
              Reset filters
            </button>
          </div>
        </div>

        {(sessionsQuery.error || feedback) && (
          <div className={`sessions-callout ${(sessionsQuery.error || feedback?.type === "error") ? "is-danger" : "is-info"}`}>
            {sessionsQuery.error ? String(sessionsQuery.error) : feedback?.message}
          </div>
        )}

        <div className="sessions-meta-strip">
          <div className="sessions-meta-pill">
            <span>{sourceLabel}</span>
            <strong className="sessions-mono">{sessionsQuery.data?.path || "Gateway memory"}</strong>
          </div>
          <div className="sessions-meta-pill">
            <span>Visibility</span>
            <strong>{visibleSessions.length}/{serverCount} shown</strong>
          </div>
          <div className="sessions-meta-pill">
            <span>Connection</span>
            <strong>{isConnected ? "Connected" : "Disconnected"}</strong>
          </div>
        </div>

        <div className="sessions-stats-grid">
          <article className="sessions-stat-card">
            <span className="sessions-stat-card__label">Visible sessions</span>
            <strong className="sessions-stat-card__value">{summary.total}</strong>
            <p>{summary.hidden > 0 ? `${summary.hidden} hidden by current filters` : "All fetched rows are visible"}</p>
          </article>
          <article className="sessions-stat-card">
            <span className="sessions-stat-card__label">Kinds</span>
            <strong className="sessions-stat-card__value">{summary.direct} / {summary.group}</strong>
            <p>Global {summary.global} · Unknown {summary.unknown}</p>
          </article>
          <article className="sessions-stat-card">
            <span className="sessions-stat-card__label">Active recently</span>
            <strong className="sessions-stat-card__value">{summary.recent}</strong>
            <p>{summary.aborted > 0 ? `${summary.aborted} aborted rows flagged` : "No aborted rows in this view"}</p>
          </article>
          <article className="sessions-stat-card">
            <span className="sessions-stat-card__label">Cached tokens</span>
            <strong className="sessions-stat-card__value">{summary.tokens.toLocaleString()}</strong>
            <p>{summary.tokens > 0 ? "Token totals from session cache" : "Waiting for token-bearing rows"}</p>
          </article>
        </div>

        <div className="sessions-visual-grid">
          <section className="sessions-visual-card">
            <div className="sessions-visual-card__header">
              <h3>Session mix</h3>
              <p>Distribution by session kind.</p>
            </div>
            <div className="sessions-stacked-bar" aria-hidden="true">
              <span className="is-direct" style={{ width: percentage(summary.direct, chartMax) }} />
              <span className="is-group" style={{ width: percentage(summary.group, chartMax) }} />
              <span className="is-global" style={{ width: percentage(summary.global, chartMax) }} />
              <span className="is-unknown" style={{ width: percentage(summary.unknown, chartMax) }} />
            </div>
            <div className="sessions-legend">
              <span><i className="is-direct" />Direct {summary.direct}</span>
              <span><i className="is-group" />Group {summary.group}</span>
              <span><i className="is-global" />Global {summary.global}</span>
              <span><i className="is-unknown" />Unknown {summary.unknown}</span>
            </div>
          </section>

          <section className="sessions-visual-card">
            <div className="sessions-visual-card__header">
              <h3>Activity buckets</h3>
              <p>Updated recency across visible rows.</p>
            </div>
            <div className="sessions-bars">
              {summary.bucketCounts.map((bucket) => (
                <div key={bucket.label} className="sessions-bar-row">
                  <span>{bucket.label}</span>
                  <div className="sessions-bar-track">
                    <div className="sessions-bar-fill" style={{ width: percentage(bucket.count, chartMax) }} />
                  </div>
                  <strong>{bucket.count}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="sessions-visual-card">
            <div className="sessions-visual-card__header">
              <h3>Top token sessions</h3>
              <p>Largest cached token totals in the current view.</p>
            </div>
            {summary.topTokenRows.length === 0 ? (
              <div className="sessions-empty-inline">No token totals available yet.</div>
            ) : (
              <div className="sessions-bars sessions-bars--tokens">
                {summary.topTokenRows.map((session) => (
                  <div key={session.key} className="sessions-bar-row sessions-bar-row--token">
                    <span className="sessions-bar-row__label">{truncate(sessionTitle(session), 28)}</span>
                    <div className="sessions-bar-track">
                      <div className="sessions-bar-fill is-accent" style={{ width: percentage(sessionTokenTotal(session), maxTopTokens) }} />
                    </div>
                    <strong>{sessionTokenTotal(session).toLocaleString()}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>

      <div className="sessions-layout">
        <section className="sessions-card sessions-card--list">
          <div className="sessions-panel-header">
            <div>
              <div className="sessions-panel-header__title">Session list</div>
              <div className="sessions-panel-header__sub">Grouped, searchable, and sorted like the upstream Sessions workspace.</div>
            </div>
            <span className="sessions-pill">{groupedSessions.length} group{groupedSessions.length === 1 ? "" : "s"}</span>
          </div>

          <div className="sessions-table-head">
            <span>Session</span>
            <span>Status</span>
            <span>Updated</span>
            <span>Tokens</span>
          </div>

          {sessionsQuery.isLoading ? (
            <div className="sessions-state"><LoaderCircle size={16} className="spin" /> Loading sessions…</div>
          ) : visibleSessions.length === 0 ? (
            <div className="sessions-empty-inline">
              {summary.fetched === 0
                ? "No sessions are available for the current gateway filters."
                : "No sessions matched the current filters."}
            </div>
          ) : (
            <div className="sessions-group-list">
              {groupedSessions.map((group) => (
                <section key={group.id} className="sessions-group">
                  <header className="sessions-group__header">
                    <div>
                      <h3>{group.label}</h3>
                      <p>{group.description}</p>
                    </div>
                    <strong>{group.rows.reduce((sum, row) => sum + sessionTokenTotal(row), 0).toLocaleString()} tok</strong>
                  </header>

                  <div className="sessions-group__rows">
                    {group.rows.map((session) => {
                      const active = session.key === selectedSession?.key;
                      const activeChat = session.key === activeChatSessionId;
                      return (
                        <button
                          key={session.key}
                          type="button"
                          className={`sessions-row ${active ? "is-active" : ""}`}
                          aria-pressed={active}
                          onClick={() => setSelectedKey(session.key)}
                        >
                          <div className="sessions-row__primary">
                            <div className="sessions-row__title-line">
                              <span className="sessions-row__title">{truncate(sessionTitle(session), 54)}</span>
                              <div className="sessions-row__pills">
                                <span className={`sessions-kind-badge is-${session.kind}`}>{sessionKindLabel(session.kind)}</span>
                                {activeChat && <span className="sessions-kind-badge is-active-chat">active</span>}
                                {session.abortedLastRun && <span className="sessions-kind-badge is-danger">aborted</span>}
                              </div>
                            </div>
                            <div className="sessions-row__meta">
                              <span className="sessions-mono">{session.key}</span>
                              <span>{sessionLabel(session)}</span>
                              <span>{truncate(session.lastMessagePreview || sessionRoute(session), 90)}</span>
                            </div>
                          </div>

                          <div className="sessions-row__status">
                            <span className={`sessions-status-dot ${session.abortedLastRun ? "is-danger" : "is-ok"}`} />
                            <div>
                              <strong>{sessionSurface(session)}</strong>
                              <span>{truncate(sessionModel(session), 28)}</span>
                            </div>
                          </div>

                          <div className="sessions-row__updated">
                            <strong>{session.updatedAt ? formatRelativeTime(session.updatedAt) : "unknown"}</strong>
                            <span>{formatTimestamp(session.updatedAt)}</span>
                          </div>

                          <div className="sessions-row__tokens">
                            <strong>{sessionTokenSummary(session)}</strong>
                            <span>{sessionTokenBreakdown(session)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>

        <section className="sessions-card sessions-card--detail">
          <div className="sessions-panel-header">
            <div>
              <div className="sessions-panel-header__title">Session details</div>
              <div className="sessions-panel-header__sub">
                {selectedSession
                  ? `${selectedPosition} of ${visibleSessions.length} visible sessions`
                  : "Select a session to inspect tokens, model, timestamps, and transcript preview."}
              </div>
            </div>
            {selectedSession && (
              <span className={`sessions-pill ${selectedSession.abortedLastRun ? "is-danger" : "is-ok"}`}>
                {selectedSession.abortedLastRun ? "Aborted" : "Available"}
              </span>
            )}
          </div>

          {!selectedSession ? (
            <div className="sessions-empty-state">
              <FileText size={20} />
              <strong>No session selected</strong>
              <p>Choose a row from the list to inspect routing, overrides, and transcript preview.</p>
            </div>
          ) : (
            <div className="sessions-detail-stack">
              <section className="sessions-detail-hero">
                <div className="sessions-detail-hero__copy">
                  <div className="sessions-detail-hero__title">{sessionTitle(selectedSession)}</div>
                  <div className="sessions-detail-hero__subtitle sessions-mono">{selectedSession.key}</div>
                  <div className="sessions-detail-hero__meta">
                    <span>{selectedSession.updatedAt ? formatRelativeTime(selectedSession.updatedAt) : "Timestamp unavailable"}</span>
                    <span>{sessionSurface(selectedSession)}</span>
                    <span>{sessionRoute(selectedSession)}</span>
                    <span>{sessionModel(selectedSession)}</span>
                  </div>
                  <div className="sessions-detail-facts">
                    {sessionFacts(selectedSession).map((fact) => (
                      <span key={`${selectedSession.key}-${fact}`} className="sessions-fact-pill">{fact}</span>
                    ))}
                  </div>
                </div>

                <div className="sessions-detail-hero__actions">
                  <button
                    type="button"
                    className="sessions-btn sessions-btn--sm"
                    onClick={openInChat}
                    disabled={!canOpenInChat}
                  >
                    Open in Chat
                    <ArrowRight size={14} />
                  </button>
                  <button
                    type="button"
                    className="sessions-btn sessions-btn--ghost sessions-btn--sm"
                    onClick={() => {
                      labelInputRef.current?.focus();
                      labelInputRef.current?.select();
                    }}
                  >
                    <PencilLine size={14} />
                    Rename
                  </button>
                  <button
                    type="button"
                    className="sessions-btn sessions-btn--ghost sessions-btn--sm"
                    onClick={() => removeSession(true)}
                    disabled={busyAction !== null || selectedSession.kind === "global"}
                    title="Archive transcript and remove the session entry"
                  >
                    {busyAction === "archive" ? <LoaderCircle size={14} className="spin" /> : <Archive size={14} />}
                    Archive
                  </button>
                  <button
                    type="button"
                    className="sessions-btn sessions-btn--danger sessions-btn--sm"
                    onClick={() => removeSession(false)}
                    disabled={busyAction !== null || selectedSession.kind === "global"}
                    title="Remove the session entry without archiving transcript files"
                  >
                    {busyAction === "delete" ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}
                    Delete Row
                  </button>
                </div>
              </section>

              <div className="sessions-detail-metrics">
                <article className="sessions-detail-metric">
                  <span>Tokens</span>
                  <strong>{sessionTokenSummary(selectedSession)}</strong>
                  <p>{sessionTokenBreakdown(selectedSession)}</p>
                </article>
                <article className="sessions-detail-metric">
                  <span>Updated</span>
                  <strong>{selectedSession.updatedAt ? formatRelativeTime(selectedSession.updatedAt) : "—"}</strong>
                  <p>{formatTimestamp(selectedSession.updatedAt)}</p>
                </article>
                <article className="sessions-detail-metric">
                  <span>Transcript rows</span>
                  <strong>{transcriptItems.length.toLocaleString()}</strong>
                  <p>{transcriptStatusLabel(transcriptStatus)}</p>
                </article>
                <article className="sessions-detail-metric">
                  <span>Response usage</span>
                  <strong>{selectedSession.responseUsage ?? "inherit"}</strong>
                  <p>{selectedSession.totalTokensFresh === false ? "cached total may be stale" : "token cache looks fresh"}</p>
                </article>
              </div>

              <div className="sessions-detail-grid">
                <section className="sessions-detail-card">
                  <div className="sessions-detail-card__header">
                    <h3>Resolved defaults</h3>
                    <p>Workspace-level session defaults from the gateway.</p>
                  </div>
                  <div className="sessions-kv-list">
                    <div className="sessions-kv-row"><span>Provider</span><strong>{sessionsQuery.data?.defaults.modelProvider ?? "inherit"}</strong></div>
                    <div className="sessions-kv-row"><span>Model</span><strong>{sessionsQuery.data?.defaults.model ?? "inherit"}</strong></div>
                    <div className="sessions-kv-row"><span>Context</span><strong>{sessionsQuery.data?.defaults.contextTokens ?? "inherit"}</strong></div>
                    <div className="sessions-kv-row"><span>Store</span><strong>{sourceLabel}</strong></div>
                  </div>
                </section>

                <section className="sessions-detail-card">
                  <div className="sessions-detail-card__header">
                    <h3>Resolved session</h3>
                    <p>Model, policy, and session-scoped identity.</p>
                  </div>
                  <div className="sessions-kv-list">
                    <div className="sessions-kv-row"><span>Provider</span><strong>{selectedSession.modelProvider ?? "inherit"}</strong></div>
                    <div className="sessions-kv-row"><span>Model</span><strong>{selectedSession.model ?? "inherit"}</strong></div>
                    <div className="sessions-kv-row"><span>Context</span><strong>{selectedSession.contextTokens ?? sessionsQuery.data?.defaults.contextTokens ?? "inherit"}</strong></div>
                    <div className="sessions-kv-row"><span>Privileges</span><strong>{selectedSession.elevatedLevel ?? "standard"}</strong></div>
                    <div className="sessions-kv-row"><span>Send policy</span><strong>{selectedSession.sendPolicy ?? "allow"}</strong></div>
                    <div className="sessions-kv-row"><span>Response usage</span><strong>{selectedSession.responseUsage ?? "inherit"}</strong></div>
                  </div>
                </section>

                <section className="sessions-detail-card">
                  <div className="sessions-detail-card__header">
                    <h3>Routing</h3>
                    <p>Agent, surface, room, and delivery targeting.</p>
                  </div>
                  <div className="sessions-kv-list">
                    <div className="sessions-kv-row"><span>Agent</span><strong>{parseSessionAgentId(selectedSession.key) ?? "n/a"}</strong></div>
                    <div className="sessions-kv-row"><span>Session ID</span><strong>{selectedSession.sessionId ?? "unknown"}</strong></div>
                    <div className="sessions-kv-row"><span>Surface</span><strong>{sessionSurface(selectedSession)}</strong></div>
                    <div className="sessions-kv-row"><span>Route</span><strong>{sessionRoute(selectedSession)}</strong></div>
                    <div className="sessions-kv-row"><span>Last channel</span><strong>{selectedSession.lastChannel ?? selectedSession.deliveryContext?.channel ?? "—"}</strong></div>
                    <div className="sessions-kv-row"><span>Last recipient</span><strong>{selectedSession.lastTo ?? selectedSession.deliveryContext?.to ?? "—"}</strong></div>
                  </div>
                </section>

                <section className="sessions-detail-card">
                  <div className="sessions-detail-card__header">
                    <h3>Usage</h3>
                    <p>Cached usage counters and origin metadata.</p>
                  </div>
                  <div className="sessions-kv-list">
                    <div className="sessions-kv-row"><span>Input</span><strong>{formatTokenCount(selectedSession.inputTokens)}</strong></div>
                    <div className="sessions-kv-row"><span>Output</span><strong>{formatTokenCount(selectedSession.outputTokens)}</strong></div>
                    <div className="sessions-kv-row"><span>Total</span><strong>{sessionTokenSummary(selectedSession)}</strong></div>
                    <div className="sessions-kv-row"><span>Origin</span><strong>{selectedSession.originLabel ?? (selectedSession.systemSent ? "system" : "user")}</strong></div>
                    <div className="sessions-kv-row"><span>Account</span><strong>{selectedSession.lastAccountId ?? selectedSession.deliveryContext?.accountId ?? "—"}</strong></div>
                    <div className="sessions-kv-row"><span>Token cache</span><strong>{selectedSession.totalTokensFresh === false ? "stale" : "fresh"}</strong></div>
                  </div>
                </section>
              </div>

              <section className="sessions-detail-card sessions-detail-card--full">
                <div className="sessions-detail-card__header sessions-detail-card__header--actions">
                  <div>
                    <h3>Overrides</h3>
                    <p>Rename, patch per-session overrides, or reset the session while keeping workspace defaults.</p>
                  </div>
                  <div className="sessions-detail-actions">
                    <button
                      type="button"
                      className="sessions-btn sessions-btn--ghost sessions-btn--sm"
                      onClick={resetSession}
                      disabled={busyAction !== null}
                    >
                      {busyAction === "reset" ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />}
                      Reset
                    </button>
                    <button
                      type="button"
                      className="sessions-btn sessions-btn--ghost sessions-btn--sm"
                      onClick={renameSession}
                      disabled={busyAction !== null || !renameChanged}
                    >
                      {busyAction === "rename" ? <LoaderCircle size={14} className="spin" /> : <PencilLine size={14} />}
                      Rename
                    </button>
                    <button
                      type="button"
                      className="sessions-btn sessions-btn--primary sessions-btn--sm"
                      onClick={saveSessionDraft}
                      disabled={busyAction !== null || !draftChanged}
                    >
                      {busyAction === "save" ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
                      Save Overrides
                    </button>
                  </div>
                </div>

                <div className="sessions-editor-grid">
                  <label className="sessions-field sessions-field--full">
                    <span>Label</span>
                    <input
                      ref={labelInputRef}
                      value={draft.label}
                      onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                      placeholder="Optional label override"
                    />
                  </label>

                  <label className="sessions-field">
                    <span>Thinking Level</span>
                    <select
                      value={resolveThinkLevelDisplay(
                        draft.thinkingLevel,
                        isBinaryThinkingProvider(selectedSession.modelProvider),
                      )}
                      onChange={(event) => setDraft((current) => ({ ...current, thinkingLevel: event.target.value }))}
                    >
                      {thinkLevels.map((level) => (
                        <option key={level || "inherit"} value={level}>{level || "inherit"}</option>
                      ))}
                    </select>
                  </label>

                  <label className="sessions-field">
                    <span>Verbose Level</span>
                    <select
                      value={draft.verboseLevel}
                      onChange={(event) => setDraft((current) => ({ ...current, verboseLevel: event.target.value }))}
                    >
                      {verboseLevels.map((level) => (
                        <option key={level.value || "inherit"} value={level.value}>{level.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="sessions-field">
                    <span>Reasoning Level</span>
                    <select
                      value={draft.reasoningLevel}
                      onChange={(event) => setDraft((current) => ({ ...current, reasoningLevel: event.target.value }))}
                    >
                      {reasoningLevels.map((level) => (
                        <option key={level || "inherit"} value={level}>{level || "inherit"}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              <section className="sessions-detail-card sessions-detail-card--full">
                <div className="sessions-detail-card__header">
                  <div>
                    <h3>Transcript preview</h3>
                    <p>{transcriptStatusLabel(transcriptStatus)} · {transcriptSourceLabel(transcriptSource)} source</p>
                  </div>
                </div>

                {transcriptQuery.isLoading ? (
                  <div className="sessions-state"><LoaderCircle size={16} className="spin" /> Loading transcript preview…</div>
                ) : transcriptQuery.error ? (
                  <div className="sessions-callout is-danger">{String(transcriptQuery.error)}</div>
                ) : transcriptItems.length === 0 ? (
                  <div className="sessions-empty-inline">{transcriptStatusLabel(transcriptStatus)}</div>
                ) : (
                  <div className="sessions-preview-list">
                    {transcriptItems.map((item, index) => (
                      <div key={`${item.role}-${index}`} className="sessions-preview-row">
                        <span className={`sessions-preview-role is-${item.role}`}>{item.role}</span>
                        <span className="sessions-mono sessions-preview-body">{truncate(item.text, 280)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
