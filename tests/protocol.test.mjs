import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPlan, digestPlan, validateEnvelope, newNonce } from '../app/src/protocol.js';
import { canonical, digest, proofFor } from '../lib/evidence.mjs';

const envelope = () => ({ version:'voirdire/2', claim_id:3, endpoint:'openrouter:vendor/model', nonce:'a'.repeat(64), transcripts:[{probe_id:'tok-1',probe_class:'tokenizer_artifact',sent:'Zoë ဤ 😀\nline',got:'original',observed_at:'2026-10-03T10:00:00Z',source:{requested_model:'vendor/model',reported_model:'vendor/model-v2',provider:'provider',generation_id:'gen-123'}}] });
test('browser canonical bytes and SHA-256 match collector including Unicode', async () => {
 const e=envelope(); assert.equal(canonicalPlan(e),canonical(e)); assert.equal(await digestPlan(e),digest(e));
 delete e.endpoint; assert.equal(canonicalPlan(e),canonical(e)); assert.equal(await digestPlan(e),digest(e));
});
test('responses can arrive after commitment but probe mutations change it', async () => {
 const e=envelope(), original=await digestPlan(e); e.transcripts[0].got='new response'; e.transcripts[0].observed_at='2026-10-04'; assert.equal(await digestPlan(e),original);
 e.transcripts[0].sent+=' '; assert.notEqual(await digestPlan(e),original);
});
test('backup restoration preserves complete source metadata and attestation proof', () => {
 const e=envelope(), proof=proofFor('test-secret','0x123',2,e);
 const saved=JSON.stringify({envelope:e,proof,downloaded:true}); const loaded=JSON.parse(saved);
 const restored=validateEnvelope(loaded.envelope);
 assert.deepEqual(restored,e); assert.equal(proofFor('test-secret','0x123',2,restored),loaded.proof);
 restored.transcripts[0].source.generation_id='modified'; assert.notEqual(proofFor('test-secret','0x123',2,restored),loaded.proof);
});
test('nonce and invalid imports fail closed', () => {
 const nonce=newNonce(); assert.match(nonce,/^[a-f0-9]{64}$/); assert.notEqual(nonce,newNonce());
 for(const override of [{nonce:'bad'},{version:'voirdire/1'},{claim_id:-1},{transcripts:[]},{transcripts:[{probe_id:'p'}]}])assert.throws(()=>validateEnvelope({...envelope(),...override}));
});

import {loadClaimView, receiptSummary} from '../app/src/lifecycle.js';
test('pending or temporarily unknown rounds do not hide claim details', async () => {
 const read=async(name,args)=>{
  if(name==='get_claim') return {claim_id:0,agent_id:'openrouter:a/b'};
  if(name==='report')return {classes:[]};
  if(name==='burned_probes')return {probe_ids:['spent']};
  if(name==='round_count')return 2;
  if(name==='get_round'&&args[0]===1)throw new Error('unknown round');
  if(name==='get_round')return {claim_id:0,round_id:0,commit_id:0,settled:false};
  if(name==='get_commitment')throw new Error('temporarily unavailable');
 };
 const result=await loadClaimView(read,0);
 assert.equal(result.claim.claim_id,0);assert.equal(result.rounds.length,1);assert.equal(result.rounds[0].expires_at,null);assert.equal(result.warnings.length,2);
});
test('missing spent-probe state is distinguished from zero spent probes', async()=>{
 const result=await loadClaimView(async name=>{
  if(name==='get_claim')return {claim_id:0};
  if(name==='report')return {classes:[]};
  if(name==='round_count')return 0;
  throw new Error('RPC unavailable');
 },0);
 assert.equal(result.burned,null);assert.match(result.warnings[0],/disabled/);
});
test('receipt lifecycle and execution result are reported separately',()=>{
 assert.match(receiptSummary({statusName:'COMMITTING'}).detail,/does not mean final settlement/);
 assert.match(receiptSummary({statusName:'FINALIZED',txExecutionResultName:'REVERT'}).detail,/REVERT/);
 assert.match(receiptSummary({statusName:'FINALIZED'}).detail,/not reported/);
 assert.equal(receiptSummary(null).status,'Pending');
});

