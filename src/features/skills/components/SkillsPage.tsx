import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Wrench } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";
import { gateway } from "@/lib/gateway";

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

type SkillMessage = {
  kind: "success" | "error";
  message: string;
};

type SkillGroup = {
  id: string;
  label: string;
  skills: SkillStatusEntry[];
};

const SKILLS_QUERY_KEY = ["gateway-skills"] as const;

const SKILL_SOURCE_GROUPS: Array<{ id: string; label: string; sources: string[] }> = [
  { id: "workspace", label: "Workspace Skills", sources: ["openclaw-workspace"] },
  { id: "built-in", label: "Built-in Skills", sources: ["openclaw-bundled"] },
  { id: "installed", label: "Installed Skills", sources: ["openclaw-managed"] },
  { id: "extra", label: "Extra Skills", sources: ["openclaw-extra"] },
];

function normalizeSkillReport(raw: unknown): SkillStatusReport {
  const payload = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const skills = Array.isArray(payload.skills)
    ? payload.skills.filter((entry): entry is SkillStatusEntry => Boolean(entry && typeof entry === "object" && typeof (entry as SkillStatusEntry).skillKey === "string"))
    : [];

  return {
    workspaceDir: typeof payload.workspaceDir === "string" ? payload.workspaceDir : "",
    managedSkillsDir: typeof payload.managedSkillsDir === "string" ? payload.managedSkillsDir : "",
    skills,
  };
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

export function SkillsPage() {
  const state = useConnectionStore((store) => store.state);
  const isConnected = state === "connected";
  const [filter, setFilter] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, SkillMessage>>({});

  const skillsQuery = useQuery<SkillStatusReport>({
    queryKey: SKILLS_QUERY_KEY,
    enabled: isConnected,
    staleTime: 10_000,
    queryFn: async () => normalizeSkillReport(await gateway.request<unknown>("skills.status")),
  });

  const filteredSkills = useMemo(() => {
    const list = skillsQuery.data?.skills ?? [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((skill) => [skill.name, skill.description, skill.source, skill.skillKey].join(" ").toLowerCase().includes(needle));
  }, [filter, skillsQuery.data]);

  const groups = useMemo(() => groupSkills(filteredSkills), [filteredSkills]);

  async function refreshSkills(clearMessages = false) {
    if (clearMessages) {
      setMessages({});
    }
    await skillsQuery.refetch();
  }

  async function updateSkillEnabled(skillKey: string, enabled: boolean) {
    setBusyKey(skillKey);
    try {
      await gateway.request("skills.update", { skillKey, enabled });
      await refreshSkills();
      setMessages((current) => ({
        ...current,
        [skillKey]: { kind: "success", message: enabled ? "Skill enabled" : "Skill disabled" },
      }));
    } catch (error) {
      setMessages((current) => ({
        ...current,
        [skillKey]: { kind: "error", message: String(error) },
      }));
    } finally {
      setBusyKey(null);
    }
  }

  async function saveSkillApiKey(skillKey: string) {
    setBusyKey(skillKey);
    try {
      await gateway.request("skills.update", { skillKey, apiKey: edits[skillKey] ?? "" });
      await refreshSkills();
      setEdits((current) => ({ ...current, [skillKey]: "" }));
      setMessages((current) => ({
        ...current,
        [skillKey]: { kind: "success", message: "API key saved" },
      }));
    } catch (error) {
      setMessages((current) => ({
        ...current,
        [skillKey]: { kind: "error", message: String(error) },
      }));
    } finally {
      setBusyKey(null);
    }
  }

  async function installSkill(skill: SkillStatusEntry) {
    const installTarget = skill.install[0];
    if (!installTarget) return;

    setBusyKey(skill.skillKey);
    try {
      const result = await gateway.request<{ message?: string }>("skills.install", {
        name: skill.name,
        installId: installTarget.id,
        timeoutMs: 120000,
      });
      await refreshSkills();
      setMessages((current) => ({
        ...current,
        [skill.skillKey]: { kind: "success", message: result.message ?? "Installed" },
      }));
    } catch (error) {
      setMessages((current) => ({
        ...current,
        [skill.skillKey]: { kind: "error", message: String(error) },
      }));
    } finally {
      setBusyKey(null);
    }
  }

  if (!isConnected) {
    return (
      <div className="workspace-empty-state">
        <Wrench size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">Skills</h2>
        <p className="workspace-subtitle">Connect a gateway to inspect, install, and configure workspace skills.</p>
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <div className="workspace-toolbar">
        <div>
          <h2 className="workspace-title">Skills</h2>
          <p className="workspace-subtitle">Gateway-backed workspace skill catalog with enable/disable, install, and API key actions.</p>
        </div>
        <div className="workspace-toolbar__actions">
          <Button variant="secondary" onClick={() => refreshSkills(true)} loading={skillsQuery.isFetching}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        </div>
      </div>

      {skillsQuery.error && <div className="workspace-alert workspace-alert--error">{String(skillsQuery.error)}</div>}

      <Card className="workspace-section">
        <div className="workspace-section__header">
          <div>
            <h3>Workspace Skill Report</h3>
            <p>{skillsQuery.data?.workspaceDir || "Waiting for workspace metadata"}</p>
          </div>
          {skillsQuery.data?.managedSkillsDir && <span className="workspace-meta mono">{skillsQuery.data.managedSkillsDir}</span>}
        </div>

        <div className="session-filters session-filters--logs">
          <label className="session-field">
            <span>Filter</span>
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search skills by name, source, or key" />
          </label>
          <div className="stat-card stat-card--compact">
            <div className="stat-card__label">Shown</div>
            <div className="stat-card__value">{filteredSkills.length}</div>
            <div className="workspace-subcopy">Skills matching the current filter.</div>
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="workspace-empty-inline">No skills matched the current filter.</div>
        ) : (
          <div className="skill-groups">
            {groups.map((group) => (
              <Card key={group.id} className="workspace-section skill-group" padding={false}>
                <div className="workspace-section__header skill-group__header">
                  <div>
                    <h3>{group.label}</h3>
                    <p>{group.skills.length} skills</p>
                  </div>
                </div>

                <div className="skill-grid">
                  {group.skills.map((skill) => {
                    const message = messages[skill.skillKey] ?? null;
                    const missing = computeSkillMissing(skill);
                    const reasons = computeSkillReasons(skill);
                    const busy = busyKey === skill.skillKey;
                    const installTarget = skill.install[0] ?? null;

                    return (
                      <div key={skill.skillKey} className="tool-group skill-card">
                        <div className="tool-group__header">
                          <div>
                            <div className="tool-item__title">{skill.emoji ? `${skill.emoji} ` : ""}{skill.name}</div>
                            <div className="workspace-subcopy">{skill.description || skill.skillKey}</div>
                          </div>
                          <div className="workspace-toolbar__actions">
                            <Button variant="secondary" size="sm" disabled={busy || skill.always} onClick={() => updateSkillEnabled(skill.skillKey, skill.disabled)}>
                              {skill.disabled ? "Enable" : "Disable"}
                            </Button>
                            {installTarget && missing.some((item) => item.startsWith("bin:")) && (
                              <Button size="sm" disabled={busy} onClick={() => installSkill(skill)}>
                                {busy ? "Installing…" : installTarget.label}
                              </Button>
                            )}
                          </div>
                        </div>

                        <div className="detail-pills">
                          <span className="detail-pill">{skill.source}</span>
                          <span className={`detail-pill ${skill.eligible ? "detail-pill--ok" : "detail-pill--warn"}`}>{skill.eligible ? "eligible" : "blocked"}</span>
                          {skill.bundled && <span className="detail-pill">bundled</span>}
                          {skill.disabled && <span className="detail-pill detail-pill--warn">disabled</span>}
                          {skill.always && <span className="detail-pill">always</span>}
                        </div>

                        {missing.length > 0 && <div className="workspace-subcopy">Missing: {missing.join(", ")}</div>}
                        {reasons.length > 0 && <div className="workspace-subcopy">Reason: {reasons.join(", ")}</div>}

                        <div className="detail-columns skill-detail-columns">
                          <div>
                            <h4>Path</h4>
                            <p>{skill.filePath}</p>
                          </div>
                          <div>
                            <h4>Requirements</h4>
                            <p>{[...skill.requirements.bins, ...skill.requirements.env, ...skill.requirements.config].join(", ") || "No extra requirements"}</p>
                          </div>
                          <div>
                            <h4>Install</h4>
                            <p>{skill.install.map((item) => item.label).join(", ") || "No install actions reported"}</p>
                          </div>
                        </div>

                        {skill.primaryEnv && (
                          <div className="skill-key-editor">
                            <label className="session-field">
                              <span>{skill.primaryEnv}</span>
                              <input
                                type="password"
                                value={edits[skill.skillKey] ?? ""}
                                onChange={(event) => setEdits((current) => ({ ...current, [skill.skillKey]: event.target.value }))}
                                placeholder={`Enter ${skill.primaryEnv}`}
                              />
                            </label>
                            <Button size="sm" disabled={busy} onClick={() => saveSkillApiKey(skill.skillKey)}>
                              Save key
                            </Button>
                          </div>
                        )}

                        {message && (
                          <div className={`workspace-alert ${message.kind === "error" ? "workspace-alert--error" : "workspace-alert--info"}`}>
                            {message.message}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
