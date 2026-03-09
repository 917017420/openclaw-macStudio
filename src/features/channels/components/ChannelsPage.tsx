import { useMemo, useState } from "react";
import { LoaderCircle, QrCode, Radio, RefreshCw, LogOut, Play, Link2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, StatusBadge } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";
import { gateway } from "@/lib/gateway";
import { formatRelativeTime } from "@/lib/utils";

type ChannelAccountSnapshot = Record<string, unknown> & {
  accountId?: string;
  name?: string | null;
  enabled?: boolean | null;
  configured?: boolean | null;
  linked?: boolean | null;
  running?: boolean | null;
  connected?: boolean | null;
  lastError?: string | null;
  lastProbeAt?: number | null;
};

interface ChannelsStatusSnapshot {
  ts: number;
  channelOrder: string[];
  channelLabels: Record<string, string>;
  channels: Record<string, Record<string, unknown>>;
  channelAccounts: Record<string, ChannelAccountSnapshot[]>;
}

const CHANNELS_QUERY_KEY = ["channels-status"] as const;

function normalizeChannelsSnapshot(raw: unknown): ChannelsStatusSnapshot {
  if (!raw || typeof raw !== "object") {
    return {
      ts: Date.now(),
      channelOrder: [],
      channelLabels: {},
      channels: {},
      channelAccounts: {},
    };
  }

  const obj = raw as Record<string, unknown>;
  const channels = obj.channels && typeof obj.channels === "object"
    ? obj.channels as Record<string, Record<string, unknown>>
    : {};
  const labels = obj.channelLabels && typeof obj.channelLabels === "object"
    ? obj.channelLabels as Record<string, string>
    : {};
  const accounts = obj.channelAccounts && typeof obj.channelAccounts === "object"
    ? obj.channelAccounts as Record<string, ChannelAccountSnapshot[]>
    : {};

  return {
    ts: typeof obj.ts === "number" ? obj.ts : Date.now(),
    channelOrder: Array.isArray(obj.channelOrder)
      ? obj.channelOrder.filter((value): value is string => typeof value === "string")
      : Object.keys(channels),
    channelLabels: labels,
    channels,
    channelAccounts: accounts,
  };
}

function channelStatus(channel: Record<string, unknown> | undefined): "connected" | "disconnected" | "error" {
  if (!channel) return "disconnected";
  if (channel.connected === true) return "connected";
  if (typeof channel.lastError === "string" && channel.lastError.trim()) return "error";
  return "disconnected";
}

function statusLabel(channel: Record<string, unknown> | undefined): string {
  if (!channel) return "Unavailable";
  if (channel.connected === true) return "Connected";
  if (channel.running === true) return "Running";
  if (channel.linked === true) return "Linked";
  if (channel.configured === true) return "Configured";
  if (typeof channel.lastError === "string" && channel.lastError.trim()) return "Error";
  return "Disconnected";
}

function describeAccount(account: ChannelAccountSnapshot): string[] {
  const flags: string[] = [];
  if (account.enabled) flags.push("enabled");
  if (account.configured) flags.push("configured");
  if (account.linked) flags.push("linked");
  if (account.running) flags.push("running");
  if (account.connected) flags.push("connected");
  return flags;
}

