import { useMemo } from "react";
import { useChatStore } from "@/features/chat/store";
import { useConnectionStore } from "@/features/connection/store";
import type { GatewayConfig } from "@/lib/gateway/types";

function buildControlUiHref(config: GatewayConfig | null, sessionKey: string | null) {
  const hashParams = new URLSearchParams();

  if (config?.url) {
    hashParams.set("gatewayUrl", config.url);
  }
  if (config?.token) {
    hashParams.set("token", config.token);
  }

  const resolvedSessionKey = sessionKey?.trim() || "main";
  hashParams.set("session", resolvedSessionKey);

  const hash = hashParams.toString();
  return hash ? `/control-ui.html#${hash}` : "/control-ui.html";
}

export function ControlUIPage() {
  const configs = useConnectionStore((state) => state.configs);
  const activeConfigId = useConnectionStore((state) => state.activeConfigId);
  const connectionState = useConnectionStore((state) => state.state);
  const selectedSessionId = useChatStore((state) => state.selectedSessionId);

  const activeConfig = useMemo(
    () => configs.find((config) => config.id === activeConfigId) ?? null,
    [activeConfigId, configs],
  );

  const controlUiHref = useMemo(
    () => buildControlUiHref(activeConfig, selectedSessionId),
    [activeConfig, selectedSessionId],
  );

  const handoffSession = selectedSessionId?.trim() || "main";

  return (
    <div className="embedded-control-ui">
      <div className="workspace-toolbar">
        <div>
          <h2 className="workspace-title">Embedded Control UI</h2>
          <p className="workspace-subtitle">
            Advanced OpenClaw dashboard preserved inside the macStudio shell.
          </p>
        </div>
        <a
          className="chat-btn primary"
          href={controlUiHref}
          target="_blank"
          rel="noreferrer"
        >
          Open Standalone
        </a>
      </div>

      <div className="workspace-alert workspace-alert--info">
        {activeConfig
          ? `Handoff synced from ${activeConfig.name} (${connectionState}) · session ${handoffSession}.`
          : "No active gateway selected. Control UI falls back to its own saved settings until you connect one."}
      </div>

      <iframe
        key={controlUiHref}
        title="OpenClaw Control UI"
        src={controlUiHref}
        className="embedded-control-ui__frame"
      />
    </div>
  );
}
