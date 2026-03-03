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

/**
 * Normalize a raw session object from the server into our ChatSession type.
 */
function normalizeSession(raw: Record<string, unknown>): ChatSession | null {
  // id: could be 'id', 'session_id', 'sessionId', 'sessionKey', 'key'
  const id = (raw.id ?? raw.session_id ?? raw.sessionId ?? raw.sessionKey ?? raw.key) as
    | string
    | undefined;
  if (!id) return null;

  const agentId = (raw.agentId ?? raw.agent_id ?? raw.agent ?? "") as string;
  const title = (raw.title ?? raw.name ?? raw.label) as string | undefined;
  const now = Date.now();

  return {
    id,
    agentId,
    title,
    createdAt: (raw.createdAt ?? raw.created_at ?? raw.created ?? now) as number,
    updatedAt: (raw.updatedAt ?? raw.updated_at ?? raw.updated ?? now) as number,
    messageCount: (raw.messageCount ?? raw.message_count ?? raw.messages ?? 0) as number,
  };
}

/**
 * Extract sessions array from the server response.
 */
function extractSessions(res: unknown): ChatSession[] {
  if (Array.isArray(res)) {
    return res.map((r) => normalizeSession(r as Record<string, unknown>)).filter(Boolean) as ChatSession[];
  }

  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>;
    for (const key of ["sessions", "items", "data", "list", "result"]) {
      if (key in obj && Array.isArray(obj[key])) {
        return (obj[key] as Record<string, unknown>[])
          .map(normalizeSession)
          .filter(Boolean) as ChatSession[];
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
