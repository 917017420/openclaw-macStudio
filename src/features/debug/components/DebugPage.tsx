import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Bug, Database, RefreshCw, TerminalSquare } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";
import { gateway } from "@/lib/gateway";
import { formatRelativeTime } from "@/lib/utils";

type DebugSnapshot = {
  status: Record<string, unknown> | null;
  health: Record<string, unknown> | null;
  models: unknown[];
  heartbeat: unknown;
  loadedAt: number;
};

const DEBUG_QUERY_KEY = ["gateway-debug"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function loadDebug(): Promise<DebugSnapshot> {
  const [status, health, models, heartbeat] = await Promise.all([
    gateway.request<unknown>("status"),
    gateway.request<unknown>("health"),
    gateway.request<unknown>("models.list"),
    gateway.request<unknown>("last-heartbeat"),
  ]);

  const modelPayload = asRecord(models);
  return {
    status: asRecord(status),
    health: asRecord(health),
    models: Array.isArray(modelPayload?.models) ? modelPayload.models : [],
    heartbeat,
    loadedAt: Date.now(),
  };
}

export function DebugPage() {
  const state = useConnectionStore((store) => store.state);
  const isConnected = state === "connected";
  const [callMethod, setCallMethod] = useState("system-presence");
  const [callParams, setCallParams] = useState("{}");
  const [callResult, setCallResult] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [, setEventTick] = useState(0);

  const debugQuery = useQuery<DebugSnapshot>({
    queryKey: DEBUG_QUERY_KEY,
    enabled: isConnected,
    staleTime: 10_000,
    refetchInterval: 20_000,
    queryFn: loadDebug,
  });

  useEffect(() => {
    const subscription = gateway.on("*", () => {
      setEventTick((value) => value + 1);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleCall() {
    setCallResult(null);
    setCallError(null);

    try {
      const params = callParams.trim() ? JSON.parse(callParams) : {};
      const result = await gateway.request(callMethod.trim(), params as Record<string, unknown>);
      setCallResult(JSON.stringify(result, null, 2));
    } catch (error) {
      setCallError(String(error));
    }
  }

  if (!isConnected) {
    return (
      <div className="workspace-empty-state">
        <Bug size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">Debug</h2>
        <p className="workspace-subtitle">Connect a gateway to inspect raw snapshots and send manual RPCs.</p>
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <div className="workspace-toolbar">
        <div>
          <h2 className="workspace-title">Debug</h2>
          <p className="workspace-subtitle">Raw snapshots, model catalog, recent events, and a manual RPC console.</p>
        </div>
        <div className="workspace-toolbar__actions">
          <Button variant="secondary" onClick={() => debugQuery.refetch()} loading={debugQuery.isFetching}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        </div>
      </div>

      {debugQuery.error && (
        <div className="workspace-alert workspace-alert--error">{String(debugQuery.error)}</div>
      )}

      <div className="workspace-grid workspace-grid--wide">
        <Card className="workspace-section">
          <div className="workspace-section__header">
            <div>
              <h3>Snapshots</h3>
              <p>Status, health, heartbeat, and available method metadata.</p>
            </div>
            <span className="workspace-meta">
              {debugQuery.data ? `Updated ${formatRelativeTime(debugQuery.data.loadedAt)}` : "Waiting for data"}
            </span>
          </div>

          <div className="detail-pills">
            <span className="detail-pill">methods: {gateway.authResult?.methods.length ?? 0}</span>
            <span className="detail-pill">events: {gateway.authResult?.events.length ?? 0}</span>
            <span className="detail-pill">event log: {gateway.recentEvents.length}</span>
          </div>

          <div className="debug-panels">
            <div>
              <div className="workspace-section__header compact">
                <div>
                  <h4>Status</h4>
                  <p>Current `status` response.</p>
                </div>
                <Activity size={16} className="text-text-tertiary" />
              </div>
              <pre className="code-block code-block--compact">{JSON.stringify(debugQuery.data?.status ?? {}, null, 2)}</pre>
            </div>
            <div>
              <div className="workspace-section__header compact">
                <div>
                  <h4>Health</h4>
                  <p>Current `health` response.</p>
                </div>
                <Database size={16} className="text-text-tertiary" />
              </div>
              <pre className="code-block code-block--compact">{JSON.stringify(debugQuery.data?.health ?? {}, null, 2)}</pre>
            </div>
            <div>
              <div className="workspace-section__header compact">
                <div>
                  <h4>Last Heartbeat</h4>
                  <p>Raw `last-heartbeat` payload.</p>
                </div>
                <RefreshCw size={16} className="text-text-tertiary" />
              </div>
              <pre className="code-block code-block--compact">{JSON.stringify(debugQuery.data?.heartbeat ?? {}, null, 2)}</pre>
            </div>
          </div>
        </Card>

        <Card className="workspace-section">
          <div className="workspace-section__header">
            <div>
              <h3>Manual RPC</h3>
              <p>Send a raw gateway method with JSON params.</p>
            </div>
            <TerminalSquare size={16} className="text-text-tertiary" />
          </div>

          <label className="session-field">
            <span>Method</span>
            <input value={callMethod} onChange={(event) => setCallMethod(event.target.value)} placeholder="system-presence" />
          </label>

          <label className="session-field">
            <span>Params (JSON)</span>
            <textarea className="text-area" value={callParams} onChange={(event) => setCallParams(event.target.value)} rows={8} />
          </label>

          <div className="workspace-toolbar__actions">
            <Button onClick={handleCall}>Run Call</Button>
          </div>

          {callError && <div className="workspace-alert workspace-alert--error">{callError}</div>}
          {callResult && <pre className="code-block">{callResult}</pre>}
        </Card>
      </div>

      <div className="workspace-grid workspace-grid--wide debug-bottom-grid">
        <Card className="workspace-section">
          <div className="workspace-section__header">
            <div>
              <h3>Models</h3>
              <p>Catalog from `models.list`.</p>
            </div>
          </div>
          <pre className="code-block">{JSON.stringify(debugQuery.data?.models ?? [], null, 2)}</pre>
        </Card>

        <Card className="workspace-section">
          <div className="workspace-section__header">
            <div>
              <h3>Event Log</h3>
              <p>Latest gateway events captured by the desktop client.</p>
            </div>
          </div>

          {gateway.recentEvents.length === 0 ? (
            <div className="workspace-empty-inline">No events captured yet.</div>
          ) : (
            <div className="event-log-list">
              {gateway.recentEvents.slice().reverse().map((event) => (
                <div key={`${event.event}-${event.time}`} className="event-log-row">
                  <div>
                    <div className="tool-item__title">{event.event}</div>
                    <div className="workspace-subcopy">{formatRelativeTime(event.time)}</div>
                  </div>
                  <div className="workspace-subcopy mono">{new Date(event.time).toLocaleTimeString()}</div>
                  <pre className="code-block code-block--compact">{event.payloadSnippet}</pre>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