import {evmReceiptSummary, attestationFailureRecord} from '../app/src/lifecycle.js';
test('EVM receipt states never claim Intelligent Contract settlement',()=>{
 assert.equal(evmReceiptSummary(null).status,'EVM pending');
 assert.match(evmReceiptSummary(null).detail,/Do not resubmit/);
 assert.equal(evmReceiptSummary({status:'0x0'}).status,'EVM reverted');
 assert.equal(evmReceiptSummary({status:'0x1'}).status,'EVM mined');
 assert.match(evmReceiptSummary({status:'0x1'}).detail,/does not mean.*settled/);
 assert.equal(evmReceiptSummary({}).status,'EVM unknown');
});
test('collector failure retains a validated EVM hash with its commitment context',()=>{
 const hash='0x'+'a'.repeat(64);
 const record=attestationFailureRecord({error:'Submission failed.',evmTransactionHash:hash,outcome:'unknown'},'0xcontract',12,'now');
 assert.equal(record.kind,'evm');assert.equal(record.hash,hash);assert.equal(record.commitId,12);assert.equal(record.status,'EVM unknown');
 assert.equal(attestationFailureRecord({evmTransactionHash:hash,outcome:'reverted'},'0xcontract',12).status,'EVM reverted');
 assert.equal(attestationFailureRecord({evmTransactionHash:'invalid'},'0xcontract',12),null);
});

import {roundActions} from '../app/src/lifecycle.js';
test('published pending rounds can request judgement without allowing premature confirmation',()=>{
 const protocol={evidence_publication:'separate-from-judging'};
 const round={verdict:'PENDING',stage_b1:'PENDING',stage_b2:'PENDING',settled:false};
 assert.deepEqual(roundActions(round,protocol),{judge:true,confirm:false,recover:true});
 assert.equal(roundActions(round,{}).judge,false);
 assert.deepEqual(roundActions({...round,settled:true},protocol),{judge:false,confirm:false,recover:false});
});
test('confirmation is only available for inconsistent findings admitted by first referee',()=>{
 const round={verdict:'INCONSISTENT',stage_b1:'ADMISSIBLE',stage_b2:'PENDING',settled:false};
 assert.equal(roundActions(round,{}).confirm,true);
 for(const change of [{stage_b1:'PENDING'},{stage_b1:'INADMISSIBLE'},{stage_b2:'ADMISSIBLE'},{verdict:'PENDING'},{verdict:'INCONCLUSIVE'},{settled:true}])assert.equal(roundActions({...round,...change},{}).confirm,false);
});

import {trackWalletProvider,ensureWalletChain} from '../app/src/wallet.js';
test('wallet EVM hash is recorded before SDK continuation; methods keep provider context',async()=>{
 const events=[], hash='0x'+'b'.repeat(64);
 const wallet={marker:7,request:async function(args){assert.equal(this.marker,7);events.push(args.method);return hash;},on:function(event,handler){assert.equal(this.marker,7);events.push(event);return handler;},removeListener:function(){assert.equal(this.marker,7);}};
 const wrapped=trackWalletProvider(wallet,value=>events.push(`persist:${value}`));
 assert.equal(await wrapped.request({method:'eth_sendTransaction',params:[]}),hash);events.push('SDK continues');
 assert.deepEqual(events,['eth_sendTransaction',`persist:${hash}`,'SDK continues']);
 assert.equal(wrapped.marker,7);const handler=()=>{};assert.equal(wrapped.on('accountsChanged',handler),handler);wrapped.removeListener();
});
test('wallet rejection and non-transaction responses never invent a submitted hash',async()=>{
 const hashes=[];let response='0x'+'c'.repeat(64);
 const wallet={async request(){if(response instanceof Error)throw response;return response;}};
 const wrapped=trackWalletProvider(wallet,hash=>hashes.push(hash));
 await wrapped.request({method:'eth_chainId'});
 for(response of [null,undefined,'0x123',{},['0x'+'c'.repeat(64)]])await wrapped.request({method:'eth_sendTransaction'});
 response=new Error('User rejected');await assert.rejects(wrapped.request({method:'eth_sendTransaction'}),/User rejected/);
 assert.deepEqual(hashes,[]);
});
test('wallet wrapper works with immutable injected provider methods',async()=>{
 const hash='0x'+'d'.repeat(64),seen=[];
 const provider=Object.freeze({request:async()=>hash});
 const wrapped=trackWalletProvider(provider,value=>seen.push(value));
 assert.equal(await wrapped.request({method:'eth_sendTransaction'}),hash);assert.deepEqual(seen,[hash]);
});
test('wallet receives the gas cushion for approval without mutating SDK request or call data',async()=>{
 let sent;const wallet={request:async r=>{sent=r;return '0x'+'e'.repeat(64)}};
 const original=Object.freeze({method:'eth_sendTransaction',params:Object.freeze([Object.freeze({gas:'0x65',value:'0x7',data:'0xabcdef'})])});
 await trackWalletProvider(wallet,()=>{}).request(original);
 assert.equal(sent.params[0].gas,'0x7f');assert.equal(original.params[0].gas,'0x65');
 assert.equal(sent.params[0].value,'0x7');assert.equal(sent.params[0].data,'0xabcdef');
});

