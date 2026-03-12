import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bot,
  FileCode2,
  FolderPlus,
  KeyRound,
  PackagePlus,
  PencilLine,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, Card, StatusBadge } from "@/components/ui";
import { useToolsCatalog } from "@/features/agents/hooks/useToolsCatalog";
import { useModels } from "@/features/chat/hooks/useModels";
import { useAgentsDirectory } from "@/features/chat/hooks/useAgents";
import { useConnectionStore } from "@/features/connection/store";
import { useChatStore } from "@/features/chat/store";
import { isChineseLanguage, useAppPreferencesStore } from "@/features/preferences/store";
import { gateway } from "@/lib/gateway";
import type { Agent } from "@/lib/gateway";
import { formatRelativeTime, truncate } from "@/lib/utils";
import "./agents.css";

type AgentPanel = "overview" | "files" | "tools" | "skills";
type AgentSort = "default" | "name" | "id" | "status";
type AgentEditorMode = "create" | "edit" | null;

type AgentIdentityResult = {
  agentId: string;
  name: string;
  avatar: string;
  emoji?: string;
};

type AgentFileEntry = {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
  content?: string;
};

type AgentsFilesListResult = {
  agentId: string;
  workspace: string;
  files: AgentFileEntry[];
};

type SkillInstallOption = {
  id: string;
  kind: "brew" | "node" | "go" | "uv" | "download";
  label: string;
  bins: string[];
};

type SkillStatusEntry = {
  name: string;
  description: string;
  source: string;
  filePath: string;
  baseDir: string;
  skillKey: string;
  bundled?: boolean;
  primaryEnv?: string;
  homepage?: string;
  emoji?: string;
  always: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  eligible: boolean;
  requirements: {
    bins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  missing: {
    bins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  install: SkillInstallOption[];
};

type SkillStatusReport = {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: SkillStatusEntry[];
};

type SkillGroup = {
  id: string;
  label: string;
  skills: SkillStatusEntry[];
};

type SkillConfigEntry = {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
};

type AgentConfigEntry = {
  id: string;
  name?: string;
  workspace?: string;
  model?: unknown;
};

type GatewayConfigShape = {
  agents?: {
    defaults?: {
      workspace?: string;
      model?: unknown;
    };
    list?: AgentConfigEntry[];
  };
  skills?: {
    entries?: Record<string, SkillConfigEntry>;
  };
};

type ConfigSnapshotIssue = {
  path: string;
  message: string;
};

type ConfigSnapshot = {
  path: string | null;
  exists: boolean | null;
  raw: string | null;
  hash: string | null;
  valid: boolean | null;
  config: Record<string, unknown> | null;
  issues: ConfigSnapshotIssue[];
};

type AgentFormState = {
  name: string;
  workspace: string;
  model: string;
  avatar: string;
  emoji: string;
};

type PageFeedback =
  | {
      kind: "success" | "error" | "info";
      message: string;
    }
  | null;

type SkillBusyState = {
  key: string;
  action: "toggle" | "install" | "apiKey" | "env";
} | null;

const PANELS: Array<{ id: AgentPanel; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "files", label: "Files" },
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
];

const SKILL_SOURCE_GROUPS: Array<{ id: string; label: string; sources: string[] }> = [
  { id: "workspace", label: "Workspace Skills", sources: ["openclaw-workspace"] },
  { id: "built-in", label: "Built-in Skills", sources: ["openclaw-bundled"] },
  { id: "installed", label: "Installed Skills", sources: ["openclaw-managed"] },
  { id: "extra", label: "Extra Skills", sources: ["openclaw-extra"] },
];

const STATUS_ORDER: Record<Agent["status"], number> = {
  running: 0,
  idle: 1,
  error: 2,
};

function normalizeSkillReport(raw: unknown): SkillStatusReport {
  const payload = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const skills = Array.isArray(payload.skills)
    ? payload.skills.filter(
        (entry): entry is SkillStatusEntry =>
          Boolean(entry && typeof entry === "object" && typeof (entry as SkillStatusEntry).skillKey === "string"),
      )
    : [];

  return {
    workspaceDir: typeof payload.workspaceDir === "string" ? payload.workspaceDir : "",
    managedSkillsDir: typeof payload.managedSkillsDir === "string" ? payload.managedSkillsDir : "",
    skills,
  };
}

function normalizeConfigSnapshot(raw: unknown): ConfigSnapshot {
  if (!raw || typeof raw !== "object") {
    return { path: null, exists: null, raw: null, hash: null, valid: null, config: null, issues: [] };
  }
  const obj = raw as Record<string, unknown>;
  return {
    path: typeof obj.path === "string" ? obj.path : null,
    exists: typeof obj.exists === "boolean" ? obj.exists : null,
    raw: typeof obj.raw === "string" ? obj.raw : null,
    hash: typeof obj.hash === "string" ? obj.hash : null,
    valid: typeof obj.valid === "boolean" ? obj.valid : null,
    config: obj.config && typeof obj.config === "object" ? (obj.config as Record<string, unknown>) : null,
    issues: Array.isArray(obj.issues)
      ? obj.issues
          .filter((issue): issue is Record<string, unknown> => Boolean(issue && typeof issue === "object"))
          .map((issue) => ({
            path: typeof issue.path === "string" ? issue.path : "(unknown)",
            message: typeof issue.message === "string" ? issue.message : JSON.stringify(issue),
          }))
      : [],
  };
}

function normalizeIdentity(raw: unknown, agentId: string): AgentIdentityResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  return {
    agentId: typeof obj.agentId === "string" ? obj.agentId : agentId,
    name: typeof obj.name === "string" ? obj.name : agentId,
    avatar: typeof obj.avatar === "string" ? obj.avatar : "",
    emoji: typeof obj.emoji === "string" ? obj.emoji : undefined,
  };
}

function normalizeFileEntry(raw: unknown): AgentFileEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name : null;
  const path = typeof obj.path === "string" ? obj.path : null;
  if (!name || !path) return null;
  return {
    name,
    path,
    missing: obj.missing === true,
    size: typeof obj.size === "number" ? obj.size : undefined,
    updatedAtMs: typeof obj.updatedAtMs === "number" ? obj.updatedAtMs : undefined,
    content: typeof obj.content === "string" ? obj.content : undefined,
  };
}

function normalizeFilesList(raw: unknown, agentId: string): AgentsFilesListResult {
  if (!raw || typeof raw !== "object") {
    return { agentId, workspace: "", files: [] };
  }
  const obj = raw as Record<string, unknown>;
  return {
    agentId:
      typeof obj.agentId === "string" && obj.agentId.trim().length > 0
        ? obj.agentId
        : agentId,
    workspace: typeof obj.workspace === "string" ? obj.workspace : "",
    files: Array.isArray(obj.files)
      ? (obj.files.map((file) => normalizeFileEntry(file)).filter(Boolean) as AgentFileEntry[])
      : [],
  };
}

function normalizeFileContent(raw: unknown): AgentFileEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.file && typeof obj.file === "object") {
    return normalizeFileEntry(obj.file);
  }
  return normalizeFileEntry(raw);
}

function capabilityPills(capabilities: unknown): string[] {
  if (!capabilities || typeof capabilities !== "object") return [];
  const obj = capabilities as Record<string, unknown>;
  const pills: string[] = [];
  if (typeof obj.commandExecution === "string") pills.push(`exec:${obj.commandExecution}`);
  if (obj.webAccess === true) pills.push("web");
  if (obj.fileTools === true) pills.push("files");
  return pills;
}

function isLikelyEmoji(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  if (trimmed.length > 16) return false;
  let hasNonAscii = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed.charCodeAt(index) > 127) {
      hasNonAscii = true;
      break;
    }
  }
  if (!hasNonAscii) return false;
  if (trimmed.includes("://") || trimmed.includes("/") || trimmed.includes(".")) return false;
  return true;
}

function resolveAgentDisplayName(agent: Agent, identity?: AgentIdentityResult | null) {
  return identity?.name?.trim() || agent.identity?.name?.trim() || agent.name?.trim() || agent.id;
}

function resolveAgentEmoji(agent: Agent, identity?: AgentIdentityResult | null) {
  const candidates = [
    identity?.emoji,
    agent.identity?.emoji,
    identity?.avatar,
    agent.identity?.avatar,
    agent.avatar,
  ];
  return candidates.find((candidate) => isLikelyEmoji(candidate)) ?? "";
}

function resolveAgentAvatar(agent: Agent, identity?: AgentIdentityResult | null) {
  const emoji = resolveAgentEmoji(agent, identity);
  if (emoji) return emoji;
  return resolveAgentDisplayName(agent, identity).slice(0, 1).toUpperCase();
}

