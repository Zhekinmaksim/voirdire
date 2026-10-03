import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionResult, keccak256 } from 'viem';
import { testnetBradbury } from 'genlayer-js/chains';
import { canFinalize, finalize, auditedAccount } from '../scripts/chain.mjs';
const hash = `0x${'11'.repeat(32)}`;
function fake({ready=true,failEstimate=false,reverted=false}={}) {
  const calls=[],logs=[];
  const c={chain:testnetBradbury,account:{address:`0x${'22'.repeat(20)}`,signTransaction:async()=>{calls.push('sign');return '0xsigned'}},
    request:async({method})=>{
      calls.push(method);
      if(method==='eth_getBlockByNumber')return {timestamp:'0x64'};
      if(method==='eth_call')return encodeFunctionResult({abi:testnetBradbury.consensusDataContract.abi,functionName:'canFinalize',result:[ready,100n,ready?90n:200n]});
      if(method==='eth_estimateGas'){if(failEstimate)throw new Error('execution reverted');return '0x186a0'};
      if(method==='eth_gasPrice')return '0x1';
      throw new Error(method);
    },getTransaction:async()=>({statusName:calls.includes('send')?'FINALIZED':'ACCEPTED',resultName:'AGREE',txExecutionResultName:'FINISHED_WITH_RETURN'}),
    getCurrentNonce:async({block})=>{assert.equal(block,'pending');return '0x1'},
    sendRawTransaction:async()=>{calls.push('send');return `0x${'33'.repeat(32)}`}};
  return {c,calls,logs,options:{log:e=>logs.push(e),waitForReceipt:async()=>({status:reverted?'reverted':'success'})}};
}
test('readiness uses chain time and reports deadline without signing',async()=>{
  const f=fake({ready:false});const r=await canFinalize(f.c,hash,e=>f.logs.push(e));
  assert.equal(r.canFinalize,false);assert.equal(r.secondsRemaining,100n);assert.ok(!f.calls.includes('sign'));
});
test('early finalize and reverted gas estimate abort before signing',async()=>{
  for(const flags of [{ready:false},{failEstimate:true}]){
    const f=fake(flags);await assert.rejects(()=>finalize(f.c,hash,f.options));assert.ok(!f.calls.includes('sign'));assert.ok(!f.calls.includes('send'));
  }
});
test('successful guarded finalization records submission and both receipts',async()=>{
  const f=fake();const r=await finalize(f.c,hash,f.options);assert.equal(r.status,'FINALIZED');
  assert.equal(f.calls.filter(x=>x==='send').length,1);
  assert.ok(f.logs.some(x=>x.event==='finalization_evm_receipt'));assert.ok(f.logs.some(x=>x.event==='receipt'));
});
test('mined revert is reported without retry',async()=>{
  const f=fake({reverted:true});await assert.rejects(()=>finalize(f.c,hash,f.options),/No automatic retry/);
  assert.equal(f.calls.filter(x=>x==='send').length,1);
});
test('signing preserves a public recovery hash before broadcast without logging calldata or raw transaction',async()=>{
  const logs=[],raw='0x01020304';
  const account=auditedAccount(Object.freeze({address:'0xaccount',signTransaction:async()=>raw}),e=>logs.push(e));
  const signed=await account.signTransaction({to:'0xdestination',nonce:7,value:0n,gas:42n,gasPrice:3n,data:'private-input'});
  assert.equal(signed,raw);assert.equal(logs[0].evmHash,keccak256(raw));
  assert.equal(logs[0].nonce,7);assert.equal(logs[0].gas,42n);
  assert.ok(!Object.values(logs[0]).includes(raw));assert.ok(!Object.values(logs[0]).includes('private-input'));
});
test('explicit bounded gas cushion is logged exactly and rejects missing estimates before signing',async()=>{
  let signed;const logs=[];
  const base={signTransaction:async r=>{signed=r;return '0x0102'}};
  const account=auditedAccount(base,e=>logs.push(e),125);
  await account.signTransaction({gas:101n});assert.equal(signed.gas,127n);assert.equal(logs[0].gas,127n);
  signed=null;await assert.rejects(account.signTransaction({}),/positive gas estimate/);assert.equal(signed,null);
  assert.throws(()=>auditedAccount(base,()=>{},151));
});
