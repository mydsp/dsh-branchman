// Graph construction with structural diagnosis.
//
// B02/B03: the old layout silently dropped nodes — an empty direction set hid
// existing main-line conversations, and a parentName cycle hid every node in a
// repo. This builder is the inverse contract: every node passed in comes back
// out, and invalid edges are reported as issues instead of being walked into
// an infinite (or empty) layout.
import type { GraphEdge, GraphNode, GraphResult, GraphIssue } from './model.js';

/**
 * Build the node/edge result.
 *
 * Guarantees:
 *   - every input node is preserved (even when an edge is invalid);
 *   - edges referencing a missing node are reported as `orphan` and excluded
 *     from the returned edge set (they cannot be laid out);
 *   - duplicate node ids are reported as `duplicate-id`;
 *   - directed cycles among the valid edges are reported as `cycle`, listing
 *     the nodes on the cycle, so callers can avoid recursing forever.
 *
 * Pure: no disk access, no host dependency.
 */
export function buildGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphResult {
  const byId = new Map<string, GraphNode>();
  const issues: GraphIssue[] = [];
  const duplicateIds = new Set<string>();

  for (const node of nodes) {
    if (byId.has(node.id)) duplicateIds.add(node.id);
    byId.set(node.id, node);
  }
  if (duplicateIds.size > 0) {
    issues.push({ code: 'duplicate-id', ids: [...duplicateIds] });
  }

  const validEdges: GraphEdge[] = [];
  const orphans: string[] = [];
  for (const edge of edges) {
    if (byId.has(edge.sourceId) && byId.has(edge.targetId)) {
      validEdges.push(edge);
    } else {
      orphans.push(edge.id);
    }
  }
  if (orphans.length > 0) {
    issues.push({ code: 'orphan', ids: orphans });
  }

  const cycleNodes = findCycleNodes(nodes.map(n => n.id), validEdges);
  if (cycleNodes.size > 0) {
    issues.push({ code: 'cycle', ids: [...cycleNodes] });
  }

  return { nodes, edges: validEdges, issues };
}

/**
 * Return the set of node ids that participate in at least one directed cycle.
 * Uses iterative DFS with the classic three-colour marking; a back-edge to a
 * grey node means a cycle. Each node is visited once, so this cannot loop.
 */
function findCycleNodes(nodeIds: string[], edges: GraphEdge[]): Set<string> {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    color.set(id, WHITE);
    adj.set(id, []);
  }
  for (const edge of edges) {
    adj.get(edge.sourceId)?.push(edge.targetId);
  }

  const onCycle = new Set<string>();
  for (const start of nodeIds) {
    if (color.get(start) !== WHITE) continue;
    // Path of GREY nodes in the current DFS branch (ancestor chain).
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    // Frame: the node, and the next neighbour index to explore.
    const frames: Array<{ node: string; next: number }> = [];
    color.set(start, GREY);
    path.push(start);
    pathIndex.set(start, 0);
    frames.push({ node: start, next: 0 });

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame === undefined) break;
      const targets = adj.get(frame.node) ?? [];
      if (frame.next < targets.length) {
        const next = targets[frame.next] ?? frame.node;
        frame.next += 1;
        const nextColor = color.get(next);
        if (nextColor === GREY) {
          // Back edge: nodes from `next` to the top of the path form a cycle.
          const from = pathIndex.get(next) ?? 0;
          for (let k = from; k < path.length; k += 1) {
            const onPath = path[k];
            if (onPath !== undefined) onCycle.add(onPath);
          }
        } else if (nextColor === WHITE) {
          color.set(next, GREY);
          pathIndex.set(next, path.length);
          path.push(next);
          frames.push({ node: next, next: 0 });
        }
        // BLACK targets are fully explored — no cycle through them.
      } else {
        color.set(frame.node, BLACK);
        pathIndex.delete(frame.node);
        path.pop();
        frames.pop();
      }
    }
  }
  return onCycle;
}
