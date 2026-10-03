import { createClient, createAccount } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';
import { verifyMessage, keccak256 } from 'viem';
import { readFileSync } from 'node:fs';
import { digest, collectionMessage } from './evidence.mjs';

export class PublicError extends Error {}
export const safeError = error => error instanceof PublicError ? error.message : 'Collector request failed; no credentials are included in diagnostics. Retry or recover your saved evidence.';
export function boundedAccount(account, limits, onSigned) {
  limits = { maxNonce: String(limits.maxNonce ?? '').trim(), maxFeeWei: String(limits.maxFeeWei ?? '').trim() };
  if (!/^[0-9]+$/.test(limits.maxNonce || '') || !/^[0-9]+$/.test(limits.maxFeeWei || '') || BigInt(limits.maxNonce) <= 0n || BigInt(limits.maxFeeWei) <= 0n) {
    throw new PublicError('Collector sponsorship safety limits are not configured');
  }
  const ceiling = BigInt(limits.maxNonce), maxFee = BigInt(limits.maxFeeWei);
  return { ...account, signTransaction: async (transaction, options) => {
    const nonce = BigInt(transaction.nonce ?? -1);
    const estimatedGas = BigInt(transaction.gas ?? -1);
    const gas = (estimatedGas * 125n + 99n) / 100n;
    const gasPrice = BigInt(transaction.gasPrice ?? transaction.maxFeePerGas ?? -1);
    const value = BigInt(transaction.value ?? 0);
    if (nonce < 0n || nonce >= ceiling) throw new PublicError('Collector sponsorship allowance is exhausted; operator review is required');
    if (estimatedGas <= 0n || gasPrice < 0n || value !== 0n || gas * gasPrice > maxFee) throw new PublicError('Collector transaction exceeds its sponsorship fee limit');
    const serializedTransaction = await account.signTransaction({ ...transaction, gas }, options);
    // Public hash is recoverable even if SDK receipt polling/decoding fails.
    // Never log or return the signed bytes or signing key.
    if (onSigned) await onSigned({ nonce: nonce.toString(), evmTransactionHash: keccak256(serializedTransaction) }, serializedTransaction);
    return serializedTransaction;
  } };
}

export function setup() {
  if (!process.env.COLLECTOR_PRIVATE_KEY) throw new PublicError('Collector is not configured');
  const deployment = JSON.parse(readFileSync(new URL('../public/deployment.json', import.meta.url), 'utf8'));
  if (!deployment.contractAddress) throw new PublicError('Contract is not deployed');
  const sponsorship = { lastSigned: null };
  const account = boundedAccount(createAccount(process.env.COLLECTOR_PRIVATE_KEY), {
    maxNonce: process.env.COLLECTOR_MAX_NONCE,
    maxFeeWei: process.env.COLLECTOR_MAX_TX_FEE_WEI,
  }, async (signed, serializedTransaction) => {
    if (sponsorship.persistSigned) await sponsorship.persistSigned(serializedTransaction);
    sponsorship.lastSigned = signed;
    console.log(JSON.stringify({ event: 'collector_signed_evm_transaction', ...signed }));
  });
  const client = createClient({ chain: testnetBradbury, account });
  return { deployment, account, client, sponsorship, key: process.env.COLLECTOR_PRIVATE_KEY };
}
export async function validate(body, context) {
  const { commitId, envelope, signature } = body;
  if (!Number.isSafeInteger(commitId) || commitId < 0 || !envelope || envelope.version !== 'voirdire/2' ||
      !Number.isSafeInteger(envelope.claim_id) || envelope.claim_id < 0 || typeof envelope.nonce !== 'string' ||
      (envelope.endpoint !== undefined && typeof envelope.endpoint !== 'string') || !/^[a-f0-9]{16,64}$/i.test(envelope.nonce || '') ||
      !Array.isArray(envelope.transcripts) || envelope.transcripts.length < 2 || envelope.transcripts.length > 6) throw new PublicError('Invalid probe plan: use 2–6 probes, a nonnegative claim ID and a hexadecimal nonce');
  const corpus = JSON.parse(readFileSync(new URL('../chain-and-site/corpus/probes.json', import.meta.url), 'utf8'));
  const seen = new Set();
  for (const t of envelope.transcripts) {
    if (!t || typeof t !== 'object' || typeof t.probe_id !== 'string' || typeof t.probe_class !== 'string' || typeof t.sent !== 'string') throw new PublicError('Invalid transcript fields');
    const p = corpus.probes.find(p => p.probe_id === t.probe_id && p.status === 'active');
    if (!p || t.probe_class !== p.class || t.sent !== p.carrier || seen.has(t.probe_id)) throw new PublicError('Use unique active corpus probes with their original prompts');
    seen.add(t.probe_id);
  }
  if (new Set(envelope.transcripts.map(t => t.probe_class)).size < 2) throw new PublicError('At least two probe classes are required');
  const address = context.deployment.contractAddress;
  const read = (functionName, args) => context.client.readContract({ address, functionName, args, transactionHashVariant: 'latest-final' });
  const commitment = await read('get_commitment', [commitId]);
  const claim = await read('get_claim', [Number(commitment.claim_id)]);
  if (Number(commitment.claim_id) !== envelope.claim_id || claim.status !== 'OPEN' || commitment.opened ||
      Number(commitment.expires_at) <= Date.now()/1000 || claim.evidence_collector.toLowerCase() !== context.account.address.toLowerCase()) throw new PublicError('Commitment is unavailable or uses another collector');
  const planDigest = digest(envelope);
  if (commitment.digest !== planDigest) throw new PublicError('Plan does not match on-chain commitment');
  if (!await verifyMessage({ address: commitment.challenger, message: collectionMessage(address, commitId, planDigest), signature })) throw new PublicError('Challenger signature required');
  if (typeof claim.agent_id !== 'string' || !/^openrouter:[a-z0-9._-]+\/[a-zA-Z0-9._:-]+$/.test(claim.agent_id) || claim.agent_id === 'openrouter:openrouter/auto') throw new PublicError('This collector supports registered openrouter:model-id agents');
  if (envelope.endpoint !== claim.agent_id) throw new PublicError('Envelope endpoint must match registered agent');
  const today = new Date().toISOString().slice(0, 10);
  if (today < claim.valid_from || today > claim.valid_until) throw new PublicError('Claim is outside its validity dates');
  const burned = await read('burned_probes', [envelope.claim_id]);
  if (envelope.transcripts.some(t => burned.probe_ids.includes(t.probe_id))) throw new PublicError('Plan contains spent probes');
  return { commitment, claim, model: claim.agent_id.slice('openrouter:'.length) };
}
export function response(res, status, data) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(data);
}
export function bodyOf(req) {
  if (typeof req.body === 'string' && req.body.length > 150000) throw new PublicError('Request too large');
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { throw new PublicError('Invalid JSON request'); }
  if (!body || Array.isArray(body) || typeof body !== 'object' || JSON.stringify(body).length > 150000) throw new PublicError('Request too large');
  return body;
}
