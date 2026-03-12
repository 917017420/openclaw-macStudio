import { useMemo } from "react";
import { useChatStore } from "@/features/chat/store";
import { useConnectionStore } from "@/features/connection/store";
import { isChineseLanguage, useAppPreferencesStore } from "@/features/preferences/store";
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
  const language = useAppPreferencesStore((store) => store.language);
  const isChinese = isChineseLanguage(language);

  const activeConfig = useMemo(
    () => configs.find((config) => config.id === activeConfigId) ?? null,
    [activeConfigId, configs],
  );

  const controlUiHref = useMemo(
    () => buildControlUiHref(activeConfig, selectedSessionId),
    [activeConfig, selectedSessionId],
  );

  const handoffSession = selectedSessionId?.trim() || "main";
  const copy = isChinese
    ? {
        title: "嵌入式控制界面",
        subtitle: "保留在 macStudio 外壳中的高级 OpenClaw 仪表盘。",
        openStandalone: "单独打开",
        handoff: (name: string, state: string, session: string) => `已从 ${name}（${state}）同步接管 · 会话 ${session}。`,
        noGateway: "当前没有活动网关。Control UI 会先回退到自己的已保存设置，直到你连接网关。",
        iframeTitle: "OpenClaw 控制界面",
      }
    : {
        title: "Embedded Control UI",
        subtitle: "Advanced OpenClaw dashboard preserved inside the macStudio shell.",
        openStandalone: "Open Standalone",
        handoff: (name: string, state: string, session: string) => `Handoff synced from ${name} (${state}) · session ${session}.`,
        noGateway: "No active gateway selected. Control UI falls back to its own saved settings until you connect one.",
        iframeTitle: "OpenClaw Control UI",
      };

  return (
    <div className="embedded-control-ui">
      <div className="workspace-toolbar">
        <div>
          <h2 className="workspace-title">{copy.title}</h2>
          <p className="workspace-subtitle">{copy.subtitle}</p>
        </div>
        <a
          className="chat-btn primary"
          href={controlUiHref}
          target="_blank"
          rel="noreferrer"
        >
          {copy.openStandalone}
        </a>
      </div>

      <div className="workspace-alert workspace-alert--info">
        {activeConfig
          ? copy.handoff(activeConfig.name, connectionState, handoffSession)
          : copy.noGateway}
      </div>

      <iframe
        key={controlUiHref}
        title={copy.iframeTitle}
        src={controlUiHref}
        className="embedded-control-ui__frame"
      />
    </div>
  );
}
