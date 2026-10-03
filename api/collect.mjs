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
    const { commitment, model, routing, generationPolicy, responseProvider } = await check(body, context);
    if (commitment.evidence_digest) throw new PublicError('Evidence already attested; recover your saved envelope instead of collecting again');
    const envelope = JSON.parse(canonical(body.envelope));
    const policy = generationPolicy || { max_tokens: 600, temperature: 1, accepted_finish_reasons: ['stop'], max_response_chars: 4096 };
    const provider = routing ? { ...routing, ...(maxPrice ? {max_price: {
      prompt: Math.min(routing.max_price.prompt, maxPrice.prompt),
      completion: Math.min(routing.max_price.completion, maxPrice.completion),
    }} : {}) } : { allow_fallbacks: false, require_parameters: true, ...(maxPrice ? { max_price: maxPrice } : {}) };
    if (envelope.transcripts.length > 6) throw new PublicError('This collector permits at most 6 probes per round');
    if (Number(commitment.expires_at) * 1000 - Date.now() < envelope.transcripts.length * 35000 + 30000) throw new PublicError('Not enough time remains in the commitment window to collect safely');
    // Fixed destination: no user-controlled URL or redirects can receive the key.
    for (const t of envelope.transcripts) {
      const upstream = await request('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35000),
        headers: { Authorization: `Bearer ${body.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: policy.max_tokens, temperature: policy.temperature, messages: [{ role: 'user', content: t.sent }], provider }),
      });
      if (!upstream.ok) throw new PublicError(`Model provider returned HTTP ${upstream.status}; no evidence was attested`);
      const data = await upstream.json();
      if (data.error || typeof data.model !== 'string' || !data.model || typeof data.id !== 'string' || !data.id) throw new PublicError('Provider response lacks required source metadata; no attestation');
      const text = data.choices?.[0]?.message?.content;
      const finishReason = data.choices?.[0]?.finish_reason;
      if (routing && (data.model !== model || data.provider !== responseProvider)) throw new PublicError('Provider response differs from the calibrated route; no attestation');
      if (typeof text !== 'string' || !text.trim() || Array.from(text).length > policy.max_response_chars || !policy.accepted_finish_reasons.includes(finishReason)) throw new PublicError('Provider returned evidence outside the generation policy; no attestation');
      t.got = text;
      if (envelope.version === 'voirdire/3') t.finish_reason = finishReason;
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
