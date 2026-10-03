import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {privateKeyToAccount} from 'viem/accounts';
import {canonical,digest,collectionMessage,proofFor} from '../lib/evidence.mjs';
import {validate} from '../lib/collector.mjs';
import {createHandler} from '../api/collect.mjs';
import {createHandler as attestHandler} from '../api/attest.mjs';
const release='chain-and-site/calibration/candidates/int-v3/';
const profile=JSON.parse(readFileSync(release+'profile.json'));
const plan=JSON.parse(readFileSync(release+'confirmation-plan.json'));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const profileHash=hash(release+'profile.json'),manifestHash=hash(release+'manifest.json');
const caller=privateKeyToAccount('0x'+'11'.repeat(32));
const collector=privateKeyToAccount('0x'+'22'.repeat(32));
const address='0x'+'33'.repeat(20);
const model=plan.families['gpt-class'].model;
function envelope(){return {version:'voirdire/3',profile_hash:profileHash,claim_id:0,nonce:'ab'.repeat(16),endpoint:'openrouter:'+model,transcripts:plan.probes.map(p=>({probe_id:p.probe_id,probe_class:p.class,sent:p.carrier}))};}
function context(env,changes={}){
 const states={get_commitment:{claim_id:0,digest:digest(env),challenger:caller.address,expires_at:Math.floor(Date.now()/1000)+86400,opened:false,evidence_digest:''},get_claim:{status:'OPEN',evidence_collector:collector.address,agent_id:env.endpoint,valid_from:'2020-01-01',valid_until:'2099-01-01'},burned_probes:{probe_ids:[]},protocol_info:{version:'voirdire/3',profile_status:'APPROVED',profile_hash:profileHash,calibration_manifest_hash:manifestHash},...changes};
 return {deployment:{contractAddress:address,protocolVersion:'voirdire/3',profileHash,calibrationManifestHash:manifestHash},profile:structuredClone(profile),calibrationPlan:structuredClone(plan),account:collector,key:'fixture-secret',client:{readContract:async c=>{assert.equal(c.transactionHashVariant,'latest-final');return states[c.functionName];}}};
}
async function body(env){return {commitId:0,envelope:env,apiKey:'fixture-key-'.repeat(3),signature:await caller.signMessage({message:collectionMessage(address,0,digest(env))})};}
async function invoke(handler,b){const out={};const res={setHeader(){},status(s){out.status=s;return res;},json(b){out.body=b;}};await handler({method:'POST',body:b},res);return out;}
function response(number,changes={}){return {id:'fixture-'+number,model,provider:plan.families['gpt-class'].provider,choices:[{finish_reason:'stop',message:{content:'A real-looking fixture response.'}}],...changes};}

