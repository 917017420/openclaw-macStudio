import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useConnectionStore } from "@/features/connection/store";
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
type Notice = { kind: "info" | "error"; text: string };
type CronAction =
  | { type: "toggle"; job: CronJob; enabled: boolean }
  | { type: "run"; job: CronJob; mode: "force" | "due" }
  | { type: "delete"; job: CronJob }
  | { type: "wake"; wakeMode: "now" | "next-heartbeat"; wakeText: string };

const CRON_QUERY_KEY = "cron-dashboard";
const DEFAULT_PAGE_SIZE = 40;
const DEFAULT_CHANNEL = "last";
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
  if (timestamp == null) return "n/a";
  return new Date(timestamp).toLocaleString();
}

function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs <= 0) {
    return "n/a";
  }
  if (durationMs < 1_000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  return `${(durationMs / 60_000).toFixed(1)} min`;
}

function formatCount(value?: number | null) {
  return value == null ? "n/a" : value.toLocaleString();
}

function formatRelativeTimestamp(timestamp?: number | null) {
  if (timestamp == null) return "n/a";
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

function formatRunStatusLabel(status: CronRunStatus | "unknown") {
  if (status === "ok") return "Succeeded";
  if (status === "error") return "Failed";
  if (status === "skipped") return "Skipped";
  return "Unknown";
}

function formatDeliveryStatusLabel(status?: CronDeliveryStatus) {
  if (status === "delivered") return "Delivered";
  if (status === "not-delivered") return "Not delivered";
  if (status === "not-requested") return "Not requested";
  return "Unknown";
}

function runTone(status: CronRunStatus | "unknown") {
  if (status === "ok") return "ok";
  if (status === "error") return "danger";
  if (status === "skipped") return "warn";
  return "soft";
}

function describeSchedule(schedule: CronSchedule) {
  if (schedule.kind === "at") {
    return `Runs once at ${new Date(schedule.at).toLocaleString()}`;
  }
  if (schedule.kind === "every") {
    const minutes = Math.round(schedule.everyMs / 60_000);
    if (minutes % (60 * 24) === 0) {
      return `Every ${minutes / (60 * 24)} day${minutes === 60 * 24 ? "" : "s"}`;
    }
    if (minutes % 60 === 0) {
      return `Every ${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
    }
    return `Every ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const exact = schedule.staggerMs === 0 ? " · exact" : "";
  const stagger = schedule.staggerMs && schedule.staggerMs > 0 ? ` · stagger ${formatDuration(schedule.staggerMs)}` : "";
  return `${schedule.expr}${schedule.tz ? ` · ${schedule.tz}` : ""}${exact}${stagger}`;
}

function describePayload(payload: CronPayload) {
  if (payload.kind === "systemEvent") {
    return payload.text || "System event";
  }
  return payload.message || "Agent turn";
}

function describeDelivery(job: CronJob) {
  const delivery = job.delivery;
  if (!delivery || delivery.mode === "none") {
    return "No delivery";
  }
  if (delivery.mode === "webhook") {
    return delivery.to ? `Webhook → ${delivery.to}` : "Webhook";
  }
  const channel = delivery.channel?.trim() || DEFAULT_CHANNEL;
  return delivery.to ? `Announce via ${channel} → ${delivery.to}` : `Announce via ${channel}`;
}

function describeFailureAlert(job: CronJob) {
  if (job.failureAlert === false) {
    return "Failure alerts disabled";
  }
  if (!job.failureAlert) {
    return "Gateway defaults";
  }
  const parts = [
    job.failureAlert.after ? `after ${job.failureAlert.after} failures` : "custom threshold",
    job.failureAlert.mode ?? "announce",
  ];
  if (job.failureAlert.channel) {
    parts.push(`channel ${job.failureAlert.channel}`);
  }
  if (job.failureAlert.to) {
    parts.push(`to ${job.failureAlert.to}`);
  }
  return parts.join(" · ");
}

function toNumber(value: string, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function buildSchedule(form: CronFormState): CronSchedule {
  if (form.scheduleKind === "at") {
    const value = form.scheduleAt.trim();
    if (!value) {
      throw new Error("Pick a run time for the one-shot schedule.");
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      throw new Error("Invalid date/time for cron job.");
    }
    return { kind: "at", at: new Date(timestamp).toISOString() };
  }

  if (form.scheduleKind === "every") {
    const amount = toNumber(form.everyAmount, 0);
    if (amount <= 0) {
      throw new Error("Repeat interval must be greater than zero.");
    }
    const multiplier =
      form.everyUnit === "minutes" ? 60_000 : form.everyUnit === "hours" ? 3_600_000 : 86_400_000;
    return { kind: "every", everyMs: amount * multiplier };
  }

  const expr = form.cronExpr.trim();
  if (!expr) {
    throw new Error("Cron expression is required.");
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

function buildPayload(form: CronFormState): CronPayload {
  if (form.payloadKind === "systemEvent") {
    const text = form.payloadText.trim();
    if (!text) {
      throw new Error("System event text is required.");
    }
    return { kind: "systemEvent", text };
  }
  const message = form.payloadText.trim();
  if (!message) {
    throw new Error("Agent turn message is required.");
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

function buildCloneName(name: string, existingNames: string[]) {
  const seen = new Set(existingNames.map((entry) => entry.trim().toLowerCase()));
  const base = `${name} copy`;
  if (!seen.has(base.toLowerCase())) {
    return base;
  }
  let index = 2;
  while (seen.has(`${base} ${index}`.toLowerCase())) {
    index += 1;
  }
  return `${base} ${index}`;
}

function validateCronForm(form: CronFormState, supportsAnnounce: boolean): CronFieldErrors {
  const errors: CronFieldErrors = {};
  if (!form.name.trim()) {
    errors.name = "Name is required.";
  }
  if (form.scheduleKind === "every") {
    const amount = toNumber(form.everyAmount.trim(), 0);
    if (amount <= 0) {
      errors.everyAmount = "Repeat interval must be greater than zero.";
    }
  }
  if (form.scheduleKind === "at") {
    const timestamp = Date.parse(form.scheduleAt.trim());
    if (!Number.isFinite(timestamp)) {
      errors.scheduleAt = "Choose a valid one-shot date and time.";
    }
  }
  if (form.scheduleKind === "cron") {
    if (!form.cronExpr.trim()) {
      errors.cronExpr = "Cron expression is required.";
    }
    if (!form.scheduleExact && form.staggerAmount.trim()) {
      const stagger = toNumber(form.staggerAmount.trim(), 0);
      if (stagger <= 0) {
        errors.staggerAmount = "Stagger must be greater than zero.";
      }
    }
  }
  if (!form.payloadText.trim()) {
    errors.payloadText =
      form.payloadKind === "systemEvent"
        ? "System event text is required."
        : "Agent turn message is required.";
  }
  if (form.payloadKind === "agentTurn" && form.timeoutSeconds.trim()) {
    const timeout = toNumber(form.timeoutSeconds.trim(), 0);
    if (timeout <= 0) {
      errors.timeoutSeconds = "Timeout must be greater than zero.";
    }
  }
  if (form.deliveryMode === "announce" && !supportsAnnounce) {
    errors.deliveryMode = "Announce delivery requires an isolated agent-turn job.";
  }
  if (form.deliveryMode === "webhook") {
    const target = form.deliveryTo.trim();
    if (!target) {
      errors.deliveryTo = "Webhook URL is required.";
    } else if (!/^https?:\/\//i.test(target)) {
      errors.deliveryTo = "Webhook URL must start with http:// or https://.";
    }
  }
  if (form.failureAlertMode === "custom") {
    const after = toNumber(form.failureAlertAfter.trim(), 0);
    if (after <= 0) {
      errors.failureAlertAfter = "Failure alert threshold must be greater than zero.";
    }
    if (form.failureAlertCooldownSeconds.trim()) {
      const cooldown = toNumber(form.failureAlertCooldownSeconds.trim(), -1);
      if (cooldown < 0) {
        errors.failureAlertCooldownSeconds = "Cooldown must be 0 or greater.";
      }
    }
  }
  return errors;
}

function orderedBlockingFields(errors: CronFieldErrors) {
  const labels: Record<CronFieldKey, string> = {
    name: "Name",
    description: "Description",
    enabled: "Enabled",
    agentId: "Agent ID",
    sessionKey: "Session key",
    scheduleKind: "Schedule type",
    scheduleAt: "Run at",
    everyAmount: "Repeat every",
    everyUnit: "Repeat unit",
    cronExpr: "Cron expression",
    cronTz: "Timezone",
    scheduleExact: "Exact schedule",
    staggerAmount: "Stagger",
    staggerUnit: "Stagger unit",
    sessionTarget: "Session target",
    wakeMode: "Wake mode",
    payloadKind: "Payload type",
    payloadText: "Payload text",
    payloadModel: "Model",
    payloadThinking: "Thinking",
    timeoutSeconds: "Timeout",
    payloadLightContext: "Light context",
    deliveryMode: "Delivery mode",
    deliveryChannel: "Delivery channel",
    deliveryTo: "Delivery target",
    deliveryAccountId: "Delivery account ID",
    deliveryBestEffort: "Best effort delivery",
    failureAlertMode: "Failure alert mode",
    failureAlertAfter: "Failure alert threshold",
    failureAlertCooldownSeconds: "Failure alert cooldown",
    failureAlertChannel: "Failure alert channel",
    failureAlertTo: "Failure alert recipient",
    failureAlertDeliveryMode: "Failure alert mode",
    failureAlertAccountId: "Failure alert account ID",
    deleteAfterRun: "Delete after run",
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
    return message ? [{ key: typedKey, label: labels[typedKey], message }] : [];
  });
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

function renderFieldError(message?: string) {
  return message ? <div className="cron-field__error">{message}</div> : null;
}

function renderFieldHint(message?: string) {
  return message ? <div className="cron-field__hint">{message}</div> : null;
}

function formatScheduleKindLabel(kind: CronSchedule["kind"]) {
  if (kind === "every") return "Interval";
  if (kind === "at") return "One-shot";
  return "Cron";
}

function formatPayloadKindLabel(kind: CronPayload["kind"]) {
  return kind === "agentTurn" ? "Agent turn" : "System event";
}

function formatSessionTargetLabel(target: CronJob["sessionTarget"] | CronFormState["sessionTarget"]) {
  return target === "isolated" ? "Isolated" : "Main";
}

function formatWakeModeLabel(mode: CronJob["wakeMode"] | CronFormState["wakeMode"]) {
  return mode === "next-heartbeat" ? "Next heartbeat" : "Immediate";
}

function formatJobsSortLabel(sortBy: CronJobsSortBy, sortDir: CronSortDir) {
  const sortLabel =
    sortBy === "nextRunAtMs" ? "Next run" : sortBy === "updatedAtMs" ? "Recently updated" : "Name";
  return `${sortLabel} · ${sortDir === "asc" ? "Ascending" : "Descending"}`;
}

function formatDateTimeWithRelative(timestamp?: number | null) {
  if (timestamp == null) return "n/a";
  return `${formatDateTime(timestamp)} · ${formatRelativeTimestamp(timestamp)}`;
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
  const isConnected = useConnectionStore((state) => state.state === "connected");
  const agentsQuery = useAgentsDirectory();

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
  const fieldErrors = useMemo(() => validateCronForm(form, supportsAnnounce), [form, supportsAnnounce]);
  const blockingFields = useMemo(() => orderedBlockingFields(fieldErrors), [fieldErrors]);
  const canSubmit = blockingFields.length === 0;

  const agentSuggestions = useMemo(() => {
    const options = (agentsQuery.data?.agents ?? []).map((agent) => agent.id).filter(Boolean);
    return ensureCurrentOption(options.sort((left, right) => left.localeCompare(right)), form.agentId);
  }, [agentsQuery.data?.agents, form.agentId]);

  const modelSuggestions = useMemo(
    () => ensureCurrentOption(supportQuery.data?.models ?? [], form.payloadModel),
    [form.payloadModel, supportQuery.data?.models],
  );

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

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        agentId: form.agentId.trim() || undefined,
        sessionKey: form.sessionKey.trim() || undefined,
        enabled: form.enabled,
        deleteAfterRun: form.deleteAfterRun,
        schedule: buildSchedule(form),
        sessionTarget: form.sessionTarget,
        wakeMode: form.wakeMode,
        payload: buildPayload(form),
        delivery: buildDelivery(form, supportsAnnounce),
        failureAlert: buildFailureAlert(form),
      };
      if (!payload.name) {
        throw new Error("Cron job name is required.");
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
      setNotice({ kind: "info", text: editingJobId ? "Cron job updated." : "Cron job created." });
      setEditingJobId(null);
      setForm(defaultCronForm());
      if (nextId) {
        setSelectedJobId(nextId);
      }
      await refreshAll();
    },
    onError: (error) => {
      setSubmitError(formatQueryError(error) ?? "Unable to save cron job.");
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
        setWakeMessage("Wake signal sent.");
      } else if (action.type === "delete") {
        setNotice({ kind: "info", text: `Removed ${action.job.name}.` });
        if (selectedJobId === action.job.id) {
          setSelectedJobId(null);
        }
        if (editingJobId === action.job.id) {
          setEditingJobId(null);
          setForm(defaultCronForm());
        }
      } else if (action.type === "toggle") {
        setNotice({ kind: "info", text: `${action.job.name} ${action.enabled ? "enabled" : "disabled"}.` });
      } else {
        setNotice({ kind: "info", text: `Triggered ${action.job.name} (${action.mode}).` });
      }
      await refreshAll();
    },
    onError: (error, action) => {
      const message = formatQueryError(error) ?? "Cron action failed.";
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
    clone.name = buildCloneName(job.name, allLoadedJobs.map((entry) => entry.name));
    setEditingJobId(null);
    setSelectedJobId(job.id);
    setForm(clone);
    setSubmitError(null);
    setNotice({ kind: "info", text: `Prepared a clone of ${job.name}.` });
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
        <h2 className="workspace-title">Cron</h2>
        <p className="workspace-subtitle">
          Connect a gateway to manage scheduled jobs, browse run history, and mirror the upstream cron workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="cron-page">
      <Card className="cron-toolbar-shell">
        <div className="cron-toolbar">
          <div className="cron-toolbar__copy">
            <div className="cron-toolbar__eyebrow">Gateway Scheduler</div>
            <h2 className="workspace-title">Cron</h2>
            <p className="workspace-subtitle">
              Review schedules, recent executions, and delivery health in one dense workspace.
            </p>
            {statusQuery.data?.storePath && (
              <div className="cron-store-path">
                <span className="cron-store-path__label">Store</span>
                <span className="cron-store-path__value">{statusQuery.data.storePath}</span>
              </div>
            )}
          </div>
          <div className="cron-toolbar__actions">
            <div className="cron-toolbar__meta-group">
              <div className="cron-toolbar__meta">
                <span>Gateway</span>
                <strong>{statusQuery.data?.enabled ? "Enabled" : "Disabled"}</strong>
              </div>
              <div className="cron-toolbar__meta">
                <span>Selected Scope</span>
                <strong>{runsScope === "all" ? "All jobs" : selectedJob?.name ?? "Selected job"}</strong>
              </div>
            </div>
            <div className="cron-toolbar__cta">
              <Button variant="secondary" onClick={() => void refreshAll()} loading={pageBusy}>
                <RefreshCw size={14} />
                Refresh
              </Button>
              <Button variant="secondary" onClick={resetForm}>
                <Plus size={14} />
                New Job
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
          label="Cron state"
          value={statusQuery.data?.enabled ? "Enabled" : "Disabled"}
          subcopy={statusQuery.data?.nextWakeAtMs ? formatRelativeTimestamp(statusQuery.data.nextWakeAtMs) : "No wake scheduled"}
          icon={<CalendarClock size={16} />}
          tone={statusQuery.data?.enabled ? "ok" : "warn"}
        />
        <MetricCard
          label="Jobs"
          value={formatCount(statusQuery.data?.jobs ?? allLoadedJobs.length)}
          subcopy={`${visibleJobs.length.toLocaleString()} visible of ${(jobsQuery.data?.total ?? visibleJobs.length).toLocaleString()} loaded`}
          icon={<Filter size={16} />}
        />
        <MetricCard
          label="Failures"
          value={unhealthyJobs.length.toLocaleString()}
          subcopy={unhealthyJobs.length > 0 ? `${unhealthyJobs[0].name} needs attention` : "No recent failing jobs"}
          icon={<AlertTriangle size={16} />}
          tone={unhealthyJobs.length > 0 ? "danger" : "ok"}
        />
        <MetricCard
          label="Runs"
          value={(runsQuery.data?.total ?? runs.length).toLocaleString()}
          subcopy={runsScope === "all" ? "Across all jobs" : selectedJob ? `For ${selectedJob.name}` : "Select a job"}
          icon={<Clock3 size={16} />}
        />
      </section>

      <div className="cron-workspace">
        <div className="cron-workspace__main">
          <Card className="cron-card cron-section-card">
            <div className="cron-card__header">
              <div>
                <h3>Jobs</h3>
                <p>Manage schedules, inspect state quickly, and keep the list easy to scan.</p>
              </div>
              <div className="cron-card__header-actions">
                <span className="cron-pill cron-pill--soft">
                  {visibleJobs.length.toLocaleString()} of {(jobsQuery.data?.total ?? visibleJobs.length).toLocaleString()} shown
                </span>
                {jobsActiveFilters && <span className="cron-pill cron-pill--warn">{jobsActiveFilterCount} active</span>}
                {jobsActiveFilters && (
                  <Button variant="secondary" size="sm" onClick={resetJobFilters}>
                    Reset Filters
                  </Button>
                )}
              </div>
            </div>

            <div className="cron-filters-grid cron-filters-grid--jobs cron-filter-surface">
              <label className="cron-field cron-field--search">
                <span>Search jobs</span>
                <div className="cron-search-field">
                  <Search size={14} />
                  <input
                    value={jobSearch}
                    onChange={(event) => setJobSearch(event.target.value)}
                    placeholder="Search name, description, agent, session key"
                  />
                </div>
              </label>
              <label className="cron-field">
                <span>Enabled</span>
                <select value={jobsEnabledFilter} onChange={(event) => setJobsEnabledFilter(event.target.value as CronJobsEnabledFilter)}>
                  <option value="all">All</option>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <label className="cron-field">
                <span>Schedule</span>
                <select
                  value={jobsScheduleKindFilter}
                  onChange={(event) => setJobsScheduleKindFilter(event.target.value as CronJobScheduleKindFilter)}
                >
                  <option value="all">All</option>
                  <option value="every">Every</option>
                  <option value="at">One-shot</option>
                  <option value="cron">Cron</option>
                </select>
              </label>
              <label className="cron-field">
                <span>Last status</span>
                <select
                  value={jobsLastStatusFilter}
                  onChange={(event) => setJobsLastStatusFilter(event.target.value as CronJobLastStatusFilter)}
                >
                  <option value="all">All</option>
                  <option value="ok">Succeeded</option>
                  <option value="error">Failed</option>
                  <option value="skipped">Skipped</option>
                </select>
              </label>
              <label className="cron-field">
                <span>Sort</span>
                <select value={jobsSortBy} onChange={(event) => setJobsSortBy(event.target.value as CronJobsSortBy)}>
                  <option value="nextRunAtMs">Next run</option>
                  <option value="updatedAtMs">Recently updated</option>
                  <option value="name">Name</option>
                </select>
              </label>
              <label className="cron-field">
                <span>Direction</span>
                <select value={jobsSortDir} onChange={(event) => setJobsSortDir(event.target.value as CronSortDir)}>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </label>
            </div>

            {jobsActiveFilters && (
              <div className="cron-active-filters">
                <span className="cron-active-filters__label">Active filters</span>
                {jobSearch.trim() && <span className="cron-pill cron-pill--soft">Search: {jobSearch.trim()}</span>}
                {jobsEnabledFilter !== "all" && <span className="cron-pill cron-pill--soft">State: {jobsEnabledFilter}</span>}
                {jobsScheduleKindFilter !== "all" && <span className="cron-pill cron-pill--soft">Schedule: {formatScheduleKindLabel(jobsScheduleKindFilter)}</span>}
                {jobsLastStatusFilter !== "all" && <span className="cron-pill cron-pill--soft">Last status: {formatRunStatusLabel(jobsLastStatusFilter)}</span>}
                {(jobsSortBy !== "nextRunAtMs" || jobsSortDir !== "asc") && (
                  <span className="cron-pill cron-pill--soft">Sort: {formatJobsSortLabel(jobsSortBy, jobsSortDir)}</span>
                )}
              </div>
            )}

            {jobsQuery.isLoading ? (
              <EmptyState
                icon={<RefreshCw size={18} />}
                title="Loading jobs"
                body="Pulling the current scheduler catalog from the gateway."
                tone="loading"
              />
            ) : visibleJobs.length === 0 ? (
              <EmptyState
                icon={<Search size={18} />}
                title="No jobs found"
                body="Adjust the filters above or create a new job from the form panel."
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
                              {job.description?.trim() || describePayload(job.payload)}
                            </div>
                          </div>
                          <div className="cron-job-row__badges">
                            <StatusBadge
                              status={job.state.runningAtMs ? "running" : job.enabled ? "connected" : "disconnected"}
                              label={job.state.runningAtMs ? "Running" : job.enabled ? "Enabled" : "Disabled"}
                            />
                            {(job.state.consecutiveErrors ?? 0) > 0 && (
                              <span className="cron-pill cron-pill--danger">
                                {(job.state.consecutiveErrors ?? 0).toLocaleString()} consecutive errors
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="cron-pill-row">
                          <span className="cron-pill cron-pill--soft">{formatScheduleKindLabel(job.schedule.kind)}</span>
                          <span className="cron-pill cron-pill--soft">{formatPayloadKindLabel(job.payload.kind)}</span>
                          <span className="cron-pill cron-pill--soft">{formatSessionTargetLabel(job.sessionTarget)}</span>
                          <span className="cron-pill cron-pill--soft">{formatWakeModeLabel(job.wakeMode)}</span>
                          <span className="cron-pill cron-pill--soft">{describeDelivery(job)}</span>
                          {job.failureAlert !== undefined && (
                            <span className="cron-pill cron-pill--warn">{describeFailureAlert(job)}</span>
                          )}
                        </div>

                        <div className="cron-kv-grid">
                          <div className="cron-kv-card">
                            <span>Schedule</span>
                            <strong>{formatScheduleKindLabel(job.schedule.kind)}</strong>
                            <small className="cron-kv-card__meta">{describeSchedule(job.schedule)}</small>
                          </div>
                          <div className="cron-kv-card">
                            <span>Next run</span>
                            <strong title={formatDateTime(job.state.nextRunAtMs)}>{formatRelativeTimestamp(job.state.nextRunAtMs)}</strong>
                            <small className="cron-kv-card__meta">{formatDateTime(job.state.nextRunAtMs)}</small>
                          </div>
                          <div className="cron-kv-card">
                            <span>Last status</span>
                            <strong>{formatRunStatusLabel(lastStatus)}</strong>
                            <small className="cron-kv-card__meta">
                              {job.state.lastRunAtMs ? `Last run ${formatRelativeTimestamp(job.state.lastRunAtMs)}` : "No runs recorded yet"}
                            </small>
                          </div>
                          <div className="cron-kv-card">
                            <span>Updated</span>
                            <strong>{formatRelativeTimestamp(job.updatedAtMs)}</strong>
                            <small className="cron-kv-card__meta">{formatDateTime(job.updatedAtMs)}</small>
                          </div>
                        </div>

                        {job.state.lastError && (
                          <div className="cron-job-row__error">{job.state.lastError}</div>
                        )}
                      </button>

                      <div className="cron-job-row__actions">
                        <Button variant="secondary" size="sm" onClick={() => startEditing(job)}>
                          Edit
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => startCloning(job)}>
                          <CopyPlus size={12} />
                          Clone
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => actionMutation.mutate({ type: "toggle", job, enabled: !job.enabled })}
                          loading={isActionPending && activeJobAction?.type === "toggle"}
                        >
                          {job.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => actionMutation.mutate({ type: "run", job, mode: "force" })}
                          loading={isActionPending && activeJobAction?.type === "run" && activeJobAction.mode === "force"}
                        >
                          <Play size={12} />
                          Run Now
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            if (window.confirm(`Delete cron job \"${job.name}\"?`)) {
                              actionMutation.mutate({ type: "delete", job });
                            }
                          }}
                          loading={isActionPending && activeJobAction?.type === "delete"}
                        >
                          <Trash2 size={12} />
                          Delete
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
                  Load More Jobs
                </Button>
              </div>
            )}
          </Card>

          {selectedJob && (
            <Card className="cron-card cron-detail-spotlight">
              <div className="cron-card__header">
                <div>
                  <h3>{selectedJob.name}</h3>
                  <p>{selectedJob.description?.trim() || describePayload(selectedJob.payload)}</p>
                </div>
                <div className="cron-card__header-actions">
                  <Button variant="secondary" size="sm" onClick={() => startEditing(selectedJob)}>
                    Edit
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => startCloning(selectedJob)}>
                    Clone
                  </Button>
                  <Button size="sm" onClick={() => actionMutation.mutate({ type: "run", job: selectedJob, mode: "due" })}>
                    <Play size={12} />
                    Run Due
                  </Button>
                </div>
              </div>

              <div className="cron-pill-row cron-pill-row--header">
                <span className={cx("cron-pill", selectedJob.enabled ? "cron-pill--ok" : "cron-pill--soft")}>
                  {selectedJob.enabled ? "Enabled" : "Disabled"}
                </span>
                <span className="cron-pill cron-pill--soft">{formatScheduleKindLabel(selectedJob.schedule.kind)}</span>
                <span className="cron-pill cron-pill--soft">{formatPayloadKindLabel(selectedJob.payload.kind)}</span>
                <span className="cron-pill cron-pill--soft">{formatSessionTargetLabel(selectedJob.sessionTarget)}</span>
                <span className="cron-pill cron-pill--soft">{formatWakeModeLabel(selectedJob.wakeMode)}</span>
              </div>

              {(selectedJob.state.consecutiveErrors ?? 0) > 0 && (
                <div className="cron-inline-alert cron-inline-alert--error compact">
                  <AlertTriangle size={16} />
                  <span>
                    {selectedJob.state.consecutiveErrors} consecutive failures. Last alert {formatDateTime(selectedJob.state.lastFailureAlertAtMs)}.
                  </span>
                </div>
              )}

              <div className="cron-spotlight-grid">
                <div className="cron-panel-card">
                  <h4>Execution</h4>
                  <div className="cron-kv-list">
                    <div className="cron-kv-row"><span>Schedule</span><strong>{describeSchedule(selectedJob.schedule)}</strong></div>
                    <div className="cron-kv-row"><span>Target</span><strong>{selectedJob.sessionTarget}</strong></div>
                    <div className="cron-kv-row"><span>Wake mode</span><strong>{selectedJob.wakeMode}</strong></div>
                    <div className="cron-kv-row"><span>Session key</span><strong>{selectedJob.sessionKey || "n/a"}</strong></div>
                    <div className="cron-kv-row"><span>Agent</span><strong>{selectedJob.agentId || "inherit"}</strong></div>
                  </div>
                </div>
                <div className="cron-panel-card">
                  <h4>Health</h4>
                  <div className="cron-kv-list">
                    <div className="cron-kv-row"><span>Next run</span><strong>{formatDateTimeWithRelative(selectedJob.state.nextRunAtMs)}</strong></div>
                    <div className="cron-kv-row"><span>Last run</span><strong>{formatDateTimeWithRelative(selectedJob.state.lastRunAtMs)}</strong></div>
                    <div className="cron-kv-row"><span>Last status</span><strong>{formatRunStatusLabel(getJobLastStatus(selectedJob))}</strong></div>
                    <div className="cron-kv-row"><span>Last duration</span><strong>{formatDuration(selectedJob.state.lastDurationMs)}</strong></div>
                    <div className="cron-kv-row"><span>Consecutive errors</span><strong>{formatCount(selectedJob.state.consecutiveErrors ?? 0)}</strong></div>
                  </div>
                </div>
                <div className="cron-panel-card">
                  <h4>Delivery</h4>
                  <div className="cron-kv-list">
                    <div className="cron-kv-row"><span>Primary delivery</span><strong>{describeDelivery(selectedJob)}</strong></div>
                    <div className="cron-kv-row"><span>Last delivery</span><strong>{formatDeliveryStatusLabel(selectedJob.state.lastDeliveryStatus)}</strong></div>
                    <div className="cron-kv-row"><span>Failure alerts</span><strong>{describeFailureAlert(selectedJob)}</strong></div>
                    <div className="cron-kv-row"><span>Updated</span><strong>{formatDateTime(selectedJob.updatedAtMs)}</strong></div>
                  </div>
                </div>
              </div>

              {(selectedJob.state.lastError || selectedJob.state.lastDeliveryError) && (
                <div className="cron-error-columns">
                  {selectedJob.state.lastError && (
                    <div className="cron-panel-card">
                      <h4>Last execution error</h4>
                      <div className="cron-error-box">{selectedJob.state.lastError}</div>
                    </div>
                  )}
                  {selectedJob.state.lastDeliveryError && (
                    <div className="cron-panel-card">
                      <h4>Last delivery error</h4>
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
                <h3>Runs</h3>
                <p>Scan recent executions first, then inspect the selected run in a calmer detail pane.</p>
              </div>
              <div className="cron-card__header-actions">
                <span className="cron-pill cron-pill--soft">
                  {runsScope === "all" ? "All jobs" : selectedJob ? selectedJob.name : "Selected job"}
                </span>
                {runsActiveFilters && <span className="cron-pill cron-pill--warn">{runsActiveFilterCount} active</span>}
                {runsActiveFilters && (
                  <Button variant="secondary" size="sm" onClick={resetRunFilters}>
                    Reset Filters
                  </Button>
                )}
              </div>
            </div>

            <div className="cron-filters-grid cron-filters-grid--runs cron-filter-surface">
              <label className="cron-field">
                <span>Scope</span>
                <select value={runsScope} onChange={(event) => setRunsScope(event.target.value as CronRunScope)}>
                  <option value="job">Selected job</option>
                  <option value="all">All jobs</option>
                </select>
              </label>
              <label className="cron-field cron-field--search">
                <span>Search runs</span>
                <div className="cron-search-field">
                  <Search size={14} />
                  <input
                    value={runsQueryText}
                    onChange={(event) => setRunsQueryText(event.target.value)}
                    placeholder="Search summary, error, job name, model"
                  />
                </div>
              </label>
              <label className="cron-field">
                <span>Sort</span>
                <select value={runsSortDir} onChange={(event) => setRunsSortDir(event.target.value as CronSortDir)}>
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </label>
              <div className="cron-filter-group">
                <span>Status</span>
                <div className="cron-chip-toggle-row">
                  {(["ok", "error", "skipped"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={cx("cron-chip-toggle", runsStatuses.includes(status) && "is-active")}
                      onClick={() => setRunsStatuses((current) => toggleSelection(current, status))}
                    >
                      {formatRunStatusLabel(status)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="cron-filter-group">
                <span>Delivery</span>
                <div className="cron-chip-toggle-row">
                  {(["delivered", "not-delivered", "unknown", "not-requested"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={cx("cron-chip-toggle", runsDeliveryStatuses.includes(status) && "is-active")}
                      onClick={() => setRunsDeliveryStatuses((current) => toggleSelection(current, status))}
                    >
                      {formatDeliveryStatusLabel(status)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {runsActiveFilters && (
              <div className="cron-active-filters">
                <span className="cron-active-filters__label">Active filters</span>
                {runsScope !== "job" && <span className="cron-pill cron-pill--soft">Scope: all jobs</span>}
                {runsQueryText.trim() && <span className="cron-pill cron-pill--soft">Search: {runsQueryText.trim()}</span>}
                {runsSortDir !== "desc" && <span className="cron-pill cron-pill--soft">Sort: oldest first</span>}
                {runsStatuses.length > 0 && <span className="cron-pill cron-pill--soft">Status: {runsStatuses.map((status) => formatRunStatusLabel(status)).join(", ")}</span>}
                {runsDeliveryStatuses.length > 0 && <span className="cron-pill cron-pill--soft">Delivery: {runsDeliveryStatuses.map((status) => formatDeliveryStatusLabel(status)).join(", ")}</span>}
              </div>
            )}

            {runsScope === "job" && !selectedJob ? (
              <EmptyState
                icon={<Clock3 size={18} />}
                title="Select a job"
                body="Choose a job row above to load its run history and detail pane."
              />
            ) : runsQuery.isLoading ? (
              <EmptyState
                icon={<RefreshCw size={18} />}
                title="Loading runs"
                body="Fetching the latest execution history from the gateway."
                tone="loading"
              />
            ) : runs.length === 0 ? (
              <EmptyState
                icon={<Search size={18} />}
                title="No runs found"
                body="Try a broader search or clear one of the run filters above."
              />
            ) : (
              <div className="cron-runs-layout">
                <div className="cron-runs-list-shell">
                  <div className="cron-subpanel-header">
                    <div>
                      <h4>Recent runs</h4>
                      <p>{runs.length.toLocaleString()} loaded in the current view.</p>
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
                            <div className="cron-run-row__subcopy">{formatDateTime(entry.ts)} · {formatRelativeTimestamp(entry.ts)}</div>
                          </div>
                          <span className={cx("cron-pill", `cron-pill--${runTone(status)}`)}>{formatRunStatusLabel(status)}</span>
                        </div>
                        <div className="cron-pill-row">
                          <span className="cron-pill cron-pill--soft">{formatDeliveryStatusLabel(entry.deliveryStatus)}</span>
                          {entry.provider && <span className="cron-pill cron-pill--soft">{entry.provider}</span>}
                          {entry.model && <span className="cron-pill cron-pill--soft">{entry.model}</span>}
                          {entry.durationMs != null && <span className="cron-pill cron-pill--soft">{formatDuration(entry.durationMs)}</span>}
                        </div>
                        <div className="cron-run-row__summary">{entry.error || entry.summary || "No summary recorded."}</div>
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
                          <p>{formatDateTime(selectedRun.ts)} · {formatRelativeTimestamp(selectedRun.ts)}</p>
                        </div>
                        <div className="cron-card__header-actions">
                          <span className={cx("cron-pill", `cron-pill--${runTone(getRunStatus(selectedRun))}`)}>
                            {formatRunStatusLabel(getRunStatus(selectedRun))}
                          </span>
                          <span className="cron-pill cron-pill--soft">{formatDeliveryStatusLabel(selectedRun.deliveryStatus)}</span>
                        </div>
                      </div>

                      {selectedRun.error && (
                        <div className="cron-inline-alert cron-inline-alert--error compact">
                          <AlertTriangle size={16} />
                          <span>{selectedRun.error}</span>
                        </div>
                      )}

                      <div className="cron-kv-grid">
                        <div className="cron-kv-card"><span>Duration</span><strong>{formatDuration(selectedRun.durationMs)}</strong></div>
                        <div className="cron-kv-card"><span>Total tokens</span><strong>{formatCount(selectedRun.usage?.total_tokens)}</strong></div>
                        <div className="cron-kv-card"><span>Run at</span><strong>{formatDateTimeWithRelative(selectedRun.runAtMs)}</strong></div>
                        <div className="cron-kv-card"><span>Next run</span><strong>{formatDateTimeWithRelative(selectedRun.nextRunAtMs)}</strong></div>
                      </div>

                      <div className="cron-panel-card">
                        <h4>Run details</h4>
                        <div className="cron-kv-list">
                          <div className="cron-kv-row"><span>Delivery</span><strong>{formatDeliveryStatusLabel(selectedRun.deliveryStatus)}</strong></div>
                          <div className="cron-kv-row"><span>Provider</span><strong>{selectedRun.provider || "n/a"}</strong></div>
                          <div className="cron-kv-row"><span>Model</span><strong>{selectedRun.model || "n/a"}</strong></div>
                          <div className="cron-kv-row"><span>Session ID</span><strong>{selectedRun.sessionId || "n/a"}</strong></div>
                          <div className="cron-kv-row"><span>Session key</span><strong>{selectedRun.sessionKey || "n/a"}</strong></div>
                        </div>
                      </div>

                      <div className="cron-panel-card">
                        <h4>Summary</h4>
                        <div className="cron-run-detail__text">
                          {selectedRun.summary || selectedRun.error || "No run summary recorded."}
                        </div>
                        {selectedRun.deliveryError && (
                          <div className="cron-error-box">{selectedRun.deliveryError}</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <EmptyState
                      icon={<Clock3 size={18} />}
                      title="Choose a run"
                      body="Select an execution row to inspect delivery metadata, usage, and summary output."
                    />
                  )}
                </div>
              </div>
            )}

            {runsQuery.data?.hasMore && (
              <div className="cron-load-more">
                <Button variant="secondary" onClick={() => setRunsLimit((current) => current + DEFAULT_PAGE_SIZE)}>
                  Load More Runs
                </Button>
              </div>
            )}
          </Card>
        </div>

        <div className="cron-workspace__sidebar">
          <Card className="cron-card cron-form-card">
            <div className="cron-card__header">
              <div>
                <h3>{editingJobId ? "Edit job" : "New job"}</h3>
                <p>{editingJobId ? "Adjust timing, payload, or delivery without losing context." : "Create a job with clear sections, tighter labels, and calmer spacing."}</p>
              </div>
              {editingJobId && selectedJob && (
                <StatusBadge
                  status={selectedJob.enabled ? "connected" : "disconnected"}
                  label={selectedJob.enabled ? "Enabled" : "Disabled"}
                />
              )}
            </div>

            {blockingFields.length > 0 && (
              <div className="cron-inline-alert compact">
                <AlertTriangle size={16} />
                <span>
                  Fix {blockingFields.length} field{blockingFields.length === 1 ? "" : "s"} before saving.
                </span>
              </div>
            )}

            <div className="cron-form-sections">
              <div className="cron-form-required">
                <span className="cron-form-required__dot">*</span>
                Required values follow the upstream cron validation flow.
              </div>

              <section className="cron-form-section">
                <div className="cron-form-section__header">
                  <h4>Basics</h4>
                  <p>Name the job and define its ownership and lifecycle.</p>
                </div>
                <div className="cron-form-grid">
                  <label className="cron-field cron-span-2">
                    <span>Name</span>
                    <input
                      className={cx(fieldErrors.name && "is-invalid")}
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Morning digest"
                    />
                    {renderFieldHint("Used in the jobs list, run history, and alerts.")}
                    {renderFieldError(fieldErrors.name)}
                  </label>
                  <label className="cron-field cron-span-2">
                    <span>Description</span>
                    <input
                      value={form.description}
                      onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                      placeholder="Explain what this job does"
                    />
                    {renderFieldHint("Optional short description for operators scanning the page.")}
                  </label>
                  <label className="cron-field">
                    <span>Agent ID</span>
                    <input
                      value={form.agentId}
                      list="cron-agent-suggestions"
                      onChange={(event) => setForm((current) => ({ ...current, agentId: event.target.value }))}
                      placeholder="Optional override"
                    />
                    {renderFieldHint("Leave blank to inherit the default agent routing.")}
                  </label>
                  <label className="cron-field">
                    <span>Session key</span>
                    <input
                      value={form.sessionKey}
                      onChange={(event) => setForm((current) => ({ ...current, sessionKey: event.target.value }))}
                      placeholder="Optional session pinning"
                    />
                    {renderFieldHint("Pins delivery and wake behavior to a specific session route.")}
                  </label>
                  <label className="cron-checkbox">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
                    />
                    <CheckboxCopy label="Enabled" hint="Include this job in scheduler scans and due checks." />
                  </label>
                  <label className="cron-checkbox">
                    <input
                      type="checkbox"
                      checked={form.deleteAfterRun}
                      onChange={(event) => setForm((current) => ({ ...current, deleteAfterRun: event.target.checked }))}
                    />
                    <CheckboxCopy label="Delete after run" hint="Remove the job automatically after its next successful execution." />
                  </label>
                </div>
              </section>

              <section className="cron-form-section">
                <div className="cron-form-section__header">
                  <h4>Schedule</h4>
                  <p>Choose interval, one-shot, or cron-expression timing.</p>
                </div>
                <div className="cron-form-grid">
                  <label className="cron-field cron-span-2">
                    <span>Schedule type</span>
                    <select
                      value={form.scheduleKind}
                      onChange={(event) => setForm((current) => ({ ...current, scheduleKind: event.target.value as CronFormState["scheduleKind"] }))}
                    >
                      <option value="every">Every</option>
                      <option value="at">One-shot at</option>
                      <option value="cron">Cron expression</option>
                    </select>
                    {renderFieldHint("Choose an interval, a one-shot run, or a cron expression schedule.")}
                  </label>

                  {form.scheduleKind === "every" && (
                    <>
                      <label className="cron-field">
                        <span>Repeat every</span>
                        <input
                          className={cx(fieldErrors.everyAmount && "is-invalid")}
                          value={form.everyAmount}
                          onChange={(event) => setForm((current) => ({ ...current, everyAmount: event.target.value }))}
                          placeholder="15"
                        />
                        {renderFieldHint("Use a positive integer cadence.")}
                        {renderFieldError(fieldErrors.everyAmount)}
                      </label>
                      <label className="cron-field">
                        <span>Unit</span>
                        <select
                          value={form.everyUnit}
                          onChange={(event) => setForm((current) => ({ ...current, everyUnit: event.target.value as CronFormState["everyUnit"] }))}
                        >
                          <option value="minutes">Minutes</option>
                          <option value="hours">Hours</option>
                          <option value="days">Days</option>
                        </select>
                        {renderFieldHint("Matches the interval unit used by the gateway scheduler.")}
                      </label>
                    </>
                  )}

                  {form.scheduleKind === "at" && (
                    <label className="cron-field cron-span-2">
                      <span>Run at</span>
                      <input
                        type="datetime-local"
                        className={cx(fieldErrors.scheduleAt && "is-invalid")}
                        value={form.scheduleAt}
                        onChange={(event) => setForm((current) => ({ ...current, scheduleAt: event.target.value }))}
                      />
                      {renderFieldHint("Use a local date and time for this one-shot job.")}
                      {renderFieldError(fieldErrors.scheduleAt)}
                    </label>
                  )}

                  {form.scheduleKind === "cron" && (
                    <>
                      <label className="cron-field cron-span-2">
                        <span>Cron expression</span>
                        <input
                        className={cx(fieldErrors.cronExpr && "is-invalid")}
                        value={form.cronExpr}
                        onChange={(event) => setForm((current) => ({ ...current, cronExpr: event.target.value }))}
                        placeholder="0 * * * *"
                      />
                      {renderFieldHint("Five-field cron syntax, with optional timezone below.")}
                      {renderFieldError(fieldErrors.cronExpr)}
                    </label>
                      <label className="cron-field">
                        <span>Timezone</span>
                        <input
                          value={form.cronTz}
                          list="cron-timezone-suggestions"
                          onChange={(event) => setForm((current) => ({ ...current, cronTz: event.target.value }))}
                          placeholder="UTC or America/Los_Angeles"
                        />
                        {renderFieldHint("Leave blank to use the scheduler default timezone.")}
                      </label>
                      <label className="cron-checkbox">
                        <input
                          type="checkbox"
                          checked={form.scheduleExact}
                          onChange={(event) => setForm((current) => ({ ...current, scheduleExact: event.target.checked }))}
                        />
                        <CheckboxCopy label="Exact schedule" hint="Disable stagger randomization and run exactly on the cron boundary." />
                      </label>
                      <label className="cron-field">
                        <span>Stagger</span>
                        <input
                          disabled={form.scheduleExact}
                          className={cx(fieldErrors.staggerAmount && "is-invalid")}
                          value={form.staggerAmount}
                          onChange={(event) => setForm((current) => ({ ...current, staggerAmount: event.target.value }))}
                          placeholder="Optional"
                        />
                        {renderFieldHint("Optional spread window for distributing clustered jobs.")}
                        {renderFieldError(fieldErrors.staggerAmount)}
                      </label>
                      <label className="cron-field">
                        <span>Stagger unit</span>
                        <select
                          disabled={form.scheduleExact}
                          value={form.staggerUnit}
                          onChange={(event) => setForm((current) => ({ ...current, staggerUnit: event.target.value as CronFormState["staggerUnit"] }))}
                        >
                          <option value="seconds">Seconds</option>
                          <option value="minutes">Minutes</option>
                        </select>
                        {renderFieldHint("Use shorter windows for tight schedules and larger windows for burst control.")}
                      </label>
                    </>
                  )}
                </div>
              </section>

              <section className="cron-form-section">
                <div className="cron-form-section__header">
                  <h4>Execution</h4>
                  <p>Choose where the job runs and what it sends.</p>
                </div>
                <div className="cron-form-grid">
                  <label className="cron-field">
                    <span>Session target</span>
                    <select
                      value={form.sessionTarget}
                      onChange={(event) => setForm((current) => ({ ...current, sessionTarget: event.target.value as CronFormState["sessionTarget"] }))}
                    >
                      <option value="main">Main</option>
                      <option value="isolated">Isolated</option>
                    </select>
                    {renderFieldHint("Isolated jobs unlock announce delivery and dedicated run context.")}
                  </label>
                  <label className="cron-field">
                    <span>Wake mode</span>
                    <select
                      value={form.wakeMode}
                      onChange={(event) => setForm((current) => ({ ...current, wakeMode: event.target.value as CronFormState["wakeMode"] }))}
                    >
                      <option value="next-heartbeat">Next heartbeat</option>
                      <option value="now">Now</option>
                    </select>
                    {renderFieldHint("Choose whether the gateway wakes immediately or on the next heartbeat.")}
                  </label>
                  <label className="cron-field">
                    <span>Payload type</span>
                    <select
                      value={form.payloadKind}
                      onChange={(event) => setForm((current) => ({ ...current, payloadKind: event.target.value as CronFormState["payloadKind"] }))}
                    >
                      <option value="agentTurn">Agent turn</option>
                      <option value="systemEvent">System event</option>
                    </select>
                    {renderFieldHint("Agent turns support model, thinking, and delivery controls.")}
                  </label>
                  {form.payloadKind === "agentTurn" && (
                    <label className="cron-field">
                      <span>Timeout seconds</span>
                      <input
                        className={cx(fieldErrors.timeoutSeconds && "is-invalid")}
                        value={form.timeoutSeconds}
                        onChange={(event) => setForm((current) => ({ ...current, timeoutSeconds: event.target.value }))}
                        placeholder="Optional"
                      />
                      {renderFieldHint("Optional hard stop for long-running agent turns.")}
                      {renderFieldError(fieldErrors.timeoutSeconds)}
                    </label>
                  )}
                  <label className="cron-field cron-span-2">
                    <span>{form.payloadKind === "agentTurn" ? "Prompt" : "Event text"}</span>
                    <textarea
                      className={cx("cron-textarea", fieldErrors.payloadText && "is-invalid")}
                      value={form.payloadText}
                      onChange={(event) => setForm((current) => ({ ...current, payloadText: event.target.value }))}
                      placeholder={
                        form.payloadKind === "agentTurn"
                          ? "Summarize overnight activity and draft an update"
                          : "wake agent pipeline"
                      }
                    />
                    {renderFieldHint(form.payloadKind === "agentTurn" ? "Sent as the turn message for this scheduled run." : "Sent as the raw system event payload.")}
                    {renderFieldError(fieldErrors.payloadText)}
                  </label>
                  {form.payloadKind === "agentTurn" && (
                    <>
                      <label className="cron-field">
                        <span>Model</span>
                        <input
                          value={form.payloadModel}
                          list="cron-model-suggestions"
                          onChange={(event) => setForm((current) => ({ ...current, payloadModel: event.target.value }))}
                          placeholder="Optional model override"
                        />
                        {renderFieldHint("Overrides the default model only for this job.")}
                      </label>
                      <label className="cron-field">
                        <span>Thinking</span>
                        <input
                          value={form.payloadThinking}
                          onChange={(event) => setForm((current) => ({ ...current, payloadThinking: event.target.value }))}
                          placeholder="Optional reasoning budget"
                        />
                        {renderFieldHint("Optional reasoning or thinking budget hint.")}
                      </label>
                      <label className="cron-checkbox cron-span-2">
                        <input
                          type="checkbox"
                          checked={form.payloadLightContext}
                          onChange={(event) => setForm((current) => ({ ...current, payloadLightContext: event.target.checked }))}
                        />
                        <CheckboxCopy label="Use light context" hint="Reduce bootstrap context for cheaper, faster routine turns." />
                      </label>
                    </>
                  )}
                </div>
              </section>

              <section className="cron-form-section">
                <div className="cron-form-section__header">
                  <h4>Delivery</h4>
                  <p>Send successful output to chat destinations or a webhook.</p>
                </div>
                <div className="cron-form-grid">
                  <label className="cron-field">
                    <span>Delivery mode</span>
                    <select
                      className={cx(fieldErrors.deliveryMode && "is-invalid")}
                      value={form.deliveryMode}
                      onChange={(event) => setForm((current) => ({ ...current, deliveryMode: event.target.value as CronFormState["deliveryMode"] }))}
                    >
                      <option value="none">None</option>
                      <option value="announce">Announce</option>
                      <option value="webhook">Webhook</option>
                    </select>
                    {renderFieldHint("Announce matches upstream behavior; webhook posts run output to an external endpoint.")}
                    {renderFieldError(fieldErrors.deliveryMode)}
                  </label>

                  {form.deliveryMode === "announce" && (
                    <>
                      <label className="cron-field">
                        <span>Channel</span>
                        <select
                          value={form.deliveryChannel}
                          onChange={(event) => setForm((current) => ({ ...current, deliveryChannel: event.target.value }))}
                        >
                          {channels.map((channelId) => (
                            <option key={channelId} value={channelId}>
                              {channelLabelById[channelId] ?? channelId}
                            </option>
                          ))}
                        </select>
                        {renderFieldHint("Use `last` unless this job needs fixed channel routing.")}
                      </label>
                      <label className="cron-field">
                        <span>Recipient / thread</span>
                        <input
                          value={form.deliveryTo}
                          list="cron-delivery-to-suggestions"
                          onChange={(event) => setForm((current) => ({ ...current, deliveryTo: event.target.value }))}
                          placeholder="Optional override"
                        />
                        {renderFieldHint("Optional direct recipient, thread, or channel target override.")}
                      </label>
                      <label className="cron-field">
                        <span>Account ID</span>
                        <input
                          value={form.deliveryAccountId}
                          list="cron-account-suggestions"
                          onChange={(event) => setForm((current) => ({ ...current, deliveryAccountId: event.target.value }))}
                          placeholder="Optional multi-account routing"
                        />
                        {renderFieldHint("Needed only when the chosen channel has multiple accounts configured.")}
                      </label>
                    </>
                  )}

                  {form.deliveryMode === "webhook" && (
                    <label className="cron-field cron-span-2">
                      <span>Webhook URL</span>
                      <input
                        className={cx(fieldErrors.deliveryTo && "is-invalid")}
                        value={form.deliveryTo}
                        onChange={(event) => setForm((current) => ({ ...current, deliveryTo: event.target.value }))}
                        placeholder="https://example.com/hook"
                      />
                      {renderFieldHint("The gateway posts successful run output to this URL.")}
                      {renderFieldError(fieldErrors.deliveryTo)}
                    </label>
                  )}

                  {form.deliveryMode !== "none" && (
                    <label className="cron-checkbox cron-span-2">
                      <input
                        type="checkbox"
                        checked={form.deliveryBestEffort}
                        onChange={(event) => setForm((current) => ({ ...current, deliveryBestEffort: event.target.checked }))}
                      />
                      <CheckboxCopy label="Best effort delivery" hint="Do not fail the job when the delivery step cannot complete." />
                    </label>
                  )}
                </div>

                {!supportsAnnounce && form.deliveryMode === "announce" && (
                  <div className="cron-inline-alert compact">
                    <AlertTriangle size={16} />
                    <span>Announce delivery only applies to isolated agent-turn jobs.</span>
                  </div>
                )}
              </section>

              <section className="cron-form-section">
                <div className="cron-form-section__header">
                  <h4>Failure alerts</h4>
                  <p>Send repeated-failure alerts when a job needs attention.</p>
                </div>
                <div className="cron-form-grid">
                  <label className="cron-field cron-span-2">
                    <span>Failure alert mode</span>
                    <select
                      value={form.failureAlertMode}
                      onChange={(event) => setForm((current) => ({ ...current, failureAlertMode: event.target.value as CronFormState["failureAlertMode"] }))}
                    >
                      <option value="inherit">Inherit gateway defaults</option>
                      <option value="disabled">Disabled</option>
                      <option value="custom">Custom</option>
                    </select>
                    {renderFieldHint("Custom alerts override the gateway default repeated-failure behavior.")}
                  </label>

                  {form.failureAlertMode === "custom" && (
                    <>
                      <label className="cron-field">
                        <span>Alert after</span>
                        <input
                          className={cx(fieldErrors.failureAlertAfter && "is-invalid")}
                          value={form.failureAlertAfter}
                          onChange={(event) => setForm((current) => ({ ...current, failureAlertAfter: event.target.value }))}
                          placeholder="3"
                        />
                        {renderFieldHint("How many consecutive failures occur before the first alert.")}
                        {renderFieldError(fieldErrors.failureAlertAfter)}
                      </label>
                      <label className="cron-field">
                        <span>Cooldown seconds</span>
                        <input
                          className={cx(fieldErrors.failureAlertCooldownSeconds && "is-invalid")}
                          value={form.failureAlertCooldownSeconds}
                          onChange={(event) => setForm((current) => ({ ...current, failureAlertCooldownSeconds: event.target.value }))}
                          placeholder="600"
                        />
                        {renderFieldHint("Minimum quiet period between repeated alerts.")}
                        {renderFieldError(fieldErrors.failureAlertCooldownSeconds)}
                      </label>
                      <label className="cron-field">
                        <span>Alert mode</span>
                        <select
                          value={form.failureAlertDeliveryMode}
                          onChange={(event) => setForm((current) => ({ ...current, failureAlertDeliveryMode: event.target.value as CronFormState["failureAlertDeliveryMode"] }))}
                        >
                          <option value="announce">Announce</option>
                          <option value="webhook">Webhook</option>
                        </select>
                        {renderFieldHint("Choose how repeated-failure notifications are delivered.")}
                      </label>
                      <label className="cron-field">
                        <span>Alert channel</span>
                        <select
                          value={form.failureAlertChannel}
                          onChange={(event) => setForm((current) => ({ ...current, failureAlertChannel: event.target.value }))}
                        >
                          {channels.map((channelId) => (
                            <option key={channelId} value={channelId}>
                              {channelLabelById[channelId] ?? channelId}
                            </option>
                          ))}
                        </select>
                        {renderFieldHint("Only used for announce-based failure alerts.")}
                      </label>
                      <label className="cron-field">
                        <span>Alert to</span>
                        <input
                          value={form.failureAlertTo}
                          list="cron-delivery-to-suggestions"
                          onChange={(event) => setForm((current) => ({ ...current, failureAlertTo: event.target.value }))}
                          placeholder="Optional recipient override"
                        />
                        {renderFieldHint("Optional recipient or thread override for the alert payload.")}
                      </label>
                      <label className="cron-field">
                        <span>Alert account ID</span>
                        <input
                          value={form.failureAlertAccountId}
                          list="cron-account-suggestions"
                          onChange={(event) => setForm((current) => ({ ...current, failureAlertAccountId: event.target.value }))}
                          placeholder="Optional multi-account routing"
                        />
                        {renderFieldHint("Optional multi-account channel routing for announce alerts.")}
                      </label>
                    </>
                  )}
                </div>
              </section>
            </div>

            <div className="cron-form-actions">
              <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={!canSubmit}>
                <Send size={14} />
                {editingJobId ? "Save Job" : "Create Job"}
              </Button>
              <Button variant="secondary" onClick={resetForm}>
                Reset
              </Button>
            </div>
          </Card>

          <Card className="cron-card">
            <div className="cron-card__header">
              <div>
                <h3>Wake gateway</h3>
                <p>Trigger the gateway wake path directly for manual nudges and parity checks.</p>
              </div>
            </div>

            {wakeMessage && (
              <div className={cx("cron-inline-alert", wakeMessage.toLowerCase().includes("sent") && "cron-inline-alert--info", "compact")}>
                <Send size={16} />
                <span>{wakeMessage}</span>
              </div>
            )}

            <div className="cron-form-grid">
              <label className="cron-field">
                <span>Wake mode</span>
                <select value={wakeMode} onChange={(event) => setWakeMode(event.target.value as "now" | "next-heartbeat")}>
                  <option value="next-heartbeat">Next heartbeat</option>
                  <option value="now">Now</option>
                </select>
                {renderFieldHint("Use the same wake semantics as the scheduler for parity testing.")}
              </label>
              <label className="cron-field cron-span-2">
                <span>Wake text</span>
                <textarea
                  className="cron-textarea"
                  value={wakeText}
                  onChange={(event) => setWakeText(event.target.value)}
                  placeholder="Ask the main session to summarize pending work"
                />
                {renderFieldHint("Optional payload sent with the wake request.")}
              </label>
            </div>

            <div className="cron-form-actions">
              <Button
                onClick={() => actionMutation.mutate({ type: "wake", wakeMode, wakeText })}
                loading={actionMutation.isPending && actionMutation.variables?.type === "wake"}
              >
                <Send size={14} />
                Send Wake
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
      <datalist id="cron-timezone-suggestions">
        {timezoneSuggestions.map((timezone) => (
          <option key={timezone} value={timezone} />
        ))}
      </datalist>
      <datalist id="cron-delivery-to-suggestions">
        {deliveryToSuggestions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <datalist id="cron-account-suggestions">
        {accountSuggestions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
    </div>
  );
}
