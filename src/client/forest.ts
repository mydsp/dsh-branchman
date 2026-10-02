import { buildGraph } from '../domain/graph.js';

export type ForestRow = { id: string; parentSessionId?: string | null; repoId?: string | null; cwd?: string | null; label?: string; directionId?: string | null; createdAt?: number | null };

/** One shared, deterministic parent model for the outline and the canvas. */
export function buildForest<T extends ForestRow>(rows: T[]) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const graph = buildGraph(rows.map(r => ({ id: r.id, kind: r.directionId ? 'direction' as const : 'session' as const })),
    rows.filter(r => r.parentSessionId && byId.has(r.parentSessionId)).map(r => ({ id: `edge:${r.id}`, sourceId: r.parentSessionId!, targetId: r.id })));
  const cyclic = new Set(graph.issues.filter(i => i.code === 'cycle').flatMap(i => i.ids));
  const parent = new Map<string, string | null>(), children = new Map<string, string[]>();
  for (const row of rows) {
    const candidate = row.parentSessionId ? byId.get(row.parentSessionId) : undefined;
    const crossRepo = candidate?.repoId && row.repoId && candidate.repoId !== row.repoId;
    parent.set(row.id, candidate && !crossRepo && !cyclic.has(row.id) ? candidate.id : null);
    children.set(row.id, []);
  }
  for (const [id, p] of parent) if (p) children.get(p)!.push(id);
  const compare = (a: string, b: string) => (byId.get(a)?.createdAt ?? 0) - (byId.get(b)?.createdAt ?? 0) || a.localeCompare(b);
  for (const ids of children.values()) ids.sort(compare);
  const roots = rows.filter(r => !parent.get(r.id)).map(r => r.id).sort((a, b) => {
    const ra = byId.get(a)!, rb = byId.get(b)!;
    return String(ra.repoId ?? ra.cwd ?? '').localeCompare(String(rb.repoId ?? rb.cwd ?? '')) || compare(a, b);
  });
  const ordered: T[] = [], depth = new Map<string, number>(), rootOf = new Map<string, string>();
  for (const root of roots) {
    const stack = [{ id: root, level: 0 }];
    while (stack.length) {
      const item = stack.pop()!; ordered.push(byId.get(item.id)!); depth.set(item.id, item.level); rootOf.set(item.id, root);
      for (const id of [...children.get(item.id)!].reverse()) stack.push({ id, level: item.level + 1 });
    }
  }
  return { byId, parent, children, roots, ordered, depth, rootOf,
    graph: { ...graph, edges: graph.edges.filter(e => parent.get(e.targetId) === e.sourceId) } };
}

/** Filters retain real ancestors; pagination never manufactures a new root. */
export function selectForestRows<T extends ForestRow>(forest: ReturnType<typeof buildForest<T>>, matches: T[], limit: number, collapsed = new Set<string>(), reveal = false) {
  const included = new Set<string>();
  for (const row of matches.slice(0, limit)) {
    let id: string | null = row.id;
    while (id && !included.has(id)) { included.add(id); id = forest.parent.get(id) ?? null; }
  }
  return forest.ordered.filter(row => {
    if (!included.has(row.id)) return false;
    if (reveal) return true;
    let p = forest.parent.get(row.id);
    while (p) { if (collapsed.has(p)) return false; p = forest.parent.get(p); }
    return true;
  });
}

export function layoutRows<T extends ForestRow>(rows: T[]) {
  const forest = buildForest(rows), positions = new Map<string, { x: number; y: number }>();
  const groups: Array<{ rootId: string; ids: string[]; x: number; y: number; width: number; height: number }> = [];
  const spans = new Map<string, number>();
  for (const row of [...forest.ordered].reverse()) spans.set(row.id, Math.max(1, forest.children.get(row.id)!.reduce((sum, id) => sum + spans.get(id)!, 0)));
  for (const rootId of forest.roots) {
    const ids = forest.ordered.filter(r => forest.rootOf.get(r.id) === rootId).map(r => r.id);
    const maxDepth = Math.max(0, ...ids.map(id => forest.depth.get(id)!));
    groups.push({ rootId, ids, x: 0, y: 0, width: maxDepth * 312 + 300, height: spans.get(rootId)! * 88 + 58 });
  }
  // Pack independent tree cards into shelves; no edge can leave its card.
  const shelfWidth = Math.max(960, ...groups.map(g => g.width));
  let x = 18, y = 18, shelfHeight = 0;
  for (const group of groups) {
    if (x > 18 && x + group.width > shelfWidth + 18) { x = 18; y += shelfHeight + 26; shelfHeight = 0; }
    group.x = x; group.y = y; x += group.width + 24; shelfHeight = Math.max(shelfHeight, group.height);
    const stack = [{ id: group.rootId, start: 0 }];
    while (stack.length) {
      const { id, start } = stack.pop()!;
      positions.set(id, { x: group.x + 18 + forest.depth.get(id)! * 312, y: group.y + 44 + (start + (spans.get(id)! - 1) / 2) * 88 });
      let next = start;
      for (const child of forest.children.get(id)!) { stack.push({ id: child, start: next }); next += spans.get(child)!; }
    }
  }
  return { ...forest, positions, groups, width: Math.max(320, ...groups.map(g => g.x + g.width + 18)), height: Math.max(120, y + shelfHeight + 18) };
}
