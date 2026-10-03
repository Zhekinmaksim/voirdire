import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { privateKeyToAccount } from 'viem/accounts';
import { canonical, digest, proofFor, validProof, collectionMessage } from '../lib/evidence.mjs';
import { validate, safeError, bodyOf } from '../lib/collector.mjs';
import { createHandler as collectHandler } from '../api/collect.mjs';
import { createHandler as attestHandler } from '../api/attest.mjs';

const caller = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const collector = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const address = `0x${'33'.repeat(20)}`;
const corpus = JSON.parse(readFileSync(new URL('../chain-and-site/corpus/probes.json', import.meta.url)));
const probes = ['tokenizer_artifact', 'refusal_shape'].map(cls => corpus.probes.find(p => p.status === 'active' && p.class === cls));
const plan = () => ({ version: 'voirdire/2', claim_id: 0, nonce: '12'.repeat(16), endpoint: 'openrouter:openai/gpt-4o', transcripts: probes.map(p => ({probe_id:p.probe_id,probe_class:p.class,sent:p.carrier})) });
const commitment = env => ({claim_id:0,digest:digest(env),challenger:caller.address,expires_at:Math.floor(Date.now()/1000)+86400,opened:false,evidence_digest:''});
const claim = {status:'OPEN',evidence_collector:collector.address,agent_id:'openrouter:openai/gpt-4o',valid_from:'2020-01-01',valid_until:'2099-01-01'};
function context(env) {
  return {deployment:{contractAddress:address},account:collector,key:'test-hmac-secret',client:{readContract:async call => {
    assert.equal(call.transactionHashVariant,'latest-final');
    return ({get_claim:claim,get_commitment:commitment(env),burned_probes:{probe_ids:[]}})[call.functionName];
  }}};
}
async function signed(env) { return {commitId:0,envelope:env,signature:await caller.signMessage({message:collectionMessage(address,0,digest(env))})}; }
async function invoke(handler,body) {
  const result = {headers:{}};
  const res = {setHeader:(k,v)=>result.headers[k]=v,status:s=>{result.status=s;return res},json:b=>result.body=b};
  await handler({method:'POST',body},res); return result;
}

test('Python and JavaScript plan/evidence bytes agree including unicode', () => {
  const env=plan(); env.transcripts[0].sent='Zoë\n😀\u200b';
  for (const t of env.transcripts) {t.got='Ответ\n“quoted”';t.observed_at='2026-10-03T11:20:03Z';}
  const script="import sys,json;sys.path.insert(0,'chain-and-site/cli');import round as r;e=json.load(sys.stdin);print(json.dumps([r.canonical(e),r.canonical_evidence(e),r.digest(e),r.evidence_digest(e)],ensure_ascii=False))";
  const actual=JSON.parse(execFileSync('python3',['-c',script],{input:JSON.stringify(env),encoding:'utf8'}));
  assert.deepEqual(actual,[canonical(env),canonical(env,true),digest(env),digest(env,true)]);
});

test('collector proof binds responses, metadata, contract and commitment',()=>{
  const env=plan(); env.transcripts[0].got='answer';env.transcripts[0].source={reported_model:'model-a'};
  const proof=proofFor('key',address,0,env);
  assert.ok(validProof(proof,proof)); assert.equal(validProof(proof,'oops'),false);
  env.transcripts[0].source.reported_model='model-b';
  assert.notEqual(proofFor('key',address,0,env),proof);
  assert.notEqual(proofFor('key',address,1,env),proof);
});

test('signed canonical corpus plan validates against finalized state',async()=>{
  const env=plan(); assert.equal((await validate(await signed(env),context(env))).model,'openai/gpt-4o');
});

test('wrong signer, altered carrier, missing endpoint and invalid inputs rejected',async()=>{
  const env=plan(),body=await signed(env);
  const wrong=await collector.signMessage({message:collectionMessage(address,0,digest(env))});
  await assert.rejects(()=>validate({...body,signature:wrong},context(env)),/signature/);
  for (const modify of [e=>e.transcripts[0].sent='malicious',e=>delete e.endpoint,e=>e.nonce=123,e=>e.transcripts[0]=null,e=>e.claim_id=-1]) {
    const changed=structuredClone(env);modify(changed);
    await assert.rejects(()=>validate({...body,envelope:changed},context(env)));
  }
});

test('unexpected errors never disclose credentials or raw RPC bodies',async()=>{
  assert.ok(!safeError(new Error('Bearer SECRET')).includes('SECRET'));
  assert.throws(()=>bodyOf({body:'{"apiKey":"SECRET"'}),/Invalid JSON/);
  const out=await invoke(collectHandler({setup:()=>{throw new Error('PRIVATE_SECRET')}}),{apiKey:'k'.repeat(25)});
  assert.equal(out.status,400);assert.ok(!JSON.stringify(out).includes('SECRET'));
});

