// Hook: useSessions — fetches session list from Gateway via TanStack Query

import { useQuery } from "@tanstack/react-query";
import { gateway } from "@/lib/gateway";
import type { ChatSession } from "@/lib/gateway";
import { useConnectionStore } from "@/features/connection/store";

/** Query key for session list */
export const SESSIONS_QUERY_KEY = ["sessions"] as const;

/** Build session query key with optional agentId filter */
export function sessionsQueryKey(agentId?: string) {
  return agentId ? [...SESSIONS_QUERY_KEY, agentId] : [...SESSIONS_QUERY_KEY];
}

interface SessionRecord {
  session: ChatSession;
  key: string;
  successorKey?: string;
}

function parseAgentIdFromKey(key: string): string | undefined {
  const m = key.match(/^agent:([^:]+):/);
  return m?.[1];
}

function isSessionKey(value: string): boolean {
  return value === "main" || /^agent:[^:]+:.+/.test(value);
}

function resolveSessionKey(
  raw: Record<string, unknown>,
  agentIdHint?: string,
): string | undefined {
  const key = raw.key;
  if (typeof key === "string" && key.length > 0) return key;

  const sessionKey = raw.sessionKey;
  if (typeof sessionKey === "string" && sessionKey.length > 0) return sessionKey;

  const sessionId = raw.sessionId ?? raw.session_id ?? raw.id;
  if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;

  if (isSessionKey(sessionId)) return sessionId;
  if (agentIdHint) return `agent:${agentIdHint}:${sessionId}`;
  return sessionId;
}

function buildSuccessorKey(key: string, agentId: string, sessionId: string): string {
  if (key.startsWith(`agent:${agentId}:`)) {
    return `agent:${agentId}:${sessionId}`;
  }
  return sessionId;
}

/**
 * Normalize a raw session object from the server into our ChatSession type.
 */
function normalizeSession(raw: Record<string, unknown>): SessionRecord | null {
  const explicitAgentId = (raw.agentId ?? raw.agent_id ?? raw.agent) as string | undefined;
  const keyHint = (raw.key ?? raw.sessionKey) as string | undefined;
  const inferredAgentId = keyHint ? parseAgentIdFromKey(keyHint) : undefined;
  const id = resolveSessionKey(raw, explicitAgentId ?? inferredAgentId);
  if (!id) return null;

  const agentId = explicitAgentId || parseAgentIdFromKey(id) || "";
  const title = (raw.title ?? raw.name ?? raw.label) as string | undefined;
  const now = Date.now();
  const sessionIdRaw = (raw.sessionId ?? raw.session_id) as string | undefined;
  const successorKey = sessionIdRaw
    ? buildSuccessorKey(id, agentId, sessionIdRaw)
    : undefined;
  const msgCountRaw = raw.messageCount ?? raw.message_count ?? raw.messages ?? 0;
  const messageCount = typeof msgCountRaw === "number" && Number.isFinite(msgCountRaw)
    ? msgCountRaw
    : 0;

  return {
    key: id,
    successorKey,
    session: {
      id,
      agentId,
      title,
      createdAt: (raw.createdAt ?? raw.created_at ?? raw.created ?? now) as number,
      updatedAt: (raw.updatedAt ?? raw.updated_at ?? raw.updated ?? now) as number,
      messageCount,
    },
  };
}

function collapseAliasedSessions(records: SessionRecord[]): ChatSession[] {
  const byKey = new Map<string, SessionRecord>();
  for (const record of records) {
    byKey.set(record.key, record);
  }

  const predecessors = new Map<string, string[]>();
  for (const record of records) {
    if (!record.successorKey) continue;
    if (!byKey.has(record.successorKey)) continue;
    const list = predecessors.get(record.successorKey) ?? [];
    list.push(record.key);
    predecessors.set(record.successorKey, list);
  }

  const visited = new Set<string>();
  const collapsed: ChatSession[] = [];

  for (const record of records) {
    if (visited.has(record.key)) continue;

    const groupKeys: string[] = [];
    const stack = [record.key];
    visited.add(record.key);

    while (stack.length > 0) {
      const key = stack.pop()!;
      groupKeys.push(key);

      const node = byKey.get(key);
      if (node?.successorKey && byKey.has(node.successorKey) && !visited.has(node.successorKey)) {
        visited.add(node.successorKey);
        stack.push(node.successorKey);
      }

      for (const prevKey of predecessors.get(key) ?? []) {
        if (!visited.has(prevKey)) {
          visited.add(prevKey);
          stack.push(prevKey);
        }
      }
    }

    const group = groupKeys
      .map((key) => byKey.get(key))
      .filter(Boolean) as SessionRecord[];
    if (group.length === 0) continue;

    const mainRepresentative = group.find((item) =>
      /(^main$)|(:main$)/.test(item.key),
    );
    const newest = group.reduce((best, cur) =>
      cur.session.updatedAt > best.session.updatedAt ? cur : best,
    );
    const representative = mainRepresentative ?? newest;
    const firstTitled = group.find((item) => (item.session.title ?? "").trim().length > 0);
    const messageCount = group.reduce(
      (max, cur) => Math.max(max, cur.session.messageCount),
      representative.session.messageCount,
    );
    const createdAt = group.reduce(
      (min, cur) => Math.min(min, cur.session.createdAt),
      representative.session.createdAt,
    );

    collapsed.push({
      ...representative.session,
      title: representative.session.title ?? firstTitled?.session.title,
      updatedAt: newest.session.updatedAt,
      createdAt,
      messageCount,
    });
  }

  return collapsed.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Extract sessions array from the server response.
 */
function extractSessions(res: unknown): ChatSession[] {
  const toCollapsed = (rows: Record<string, unknown>[]): ChatSession[] => {
    const normalized = rows
      .map(normalizeSession)
      .filter(Boolean) as SessionRecord[];
    return collapseAliasedSessions(normalized);
  };

  if (Array.isArray(res)) {
    return toCollapsed(res as Record<string, unknown>[]);
  }

  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>;
    for (const key of ["sessions", "items", "data", "list", "result"]) {
      if (key in obj && Array.isArray(obj[key])) {
        return toCollapsed(obj[key] as Record<string, unknown>[]);
      }
    }
  }

  return [];
}

/**
 * Fetch and cache the session list for a given agent.
 * Only enabled when Gateway is connected and agentId is provided.
 */
export function useSessions(agentId: string | null) {
  const isConnected = useConnectionStore((s) => s.state === "connected");

  return useQuery<ChatSession[]>({
    queryKey: sessionsQueryKey(agentId ?? undefined),
    queryFn: async () => {
      const params: Record<string, unknown> = {};
      if (agentId) params.agentId = agentId;

      console.log("[useSessions] Fetching with params:", params);

      const res = await gateway.request<unknown>("sessions.list", params);
      console.log("[useSessions] Raw response:", JSON.stringify(res));

      const sessions = extractSessions(res);
      console.log("[useSessions] Parsed sessions:", sessions);

      return sessions;
    },
    enabled: isConnected && agentId !== null,
    staleTime: 15_000,
  });
}
