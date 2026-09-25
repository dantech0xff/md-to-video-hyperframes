import { describe, it, expect } from "vitest";
import type { ActivityEntry } from "../../../shared/types";
import { applyActivity, catchUp, type ActivityView } from "./activity";

const msg = (id: string, text: string): ActivityEntry => ({ id, at: "2026-09-25T08:00:00Z", kind: "message", text });

describe("applyActivity", () => {
  it("adds new entries, replaces changed ones and tracks the state", () => {
    let view: ActivityView = { entries: [], state: "idle" };
    view = applyActivity(view, { projectId: "p", type: "entry", entry: msg("a", "Mình") });
    view = applyActivity(view, { projectId: "p", type: "entry", entry: msg("a", "Mình đọc tư liệu") });
    view = applyActivity(view, { projectId: "p", type: "entry", entry: msg("b", "Xong") });
    expect(view.entries.map((e) => (e.kind === "message" ? e.text : ""))).toEqual(["Mình đọc tư liệu", "Xong"]);
    const working = applyActivity(view, { projectId: "p", type: "state", state: "working" });
    expect(working.state).toBe("working");
    expect(applyActivity(working, { projectId: "p", type: "state", state: "working" })).toBe(working);
  });
});

describe("catchUp", () => {
  it("keeps what happened while the saved activity was loading", () => {
    // the snapshot was taken before the agent asked for permission; the question arrived first
    const snapshot: ActivityView = { entries: [msg("a", "Mình đọc tư liệu")], state: "working" };
    const ask: ActivityEntry = { id: "p1", at: "2026-09-25T08:00:01Z", kind: "permission", title: "npm install", options: [] };
    const view = catchUp(snapshot, [
      { projectId: "p", type: "entry", entry: msg("a", "Mình") },
      { projectId: "p", type: "entry", entry: msg("a", "Mình đọc tư liệu") },
      { projectId: "p", type: "entry", entry: ask },
      { projectId: "p", type: "state", state: "waiting" },
    ]);
    expect(view.entries.map((e) => e.id)).toEqual(["a", "p1"]);
    expect(view.entries[0]).toMatchObject({ text: "Mình đọc tư liệu" });
    expect(view.state).toBe("waiting");
  });
});
