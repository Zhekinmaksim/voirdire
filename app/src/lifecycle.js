// Concurrent contract reads can briefly see different finalized snapshots.
// Keep the claim readable when a newly counted round is not queryable yet.
export async function loadClaimView(read, id) {
  const claim = await read('get_claim', [id]);
  const results = await Promise.allSettled([
    read('report', [id]), read('burned_probes', [id]), read('round_count'),
  ]);
  const warnings = [];
  const report = results[0].status === 'fulfilled' ? results[0].value : {classes:[]};
  if (results[0].status !== 'fulfilled') warnings.push('Class readings are temporarily unavailable.');
  const burned = results[1].status === 'fulfilled' ? results[1].value : null;
  if (!burned) warnings.push('Spent probes could not be verified. Preparing a new examination is disabled until refresh succeeds.');
  const count = results[2].status === 'fulfilled' ? Number(results[2].value) : 0;
  if (count > 100) warnings.push('This view searches only the latest 100 rounds across the contract. Older rounds remain available through the contract API.');
  if (results[2].status !== 'fulfilled') warnings.push('Round history is temporarily unavailable.');
  const outcomes = await Promise.allSettled(Array.from({length:Math.min(count,100)},(_,i)=>read('get_round',[count-i-1])));
  if (outcomes.some(r=>r.status==='rejected')) warnings.push('Some rounds are still unavailable from the latest-final snapshot. Refresh after their transaction finalizes.');
  const rounds = outcomes.filter(r=>r.status==='fulfilled').map(r=>r.value).filter(r=>Number(r.claim_id)===id);
  await Promise.all(rounds.filter(r=>!r.settled).map(async r=>{
    try { const cm=await read('get_commitment',[Number(r.commit_id)]); r.expires_at=Number(cm.expires_at)+7*86400; }
    catch { r.expires_at=null; warnings.push(`Round #${r.round_id}: expiry time is temporarily unavailable.`); }
  }));
  return {claim,report,burned,rounds,warnings};
}
export function receiptSummary(receipt) {
  if (!receipt) return {status:'Pending', detail:'No network receipt is available yet.'};
  const status=String(receipt.statusName ?? receipt.status ?? 'Unknown');
  const execution=receipt.txExecutionResultName;
  const detail=status==='FINALIZED'
    ? `Network lifecycle finalized. Execution result: ${execution || 'not reported; inspect the receipt'}.`
    : `Network lifecycle: ${status}. ${execution ? `Execution result: ${execution}. ` : ''}Submission or a readable state does not mean final settlement.`;
  return {status,detail};
}

export function evmReceiptSummary(receipt) {
  if (!receipt) return {status:'EVM pending', detail:'No EVM receipt yet. Do not resubmit: the original transaction may still be mined. Your saved evidence and proof remain available.'};
  const status=receipt.status;
  if (status==='0x0'||status===0||status===0n||status==='reverted') return {status:'EVM reverted', detail:'The EVM transaction reverted. No successful Intelligent Contract submission is established. Keep the saved evidence and inspect the failure before retrying.'};
  if (status==='0x1'||status===1||status===1n||status==='success') return {status:'EVM mined', detail:'EVM execution succeeded. This does not mean the Intelligent Contract transaction is settled. Recover the commitment and verify its attestation before proceeding; do not blindly resubmit.'};
  return {status:'EVM unknown', detail:'The EVM receipt has no recognized execution status. Keep the saved evidence and do not resubmit until the original transaction is resolved.'};
}
export function attestationFailureRecord(result, contract, commitId, time=new Date().toISOString()) {
  if (!/^0x[\da-f]{64}$/i.test(result?.evmTransactionHash||'')) return null;
  return {kind:'evm',hash:result.evmTransactionHash,label:'Collector attestation · EVM submission',contract,commitId,time,
    status:result.outcome==='reverted'?'EVM reverted':'EVM unknown',
    error:typeof result.error==='string'?result.error:'Collector submission could not be confirmed.',
    detail:'This hash tracks the EVM submission, not an Intelligent Contract transaction ID. Keep the saved evidence and proof. Check status before any retry.'};
}

export function roundActions(round, protocol) {
  const unsettled = !round.settled;
  return {
    judge: unsettled && round.verdict === 'PENDING' && protocol?.evidence_publication === 'separate-from-judging',
    confirm: unsettled && round.verdict === 'INCONSISTENT' && round.stage_b1 === 'ADMISSIBLE' && round.stage_b2 === 'PENDING',
    recover: unsettled,
  };
}

export function attestationRecoveryState(txs, contract, commitment) {
  const rows = txs.filter(t => t.kind === 'evm' && t.label?.startsWith('Collector attestation') &&
    t.contract?.toLowerCase() === contract?.toLowerCase() && t.commitId === Number(commitment?.commit_id));
  const unresolved = rows.some(t => !['EVM mined','EVM reverted'].includes(t.status));
  return {blocked: unresolved && !commitment?.evidence_digest,
    reconcile: !!commitment?.evidence_digest || rows.some(t => t.status === 'EVM mined')};
}
export function recordAttestationResult(txs, result, contract, commitId) {
  if (!/^0x[\da-f]{64}$/i.test(result.transactionHash || '')) return txs;
  const matches = t => t.contract?.toLowerCase() === contract.toLowerCase() && t.commitId === commitId && t.label?.startsWith('Collector attestation');
  const prior = txs.find(t => matches(t) && t.kind === 'evm' && t.status !== 'EVM reverted');
  const existing = txs.find(t => t.hash?.toLowerCase() === result.transactionHash.toLowerCase());
  const row = existing || prior || {time:new Date().toISOString()};
  const evmTransactionHash = prior?.hash || row.evmTransactionHash;
  Object.assign(row,{kind:'ic',hash:result.transactionHash,contract,commitId,label:'Collector attestation',
    ...(evmTransactionHash?{evmTransactionHash}:{}), error:''});
  if (!existing) Object.assign(row,{status:'Submitted',detail:'Intelligent Contract ID recovered. Check its receipt; recovery does not mean final settlement.'});
  return [...txs.filter(t => t !== row && t !== prior),row];
}
