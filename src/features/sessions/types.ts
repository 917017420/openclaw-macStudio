export type SessionKind = "direct" | "group" | "global" | "unknown";

export interface SessionDefaults {
  modelProvider?: string | null;
  model?: string | null;
  contextTokens?: number | null;
}

export interface SessionRow {
  key: string;
  kind: SessionKind;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  surface?: string;
  subject?: string;
  room?: string;
  space?: string;
  lastMessagePreview?: string;
  updatedAt: number | null;
  sessionId?: string;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
}

export interface SessionsListSnapshot {
  ts: number;
  path: string;
  count: number;
  defaults: SessionDefaults;
  sessions: SessionRow[];
}

export interface SessionPreviewItem {
  role: "user" | "assistant" | "tool" | "system" | "other";
  text: string;
}

export interface SessionPreviewEntry {
  key: string;
  status: "ok" | "empty" | "missing" | "error";
  items: SessionPreviewItem[];
}

export interface SessionsPreviewSnapshot {
  ts: number;
  previews: SessionPreviewEntry[];
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeSessionRow(raw: unknown): SessionRow | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const key = typeof obj.key === "string"
    ? obj.key
    : typeof obj.sessionKey === "string"
      ? obj.sessionKey
      : null;
  if (!key) {
    return null;
  }

  const kind = obj.kind;
  return {
    key,
    kind:
      kind === "direct" || kind === "group" || kind === "global" || kind === "unknown"
        ? kind
        : "unknown",
    label: asOptionalString(obj.label),
    displayName: asOptionalString(obj.displayName),
    derivedTitle: asOptionalString(obj.derivedTitle),
    surface: asOptionalString(obj.surface),
    subject: asOptionalString(obj.subject),
    room: asOptionalString(obj.room),
    space: asOptionalString(obj.space),
    lastMessagePreview: asOptionalString(obj.lastMessagePreview),
    updatedAt: asOptionalNumber(obj.updatedAt) ?? null,
    sessionId: asOptionalString(obj.sessionId),
    systemSent: obj.systemSent === true,
    abortedLastRun: obj.abortedLastRun === true,
    thinkingLevel: asOptionalString(obj.thinkingLevel),
    verboseLevel: asOptionalString(obj.verboseLevel),
    reasoningLevel: asOptionalString(obj.reasoningLevel),
    elevatedLevel: asOptionalString(obj.elevatedLevel),
    inputTokens: asOptionalNumber(obj.inputTokens),
    outputTokens: asOptionalNumber(obj.outputTokens),
    totalTokens: asOptionalNumber(obj.totalTokens),
    model: asOptionalString(obj.model),
    modelProvider: asOptionalString(obj.modelProvider),
    contextTokens: asOptionalNumber(obj.contextTokens),
  };
}

export function normalizeSessionsSnapshot(raw: unknown): SessionsListSnapshot {
  if (!raw || typeof raw !== "object") {
    return { ts: Date.now(), path: "", count: 0, defaults: {}, sessions: [] };
  }

  const obj = raw as Record<string, unknown>;
  const sessionsRaw = Array.isArray(obj.sessions) ? obj.sessions : [];
  return {
    ts: typeof obj.ts === "number" ? obj.ts : Date.now(),
    path: typeof obj.path === "string" ? obj.path : "",
    count: typeof obj.count === "number" ? obj.count : sessionsRaw.length,
    defaults: obj.defaults && typeof obj.defaults === "object"
      ? (obj.defaults as SessionDefaults)
      : {},
    sessions: sessionsRaw
      .map((entry) => normalizeSessionRow(entry))
      .filter(Boolean) as SessionRow[],
  };
}

export function normalizeSessionsPreview(raw: unknown): SessionsPreviewSnapshot {
  if (!raw || typeof raw !== "object") {
    return { ts: Date.now(), previews: [] };
  }

  const obj = raw as Record<string, unknown>;
  const previewsRaw = Array.isArray(obj.previews) ? obj.previews : [];

  return {
    ts: typeof obj.ts === "number" ? obj.ts : Date.now(),
    previews: previewsRaw
      .map((entry) => {
        const preview = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
        const itemsRaw = Array.isArray(preview.items) ? preview.items : [];
        return {
          key: typeof preview.key === "string" ? preview.key : "",
          status:
            preview.status === "ok" ||
            preview.status === "empty" ||
            preview.status === "missing" ||
            preview.status === "error"
              ? preview.status
              : "error",
          items: itemsRaw
            .map((item) => {
              if (!item || typeof item !== "object") {
                return null;
              }
              const objItem = item as Record<string, unknown>;
              const role = typeof objItem.role === "string" ? objItem.role : "other";
              const text = typeof objItem.text === "string" ? objItem.text : "";
              return {
                role:
                  role === "user" || role === "assistant" || role === "tool" || role === "system"
                    ? role
                    : "other",
                text,
              } as SessionPreviewItem;
            })
            .filter(Boolean) as SessionPreviewItem[],
        } satisfies SessionPreviewEntry;
      })
      .filter((entry) => entry.key),
  };
}
