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

import {trackWalletProvider} from '../app/src/wallet.js';
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
