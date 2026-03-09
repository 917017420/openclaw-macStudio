import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, Send, Settings } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, StatusBadge } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";
import { useChatStore } from "@/features/chat/store";
import { gateway } from "@/lib/gateway";
import { formatRelativeTime, truncate } from "@/lib/utils";

interface ConfigSnapshotIssue {
  path: string;
  message: string;
}

interface ConfigSnapshot {
  path?: string | null;
  exists?: boolean | null;
  raw?: string | null;
  hash?: string | null;
  valid?: boolean | null;
  config?: Record<string, unknown> | null;
  issues?: ConfigSnapshotIssue[] | null;
}

const CONFIG_QUERY_KEY = ["gateway-config"] as const;

function normalizeConfigSnapshot(raw: unknown): ConfigSnapshot {
  if (!raw || typeof raw !== "object") {
    return { raw: null, hash: null, valid: null, config: null, issues: [] };
  }
  const obj = raw as Record<string, unknown>;
  return {
    path: typeof obj.path === "string" ? obj.path : null,
    exists: typeof obj.exists === "boolean" ? obj.exists : null,
    raw: typeof obj.raw === "string" ? obj.raw : null,
    hash: typeof obj.hash === "string" ? obj.hash : null,
    valid: typeof obj.valid === "boolean" ? obj.valid : null,
    config: obj.config && typeof obj.config === "object" ? obj.config as Record<string, unknown> : null,
    issues: Array.isArray(obj.issues)
      ? obj.issues
          .filter((issue): issue is Record<string, unknown> => Boolean(issue && typeof issue === "object"))
          .map((issue) => ({
            path: typeof issue.path === "string" ? issue.path : "(unknown)",
            message: typeof issue.message === "string" ? issue.message : JSON.stringify(issue),
          }))
      : [],
  };
}

function serializeSnapshot(snapshot: ConfigSnapshot | undefined): string {
  if (!snapshot) return "";
  if (snapshot.raw) return snapshot.raw;
  if (snapshot.config) return JSON.stringify(snapshot.config, null, 2);
  return "";
}

