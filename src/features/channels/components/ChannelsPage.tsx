import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Link2,
  LoaderCircle,
  LogOut,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  TestTube2,
  ToggleLeft,
} from "lucide-react";
import { Button, Card, StatusBadge } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";
import { gateway } from "@/lib/gateway";
import { formatRelativeTime, truncate } from "@/lib/utils";
import { ChannelConfigForm } from "./ChannelConfigForm";
import {
  asRecord,
  buildChannelConfigValues,
  buildChannels,
  buildRawEditors,
  buildStatusItems,
  cloneJsonRecord,
  createNostrProfileFormState,
  formatBoolean,
  formatChannelSummary,
  formatTimestamp,
  normalizeChannelsSnapshot,
  normalizeConfigSchemaResponse,
  normalizeConfigSnapshot,
  parseNostrFieldErrors,
  readBoolean,
  readString,
  renderAccountFlags,
  resolveChannelConfigValue,
  resolvePrimaryNostrProfile,
  serializeJson,
  setValueAtPath,
  statusLabel,
  statusTone,
  summarizeProbe,
  truncateMiddle,
} from "./channel-data";
import { NostrProfileEditor } from "./NostrProfileEditor";
import type {
  ChannelAccountSnapshot,
  ChannelDefinition,
  ChannelsStatusSnapshot,
  ConfigSchemaResponse,
  ConfigSnapshot,
  FeedbackMessage,
  JsonRecord,
  NostrProfile,
  NostrProfileFormState,
} from "./channel-types";
import "./channels.css";

const CHANNELS_QUERY_KEY = ["channels-status"] as const;
const CONFIG_QUERY_KEY = ["gateway-config", "channels"] as const;
const SCHEMA_QUERY_KEY = ["gateway-config-schema", "channels"] as const;

