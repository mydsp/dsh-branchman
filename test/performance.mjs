// Synthetic dataset, real bundled runtime. Host corpus I/O is explicitly a fixture.
import {BranchmanRuntime} from '../index.js';
import {emptyStateV2} from '../dist-test/src/host/store.js';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,cpus} from 'node:os';
const folder=await mkdtemp(join(tmpdir(),'branchman-performance-'));
try {
  const runtime=new BranchmanRuntime({sessions:{get:()=>undefined}},{dataFile:join(folder,'tree-v2.json')},{buildForkSeed:()=>[]});await runtime.ready();
  const state=emptyStateV2();state.repositories.push({id:'repo',canonicalCommonDir:'E:/fixture/.git',primaryWorktreeId:'wt0',identityVerified:true});
  for(let i=0;i<101;i++)state.worktrees.push({id:`wt${i}`,repoId:'repo',canonicalPath:`E:/fixture/wt${i}`,branchRef:`branch-${i}`,managedBy:i?'branchman':'external'});
  const corpus=[];
  for(let i=0;i<1000;i++){const id=`synthetic-${i}`;state.sessions.push({sessionId:id,worktreeId:`wt${i%101}`,presence:'persisted',archived:false});corpus.push({header:{id,cwd:`E:/fixture/wt${i%101}`,createdAt:i}});}
  for(let i=0;i<100;i++)state.directions.push({id:`dir${i}`,repoId:'repo',worktreeId:`wt${i+1}`,displayName:`same-${i%10}`,primarySessionId:`synthetic-${i}`,baseOid:'fixture',upstreamRef:'branch-0',integrationTargetWorktreeId:'wt0',state:'ready'});
  await runtime.store.commit(0,state);
  let titleCalls=0;
  runtime.bind('sessionQuery',{listSessions:async()=>corpus,readTitleSnapshots:async ids=>{titleCalls++;return ids.map(sessionId=>({sessionId,status:'fulfilled',value:{title:{title:`Title ${sessionId}`,source:{kind:'generated'}}}}));}});
  const start=performance.now();await runtime.tree();const firstReadMs=performance.now()-start;
  for(let i=0;i<16;i++)await runtime.tree();
  const samples=[];for(let i=0;i<100;i++){const t=performance.now();const data=await runtime.tree();if(data.sessions.length!==1000)throw Error('lost sessions');samples.push(performance.now()-t);}
  samples.sort((a,b)=>a-b);const result={dataset:{sessions:1000,directions:100},layer:'actual bundled runtime, fixture corpus/title I/O',runtime:process.version,cpu:cpus()[0]?.model,firstReadMs,p95Ms:samples[94],maxMs:samples.at(-1),samples:100,titleCalls};
  await writeFile('E:/codexproject/docs/superpowers/plans/dsh-takeover-evidence/runtime-performance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  await runtime.dispose();if(result.p95Ms>200)process.exitCode=1;
}finally{await rm(folder,{recursive:true,force:true});}
