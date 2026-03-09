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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKeyDown);
    };
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
        <span className="agent-picker-btn__content">
          <Bot size={15} />
          <span className="agent-picker-btn__label">{selected.name}</span>
        </span>
        <span className={`status-dot agent-picker-status ${selected.status === "running" ? "connected" : ""}`} />
      </div>
    );
  }

  return (
    <div className="agent-picker-panel" ref={panelRef}>
      <button
        type="button"
        className="agent-picker-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="chat-agent-picker-menu"
      >
        <span className="agent-picker-btn__content">
          <Bot size={15} />
          <span className="agent-picker-btn__label">{selected.name}</span>
        </span>
        <ChevronDown size={14} className={`agent-picker-btn__chevron ${open ? "is-open" : ""}`} />
      </button>

      {open && (
        <div id="chat-agent-picker-menu" className="agent-picker-menu" role="menu" aria-label="Choose agent">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={`agent-picker-option ${agent.id === selectedAgentId ? "active" : ""}`}
              onClick={() => handleSelect(agent.id)}
              role="menuitemradio"
              aria-checked={agent.id === selectedAgentId}
            >
              <span className="agent-picker-menu__label">
                <span className={`status-dot agent-picker-status ${agent.status === "running" ? "connected" : ""}`} />
                <span className="agent-picker-option__text">{agent.name}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
