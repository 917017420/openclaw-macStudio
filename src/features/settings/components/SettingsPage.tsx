import { Settings } from "lucide-react";

export function SettingsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <Settings size={48} className="text-text-tertiary" />
      <h2 className="text-lg font-semibold text-text-primary">Settings</h2>
      <p className="text-sm text-text-secondary">
        Application settings will be available in Phase 4
      </p>
    </div>
  );
}