function countTools(groups?: Array<{ tools: Array<unknown> }>) {
  return (groups ?? []).reduce((sum, group) => sum + group.tools.length, 0);
}

function formatBytes(bytes?: number) {
  if (bytes == null || !Number.isFinite(bytes)) {
    return "-";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function groupSkills(skills: SkillStatusEntry[]) {
  const groups = new Map<string, SkillGroup>();
  for (const def of SKILL_SOURCE_GROUPS) {
    groups.set(def.id, { id: def.id, label: def.label, skills: [] });
  }
  const other: SkillGroup = { id: "other", label: "Other Skills", skills: [] };
  for (const skill of skills) {
    const match = skill.bundled
      ? SKILL_SOURCE_GROUPS.find((group) => group.id === "built-in")
      : SKILL_SOURCE_GROUPS.find((group) => group.sources.includes(skill.source));
    if (match) {
      groups.get(match.id)?.skills.push(skill);
    } else {
      other.skills.push(skill);
    }
  }
  const ordered = SKILL_SOURCE_GROUPS.map((group) => groups.get(group.id)).filter(
    (group): group is SkillGroup => Boolean(group && group.skills.length > 0),
  );
  if (other.skills.length > 0) {
    ordered.push(other);
  }
  return ordered;
}

function computeSkillMissing(skill: SkillStatusEntry) {
  return [
    ...skill.missing.bins.map((item) => `bin:${item}`),
    ...skill.missing.env.map((item) => `env:${item}`),
    ...skill.missing.config.map((item) => `config:${item}`),
    ...skill.missing.os.map((item) => `os:${item}`),
  ];
}

function computeSkillReasons(skill: SkillStatusEntry) {
  const reasons: string[] = [];
  if (skill.disabled) reasons.push("disabled");
  if (skill.blockedByAllowlist) reasons.push("blocked by allowlist");
  if (skill.always) reasons.push("always on");
  return reasons;
}

function resolveConfigShape(config: Record<string, unknown> | null): GatewayConfigShape {
  return (config as GatewayConfigShape | null) ?? {};
}

function resolveAgentConfig(config: Record<string, unknown> | null, agentId: string | null) {
  const cfg = resolveConfigShape(config);
  const list = Array.isArray(cfg.agents?.list) ? cfg.agents?.list : [];
  return {
    entry: agentId ? list.find((agent) => agent?.id === agentId) ?? null : null,
    defaults: cfg.agents?.defaults,
  };
}

function resolveSkillConfig(config: Record<string, unknown> | null, skillKey: string) {
  const cfg = resolveConfigShape(config);
  const entries = cfg.skills?.entries ?? {};
  return entries[skillKey] ?? null;
}

function resolveModelLabel(model?: unknown): string {
  if (!model) {
    return "-";
  }
  if (typeof model === "string") {
    return model.trim() || "-";
  }
  if (typeof model === "object" && model) {
    const record = model as { primary?: string; fallbacks?: string[] };
    const primary = record.primary?.trim();
    if (primary) {
      const fallbackCount = Array.isArray(record.fallbacks) ? record.fallbacks.length : 0;
      return fallbackCount > 0 ? `${primary} (+${fallbackCount} fallback)` : primary;
    }
  }
  return "-";
}

function resolveModelPrimary(model?: unknown): string | null {
  if (!model) {
    return null;
  }
  if (typeof model === "string") {
    const trimmed = model.trim();
    return trimmed || null;
  }
  if (typeof model === "object" && model) {
    const record = model as Record<string, unknown>;
    const candidate =
      typeof record.primary === "string"
        ? record.primary
        : typeof record.model === "string"
          ? record.model
          : typeof record.id === "string"
            ? record.id
            : typeof record.value === "string"
              ? record.value
              : null;
    const primary = candidate?.trim();
    return primary || null;
  }
  return null;
}

function uniqueStrings(items: Array<string | null | undefined>) {
  return [...new Set(items.map((item) => item?.trim() ?? "").filter((item) => item.length > 0))];
}

function matchesAgentQuery(agent: Agent, identity: AgentIdentityResult | null | undefined, query: string) {
  if (!query) return true;
  const haystack = [
    agent.id,
    agent.name,
    agent.description,
    agent.status,
    agent.identity?.name,
    agent.identity?.emoji,
    identity?.name,
    identity?.emoji,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function sortAgents(agents: Agent[], sort: AgentSort, defaultId: string | null) {
  const next = [...agents];
  next.sort((left, right) => {
    if (sort === "default") {
      if (left.id === defaultId && right.id !== defaultId) return -1;
      if (right.id === defaultId && left.id !== defaultId) return 1;
      return resolveAgentDisplayName(left).localeCompare(resolveAgentDisplayName(right));
    }
    if (sort === "name") {
      return resolveAgentDisplayName(left).localeCompare(resolveAgentDisplayName(right));
    }
    if (sort === "status") {
      const statusDiff = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
      return statusDiff !== 0 ? statusDiff : left.id.localeCompare(right.id);
    }
    return left.id.localeCompare(right.id);
  });
  return next;
}

function buildAgentFormSeed(params: {
  agent?: Agent | null;
  identity?: AgentIdentityResult | null;
  config?: Record<string, unknown> | null;
  files?: AgentsFilesListResult | null;
}) {
  const agentId = params.agent?.id ?? null;
  const resolvedConfig = resolveAgentConfig(params.config ?? null, agentId);
  return {
    name: params.agent ? resolveAgentDisplayName(params.agent, params.identity) : "",
    workspace:
      params.files?.workspace ||
      resolvedConfig.entry?.workspace ||
      resolvedConfig.defaults?.workspace ||
      "",
    model:
      resolveModelPrimary(resolvedConfig.entry?.model) ??
      resolveModelPrimary(resolvedConfig.defaults?.model) ??
      "",
    avatar:
      params.identity?.avatar?.trim() ||
      params.agent?.identity?.avatar?.trim() ||
      params.agent?.avatar?.trim() ||
      "",
    emoji: params.identity?.emoji?.trim() || params.agent?.identity?.emoji?.trim() || "",
  } satisfies AgentFormState;
}

function emptyAgentForm(defaultWorkspace: string) {
  return {
    name: "",
    workspace: defaultWorkspace,
    model: "",
    avatar: "",
    emoji: "",
  } satisfies AgentFormState;
}

export function AgentsPage() {
  const language = useAppPreferencesStore((store) => store.language);
  const isChinese = isChineseLanguage(language);
  const pageCopy = isChinese
    ? {
        title: "智能体",
        emptySubtitle: "先连接网关，再查看、创建、编辑和管理智能体。",
        eyebrow: "控制台",
        subtitle: "官方风格的智能体工作区，包含列表管理、配置编辑、文件、工具和技能面板。",
        refresh: "刷新",
        newAgent: "新建智能体",
        openChat: "打开聊天",
        sortAgents: "智能体排序",
        defaultFirst: "默认优先",
        name: "名称",
        id: "ID",
        status: "状态",
        loadingAgents: "正在加载智能体…",
        noAgentsMatched: "没有智能体匹配当前筛选条件。",
        noAgentsReturned: "网关没有返回任何智能体。",
        workspacePending: "工作区待加载",
        defaultTag: "默认",
        createAgent: "创建智能体",
        createAgentDetail: "通过 `agents.create` 添加新条目，然后可选地应用模型覆盖。",
        workspace: "工作区",
        model: "模型",
        avatar: "头像",
        emoji: "表情",
        createAgentButton: "创建智能体",
        cancel: "取消",
        noAgentSelected: "未选择智能体",
        noAgentSelectedHint: "创建一个新智能体，或从侧栏选择一个来查看文件、工具和技能。",
        overviewTab: "概览",
        filesTab: "文件",
        toolsTab: "工具",
        skillsTab: "技能",
        configIssues: (count: number) => `当前网关配置存在校验问题${count > 0 ? `（${count}）` : ""}，修复前智能体编辑能力可能受限。`,
        configuredFromList: (count: number) => `来自 \`agents.list\` 的 ${count} 个配置项。`,
        shownCount: (count: number) => `显示 ${count} 个`,
        filterPlaceholder: "按 ID、名称、描述筛选",
        createAgentHint: "通过官方工作区流程创建新智能体。名称和工作区为必填项。",
        createNamePlaceholder: "研究助理",
        createWorkspacePlaceholder: "~/openclaw/agents/research",
        createModelPlaceholder: "openai/gpt-5",
        createAvatarPlaceholder: "🤖 或头像标签",
        createEmojiPlaceholder: "🧠",
        createFormHint: "`agents.create` 支持 `name`、`workspace`、`emoji` 和 `avatar`。如果这里填写模型，页面会追加一次 `agents.update` 调用来应用它。",
        editAgent: "编辑智能体",
        agentConfig: "智能体配置",
        updateAgentDetail: "通过 `agents.update` 更新当前智能体。",
        agentConfigDetail: "与网关配置对齐的名称、工作区、模型和头像。",
        statusPolicy: "状态与策略",
        statusPolicyDetail: "网关上报的运行状态、默认值和能力元数据。",
        filesSnapshot: "文件快照",
        filesSnapshotDetail: "不离开当前页面即可浏览和编辑核心工作区文件。",
        skillsSnapshot: "技能快照",
        skillsSnapshotDetail: "当前智能体的技能资格、安装提示和配置就绪情况。",
        coreFiles: "核心文件",
        toolCatalog: "工具目录",
        toolCatalogDetail: "按官方 WebUI 结构分组的运行时工具目录。",
        agentSkills: "智能体技能",
        install: "安装",
        enable: "启用",
        disable: "停用",
        saveKey: "保存 Key",
        saveEnvOverrides: "保存环境变量覆盖",
        noCapabilities: "未上报能力元数据。",
        noDescription: "网关没有为该智能体返回显式描述。可在下方配置区更新显示名称、工作区、模型和头像。",
      }
    : {
        title: "Agents",
        emptySubtitle: "Connect a gateway to inspect, create, edit, and manage agents.",
        eyebrow: "Control Surface",
        subtitle: "Official-style agent workspace with list management, config editing, files, tools, and skills panels.",
        refresh: "Refresh",
        newAgent: "New Agent",
        openChat: "Open Chat",
        sortAgents: "Sort agents",
        defaultFirst: "Default first",
        name: "Name",
        id: "ID",
        status: "Status",
        loadingAgents: "Loading agents…",
        noAgentsMatched: "No agents matched the current filter.",
        noAgentsReturned: "No agents were returned from `agents.list`.",
        workspacePending: "workspace pending",
        defaultTag: "default",
        createAgent: "Create Agent",
        createAgentDetail: "Add a new entry through `agents.create`, then optionally apply model overrides.",
        workspace: "Workspace",
        model: "Model",
        avatar: "Avatar",
        emoji: "Emoji",
        createAgentButton: "Create Agent",
        cancel: "Cancel",
        noAgentSelected: "No agent selected",
        noAgentSelectedHint: "Create a new agent or choose one from the sidebar to inspect files, tools, and skills.",
        overviewTab: "Overview",
        filesTab: "Files",
        toolsTab: "Tools",
        skillsTab: "Skills",
        configIssues: (count: number) => `Gateway config currently reports validation issues${count > 0 ? ` (${count})` : ""}. Agent edits may be partially constrained until the config is fixed.`,
        configuredFromList: (count: number) => `${count} configured from \`agents.list\`.`,
        shownCount: (count: number) => `${count} shown`,
        filterPlaceholder: "Filter by id, name, description",
        createAgentHint: "Create a new agent from the official workspace flow. Name and workspace are required.",
        createNamePlaceholder: "Research Assistant",
        createWorkspacePlaceholder: "~/openclaw/agents/research",
        createModelPlaceholder: "openai/gpt-5",
        createAvatarPlaceholder: "🤖 or avatar label",
        createEmojiPlaceholder: "🧠",
        createFormHint: "`agents.create` supports `name`, `workspace`, `emoji`, and `avatar`. If a model is supplied here, the page applies it in a second `agents.update` call.",
        editAgent: "Edit Agent",
        agentConfig: "Agent Config",
        updateAgentDetail: "Update this agent through `agents.update`.",
        agentConfigDetail: "Name, workspace, model, and avatar aligned with the gateway config.",
        statusPolicy: "Status & Policy",
        statusPolicyDetail: "Gateway-reported runtime status, defaults, and capability metadata.",
        filesSnapshot: "Files Snapshot",
        filesSnapshotDetail: "Browse and edit core workspace files without leaving the page.",
        skillsSnapshot: "Skills Snapshot",
        skillsSnapshotDetail: "Agent-scoped skill eligibility, install hints, and configuration readiness.",
        coreFiles: "Core Files",
        toolCatalog: "Tool Catalog",
        toolCatalogDetail: "Runtime tool catalog grouped to match the official WebUI structure.",
        agentSkills: "Agent Skills",
        install: "Install",
        enable: "Enable",
        disable: "Disable",
        saveKey: "Save Key",
        saveEnvOverrides: "Save Env Overrides",
        noCapabilities: "No capabilities metadata reported.",
        noDescription: "No explicit description reported by the gateway for this agent. Use the config panel below to update its display name, workspace, model, and avatar.",
      };
  const navigate = useNavigate();
  const isConnected = useConnectionStore((state) => state.state === "connected");
  const selectedAgentId = useChatStore((state) => state.selectedAgentId);
  const selectAgent = useChatStore((state) => state.selectAgent);
  const selectSession = useChatStore((state) => state.selectSession);
  const setSelectedModel = useChatStore((state) => state.setSelectedModel);

  const [panel, setPanel] = useState<AgentPanel>("overview");
  const [editorMode, setEditorMode] = useState<AgentEditorMode>(null);
  const [listFilter, setListFilter] = useState("");
  const [sortBy, setSortBy] = useState<AgentSort>("default");
  const [toolFilter, setToolFilter] = useState("");
  const [skillFilter, setSkillFilter] = useState("");
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [fileDrafts, setFileDrafts] = useState<Record<string, string>>({});
  const [skillApiKeyDrafts, setSkillApiKeyDrafts] = useState<Record<string, string>>({});
  const [skillEnvDrafts, setSkillEnvDrafts] = useState<Record<string, Record<string, string>>>({});
  const [agentForm, setAgentForm] = useState<AgentFormState>(emptyAgentForm(""));
  const [agentFormSeed, setAgentFormSeed] = useState<AgentFormState>(emptyAgentForm(""));
  const [busyFileName, setBusyFileName] = useState<string | null>(null);
  const [busySkill, setBusySkill] = useState<SkillBusyState>(null);
  const [savingAgent, setSavingAgent] = useState(false);
  const [feedback, setFeedback] = useState<PageFeedback>(null);

  const deferredListFilter = useDeferredValue(listFilter.trim().toLowerCase());
  const deferredToolFilter = useDeferredValue(toolFilter.trim().toLowerCase());
  const deferredSkillFilter = useDeferredValue(skillFilter.trim().toLowerCase());

  const agentsQuery = useAgentsDirectory();
  const agents = agentsQuery.data?.agents ?? [];
  const defaultId = agentsQuery.data?.defaultId ?? null;

  useEffect(() => {
    if (!agents.length) {
      if (selectedAgentId) {
        selectAgent(null);
      }
      return;
    }
    const hasSelected = selectedAgentId ? agents.some((agent) => agent.id === selectedAgentId) : false;
    if (!hasSelected) {
      selectAgent(defaultId ?? agents[0]?.id ?? null);
    }
  }, [agents, defaultId, selectAgent, selectedAgentId]);

  const activeAgent = useMemo(
    () =>
      agents.find((agent) => agent.id === selectedAgentId) ??
      agents.find((agent) => agent.id === defaultId) ??
      agents[0] ??
      null,
    [agents, defaultId, selectedAgentId],
  );

  const configQuery = useQuery<ConfigSnapshot>({
    queryKey: ["gateway-config", "agents-page"],
    enabled: isConnected,
    staleTime: 15_000,
    queryFn: async () => normalizeConfigSnapshot(await gateway.request<unknown>("config.get")),
  });

  const identityQuery = useQuery<AgentIdentityResult | null>({
    queryKey: activeAgent ? ["agent-identity", activeAgent.id] : ["agent-identity"],
    enabled: isConnected && Boolean(activeAgent),
    staleTime: 60_000,
    queryFn: async () => {
      if (!activeAgent) return null;
      return normalizeIdentity(
        await gateway.request<unknown>("agent.identity.get", { agentId: activeAgent.id }),
        activeAgent.id,
      );
    },
  });

  const modelsQuery = useModels(activeAgent?.id ?? null);
  const toolsQuery = useToolsCatalog(activeAgent?.id ?? null);

  const skillsQuery = useQuery<SkillStatusReport>({
    queryKey: activeAgent ? ["agent-skills", activeAgent.id] : ["agent-skills"],
    enabled: isConnected && Boolean(activeAgent),
    staleTime: 15_000,
    queryFn: async () => {
      if (!activeAgent) {
        return { workspaceDir: "", managedSkillsDir: "", skills: [] };
      }
      return normalizeSkillReport(await gateway.request<unknown>("skills.status", { agentId: activeAgent.id }));
    },
  });

  const filesListQuery = useQuery<AgentsFilesListResult>({
    queryKey: activeAgent ? ["agent-files-list", activeAgent.id] : ["agent-files-list"],
    enabled: isConnected && Boolean(activeAgent) && (panel === "overview" || panel === "files" || editorMode === "edit"),
    staleTime: 15_000,
    queryFn: async () => {
      if (!activeAgent) {
        return { agentId: "", workspace: "", files: [] };
      }
      return normalizeFilesList(
        await gateway.request<unknown>("agents.files.list", { agentId: activeAgent.id }),
        activeAgent.id,
      );
    },
  });

  useEffect(() => {
    const files = filesListQuery.data?.files ?? [];
    if (!files.length) {
      setActiveFileName(null);
      return;
    }
    if (!activeFileName || !files.some((file) => file.name === activeFileName)) {
      setActiveFileName(files[0]?.name ?? null);
    }
  }, [activeFileName, filesListQuery.data]);

  const activeFileQuery = useQuery<AgentFileEntry | null>({
    queryKey:
      activeAgent && activeFileName
        ? ["agent-file", activeAgent.id, activeFileName]
        : ["agent-file"],
    enabled: isConnected && Boolean(activeAgent) && Boolean(activeFileName) && panel === "files",
    staleTime: 0,
    queryFn: async () => {
      if (!activeAgent || !activeFileName) return null;
      return normalizeFileContent(
        await gateway.request<unknown>("agents.files.get", {
          agentId: activeAgent.id,
          name: activeFileName,
        }),
      );
    },
  });

  useEffect(() => {
    const activeFileData = activeFileQuery.data;
    if (!activeFileName || !activeFileData) return;
    setFileDrafts((current) => {
      if (Object.prototype.hasOwnProperty.call(current, activeFileName)) {
        return current;
      }
      return { ...current, [activeFileName]: activeFileData.content ?? "" };
    });
  }, [activeFileName, activeFileQuery.data]);

  useEffect(() => {
    setFeedback(null);
  }, [activeAgent?.id, panel]);

  const configShape = configQuery.data?.config ?? null;
  const activeIdentity = identityQuery.data;
  const activeAgentConfig = useMemo(
    () => resolveAgentConfig(configShape, activeAgent?.id ?? null),
    [configShape, activeAgent?.id],
  );

  const defaultWorkspace = activeAgentConfig.defaults?.workspace ?? "";

  const visibleAgents = useMemo(() => {
    const filtered = agents.filter((agent) => matchesAgentQuery(agent, agent.id === activeAgent?.id ? activeIdentity : null, deferredListFilter));
    return sortAgents(filtered, sortBy, defaultId);
  }, [agents, activeAgent?.id, activeIdentity, defaultId, deferredListFilter, sortBy]);

  const capabilityTags = capabilityPills(activeAgent?.capabilities);
  const toolsCount = countTools(toolsQuery.data?.groups);
  const skillsCount = skillsQuery.data?.skills.length ?? 0;
  const eligibleSkillsCount = skillsQuery.data?.skills.filter((skill) => skill.eligible && !skill.disabled).length ?? 0;
  const blockedSkillsCount = Math.max(skillsCount - eligibleSkillsCount, 0);
  const workspacePath =
    filesListQuery.data?.workspace ||
    activeAgentConfig.entry?.workspace ||
    skillsQuery.data?.workspaceDir ||
    activeAgentConfig.defaults?.workspace ||
    "Not loaded";
  const modelLabel = resolveModelLabel(activeAgentConfig.entry?.model ?? activeAgentConfig.defaults?.model);

  const filteredToolGroups = useMemo(() => {
    const groups = toolsQuery.data?.groups ?? [];
    if (!deferredToolFilter) return groups;
    return groups
      .map((group) => ({
        ...group,
        tools: group.tools.filter((tool) =>
          [tool.id, tool.label, tool.description, tool.pluginId, ...tool.defaultProfiles]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(deferredToolFilter),
        ),
      }))
      .filter((group) => group.tools.length > 0);
  }, [deferredToolFilter, toolsQuery.data]);

  const groupedSkills = useMemo(() => {
    const list = skillsQuery.data?.skills ?? [];
    const filtered = !deferredSkillFilter
      ? list
      : list.filter((skill) =>
          [skill.name, skill.description, skill.source, skill.skillKey].join(" ").toLowerCase().includes(deferredSkillFilter),
        );
    return groupSkills(filtered);
  }, [deferredSkillFilter, skillsQuery.data]);

  const activeFileEntry =
    (activeFileName ? filesListQuery.data?.files.find((file) => file.name === activeFileName) : null) ?? activeFileQuery.data;
  const activeFileDraft =
    (activeFileName ? fileDrafts[activeFileName] : undefined) ??
    activeFileQuery.data?.content ??
    "";
  const activeFileDirty = activeFileName
    ? activeFileDraft !== (activeFileQuery.data?.content ?? "")
    : false;

  const formDirty = JSON.stringify(agentForm) !== JSON.stringify(agentFormSeed);
  const canSubmitAgentForm =
    agentForm.name.trim().length > 0 &&
    agentForm.workspace.trim().length > 0 &&
    (editorMode === "create" || formDirty);

  const refreshCurrentView = async () => {
    setFeedback(null);
    const actions: Array<Promise<unknown>> = [agentsQuery.refetch(), configQuery.refetch()];
    if (activeAgent) {
      actions.push(identityQuery.refetch(), toolsQuery.refetch(), skillsQuery.refetch(), modelsQuery.refetch());
      if (panel === "overview" || panel === "files" || editorMode === "edit") {
        actions.push(filesListQuery.refetch());
      }
      if (panel === "files" && activeFileName) {
        actions.push(activeFileQuery.refetch());
      }
    }
    await Promise.all(actions);
  };

  const refreshFiles = async () => {
    setFeedback(null);
    await Promise.all([
      filesListQuery.refetch(),
      activeFileName ? activeFileQuery.refetch() : Promise.resolve(null),
    ]);
  };

  const activateAgent = (agentId: string) => {
    selectAgent(agentId);
    selectSession(null);
    setSelectedModel(null);
    setActiveFileName(null);
    setEditorMode(null);
    setFeedback(null);
  };

  const openCreate = () => {
    const nextForm = emptyAgentForm(defaultWorkspace);
    setAgentForm(nextForm);
    setAgentFormSeed(nextForm);
    setEditorMode("create");
    setPanel("overview");
      setFeedback({
        kind: "info",
        message: pageCopy.createAgentHint,
      });
  };

  const openEdit = () => {
    if (!activeAgent) return;
    const nextForm = buildAgentFormSeed({
      agent: activeAgent,
      identity: activeIdentity,
      config: configShape,
      files: filesListQuery.data ?? null,
    });
    setAgentForm(nextForm);
    setAgentFormSeed(nextForm);
    setEditorMode("edit");
    setPanel("overview");
    setFeedback(null);
  };

  const cancelEditing = () => {
    setEditorMode(null);
    setFeedback(null);
  };

  const saveAgentForm = async () => {
    if (!canSubmitAgentForm) return;
    setSavingAgent(true);
    setFeedback(null);

    try {
      if (editorMode === "create") {
        const createResult = await gateway.request<{ agentId: string }>("agents.create", {
          name: agentForm.name.trim(),
          workspace: agentForm.workspace.trim(),
          emoji: agentForm.emoji.trim() || undefined,
          avatar: agentForm.avatar.trim() || undefined,
        });

        const nextAgentId = createResult.agentId;
        if (agentForm.model.trim()) {
          await gateway.request("agents.update", {
            agentId: nextAgentId,
            model: agentForm.model.trim(),
          });
        }

        await Promise.all([agentsQuery.refetch(), configQuery.refetch()]);
        selectAgent(nextAgentId);
        selectSession(null);
        setSelectedModel(null);
        setEditorMode(null);
        setFeedback({ kind: "success", message: `Created agent ${nextAgentId}.` });
      } else if (editorMode === "edit" && activeAgent) {
        await gateway.request("agents.update", {
          agentId: activeAgent.id,
          name: agentForm.name.trim(),
          workspace: agentForm.workspace.trim(),
          model: agentForm.model.trim() || undefined,
          avatar: agentForm.avatar.trim(),
        });

        await Promise.all([
          agentsQuery.refetch(),
          configQuery.refetch(),
          identityQuery.refetch(),
          filesListQuery.refetch(),
        ]);

        setAgentFormSeed(agentForm);
        setEditorMode(null);
        setFeedback({ kind: "success", message: `Updated agent ${activeAgent.id}.` });
      }
    } catch (error) {
      setFeedback({ kind: "error", message: String(error) });
    } finally {
      setSavingAgent(false);
    }
  };

  const deleteAgent = async () => {
    if (!activeAgent) return;
    if (!window.confirm(`Delete agent "${activeAgent.id}"?`)) return;
    const deleteFiles = window.confirm(
      `Also move workspace, agent directory, and sessions for "${activeAgent.id}" to trash?\n\nOK = delete files, Cancel = keep files.`,
    );

    setFeedback(null);
    try {
      await gateway.request("agents.delete", { agentId: activeAgent.id, deleteFiles });
      await Promise.all([agentsQuery.refetch(), configQuery.refetch()]);
      selectSession(null);
      setSelectedModel(null);
      setEditorMode(null);
      setFeedback({
        kind: "success",
        message: deleteFiles
          ? `Deleted agent ${activeAgent.id} and removed related files.`
          : `Deleted agent ${activeAgent.id} but kept files on disk.`,
      });
    } catch (error) {
      setFeedback({ kind: "error", message: String(error) });
    }
  };

  const saveActiveFile = async () => {
    if (!activeAgent || !activeFileName) return;
    setBusyFileName(activeFileName);
    setFeedback(null);
    try {
      await gateway.request("agents.files.set", {
        agentId: activeAgent.id,
        name: activeFileName,
        content: activeFileDraft,
      });
      setFileDrafts((current) => ({ ...current, [activeFileName]: activeFileDraft }));
      await refreshFiles();
      setFeedback({ kind: "success", message: `Saved ${activeFileName}.` });
    } catch (error) {
      setFeedback({ kind: "error", message: String(error) });
    } finally {
      setBusyFileName(null);
    }
  };

  const updateSkillEnabled = async (skill: SkillStatusEntry, enabled: boolean) => {
    setBusySkill({ key: skill.skillKey, action: "toggle" });
    setFeedback(null);
    try {
      await gateway.request("skills.update", { skillKey: skill.skillKey, enabled });
      await Promise.all([skillsQuery.refetch(), configQuery.refetch()]);
      setFeedback({
        kind: "success",
        message: enabled ? `Enabled ${skill.skillKey}.` : `Disabled ${skill.skillKey}.`,
      });
    } catch (error) {
      setFeedback({ kind: "error", message: String(error) });
    } finally {
      setBusySkill(null);
    }
  };

  const installSkill = async (skill: SkillStatusEntry) => {
    const installTarget = skill.install[0];
    if (!installTarget) return;
    setBusySkill({ key: skill.skillKey, action: "install" });
    setFeedback(null);
    try {
      const result = await gateway.request<{ message?: string }>("skills.install", {
        name: skill.name,
        installId: installTarget.id,
        timeoutMs: 120_000,
      });
      await Promise.all([skillsQuery.refetch(), configQuery.refetch()]);
      setFeedback({
        kind: "success",
        message: result.message ?? `Installed requirements for ${skill.name}.`,
      });
    } catch (error) {
      setFeedback({ kind: "error", message: String(error) });
    } finally {
      setBusySkill(null);
    }
  };

  const saveSkillApiKey = async (skill: SkillStatusEntry, apiKey: string) => {
    setBusySkill({ key: skill.skillKey, action: "apiKey" });
    setFeedback(null);
    try {
      await gateway.request("skills.update", { skillKey: skill.skillKey, apiKey });
      await Promise.all([skillsQuery.refetch(), configQuery.refetch()]);
      setFeedback({
        kind: "success",
        message: apiKey.trim() ? `Saved API key for ${skill.skillKey}.` : `Cleared API key for ${skill.skillKey}.`,
      });
    } catch (error) {
      setFeedback({ kind: "error", message: String(error) });
    } finally {
      setBusySkill(null);
    }
  };

  const saveSkillEnv = async (skill: SkillStatusEntry, env: Record<string, string>) => {
    setBusySkill({ key: skill.skillKey, action: "env" });
    setFeedback(null);
    try {
      await gateway.request("skills.update", { skillKey: skill.skillKey, env });
      await Promise.all([skillsQuery.refetch(), configQuery.refetch()]);
      setFeedback({ kind: "success", message: `Saved environment overrides for ${skill.skillKey}.` });
    } catch (error) {
      setFeedback({ kind: "error", message: String(error) });
    } finally {
      setBusySkill(null);
    }
  };

  const openInChat = () => {
    if (!activeAgent) return;
    selectAgent(activeAgent.id);
    selectSession(null);
    navigate("/chat");
  };

  if (!isConnected) {
    return (
      <div className="workspace-empty-state agents-page agents-page--empty">
        <Bot size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">{pageCopy.title}</h2>
        <p className="workspace-subtitle">{pageCopy.emptySubtitle}</p>
      </div>
    );
  }

  return (
    <div className="workspace-page agents-page">
      <div className="workspace-toolbar agents-toolbar">
        <div>
          <div className="agents-page__eyebrow">{pageCopy.eyebrow}</div>
          <h2 className="workspace-title">{pageCopy.title}</h2>
          <p className="workspace-subtitle">
            {pageCopy.subtitle}
          </p>
        </div>
        <div className="workspace-toolbar__actions">
          <Button variant="secondary" onClick={refreshCurrentView} loading={agentsQuery.isFetching || configQuery.isFetching}>
            <RefreshCw size={14} />
            {pageCopy.refresh}
          </Button>
          <Button variant="secondary" onClick={openCreate}>
            <FolderPlus size={14} />
            {pageCopy.newAgent}
          </Button>
          <Button onClick={openInChat} disabled={!activeAgent || editorMode === "create"}>
            {pageCopy.openChat}
            <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {feedback && (
        <div className={`workspace-alert ${
          feedback.kind === "error"
            ? "workspace-alert--error"
            : "workspace-alert--info"
        }`}>
          {feedback.message}
        </div>
      )}

      {configQuery.data?.valid === false && (
        <div className="workspace-alert workspace-alert--error">
          {pageCopy.configIssues(configQuery.data.issues.length)}
        </div>
      )}

      <div className="agents-shell">
        <Card className="agents-sidebar" padding={false}>
          <div className="agents-sidebar__header">
            <div>
              <h3>{pageCopy.title}</h3>
              <p>{pageCopy.configuredFromList(agents.length)}</p>
            </div>
            <StatusBadge
              status={agentsQuery.error ? "error" : "connected"}
              label={agentsQuery.error ? "Error" : pageCopy.shownCount(visibleAgents.length)}
            />
          </div>

          <div className="agents-sidebar__controls">
            <label className="agents-search">
              <Search size={14} />
              <input
                value={listFilter}
                onChange={(event) => setListFilter(event.target.value)}
                placeholder={pageCopy.filterPlaceholder}
              />
            </label>
            <select
              className="agents-select"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as AgentSort)}
              aria-label={pageCopy.sortAgents}
            >
              <option value="default">{pageCopy.defaultFirst}</option>
              <option value="name">{pageCopy.name}</option>
              <option value="id">{pageCopy.id}</option>
              <option value="status">{pageCopy.status}</option>
            </select>
          </div>

          {agentsQuery.error ? (
            <div className="workspace-alert workspace-alert--error agents-sidebar__state">{String(agentsQuery.error)}</div>
          ) : agentsQuery.isLoading ? (
            <div className="workspace-inline-status agents-sidebar__state">{pageCopy.loadingAgents}</div>
          ) : visibleAgents.length === 0 ? (
            <div className="workspace-empty-inline agents-sidebar__state">
              {listFilter.trim() ? pageCopy.noAgentsMatched : pageCopy.noAgentsReturned}
            </div>
          ) : (
            <div className="agents-list">
              {visibleAgents.map((agent) => {
                const selected = activeAgent?.id === agent.id;
                const displayName = resolveAgentDisplayName(agent, selected ? activeIdentity : null);
                const emoji = resolveAgentAvatar(agent, selected ? activeIdentity : null);
                const resolvedConfig = resolveAgentConfig(configShape, agent.id);
                const workspace = resolvedConfig.entry?.workspace || resolvedConfig.defaults?.workspace || pageCopy.workspacePending;
                return (
                  <button
                    type="button"
                    key={agent.id}
                    className={`agents-list__row ${selected ? "active" : ""}`}
                    onClick={() => activateAgent(agent.id)}
                  >
                    <div className="agents-list__avatar">{emoji}</div>
                    <div className="agents-list__meta">
                      <div className="agents-list__title">{displayName}</div>
                      <div className="workspace-subcopy mono">{agent.id}</div>
                      <div className="workspace-subcopy mono">{truncate(workspace, 28)}</div>
                    </div>
                    <div className="agents-list__status">
                      <StatusBadge status={agent.status} label={agent.status} />
                      {agent.id === defaultId && <span className="detail-pill">{pageCopy.defaultTag}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <div className="agents-main">
          {editorMode === "create" && (
            <Card className="workspace-section agents-editor-card">
              <div className="workspace-section__header compact">
                <div>
                  <h4>{pageCopy.createAgent}</h4>
                  <p>{pageCopy.createAgentDetail}</p>
                </div>
                <Sparkles size={16} className="text-text-tertiary" />
              </div>

              <div className="agents-form">
                <label className="agents-field">
                  <span>{pageCopy.name}</span>
                  <input
                    className="agents-input"
                    value={agentForm.name}
                    onChange={(event) => setAgentForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder={pageCopy.createNamePlaceholder}
                  />
                </label>
                <label className="agents-field">
                  <span>{pageCopy.workspace}</span>
                  <input
                    className="agents-input mono"
                    value={agentForm.workspace}
                    onChange={(event) => setAgentForm((current) => ({ ...current, workspace: event.target.value }))}
                    placeholder={pageCopy.createWorkspacePlaceholder}
                  />
                </label>
                <label className="agents-field">
                  <span>{pageCopy.model}</span>
                  <input
                    className="agents-input mono"
                    value={agentForm.model}
                    onChange={(event) => setAgentForm((current) => ({ ...current, model: event.target.value }))}
                    list="agents-model-list"
                    placeholder={pageCopy.createModelPlaceholder}
                  />
                </label>
                <label className="agents-field">
                  <span>{pageCopy.avatar}</span>
                  <input
                    className="agents-input"
                    value={agentForm.avatar}
                    onChange={(event) => setAgentForm((current) => ({ ...current, avatar: event.target.value }))}
                    placeholder={pageCopy.createAvatarPlaceholder}
                  />
                </label>
                <label className="agents-field">
                  <span>{pageCopy.emoji}</span>
                  <input
                    className="agents-input"
                    value={agentForm.emoji}
                    onChange={(event) => setAgentForm((current) => ({ ...current, emoji: event.target.value }))}
                    placeholder={pageCopy.createEmojiPlaceholder}
                  />
                </label>
                <div className="agents-field agents-field--wide">
                  <div className="agents-form__hint">
                    {pageCopy.createFormHint}
                  </div>
                </div>
                <div className="agents-form__actions agents-field agents-field--wide">
                  <Button variant="ghost" onClick={cancelEditing}>{pageCopy.cancel}</Button>
                  <Button onClick={saveAgentForm} loading={savingAgent} disabled={!canSubmitAgentForm}>{pageCopy.createAgentButton}</Button>
                </div>
              </div>
            </Card>
          )}

          {!activeAgent ? (
            <Card className="workspace-section">
              <div className="workspace-empty-inline">
                <div className="agents-empty-block">
                  <Bot size={24} />
                  <strong>{pageCopy.noAgentSelected}</strong>
                  <span>{pageCopy.noAgentSelectedHint}</span>
                  <Button size="sm" onClick={openCreate}>{pageCopy.createAgent}</Button>
                </div>
              </div>
            </Card>
          ) : (
            <>
              <section className="agents-hero">
                <div className="agents-hero__identity">
                  <div className="agents-hero__avatar">{resolveAgentAvatar(activeAgent, activeIdentity)}</div>
                  <div className="agents-hero__copy">
                    <div className="agents-hero__title-row">
                      <h3>{resolveAgentDisplayName(activeAgent, activeIdentity)}</h3>
                      <StatusBadge status={activeAgent.status} label={activeAgent.status} />
                      {activeAgent.id === defaultId && <span className="detail-pill">default</span>}
                    </div>
                    <p>
                      {activeAgent.description || pageCopy.noDescription}
                    </p>
                    <div className="agents-hero__meta mono">{activeAgent.id}</div>
                    <div className="agents-hero__actions">
                      <Button variant="secondary" size="sm" onClick={openEdit}>
                        <PencilLine size={14} />
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" onClick={deleteAgent} disabled={activeAgent.id === defaultId}>
                        <Trash2 size={14} />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="agents-hero__stats">
                  <div className="agents-stat">
                    <span>Workspace</span>
                    <strong>{workspacePath ? truncate(workspacePath, 32) : "Pending"}</strong>
                  </div>
                  <div className="agents-stat">
                    <span>Model</span>
                    <strong>{truncate(modelLabel, 28)}</strong>
                  </div>
                  <div className="agents-stat">
                    <span>Tools</span>
                    <strong>{toolsCount}</strong>
                  </div>
                  <div className="agents-stat">
                    <span>Skills</span>
                    <strong>{eligibleSkillsCount}/{skillsCount}</strong>
                  </div>
                </div>
              </section>

              <div className="detail-pills agents-capabilities">
                {capabilityTags.length > 0 ? (
                  capabilityTags.map((pill) => (
                    <span key={pill} className="detail-pill">
                      {pill}
                    </span>
                  ))
                ) : (
                  <span className="workspace-subcopy">{pageCopy.noCapabilities}</span>
                )}
                {toolsQuery.data?.profiles.map((profile) => (
                  <span key={profile.id} className="detail-pill detail-pill--soft">
                    profile:{profile.label}
                  </span>
                ))}
              </div>

              <div className="agents-tabs" role="tablist" aria-label="Agent panels">
                    {PANELS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`agents-tabs__tab ${panel === entry.id ? "active" : ""}`}
                    onClick={() => setPanel(entry.id)}
                  >
                    {entry.id === "overview"
                      ? pageCopy.overviewTab
                      : entry.id === "files"
                        ? pageCopy.filesTab
                        : entry.id === "tools"
                          ? pageCopy.toolsTab
                          : pageCopy.skillsTab}
                  </button>
                ))}
              </div>

              {panel === "overview" && (
                <div className="agents-stack">
                  <div className="agents-overview-grid">
                    <Card className="workspace-section">
                      <div className="workspace-section__header compact">
                        <div>
                          <h4>{editorMode === "edit" ? pageCopy.editAgent : pageCopy.agentConfig}</h4>
                          <p>
                            {editorMode === "edit"
                              ? pageCopy.updateAgentDetail
                              : pageCopy.agentConfigDetail}
                          </p>
                        </div>
                        <Sparkles size={16} className="text-text-tertiary" />
                      </div>

                      {editorMode === "edit" ? (
                        <div className="agents-form">
                          <label className="agents-field">
                            <span>Name</span>
                            <input
                              className="agents-input"
                              value={agentForm.name}
                              onChange={(event) => setAgentForm((current) => ({ ...current, name: event.target.value }))}
                              placeholder="Agent name"
                            />
                          </label>
                          <label className="agents-field">
                            <span>Workspace</span>
                            <input
                              className="agents-input mono"
                              value={agentForm.workspace}
                              onChange={(event) => setAgentForm((current) => ({ ...current, workspace: event.target.value }))}
                              placeholder="~/openclaw/agents/..."
                            />
                          </label>
                          <label className="agents-field">
                            <span>Model</span>
                            <input
                              className="agents-input mono"
                              value={agentForm.model}
                              onChange={(event) => setAgentForm((current) => ({ ...current, model: event.target.value }))}
                              list="agents-model-list"
                              placeholder="Model override"
                            />
                          </label>
                          <label className="agents-field">
                            <span>Avatar</span>
                            <input
                              className="agents-input"
                              value={agentForm.avatar}
                              onChange={(event) => setAgentForm((current) => ({ ...current, avatar: event.target.value }))}
                              placeholder="Avatar or emoji"
                            />
                          </label>
                          <label className="agents-field">
                            <span>Emoji</span>
                            <input
                              className="agents-input"
                              value={agentForm.emoji}
                              disabled
                              placeholder="Edit IDENTITY.md to change emoji"
                            />
                          </label>
                          <div className="agents-field agents-field--wide">
                            <div className="agents-form__hint">
                              Emoji changes are not exposed by `agents.update`; use the Files panel to edit `IDENTITY.md` when you need to update it.
                            </div>
                          </div>
                          <div className="agents-form__actions agents-field agents-field--wide">
                            <Button variant="ghost" onClick={cancelEditing}>Cancel</Button>
                            <Button onClick={saveAgentForm} loading={savingAgent} disabled={!canSubmitAgentForm}>Save Changes</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="agents-kv-grid">
                          <div className="agents-kv">
                            <span>Identity</span>
                            <strong>{resolveAgentDisplayName(activeAgent, activeIdentity)}</strong>
                          </div>
                          <div className="agents-kv">
                            <span>Avatar</span>
                            <strong>{resolveAgentAvatar(activeAgent, activeIdentity)}</strong>
                          </div>
                          <div className="agents-kv">
                            <span>Workspace</span>
                            <strong className="mono">{workspacePath}</strong>
                          </div>
                          <div className="agents-kv">
                            <span>Model</span>
                            <strong className="mono">{modelLabel}</strong>
                          </div>
                        </div>
                      )}
                    </Card>

                    <Card className="workspace-section">
                      <div className="workspace-section__header compact">
                        <div>
                          <h4>{pageCopy.statusPolicy}</h4>
                          <p>{pageCopy.statusPolicyDetail}</p>
                        </div>
                        <Wrench size={16} className="text-text-tertiary" />
                      </div>
                      <div className="agents-kv-grid">
                        <div className="agents-kv">
                          <span>Status</span>
                          <strong>{activeAgent.status}</strong>
                        </div>
                        <div className="agents-kv">
                          <span>Default Agent</span>
                          <strong>{activeAgent.id === defaultId ? "Yes" : "No"}</strong>
                        </div>
                        <div className="agents-kv">
                          <span>Eligible Skills</span>
                          <strong>{eligibleSkillsCount}</strong>
                        </div>
                        <div className="agents-kv">
                          <span>Blocked Skills</span>
                          <strong>{blockedSkillsCount}</strong>
                        </div>
                      </div>
                      <div className="agents-banner agents-banner--info">
                        <TriangleAlert size={14} />
                        <span>Current gateway RPCs expose agent runtime status, but do not expose dedicated `agents.start` / `agents.stop` lifecycle calls.</span>
                      </div>
                    </Card>
                  </div>

                  <div className="agents-overview-grid">
                    <Card className="workspace-section">
                      <div className="workspace-section__header compact">
                        <div>
                          <h4>{pageCopy.filesSnapshot}</h4>
                          <p>{pageCopy.filesSnapshotDetail}</p>
                        </div>
                        <FileCode2 size={16} className="text-text-tertiary" />
                      </div>
                      {filesListQuery.isLoading ? (
                        <div className="workspace-inline-status">Loading file list…</div>
                      ) : filesListQuery.data && filesListQuery.data.files.length > 0 ? (
                        <div className="agents-mini-list">
                          {filesListQuery.data.files.slice(0, 5).map((file) => (
                            <button
                              type="button"
                              key={file.name}
                              className="agents-mini-list__row agents-mini-list__action"
                              onClick={() => {
                                setPanel("files");
                                setActiveFileName(file.name);
                              }}
                            >
                              <div>
                                <div className="tool-item__title mono">{file.name}</div>
                                <div className="workspace-subcopy mono">{truncate(file.path, 54)}</div>
                              </div>
                              <span className={`detail-pill ${file.missing ? "detail-pill--warn" : "detail-pill--soft"}`}>
                                {file.missing ? "missing" : formatBytes(file.size)}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="workspace-empty-inline">No bootstrap files were reported for this agent.</div>
                      )}
                    </Card>

                    <Card className="workspace-section">
                      <div className="workspace-section__header compact">
                        <div>
                          <h4>{pageCopy.skillsSnapshot}</h4>
                          <p>{pageCopy.skillsSnapshotDetail}</p>
                        </div>
                        <KeyRound size={16} className="text-text-tertiary" />
                      </div>
                      {skillsQuery.isLoading ? (
                        <div className="workspace-inline-status">Loading skills…</div>
                      ) : skillsQuery.data && skillsQuery.data.skills.length > 0 ? (
                        <div className="agents-checklist">
                          <div className="agents-checklist__row">
                            <span className="detail-pill detail-pill--ok">eligible</span>
                            <span>{eligibleSkillsCount} skills are currently eligible for this agent.</span>
                          </div>
                          <div className="agents-checklist__row">
                            <span className="detail-pill detail-pill--warn">blocked</span>
                            <span>{blockedSkillsCount} skills are blocked, disabled, or missing requirements.</span>
                          </div>
                          <div className="agents-checklist__row">
                            <span className="detail-pill">workspace</span>
                            <span className="mono">{skillsQuery.data.workspaceDir || "No workspace reported"}</span>
                          </div>
                          <div className="agents-checklist__row">
                            <span className="detail-pill">managed</span>
                            <span className="mono">{skillsQuery.data.managedSkillsDir || "No managed skills dir"}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="workspace-empty-inline">No skill metadata was returned for this agent.</div>
                      )}
                    </Card>
                  </div>
                </div>
              )}

              {panel === "files" && (
                <Card className="workspace-section agents-panel" padding={false}>
                  <div className="agents-panel__header">
                    <div>
                      <h3>{pageCopy.coreFiles}</h3>
                      <p>{filesListQuery.data?.workspace || "Load the workspace files for this agent."}</p>
                    </div>
                    <div className="workspace-toolbar__actions">
                      <Button variant="secondary" size="sm" onClick={refreshFiles} loading={filesListQuery.isFetching}>
                        <RefreshCw size={14} />
                        Refresh
                      </Button>
                    </div>
                  </div>

                  {filesListQuery.error && (
                    <div className="workspace-alert workspace-alert--error agents-panel__alert">{String(filesListQuery.error)}</div>
                  )}

                  {!filesListQuery.data ? (
                    <div className="workspace-empty-inline agents-panel__body">Load the agent workspace files to edit core instructions.</div>
                  ) : (
                    <div className="agents-files-grid">
                      <div className="agents-files-list">
                        {filesListQuery.data.files.length === 0 ? (
                          <div className="workspace-empty-inline">No files found for this agent.</div>
                        ) : (
                          filesListQuery.data.files.map((file) => (
                            <button
                              type="button"
                              key={file.name}
                              className={`agents-file-row ${file.name === activeFileName ? "active" : ""}`}
                              onClick={() => setActiveFileName(file.name)}
                            >
                              <div>
                                <div className="agents-file-row__title mono">{file.name}</div>
                                <div className="workspace-subcopy mono">
                                  {file.missing
                                    ? "Missing file"
                                    : `${formatBytes(file.size)} · ${
                                        file.updatedAtMs ? formatRelativeTime(file.updatedAtMs) : "unknown time"
                                      }`}
                                </div>
                              </div>
                              {file.missing && <span className="detail-pill detail-pill--warn">missing</span>}
                            </button>
                          ))
                        )}
                      </div>

                      <div className="agents-file-editor">
                        {!activeFileName ? (
                          <div className="workspace-empty-inline">Select a file to inspect or edit it.</div>
                        ) : (
                          <>
                            <div className="agents-file-editor__header">
                              <div>
                                <h4 className="mono">{activeFileEntry?.name ?? activeFileName}</h4>
                                <p className="workspace-subcopy mono">{activeFileEntry?.path ?? "Loading path…"}</p>
                              </div>
                              <div className="workspace-toolbar__actions">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setFileDrafts((current) => ({
                                      ...current,
                                      [activeFileName]: activeFileQuery.data?.content ?? "",
                                    }))
                                  }
                                  disabled={!activeFileDirty}
                                >
                                  Reset
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={saveActiveFile}
                                  loading={busyFileName === activeFileName}
                                  disabled={!activeFileDirty}
                                >
                                  Save
                                </Button>
                              </div>
                            </div>

                            {activeFileEntry?.missing && (
                              <div className="workspace-alert workspace-alert--info">
                                This file is missing. Saving will create it in the agent workspace.
                              </div>
                            )}

                            {activeFileQuery.isLoading ? (
                              <div className="workspace-inline-status">Loading file content…</div>
                            ) : (
                              <textarea
                                className="agents-file-editor__textarea"
                                value={activeFileDraft}
                                onChange={(event) =>
                                  setFileDrafts((current) => ({
                                    ...current,
                                    [activeFileName]: event.target.value,
                                  }))
                                }
                                spellCheck={false}
                              />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              )}

              {panel === "tools" && (
                <Card className="workspace-section agents-panel">
                  <div className="workspace-section__header">
                    <div>
                      <h3>{pageCopy.toolCatalog}</h3>
                      <p>{pageCopy.toolCatalogDetail}</p>
                    </div>
                    <div className="workspace-toolbar__actions">
                      <label className="agents-search">
                        <Search size={14} />
                        <input
                          value={toolFilter}
                          onChange={(event) => setToolFilter(event.target.value)}
                          placeholder="Filter by tool, plugin, or profile"
                        />
                      </label>
                      <Button variant="secondary" size="sm" onClick={() => toolsQuery.refetch()} loading={toolsQuery.isFetching}>
                        <RefreshCw size={14} />
                        Refresh
                      </Button>
                    </div>
                  </div>

                  {toolsQuery.error && <div className="workspace-alert workspace-alert--error">{String(toolsQuery.error)}</div>}

                  <div className="agents-banner agents-banner--info">
                    <TriangleAlert size={14} />
                    <span>Gateway tool policy is currently reported as catalog + profiles. Dedicated per-agent tool override mutations are not exposed in this desktop client.</span>
                  </div>

                  {toolsQuery.isLoading ? (
                    <div className="workspace-inline-status">Loading runtime tool catalog…</div>
                  ) : filteredToolGroups.length > 0 ? (
                    <div className="agents-tool-groups">
                      {filteredToolGroups.map((group) => (
                        <section key={group.id} className="agents-tool-group tool-group">
                          <div className="tool-group__header">
                            <div>
                              <strong>{group.label}</strong>
                              <div className="workspace-subcopy">
                                {group.tools.length} tools · {group.source}
                                {group.pluginId ? ` · ${group.pluginId}` : ""}
                              </div>
                            </div>
                          </div>

                          <div className="tool-group__items agents-tool-group__items">
                            {group.tools.map((tool) => (
                              <article key={tool.id} className="agents-tool-card">
                                <div className="tool-item__title">{tool.label}</div>
                                <div className="workspace-subcopy mono">{tool.id}</div>
                                <div className="agents-tool-card__description">
                                  {tool.description || "No description was reported for this tool."}
                                </div>
                                <div className="detail-pills">
                                  <span className="detail-pill">{tool.source}</span>
                                  {tool.pluginId && <span className="detail-pill detail-pill--soft">plugin:{tool.pluginId}</span>}
                                  {tool.optional && <span className="detail-pill detail-pill--soft">optional</span>}
                                  {tool.defaultProfiles.map((profile) => (
                                    <span key={`${tool.id}-${profile}`} className="detail-pill detail-pill--soft">
                                      {profile}
                                    </span>
                                  ))}
                                </div>
                              </article>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <div className="workspace-empty-inline">No tool catalog matched the current filter.</div>
                  )}
                </Card>
              )}

              {panel === "skills" && (
                <Card className="workspace-section agents-panel">
                  <div className="workspace-section__header">
                    <div>
                      <h3>{pageCopy.agentSkills}</h3>
                      <p>{skillsQuery.data?.workspaceDir || "Agent-scoped skill report from `skills.status`."}</p>
                    </div>
                    <div className="workspace-toolbar__actions">
                      <label className="agents-search">
                        <Search size={14} />
                        <input
                          value={skillFilter}
                          onChange={(event) => setSkillFilter(event.target.value)}
                          placeholder="Filter by skill name, key, or source"
                        />
                      </label>
                      <Button variant="secondary" size="sm" onClick={() => skillsQuery.refetch()} loading={skillsQuery.isFetching}>
                        <RefreshCw size={14} />
                        Refresh
                      </Button>
                    </div>
                  </div>

                  {skillsQuery.error && <div className="workspace-alert workspace-alert--error">{String(skillsQuery.error)}</div>}

                  <div className="agents-banner agents-banner--info">
                    <TriangleAlert size={14} />
                    <span>`skills.install` and `skills.update` are available here. Dedicated uninstall RPCs are not exposed by the current gateway, so disabling a skill is the closest supported fallback.</span>
                  </div>

                  <div className="agents-skill-meta">
                    <div className="agents-kv">
                      <span>Workspace</span>
                      <strong className="mono">{skillsQuery.data?.workspaceDir || "-"}</strong>
                    </div>
                    <div className="agents-kv">
                      <span>Managed Skills</span>
                      <strong className="mono">{skillsQuery.data?.managedSkillsDir || "-"}</strong>
                    </div>
                  </div>

                  {skillsQuery.isLoading ? (
                    <div className="workspace-inline-status">Loading skills…</div>
                  ) : groupedSkills.length > 0 ? (
                    <div className="agents-skill-groups">
                      {groupedSkills.map((group) => (
                        <section key={group.id} className="tool-group agents-skill-group">
                          <div className="tool-group__header">
                            <div>
                              <strong>{group.label}</strong>
                              <div className="workspace-subcopy">{group.skills.length} matching skills</div>
                            </div>
                          </div>

                          <div className="tool-group__items agents-skill-group__items">
                            {group.skills.map((skill) => {
                              const missing = computeSkillMissing(skill);
                              const reasons = computeSkillReasons(skill);
                              const toggledOff = skill.disabled;
                              const skillConfig = resolveSkillConfig(configShape, skill.skillKey);
                              const envNames = uniqueStrings([
                                ...skill.requirements.env.filter((name) => name !== skill.primaryEnv),
                                ...Object.keys(skillConfig?.env ?? {}).filter((name) => name !== skill.primaryEnv),
                              ]);
                              const apiKeyValue = skillApiKeyDrafts[skill.skillKey] ?? skillConfig?.apiKey ?? "";
                              const envValue = skillEnvDrafts[skill.skillKey] ?? skillConfig?.env ?? {};
                              const installLabel = skill.install[0]?.label ?? null;

                              return (
                                <div key={skill.skillKey} className="tool-item agents-skill-card">
                                  <div className="agents-skill-card__header">
                                    <div>
                                      <div className="tool-item__title">
                                        {skill.emoji ? `${skill.emoji} ` : ""}
                                        {skill.name}
                                      </div>
                                      <div className="workspace-subcopy mono">{skill.skillKey}</div>
                                    </div>
                                    <div className="agents-skill-actions">
                                      {installLabel && (
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          onClick={() => installSkill(skill)}
                                          loading={busySkill?.key === skill.skillKey && busySkill.action === "install"}
                                        >
                                          <PackagePlus size={14} />
                                          {pageCopy.install}
                                        </Button>
                                      )}
                                      <Button
                                        size="sm"
                                        variant={toggledOff ? "primary" : "secondary"}
                                        onClick={() => updateSkillEnabled(skill, toggledOff)}
                                        loading={busySkill?.key === skill.skillKey && busySkill.action === "toggle"}
                                        disabled={skill.always}
                                      >
                                        {toggledOff ? pageCopy.enable : pageCopy.disable}
                                      </Button>
                                    </div>
                                  </div>

                                  <div className="agents-tool-card__description">
                                    {skill.description || "No description reported for this skill."}
                                  </div>

                                  <div className="detail-pills">
                                    <span className="detail-pill">{skill.source}</span>
                                    <span className={`detail-pill ${skill.eligible ? "detail-pill--ok" : "detail-pill--warn"}`}>
                                      {skill.eligible ? "eligible" : "blocked"}
                                    </span>
                                    {skill.bundled && <span className="detail-pill detail-pill--soft">bundled</span>}
                                    {skill.disabled && <span className="detail-pill detail-pill--warn">disabled</span>}
                                    {skill.always && <span className="detail-pill">always</span>}
                                    {skill.primaryEnv && <span className="detail-pill detail-pill--soft">env:{skill.primaryEnv}</span>}
                                  </div>

                                  {installLabel && (
                                    <div className="workspace-subcopy">Suggested install: {installLabel}</div>
                                  )}
                                  {missing.length > 0 && <div className="workspace-subcopy">Missing: {missing.join(", ")}</div>}
                                  {reasons.length > 0 && <div className="workspace-subcopy">Reason: {reasons.join(", ")}</div>}

                                  {(skill.primaryEnv || envNames.length > 0) && (
                                    <div className="agents-skill-config">
                                      {skill.primaryEnv && (
                                        <div className="agents-skill-config__row">
                                          <label className="agents-field agents-field--wide">
                                            <span>API Key ({skill.primaryEnv})</span>
                                            <input
                                              className="agents-input mono"
                                              value={apiKeyValue}
                                              onChange={(event) =>
                                                setSkillApiKeyDrafts((current) => ({
                                                  ...current,
                                                  [skill.skillKey]: event.target.value,
                                                }))
                                              }
                                              placeholder={`Set ${skill.primaryEnv}`}
                                            />
                                          </label>
                                          <Button
                                            size="sm"
                                            onClick={() => saveSkillApiKey(skill, apiKeyValue)}
                                            loading={busySkill?.key === skill.skillKey && busySkill.action === "apiKey"}
                                          >
                                            {pageCopy.saveKey}
                                          </Button>
                                        </div>
                                      )}

                                      {envNames.length > 0 && (
                                        <>
                                          <div className="agents-env-grid">
                                            {envNames.map((envName) => (
                                              <label key={envName} className="agents-field">
                                                <span>{envName}</span>
                                                <input
                                                  className="agents-input mono"
                                                  value={envValue[envName] ?? ""}
                                                  onChange={(event) =>
                                                    setSkillEnvDrafts((current) => ({
                                                      ...current,
                                                      [skill.skillKey]: {
                                                        ...(current[skill.skillKey] ?? skillConfig?.env ?? {}),
                                                        [envName]: event.target.value,
                                                      },
                                                    }))
                                                  }
                                                  placeholder={`Override ${envName}`}
                                                />
                                              </label>
                                            ))}
                                          </div>
                                          <div className="agents-inline-actions">
                                            <Button
                                              size="sm"
                                              variant="secondary"
                                              onClick={() => saveSkillEnv(skill, envValue)}
                                              loading={busySkill?.key === skill.skillKey && busySkill.action === "env"}
                                            >
                                              {pageCopy.saveEnvOverrides}
                                            </Button>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <div className="workspace-empty-inline">No skills matched the current filter.</div>
                  )}
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      <datalist id="agents-model-list">
        {(modelsQuery.data ?? []).map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </datalist>
    </div>
  );
}