test('successful collection uses fixed transport and returns signed recoverable evidence',async()=>{
  const env=plan(),ctx=context(env);let calls=0;
  const handler=collectHandler({setup:()=>ctx,validate:async()=>({commitment:commitment(env),model:'openai/gpt-4o'}),fetch:async(url,options)=>{
    calls++;assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,`Bearer ${'k'.repeat(25)}`);
    assert.equal(JSON.parse(options.body).provider.allow_fallbacks,false);
    return {ok:true,json:async()=>({id:`generation-${calls}`,model:'reported-version',provider:'provider',choices:[{finish_reason:'stop',message:{content:'Observed response'}}]})};
  }});
  const out=await invoke(handler,{...(await signed(env)),apiKey:'k'.repeat(25)});
  assert.equal(out.status,200);assert.equal(calls,2);
  assert.equal(out.body.envelope.transcripts[0].source.requested_model,'openai/gpt-4o');
  assert.equal(out.body.envelope.transcripts[0].source.reported_model,'reported-version');
  assert.ok(validProof(proofFor(ctx.key,address,0,out.body.envelope),out.body.proof));
  assert.equal(out.headers['Cache-Control'],'no-store');
  assert.ok(!JSON.stringify(out.body).includes('k'.repeat(25)));
});

test('tampered collector proof cannot send an attestation transaction',async()=>{
  const env=plan(),ctx=context(env);let writes=0;ctx.client.writeContract=async()=>{writes++;return '0xhash'};
  const handler=attestHandler({setup:()=>ctx,validate:async()=>({commitment:commitment(env)})});
  const out=await invoke(handler,{envelope:env,commitId:0,proof:'0'.repeat(64)});
  assert.equal(out.status,400);assert.equal(writes,0);
});

test('provider errors, missing provenance and truncation never produce collector proof',async()=>{
  const env=plan(),ctx=context(env);
  for (const upstream of [()=>{throw new Error('Authorization SECRET')},()=>({ok:false,status:401}),()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'text'}}]})}),()=>({ok:true,json:async()=>({id:'id',model:'model',choices:[{finish_reason:'length',message:{content:'text'}}]})})]) {
    const handler=collectHandler({setup:()=>ctx,validate:async()=>({commitment:commitment(env),model:'openai/gpt-4o'}),fetch:upstream});
    const out=await invoke(handler,{envelope:env,commitId:0,apiKey:'k'.repeat(25)});
    assert.equal(out.status,400);assert.equal(out.body.proof,undefined);assert.ok(!JSON.stringify(out).includes('SECRET'));
  }
});

test('nonfinal attestation suppresses another fee-paying transaction',async()=>{
  const env=plan(),ctx=context(env);let writes=0;
  ctx.client.readContract=async call=>{assert.equal(call.transactionHashVariant,'latest-nonfinal');return {...commitment(env),evidence_digest:digest(env,true)}};
  ctx.client.writeContract=async()=>{writes++;return '0xhash'};
  const handler=attestHandler({setup:()=>ctx,validate:async()=>({commitment:commitment(env)})});
  const out=await invoke(handler,{envelope:env,commitId:0,proof:proofFor(ctx.key,address,0,env)});
  assert.equal(out.status,200);assert.equal(out.body.awaitingFinality,true);assert.equal(writes,0);
});

test('concurrent repeats deduplicate and distinct commits serialize signer submissions',async()=>{
  const env=plan(),ctx=context(env);let writes=0,active=0,maxActive=0;
  ctx.client.readContract=async()=>commitment(env);
  ctx.client.writeContract=async()=>{writes++;active++;maxActive=Math.max(active,maxActive);await new Promise(resolve=>setTimeout(resolve,10));active--;return `0xhash${writes}`};
  const handler=attestHandler({setup:()=>ctx,validate:async()=>({commitment:commitment(env)})});
  const first={envelope:env,commitId:0,proof:proofFor(ctx.key,address,0,env)};
  const second={envelope:env,commitId:1,proof:proofFor(ctx.key,address,1,env)};
  const results=await Promise.all([invoke(handler,first),invoke(handler,first),invoke(handler,second)]);
  assert.ok(results.every(r=>r.status===200));assert.equal(writes,2);assert.equal(maxActive,1);
  assert.equal(results[0].body.transactionHash,results[1].body.transactionHash);
});

test('sponsorship caps fail closed and bound cross-instance replay expense',async()=>{
  const { boundedAccount } = await import('../lib/collector.mjs');
  let signed=0;
  const original={address:collector.address,signTransaction:async()=>{signed++;return '0xsigned'}};
  assert.throws(()=>boundedAccount(original,{}),/not configured/);
  const guarded=boundedAccount(original,{maxNonce:'21\n',maxFeeWei:' 10000000000000000\n'});
  const request={nonce:20,gas:200000n,gasPrice:1000000000n,value:0n};
  assert.equal(await guarded.signTransaction(request),'0xsigned');
  for(const change of [{nonce:21},{nonce:-1},{gas:0n},{gasPrice:-1n},{value:1n},{gas:100000000n}]) {
    await assert.rejects(()=>guarded.signTransaction({...request,...change}));
  }
  assert.equal(signed,1);
});

