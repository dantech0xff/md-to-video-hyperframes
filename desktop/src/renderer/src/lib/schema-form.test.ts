import { describe, it, expect } from "vitest";
import type { JsonSchema, Problem } from "../../../shared/types";
import { blank, bounds, branchLabel, branchOf, childPath, fieldKind, fieldLabel, messagesAt, problemsUnder, withField } from "./schema-form";

// pieces of the engine's script schema, as z.toJSONSchema writes them
const LIST_ITEM: JsonSchema = {
  anyOf: [
    { type: "string", minLength: 1, maxLength: 110 },
    { type: "object", properties: { text: { type: "string", minLength: 1, maxLength: 110 }, sub: { type: "string", maxLength: 100 } }, required: ["text"] },
  ],
};
const MASCOT: JsonSchema = {
  anyOf: [
    { type: "boolean", const: false },
    { type: "string", enum: ["idle", "wave", "point"] },
    { type: "object", properties: { pose: { default: "point", type: "string", enum: ["idle", "wave", "point"] }, say: { type: "string", maxLength: 48 } } },
  ],
};
const INTEGER: JsonSchema = { type: "integer", minimum: -9007199254740991, maximum: 9007199254740991 };

describe("schema form", () => {
  it("gives each kind of field its input", () => {
    expect(fieldKind({ type: "string", maxLength: 70 }, "title")).toEqual({ kind: "text", multiline: false });
    expect(fieldKind({ type: "string", minLength: 1 }, "voice")).toEqual({ kind: "text", multiline: true });
    expect(fieldKind({ type: "string", maxLength: 2400 }, "snippet")).toEqual({ kind: "text", multiline: true });
    expect(fieldKind({ type: "string", enum: ["list", "grid"] })).toEqual({ kind: "enum", options: ["list", "grid"] });
    expect(fieldKind({ type: "boolean", const: false })).toEqual({ kind: "const", value: false });
    expect(fieldKind(INTEGER)).toEqual({ kind: "number", integer: true });
    expect(fieldKind({ type: "array", items: LIST_ITEM, maxItems: 6 })).toEqual({ kind: "list", item: LIST_ITEM });
    expect(fieldKind({ type: "array", prefixItems: [INTEGER, INTEGER] })).toMatchObject({ kind: "tuple" });
    expect(fieldKind(MASCOT)).toMatchObject({ kind: "union" });
    expect(fieldKind({ anyOf: [{ type: "string" }] })).toMatchObject({ kind: "text" });
    expect(fieldKind({})).toEqual({ kind: "json" });
  });

  it("starts what the user adds from its default, else the simplest value it takes", () => {
    expect(blank({ type: "string", maxLength: 20 })).toBe("");
    expect(blank({ default: "start", anyOf: [{ type: "string" }, { type: "number" }] })).toBe("start");
    expect(blank({ type: "number", minimum: 0, maximum: 1 })).toBe(0);
    expect(blank({ type: "integer", minimum: 1, maximum: 99 })).toBe(1);
    // above zero, not zero
    expect(blank({ type: "number", exclusiveMinimum: 0 })).toBe(1);
    expect(blank(INTEGER)).toBe(0);
    expect(blank({ type: "array", items: { type: "string" }, minItems: 2 })).toEqual(["", ""]);
    expect(blank({ type: "array", prefixItems: [{ type: "string" }, INTEGER] })).toEqual(["", 0]);
    expect(blank(LIST_ITEM)).toBe("");
    expect(blank({ type: "object", properties: { text: { type: "string" }, sub: { type: "string" } }, required: ["text"] })).toEqual({ text: "" });
    // a default is copied, never shared between items
    const edges: JsonSchema = { type: "array", default: [], items: { type: "string" } };
    expect(blank(edges)).not.toBe(blank(edges));
  });

  it("tells which shape of a union a value has, exact values first", () => {
    const [off, pose, custom] = MASCOT.anyOf!;
    expect(branchOf(MASCOT.anyOf!, false)).toBe(0);
    expect(branchOf(MASCOT.anyOf!, "wave")).toBe(1);
    expect(branchOf(MASCOT.anyOf!, { pose: "wave", say: "Hi" })).toBe(2);
    expect(branchOf(MASCOT.anyOf!, "dance")).toBe(-1);
    expect(branchOf(LIST_ITEM.anyOf!, "Cache")).toBe(0);
    expect(branchOf(LIST_ITEM.anyOf!, { text: "Cache" })).toBe(1);
    // "wave" is the pose, not just any text
    expect(branchOf([{ type: "string" }, { type: "string", enum: ["wave"] }], "wave")).toBe(1);
    expect(branchOf([INTEGER, { type: "string" }], 1.5)).toBe(-1);
    expect([off, pose, custom].map(branchLabel)).toEqual(["Tắt", "Chọn", "Chi tiết"]);
    expect(LIST_ITEM.anyOf!.map(branchLabel)).toEqual(["Chữ", "Chi tiết"]);
  });

  it("knows a number's own bounds, not every integer's", () => {
    expect(bounds(INTEGER)).toEqual({ min: undefined, max: undefined });
    expect(bounds({ type: "number", minimum: -90, maximum: 90 })).toEqual({ min: -90, max: 90 });
  });

  it("sets and removes fields in their place, and finds the engine's problems by field", () => {
    expect(Object.keys(withField({ voice: "a", title: "b", sub: "c" }, "title", "B"))).toEqual(["voice", "title", "sub"]);
    expect(withField({ voice: "a", sub: "c" }, "sub", undefined)).toEqual({ voice: "a" });
    const problems: Problem[] = [
      { path: "items.1.text", message: "Too big" },
      { path: "items", message: "Too many" },
    ];
    expect(messagesAt(problems, "items")).toEqual(["Too many"]);
    expect(messagesAt(problems, childPath(childPath("items", 1), "text"))).toEqual(["Too big"]);
    expect(problemsUnder(problems, "items.1")).toBe(true);
    expect(problemsUnder(problems, "item")).toBe(false);
    expect(childPath("", "voice")).toBe("voice");
    expect(fieldLabel("voice")).toBe("Lời thoại");
    expect(fieldLabel("somethingNew")).toBe("somethingNew");
  });
});
