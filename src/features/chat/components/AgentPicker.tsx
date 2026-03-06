import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Bot, ChevronDown } from "lucide-react";
import { useAgents } from "@/features/chat/hooks/useAgents";
import { useChatStore } from "@/features/chat/store";

export const AgentPicker = memo(function AgentPicker() {
  const { data: agents, isLoading, error } = useAgents();
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectAgent = useChatStore((s) => s.selectAgent);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (agents && agents.length > 0 && !selectedAgentId) {
      selectAgent(agents[0].id);
    }
  }, [agents, selectedAgentId, selectAgent]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleSelect = useCallback(
    (agentId: string) => {
      selectAgent(agentId);
      setOpen(false);
    },
    [selectAgent],
  );

  if (isLoading) {
    return <div className="muted">Loading agents...</div>;
  }

  if (error) {
    return <div className="muted">Failed to load agents</div>;
  }

  if (!agents || agents.length === 0) {
    return <div className="muted">No agents available</div>;
  }

  const selected = agents.find((a) => a.id === selectedAgentId) ?? agents[0];

  if (agents.length === 1) {
    return (
      <div className="agent-picker-btn" style={{ cursor: "default" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Bot size={15} />
          <span>{selected.name}</span>
        </span>
        <span className={`status-dot ${selected.status === "running" ? "connected" : ""}`} />
      </div>
    );
  }

  return (
    <div className="agent-picker-panel" ref={panelRef}>
      <button type="button" className="agent-picker-btn" onClick={() => setOpen((v) => !v)}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Bot size={15} />
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selected.name}</span>
        </span>
        <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 140ms" }} />
      </button>

      {open && (
        <div className="agent-picker-menu">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={`agent-picker-option ${agent.id === selectedAgentId ? "active" : ""}`}
              onClick={() => handleSelect(agent.id)}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className={`status-dot ${agent.status === "running" ? "connected" : ""}`} />
                {agent.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
