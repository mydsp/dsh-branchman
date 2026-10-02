import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BranchmanRuntime } from '../index.js';
const exec = promisify(execFile), git = (cwd, ...args) => exec(process.env.GIT_PATH ?? 'git', args, { cwd, windowsHide: true });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'branchman-runtime-')), repo = join(dir, 'repo');
  await mkdir(repo); await git(repo, 'init', '-b', 'feature-source'); await git(repo, 'config', 'user.name', 'Acceptance'); await git(repo, 'config', 'user.email', 'lab@example.invalid');
  await writeFile(join(repo, '中文.txt'), 'baseline\n'); await writeFile(join(repo, 'binary.dat'), Buffer.from([0,1,2,3]));
  await git(repo,'add','.'); await git(repo,'commit','-m','baseline');
  const events = [{seq:0,time:10,type:'turn/start',data:{}},{seq:1,time:11,type:'assistant/message',data:{message:{id:'message-one'}}},{seq:2,time:12,type:'turn/end',data:{}},
    {seq:3,time:13,type:'turn/start',data:{}},{seq:4,time:14,type:'assistant/message',data:{message:{id:'message-two'}}},{seq:5,time:15,type:'turn/end',data:{}}];
  const sessions = new Map([['parent',{id:'parent',header:{id:'parent',cwd:repo},events}]]), calls={creates:0,acquired:0,released:0,failAttach:false};
  const query = { listSessions:async()=>[...sessions.values()].map(s=>({header:s.header,live:true})), readTitleSnapshots:async ids=>ids.map(sessionId=>({sessionId,status:'fulfilled',value:{title:{title:'Manual label',source:{kind:'user'}}}})),
    observeSession:async id=>{calls.acquired++;const s=sessions.get(id); if(!s)throw Error('missing');return {source:'live',header:s.header,events:s.events,projections:{values:{agentPreset:'lab-preset'}},cursor:s.events.length-1,[Symbol.dispose](){calls.released++;}};} };
  const ctx={sessions:{get:id=>sessions.get(id)}};
  // The production entry is imported above. Only host side effects are fixtures;
  // all Git, filesystem, state and operation journal code is real.
  const peers={buildForkSeed:(events,boundary)=>[...events.slice(0,boundary+1),{seq:boundary+1,time:12,type:'session/end-seed',data:{inherited:true}}]};
  const createRuntime=()=>{
    const runtime=new BranchmanRuntime(ctx,{dataFile:join(dir,'branchman/tree-v2.json'),gitPath:process.env.GIT_PATH??'git'},peers);
    for(const [key,value] of Object.entries({sessionQuery:query,agentPresets:{resolve:async id=>({id:id??'host-default'}),mount:async()=>({dispose(){}})},agents:{create:async input=>{(await input.setup?.({}))?.commit();calls.creates++;sessions.set(input.sessionId,{id:input.sessionId,header:{id:input.sessionId,...input.meta},events:input.seed??[],inherited:input.inheritedEventCount});}},
      agentDefaultModel:{currentSelection:()=>({provider:'lab',model:'lab'})},workspaceRegistry:{create:async()=>({id:'workspace',attachSession:async()=>{if(calls.failAttach)throw Error('injected attach failure');}}),archivedSessionIds:[]}})) runtime.bind(key,value);
    return runtime;
  };
  const runtime=createRuntime();await runtime.ready();
  const request={requestId:'fork-one',sourceSessionId:'parent',sourceCwd:repo,displayName:'同名 / human label',brief:'Explicit handoff',messageId:'message-one',history:'inherit',codeSource:{kind:'source-head',carryChanges:true}};
  return {dir,repo,runtime,createRuntime,request,sessions,calls,cleanup:async()=>{await runtime.dispose();await rm(dir,{recursive:true,force:true});}};
}
test('production entry carries dirty CJK/binary/untracked files and exact conversation boundary',async()=>{
  const f=await fixture();try{
    await writeFile(join(f.repo,'中文.txt'),'修改\n');await writeFile(join(f.repo,'binary.dat'),Buffer.from([0,255,9]));await writeFile(join(f.repo,'未跟踪.txt'),'untracked');
    const [a,b]=await Promise.all([f.runtime.fork(f.request),f.runtime.fork(f.request)]);
    assert.equal(a.state,'succeeded');assert.equal(a.operationId,b.operationId);assert.equal(f.calls.creates,1);
    const s=f.runtime.store.read(),d=s.directions[0],w=s.worktrees.find(w=>w.id===d.worktreeId);
    assert.equal(d.brief,'Explicit handoff');assert.equal(d.displayName,f.request.displayName);assert.match(w.branchRef,/^branchman\/[a-f0-9-]+$/);
    assert.equal(await readFile(join(w.canonicalPath,'中文.txt'),'utf8'),'修改\n');assert.deepEqual(await readFile(join(w.canonicalPath,'binary.dat')),Buffer.from([0,255,9]));
    assert.equal(await readFile(join(w.canonicalPath,'未跟踪.txt'),'utf8'),'untracked');assert.equal(s.forkEdges[0].boundarySeq,2);
    assert.equal(f.sessions.get(d.primarySessionId).inherited,3);assert.equal(f.calls.acquired,f.calls.released);
    await assert.rejects(()=>f.runtime.removeDirection(d.id),/uncommitted/);
    const tree=await f.runtime.tree('parent');assert.equal(tree.sessions.find(s=>s.sessionId==='parent').label.source,'user');
    assert.equal(tree.operations[0].request,undefined);assert.equal(tree.operations[0].requestDigest,undefined);
    assert.equal(f.runtime.operations.getByRequestId(f.request.requestId).request.brief,'Explicit handoff');
  }finally{await f.cleanup();}
});
test('a new runtime reconciles a partial fork without creating a second child',async()=>{
  const f=await fixture();try{
    f.calls.failAttach=true;const failed=await f.runtime.fork(f.request);assert.equal(failed.state,'recovery-required');assert.equal(f.calls.creates,1);
    await f.runtime.dispose();f.calls.failAttach=false;const restarted=f.createRuntime();await restarted.ready();
    const result=await restarted.operations.recover(failed.operationId);assert.equal(result.state,'succeeded');assert.equal(f.calls.creates,1);
    assert.equal(restarted.store.read().directions.length,1);assert.equal((await restarted.fork(f.request)).state,'succeeded');await restarted.dispose();
  }finally{await f.cleanup();}
});
test('source cwd mismatch is rejected before any Git side effect',async()=>{
  const f=await fixture();try{await assert.rejects(()=>f.runtime.fork({...f.request,sourceCwd:join(f.repo,'other')}),/differs/);assert.equal(f.calls.creates,0);assert.equal(f.runtime.operations.list().length,0);}finally{await f.cleanup();}
});

