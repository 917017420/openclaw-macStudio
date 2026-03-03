import { Bot } from "lucide-react";

export function AgentsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <Bot size={48} className="text-text-tertiary" />
      <h2 className="text-lg font-semibold text-text-primary">Agents</h2>
      <p className="text-sm text-text-secondary">
        Agent management will be available in Phase 3
      </p>
    </div>
  );
}
