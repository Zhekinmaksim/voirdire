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
