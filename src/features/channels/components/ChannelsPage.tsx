import { Radio } from "lucide-react";

export function ChannelsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <Radio size={48} className="text-text-tertiary" />
      <h2 className="text-lg font-semibold text-text-primary">Channels</h2>
      <p className="text-sm text-text-secondary">
        Channel management will be available in Phase 3
      </p>
    </div>
  );
}
