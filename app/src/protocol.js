export const encode = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
export function canonicalPlan(env) {
  const core = {claim_id: Number(env.claim_id)};
  if (env.endpoint) core.endpoint = String(env.endpoint);
  core.nonce = String(env.nonce);
  core.transcripts = env.transcripts.map(t => ({probe_class: String(t.probe_class), probe_id: String(t.probe_id), sent: String(t.sent)}));
  core.version = String(env.version);
  return JSON.stringify(core);
}
export async function digestPlan(env) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPlan(env)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export function newNonce() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); }
export function validateEnvelope(env) {
  if (env.version !== 'voirdire/2' || !Number.isSafeInteger(env.claim_id) || env.claim_id < 0 || !/^[\da-f]{16,64}$/i.test(env.nonce) || !Array.isArray(env.transcripts) || !env.transcripts.length) throw new Error('This is not a valid Voirdire v2 envelope.');
  for (const t of env.transcripts) if (![t.probe_id, t.probe_class, t.sent].every(v => typeof v === 'string' && v.length)) throw new Error('An envelope probe is incomplete.');
  return env;
}

export function corpusRoundCapacity(probes) {
  const classes=['tokenizer_artifact','refusal_shape','repeat_stability'];
  const seen=new Set();
  const counts=Object.fromEntries(classes.map(name=>[name,0]));
  for(const probe of Array.isArray(probes)?probes:[]) {
    if(probe?.status!=='active'||!classes.includes(probe.class)||typeof probe.probe_id!=='string'||!probe.probe_id||seen.has(probe.probe_id)||typeof probe.carrier!=='string'||!probe.carrier)continue;
    seen.add(probe.probe_id);counts[probe.class]++;
  }
  // A prepared round consumes two distinct probes in each of three classes.
  return Math.min(...classes.map(name=>Math.floor(counts[name]/2)));
}
