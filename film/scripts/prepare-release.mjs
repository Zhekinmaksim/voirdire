// Generate the film's facts from the release verified by prepare_web.py.
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const film = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(film, '..');
const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const sha = path => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
const require = (condition, message) => {if (!condition) throw Error(message);};
const deployment = read('public/deployment.json');
const profile = read('public/profile.json');
const gate = read('public/research/confirmation-v3.json');
const confirmed = read('chain-and-site/calibration/confirmation-v3/release.json');
const plan = read('chain-and-site/calibration/candidates/int-v3/confirmation-plan.json');
const verification = read('public/release-verification.json');
require(deployment.protocolVersion === 'voirdire/3' && gate.gate === 'PASS', 'Expected approved v3');
require(sha('public/profile.json') === deployment.profileHash, 'Film profile hash mismatch');
require(sha('public/research/confirmation-v3.json') === confirmed.files_sha256['gate.json'], 'Film gate hash mismatch');
require(gate.manifest_sha256 === deployment.calibrationManifestHash, 'Film manifest mismatch');
require(verification.contract.toLowerCase() === deployment.contractAddress.toLowerCase() && verification.status === 'VERIFIED_ON_BRADBURY', 'Film controls belong to another deployment');
const labels = {'gpt-class':'GPT-4o mini', 'llama-class':'Llama 3.3 70B', 'mistral-class':'Mistral Small 3.2 24B'};
const families = Object.keys(labels).map(family => {
  const metric = gate.metrics[family], spec = plan.families[family];
  require(metric.correct + metric.abstain + metric.false_accusations === 100 && metric.false_accusations === 0, 'Unexpected confirmation counts');
  require(profile.supported_models[family] === spec.model, 'Model is outside the frozen profile');
  return {family, label:labels[family], model:spec.model, provider:spec.provider, tag:spec.tag, confusion:gate.confusion[family], ...metric};
});
require(gate.responses === 1800 && gate.rounds === 300 && gate.old_response_id_overlap === 0, 'Unexpected confirmation scope');
const controls = ['INCONSISTENT', 'CONSISTENT', 'INCONCLUSIVE'].map(verdict => {
  const control = verification.controls.find(c => c.result.verdict === verdict);
  const expectedLabels = {INCONSISTENT:'declared Llama, actual GPT', CONSISTENT:'truthful GPT, matched', INCONCLUSIVE:'truthful GPT, abstained'};
  require(control && control.result.settled, 'Missing live settlement control: ' + verdict);
  require(control.label === expectedLabels[verdict], 'Live control differs from the film story');
  require(control.transactions.every(t => t.observed_receipt.status === 'FINALIZED' && t.observed_receipt.consensus === 'AGREE' && t.observed_receipt.execution === 'FINISHED_WITH_RETURN'), 'Unfinalized live control');
  if (verdict === 'INCONSISTENT') require(control.result.stage_b1 === 'ADMISSIBLE' && control.result.stage_b2 === 'ADMISSIBLE' && control.result.claim_status === 'VOIDED', 'Divergence was not confirmed');
  if (verdict === 'CONSISTENT') require(control.result.confirmed_rounds === 1 && control.result.claim_status === 'CLOSED', 'Matching control was not confirmed');
  if (verdict === 'INCONCLUSIVE') require(control.result.confirmed_rounds === 0 && control.result.decision === 'ABSTAIN', 'Abstention was counted as a pass');
  return {verdict, label:control.label, claim_id:control.claim_id, round_id:control.round_id, ...control.result};
});
const withdrawal = verification.withdrawal;
require(withdrawal.actual_wallet_arrival_verified && withdrawal.status === 'FINALIZED' && withdrawal.consensus === 'AGREE' && withdrawal.execution === 'FINISHED_WITH_RETURN' && withdrawal.observed_wallet_balance_delta_wei === withdrawal.amount_wei && withdrawal.manual_finalization === false, 'Native withdrawal is not independently verified');
const amount = BigInt(withdrawal.amount_wei), unit = 10n ** 18n;
const fraction = (amount % unit).toString().padStart(18, '0').replace(/0+$/, '');
const probes = read('chain-and-site/corpus/probes.json').probes;
const snapshot = {
  schema:'voirdire-film-release/1', network:'GenLayer Bradbury testnet', site:'voirdire.pro',
  observed_at:verification.observed_at,
  observed_date:new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Tashkent',day:'numeric',month:'short',year:'numeric'}).format(new Date(verification.observed_at)),
  contract:deployment.contractAddress,
  profile_hash:deployment.profileHash, manifest_hash:deployment.calibrationManifestHash,
  gate_sha256:sha('public/research/confirmation-v3.json'), verification_sha256:sha('public/release-verification.json'),
  responses:gate.responses, rounds:gate.rounds, per_family_rounds:100, families,
  abstentions:families.reduce((n,f) => n + f.abstain, 0),
  false_accusations:families.reduce((n,f) => n + f.false_accusations, 0),
  false_accusation_upper95_percent:Math.max(...families.map(f => f.false_accusation_interval95[1])) * 100,
  generation_policy:profile.generation_policy,
  probes:profile.probe_ids.map(id => {
    const probe = probes.find(p => p.probe_id === id);
    require(probe && createHash('sha256').update(probe.carrier).digest('hex') === profile.probe_prompt_sha256[id], 'Film probe prompt mismatch');
    return {id, class:profile.probe_classes[id], carrier:probe.carrier};
  }),
  controls, withdrawal:{amount_wei:withdrawal.amount_wei, amount_gen:amount/unit+(fraction ? '.'+fraction : ''), transaction:withdrawal.transaction},
};
writeFileSync(resolve(film, 'src/release.json'), JSON.stringify(snapshot, null, 2)+'\n');
console.log('Film facts verified: 1,800 responses, three live outcomes, finalized testnet withdrawal.');
