/**
 * Layered auto-layout for architecture diagrams (small graphs, ≤ 9 nodes):
 * longest-path ranking → barycenter ordering → centered placement → cubic
 * bezier edges. Landscape flows left→right, portrait top→bottom.
 */

export interface LayoutNodeIn {
  id: string;
}
export interface LayoutEdgeIn {
  from: string;
  to: string;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutResult {
  dir: "LR" | "TB";
  nodes: Record<string, Box & { rank: number; order: number }>;
  edges: { from: string; to: string; d: string; label: { x: number; y: number }; pts: number[] }[];
  width: number;
  height: number;
}

export interface LayoutOpts {
  dir: "LR" | "TB";
  width: number;
  height: number;
  nodeW: number;
  nodeH: number;
  gap: number;
  /** minimum free space between ranks (room for edge labels) */
  rankGap?: number;
}

export function layoutDiagram(nodes: LayoutNodeIn[], edges: LayoutEdgeIn[], o: LayoutOpts): LayoutResult {
  const ids = nodes.map((n) => n.id);
  const rank: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));

  // longest-path ranks (cycle-safe: bounded relaxation)
  for (let iter = 0; iter < ids.length; iter++) {
    let changed = false;
    for (const e of edges) {
      if (e.from === e.to) continue;
      if (rank[e.to] < rank[e.from] + 1 && rank[e.from] + 1 < ids.length) {
        rank[e.to] = rank[e.from] + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const used = [...new Set(Object.values(rank))].sort((a, b) => a - b);
  for (const id of ids) rank[id] = used.indexOf(rank[id]);
  const R = used.length;

  const layers: string[][] = Array.from({ length: R }, () => []);
  for (const id of ids) layers[rank[id]].push(id);

  // barycenter ordering sweeps
  const pos = (id: string) => layers[rank[id]].indexOf(id);
  const neighbors = (id: string, dirn: -1 | 1) =>
    edges
      .filter((e) => (dirn === -1 ? e.to === id && rank[e.from] < rank[id] : e.from === id && rank[e.to] > rank[id]))
      .map((e) => (dirn === -1 ? e.from : e.to));
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    const order = down ? [...Array(R).keys()].slice(1) : [...Array(R).keys()].reverse().slice(1);
    for (const r of order) {
      const bc = (id: string) => {
        const ns = neighbors(id, down ? -1 : 1);
        return ns.length ? ns.reduce((s, n) => s + pos(n), 0) / ns.length : pos(id);
      };
      const scored = layers[r].map((id, i) => ({ id, b: bc(id), i }));
      scored.sort((a, b) => a.b - b.b || a.i - b.i);
      layers[r] = scored.map((s) => s.id);
    }
  }

  // placement
  const maxInRank = Math.max(...layers.map((l) => l.length));
  const along = o.dir === "LR" ? o.width : o.height;
  const across = o.dir === "LR" ? o.height : o.width;
  const sizeAlong = o.dir === "LR" ? o.nodeW : o.nodeH;
  let sizeAcross = o.dir === "LR" ? o.nodeH : o.nodeW;
  sizeAcross = Math.min(sizeAcross, (across - (maxInRank - 1) * o.gap) / maxInRank);
  const rankGap = o.rankGap ?? 90;
  const alongNode = Math.max(Math.min(sizeAlong, R > 1 ? (along - (R - 1) * rankGap) / R : sizeAlong), Math.min(sizeAlong, 240));

  const result: LayoutResult["nodes"] = {};
  layers.forEach((layer, r) => {
    const centerAlong = R === 1 ? along / 2 : alongNode / 2 + ((along - alongNode) * r) / (R - 1);
    const k = layer.length;
    const total = k * sizeAcross + (k - 1) * o.gap;
    const spare = across - total;
    const gap = k > 1 ? o.gap + Math.min(spare / (k - 1), sizeAcross * 0.6) : 0;
    const used2 = k * sizeAcross + (k - 1) * gap;
    const startAcross = (across - used2) / 2;
    layer.forEach((id, i) => {
      const a = centerAlong - alongNode / 2;
      const c = startAcross + i * (sizeAcross + gap);
      result[id] =
        o.dir === "LR"
          ? { x: a, y: c, w: alongNode, h: sizeAcross, rank: r, order: i }
          : { x: c, y: a, w: sizeAcross, h: alongNode, rank: r, order: i };
    });
  });

  const outEdges = edges.map((e) => {
    const pts = edgePoints(result[e.from], result[e.to], o.dir);
    const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = pts;
    const label = bezierPoint(pts, 0.5);
    return { from: e.from, to: e.to, d: `M ${f(x0)} ${f(y0)} C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(x1)} ${f(y1)}`, label, pts };
  });

  return { dir: o.dir, nodes: result, edges: outEdges, width: o.width, height: o.height };
}

const f = (n: number) => Math.round(n * 10) / 10;

function edgePoints(a: Box & { rank: number }, b: Box & { rank: number }, dir: "LR" | "TB"): number[] {
  const inset = 6; // leave room for the arrowhead
  if (dir === "LR") {
    if (b.rank > a.rank) {
      const x0 = a.x + a.w, y0 = a.y + a.h / 2, x1 = b.x - inset, y1 = b.y + b.h / 2;
      const dx = (x1 - x0) * 0.5;
      return [x0, y0, x0 + dx, y0, x1 - dx, y1, x1, y1];
    }
    if (b.rank === a.rank) {
      const down = b.y > a.y;
      const x0 = a.x + a.w / 2, y0 = down ? a.y + a.h : a.y, x1 = b.x + b.w / 2, y1 = down ? b.y - inset : b.y + b.h + inset;
      const dy = (y1 - y0) * 0.5;
      return [x0, y0, x0, y0 + dy, x1, y1 - dy, x1, y1];
    }
    // backward: arc underneath
    const x0 = a.x + a.w / 2, y0 = a.y + a.h, x1 = b.x + b.w / 2, y1 = b.y + b.h + inset;
    const drop = 110;
    return [x0, y0, x0, y0 + drop, x1, y1 + drop, x1, y1];
  }
  if (b.rank > a.rank) {
    const x0 = a.x + a.w / 2, y0 = a.y + a.h, x1 = b.x + b.w / 2, y1 = b.y - inset;
    const dy = (y1 - y0) * 0.5;
    return [x0, y0, x0, y0 + dy, x1, y1 - dy, x1, y1];
  }
  if (b.rank === a.rank) {
    const right = b.x > a.x;
    const x0 = right ? a.x + a.w : a.x, y0 = a.y + a.h / 2, x1 = right ? b.x - inset : b.x + b.w + inset, y1 = b.y + b.h / 2;
    const dx = (x1 - x0) * 0.5;
    return [x0, y0, x0 + dx, y0, x1 - dx, y1, x1, y1];
  }
  const x0 = a.x + a.w, y0 = a.y + a.h / 2, x1 = b.x + b.w + inset, y1 = b.y + b.h / 2;
  const push = 110;
  return [x0, y0, x0 + push, y0, x1 + push, y1, x1, y1];
}

export function bezierPoint(p: number[], t: number): { x: number; y: number } {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  const u = 1 - t;
  return {
    x: f(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3),
    y: f(u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3),
  };
}

/** Path through a sequence of node ids, reusing edge curves (reversed when needed). */
export function flowPath(ids: string[], layout: LayoutResult): string | null {
  const parts: string[] = [];
  for (let i = 0; i < ids.length - 1; i++) {
    const a = ids[i], b = ids[i + 1];
    const na = layout.nodes[a], nb = layout.nodes[b];
    if (!na || !nb) return null;
    let pts: number[];
    const fwd = layout.edges.find((e) => e.from === a && e.to === b);
    const back = layout.edges.find((e) => e.from === b && e.to === a);
    if (fwd) pts = fwd.pts;
    else if (back) {
      const p = back.pts;
      pts = [p[6], p[7], p[4], p[5], p[2], p[3], p[0], p[1]];
    } else {
      const x0 = na.x + na.w / 2, y0 = na.y + na.h / 2, x1 = nb.x + nb.w / 2, y1 = nb.y + nb.h / 2;
      pts = [x0, y0, (x0 * 2 + x1) / 3, (y0 * 2 + y1) / 3, (x0 + x1 * 2) / 3, (y0 + y1 * 2) / 3, x1, y1];
    }
    const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = pts;
    parts.push(`${i === 0 ? `M ${f(x0)} ${f(y0)} ` : `L ${f(x0)} ${f(y0)} `}C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(x1)} ${f(y1)}`);
  }
  return parts.join(" ");
}
