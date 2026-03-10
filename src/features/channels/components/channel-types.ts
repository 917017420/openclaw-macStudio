export type JsonRecord = Record<string, unknown>;

export type ProbeSummary = {
  ok?: boolean | null;
  status?: number | null;
  error?: string | null;
  elapsedMs?: number | null;
};

export type ConfigSnapshotIssue = {
  path: string;
  message: string;
};

export type ConfigSnapshot = {
  path?: string | null;
  exists?: boolean | null;
  raw?: string | null;
  hash?: string | null;
  valid?: boolean | null;
  config?: JsonRecord | null;
  issues?: ConfigSnapshotIssue[] | null;
};

export type ConfigUiHint = {
  label?: string;
  help?: string;
  tags?: string[];
  group?: string;
  order?: number;
  advanced?: boolean;
  sensitive?: boolean;
  placeholder?: string;
  itemTemplate?: unknown;
};

export type ConfigUiHints = Record<string, ConfigUiHint>;

export type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  tags?: string[];
  "x-tags"?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  additionalProperties?: JsonSchema | boolean;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  nullable?: boolean;
  format?: string;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
};

export type ConfigSchemaResponse = {
  schema: JsonSchema;
  uiHints: ConfigUiHints;
  version?: string;
  generatedAt?: string;
};

export type ChannelUiMetaEntry = {
  id: string;
  label: string;
  detailLabel?: string;
  systemImage?: string;
};

export type ChannelAccountSnapshot = {
  accountId: string;
  name?: string | null;
  enabled?: boolean | null;
  configured?: boolean | null;
  linked?: boolean | null;
  running?: boolean | null;
  connected?: boolean | null;
  reconnectAttempts?: number | null;
  lastConnectedAt?: number | null;
  lastError?: string | null;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  lastProbeAt?: number | null;
  mode?: string | null;
  dmPolicy?: string | null;
  allowFrom?: string[] | null;
  tokenSource?: string | null;
  botTokenSource?: string | null;
  appTokenSource?: string | null;
  credentialSource?: string | null;
  audienceType?: string | null;
  audience?: string | null;
  webhookPath?: string | null;
  webhookUrl?: string | null;
  baseUrl?: string | null;
  allowUnmentionedGroups?: boolean | null;
  cliPath?: string | null;
  dbPath?: string | null;
  port?: number | null;
  publicKey?: string | null;
  profile?: JsonRecord | null;
  probe?: unknown;
};

export type ChannelsStatusSnapshot = {
  ts: number;
  channelOrder: string[];
  channelLabels: Record<string, string>;
  channelDetailLabels: Record<string, string>;
  channelSystemImages: Record<string, string>;
  channelMeta: ChannelUiMetaEntry[];
  channels: Record<string, JsonRecord>;
  channelAccounts: Record<string, ChannelAccountSnapshot[]>;
  channelDefaultAccountId: Record<string, string>;
};

export type ChannelDefinition = {
  id: string;
  label: string;
  detail: string;
  systemImage?: string;
  status: JsonRecord | undefined;
  accounts: ChannelAccountSnapshot[];
  defaultAccountId?: string;
  enabled: boolean;
};

export type StatusItem = {
  label: string;
  value: string;
};

export type FeedbackMessage = {
  kind: "error" | "info" | "success";
  message: string;
};

export type NostrProfile = {
  name?: string;
  displayName?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string;
  nip05?: string;
  lud16?: string;
};

export type NostrProfileFormState = {
  values: NostrProfile;
  original: NostrProfile;
  saving: boolean;
  importing: boolean;
  error: string | null;
  success: string | null;
  fieldErrors: Record<string, string>;
  showAdvanced: boolean;
};
