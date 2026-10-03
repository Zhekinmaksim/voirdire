// Run the SDK's exact deployment encoding and estimation, abort before signing.
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';
import { client, json } from './chain.mjs';
const local = await client(true);
let result;
const preview = createClient({chain:testnetBradbury, account:{...local.account, signTransaction:async tx=>{
  // Repeat estimation explicitly: the SDK's fallback gas must never authorize a deployment.
  const gas = BigInt(await local.request({method:'eth_estimateGas',params:[{from:local.account.address,to:tx.to,data:tx.data,value:'0x0'}]}));
  const block = await local.request({method:'eth_getBlockByNumber',params:['latest',false]});
  const balance = BigInt(await local.request({method:'eth_getBalance',params:[local.account.address,'pending']}));
  const percent=BigInt(process.env.GENLAYER_GAS_BUFFER_PERCENT||105);
  if(percent<100n||percent>150n)throw new Error('Invalid gas cushion');
  const buffered=(gas*percent+99n)/100n, fee=buffered*BigInt(tx.gasPrice);
  result={estimatedGas:gas,bufferedGas:buffered,blockGasLimit:BigInt(block.gasLimit),feeWei:fee,balanceWei:balance,
    feasible:buffered<=16777216n&&buffered<=BigInt(block.gasLimit)&&fee<=10000000000000000n&&balance>fee,
    note:'The local ceiling is 16,777,216; a 16.7M v3 transaction was accepted after the RPC rejected 19.7M. Block limit alone does not establish this limit.'};
  throw new Error('PREVIEW_ONLY');
}}});
try{await preview.deployContract({code:readFileSync(process.argv[2],'utf8'),args:[]});}
catch(error){if(!result)throw error;}
writeFileSync('runs/calibrated-contract/gas-preflight.json',json(result)+'\n');
console.log(json(result));if(!result.feasible)process.exitCode=2;
