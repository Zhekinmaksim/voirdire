import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256 } from 'viem';
import { AttestationJournal, JournalConflict, MAX_JOURNAL_BYTES, attestationJobKey, journalKey } from '../lib/attestation-journal.mjs';
const signer = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const contract = `0x${'22'.repeat(20)}`, digest = '33'.repeat(32), icHash = `0x${'44'.repeat(32)}`;
const jobKey = attestationJobKey(contract, 0);
function store() {
  let value = null, etag = null, n = 0;
  return { read: async () => value === null ? null : structuredClone({ value, etag }),
    compareAndSwap: async (expected, next) => { if (expected !== etag) throw new JournalConflict(); value = structuredClone(next); etag = String(++n); },
    inspect: () => structuredClone(value) };
}
function fixture() {
  const storage = store(); let time = 100;
  const make = () => new AttestationJournal({ store: storage, chainId: 61999, signer: signer.address, now: () => time, leaseMs: 100 });
  return { storage, a: make(), b: make(), advance: () => { time += 101; } };
}
const reservation = (journal, overrides = {}) => journal.reserve({ contract, commitId: 0, evidenceDigest: digest, owner: 'owner-00000000000001', ...overrides });
const raw = (nonce = 0, account = signer, chainId = 61999) => account.signTransaction({ chainId, type: 'legacy', nonce, gas: 100000n, gasPrice: 1n, to: contract, value: 0n, data: '0x1234' });
const receipt = (rawTx, status = '0x1') => ({ transactionHash: keccak256(rawTx), status, blockHash: `0x${'55'.repeat(32)}`, blockNumber: '0x42' });