function renderStatusList(items: Array<{ label: string; value: string }>) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="channels-status-list">
      {items.map((item) => (
        <div key={`${item.label}-${item.value}`} className="channels-status-list__row">
          <span className="channels-label">{item.label}</span>
          <span>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function renderProbeCallout(status: JsonRecord | undefined) {
  const message = summarizeProbe(status?.probe);
  if (!message) {
    return null;
  }
  return <div className="workspace-alert channels-page__alert">{message}</div>;
}

function renderAccountCards(accounts: ChannelAccountSnapshot[], channelId: string) {
  if (accounts.length === 0) {
    return null;
  }

  return (
    <div className="channels-account-card-list">
      {accounts.map((account, index) => {
        const probeRecord = asRecord(account.probe);
        const profileRecord = asRecord(account.profile);
        const title =
          channelId === "telegram"
            ? (() => {
                const bot = asRecord(probeRecord?.bot);
                const username = readString(bot, "username");
                return username
                  ? `@${username}`
                  : account.name ?? account.accountId ?? `Account ${index + 1}`;
              })()
            : channelId === "nostr"
              ? readString(profileRecord, "displayName") ??
                readString(profileRecord, "name") ??
                account.name ??
                account.accountId ??
                `Account ${index + 1}`
              : account.name ?? account.accountId ?? `Account ${index + 1}`;

        const details = buildStatusItems([
          ["Configured", formatBoolean(account.configured)],
          ["Running", formatBoolean(account.running)],
          ["Connected", formatBoolean(account.connected)],
          ["Last inbound", formatTimestamp(account.lastInboundAt)],
          ["Last probe", formatTimestamp(account.lastProbeAt)],
          channelId === "nostr"
            ? ["Public Key", truncateMiddle(account.publicKey)]
            : ["Flags", renderAccountFlags(account)],
        ]);

        return (
          <div key={`${channelId}-${account.accountId}-${index}`} className="channels-account-card">
            <div className="channels-account-card__header">
              <div>
                <div className="channels-account-card__title">{title}</div>
                <div className="channels-account-card__id mono">{account.accountId}</div>
              </div>
              <StatusBadge
                status={account.connected ? "connected" : account.running ? "running" : account.lastError ? "error" : "idle"}
                label={
                  account.connected
                    ? "Connected"
                    : account.running
                      ? "Running"
                      : account.lastError
                        ? "Error"
                        : "Idle"
                }
              />
            </div>
            {renderStatusList(details)}
            {account.lastError && (
              <div className="channels-account-card__error">{account.lastError}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function renderChannelSummary(channel: ChannelDefinition) {
  if (["telegram", "nostr"].includes(channel.id) && channel.accounts.length > 1) {
    return renderAccountCards(channel.accounts, channel.id);
  }

  const summaryItems = formatChannelSummary(channel);
  const profile = resolvePrimaryNostrProfile(channel);

  if (channel.id !== "nostr") {
    return renderStatusList(summaryItems);
  }

  return (
    <>
      {renderStatusList(summaryItems)}
      {profile && (
        <div className="channels-profile-card">
          <div className="channels-profile-card__title">Profile</div>
          {renderStatusList(
            buildStatusItems([
              ["Name", profile.name],
              ["Display", profile.displayName],
              ["NIP-05", profile.nip05],
              ["Website", profile.website],
            ]),
          ) ?? <div className="workspace-subcopy">No profile published.</div>}
          {profile.about && (
            <p className="channels-profile-card__about">{truncate(profile.about, 220)}</p>
          )}
        </div>
      )}
    </>
  );
}

function resolveGatewayHttpBase(url: string) {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/(ws|socket|gateway)\/?$/u, "");
  return parsed.toString().replace(/\/$/u, "");
}

function resolveGatewayHttpHeaders(
  activeConfig: { token: string; deviceToken?: string } | null,
): Record<string, string> {
  const deviceToken = gateway.authResult?.deviceToken?.trim() || activeConfig?.deviceToken?.trim();
  if (deviceToken) {
    return { Authorization: `Bearer ${deviceToken}` } satisfies Record<string, string>;
  }
  const token = activeConfig?.token?.trim();
  return token
    ? ({ Authorization: `Bearer ${token}` } satisfies Record<string, string>)
    : ({} satisfies Record<string, string>);
}

function buildNostrProfileUrl(baseUrl: string, accountId: string, suffix = "") {
  return `${baseUrl}/api/channels/nostr/${encodeURIComponent(accountId)}/profile${suffix}`;
}

export function ChannelsPage() {
  const connectionState = useConnectionStore((state) => state.state);
  const configs = useConnectionStore((state) => state.configs);
  const activeConfigId = useConnectionStore((state) => state.activeConfigId);
  const activeConfig = useMemo(
    () => configs.find((config) => config.id === activeConfigId) ?? null,
    [activeConfigId, configs],
  );
  const isConnected = connectionState === "connected";

  const [probe, setProbe] = useState(true);
  const [whatsAppBusy, setWhatsAppBusy] = useState(false);
  const [whatsAppMessage, setWhatsAppMessage] = useState<string | null>(null);
  const [whatsAppQrDataUrl, setWhatsAppQrDataUrl] = useState<string | null>(null);
  const [whatsAppLinked, setWhatsAppLinked] = useState<boolean | null>(null);
  const [channelDrafts, setChannelDrafts] = useState<Record<string, JsonRecord>>({});
  const [channelRawDrafts, setChannelRawDrafts] = useState<Record<string, string>>({});
  const [channelRawErrors, setChannelRawErrors] = useState<Record<string, string | null>>({});
  const [channelModes, setChannelModes] = useState<Record<string, "form" | "raw">>({});
  const [channelBusyId, setChannelBusyId] = useState<string | null>(null);
  const [channelFeedback, setChannelFeedback] = useState<Record<string, FeedbackMessage | null>>(
    {},
  );
  const [globalFeedback, setGlobalFeedback] = useState<FeedbackMessage | null>(null);
  const [nostrProfileAccountId, setNostrProfileAccountId] = useState<string | null>(null);
  const [nostrProfileFormState, setNostrProfileFormState] =
    useState<NostrProfileFormState | null>(null);

  const channelsQuery = useQuery<ChannelsStatusSnapshot>({
    queryKey: [...CHANNELS_QUERY_KEY, probe],
    enabled: isConnected,
    staleTime: 15_000,
    queryFn: async () =>
      normalizeChannelsSnapshot(
        await gateway.request<unknown>("channels.status", { probe, timeoutMs: 8_000 }),
      ),
  });

  const configQuery = useQuery<ConfigSnapshot>({
    queryKey: CONFIG_QUERY_KEY,
    enabled: isConnected,
    staleTime: 15_000,
    queryFn: async () => normalizeConfigSnapshot(await gateway.request<unknown>("config.get")),
  });

  const schemaQuery = useQuery<ConfigSchemaResponse | null>({
    queryKey: SCHEMA_QUERY_KEY,
    enabled: isConnected,
    staleTime: 60_000,
    queryFn: async () =>
      normalizeConfigSchemaResponse(await gateway.request<unknown>("config.schema", {})),
  });

  const channels = useMemo(
    () => buildChannels(channelsQuery.data ?? null),
    [channelsQuery.data],
  );

  const channelIds = useMemo(() => channels.map((channel) => channel.id), [channels]);
  const channelIdsKey = useMemo(() => channelIds.join("|"), [channelIds]);

  useEffect(() => {
    const nextDrafts = buildChannelConfigValues(configQuery.data?.config, channelIds);
    setChannelDrafts(nextDrafts);
    setChannelRawDrafts(buildRawEditors(nextDrafts));
    setChannelRawErrors((current) =>
      Object.fromEntries(channelIds.map((channelId) => [channelId, current[channelId] ?? null])),
    );
    setChannelModes((current) =>
      Object.fromEntries(channelIds.map((channelId) => [channelId, current[channelId] ?? "form"])),
    );
    setChannelFeedback((current) =>
      Object.fromEntries(channelIds.map((channelId) => [channelId, current[channelId] ?? null])),
    );
  }, [configQuery.data?.hash, channelIdsKey]);

  function requestRefresh(nextProbe: boolean) {
    setProbe(nextProbe);
    setGlobalFeedback(null);
    if (nextProbe === probe) {
      void channelsQuery.refetch();
    }
  }

  function updateChannelDraft(channelId: string, nextValue: JsonRecord) {
    setChannelDrafts((current) => ({
      ...current,
      [channelId]: nextValue,
    }));
    setChannelRawDrafts((current) => ({
      ...current,
      [channelId]: JSON.stringify(nextValue, null, 2),
    }));
    setChannelRawErrors((current) => ({ ...current, [channelId]: null }));
    setChannelFeedback((current) => ({ ...current, [channelId]: null }));
  }

  function patchChannelDraft(channelId: string, path: Array<string | number>, nextValue: unknown) {
    const currentValue = channelDrafts[channelId] ?? {};
    const patched = setValueAtPath(currentValue, path, nextValue) as JsonRecord;
    updateChannelDraft(channelId, asRecord(patched) ?? {});
  }

  function applyRawDraft(channelId: string) {
    const rawValue = channelRawDrafts[channelId] ?? "{}";
    try {
      const parsed = rawValue.trim() ? JSON.parse(rawValue) : {};
      const record = asRecord(parsed);
      if (!record) {
        throw new Error("Channel config must be a JSON object.");
      }
      updateChannelDraft(channelId, record);
      setChannelFeedback((current) => ({
        ...current,
        [channelId]: { kind: "success", message: "Raw JSON applied to the local draft." },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setChannelRawErrors((current) => ({ ...current, [channelId]: message }));
    }
  }

  function isChannelDirty(channelId: string) {
    const current = channelDrafts[channelId] ?? {};
    const original = resolveChannelConfigValue(configQuery.data?.config, channelId);
    return serializeJson(current) !== serializeJson(original);
  }

  async function persistChannelConfig(
    channelId: string,
    nextValue?: JsonRecord,
    successMessage?: string,
  ) {
    const snapshot = configQuery.data;
    const value = nextValue ?? channelDrafts[channelId] ?? {};
    if (!snapshot?.hash) {
      setChannelFeedback((current) => ({
        ...current,
        [channelId]: {
          kind: "error",
          message: "Config hash missing. Reload config and retry.",
        },
      }));
      return;
    }

    setChannelBusyId(channelId);
    setGlobalFeedback(null);
    setChannelFeedback((current) => ({ ...current, [channelId]: null }));
    try {
      await gateway.request("config.patch", {
        raw: JSON.stringify({ channels: { [channelId]: value } }, null, 2),
        baseHash: snapshot.hash,
      });
      updateChannelDraft(channelId, value);
      setChannelFeedback((current) => ({
        ...current,
        [channelId]: {
          kind: "success",
          message: successMessage ?? `${channelId} config saved.`,
        },
      }));
      await Promise.all([configQuery.refetch(), channelsQuery.refetch()]);
    } catch (error) {
      setChannelFeedback((current) => ({
        ...current,
        [channelId]: {
          kind: "error",
          message: String(error),
        },
      }));
    } finally {
      setChannelBusyId(null);
    }
  }

  async function toggleChannelEnabled(channel: ChannelDefinition) {
    const currentValue = cloneJsonRecord(channelDrafts[channel.id] ?? {});
    const nextEnabled = !(readBoolean(currentValue, "enabled") ?? channel.enabled);
    currentValue.enabled = nextEnabled;
    updateChannelDraft(channel.id, currentValue);
    await persistChannelConfig(
      channel.id,
      currentValue,
      `${channel.label} ${nextEnabled ? "enabled" : "disabled"}.`,
    );
  }

  async function reloadChannelConfig(channelId: string) {
    setChannelBusyId(channelId);
    setGlobalFeedback(null);
    try {
      const result = await configQuery.refetch();
      const nextValue = cloneJsonRecord(resolveChannelConfigValue(result.data?.config, channelId));
      updateChannelDraft(channelId, nextValue);
      setChannelFeedback((current) => ({
        ...current,
        [channelId]: { kind: "info", message: `${channelId} config reloaded.` },
      }));
    } catch (error) {
      setChannelFeedback((current) => ({
        ...current,
        [channelId]: { kind: "error", message: String(error) },
      }));
    } finally {
      setChannelBusyId(null);
    }
  }

  async function startWhatsAppLogin(force: boolean) {
    setWhatsAppBusy(true);
    setGlobalFeedback(null);
    try {
      const response = await gateway.request<{ message?: string; qrDataUrl?: string }>(
        "web.login.start",
        {
          force,
          timeoutMs: 30_000,
        },
      );
      setWhatsAppMessage(response.message ?? null);
      setWhatsAppQrDataUrl(response.qrDataUrl ?? null);
      setWhatsAppLinked(null);
      await channelsQuery.refetch();
    } catch (error) {
      setWhatsAppMessage(String(error));
      setWhatsAppLinked(null);
    } finally {
      setWhatsAppBusy(false);
    }
  }

  async function waitWhatsAppLogin() {
    setWhatsAppBusy(true);
    setGlobalFeedback(null);
    try {
      const response = await gateway.request<{ message?: string; connected?: boolean }>(
        "web.login.wait",
        {
          timeoutMs: 120_000,
        },
      );
      setWhatsAppMessage(response.message ?? null);
      setWhatsAppLinked(response.connected ?? null);
      if (response.connected) {
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
    setGlobalFeedback(null);
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

  function handleNostrProfileEdit(channel: ChannelDefinition) {
    const profile = resolvePrimaryNostrProfile(channel);
    const accountId = channel.accounts[0]?.accountId ?? "default";
    setNostrProfileAccountId(accountId);
    setNostrProfileFormState(createNostrProfileFormState(profile));
  }

  function handleNostrProfileFieldChange(field: keyof NostrProfile, value: string) {
    setNostrProfileFormState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        values: {
          ...current.values,
          [field]: value,
        },
        fieldErrors: {
          ...current.fieldErrors,
          [field]: "",
        },
      };
    });
  }

  async function handleNostrProfileSave() {
    if (!nostrProfileFormState || !nostrProfileAccountId || !activeConfig) {
      return;
    }

    const baseUrl = resolveGatewayHttpBase(activeConfig.url);
    setNostrProfileFormState((current) =>
      current
        ? {
            ...current,
            saving: true,
            error: null,
            success: null,
            fieldErrors: {},
          }
        : current,
    );

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...resolveGatewayHttpHeaders(activeConfig),
      };
      const response = await fetch(buildNostrProfileUrl(baseUrl, nostrProfileAccountId), {
        method: "PUT",
        headers,
        body: JSON.stringify(nostrProfileFormState.values),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        details?: unknown;
        persisted?: boolean;
      } | null;

      if (!response.ok || payload?.ok === false || !payload) {
        setNostrProfileFormState((current) =>
          current
            ? {
                ...current,
                saving: false,
                error: payload?.error ?? `Profile update failed (${response.status})`,
                success: null,
                fieldErrors: parseNostrFieldErrors(payload?.details),
              }
            : current,
        );
        return;
      }

      if (!payload.persisted) {
        setNostrProfileFormState((current) =>
          current
            ? {
                ...current,
                saving: false,
                error: "Profile publish failed on all relays.",
                success: null,
              }
            : current,
        );
        return;
      }

      setNostrProfileFormState((current) =>
        current
          ? {
              ...current,
              saving: false,
              error: null,
              success: "Profile published to relays.",
              original: { ...current.values },
              fieldErrors: {},
            }
          : current,
      );
      await channelsQuery.refetch();
    } catch (error) {
      setNostrProfileFormState((current) =>
        current
          ? {
              ...current,
              saving: false,
              error: `Profile update failed: ${String(error)}`,
              success: null,
            }
          : current,
      );
    }
  }

  async function handleNostrProfileImport() {
    if (!nostrProfileFormState || !nostrProfileAccountId || !activeConfig) {
      return;
    }

    const baseUrl = resolveGatewayHttpBase(activeConfig.url);
    setNostrProfileFormState((current) =>
      current
        ? {
            ...current,
            importing: true,
            error: null,
            success: null,
          }
        : current,
    );

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...resolveGatewayHttpHeaders(activeConfig),
      };
      const response = await fetch(
        buildNostrProfileUrl(baseUrl, nostrProfileAccountId, "/import"),
        {
          method: "POST",
          headers,
          body: JSON.stringify({ autoMerge: true }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        imported?: NostrProfile;
        merged?: NostrProfile;
        saved?: boolean;
      } | null;

      if (!response.ok || payload?.ok === false || !payload) {
        setNostrProfileFormState((current) =>
          current
            ? {
                ...current,
                importing: false,
                error: payload?.error ?? `Profile import failed (${response.status})`,
                success: null,
              }
            : current,
        );
        return;
      }

      setNostrProfileFormState((current) => {
        if (!current) {
          return current;
        }
        const nextValues = { ...current.values, ...(payload.merged ?? payload.imported ?? {}) };
        return {
          ...current,
          importing: false,
          values: nextValues,
          showAdvanced: Boolean(
            nextValues.banner || nextValues.website || nextValues.nip05 || nextValues.lud16,
          ),
          error: null,
          success: payload.saved
            ? "Profile imported from relays. Review and publish."
            : "Profile imported. Review and publish.",
        };
      });

      if (payload.saved) {
        await channelsQuery.refetch();
      }
    } catch (error) {
      setNostrProfileFormState((current) =>
        current
          ? {
              ...current,
              importing: false,
              error: `Profile import failed: ${String(error)}`,
              success: null,
            }
          : current,
      );
    }
  }

  if (!isConnected) {
    return (
      <div className="workspace-empty-state channels-page channels-page--empty">
        <Radio size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">Channels</h2>
        <p className="workspace-subtitle">
          Connect a gateway to inspect channel health, login state, and channel config panels.
        </p>
      </div>
    );
  }

  const activeCount = channels.filter((channel) => channel.enabled).length;
  const totalAccounts = channels.reduce(
    (count, channel) => count + channel.accounts.length,
    0,
  );

  return (
    <div className="workspace-page channels-page">
      <div className="workspace-toolbar channels-toolbar">
        <div>
          <div className="channels-page__eyebrow">Control Surface</div>
          <h2 className="workspace-title">Channels</h2>
          <p className="workspace-subtitle">
            Official-style channel workspace with per-channel status, account detail, structured config, enable toggles, probe actions, and WhatsApp / Nostr flows.
          </p>
        </div>
        <div className="workspace-toolbar__actions">
          <Button variant="ghost" onClick={() => requestRefresh(!probe)}>
            {probe ? "Deep Probe On" : "Fast Status"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => requestRefresh(probe)}
            loading={channelsQuery.isFetching}
          >
            <RefreshCw size={14} />
            Refresh
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setGlobalFeedback(null);
              void Promise.all([configQuery.refetch(), schemaQuery.refetch()]);
            }}
            loading={configQuery.isFetching || schemaQuery.isFetching}
          >
            <RotateCcw size={14} />
            Reload Config
          </Button>
        </div>
      </div>

      <div className="channels-overview-pills">
        <span>
          <ShieldCheck size={14} />
          {activeCount}/{channels.length || 0} active
        </span>
        <span>
          <Link2 size={14} />
          {totalAccounts} accounts
        </span>
        <span>
          <TestTube2 size={14} />
          {probe ? "deep probe" : "fast status"}
        </span>
        <span>
          <CheckCircle2 size={14} />
          {channelsQuery.data ? `updated ${formatRelativeTime(channelsQuery.data.ts)}` : "waiting for data"}
        </span>
      </div>

      {channelsQuery.error && (
        <div className="workspace-alert workspace-alert--error">{String(channelsQuery.error)}</div>
      )}
      {configQuery.error && (
        <div className="workspace-alert workspace-alert--error">{String(configQuery.error)}</div>
      )}
      {schemaQuery.error && (
        <div className="workspace-alert workspace-alert--error">{String(schemaQuery.error)}</div>
      )}
      {globalFeedback && (
        <div
          className={`workspace-alert ${
            globalFeedback.kind === "error" ? "workspace-alert--error" : "workspace-alert--info"
          }`}
        >
          {globalFeedback.message}
        </div>
      )}

      {channelsQuery.isLoading ? (
        <div className="workspace-inline-status">
          <LoaderCircle size={16} className="spin" /> Loading channels…
        </div>
      ) : channels.length === 0 ? (
        <div className="workspace-empty-inline">No channels reported by the gateway yet.</div>
      ) : (
        <div className="channels-grid">
          {channels.map((channel) => {
            const lastError = readString(channel.status, "lastError");
            const isBusy = channelBusyId === channel.id;
            const isDirty = isChannelDirty(channel.id);
            const currentDraft = channelDrafts[channel.id] ?? {};
            const feedback = channelFeedback[channel.id];
            const status = channel.status;
            const accountCount = channel.accounts.length;
            const primaryNostrAccountId = channel.accounts[0]?.accountId ?? "default";
            const showNostrEditor =
              channel.id === "nostr" &&
              nostrProfileFormState &&
              nostrProfileAccountId === primaryNostrAccountId;

            return (
              <Card
                key={channel.id}
                className={`workspace-section channels-card ${
                  channel.enabled ? "is-enabled" : "is-muted"
                }`}
              >
                <div className="channels-card__header">
                  <div>
                    <div className="channels-card__eyebrow">{channel.id}</div>
                    <h3>{channel.label}</h3>
                    <p>{channel.detail}</p>
                  </div>
                  <StatusBadge
                    status={statusTone(status)}
                    label={statusLabel(status)}
                  />
                </div>

                <div className="channels-card__meta">
                  <span>{accountCount} account{accountCount === 1 ? "" : "s"}</span>
                  {channel.defaultAccountId && <span>default {channel.defaultAccountId}</span>}
                  <span>{channel.enabled ? "active" : "idle"}</span>
                </div>

                {renderChannelSummary(channel)}
                {lastError && (
                  <div className="workspace-alert workspace-alert--error channels-page__alert">
                    {lastError}
                  </div>
                )}
                {renderProbeCallout(status)}
                {feedback && (
                  <div
                    className={`workspace-alert ${
                      feedback.kind === "error" ? "workspace-alert--error" : "workspace-alert--info"
                    } channels-page__alert`}
                  >
                    {feedback.message}
                  </div>
                )}

                {channel.id === "whatsapp" && (
                  <>
                    {whatsAppMessage && (
                      <div className="workspace-alert workspace-alert--info channels-page__alert">
                        {whatsAppMessage}
                      </div>
                    )}
                    {whatsAppLinked !== null && (
                      <div className="channels-whatsapp-state">
                        <StatusBadge
                          status={whatsAppLinked ? "connected" : "idle"}
                          label={whatsAppLinked ? "Linked" : "Not linked"}
                        />
                      </div>
                    )}
                    {whatsAppQrDataUrl && (
                      <div className="channels-qr-wrap">
                        <img src={whatsAppQrDataUrl} alt="WhatsApp QR code" />
                      </div>
                    )}
                  </>
                )}

                {showNostrEditor && nostrProfileFormState ? (
                  <NostrProfileEditor
                    accountId={primaryNostrAccountId}
                    state={nostrProfileFormState}
                    onFieldChange={handleNostrProfileFieldChange}
                    onSave={handleNostrProfileSave}
                    onImport={handleNostrProfileImport}
                    onCancel={() => {
                      setNostrProfileFormState(null);
                      setNostrProfileAccountId(null);
                    }}
                    onToggleAdvanced={() =>
                      setNostrProfileFormState((current) =>
                        current
                          ? { ...current, showAdvanced: !current.showAdvanced }
                          : current,
                      )
                    }
                  />
                ) : channel.id === "nostr" && channel.accounts.length > 0 ? (
                  <div className="channels-actions channels-actions--tight">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleNostrProfileEdit(channel)}
                    >
                      Edit Profile
                    </Button>
                  </div>
                ) : null}

                <div className="channels-actions">
                  <Button
                    size="sm"
                    variant={channel.enabled ? "ghost" : "secondary"}
                    onClick={() => void toggleChannelEnabled(channel)}
                    loading={isBusy}
                  >
                    <ToggleLeft size={14} />
                    {channel.enabled ? "Disable" : "Enable"}
                  </Button>
                  {channel.id === "whatsapp" ? (
                    <>
                      <Button size="sm" onClick={() => void startWhatsAppLogin(false)} loading={whatsAppBusy}>
                        <Play size={14} />
                        Show QR
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void startWhatsAppLogin(true)}
                        loading={whatsAppBusy}
                      >
                        <RefreshCw size={14} />
                        Relink
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void waitWhatsAppLogin()}
                        loading={whatsAppBusy}
                      >
                        <Link2 size={14} />
                        Wait
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void logoutWhatsApp()}
                        loading={whatsAppBusy}
                      >
                        <LogOut size={14} />
                        Logout
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => requestRefresh(true)}
                      loading={channelsQuery.isFetching && probe}
                    >
                      <TestTube2 size={14} />
                      Probe
                    </Button>
                  )}
                </div>

                <div className="channels-config">
                  <div className="channels-config__header">
                    <div>
                      <h4>Configuration</h4>
                      <p>
                        {configQuery.data?.path ?? "Gateway config"} · channels.{channel.id}
                      </p>
                    </div>
                    <div className="channels-config__status">
                      <StatusBadge
                        status={configQuery.data?.valid === false ? "error" : "connected"}
                        label={configQuery.data?.valid === false ? "Invalid" : "Ready"}
                      />
                    </div>
                  </div>

                  <ChannelConfigForm
                    channelId={channel.id}
                    schemaResponse={schemaQuery.data ?? null}
                    value={currentDraft}
                    disabled={Boolean(isBusy || schemaQuery.isFetching)}
                    mode={channelModes[channel.id] ?? "form"}
                    rawValue={channelRawDrafts[channel.id] ?? "{}"}
                    rawError={channelRawErrors[channel.id] ?? null}
                    onModeChange={(mode) =>
                      setChannelModes((current) => ({ ...current, [channel.id]: mode }))
                    }
                    onPatch={(path, value) => patchChannelDraft(channel.id, path, value)}
                    onRawChange={(value) =>
                      setChannelRawDrafts((current) => ({ ...current, [channel.id]: value }))
                    }
                    onApplyRaw={() => applyRawDraft(channel.id)}
                  />

                  <div className="channels-actions">
                    <Button
                      size="sm"
                      onClick={() => void persistChannelConfig(channel.id)}
                      loading={isBusy}
                      disabled={!isDirty}
                    >
                      <Save size={14} />
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void reloadChannelConfig(channel.id)}
                      loading={isBusy}
                    >
                      <RotateCcw size={14} />
                      Reload
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="workspace-section channels-snapshot">
        <div className="workspace-section__header">
          <div>
            <h3>Channel Health</h3>
            <p>Raw `channels.status` snapshot from the gateway for parity checks and diagnostics.</p>
          </div>
          <div className="channels-snapshot__meta">
            <StatusBadge
              status={probe ? "connected" : "idle"}
              label={probe ? "Deep probe" : "Fast mode"}
            />
            <span className="workspace-meta">
              {channelsQuery.data
                ? `Updated ${formatRelativeTime(channelsQuery.data.ts)}`
                : "Waiting for data"}
            </span>
          </div>
        </div>

        <pre className="channels-snapshot__code">
          {JSON.stringify(channelsQuery.data ?? null, null, 2)}
        </pre>

        {configQuery.data?.issues && configQuery.data.issues.length > 0 && (
          <div className="channels-issues">
            {configQuery.data.issues.map((issue, index) => (
              <div key={`${issue.path}-${index}`} className="channels-issues__row">
                <strong>{issue.path}</strong>
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
