import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeEventTopics, encodeAbiParameters, keccak256 } from 'viem';
import { testnetBradbury } from 'genlayer-js/chains';
import { AttestationJournal, JournalConflict, attestationJobKey } from '../lib/attestation-journal.mjs';
import { boundedAccount } from '../lib/collector.mjs';
import { submitDurably, receiptIcHash } from '../lib/durable-attestation.mjs';
const signer = privateKeyToAccount(`0x${'11'.repeat(32)}`), contract = `0x${'22'.repeat(20)}`;
const evidenceDigest = '33'.repeat(32), icHash = `0x${'44'.repeat(32)}`;
const jobKey = attestationJobKey(contract, 0);
function store() {
  let current = null, generation = 0;
  return { read: async () => structuredClone(current), compareAndSwap: async (etag, value) => {
    if (etag !== (current?.etag ?? null)) throw new JournalConflict();
    current = { value: structuredClone(value), etag: String(++generation) };
  } };
}
const event = (address = testnetBradbury.consensusMainContract.address, txId = icHash) => ({ address, data: '0x', topics: encodeEventTopics({ abi: testnetBradbury.consensusMainContract.abi, eventName: 'NewTransaction', args: { txId, recipient: contract, activator: signer.address } }) });
const receipt = (raw, logs = [event()], status = '0x1') => ({ transactionHash: keccak256(raw), blockHash: `0x${'55'.repeat(32)}`, blockNumber: '0x5', status, logs });
function fixture(shared = store()) {
  const sponsorship = { lastSigned: null };
  const sent = [], writes = [];
  const account = boundedAccount(signer, { maxNonce: 21, maxFeeWei: '10000000000000000' }, async (signed, raw) => {
    if (!sponsorship.persistSigned) throw new Error('Durable hook missing');
    await sponsorship.persistSigned(raw);
    sponsorship.lastSigned = signed;
  });
  const client = { chain: testnetBradbury,
    readContract: async () => ({ evidence_digest: '', opened: false }),
    request: async request => { assert.equal(request.method, 'eth_getTransactionReceipt'); return sent.length ? receipt(sent.at(-1)) : null; },
    sendRawTransaction: async ({ serializedTransaction }) => { sent.push(serializedTransaction); return keccak256(serializedTransaction); },
    writeContract: async request => {
      writes.push(request);
      const raw = await account.signTransaction({ chainId: testnetBradbury.id, type: 'legacy', nonce: 0, gas: 100000n, gasPrice: 1n, to: testnetBradbury.consensusMainContract.address, value: 0n, data: '0x1234' });
      await client.sendRawTransaction({ serializedTransaction: raw });
      return icHash;
    } };
  const context = { client, account, sponsorship, deployment: { contractAddress: contract } };
  const journal = new AttestationJournal({ store: shared, chainId: client.chain.id, signer: account.address });
  return { shared, context, journal, sent, writes };
}
const submit = (f, commitId = 0) => submitDurably(f.context, { commitId }, evidenceDigest, { journal: f.journal });
test('conflicting transaction IDs from the authentic consensus emitter fail closed',()=>{
  assert.throws(()=>receiptIcHash({chain:testnetBradbury},{logs:[event(),event(undefined,`0x${'66'.repeat(32)}`)]}),/Ambiguous/);
});

