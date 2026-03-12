import { useState } from "react";
import { Plus, Trash2, Wifi, WifiOff } from "lucide-react";
import { Button, Input, Card, StatusBadge } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";
import { useAppPreferencesStore, isChineseLanguage } from "@/features/preferences/store";
import { gateway } from "@/lib/gateway";
import type { GatewayConfig } from "@/lib/gateway/types";

function formatDiagnosticValue(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : "—";
}

export function ConnectionPage() {
  const {
    state,
    error,
    configs,
    activeConfigId,
    addConfig,
    removeConfig,
    connect,
    disconnect,
  } = useConnectionStore();

  const [showForm, setShowForm] = useState(configs.length === 0);
  const [isConnecting, setIsConnecting] = useState(false);
  const runtimeContext = gateway.runtimeContext;
  const handshakeTrace = gateway.recentHandshakeTrace;
  const language = useAppPreferencesStore((store) => store.language);
  const isChinese = isChineseLanguage(language);
  const copy = isChinese
    ? {
        title: "网关连接",
        subtitle: "连接到你的 OpenClaw Gateway 服务",
        runtimeDiagnostics: "运行时诊断",
        runtimeDiagnosticsDetail: "展示当前 Tauri/WebView 环境以及最近一次网关握手轨迹。",
        labels: {
          client: "客户端",
          origin: "WebView 来源",
          href: "WebView 地址",
          protocol: "协议",
          host: "主机",
          baseUri: "基础 URI",
          userAgent: "用户代理",
          platform: "平台",
          tauriDetected: "检测到 Tauri",
          wsOriginHeader: "WS Origin 头",
          transport: "传输层",
        },
        yes: "是",
        no: "否",
        handshakeTrace: "握手轨迹",
        noConnectionAttempts: "暂时还没有捕获到连接尝试。",
        addGateway: "添加网关",
        disconnect: "断开连接",
        connect: "连接",
      }
    : {
        title: "Gateway Connection",
        subtitle: "Connect to your OpenClaw Gateway server",
        runtimeDiagnostics: "Runtime Diagnostics",
        runtimeDiagnosticsDetail: "Active Tauri/WebView context and the latest gateway handshake trace.",
        labels: {
          client: "Client",
          origin: "WebView origin",
          href: "WebView href",
          protocol: "Protocol",
          host: "Host",
          baseUri: "Base URI",
          userAgent: "User agent",
          platform: "Platform",
          tauriDetected: "Tauri detected",
          wsOriginHeader: "WS Origin header",
          transport: "Transport",
        },
        yes: "yes",
        no: "no",
        handshakeTrace: "Handshake trace",
        noConnectionAttempts: "No connection attempts captured yet.",
        addGateway: "Add Gateway",
        disconnect: "Disconnect",
        connect: "Connect",
      };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">
            {copy.title}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            {copy.subtitle}
          </p>
        </div>
        <StatusBadge status={state} size="md" />
      </div>

      {/* Error display */}
      {error && (
        <div className="mb-4 rounded-lg border border-status-error/30 bg-status-error/10 p-3">
          <p className="text-sm text-status-error">
            {error.message}
          </p>
        </div>
      )}

      {/* Connection configs list */}
      <div className="mb-4 space-y-3">
        {configs.map((config) => (
          <GatewayConfigCard
            key={config.id}
            config={config}
            isActive={config.id === activeConfigId}
            isConnected={config.id === activeConfigId && state === "connected"}
            isConnecting={config.id === activeConfigId && isConnecting}
            onConnect={async () => {
              setIsConnecting(true);
              try {
                await connect(config.id);
              } catch {
                // Error handled by store
              } finally {
                setIsConnecting(false);
              }
            }}
            onDisconnect={disconnect}
            onRemove={() => removeConfig(config.id)}
          />
        ))}
      </div>

      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-text-primary">{copy.runtimeDiagnostics}</h3>
        <p className="mt-1 text-xs text-text-secondary">
          {copy.runtimeDiagnosticsDetail}
        </p>

        <div className="mt-4 space-y-2 text-xs">
          <DiagnosticRow label={copy.labels.client} value={`${runtimeContext.clientId} / ${runtimeContext.clientMode}`} />
          <DiagnosticRow label={copy.labels.origin} value={formatDiagnosticValue(runtimeContext.locationOrigin)} />
          <DiagnosticRow label={copy.labels.href} value={formatDiagnosticValue(runtimeContext.locationHref)} />
          <DiagnosticRow label={copy.labels.protocol} value={formatDiagnosticValue(runtimeContext.locationProtocol)} />
          <DiagnosticRow label={copy.labels.host} value={formatDiagnosticValue(runtimeContext.locationHost)} />
          <DiagnosticRow label={copy.labels.baseUri} value={formatDiagnosticValue(runtimeContext.documentBaseUri)} />
          <DiagnosticRow label={copy.labels.userAgent} value={formatDiagnosticValue(runtimeContext.userAgent)} />
          <DiagnosticRow label={copy.labels.platform} value={formatDiagnosticValue(runtimeContext.platform)} />
          <DiagnosticRow label={copy.labels.tauriDetected} value={runtimeContext.tauriDetected ? copy.yes : copy.no} />
          <DiagnosticRow label={copy.labels.wsOriginHeader} value={formatDiagnosticValue(runtimeContext.explicitOriginHeader)} />
          <DiagnosticRow label={copy.labels.transport} value={runtimeContext.socketTransport} />
        </div>

        <div className="mt-4">
          <p className="text-xs font-medium text-text-primary">{copy.handshakeTrace}</p>
          <pre className="code-block code-block--compact mt-2 max-h-64 overflow-auto">{handshakeTrace.length > 0
            ? handshakeTrace
                .map((entry) => {
                  const time = new Date(entry.timestamp).toLocaleTimeString();
                  return `${time}  ${entry.stage}${entry.detail ? `  ${entry.detail}` : ""}`;
                })
                .join("\n")
            : copy.noConnectionAttempts}</pre>
        </div>
      </Card>

      {/* Add new config */}
      {showForm ? (
        <AddConfigForm
          onAdd={(config) => {
            addConfig(config);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <Button
          variant="secondary"
          onClick={() => setShowForm(true)}
          className="w-full"
        >
          <Plus size={16} />
          {copy.addGateway}
        </Button>
      )}
    </div>
  );
}

function DiagnosticRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-b-0 last:pb-0">
      <span className="text-text-secondary">{label}</span>
      <span className="max-w-[65%] break-all text-right font-mono text-text-primary">{value}</span>
    </div>
  );
}