import {corpusRoundCapacity} from '../app/src/protocol.js';
test('registration round capacity uses two fresh probes per required class and fails closed',()=>{
 const make=(counts)=>Object.entries(counts).flatMap(([group,count])=>Array.from({length:count},(_,i)=>({probe_id:`${group}-${i}`,class:group,status:'active',carrier:'task'})));
 const groups={tokenizer_artifact:7,refusal_shape:7,repeat_stability:7};
 assert.equal(corpusRoundCapacity(make(groups)),3);
 assert.equal(corpusRoundCapacity(make({...groups,repeat_stability:1})),0);
 assert.equal(corpusRoundCapacity(undefined),0);
 const probes=make(groups);probes[0].status='retired';probes.push(probes[1],{probe_id:'extra',class:'other',status:'active',carrier:'task'});
 assert.equal(corpusRoundCapacity(probes),3);
});

import {restoreEvidenceBundle} from '../app/src/protocol.js';
import {attestationRecoveryState,recordAttestationResult} from '../app/src/lifecycle.js';
test('hard reload retains evidence proof and requires a new download after collection',()=>{
 const e=envelope(),proof=proofFor('secret','contract',3,e);
 for(const downloaded of [false,true,undefined,'true']){
  const restored=restoreEvidenceBundle(JSON.parse(JSON.stringify({envelope:e,proof,downloaded})));
  assert.equal(restored.downloaded,downloaded===true);
  assert.equal(proofFor('secret','contract',3,restored.envelope),restored.proof);
 }
 assert.equal(restoreEvidenceBundle({envelope:e,proof},{imported:true}).downloaded,true);
 for(const broken of [null,{}, {envelope:{...e,transcripts:[null]}}, {envelope:e,proof:{bad:true}}])assert.throws(()=>restoreEvidenceBundle(broken));
});
test('successful EVM attestation can reconcile while unresolved submissions require a receipt check',()=>{
 const base={kind:'evm',label:'Collector attestation · EVM submission',contract:'0xABC',commitId:3};
 for(const status of ['EVM pending','EVM unknown'])assert.equal(attestationRecoveryState([{...base,status}],'0xabc',{commit_id:3}).blocked,true);
 assert.deepEqual(attestationRecoveryState([{...base,status:'EVM mined'}],'0xabc',{commit_id:3}),{blocked:false,reconcile:true});
 assert.equal(attestationRecoveryState([{...base,status:'EVM unknown'}],'0xabc',{commit_id:3,opened:true,evidence_digest:'attested'}).blocked,false);
 assert.equal(attestationRecoveryState([{...base,status:'EVM unknown'}],'other',{commit_id:3}).blocked,false);
 assert.equal(attestationRecoveryState([{...base,status:'EVM reverted'}],'0xabc',{commit_id:3}).blocked,false);
});
test('journal recovery links original EVM submission and recovered IC id without duplicate rows',()=>{
 const evm='0x'+'1'.repeat(64),ic='0x'+'2'.repeat(64);
 const row={kind:'evm',hash:evm,label:'Collector attestation · EVM submission',contract:'0xabc',commitId:3,status:'EVM mined',error:'uncertain'};
 let txs=recordAttestationResult([row],{transactionHash:ic,recovered:true},'0xabc',3);
 assert.equal(txs.length,1);assert.equal(txs[0].hash,ic);assert.equal(txs[0].evmTransactionHash,evm);assert.equal(txs[0].kind,'ic');assert.equal(txs[0].error,'');
 txs[0].status='FINALIZED';
 txs=recordAttestationResult(txs,{transactionHash:ic,recovered:true},'0xabc',3);
 assert.equal(txs.length,1);assert.equal(txs[0].status,'FINALIZED');assert.equal(txs[0].evmTransactionHash,evm);
 assert.deepEqual(recordAttestationResult(txs,{alreadyAttested:true},'0xabc',3),txs);
});

