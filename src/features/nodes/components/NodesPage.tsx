import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  Cpu,
  KeyRound,
  Network,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button, Card, StatusBadge } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";
import { gateway } from "@/lib/gateway";
import { formatRelativeTime, truncate } from "@/lib/utils";

type NodeEntry = {
  nodeId: string;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  remoteIp?: string;
  caps?: string[];
  commands?: string[];
  permissions?: unknown;
  connectedAtMs?: number;
  paired?: boolean;
  connected?: boolean;
};

type NodesSnapshot = {
  ts: number;
  nodes: NodeEntry[];
};

type DeviceTokenSummary = {
  role: string;
  scopes?: string[];
  createdAtMs?: number;
  rotatedAtMs?: number;
  revokedAtMs?: number;
  lastUsedAtMs?: number;
};

type PendingDevice = {
  requestId: string;
  deviceId: string;
  displayName?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  isRepair?: boolean;
  ts?: number;
};

type PairedDevice = {
  deviceId: string;
  displayName?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  tokens?: DeviceTokenSummary[];
  createdAtMs?: number;
  approvedAtMs?: number;
};

type DevicePairingList = {
  pending: PendingDevice[];
  paired: PairedDevice[];
};

type ExecApprovalsDefaults = {
  security?: string;
  ask?: string;
  askFallback?: string;
  autoAllowSkills?: boolean;
};

type ExecApprovalsAllowlistEntry = {
  id?: string;
  pattern: string;
  lastUsedAt?: number;
  lastUsedCommand?: string;
  lastResolvedPath?: string;
};

type ExecApprovalsAgent = ExecApprovalsDefaults & {
  allowlist?: ExecApprovalsAllowlistEntry[];
};

type ExecApprovalsFile = {
  version?: number;
  socket?: { path?: string };
  defaults?: ExecApprovalsDefaults;
  agents?: Record<string, ExecApprovalsAgent>;
};

type ExecApprovalsSnapshot = {
  path: string;
  exists: boolean;
  hash: string;
  file: ExecApprovalsFile;
};

type RotatedToken = {
  deviceId: string;
  role: string;
  token: string;
};

