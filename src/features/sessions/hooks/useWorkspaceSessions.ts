import { useQuery } from "@tanstack/react-query";
import { useConnectionStore } from "@/features/connection/store";
import { gateway } from "@/lib/gateway";
import { normalizeSessionsSnapshot, type SessionsListSnapshot } from "../types";

interface UseWorkspaceSessionsParams {
  activeMinutes: string;
  limit: string;
  includeGlobal: boolean;
  includeUnknown: boolean;
}

export function useWorkspaceSessions(params: UseWorkspaceSessionsParams) {
  const isConnected = useConnectionStore((state) => state.state === "connected");

  return useQuery<SessionsListSnapshot>({
    queryKey: [
      "workspace-sessions",
      params.activeMinutes,
      params.limit,
      params.includeGlobal,
      params.includeUnknown,
    ],
    enabled: isConnected,
    staleTime: 15_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const request: Record<string, unknown> = {
        includeGlobal: params.includeGlobal,
        includeUnknown: params.includeUnknown,
        includeDerivedTitles: true,
        includeLastMessage: true,
      };

      const parsedActiveMinutes = Number(params.activeMinutes);
      const parsedLimit = Number(params.limit);

      if (Number.isFinite(parsedActiveMinutes) && parsedActiveMinutes > 0) {
        request.activeMinutes = parsedActiveMinutes;
      }
      if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
        request.limit = parsedLimit;
      }

      const raw = await gateway.request<unknown>("sessions.list", request);
      return normalizeSessionsSnapshot(raw);
    },
  });
}
