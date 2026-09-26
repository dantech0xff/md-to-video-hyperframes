/**
 * A form for one part of a script, built from the JSON Schema the engine
 * gives (design doc §12, 2.3): a field per property, lists that grow, shrink
 * and reorder, a switch between the shapes a union takes, and the engine's
 * problems under the fields they are about. What the engine decides stays
 * there: the form only shows the limits it knows (lengths, counts).
 */
import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import type { JsonSchema, Problem } from "../../../shared/types";
import { blank, bounds, branchLabel, branchOf, childPath, fieldKind, fieldLabel, messagesAt, problemsUnder, withField } from "../lib/schema-form";

type ObjectSchema = JsonSchema & { properties: Record<string, JsonSchema>; required: string[] };

export function SchemaForm(props: {
  schema: ObjectSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  /** fields shown folded, under "Nâng cao" */
  advanced?: string[];
  problems: Problem[];
  disabled?: boolean;
}) {
  const { schema, value, problems, advanced = [] } = props;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const names = Object.keys(schema.properties);
  const extra = names.filter((n) => advanced.includes(n));
  const field = (name: string) => (
    <Field
      key={name}
      name={name}
      label={fieldLabel(name)}
      path={name}
      schema={schema.properties[name]}
      value={value[name]}
      required={schema.required.includes(name)}
      onChange={(v) => props.onChange(withField(value, name, v))}
      problems={problems}
      disabled={props.disabled}
    />
  );
  // a problem in a folded field unfolds it
  const open = showAdvanced || extra.some((n) => problemsUnder(problems, n));
  return (
    <div className="sf">
      {names.filter((n) => !advanced.includes(n)).map(field)}
      {extra.length > 0 && (
        <div className="sf-advanced">
          <button type="button" className="btn ghost small" onClick={() => setShowAdvanced(!open)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Nâng cao: nhịp hiệu ứng, chuyển cảnh, âm thanh, nhân vật
          </button>
          {open && <div className="sf">{extra.map(field)}</div>}
        </div>
      )}
    </div>
  );
}

interface FieldProps {
  /** the property's name; empty for an item of a list */
  name: string;
  /** empty when something around the field names it already */
  label: string;
  /** where the engine reports its problems: "items.1.text" */
  path: string;
  schema: JsonSchema;
  value: unknown;
  /** a required field is never removed; an optional one left empty is */
  required: boolean;
  onChange: (value: unknown) => void;
  problems: Problem[];
  disabled?: boolean;
}

function Field(p: FieldProps) {
  const kind = fieldKind(p.schema, p.name);
  switch (kind.kind) {
    case "const":
      return null;
    case "text":
      return <TextField {...p} multiline={kind.multiline} />;
    case "enum":
      return (
        <Shell {...p}>
          <select
            value={p.value === undefined ? "" : String(p.value)}
            disabled={p.disabled}
            onChange={(e) => p.onChange(e.target.value === "" ? undefined : kind.options.find((o) => String(o) === e.target.value))}
          >
            {(!p.required || p.value === undefined) && <option value="">{p.required ? "Chọn…" : "Mặc định"}</option>}
            {kind.options.map((o) => (
              <option key={String(o)} value={String(o)}>
                {String(o)}
              </option>
            ))}
          </select>
        </Shell>
      );
    case "number":
      return (
        <Shell {...p}>
          <NumberInput value={p.value} integer={kind.integer} disabled={p.disabled} onChange={p.onChange} above={p.schema.exclusiveMinimum} {...bounds(p.schema)} />
        </Shell>
      );
    case "boolean":
      return (
        <Shell {...p}>
          {p.required ? (
            <label className="row small">
              <input type="checkbox" checked={p.value === true} disabled={p.disabled} onChange={(e) => p.onChange(e.target.checked)} /> Có
            </label>
          ) : (
            <select value={p.value === undefined ? "" : String(p.value)} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value === "" ? undefined : e.target.value === "true")}>
              <option value="">Mặc định</option>
              <option value="true">Có</option>
              <option value="false">Không</option>
            </select>
          )}
        </Shell>
      );
    case "list":
      return <ListField {...p} item={kind.item} />;
    case "tuple":
      return (
        <Optional {...p}>
          {(value) => (
            <div className="sf-tuple">
              {kind.items.map((item, i) => (
                <Field
                  key={i}
                  name=""
                  label=""
                  path={childPath(p.path, i)}
                  schema={item}
                  value={Array.isArray(value) ? value[i] : undefined}
                  required
                  onChange={(v) => p.onChange(kind.items.map((_, j) => (j === i ? v : Array.isArray(value) ? value[j] : blank(kind.items[j]))))}
                  problems={p.problems}
                  disabled={p.disabled}
                />
              ))}
            </div>
          )}
        </Optional>
      );
    case "object":
      return (
        <Optional {...p}>
          {(value) => {
            const obj = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
            return (
              <div className={p.label ? "sf-group" : "sf"}>
                {Object.entries(kind.properties).map(([name, schema]) => (
                  <Field
                    key={name}
                    name={name}
                    label={fieldLabel(name)}
                    path={childPath(p.path, name)}
                    schema={schema}
                    value={obj[name]}
                    required={kind.required.includes(name)}
                    onChange={(v) => p.onChange(withField(obj, name, v))}
                    problems={p.problems}
                    disabled={p.disabled}
                  />
                ))}
              </div>
            );
          }}
        </Optional>
      );
    case "union":
      return <UnionField {...p} branches={kind.branches} />;
    default:
      return <JsonField {...p} />;
  }
}

