import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Play, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { Button, Card, StatusBadge } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";
import { gateway } from "@/lib/gateway";
import { formatRelativeTime } from "@/lib/utils";

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
      thinking?: string;
      timeoutSeconds?: number;
      lightContext?: boolean;
    };

type CronDelivery = {
  mode: "none" | "announce" | "webhook";
  channel?: string;
  to?: string;
  accountId?: string;
  bestEffort?: boolean;
};

type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: "ok" | "error" | "skipped";
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
  lastDeliveryStatus?: "delivered" | "not-delivered" | "unknown" | "not-requested";
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
  createdAtMs: number;
  updatedAtMs: number;
  state: CronJobState;
};

type CronJobsResult = {
  jobs: CronJob[];
  total: number;
};

type CronRunEntry = {
  ts: number;
  jobId: string;
  jobName?: string;
  status?: "ok" | "error" | "skipped";
  error?: string;
  summary?: string;
  deliveryStatus?: "delivered" | "not-delivered" | "unknown" | "not-requested";
  durationMs?: number;
  sessionKey?: string;
  model?: string;
  provider?: string;
  usage?: {
    total_tokens?: number;
  };
};

type CronRunsResult = {
  entries: CronRunEntry[];
  total: number;
};

type RunStatusFilter = "all" | "ok" | "error" | "skipped" | "unknown";

type ChannelOption = {
  id: string;
  label: string;
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
  deleteAfterRun: boolean;
};

const CRON_QUERY_KEY = "cron-dashboard";

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
    deliveryChannel: "last",
    deliveryTo: "",
    deliveryAccountId: "",
    deliveryBestEffort: false,
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
      if (!id || !name || !schedule || !payload || !state) {
        return [];
      }
      const sessionTarget = readString(item, "sessionTarget");
      const wakeMode = readString(item, "wakeMode");
      if ((sessionTarget !== "main" && sessionTarget !== "isolated") || (wakeMode !== "next-heartbeat" && wakeMode !== "now")) {
        return [];
      }

      return [{
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
        delivery: asRecord(item.delivery) as CronDelivery | undefined,
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
          lastDeliveryStatus: readString(state, "lastDeliveryStatus") as CronJobState["lastDeliveryStatus"],
        },
      }];
    })
    : [];

  return {
    jobs,
    total: readNumber(record, "total") ?? jobs.length,
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
      const usage = asRecord(item.usage);
      return [{
        ts,
        jobId,
        jobName: readString(item, "jobName"),
        status: readString(item, "status") as CronRunEntry["status"],
        error: readString(item, "error"),
        summary: readString(item, "summary"),
        deliveryStatus: readString(item, "deliveryStatus") as CronRunEntry["deliveryStatus"],
        durationMs: readNumber(item, "durationMs"),
        sessionKey: readString(item, "sessionKey"),
        model: readString(item, "model"),
        provider: readString(item, "provider"),
        usage: usage ? { total_tokens: readNumber(usage, "total_tokens") } : undefined,
      }];
    })
    : [];

  return {
    entries,
    total: readNumber(record, "total") ?? entries.length,
  };
}

function normalizeModelIds(value: unknown): string[] {
  const record = asRecord(value);
  if (!Array.isArray(record?.models)) {
    return [];
  }
  return Array.from(new Set(record.models.flatMap((entry) => {
    const item = asRecord(entry);
    const id = readString(item, "id");
    return id ? [id] : [];
  }))).sort((left, right) => left.localeCompare(right));
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

  return [{ id: "last", label: "last used channel" }, ...options];
}

function formatDateTime(timestamp?: number | null) {
  if (timestamp == null) return "n/a";
  return new Date(timestamp).toLocaleString();
}

