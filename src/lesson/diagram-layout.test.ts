import { describe, it, expect } from "vitest";
import { layoutDiagram, flowPath, type Box } from "./diagram-layout.js";

const nodes = ["app", "repo", "db", "api", "server"].map((id) => ({ id }));
const edges = [
  { from: "app", to: "repo" },
  { from: "repo", to: "db" },
  { from: "repo", to: "api" },
  { from: "api", to: "server" },
];

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("layoutDiagram", () => {
  for (const dir of ["LR", "TB"] as const) {
    it(`ranks by longest path and places nodes without overlap (${dir})`, () => {
      const W = dir === "LR" ? 1600 : 900;
      const H = dir === "LR" ? 700 : 1000;
      const L = layoutDiagram(nodes, edges, { dir, width: W, height: H, nodeW: 300, nodeH: 130, gap: 40, rankGap: 120 });
      expect(Object.fromEntries(Object.entries(L.nodes).map(([k, v]) => [k, v.rank]))).toEqual({ app: 0, repo: 1, db: 2, api: 2, server: 3 });
      const boxes = Object.values(L.nodes);
      for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(W + 0.01);
        expect(b.y + b.h).toBeLessThanOrEqual(H + 0.01);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
      expect(L.edges).toHaveLength(edges.length);
      for (const e of L.edges) expect(e.d).toMatch(/^M [\d.-]+ [\d.-]+ C /);
    });
  }

  it("survives cycles", () => {
    const L = layoutDiagram([{ id: "a" }, { id: "b" }], [{ from: "a", to: "b" }, { from: "b", to: "a" }], { dir: "LR", width: 800, height: 400, nodeW: 200, nodeH: 100, gap: 30 });
    expect(Object.keys(L.nodes)).toHaveLength(2);
  });
});

describe("flowPath", () => {
  const L = layoutDiagram(nodes, edges, { dir: "LR", width: 1600, height: 700, nodeW: 300, nodeH: 130, gap: 40 });
  it("chains edge curves along a node path, forward or backward", () => {
    expect(flowPath(["app", "repo", "db"], L)).toMatch(/^M .* C .* L .* C /);
    expect(flowPath(["db", "repo"], L)).toMatch(/^M /);
  });
  it("returns null for unknown nodes", () => {
    expect(flowPath(["app", "nope"], L)).toBeNull();
  });
});