/** The field's name, what the engine says about it and, inside, its input; without a name, the input and its aside share a line. */
function Shell(p: FieldProps & { children: ReactNode; aside?: ReactNode; hint?: ReactNode }) {
  const messages = messagesAt(p.problems, p.path);
  return (
    <div className={`sf-field${messages.length ? " invalid" : ""}`}>
      {p.label && (
        <div className="sf-label">
          <span>{p.label}</span>
          {p.required && <span className="sf-required">*</span>}
          {p.name && p.label !== p.name && <span className="mono faint">{p.name}</span>}
          <span className="grow" />
          {p.aside}
        </div>
      )}
      {!p.label && p.aside ? (
        <div className="sf-inline">
          {p.children}
          {p.aside}
        </div>
      ) : (
        p.children
      )}
      {p.hint && <span className="small muted">{p.hint}</span>}
      {messages.map((m, i) => (
        <span key={i} className="sf-error">
          {m}
        </span>
      ))}
    </div>
  );
}

function TextField(p: FieldProps & { multiline: boolean }) {
  const text = typeof p.value === "string" ? p.value : "";
  const max = p.schema.maxLength;
  // the engine counts UTF-16 units, as String.length does
  const count = max !== undefined && (
    <span className={`sf-count${text.length > max ? " over" : ""}`}>
      {text.length}/{max}
    </span>
  );
  // an optional field left empty is removed from the script
  const change = (next: string) => p.onChange(next === "" && !p.required ? undefined : next);
  const hint = p.name === "voice" && "Các dấu {…} như {1}, {pause:2}, {show:api} chỉnh hiệu ứng theo lời đọc và không được đọc lên: giữ nguyên nếu không chắc.";
  return (
    <Shell {...p} aside={count} hint={hint}>
      {p.multiline ? (
        <textarea rows={p.name === "voice" ? 3 : 4} value={text} disabled={p.disabled} onChange={(e) => change(e.target.value)} className={p.name === "code" ? "mono" : undefined} />
      ) : (
        <input type="text" value={text} disabled={p.disabled} onChange={(e) => change(e.target.value)} />
      )}
    </Shell>
  );
}

/** A number typed as text: "1," and "-" are on their way to a number, not wrong yet. */
function NumberInput(p: { value: unknown; integer: boolean; min?: number; max?: number; above?: number; disabled?: boolean; onChange: (value: unknown) => void }) {
  const shown = (v: unknown) => (v === undefined ? "" : String(v));
  const [text, setText] = useState(shown(p.value));
  useEffect(() => {
    // the value changed from elsewhere (an item moved up): show it
    setText((t) => (parse(t) === p.value ? t : shown(p.value)));
  }, [p.value]);
  const from = p.above !== undefined ? `lớn hơn ${p.above}` : p.min !== undefined && `từ ${p.min}`;
  const range = [from, p.max !== undefined && `đến ${p.max}`].filter(Boolean).join(" ");
  return (
    <input
      type="text"
      inputMode={p.integer ? "numeric" : "decimal"}
      placeholder={range ? `${p.integer ? "Số nguyên" : "Số"} ${range}` : undefined}
      value={text}
      disabled={p.disabled}
      onChange={(e) => {
        setText(e.target.value);
        p.onChange(parse(e.target.value));
      }}
    />
  );
}

/** A number, nothing for an empty box, the text itself when it is no number (the engine then says so). */
function parse(text: string): unknown {
  if (!text.trim()) return undefined;
  const n = Number(text.trim().replace(",", "."));
  return Number.isFinite(n) ? n : text;
}

/** A compound field the script may leave out: a button to add it, and one to take it out again. */
function Optional(p: FieldProps & { children: (value: unknown) => ReactNode }) {
  if (p.value === undefined && !p.required) {
    return (
      <Shell {...p}>
        <div>
          <button type="button" className="btn small" disabled={p.disabled} onClick={() => p.onChange(blank(p.schema))}>
            <Plus size={13} /> Thêm
          </button>
        </div>
      </Shell>
    );
  }
  const remove = !p.required && (
    <button type="button" className="btn ghost small" disabled={p.disabled} onClick={() => p.onChange(undefined)}>
      <X size={13} /> Bỏ
    </button>
  );
  return (
    <Shell {...p} aside={remove}>
      {p.children(p.value)}
    </Shell>
  );
}

