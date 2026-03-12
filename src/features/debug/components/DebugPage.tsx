import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Bug, Database, RefreshCw, TerminalSquare } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";
import { isChineseLanguage, useAppPreferencesStore } from "@/features/preferences/store";
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
  const language = useAppPreferencesStore((store) => store.language);
  const isChinese = isChineseLanguage(language);
  const copy = isChinese
    ? {
        title: "调试",
        emptySubtitle: "先连接网关，再查看原始快照并发送手动 RPC。",
        subtitle: "原始快照、模型目录、最近事件，以及手动 RPC 控制台。",
        refresh: "刷新",
        snapshots: "快照",
        snapshotsDetail: "状态、健康、心跳以及可用方法元数据。",
        manualRpc: "手动 RPC",
        manualRpcDetail: "使用 JSON 参数发送原始网关方法。",
        method: "方法",
        params: "参数（JSON）",
        runCall: "执行调用",
        models: "模型",
        modelsDetail: "来自 `models.list` 的目录。",
        eventLog: "事件日志",
        eventLogDetail: "桌面客户端捕获到的最新网关事件。",
        noEvents: "暂时还没有捕获到事件。",
        status: "状态",
        statusDetail: "当前 `status` 响应。",
        health: "健康",
        healthDetail: "当前 `health` 响应。",
        lastHeartbeat: "最近心跳",
        lastHeartbeatDetail: "原始 `last-heartbeat` 载荷。",
        waiting: "等待数据",
        updated: (relative: string) => `更新于${relative}`,
      }
    : {
        title: "Debug",
        emptySubtitle: "Connect a gateway to inspect raw snapshots and send manual RPCs.",
        subtitle: "Raw snapshots, model catalog, recent events, and a manual RPC console.",
        refresh: "Refresh",
        snapshots: "Snapshots",
        snapshotsDetail: "Status, health, heartbeat, and available method metadata.",
        manualRpc: "Manual RPC",
        manualRpcDetail: "Send a raw gateway method with JSON params.",
        method: "Method",
        params: "Params (JSON)",
        runCall: "Run Call",
        models: "Models",
        modelsDetail: "Catalog from `models.list`.",
        eventLog: "Event Log",
        eventLogDetail: "Latest gateway events captured by the desktop client.",
        noEvents: "No events captured yet.",
        status: "Status",
        statusDetail: "Current `status` response.",
        health: "Health",
        healthDetail: "Current `health` response.",
        lastHeartbeat: "Last Heartbeat",
        lastHeartbeatDetail: "Raw `last-heartbeat` payload.",
        waiting: "Waiting for data",
        updated: (relative: string) => `Updated ${relative}`,
      };
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
        <h2 className="workspace-title">{copy.title}</h2>
        <p className="workspace-subtitle">{copy.emptySubtitle}</p>
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <div className="workspace-toolbar">
        <div>
          <h2 className="workspace-title">{copy.title}</h2>
          <p className="workspace-subtitle">{copy.subtitle}</p>
        </div>
        <div className="workspace-toolbar__actions">
          <Button variant="secondary" onClick={() => debugQuery.refetch()} loading={debugQuery.isFetching}>
            <RefreshCw size={14} />
            {copy.refresh}
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
              <h3>{copy.snapshots}</h3>
              <p>{copy.snapshotsDetail}</p>
            </div>
            <span className="workspace-meta">
              {debugQuery.data ? copy.updated(formatRelativeTime(debugQuery.data.loadedAt)) : copy.waiting}
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
                  <p>{copy.statusDetail}</p>
                </div>
                <Activity size={16} className="text-text-tertiary" />
              </div>
              <pre className="code-block code-block--compact">{JSON.stringify(debugQuery.data?.status ?? {}, null, 2)}</pre>
            </div>
            <div>
              <div className="workspace-section__header compact">
                <div>
                  <h4>{copy.health}</h4>
                  <p>{copy.healthDetail}</p>
                </div>
                <Database size={16} className="text-text-tertiary" />
              </div>
              <pre className="code-block code-block--compact">{JSON.stringify(debugQuery.data?.health ?? {}, null, 2)}</pre>
            </div>
            <div>
              <div className="workspace-section__header compact">
                <div>
                  <h4>{copy.lastHeartbeat}</h4>
                  <p>{copy.lastHeartbeatDetail}</p>
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
              <h3>{copy.manualRpc}</h3>
              <p>{copy.manualRpcDetail}</p>
            </div>
            <TerminalSquare size={16} className="text-text-tertiary" />
          </div>

          <label className="session-field">
            <span>{copy.method}</span>
            <input value={callMethod} onChange={(event) => setCallMethod(event.target.value)} placeholder="system-presence" />
          </label>

          <label className="session-field">
            <span>{copy.params}</span>
            <textarea className="text-area" value={callParams} onChange={(event) => setCallParams(event.target.value)} rows={8} />
          </label>

          <div className="workspace-toolbar__actions">
            <Button onClick={handleCall}>{copy.runCall}</Button>
          </div>

          {callError && <div className="workspace-alert workspace-alert--error">{callError}</div>}
          {callResult && <pre className="code-block">{callResult}</pre>}
        </Card>
      </div>

      <div className="workspace-grid workspace-grid--wide debug-bottom-grid">
        <Card className="workspace-section">
          <div className="workspace-section__header">
            <div>
              <h3>{copy.models}</h3>
              <p>{copy.modelsDetail}</p>
            </div>
          </div>
          <pre className="code-block">{JSON.stringify(debugQuery.data?.models ?? [], null, 2)}</pre>
        </Card>

        <Card className="workspace-section">
          <div className="workspace-section__header">
            <div>
              <h3>{copy.eventLog}</h3>
              <p>{copy.eventLogDetail}</p>
            </div>
          </div>

          {gateway.recentEvents.length === 0 ? (
            <div className="workspace-empty-inline">{copy.noEvents}</div>
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
