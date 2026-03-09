import { useState } from "react";
import { Plus, Trash2, Wifi, WifiOff } from "lucide-react";
import { Button, Input, Card, StatusBadge } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";
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

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">
            Gateway Connection
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Connect to your OpenClaw Gateway server
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
        <h3 className="text-sm font-semibold text-text-primary">Runtime Diagnostics</h3>
        <p className="mt-1 text-xs text-text-secondary">
          Active Tauri/WebView context and the latest gateway handshake trace.
        </p>

        <div className="mt-4 space-y-2 text-xs">
          <DiagnosticRow label="Client" value={`${runtimeContext.clientId} / ${runtimeContext.clientMode}`} />
          <DiagnosticRow label="WebView origin" value={formatDiagnosticValue(runtimeContext.locationOrigin)} />
          <DiagnosticRow label="WebView href" value={formatDiagnosticValue(runtimeContext.locationHref)} />
          <DiagnosticRow label="Protocol" value={formatDiagnosticValue(runtimeContext.locationProtocol)} />
          <DiagnosticRow label="Host" value={formatDiagnosticValue(runtimeContext.locationHost)} />
          <DiagnosticRow label="Base URI" value={formatDiagnosticValue(runtimeContext.documentBaseUri)} />
          <DiagnosticRow label="User agent" value={formatDiagnosticValue(runtimeContext.userAgent)} />
          <DiagnosticRow label="Platform" value={formatDiagnosticValue(runtimeContext.platform)} />
          <DiagnosticRow label="Tauri detected" value={runtimeContext.tauriDetected ? "yes" : "no"} />
          <DiagnosticRow label="WS Origin header" value={formatDiagnosticValue(runtimeContext.explicitOriginHeader)} />
          <DiagnosticRow label="Transport" value={runtimeContext.socketTransport} />
        </div>

        <div className="mt-4">
          <p className="text-xs font-medium text-text-primary">Handshake trace</p>
          <pre className="code-block code-block--compact mt-2 max-h-64 overflow-auto">{handshakeTrace.length > 0
            ? handshakeTrace
                .map((entry) => {
                  const time = new Date(entry.timestamp).toLocaleTimeString();
                  return `${time}  ${entry.stage}${entry.detail ? `  ${entry.detail}` : ""}`;
                })
                .join("\n")
            : "No connection attempts captured yet."}</pre>
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
          Add Gateway
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
            Disconnect
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            loading={isConnecting}
            onClick={onConnect}
          >
            <Wifi size={14} />
            Connect
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

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Name is required";
    if (!url.trim() || (!url.startsWith("wss://") && !url.startsWith("ws://"))) {
      newErrors.url = "Valid WebSocket URL required (wss:// or ws://)";
    }
    if (!token.trim()) newErrors.token = "Token is required";
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
        Add Gateway Configuration
      </h3>
      <div className="space-y-3">
        <Input
          label="Name"
          placeholder="My Gateway Server"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <Input
          label="Gateway URL"
          placeholder="wss://your-server:18789"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={errors.url}
          hint="WebSocket address of your OpenClaw Gateway"
        />
        <Input
          label="Token"
          type="password"
          placeholder="Your Gateway token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          error={errors.token}
        />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSubmit}>
          Add Gateway
        </Button>
      </div>
    </Card>
  );
}
