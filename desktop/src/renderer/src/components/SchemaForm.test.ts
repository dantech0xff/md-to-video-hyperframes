import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { JsonSchema } from "../../../shared/types";
import { SchemaForm } from "./SchemaForm";

/** A news scene's ticker: optional, and one item at least when it is there. */
const ticker: JsonSchema = { type: "array", items: { type: "string", maxLength: 60 }, minItems: 1, maxItems: 4 };

const form = (properties: Record<string, JsonSchema>, required: string[], value: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(SchemaForm, { schema: { type: "object", properties, required }, value, onChange: () => undefined, problems: [] }));

/** The buttons named `label` (their opening tags, attributes included). */
const buttons = (html: string, label: string) => [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).filter((b) => b.includes(`aria-label="${label}"`));

describe("SchemaForm lists", () => {
  it("lets an optional list go, its last item or the list as a whole", () => {
    const html = form({ ticker }, [], { ticker: ["Beta mở cho mọi người"] });
    expect(buttons(html, "Xoá")).toHaveLength(1);
    expect(buttons(html, "Xoá")[0]).not.toContain("disabled");
    expect(html).toContain("Bỏ</button>");
    // two items at a minimum of two: neither goes alone, the list still can
    const two = form({ ticker: { ...ticker, minItems: 2 } }, [], { ticker: ["A", "B"] });
    expect(buttons(two, "Xoá").every((b) => b.includes("disabled"))).toBe(true);
    expect(two).toContain("Bỏ</button>");
  });

  it("keeps a required list at its minimum, and an absent optional one offers to add it", () => {
    const html = form({ ticker }, ["ticker"], { ticker: ["Beta mở cho mọi người"] });
    expect(buttons(html, "Xoá")[0]).toContain("disabled");
    expect(html).not.toContain("Bỏ</button>");
    const absent = form({ ticker }, [], {});
    expect(absent).not.toContain("Bỏ</button>");
    expect(absent).toContain("Thêm</button>");
  });
});
