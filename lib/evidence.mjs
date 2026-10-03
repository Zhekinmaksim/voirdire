import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
export const stable = value => JSON.stringify(sort(value));
function sort(v) {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]));
  return v;
}
export function canonical(env, evidence = false) {
  const core = { version: env.version, claim_id: env.claim_id, nonce: env.nonce,
    transcripts: env.transcripts.map(t => ({ probe_id: t.probe_id, probe_class: t.probe_class, sent: t.sent,
      ...(evidence ? { got: t.got, ...(env.version === 'voirdire/3' ? { finish_reason: t.finish_reason } : {}), ...(t.observed_at ? { observed_at: t.observed_at } : {}) } : {}) })) };
  if (env.endpoint) core.endpoint = env.endpoint;
  if (env.version === 'voirdire/3') core.profile_hash = env.profile_hash;
  return stable(core);
}
export const digest = (env, evidence = false) => createHash('sha256').update(canonical(env, evidence)).digest('hex');
export const collectionMessage = (address, commitId, plan) => `Voirdire collection\nChain: 4221\nContract: ${address.toLowerCase()}\nCommitment: ${commitId}\nPlan: ${plan}`;
export const proofFor = (key, address, commitId, env) => createHmac('sha256', key).update(`voirdire-collector-${env.version === 'voirdire/3' ? 'v3' : 'v2'}:${address.toLowerCase()}:${commitId}:${digest(env, true)}:${createHash('sha256').update(stable(env)).digest('hex')}`).digest('hex');
export function validProof(expected, received) {
  return typeof received === 'string' && /^[a-f0-9]{64}$/.test(received) && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
}
