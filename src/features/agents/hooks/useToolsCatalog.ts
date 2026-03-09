import { useQuery } from "@tanstack/react-query";
import { useConnectionStore } from "@/features/connection/store";
import { gateway } from "@/lib/gateway";

export interface ToolCatalogProfile {
  id: string;
  label: string;
}

export interface ToolCatalogEntry {
  id: string;
  label: string;
  description: string;
  source: "core" | "plugin" | "unknown";
  pluginId?: string;
  optional: boolean;
  defaultProfiles: string[];
}

export interface ToolCatalogGroup {
  id: string;
  label: string;
  tools: ToolCatalogEntry[];
  source: "core" | "plugin" | "unknown";
  pluginId?: string;
}

export interface ToolsCatalogResult {
  agentId: string;
  profiles: ToolCatalogProfile[];
  groups: ToolCatalogGroup[];
}

function normalizeProfile(raw: unknown): ToolCatalogProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id : null;
  if (!id) return null;
  return {
    id,
    label: typeof obj.label === "string" ? obj.label : id,
  };
}

export const TOOLS_CATALOG_QUERY_KEY = ["tools-catalog"] as const;

function normalizeTool(raw: unknown): ToolCatalogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id : null;
  if (!id) return null;

  return {
    id,
    label: typeof obj.label === "string" ? obj.label : id,
    description: typeof obj.description === "string" ? obj.description : "",
    source:
      obj.source === "core" || obj.source === "plugin"
        ? obj.source
        : "unknown",
    pluginId: typeof obj.pluginId === "string" ? obj.pluginId : undefined,
    optional: obj.optional === true,
    defaultProfiles: Array.isArray(obj.defaultProfiles)
      ? obj.defaultProfiles.filter((profile): profile is string => typeof profile === "string")
      : [],
  };
}

function normalizeGroup(raw: unknown): ToolCatalogGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id : null;
  if (!id) return null;
  const rawTools = Array.isArray(obj.tools) ? obj.tools : [];
  return {
    id,
    label: typeof obj.label === "string" ? obj.label : id,
    tools: rawTools.map((tool) => normalizeTool(tool)).filter(Boolean) as ToolCatalogEntry[],
    source:
      obj.source === "core" || obj.source === "plugin"
        ? obj.source
        : "unknown",
    pluginId: typeof obj.pluginId === "string" ? obj.pluginId : undefined,
  };
}

function normalizeCatalog(raw: unknown, agentId: string): ToolsCatalogResult {
  if (!raw || typeof raw !== "object") {
    return { agentId, profiles: [], groups: [] };
  }
  const obj = raw as Record<string, unknown>;
  const profiles = Array.isArray(obj.profiles)
    ? obj.profiles.map((profile) => normalizeProfile(profile)).filter(Boolean) as ToolCatalogProfile[]
    : [];
  const groups = Array.isArray(obj.groups)
    ? obj.groups.map((group) => normalizeGroup(group)).filter(Boolean) as ToolCatalogGroup[]
    : [];
  return {
    agentId:
      typeof obj.agentId === "string" && obj.agentId.trim().length > 0
        ? obj.agentId
        : agentId,
    profiles,
    groups,
  };
}

export function useToolsCatalog(agentId: string | null) {
  const isConnected = useConnectionStore((state) => state.state === "connected");

  return useQuery<ToolsCatalogResult>({
    queryKey: agentId ? [...TOOLS_CATALOG_QUERY_KEY, agentId] : TOOLS_CATALOG_QUERY_KEY,
    enabled: isConnected && Boolean(agentId),
    staleTime: 60_000,
    queryFn: async () => {
      if (!agentId) {
        return { agentId: "", profiles: [], groups: [] };
      }
      const result = await gateway.request<unknown>("tools.catalog", {
        agentId,
        includePlugins: true,
      });
      return normalizeCatalog(result, agentId);
    },
  });
}
