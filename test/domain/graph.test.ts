import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGraph } from '../../src/domain/graph.js';
import type { GraphEdge, GraphNode } from '../../src/domain/model.js';

const node = (id: string, kind: GraphNode['kind'] = 'direction'): GraphNode => ({ id, kind });
const edge = (id: string, sourceId: string, targetId: string): GraphEdge => ({ id, sourceId, targetId });

// B02 regression: an independent session with no direction is still a node.
test('independent session without a direction is preserved', () => {
  const result = buildGraph([node('session-a', 'session')], []);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0]?.id, 'session-a');
  assert.deepEqual(result.issues, []);
});

// B01 regression: same display name must not collapse distinct ids.
test('same-name nodes with distinct ids are both kept', () => {
  const a = node('id-1', 'direction');
  const b = node('id-2', 'direction');
  const result = buildGraph([a, b], []);
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(result.nodes.map(n => n.id).sort(), ['id-1', 'id-2']);
});

// B03 regression: a two-node cycle reports the cycle and keeps both nodes.
test('two-node cycle reports cycle but drops no nodes', () => {
  const result = buildGraph(
    [node('A'), node('B')],
    [edge('e1', 'A', 'B'), edge('e2', 'B', 'A')],
  );
  assert.equal(result.nodes.length, 2);
  const cycle = result.issues.find(i => i.code === 'cycle');
  assert.ok(cycle, 'expected a cycle issue');
  assert.deepEqual([...(cycle?.ids ?? [])].sort(), ['A', 'B']);
});

test('missing parent edge is reported as orphan and excluded from edges', () => {
  const result = buildGraph(
    [node('child')],
    [edge('e-missing', 'ghost', 'child'), edge('e-ok', 'child', 'child')],
  );
  // The self-loop is a cycle, and the ghost edge is an orphan.
  const orphan = result.issues.find(i => i.code === 'orphan');
  assert.ok(orphan, 'expected an orphan issue');
  assert.deepEqual([...(orphan?.ids ?? [])], ['e-missing']);
  // Only the valid (self) edge survives into the edge set.
  assert.deepEqual(result.edges.map(e => e.id), ['e-ok']);
});

test('duplicate node id is reported', () => {
  const result = buildGraph([node('dup'), node('dup')], []);
  const dup = result.issues.find(i => i.code === 'duplicate-id');
  assert.ok(dup, 'expected a duplicate-id issue');
  assert.deepEqual([...(dup?.ids ?? [])], ['dup']);
});

test('acyclic chain produces no cycle issue', () => {
  const result = buildGraph(
    [node('r'), node('a'), node('b')],
    [edge('e1', 'r', 'a'), edge('e2', 'a', 'b')],
  );
  assert.equal(result.issues.some(i => i.code === 'cycle'), false);
  assert.equal(result.edges.length, 2);
});
