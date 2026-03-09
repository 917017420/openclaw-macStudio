import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bot,
  FileCode2,
  RefreshCw,
  Search,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, Card, StatusBadge } from "@/components/ui";
import { useToolsCatalog } from "@/features/agents/hooks/useToolsCatalog";
import { useAgentsDirectory } from "@/features/chat/hooks/useAgents";
import { useConnectionStore } from "@/features/connection/store";
import { useChatStore } from "@/features/chat/store";
import { gateway } from "@/lib/gateway";
import type { Agent } from "@/lib/gateway";
import { formatRelativeTime, truncate } from "@/lib/utils";
import "./agents.css";

type AgentPanel = "overview" | "files" | "tools" | "skills";

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
  kind: "brew" | "node" | "go" | "uv";
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
  emoji?: string;
  homepage?: string;
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

type PageFeedback =
  | {
      kind: "success" | "error";
      message: string;
    }
  | null;

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
      ? obj.files.map((file) => normalizeFileEntry(file)).filter(Boolean) as AgentFileEntry[]
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
  if (trimmed.includes("://") || trimmed.includes("/") || trimmed.includes(".")) return false;
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed.charCodeAt(index) > 127) {
      return true;
    }
  }
  return false;
}

function resolveAgentDisplayName(agent: Agent, identity?: AgentIdentityResult | null) {
  return (
    identity?.name?.trim() ||
    agent.identity?.name?.trim() ||
    agent.name?.trim() ||
    agent.id
  );
}

function resolveAgentAvatar(agent: Agent, identity?: AgentIdentityResult | null) {
  const candidates = [
    identity?.emoji,
    agent.identity?.emoji,
    identity?.avatar,
    agent.identity?.avatar,
    agent.avatar,
  ];
  const emoji = candidates.find((value) => isLikelyEmoji(value));
  if (emoji) {
    return emoji;
  }
  return resolveAgentDisplayName(agent, identity).slice(0, 1).toUpperCase();
}

function countTools(groups?: Array<{ tools: Array<unknown> }>) {
  return groups?.reduce((count, group) => count + group.tools.length, 0) ?? 0;
}

