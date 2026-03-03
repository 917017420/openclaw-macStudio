// Hook: useAgents — fetches agent list from Gateway via TanStack Query

import { useQuery } from "@tanstack/react-query";
import { gateway } from "@/lib/gateway";
import type { Agent } from "@/lib/gateway";
import { useConnectionStore } from "@/features/connection/store";

/** Query key for agent list */
export const AGENTS_QUERY_KEY = ["agents"] as const;

/**
 * Normalize a raw agent object from the server into our Agent type.
 * Handles various possible field naming conventions.
 */
function normalizeAgent(raw: Record<string, unknown>): Agent | null {
  // id: could be 'id', 'agent_id', 'agentId'
  const id = (raw.id ?? raw.agent_id ?? raw.agentId) as string | undefined;
  if (!id) return null;

  // name: could be 'name', 'display_name', 'displayName', or fallback to id
  const name = (raw.name ?? raw.display_name ?? raw.displayName ?? id) as string;

  // status: could be 'status', 'state', or derive from boolean 'running'
  let status: Agent["status"] = "idle";
  if (raw.status === "running" || raw.state === "running" || raw.running === true) {
    status = "running";
  } else if (raw.status === "error" || raw.state === "error") {
    status = "error";
  }

  return {
    id,
    name,
    status,
    avatar: raw.avatar as string | undefined,
    description: (raw.description ?? raw.desc) as string | undefined,
  };
}

/**
 * Extract an array of agent-like objects from the server response.
 */
function extractAgents(res: unknown): Agent[] {
  // Direct array
  if (Array.isArray(res)) {
    return res.map((r) => normalizeAgent(r as Record<string, unknown>)).filter(Boolean) as Agent[];
  }

  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>;

    // Nested in a known key
    for (const key of ["agents", "items", "data", "list", "result"]) {
      if (key in obj && Array.isArray(obj[key])) {
        return (obj[key] as Record<string, unknown>[])
          .map(normalizeAgent)
          .filter(Boolean) as Agent[];
      }
    }

    // Maybe the response IS a single agent object (has an id field)
    if ("id" in obj || "agent_id" in obj || "agentId" in obj) {
      const agent = normalizeAgent(obj);
      return agent ? [agent] : [];
    }
  }

  return [];
}

/**
 * Fetch and cache the agent list.
 * Only enabled when Gateway is connected.
 */
export function useAgents() {
  const isConnected = useConnectionStore((s) => s.state === "connected");

  return useQuery<Agent[]>({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: async () => {
      const res = await gateway.request<unknown>("agents.list");
      console.log("[useAgents] Raw response:", JSON.stringify(res));

      const agents = extractAgents(res);
      console.log("[useAgents] Parsed agents:", agents);

      return agents;
    },
    enabled: isConnected,
    staleTime: 60_000,
  });
}