function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs <= 0) return "n/a";
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = Math.round(durationMs / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function getRunKey(entry: CronRunEntry) {
  return `${entry.jobId}-${entry.ts}`;
}

function getRunStatus(entry: CronRunEntry): Exclude<RunStatusFilter, "all"> {
  if (entry.status === "ok" || entry.status === "error" || entry.status === "skipped") {
    return entry.status;
  }
  return "unknown";
}

function formatRunStatusLabel(status: Exclude<RunStatusFilter, "all">) {
  if (status === "ok") return "Succeeded";
  if (status === "error") return "Failed";
  if (status === "skipped") return "Skipped";
  return "Unknown";
}

function getRunBadgeStatus(entry: CronRunEntry): "idle" | "error" {
  return getRunStatus(entry) === "error" ? "error" : "idle";
}

function describeSchedule(schedule: CronSchedule) {
  if (schedule.kind === "at") {
    return `At ${new Date(schedule.at).toLocaleString()}`;
  }
  if (schedule.kind === "every") {
    const minutes = Math.round(schedule.everyMs / 60_000);
    return `Every ${minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`}`;
  }
  return schedule.tz ? `${schedule.expr} · ${schedule.tz}` : schedule.expr;
}

function describeDelivery(job: CronJob) {
  if (!job.delivery || job.delivery.mode === "none") {
    return "No delivery";
  }
  if (job.delivery.mode === "webhook") {
    return job.delivery.to ? `Webhook → ${job.delivery.to}` : "Webhook";
  }
  const channel = job.delivery.channel?.trim() || "last";
  return job.delivery.to ? `${channel} → ${job.delivery.to}` : `Announce via ${channel}`;
}

function buildSchedule(form: CronFormState): CronSchedule {
  if (form.scheduleKind === "at") {
    const value = form.scheduleAt.trim();
    if (!value) {
      throw new Error("Pick a run time for the one-shot schedule.");
    }
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) {
      throw new Error("Invalid date/time for cron job.");
    }
    return { kind: "at", at: new Date(timestamp).toISOString() };
  }

  if (form.scheduleKind === "every") {
    const amount = Number(form.everyAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Repeat interval must be greater than zero.");
    }
    const multiplier = form.everyUnit === "minutes" ? 60_000 : form.everyUnit === "hours" ? 3_600_000 : 86_400_000;
    return { kind: "every", everyMs: amount * multiplier };
  }

  const expr = form.cronExpr.trim();
  if (!expr) {
    throw new Error("Cron expression is required.");
  }
  const staggerAmount = Number(form.staggerAmount);
  const staggerMs = Number.isFinite(staggerAmount) && staggerAmount > 0
    ? form.staggerUnit === "minutes"
      ? staggerAmount * 60_000
      : staggerAmount * 1_000
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

  return {
    kind: "agentTurn",
    message,
    model: form.payloadModel.trim() || undefined,
    thinking: form.payloadThinking.trim() || undefined,
    timeoutSeconds: Number(form.timeoutSeconds) > 0 ? Number(form.timeoutSeconds) : undefined,
    lightContext: form.payloadLightContext || undefined,
  };
}

function buildDelivery(form: CronFormState): CronDelivery | undefined {
  if (form.deliveryMode === "none") {
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
    channel: form.deliveryChannel.trim() || "last",
    to: form.deliveryTo.trim() || undefined,
    accountId: form.deliveryAccountId.trim() || undefined,
    bestEffort: form.deliveryBestEffort,
  };
}

function formFromJob(job: CronJob): CronFormState {
  const form = defaultCronForm();
  const next: CronFormState = {
    ...form,
    name: job.name,
    description: job.description ?? "",
    enabled: job.enabled,
    agentId: job.agentId?.trim() ?? "",
    sessionKey: job.sessionKey?.trim() ?? "",
    sessionTarget: job.sessionTarget,
    wakeMode: job.wakeMode,
    deleteAfterRun: Boolean(job.deleteAfterRun),
    deliveryMode: job.delivery?.mode ?? "none",
    deliveryChannel: job.delivery?.channel ?? "last",
    deliveryTo: job.delivery?.to ?? "",
    deliveryAccountId: job.delivery?.accountId ?? "",
    deliveryBestEffort: Boolean(job.delivery?.bestEffort),
  };

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
    if (job.schedule.staggerMs) {
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

async function loadCronDashboard(search: string, selectedJobId: string | null) {
  const [statusRaw, jobsRaw, runsRaw, modelsRaw, channelsRaw] = await Promise.all([
    gateway.request<unknown>("cron.status", {}),
    gateway.request<unknown>("cron.list", {
      includeDisabled: true,
      query: search.trim() || undefined,
      sortBy: "nextRunAtMs",
      sortDir: "asc",
      limit: 200,
    }),
    gateway.request<unknown>("cron.runs", {
      scope: selectedJobId ? "job" : "all",
      id: selectedJobId ?? undefined,
      limit: 25,
      sortDir: "desc",
    }),
    gateway.request<unknown>("models.list", {}),
    gateway.request<unknown>("channels.status", { probe: false, timeoutMs: 5000 }),
  ]);

  return {
    status: normalizeCronStatus(statusRaw),
    jobs: normalizeCronJobs(jobsRaw),
    runs: normalizeCronRuns(runsRaw),
    models: normalizeModelIds(modelsRaw),
    channels: normalizeChannelOptions(channelsRaw),
  };
}

export function CronPage() {
  const queryClient = useQueryClient();
  const isConnected = useConnectionStore((state) => state.state === "connected");
  const [jobSearch, setJobSearch] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [form, setForm] = useState<CronFormState>(defaultCronForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [wakeText, setWakeText] = useState("");
  const [wakeMode, setWakeMode] = useState<"now" | "next-heartbeat">("next-heartbeat");
  const [wakeMessage, setWakeMessage] = useState<string | null>(null);
  const [runStatusFilter, setRunStatusFilter] = useState<RunStatusFilter>("all");
  const [selectedRunKey, setSelectedRunKey] = useState<string | null>(null);

  const cronQuery = useQuery({
    queryKey: [CRON_QUERY_KEY, jobSearch, selectedJobId],
    queryFn: () => loadCronDashboard(jobSearch, selectedJobId),
    enabled: isConnected,
  });

  const jobs = cronQuery.data?.jobs.jobs ?? [];
  const runs = cronQuery.data?.runs.entries ?? [];
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );
  const filteredRuns = useMemo(
    () => runs.filter((entry) => runStatusFilter === "all" || getRunStatus(entry) === runStatusFilter),
    [runStatusFilter, runs],
  );
  const selectedRun = useMemo(
    () => filteredRuns.find((entry) => getRunKey(entry) === selectedRunKey) ?? filteredRuns[0] ?? null,
    [filteredRuns, selectedRunKey],
  );
  const selectedRunJob = useMemo(
    () => jobs.find((job) => job.id === selectedRun?.jobId) ?? null,
    [jobs, selectedRun?.jobId],
  );

  useEffect(() => {
    if (jobs.length === 0) {
      setSelectedJobId(null);
      return;
    }
    if (!selectedJobId || !jobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(jobs[0].id);
    }
  }, [jobs, selectedJobId]);

  useEffect(() => {
    if (filteredRuns.length === 0) {
      setSelectedRunKey(null);
      return;
    }
    if (!selectedRunKey || !filteredRuns.some((entry) => getRunKey(entry) === selectedRunKey)) {
      setSelectedRunKey(getRunKey(filteredRuns[0]));
    }
  }, [filteredRuns, selectedRunKey]);

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
        delivery: buildDelivery(form),
      };

      if (!payload.name) {
        throw new Error("Cron job name is required.");
      }

      if (editingJobId) {
        await gateway.request("cron.update", { id: editingJobId, patch: payload });
      } else {
        await gateway.request("cron.add", payload);
      }
    },
    onSuccess: async () => {
      setForm(defaultCronForm());
      setEditingJobId(null);
      setFormError(null);
      await refreshAll();
    },
    onError: (error) => {
      setFormError(String(error));
    },
  });

  const actionMutation = useMutation({
    mutationFn: async (action: { type: "toggle" | "run" | "delete" | "wake"; job?: CronJob; enabled?: boolean; wakeMode?: "now" | "next-heartbeat"; wakeText?: string }) => {
      if (action.type === "toggle" && action.job) {
        await gateway.request("cron.update", { id: action.job.id, patch: { enabled: action.enabled } });
        return;
      }
      if (action.type === "run" && action.job) {
        await gateway.request("cron.run", { id: action.job.id, mode: "force" });
        return;
      }
      if (action.type === "delete" && action.job) {
        await gateway.request("cron.remove", { id: action.job.id });
        return;
      }
      if (action.type === "wake") {
        await gateway.request<{ message?: string }>("wake", {
          mode: action.wakeMode,
          text: action.wakeText,
        });
      }
    },
    onSuccess: async (_data, variables) => {
      if (variables.type === "wake") {
        setWakeMessage("Wake signal sent.");
      }
      await refreshAll();
    },
    onError: (error, variables) => {
      if (variables.type === "wake") {
        setWakeMessage(String(error));
      } else {
        setFormError(String(error));
      }
    },
  });

  const startEditing = (job: CronJob) => {
    setEditingJobId(job.id);
    setSelectedJobId(job.id);
    setForm(formFromJob(job));
    setFormError(null);
  };

  const resetForm = () => {
    setEditingJobId(null);
    setForm(defaultCronForm());
    setFormError(null);
  };

  if (!isConnected) {
    return (
      <div className="workspace-empty-state">
        <CalendarClock size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">Cron</h2>
        <p className="workspace-subtitle">Connect a gateway to manage scheduled jobs, trigger runs, and inspect recent cron activity.</p>
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <div className="workspace-toolbar">
        <div>
          <h2 className="workspace-title">Cron</h2>
          <p className="workspace-subtitle">
            Create, edit, run, and inspect gateway cron jobs with live `cron.*` RPCs.
          </p>
        </div>
        <div className="workspace-toolbar__actions">
          <Button variant="secondary" onClick={() => cronQuery.refetch()} loading={cronQuery.isFetching}>
            <RefreshCw size={14} />
            Refresh
          </Button>
          <Button variant="secondary" onClick={resetForm}>
            <Plus size={14} />
            New Job
          </Button>
        </div>
      </div>

      {formError && <div className="workspace-alert workspace-alert--error">{formError}</div>}

      <div className="stats-grid stats-grid--overview usage-overview-grid">
        <Card className="stat-card stat-card--overview usage-stat-card">
          <div className="stat-card__icon"><CalendarClock size={16} /></div>
          <span className="stat-card__label">Cron State</span>
          <span className="stat-card__value">{cronQuery.data?.status.enabled ? "Enabled" : "Disabled"}</span>
          <span className="workspace-subcopy">{cronQuery.data?.status.storePath || "No store path reported"}</span>
        </Card>
        <Card className="stat-card stat-card--overview usage-stat-card">
          <div className="stat-card__icon"><Play size={16} /></div>
          <span className="stat-card__label">Jobs</span>
          <span className="stat-card__value">{(cronQuery.data?.status.jobs ?? 0).toLocaleString()}</span>
          <span className="workspace-subcopy">{(cronQuery.data?.jobs.total ?? 0).toLocaleString()} currently loaded</span>
        </Card>
        <Card className="stat-card stat-card--overview usage-stat-card">
          <div className="stat-card__icon"><Send size={16} /></div>
          <span className="stat-card__label">Next Wake</span>
          <span className="stat-card__value">{formatDateTime(cronQuery.data?.status.nextWakeAtMs)}</span>
          <span className="workspace-subcopy">{cronQuery.data?.status.nextWakeAtMs ? formatRelativeTime(cronQuery.data.status.nextWakeAtMs) : "Idle"}</span>
        </Card>
        <Card className="stat-card stat-card--overview usage-stat-card">
          <div className="stat-card__icon"><RefreshCw size={16} /></div>
          <span className="stat-card__label">Recent Runs</span>
          <span className="stat-card__value">{(cronQuery.data?.runs.total ?? 0).toLocaleString()}</span>
          <span className="workspace-subcopy">Latest 25 runs for the current scope</span>
        </Card>
      </div>

      <div className="workspace-grid usage-grid-layout">
        <div className="usage-grid-layout__main">
          <Card className="workspace-section">
            <div className="workspace-section__header">
              <div>
                <h3>{editingJobId ? "Edit Job" : "Create Job"}</h3>
                <p>
                  {editingJobId ? "Updating via `cron.update`." : "Creating via `cron.add`."}
                </p>
              </div>
              {editingJobId && selectedJob && <StatusBadge status={selectedJob.enabled ? "connected" : "disconnected"} label={selectedJob.enabled ? "Enabled" : "Disabled"} />}
            </div>

            <div className="session-editor-grid cron-form-grid">
              <label className="session-field">
                <span>Name</span>
                <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Morning digest" />
              </label>
              <label className="session-field">
                <span>Agent Id</span>
                <input value={form.agentId} onChange={(event) => setForm((current) => ({ ...current, agentId: event.target.value }))} placeholder="Optional agent override" />
              </label>
              <label className="session-field">
                <span>Description</span>
                <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Explain what this job does" />
              </label>
              <label className="session-field">
                <span>Session Key</span>
                <input value={form.sessionKey} onChange={(event) => setForm((current) => ({ ...current, sessionKey: event.target.value }))} placeholder="Optional session pinning" />
              </label>
              <label className="session-field">
                <span>Schedule Type</span>
                <select value={form.scheduleKind} onChange={(event) => setForm((current) => ({ ...current, scheduleKind: event.target.value as CronFormState["scheduleKind"] }))}>
                  <option value="every">Every</option>
                  <option value="at">One-shot at</option>
                  <option value="cron">Cron expression</option>
                </select>
              </label>
              <label className="session-field">
                <span>Wake Mode</span>
                <select value={form.wakeMode} onChange={(event) => setForm((current) => ({ ...current, wakeMode: event.target.value as CronFormState["wakeMode"] }))}>
                  <option value="next-heartbeat">Next heartbeat</option>
                  <option value="now">Now</option>
                </select>
              </label>

              {form.scheduleKind === "every" && (
                <>
                  <label className="session-field">
                    <span>Repeat Every</span>
                    <input value={form.everyAmount} onChange={(event) => setForm((current) => ({ ...current, everyAmount: event.target.value }))} placeholder="15" />
                  </label>
                  <label className="session-field">
                    <span>Unit</span>
                    <select value={form.everyUnit} onChange={(event) => setForm((current) => ({ ...current, everyUnit: event.target.value as CronFormState["everyUnit"] }))}>
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </label>
                </>
              )}

              {form.scheduleKind === "at" && (
                <label className="session-field">
                  <span>Run At</span>
                  <input type="datetime-local" value={form.scheduleAt} onChange={(event) => setForm((current) => ({ ...current, scheduleAt: event.target.value }))} />
                </label>
              )}

              {form.scheduleKind === "cron" && (
                <>
                  <label className="session-field">
                    <span>Cron Expression</span>
                    <input value={form.cronExpr} onChange={(event) => setForm((current) => ({ ...current, cronExpr: event.target.value }))} placeholder="0 * * * *" />
                  </label>
                  <label className="session-field">
                    <span>Timezone</span>
                    <input value={form.cronTz} onChange={(event) => setForm((current) => ({ ...current, cronTz: event.target.value }))} placeholder="UTC or Asia/Shanghai" />
                  </label>
                  <label className="session-field">
                    <span>Stagger</span>
                    <input value={form.staggerAmount} onChange={(event) => setForm((current) => ({ ...current, staggerAmount: event.target.value }))} placeholder="Optional" />
                  </label>
                  <label className="session-field">
                    <span>Stagger Unit</span>
                    <select value={form.staggerUnit} onChange={(event) => setForm((current) => ({ ...current, staggerUnit: event.target.value as CronFormState["staggerUnit"] }))}>
                      <option value="seconds">Seconds</option>
                      <option value="minutes">Minutes</option>
                    </select>
                  </label>
                </>
              )}

              <label className="session-field">
                <span>Payload Type</span>
                <select value={form.payloadKind} onChange={(event) => setForm((current) => ({ ...current, payloadKind: event.target.value as CronFormState["payloadKind"] }))}>
                  <option value="agentTurn">Agent Turn</option>
                  <option value="systemEvent">System Event</option>
                </select>
              </label>
              <label className="session-field">
                <span>Session Target</span>
                <select value={form.sessionTarget} onChange={(event) => setForm((current) => ({ ...current, sessionTarget: event.target.value as CronFormState["sessionTarget"] }))}>
                  <option value="isolated">Isolated</option>
                  <option value="main">Main</option>
                </select>
              </label>
              <label className="session-field cron-form-grid__full">
                <span>{form.payloadKind === "agentTurn" ? "Prompt / Message" : "System Event Text"}</span>
                <textarea className="text-area" value={form.payloadText} onChange={(event) => setForm((current) => ({ ...current, payloadText: event.target.value }))} placeholder={form.payloadKind === "agentTurn" ? "Summarize overnight activity" : "wake agent pipeline"} />
              </label>

              {form.payloadKind === "agentTurn" && (
                <>
                  <label className="session-field">
                    <span>Model Override</span>
                    <input list="cron-model-suggestions" value={form.payloadModel} onChange={(event) => setForm((current) => ({ ...current, payloadModel: event.target.value }))} placeholder="Optional model override" />
                    <datalist id="cron-model-suggestions">
                      {(cronQuery.data?.models ?? []).map((model) => <option key={model} value={model} />)}
                    </datalist>
                  </label>
                  <label className="session-field">
                    <span>Thinking</span>
                    <input value={form.payloadThinking} onChange={(event) => setForm((current) => ({ ...current, payloadThinking: event.target.value }))} placeholder="Optional reasoning budget" />
                  </label>
                  <label className="session-field">
                    <span>Timeout Seconds</span>
                    <input value={form.timeoutSeconds} onChange={(event) => setForm((current) => ({ ...current, timeoutSeconds: event.target.value }))} placeholder="Optional" />
                  </label>
                  <label className="session-field session-field--checkbox">
                    <input type="checkbox" checked={form.payloadLightContext} onChange={(event) => setForm((current) => ({ ...current, payloadLightContext: event.target.checked }))} />
                    <span>Use light context</span>
                  </label>
                </>
              )}

              <label className="session-field">
                <span>Delivery</span>
                <select value={form.deliveryMode} onChange={(event) => setForm((current) => ({ ...current, deliveryMode: event.target.value as CronFormState["deliveryMode"] }))}>
                  <option value="none">None</option>
                  <option value="announce">Announce</option>
                  <option value="webhook">Webhook</option>
                </select>
              </label>

              {form.deliveryMode === "announce" && (
                <>
                  <label className="session-field">
                    <span>Channel</span>
                    <select value={form.deliveryChannel} onChange={(event) => setForm((current) => ({ ...current, deliveryChannel: event.target.value }))}>
                      {(cronQuery.data?.channels ?? []).map((channel) => (
                        <option key={channel.id} value={channel.id}>{channel.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="session-field">
                    <span>Recipient / Thread</span>
                    <input value={form.deliveryTo} onChange={(event) => setForm((current) => ({ ...current, deliveryTo: event.target.value }))} placeholder="Optional destination" />
                  </label>
                  <label className="session-field">
                    <span>Account Id</span>
                    <input value={form.deliveryAccountId} onChange={(event) => setForm((current) => ({ ...current, deliveryAccountId: event.target.value }))} placeholder="Optional multi-account id" />
                  </label>
                </>
              )}

              {form.deliveryMode === "webhook" && (
                <label className="session-field">
                  <span>Webhook URL</span>
                  <input value={form.deliveryTo} onChange={(event) => setForm((current) => ({ ...current, deliveryTo: event.target.value }))} placeholder="https://example.com/hook" />
                </label>
              )}

              <label className="session-field session-field--checkbox">
                <input type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} />
                <span>Enabled</span>
              </label>
              <label className="session-field session-field--checkbox">
                <input type="checkbox" checked={form.deliveryBestEffort} onChange={(event) => setForm((current) => ({ ...current, deliveryBestEffort: event.target.checked }))} />
                <span>Best effort delivery</span>
              </label>
              <label className="session-field session-field--checkbox">
                <input type="checkbox" checked={form.deleteAfterRun} onChange={(event) => setForm((current) => ({ ...current, deleteAfterRun: event.target.checked }))} />
                <span>Delete after run</span>
              </label>
            </div>

            <div className="workspace-toolbar__actions">
              <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
                <Send size={14} />
                {editingJobId ? "Save Job" : "Create Job"}
              </Button>
              <Button variant="secondary" onClick={resetForm}>Reset</Button>
            </div>
          </Card>

          <Card className="workspace-section">
            <div className="workspace-section__header">
              <div>
                <h3>Recent Runs</h3>
                <p>{selectedJob ? `Showing runs for ${selectedJob.name}.` : "Showing latest runs across all jobs."}</p>
              </div>
              <div className="workspace-toolbar__actions cron-runs-toolbar">
                {selectedJob && (
                  <Button variant="secondary" size="sm" onClick={() => setSelectedJobId(null)}>
                    All Jobs
                  </Button>
                )}
                <label className="session-field usage-field usage-field--compact cron-runs-filter">
                  <span>Status</span>
                  <select value={runStatusFilter} onChange={(event) => setRunStatusFilter(event.target.value as RunStatusFilter)}>
                    <option value="all">All runs</option>
                    <option value="ok">Succeeded</option>
                    <option value="error">Failed</option>
                    <option value="skipped">Skipped</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
              </div>
            </div>

            {cronQuery.isLoading ? (
              <div className="workspace-inline-status">Loading cron runs…</div>
            ) : runs.length === 0 ? (
              <div className="workspace-empty-inline">No recent runs were recorded.</div>
            ) : filteredRuns.length === 0 ? (
              <div className="workspace-empty-inline">No runs match the current status filter.</div>
            ) : (
              <div className="cron-runs-layout">
                <div className="usage-log-list cron-runs-list">
                  {filteredRuns.map((entry) => {
                    const isSelected = selectedRun != null && getRunKey(entry) === getRunKey(selectedRun);
                    return (
                      <button
                        key={getRunKey(entry)}
                        type="button"
                        className={`cron-run-row ${isSelected ? "active" : ""}`}
                        onClick={() => setSelectedRunKey(getRunKey(entry))}
                      >
                        <div>
                          <div className="usage-ranking-row__title">{entry.jobName ?? entry.jobId}</div>
                          <div className="workspace-subcopy">{new Date(entry.ts).toLocaleString()}</div>
                        </div>
                        <div className="detail-pills">
                          <span className="detail-pill">{getRunStatus(entry)}</span>
                          {entry.deliveryStatus && <span className="detail-pill">{entry.deliveryStatus}</span>}
                          {entry.model && <span className="detail-pill">{entry.model}</span>}
                        </div>
                        <div className="cron-run-row__summary">
                          <strong>{entry.summary ?? entry.error ?? "No summary"}</strong>
                          <span>
                            {entry.usage?.total_tokens != null ? `${entry.usage.total_tokens.toLocaleString()} tokens` : formatDuration(entry.durationMs)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {selectedRun && (
                  <div className="cron-run-detail">
                    <div className="workspace-section__header">
                      <div>
                        <h3>Run Details</h3>
                        <p>{selectedRun.jobName ?? selectedRun.jobId} · {formatDateTime(selectedRun.ts)}</p>
                      </div>
                      <StatusBadge status={getRunBadgeStatus(selectedRun)} label={formatRunStatusLabel(getRunStatus(selectedRun))} />
                    </div>

                    {selectedRun.error && (
                      <div className="workspace-alert workspace-alert--error compact">{selectedRun.error}</div>
                    )}

                    <div className="detail-pills">
                      <span className="detail-pill">{selectedRun.deliveryStatus ?? "delivery unknown"}</span>
                      <span className="detail-pill">{selectedRun.sessionKey ?? "no session key"}</span>
                      {selectedRun.provider && <span className="detail-pill">{selectedRun.provider}</span>}
                      {selectedRun.model && <span className="detail-pill">{selectedRun.model}</span>}
                    </div>

                    <div className="overview-kv-list compact">
                      <div className="overview-kv-row"><span>Job</span><strong>{selectedRun.jobName ?? selectedRun.jobId}</strong></div>
                      <div className="overview-kv-row"><span>Started</span><strong>{formatDateTime(selectedRun.ts)}</strong></div>
                      <div className="overview-kv-row"><span>Duration</span><strong>{formatDuration(selectedRun.durationMs)}</strong></div>
                      <div className="overview-kv-row"><span>Tokens</span><strong>{selectedRun.usage?.total_tokens?.toLocaleString() ?? "n/a"}</strong></div>
                    </div>

                    <div className="cron-run-detail__summary">
                      <span>Summary</span>
                      <strong>{selectedRun.summary ?? selectedRun.error ?? "No summary was recorded for this run."}</strong>
                    </div>

                    <div className="workspace-toolbar__actions cron-run-detail__actions">
                      {selectedRunJob && selectedRunJob.id !== selectedJobId && (
                        <Button variant="secondary" size="sm" onClick={() => setSelectedJobId(selectedRunJob.id)}>
                          Focus Job
                        </Button>
                      )}
                      {selectedRunJob && (
                        <Button
                          size="sm"
                          onClick={() => actionMutation.mutate({ type: "run", job: selectedRunJob })}
                          loading={actionMutation.isPending && selectedRunJob.id === selectedJobId}
                        >
                          <Play size={12} />
                          Run Again
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="usage-grid-layout__sidebar">
          <Card className="workspace-section">
            <div className="workspace-section__header">
              <div>
                <h3>Jobs</h3>
                <p>{jobs.length} visible job{jobs.length === 1 ? "" : "s"}</p>
              </div>
            </div>

            <label className="session-search">
              <CalendarClock size={14} />
              <input value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="Search jobs by name, description, agent" />
            </label>

            {cronQuery.isLoading ? (
              <div className="workspace-inline-status">Loading cron jobs…</div>
            ) : jobs.length === 0 ? (
              <div className="workspace-empty-inline">No cron jobs matched the current filters.</div>
            ) : (
              <div className="session-browser-list usage-session-list">
                {jobs.map((job) => {
                  const isSelected = job.id === selectedJobId;
                  return (
                    <div key={job.id} className={`session-browser-row ${isSelected ? "active" : ""}`}>
                      <button type="button" className="cron-job-select" onClick={() => setSelectedJobId(job.id)}>
                        <div className="session-browser-row__top">
                          <div>
                            <div className="usage-ranking-row__title">{job.name}</div>
                            <div className="workspace-subcopy">{describeSchedule(job.schedule)}</div>
                          </div>
                          <StatusBadge status={job.enabled ? "connected" : "disconnected"} label={job.enabled ? "Enabled" : "Disabled"} />
                        </div>
                        <div className="detail-pills">
                          <span className="detail-pill">{job.payload.kind}</span>
                          <span className="detail-pill">{job.sessionTarget}</span>
                          <span className="detail-pill">{describeDelivery(job)}</span>
                        </div>
                        <div className="overview-kv-list compact cron-job-meta-list">
                          <div className="overview-kv-row"><span>Next Run</span><strong>{formatDateTime(job.state.nextRunAtMs)}</strong></div>
                          <div className="overview-kv-row"><span>Last Run</span><strong>{formatDateTime(job.state.lastRunAtMs)}</strong></div>
                          <div className="overview-kv-row"><span>Last Status</span><strong>{job.state.lastRunStatus ?? job.state.lastStatus ?? "n/a"}</strong></div>
                        </div>
                      </button>

                      <div className="workspace-toolbar__actions cron-job-actions">
                        <Button variant="secondary" size="sm" onClick={() => startEditing(job)}>Edit</Button>
                        <Button variant="secondary" size="sm" onClick={() => actionMutation.mutate({ type: "toggle", job, enabled: !job.enabled })} loading={actionMutation.isPending && selectedJobId === job.id}>
                          {job.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button size="sm" onClick={() => actionMutation.mutate({ type: "run", job })} loading={actionMutation.isPending && selectedJobId === job.id}>
                          <Play size={12} />
                          Run
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => actionMutation.mutate({ type: "delete", job })}>
                          <Trash2 size={12} />
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="workspace-section">
            <div className="workspace-section__header">
              <div>
                <h3>Wake Gateway</h3>
                <p>Trigger the cron wake path directly with `wake`.</p>
              </div>
            </div>

            {wakeMessage && <div className="workspace-alert compact">{wakeMessage}</div>}

            <label className="session-field">
              <span>Mode</span>
              <select value={wakeMode} onChange={(event) => setWakeMode(event.target.value as "now" | "next-heartbeat")}>
                <option value="next-heartbeat">Next heartbeat</option>
                <option value="now">Now</option>
              </select>
            </label>

            <label className="session-field">
              <span>Wake Text</span>
              <textarea className="text-area" value={wakeText} onChange={(event) => setWakeText(event.target.value)} placeholder="Ask the main session to summarize pending work" />
            </label>

            <Button onClick={() => actionMutation.mutate({ type: "wake", wakeMode, wakeText })} loading={actionMutation.isPending}>
              <Send size={14} />
              Send Wake
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