test('legacy sessions without a preset compose the official host default',async()=>{
  const f=await fixture();try{
    const query=f.runtime.services.sessionQuery,observe=query.observeSession;
    query.observeSession=async id=>{const lease=await observe(id);lease.projections={values:{}};return lease;};
    const result=await f.runtime.fork(f.request);assert.equal(result.state,'succeeded');
    const d=f.runtime.direction(result.directionId);assert.equal(f.sessions.get(d.primarySessionId).header.agentPreset,'host-default');
  }finally{await f.cleanup();}
});

test('missing model selection fails before a worktree is allocated',async()=>{
  const f=await fixture();try{
    f.runtime.bind('agentDefaultModel',{currentSelection:()=>undefined});
    const result=await f.runtime.fork(f.request);assert.equal(result.state,'failed');assert.match(result.code,/model selection/);
    assert.equal(f.calls.creates,0);assert.equal((await git(f.repo,'worktree','list','--porcelain')).stdout.split('worktree ').length-1,1);
  }finally{await f.cleanup();}
});

test('the production tree derives a missing summary once and releases its observation',async()=>{
  const f=await fixture();try{
    const query=f.runtime.services.sessionQuery;
    query.readTitleSnapshots=async ids=>ids.map(sessionId=>({sessionId,status:'fulfilled',value:{}}));
    f.sessions.get('parent').events.push({seq:6,type:'goal/change',data:{goal:{objective:'Actual goal summary'}}});
    const first=await f.runtime.tree('parent');
    assert.equal(first.sessions.find(s=>s.sessionId==='parent').label.text,'Actual goal summary');
    const acquired=f.calls.acquired;await f.runtime.tree('parent');
    assert.equal(f.calls.acquired,acquired);assert.equal(f.calls.acquired,f.calls.released);
  }finally{await f.cleanup();}
});