test('v3 plan binds profile while v2 canonical bytes exclude unrelated profile fields',async()=>{
 const v2=envelope(),before=canonicalPlan(v2);v2.profile_hash='1'.repeat(64);
 assert.equal(canonicalPlan(v2),before);
 const v3={...v2,version:'voirdire/3',transcripts:v2.transcripts.map(t=>({...t,finish_reason:'stop'}))};validateEnvelope(v3);
 const expected=JSON.stringify({claim_id:v3.claim_id,endpoint:v3.endpoint,nonce:v3.nonce,profile_hash:v3.profile_hash,transcripts:v3.transcripts.map(({probe_class,probe_id,sent})=>({probe_class,probe_id,sent})),version:'voirdire/3'});
 assert.equal(canonicalPlan(v3),expected);
 const digest=await digestPlan(v3);v3.profile_hash='2'.repeat(64);assert.notEqual(await digestPlan(v3),digest);
 for(const profile_hash of [undefined,'bad','A'.repeat(64)])assert.throws(()=>validateEnvelope({...v3,profile_hash}));
 const restored=restoreEvidenceBundle({envelope:v3,proof:'opaque',downloaded:true});assert.equal(restored.envelope.profile_hash,v3.profile_hash);
});
import {requireEnvelopeProtocol} from '../app/src/protocol.js';
test('saved plans cannot be reused against another protocol or frozen profile',()=>{
 const v2=envelope(),v3={...v2,version:'voirdire/3',profile_hash:'a'.repeat(64),transcripts:v2.transcripts.map(t=>({...t,finish_reason:'stop'}))};
 assert.equal(requireEnvelopeProtocol(v2,{version:'voirdire/2'}),v2);
 assert.equal(requireEnvelopeProtocol(v3,{version:'voirdire/3',profile_hash:v3.profile_hash}),v3);
 assert.throws(()=>requireEnvelopeProtocol(v2,{version:'voirdire/3',profile_hash:v3.profile_hash}));
 assert.throws(()=>requireEnvelopeProtocol(v3,{version:'voirdire/3',profile_hash:'b'.repeat(64)}));
});

