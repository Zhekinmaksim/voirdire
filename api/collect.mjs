import { setup, validate, response, bodyOf, PublicError, safeError } from '../lib/collector.mjs';
import { canonical, digest, proofFor } from '../lib/evidence.mjs';
export const config = { maxDuration: 300 };
export function createHandler(deps = {}) {
  const getContext = deps.setup || setup;
  const check = deps.validate || validate;
  const request = deps.fetch || globalThis.fetch;
  return async function handler(req, res) {
  if (req.method !== 'POST') return response(res, 405, { error: 'POST required' });
  try {
    const body = bodyOf(req);
    if (typeof body.apiKey !== 'string' || body.apiKey.length < 20 || body.apiKey.length > 512) throw new PublicError('OpenRouter API key required');
    let maxPrice;
    if (body.priceLimits !== undefined) {
      if (!body.priceLimits || typeof body.priceLimits !== 'object' || Array.isArray(body.priceLimits) ||
          !['prompt', 'completion'].every(key => typeof body.priceLimits[key] === 'number' && Number.isFinite(body.priceLimits[key]) && body.priceLimits[key] > 0)) {
        throw new PublicError('priceLimits must contain positive finite prompt and completion prices in USD per million tokens');
      }
      maxPrice = { prompt: body.priceLimits.prompt, completion: body.priceLimits.completion };
    }
    const context = getContext();
    const { commitment, model } = await check(body, context);
    if (commitment.evidence_digest) throw new PublicError('Evidence already attested; recover your saved envelope instead of collecting again');
    const envelope = JSON.parse(canonical(body.envelope));
    if (envelope.transcripts.length > 6) throw new PublicError('This collector permits at most 6 probes per round');
    if (Number(commitment.expires_at) * 1000 - Date.now() < envelope.transcripts.length * 35000 + 30000) throw new PublicError('Not enough time remains in the commitment window to collect safely');
    // Fixed destination: no user-controlled URL or redirects can receive the key.
    for (const t of envelope.transcripts) {
      const upstream = await request('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35000),
        headers: { Authorization: `Bearer ${body.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 600, temperature: 1, messages: [{ role: 'user', content: t.sent }], provider: { allow_fallbacks: false, require_parameters: true, ...(maxPrice ? { max_price: maxPrice } : {}) } }),
      });
      if (!upstream.ok) throw new PublicError(`Model provider returned HTTP ${upstream.status}; no evidence was attested`);
      const data = await upstream.json();
      if (data.error || typeof data.model !== 'string' || !data.model || typeof data.id !== 'string' || !data.id) throw new PublicError('Provider response lacks required source metadata; no attestation');
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim() || text.length > 4096 || data.choices[0].finish_reason !== 'stop') throw new PublicError('Provider returned empty, oversized or truncated evidence; no attestation');
      t.got = text;
      t.observed_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      // Source metadata is retained for audit; canonical commitment ignores it.
      t.source = { requested_model: model, reported_model: data.model, provider: typeof data.provider === 'string' ? data.provider : null, generation_id: data.id, usage: data.usage || null, transport: 'https://openrouter.ai/api/v1/chat/completions' };
    }
    const evidenceDigest = digest(envelope, true);
    return response(res, 200, { envelope, evidenceDigest, proof: proofFor(context.key, context.deployment.contractAddress, body.commitId, envelope) });
  } catch (error) {
    // Never log request bodies or provider keys.
    return response(res, 400, { error: safeError(error) });
  }
}
}
export default createHandler();
