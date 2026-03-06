// Hook: useModels — fetches available models from Gateway

import { useQuery } from "@tanstack/react-query";
import { gateway } from "@/lib/gateway";
import { useConnectionStore } from "@/features/connection/store";

export interface ChatModelOption {
  id: string;
  label: string;
  provider?: string;
}

export const MODELS_QUERY_KEY = ["models"] as const;

type ModelsListParamMode = "unknown" | "agentId" | "plain";
let modelsListParamMode: ModelsListParamMode = "unknown";

function isParamShapeError(error: unknown): boolean {
  const msg = String(error);
  return (
    msg.includes("invalid") ||
    msg.includes("required property") ||
    msg.includes("unexpected property")
  );
}

function normalizeModel(raw: unknown): ChatModelOption | null {
  if (typeof raw === "string") {
    const id = raw.trim();
    if (!id) return null;
    return { id, label: id };
  }

  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = (obj.id ?? obj.model ?? obj.modelId ?? obj.model_id ?? obj.name) as
    | string
    | undefined;
  if (!id || !id.trim()) return null;

  const label = (obj.label ?? obj.displayName ?? obj.display_name ?? obj.name ?? id) as string;
  const provider = (obj.provider ?? obj.vendor ?? obj.source) as string | undefined;
  const key = provider && !id.includes("/") ? `${provider}/${id}` : id.trim();

  return { id: key, label: String(label), provider };
}

function extractModels(res: unknown): ChatModelOption[] {
  const toList = (items: unknown[]): ChatModelOption[] =>
    items
      .map((item) => normalizeModel(item))
      .filter(Boolean) as ChatModelOption[];

  if (Array.isArray(res)) {
    return toList(res);
  }

  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>;
    for (const key of ["models", "items", "data", "list", "result"]) {
      if (Array.isArray(obj[key])) {
        return toList(obj[key] as unknown[]);
      }
    }
  }

  return [];
}

export function useModels(agentId: string | null) {
  const isConnected = useConnectionStore((s) => s.state === "connected");

  return useQuery<ChatModelOption[]>({
    queryKey: agentId ? [...MODELS_QUERY_KEY, agentId] : MODELS_QUERY_KEY,
    queryFn: async () => {
      // Auto-detect whether this gateway supports `models.list({ agentId })`.
      if (agentId && modelsListParamMode !== "plain") {
        try {
          const scoped = await gateway.request<unknown>("models.list", { agentId });
          modelsListParamMode = "agentId";
          return extractModels(scoped);
        } catch (err) {
          if (!isParamShapeError(err)) {
            throw err;
          }
          modelsListParamMode = "plain";
        }
      }

      const res = await gateway.request<unknown>("models.list");
      return extractModels(res);
    },
    enabled: isConnected,
    staleTime: 60_000,
  });
}
