import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  FileText,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button, Card, StatusBadge } from "@/components/ui";
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

const THINK_LEVELS = ["", "off", "minimal", "low", "medium", "high", "xhigh"] as const;
const BINARY_THINK_LEVELS = ["", "off", "on"] as const;
const VERBOSE_LEVELS = [
  { value: "", label: "inherit" },
  { value: "off", label: "off (explicit)" },
  { value: "on", label: "on" },
  { value: "full", label: "full" },
] as const;
const REASONING_LEVELS = ["", "off", "on", "stream"] as const;

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

function sessionTitle(row: SessionRow): string {
  const preferred =
    row.label?.trim() ||
    row.displayName?.trim() ||
    row.derivedTitle?.trim() ||
    row.subject?.trim();
  return preferred || row.key;
}

function sessionFacts(row: SessionRow): string[] {
  const facts = [sessionKindLabel(row.kind)];
  if (row.surface) facts.push(row.surface);
  if (row.subject && row.subject !== sessionTitle(row)) facts.push(row.subject);
  if (row.room) facts.push(`room ${row.room}`);
  if (row.space) facts.push(`space ${row.space}`);
  if (row.modelProvider && row.model) facts.push(`${row.modelProvider}/${row.model}`);
  else if (row.model) facts.push(row.model);
  if (typeof row.totalTokens === "number") facts.push(`${row.totalTokens.toLocaleString()} tokens`);
  if (row.elevatedLevel) facts.push(`${row.elevatedLevel} privileges`);
  if (row.systemSent) facts.push("system-originated");
  if (row.abortedLastRun) facts.push("aborted last run");
  return facts;
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

function sessionLabel(row: SessionRow): string {
  const preferred = row.label?.trim() || row.displayName?.trim() || row.derivedTitle?.trim();
  return preferred || "—";
}

function sessionRoute(row: SessionRow): string {
  return row.room || row.space || row.subject || row.surface || "—";
}

function sessionModel(row: SessionRow): string {
  if (row.modelProvider && row.model) {
    return `${row.modelProvider}/${row.model}`;
  }
  return row.model || row.modelProvider || "inherit";
}

function sessionTokenSummary(row: SessionRow): string {
  if (typeof row.totalTokens !== "number") {
    return "—";
  }
  return row.totalTokens.toLocaleString();
}

function sessionTokenBreakdown(row: SessionRow): string {
  return `${(row.inputTokens ?? 0).toLocaleString()} in · ${(row.outputTokens ?? 0).toLocaleString()} out`;
}

function sessionTimestamp(row: SessionRow): string {
  return row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "No timestamp recorded";
}

function transcriptSourceLabel(source: "history" | "preview"): string {
  return source === "history" ? "History" : "Preview";
}

function sessionSearchText(row: SessionRow): string {
  return [
    row.key,
    row.label,
    row.displayName,
    row.derivedTitle,
    row.subject,
    row.surface,
    row.room,
    row.space,
    row.lastMessagePreview,
    row.model,
    row.modelProvider,
    row.sessionId,
    row.elevatedLevel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
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
        const tokenDelta = (right.totalTokens ?? -1) - (left.totalTokens ?? -1);
        return tokenDelta !== 0 ? tokenDelta : (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
      }
      case "updated-desc":
      default:
        return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    }
  });
  return sorted;
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
  if (rows.length === 0) {
    return null;
  }
  if (!currentKey) {
    return rows[0]?.key ?? null;
  }
  const currentIndex = rows.findIndex((row) => row.key === currentKey);
  if (currentIndex === -1) {
    return rows[0]?.key ?? null;
  }
  return rows[currentIndex + 1]?.key ?? rows[currentIndex - 1]?.key ?? null;
}

