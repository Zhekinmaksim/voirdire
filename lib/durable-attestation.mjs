import { randomUUID } from 'node:crypto';
import { parseEventLogs } from 'viem';
import { AttestationJournal, journalKey, attestationJobKey } from './attestation-journal.mjs';
import { blobJournalStore } from './blob-journal.mjs';
import { PublicError } from './collector.mjs';

const createdAbi = [{ type:'event', name:'CreatedTransaction', anonymous:false,
  inputs:[{name:'txId',type:'bytes32',indexed:true},{name:'txSlot',type:'uint256',indexed:false}] }];
export function receiptIcHash(client, receipt) {
  const logs = (receipt.logs || []).filter(log => log.address?.toLowerCase() === client.chain.consensusMainContract.address.toLowerCase());
  const primary = parseEventLogs({ abi:client.chain.consensusMainContract.abi, eventName:'NewTransaction', logs });
  const fallback = parseEventLogs({ abi:createdAbi, eventName:'CreatedTransaction', logs });
  const ids=[...new Set([...primary,...fallback].map(event=>event.args.txId.toLowerCase()))];
  if(ids.length>1)throw new Error('Ambiguous consensus transaction events');
  return ids[0] || null;
}
export async function submitDurably(context, body, evidenceDigest, { journal: suppliedJournal } = {}) {
  const {client,account,sponsorship}=context, address=context.deployment.contractAddress;
  const journal=suppliedJournal || new AttestationJournal({chainId:client.chain.id,signer:account.address,
    store:blobJournalStore(journalKey(client.chain.id,account.address)),leaseMs:60000});
  const jobKey=attestationJobKey(address,body.commitId);
  async function recover(key, job, exposeSigned = true) {
    const attempt=job.attempts.at(-1);
    if(attempt.state==='mined')return {transactionHash:attempt.icTransactionHash,evidenceDigest:job.evidenceDigest,recovered:true};
    if(exposeSigned)sponsorship.lastSigned={evmTransactionHash:attempt.transactionHash,nonce:String(attempt.nonce)};
    const receipt=await client.request({method:'eth_getTransactionReceipt',params:[attempt.transactionHash]});
    if(!receipt){
      await journal.rebroadcast(key,serializedTransaction=>client.sendRawTransaction({serializedTransaction}));
      throw new PublicError('Saved transaction rebroadcast; check its EVM receipt before retrying');
    }
    const icTransactionHash=receipt.status==='0x1'?receiptIcHash(client,receipt):null;
    await journal.recordReceipt(key,receipt,{icTransactionHash});
    if(receipt.status==='0x0')throw new Error(`Transaction reverted: EVM tx ${attempt.transactionHash}`);
    return {transactionHash:icTransactionHash,evidenceDigest:job.evidenceDigest,recovered:true};
  }
  const reservation=await journal.reserve({contract:address,commitId:body.commitId,evidenceDigest,owner:randomUUID()});
  if(reservation.kind==='existing')return recover(jobKey,reservation.job);
  if(reservation.kind==='busy'){
    const {value}=await journal.snapshot();
    const job=value.jobs[reservation.jobKey];
    if(job?.attempts.at(-1)?.state==='signed')await recover(reservation.jobKey,job,false);
    throw new PublicError('Collector is finishing another saved transaction; retry shortly');
  }
  const token=reservation.token;
  sponsorship.persistSigned=raw=>journal.persistSigned(token,raw);
  try {
    const pending=await client.readContract({address,functionName:'get_commitment',args:[body.commitId],transactionHashVariant:'latest-nonfinal'});
    if(pending.evidence_digest){
      if(pending.evidence_digest!==evidenceDigest)throw new PublicError('Different evidence already attested');
      await journal.releaseReserved(token);
      return {alreadyAttested:true,awaitingFinality:true,evidenceDigest};
    }
    if(pending.opened)throw new PublicError('Commitment has already settled');
    const transactionHash=await client.writeContract({address,functionName:'attest_evidence',args:[body.commitId,evidenceDigest],value:0n});
    const receipt=await client.request({method:'eth_getTransactionReceipt',params:[sponsorship.lastSigned.evmTransactionHash]});
    const recovered=receiptIcHash(client,receipt);
    if(recovered?.toLowerCase()!==transactionHash.toLowerCase())throw new Error('Consensus event mismatch');
    await journal.recordReceipt(jobKey,receipt,{icTransactionHash:recovered});
    console.log(JSON.stringify({event:'collector_durable_attestation',commitId:body.commitId,evidenceDigest,transactionHash}));
    return {transactionHash,evidenceDigest};
  } catch(error) {
    // releaseReserved rejects signed/lost reservations. Never clear unknown
    // signed state, even when the HTTP request or storage write failed.
    try { await journal.releaseReserved(token); } catch { /* retained for recovery */ }
    throw error;
  } finally { sponsorship.persistSigned=null; }
}
