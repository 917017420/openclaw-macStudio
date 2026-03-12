import { Upload } from "lucide-react";
import { Button } from "@/components/ui";
import { isChineseLanguage, useAppPreferencesStore } from "@/features/preferences/store";
import type { NostrProfile, NostrProfileFormState } from "./channel-types";

type NostrProfileEditorProps = {
  accountId: string;
  state: NostrProfileFormState;
  onFieldChange: (field: keyof NostrProfile, value: string) => void;
  onSave: () => void;
  onImport: () => void;
  onCancel: () => void;
  onToggleAdvanced: () => void;
};

function isDirty(state: NostrProfileFormState) {
  return JSON.stringify(state.values) !== JSON.stringify(state.original);
}

function Field(props: {
  label: string;
  field: keyof NostrProfile;
  state: NostrProfileFormState;
  type?: "text" | "url" | "textarea";
  placeholder?: string;
  help?: string;
  onFieldChange: (field: keyof NostrProfile, value: string) => void;
}) {
  const { label, field, state, type = "text", placeholder, help, onFieldChange } = props;
  const value = state.values[field] ?? "";
  const error = state.fieldErrors[field];

  return (
    <label className="channels-form-field">
      <span className="channels-form-label">{label}</span>
      {help && <span className="channels-form-help">{help}</span>}
      {type === "textarea" ? (
        <textarea
          className="channels-input channels-input--textarea"
          value={value}
          placeholder={placeholder}
          disabled={state.saving}
          onChange={(event) => onFieldChange(field, event.target.value)}
        />
      ) : (
        <input
          className="channels-input"
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={state.saving}
          onChange={(event) => onFieldChange(field, event.target.value)}
        />
      )}
      {error && <span className="channels-form-error">{error}</span>}
    </label>
  );
}

export function NostrProfileEditor(props: NostrProfileEditorProps) {
  const { accountId, state, onFieldChange, onSave, onImport, onCancel, onToggleAdvanced } = props;
  const language = useAppPreferencesStore((store) => store.language);
  const isChinese = isChineseLanguage(language);
  const copy = isChinese
    ? {
        title: "Nostr 资料",
        subtitle: `为账号 \`${accountId}\` 发布 kind:0 资料。`,
        account: `账号 ${accountId}`,
        unsaved: "未保存",
        synced: "已同步",
        previewAlt: "Nostr 资料预览",
        username: "用户名",
        usernameHelp: "简短的资料名称。",
        displayName: "显示名",
        displayNameHelp: "展示给其他客户端的名称。",
        avatarUrl: "头像地址",
        avatarUrlHelp: "HTTPS 图片地址。",
        bio: "简介",
        bioPlaceholder: "介绍一下这个 relay 身份…",
        bioHelp: "自由填写的资料说明。",
        bannerUrl: "横幅地址",
        website: "网站",
        saveAndPublish: "保存并发布",
        import: "导入",
        hideAdvanced: "收起高级项",
        showAdvanced: "显示高级项",
        cancel: "取消",
      }
    : {
        title: "Nostr Profile",
        subtitle: `Publish a kind:0 profile for account \`${accountId}\`.`,
        account: `account ${accountId}`,
        unsaved: "unsaved",
        synced: "synced",
        previewAlt: "Nostr profile preview",
        username: "Username",
        usernameHelp: "Short profile name.",
        displayName: "Display Name",
        displayNameHelp: "Name shown to other clients.",
        avatarUrl: "Avatar URL",
        avatarUrlHelp: "HTTPS image URL.",
        bio: "Bio",
        bioPlaceholder: "Tell people about this relay identity...",
        bioHelp: "Free-form profile description.",
        bannerUrl: "Banner URL",
        website: "Website",
        saveAndPublish: "Save & Publish",
        import: "Import",
        hideAdvanced: "Hide Advanced",
        showAdvanced: "Show Advanced",
        cancel: "Cancel",
      };

  return (
    <div className="channels-profile-editor">
      <div className="channels-profile-editor__header">
        <div>
          <h4>{copy.title}</h4>
          <p>{copy.subtitle}</p>
        </div>
        <div className="channels-card__meta">
          <span>{copy.account}</span>
          <span>{isDirty(state) ? copy.unsaved : copy.synced}</span>
        </div>
      </div>

      {state.error && <div className="workspace-alert workspace-alert--error channels-page__alert">{state.error}</div>}
      {state.success && <div className="workspace-alert workspace-alert--info channels-page__alert">{state.success}</div>}

      {state.values.picture && (
        <div className="channels-profile-editor__preview">
          <img
            src={state.values.picture}
            alt={copy.previewAlt}
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        </div>
      )}

      <div className="channels-profile-editor__grid">
        <Field
          label={copy.username}
          field="name"
          state={state}
          placeholder="satoshi"
          help={copy.usernameHelp}
          onFieldChange={onFieldChange}
        />
        <Field
          label={copy.displayName}
          field="displayName"
          state={state}
          placeholder="Satoshi Nakamoto"
          help={copy.displayNameHelp}
          onFieldChange={onFieldChange}
        />
        <Field
          label={copy.avatarUrl}
          field="picture"
          type="url"
          state={state}
          placeholder="https://example.com/avatar.png"
          help={copy.avatarUrlHelp}
          onFieldChange={onFieldChange}
        />
        <Field
          label={copy.bio}
          field="about"
          type="textarea"
          state={state}
          placeholder={copy.bioPlaceholder}
          help={copy.bioHelp}
          onFieldChange={onFieldChange}
        />
      </div>

      {state.showAdvanced && (
        <div className="channels-profile-editor__advanced">
          <Field
            label={copy.bannerUrl}
            field="banner"
            type="url"
            state={state}
            placeholder="https://example.com/banner.png"
            onFieldChange={onFieldChange}
          />
          <Field
            label={copy.website}
            field="website"
            type="url"
            state={state}
            placeholder="https://example.com"
            onFieldChange={onFieldChange}
          />
          <Field
            label="NIP-05"
            field="nip05"
            state={state}
            placeholder="you@example.com"
            onFieldChange={onFieldChange}
          />
          <Field
            label="LUD-16"
            field="lud16"
            state={state}
            placeholder="you@getalby.com"
            onFieldChange={onFieldChange}
          />
        </div>
      )}

      <div className="channels-actions">
        <Button type="button" size="sm" onClick={onSave} loading={state.saving} disabled={!isDirty(state)}>
          {copy.saveAndPublish}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onImport} loading={state.importing}>
          <Upload size={14} />
          {copy.import}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onToggleAdvanced}>
          {state.showAdvanced ? copy.hideAdvanced : copy.showAdvanced}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  );
}
