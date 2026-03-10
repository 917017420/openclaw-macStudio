import { Upload } from "lucide-react";
import { Button } from "@/components/ui";
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

  return (
    <div className="channels-profile-editor">
      <div className="channels-profile-editor__header">
        <div>
          <h4>Nostr Profile</h4>
          <p>Publish a kind:0 profile for account `{accountId}`.</p>
        </div>
        <div className="channels-card__meta">
          <span>account {accountId}</span>
          <span>{isDirty(state) ? "unsaved" : "synced"}</span>
        </div>
      </div>

      {state.error && <div className="workspace-alert workspace-alert--error channels-page__alert">{state.error}</div>}
      {state.success && <div className="workspace-alert workspace-alert--info channels-page__alert">{state.success}</div>}

      {state.values.picture && (
        <div className="channels-profile-editor__preview">
          <img
            src={state.values.picture}
            alt="Nostr profile preview"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        </div>
      )}

      <div className="channels-profile-editor__grid">
        <Field
          label="Username"
          field="name"
          state={state}
          placeholder="satoshi"
          help="Short profile name."
          onFieldChange={onFieldChange}
        />
        <Field
          label="Display Name"
          field="displayName"
          state={state}
          placeholder="Satoshi Nakamoto"
          help="Name shown to other clients."
          onFieldChange={onFieldChange}
        />
        <Field
          label="Avatar URL"
          field="picture"
          type="url"
          state={state}
          placeholder="https://example.com/avatar.png"
          help="HTTPS image URL."
          onFieldChange={onFieldChange}
        />
        <Field
          label="Bio"
          field="about"
          type="textarea"
          state={state}
          placeholder="Tell people about this relay identity..."
          help="Free-form profile description."
          onFieldChange={onFieldChange}
        />
      </div>

      {state.showAdvanced && (
        <div className="channels-profile-editor__advanced">
          <Field
            label="Banner URL"
            field="banner"
            type="url"
            state={state}
            placeholder="https://example.com/banner.png"
            onFieldChange={onFieldChange}
          />
          <Field
            label="Website"
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
          Save & Publish
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onImport} loading={state.importing}>
          <Upload size={14} />
          Import
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onToggleAdvanced}>
          {state.showAdvanced ? "Hide Advanced" : "Show Advanced"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