test('two instances: one reservation; new deployment shares signer lock', async () => {
  const { a, b } = fixture();
  const results = await Promise.all([reservation(a), reservation(b, { contract: `0x${'66'.repeat(20)}`, owner: 'owner-00000000000002' })]);
  assert.deepEqual(results.map(x => x.kind).sort(), ['busy', 'reserved']);
  assert.equal(a.key, b.key); assert.notEqual(journalKey(61999, signer.address), journalKey(61998, signer.address));
});
test('expired owner cannot persist signature or release a replacement lease', async () => {
  const { a, b, advance } = fixture(); const old = await reservation(a); advance();
  const next = await reservation(b, { owner: 'owner-00000000000002' });
  assert.equal(next.kind, 'reserved');
  await assert.rejects(a.persistSigned(old.token, await raw()), /owner lost/);
  await assert.rejects(a.releaseReserved(old.token), /owner lost/);
  await b.persistSigned(next.token, await raw());
});
test('expired lease cannot sign even before another owner takes over', async () => {
  const { a, advance } = fixture(); const lease = await reservation(a); advance();
  await assert.rejects(a.persistSigned(lease.token, await raw()), /expired/);
});
test('signed unknown never expires; reboot returns existing job and blocks other job', async () => {
  const { a, b, advance, storage } = fixture(); const lease = await reservation(a);
  const tx = await raw(); await a.persistSigned(lease.token, tx); advance(); advance();
  assert.equal((await reservation(b)).kind, 'existing');
  assert.equal((await reservation(b, { commitId: 1 })).kind, 'busy');
  assert.equal(storage.inspect().jobs[jobKey].attempts[0].rawTransaction, tx);
});
test('broadcast only stored bytes and repeats identical signed transaction after lost response', async () => {
  const { a, b } = fixture(); const lease = await reservation(a); const tx = await raw();
  await assert.rejects(a.rebroadcast(jobKey, () => assert.fail()), /No signed/);
  await a.persistSigned(lease.token, tx); const calls = [];
  await assert.rejects(a.rebroadcast(jobKey, async bytes => { calls.push(bytes); throw new Error('connection lost'); }), /connection lost/);
  await b.rebroadcast(jobKey, async bytes => { calls.push(bytes); return keccak256(bytes); });
  assert.deepEqual(calls, [tx, tx]);
});
test('ambiguous CAS write never returns signature permission; durable record recovers', async () => {
  const f = fixture(); const lease = await reservation(f.a); const tx = await raw();
  const original = f.storage.compareAndSwap;
  f.storage.compareAndSwap = async (...args) => { await original(...args); throw new Error('unknown storage outcome'); };
  let allowedToBroadcast = false;
  await assert.rejects(async () => { await f.a.persistSigned(lease.token, tx); allowedToBroadcast = true; }, /unknown storage/);
  assert.equal(allowedToBroadcast, false);
  assert.equal((await reservation(f.b)).kind, 'existing');
});
test('unavailable storage aborts without CAS retry; conflicts capped at three', async () => {
  const f = fixture(); let calls = 0;
  f.storage.compareAndSwap = async () => { calls++; throw new Error('unavailable'); };
  await assert.rejects(reservation(f.a), /unavailable/); assert.equal(calls, 1);
  calls = 0; f.storage.compareAndSwap = async () => { calls++; throw new JournalConflict(); };
  await assert.rejects(reservation(f.a), /retry limit/); assert.equal(calls, 3);
});
test('success receipt releases signer but permanent job dedup survives nonfinal lag', async () => {
  const { a, b } = fixture(); const lease = await reservation(a); const tx = await raw(); await a.persistSigned(lease.token, tx);
  await a.recordReceipt(jobKey, receipt(tx), { icTransactionHash: icHash });
  assert.equal((await reservation(b)).kind, 'existing');
  assert.equal((await reservation(b, { commitId: 1 })).kind, 'reserved');
  await a.recordIcResult(jobKey, icHash, 'finalized');
  await assert.rejects(a.recordIcResult(jobKey, icHash, 'failed'), /Terminal/);
});
test('null, foreign receipt and missing IC event cannot release signed slot', async () => {
  const { a, b } = fixture(); const lease = await reservation(a); const tx = await raw(); await a.persistSigned(lease.token, tx);
  await assert.rejects(a.recordReceipt(jobKey, null));
  await assert.rejects(a.recordReceipt(jobKey, { ...receipt(tx, '0x0'), transactionHash: icHash }), /does not match/);
  await assert.rejects(a.recordReceipt(jobKey, receipt(tx)), /requires recovered IC/);
  assert.equal((await reservation(b, { commitId: 1 })).kind, 'busy');
});
test('only matching mined revert permits fresh nonce retry and preserves prior attempt', async () => {
  const { a, storage } = fixture(); const lease = await reservation(a); const tx = await raw(); await a.persistSigned(lease.token, tx);
  await a.recordReceipt(jobKey, receipt(tx, '0x0'));
  const retry = await reservation(a); assert.equal(retry.kind, 'reserved');
  await assert.rejects(a.persistSigned(retry.token, tx), /Nonce already/);
  await a.persistSigned(retry.token, await raw(1));
  assert.deepEqual(storage.inspect().jobs[jobKey].attempts.map(x => x.state), ['reverted', 'signed']);
});
test('evidence digest cannot change after abandoned or reverted attempt', async () => {
  const { a } = fixture(); const lease = await reservation(a); await a.releaseReserved(lease.token);
  await assert.rejects(reservation(a, { evidenceDigest: '77'.repeat(32) }), /Different evidence/);
});
test('signature binds chain and signer before becoming durable', async () => {
  const { a } = fixture(); const lease = await reservation(a);
  await assert.rejects(a.persistSigned(lease.token, await raw(0, signer, 1)), /identity mismatch/);
  await assert.rejects(a.persistSigned(lease.token, await raw(0, privateKeyToAccount(`0x${'88'.repeat(32)}`))), /identity mismatch/);
});
test('journal size cap and identity mismatch fail closed', async () => {
  const f = fixture(); const lease = await reservation(f.a); await f.a.releaseReserved(lease.token);
  const state = await f.storage.read(); state.value.padding = 'x'.repeat(MAX_JOURNAL_BYTES);
  await f.storage.compareAndSwap(state.etag, state.value);
  await assert.rejects(reservation(f.a), /capacity/);
  const g = fixture(); await reservation(g.a); const wrong = new AttestationJournal({ store: g.storage, chainId: 1, signer: signer.address });
  await assert.rejects(wrong.snapshot(), /identity/);
});
test('unexpected broadcast hash and changed receipt retain fail-closed history', async () => {
  const { a } = fixture(); const lease = await reservation(a); const tx = await raw(); await a.persistSigned(lease.token, tx);
  await assert.rejects(a.rebroadcast(jobKey, async () => icHash), /hash mismatch/);
  await a.recordReceipt(jobKey, receipt(tx), { icTransactionHash: icHash });
  await assert.rejects(a.recordReceipt(jobKey, receipt(tx, '0x0')), /Receipt changed/);
});
test('size overflow aborts before CAS rather than discarding signed history', async () => {
  const f = fixture(); const lease = await reservation(f.a); await f.a.releaseReserved(lease.token);
  const snap = await f.storage.read();
  const before = Buffer.byteLength(JSON.stringify(snap.value));
  snap.value.padding = 'x'.repeat(MAX_JOURNAL_BYTES - before - 30);
  await f.storage.compareAndSwap(snap.etag, snap.value);
  const stable = f.storage.inspect();
  await assert.rejects(reservation(f.a, { commitId: 1 }), /capacity/);
  assert.deepEqual(f.storage.inspect(), stable);
});
