const TOOL_STREAM_LIMIT = 50;
const TOOL_OUTPUT_CHAR_LIMIT = 120_000;

export type CompactionStatus = {
  active: boolean;
  startedAt: number | null;
  completedAt: number | null;
};

export type FallbackStatus = {
  phase?: "active" | "cleared";
  selected: string;
  active: string;
  previous?: string;
  reason?: string;
  attempts: string[];
  occurredAt: number;
};

export type AgentToolEventPayload = {
  runId: string | null;
  seq: number;
  stream: string | null;
  phase: string | null;
  ts: number;
  sessionKey?: string | null;
  data: Record<string, unknown>;
  isError?: boolean;
};

export type ToolStreamEntry = {
  toolCallId: string;
  runId: string | null;
  sessionKey?: string;
  name: string;
  args?: unknown;
  output?: string;
  phase: "start" | "update" | "result";
  startedAt: number;
  updatedAt: number;
  message: Record<string, unknown>;
};

export type SessionToolStreamHost = {
  sessionKey: string;
  currentRunId: string | null;
  toolStreamById: Map<string, ToolStreamEntry>;
  toolStreamOrder: string[];
  chatToolMessages: Record<string, unknown>[];
  compactionStatus: CompactionStatus | null;
  fallbackStatus: FallbackStatus | null;
};

export function createSessionToolStreamHost(sessionKey: string): SessionToolStreamHost {
  return {
    sessionKey,
    currentRunId: null,
    toolStreamById: new Map<string, ToolStreamEntry>(),
    toolStreamOrder: [],
    chatToolMessages: [],
    compactionStatus: null,
    fallbackStatus: null,
  };
}

export function resetToolStream(host: SessionToolStreamHost, runId?: string | null) {
  host.currentRunId = runId ?? null;
  host.toolStreamById.clear();
  host.toolStreamOrder = [];
  host.chatToolMessages = [];
}

function syncToolStreamMessages(host: SessionToolStreamHost) {
  host.chatToolMessages = host.toolStreamOrder
    .map((id) => host.toolStreamById.get(id)?.message)
    .filter((message): message is Record<string, unknown> => Boolean(message));
}

