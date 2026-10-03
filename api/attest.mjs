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
  return async function handler(req, res) {
    if (req.method !== 'POST') return response(res, 405, { error: 'POST required' });
    try {
      const body = bodyOf(req), context = getContext();
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
      const existing = submissions.get(jobKey);
      if (existing) {
        if (existing.evidenceDigest !== evidenceDigest) throw new PublicError('Another evidence bundle is already being attested');
        return response(res, 200, await existing.promise);
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
      catch (error) { submissions.delete(jobKey); throw error; }
    } catch (error) { return response(res, 400, { error: safeError(error) }); }
  };
}
export default createHandler();
