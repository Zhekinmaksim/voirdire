import { setup, validate, response, bodyOf, PublicError, safeError } from '../lib/collector.mjs';
import { digest, proofFor, validProof } from '../lib/evidence.mjs';
export const config = { maxDuration: 60 };
export function createHandler(deps = {}) {
  const getContext = deps.setup || setup;
  const check = deps.validate || validate;
  // Best-effort per-instance idempotency, not a durable distributed queue.
  // Serial submission lets SDK getCurrentNonce(default: pending) observe the
  // prior submitted transaction before assigning the next signer nonce.
  const submissions = new Map();
  let signerQueue = Promise.resolve();
  const failure = (error, context) => {
    const signed = context?.sponsorship?.lastSigned;
    if (!signed) return null;
    const reverted = String(error.message).startsWith('Transaction reverted: EVM tx ');
    return {
      error: reverted ? `Attestation EVM transaction reverted: ${signed.evmTransactionHash}. Inspect its receipt before retrying.` : `Attestation submission outcome is uncertain: ${signed.evmTransactionHash}. Inspect the EVM transaction before retrying.`,
      evmTransactionHash: signed.evmTransactionHash,
      outcome: reverted ? 'reverted' : 'unknown',
    };
  };
  return async function handler(req, res) {
    if (req.method !== 'POST') return response(res, 405, { error: 'POST required' });
    let context;
    try {
      const body = bodyOf(req);
      context = getContext();
      const { commitment } = await check(body, context);
      const address = context.deployment.contractAddress;
      if (!validProof(proofFor(context.key, address, body.commitId, body.envelope), body.proof)) throw new PublicError('Only evidence obtained by this collector may be attested');
      const evidenceDigest = digest(body.envelope, true);
      const jobKey = `${address.toLowerCase()}:${body.commitId}`;
      if (commitment.evidence_digest) {
        if (commitment.evidence_digest !== evidenceDigest) throw new PublicError('Different evidence already attested');
        submissions.delete(jobKey);
        return response(res, 200, { alreadyAttested: true, evidenceDigest });
      }
      for (const [key, job] of submissions) if (job.expiresAt < Date.now() / 1000) submissions.delete(key);
      let existing = submissions.get(jobKey);
      if (existing?.failure?.outcome === 'reverted') {
        // A new user request may retry only after the chain confirms that the
        // previous EVM transaction reverted. Null/success/lookup errors cannot
        // release this guard: successful EVM execution may still await IC state.
        try {
          const receipt = await context.client.request({ method: 'eth_getTransactionReceipt', params: [existing.failure.evmTransactionHash] });
          if (receipt?.status === '0x0' && receipt.transactionHash?.toLowerCase() === existing.failure.evmTransactionHash.toLowerCase()) {
            submissions.delete(jobKey);
            existing = null;
          }
        } catch { /* Preserve recovery state when RPC cannot confirm failure. */ }
      }
      if (existing) {
        if (existing.evidenceDigest !== evidenceDigest) throw new PublicError('Another evidence bundle is already being attested');
        if (existing.failure) return response(res, 502, existing.failure);
        try { return response(res, 200, await existing.promise); }
        catch (error) {
          if (existing.failure) return response(res, 502, existing.failure);
          throw error;
        }
      }
      // Refuse overload rather than evicting unfinalized jobs and risking repeats.
      if (submissions.size >= 256) throw new PublicError('Collector submission queue is full; retry after existing transactions settle');
      const promise = signerQueue.catch(() => {}).then(async () => {
        const pending = await context.client.readContract({ address, functionName: 'get_commitment', args: [body.commitId], transactionHashVariant: 'latest-nonfinal' });
        if (pending.evidence_digest) {
          if (pending.evidence_digest !== evidenceDigest) throw new PublicError('Different evidence already attested');
          return { alreadyAttested: true, awaitingFinality: true, evidenceDigest };
        }
        if (pending.opened) throw new PublicError('Commitment has already settled');
        const transactionHash = await context.client.writeContract({ address, functionName: 'attest_evidence', args: [body.commitId, evidenceDigest], value: 0n });
        console.log(JSON.stringify({ event: 'collector_attestation', commitId: body.commitId, evidenceDigest, transactionHash }));
        return { transactionHash, evidenceDigest };
      });
      submissions.set(jobKey, { evidenceDigest, promise, expiresAt: Number(commitment.expires_at) });
      signerQueue = promise;
      try { return response(res, 200, await promise); }
      catch (error) {
        const diagnostic = failure(error, context);
        if (diagnostic) {
          submissions.get(jobKey).failure = diagnostic;
          console.log(JSON.stringify({ event: 'collector_submission_failed', commitId: body.commitId, ...diagnostic }));
          return response(res, 502, diagnostic);
        }
        submissions.delete(jobKey);
        throw error;
      }
    } catch (error) { return response(res, 400, { error: safeError(error) }); }
  };
}
export default createHandler();