test('external branch switches cannot redirect an integration',async()=>{
  const f=await fixture();try{
    const result=await f.runtime.fork({...f.request,history:'blank',codeSource:{kind:'source-head',carryChanges:false}});
    assert.equal(result.state,'succeeded');const d=f.runtime.store.read().directions[0];
    await git(f.repo,'checkout','-b','externally-switched');
    const head=(await git(f.repo,'rev-parse','HEAD')).stdout;
    const merge=await f.runtime.integration('merge','merge-switched',d.id);
    assert.equal(merge.state,'recovery-required');assert.match(merge.code,/identity changed/);
    assert.equal((await git(f.repo,'rev-parse','HEAD')).stdout,head);
    assert.equal(f.runtime.direction(d.id).state,'ready');
  }finally{await f.cleanup();}
});

test('external branch switches cannot turn a managed directory into deletion authority',async()=>{
  const f=await fixture();try{
    const result=await f.runtime.fork({...f.request,history:'blank',codeSource:{kind:'source-head',carryChanges:false}});
    const d=f.runtime.direction(result.directionId),child=f.runtime.treePath(d.worktreeId);
    await git(child,'checkout','-b','unrelated-user-branch');
    await assert.rejects(()=>f.runtime.removeDirection(d.id),/ownership changed/);
    assert.equal((await git(child,'branch','--show-current')).stdout.trim(),'unrelated-user-branch');
    assert.equal(f.runtime.store.read().worktrees.find(w=>w.id===d.worktreeId).branchRef,`branchman/${d.id}`);
  }finally{await f.cleanup();}
});

test('conflicting integration retains Git conflict state and both source commits',async()=>{
  const f=await fixture();try{
    const result=await f.runtime.fork({...f.request,history:'blank',codeSource:{kind:'source-head',carryChanges:false}});
    const d=f.runtime.direction(result.directionId),child=f.runtime.treePath(d.worktreeId);
    await writeFile(join(f.repo,'中文.txt'),'parent change\n');await git(f.repo,'add','.');await git(f.repo,'commit','-m','parent');
    await writeFile(join(child,'中文.txt'),'child change\n');await git(child,'add','.');await git(child,'commit','-m','child');
    const childHead=(await git(child,'rev-parse','HEAD')).stdout;
    const merge=await f.runtime.integration('merge','conflict-merge',d.id);
    assert.equal(merge.state,'recovery-required');assert.equal(f.runtime.direction(d.id).state,'conflicted');
    assert.notEqual((await git(f.repo,'ls-files','-u')).stdout,'');assert.equal((await git(child,'rev-parse','HEAD')).stdout,childHead);
    await assert.rejects(()=>f.runtime.checkDirection(d.id),/uncommitted|conflict/i);
    await git(f.repo,'merge','--abort');
    assert.equal((await f.runtime.checkDirection(d.id)).state,'ready');
  }finally{await f.cleanup();}
});

test('unmerged child commits prevent removal; merged clean children can be removed',async()=>{
  const f=await fixture();try{
    const result=await f.runtime.fork({...f.request,history:'blank',codeSource:{kind:'source-head',carryChanges:false}});
    const d=f.runtime.direction(result.directionId),child=f.runtime.treePath(d.worktreeId);
    await writeFile(join(child,'child-only.txt'),'value');await git(child,'add','.');await git(child,'commit','-m','child');
    await assert.rejects(()=>f.runtime.removeDirection(d.id),/not integrated/);
    assert.equal((await f.runtime.integration('merge','integrate-first',d.id)).state,'succeeded');
    const removed=await f.runtime.operations.remove({requestId:'remove-integrated',directionId:d.id});
    assert.equal(removed.state,'succeeded');assert.equal(f.runtime.direction(d.id).state,'removed');
    assert.equal((await git(f.repo,'worktree','list','--porcelain')).stdout.includes(child.replaceAll('\\','/')),false);
  }finally{await f.cleanup();}
});