test('bounded signing callback is awaited before raw bytes can reach broadcast', async () => {
  let resolve, entered; const gate = new Promise(r => { resolve = r; }); const callbackEntered = new Promise(r => { entered = r; }); let returned = false;
  const account = boundedAccount(signer, { maxNonce: 21, maxFeeWei: '10000000000000000' }, async () => { entered(); return gate; });
  const pending = account.signTransaction({ chainId: testnetBradbury.id, type: 'legacy', nonce: 0, gas: 100000n, gasPrice: 1n, to: contract, value: 0n }).then(() => { returned = true; });
  await callbackEntered; await new Promise(r => setImmediate(r)); assert.equal(returned, false);
  resolve(); await pending; assert.equal(returned, true);
});
test('signature persisted before SDK send; receipt retains permanent job dedup', async () => {
  const f = fixture(); const original = f.context.client.sendRawTransaction;
  f.context.client.sendRawTransaction = async request => {
    const { value } = await f.shared.read();
    assert.equal(value.jobs[jobKey].attempts.at(-1).rawTransaction, request.serializedTransaction);
    return original(request);
  };
  assert.equal((await submit(f)).transactionHash, icHash);
  const restarted = fixture(f.shared);
  assert.equal((await submit(restarted)).transactionHash, icHash);
  assert.equal(restarted.writes.length, 0); assert.equal(restarted.sent.length, 0);
});
test('ambiguous committed CAS prevents SDK broadcast and restart recovers stored identical bytes', async () => {
  const f = fixture(); const original = f.shared.compareAndSwap;
  f.shared.compareAndSwap = async (etag, value) => {
    await original(etag, value);
    if (value.jobs[jobKey]?.attempts.at(-1).state === 'signed') throw new Error('ambiguous persistence outcome');
  };
  await assert.rejects(submit(f), /ambiguous persistence/);
  assert.equal(f.sent.length, 0); assert.equal(f.context.sponsorship.lastSigned, null);
  const raw = (await f.shared.read()).value.jobs[jobKey].attempts.at(-1).rawTransaction;
  f.shared.compareAndSwap = original;
  const restarted = fixture(f.shared); restarted.context.client.request = async () => null;
  await assert.rejects(submit(restarted), /rebroadcast/);
  assert.deepEqual(restarted.sent, [raw]); assert.equal(restarted.writes.length, 0);
});
test('RPC broadcast succeeded but response lost: new instance does not sign another nonce', async () => {
  const f = fixture(); const original = f.context.client.sendRawTransaction;
  f.context.client.sendRawTransaction = async request => { await original(request); throw new Error('response lost'); };
  await assert.rejects(submit(f), /response lost/);
  const restarted = fixture(f.shared); restarted.context.client.request = async () => receipt(f.sent[0]);
  assert.equal((await submit(restarted)).transactionHash, icHash);
  assert.equal(restarted.writes.length, 0); assert.equal(restarted.sent.length, 0);
});
test('consensus event extraction rejects spoofed emitter and accepts expected emitter', () => {
  const f = fixture();
  assert.equal(receiptIcHash(f.context.client, { logs: [event(contract)] }), null);
  assert.equal(receiptIcHash(f.context.client, { logs: [event(contract, `0x${'66'.repeat(32)}`), event()] }), icHash);
  const abi = [{ type: 'event', name: 'CreatedTransaction', inputs: [{ name: 'txId', type: 'bytes32', indexed: true }, { name: 'txSlot', type: 'uint256', indexed: false }] }];
  const log = { address: testnetBradbury.consensusMainContract.address, topics: encodeEventTopics({ abi, eventName: 'CreatedTransaction', args: { txId: icHash } }), data: encodeAbiParameters([{ type: 'uint256' }], [1n]) };
  assert.equal(receiptIcHash(f.context.client, { logs: [log] }), icHash);
});
test('successful receipt without authentic IC event never releases signed recovery state', async () => {
  const f = fixture(); f.context.client.request = async () => receipt(f.sent[0], [event(contract)]);
  await assert.rejects(submit(f), /event mismatch/);
  assert.equal((await f.shared.read()).value.jobs[jobKey].attempts.at(-1).state, 'signed');
});
test('other-job busy response reveals neither signed bytes nor unrelated transaction hash', async () => {
  const f = fixture(); f.context.client.sendRawTransaction = async () => { throw new Error('send interrupted'); };
  await assert.rejects(submit(f), /send interrupted/);
  const restarted = fixture(f.shared); restarted.context.client.request = async () => null;
  let error; try { await submit(restarted, 1); } catch (caught) { error = caught; }
  assert.ok(error); assert.equal(restarted.writes.length, 0);
  assert.equal(restarted.context.sponsorship.lastSigned, null);
  assert.doesNotMatch(error.message, /0x[0-9a-f]+/i);
});
test('already-attested pending state releases unsigned lease without spending gas', async () => {
  const f = fixture(); f.context.client.readContract = async () => ({ evidence_digest: evidenceDigest, opened: false });
  assert.equal((await submit(f)).alreadyAttested, true); assert.equal(f.writes.length, 0);
  assert.equal((await f.shared.read()).value.active, null);
});
