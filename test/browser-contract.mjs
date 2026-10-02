import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as host from '../index.js';
const source=await readFile(new URL('../client.js',import.meta.url),'utf8');
let factory;
vm.runInNewContext(source,{window:{__ModuleLoader__:{load(input){assert.equal(input.id,'dsh-branchman');factory=input.factory;}}}});
const React={Component:class{},createElement:(type,props,...children)=>({type,props,children})};
const plugin=factory(name=>{assert.equal(name,'react');return React;});
test('built package exposes the real host and ModuleLoader client contract',()=>{
  assert.equal(typeof host.apply,'function');assert.equal(typeof host.BranchmanRuntime,'function');
  assert.deepEqual(host.inject,['webServer','sessions','tools']);assert.equal(typeof plugin.apply,'function');
  assert.equal(source.includes('eval('),false);assert.equal(source.includes('new Function('),false);
});
test('actual browser bundle preserves independent conversations and duplicate direction names',()=>{
  const rows=plugin.__test.overviewRows({sessions:[{sessionId:'plain',cwd:'E:/repo',label:{source:'summary',text:'Independent'}},{sessionId:'one',directionId:'d1'},{sessionId:'two',directionId:'d2'}],directions:[{id:'d1',repoId:'r1',displayName:'same',brief:'first'},{id:'d2',repoId:'r2',displayName:'same',brief:'second'}],worktrees:[]});
  assert.equal(rows.length,3);assert.equal(rows[0].label,'Independent');assert.equal(rows[1].label,'first');assert.equal(rows[2].label,'second');
  assert.notEqual(rows[1].id,rows[2].id);
});
test('a current authoritative manual title replaces stale cached labels',()=>{
  const rows=plugin.__test.overviewRows({sessions:[{sessionId:'s',label:{source:'user',text:'old'}}],directions:[],worktrees:[]},{byId:{s:{title:'New manual title',displayTitle:'New manual title'}}});
  assert.equal(rows[0].label,'New manual title');
});
test('cycles keep every actual bundle row and produce finite graph coordinates',()=>{
  const rows=[{id:'a',parentSessionId:'b'},{id:'b',parentSessionId:'a'},{id:'c',parentSessionId:null}];
  const layout=plugin.__test.layoutRows(rows);assert.equal(layout.graph.nodes.length,3);assert.equal(layout.graph.issues.some(i=>i.code==='cycle'),true);
  assert.equal([...layout.positions.values()].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),true);
});

test('interleaved roots own disjoint tree cards and every edge stays inside its card',()=>{
  const rows=[{id:'a',repoId:'r'},{id:'b',repoId:'r'},{id:'b1',parentSessionId:'b',repoId:'r'},{id:'a1',parentSessionId:'a',repoId:'r'},{id:'a2',parentSessionId:'a1',repoId:'r'},{id:'b2',parentSessionId:'b1',repoId:'r'}];
  const layout=plugin.__test.layoutRows(rows);assert.equal(layout.groups.length,2);
  for(const a of layout.groups)for(const b of layout.groups)if(a!==b)assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
  for(const edge of layout.graph.edges){assert.equal(layout.rootOf.get(edge.sourceId),layout.rootOf.get(edge.targetId));const g=layout.groups.find(g=>g.rootId===layout.rootOf.get(edge.sourceId));for(const id of [edge.sourceId,edge.targetId]){const p=layout.positions.get(id);assert.ok(p.x>=g.x&&p.x+264<=g.x+g.width);assert.ok(p.y>=g.y&&p.y+68<=g.y+g.height);}}
  assert.deepEqual([...plugin.__test.layoutRows([...rows].reverse()).positions], [...layout.positions]);
});

test('outline uses real ancestry, excludes cross-repository edges and retains ancestors when searching',()=>{
  const rows=[{id:'r',repoId:'one'},{id:'c',repoId:'one',parentSessionId:'r'},{id:'g',repoId:'one',parentSessionId:'c'},{id:'other',repoId:'two',parentSessionId:'r'}];
  const forest=plugin.__test.buildForest(rows);assert.equal(forest.depth.get('g'),2);assert.equal(forest.parent.get('other'),null);
  assert.deepEqual(Array.from(plugin.__test.selectForestRows(forest,[rows[2]],1,new Set(),true),r=>r.id),['r','c','g']);
  assert.deepEqual(Array.from(plugin.__test.selectForestRows(forest,rows,10,new Set(['c'])),r=>r.id),['r','c','other']);
});
