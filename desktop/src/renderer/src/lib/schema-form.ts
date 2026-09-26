/**
 * What the script edit form needs to know about a JSON Schema: which input a
 * field gets, a value for something new, which branch of a union a value
 * takes, labels in Vietnamese, and the engine's problems by field.
 */
import type { JsonSchema, Problem } from "../../../shared/types";

export type FieldKind =
  | { kind: "text"; multiline: boolean }
  | { kind: "enum"; options: (string | number)[] }
  | { kind: "number"; integer: boolean }
  | { kind: "boolean" }
  | { kind: "const"; value: unknown }
  | { kind: "list"; item: JsonSchema }
  | { kind: "tuple"; items: JsonSchema[] }
  | { kind: "object"; properties: Record<string, JsonSchema>; required: string[] }
  | { kind: "union"; branches: JsonSchema[] }
  | { kind: "json" };

/** Fields whose text runs over several lines: the narration, code, long text. */
const MULTILINE = new Set(["voice", "code", "before", "after", "output", "definition", "quote", "explain"]);

export function fieldKind(schema: JsonSchema, name = ""): FieldKind {
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches?.length) return branches.length === 1 ? fieldKind(branches[0], name) : { kind: "union", branches };
  if (schema.const !== undefined) return { kind: "const", value: schema.const };
  if (schema.enum?.length && schema.enum.every((v) => typeof v === "string" || typeof v === "number")) return { kind: "enum", options: schema.enum as (string | number)[] };
  switch (schema.type) {
    case "string":
      return { kind: "text", multiline: MULTILINE.has(name) || (schema.maxLength ?? Infinity) > 160 };
    case "number":
    case "integer":
      return { kind: "number", integer: schema.type === "integer" };
    case "boolean":
      return { kind: "boolean" };
    case "array":
      if (schema.prefixItems?.length) return { kind: "tuple", items: schema.prefixItems };
      return schema.items ? { kind: "list", item: schema.items } : { kind: "json" };
    case "object":
      return schema.properties ? { kind: "object", properties: schema.properties, required: schema.required ?? [] } : { kind: "json" };
    default:
      return { kind: "json" };
  }
}

/** The bounds of a number, leaving out the ones every integer has anyway. */
export function bounds(schema: JsonSchema): { min?: number; max?: number } {
  const real = (n: number | undefined) => (n !== undefined && Math.abs(n) < Number.MAX_SAFE_INTEGER ? n : undefined);
  return { min: real(schema.minimum ?? schema.exclusiveMinimum), max: real(schema.maximum ?? schema.exclusiveMaximum) };
}

/** A value for a field or item just added: its default, else the simplest one it takes. */
export function blank(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return structuredClone(schema.default);
  const kind = fieldKind(schema);
  switch (kind.kind) {
    case "const":
      return kind.value;
    case "enum":
      return kind.options[0];
    case "text":
      return "";
    case "number": {
      const { min, max } = bounds(schema);
      // a number that must be above its bound starts one above it
      const low = schema.minimum === undefined && min !== undefined ? min + 1 : min;
      return Math.min(Math.max(0, low ?? 0), max ?? Infinity);
    }
    case "boolean":
      return false;
    case "list":
      return Array.from({ length: schema.minItems ?? 0 }, () => blank(kind.item));
    case "tuple":
      return kind.items.map(blank);
    case "object":
      return Object.fromEntries(kind.required.map((k) => [k, blank(kind.properties[k])]));
    case "union":
      return blank(kind.branches[0]);
    default:
      return undefined;
  }
}

/** The union branch a value takes, by what it is: -1 when none fits. */
export function branchOf(branches: JsonSchema[], value: unknown): number {
  const fits = (b: JsonSchema): boolean => {
    const kind = fieldKind(b);
    switch (kind.kind) {
      case "const":
        return value === kind.value;
      case "enum":
        return kind.options.includes(value as string | number);
      case "text":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && (!kind.integer || Number.isInteger(value));
      case "boolean":
        return typeof value === "boolean";
      case "list":
      case "tuple":
        return Array.isArray(value);
      case "object":
        return !!value && typeof value === "object" && !Array.isArray(value);
      case "union":
        return branchOf(kind.branches, value) >= 0;
      default:
        return false;
    }
  };
  // exact values before open ones: "point" is the pose, not any text
  const order = branches.map((b, i) => ({ i, rank: ["const", "enum"].includes(fieldKind(b).kind) ? 0 : 1 })).sort((a, b) => a.rank - b.rank);
  return order.find(({ i }) => fits(branches[i]))?.i ?? -1;
}

/** What a union branch is, in a word, for the switch between them. */
export function branchLabel(schema: JsonSchema): string {
  const kind = fieldKind(schema);
  switch (kind.kind) {
    case "const":
      return kind.value === false ? "Tắt" : kind.value === true ? "Bật" : String(kind.value);
    case "enum":
      return "Chọn";
    case "text":
      return "Chữ";
    case "number":
      return "Số";
    case "boolean":
      return "Có/không";
    case "list":
    case "tuple":
      return "Danh sách";
    case "object":
      return "Chi tiết";
    default:
      return "JSON";
  }
}