function formatBytes(bytes?: number) {
  if (bytes == null || !Number.isFinite(bytes)) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
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
  const ordered = SKILL_SOURCE_GROUPS
    .map((group) => groups.get(group.id))
    .filter((group): group is SkillGroup => Boolean(group && group.skills.length > 0));
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

export function AgentsPage() {
  const navigate = useNavigate();
  const isConnected = useConnectionStore((state) => state.state === "connected");
  const selectedAgentId = useChatStore((state) => state.selectedAgentId);
  const selectAgent = useChatStore((state) => state.selectAgent);
  const selectSession = useChatStore((state) => state.selectSession);
  const setSelectedModel = useChatStore((state) => state.setSelectedModel);

  const [panel, setPanel] = useState<AgentPanel>("overview");
  const [toolFilter, setToolFilter] = useState("");
  const [skillFilter, setSkillFilter] = useState("");
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [fileDrafts, setFileDrafts] = useState<Record<string, string>>({});
  const [busyFileName, setBusyFileName] = useState<string | null>(null);
  const [busySkillKey, setBusySkillKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<PageFeedback>(null);

  const deferredToolFilter = useDeferredValue(toolFilter);
  const deferredSkillFilter = useDeferredValue(skillFilter);

  const agentsQuery = useAgentsDirectory();
  const agents = agentsQuery.data?.agents ?? [];
  const defaultId = agentsQuery.data?.defaultId ?? null;

  useEffect(() => {
    if (!selectedAgentId && agents.length > 0) {
      selectAgent(defaultId ?? agents[0].id);
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

  const toolsQuery = useToolsCatalog(activeAgent?.id ?? null);

  const skillsQuery = useQuery<SkillStatusReport>({
    queryKey: activeAgent ? ["agent-skills", activeAgent.id] : ["agent-skills"],
    enabled: isConnected && Boolean(activeAgent),
    staleTime: 15_000,
    queryFn: async () => {
      if (!activeAgent) {
        return { workspaceDir: "", managedSkillsDir: "", skills: [] };
      }
      return normalizeSkillReport(
        await gateway.request<unknown>("skills.status", { agentId: activeAgent.id }),
      );
    },
  });

  const filesListQuery = useQuery<AgentsFilesListResult>({
    queryKey: activeAgent ? ["agent-files-list", activeAgent.id] : ["agent-files-list"],
    enabled: isConnected && Boolean(activeAgent) && (panel === "overview" || panel === "files"),
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
    if (files.length === 0) {
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
    if (!activeFileName || !activeFileQuery.data) return;
    setFileDrafts((current) => {
      if (Object.hasOwn(current, activeFileName)) {
        return current;
      }
      return { ...current, [activeFileName]: activeFileQuery.data.content ?? "" };
    });
  }, [activeFileName, activeFileQuery.data]);

  useEffect(() => {
    setFeedback(null);
  }, [activeAgent?.id, panel]);

  const activeIdentity = identityQuery.data;
  const capabilityTags = capabilityPills(activeAgent?.capabilities);
  const toolsCount = countTools(toolsQuery.data?.groups);
  const skillsCount = skillsQuery.data?.skills.length ?? 0;
  const eligibleSkillsCount =
    skillsQuery.data?.skills.filter((skill) => skill.eligible && !skill.disabled).length ?? 0;
  const workspacePath = filesListQuery.data?.workspace || skillsQuery.data?.workspaceDir || "Not loaded";

  const filteredToolGroups = useMemo(() => {
    const groups = toolsQuery.data?.groups ?? [];
    const needle = deferredToolFilter.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        tools: group.tools.filter((tool) =>
          [tool.id, tool.label, tool.description, tool.pluginId, ...tool.defaultProfiles]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(needle),
        ),
      }))
      .filter((group) => group.tools.length > 0);
  }, [deferredToolFilter, toolsQuery.data]);

  const groupedSkills = useMemo(() => {
    const list = skillsQuery.data?.skills ?? [];
    const needle = deferredSkillFilter.trim().toLowerCase();
    const filtered = !needle
      ? list
      : list.filter((skill) =>
          [skill.name, skill.description, skill.source, skill.skillKey]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        );
    return groupSkills(filtered);
  }, [deferredSkillFilter, skillsQuery.data]);

  const activeFileEntry =
    (activeFileName
      ? filesListQuery.data?.files.find((file) => file.name === activeFileName)
      : null) ?? activeFileQuery.data;
  const activeFileDraft =
    (activeFileName ? fileDrafts[activeFileName] : undefined) ??
    activeFileQuery.data?.content ??
    "";
  const activeFileDirty = activeFileName
    ? activeFileDraft !== (activeFileQuery.data?.content ?? "")
    : false;

  function activateAgent(agentId: string) {
    selectAgent(agentId);
    selectSession(null);
    setSelectedModel(null);
    setActiveFileName(null);
  }

  async function refreshCurrentView() {
    setFeedback(null);
    const actions: Array<Promise<unknown>> = [agentsQuery.refetch()];
    if (activeAgent) {
      actions.push(identityQuery.refetch(), toolsQuery.refetch(), skillsQuery.refetch());
      if (panel === "overview" || panel === "files") {
        actions.push(filesListQuery.refetch());
      }
      if (panel === "files" && activeFileName) {
        actions.push(activeFileQuery.refetch());
      }
    }
    await Promise.all(actions);
  }

  async function refreshFiles() {
    setFeedback(null);
    await Promise.all([
      filesListQuery.refetch(),
      activeFileName ? activeFileQuery.refetch() : Promise.resolve(null),
    ]);
  }

  async function saveActiveFile() {
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
  }

  async function updateSkillEnabled(skillKey: string, enabled: boolean) {
    setBusySkillKey(skillKey);
    setFeedback(null);
    try {
      await gateway.request("skills.update", { skillKey, enabled });
      await skillsQuery.refetch();
      setFeedback({
        kind: "success",
        message: enabled ? `Enabled ${skillKey}.` : `Disabled ${skillKey}.`,
      });
    } catch (error) {
      setFeedback({ kind: "error", message: String(error) });
    } finally {
      setBusySkillKey(null);
    }
  }

  function openInChat() {
    if (!activeAgent) return;
    selectAgent(activeAgent.id);
    selectSession(null);
    navigate("/chat");
  }

  if (!isConnected) {
    return (
      <div className="workspace-empty-state agents-page agents-page--empty">
        <Bot size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">Agents</h2>
        <p className="workspace-subtitle">Connect a gateway to inspect and align agent workspaces.</p>
      </div>
    );
  }

  return (
    <div className="workspace-page agents-page">
      <div className="workspace-toolbar agents-toolbar">
        <div>
          <h2 className="workspace-title">Agents</h2>
          <p className="workspace-subtitle">
            Official-style agent workspace with overview, files, tools, and skills panels.
          </p>
        </div>
        <div className="workspace-toolbar__actions">
          <Button variant="secondary" onClick={refreshCurrentView} loading={agentsQuery.isFetching}>
            <RefreshCw size={14} />
            Refresh
          </Button>
          <Button onClick={openInChat} disabled={!activeAgent}>
            Open Chat
            <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {feedback && (
        <div
          className={`workspace-alert ${
            feedback.kind === "error" ? "workspace-alert--error" : "workspace-alert--info"
          }`}
        >
          {feedback.message}
        </div>
      )}
      {agentsQuery.error && (
        <div className="workspace-alert workspace-alert--error">{String(agentsQuery.error)}</div>
      )}

      <div className="agents-shell">
        <Card className="agents-sidebar" padding={false}>
          <div className="agents-sidebar__header">
            <div>
              <h3>Configured Agents</h3>
              <p>{agents.length} loaded from `agents.list`.</p>
            </div>
            <StatusBadge status="connected" label={defaultId ? `default:${defaultId}` : "connected"} />
          </div>

          {agentsQuery.isLoading ? (
            <div className="workspace-inline-status agents-sidebar__state">Loading agents…</div>
          ) : agents.length === 0 ? (
            <div className="workspace-empty-inline agents-sidebar__state">No agents were returned from `agents.list`.</div>
          ) : (
            <div className="agents-list">
              {agents.map((agent) => {
                const active = agent.id === activeAgent?.id;
                const badge = agent.id === defaultId ? "default" : null;
                return (
                  <button
                    type="button"
                    key={agent.id}
                    className={`agents-list__row ${active ? "active" : ""}`}
                    onClick={() => activateAgent(agent.id)}
                  >
                    <div className="agents-list__avatar">
                      {resolveAgentAvatar(
                        agent,
                        active ? activeIdentity : agent.id === activeAgent?.id ? activeIdentity : null,
                      )}
                    </div>
                    <div className="agents-list__meta">
                      <div className="agents-list__title">{resolveAgentDisplayName(agent)}</div>
                      <div className="workspace-subcopy mono">{agent.id}</div>
                    </div>
                    <div className="agents-list__status">
                      {badge && <span className="detail-pill">{badge}</span>}
                      <StatusBadge status={agent.status} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <div className="agents-main">
          {!activeAgent ? (
            <Card className="workspace-section">
              <div className="workspace-empty-inline">Select an agent to inspect its workspace and tools.</div>
            </Card>
          ) : (
            <>
              <section className="agents-hero">
                <div className="agents-hero__identity">
                  <div className="agents-hero__avatar">
                    {resolveAgentAvatar(activeAgent, activeIdentity)}
                  </div>
                  <div className="agents-hero__copy">
                    <div className="agents-hero__title-row">
                      <h3>{resolveAgentDisplayName(activeAgent, activeIdentity)}</h3>
                      <StatusBadge status={activeAgent.status} label={activeAgent.status} />
                      {activeAgent.id === defaultId && <span className="detail-pill">default</span>}
                    </div>
                    <p>
                      {activeAgent.description ||
                        "No explicit description reported by the gateway for this agent."}
                    </p>
                    <div className="agents-hero__meta mono">{activeAgent.id}</div>
                  </div>
                </div>

                <div className="agents-hero__stats">
                  <div className="agents-stat">
                    <span>Workspace</span>
                    <strong>{workspacePath ? truncate(workspacePath, 30) : "Pending"}</strong>
                  </div>
                  <div className="agents-stat">
                    <span>Tools</span>
                    <strong>{toolsCount}</strong>
                  </div>
                  <div className="agents-stat">
                    <span>Skills</span>
                    <strong>{skillsCount}</strong>
                  </div>
                  <div className="agents-stat">
                    <span>Eligible</span>
                    <strong>{eligibleSkillsCount}</strong>
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
                  <span className="workspace-subcopy">No capabilities metadata reported.</span>
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
                    {entry.label}
                  </button>
                ))}
              </div>

              {panel === "overview" && (
                <div className="agents-stack">
                  <div className="agents-overview-grid">
                    <Card className="workspace-section">
                      <div className="workspace-section__header compact">
                        <div>
                          <h4>Agent Context</h4>
                          <p>Workspace and identity details resolved for this agent.</p>
                        </div>
                        <Sparkles size={16} className="text-text-tertiary" />
                      </div>
                      <div className="agents-kv-grid">
                        <div className="agents-kv">
                          <span>Identity</span>
                          <strong>{resolveAgentDisplayName(activeAgent, activeIdentity)}</strong>
                        </div>
                        <div className="agents-kv">
                          <span>Emoji / Avatar</span>
                          <strong>{resolveAgentAvatar(activeAgent, activeIdentity)}</strong>
                        </div>
                        <div className="agents-kv">
                          <span>Workspace</span>
                          <strong className="mono">{workspacePath || "Load files to resolve"}</strong>
                        </div>
                        <div className="agents-kv">
                          <span>Managed Skills</span>
                          <strong className="mono">
                            {skillsQuery.data?.managedSkillsDir || "No managed skills dir"}
                          </strong>
                        </div>
                      </div>
                    </Card>

                    <Card className="workspace-section">
                      <div className="workspace-section__header compact">
                        <div>
                          <h4>Files Snapshot</h4>
                          <p>Official module parity starts with the core workspace files.</p>
                        </div>
                        <FileCode2 size={16} className="text-text-tertiary" />
                      </div>
                      {filesListQuery.isLoading ? (
                        <div className="workspace-inline-status">Loading file list…</div>
                      ) : filesListQuery.data && filesListQuery.data.files.length > 0 ? (
                        <div className="agents-mini-list">
                          {filesListQuery.data.files.slice(0, 4).map((file) => (
                            <div key={file.name} className="agents-mini-list__row">
                              <div>
                                <div className="tool-item__title mono">{file.name}</div>
                                <div className="workspace-subcopy mono">{truncate(file.path, 52)}</div>
                              </div>
                              <div className="workspace-subcopy">
                                {file.missing
                                  ? "missing"
                                  : file.updatedAtMs
                                    ? formatRelativeTime(file.updatedAtMs)
                                    : formatBytes(file.size)}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="workspace-empty-inline">No workspace files loaded yet.</div>
                      )}
                    </Card>
                  </div>

                  <Card className="workspace-section">
                    <div className="workspace-section__header">
                      <div>
                        <h3>Panel Alignment Summary</h3>
                        <p>Current parity between desktop Agents and the upstream official module.</p>
                      </div>
                    </div>
                    <div className="agents-checklist">
                      <div className="agents-checklist__row">
                        <span className="detail-pill">overview</span>
                        <span>Identity, workspace snapshot, tools count, and skills count are available.</span>
                      </div>
                      <div className="agents-checklist__row">
                        <span className="detail-pill">files</span>
                        <span>Workspace file list, file loading, editing, and save flow are wired to `agents.files.*`.</span>
                      </div>
                      <div className="agents-checklist__row">
                        <span className="detail-pill">tools</span>
                        <span>Runtime tool catalog, grouped rendering, and search are aligned with the upstream structure.</span>
                      </div>
                      <div className="agents-checklist__row">
                        <span className="detail-pill">skills</span>
                        <span>Agent-scoped skill report, grouped rendering, and enable/disable are available.</span>
                      </div>
                    </div>
                  </Card>
                </div>
              )}

              {panel === "files" && (
                <Card className="workspace-section agents-panel" padding={false}>
                  <div className="agents-panel__header">
                    <div>
                      <h3>Core Files</h3>
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
                    <div className="workspace-alert workspace-alert--error agents-panel__alert">
                      {String(filesListQuery.error)}
                    </div>
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
                            ) : activeFileQuery.error ? (
                              <div className="workspace-alert workspace-alert--error">
                                {String(activeFileQuery.error)}
                              </div>
                            ) : (
                              <textarea
                                className="agents-file-editor__textarea mono"
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
                      <h3>Tool Access</h3>
                      <p>{toolsCount} tools currently visible for this agent.</p>
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
                    </div>
                  </div>

                  {toolsQuery.error && (
                    <div className="workspace-alert workspace-alert--error">{String(toolsQuery.error)}</div>
                  )}

                  {toolsQuery.isLoading ? (
                    <div className="workspace-inline-status">Loading tool catalog…</div>
                  ) : filteredToolGroups.length > 0 ? (
                    <div className="agents-tool-groups">
                      {filteredToolGroups.map((group) => (
                        <section key={group.id} className="tool-group agents-tool-group">
                          <div className="tool-group__header">
                            <div>
                              <strong>{group.label}</strong>
                              <div className="workspace-subcopy">
                                {group.source}
                                {group.pluginId ? ` · ${group.pluginId}` : ""}
                              </div>
                            </div>
                            <span className="detail-pill">{group.tools.length} tools</span>
                          </div>

                          <div className="tool-group__items agents-tool-group__items">
                            {group.tools.map((tool) => (
                              <div key={tool.id} className="tool-item agents-tool-card">
                                <div className="tool-item__title">{tool.label}</div>
                                <div className="workspace-subcopy mono">{tool.id}</div>
                                <div className="agents-tool-card__description">
                                  {tool.description || "No description reported by the gateway."}
                                </div>
                                <div className="detail-pills">
                                  <span className="detail-pill">{tool.source}</span>
                                  {tool.pluginId && <span className="detail-pill">plugin:{tool.pluginId}</span>}
                                  {tool.optional && <span className="detail-pill detail-pill--soft">optional</span>}
                                  {tool.defaultProfiles.map((profile) => (
                                    <span key={`${tool.id}-${profile}`} className="detail-pill detail-pill--soft">
                                      {profile}
                                    </span>
                                  ))}
                                </div>
                              </div>
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
                      <h3>Agent Skills</h3>
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

                  {skillsQuery.error && (
                    <div className="workspace-alert workspace-alert--error">{String(skillsQuery.error)}</div>
                  )}

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
                                    <Button
                                      size="sm"
                                      variant={toggledOff ? "primary" : "secondary"}
                                      onClick={() => updateSkillEnabled(skill.skillKey, toggledOff)}
                                      loading={busySkillKey === skill.skillKey}
                                      disabled={skill.always}
                                    >
                                      {toggledOff ? "Enable" : "Disable"}
                                    </Button>
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
                                  </div>

                                  {missing.length > 0 && (
                                    <div className="workspace-subcopy">Missing: {missing.join(", ")}</div>
                                  )}
                                  {reasons.length > 0 && (
                                    <div className="workspace-subcopy">Reason: {reasons.join(", ")}</div>
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
    </div>
  );
}