export function ChannelsPage() {
  const isConnected = useConnectionStore((state) => state.state === "connected");
  const [probe, setProbe] = useState(true);
  const [whatsAppBusy, setWhatsAppBusy] = useState(false);
  const [whatsAppMessage, setWhatsAppMessage] = useState<string | null>(null);
  const [whatsAppQrDataUrl, setWhatsAppQrDataUrl] = useState<string | null>(null);
  const [whatsAppLinked, setWhatsAppLinked] = useState<boolean | null>(null);

  const channelsQuery = useQuery<ChannelsStatusSnapshot>({
    queryKey: [...CHANNELS_QUERY_KEY, probe],
    enabled: isConnected,
    staleTime: 15_000,
    queryFn: async () => {
      const raw = await gateway.request<unknown>("channels.status", {
        probe,
        timeoutMs: 8000,
      });
      return normalizeChannelsSnapshot(raw);
    },
  });

  const channels = useMemo(() => {
    const snapshot = channelsQuery.data;
    if (!snapshot) return [];
    return snapshot.channelOrder.map((channelId) => ({
      id: channelId,
      label: snapshot.channelLabels[channelId] ?? channelId,
      details: snapshot.channels[channelId],
      accounts: snapshot.channelAccounts[channelId] ?? [],
    }));
  }, [channelsQuery.data]);

  async function startWhatsAppLogin(force: boolean) {
    setWhatsAppBusy(true);
    try {
      const res = await gateway.request<{ message?: string; qrDataUrl?: string }>("web.login.start", {
        force,
        timeoutMs: 30000,
      });
      setWhatsAppMessage(res.message ?? "Login started.");
      setWhatsAppQrDataUrl(res.qrDataUrl ?? null);
      setWhatsAppLinked(null);
      await channelsQuery.refetch();
    } catch (error) {
      setWhatsAppMessage(String(error));
    } finally {
      setWhatsAppBusy(false);
    }
  }

  async function waitWhatsAppLogin() {
    setWhatsAppBusy(true);
    try {
      const res = await gateway.request<{ message?: string; connected?: boolean }>("web.login.wait", {
        timeoutMs: 120000,
      });
      setWhatsAppMessage(res.message ?? "Login state updated.");
      setWhatsAppLinked(res.connected ?? null);
      if (res.connected) {
        setWhatsAppQrDataUrl(null);
      }
      await channelsQuery.refetch();
    } catch (error) {
      setWhatsAppMessage(String(error));
      setWhatsAppLinked(null);
    } finally {
      setWhatsAppBusy(false);
    }
  }

  async function logoutWhatsApp() {
    setWhatsAppBusy(true);
    try {
      await gateway.request("channels.logout", { channel: "whatsapp" });
      setWhatsAppMessage("Logged out from WhatsApp.");
      setWhatsAppQrDataUrl(null);
      setWhatsAppLinked(false);
      await channelsQuery.refetch();
    } catch (error) {
      setWhatsAppMessage(String(error));
    } finally {
      setWhatsAppBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="workspace-empty-state">
        <Radio size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">Channels</h2>
        <p className="workspace-subtitle">Connect a gateway to inspect linked messaging surfaces.</p>
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <div className="workspace-toolbar">
        <div>
          <h2 className="workspace-title">Channels</h2>
          <p className="workspace-subtitle">
            Probe linked surfaces, inspect account health, and handle WhatsApp login directly.
          </p>
        </div>
        <div className="workspace-toolbar__actions">
          <Button variant="ghost" onClick={() => setProbe((value) => !value)}>
            {probe ? "Deep Probe On" : "Fast Status"}
          </Button>
          <Button variant="secondary" onClick={() => channelsQuery.refetch()} loading={channelsQuery.isFetching}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        </div>
      </div>

      {channelsQuery.error && (
        <div className="workspace-alert workspace-alert--error">
          {String(channelsQuery.error)}
        </div>
      )}

      <div className="workspace-grid workspace-grid--wide">
        <Card className="workspace-section">
          <div className="workspace-section__header">
            <div>
              <h3>Linked Surfaces</h3>
              <p>Snapshot from `channels.status` with per-account metadata.</p>
            </div>
            <span className="workspace-meta">
              {channelsQuery.data ? `Updated ${formatRelativeTime(channelsQuery.data.ts)}` : "Waiting for data"}
            </span>
          </div>

          {channelsQuery.isLoading ? (
            <div className="workspace-inline-status"><LoaderCircle size={16} className="spin" /> Loading channels…</div>
          ) : channels.length === 0 ? (
            <div className="workspace-empty-inline">No channels reported by this gateway yet.</div>
          ) : (
            <div className="channel-list">
              {channels.map((channel) => {
                const details = channel.details;
                return (
                  <div key={channel.id} className="channel-card">
                    <div className="channel-card__header">
                      <div>
                        <h4>{channel.label}</h4>
                        <p className="workspace-subcopy">{channel.id}</p>
                      </div>
                      <StatusBadge status={channelStatus(details)} label={statusLabel(details)} />
                    </div>

                    <div className="channel-card__facts">
                      <span>{channel.accounts.length} account{channel.accounts.length === 1 ? "" : "s"}</span>
                      {details?.configured === true && <span>configured</span>}
                      {details?.running === true && <span>running</span>}
                      {details?.connected === true && <span>connected</span>}
                    </div>

                    {typeof details?.lastError === "string" && details.lastError.trim().length > 0 && (
                      <div className="workspace-alert workspace-alert--error compact">{details.lastError}</div>
                    )}

                    {channel.accounts.length > 0 && (
                      <div className="channel-accounts">
                        {channel.accounts.map((account, index) => (
                          <div key={`${channel.id}-${account.accountId ?? index}`} className="channel-account-row">
                            <div>
                              <div className="channel-account-row__title">
                                {account.name ?? account.accountId ?? `Account ${index + 1}`}
                              </div>
                              <div className="workspace-subcopy">
                                {describeAccount(account).join(" · ") || "no flags reported"}
                              </div>
                            </div>
                            <div className="channel-account-row__meta">
                              {typeof account.lastProbeAt === "number" && <span>probe {formatRelativeTime(account.lastProbeAt)}</span>}
                              {account.lastError && <span className="text-status-error">{account.lastError}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="workspace-section">
          <div className="workspace-section__header">
            <div>
              <h3>WhatsApp Login</h3>
              <p>Start QR login, wait for a link, or force logout without leaving the desktop shell.</p>
            </div>
            <QrCode size={18} className="text-text-tertiary" />
          </div>

          <div className="workspace-toolbar__actions">
            <Button onClick={() => startWhatsAppLogin(false)} loading={whatsAppBusy}>
              <Play size={14} />
              Start Login
            </Button>
            <Button variant="secondary" onClick={() => startWhatsAppLogin(true)} loading={whatsAppBusy}>
              <RefreshCw size={14} />
              Force New QR
            </Button>
            <Button variant="ghost" onClick={waitWhatsAppLogin} loading={whatsAppBusy}>
              <Link2 size={14} />
              Wait
            </Button>
            <Button variant="ghost" onClick={logoutWhatsApp} loading={whatsAppBusy}>
              <LogOut size={14} />
              Logout
            </Button>
          </div>

          {whatsAppMessage && (
            <div className="workspace-alert workspace-alert--info">{whatsAppMessage}</div>
          )}

          {whatsAppLinked !== null && (
            <div className="workspace-inline-status">
              <StatusBadge status={whatsAppLinked ? "connected" : "disconnected"} label={whatsAppLinked ? "Linked" : "Not linked"} />
            </div>
          )}

          {whatsAppQrDataUrl ? (
            <div className="qr-panel">
              <img src={whatsAppQrDataUrl} alt="WhatsApp QR code" className="qr-panel__image" />
            </div>
          ) : (
            <div className="workspace-empty-inline">No QR code active. Start a login attempt to generate one.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