function ListField(p: FieldProps & { item: JsonSchema }) {
  const items = Array.isArray(p.value) ? p.value : [];
  const min = p.schema.minItems ?? 0;
  const max = p.schema.maxItems ?? Infinity;
  // an optional list that needs items is left out once it has none; one that may be empty stays, empty
  const set = (next: unknown[]) => p.onChange(!next.length && !p.required && min > 0 ? undefined : next);
  const move = (from: number, to: number) => {
    const next = [...items];
    next.splice(to, 0, ...next.splice(from, 1));
    set(next);
  };
  const count = Number.isFinite(max) && <span className={`sf-count${items.length > max ? " over" : ""}`}>{items.length}/{max}</span>;
  // text, numbers and choices line up in rows; items with fields of their own get a box each
  const boxed = compound(p.item);
  return (
    <Shell {...p} aside={count}>
      <div className="sf-list">
        {items.map((value, i) => (
          <div key={i} className={`sf-item${boxed ? " boxed" : ""}`}>
            <span className="sf-index">{i + 1}</span>
            <div className="grow">
              <Field
                name=""
                label=""
                path={childPath(p.path, i)}
                schema={p.item}
                value={value}
                required
                onChange={(v) => set(items.map((x, j) => (j === i ? v : x)))}
                problems={p.problems}
                disabled={p.disabled}
              />
            </div>
            <div className="sf-item-actions">
              <button type="button" className="btn ghost icon-btn" aria-label="Lên trên" disabled={p.disabled || i === 0} onClick={() => move(i, i - 1)}>
                <ArrowUp size={14} />
              </button>
              <button type="button" className="btn ghost icon-btn" aria-label="Xuống dưới" disabled={p.disabled || i === items.length - 1} onClick={() => move(i, i + 1)}>
                <ArrowDown size={14} />
              </button>
              <button type="button" className="btn ghost icon-btn" aria-label="Xoá" disabled={p.disabled || items.length <= min} onClick={() => set(items.filter((_, j) => j !== i))}>
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
        <div>
          <button type="button" className="btn small" disabled={p.disabled || items.length >= max} onClick={() => set([...items, blank(p.item)])}>
            <Plus size={13} /> Thêm
          </button>
        </div>
      </div>
    </Shell>
  );
}

function UnionField(p: FieldProps & { branches: JsonSchema[] }) {
  const at = p.value === undefined ? -1 : branchOf(p.branches, p.value);
  const branch = at >= 0 ? p.branches[at] : undefined;
  const switcher = (
    <div className="segmented sf-switch">
      {!p.required && (
        <button type="button" className={p.value === undefined ? "active" : ""} disabled={p.disabled} onClick={() => p.onChange(undefined)}>
          Mặc định
        </button>
      )}
      {p.branches.map((b, i) => (
        <button key={i} type="button" className={i === at ? "active" : ""} disabled={p.disabled} onClick={() => i !== at && p.onChange(blank(b))}>
          {branchLabel(b)}
        </button>
      ))}
    </div>
  );
  // the problems of the field itself show once, around it
  const inner = p.problems.filter((x) => x.path !== p.path);
  const input = (
    <>
      {branch && fieldKind(branch).kind !== "const" && <Field {...p} label="" schema={branch} required problems={inner} />}
      {/* a value none of the shapes takes: shown as it is, to fix by hand */}
      {p.value !== undefined && !branch && <JsonField {...p} label="" problems={inner} />}
    </>
  );
  if (p.label) {
    return (
      <Shell {...p} aside={switcher}>
        {input}
      </Shell>
    );
  }
  // in a list: the switch beside a simple input, above one with fields of its own
  return (
    <Shell {...p}>
      <div className={branch && compound(branch) ? "sf" : "sf-inline"}>
        {switcher}
        <div className="grow">{input}</div>
      </div>
    </Shell>
  );
}

/** Values with parts of their own: an object, a list, a tuple, or a union that can be one. */
function compound(schema: JsonSchema): boolean {
  const kind = fieldKind(schema);
  if (kind.kind === "union") return kind.branches.some(compound);
  return kind.kind === "object" || kind.kind === "list" || kind.kind === "tuple" || kind.kind === "json";
}

/** Any value as JSON, for the rare shape the form has no input for. */
function JsonField(p: FieldProps) {
  const [text, setText] = useState(() => JSON.stringify(p.value ?? null, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <Shell {...p} hint={bad ? "JSON chưa hợp lệ: chưa lưu được ô này." : undefined}>
      <textarea
        className="mono"
        rows={4}
        value={text}
        disabled={p.disabled}
        onChange={(e) => {
          setText(e.target.value);
          try {
            p.onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
    </Shell>
  );
}
