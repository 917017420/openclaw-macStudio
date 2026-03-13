import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  CopyPlus,
  Filter,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button, Card, StatusBadge } from "@/components/ui";
import { useAgentsDirectory } from "@/features/chat/hooks/useAgents";
import { useChatStore } from "@/features/chat/store";
import { useConnectionStore } from "@/features/connection/store";
import { isChineseLanguage, useAppPreferencesStore } from "@/features/preferences/store";
import { gateway } from "@/lib/gateway";
import { formatRelativeTime } from "@/lib/utils";
import "./cron.css";

type CronStatusSummary = {
  enabled: boolean;
  storePath: string;
  jobs: number;
  nextWakeAtMs: number | null;
};

type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string; staggerMs?: number };

type CronPayload =
  | { kind: "systemEvent"; text: string }
  | {
      kind: "agentTurn";
      message: string;
      model?: string;
      fallbacks?: string[];
      thinking?: string;
      timeoutSeconds?: number;
      allowUnsafeExternalContent?: boolean;
      lightContext?: boolean;
    };

type CronFailureDestination = {
  channel?: string;
  to?: string;
  accountId?: string;
  mode?: "announce" | "webhook";
};

type CronDelivery = {
  mode: "none" | "announce" | "webhook";
  channel?: string;
  to?: string;
  accountId?: string;
  bestEffort?: boolean;
  failureDestination?: CronFailureDestination;
};

type CronFailureAlert =
  | false
  | {
      after?: number;
      channel?: string;
      to?: string;
      cooldownMs?: number;
      mode?: "announce" | "webhook";
      accountId?: string;
    };

type CronRunStatus = "ok" | "error" | "skipped";
type CronDeliveryStatus = "delivered" | "not-delivered" | "unknown" | "not-requested";
type CronSortDir = "asc" | "desc";
type CronJobsEnabledFilter = "all" | "enabled" | "disabled";
type CronJobsSortBy = "nextRunAtMs" | "updatedAtMs" | "name";
type CronRunScope = "all" | "job";
type CronJobScheduleKindFilter = "all" | CronSchedule["kind"];
type CronJobLastStatusFilter = "all" | CronRunStatus;

type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: CronRunStatus;
  lastStatus?: CronRunStatus;
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
  lastDelivered?: boolean;
  lastDeliveryStatus?: CronDeliveryStatus;
  lastDeliveryError?: string;
  lastFailureAlertAtMs?: number;
};

type CronJob = {
  id: string;
  name: string;
  description?: string;
  agentId?: string | null;
  sessionKey?: string | null;
  enabled: boolean;
  deleteAfterRun?: boolean;
  sessionTarget: "main" | "isolated";
  wakeMode: "next-heartbeat" | "now";
  schedule: CronSchedule;
  payload: CronPayload;
  delivery?: CronDelivery;
  failureAlert?: CronFailureAlert;
  createdAtMs: number;
  updatedAtMs: number;
  state: CronJobState;
};