export function SessionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<SessionDraft>(buildDraft(null));
  const [busyAction, setBusyAction] = useState<"save" | "reset" | "delete" | null>(null);
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
      if (kindFilter !== "all" && session.kind !== kindFilter) {
        return false;
      }
      return !needle || sessionSearchText(session).includes(needle);
    });
    return sortSessions(filtered, sortBy);
  }, [allSessions, kindFilter, search, sortBy]);

  useEffect(() => {
    if (!selectedKey || !visibleSessions.some((session) => session.key === selectedKey)) {
      setSelectedKey(visibleSessions[0]?.key ?? null);
    }
  }, [selectedKey, visibleSessions]);

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
  const serverCount = sessionsQuery.data?.count ?? allSessions.length;

  const summary = useMemo(() => {
    return {
      total: visibleSessions.length,
      fetched: allSessions.length,
      hidden: Math.max(allSessions.length - visibleSessions.length, 0),
      direct: visibleSessions.filter((session) => session.kind === "direct").length,
      group: visibleSessions.filter((session) => session.kind === "group").length,
      global: visibleSessions.filter((session) => session.kind === "global").length,
      unknown: visibleSessions.filter((session) => session.kind === "unknown").length,
      aborted: visibleSessions.filter((session) => session.abortedLastRun).length,
      tokens: visibleSessions.reduce((sum, session) => sum + (session.totalTokens ?? 0), 0),
      recent: visibleSessions.filter((session) => {
        if (!session.updatedAt) return false;
        return Date.now() - session.updatedAt <= 24 * 60 * 60 * 1000;
      }).length,
    };
  }, [allSessions, visibleSessions]);

  const selectedPosition = selectedSession
    ? visibleSessions.findIndex((session) => session.key === selectedSession.key) + 1
    : 0;
  const sourceLabel = sessionsQuery.data?.path ? "Session store" : "Live gateway";

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
      selectedSession?.key ? transcriptQuery.refetch() : Promise.resolve(transcriptQuery.data),
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
    setActiveMinutes("1440");
    setLimit("200");
    setIncludeGlobal(true);
    setIncludeUnknown(false);
  }

  async function refreshAll() {
    setFeedback(null);
    await refreshWorkspaceData(selectedSession?.key ?? null);
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

  async function deleteSession() {
    if (!selectedSession || selectedSession.kind === "global") return;

    const confirmed = window.confirm(
      `Delete session "${selectedSession.key}"?\n\nDeletes the session entry and archives its transcript.`,
    );
    if (!confirmed) {
      return;
    }

    const deletedKey = selectedSession.key;
    const nextKey = nextSelectedKey(visibleSessions, deletedKey);

    setBusyAction("delete");
    setFeedback(null);
    try {
      await gateway.request("sessions.delete", {
        key: deletedKey,
        deleteTranscript: true,
      });
      syncLocalChatSession(deletedKey, true);
      queryClient.removeQueries({ queryKey: messagesQueryKey(deletedKey) });
      setSelectedKey(nextKey === deletedKey ? null : nextKey);
      setFeedback({ type: "info", message: `Deleted ${deletedKey}.` });
      await refreshWorkspaceData();
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

  if (!isConnected) {
    return (
      <div className="workspace-empty-state sessions-page sessions-page--empty">
        <FileText size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">Sessions</h2>
        <p className="workspace-subtitle">Connect a gateway to browse, patch, and inspect stored session state.</p>
      </div>
    );
  }

  const thinkLevels = withCurrentOption(
    resolveThinkLevelOptions(selectedSession?.modelProvider),
    resolveThinkLevelDisplay(
      draft.thinkingLevel,
      isBinaryThinkingProvider(selectedSession?.modelProvider),
    ),
  );
  const verboseLevels = withCurrentLabeledOption(VERBOSE_LEVELS, draft.verboseLevel);
  const reasoningLevels = withCurrentOption(REASONING_LEVELS, draft.reasoningLevel);
  const transcriptStatus = transcriptQuery.data?.status ?? "empty";
  const transcriptSource = transcriptQuery.data?.source ?? "preview";
  return (
    <div className="workspace-page sessions-page">
      <section className="sessions-toolbar-shell">
        <div className="workspace-toolbar sessions-toolbar">
          <div className="sessions-toolbar__copy">
            <span className="sessions-toolbar__eyebrow">Gateway Sessions</span>
            <h2 className="workspace-title">Sessions</h2>
            <p className="workspace-subtitle">
              Inspect live session rows, tune per-session overrides, and sanity-check transcript state without leaving OpenClaw.
            </p>
          </div>
          <div className="workspace-toolbar__actions sessions-toolbar__actions">
            <div className="sessions-toolbar__meta">
              <span>Source</span>
              <strong>{sourceLabel}</strong>
            </div>
            <div className="sessions-toolbar__meta">
              <span>Selection</span>
              <strong>{selectedSession ? `${selectedPosition}/${visibleSessions.length}` : "—"}</strong>
            </div>
            <Button variant="secondary" onClick={refreshAll} loading={sessionsQuery.isFetching || transcriptQuery.isFetching}>
              <RefreshCw size={14} />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      {sessionsQuery.error && (
        <div className="workspace-alert workspace-alert--error">{String(sessionsQuery.error)}</div>
      )}
      {feedback && (
        <div className={`workspace-alert ${feedback.type === "error" ? "workspace-alert--error" : "workspace-alert--info"}`}>
          {feedback.message}
        </div>
      )}

      <div className="sessions-summary-strip">
        <div className="sessions-summary-pill">
          <div className="sessions-summary-pill__value">
            <span>Visible Sessions</span>
            <strong>{summary.total}</strong>
          </div>
          <p>{summary.hidden > 0 ? `${summary.hidden} filtered out by search or kind` : "All fetched rows are visible"}</p>
        </div>
        <div className="sessions-summary-pill">
          <div className="sessions-summary-pill__value">
            <span>Direct / Group</span>
            <strong>{summary.direct} / {summary.group}</strong>
          </div>
          <p>Global {summary.global} · Unknown {summary.unknown}</p>
        </div>
        <div className="sessions-summary-pill">
          <div className="sessions-summary-pill__value">
            <span>Updated Today</span>
            <strong>{summary.recent}</strong>
          </div>
          <p>{summary.aborted > 0 ? `${summary.aborted} marked aborted` : "No aborted sessions in view"}</p>
        </div>
        <div className="sessions-summary-pill">
          <div className="sessions-summary-pill__value">
            <span>Cached Tokens</span>
            <strong>{summary.tokens.toLocaleString()}</strong>
          </div>
          <p>{summary.total > 0 ? `Across ${summary.total} visible sessions` : "Waiting for session rows"}</p>
        </div>
      </div>

      <div className="sessions-layout">
        <Card className="sessions-panel sessions-panel--index" padding={false}>
          <div className="sessions-panel__header sessions-panel__header--index">
            <div className="workspace-section__header">
              <div>
                <h3>Sessions</h3>
                <p>Search, sort, and inspect live session rows from the connected gateway.</p>
              </div>
              <StatusBadge status="connected" label={`${visibleSessions.length}/${serverCount} shown`} />
            </div>

            <div className="session-filters sessions-filters-grid">
              <label className="session-field session-field--search">
                <span>Search</span>
                <div className="session-search">
                  <Search size={14} />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Key, label, preview, model, route" />
                </div>
              </label>

              <label className="session-field">
                <span>Kind</span>
                <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}>
                  <option value="all">All</option>
                  <option value="direct">Direct</option>
                  <option value="group">Group</option>
                  <option value="global">Global</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>

              <label className="session-field">
                <span>Sort</span>
                <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SessionSort)}>
                  <option value="updated-desc">Newest first</option>
                  <option value="updated-asc">Oldest first</option>
                  <option value="title-asc">Title A-Z</option>
                  <option value="title-desc">Title Z-A</option>
                  <option value="tokens-desc">Most tokens</option>
                </select>
              </label>

              <label className="session-field">
                <span>Active Within</span>
                <input value={activeMinutes} onChange={(event) => setActiveMinutes(event.target.value)} inputMode="numeric" />
              </label>

              <label className="session-field">
                <span>Row Limit</span>
                <input value={limit} onChange={(event) => setLimit(event.target.value)} inputMode="numeric" />
              </label>

              <label className="session-field session-field--checkbox">
                <input type="checkbox" checked={includeGlobal} onChange={(event) => setIncludeGlobal(event.target.checked)} />
                <span>Include global sessions</span>
              </label>

              <label className="session-field session-field--checkbox">
                <input type="checkbox" checked={includeUnknown} onChange={(event) => setIncludeUnknown(event.target.checked)} />
                <span>Include unknown sessions</span>
              </label>

              <div className="workspace-toolbar__actions sessions-filters-grid__actions">
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  <X size={14} />
                  Reset filters
                </Button>
              </div>
            </div>

            <div className="sessions-store-path">
              {sessionsQuery.data?.path ? (
                <>
                  <span className="sessions-store-path__label">Store</span>
                  <span className="sessions-store-path__value mono">{sessionsQuery.data.path}</span>
                </>
              ) : (
                <>
                  <span className="sessions-store-path__label">Source</span>
                  <span className="sessions-store-path__value">Live gateway session rows</span>
                </>
              )}
            </div>
          </div>

          {sessionsQuery.isLoading ? (
            <div className="sessions-panel__state workspace-inline-status"><LoaderCircle size={16} className="spin" /> Loading sessions…</div>
          ) : visibleSessions.length === 0 ? (
            <div className="sessions-panel__state workspace-empty-inline">
              {summary.fetched === 0 ? "No sessions are available for the current gateway filters." : "No sessions matched the current filters."}
            </div>
          ) : (
            <div className="sessions-panel__scroll sessions-panel__scroll--index">
              <div className="sessions-table-wrap">
                <div className="sessions-table-head">
                  <span>Key</span>
                  <span>Label</span>
                  <span>Kind</span>
                  <span>Updated</span>
                  <span>Tokens</span>
                  <span>Route</span>
                </div>

                <div className="sessions-table-body">
                  {visibleSessions.map((session) => {
                    const active = session.key === selectedSession?.key;
                    return (
                      <button
                        key={session.key}
                        type="button"
                        className={`sessions-table-row ${active ? "active" : ""}`}
                        aria-pressed={active}
                        onClick={() => setSelectedKey(session.key)}
                      >
                        <div className="sessions-table-cell sessions-table-cell--primary">
                          <span className="sessions-table-text">{truncate(sessionTitle(session), 48)}</span>
                          <span className="sessions-table-subtext mono">{session.key}</span>
                        </div>

                        <div className="sessions-table-cell">
                          <span className={`sessions-table-text ${session.label?.trim() ? "" : "sessions-table-text--muted"}`}>
                            {truncate(session.label?.trim() || "No label override", 40)}
                          </span>
                          <span className="sessions-table-subtext sessions-table-subtext--wrap">
                            {session.lastMessagePreview ? truncate(session.lastMessagePreview, 120) : "No cached preview available."}
                          </span>
                        </div>

                        <div className="sessions-table-cell">
                          <StatusBadge status={session.abortedLastRun ? "error" : "connected"} label={sessionKindLabel(session.kind)} />
                          <span className={`sessions-table-subtext ${session.abortedLastRun ? "sessions-table-subtext--danger" : ""}`}>
                            {session.abortedLastRun ? "Needs attention" : session.systemSent ? "System-originated" : "Available"}
                          </span>
                        </div>

                        <div className="sessions-table-cell">
                          <span className="sessions-table-text">{session.updatedAt ? formatRelativeTime(session.updatedAt) : "unknown"}</span>
                          <span className="sessions-table-subtext">{sessionTimestamp(session)}</span>
                        </div>

                        <div className="sessions-table-cell">
                          <span className="sessions-table-text">{sessionTokenSummary(session)}</span>
                          <span className="sessions-table-subtext">{sessionTokenBreakdown(session)}</span>
                        </div>

                        <div className="sessions-table-cell">
                          <span className="sessions-table-text">{truncate(sessionRoute(session), 36)}</span>
                          <span className="sessions-table-subtext">{truncate(sessionModel(session), 44)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="sessions-panel sessions-panel--detail" padding={false}>
          <div className="sessions-panel__header sessions-panel__header--detail">
            <div className="workspace-section__header">
              <div>
                <h3>{selectedSession ? sessionTitle(selectedSession) : "Session Details"}</h3>
                <p>
                  {selectedSession
                    ? `${selectedSession.key} · ${selectedPosition} of ${visibleSessions.length} visible sessions`
                    : "Select a session to inspect routing, overrides, and transcript preview."}
                </p>
              </div>
              {selectedSession && (
                <StatusBadge
                  status={selectedSession.abortedLastRun ? "error" : "connected"}
                  label={selectedSession.abortedLastRun ? "Aborted" : "Available"}
                />
              )}
            </div>
          </div>

          <div className="sessions-panel__scroll sessions-panel__scroll--detail">
            {!selectedSession ? (
              <div className="workspace-empty-inline">Select a session from the list to view settings and preview.</div>
            ) : (
              <div className="sessions-detail-stack">
                <div className="sessions-detail-hero">
                  <div className="sessions-detail-hero__copy">
                    <div className="sessions-detail-hero__title">{sessionTitle(selectedSession)}</div>
                    <div className="sessions-detail-hero__subtitle mono">{selectedSession.key}</div>
                    <div className="sessions-detail-hero__meta">
                      <span>{selectedSession.updatedAt ? formatRelativeTime(selectedSession.updatedAt) : "Timestamp unavailable"}</span>
                      <span>{sessionRoute(selectedSession)}</span>
                      <span>{sessionModel(selectedSession)}</span>
                    </div>
                  </div>

                  <div className="sessions-detail-hero__side">
                    <div className="sessions-detail-hero__stats">
                      <div className="sessions-detail-stat">
                        <span>Tokens</span>
                        <strong>{sessionTokenSummary(selectedSession)}</strong>
                      </div>
                      <div className="sessions-detail-stat">
                        <span>Preview Rows</span>
                        <strong>{transcriptItems.length.toLocaleString()}</strong>
                      </div>
                    </div>

                    <div className="sessions-detail-hero__actions">
                      <StatusBadge
                        status={selectedSession.abortedLastRun ? "error" : "connected"}
                        label={selectedSession.abortedLastRun ? "Aborted" : "Available"}
                      />
                      <Button size="sm" onClick={openInChat} disabled={!canOpenInChat || !selectedSession}>
                        Open in Chat
                        <ArrowRight size={14} />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="sessions-detail-facts">
                  {sessionFacts(selectedSession).map((fact) => (
                    <span key={`${selectedSession.key}-${fact}`} className="sessions-fact-pill">{fact}</span>
                  ))}
                </div>

                <div className="sessions-detail-grid">
                  <section className="sessions-detail-card">
                    <div className="sessions-detail-card__header">
                      <h4>Resolved Defaults</h4>
                      <p>Workspace-level defaults.</p>
                    </div>
                    <div className="sessions-kv-list">
                      <div className="sessions-kv-row"><span>Provider</span><strong>{sessionsQuery.data?.defaults.modelProvider ?? "inherit"}</strong></div>
                      <div className="sessions-kv-row"><span>Model</span><strong>{sessionsQuery.data?.defaults.model ?? "inherit"}</strong></div>
                      <div className="sessions-kv-row"><span>Context</span><strong>{sessionsQuery.data?.defaults.contextTokens ?? "inherit"}</strong></div>
                    </div>
                  </section>

                  <section className="sessions-detail-card">
                    <div className="sessions-detail-card__header">
                      <h4>Resolved Session</h4>
                      <p>Overrides resolved for this session.</p>
                    </div>
                    <div className="sessions-kv-list">
                      <div className="sessions-kv-row"><span>Provider</span><strong>{selectedSession.modelProvider ?? "inherit"}</strong></div>
                      <div className="sessions-kv-row"><span>Model</span><strong>{selectedSession.model ?? "inherit"}</strong></div>
                      <div className="sessions-kv-row"><span>Context</span><strong>{selectedSession.contextTokens ?? sessionsQuery.data?.defaults.contextTokens ?? "inherit"}</strong></div>
                      <div className="sessions-kv-row"><span>Privileges</span><strong>{selectedSession.elevatedLevel ?? "standard"}</strong></div>
                    </div>
                  </section>

                  <section className="sessions-detail-card">
                    <div className="sessions-detail-card__header">
                      <h4>Usage</h4>
                      <p>Cached token and origin signals.</p>
                    </div>
                    <div className="sessions-kv-list">
                      <div className="sessions-kv-row"><span>Input</span><strong>{(selectedSession.inputTokens ?? 0).toLocaleString()}</strong></div>
                      <div className="sessions-kv-row"><span>Output</span><strong>{(selectedSession.outputTokens ?? 0).toLocaleString()}</strong></div>
                      <div className="sessions-kv-row"><span>Total</span><strong>{(selectedSession.totalTokens ?? 0).toLocaleString()}</strong></div>
                      <div className="sessions-kv-row"><span>Origin</span><strong>{selectedSession.systemSent ? "system" : "user"}</strong></div>
                    </div>
                  </section>

                  <section className="sessions-detail-card">
                    <div className="sessions-detail-card__header">
                      <h4>Routing</h4>
                      <p>Agent, route, and surface identity.</p>
                    </div>
                    <div className="sessions-kv-list">
                      <div className="sessions-kv-row"><span>Agent</span><strong>{parseSessionAgentId(selectedSession.key) ?? "n/a"}</strong></div>
                      <div className="sessions-kv-row"><span>Session ID</span><strong>{selectedSession.sessionId ?? "unknown"}</strong></div>
                      <div className="sessions-kv-row"><span>Surface</span><strong>{selectedSession.surface ?? "unknown"}</strong></div>
                      <div className="sessions-kv-row"><span>Route</span><strong>{sessionRoute(selectedSession)}</strong></div>
                    </div>
                  </section>
                </div>

                <section className="sessions-detail-card sessions-detail-card--full">
                  <div className="workspace-section__header compact">
                    <div>
                      <h4>Overrides</h4>
                      <p>Patch only session-level overrides; workspace defaults remain unchanged.</p>
                    </div>
                    <div className="workspace-toolbar__actions">
                      <Button variant="secondary" size="sm" onClick={resetSession} loading={busyAction === "reset"}>
                        <RotateCcw size={14} />
                        Reset
                      </Button>
                      <Button variant="danger" size="sm" onClick={deleteSession} loading={busyAction === "delete"} disabled={selectedSession.kind === "global"}>
                        <Trash2 size={14} />
                        Delete
                      </Button>
                      <Button size="sm" onClick={saveSessionDraft} loading={busyAction === "save"} disabled={!draftChanged}>
                        <Save size={14} />
                        Save Overrides
                      </Button>
                    </div>
                  </div>

                  <div className="session-editor-grid sessions-editor-grid">
                    <label className="session-field sessions-editor-grid__label">
                      <span>Label</span>
                      <input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Optional label override" />
                    </label>

                    <label className="session-field">
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

                    <label className="session-field">
                      <span>Verbose Level</span>
                      <select value={draft.verboseLevel} onChange={(event) => setDraft((current) => ({ ...current, verboseLevel: event.target.value }))}>
                        {verboseLevels.map((level) => (
                          <option key={level.value || "inherit"} value={level.value}>{level.label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="session-field">
                      <span>Reasoning Level</span>
                      <select value={draft.reasoningLevel} onChange={(event) => setDraft((current) => ({ ...current, reasoningLevel: event.target.value }))}>
                        {reasoningLevels.map((level) => (
                          <option key={level || "inherit"} value={level}>{level || "inherit"}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>

                <section className="sessions-detail-card sessions-detail-card--full">
                  <div className="workspace-section__header compact">
                    <div>
                      <h4>Transcript Preview</h4>
                      <p>{transcriptStatusLabel(transcriptStatus)} · {transcriptSourceLabel(transcriptSource)} source</p>
                    </div>
                  </div>

                  {transcriptQuery.isLoading ? (
                    <div className="workspace-inline-status"><LoaderCircle size={16} className="spin" /> Loading transcript preview…</div>
                  ) : transcriptQuery.error ? (
                    <div className="workspace-alert workspace-alert--error">{String(transcriptQuery.error)}</div>
                  ) : transcriptItems.length === 0 ? (
                    <div className="workspace-empty-inline">{transcriptStatusLabel(transcriptStatus)}</div>
                  ) : (
                    <div className="session-preview-list sessions-preview-list">
                      {transcriptItems.map((item, index) => (
                        <div key={`${item.role}-${index}`} className="session-preview-row sessions-preview-row">
                          <span className={`detail-pill session-preview-row__role session-preview-row__role--${item.role}`}>{item.role}</span>
                          <span className="mono sessions-preview-row__body">{truncate(item.text, 240)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
