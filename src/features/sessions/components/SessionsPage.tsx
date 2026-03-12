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
import { isChineseLanguage, useAppPreferencesStore } from "@/features/preferences/store";
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

function sessionKindLabel(kind: SessionKind, isChinese: boolean): string {
  switch (kind) {
    case "direct":
      return isChinese ? "直接" : "Direct";
    case "group":
      return isChinese ? "群组" : "Group";
    case "global":
      return isChinese ? "全局" : "Global";
    case "unknown":
    default:
      return isChinese ? "未知" : "Unknown";
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

function sessionSurface(row: SessionRow, isChinese: boolean): string {
  return row.surface || row.channel || row.originLabel || (isChinese ? "未知界面来源" : "Unknown surface");
}

function sessionRoute(row: SessionRow): string {
  return row.room || row.groupChannel || row.space || row.subject || row.lastTo || "—";
}

function sessionModel(row: SessionRow, isChinese: boolean): string {
  if (row.modelProvider && row.model) {
    return `${row.modelProvider}/${row.model}`;
  }
  return row.model || row.modelProvider || (isChinese ? "继承" : "inherit");
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

function sessionTokenBreakdown(row: SessionRow, isChinese: boolean): string {
  return isChinese
    ? `${(row.inputTokens ?? 0).toLocaleString()} 输入 · ${(row.outputTokens ?? 0).toLocaleString()} 输出`
    : `${(row.inputTokens ?? 0).toLocaleString()} in · ${(row.outputTokens ?? 0).toLocaleString()} out`;
}

function formatTimestamp(value: number | null | undefined, language: string, isChinese: boolean): string {
  return value ? new Date(value).toLocaleString(language) : (isChinese ? "没有记录时间戳" : "No timestamp recorded");
}

function transcriptSourceLabel(source: "history" | "preview", isChinese: boolean): string {
  if (source === "history") {
    return isChinese ? "历史记录" : "History";
  }
  return isChinese ? "预览" : "Preview";
}

function transcriptStatusLabel(status: "ok" | "empty" | "missing" | "error", isChinese: boolean): string {
  switch (status) {
    case "ok":
      return isChinese ? "转录已就绪" : "Transcript ready";
    case "empty":
      return isChinese ? "转录为空" : "Transcript is empty";
    case "missing":
      return isChinese ? "缺少转录" : "Transcript missing";
    case "error":
    default:
      return isChinese ? "转录不可用" : "Transcript unavailable";
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

function activityBucketLabel(bucket: (typeof ACTIVITY_BUCKETS)[number], isChinese: boolean): string {
  if (!isChinese) return bucket;
  switch (bucket) {
    case "Updated in hour":
      return "1 小时内更新";
    case "Updated today":
      return "今天更新";
    case "Updated this week":
      return "本周更新";
    case "Older":
    default:
      return "更早";
  }
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

function groupSessions(rows: SessionRow[], groupBy: SessionGroupBy, isChinese: boolean): SessionGroup[] {
  if (groupBy === "none") {
    return [{
      id: "all",
      label: isChinese ? "全部会话" : "All Sessions",
      description: isChinese ? `显示 ${rows.length} 条` : `${rows.length} visible`,
      rows,
    }];
  }

  const groups = new Map<string, SessionRow[]>();
  for (const row of rows) {
    const label =
      groupBy === "kind"
        ? sessionKindLabel(row.kind, isChinese)
        : groupBy === "provider"
          ? row.modelProvider || (isChinese ? "继承提供商" : "Inherited provider")
          : groupBy === "surface"
            ? sessionSurface(row, isChinese)
            : activityBucketLabel(sessionActivityBucket(row), isChinese);
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
      description: isChinese
        ? `${groupedRows.length} 个会话`
        : `${groupedRows.length} session${groupedRows.length === 1 ? "" : "s"}`,
      rows: groupedRows,
    }));
}

function sessionFacts(row: SessionRow, isChinese: boolean): string[] {
  const facts = [sessionKindLabel(row.kind, isChinese)];
  const surface = sessionSurface(row, isChinese);
  if (surface) facts.push(surface);
  if (row.subject && row.subject !== sessionTitle(row)) facts.push(row.subject);
  if (row.room || row.groupChannel) facts.push(isChinese ? `房间 ${row.room || row.groupChannel}` : `room ${row.room || row.groupChannel}`);
  if (row.space) facts.push(isChinese ? `空间 ${row.space}` : `space ${row.space}`);
  if (row.modelProvider && row.model) facts.push(`${row.modelProvider}/${row.model}`);
  else if (row.model) facts.push(row.model);
  if (sessionTokenTotal(row) > 0) facts.push(`${sessionTokenTotal(row).toLocaleString()} ${isChinese ? "Tokens" : "tokens"}`);
  if (row.elevatedLevel) facts.push(isChinese ? `${row.elevatedLevel} 权限` : `${row.elevatedLevel} privileges`);
  if (row.sendPolicy) facts.push(isChinese ? `发送 ${row.sendPolicy}` : `send ${row.sendPolicy}`);
  if (row.responseUsage) facts.push(isChinese ? `用量 ${row.responseUsage}` : `usage ${row.responseUsage}`);
  if (row.systemSent) facts.push(isChinese ? "系统发起" : "system-originated");
  if (row.abortedLastRun) facts.push(isChinese ? "上次运行已中止" : "aborted last run");
  return facts;
}

function percentage(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.max(4, Math.round((value / total) * 100))}%`;
}

export function SessionsPage() {
  const language = useAppPreferencesStore((store) => store.language);
  const isChinese = isChineseLanguage(language);
  const pageCopy = isChinese
    ? {
        eyebrow: "控制台",
        title: "会话",
        subtitle: "官方风格的会话工作区，用于查看活跃 Key、缓存指标和会话级覆盖配置。",
        loading: "加载中…",
        refresh: "刷新",
        search: "搜索",
        searchPlaceholder: "Key、标签、预览、模型、路由",
        kind: "类型",
        all: "全部",
        direct: "直接",
        group: "群组",
        global: "全局",
        unknown: "未知",
        sort: "排序",
        newestFirst: "最新优先",
        oldestFirst: "最旧优先",
        titleAsc: "标题 A-Z",
        titleDesc: "标题 Z-A",
        mostTokens: "最多 Tokens",
        groupBy: "分组",
        activity: "活跃度",
        provider: "提供商",
        surface: "界面来源",
        none: "无",
        activeWithin: "活跃时间内",
        rowLimit: "行数上限",
        includeGlobal: "包含全局",
        includeUnknown: "包含未知",
        resetFilters: "重置筛选",
        gatewayMemory: "网关内存",
        visibility: "可见性",
        shown: "已显示",
        connection: "连接",
        connected: "已连接",
        disconnected: "未连接",
        visibleSessions: "可见会话",
        hiddenByFilters: (count: number) => `${count} 条被当前筛选隐藏`,
        allVisible: "所有已拉取行都可见",
        kinds: "类型",
        activeRecently: "最近活跃",
        abortedRows: (count: number) => `${count} 条标记为中止`,
        noAborted: "当前视图没有中止记录",
        cachedTokens: "缓存 Tokens",
        tokenCacheWaiting: "等待带有 Token 的记录",
        tokenCacheReady: "来自会话缓存的 Token 总数",
        sessionMix: "会话分布",
        sessionMixDetail: "按会话类型分布。",
        activityBuckets: "活跃桶",
        activityBucketsDetail: "可见记录的最近更新时间分布。",
        topTokenSessions: "高 Token 会话",
        topTokenSessionsDetail: "当前视图中缓存 Token 总数最高的会话。",
        noTokenTotals: "还没有可用的 Token 总数。",
        sessionList: "会话列表",
        sessionListDetail: "像上游 Sessions 工作区一样支持分组、搜索和排序。",
        groups: (count: number) => `${count} 组`,
        session: "会话",
        status: "状态",
        updated: "更新时间",
        tokens: "Tokens",
        loadingSessions: "正在加载会话…",
        noSessionsForGateway: "当前网关筛选条件下没有会话。",
        noSessionsMatched: "没有会话匹配当前筛选条件。",
        active: "活跃",
        aborted: "已中止",
        unknownTime: "未知",
        sessionDetails: "会话详情",
        selectSessionHint: "选择一个会话以查看 tokens、模型、时间戳和转录预览。",
        available: "可用",
        noSessionSelected: "未选择会话",
        chooseSessionHint: "从列表中选择一行以查看路由、覆盖项和转录预览。",
        timestampUnavailable: "时间戳不可用",
        openInChat: "在聊天中打开",
        rename: "重命名",
        archive: "归档",
        deleteRow: "删除行",
        archiveTitle: "归档转录并移除会话条目",
        deleteTitle: "移除会话条目但不归档转录文件",
        transcriptRows: "转录行数",
        responseUsage: "响应用量",
        cachedTotalMayBeStale: "缓存总数可能已过期",
        tokenCacheFresh: "Token 缓存看起来是新的",
        resolvedDefaults: "默认解析值",
        resolvedDefaultsDetail: "来自网关的工作区级会话默认值。",
        resolvedSession: "会话解析值",
        resolvedSessionDetail: "模型、策略和会话级身份。",
        routing: "路由",
        routingDetail: "Agent、界面来源、房间和投递目标。",
        usage: "用量",
        usageDetail: "缓存的用量计数和来源元数据。",
        overrides: "覆盖项",
        overridesDetail: "重命名、补丁单会话覆盖项，或在保留工作区默认值的同时重置会话。",
        reset: "重置",
        saveOverrides: "保存覆盖项",
        label: "标签",
        optionalLabelOverride: "可选标签覆盖",
        thinkingLevel: "思考级别",
        verboseLevel: "详细级别",
        reasoningLevel: "推理级别",
        inherit: "继承",
        transcriptPreview: "转录预览",
        loadingTranscript: "正在加载转录预览…",
        transcriptSourceSuffix: "来源",
        sessionStore: "会话存储",
        liveGateway: "实时网关",
        sessionMixTitle: "会话分布",
        sessionListTitle: "会话列表",
        providerLabel: "提供商",
        modelLabel: "模型",
        contextLabel: "上下文",
        storeLabel: "存储来源",
        privilegesLabel: "权限",
        sendPolicyLabel: "发送策略",
        agentLabel: "智能体",
        sessionIdLabel: "会话 ID",
        surfaceLabel: "界面来源",
        routeLabel: "路由",
        lastChannelLabel: "最近渠道",
        lastRecipientLabel: "最近接收方",
        inputLabel: "输入",
        outputLabel: "输出",
        totalLabel: "总计",
        originLabel: "来源",
        accountLabel: "账号",
        tokenCacheLabel: "Token 缓存",
        fresh: "最新",
        stale: "过期",
        system: "系统",
        user: "用户",
        standard: "标准",
        allow: "允许",
        notAvailable: "不可用",
        errorPrefix: "错误",
        resetSuccess: (key: string) => `已重置 ${key}。`,
        saveSuccess: (key: string) => `已保存 ${key} 的覆盖项。`,
        renameSuccess: (key: string) => `已重命名 ${key}。`,
        clearLabelSuccess: (key: string) => `已清除 ${key} 的自定义标签。`,
        archiveConfirmTitle: "归档会话",
        deleteConfirmTitle: "删除会话行",
        archiveConfirmDescription: "会归档转录文件并移除该会话条目。",
        deleteConfirmDescription: "只会移除会话条目，不会归档转录文件。",
        archiveSuccess: (key: string) => `已归档转录并移除 ${key}。`,
        deleteSuccess: (key: string) => `已移除会话行 ${key}。`,
      }
    : {
        eyebrow: "Control Surface",
        title: "Sessions",
        subtitle: "Official-style session workspace for active keys, cached metrics, and per-session overrides.",
        loading: "Loading…",
        refresh: "Refresh",
        search: "Search",
        searchPlaceholder: "Key, label, preview, model, route",
        kind: "Kind",
        all: "All",
        direct: "Direct",
        group: "Group",
        global: "Global",
        unknown: "Unknown",
        sort: "Sort",
        newestFirst: "Newest first",
        oldestFirst: "Oldest first",
        titleAsc: "Title A-Z",
        titleDesc: "Title Z-A",
        mostTokens: "Most tokens",
        groupBy: "Group",
        activity: "Activity",
        provider: "Provider",
        surface: "Surface",
        none: "None",
        activeWithin: "Active Within",
        rowLimit: "Row Limit",
        includeGlobal: "Include global",
        includeUnknown: "Include unknown",
        resetFilters: "Reset filters",
        gatewayMemory: "Gateway memory",
        visibility: "Visibility",
        shown: "shown",
        connection: "Connection",
        connected: "Connected",
        disconnected: "Disconnected",
        visibleSessions: "Visible sessions",
        hiddenByFilters: (count: number) => `${count} hidden by current filters`,
        allVisible: "All fetched rows are visible",
        kinds: "Kinds",
        activeRecently: "Active recently",
        abortedRows: (count: number) => `${count} aborted rows flagged`,
        noAborted: "No aborted rows in this view",
        cachedTokens: "Cached tokens",
        tokenCacheWaiting: "Waiting for token-bearing rows",
        tokenCacheReady: "Token totals from session cache",
        sessionMix: "Session mix",
        sessionMixDetail: "Distribution by session kind.",
        activityBuckets: "Activity buckets",
        activityBucketsDetail: "Updated recency across visible rows.",
        topTokenSessions: "Top token sessions",
        topTokenSessionsDetail: "Largest cached token totals in the current view.",
        noTokenTotals: "No token totals available yet.",
        sessionList: "Session list",
        sessionListDetail: "Grouped, searchable, and sorted like the upstream Sessions workspace.",
        groups: (count: number) => `${count} group${count === 1 ? "" : "s"}`,
        session: "Session",
        status: "Status",
        updated: "Updated",
        tokens: "Tokens",
        loadingSessions: "Loading sessions…",
        noSessionsForGateway: "No sessions are available for the current gateway filters.",
        noSessionsMatched: "No sessions matched the current filters.",
        active: "active",
        aborted: "aborted",
        unknownTime: "unknown",
        sessionDetails: "Session details",
        selectSessionHint: "Select a session to inspect tokens, model, timestamps, and transcript preview.",
        available: "Available",
        noSessionSelected: "No session selected",
        chooseSessionHint: "Choose a row from the list to inspect routing, overrides, and transcript preview.",
        timestampUnavailable: "Timestamp unavailable",
        openInChat: "Open in Chat",
        rename: "Rename",
        archive: "Archive",
        deleteRow: "Delete Row",
        archiveTitle: "Archive transcript and remove the session entry",
        deleteTitle: "Remove the session entry without archiving transcript files",
        transcriptRows: "Transcript rows",
        responseUsage: "Response usage",
        cachedTotalMayBeStale: "cached total may be stale",
        tokenCacheFresh: "token cache looks fresh",
        resolvedDefaults: "Resolved defaults",
        resolvedDefaultsDetail: "Workspace-level session defaults from the gateway.",
        resolvedSession: "Resolved session",
        resolvedSessionDetail: "Model, policy, and session-scoped identity.",
        routing: "Routing",
        routingDetail: "Agent, surface, room, and delivery targeting.",
        usage: "Usage",
        usageDetail: "Cached usage counters and origin metadata.",
        overrides: "Overrides",
        overridesDetail: "Rename, patch per-session overrides, or reset the session while keeping workspace defaults.",
        reset: "Reset",
        saveOverrides: "Save Overrides",
        label: "Label",
        optionalLabelOverride: "Optional label override",
        thinkingLevel: "Thinking Level",
        verboseLevel: "Verbose Level",
        reasoningLevel: "Reasoning Level",
        inherit: "inherit",
        transcriptPreview: "Transcript preview",
        loadingTranscript: "Loading transcript preview…",
        transcriptSourceSuffix: "source",
        sessionStore: "Session store",
        liveGateway: "Live gateway",
        sessionMixTitle: "Session mix",
        sessionListTitle: "Session list",
        providerLabel: "Provider",
        modelLabel: "Model",
        contextLabel: "Context",
        storeLabel: "Store",
        privilegesLabel: "Privileges",
        sendPolicyLabel: "Send policy",
        agentLabel: "Agent",
        sessionIdLabel: "Session ID",
        surfaceLabel: "Surface",
        routeLabel: "Route",
        lastChannelLabel: "Last channel",
        lastRecipientLabel: "Last recipient",
        inputLabel: "Input",
        outputLabel: "Output",
        totalLabel: "Total",
        originLabel: "Origin",
        accountLabel: "Account",
        tokenCacheLabel: "Token cache",
        fresh: "fresh",
        stale: "stale",
        system: "system",
        user: "user",
        standard: "standard",
        allow: "allow",
        notAvailable: "n/a",
        errorPrefix: "Error",
        resetSuccess: (key: string) => `Reset ${key}.`,
        saveSuccess: (key: string) => `Saved overrides for ${key}.`,
        renameSuccess: (key: string) => `Renamed ${key}.`,
        clearLabelSuccess: (key: string) => `Cleared custom label for ${key}.`,
        archiveConfirmTitle: "Archive session",
        deleteConfirmTitle: "Delete session row",
        archiveConfirmDescription: "Archives transcript files and removes the session entry.",
        deleteConfirmDescription: "Removes the session entry without archiving transcript files.",
        archiveSuccess: (key: string) => `Archived transcript and removed ${key}.`,
        deleteSuccess: (key: string) => `Removed session row ${key}.`,
      };
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
    () => groupSessions(visibleSessions, groupBy, isChinese),
    [groupBy, isChinese, visibleSessions],
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
  const sourceLabel = sessionsQuery.data?.path ? pageCopy.sessionStore : pageCopy.liveGateway;
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
      label: activityBucketLabel(bucket, isChinese),
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
          ? pageCopy.renameSuccess(selectedSession.key)
          : pageCopy.clearLabelSuccess(selectedSession.key),
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
      setFeedback({ type: "info", message: pageCopy.saveSuccess(selectedSession.key) });
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
      setFeedback({ type: "info", message: pageCopy.resetSuccess(selectedSession.key) });
      await refreshWorkspaceData(selectedSession.key);
    } catch (error) {
      setFeedback({ type: "error", message: String(error) });
    } finally {
      setBusyAction(null);
    }
  }

  async function removeSession(deleteTranscript: boolean) {
    if (!selectedSession || selectedSession.kind === "global") return;

    const actionLabel = deleteTranscript ? pageCopy.archiveConfirmTitle : pageCopy.deleteConfirmTitle;
    const description = deleteTranscript
      ? pageCopy.archiveConfirmDescription
      : pageCopy.deleteConfirmDescription;
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
          ? pageCopy.archiveSuccess(deletedKey)
          : pageCopy.deleteSuccess(deletedKey),
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
            <div className="sessions-card__eyebrow">{pageCopy.eyebrow}</div>
            <div className="sessions-card__title">{pageCopy.title}</div>
            <div className="sessions-card__sub">{pageCopy.subtitle}</div>
          </div>
          <div className="sessions-hero__actions">
            <button
              type="button"
              className="sessions-btn"
              onClick={refreshAll}
              disabled={!isConnected || sessionsQuery.isFetching}
            >
              {sessionsQuery.isFetching ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
              {sessionsQuery.isFetching ? pageCopy.loading : pageCopy.refresh}
            </button>
          </div>
        </div>

        <div className="sessions-filters">
          <label className="sessions-field sessions-field--search">
            <span>{pageCopy.search}</span>
            <div className="sessions-search">
              <Search size={14} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={pageCopy.searchPlaceholder}
              />
            </div>
          </label>

          <label className="sessions-field">
            <span>{pageCopy.kind}</span>
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}>
              <option value="all">{pageCopy.all}</option>
              <option value="direct">{pageCopy.direct}</option>
              <option value="group">{pageCopy.group}</option>
              <option value="global">{pageCopy.global}</option>
              <option value="unknown">{pageCopy.unknown}</option>
            </select>
          </label>

          <label className="sessions-field">
            <span>{pageCopy.sort}</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SessionSort)}>
              <option value="updated-desc">{pageCopy.newestFirst}</option>
              <option value="updated-asc">{pageCopy.oldestFirst}</option>
              <option value="title-asc">{pageCopy.titleAsc}</option>
              <option value="title-desc">{pageCopy.titleDesc}</option>
              <option value="tokens-desc">{pageCopy.mostTokens}</option>
            </select>
          </label>

          <label className="sessions-field">
            <span>{pageCopy.groupBy}</span>
            <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as SessionGroupBy)}>
              <option value="kind">{pageCopy.kind}</option>
              <option value="activity">{pageCopy.activity}</option>
              <option value="provider">{pageCopy.provider}</option>
              <option value="surface">{pageCopy.surface}</option>
              <option value="none">{pageCopy.none}</option>
            </select>
          </label>

          <label className="sessions-field">
            <span>{pageCopy.activeWithin}</span>
            <input value={activeMinutes} onChange={(event) => setActiveMinutes(event.target.value)} inputMode="numeric" />
          </label>

          <label className="sessions-field">
            <span>{pageCopy.rowLimit}</span>
            <input value={limit} onChange={(event) => setLimit(event.target.value)} inputMode="numeric" />
          </label>

          <label className="sessions-field sessions-field--checkbox">
            <input type="checkbox" checked={includeGlobal} onChange={(event) => setIncludeGlobal(event.target.checked)} />
            <span>{pageCopy.includeGlobal}</span>
          </label>

          <label className="sessions-field sessions-field--checkbox">
            <input type="checkbox" checked={includeUnknown} onChange={(event) => setIncludeUnknown(event.target.checked)} />
            <span>{pageCopy.includeUnknown}</span>
          </label>

          <div className="sessions-filters__actions">
            <button type="button" className="sessions-btn sessions-btn--ghost sessions-btn--sm" onClick={resetFilters}>
              <X size={14} />
              {pageCopy.resetFilters}
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
            <strong className="sessions-mono">{sessionsQuery.data?.path || pageCopy.gatewayMemory}</strong>
          </div>
          <div className="sessions-meta-pill">
            <span>{pageCopy.visibility}</span>
            <strong>{visibleSessions.length}/{serverCount} {pageCopy.shown}</strong>
          </div>
          <div className="sessions-meta-pill">
            <span>{pageCopy.connection}</span>
            <strong>{isConnected ? pageCopy.connected : pageCopy.disconnected}</strong>
          </div>
        </div>

        <div className="sessions-stats-grid">
          <article className="sessions-stat-card">
            <span className="sessions-stat-card__label">{pageCopy.visibleSessions}</span>
            <strong className="sessions-stat-card__value">{summary.total}</strong>
            <p>{summary.hidden > 0 ? pageCopy.hiddenByFilters(summary.hidden) : pageCopy.allVisible}</p>
          </article>
          <article className="sessions-stat-card">
            <span className="sessions-stat-card__label">{pageCopy.kinds}</span>
            <strong className="sessions-stat-card__value">{summary.direct} / {summary.group}</strong>
            <p>{pageCopy.global} {summary.global} · {pageCopy.unknown} {summary.unknown}</p>
          </article>
          <article className="sessions-stat-card">
            <span className="sessions-stat-card__label">{pageCopy.activeRecently}</span>
            <strong className="sessions-stat-card__value">{summary.recent}</strong>
            <p>{summary.aborted > 0 ? pageCopy.abortedRows(summary.aborted) : pageCopy.noAborted}</p>
          </article>
          <article className="sessions-stat-card">
            <span className="sessions-stat-card__label">{pageCopy.cachedTokens}</span>
            <strong className="sessions-stat-card__value">{summary.tokens.toLocaleString()}</strong>
            <p>{summary.tokens > 0 ? pageCopy.tokenCacheReady : pageCopy.tokenCacheWaiting}</p>
          </article>
        </div>

        <div className="sessions-visual-grid">
          <section className="sessions-visual-card">
            <div className="sessions-visual-card__header">
              <h3>{pageCopy.sessionMixTitle}</h3>
              <p>{pageCopy.sessionMixDetail}</p>
            </div>
            <div className="sessions-stacked-bar" aria-hidden="true">
              <span className="is-direct" style={{ width: percentage(summary.direct, chartMax) }} />
              <span className="is-group" style={{ width: percentage(summary.group, chartMax) }} />
              <span className="is-global" style={{ width: percentage(summary.global, chartMax) }} />
              <span className="is-unknown" style={{ width: percentage(summary.unknown, chartMax) }} />
            </div>
            <div className="sessions-legend">
              <span><i className="is-direct" />{pageCopy.direct} {summary.direct}</span>
              <span><i className="is-group" />{pageCopy.group} {summary.group}</span>
              <span><i className="is-global" />{pageCopy.global} {summary.global}</span>
              <span><i className="is-unknown" />{pageCopy.unknown} {summary.unknown}</span>
            </div>
          </section>

          <section className="sessions-visual-card">
            <div className="sessions-visual-card__header">
              <h3>{pageCopy.activityBuckets}</h3>
              <p>{pageCopy.activityBucketsDetail}</p>
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
              <h3>{pageCopy.topTokenSessions}</h3>
              <p>{pageCopy.topTokenSessionsDetail}</p>
            </div>
            {summary.topTokenRows.length === 0 ? (
              <div className="sessions-empty-inline">{pageCopy.noTokenTotals}</div>
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
              <div className="sessions-panel-header__title">{pageCopy.sessionListTitle}</div>
              <div className="sessions-panel-header__sub">{pageCopy.sessionListDetail}</div>
            </div>
            <span className="sessions-pill">{pageCopy.groups(groupedSessions.length)}</span>
          </div>

          <div className="sessions-table-head">
            <span>{pageCopy.session}</span>
            <span>{pageCopy.status}</span>
            <span>{pageCopy.updated}</span>
            <span>{pageCopy.tokens}</span>
          </div>

          {sessionsQuery.isLoading ? (
            <div className="sessions-state"><LoaderCircle size={16} className="spin" /> {pageCopy.loadingSessions}</div>
          ) : visibleSessions.length === 0 ? (
            <div className="sessions-empty-inline">
              {summary.fetched === 0
                ? pageCopy.noSessionsForGateway
                : pageCopy.noSessionsMatched}
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
                                <span className={`sessions-kind-badge is-${session.kind}`}>{sessionKindLabel(session.kind, isChinese)}</span>
                                {activeChat && <span className="sessions-kind-badge is-active-chat">{pageCopy.active}</span>}
                                {session.abortedLastRun && <span className="sessions-kind-badge is-danger">{pageCopy.aborted}</span>}
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
                              <strong>{sessionSurface(session, isChinese)}</strong>
                              <span>{truncate(sessionModel(session, isChinese), 28)}</span>
                            </div>
                          </div>

                          <div className="sessions-row__updated">
                            <strong>{session.updatedAt ? formatRelativeTime(session.updatedAt) : pageCopy.unknownTime}</strong>
                            <span>{formatTimestamp(session.updatedAt, language, isChinese)}</span>
                          </div>

                          <div className="sessions-row__tokens">
                            <strong>{sessionTokenSummary(session)}</strong>
                            <span>{sessionTokenBreakdown(session, isChinese)}</span>
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
              <div className="sessions-panel-header__title">{pageCopy.sessionDetails}</div>
              <div className="sessions-panel-header__sub">
                {selectedSession
                  ? (isChinese ? `第 ${selectedPosition} / ${visibleSessions.length} 个可见会话` : `${selectedPosition} of ${visibleSessions.length} visible sessions`)
                  : pageCopy.selectSessionHint}
              </div>
            </div>
            {selectedSession && (
              <span className={`sessions-pill ${selectedSession.abortedLastRun ? "is-danger" : "is-ok"}`}>
                {selectedSession.abortedLastRun ? pageCopy.aborted : pageCopy.available}
              </span>
            )}
          </div>

          {!selectedSession ? (
            <div className="sessions-empty-state">
              <FileText size={20} />
              <strong>{pageCopy.noSessionSelected}</strong>
              <p>{pageCopy.chooseSessionHint}</p>
            </div>
          ) : (
            <div className="sessions-detail-stack">
              <section className="sessions-detail-hero">
                <div className="sessions-detail-hero__copy">
                  <div className="sessions-detail-hero__title">{sessionTitle(selectedSession)}</div>
                  <div className="sessions-detail-hero__subtitle sessions-mono">{selectedSession.key}</div>
                  <div className="sessions-detail-hero__meta">
                    <span>{selectedSession.updatedAt ? formatRelativeTime(selectedSession.updatedAt) : pageCopy.timestampUnavailable}</span>
                    <span>{sessionSurface(selectedSession, isChinese)}</span>
                    <span>{sessionRoute(selectedSession)}</span>
                    <span>{sessionModel(selectedSession, isChinese)}</span>
                  </div>
                  <div className="sessions-detail-facts">
                    {sessionFacts(selectedSession, isChinese).map((fact) => (
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
                    {pageCopy.openInChat}
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
                    {pageCopy.rename}
                  </button>
                  <button
                    type="button"
                    className="sessions-btn sessions-btn--ghost sessions-btn--sm"
                    onClick={() => removeSession(true)}
                    disabled={busyAction !== null || selectedSession.kind === "global"}
                    title={pageCopy.archiveTitle}
                  >
                    {busyAction === "archive" ? <LoaderCircle size={14} className="spin" /> : <Archive size={14} />}
                    {pageCopy.archive}
                  </button>
                  <button
                    type="button"
                    className="sessions-btn sessions-btn--danger sessions-btn--sm"
                    onClick={() => removeSession(false)}
                    disabled={busyAction !== null || selectedSession.kind === "global"}
                    title={pageCopy.deleteTitle}
                  >
                    {busyAction === "delete" ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}
                    {pageCopy.deleteRow}
                  </button>
                </div>
              </section>

              <div className="sessions-detail-metrics">
                <article className="sessions-detail-metric">
                  <span>{pageCopy.tokens}</span>
                  <strong>{sessionTokenSummary(selectedSession)}</strong>
                  <p>{sessionTokenBreakdown(selectedSession, isChinese)}</p>
                </article>
                <article className="sessions-detail-metric">
                  <span>{pageCopy.updated}</span>
                  <strong>{selectedSession.updatedAt ? formatRelativeTime(selectedSession.updatedAt) : "—"}</strong>
                  <p>{formatTimestamp(selectedSession.updatedAt, language, isChinese)}</p>
                </article>
                <article className="sessions-detail-metric">
                  <span>{pageCopy.transcriptRows}</span>
                  <strong>{transcriptItems.length.toLocaleString()}</strong>
                  <p>{transcriptStatusLabel(transcriptStatus, isChinese)}</p>
                </article>
                <article className="sessions-detail-metric">
                  <span>{pageCopy.responseUsage}</span>
                  <strong>{selectedSession.responseUsage ?? pageCopy.inherit}</strong>
                  <p>{selectedSession.totalTokensFresh === false ? pageCopy.cachedTotalMayBeStale : pageCopy.tokenCacheFresh}</p>
                </article>
              </div>

              <div className="sessions-detail-grid">
                <section className="sessions-detail-card">
                  <div className="sessions-detail-card__header">
                    <h3>{pageCopy.resolvedDefaults}</h3>
                    <p>{pageCopy.resolvedDefaultsDetail}</p>
                  </div>
                  <div className="sessions-kv-list">
                    <div className="sessions-kv-row"><span>{pageCopy.providerLabel}</span><strong>{sessionsQuery.data?.defaults.modelProvider ?? pageCopy.inherit}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.modelLabel}</span><strong>{sessionsQuery.data?.defaults.model ?? pageCopy.inherit}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.contextLabel}</span><strong>{sessionsQuery.data?.defaults.contextTokens ?? pageCopy.inherit}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.storeLabel}</span><strong>{sourceLabel}</strong></div>
                  </div>
                </section>

                <section className="sessions-detail-card">
                  <div className="sessions-detail-card__header">
                    <h3>{pageCopy.resolvedSession}</h3>
                    <p>{pageCopy.resolvedSessionDetail}</p>
                  </div>
                  <div className="sessions-kv-list">
                    <div className="sessions-kv-row"><span>{pageCopy.providerLabel}</span><strong>{selectedSession.modelProvider ?? pageCopy.inherit}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.modelLabel}</span><strong>{selectedSession.model ?? pageCopy.inherit}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.contextLabel}</span><strong>{selectedSession.contextTokens ?? sessionsQuery.data?.defaults.contextTokens ?? pageCopy.inherit}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.privilegesLabel}</span><strong>{selectedSession.elevatedLevel ?? pageCopy.standard}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.sendPolicyLabel}</span><strong>{selectedSession.sendPolicy ?? pageCopy.allow}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.responseUsage}</span><strong>{selectedSession.responseUsage ?? pageCopy.inherit}</strong></div>
                  </div>
                </section>

                <section className="sessions-detail-card">
                  <div className="sessions-detail-card__header">
                    <h3>{pageCopy.routing}</h3>
                    <p>{pageCopy.routingDetail}</p>
                  </div>
                  <div className="sessions-kv-list">
                    <div className="sessions-kv-row"><span>{pageCopy.agentLabel}</span><strong>{parseSessionAgentId(selectedSession.key) ?? pageCopy.notAvailable}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.sessionIdLabel}</span><strong>{selectedSession.sessionId ?? pageCopy.unknown}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.surfaceLabel}</span><strong>{sessionSurface(selectedSession, isChinese)}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.routeLabel}</span><strong>{sessionRoute(selectedSession)}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.lastChannelLabel}</span><strong>{selectedSession.lastChannel ?? selectedSession.deliveryContext?.channel ?? "—"}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.lastRecipientLabel}</span><strong>{selectedSession.lastTo ?? selectedSession.deliveryContext?.to ?? "—"}</strong></div>
                  </div>
                </section>

                <section className="sessions-detail-card">
                  <div className="sessions-detail-card__header">
                    <h3>{pageCopy.usage}</h3>
                    <p>{pageCopy.usageDetail}</p>
                  </div>
                  <div className="sessions-kv-list">
                    <div className="sessions-kv-row"><span>{pageCopy.inputLabel}</span><strong>{formatTokenCount(selectedSession.inputTokens)}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.outputLabel}</span><strong>{formatTokenCount(selectedSession.outputTokens)}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.totalLabel}</span><strong>{sessionTokenSummary(selectedSession)}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.originLabel}</span><strong>{selectedSession.originLabel ?? (selectedSession.systemSent ? pageCopy.system : pageCopy.user)}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.accountLabel}</span><strong>{selectedSession.lastAccountId ?? selectedSession.deliveryContext?.accountId ?? "—"}</strong></div>
                    <div className="sessions-kv-row"><span>{pageCopy.tokenCacheLabel}</span><strong>{selectedSession.totalTokensFresh === false ? pageCopy.stale : pageCopy.fresh}</strong></div>
                  </div>
                </section>
              </div>

              <section className="sessions-detail-card sessions-detail-card--full">
                <div className="sessions-detail-card__header sessions-detail-card__header--actions">
                  <div>
                    <h3>{pageCopy.overrides}</h3>
                    <p>{pageCopy.overridesDetail}</p>
                  </div>
                  <div className="sessions-detail-actions">
                    <button
                      type="button"
                      className="sessions-btn sessions-btn--ghost sessions-btn--sm"
                      onClick={resetSession}
                      disabled={busyAction !== null}
                    >
                      {busyAction === "reset" ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />}
                      {pageCopy.reset}
                    </button>
                    <button
                      type="button"
                      className="sessions-btn sessions-btn--ghost sessions-btn--sm"
                      onClick={renameSession}
                      disabled={busyAction !== null || !renameChanged}
                    >
                      {busyAction === "rename" ? <LoaderCircle size={14} className="spin" /> : <PencilLine size={14} />}
                      {pageCopy.rename}
                    </button>
                    <button
                      type="button"
                      className="sessions-btn sessions-btn--primary sessions-btn--sm"
                      onClick={saveSessionDraft}
                      disabled={busyAction !== null || !draftChanged}
                    >
                      {busyAction === "save" ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
                      {pageCopy.saveOverrides}
                    </button>
                  </div>
                </div>

                <div className="sessions-editor-grid">
                  <label className="sessions-field sessions-field--full">
                    <span>{pageCopy.label}</span>
                    <input
                      ref={labelInputRef}
                      value={draft.label}
                      onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                      placeholder={pageCopy.optionalLabelOverride}
                    />
                  </label>

                  <label className="sessions-field">
                    <span>{pageCopy.thinkingLevel}</span>
                    <select
                      value={resolveThinkLevelDisplay(
                        draft.thinkingLevel,
                        isBinaryThinkingProvider(selectedSession.modelProvider),
                      )}
                      onChange={(event) => setDraft((current) => ({ ...current, thinkingLevel: event.target.value }))}
                    >
                      {thinkLevels.map((level) => (
                        <option key={level || "inherit"} value={level}>{level || pageCopy.inherit}</option>
                      ))}
                    </select>
                  </label>

                  <label className="sessions-field">
                    <span>{pageCopy.verboseLevel}</span>
                    <select
                      value={draft.verboseLevel}
                      onChange={(event) => setDraft((current) => ({ ...current, verboseLevel: event.target.value }))}
                    >
                      {verboseLevels.map((level) => (
                        <option key={level.value || "inherit"} value={level.value}>
                          {level.value
                            ? (isChinese
                              ? level.value === "off"
                                ? "关闭（显式）"
                                : level.value === "on"
                                  ? "开启"
                                  : level.value === "full"
                                    ? "完整"
                                    : level.label
                              : level.label)
                            : pageCopy.inherit}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="sessions-field">
                    <span>{pageCopy.reasoningLevel}</span>
                    <select
                      value={draft.reasoningLevel}
                      onChange={(event) => setDraft((current) => ({ ...current, reasoningLevel: event.target.value }))}
                    >
                      {reasoningLevels.map((level) => (
                        <option key={level || "inherit"} value={level}>{level || pageCopy.inherit}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              <section className="sessions-detail-card sessions-detail-card--full">
                <div className="sessions-detail-card__header">
                  <div>
                    <h3>{pageCopy.transcriptPreview}</h3>
                    <p>{transcriptStatusLabel(transcriptStatus, isChinese)} · {transcriptSourceLabel(transcriptSource, isChinese)} {pageCopy.transcriptSourceSuffix}</p>
                  </div>
                </div>

                {transcriptQuery.isLoading ? (
                  <div className="sessions-state"><LoaderCircle size={16} className="spin" /> {pageCopy.loadingTranscript}</div>
                ) : transcriptQuery.error ? (
                  <div className="sessions-callout is-danger">{String(transcriptQuery.error)}</div>
                ) : transcriptItems.length === 0 ? (
                  <div className="sessions-empty-inline">{transcriptStatusLabel(transcriptStatus, isChinese)}</div>
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