import {profileRegistration,frozenProfileProbes,verifyPublicProfile,responseFinishNote} from '../app/src/protocol.js';
import {createHash} from 'node:crypto';
test('v3 approval binds exact public bytes, scope and all six corpus prompts',async()=>{
 const models={'gpt-class':'openai/gpt-4o-mini','llama-class':'meta-llama/llama-3.3-70b-instruct','mistral-class':'mistralai/mistral-small-3.2-24b-instruct'};
 const corpus=Array.from({length:6},(_,i)=>({probe_id:`p${i}`,class:'tokenizer_artifact',carrier:`prompt ${i}`,status:'active'}));
 const profile={probe_ids:corpus.map(p=>p.probe_id),supported_models:models,probe_classes:Object.fromEntries(corpus.map(p=>[p.probe_id,p.class])),probe_prompt_sha256:Object.fromEntries(corpus.map(p=>[p.probe_id,createHash('sha256').update(p.carrier).digest('hex')]))};
 const bytes=new TextEncoder().encode(JSON.stringify(profile));
 const protocol={version:'voirdire/3',profile_status:'APPROVED',profile_hash:createHash('sha256').update(bytes).digest('hex'),probe_ids:profile.probe_ids,supported_models:models,required_rounds:1};
 assert.deepEqual(await verifyPublicProfile(bytes,protocol,corpus),profile);
 await assert.rejects(verifyPublicProfile(bytes,{...protocol,profile_status:'UNVALIDATED_INTEGER_CANDIDATE'},corpus),/not approved/);
 await assert.rejects(verifyPublicProfile(new TextEncoder().encode(JSON.stringify(profile)+' '),protocol,corpus),/bytes/);
 await assert.rejects(verifyPublicProfile(bytes,protocol,corpus.map((p,i)=>i===0?{...p,carrier:'changed'}:p)),/prompt/);
 assert.deepEqual(profileRegistration(protocol,'gpt-class'),{agent:'openrouter:openai/gpt-4o-mini',model:'gpt-class',version:'openai/gpt-4o-mini',rounds:1});
 assert.deepEqual(profileRegistration(protocol,'llama-class','gpt-class'),{agent:'openrouter:openai/gpt-4o-mini',model:'llama-class',version:models['llama-class'],rounds:1});
 assert.throws(()=>profileRegistration(protocol,'gpt-class','unknown-family'),/collection target/);
 assert.throws(()=>profileRegistration(protocol,'unknown-family'));
 assert.deepEqual(frozenProfileProbes(protocol,[...corpus].reverse()).map(p=>p.probe_id),profile.probe_ids);
 assert.throws(()=>frozenProfileProbes(protocol,corpus,['p0']),/fresh probes/);
});
test('v3 preserves token-limit evidence and never binds future finish reasons into the plan',async()=>{
 const e={...envelope(),version:'voirdire/3',profile_hash:'a'.repeat(64)};
 assert.throws(()=>validateEnvelope(e),/finish reason/);
 e.transcripts[0].got='';validateEnvelope(e);
 const before=await digestPlan(e);e.transcripts[0].got='partial response';e.transcripts[0].finish_reason='length';
 validateEnvelope(e);assert.equal(await digestPlan(e),before);assert.match(responseFinishNote(e.transcripts[0]),/partial/);
 const restored=restoreEvidenceBundle({envelope:e,proof:'opaque'});assert.equal(restored.envelope.transcripts[0].finish_reason,'length');
 e.transcripts[0].finish_reason='content_filter';assert.throws(()=>validateEnvelope(e),/finish reason/);
});
test('ordinary wallets switch or add only the configured chain without requiring Snaps',async()=>{
 const chain={id:4221,name:'Bradbury',nativeCurrency:{name:'GEN',symbol:'GEN',decimals:18},rpcUrls:{default:{http:['https://example.invalid']}}};
 const calls=[];let active='0x1',added=false;
 const wallet={async request(r){calls.push(r);if(r.method==='eth_chainId')return active;if(r.method==='wallet_switchEthereumChain'){if(!added)throw Object.assign(new Error('unknown chain'),{code:4902});active=r.params[0].chainId;return null;}if(r.method==='wallet_addEthereumChain'){added=true;return null;}throw Error('unsupported wallet method');}};
 await ensureWalletChain(wallet,chain);assert.equal(active,'0x107d');assert.deepEqual(calls.map(c=>c.method),['eth_chainId','wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain','eth_chainId']);
 assert.equal(calls[2].params[0].chainId,'0x107d');
});
test('wallet rejection or unsuccessful network switch prevents a send',async()=>{
 const chain={id:4221};
 await assert.rejects(ensureWalletChain({request:async r=>{if(r.method==='eth_chainId')return '0x1';throw Object.assign(new Error('user rejected'),{code:4001});}},chain),/user rejected/);
 await assert.rejects(ensureWalletChain({request:async r=>r.method==='eth_chainId'?'0x1':null},chain),/No transaction was sent/);
});
