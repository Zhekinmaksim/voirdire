export const encode = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
export function canonicalPlan(env) {
  const core = {claim_id: Number(env.claim_id)};
  if (env.endpoint) core.endpoint = String(env.endpoint);
  core.nonce = String(env.nonce);
  if (env.version === 'voirdire/3') core.profile_hash = String(env.profile_hash);
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
  if (!env || typeof env !== 'object' || !['voirdire/2','voirdire/3'].includes(env.version) || !Number.isSafeInteger(env.claim_id) || env.claim_id < 0 || !/^[\da-f]{16,64}$/i.test(env.nonce) || !Array.isArray(env.transcripts) || !env.transcripts.length) throw new Error('This is not a valid Voirdire envelope.');
  if (env.version === 'voirdire/3' && !/^[a-f0-9]{64}$/.test(env.profile_hash || '')) throw new Error('A v3 envelope must bind an exact profile hash.');
  for (const t of env.transcripts) if (!t || ![t.probe_id, t.probe_class, t.sent].every(v => typeof v === 'string' && v.length)) throw new Error('An envelope probe is incomplete.');
  if (env.version === 'voirdire/3' && env.transcripts.some(t => t.got && !['stop','length'].includes(t.finish_reason))) throw new Error('Collected v3 responses require the provider finish reason.');
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

// Read the complete saved bundle without rebuilding source metadata covered by HMAC.
export function restoreEvidenceBundle(saved, {imported = false} = {}) {
  if (!saved || typeof saved !== 'object') throw new Error('No saved evidence bundle.');
  const envelope = validateEnvelope(saved.envelope || saved);
  const proof = saved.proof ?? null;
  if (proof !== null && (typeof proof !== 'string' || !proof.length)) throw new Error('Invalid collector proof in saved evidence.');
  return {envelope, proof, downloaded: imported || saved.downloaded === true};
}

export function requireEnvelopeProtocol(envelope, protocol) {
  validateEnvelope(envelope);
  if (envelope.version !== protocol?.version || (envelope.version === 'voirdire/3' && envelope.profile_hash !== protocol.profile_hash)) throw new Error('Saved evidence belongs to a different protocol or profile. Restore the matching backup or prepare a new plan.');
  return envelope;
}

export function profileRegistration(protocol, family, targetFamily = family) {
  const model = protocol?.supported_models?.[family];
  if (protocol?.version !== 'voirdire/3' || !['gpt-class','llama-class','mistral-class'].includes(family) || typeof model !== 'string' || !model.includes('/')) throw new Error('Select an approved profile endpoint.');
  const target = protocol.supported_models[targetFamily];
  if (!['gpt-class','llama-class','mistral-class'].includes(targetFamily) || typeof target !== 'string' || !target.includes('/')) throw new Error('Select an approved collection target.');
  return {agent:`openrouter:${target}`, model:family, version:model, rounds:1};
}
export function frozenProfileProbes(protocol, corpus, burned = []) {
  const ids=protocol?.probe_ids;
  if (!Array.isArray(ids) || ids.length!==6 || new Set(ids).size!==6) throw new Error('The frozen profile must contain six unique probes.');
  const spent=new Set(burned);
  return ids.map(id=>{
    const matches=corpus.filter(p=>p.probe_id===id&&p.status==='active');
    if(matches.length!==1||spent.has(id))throw new Error('The frozen profile requires six fresh probes. This claim cannot reuse a spent profile.');
    return matches[0];
  });
}

const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export async function verifyPublicProfile(bytes, protocol, corpus) {
  if (protocol?.version !== 'voirdire/3' || protocol.profile_status !== 'APPROVED') throw new Error('The on-chain profile is not approved.');
  if (await sha256(bytes) !== protocol.profile_hash) throw new Error('Public profile bytes do not match the on-chain hash.');
  const profile=JSON.parse(new TextDecoder().decode(bytes));
  const ids=protocol.probe_ids;
  if (JSON.stringify(profile.probe_ids)!==JSON.stringify(ids)) throw new Error('Public and on-chain probe lists differ.');
  const families=['gpt-class','llama-class','mistral-class'];
  if (Object.keys(protocol.supported_models||{}).length!==3 || families.some(f=>profile.supported_models?.[f]!==protocol.supported_models?.[f] || typeof protocol.supported_models?.[f]!=='string') || Number(protocol.required_rounds)!==1) throw new Error('Unsupported profile scope.');
  const probes=frozenProfileProbes(protocol,corpus);
  for(const p of probes){
    if(profile.probe_classes?.[p.probe_id]!==p.class || await sha256(new TextEncoder().encode(p.carrier))!==profile.probe_prompt_sha256?.[p.probe_id])throw new Error('Corpus prompt or class differs from the frozen profile.');
  }
  return profile;
}
export function responseFinishNote(transcript) {
  const reason=transcript.finish_reason ?? transcript.source?.finish_reason;
  return reason==='length'?'Token limit reached: this response is partial.':reason==='stop'?'Provider finish reason: stop.':reason?`Provider finish reason: ${reason}.`:'';
}