/** A value with `key` set, or removed when `value` is undefined; the other fields keep their order. */
export function withField(obj: Record<string, unknown> | undefined, key: string, value: unknown): Record<string, unknown> {
  const next = { ...obj };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/** The engine's messages for exactly this field. */
export function messagesAt(problems: Problem[], path: string): string[] {
  return problems.filter((p) => p.path === path).map((p) => p.message);
}

/** Some problem is in this field or inside it. */
export function problemsUnder(problems: Problem[], path: string): boolean {
  return problems.some((p) => p.path === path || p.path.startsWith(`${path}.`));
}

export function childPath(path: string, key: string | number): string {
  return path ? `${path}.${key}` : String(key);
}

/** Vietnamese names of the script's fields; a field not listed shows its own name. */
const LABELS: Record<string, string> = {
  voice: "Lời thoại",
  title: "Tiêu đề",
  subtitle: "Phụ đề",
  text: "Chữ",
  sub: "Dòng phụ",
  tag: "Nhãn nhỏ",
  icon: "Icon",
  icons: "Các icon",
  emphasis: "Từ nhấn mạnh",
  keyword: "Từ tô màu",
  pills: "Các nhãn",
  kicker: "Nhãn (cũ)",
  ghost: "Chữ mờ phía sau",
  items: "Các mục",
  term: "Thuật ngữ",
  definition: "Định nghĩa",
  example: "Ví dụ",
  numbered: "Đánh số",
  layout: "Bố cục",
  filename: "Tên file",
  lang: "Ngôn ngữ",
  code: "Code",
  focus: "Dòng làm nổi",
  typing: "Hiệu ứng gõ",
  before: "Trước",
  after: "Sau",
  commands: "Các lệnh",
  cmd: "Lệnh",
  output: "Kết quả",
  direction: "Hướng",
  nodes: "Các khối",
  edges: "Các mũi tên",
  from: "Từ",
  to: "Đến",
  dashed: "Nét đứt",
  kind: "Loại",
  progressive: "Hiện dần",
  mode: "Kiểu",
  layers: "Các lớp",
  name: "Tên",
  note: "Ghi chú",
  rule: "Quy tắc",
  core: "Lớp lõi (số thứ tự, từ 0)",
  platform: "Nền tảng",
  image: "Ảnh",
  ui: "Màn hình giả lập",
  appBar: "Thanh tiêu đề",
  button: "Nút",
  toast: "Thông báo",
  state: "Trạng thái",
  callouts: "Chú thích trên màn hình",
  x: "Vị trí ngang (%)",
  y: "Vị trí dọc (%)",
  points: "Các ý",
  columns: "Các cột",
  rows: "Các hàng",
  label: "Nhãn",
  values: "Giá trị",
  winner: "Cột thắng (số thứ tự, từ 0)",
  question: "Câu hỏi",
  options: "Các lựa chọn",
  answer: "Đáp án đúng (số thứ tự, từ 0)",
  explain: "Giải thích",
  src: "Ảnh",
  caption: "Chú thích",
  fit: "Cách vừa khung",
  motion: "Chuyển động",
  left: "Bên trái",
  right: "Bên phải",
  badge: "Huy hiệu",
  value: "Giá trị",
  tone: "Sắc thái",
  ticker: "Dòng chữ chạy",
  tickerLabel: "Nhãn dòng chữ chạy",
  headline: "Tiêu đề tin",
  facts: "Các ý chính",
  period: "Khoảng thời gian",
  source: "Nguồn",
  time: "Thời gian",
  quote: "Câu trích dẫn",
  person: "Người nói",
  role: "Chức danh",
  avatar: "Ảnh chân dung",
  media: "Ảnh nền",
  markers: "Các điểm trên bản đồ",
  lat: "Vĩ độ",
  lon: "Kinh độ",
  primary: "Điểm chính",
  unit: "Đơn vị",
  delta: "Thay đổi",
  series: "Các cột số liệu",
  display: "Hiển thị",
  legend: "Chú giải",
  a: "Giá trị A",
  b: "Giá trị B",
  highlight: "Làm nổi",
  axisMax: "Giá trị lớn nhất của trục",
  annotation: "Chú thích điểm",
  i: "Điểm số (từ 0)",
  labels: "Các nhãn",
  lastLabel: "Nhãn giá trị cuối",
  percent: "Phần trăm",
  range: "Khoảng năm",
  events: "Các mốc",
  year: "Năm",
  context: "Ngữ cảnh",
  punch: "Câu chốt",
  cta: "Kêu gọi hành động",
  myth: "Hiểu lầm",
  fact: "Sự thật",
  multiplier: "Hệ số",
  rank: "Hạng",
  total: "Tổng số",
  noun: "Danh từ",
  detail: "Chi tiết",
  fix: "Cách sửa",
  model: "Mô hình 3D",
  symbol: "Ký hiệu",
  next: "Bài tiếp theo",
  mascot: "Nhân vật",
  pose: "Tư thế",
  side: "Phía",
  say: "Lời nói",
  talk: "Mấp máy miệng",
  beats: "Nhịp hiệu ứng",
  at: "Lúc",
  do: "Hành động",
  target: "Đối tượng",
  lines: "Dòng code",
  path: "Đường đi",
  sfx: "Âm thanh",
  volume: "Âm lượng",
  transition: "Chuyển cảnh",
  hold: "Giữ thêm (giây)",
};

export function fieldLabel(name: string): string {
  return LABELS[name] ?? name;
}