export function SettingsPage() {
  const state = useConnectionStore((store) => store.state);
  const configs = useConnectionStore((store) => store.configs);
  const activeConfigId = useConnectionStore((store) => store.activeConfigId);
  const selectedSessionId = useChatStore((store) => store.selectedSessionId);
  const [draft, setDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"save" | "apply" | null>(null);

  const activeConfig = useMemo(
    () => configs.find((config) => config.id === activeConfigId) ?? null,
    [activeConfigId, configs],
  );

  const configQuery = useQuery<ConfigSnapshot>({
    queryKey: CONFIG_QUERY_KEY,
    enabled: state === "connected",
    staleTime: 15_000,
    queryFn: async () => {
      const result = await gateway.request<unknown>("config.get");
      return normalizeConfigSnapshot(result);
    },
  });

  useEffect(() => {
    setDraft(serializeSnapshot(configQuery.data));
  }, [configQuery.data]);

  async function persistConfig(mode: "save" | "apply") {
    const snapshot = configQuery.data;
    if (!snapshot?.hash) {
      setSaveError("Config hash missing. Reload the config and retry.");
      return;
    }

    setBusyAction(mode);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      if (mode === "save") {
        await gateway.request("config.set", {
          raw: draft,
          baseHash: snapshot.hash,
        });
        setSaveSuccess("Config saved to disk.");
      } else {
        await gateway.request("config.apply", {
          raw: draft,
          baseHash: snapshot.hash,
          sessionKey: selectedSessionId ?? "main",
        });
        setSaveSuccess(`Config applied using session ${selectedSessionId ?? "main"}.`);
      }

      await configQuery.refetch();
    } catch (error) {
      setSaveError(String(error));
    } finally {
      setBusyAction(null);
    }
  }

  const authMethods = gateway.authResult?.methods ?? [];
  const authEvents = gateway.authResult?.events ?? [];
  const authScopes = activeConfig?.scopes ?? [];
  const recentEvents = gateway.recentEvents;

  if (state !== "connected") {
    return (
      <div className="workspace-empty-state">
        <Settings size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">Settings</h2>
        <p className="workspace-subtitle">Connect a gateway to load config, auth metadata, and event diagnostics.</p>
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <div className="workspace-toolbar">
        <div>
          <h2 className="workspace-title">Gateway Settings</h2>
          <p className="workspace-subtitle">
            Edit raw gateway config and inspect live connection diagnostics from the desktop client.
          </p>
        </div>
        <div className="workspace-toolbar__actions">
          <Button variant="secondary" onClick={() => configQuery.refetch()} loading={configQuery.isFetching}>
            <RefreshCw size={14} />
            Reload
          </Button>
          <Button onClick={() => persistConfig("save")} loading={busyAction === "save"}>
            <Save size={14} />
            Save
          </Button>
          <Button variant="secondary" onClick={() => persistConfig("apply")} loading={busyAction === "apply"}>
            <Send size={14} />
            Apply
          </Button>
        </div>
      </div>

      {configQuery.error && (
        <div className="workspace-alert workspace-alert--error">{String(configQuery.error)}</div>
      )}
      {saveError && <div className="workspace-alert workspace-alert--error">{saveError}</div>}
      {saveSuccess && <div className="workspace-alert workspace-alert--info">{saveSuccess}</div>}

      <div className="workspace-grid workspace-grid--wide">
        <Card className="workspace-section">
          <div className="workspace-section__header">
            <div>
              <h3>Raw Config</h3>
              <p>
                {configQuery.data?.path ?? "gateway config"}
                {configQuery.data?.exists === false ? " · file missing" : ""}
              </p>
            </div>
            <StatusBadge
              status={configQuery.data?.valid === false ? "error" : "connected"}
              label={configQuery.data?.valid === false ? "Invalid" : "Ready"}
            />
          </div>

          <textarea
            className="config-editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            placeholder="Gateway config will appear here after config.get succeeds"
          />

          {configQuery.data?.issues && configQuery.data.issues.length > 0 && (
            <div className="issue-list">
              {configQuery.data.issues.map((issue, index) => (
                <div key={`${issue.path}-${index}`} className="issue-row">
                  <strong>{issue.path}</strong>
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="workspace-section">
          <div className="workspace-section__header">
            <div>
              <h3>Client Diagnostics</h3>
              <p>Connection metadata exposed by the Tauri gateway client.</p>
            </div>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-card__label">Gateway</span>
              <span className="stat-card__value">{truncate(activeConfig?.url ?? "not configured", 48)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-card__label">State</span>
              <span className="stat-card__value">{state}</span>
            </div>
            <div className="stat-card">
              <span className="stat-card__label">Events Seen</span>
              <span className="stat-card__value">{gateway.eventCount}</span>
            </div>
            <div className="stat-card">
              <span className="stat-card__label">Last Event</span>
              <span className="stat-card__value">
                {gateway.lastEventAt ? formatRelativeTime(gateway.lastEventAt) : "never"}
              </span>
            </div>
          </div>

          <div className="detail-columns">
            <div>
              <h4>Scopes</h4>
              <div className="detail-pills">
                {authScopes.length > 0
                  ? authScopes.map((scope) => <span key={scope} className="detail-pill">{scope}</span>)
                  : <span className="workspace-subcopy">No scopes reported.</span>}
              </div>
            </div>
            <div>
              <h4>Methods</h4>
              <div className="detail-list mono">
                {authMethods.length > 0
                  ? authMethods.map((method) => <span key={method}>{method}</span>)
                  : <span className="workspace-subcopy">No advertised method list.</span>}
              </div>
            </div>
            <div>
              <h4>Events</h4>
              <div className="detail-list mono">
                {authEvents.length > 0
                  ? authEvents.map((event) => <span key={event}>{event}</span>)
                  : <span className="workspace-subcopy">No advertised event list.</span>}
              </div>
            </div>
          </div>

          <div>
            <h4>Recent Gateway Events</h4>
            {recentEvents.length === 0 ? (
              <div className="workspace-empty-inline">No gateway events captured yet.</div>
            ) : (
              <div className="event-log-list mono">
                {recentEvents.map((entry, index) => (
                  <div key={`${entry.event}-${entry.time}-${index}`} className="event-log-row">
                    <span>{entry.event}</span>
                    <span>{formatRelativeTime(entry.time)}</span>
                    <span>{truncate(entry.payloadSnippet, 120)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
