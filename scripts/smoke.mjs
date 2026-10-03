// Real Bradbury flow, one explicit phase per invocation. No fabricated responses.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { client, submit, json } from './chain.mjs';
import { digest, collectionMessage } from '../lib/evidence.mjs';
import { createHandler as collectHandler } from '../api/collect.mjs';
import attest from '../api/attest.mjs';

const config = JSON.parse(readFileSync('public/deployment.json'));
const statePath = process.env.SMOKE_STATE_FILE || 'runs/smoke.json';
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath)) : { contractAddress: config.contractAddress, costs: [], transactions: [] };
if(state.contractAddress!==config.contractAddress)throw new Error('Smoke state belongs to a different contract; select its matching state file');
const save = () => writeFileSync(statePath, json(state)+'\n', {mode:0o600});
const totalDebit = () => readdirSync('runs').filter(n=>/^smoke.*\.json$/.test(n)).reduce((sum,name)=>sum+(JSON.parse(readFileSync('runs/'+name)).costs||[]).reduce((a,b)=>a+b.debit,0),0);
const envValue = (file, name) => readFileSync(file,'utf8').split('\n').find(l=>l.startsWith(name+'='))?.slice(name.length+1).trim().replace(/^(['"])(.*)\1$/, '$2');
process.env.COLLECTOR_PRIVATE_KEY = envValue('.env.collector','COLLECTOR_PRIVATE_KEY');
const command = process.argv[2];
const c = await client(true);
const read = (functionName,args=[]) => c.readContract({address:config.contractAddress,functionName,args,transactionHashVariant:'latest-final'});
async function write(functionName,args=[],value=0n){
  const hash=await submit(c,{address:config.contractAddress,functionName,args,value});
  state.transactions.push({functionName,hash});save();
}
async function invoke(handler,body){
  let result,status;
  await handler({method:'POST',body},{setHeader(){},status(s){status=s;return this},json(v){result=v}});
  if(status!==200)throw new Error(result.error);
  return result;
}
try {
  if(command==='register'){
    if(state.transactions.some(t=>t.functionName==='register_claim'))throw new Error('Registration already submitted; recover its finalized claim instead');
    state.claimId=Number(await read('claim_count'));save();
    await write('register_claim',['openrouter:openai/gpt-4o-mini','gpt-class','openai/gpt-4o-mini','2026-10-03','2026-10-10',1000000000000n,1000000000000n,1,config.collectorAddress],3000000000000n);
  }else if(command==='commit'){
    if(state.transactions.some(t=>t.functionName==='commit'))throw new Error('Commitment already submitted');
    const claim=await read('get_claim',[state.claimId]);
    if(claim.vendor.toLowerCase()!==c.account.address.toLowerCase())throw new Error('Unexpected claim owner');
    const corpus=JSON.parse(readFileSync('public/corpus.json'));
    const ids=['tok-001','tok-002','ref-001','ref-002','stb-001','stb-002'];
    state.envelope={version:'voirdire/2',claim_id:state.claimId,endpoint:claim.agent_id,nonce:randomBytes(24).toString('hex'),transcripts:ids.map(id=>{const p=corpus.probes.find(p=>p.probe_id===id);return{probe_id:id,probe_class:p.class,sent:p.carrier,got:''}})};
    state.commitId=Number(await read('commitment_count'));save();
    await write('commit',[state.claimId,digest(state.envelope)],BigInt(claim.challenge_stake));
  }else if(command==='collect'){
    if(state.proof)throw new Error('Evidence already collected; reuse saved proof');
    const signature=await c.account.signMessage({message:collectionMessage(config.contractAddress,state.commitId,digest(state.envelope))});
    if(process.argv.includes('--remote')){
      if(state.envelope.endpoint!=='openrouter:openai/gpt-4o-mini')throw new Error('Unexpected billable model');
      const reserve=state.envelope.transcripts.length*0.05;
      if(totalDebit()+reserve>1)throw new Error('Global USD1 smoke budget exhausted');
      const index=state.costs.length;state.costs.push({debit:reserve,status:'reserved-hosted'});save();
      const response=await fetch('https://voirdire-mu.vercel.app/api/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({commitId:state.commitId,envelope:state.envelope,signature,apiKey:envValue('.env','OPENROUTER_API_KEY'),priceLimits:{prompt:0.15,completion:0.6}})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Hosted collection failed');
      const costs=result.envelope.transcripts.map(t=>Number(t.source?.usage?.cost));
      if(costs.every(v=>Number.isFinite(v)&&v>=0)&&costs.reduce((a,b)=>a+b,0)<=reserve)state.costs[index]={debit:costs.reduce((a,b)=>a+b,0),status:'reported-hosted'};
      Object.assign(state,result);save();console.log('Hosted evidence saved; global smoke debit USD',totalDebit());
      process.exit(0);
    }
    const handler=collectHandler({fetch:async(url,options)=>{
      const used=totalDebit();
      if(used+0.05>1)throw new Error('USD1 smoke budget exhausted');
      const body=JSON.parse(options.body);
      if(body.model!=='openai/gpt-4o-mini'||body.max_tokens>600)throw new Error('Unexpected billable model');
      body.provider={...body.provider,max_price:{prompt:0.15,completion:0.6}};
      state.costs.push({debit:0.05,status:'reserved'});const index=state.costs.length-1;save();
      const result=await fetch(url,{...options,body:JSON.stringify(body)});
      if(result.ok){const data=await result.clone().json();const cost=Number(data.usage?.cost);if(Number.isFinite(cost)&&cost>=0&&cost<=0.05){state.costs[index]={debit:cost,status:'reported',generationId:data.id};save();}}
      return result;
    }});
    const result=await invoke(handler,{commitId:state.commitId,envelope:state.envelope,apiKey:envValue('.env','OPENROUTER_API_KEY'),signature});
    Object.assign(state,result);save();console.log('Evidence saved; smoke budget debit USD',state.costs.reduce((a,b)=>a+b.debit,0));
  }else if(command==='attest'){
    const signature=await c.account.signMessage({message:collectionMessage(config.contractAddress,state.commitId,digest(state.envelope))});
    const body={commitId:state.commitId,envelope:state.envelope,proof:state.proof,signature};
    let result;
    if(process.argv.includes('--remote')){
      const response=await fetch('https://voirdire-mu.vercel.app/api/attest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      result=await response.json();
      (state.attestationAttempts??=[]).push({at:new Date().toISOString(),status:response.status,result});save();
      if(!response.ok)throw new Error((result.error||'Hosted collector failed')+(result.evmTransactionHash?' EVM: '+result.evmTransactionHash:''));
    }else result=await invoke(attest,body);
    state.transactions.push({functionName:'attest_evidence',hash:result.transactionHash});save();console.log(json(result));
  }else if(command==='reveal'){
    if(state.transactions.some(t=>t.functionName==='reveal'))throw new Error('Reveal already submitted');
    const cm=await read('get_commitment',[state.commitId]);
    if(cm.evidence_digest!==digest(state.envelope,true))throw new Error('Attestation is not finalized');
    state.roundId=Number(await read('round_count'));save();
    await write('reveal',[state.commitId,JSON.stringify(state.envelope)]);
  }else if(command==='confirm'){
    const round=await read('get_round',[state.roundId]);
    if(round.settled||round.verdict!=='INCONSISTENT')throw new Error('No divergent round needing confirmation');
    await write('confirm',[state.roundId]);
  }else if(command==='withdraw'){
    const balance=BigInt(await read('balance_of',[c.account.address]));
    if(!balance)throw new Error('No finalized withdrawal credit');
    await write('withdraw');
  }else if(command==='close'){
    await write('close_claim',[state.claimId]);
  }else if(command==='status'){
    const roundCount=Number(await read('round_count'));
    console.log(json({claim:state.claimId===undefined?null:await read('get_claim',[state.claimId]),commitment:state.commitId===undefined?null:await read('get_commitment',[state.commitId]),round:state.roundId===undefined||state.roundId>=roundCount?null:await read('get_round',[state.roundId]),credit:await read('balance_of',[c.account.address]),solvency:await read('solvency')}));
  }else throw new Error('Use register|commit|collect|attest|reveal|confirm|withdraw|close|status');
}catch(e){console.error(e.shortMessage||e.message);process.exitCode=1;}
