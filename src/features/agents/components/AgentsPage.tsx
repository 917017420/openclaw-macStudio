import { useEffect, useMemo } from "react";
import { Bot, ArrowRight, Wrench } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, Card, StatusBadge } from "@/components/ui";
import { useAgents } from "@/features/chat/hooks/useAgents";
import { useToolsCatalog } from "@/features/agents/hooks/useToolsCatalog";
import { useConnectionStore } from "@/features/connection/store";
import { useChatStore } from "@/features/chat/store";

function capabilityPills(capabilities: unknown): string[] {
  if (!capabilities || typeof capabilities !== "object") return [];
  const obj = capabilities as Record<string, unknown>;
  const pills: string[] = [];
  if (typeof obj.commandExecution === "string") pills.push(`exec:${obj.commandExecution}`);
  if (obj.webAccess === true) pills.push("web");
  if (obj.fileTools === true) pills.push("files");
  return pills;
}

export function AgentsPage() {
  const navigate = useNavigate();
  const isConnected = useConnectionStore((state) => state.state === "connected");
  const selectedAgentId = useChatStore((state) => state.selectedAgentId);
  const selectAgent = useChatStore((state) => state.selectAgent);
  const selectSession = useChatStore((state) => state.selectSession);
  const setSelectedModel = useChatStore((state) => state.setSelectedModel);

  const agentsQuery = useAgents();
  const agents = agentsQuery.data ?? [];

  useEffect(() => {
    if (!selectedAgentId && agents.length > 0) {
      selectAgent(agents[0].id);
    }
  }, [agents, selectAgent, selectedAgentId]);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  );

  const toolsQuery = useToolsCatalog(activeAgent?.id ?? null);
  const toolsCount = toolsQuery.data?.groups.reduce((count, group) => count + group.tools.length, 0) ?? 0;

  const activateAgent = (agentId: string) => {
    selectAgent(agentId);
    selectSession(null);
    setSelectedModel(null);
  };

  if (!isConnected) {
    return (
      <div className="workspace-empty-state">
        <Bot size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">Agents</h2>
        <p className="workspace-subtitle">Connect a gateway to inspect and switch available agents.</p>
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <div className="workspace-toolbar">
        <div>
          <h2 className="workspace-title">Agents</h2>
          <p className="workspace-subtitle">
            Choose the active agent for chat and inspect its available tools.
          </p>
        </div>
        {activeAgent && (
          <Button
            onClick={() => {
              activateAgent(activeAgent.id);
              navigate("/chat");
            }}
          >
            Open Chat
            <ArrowRight size={14} />
          </Button>
        )}
      </div>

      {agentsQuery.error && (
        <div className="workspace-alert workspace-alert--error">{String(agentsQuery.error)}</div>
      )}

      <div className="workspace-grid workspace-grid--wide">
        <Card className="workspace-section">
          <div className="workspace-section__header">
            <div>
              <h3>Available Agents</h3>
              <p>{agents.length} agent{agents.length === 1 ? "" : "s"} exposed by the gateway.</p>
            </div>
          </div>

          {agentsQuery.isLoading ? (
            <div className="workspace-inline-status">Loading agents…</div>
          ) : agents.length === 0 ? (
            <div className="workspace-empty-inline">No agents were returned from `agents.list`.</div>
          ) : (
            <div className="agent-list">
              {agents.map((agent) => {
                const isActive = agent.id === activeAgent?.id;
                return (
                  <button
                    type="button"
                    key={agent.id}
                    className={`agent-row ${isActive ? "active" : ""}`}
                    onClick={() => activateAgent(agent.id)}
                  >
                    <div className="agent-row__identity">
                      <div className="agent-row__avatar">{agent.name.slice(0, 1).toUpperCase()}</div>
                      <div>
                        <div className="agent-row__title">{agent.name}</div>
                        <div className="workspace-subcopy mono">{agent.id}</div>
                      </div>
                    </div>
                    <StatusBadge status={agent.status} />
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="workspace-section">
          <div className="workspace-section__header">
            <div>
              <h3>{activeAgent?.name ?? "Agent Details"}</h3>
              <p>{activeAgent?.description ?? "Select an agent to inspect it."}</p>
            </div>
            <StatusBadge status={activeAgent?.status ?? "idle"} />
          </div>

          {activeAgent ? (
            <>
              <div className="detail-pills">
                {capabilityPills(activeAgent.capabilities).length > 0 ? (
                  capabilityPills(activeAgent.capabilities).map((pill) => (
                    <span key={pill} className="detail-pill">{pill}</span>
                  ))
                ) : (
                  <span className="workspace-subcopy">No capabilities metadata reported.</span>
                )}
              </div>

              <div className="workspace-section__header compact">
                <div>
                  <h4>Tool Catalog</h4>
                  <p>{toolsCount} tools currently visible for this agent.</p>
                </div>
                <Wrench size={16} className="text-text-tertiary" />
              </div>

              {toolsQuery.isLoading ? (
                <div className="workspace-inline-status">Loading tools…</div>
              ) : toolsQuery.data && toolsQuery.data.groups.length > 0 ? (
                <div className="tool-groups">
                  {toolsQuery.data.groups.map((group) => (
                    <div key={group.id} className="tool-group">
                      <div className="tool-group__header">
                        <strong>{group.label}</strong>
                        <span className="workspace-subcopy">{group.tools.length} tools</span>
                      </div>
                      <div className="tool-group__items">
                        {group.tools.map((tool) => (
                          <div key={tool.id} className="tool-item">
                            <div className="tool-item__title">{tool.label}</div>
                            <div className="workspace-subcopy">{tool.description || tool.id}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="workspace-empty-inline">No tool catalog returned for this agent.</div>
              )}
            </>
          ) : (
            <div className="workspace-empty-inline">Select an agent to inspect it.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