const NODES_QUERY_KEY = ["gateway-nodes"] as const;
const DEVICES_QUERY_KEY = ["gateway-devices"] as const;
const EXEC_APPROVALS_QUERY_KEY = ["gateway-exec-approvals"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return entries.length > 0 ? entries : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeNodesSnapshot(raw: unknown): NodesSnapshot {
  const payload = asRecord(raw) ?? {};
  const nodes = Array.isArray(payload.nodes)
    ? payload.nodes.filter(
        (entry): entry is NodeEntry =>
          Boolean(entry && typeof entry === "object" && typeof (entry as NodeEntry).nodeId === "string"),
      )
    : [];

  return {
    ts: typeof payload.ts === "number" ? payload.ts : Date.now(),
    nodes,
  };
}

function normalizeDeviceTokenSummary(raw: unknown): DeviceTokenSummary | null {
  const token = asRecord(raw);
  const role = readString(token?.role);
  if (!role) {
    return null;
  }

  return {
    role,
    scopes: asStringArray(token?.scopes),
    createdAtMs: readNumber(token?.createdAtMs),
    rotatedAtMs: readNumber(token?.rotatedAtMs),
    revokedAtMs: readNumber(token?.revokedAtMs),
    lastUsedAtMs: readNumber(token?.lastUsedAtMs),
  };
}

function normalizePendingDevice(raw: unknown): PendingDevice | null {
  const request = asRecord(raw);
  const requestId = readString(request?.requestId);
  const deviceId = readString(request?.deviceId);
  if (!requestId || !deviceId) {
    return null;
  }

  return {
    requestId,
    deviceId,
    displayName: readString(request?.displayName),
    role: readString(request?.role),
    roles: asStringArray(request?.roles),
    scopes: asStringArray(request?.scopes),
    remoteIp: readString(request?.remoteIp),
    isRepair: readBoolean(request?.isRepair),
    ts: readNumber(request?.ts),
  };
}

function normalizePairedDevice(raw: unknown): PairedDevice | null {
  const device = asRecord(raw);
  const deviceId = readString(device?.deviceId);
  if (!deviceId) {
    return null;
  }

  const tokens = Array.isArray(device?.tokens)
    ? device.tokens.map(normalizeDeviceTokenSummary).filter((entry): entry is DeviceTokenSummary => Boolean(entry))
    : undefined;

  return {
    deviceId,
    displayName: readString(device?.displayName),
    roles: asStringArray(device?.roles),
    scopes: asStringArray(device?.scopes),
    remoteIp: readString(device?.remoteIp),
    tokens,
    createdAtMs: readNumber(device?.createdAtMs),
    approvedAtMs: readNumber(device?.approvedAtMs),
  };
}

function normalizeDevicePairingList(raw: unknown): DevicePairingList {
  const payload = asRecord(raw) ?? {};

  return {
    pending: Array.isArray(payload.pending)
      ? payload.pending.map(normalizePendingDevice).filter((entry): entry is PendingDevice => Boolean(entry))
      : [],
    paired: Array.isArray(payload.paired)
      ? payload.paired.map(normalizePairedDevice).filter((entry): entry is PairedDevice => Boolean(entry))
      : [],
  };
}

function normalizeExecApprovalsSnapshot(raw: unknown): ExecApprovalsSnapshot {
  const payload = asRecord(raw) ?? {};
  const file = asRecord(payload.file) ?? {};

  return {
    path: readString(payload.path) ?? "exec-approvals.json",
    exists: readBoolean(payload.exists) ?? false,
    hash: readString(payload.hash) ?? "",
    file: file as ExecApprovalsFile,
  };
}

function formatWhen(timestamp?: number | null) {
  return timestamp ? formatRelativeTime(timestamp) : "n/a";
}

function supportsExecApprovals(node: NodeEntry) {
  const commands = new Set(node.commands ?? []);
  return commands.has("system.execApprovals.get") && commands.has("system.execApprovals.set");
}

function summarizeRoles(device: PendingDevice | PairedDevice) {
  const values = new Set<string>();

  if (device.role) {
    values.add(device.role);
  }
  for (const role of device.roles ?? []) {
    if (role.trim()) {
      values.add(role);
    }
  }
  for (const token of device.tokens ?? []) {
    if (token.role.trim()) {
      values.add(token.role);
    }
  }

  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function countTokenEntries(devices: PairedDevice[]) {
  return devices.reduce((count, device) => count + (device.tokens?.length ?? 0), 0);
}

async function copyToClipboard(value: string) {
  if (!navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function NodesPage() {
  const state = useConnectionStore((store) => store.state);
  const isConnected = state === "connected";

  const [deviceActionBusy, setDeviceActionBusy] = useState<string | null>(null);
  const [deviceActionError, setDeviceActionError] = useState<string | null>(null);
  const [deviceActionSuccess, setDeviceActionSuccess] = useState<string | null>(null);
  const [rotatedToken, setRotatedToken] = useState<RotatedToken | null>(null);

  const [execTargetKind, setExecTargetKind] = useState<"gateway" | "node">("gateway");
  const [execTargetNodeId, setExecTargetNodeId] = useState<string | null>(null);
  const [execDraft, setExecDraft] = useState("");
  const [execDirty, setExecDirty] = useState(false);
  const [execSaving, setExecSaving] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [execSuccess, setExecSuccess] = useState<string | null>(null);

  const nodesQuery = useQuery<NodesSnapshot>({
    queryKey: NODES_QUERY_KEY,
    enabled: isConnected,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async () => normalizeNodesSnapshot(await gateway.request<unknown>("node.list")),
  });

  const devicesQuery = useQuery<DevicePairingList>({
    queryKey: DEVICES_QUERY_KEY,
    enabled: isConnected,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async () => normalizeDevicePairingList(await gateway.request<unknown>("device.pair.list", {})),
  });

  const execTargetNodes = useMemo(
    () => (nodesQuery.data?.nodes ?? []).filter(supportsExecApprovals),
    [nodesQuery.data?.nodes],
  );

  useEffect(() => {
    if (execTargetKind !== "node") {
      return;
    }
    if (execTargetNodeId && execTargetNodes.some((node) => node.nodeId === execTargetNodeId)) {
      return;
    }
    setExecTargetNodeId(execTargetNodes[0]?.nodeId ?? null);
  }, [execTargetKind, execTargetNodeId, execTargetNodes]);

  const execTargetReady = execTargetKind === "gateway" || Boolean(execTargetNodeId);

  const execQuery = useQuery<ExecApprovalsSnapshot>({
    queryKey: [...EXEC_APPROVALS_QUERY_KEY, execTargetKind, execTargetNodeId],
    enabled: isConnected && execTargetReady,
    staleTime: 60_000,
    queryFn: async () =>
      normalizeExecApprovalsSnapshot(
        await gateway.request<unknown>(
          execTargetKind === "gateway" ? "exec.approvals.get" : "exec.approvals.node.get",
          execTargetKind === "gateway" ? {} : { nodeId: execTargetNodeId },
        ),
      ),
  });

  useEffect(() => {
    if (!execQuery.data) {
      return;
    }
    setExecDraft(JSON.stringify(execQuery.data.file ?? {}, null, 2));
    setExecDirty(false);
    setExecError(null);
    setExecSuccess(null);
  }, [execQuery.data]);

  const nodeSummary = useMemo(() => {
    const nodes = nodesQuery.data?.nodes ?? [];
    return {
      total: nodes.length,
      connected: nodes.filter((node) => node.connected).length,
      paired: nodes.filter((node) => node.paired).length,
      commands: nodes.reduce((count, node) => count + (node.commands?.length ?? 0), 0),
    };
  }, [nodesQuery.data]);

  const deviceSummary = useMemo(() => {
    const pending = devicesQuery.data?.pending ?? [];
    const paired = devicesQuery.data?.paired ?? [];
    return {
      pending: pending.length,
      paired: paired.length,
      tokens: countTokenEntries(paired),
    };
  }, [devicesQuery.data]);

  const execSummary = useMemo(() => {
    const file = execQuery.data?.file;
    const defaults = file?.defaults ?? {};
    return {
      agentOverrides: Object.keys(file?.agents ?? {}).length,
      security: defaults.security ?? "deny",
      ask: defaults.ask ?? "on-miss",
      autoAllowSkills: defaults.autoAllowSkills === true,
    };
  }, [execQuery.data]);

  const refreshAll = async () => {
    await Promise.all([
      nodesQuery.refetch(),
      devicesQuery.refetch(),
      execTargetReady ? execQuery.refetch() : Promise.resolve(),
    ]);
  };

  const runDeviceAction = async (actionKey: string, task: () => Promise<void>) => {
    setDeviceActionBusy(actionKey);
    setDeviceActionError(null);
    setDeviceActionSuccess(null);
    setRotatedToken(null);

    try {
      await task();
      await devicesQuery.refetch();
    } catch (error) {
      setDeviceActionError(String(error));
    } finally {
      setDeviceActionBusy(null);
    }
  };

  const approvePendingDevice = async (requestId: string) => {
    await runDeviceAction(`approve:${requestId}`, async () => {
      await gateway.request("device.pair.approve", { requestId });
      setDeviceActionSuccess("Device pairing approved.");
    });
  };

  const rejectPendingDevice = async (requestId: string) => {
    if (!window.confirm("Reject this device pairing request?")) {
      return;
    }

    await runDeviceAction(`reject:${requestId}`, async () => {
      await gateway.request("device.pair.reject", { requestId });
      setDeviceActionSuccess("Device pairing request rejected.");
    });
  };

  const rotateDeviceToken = async (device: PairedDevice, role: string, scopes?: string[]) => {
    await runDeviceAction(`rotate:${device.deviceId}:${role}`, async () => {
      const result = await gateway.request<{ token?: string; role?: string }>("device.token.rotate", {
        deviceId: device.deviceId,
        role,
        scopes,
      });

      const token = readString(result.token);
      if (token) {
        const copied = await copyToClipboard(token);
        setRotatedToken({
          deviceId: device.deviceId,
          role: result.role ?? role,
          token,
        });
        setDeviceActionSuccess(copied ? "Rotated token copied to clipboard." : "Rotated token ready to copy.");
      } else {
        setDeviceActionSuccess("Device token rotated.");
      }
    });
  };

  const revokeDeviceToken = async (device: PairedDevice, role: string) => {
    if (!window.confirm(`Revoke token for ${device.displayName ?? device.deviceId} (${role})?`)) {
      return;
    }

    await runDeviceAction(`revoke:${device.deviceId}:${role}`, async () => {
      await gateway.request("device.token.revoke", { deviceId: device.deviceId, role });
      setDeviceActionSuccess("Device token revoked.");
    });
  };

  const removeDevice = async (device: PairedDevice) => {
    if (!window.confirm(`Remove paired device ${device.displayName ?? device.deviceId}?`)) {
      return;
    }

    await runDeviceAction(`remove:${device.deviceId}`, async () => {
      await gateway.request("device.pair.remove", { deviceId: device.deviceId });
      setDeviceActionSuccess("Paired device removed.");
    });
  };

  const resetExecDraft = () => {
    if (!execQuery.data) {
      return;
    }
    setExecDraft(JSON.stringify(execQuery.data.file ?? {}, null, 2));
    setExecDirty(false);
    setExecError(null);
    setExecSuccess(null);
  };

  const saveExecApprovals = async () => {
    if (!execQuery.data) {
      return;
    }

    setExecSaving(true);
    setExecError(null);
    setExecSuccess(null);

    try {
      const file = JSON.parse(execDraft) as ExecApprovalsFile;
      const response = await gateway.request<unknown>(
        execTargetKind === "gateway" ? "exec.approvals.set" : "exec.approvals.node.set",
        execTargetKind === "gateway"
          ? { file, baseHash: execQuery.data.hash }
          : { nodeId: execTargetNodeId, file, baseHash: execQuery.data.hash },
      );

      const next = normalizeExecApprovalsSnapshot(response);
      setExecDraft(JSON.stringify(next.file ?? {}, null, 2));
      setExecDirty(false);
      setExecSuccess(execTargetKind === "gateway" ? "Gateway exec approvals saved." : "Node exec approvals saved.");
      await execQuery.refetch();
    } catch (error) {
      if (error instanceof SyntaxError) {
        setExecError(`Invalid JSON: ${error.message}`);
      } else {
        setExecError(String(error));
      }
    } finally {
      setExecSaving(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="workspace-empty-state">
        <Network size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">Nodes</h2>
        <p className="workspace-subtitle">Connect a gateway to inspect nodes, approve devices, and edit exec approvals.</p>
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <div className="workspace-toolbar">
        <div>
          <h2 className="workspace-title">Nodes</h2>
          <p className="workspace-subtitle">
            Inspect paired nodes, manage gateway device pairings, and edit exec approvals for the gateway or a node host.
          </p>
        </div>
        <div className="workspace-toolbar__actions">
          <Button variant="secondary" onClick={refreshAll} loading={nodesQuery.isFetching || devicesQuery.isFetching || execQuery.isFetching}>
            <RefreshCw size={14} />
            Refresh All
          </Button>
        </div>
      </div>

      {nodesQuery.error && <div className="workspace-alert workspace-alert--error">{String(nodesQuery.error)}</div>}
      {devicesQuery.error && <div className="workspace-alert workspace-alert--error">{String(devicesQuery.error)}</div>}

      <div className="stats-grid stats-grid--overview">
        <div className="stat-card stat-card--overview">
          <div className="stat-card__icon"><Network size={16} /></div>
          <div className="stat-card__label">Nodes</div>
          <div className="stat-card__value">{nodeSummary.total}</div>
          <div className="workspace-subcopy">All paired or connected nodes.</div>
        </div>
        <div className="stat-card stat-card--overview">
          <div className="stat-card__icon"><Cpu size={16} /></div>
          <div className="stat-card__label">Connected</div>
          <div className="stat-card__value">{nodeSummary.connected}</div>
          <div className="workspace-subcopy">Currently online nodes.</div>
        </div>
        <div className="stat-card stat-card--overview">
          <div className="stat-card__icon"><Shield size={16} /></div>
          <div className="stat-card__label">Device Requests</div>
          <div className="stat-card__value">{deviceSummary.pending}</div>
          <div className="workspace-subcopy">Pending gateway pairing approvals.</div>
        </div>
        <div className="stat-card stat-card--overview">
          <div className="stat-card__icon"><KeyRound size={16} /></div>
          <div className="stat-card__label">Device Tokens</div>
          <div className="stat-card__value">{deviceSummary.tokens}</div>
          <div className="workspace-subcopy">Tracked token summaries across paired devices.</div>
        </div>
      </div>

      <div className="workspace-grid workspace-grid--wide">
        <Card className="workspace-section">
          <div className="workspace-section__header">
            <div>
              <h3>Node Inventory</h3>
              <p>{nodesQuery.data ? `Updated ${formatRelativeTime(nodesQuery.data.ts)}` : "Waiting for data"}</p>
            </div>
          </div>

          {nodesQuery.isLoading ? (
            <div className="workspace-inline-status">Loading nodes…</div>
          ) : (nodesQuery.data?.nodes.length ?? 0) === 0 ? (
            <div className="workspace-empty-inline">No nodes were reported by `node.list`.</div>
          ) : (
            <div className="node-list">
              {nodesQuery.data?.nodes.map((node) => (
                <div key={node.nodeId} className="channel-card">
                  <div className="channel-card__header">
                    <div>
                      <h4>{node.displayName || truncate(node.nodeId, 24)}</h4>
                      <p className="workspace-subcopy mono">{node.nodeId}</p>
                    </div>
                    <StatusBadge status={node.connected ? "connected" : "disconnected"} label={node.connected ? "Online" : "Offline"} />
                  </div>

                  <div className="detail-pills">
                    {node.platform && <span className="detail-pill">platform: {node.platform}</span>}
                    {node.deviceFamily && <span className="detail-pill">family: {node.deviceFamily}</span>}
                    {node.modelIdentifier && <span className="detail-pill">model: {node.modelIdentifier}</span>}
                    {node.remoteIp && <span className="detail-pill">ip: {node.remoteIp}</span>}
                    {node.paired && <span className="detail-pill">paired</span>}
                    {supportsExecApprovals(node) && <span className="detail-pill">exec approvals</span>}
                    {node.connectedAtMs && <span className="detail-pill">connected {formatRelativeTime(node.connectedAtMs)}</span>}
                  </div>

                  <div className="detail-columns node-detail-columns">
                    <div>
                      <h4>Versions</h4>
                      <p>Node-reported build metadata.</p>
                      <div className="overview-kv-list compact">
                        <div className="overview-kv-row"><span>Version</span><strong>{node.version ?? "n/a"}</strong></div>
                        <div className="overview-kv-row"><span>Core</span><strong>{node.coreVersion ?? "n/a"}</strong></div>
                        <div className="overview-kv-row"><span>UI</span><strong>{node.uiVersion ?? "n/a"}</strong></div>
                      </div>
                    </div>

                    <div>
                      <h4>Capabilities</h4>
                      <p>Declared caps from `node.list`.</p>
                      <div className="detail-pills">
                        {(node.caps?.length ?? 0) > 0 ? node.caps?.map((cap) => <span key={cap} className="detail-pill">{cap}</span>) : <span className="workspace-subcopy">No caps reported.</span>}
                      </div>
                    </div>

                    <div>
                      <h4>Commands</h4>
                      <p>Commands the node says it can handle.</p>
                      <div className="detail-pills">
                        {(node.commands?.length ?? 0) > 0 ? node.commands?.map((command) => <span key={command} className="detail-pill">{command}</span>) : <span className="workspace-subcopy">No commands reported.</span>}
                      </div>
                    </div>
                  </div>

                  {node.permissions !== undefined && (
                    <pre className="code-block code-block--compact">{JSON.stringify(node.permissions, null, 2)}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="workspace-section">
          <div className="workspace-section__header">
            <div>
              <h3>Gateway Devices</h3>
              <p>Approve pending pairings, rotate device tokens, and remove stale clients.</p>
            </div>
            <span className="workspace-meta">{deviceSummary.paired} paired</span>
          </div>

          {deviceActionError && <div className="workspace-alert workspace-alert--error compact">{deviceActionError}</div>}
          {deviceActionSuccess && <div className="workspace-alert workspace-alert--info compact">{deviceActionSuccess}</div>}
          {rotatedToken && (
            <div className="workspace-alert workspace-alert--info compact">
              <strong>{rotatedToken.role}</strong> token for <span className="mono">{rotatedToken.deviceId}</span>
              <pre className="code-block code-block--compact node-token-block">{rotatedToken.token}</pre>
            </div>
          )}

          <div className="workspace-section__header compact">
            <div>
              <h4>Pending Requests</h4>
              <p>{deviceSummary.pending} awaiting approval.</p>
            </div>
          </div>

          {devicesQuery.isLoading ? (
            <div className="workspace-inline-status">Loading gateway devices…</div>
          ) : (devicesQuery.data?.pending.length ?? 0) === 0 ? (
            <div className="workspace-empty-inline">No pending device pairing requests.</div>
          ) : (
            <div className="device-request-list">
              {devicesQuery.data?.pending.map((request) => (
                <div key={request.requestId} className="issue-row device-request-row">
                  <div className="channel-card__header">
                    <div>
                      <h4>{request.displayName ?? truncate(request.deviceId, 20)}</h4>
                      <p className="workspace-subcopy mono">{request.deviceId}</p>
                    </div>
                    <div className="device-row-actions">
                      <Button size="sm" onClick={() => approvePendingDevice(request.requestId)} loading={deviceActionBusy === `approve:${request.requestId}`}>
                        <Check size={14} />
                        Approve
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => rejectPendingDevice(request.requestId)} loading={deviceActionBusy === `reject:${request.requestId}`}>
                        <XCircle size={14} />
                        Reject
                      </Button>
                    </div>
                  </div>

                  <div className="detail-pills">
                    {summarizeRoles(request).map((role) => <span key={role} className="detail-pill">role: {role}</span>)}
                    {(request.scopes ?? []).map((scope) => <span key={`${request.requestId}-${scope}`} className="detail-pill">{scope}</span>)}
                    {request.remoteIp && <span className="detail-pill">ip: {request.remoteIp}</span>}
                    {request.isRepair && <span className="detail-pill">repair</span>}
                    {request.ts && <span className="detail-pill">requested {formatRelativeTime(request.ts)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="workspace-section__header compact">
            <div>
              <h4>Paired Devices</h4>
              <p>{deviceSummary.tokens} token summary entries returned by the gateway.</p>
            </div>
          </div>

          {(devicesQuery.data?.paired.length ?? 0) === 0 ? (
            <div className="workspace-empty-inline">No paired devices stored on this gateway.</div>
          ) : (
            <div className="device-list">
              {devicesQuery.data?.paired.map((device) => {
                const roles = summarizeRoles(device);
                const tokenEntries = (device.tokens ?? []).slice().sort((left, right) => left.role.localeCompare(right.role));
                return (
                  <div key={device.deviceId} className="channel-card">
                    <div className="channel-card__header">
                      <div>
                        <h4>{device.displayName ?? truncate(device.deviceId, 24)}</h4>
                        <p className="workspace-subcopy mono">{device.deviceId}</p>
                      </div>
                      <div className="device-row-actions">
                        <StatusBadge status="connected" label="Paired" />
                        <Button variant="ghost" size="sm" onClick={() => removeDevice(device)} loading={deviceActionBusy === `remove:${device.deviceId}`}>
                          <Trash2 size={14} />
                          Remove
                        </Button>
                      </div>
                    </div>

                    <div className="detail-pills">
                      {roles.map((role) => <span key={`${device.deviceId}-${role}`} className="detail-pill">role: {role}</span>)}
                      {(device.scopes ?? []).map((scope) => <span key={`${device.deviceId}-${scope}`} className="detail-pill">{scope}</span>)}
                      {device.remoteIp && <span className="detail-pill">ip: {device.remoteIp}</span>}
                      {device.approvedAtMs && <span className="detail-pill">approved {formatRelativeTime(device.approvedAtMs)}</span>}
                    </div>

                    <div className="overview-kv-list compact">
                      <div className="overview-kv-row"><span>Created</span><strong>{formatWhen(device.createdAtMs)}</strong></div>
                      <div className="overview-kv-row"><span>Approved</span><strong>{formatWhen(device.approvedAtMs)}</strong></div>
                      <div className="overview-kv-row"><span>Tokens</span><strong>{tokenEntries.length}</strong></div>
                    </div>

                    {tokenEntries.length > 0 ? (
                      <div className="device-token-list">
                        {tokenEntries.map((token) => (
                          <div key={`${device.deviceId}:${token.role}`} className="device-token-row">
                            <div>
                              <div className="tool-item__title">{token.role}</div>
                              <div className="workspace-subcopy">
                                {(token.scopes ?? []).join(", ") || (device.scopes ?? []).join(", ") || "no scopes reported"}
                              </div>
                            </div>
                            <div className="device-token-row__meta">
                              <span>created {formatWhen(token.createdAtMs)}</span>
                              <span>rotated {formatWhen(token.rotatedAtMs)}</span>
                              <span>last used {formatWhen(token.lastUsedAtMs)}</span>
                            </div>
                            <div className="device-row-actions">
                              <Button size="sm" variant="secondary" onClick={() => rotateDeviceToken(device, token.role, token.scopes ?? device.scopes)} loading={deviceActionBusy === `rotate:${device.deviceId}:${token.role}`}>
                                <RotateCcw size={14} />
                                Rotate
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => revokeDeviceToken(device, token.role)} loading={deviceActionBusy === `revoke:${device.deviceId}:${token.role}`}>
                                <XCircle size={14} />
                                Revoke
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="workspace-empty-inline">No token entries reported for this device.</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card className="workspace-section node-management-section">
        <div className="workspace-section__header">
          <div>
            <h3>Exec Approvals</h3>
            <p>Edit allowlist policy for the local gateway host or a connected node that supports exec approvals.</p>
          </div>
          <div className="workspace-toolbar__actions">
            <Button variant="secondary" onClick={() => execQuery.refetch()} loading={execQuery.isFetching} disabled={!execTargetReady}>
              <RefreshCw size={14} />
              Reload
            </Button>
            <Button variant="ghost" onClick={resetExecDraft} disabled={!execDirty || !execQuery.data}>
              <RotateCcw size={14} />
              Reset
            </Button>
            <Button onClick={saveExecApprovals} loading={execSaving} disabled={!execDirty || !execQuery.data}>
              <Save size={14} />
              Save
            </Button>
          </div>
        </div>

        <div className="session-editor-grid node-management-grid">
          <label className="session-field">
            <span>Target Host</span>
            <select
              value={execTargetKind}
              onChange={(event) => {
                const next = event.target.value as "gateway" | "node";
                setExecTargetKind(next);
                setExecError(null);
                setExecSuccess(null);
              }}
            >
              <option value="gateway">Gateway</option>
              <option value="node">Node</option>
            </select>
          </label>

          {execTargetKind === "node" && (
            <label className="session-field">
              <span>Node Target</span>
              <select
                value={execTargetNodeId ?? ""}
                onChange={(event) => {
                  setExecTargetNodeId(event.target.value || null);
                  setExecError(null);
                  setExecSuccess(null);
                }}
                disabled={execTargetNodes.length === 0}
              >
                {execTargetNodes.length === 0 ? (
                  <option value="">No node supports exec approvals</option>
                ) : (
                  execTargetNodes.map((node) => (
                    <option key={node.nodeId} value={node.nodeId}>
                      {node.displayName ? `${node.displayName} · ${node.nodeId}` : node.nodeId}
                    </option>
                  ))
                )}
              </select>
            </label>
          )}
        </div>

        {execTargetKind === "node" && execTargetNodes.length === 0 && (
          <div className="workspace-alert workspace-alert--info compact">
            No currently connected node advertises both `system.execApprovals.get` and `system.execApprovals.set`.
          </div>
        )}
        {execQuery.error && <div className="workspace-alert workspace-alert--error compact">{String(execQuery.error)}</div>}
        {execError && <div className="workspace-alert workspace-alert--error compact">{execError}</div>}
        {execSuccess && <div className="workspace-alert workspace-alert--info compact">{execSuccess}</div>}

        {execQuery.data ? (
          <>
            <div className="stats-grid">
              <div className="stat-card stat-card--compact">
                <span className="stat-card__label">Target</span>
                <span className="stat-card__value">
                  {execTargetKind === "gateway"
                    ? "Gateway"
                    : execTargetNodes.find((node) => node.nodeId === execTargetNodeId)?.displayName ?? execTargetNodeId ?? "Node"}
                </span>
              </div>
              <div className="stat-card stat-card--compact">
                <span className="stat-card__label">Path</span>
                <span className="stat-card__value">{truncate(execQuery.data.path, 44)}</span>
              </div>
              <div className="stat-card stat-card--compact">
                <span className="stat-card__label">Agent Overrides</span>
                <span className="stat-card__value">{execSummary.agentOverrides}</span>
              </div>
              <div className="stat-card stat-card--compact">
                <span className="stat-card__label">Default Policy</span>
                <span className="stat-card__value">{execSummary.security} · {execSummary.ask}</span>
              </div>
            </div>

            <div className="detail-pills">
              <span className="detail-pill">exists: {execQuery.data.exists ? "yes" : "no"}</span>
              <span className="detail-pill">hash: {truncate(execQuery.data.hash || "missing", 18)}</span>
              <span className="detail-pill">autoAllowSkills: {execSummary.autoAllowSkills ? "on" : "off"}</span>
            </div>

            <textarea
              className="config-editor"
              value={execDraft}
              onChange={(event) => {
                setExecDraft(event.target.value);
                setExecDirty(true);
                if (execError?.startsWith("Invalid JSON:")) {
                  setExecError(null);
                }
                setExecSuccess(null);
              }}
              spellCheck={false}
              placeholder="Exec approvals JSON will appear here after the snapshot loads"
            />
          </>
        ) : execQuery.isLoading ? (
          <div className="workspace-inline-status">Loading exec approvals…</div>
        ) : (
          <div className="workspace-empty-inline">Select a valid target to load exec approvals.</div>
        )}
      </Card>
    </div>
  );
}