const contractPath=['runs/calibrated-contract/voirdire.py','public/voirdire.py','chain-and-site/contracts/voirdire.py'].find(p=>existsSync(p)&&readFileSync(p,'utf8').includes('"profile_hash": str(env.get("profile_hash", ""))'));
test('v3 JS commitment and evidence canonicalization match actual Python contract', {skip:!contractPath&&'v3 contract source not yet promoted'},()=>{
 const env=envelope();env.transcripts[0].sent='Zoë 😀\n\u200b';
 for(const t of env.transcripts)Object.assign(t,{got:'Ответ “yes” 😀',finish_reason:'length',observed_at:'2026-10-03T11:22:33Z',source:{ignored:'metadata'}});
 const script=`import ast,json,sys\nsrc=ast.parse(open(sys.argv[1]).read());ns={'json':json}\nfns=[n for n in src.body if isinstance(n,ast.FunctionDef) and n.name in ('_canonical','_canonical_evidence')]\nexec(compile(ast.Module(body=fns,type_ignores=[]),'contract','exec'),ns)\ne=json.load(sys.stdin);print(json.dumps([ns['_canonical'](e),ns['_canonical_evidence'](e)],ensure_ascii=False))`;
 const actual=JSON.parse(execFileSync('python3',['-c',script,contractPath],{input:JSON.stringify(env),encoding:'utf8'}));
 assert.deepEqual(actual,[canonical(env),canonical(env,true)]);
});
test('v3 profile and finish reason bind hashes while responses remain outside commitment',()=>{
 const e=envelope();for(const t of e.transcripts)Object.assign(t,{got:'answer',finish_reason:'stop'});
 const commit=digest(e),evidence=digest(e,true),proof=proofFor('k',address,0,e);
 e.transcripts[0].finish_reason='length';assert.equal(digest(e),commit);assert.notEqual(digest(e,true),evidence);assert.notEqual(proofFor('k',address,0,e),proof);
 e.profile_hash='00'.repeat(32);assert.notEqual(digest(e),commit);
});
test('v3 exact signed profile validates and returns frozen route and generation policy',async()=>{
 const e=envelope(),result=await validate(await body(e),context(e));
 assert.deepEqual(result.routing,plan.families['gpt-class'].routing);assert.deepEqual(result.generationPolicy,profile.generation_policy);
});
test('v3 wrong signature, profile hash, exact probe set or prompt fails closed',async()=>{
 const e=envelope(),b=await body(e);
 const wrong=await collector.signMessage({message:collectionMessage(address,0,digest(e))});
 await assert.rejects(()=>validate({...b,signature:wrong},context(e)),/signature/);
 for(const mutate of [x=>x.profile_hash='0'.repeat(64),x=>x.transcripts.pop(),x=>x.transcripts[1]=x.transcripts[0],x=>x.transcripts[0].sent+=' ']){
  const x=structuredClone(e);mutate(x);await assert.rejects(()=>validate({...b,envelope:x},context(x)));
 }
});
test('v3 unapproved, mismatched on-chain profile or manifest cannot collect',async()=>{
 const e=envelope(),signedBody=await body(e);const good=context(e);const protocol=await good.client.readContract({functionName:'protocol_info',transactionHashVariant:'latest-final'});
 for(const change of [{profile_status:'UNVALIDATED'},{profile_hash:'wrong'},{calibration_manifest_hash:'wrong'},{version:'voirdire/2'}])await assert.rejects(()=>validate(signedBody,context(e,{protocol_info:{...protocol,...change}})),/approved/);
});
test('v3 missing or permissive pinned provider routing fails before upstream calls',async()=>{
 const e=envelope(),b=await body(e);
 for(const mutate of [s=>delete s.routing.only,s=>s.routing.allow_fallbacks=true,s=>s.routing.only=['other'],s=>delete s.routing.max_price]){
  const c=context(e);mutate(c.calibrationPlan.families['gpt-class']);await assert.rejects(()=>validate(b,c),/route/);
 }
});
test('v3 collection pins model/provider and never raises frozen price ceiling',async()=>{
 const e=envelope(),c=context(e),b=await body(e);let requests=0;
 for(const priceLimits of [{prompt:999,completion:999},{prompt:.01,completion:.02}]){
  const out=await invoke(createHandler({setup:()=>c,fetch:async(url,opts)=>{
   requests++;const p=JSON.parse(opts.body);const frozen=plan.families['gpt-class'].routing;
   assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(opts.redirect,'error');assert.equal(p.model,model);
   assert.deepEqual(p.provider.only,frozen.only);assert.deepEqual(p.provider.order,frozen.order);assert.equal(p.provider.allow_fallbacks,false);assert.equal(p.provider.require_parameters,true);
   assert.equal(p.provider.max_price.prompt,Math.min(frozen.max_price.prompt,priceLimits.prompt));assert.equal(p.provider.max_price.completion,Math.min(frozen.max_price.completion,priceLimits.completion));
   assert.equal(p.max_tokens,600);assert.equal(p.temperature,1);
   return {ok:true,json:async()=>response(requests,{choices:[{finish_reason:'length',message:{content:'😀'.repeat(4096)}}]})};
  }}),{...b,priceLimits});
  assert.equal(out.status,200);assert.equal(out.body.envelope.transcripts.length,6);assert.ok(out.body.envelope.transcripts.every(t=>t.finish_reason==='length'));
  assert.equal(out.body.evidenceDigest,digest(out.body.envelope,true));
 }
 assert.equal(requests,12);
});
test('v3 wrong reported model/provider, tools, empty and overlong evidence return no proof',async()=>{
 const e=envelope(),b=await body(e);
 for(const change of [{model:'openai/other'},{provider:'wrong'},{choices:[{finish_reason:'tool_calls',message:{content:'text'}}]},{choices:[{finish_reason:'stop',message:{content:''}}]},{choices:[{finish_reason:'stop',message:{content:'😀'.repeat(4097)}}]}]){
  let requests=0;const out=await invoke(createHandler({setup:()=>context(e),fetch:async()=>{requests++;return {ok:true,json:async()=>response(requests,change)};}}),b);
  assert.equal(out.status,400);assert.equal(requests,1);assert.equal(out.body.proof,undefined);
 }
});
test('v2 still rejects length finish reason while v3 binds it',async()=>{
 const e=envelope();e.version='voirdire/2';delete e.profile_hash;
 const out=await invoke(createHandler({setup:()=>context(e),validate:async()=>({commitment:{expires_at:Math.floor(Date.now()/1000)+86400},model}),fetch:async()=>({ok:true,json:async()=>response(1,{choices:[{finish_reason:'length',message:{content:'capped text'}}]})})}),{envelope:e,commitId:0,apiKey:'fixture-'.repeat(5)});
 assert.equal(out.status,400);assert.equal(out.body.proof,undefined);
});
test('setup rejects local profile and manifest hash mismatch without touching deployment files',()=>{
 const program=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const original=fs.readFileSync;const profileBytes=original(${JSON.stringify(release+'profile.json')});
const deployment={contractAddress:${JSON.stringify(address)},protocolVersion:'voirdire/3',profileHash:${JSON.stringify(profileHash)},calibrationManifestHash:'bad'};
fs.readFileSync=(path,...args)=>String(path).endsWith('/public/deployment.json')?JSON.stringify(deployment):String(path).endsWith('/public/profile.json')?profileBytes:original(path,...args);
syncBuiltinESMExports();process.env.COLLECTOR_PRIVATE_KEY='0x'+'22'.repeat(32);
const {setup}=await import('./lib/collector.mjs');
let errors=[];try{setup()}catch(e){errors.push(e.message)};deployment.profileHash='bad';try{setup()}catch(e){errors.push(e.message)};console.log(JSON.stringify(errors));`;
 const errors=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8'}));
 assert.match(errors[0],/calibration release/);assert.match(errors[1],/profile does not match/);
});

test('v3 finish-reason tampering cannot trigger an attestation write',async()=>{
 const e=envelope();for(const t of e.transcripts)Object.assign(t,{got:'response',finish_reason:'stop'});
 const c=context(e),b=await body(e);b.proof=proofFor(c.key,address,0,e);
 e.transcripts[0].finish_reason='length';let writes=0;
 c.client.writeContract=async()=>{writes++;throw new Error('must never write');};
 const result=await invoke(attestHandler({setup:()=>c}),b);
 assert.equal(result.status,400);assert.match(result.body.error,/Only evidence/);assert.equal(writes,0);
});