// ---- Sub-components ----

function GatewayConfigCard({
  config,
  isActive,
  isConnected,
  isConnecting,
  onConnect,
  onDisconnect,
  onRemove,
}: {
  config: GatewayConfig;
  isActive: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
}) {
  const language = useAppPreferencesStore((store) => store.language);
  const isChinese = isChineseLanguage(language);
  return (
    <Card active={isActive} className="flex items-center justify-between">
      <div className="flex-1">
        <h3 className="text-sm font-medium text-text-primary">{config.name}</h3>
        <p className="mt-0.5 text-xs text-text-tertiary font-mono">{config.url}</p>
      </div>
      <div className="flex items-center gap-2">
        {isConnected ? (
          <Button variant="secondary" size="sm" onClick={onDisconnect}>
            <WifiOff size={14} />
            {isChinese ? "断开连接" : "Disconnect"}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            loading={isConnecting}
            onClick={onConnect}
          >
            <Wifi size={14} />
            {isChinese ? "连接" : "Connect"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={isActive && isConnected}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </Card>
  );
}

function AddConfigForm({
  onAdd,
  onCancel,
}: {
  onAdd: (config: Omit<GatewayConfig, "id">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("wss://");
  const [token, setToken] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const language = useAppPreferencesStore((store) => store.language);
  const isChinese = isChineseLanguage(language);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = isChinese ? "名称不能为空" : "Name is required";
    if (!url.trim() || (!url.startsWith("wss://") && !url.startsWith("ws://"))) {
      newErrors.url = isChinese ? "请输入有效的 WebSocket 地址（wss:// 或 ws://）" : "Valid WebSocket URL required (wss:// or ws://)";
    }
    if (!token.trim()) newErrors.token = isChinese ? "令牌不能为空" : "Token is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    onAdd({ name: name.trim(), url: url.trim(), token: token.trim() });
  };

  return (
    <Card>
      <h3 className="mb-4 text-sm font-semibold text-text-primary">
        {isChinese ? "添加网关配置" : "Add Gateway Configuration"}
      </h3>
      <div className="space-y-3">
        <Input
          label={isChinese ? "名称" : "Name"}
          placeholder={isChinese ? "我的网关服务" : "My Gateway Server"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <Input
          label={isChinese ? "网关地址" : "Gateway URL"}
          placeholder={isChinese ? "wss://你的服务:18789" : "wss://your-server:18789"}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={errors.url}
          hint={isChinese ? "你的 OpenClaw Gateway WebSocket 地址" : "WebSocket address of your OpenClaw Gateway"}
        />
        <Input
          label={isChinese ? "令牌" : "Token"}
          type="password"
          placeholder={isChinese ? "你的网关令牌" : "Your Gateway token"}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          error={errors.token}
        />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {isChinese ? "取消" : "Cancel"}
        </Button>
        <Button onClick={handleSubmit}>
          {isChinese ? "添加网关" : "Add Gateway"}
        </Button>
      </div>
    </Card>
  );
}