function trimToolStream(host: SessionToolStreamHost) {
  if (host.toolStreamOrder.length <= TOOL_STREAM_LIMIT) {
    return;
  }
  const overflow = host.toolStreamOrder.length - TOOL_STREAM_LIMIT;
  const removed = host.toolStreamOrder.splice(0, overflow);
  for (const id of removed) {
    host.toolStreamById.delete(id);
  }
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveModelLabel(provider: unknown, model: unknown): string | null {
  const modelValue = toTrimmedString(model);
  if (!modelValue) {
    return null;
  }
  const providerValue = toTrimmedString(provider);
  if (providerValue) {
    const prefix = `${providerValue}/`;
    if (modelValue.toLowerCase().startsWith(prefix.toLowerCase())) {
      const trimmedModel = modelValue.slice(prefix.length).trim();
      if (trimmedModel) {
        return `${providerValue}/${trimmedModel}`;
      }
    }
    return `${providerValue}/${modelValue}`;
  }
  const slashIndex = modelValue.indexOf("/");
  if (slashIndex > 0) {
    const p = modelValue.slice(0, slashIndex).trim();
    const m = modelValue.slice(slashIndex + 1).trim();
    if (p && m) {
      return `${p}/${m}`;
    }
  }
  return modelValue;
}

type FallbackAttempt = {
  provider: string;
  model: string;
  reason: string;
};

function parseFallbackAttemptSummaries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => toTrimmedString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function parseFallbackAttempts(value: unknown): FallbackAttempt[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: FallbackAttempt[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const item = entry as Record<string, unknown>;
    const provider = toTrimmedString(item.provider);
    const model = toTrimmedString(item.model);
    if (!provider || !model) {
      continue;
    }
    const reason =
      toTrimmedString(item.reason)?.replace(/_/g, " ") ??
      toTrimmedString(item.code) ??
      (typeof item.status === "number" ? `HTTP ${item.status}` : null) ??
      toTrimmedString(item.error) ??
      "error";
    out.push({ provider, model, reason });
  }
  return out;
}

function extractToolOutputText(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  const content = record.content;
  if (!Array.isArray(content)) {
    return null;
  }
  const parts = content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const entry = item as Record<string, unknown>;
      if (entry.type === "text" && typeof entry.text === "string") {
        return entry.text;
      }
      return null;
    })
    .filter((part): part is string => Boolean(part));
  if (parts.length === 0) {
    return null;
  }
  return parts.join("\n");
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n\n… truncated (${text.length} chars total).`;
}

function formatToolOutput(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const contentText = extractToolOutputText(value);
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (contentText) {
    text = contentText;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  return truncateText(text, TOOL_OUTPUT_CHAR_LIMIT);
}

function buildToolStreamMessage(entry: ToolStreamEntry): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  content.push({
    type: "toolcall",
    name: entry.name,
    arguments: entry.args ?? {},
  });
  if (entry.phase === "result" || entry.output !== undefined) {
    content.push({
      type: "toolresult",
      name: entry.name,
      text: entry.output ?? "",
    });
  }
  return {
    id: `tool-stream:${entry.toolCallId}`,
    role: "assistant",
    toolCallId: entry.toolCallId,
    runId: entry.runId,
    content,
    timestamp: entry.startedAt,
    __openclaw: {
      toolPhase: entry.phase,
    },
  };
}

function resolveAcceptedSession(
  host: SessionToolStreamHost,
  payload: AgentToolEventPayload,
  options?: { allowSessionScopedWhenIdle?: boolean },
): { accepted: boolean; sessionKey?: string } {
  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : undefined;
  if (sessionKey && sessionKey !== host.sessionKey) {
    return { accepted: false };
  }
  if (!host.currentRunId && options?.allowSessionScopedWhenIdle && sessionKey) {
    return { accepted: true, sessionKey };
  }
  if (host.currentRunId && payload.runId && payload.runId !== host.currentRunId) {
    return { accepted: false };
  }
  return { accepted: true, sessionKey };
}

function handleCompactionEvent(host: SessionToolStreamHost, payload: AgentToolEventPayload) {
  const phase = typeof payload.data.phase === "string" ? payload.data.phase : "";
  if (phase === "start") {
    host.compactionStatus = {
      active: true,
      startedAt: Date.now(),
      completedAt: null,
    };
    return;
  }
  if (phase === "end") {
    host.compactionStatus = {
      active: false,
      startedAt: host.compactionStatus?.startedAt ?? null,
      completedAt: Date.now(),
    };
  }
}

function handleLifecycleFallbackEvent(host: SessionToolStreamHost, payload: AgentToolEventPayload) {
  const data = payload.data ?? {};
  const phase = payload.stream === "fallback" ? "fallback" : toTrimmedString(data.phase);
  if (payload.stream === "lifecycle" && phase !== "fallback" && phase !== "fallback_cleared") {
    return;
  }

  const accepted = resolveAcceptedSession(host, payload, { allowSessionScopedWhenIdle: true });
  if (!accepted.accepted) {
    return;
  }

  const selected =
    resolveModelLabel(data.selectedProvider, data.selectedModel) ??
    resolveModelLabel(data.fromProvider, data.fromModel);
  const active =
    resolveModelLabel(data.activeProvider, data.activeModel) ??
    resolveModelLabel(data.toProvider, data.toModel);
  const previous =
    resolveModelLabel(data.previousActiveProvider, data.previousActiveModel) ??
    toTrimmedString(data.previousActiveModel);
  if (!selected || !active) {
    return;
  }
  if (phase === "fallback" && selected === active) {
    return;
  }

  const reason = toTrimmedString(data.reasonSummary) ?? toTrimmedString(data.reason);
  const attempts = (() => {
    const summaries = parseFallbackAttemptSummaries(data.attemptSummaries);
    if (summaries.length > 0) {
      return summaries;
    }
    return parseFallbackAttempts(data.attempts).map((attempt) => {
      const modelRef = resolveModelLabel(attempt.provider, attempt.model);
      return `${modelRef ?? `${attempt.provider}/${attempt.model}`}: ${attempt.reason}`;
    });
  })();

  host.fallbackStatus = {
    phase: phase === "fallback_cleared" ? "cleared" : "active",
    selected,
    active: phase === "fallback_cleared" ? selected : active,
    previous:
      phase === "fallback_cleared"
        ? (previous ?? (active !== selected ? active : undefined))
        : undefined,
    reason: reason ?? undefined,
    attempts,
    occurredAt: Date.now(),
  };
}

export function handleAgentToolEvent(host: SessionToolStreamHost, payload?: AgentToolEventPayload) {
  if (!payload) {
    return;
  }

  if (payload.stream === "compaction") {
    handleCompactionEvent(host, payload);
    return;
  }

  if (payload.stream === "lifecycle" || payload.stream === "fallback") {
    handleLifecycleFallbackEvent(host, payload);
    return;
  }

  if (payload.stream !== "tool") {
    return;
  }

  const accepted = resolveAcceptedSession(host, payload);
  if (!accepted.accepted) {
    return;
  }

  if (payload.runId && host.currentRunId && payload.runId !== host.currentRunId) {
    resetToolStream(host, payload.runId);
  } else if (payload.runId && !host.currentRunId) {
    host.currentRunId = payload.runId;
  }

  const data = payload.data ?? {};
  const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
  if (!toolCallId) {
    return;
  }

  const name = typeof data.name === "string" ? data.name : "tool";
  const phase = typeof data.phase === "string" ? data.phase : "";
  const args = phase === "start" ? data.args : undefined;
  const output =
    phase === "update"
      ? formatToolOutput(data.partialResult)
      : phase === "result"
        ? formatToolOutput(data.result)
        : undefined;

  const now = Date.now();
  let entry = host.toolStreamById.get(toolCallId);
  if (!entry) {
    entry = {
      toolCallId,
      runId: payload.runId,
      sessionKey: accepted.sessionKey,
      name,
      args,
      output: output ?? undefined,
      phase: phase === "result" ? "result" : phase === "update" ? "update" : "start",
      startedAt: payload.ts || now,
      updatedAt: now,
      message: {},
    };
    host.toolStreamById.set(toolCallId, entry);
    host.toolStreamOrder.push(toolCallId);
  } else {
    entry.name = name;
    entry.phase = phase === "result" ? "result" : phase === "update" ? "update" : "start";
    if (args !== undefined) {
      entry.args = args;
    }
    if (output !== undefined || phase === "result") {
      entry.output = output ?? undefined;
    }
    entry.updatedAt = now;
  }

  entry.message = buildToolStreamMessage(entry);
  trimToolStream(host);
  syncToolStreamMessages(host);
}
