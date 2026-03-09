// Hook: useAgents — fetches agent list from Gateway via TanStack Query

import { useQuery } from "@tanstack/react-query";
import { gateway } from "@/lib/gateway";
import type { Agent, AgentCapabilities } from "@/lib/gateway";
import { useConnectionStore } from "@/features/connection/store";

/** Query key for agent list */
export const AGENTS_QUERY_KEY = ["agents"] as const;

export interface AgentDirectoryResult {
  agents: Agent[];
  defaultId: string | null;
}

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

  const identityRaw =
    raw.identity && typeof raw.identity === "object"
      ? (raw.identity as Record<string, unknown>)
      : null;

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
    identity: identityRaw
      ? {
          name: typeof identityRaw.name === "string" ? identityRaw.name : undefined,
          avatar: typeof identityRaw.avatar === "string" ? identityRaw.avatar : undefined,
          emoji: typeof identityRaw.emoji === "string" ? identityRaw.emoji : undefined,
        }
      : undefined,
    description: (raw.description ?? raw.desc) as string | undefined,
    capabilities:
      raw.capabilities && typeof raw.capabilities === "object"
        ? {
            commandExecution:
              (raw.capabilities as Record<string, unknown>).commandExecution === "off" ||
              (raw.capabilities as Record<string, unknown>).commandExecution === "ask" ||
              (raw.capabilities as Record<string, unknown>).commandExecution === "auto"
                ? (raw.capabilities as Record<string, unknown>).commandExecution as AgentCapabilities["commandExecution"]
                : "off",
            webAccess: (raw.capabilities as Record<string, unknown>).webAccess === true,
            fileTools: (raw.capabilities as Record<string, unknown>).fileTools === true,
          }
        : undefined,
  };
}

function extractAgents(res: unknown): AgentDirectoryResult {
  if (Array.isArray(res)) {
    return {
      agents: res.map((r) => normalizeAgent(r as Record<string, unknown>)).filter(Boolean) as Agent[],
      defaultId: null,
    };
  }

  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>;
    const defaultIdCandidates = [obj.defaultId, obj.default_id, obj.defaultAgentId];
    const defaultId =
      defaultIdCandidates.find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? null;

    for (const key of ["agents", "items", "data", "list", "result"]) {
      if (key in obj && Array.isArray(obj[key])) {
        return {
          agents: (obj[key] as Record<string, unknown>[])
            .map(normalizeAgent)
            .filter(Boolean) as Agent[],
          defaultId,
        };
      }
    }

    if ("id" in obj || "agent_id" in obj || "agentId" in obj) {
      const agent = normalizeAgent(obj);
      return {
        agents: agent ? [agent] : [],
        defaultId,
      };
    }
  }

  return { agents: [], defaultId: null };
}

async function fetchAgentsDirectory() {
  return extractAgents(await gateway.request<unknown>("agents.list"));
}

export function useAgentsDirectory() {
  const isConnected = useConnectionStore((s) => s.state === "connected");

  return useQuery<AgentDirectoryResult>({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: fetchAgentsDirectory,
    enabled: isConnected,
    staleTime: 60_000,
  });
}

/**
 * Fetch and cache the agent list.
 * Only enabled when Gateway is connected.
 */
export function useAgents() {
  const isConnected = useConnectionStore((s) => s.state === "connected");

  return useQuery<AgentDirectoryResult, Error, Agent[]>({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: fetchAgentsDirectory,
    select: (result) => result.agents,
    enabled: isConnected,
    staleTime: 60_000,
  });
}