test('optional provider price limits are enforced in every upstream request',async()=>{
  const env=plan(),ctx=context(env);let requests=0;
  const handler=collectHandler({setup:()=>ctx,validate:async()=>({commitment:commitment(env),model:'openai/gpt-4o-mini'}),fetch:async(url,options)=>{
    requests++;assert.deepEqual(JSON.parse(options.body).provider.max_price,{prompt:0.15,completion:0.6});
    return {ok:true,json:async()=>({id:'g',model:'m',choices:[{finish_reason:'stop',message:{content:'answer'}}]})};
  }});
  const body={envelope:env,commitId:0,apiKey:'k'.repeat(25)};
  assert.equal((await invoke(handler,{...body,priceLimits:{prompt:0.15,completion:0.6}})).status,200);
  assert.equal(requests,2);
  for(const priceLimits of [null,[],{}, {prompt:0,completion:1},{prompt:1,completion:Infinity},{prompt:'0.15',completion:0.6}]) {
    assert.equal((await invoke(handler,{...body,priceLimits})).status,400);
  }
  assert.equal(requests,2);
});

test('gas cushion is applied before signing and cannot bypass sponsorship ceiling',async()=>{
  const { boundedAccount } = await import('../lib/collector.mjs');
  let signedTransaction,diagnostic;
  const account=boundedAccount({signTransaction:async tx=>{signedTransaction=tx;return '0x1234'}},{maxNonce:'21',maxFeeWei:'10000'},d=>diagnostic=d);
  await account.signTransaction({nonce:2,gas:101n,gasPrice:1n,value:0n});
  assert.equal(signedTransaction.gas,127n);
  assert.equal(diagnostic.nonce,'2');assert.match(diagnostic.evmTransactionHash,/^0x[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(diagnostic).includes('1234'),false);
  await assert.rejects(()=>account.signTransaction({nonce:3,gas:9000n,gasPrice:1n,value:0n}),/fee limit/);
});

test('post-sign failures return public EVM hash and suppress same-instance retries',async()=>{
  const env=plan(),ctx=context(env);let writes=0;
  ctx.sponsorship={lastSigned:null};ctx.client.readContract=async()=>commitment(env);
  ctx.client.writeContract=async()=>{writes++;ctx.sponsorship.lastSigned={nonce:'2',evmTransactionHash:`0x${'55'.repeat(32)}`};throw new Error('Transaction reverted: EVM tx internal details');};
  const handler=attestHandler({setup:()=>ctx,validate:async()=>({commitment:commitment(env)})});
  const body={envelope:env,commitId:0,proof:proofFor(ctx.key,address,0,env)};
  for(let i=0;i<2;i++){
    const out=await invoke(handler,body);assert.equal(out.status,502);assert.equal(out.body.outcome,'reverted');
    assert.equal(out.body.evmTransactionHash,`0x${'55'.repeat(32)}`);assert.ok(!out.body.error.includes('internal'));
  }
  assert.equal(writes,1);
});

test('cached reverted submissions retry only when EVM receipt confirms the same failed hash',async()=>{
  const env=plan(),ctx=context(env),evmHash=`0x${'66'.repeat(32)}`;let writes=0,receipt=null;
  ctx.sponsorship={lastSigned:null};ctx.client.readContract=async()=>commitment(env);
  ctx.client.request=async({method,params})=>{assert.equal(method,'eth_getTransactionReceipt');assert.deepEqual(params,[evmHash]);return receipt};
  ctx.client.writeContract=async()=>{writes++;ctx.sponsorship.lastSigned={nonce:String(writes),evmTransactionHash:evmHash};throw new Error('Transaction reverted: EVM tx '+evmHash)};
  const handler=attestHandler({setup:()=>ctx,validate:async()=>({commitment:commitment(env)})});
  const body={envelope:env,commitId:0,proof:proofFor(ctx.key,address,0,env)};
  assert.equal((await invoke(handler,body)).status,502);
  for(const value of [null,{status:'0x1',transactionHash:evmHash},{status:'0x0',transactionHash:`0x${'77'.repeat(32)}`}]){
    receipt=value;assert.equal((await invoke(handler,body)).status,502);assert.equal(writes,1);
  }
  receipt={status:'0x0',transactionHash:evmHash};
  const retry=await invoke(handler,body);assert.equal(retry.status,502);assert.equal(writes,2);
  assert.ok(retry.body.error.includes(evmHash));
});
