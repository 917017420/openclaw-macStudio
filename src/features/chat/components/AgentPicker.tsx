// AgentPicker — agent selection UI
// Single agent: display directly. Multiple agents: dropdown.

import { memo } from "react";
import { useAgents } from "@/features/chat/hooks/useAgents";
import { useChatStore } from "@/features/chat/store";
import { Bot, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect, useCallback } from "react";

export const AgentPicker = memo(function AgentPicker() {
  const { data: agents, isLoading, error } = useAgents();
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectAgent = useChatStore((s) => s.selectAgent);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Auto-select first agent if none selected
  useEffect(() => {
    if (agents && agents.length > 0 && !selectedAgentId) {
      selectAgent(agents[0].id);
    }
  }, [agents, selectedAgentId, selectAgent]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  const handleSelect = useCallback(
    (agentId: string) => {
      selectAgent(agentId);
      setDropdownOpen(false);
    },
    [selectAgent],
  );

  if (isLoading) {
    return (
      <div className="px-3 py-2 text-xs text-text-tertiary">
        Loading agents…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-2 text-xs text-status-error">
        Failed to load agents: {String(error)}
      </div>
    );
  }

  if (!agents || agents.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-text-tertiary">
        No agents available
      </div>
    );
  }

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  // Single agent — simple display
  if (agents.length === 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <Bot size={16} className="text-primary" />
        <span className="text-sm font-medium text-text-primary">
          {agents[0].name}
        </span>
        <div
          className={cn(
            "ml-auto h-2 w-2 rounded-full",
            agents[0].status === "running" ? "bg-status-running" : "bg-status-idle",
          )}
        />
      </div>
    );
  }

  // Multiple agents — dropdown
  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2"
      >
        <Bot size={16} className="text-primary" />
        <span className="flex-1 truncate text-sm font-medium text-text-primary">
          {selectedAgent?.name ?? "Select agent"}
        </span>
        <ChevronDown
          size={14}
          className={cn(
            "text-text-tertiary transition-transform",
            dropdownOpen && "rotate-180",
          )}
        />
      </button>

      {dropdownOpen && (
        <div className="absolute left-0 right-0 top-full z-10 rounded-lg border border-border bg-surface-0 py-1 shadow-lg">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => handleSelect(agent.id)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                agent.id === selectedAgentId
                  ? "bg-primary-light text-primary"
                  : "text-text-primary hover:bg-surface-2",
              )}
            >
              <span className="flex-1 truncate">{agent.name}</span>
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  agent.status === "running" ? "bg-status-running" : "bg-status-idle",
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