type CronJobsResult = {
  jobs: CronJob[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

type CronRunUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
};

type CronRunEntry = {
  ts: number;
  jobId: string;
  jobName?: string;
  status?: CronRunStatus;
  error?: string;
  summary?: string;
  delivered?: boolean;
  deliveryStatus?: CronDeliveryStatus;
  deliveryError?: string;
  durationMs?: number;
  sessionId?: string;
  sessionKey?: string;
  runAtMs?: number;
  nextRunAtMs?: number;
  model?: string;
  provider?: string;
  usage?: CronRunUsage;
};

type CronRunsResult = {
  entries: CronRunEntry[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

type ChannelOption = {
  id: string;
  label: string;
};

type CronSupportResult = {
  models: string[];
  channels: ChannelOption[];
};

type CronFormState = {
  name: string;
  description: string;
  enabled: boolean;
  agentId: string;
  clearAgent: boolean;
  sessionKey: string;
  scheduleKind: "every" | "at" | "cron";
  scheduleAt: string;
  everyAmount: string;
  everyUnit: "minutes" | "hours" | "days";
  cronExpr: string;
  cronTz: string;
  scheduleExact: boolean;
  staggerAmount: string;
  staggerUnit: "seconds" | "minutes";
  sessionTarget: "main" | "isolated";
  wakeMode: "next-heartbeat" | "now";
  payloadKind: "agentTurn" | "systemEvent";
  payloadText: string;
  payloadModel: string;
  payloadThinking: string;
  timeoutSeconds: string;
  payloadLightContext: boolean;
  deliveryMode: "none" | "announce" | "webhook";
  deliveryChannel: string;
  deliveryTo: string;
  deliveryAccountId: string;
  deliveryBestEffort: boolean;
  failureAlertMode: "inherit" | "disabled" | "custom";
  failureAlertAfter: string;
  failureAlertCooldownSeconds: string;
  failureAlertChannel: string;
  failureAlertTo: string;
  failureAlertDeliveryMode: "announce" | "webhook";
  failureAlertAccountId: string;
  deleteAfterRun: boolean;
};

type CronFieldKey = keyof CronFormState;
type CronFieldErrors = Partial<Record<CronFieldKey, string>>;
type BlockingField = {
  key: CronFieldKey;
  inputId: string;
  label: string;
  message: string;
};
type Notice = { kind: "info" | "error"; text: string };
type CronAction =
  | { type: "toggle"; job: CronJob; enabled: boolean }
  | { type: "run"; job: CronJob; mode: "force" | "due" }
  | { type: "delete"; job: CronJob }
  | { type: "wake"; wakeMode: "now" | "next-heartbeat"; wakeText: string };

const CRON_QUERY_KEY = "cron-dashboard";
const DEFAULT_PAGE_SIZE = 40;
const DEFAULT_CHANNEL = "last";
const CRON_THINKING_SUGGESTIONS = ["off", "minimal", "low", "medium", "high"];
const TIMEZONE_FALLBACKS = ["UTC", "America/Los_Angeles", "America/New_York", "Asia/Shanghai", "Europe/London"];
const intlWithSupportedValues = Intl as typeof Intl & {
  supportedValuesOf?: (key: string) => string[];
};
const TIMEZONE_SUGGESTIONS = Array.from(
  new Set([...(intlWithSupportedValues.supportedValuesOf?.("timeZone") ?? []), ...TIMEZONE_FALLBACKS]),
).sort((left, right) => left.localeCompare(right));

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

function readBoolean(record: Record<string, unknown> | null, key: string): boolean | undefined {
  return typeof record?.[key] === "boolean" ? (record[key] as boolean) : undefined;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function defaultCronForm(): CronFormState {
  return {
    name: "",
    description: "",
    enabled: true,
    agentId: "",
    clearAgent: false,
    sessionKey: "",
    scheduleKind: "every",
    scheduleAt: "",
    everyAmount: "15",
    everyUnit: "minutes",
    cronExpr: "0 * * * *",
    cronTz: "",
    scheduleExact: false,
    staggerAmount: "",
    staggerUnit: "minutes",
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payloadKind: "agentTurn",
    payloadText: "",
    payloadModel: "",
    payloadThinking: "",
    timeoutSeconds: "",
    payloadLightContext: false,
    deliveryMode: "none",
    deliveryChannel: DEFAULT_CHANNEL,
    deliveryTo: "",
    deliveryAccountId: "",
    deliveryBestEffort: false,
    failureAlertMode: "inherit",
    failureAlertAfter: "3",
    failureAlertCooldownSeconds: "600",
    failureAlertChannel: DEFAULT_CHANNEL,
    failureAlertTo: "",
    failureAlertDeliveryMode: "announce",
    failureAlertAccountId: "",
    deleteAfterRun: false,
  };
}

function normalizeCronStatus(value: unknown): CronStatusSummary {
  const record = asRecord(value);
  return {
    enabled: readBoolean(record, "enabled") ?? false,
    storePath: readString(record, "storePath") ?? "",
    jobs: readNumber(record, "jobs") ?? 0,
    nextWakeAtMs: readNumber(record, "nextWakeAtMs") ?? null,
  };
}

function normalizeCronJobs(value: unknown): CronJobsResult {
  const record = asRecord(value);
  const jobs = Array.isArray(record?.jobs)
    ? record.jobs.flatMap((entry) => {
        const item = asRecord(entry);
        const id = readString(item, "id");
        const name = readString(item, "name");
        const schedule = item?.schedule;
        const payload = item?.payload;
        const state = asRecord(item?.state);
        const sessionTarget = readString(item, "sessionTarget");
        const wakeMode = readString(item, "wakeMode");
        if (
          !id ||
          !name ||
          !schedule ||
          !payload ||
          !state ||
          (sessionTarget !== "main" && sessionTarget !== "isolated") ||
          (wakeMode !== "next-heartbeat" && wakeMode !== "now")
        ) {
          return [];
        }
        const failureAlertRaw = item?.failureAlert;
        const failureAlert =
          failureAlertRaw === false
            ? false
            : (asRecord(failureAlertRaw) as Exclude<CronFailureAlert, false> | null) ?? undefined;
        return [
          {
            id,
            name,
            description: readString(item, "description"),
            agentId: readString(item, "agentId") ?? null,
            sessionKey: readString(item, "sessionKey") ?? null,
            enabled: readBoolean(item, "enabled") ?? false,
            deleteAfterRun: readBoolean(item, "deleteAfterRun"),
            sessionTarget,
            wakeMode,
            schedule: schedule as CronSchedule,
            payload: payload as CronPayload,
            delivery: (asRecord(item?.delivery) as CronDelivery | null) ?? undefined,
            failureAlert,
            createdAtMs: readNumber(item, "createdAtMs") ?? 0,
            updatedAtMs: readNumber(item, "updatedAtMs") ?? 0,
            state: {
              nextRunAtMs: readNumber(state, "nextRunAtMs"),
              runningAtMs: readNumber(state, "runningAtMs"),
              lastRunAtMs: readNumber(state, "lastRunAtMs"),
              lastRunStatus: readString(state, "lastRunStatus") as CronJobState["lastRunStatus"],
              lastStatus: readString(state, "lastStatus") as CronJobState["lastStatus"],
              lastError: readString(state, "lastError"),
              lastDurationMs: readNumber(state, "lastDurationMs"),
              consecutiveErrors: readNumber(state, "consecutiveErrors"),
              lastDelivered: readBoolean(state, "lastDelivered"),
              lastDeliveryStatus: readString(state, "lastDeliveryStatus") as CronJobState["lastDeliveryStatus"],
              lastDeliveryError: readString(state, "lastDeliveryError"),
              lastFailureAlertAtMs: readNumber(state, "lastFailureAlertAtMs"),
            },
          },
        ];
      })
    : [];
  const total = readNumber(record, "total") ?? jobs.length;
  const limit = readNumber(record, "limit") ?? jobs.length;
  const offset = readNumber(record, "offset") ?? 0;
  return {
    jobs,
    total,
    limit,
    offset,
    hasMore: jobs.length < total,
  };
}

function normalizeCronRuns(value: unknown): CronRunsResult {
  const record = asRecord(value);
  const entries = Array.isArray(record?.entries)
    ? record.entries.flatMap((entry) => {
        const item = asRecord(entry);
        const ts = readNumber(item, "ts");
        const jobId = readString(item, "jobId");
        if (ts == null || !jobId) {
          return [];
        }
        const usage = asRecord(item?.usage);
        return [
          {
            ts,
            jobId,
            jobName: readString(item, "jobName"),
            status: readString(item, "status") as CronRunEntry["status"],
            error: readString(item, "error"),
            summary: readString(item, "summary"),
            delivered: readBoolean(item, "delivered"),
            deliveryStatus: readString(item, "deliveryStatus") as CronRunEntry["deliveryStatus"],
            deliveryError: readString(item, "deliveryError"),
            durationMs: readNumber(item, "durationMs"),
            sessionId: readString(item, "sessionId"),
            sessionKey: readString(item, "sessionKey"),
            runAtMs: readNumber(item, "runAtMs"),
            nextRunAtMs: readNumber(item, "nextRunAtMs"),
            model: readString(item, "model"),
            provider: readString(item, "provider"),
            usage: usage
              ? {
                  input_tokens: readNumber(usage, "input_tokens"),
                  output_tokens: readNumber(usage, "output_tokens"),
                  total_tokens: readNumber(usage, "total_tokens"),
                  cache_read_tokens: readNumber(usage, "cache_read_tokens"),
                  cache_write_tokens: readNumber(usage, "cache_write_tokens"),
                }
              : undefined,
          },
        ];
      })
    : [];
  const total = readNumber(record, "total") ?? entries.length;
  const limit = readNumber(record, "limit") ?? entries.length;
  const offset = readNumber(record, "offset") ?? 0;
  return {
    entries,
    total,
    limit,
    offset,
    hasMore: entries.length < total,
  };
}

function normalizeModelIds(value: unknown): string[] {
  const record = asRecord(value);
  if (!Array.isArray(record?.models)) {
    return [];
  }
  return Array.from(
    new Set(
      record.models.flatMap((entry) => {
        const item = asRecord(entry);
        const id = readString(item, "id");
        return id ? [id] : [];
      }),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeChannelOptions(value: unknown): ChannelOption[] {
  const record = asRecord(value);
  const channelsRecord = asRecord(record?.channels);
  const order = Array.isArray(record?.channelOrder)
    ? record.channelOrder.filter((entry): entry is string => typeof entry === "string")
    : Object.keys(channelsRecord ?? {});
  const options = order.flatMap((channelId) => {
    const channel = asRecord(channelsRecord?.[channelId]);
    const label = readString(channel, "label") ?? readString(channel, "title") ?? channelId;
    return [{ id: channelId, label }];
  });
  return [{ id: DEFAULT_CHANNEL, label: "last used channel" }, ...options];
}

async function loadCronStatus() {
  return normalizeCronStatus(await gateway.request<unknown>("cron.status", {}));
}

async function loadCronSupport() {
  const [modelsRaw, channelsRaw] = await Promise.all([
    gateway.request<unknown>("models.list", {}),
    gateway.request<unknown>("channels.status", { probe: false, timeoutMs: 5_000 }),
  ]);
  return {
    models: normalizeModelIds(modelsRaw),
    channels: normalizeChannelOptions(channelsRaw),
  } satisfies CronSupportResult;
}

function formatDateTime(timestamp?: number | null) {
  if (timestamp == null) {
    return isChineseLanguage(useAppPreferencesStore.getState().language) ? "暂无" : "n/a";
  }
  const locale = useAppPreferencesStore.getState().language;
  return new Date(timestamp).toLocaleString(locale);
}

function formatDuration(durationMs?: number, isChinese = false) {
  if (!durationMs || durationMs <= 0) {
    return isChinese ? "暂无" : "n/a";
  }
  if (durationMs < 1_000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  return isChinese ? `${(durationMs / 60_000).toFixed(1)} 分钟` : `${(durationMs / 60_000).toFixed(1)} min`;
}

function formatCount(value?: number | null, isChinese = false) {
  return value == null ? (isChinese ? "暂无" : "n/a") : value.toLocaleString();
}

function formatRelativeTimestamp(timestamp?: number | null, isChinese = false) {
  if (timestamp == null) return isChinese ? "暂无" : "n/a";
  return formatRelativeTime(timestamp);
}

function getRunKey(entry: CronRunEntry) {
  return `${entry.jobId}:${entry.ts}:${entry.status ?? "unknown"}`;
}

function getRunStatus(entry: CronRunEntry): CronRunStatus | "unknown" {
  if (entry.status === "ok" || entry.status === "error" || entry.status === "skipped") {
    return entry.status;
  }
  return "unknown";
}

function getJobLastStatus(job: CronJob): CronRunStatus | "unknown" {
  const status = job.state.lastRunStatus ?? job.state.lastStatus;
  if (status === "ok" || status === "error" || status === "skipped") {
    return status;
  }
  return "unknown";
}

function formatRunStatusLabel(status: CronRunStatus | "unknown", isChinese = false) {
  if (status === "ok") return isChinese ? "成功" : "Succeeded";
  if (status === "error") return isChinese ? "失败" : "Failed";
  if (status === "skipped") return isChinese ? "已跳过" : "Skipped";
  return isChinese ? "未知" : "Unknown";
}

function formatDeliveryStatusLabel(status?: CronDeliveryStatus, isChinese = false) {
  if (status === "delivered") return isChinese ? "已投递" : "Delivered";
  if (status === "not-delivered") return isChinese ? "未投递" : "Not delivered";
  if (status === "not-requested") return isChinese ? "未请求投递" : "Not requested";
  return isChinese ? "未知" : "Unknown";
}

function runTone(status: CronRunStatus | "unknown") {
  if (status === "ok") return "ok";
  if (status === "error") return "danger";
  if (status === "skipped") return "warn";
  return "soft";
}

function describeSchedule(schedule: CronSchedule, isChinese = false) {
  if (schedule.kind === "at") {
    const locale = useAppPreferencesStore.getState().language;
    return isChinese
      ? `将在 ${new Date(schedule.at).toLocaleString(locale)} 执行一次`
      : `Runs once at ${new Date(schedule.at).toLocaleString(locale)}`;
  }
  if (schedule.kind === "every") {
    const minutes = Math.round(schedule.everyMs / 60_000);
    if (minutes % (60 * 24) === 0) {
      return isChinese
        ? `每 ${minutes / (60 * 24)} 天`
        : `Every ${minutes / (60 * 24)} day${minutes === 60 * 24 ? "" : "s"}`;
    }
    if (minutes % 60 === 0) {
      return isChinese
        ? `每 ${minutes / 60} 小时`
        : `Every ${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
    }
    return isChinese ? `每 ${minutes} 分钟` : `Every ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const exact = schedule.staggerMs === 0 ? (isChinese ? " · 精确" : " · exact") : "";
  const stagger =
    schedule.staggerMs && schedule.staggerMs > 0
      ? ` · ${isChinese ? "错峰" : "stagger"} ${formatDuration(schedule.staggerMs, isChinese)}`
      : "";
  return `${schedule.expr}${schedule.tz ? ` · ${schedule.tz}` : ""}${exact}${stagger}`;
}

function describePayload(payload: CronPayload, isChinese = false) {
  if (payload.kind === "systemEvent") {
    return payload.text || (isChinese ? "系统事件" : "System event");
  }
  return payload.message || (isChinese ? "智能体轮次" : "Agent turn");
}

function describeDelivery(job: CronJob, isChinese = false) {
  const delivery = job.delivery;
  if (!delivery || delivery.mode === "none") {
    return isChinese ? "不投递" : "No delivery";
  }
  if (delivery.mode === "webhook") {
    return delivery.to ? `Webhook → ${delivery.to}` : "Webhook";
  }
  const channel = delivery.channel?.trim() || DEFAULT_CHANNEL;
  return isChinese
    ? delivery.to
      ? `通过 ${channel} 广播 → ${delivery.to}`
      : `通过 ${channel} 广播`
    : delivery.to
      ? `Announce via ${channel} → ${delivery.to}`
      : `Announce via ${channel}`;
}

function describeFailureAlert(job: CronJob, isChinese = false) {
  if (job.failureAlert === false) {
    return isChinese ? "失败告警已关闭" : "Failure alerts disabled";
  }
  if (!job.failureAlert) {
    return isChinese ? "网关默认值" : "Gateway defaults";
  }
  const parts = [
    job.failureAlert.after
      ? isChinese
        ? `${job.failureAlert.after} 次失败后告警`
        : `after ${job.failureAlert.after} failures`
      : isChinese
        ? "自定义阈值"
        : "custom threshold",
    isChinese
      ? (job.failureAlert.mode ?? "announce") === "webhook"
        ? "Webhook"
        : "广播"
      : (job.failureAlert.mode ?? "announce"),
  ];
  if (job.failureAlert.channel) {
    parts.push(isChinese ? `频道 ${job.failureAlert.channel}` : `channel ${job.failureAlert.channel}`);
  }
  if (job.failureAlert.to) {
    parts.push(isChinese ? `目标 ${job.failureAlert.to}` : `to ${job.failureAlert.to}`);
  }
  return parts.join(" · ");
}

function toNumber(value: string, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function buildSchedule(form: CronFormState, isChinese = false): CronSchedule {
  if (form.scheduleKind === "at") {
    const value = form.scheduleAt.trim();
    if (!value) {
      throw new Error(isChinese ? "请为单次任务选择执行时间。" : "Pick a run time for the one-shot schedule.");
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      throw new Error(isChinese ? "定时任务日期或时间无效。" : "Invalid date/time for cron job.");
    }
    return { kind: "at", at: new Date(timestamp).toISOString() };
  }

  if (form.scheduleKind === "every") {
    const amount = toNumber(form.everyAmount, 0);
    if (amount <= 0) {
      throw new Error(isChinese ? "重复间隔必须大于 0。" : "Repeat interval must be greater than zero.");
    }
    const multiplier =
      form.everyUnit === "minutes" ? 60_000 : form.everyUnit === "hours" ? 3_600_000 : 86_400_000;
    return { kind: "every", everyMs: amount * multiplier };
  }

  const expr = form.cronExpr.trim();
  if (!expr) {
    throw new Error(isChinese ? "Cron 表达式必填。" : "Cron expression is required.");
  }
  if (form.scheduleExact) {
    return {
      kind: "cron",
      expr,
      tz: form.cronTz.trim() || undefined,
      staggerMs: 0,
    };
  }
  const staggerRaw = form.staggerAmount.trim();
  const staggerValue = staggerRaw ? toNumber(staggerRaw, 0) : 0;
  const staggerMs =
    staggerValue > 0
      ? form.staggerUnit === "minutes"
        ? staggerValue * 60_000
        : staggerValue * 1_000
      : undefined;
  return {
    kind: "cron",
    expr,
    tz: form.cronTz.trim() || undefined,
    staggerMs,
  };
}

function buildPayload(form: CronFormState, isChinese = false): CronPayload {
  if (form.payloadKind === "systemEvent") {
    const text = form.payloadText.trim();
    if (!text) {
      throw new Error(isChinese ? "系统事件文本必填。" : "System event text is required.");
    }
    return { kind: "systemEvent", text };
  }
  const message = form.payloadText.trim();
  if (!message) {
    throw new Error(isChinese ? "智能体轮次消息必填。" : "Agent turn message is required.");
  }
  const payload: Extract<CronPayload, { kind: "agentTurn" }> = {
    kind: "agentTurn",
    message,
  };
  const model = form.payloadModel.trim();
  const thinking = form.payloadThinking.trim();
  const timeout = toNumber(form.timeoutSeconds.trim(), 0);
  if (model) payload.model = model;
  if (thinking) payload.thinking = thinking;
  if (timeout > 0) payload.timeoutSeconds = timeout;
  if (form.payloadLightContext) payload.lightContext = true;
  return payload;
}

function buildDelivery(form: CronFormState, supportsAnnounce: boolean): CronDelivery | undefined {
  if (form.deliveryMode === "none") {
    return { mode: "none" };
  }
  if (form.deliveryMode === "announce" && !supportsAnnounce) {
    return { mode: "none" };
  }
  if (form.deliveryMode === "webhook") {
    return {
      mode: "webhook",
      to: form.deliveryTo.trim() || undefined,
      bestEffort: form.deliveryBestEffort,
    };
  }
  return {
    mode: "announce",
    channel: form.deliveryChannel.trim() || DEFAULT_CHANNEL,
    to: form.deliveryTo.trim() || undefined,
    accountId: form.deliveryAccountId.trim() || undefined,
    bestEffort: form.deliveryBestEffort,
  };
}

function buildFailureAlert(form: CronFormState): CronFailureAlert | undefined {
  if (form.failureAlertMode === "disabled") {
    return false;
  }
  if (form.failureAlertMode !== "custom") {
    return undefined;
  }
  const after = toNumber(form.failureAlertAfter.trim(), 0);
  const cooldownSeconds = form.failureAlertCooldownSeconds.trim()
    ? toNumber(form.failureAlertCooldownSeconds.trim(), 0)
    : undefined;
  return {
    after: after > 0 ? Math.floor(after) : undefined,
    channel: form.failureAlertChannel.trim() || DEFAULT_CHANNEL,
    to: form.failureAlertTo.trim() || undefined,
    cooldownMs:
      cooldownSeconds !== undefined && cooldownSeconds >= 0
        ? Math.floor(cooldownSeconds * 1_000)
        : undefined,
    mode: form.failureAlertDeliveryMode,
    accountId: form.failureAlertAccountId.trim() || undefined,
  };
}

function formFromJob(job: CronJob): CronFormState {
  const next = defaultCronForm();
  next.name = job.name;
  next.description = job.description ?? "";
  next.enabled = job.enabled;
  next.agentId = job.agentId?.trim() ?? "";
  next.sessionKey = job.sessionKey?.trim() ?? "";
  next.sessionTarget = job.sessionTarget;
  next.wakeMode = job.wakeMode;
  next.deleteAfterRun = Boolean(job.deleteAfterRun);
  next.deliveryMode = job.delivery?.mode ?? "none";
  next.deliveryChannel = job.delivery?.channel ?? DEFAULT_CHANNEL;
  next.deliveryTo = job.delivery?.to ?? "";
  next.deliveryAccountId = job.delivery?.accountId ?? "";
  next.deliveryBestEffort = Boolean(job.delivery?.bestEffort);

  if (job.failureAlert === false) {
    next.failureAlertMode = "disabled";
  } else if (job.failureAlert) {
    next.failureAlertMode = "custom";
    next.failureAlertAfter = job.failureAlert.after ? String(job.failureAlert.after) : next.failureAlertAfter;
    next.failureAlertCooldownSeconds =
      typeof job.failureAlert.cooldownMs === "number"
        ? String(Math.floor(job.failureAlert.cooldownMs / 1_000))
        : next.failureAlertCooldownSeconds;
    next.failureAlertChannel = job.failureAlert.channel ?? DEFAULT_CHANNEL;
    next.failureAlertTo = job.failureAlert.to ?? "";
    next.failureAlertDeliveryMode = job.failureAlert.mode ?? "announce";
    next.failureAlertAccountId = job.failureAlert.accountId ?? "";
  }

  if (job.schedule.kind === "at") {
    next.scheduleKind = "at";
    next.scheduleAt = job.schedule.at.slice(0, 16);
  } else if (job.schedule.kind === "every") {
    next.scheduleKind = "every";
    if (job.schedule.everyMs % 86_400_000 === 0) {
      next.everyAmount = String(job.schedule.everyMs / 86_400_000);
      next.everyUnit = "days";
    } else if (job.schedule.everyMs % 3_600_000 === 0) {
      next.everyAmount = String(job.schedule.everyMs / 3_600_000);
      next.everyUnit = "hours";
    } else {
      next.everyAmount = String(job.schedule.everyMs / 60_000);
      next.everyUnit = "minutes";
    }
  } else {
    next.scheduleKind = "cron";
    next.cronExpr = job.schedule.expr;
    next.cronTz = job.schedule.tz ?? "";
    next.scheduleExact = job.schedule.staggerMs === 0;
    if (job.schedule.staggerMs && job.schedule.staggerMs > 0) {
      if (job.schedule.staggerMs % 60_000 === 0) {
        next.staggerAmount = String(job.schedule.staggerMs / 60_000);
        next.staggerUnit = "minutes";
      } else {
        next.staggerAmount = String(job.schedule.staggerMs / 1_000);
        next.staggerUnit = "seconds";
      }
    }
  }

  if (job.payload.kind === "systemEvent") {
    next.payloadKind = "systemEvent";
    next.payloadText = job.payload.text;
  } else {
    next.payloadKind = "agentTurn";
    next.payloadText = job.payload.message;
    next.payloadModel = job.payload.model ?? "";
    next.payloadThinking = job.payload.thinking ?? "";
    next.timeoutSeconds = job.payload.timeoutSeconds ? String(job.payload.timeoutSeconds) : "";
    next.payloadLightContext = Boolean(job.payload.lightContext);
  }

  return next;
}

function buildCloneName(name: string, existingNames: string[], isChinese = false) {
  const seen = new Set(existingNames.map((entry) => entry.trim().toLowerCase()));
  const base = isChinese ? `${name} 副本` : `${name} copy`;
  if (!seen.has(base.toLowerCase())) {
    return base;
  }
  let index = 2;
  while (seen.has(`${base} ${index}`.toLowerCase())) {
    index += 1;
  }
  return `${base} ${index}`;
}

function validateCronForm(form: CronFormState, supportsAnnounce: boolean, isChinese = false): CronFieldErrors {
  const errors: CronFieldErrors = {};
  if (!form.name.trim()) {
    errors.name = isChinese ? "名称必填。" : "Name is required.";
  }
  if (form.scheduleKind === "every") {
    const amount = toNumber(form.everyAmount.trim(), 0);
    if (amount <= 0) {
      errors.everyAmount = isChinese ? "重复间隔必须大于 0。" : "Repeat interval must be greater than zero.";
    }
  }
  if (form.scheduleKind === "at") {
    const timestamp = Date.parse(form.scheduleAt.trim());
    if (!Number.isFinite(timestamp)) {
      errors.scheduleAt = isChinese ? "请选择有效的单次执行日期和时间。" : "Choose a valid one-shot date and time.";
    }
  }
  if (form.scheduleKind === "cron") {
    if (!form.cronExpr.trim()) {
      errors.cronExpr = isChinese ? "Cron 表达式必填。" : "Cron expression is required.";
    }
    if (!form.scheduleExact && form.staggerAmount.trim()) {
      const stagger = toNumber(form.staggerAmount.trim(), 0);
      if (stagger <= 0) {
        errors.staggerAmount = isChinese ? "错峰值必须大于 0。" : "Stagger must be greater than zero.";
      }
    }
  }
  if (!form.payloadText.trim()) {
    errors.payloadText =
      form.payloadKind === "systemEvent"
        ? isChinese
          ? "系统事件文本必填。"
          : "System event text is required."
        : isChinese
          ? "智能体轮次消息必填。"
          : "Agent turn message is required.";
  }
  if (form.payloadKind === "agentTurn" && form.timeoutSeconds.trim()) {
    const timeout = toNumber(form.timeoutSeconds.trim(), 0);
    if (timeout <= 0) {
      errors.timeoutSeconds = isChinese ? "超时时间必须大于 0。" : "Timeout must be greater than zero.";
    }
  }
  if (form.deliveryMode === "announce" && !supportsAnnounce) {
    errors.deliveryMode = isChinese
      ? "广播投递仅适用于隔离会话的智能体轮次任务。"
      : "Announce delivery requires an isolated agent-turn job.";
  }
  if (form.deliveryMode === "webhook") {
    const target = form.deliveryTo.trim();
    if (!target) {
      errors.deliveryTo = isChinese ? "Webhook URL 必填。" : "Webhook URL is required.";
    } else if (!/^https?:\/\//i.test(target)) {
      errors.deliveryTo = isChinese
        ? "Webhook URL 必须以 http:// 或 https:// 开头。"
        : "Webhook URL must start with http:// or https://.";
    }
  }
  if (form.failureAlertMode === "custom") {
    const after = toNumber(form.failureAlertAfter.trim(), 0);
    if (after <= 0) {
      errors.failureAlertAfter = isChinese ? "失败告警阈值必须大于 0。" : "Failure alert threshold must be greater than zero.";
    }
    if (form.failureAlertCooldownSeconds.trim()) {
      const cooldown = toNumber(form.failureAlertCooldownSeconds.trim(), -1);
      if (cooldown < 0) {
        errors.failureAlertCooldownSeconds = isChinese ? "冷却时间必须大于或等于 0。" : "Cooldown must be 0 or greater.";
      }
    }
  }
  return errors;
}

function orderedBlockingFields(errors: CronFieldErrors, isChinese = false) {
  const labels: Record<CronFieldKey, string> = {
    name: isChinese ? "名称" : "Name",
    description: isChinese ? "描述" : "Description",
    enabled: isChinese ? "启用" : "Enabled",
    agentId: isChinese ? "智能体 ID" : "Agent ID",
    clearAgent: isChinese ? "清空智能体覆盖" : "Clear agent override",
    sessionKey: isChinese ? "会话 Key" : "Session key",
    scheduleKind: isChinese ? "计划类型" : "Schedule type",
    scheduleAt: isChinese ? "执行时间" : "Run at",
    everyAmount: isChinese ? "重复间隔" : "Repeat every",
    everyUnit: isChinese ? "重复单位" : "Repeat unit",
    cronExpr: isChinese ? "Cron 表达式" : "Cron expression",
    cronTz: isChinese ? "时区" : "Timezone",
    scheduleExact: isChinese ? "精确计划" : "Exact schedule",
    staggerAmount: isChinese ? "错峰" : "Stagger",
    staggerUnit: isChinese ? "错峰单位" : "Stagger unit",
    sessionTarget: isChinese ? "会话目标" : "Session target",
    wakeMode: isChinese ? "唤醒模式" : "Wake mode",
    payloadKind: isChinese ? "负载类型" : "Payload type",
    payloadText: isChinese ? "负载文本" : "Payload text",
    payloadModel: isChinese ? "模型" : "Model",
    payloadThinking: isChinese ? "思考" : "Thinking",
    timeoutSeconds: isChinese ? "超时" : "Timeout",
    payloadLightContext: isChinese ? "轻量上下文" : "Light context",
    deliveryMode: isChinese ? "投递模式" : "Delivery mode",
    deliveryChannel: isChinese ? "投递频道" : "Delivery channel",
    deliveryTo: isChinese ? "投递目标" : "Delivery target",
    deliveryAccountId: isChinese ? "投递账号 ID" : "Delivery account ID",
    deliveryBestEffort: isChinese ? "尽力投递" : "Best effort delivery",
    failureAlertMode: isChinese ? "失败告警模式" : "Failure alert mode",
    failureAlertAfter: isChinese ? "失败告警阈值" : "Failure alert threshold",
    failureAlertCooldownSeconds: isChinese ? "失败告警冷却时间" : "Failure alert cooldown",
    failureAlertChannel: isChinese ? "失败告警频道" : "Failure alert channel",
    failureAlertTo: isChinese ? "失败告警接收目标" : "Failure alert recipient",
    failureAlertDeliveryMode: isChinese ? "失败告警模式" : "Failure alert mode",
    failureAlertAccountId: isChinese ? "失败告警账号 ID" : "Failure alert account ID",
    deleteAfterRun: isChinese ? "执行后删除" : "Delete after run",
  };
  return [
    "name",
    "scheduleAt",
    "everyAmount",
    "cronExpr",
    "staggerAmount",
    "payloadText",
    "timeoutSeconds",
    "deliveryMode",
    "deliveryTo",
    "failureAlertAfter",
    "failureAlertCooldownSeconds",
  ].flatMap((key) => {
    const typedKey = key as CronFieldKey;
    const message = errors[typedKey];
    return message
      ? [{ key: typedKey, inputId: inputIdForField(typedKey), label: labels[typedKey], message } satisfies BlockingField]
      : [];
  });
}

function errorIdForField(key: CronFieldKey) {
  return `cron-error-${key}`;
}

function inputIdForField(key: CronFieldKey) {
  if (key === "name") return "cron-name";
  if (key === "scheduleAt") return "cron-schedule-at";
  if (key === "everyAmount") return "cron-every-amount";
  if (key === "cronExpr") return "cron-cron-expr";
  if (key === "staggerAmount") return "cron-stagger-amount";
  if (key === "payloadText") return "cron-payload-text";
  if (key === "payloadModel") return "cron-payload-model";
  if (key === "payloadThinking") return "cron-payload-thinking";
  if (key === "timeoutSeconds") return "cron-timeout-seconds";
  if (key === "failureAlertAfter") return "cron-failure-alert-after";
  if (key === "failureAlertCooldownSeconds") return "cron-failure-alert-cooldown-seconds";
  return "cron-delivery-to";
}

function fieldA11yProps(key: CronFieldKey, errors: CronFieldErrors) {
  const message = errors[key];
  return {
    id: inputIdForField(key),
    "aria-invalid": message ? true : undefined,
    "aria-describedby": message ? errorIdForField(key) : undefined,
  };
}

function ensureCurrentOption(options: string[], current: string) {
  const normalized = current.trim();
  return normalized && !options.includes(normalized) ? [...options, normalized] : options;
}

function toggleSelection<T extends string>(selected: T[], value: T) {
  return selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value];
}

function formatQueryError(error: unknown) {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return String(error);
}

function renderFieldError(message?: string, id?: string) {
  return message ? <div id={id} className="cron-field__error">{message}</div> : null;
}

function renderFieldHint(message?: string) {
  return message ? <div className="cron-field__hint">{message}</div> : null;
}

function formatScheduleKindLabel(kind: CronSchedule["kind"], isChinese = false) {
  if (kind === "every") return isChinese ? "间隔" : "Interval";
  if (kind === "at") return isChinese ? "单次" : "One-shot";
  return "Cron";
}

function formatPayloadKindLabel(kind: CronPayload["kind"], isChinese = false) {
  return kind === "agentTurn" ? (isChinese ? "智能体轮次" : "Agent turn") : isChinese ? "系统事件" : "System event";
}

function formatSessionTargetLabel(target: CronJob["sessionTarget"] | CronFormState["sessionTarget"], isChinese = false) {
  return target === "isolated" ? (isChinese ? "隔离" : "Isolated") : isChinese ? "主会话" : "Main";
}

function formatWakeModeLabel(mode: CronJob["wakeMode"] | CronFormState["wakeMode"], isChinese = false) {
  return mode === "next-heartbeat" ? (isChinese ? "下次心跳" : "Next heartbeat") : isChinese ? "立即" : "Immediate";
}

function formatJobsSortLabel(sortBy: CronJobsSortBy, sortDir: CronSortDir, isChinese = false) {
  const sortLabel =
    sortBy === "nextRunAtMs"
      ? isChinese
        ? "下次运行"
        : "Next run"
      : sortBy === "updatedAtMs"
        ? isChinese
          ? "最近更新"
          : "Recently updated"
        : isChinese
          ? "名称"
          : "Name";
  return `${sortLabel} · ${sortDir === "asc" ? (isChinese ? "升序" : "Ascending") : isChinese ? "降序" : "Descending"}`;
}

function formatDateTimeWithRelative(timestamp?: number | null, isChinese = false) {
  if (timestamp == null) return isChinese ? "暂无" : "n/a";
  return `${formatDateTime(timestamp)} · ${formatRelativeTimestamp(timestamp, isChinese)}`;
}

function CheckboxCopy(props: { label: string; hint: string }) {
  return (
    <span className="cron-checkbox__copy">
      <strong>{props.label}</strong>
      <small>{props.hint}</small>
    </span>
  );
}

function EmptyState(props: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tone?: "default" | "loading" | "danger";
}) {
  return (
    <div className={cx("cron-empty-box", props.tone && `cron-empty-box--${props.tone}`)}>
      <div className={cx("cron-empty-box__icon", props.tone === "loading" && "is-spinning")}>{props.icon}</div>
      <div className="cron-empty-box__copy">
        <strong>{props.title}</strong>
        <span>{props.body}</span>
      </div>
    </div>
  );
}

function MetricCard(props: { label: string; value: string; subcopy: string; icon: React.ReactNode; tone?: "default" | "danger" | "ok" | "warn" }) {
  return (
    <div className={cx("cron-summary-pill", props.tone && `cron-summary-pill--${props.tone}`)}>
      <div className="cron-summary-pill__icon">{props.icon}</div>
      <span className="cron-summary-pill__label">{props.label}</span>
      <strong className="cron-summary-pill__value">{props.value}</strong>
      <span className="cron-summary-pill__subcopy">{props.subcopy}</span>
    </div>
  );
}

export function CronPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isConnected = useConnectionStore((state) => state.state === "connected");
  const selectAgent = useChatStore((state) => state.selectAgent);
  const selectSession = useChatStore((state) => state.selectSession);
  const agentsQuery = useAgentsDirectory();
  const language = useAppPreferencesStore((store) => store.language);
  const isChinese = isChineseLanguage(language);
  const t = (zh: string, en: string) => (isChinese ? zh : en);

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedRunKey, setSelectedRunKey] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [form, setForm] = useState<CronFormState>(defaultCronForm);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [wakeText, setWakeText] = useState("");
  const [wakeMode, setWakeMode] = useState<"now" | "next-heartbeat">("next-heartbeat");
  const [wakeMessage, setWakeMessage] = useState<string | null>(null);

  const [jobSearch, setJobSearch] = useState("");
  const [jobsEnabledFilter, setJobsEnabledFilter] = useState<CronJobsEnabledFilter>("all");
  const [jobsScheduleKindFilter, setJobsScheduleKindFilter] = useState<CronJobScheduleKindFilter>("all");
  const [jobsLastStatusFilter, setJobsLastStatusFilter] = useState<CronJobLastStatusFilter>("all");
  const [jobsSortBy, setJobsSortBy] = useState<CronJobsSortBy>("nextRunAtMs");
  const [jobsSortDir, setJobsSortDir] = useState<CronSortDir>("asc");
  const [jobsLimit, setJobsLimit] = useState(DEFAULT_PAGE_SIZE);

  const [runsScope, setRunsScope] = useState<CronRunScope>("job");
  const [runsQueryText, setRunsQueryText] = useState("");
  const [runsSortDir, setRunsSortDir] = useState<CronSortDir>("desc");
  const [runsLimit, setRunsLimit] = useState(DEFAULT_PAGE_SIZE);
  const [runsStatuses, setRunsStatuses] = useState<CronRunStatus[]>([]);
  const [runsDeliveryStatuses, setRunsDeliveryStatuses] = useState<CronDeliveryStatus[]>([]);

  useEffect(() => {
    setJobsLimit(DEFAULT_PAGE_SIZE);
  }, [jobSearch, jobsEnabledFilter, jobsScheduleKindFilter, jobsLastStatusFilter, jobsSortBy, jobsSortDir]);

  useEffect(() => {
    setRunsLimit(DEFAULT_PAGE_SIZE);
  }, [runsScope, selectedJobId, runsQueryText, runsSortDir, runsStatuses.join("|"), runsDeliveryStatuses.join("|")]);

  const statusQuery = useQuery({
    queryKey: [CRON_QUERY_KEY, "status"],
    queryFn: loadCronStatus,
    enabled: isConnected,
  });

  const supportQuery = useQuery({
    queryKey: [CRON_QUERY_KEY, "support"],
    queryFn: loadCronSupport,
    enabled: isConnected,
  });

  const jobsQuery = useQuery({
    queryKey: [CRON_QUERY_KEY, "jobs", jobSearch, jobsEnabledFilter, jobsSortBy, jobsSortDir, jobsLimit],
    queryFn: async () =>
      normalizeCronJobs(
        await gateway.request<unknown>("cron.list", {
          includeDisabled: jobsEnabledFilter === "all",
          enabled: jobsEnabledFilter,
          query: jobSearch.trim() || undefined,
          sortBy: jobsSortBy,
          sortDir: jobsSortDir,
          limit: jobsLimit,
        }),
      ),
    enabled: isConnected,
  });

  const runsQuery = useQuery({
    queryKey: [
      CRON_QUERY_KEY,
      "runs",
      runsScope,
      selectedJobId,
      runsQueryText,
      runsSortDir,
      runsLimit,
      runsStatuses.join("|"),
      runsDeliveryStatuses.join("|"),
    ],
    queryFn: async () =>
      normalizeCronRuns(
        await gateway.request<unknown>("cron.runs", {
          scope: runsScope,
          id: runsScope === "job" ? selectedJobId ?? undefined : undefined,
          limit: runsLimit,
          query: runsQueryText.trim() || undefined,
          sortDir: runsSortDir,
          statuses: runsStatuses.length > 0 ? runsStatuses : undefined,
          deliveryStatuses: runsDeliveryStatuses.length > 0 ? runsDeliveryStatuses : undefined,
        }),
      ),
    enabled: isConnected && (runsScope === "all" || Boolean(selectedJobId)),
  });

  const allLoadedJobs = jobsQuery.data?.jobs ?? [];
  const visibleJobs = useMemo(
    () =>
      allLoadedJobs.filter((job) => {
        if (jobsScheduleKindFilter !== "all" && job.schedule.kind !== jobsScheduleKindFilter) {
          return false;
        }
        if (jobsLastStatusFilter !== "all" && getJobLastStatus(job) !== jobsLastStatusFilter) {
          return false;
        }
        return true;
      }),
    [allLoadedJobs, jobsLastStatusFilter, jobsScheduleKindFilter],
  );
  const selectedJob = useMemo(
    () => visibleJobs.find((job) => job.id === selectedJobId) ?? null,
    [selectedJobId, visibleJobs],
  );

  useEffect(() => {
    if (visibleJobs.length === 0) {
      setSelectedJobId(null);
      return;
    }
    if (!selectedJobId || !visibleJobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(visibleJobs[0].id);
    }
  }, [selectedJobId, visibleJobs]);

  const runs = runsScope === "job" && !selectedJobId ? [] : runsQuery.data?.entries ?? [];
  const selectedRun = useMemo(
    () => runs.find((entry) => getRunKey(entry) === selectedRunKey) ?? runs[0] ?? null,
    [runs, selectedRunKey],
  );

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunKey(null);
      return;
    }
    if (!selectedRunKey || !runs.some((entry) => getRunKey(entry) === selectedRunKey)) {
      setSelectedRunKey(getRunKey(runs[0]));
    }
  }, [runs, selectedRunKey]);

  const supportsAnnounce = form.sessionTarget === "isolated" && form.payloadKind === "agentTurn";
  const fieldErrors = useMemo(
    () => validateCronForm(form, supportsAnnounce, isChinese),
    [form, isChinese, supportsAnnounce],
  );
  const blockingFields = useMemo(() => orderedBlockingFields(fieldErrors, isChinese), [fieldErrors, isChinese]);
  const canSubmit = blockingFields.length === 0;

  const agentSuggestions = useMemo(() => {
    const options = (agentsQuery.data?.agents ?? []).map((agent) => agent.id).filter(Boolean);
    return ensureCurrentOption(options.sort((left, right) => left.localeCompare(right)), form.agentId);
  }, [agentsQuery.data?.agents, form.agentId]);

  const modelSuggestions = useMemo(
    () => ensureCurrentOption(supportQuery.data?.models ?? [], form.payloadModel),
    [form.payloadModel, supportQuery.data?.models],
  );

  const thinkingSuggestions = useMemo(() => {
    const fromJobs = allLoadedJobs.flatMap((job) =>
      job.payload.kind === "agentTurn" && job.payload.thinking ? [job.payload.thinking] : [],
    );
    return ensureCurrentOption(
      Array.from(new Set([...CRON_THINKING_SUGGESTIONS, ...fromJobs])).sort((left, right) =>
        left.localeCompare(right),
      ),
      form.payloadThinking,
    );
  }, [allLoadedJobs, form.payloadThinking]);

  const timezoneSuggestions = useMemo(() => {
    const fromJobs = allLoadedJobs.flatMap((job) =>
      job.schedule.kind === "cron" && job.schedule.tz ? [job.schedule.tz] : [],
    );
    return ensureCurrentOption(
      Array.from(new Set([...TIMEZONE_SUGGESTIONS, ...fromJobs])).sort((left, right) =>
        left.localeCompare(right),
      ),
      form.cronTz,
    );
  }, [allLoadedJobs, form.cronTz]);

  const deliveryToSuggestions = useMemo(() => {
    const values = allLoadedJobs.flatMap((job) => [job.delivery?.to, job.failureAlert && job.failureAlert !== false ? job.failureAlert.to : undefined]).filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    return ensureCurrentOption(
      Array.from(new Set(values)).sort((left, right) => left.localeCompare(right)),
      form.deliveryTo,
    );
  }, [allLoadedJobs, form.deliveryTo]);

  const accountSuggestions = useMemo(() => {
    const values = allLoadedJobs.flatMap((job) => [job.delivery?.accountId, job.failureAlert && job.failureAlert !== false ? job.failureAlert.accountId : undefined]).filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    return ensureCurrentOption(
      Array.from(new Set(values)).sort((left, right) => left.localeCompare(right)),
      form.deliveryAccountId,
    );
  }, [allLoadedJobs, form.deliveryAccountId]);

  const channels = useMemo(() => {
    const base = (supportQuery.data?.channels ?? []).map((channel) => channel.id);
    return Array.from(new Set([DEFAULT_CHANNEL, ...base, form.deliveryChannel, form.failureAlertChannel].filter(Boolean)));
  }, [form.deliveryChannel, form.failureAlertChannel, supportQuery.data?.channels]);

  const channelLabelById = useMemo(
    () => Object.fromEntries((supportQuery.data?.channels ?? []).map((channel) => [channel.id, channel.label])),
    [supportQuery.data?.channels],
  );
  const resolveChannelLabel = (channelId: string) =>
    channelId === DEFAULT_CHANNEL ? t("上次使用的频道", "last used channel") : channelLabelById[channelId] ?? channelId;

  const pageBusy =
    statusQuery.isFetching || supportQuery.isFetching || jobsQuery.isFetching || runsQuery.isFetching;
  const jobsActiveFilters =
    jobSearch.trim().length > 0 ||
    jobsEnabledFilter !== "all" ||
    jobsScheduleKindFilter !== "all" ||
    jobsLastStatusFilter !== "all" ||
    jobsSortBy !== "nextRunAtMs" ||
    jobsSortDir !== "asc";
  const jobsActiveFilterCount = [
    jobSearch.trim().length > 0,
    jobsEnabledFilter !== "all",
    jobsScheduleKindFilter !== "all",
    jobsLastStatusFilter !== "all",
    jobsSortBy !== "nextRunAtMs" || jobsSortDir !== "asc",
  ].filter(Boolean).length;
  const runsActiveFilters =
    runsScope !== "job" ||
    runsQueryText.trim().length > 0 ||
    runsSortDir !== "desc" ||
    runsStatuses.length > 0 ||
    runsDeliveryStatuses.length > 0;
  const runsActiveFilterCount = [
    runsScope !== "job",
    runsQueryText.trim().length > 0,
    runsSortDir !== "desc",
    runsStatuses.length > 0,
    runsDeliveryStatuses.length > 0,
  ].filter(Boolean).length;
  const unhealthyJobs = allLoadedJobs.filter(
    (job) => getJobLastStatus(job) === "error" || (job.state.consecutiveErrors ?? 0) > 0,
  );

  const refreshAll = async () => {
    await queryClient.invalidateQueries({ queryKey: [CRON_QUERY_KEY] });
  };

  const focusFormField = (inputId: string) => {
    const element = document.getElementById(inputId);
    if (!(element instanceof HTMLElement)) return;
    element.focus();
    element.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const openChatSession = (sessionKey?: string | null) => {
    const nextSessionKey = sessionKey?.trim();
    if (!nextSessionKey) {
      setNotice({ kind: "error", text: t("该运行没有可打开的会话。", "This run does not have an openable chat session.") });
      return;
    }
    const agentMatch = nextSessionKey.match(/^agent:([^:]+):/);
    selectAgent(agentMatch?.[1] ?? null);
    selectSession(nextSessionKey);
    navigate("/chat");
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        agentId: form.clearAgent ? null : form.agentId.trim() || undefined,
        sessionKey: form.sessionKey.trim() || undefined,
        enabled: form.enabled,
        deleteAfterRun: form.deleteAfterRun,
        schedule: buildSchedule(form, isChinese),
        sessionTarget: form.sessionTarget,
        wakeMode: form.wakeMode,
        payload: buildPayload(form, isChinese),
        delivery: buildDelivery(form, supportsAnnounce),
        failureAlert: buildFailureAlert(form),
      };
      if (!payload.name) {
        throw new Error(t("定时任务名称必填。", "Cron job name is required."));
      }
      if (editingJobId) {
        return gateway.request<unknown>("cron.update", { id: editingJobId, patch: payload });
      }
      return gateway.request<unknown>("cron.add", payload);
    },
    onSuccess: async (result) => {
      const record = asRecord(result);
      const nextId = readString(record, "id");
      setSubmitError(null);
      setNotice({ kind: "info", text: editingJobId ? t("定时任务已更新。", "Cron job updated.") : t("定时任务已创建。", "Cron job created.") });
      setEditingJobId(null);
      setForm(defaultCronForm());
      if (nextId) {
        setSelectedJobId(nextId);
      }
      await refreshAll();
    },
    onError: (error) => {
      setSubmitError(formatQueryError(error) ?? t("无法保存定时任务。", "Unable to save cron job."));
    },
  });

  const actionMutation = useMutation({
    mutationFn: async (action: CronAction) => {
      if (action.type === "toggle") {
        return gateway.request("cron.update", { id: action.job.id, patch: { enabled: action.enabled } });
      }
      if (action.type === "run") {
        return gateway.request("cron.run", { id: action.job.id, mode: action.mode });
      }
      if (action.type === "delete") {
        return gateway.request("cron.remove", { id: action.job.id });
      }
      return gateway.request("wake", { mode: action.wakeMode, text: action.wakeText });
    },
    onSuccess: async (_result, action) => {
      if (action.type === "wake") {
        setWakeMessage(t("唤醒信号已发送。", "Wake signal sent."));
      } else if (action.type === "delete") {
        setNotice({ kind: "info", text: isChinese ? `已删除 ${action.job.name}。` : `Removed ${action.job.name}.` });
        if (selectedJobId === action.job.id) {
          setSelectedJobId(null);
        }
        if (editingJobId === action.job.id) {
          setEditingJobId(null);
          setForm(defaultCronForm());
        }
      } else if (action.type === "toggle") {
        setNotice({
          kind: "info",
          text: isChinese
            ? `${action.job.name}已${action.enabled ? "启用" : "停用"}。`
            : `${action.job.name} ${action.enabled ? "enabled" : "disabled"}.`,
        });
      } else {
        setNotice({
          kind: "info",
          text: isChinese
            ? `已触发 ${action.job.name}（${action.mode === "force" ? "强制运行" : "到期运行"}）。`
            : `Triggered ${action.job.name} (${action.mode}).`,
        });
      }
      await refreshAll();
    },
    onError: (error, action) => {
      const message = formatQueryError(error) ?? t("定时任务操作失败。", "Cron action failed.");
      if (action.type === "wake") {
        setWakeMessage(message);
      } else {
        setNotice({ kind: "error", text: message });
      }
    },
  });

  const activeJobAction = actionMutation.variables?.type !== "wake" ? actionMutation.variables : null;

  function startEditing(job: CronJob) {
    setEditingJobId(job.id);
    setSelectedJobId(job.id);
    setForm(formFromJob(job));
    setSubmitError(null);
    setNotice(null);
  }

  function startCloning(job: CronJob) {
    const clone = formFromJob(job);
    clone.name = buildCloneName(job.name, allLoadedJobs.map((entry) => entry.name), isChinese);
    clone.clearAgent = false;
    setEditingJobId(null);
    setSelectedJobId(job.id);
    setForm(clone);
    setSubmitError(null);
    setNotice({
      kind: "info",
      text: isChinese ? `已准备 ${job.name} 的副本。` : `Prepared a clone of ${job.name}.`,
    });
  }

  function resetForm() {
    setEditingJobId(null);
    setForm(defaultCronForm());
    setSubmitError(null);
  }

  function resetJobFilters() {
    setJobSearch("");
    setJobsEnabledFilter("all");
    setJobsScheduleKindFilter("all");
    setJobsLastStatusFilter("all");
    setJobsSortBy("nextRunAtMs");
    setJobsSortDir("asc");
  }

  function resetRunFilters() {
    setRunsScope("job");
    setRunsQueryText("");
    setRunsSortDir("desc");
    setRunsStatuses([]);
    setRunsDeliveryStatuses([]);
  }

  const queryError =
    formatQueryError(statusQuery.error) ??
    formatQueryError(supportQuery.error) ??
    formatQueryError(jobsQuery.error) ??
    formatQueryError(runsQuery.error);

  if (!isConnected) {
    return (
      <div className="cron-page cron-page--empty">
        <CalendarClock size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">{t("定时任务", "Cron")}</h2>
        <p className="workspace-subtitle">
          {t("先连接网关，再管理定时任务、查看运行历史，并对齐官方 cron 工作区。", "Connect a gateway to manage scheduled jobs, browse run history, and mirror the upstream cron workspace.")}
        </p>
      </div>
    );
  }

  return (
    <div className="cron-page">
      <Card className="cron-toolbar-shell">
        <div className="cron-toolbar">
          <div className="cron-toolbar__copy">
            <div className="cron-toolbar__eyebrow">{t("网关调度器", "Gateway Scheduler")}</div>
            <h2 className="workspace-title">{t("定时任务", "Cron")}</h2>
            <p className="workspace-subtitle">
              {t("在一个高密度工作区里查看计划、最近执行记录和投递健康状态。", "Review schedules, recent executions, and delivery health in one dense workspace.")}
            </p>
            {statusQuery.data?.storePath && (
              <div className="cron-store-path">
                <span className="cron-store-path__label">{t("存储", "Store")}</span>
                <span className="cron-store-path__value">{statusQuery.data.storePath}</span>
              </div>
            )}
          </div>
          <div className="cron-toolbar__actions">
            <div className="cron-toolbar__meta-group">
              <div className="cron-toolbar__meta">
                <span>{t("网关", "Gateway")}</span>
                <strong>{statusQuery.data?.enabled ? t("已启用", "Enabled") : t("已停用", "Disabled")}</strong>
              </div>
              <div className="cron-toolbar__meta">
                <span>{t("当前范围", "Selected Scope")}</span>
                <strong>{runsScope === "all" ? t("全部任务", "All jobs") : selectedJob?.name ?? t("当前任务", "Selected job")}</strong>
              </div>
            </div>
            <div className="cron-toolbar__cta">
              <Button variant="secondary" onClick={() => void refreshAll()} loading={pageBusy}>
                <RefreshCw size={14} />
                {t("刷新", "Refresh")}
              </Button>
              <Button variant="secondary" onClick={resetForm}>
                <Plus size={14} />
                {t("新建任务", "New Job")}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {(notice || queryError || submitError) && (
        <div
          className={cx(
            "cron-inline-alert",
            (notice?.kind === "error" || queryError || submitError) && "cron-inline-alert--error",
          )}
        >
          {notice?.kind === "error" || queryError || submitError ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{submitError ?? queryError ?? notice?.text}</span>
        </div>
      )}

      <section className="cron-summary-strip">
        <MetricCard
          label={t("定时状态", "Cron state")}
          value={statusQuery.data?.enabled ? t("已启用", "Enabled") : t("已停用", "Disabled")}
          subcopy={
            statusQuery.data?.nextWakeAtMs
              ? formatRelativeTimestamp(statusQuery.data.nextWakeAtMs, isChinese)
              : t("暂无唤醒计划", "No wake scheduled")
          }
          icon={<CalendarClock size={16} />}
          tone={statusQuery.data?.enabled ? "ok" : "warn"}
        />
        <MetricCard
          label={t("任务", "Jobs")}
          value={formatCount(statusQuery.data?.jobs ?? allLoadedJobs.length, isChinese)}
          subcopy={
            isChinese
              ? `已显示 ${visibleJobs.length.toLocaleString()} / 已加载 ${(jobsQuery.data?.total ?? visibleJobs.length).toLocaleString()}`
              : `${visibleJobs.length.toLocaleString()} visible of ${(jobsQuery.data?.total ?? visibleJobs.length).toLocaleString()} loaded`
          }
          icon={<Filter size={16} />}
        />
        <MetricCard
          label={t("失败", "Failures")}
          value={unhealthyJobs.length.toLocaleString()}
          subcopy={
            unhealthyJobs.length > 0
              ? isChinese
                ? `${unhealthyJobs[0].name} 需要处理`
                : `${unhealthyJobs[0].name} needs attention`
              : t("最近没有失败任务", "No recent failing jobs")
          }
          icon={<AlertTriangle size={16} />}
          tone={unhealthyJobs.length > 0 ? "danger" : "ok"}
        />
        <MetricCard
          label={t("运行", "Runs")}
          value={(runsQuery.data?.total ?? runs.length).toLocaleString()}
          subcopy={
            runsScope === "all"
              ? t("覆盖全部任务", "Across all jobs")
              : selectedJob
                ? isChinese
                  ? `${selectedJob.name} 的运行记录`
                  : `For ${selectedJob.name}`
                : t("请选择一个任务", "Select a job")
          }
          icon={<Clock3 size={16} />}
        />
      </section>

      <div className="cron-workspace">
        <div className="cron-workspace__main">
          <Card className="cron-card cron-section-card">
            <div className="cron-card__header">
              <div>
                <h3>{t("任务", "Jobs")}</h3>
                <p>{t("集中管理计划并快速查看状态，让列表更容易扫读。", "Manage schedules, inspect state quickly, and keep the list easy to scan.")}</p>
              </div>
              <div className="cron-card__header-actions">
                <span className="cron-pill cron-pill--soft">
                  {isChinese
                    ? `已显示 ${visibleJobs.length.toLocaleString()} / ${(jobsQuery.data?.total ?? visibleJobs.length).toLocaleString()}`
                    : `${visibleJobs.length.toLocaleString()} of ${(jobsQuery.data?.total ?? visibleJobs.length).toLocaleString()} shown`}
                </span>
                {jobsActiveFilters && (
                  <span className="cron-pill cron-pill--warn">
                    {isChinese ? `${jobsActiveFilterCount} 个生效中` : `${jobsActiveFilterCount} active`}
                  </span>
                )}
                {jobsActiveFilters && (
                  <Button variant="secondary" size="sm" onClick={resetJobFilters}>
                    {t("重置筛选", "Reset Filters")}
                  </Button>
                )}
              </div>
            </div>

            <div className="cron-filters-grid cron-filters-grid--jobs cron-filter-surface">
              <label className="cron-field cron-field--search">
                <span>{t("搜索任务", "Search jobs")}</span>
                <div className="cron-search-field">
                  <Search size={14} />
                  <input
                    value={jobSearch}
                    onChange={(event) => setJobSearch(event.target.value)}
                    placeholder={t("搜索名称、描述、智能体、会话 Key", "Search name, description, agent, session key")}
                  />
                </div>
              </label>
              <label className="cron-field">
                <span>{t("启用状态", "Enabled")}</span>
                <select value={jobsEnabledFilter} onChange={(event) => setJobsEnabledFilter(event.target.value as CronJobsEnabledFilter)}>
                  <option value="all">{t("全部", "All")}</option>
                  <option value="enabled">{t("已启用", "Enabled")}</option>
                  <option value="disabled">{t("已停用", "Disabled")}</option>
                </select>
              </label>
              <label className="cron-field">
                <span>{t("计划", "Schedule")}</span>
                <select
                  value={jobsScheduleKindFilter}
                  onChange={(event) => setJobsScheduleKindFilter(event.target.value as CronJobScheduleKindFilter)}
                >
                  <option value="all">{t("全部", "All")}</option>
                  <option value="every">{t("间隔", "Every")}</option>
                  <option value="at">{t("单次", "One-shot")}</option>
                  <option value="cron">Cron</option>
                </select>
              </label>
              <label className="cron-field">
                <span>{t("最近状态", "Last status")}</span>
                <select
                  value={jobsLastStatusFilter}
                  onChange={(event) => setJobsLastStatusFilter(event.target.value as CronJobLastStatusFilter)}
                >
                  <option value="all">{t("全部", "All")}</option>
                  <option value="ok">{formatRunStatusLabel("ok", isChinese)}</option>
                  <option value="error">{formatRunStatusLabel("error", isChinese)}</option>
                  <option value="skipped">{formatRunStatusLabel("skipped", isChinese)}</option>
                </select>
              </label>
              <label className="cron-field">
                <span>{t("排序", "Sort")}</span>
                <select value={jobsSortBy} onChange={(event) => setJobsSortBy(event.target.value as CronJobsSortBy)}>
                  <option value="nextRunAtMs">{t("下次运行", "Next run")}</option>
                  <option value="updatedAtMs">{t("最近更新", "Recently updated")}</option>
                  <option value="name">{t("名称", "Name")}</option>
                </select>
              </label>
              <label className="cron-field">
                <span>{t("方向", "Direction")}</span>
                <select value={jobsSortDir} onChange={(event) => setJobsSortDir(event.target.value as CronSortDir)}>
                  <option value="asc">{t("升序", "Ascending")}</option>
                  <option value="desc">{t("降序", "Descending")}</option>
                </select>
              </label>
            </div>

            {jobsActiveFilters && (
              <div className="cron-active-filters">
                <span className="cron-active-filters__label">{t("当前筛选", "Active filters")}</span>
                {jobSearch.trim() && <span className="cron-pill cron-pill--soft">{t("搜索", "Search")}: {jobSearch.trim()}</span>}
                {jobsEnabledFilter !== "all" && (
                  <span className="cron-pill cron-pill--soft">
                    {t("状态", "State")}: {jobsEnabledFilter === "enabled" ? t("已启用", "Enabled") : t("已停用", "Disabled")}
                  </span>
                )}
                {jobsScheduleKindFilter !== "all" && <span className="cron-pill cron-pill--soft">{t("计划", "Schedule")}: {formatScheduleKindLabel(jobsScheduleKindFilter, isChinese)}</span>}
                {jobsLastStatusFilter !== "all" && <span className="cron-pill cron-pill--soft">{t("最近状态", "Last status")}: {formatRunStatusLabel(jobsLastStatusFilter, isChinese)}</span>}
                {(jobsSortBy !== "nextRunAtMs" || jobsSortDir !== "asc") && (
                  <span className="cron-pill cron-pill--soft">{t("排序", "Sort")}: {formatJobsSortLabel(jobsSortBy, jobsSortDir, isChinese)}</span>
                )}
              </div>
            )}

            {jobsQuery.isLoading ? (
              <EmptyState
                icon={<RefreshCw size={18} />}
                title={t("正在加载任务", "Loading jobs")}
                body={t("正在从网关拉取当前调度任务目录。", "Pulling the current scheduler catalog from the gateway.")}
                tone="loading"
              />
            ) : visibleJobs.length === 0 ? (
              <EmptyState
                icon={<Search size={18} />}
                title={t("没有找到任务", "No jobs found")}
                body={t("调整上方筛选条件，或在右侧表单中创建新任务。", "Adjust the filters above or create a new job from the form panel.")}
              />
            ) : (
              <div className="cron-job-list">
                {visibleJobs.map((job) => {
                  const isSelected = job.id === selectedJobId;
                  const lastStatus = getJobLastStatus(job);
                  const isActionPending =
                    actionMutation.isPending &&
                    activeJobAction &&
                    "job" in activeJobAction &&
                    activeJobAction.job.id === job.id;
                  return (
                    <div
                      key={job.id}
                      className={cx(
                        "cron-job-row",
                        isSelected && "is-selected",
                        job.state.runningAtMs && "is-running",
                        lastStatus === "error" && "is-danger",
                      )}
                    >
                      <button
                        type="button"
                        className="cron-job-row__main"
                        onClick={() => setSelectedJobId(job.id)}
                        aria-pressed={isSelected}
                      >
                        <div className="cron-job-row__top">
                          <div>
                            <div className="cron-job-row__title">{job.name}</div>
                            <div className="cron-job-row__subcopy">
                              {job.description?.trim() || describePayload(job.payload, isChinese)}
                            </div>
                          </div>
                          <div className="cron-job-row__badges">
                            <StatusBadge
                              status={job.state.runningAtMs ? "running" : job.enabled ? "connected" : "disconnected"}
                              label={job.state.runningAtMs ? t("运行中", "Running") : job.enabled ? t("已启用", "Enabled") : t("已停用", "Disabled")}
                            />
                            {(job.state.consecutiveErrors ?? 0) > 0 && (
                              <span className="cron-pill cron-pill--danger">
                                {isChinese
                                  ? `连续错误 ${(job.state.consecutiveErrors ?? 0).toLocaleString()} 次`
                                  : `${(job.state.consecutiveErrors ?? 0).toLocaleString()} consecutive errors`}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="cron-pill-row">
                          <span className="cron-pill cron-pill--soft">{formatScheduleKindLabel(job.schedule.kind, isChinese)}</span>
                          <span className="cron-pill cron-pill--soft">{formatPayloadKindLabel(job.payload.kind, isChinese)}</span>
                          <span className="cron-pill cron-pill--soft">{formatSessionTargetLabel(job.sessionTarget, isChinese)}</span>
                          <span className="cron-pill cron-pill--soft">{formatWakeModeLabel(job.wakeMode, isChinese)}</span>
                          <span className="cron-pill cron-pill--soft">{describeDelivery(job, isChinese)}</span>
                          {job.failureAlert !== undefined && (
                            <span className="cron-pill cron-pill--warn">{describeFailureAlert(job, isChinese)}</span>
                          )}
                        </div>

                        <div className="cron-kv-grid">
                          <div className="cron-kv-card">
                            <span>{t("计划", "Schedule")}</span>
                            <strong>{formatScheduleKindLabel(job.schedule.kind, isChinese)}</strong>
                            <small className="cron-kv-card__meta">{describeSchedule(job.schedule, isChinese)}</small>
                          </div>
                          <div className="cron-kv-card">
                            <span>{t("下次运行", "Next run")}</span>
                            <strong title={formatDateTime(job.state.nextRunAtMs)}>{formatRelativeTimestamp(job.state.nextRunAtMs, isChinese)}</strong>
                            <small className="cron-kv-card__meta">{formatDateTime(job.state.nextRunAtMs)}</small>
                          </div>
                          <div className="cron-kv-card">
                            <span>{t("最近状态", "Last status")}</span>
                            <strong>{formatRunStatusLabel(lastStatus, isChinese)}</strong>
                            <small className="cron-kv-card__meta">
                              {job.state.lastRunAtMs
                                ? isChinese
                                  ? `上次运行 ${formatRelativeTimestamp(job.state.lastRunAtMs, isChinese)}`
                                  : `Last run ${formatRelativeTimestamp(job.state.lastRunAtMs, isChinese)}`
                                : t("暂无运行记录", "No runs recorded yet")}
                            </small>
                          </div>
                          <div className="cron-kv-card">
                            <span>{t("更新时间", "Updated")}</span>
                            <strong>{formatRelativeTimestamp(job.updatedAtMs, isChinese)}</strong>
                            <small className="cron-kv-card__meta">{formatDateTime(job.updatedAtMs)}</small>
                          </div>
                        </div>

                        {job.state.lastError && (
                          <div className="cron-job-row__error">{job.state.lastError}</div>
                        )}
                      </button>

                      <div className="cron-job-row__actions">
                        <Button variant="secondary" size="sm" onClick={() => startEditing(job)}>
                          {t("编辑", "Edit")}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => startCloning(job)}>
                          <CopyPlus size={12} />
                          {t("克隆", "Clone")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => actionMutation.mutate({ type: "toggle", job, enabled: !job.enabled })}
                          loading={isActionPending && activeJobAction?.type === "toggle"}
                        >
                          {job.enabled ? t("停用", "Disable") : t("启用", "Enable")}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => actionMutation.mutate({ type: "run", job, mode: "force" })}
                          loading={isActionPending && activeJobAction?.type === "run" && activeJobAction.mode === "force"}
                        >
                          <Play size={12} />
                          {t("立即运行", "Run Now")}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            if (window.confirm(isChinese ? `确认删除定时任务“${job.name}”吗？` : `Delete cron job \"${job.name}\"?`)) {
                              actionMutation.mutate({ type: "delete", job });
                            }
                          }}
                          loading={isActionPending && activeJobAction?.type === "delete"}
                        >
                          <Trash2 size={12} />
                          {t("删除", "Delete")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {jobsQuery.data?.hasMore && (
              <div className="cron-load-more">
                <Button variant="secondary" onClick={() => setJobsLimit((current) => current + DEFAULT_PAGE_SIZE)}>
                  {t("加载更多任务", "Load More Jobs")}
                </Button>
              </div>
            )}
          </Card>

          {selectedJob && (
            <Card className="cron-card cron-detail-spotlight">
              <div className="cron-card__header">
                <div>
                  <h3>{selectedJob.name}</h3>
                  <p>{selectedJob.description?.trim() || describePayload(selectedJob.payload, isChinese)}</p>
                </div>
                <div className="cron-card__header-actions">
                  <Button variant="secondary" size="sm" onClick={() => startEditing(selectedJob)}>
                    {t("编辑", "Edit")}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => startCloning(selectedJob)}>
                    {t("克隆", "Clone")}
                  </Button>
                  <Button size="sm" onClick={() => actionMutation.mutate({ type: "run", job: selectedJob, mode: "due" })}>
                    <Play size={12} />
                    {t("仅在到期时运行", "Run if due")}
                  </Button>
                </div>
              </div>

              <div className="cron-pill-row cron-pill-row--header">
                <span className={cx("cron-pill", selectedJob.enabled ? "cron-pill--ok" : "cron-pill--soft")}>
                  {selectedJob.enabled ? t("已启用", "Enabled") : t("已停用", "Disabled")}
                </span>
                <span className="cron-pill cron-pill--soft">{formatScheduleKindLabel(selectedJob.schedule.kind, isChinese)}</span>
                <span className="cron-pill cron-pill--soft">{formatPayloadKindLabel(selectedJob.payload.kind, isChinese)}</span>
                <span className="cron-pill cron-pill--soft">{formatSessionTargetLabel(selectedJob.sessionTarget, isChinese)}</span>
                <span className="cron-pill cron-pill--soft">{formatWakeModeLabel(selectedJob.wakeMode, isChinese)}</span>
              </div>

              {(selectedJob.state.consecutiveErrors ?? 0) > 0 && (
                <div className="cron-inline-alert cron-inline-alert--error compact">
                  <AlertTriangle size={16} />
                  <span>
                    {isChinese
                      ? `已连续失败 ${selectedJob.state.consecutiveErrors} 次。上次告警时间：${formatDateTime(selectedJob.state.lastFailureAlertAtMs)}。`
                      : `${selectedJob.state.consecutiveErrors} consecutive failures. Last alert ${formatDateTime(selectedJob.state.lastFailureAlertAtMs)}.`}
                  </span>
                </div>
              )}

              <div className="cron-spotlight-grid">
                <div className="cron-panel-card">
                  <h4>{t("执行", "Execution")}</h4>
                  <div className="cron-kv-list">
                    <div className="cron-kv-row"><span>{t("计划", "Schedule")}</span><strong>{describeSchedule(selectedJob.schedule, isChinese)}</strong></div>
                    <div className="cron-kv-row"><span>{t("目标", "Target")}</span><strong>{formatSessionTargetLabel(selectedJob.sessionTarget, isChinese)}</strong></div>
                    <div className="cron-kv-row"><span>{t("唤醒模式", "Wake mode")}</span><strong>{formatWakeModeLabel(selectedJob.wakeMode, isChinese)}</strong></div>
                    <div className="cron-kv-row"><span>{t("会话 Key", "Session key")}</span><strong>{selectedJob.sessionKey || t("暂无", "n/a")}</strong></div>
                    <div className="cron-kv-row"><span>{t("智能体", "Agent")}</span><strong>{selectedJob.agentId || t("继承默认值", "inherit")}</strong></div>
                  </div>
                </div>
                <div className="cron-panel-card">
                  <h4>{t("健康状态", "Health")}</h4>
                  <div className="cron-kv-list">
                    <div className="cron-kv-row"><span>{t("下次运行", "Next run")}</span><strong>{formatDateTimeWithRelative(selectedJob.state.nextRunAtMs, isChinese)}</strong></div>
                    <div className="cron-kv-row"><span>{t("上次运行", "Last run")}</span><strong>{formatDateTimeWithRelative(selectedJob.state.lastRunAtMs, isChinese)}</strong></div>
                    <div className="cron-kv-row"><span>{t("最近状态", "Last status")}</span><strong>{formatRunStatusLabel(getJobLastStatus(selectedJob), isChinese)}</strong></div>
                    <div className="cron-kv-row"><span>{t("最近耗时", "Last duration")}</span><strong>{formatDuration(selectedJob.state.lastDurationMs, isChinese)}</strong></div>
                    <div className="cron-kv-row"><span>{t("连续错误", "Consecutive errors")}</span><strong>{formatCount(selectedJob.state.consecutiveErrors ?? 0, isChinese)}</strong></div>
                  </div>
                </div>
                <div className="cron-panel-card">
                  <h4>{t("投递", "Delivery")}</h4>
                  <div className="cron-kv-list">
                    <div className="cron-kv-row"><span>{t("主投递方式", "Primary delivery")}</span><strong>{describeDelivery(selectedJob, isChinese)}</strong></div>
                    <div className="cron-kv-row"><span>{t("最近投递", "Last delivery")}</span><strong>{formatDeliveryStatusLabel(selectedJob.state.lastDeliveryStatus, isChinese)}</strong></div>
                    <div className="cron-kv-row"><span>{t("失败告警", "Failure alerts")}</span><strong>{describeFailureAlert(selectedJob, isChinese)}</strong></div>
                    <div className="cron-kv-row"><span>{t("更新时间", "Updated")}</span><strong>{formatDateTime(selectedJob.updatedAtMs)}</strong></div>
                  </div>
                </div>
              </div>

              {(selectedJob.state.lastError || selectedJob.state.lastDeliveryError) && (
                <div className="cron-error-columns">
                  {selectedJob.state.lastError && (
                    <div className="cron-panel-card">
                      <h4>{t("最近执行错误", "Last execution error")}</h4>
                      <div className="cron-error-box">{selectedJob.state.lastError}</div>
                    </div>
                  )}
                  {selectedJob.state.lastDeliveryError && (
                    <div className="cron-panel-card">
                      <h4>{t("最近投递错误", "Last delivery error")}</h4>
                      <div className="cron-error-box">{selectedJob.state.lastDeliveryError}</div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          <Card className="cron-card cron-section-card">
            <div className="cron-card__header">
              <div>
                <h3>{t("运行记录", "Runs")}</h3>
                <p>{t("先扫一遍最近执行记录，再在右侧查看更安静的详情面板。", "Scan recent executions first, then inspect the selected run in a calmer detail pane.")}</p>
              </div>
              <div className="cron-card__header-actions">
                <span className="cron-pill cron-pill--soft">
                  {runsScope === "all" ? t("全部任务", "All jobs") : selectedJob ? selectedJob.name : t("当前任务", "Selected job")}
                </span>
                {runsActiveFilters && <span className="cron-pill cron-pill--warn">{isChinese ? `${runsActiveFilterCount} 个生效中` : `${runsActiveFilterCount} active`}</span>}
                {runsActiveFilters && (
                  <Button variant="secondary" size="sm" onClick={resetRunFilters}>
                    {t("重置筛选", "Reset Filters")}
                  </Button>
                )}
              </div>
            </div>

            <div className="cron-filters-grid cron-filters-grid--runs cron-filter-surface">
              <label className="cron-field">
                <span>{t("范围", "Scope")}</span>
                <select value={runsScope} onChange={(event) => setRunsScope(event.target.value as CronRunScope)}>
                  <option value="job">{t("当前任务", "Selected job")}</option>
                  <option value="all">{t("全部任务", "All jobs")}</option>
                </select>
              </label>
              <label className="cron-field cron-field--search">
                <span>{t("搜索运行记录", "Search runs")}</span>
                <div className="cron-search-field">
                  <Search size={14} />
                  <input
                    value={runsQueryText}
                    onChange={(event) => setRunsQueryText(event.target.value)}
                    placeholder={t("搜索摘要、错误、任务名、模型", "Search summary, error, job name, model")}
                  />
                </div>
              </label>
              <label className="cron-field">
                <span>{t("排序", "Sort")}</span>
                <select value={runsSortDir} onChange={(event) => setRunsSortDir(event.target.value as CronSortDir)}>
                  <option value="desc">{t("最新优先", "Newest first")}</option>
                  <option value="asc">{t("最早优先", "Oldest first")}</option>
                </select>
              </label>
              <div className="cron-filter-group">
                <span>{t("状态", "Status")}</span>
                <div className="cron-chip-toggle-row">
                  {(["ok", "error", "skipped"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={cx("cron-chip-toggle", runsStatuses.includes(status) && "is-active")}
                      onClick={() => setRunsStatuses((current) => toggleSelection(current, status))}
                    >
                      {formatRunStatusLabel(status, isChinese)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="cron-filter-group">
                <span>{t("投递", "Delivery")}</span>
                <div className="cron-chip-toggle-row">
                  {(["delivered", "not-delivered", "unknown", "not-requested"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={cx("cron-chip-toggle", runsDeliveryStatuses.includes(status) && "is-active")}
                      onClick={() => setRunsDeliveryStatuses((current) => toggleSelection(current, status))}
                    >
                      {formatDeliveryStatusLabel(status, isChinese)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {runsActiveFilters && (
              <div className="cron-active-filters">
                <span className="cron-active-filters__label">{t("当前筛选", "Active filters")}</span>
                {runsScope !== "job" && <span className="cron-pill cron-pill--soft">{t("范围", "Scope")}: {t("全部任务", "all jobs")}</span>}
                {runsQueryText.trim() && <span className="cron-pill cron-pill--soft">{t("搜索", "Search")}: {runsQueryText.trim()}</span>}
                {runsSortDir !== "desc" && <span className="cron-pill cron-pill--soft">{t("排序", "Sort")}: {t("最早优先", "oldest first")}</span>}
                {runsStatuses.length > 0 && <span className="cron-pill cron-pill--soft">{t("状态", "Status")}: {runsStatuses.map((status) => formatRunStatusLabel(status, isChinese)).join(", ")}</span>}
                {runsDeliveryStatuses.length > 0 && <span className="cron-pill cron-pill--soft">{t("投递", "Delivery")}: {runsDeliveryStatuses.map((status) => formatDeliveryStatusLabel(status, isChinese)).join(", ")}</span>}
              </div>
            )}

            {runsScope === "job" && !selectedJob ? (
              <EmptyState
                icon={<Clock3 size={18} />}
                title={t("请选择任务", "Select a job")}
                body={t("先在上方选择一个任务，才能加载它的运行历史和详情。", "Choose a job row above to load its run history and detail pane.")}
              />
            ) : runsQuery.isLoading ? (
              <EmptyState
                icon={<RefreshCw size={18} />}
                title={t("正在加载运行记录", "Loading runs")}
                body={t("正在从网关获取最新执行历史。", "Fetching the latest execution history from the gateway.")}
                tone="loading"
              />
            ) : runs.length === 0 ? (
              <EmptyState
                icon={<Search size={18} />}
                title={t("没有找到运行记录", "No runs found")}
                body={t("可以放宽搜索条件，或清除上方某个筛选项。", "Try a broader search or clear one of the run filters above.")}
              />
            ) : (
              <div className="cron-runs-layout">
                <div className="cron-runs-list-shell">
                  <div className="cron-subpanel-header">
                    <div>
                      <h4>{t("最近运行", "Recent runs")}</h4>
                      <p>{isChinese ? `当前视图已加载 ${runs.length.toLocaleString()} 条。` : `${runs.length.toLocaleString()} loaded in the current view.`}</p>
                    </div>
                  </div>
                  <div className="cron-runs-list">
                  {runs.map((entry) => {
                    const status = getRunStatus(entry);
                    const active = selectedRunKey === getRunKey(entry);
                    return (
                      <button
                        key={getRunKey(entry)}
                        type="button"
                        className={cx("cron-run-row", active && "is-active", status === "error" && "is-danger")}
                        onClick={() => setSelectedRunKey(getRunKey(entry))}
                        aria-pressed={active}
                      >
                        <div className="cron-run-row__top">
                          <div>
                            <div className="cron-run-row__title">{entry.jobName || entry.jobId}</div>
                            <div className="cron-run-row__subcopy">{formatDateTime(entry.ts)} · {formatRelativeTimestamp(entry.ts, isChinese)}</div>
                          </div>
                          <span className={cx("cron-pill", `cron-pill--${runTone(status)}`)}>{formatRunStatusLabel(status, isChinese)}</span>
                        </div>
                        <div className="cron-pill-row">
                          <span className="cron-pill cron-pill--soft">{formatDeliveryStatusLabel(entry.deliveryStatus, isChinese)}</span>
                          {entry.provider && <span className="cron-pill cron-pill--soft">{entry.provider}</span>}
                          {entry.model && <span className="cron-pill cron-pill--soft">{entry.model}</span>}
                          {entry.durationMs != null && <span className="cron-pill cron-pill--soft">{formatDuration(entry.durationMs, isChinese)}</span>}
                        </div>
                        <div className="cron-run-row__summary">{entry.error || entry.summary || t("暂无摘要。", "No summary recorded.")}</div>
                      </button>
                    );
                  })}
                </div>
                </div>

                <div className="cron-run-detail cron-run-detail--panel">
                  {selectedRun ? (
                    <>
                      <div className="cron-card__header compact cron-subpanel-header">
                        <div>
                          <h4>{selectedRun.jobName || selectedRun.jobId}</h4>
                          <p>{formatDateTime(selectedRun.ts)} · {formatRelativeTimestamp(selectedRun.ts, isChinese)}</p>
                        </div>
                        <div className="cron-card__header-actions">
                          {selectedRun.sessionKey && (
                            <Button variant="secondary" size="sm" onClick={() => openChatSession(selectedRun.sessionKey)}>
                              {t("打开运行会话", "Open Run Chat")}
                            </Button>
                          )}
                          <span className={cx("cron-pill", `cron-pill--${runTone(getRunStatus(selectedRun))}`)}>
                            {formatRunStatusLabel(getRunStatus(selectedRun), isChinese)}
                          </span>
                          <span className="cron-pill cron-pill--soft">{formatDeliveryStatusLabel(selectedRun.deliveryStatus, isChinese)}</span>
                        </div>
                      </div>

                      {selectedRun.error && (
                        <div className="cron-inline-alert cron-inline-alert--error compact">
                          <AlertTriangle size={16} />
                          <span>{selectedRun.error}</span>
                        </div>
                      )}

                      <div className="cron-kv-grid">
                        <div className="cron-kv-card"><span>{t("耗时", "Duration")}</span><strong>{formatDuration(selectedRun.durationMs, isChinese)}</strong></div>
                        <div className="cron-kv-card"><span>{t("总 Token", "Total tokens")}</span><strong>{formatCount(selectedRun.usage?.total_tokens, isChinese)}</strong></div>
                        <div className="cron-kv-card"><span>{t("运行时间", "Run at")}</span><strong>{formatDateTimeWithRelative(selectedRun.runAtMs, isChinese)}</strong></div>
                        <div className="cron-kv-card"><span>{t("下次运行", "Next run")}</span><strong>{formatDateTimeWithRelative(selectedRun.nextRunAtMs, isChinese)}</strong></div>
                      </div>

                      <div className="cron-panel-card">
                        <h4>{t("运行详情", "Run details")}</h4>
                        <div className="cron-kv-list">
                          <div className="cron-kv-row"><span>{t("投递", "Delivery")}</span><strong>{formatDeliveryStatusLabel(selectedRun.deliveryStatus, isChinese)}</strong></div>
                          <div className="cron-kv-row"><span>{t("提供方", "Provider")}</span><strong>{selectedRun.provider || t("暂无", "n/a")}</strong></div>
                          <div className="cron-kv-row"><span>{t("模型", "Model")}</span><strong>{selectedRun.model || t("暂无", "n/a")}</strong></div>
                          <div className="cron-kv-row"><span>{t("会话 ID", "Session ID")}</span><strong>{selectedRun.sessionId || t("暂无", "n/a")}</strong></div>
                          <div className="cron-kv-row"><span>{t("会话 Key", "Session key")}</span><strong>{selectedRun.sessionKey || t("暂无", "n/a")}</strong></div>
                        </div>
                      </div>

                      <div className="cron-panel-card">
                        <h4>{t("摘要", "Summary")}</h4>
                        <div className="cron-run-detail__text">
                          {selectedRun.summary || selectedRun.error || t("暂无运行摘要。", "No run summary recorded.")}
                        </div>
                        {selectedRun.deliveryError && (
                          <div className="cron-error-box">{selectedRun.deliveryError}</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <EmptyState
                      icon={<Clock3 size={18} />}
                      title={t("请选择运行记录", "Choose a run")}
                      body={t("选择一条执行记录后，可查看投递元数据、用量和摘要输出。", "Select an execution row to inspect delivery metadata, usage, and summary output.")}
                    />
                  )}
                </div>
              </div>
            )}

            {runsQuery.data?.hasMore && (
              <div className="cron-load-more">
                <Button variant="secondary" onClick={() => setRunsLimit((current) => current + DEFAULT_PAGE_SIZE)}>
                  {t("加载更多运行记录", "Load More Runs")}
                </Button>
              </div>
            )}
          </Card>
        </div>

        <div className="cron-workspace__sidebar">
          <Card className="cron-card cron-form-card">
            <div className="cron-card__header">
              <div>
                <h3>{editingJobId ? t("编辑任务", "Edit job") : t("新建任务", "New job")}</h3>
                <p>{editingJobId ? t("在不丢失上下文的前提下调整时间、负载和投递设置。", "Adjust timing, payload, or delivery without losing context.") : t("用更清晰的分区、紧凑的标签和更稳定的节奏创建任务。", "Create a job with clear sections, tighter labels, and calmer spacing.")}</p>
              </div>
              {editingJobId && selectedJob && (
                <StatusBadge
                  status={selectedJob.enabled ? "connected" : "disconnected"}
                  label={selectedJob.enabled ? t("已启用", "Enabled") : t("已停用", "Disabled")}
                />
              )}
            </div>

            {blockingFields.length > 0 && (
              <div className="cron-form-status" role="status" aria-live="polite">
                <div className="cron-form-status__title">
                  <AlertTriangle size={16} />
                  <span>{t("暂时还不能创建任务", "Can't add job yet")}</span>
                </div>
                <div className="cron-form-status__subtitle">
                  {isChinese
                    ? `还需修复 ${blockingFields.length} 个字段后才能继续。`
                    : `Fix ${blockingFields.length} field${blockingFields.length === 1 ? "" : "s"} to continue.`}
                </div>
                <ul className="cron-form-status__list">
                  {blockingFields.map((field) => (
                    <li key={field.key}>
                      <button type="button" className="cron-form-status__link" onClick={() => focusFormField(field.inputId)}>
                        {field.label}: {field.message}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="cron-form-sections">
              <div className="cron-form-required">
                <span className="cron-form-required__dot">*</span>
                {t("带 * 的项目遵循官方 cron 校验流程。", "Required values follow the upstream cron validation flow.")}
              </div>

              <section className="cron-form-section">
                <div className="cron-form-section__header">
                  <h4>{t("基础信息", "Basics")}</h4>
                  <p>{t("定义任务名称、归属关系和生命周期。", "Name the job and define its ownership and lifecycle.")}</p>
                </div>
                <div className="cron-form-grid">
                  <label className="cron-field cron-span-2">
                    <span>{t("名称", "Name")}</span>
                    <input
                      {...fieldA11yProps("name", fieldErrors)}
                      className={cx(fieldErrors.name && "is-invalid")}
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder={t("晨间摘要", "Morning digest")}
                    />
                    {renderFieldHint(t("会显示在任务列表、运行历史和告警里。", "Used in the jobs list, run history, and alerts."))}
                    {renderFieldError(fieldErrors.name, errorIdForField("name"))}
                  </label>
                  <label className="cron-field cron-span-2">
                    <span>{t("描述", "Description")}</span>
                    <input
                      value={form.description}
                      onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                      placeholder={t("说明这个任务的作用", "Explain what this job does")}
                    />
                    {renderFieldHint(t("给运维快速扫读用的可选简短描述。", "Optional short description for operators scanning the page."))}
                  </label>
                  <label className="cron-field">
                    <span>{t("智能体 ID", "Agent ID")}</span>
                    <input
                      id="cron-agent-id"
                      value={form.agentId}
                      list="cron-agent-suggestions"
                      disabled={form.clearAgent}
                      onChange={(event) => setForm((current) => ({ ...current, agentId: event.target.value }))}
                      placeholder={t("可选覆盖", "Optional override")}
                    />
                    {renderFieldHint(t("留空则继承默认智能体路由。", "Leave blank to inherit the default agent routing."))}
                  </label>
                  <label className="cron-checkbox">
                    <input
                      type="checkbox"
                      checked={form.clearAgent}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          clearAgent: event.target.checked,
                          agentId: event.target.checked ? "" : current.agentId,
                        }))
                      }
                    />
                    <CheckboxCopy label={t("清空智能体覆盖", "Clear agent override")} hint={t("显式移除已有的智能体覆盖，回退到默认路由。", "Explicitly remove any existing agent override and fall back to default routing.")} />
                  </label>
                  <label className="cron-field">
                    <span>{t("会话 Key", "Session key")}</span>
                    <input
                      id="cron-session-key"
                      value={form.sessionKey}
                      onChange={(event) => setForm((current) => ({ ...current, sessionKey: event.target.value }))}
                      placeholder={t("可选会话绑定", "Optional session pinning")}
                    />
                    {renderFieldHint(t("把投递和唤醒行为固定到特定会话路由。", "Pins delivery and wake behavior to a specific session route."))}
                  </label>
                  <label className="cron-checkbox">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
                    />
                    <CheckboxCopy label={t("启用", "Enabled")} hint={t("让调度器在扫描和到期检查时包含这个任务。", "Include this job in scheduler scans and due checks.")} />
                  </label>
                  <label className="cron-checkbox">
                    <input
                      type="checkbox"
                      checked={form.deleteAfterRun}
                      onChange={(event) => setForm((current) => ({ ...current, deleteAfterRun: event.target.checked }))}
                    />
                    <CheckboxCopy label={t("运行后删除", "Delete after run")} hint={t("下一次成功执行后自动删除该任务。", "Remove the job automatically after its next successful execution.")} />
                  </label>
                </div>
              </section>

              <section className="cron-form-section">
                <div className="cron-form-section__header">
                  <h4>{t("计划", "Schedule")}</h4>
                  <p>{t("选择间隔执行、单次执行或 Cron 表达式计划。", "Choose interval, one-shot, or cron-expression timing.")}</p>
                </div>
                <div className="cron-form-grid">
                  <label className="cron-field cron-span-2">
                    <span>{t("计划类型", "Schedule type")}</span>
                    <select
                      value={form.scheduleKind}
                      onChange={(event) => setForm((current) => ({ ...current, scheduleKind: event.target.value as CronFormState["scheduleKind"] }))}
                    >
                      <option value="every">{t("间隔执行", "Every")}</option>
                      <option value="at">{t("单次执行", "One-shot at")}</option>
                      <option value="cron">{t("Cron 表达式", "Cron expression")}</option>
                    </select>
                    {renderFieldHint(t("可选间隔计划、单次执行，或 Cron 表达式计划。", "Choose an interval, a one-shot run, or a cron expression schedule."))}
                  </label>

                  {form.scheduleKind === "every" && (
                    <>
                      <label className="cron-field">
                        <span>{t("重复间隔", "Repeat every")}</span>
                        <input
                          {...fieldA11yProps("everyAmount", fieldErrors)}
                          className={cx(fieldErrors.everyAmount && "is-invalid")}
                          value={form.everyAmount}
                          onChange={(event) => setForm((current) => ({ ...current, everyAmount: event.target.value }))}
                          placeholder="15"
                        />
                        {renderFieldHint(t("请输入大于 0 的整数频率。", "Use a positive integer cadence."))}
                        {renderFieldError(fieldErrors.everyAmount, errorIdForField("everyAmount"))}
                      </label>
                      <label className="cron-field">
                        <span>{t("单位", "Unit")}</span>
                        <select
                          value={form.everyUnit}
                          onChange={(event) => setForm((current) => ({ ...current, everyUnit: event.target.value as CronFormState["everyUnit"] }))}
                        >
                          <option value="minutes">{t("分钟", "Minutes")}</option>
                          <option value="hours">{t("小时", "Hours")}</option>
                          <option value="days">{t("天", "Days")}</option>
                        </select>
                        {renderFieldHint(t("与网关调度器使用的间隔单位保持一致。", "Matches the interval unit used by the gateway scheduler."))}
                      </label>
                    </>
                  )}

                  {form.scheduleKind === "at" && (
                    <label className="cron-field cron-span-2">
                      <span>{t("执行时间", "Run at")}</span>
                      <input
                        type="datetime-local"
                        {...fieldA11yProps("scheduleAt", fieldErrors)}
                        className={cx(fieldErrors.scheduleAt && "is-invalid")}
                        value={form.scheduleAt}
                        onChange={(event) => setForm((current) => ({ ...current, scheduleAt: event.target.value }))}
                      />
                      {renderFieldHint(t("单次任务使用本地日期和时间。", "Use a local date and time for this one-shot job."))}
                      {renderFieldError(fieldErrors.scheduleAt, errorIdForField("scheduleAt"))}
                    </label>
                  )}

                  {form.scheduleKind === "cron" && (
                    <>
                      <label className="cron-field cron-span-2">
                        <span>{t("Cron 表达式", "Cron expression")}</span>
                        <input
                          {...fieldA11yProps("cronExpr", fieldErrors)}
                          className={cx(fieldErrors.cronExpr && "is-invalid")}
                          value={form.cronExpr}
                          onChange={(event) => setForm((current) => ({ ...current, cronExpr: event.target.value }))}
                          placeholder="0 * * * *"
                        />
                        {renderFieldHint(t("五段 Cron 语法，下方可选配置时区。", "Five-field cron syntax, with optional timezone below."))}
                        {renderFieldError(fieldErrors.cronExpr, errorIdForField("cronExpr"))}
                      </label>
                      <label className="cron-field">
                        <span>{t("时区", "Timezone")}</span>
                        <input
                          value={form.cronTz}
                          list="cron-tz-suggestions"
                          onChange={(event) => setForm((current) => ({ ...current, cronTz: event.target.value }))}
                          placeholder={t("UTC 或 Asia/Shanghai", "UTC or America/Los_Angeles")}
                        />
                        {renderFieldHint(t("留空则使用调度器默认时区。", "Leave blank to use the scheduler default timezone."))}
                      </label>
                      <label className="cron-checkbox">
                        <input
                          type="checkbox"
                          checked={form.scheduleExact}
                          onChange={(event) => setForm((current) => ({ ...current, scheduleExact: event.target.checked }))}
                        />
                        <CheckboxCopy label={t("精确计划", "Exact schedule")} hint={t("关闭错峰随机化，严格按 Cron 边界执行。", "Disable stagger randomization and run exactly on the cron boundary.")} />
                      </label>
                      <label className="cron-field">
                        <span>{t("错峰", "Stagger")}</span>
                        <input
                          disabled={form.scheduleExact}
                          {...fieldA11yProps("staggerAmount", fieldErrors)}
                          className={cx(fieldErrors.staggerAmount && "is-invalid")}
                          value={form.staggerAmount}
                          onChange={(event) => setForm((current) => ({ ...current, staggerAmount: event.target.value }))}
                          placeholder={t("可选", "Optional")}
                        />
                        {renderFieldHint(t("用于分散密集任务的可选时间窗口。", "Optional spread window for distributing clustered jobs."))}
                        {renderFieldError(fieldErrors.staggerAmount, errorIdForField("staggerAmount"))}
                      </label>
                      <label className="cron-field">
                        <span>{t("错峰单位", "Stagger unit")}</span>
                        <select
                          disabled={form.scheduleExact}
                          value={form.staggerUnit}
                          onChange={(event) => setForm((current) => ({ ...current, staggerUnit: event.target.value as CronFormState["staggerUnit"] }))}
                        >
                          <option value="seconds">{t("秒", "Seconds")}</option>
                          <option value="minutes">{t("分钟", "Minutes")}</option>
                        </select>
                        {renderFieldHint(t("紧凑计划用更短窗口，突发控制用更长窗口。", "Use shorter windows for tight schedules and larger windows for burst control."))}
                      </label>
                    </>
                  )}
                </div>
              </section>

              <section className="cron-form-section">
                <div className="cron-form-section__header">
                  <h4>{t("执行", "Execution")}</h4>
                  <p>{t("选择任务运行位置以及发送内容。", "Choose where the job runs and what it sends.")}</p>
                </div>
                <div className="cron-form-grid">
                  <label className="cron-field">
                    <span>{t("会话目标", "Session target")}</span>
                    <select
                      value={form.sessionTarget}
                      onChange={(event) => setForm((current) => ({ ...current, sessionTarget: event.target.value as CronFormState["sessionTarget"] }))}
                    >
                      <option value="main">{t("主会话", "Main")}</option>
                      <option value="isolated">{t("隔离会话", "Isolated")}</option>
                    </select>
                    {renderFieldHint(t("隔离任务可启用广播投递和独立运行上下文。", "Isolated jobs unlock announce delivery and dedicated run context."))}
                  </label>
                  <label className="cron-field">
                    <span>{t("唤醒模式", "Wake mode")}</span>
                    <select
                      value={form.wakeMode}
                      onChange={(event) => setForm((current) => ({ ...current, wakeMode: event.target.value as CronFormState["wakeMode"] }))}
                    >
                      <option value="next-heartbeat">{t("下次心跳", "Next heartbeat")}</option>
                      <option value="now">{t("立即", "Now")}</option>
                    </select>
                    {renderFieldHint(t("决定网关是立即唤醒还是等到下次心跳。", "Choose whether the gateway wakes immediately or on the next heartbeat."))}
                  </label>
                  <label className="cron-field">
                    <span>{t("负载类型", "Payload type")}</span>
                    <select
                      value={form.payloadKind}
                      onChange={(event) => setForm((current) => ({ ...current, payloadKind: event.target.value as CronFormState["payloadKind"] }))}
                    >
                      <option value="agentTurn">{t("智能体轮次", "Agent turn")}</option>
                      <option value="systemEvent">{t("系统事件", "System event")}</option>
                    </select>
                    {renderFieldHint(t("智能体轮次支持模型、思考预算和投递控制。", "Agent turns support model, thinking, and delivery controls."))}
                  </label>
                  {form.payloadKind === "agentTurn" && (
                    <label className="cron-field">
                      <span>{t("超时秒数", "Timeout seconds")}</span>
                      <input
                        {...fieldA11yProps("timeoutSeconds", fieldErrors)}
                        className={cx(fieldErrors.timeoutSeconds && "is-invalid")}
                        value={form.timeoutSeconds}
                        onChange={(event) => setForm((current) => ({ ...current, timeoutSeconds: event.target.value }))}
                        placeholder={t("可选", "Optional")}
                      />
                      {renderFieldHint(t("给长时间运行的智能体轮次设置硬性停止时间。", "Optional hard stop for long-running agent turns."))}
                      {renderFieldError(fieldErrors.timeoutSeconds, errorIdForField("timeoutSeconds"))}
                    </label>
                  )}
                  <label className="cron-field cron-span-2">
                    <span>{form.payloadKind === "agentTurn" ? t("提示词", "Prompt") : t("事件文本", "Event text")}</span>
                    <textarea
                      {...fieldA11yProps("payloadText", fieldErrors)}
                      className={cx("cron-textarea", fieldErrors.payloadText && "is-invalid")}
                      value={form.payloadText}
                      onChange={(event) => setForm((current) => ({ ...current, payloadText: event.target.value }))}
                      placeholder={
                        form.payloadKind === "agentTurn"
                          ? t("总结夜间活动并起草更新", "Summarize overnight activity and draft an update")
                          : t("唤醒智能体流水线", "wake agent pipeline")
                      }
                    />
                    {renderFieldHint(form.payloadKind === "agentTurn" ? t("将作为本次定时运行的轮次消息发送。", "Sent as the turn message for this scheduled run.") : t("将作为原始系统事件负载发送。", "Sent as the raw system event payload."))}
                    {renderFieldError(fieldErrors.payloadText, errorIdForField("payloadText"))}
                  </label>
                  {form.payloadKind === "agentTurn" && (
                    <>
                      <label className="cron-field">
                        <span>{t("模型", "Model")}</span>
                        <input
                          id="cron-payload-model"
                          value={form.payloadModel}
                          list="cron-model-suggestions"
                          onChange={(event) => setForm((current) => ({ ...current, payloadModel: event.target.value }))}
                          placeholder={t("可选模型覆盖", "Optional model override")}
                        />
                        {renderFieldHint(t("仅对当前任务覆盖默认模型。", "Overrides the default model only for this job."))}
                      </label>
                      <label className="cron-field">
                        <span>{t("思考预算", "Thinking")}</span>
                        <input
                          id="cron-payload-thinking"
                          value={form.payloadThinking}
                          list="cron-thinking-suggestions"
                          onChange={(event) => setForm((current) => ({ ...current, payloadThinking: event.target.value }))}
                          placeholder={t("可选思考预算", "Optional reasoning budget")}
                        />
                        {renderFieldHint(t("可选推理或思考预算提示。", "Optional reasoning or thinking budget hint."))}
                      </label>
                      <label className="cron-checkbox cron-span-2">
                        <input
                          type="checkbox"
                          checked={form.payloadLightContext}
                          onChange={(event) => setForm((current) => ({ ...current, payloadLightContext: event.target.checked }))}
                        />
                        <CheckboxCopy label={t("使用轻量上下文", "Use light context")} hint={t("减少启动上下文，让常规轮次更便宜也更快。", "Reduce bootstrap context for cheaper, faster routine turns.")} />
                      </label>
                    </>
                  )}
                </div>
              </section>

              <section className="cron-form-section">
                <div className="cron-form-section__header">
                  <h4>{t("投递", "Delivery")}</h4>
                  <p>{t("把成功输出发到聊天目标或 Webhook。", "Send successful output to chat destinations or a webhook.")}</p>
                </div>
                <div className="cron-form-grid">
                  <label className="cron-field">
                    <span>{t("投递模式", "Delivery mode")}</span>
                    <select
                      id="cron-delivery-mode"
                      className={cx(fieldErrors.deliveryMode && "is-invalid")}
                      value={form.deliveryMode}
                      onChange={(event) => setForm((current) => ({ ...current, deliveryMode: event.target.value as CronFormState["deliveryMode"] }))}
                    >
                      <option value="none">{t("不投递", "None")}</option>
                      <option value="announce">{t("广播", "Announce")}</option>
                      <option value="webhook">Webhook</option>
                    </select>
                    {renderFieldHint(t("广播模式对齐官方行为；Webhook 会把运行结果推送到外部地址。", "Announce matches upstream behavior; webhook posts run output to an external endpoint."))}
                    {renderFieldError(fieldErrors.deliveryMode)}
                  </label>

                  {form.deliveryMode === "announce" && (
                    <>
                      <label className="cron-field">
                        <span>{t("频道", "Channel")}</span>
                        <select
                          value={form.deliveryChannel}
                          onChange={(event) => setForm((current) => ({ ...current, deliveryChannel: event.target.value }))}
                        >
                          {channels.map((channelId) => (
                            <option key={channelId} value={channelId}>
                              {resolveChannelLabel(channelId)}
                            </option>
                          ))}
                        </select>
                        {renderFieldHint(t("除非任务需要固定频道路由，否则使用 `last` 即可。", "Use `last` unless this job needs fixed channel routing."))}
                      </label>
                      <label className="cron-field">
                        <span>{t("接收目标 / 线程", "Recipient / thread")}</span>
                        <input
                          value={form.deliveryTo}
                          list="cron-delivery-to-suggestions"
                          onChange={(event) => setForm((current) => ({ ...current, deliveryTo: event.target.value }))}
                          placeholder={t("可选覆盖", "Optional override")}
                        />
                        {renderFieldHint(t("可选地覆盖直接接收者、线程或频道目标。", "Optional direct recipient, thread, or channel target override."))}
                      </label>
                      <label className="cron-field">
                        <span>{t("账号 ID", "Account ID")}</span>
                        <input
                          value={form.deliveryAccountId}
                          list="cron-delivery-account-suggestions"
                          onChange={(event) => setForm((current) => ({ ...current, deliveryAccountId: event.target.value }))}
                          placeholder={t("可选多账号路由", "Optional multi-account routing")}
                        />
                        {renderFieldHint(t("仅当选定频道配置了多个账号时才需要。", "Needed only when the chosen channel has multiple accounts configured."))}
                      </label>
                    </>
                  )}

                  {form.deliveryMode === "webhook" && (
                    <label className="cron-field cron-span-2">
                      <span>{t("Webhook 地址", "Webhook URL")}</span>
                      <input
                        {...fieldA11yProps("deliveryTo", fieldErrors)}
                        className={cx(fieldErrors.deliveryTo && "is-invalid")}
                        value={form.deliveryTo}
                        onChange={(event) => setForm((current) => ({ ...current, deliveryTo: event.target.value }))}
                        placeholder="https://example.com/hook"
                      />
                      {renderFieldHint(t("网关会把成功运行的输出 POST 到这个地址。", "The gateway posts successful run output to this URL."))}
                      {renderFieldError(fieldErrors.deliveryTo, errorIdForField("deliveryTo"))}
                    </label>
                  )}

                  {form.deliveryMode !== "none" && (
                    <label className="cron-checkbox cron-span-2">
                      <input
                        type="checkbox"
                        checked={form.deliveryBestEffort}
                        onChange={(event) => setForm((current) => ({ ...current, deliveryBestEffort: event.target.checked }))}
                      />
                      <CheckboxCopy label={t("尽力投递", "Best effort delivery")} hint={t("即使投递步骤失败，也不要让整个任务失败。", "Do not fail the job when the delivery step cannot complete.")} />
                    </label>
                  )}
                </div>

                {!supportsAnnounce && form.deliveryMode === "announce" && (
                  <div className="cron-inline-alert compact">
                    <AlertTriangle size={16} />
                    <span>{t("广播投递仅适用于隔离会话的智能体轮次任务。", "Announce delivery only applies to isolated agent-turn jobs.")}</span>
                  </div>
                )}
              </section>

              <section className="cron-form-section">
                <div className="cron-form-section__header">
                  <h4>{t("失败告警", "Failure alerts")}</h4>
                  <p>{t("当任务需要关注时，发送重复失败告警。", "Send repeated-failure alerts when a job needs attention.")}</p>
                </div>
                <div className="cron-form-grid">
                  <label className="cron-field cron-span-2">
                    <span>{t("失败告警模式", "Failure alert mode")}</span>
                    <select
                      value={form.failureAlertMode}
                      onChange={(event) => setForm((current) => ({ ...current, failureAlertMode: event.target.value as CronFormState["failureAlertMode"] }))}
                    >
                      <option value="inherit">{t("继承网关默认值", "Inherit gateway defaults")}</option>
                      <option value="disabled">{t("关闭", "Disabled")}</option>
                      <option value="custom">{t("自定义", "Custom")}</option>
                    </select>
                    {renderFieldHint(t("自定义告警会覆盖网关默认的重复失败行为。", "Custom alerts override the gateway default repeated-failure behavior."))}
                  </label>

                  {form.failureAlertMode === "custom" && (
                    <>
                      <label className="cron-field">
                        <span>{t("告警阈值", "Alert after")}</span>
                        <input
                          {...fieldA11yProps("failureAlertAfter", fieldErrors)}
                          className={cx(fieldErrors.failureAlertAfter && "is-invalid")}
                          value={form.failureAlertAfter}
                          onChange={(event) => setForm((current) => ({ ...current, failureAlertAfter: event.target.value }))}
                          placeholder="3"
                        />
                        {renderFieldHint(t("连续失败多少次后触发首次告警。", "How many consecutive failures occur before the first alert."))}
                        {renderFieldError(fieldErrors.failureAlertAfter, errorIdForField("failureAlertAfter"))}
                      </label>
                      <label className="cron-field">
                        <span>{t("冷却秒数", "Cooldown seconds")}</span>
                        <input
                          {...fieldA11yProps("failureAlertCooldownSeconds", fieldErrors)}
                          className={cx(fieldErrors.failureAlertCooldownSeconds && "is-invalid")}
                          value={form.failureAlertCooldownSeconds}
                          onChange={(event) => setForm((current) => ({ ...current, failureAlertCooldownSeconds: event.target.value }))}
                          placeholder="600"
                        />
                        {renderFieldHint(t("重复告警之间至少需要安静多久。", "Minimum quiet period between repeated alerts."))}
                        {renderFieldError(fieldErrors.failureAlertCooldownSeconds, errorIdForField("failureAlertCooldownSeconds"))}
                      </label>
                      <label className="cron-field">
                        <span>{t("告警方式", "Alert mode")}</span>
                        <select
                          value={form.failureAlertDeliveryMode}
                          onChange={(event) => setForm((current) => ({ ...current, failureAlertDeliveryMode: event.target.value as CronFormState["failureAlertDeliveryMode"] }))}
                        >
                          <option value="announce">{t("广播", "Announce")}</option>
                          <option value="webhook">Webhook</option>
                        </select>
                        {renderFieldHint(t("选择重复失败通知的投递方式。", "Choose how repeated-failure notifications are delivered."))}
                      </label>
                      <label className="cron-field">
                        <span>{t("告警频道", "Alert channel")}</span>
                        <select
                          value={form.failureAlertChannel}
                          onChange={(event) => setForm((current) => ({ ...current, failureAlertChannel: event.target.value }))}
                        >
                          {channels.map((channelId) => (
                            <option key={channelId} value={channelId}>
                              {resolveChannelLabel(channelId)}
                            </option>
                          ))}
                        </select>
                        {renderFieldHint(t("仅在广播型失败告警时使用。", "Only used for announce-based failure alerts."))}
                      </label>
                      <label className="cron-field">
                        <span>{t("告警目标", "Alert to")}</span>
                        <input
                          value={form.failureAlertTo}
                          list="cron-delivery-to-suggestions"
                          onChange={(event) => setForm((current) => ({ ...current, failureAlertTo: event.target.value }))}
                          placeholder={t("可选接收目标覆盖", "Optional recipient override")}
                        />
                        {renderFieldHint(t("可选地为告警负载覆盖接收目标或线程。", "Optional recipient or thread override for the alert payload."))}
                      </label>
                      <label className="cron-field">
                        <span>{t("告警账号 ID", "Alert account ID")}</span>
                        <input
                          value={form.failureAlertAccountId}
                          list="cron-delivery-account-suggestions"
                          onChange={(event) => setForm((current) => ({ ...current, failureAlertAccountId: event.target.value }))}
                          placeholder={t("可选多账号路由", "Optional multi-account routing")}
                        />
                        {renderFieldHint(t("广播型告警可选的多账号频道路由。", "Optional multi-account channel routing for announce alerts."))}
                      </label>
                    </>
                  )}
                </div>
              </section>
            </div>

            <div className="cron-form-actions">
              <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={!canSubmit}>
                <Send size={14} />
                {editingJobId ? t("保存任务", "Save Job") : t("创建任务", "Create Job")}
              </Button>
              <Button variant="secondary" onClick={resetForm}>
                {t("重置", "Reset")}
              </Button>
            </div>
          </Card>

          <Card className="cron-card">
            <div className="cron-card__header">
              <div>
                <h3>{t("唤醒网关", "Wake gateway")}</h3>
                <p>{t("直接触发网关唤醒路径，用于人工唤醒和一致性检查。", "Trigger the gateway wake path directly for manual nudges and parity checks.")}</p>
              </div>
            </div>

            {wakeMessage && (
              <div className={cx("cron-inline-alert", (wakeMessage.toLowerCase().includes("sent") || wakeMessage.includes("已发送")) && "cron-inline-alert--info", "compact")}>
                <Send size={16} />
                <span>{wakeMessage}</span>
              </div>
            )}

            <div className="cron-form-grid">
              <label className="cron-field">
                <span>{t("唤醒模式", "Wake mode")}</span>
                <select value={wakeMode} onChange={(event) => setWakeMode(event.target.value as "now" | "next-heartbeat")}>
                  <option value="next-heartbeat">{t("下次心跳", "Next heartbeat")}</option>
                  <option value="now">{t("立即", "Now")}</option>
                </select>
                {renderFieldHint(t("使用与调度器一致的唤醒语义做一致性测试。", "Use the same wake semantics as the scheduler for parity testing."))}
              </label>
              <label className="cron-field cron-span-2">
                <span>{t("唤醒文本", "Wake text")}</span>
                <textarea
                  className="cron-textarea"
                  value={wakeText}
                  onChange={(event) => setWakeText(event.target.value)}
                  placeholder={t("让主会话总结待处理工作", "Ask the main session to summarize pending work")}
                />
                {renderFieldHint(t("唤醒请求可附带的可选负载。", "Optional payload sent with the wake request."))}
              </label>
            </div>

            <div className="cron-form-actions">
              <Button
                onClick={() => actionMutation.mutate({ type: "wake", wakeMode, wakeText })}
                loading={actionMutation.isPending && actionMutation.variables?.type === "wake"}
              >
                <Send size={14} />
                {t("发送唤醒", "Send Wake")}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <datalist id="cron-agent-suggestions">
        {agentSuggestions.map((agentId) => (
          <option key={agentId} value={agentId} />
        ))}
      </datalist>
      <datalist id="cron-model-suggestions">
        {modelSuggestions.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      <datalist id="cron-thinking-suggestions">
        {thinkingSuggestions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="cron-tz-suggestions">
        {timezoneSuggestions.map((timezone) => (
          <option key={timezone} value={timezone} />
        ))}
      </datalist>
      <datalist id="cron-delivery-to-suggestions">
        {deliveryToSuggestions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="cron-delivery-account-suggestions">
        {accountSuggestions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
    </div>
  );
}
