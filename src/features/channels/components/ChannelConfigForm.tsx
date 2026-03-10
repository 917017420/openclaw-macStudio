import { Fragment } from "react";
import { Code2, ListPlus, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import {
  asRecord,
  defaultValue,
  hintForPath,
  humanize,
  pathKey,
  resolveSchemaNode,
  schemaTags,
  schemaType,
} from "./channel-data";
import type { ConfigSchemaResponse, JsonSchema } from "./channel-types";

type PathSegment = string | number;

type ChannelConfigFormProps = {
  channelId: string;
  schemaResponse: ConfigSchemaResponse | null | undefined;
  value: Record<string, unknown>;
  disabled?: boolean;
  mode: "form" | "raw";
  rawValue: string;
  rawError: string | null;
  onModeChange: (mode: "form" | "raw") => void;
  onPatch: (path: PathSegment[], value: unknown) => void;
  onRawChange: (value: string) => void;
  onApplyRaw: () => void;
};

function NodeLabel(props: {
  label: string;
  help?: string;
  tags?: string[];
  required?: boolean;
}) {
  const { label, help, tags, required } = props;
  return (
    <div className="channels-form-label-row">
      <div>
        <label className="channels-form-label">
          {label}
          {required && <span className="channels-form-label__required">Required</span>}
        </label>
        {help && <p className="channels-form-help">{help}</p>}
      </div>
      {tags && tags.length > 0 && (
        <div className="channels-form-tags">
          {tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function RenderNode(props: {
  schema: JsonSchema;
  value: unknown;
  path: PathSegment[];
  disabled: boolean;
  label?: string;
  required?: boolean;
  hints: ConfigSchemaResponse["uiHints"];
  showLabel?: boolean;
  onPatch: (path: PathSegment[], value: unknown) => void;
}) {
  const {
    schema,
    value,
    path,
    disabled,
    label,
    required,
    hints,
    showLabel = true,
    onPatch,
  } = props;
  const hint = hintForPath(path, hints);
  const displayLabel =
    hint?.label ??
    schema.title ??
    label ??
    humanize(String(path.length > 0 ? path[path.length - 1] : "Value"));
  const help = hint?.help ?? schema.description;
  const tags = schemaTags(schema, hint);
  const type = schemaType(schema);

  const effectiveLabel = showLabel ? (
    <NodeLabel label={displayLabel} help={help} tags={tags} required={required} />
  ) : null;

  const renderFallback = (message: string) => (
    <div className="channels-form-unsupported">
      <div>{message}</div>
      <div className="channels-form-unsupported__path mono">{pathKey(path)}</div>
    </div>
  );

  const renderTextInput = (inputType: "text" | "password" | "number") => {
    const stringValue =
      typeof value === "string" || typeof value === "number" ? String(value) : value == null ? "" : String(value);
    const multiline =
      schema.format === "textarea" ||
      typeof value === "string" && value.includes("\n") ||
      (schema.maxLength ?? 0) > 120;
    if (inputType !== "number" && multiline) {
      return (
        <div className="channels-form-field">
          {effectiveLabel}
          <textarea
            className="channels-input channels-input--textarea mono"
            value={stringValue}
            disabled={disabled}
            placeholder={hint?.placeholder}
            onChange={(event) => onPatch(path, event.target.value)}
          />
        </div>
      );
    }
    return (
      <div className="channels-form-field">
        {effectiveLabel}
        <input
          className="channels-input mono"
          type={inputType}
          value={stringValue}
          disabled={disabled}
          placeholder={hint?.placeholder}
          min={schema.minimum}
          max={schema.maximum}
          onChange={(event) => {
            const nextValue =
              inputType === "number"
                ? event.target.value === ""
                  ? undefined
                  : Number(event.target.value)
                : event.target.value;
            onPatch(path, nextValue);
          }}
        />
      </div>
    );
  };

  if (schema.const !== undefined) {
    return (
      <div className="channels-form-field">
        {effectiveLabel}
        <div className="channels-form-readonly">{String(schema.const)}</div>
      </div>
    );
  }

  if (schema.enum && schema.enum.length > 0) {
    return (
      <div className="channels-form-field">
        {effectiveLabel}
        {schema.enum.length <= 4 ? (
          <div className="channels-segmented">
            {schema.enum.map((entry) => {
              const active = entry === value || String(entry) === String(value ?? "");
              return (
                <button
                  key={String(entry)}
                  type="button"
                  className={`channels-segmented__btn ${active ? "is-active" : ""}`}
                  disabled={disabled}
                  onClick={() => onPatch(path, entry)}
                >
                  {String(entry)}
                </button>
              );
            })}
          </div>
        ) : (
          <select
            className="channels-input"
            value={String(value ?? schema.default ?? "")}
            disabled={disabled}
            onChange={(event) => onPatch(path, event.target.value)}
          >
            {schema.enum.map((entry) => (
              <option key={String(entry)} value={String(entry)}>
                {String(entry)}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }

  if (schema.oneOf || schema.anyOf) {
    const variants = (schema.oneOf ?? schema.anyOf ?? []).filter(Boolean);
    const literalVariants = variants.filter((variant) => variant.const !== undefined);
    if (literalVariants.length === variants.length && literalVariants.length > 0) {
      return (
        <div className="channels-form-field">
          {effectiveLabel}
          <div className="channels-segmented">
            {literalVariants.map((variant) => {
              const entry = variant.const;
              const active = entry === value || String(entry) === String(value ?? "");
              return (
                <button
                  key={String(entry)}
                  type="button"
                  className={`channels-segmented__btn ${active ? "is-active" : ""}`}
                  disabled={disabled}
                  onClick={() => onPatch(path, entry)}
                >
                  {String(entry)}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    const primitiveType = variants
      .map((variant) => schemaType(variant))
      .find((entry) => entry === "string" || entry === "number" || entry === "integer" || entry === "boolean");
    if (primitiveType === "boolean") {
      const checked = typeof value === "boolean" ? value : Boolean(schema.default);
      return (
        <label className={`channels-toggle-row ${disabled ? "is-disabled" : ""}`}>
          <div className="channels-toggle-row__content">
            <NodeLabel label={displayLabel} help={help} tags={tags} required={required} />
          </div>
          <div className="channels-toggle">
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(event) => onPatch(path, event.target.checked)}
            />
            <span className="channels-toggle__track" />
          </div>
        </label>
      );
    }
    if (primitiveType === "number" || primitiveType === "integer") {
      return renderTextInput("number");
    }
    if (primitiveType === "string") {
      return renderTextInput(hint?.sensitive ? "password" : "text");
    }
    return renderFallback("Unsupported union type. Switch to Raw JSON to edit this field.");
  }

  if (type === "object") {
    const objectValue = asRecord(value) ?? {};
    const properties = schema.properties ?? {};
    const orderedKeys = Object.entries(properties).sort((left, right) => {
      const leftHint = hintForPath([...path, left[0]], hints)?.order ?? 50;
      const rightHint = hintForPath([...path, right[0]], hints)?.order ?? 50;
      return leftHint - rightHint || left[0].localeCompare(right[0]);
    });
    const dynamicKeys = Object.keys(objectValue)
      .filter((key) => !(key in properties))
      .sort((left, right) => left.localeCompare(right));
    const childEntries = [
      ...orderedKeys,
      ...dynamicKeys.map((key) => [key, schema.additionalProperties && typeof schema.additionalProperties === "object" ? schema.additionalProperties : { type: "string" }] as const),
    ];
    const requiredKeys = new Set(schema.required ?? []);

    return (
      <div className={`channels-object ${showLabel ? "channels-object--boxed" : ""}`}>
        {showLabel && (
          <div className="channels-object__header">
            <NodeLabel label={displayLabel} help={help} tags={tags} required={required} />
            {schema.additionalProperties && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  const nextKey = window.prompt(`Add key under ${displayLabel}`)?.trim();
                  if (!nextKey || nextKey in objectValue) {
                    return;
                  }
                  const template =
                    schema.additionalProperties && typeof schema.additionalProperties === "object"
                      ? defaultValue(schema.additionalProperties)
                      : "";
                  onPatch([...path, nextKey], template);
                }}
              >
                <Plus size={14} />
                Add entry
              </Button>
            )}
          </div>
        )}
        {childEntries.length > 0 ? (
          <div className="channels-object__body">
            {childEntries.map(([key, childSchema]) => {
              const isDynamic = !(key in properties);
              return (
                <Fragment key={`${pathKey(path)}.${key}`}>
                  <div className="channels-object__row">
                    <RenderNode
                      schema={childSchema}
                      value={objectValue[key]}
                      path={[...path, key]}
                      disabled={disabled}
                      label={key}
                      required={requiredKeys.has(key)}
                      hints={hints}
                      onPatch={onPatch}
                    />
                    {isDynamic && (
                      <button
                        type="button"
                        className="channels-icon-btn"
                        disabled={disabled}
                        onClick={() => onPatch([...path, key], undefined)}
                        aria-label={`Remove ${key}`}
                      >
                        <Minus size={14} />
                      </button>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>
        ) : (
          <div className="channels-form-empty-inline">No editable fields in this section yet.</div>
        )}
      </div>
    );
  }

  if (type === "array") {
    const itemsSchema = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    const arrayValue = Array.isArray(value) ? value : [];
    return (
      <div className="channels-array">
        <div className="channels-array__header">
          <NodeLabel label={displayLabel} help={help} tags={tags} required={required} />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onPatch(path, [...arrayValue, defaultValue(itemsSchema)])}
          >
            <ListPlus size={14} />
            Add item
          </Button>
        </div>
        {arrayValue.length > 0 ? (
          <div className="channels-array__body">
            {arrayValue.map((entry, index) => (
              <div key={`${pathKey(path)}.${index}`} className="channels-array__item">
                {itemsSchema ? (
                  <RenderNode
                    schema={itemsSchema}
                    value={entry}
                    path={[...path, index]}
                    disabled={disabled}
                    label={`Item ${index + 1}`}
                    hints={hints}
                    onPatch={onPatch}
                  />
                ) : (
                  renderFallback("Array item schema unavailable. Use Raw JSON.")
                )}
                <button
                  type="button"
                  className="channels-icon-btn"
                  disabled={disabled}
                  onClick={() => onPatch([...path, index], undefined)}
                  aria-label={`Remove item ${index + 1}`}
                >
                  <Minus size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="channels-form-empty-inline">No items configured.</div>
        )}
      </div>
    );
  }

  if (type === "boolean") {
    const checked = typeof value === "boolean" ? value : Boolean(schema.default);
    return (
      <label className={`channels-toggle-row ${disabled ? "is-disabled" : ""}`}>
        <div className="channels-toggle-row__content">
          <NodeLabel label={displayLabel} help={help} tags={tags} required={required} />
        </div>
        <div className="channels-toggle">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onPatch(path, event.target.checked)}
          />
          <span className="channels-toggle__track" />
        </div>
      </label>
    );
  }

  if (type === "number" || type === "integer") {
    return renderTextInput("number");
  }

  if (type === "string") {
    return renderTextInput(hint?.sensitive ? "password" : "text");
  }

  return renderFallback("This field type is not yet supported in the structured editor.");
}

export function ChannelConfigForm(props: ChannelConfigFormProps) {
  const {
    channelId,
    schemaResponse,
    value,
    disabled = false,
    mode,
    rawValue,
    rawError,
    onModeChange,
    onPatch,
    onRawChange,
    onApplyRaw,
  } = props;
  const node = resolveSchemaNode(schemaResponse?.schema, ["channels", channelId]);

  return (
    <div className="channels-config-panel">
      <div className="channels-config-toolbar">
        <div className="channels-config-toolbar__modes">
          <button
            type="button"
            className={`channels-config-toolbar__mode ${mode === "form" ? "is-active" : ""}`}
            onClick={() => onModeChange("form")}
          >
            Structured
          </button>
          <button
            type="button"
            className={`channels-config-toolbar__mode ${mode === "raw" ? "is-active" : ""}`}
            onClick={() => onModeChange("raw")}
          >
            <Code2 size={13} />
            Raw JSON
          </button>
        </div>
      </div>

      {mode === "raw" ? (
        <div className="channels-raw-editor">
          <textarea
            className="channels-input channels-input--textarea channels-input--code mono"
            value={rawValue}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => onRawChange(event.target.value)}
          />
          {rawError && <div className="workspace-alert workspace-alert--error channels-page__alert">{rawError}</div>}
          <div className="channels-raw-editor__actions">
            <Button type="button" size="sm" variant="secondary" onClick={onApplyRaw} disabled={disabled}>
              Apply Raw Changes
            </Button>
          </div>
        </div>
      ) : node ? (
        <div className="channels-config-form">
          <RenderNode
            schema={node}
            value={value}
            path={[]}
            disabled={disabled}
            hints={schemaResponse?.uiHints ?? {}}
            showLabel={false}
            onPatch={onPatch}
          />
        </div>
      ) : (
        <div className="workspace-alert workspace-alert--error channels-page__alert">
          Channel config schema unavailable. Switch to Raw JSON to edit this section.
        </div>
      )}
    </div>
  );
}
