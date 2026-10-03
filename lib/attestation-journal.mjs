import { keccak256, parseTransaction, recoverTransactionAddress } from 'viem';

export const MAX_JOURNAL_BYTES = 64 * 1024;
export class JournalError extends Error {}
export class JournalConflict extends JournalError { constructor(message = 'Journal CAS conflict') { super(message); this.code = 'CAS_CONFLICT'; } }
const address = value => {
  if (!/^0x[0-9a-f]{40}$/i.test(value || '')) throw new JournalError('Invalid journal address');
  return value.toLowerCase();
};
const hash = value => {
  if (!/^0x[0-9a-f]{64}$/i.test(value || '')) throw new JournalError('Invalid transaction hash');
  return value.toLowerCase();
};
export function journalKey(chainId, signer) {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new JournalError('Invalid chain id');
  return `attestation-journal/v1/${chainId}/${address(signer)}`;
}
export function attestationJobKey(contract, commitId) {
  if (!Number.isSafeInteger(commitId) || commitId < 0) throw new JournalError('Invalid commitment id');
  return `${address(contract)}:${commitId}`;
}
const copy = value => structuredClone(value);
const latest = job => job.attempts.at(-1);

/** Store must scope read/CAS to key, offer linearizable CAS (null=create only),
 * return fresh {value,etag}, and throw code CAS_CONFLICT only on a proven conflict.
 * An unavailable/ambiguous write MUST NOT be relabeled as a conflict. No raw
 * transaction may be returned to an SDK until persistSigned has succeeded. */
/* Integration (existing bounded signer still enforces hard gas/fee/nonce caps):
 * const lease = await journal.reserve({contract, commitId, evidenceDigest, owner: randomUUID()});
 * if (lease.kind !== 'reserved') return publicRecoverySummary(lease); // never expose rawTx
 * const original = boundedAccount.signTransaction.bind(boundedAccount);
 * const account = {...boundedAccount, async signTransaction(tx) {
 *   const raw = await original(tx);
 *   await journal.persistSigned(lease.token, raw); // on ANY error, throw; no send
 *   return raw;
 * }};
 * // SDK write uses account. Lost response -> inspect durable job and chain receipt.
 * // Missing receipt -> journal.rebroadcast(jobKey, raw => rpc.sendRawTransaction(...)).
 * // Mined receipt -> decode expected consensus event/address, then recordReceipt.
 * // Do not call releaseReserved after a signing attempt with uncertain CAS outcome.
 * // Store adapter must not expire/delete this record or cache stale reads. Existing
 * // job snapshots include signed bytes for internal recovery only, never HTTP output.
 */
export class AttestationJournal {
  constructor({ store, chainId, signer, now = () => Date.now(), leaseMs = 30_000 }) {
    this.key = journalKey(chainId, signer);
    if (!store?.read || !store?.compareAndSwap) throw new JournalError('CAS store required');
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 300_000) throw new JournalError('Invalid lease duration');
    Object.assign(this, { store, chainId, signer: address(signer), now, leaseMs });
  }
  empty() { return { version: 1, chainId: this.chainId, signer: this.signer, sequence: 0, active: null, jobs: {} }; }
  validate(value) {
    if (!value || value.version !== 1 || value.chainId !== this.chainId || value.signer !== this.signer || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !value.jobs || typeof value.jobs !== 'object' || Array.isArray(value.jobs)) throw new JournalError('Journal identity or format mismatch');
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded) > MAX_JOURNAL_BYTES) throw new JournalError('Journal capacity exhausted');
    return value;
  }
  async snapshot() {
    const record = await this.store.read();
    if (record === null) return { value: this.empty(), etag: null };
    if (!record || typeof record.etag !== 'string' || !record.etag) throw new JournalError('Invalid CAS response');
    return { value: copy(this.validate(record.value)), etag: record.etag };
  }
  async mutate(fn) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { value, etag } = await this.snapshot();
      const result = fn(value);
      if (result.noWrite) return copy(result.result);
      this.validate(value);
      try { await this.store.compareAndSwap(etag, value); return copy(result.result); }
      catch (error) { if (error?.code !== 'CAS_CONFLICT') throw error; }
    }
    throw new JournalConflict('CAS retry limit reached');
  }
  async reserve({ contract, commitId, evidenceDigest, owner }) {
    const jobKey = attestationJobKey(contract, commitId);
    if (!/^[0-9a-f]{64}$/i.test(evidenceDigest || '') || typeof owner !== 'string' || owner.length < 16 || owner.length > 128) throw new JournalError('Invalid reservation identity');
    evidenceDigest = evidenceDigest.toLowerCase();
    return this.mutate(state => {
      const time = this.now();
      let job = state.jobs[jobKey];
      if (job && job.evidenceDigest !== evidenceDigest) throw new JournalError('Different evidence already reserved');
      if (job && ['signed', 'mined'].includes(latest(job)?.state)) return { noWrite: true, result: { kind: 'existing', jobKey, job } };
      if (state.active) {
        const active = state.active;
        const prior = state.jobs[active.jobKey].attempts[active.attempt];
        if (prior.state !== 'reserved' || time < active.leaseUntil) return { noWrite: true, result: { kind: 'busy', jobKey: active.jobKey } };
        prior.state = 'abandoned';
        state.active = null;
      }
      if (!job) job = state.jobs[jobKey] = { evidenceDigest, attempts: [], icResult: null };
      if (state.sequence >= Number.MAX_SAFE_INTEGER) throw new JournalError('Journal sequence exhausted');
      const generation = ++state.sequence;
      const attempt = job.attempts.length;
      const leaseUntil = time + this.leaseMs;
      const token = { jobKey, attempt, generation, owner };
      job.attempts.push({ state: 'reserved', generation, owner, createdAt: time, leaseUntil });
      state.active = { ...token, leaseUntil };
      return { result: { kind: 'reserved', token, leaseUntil } };
    });
  }
  fenced(state, token, requireReserved = true) {
    const active = state.active;
    if (!active || !token || ['jobKey', 'attempt', 'generation', 'owner'].some(key => active[key] !== token[key])) throw new JournalError('Reservation owner lost');
    const attempt = state.jobs[active.jobKey].attempts[active.attempt];
    if (requireReserved && (attempt.state !== 'reserved' || this.now() >= active.leaseUntil)) throw new JournalError('Reservation expired or already signed');
    return attempt;
  }
  async releaseReserved(token) {
    return this.mutate(state => {
      const attempt = this.fenced(state, token);
      attempt.state = 'abandoned'; state.active = null;
      return { result: { released: true } };
    });
  }
  async persistSigned(token, rawTransaction) {
    if (typeof rawTransaction !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(rawTransaction) || rawTransaction.length > MAX_JOURNAL_BYTES) throw new JournalError('Invalid signed transaction');
    const tx = parseTransaction(rawTransaction);
    const signer = await recoverTransactionAddress({ serializedTransaction: rawTransaction });
    if (address(signer) !== this.signer || tx.chainId !== this.chainId || !Number.isSafeInteger(tx.nonce) || tx.nonce < 0) throw new JournalError('Signed transaction identity mismatch');
    const transactionHash = keccak256(rawTransaction);
    return this.mutate(state => {
      const attempt = this.fenced(state, token);
      // Nonces are exclusive to this signer journal. Failed mined attempts also
      // consume their nonce. Replacements and independent signer use are forbidden.
      for (const job of Object.values(state.jobs)) for (const prior of job.attempts) {
        if (prior.nonce !== undefined && prior.nonce >= tx.nonce) throw new JournalError('Nonce already used or moved backwards');
      }
      Object.assign(attempt, { state: 'signed', rawTransaction, transactionHash, nonce: tx.nonce, signedAt: this.now() });
      state.active.leaseUntil = null;
      return { result: { transactionHash, nonce: tx.nonce } };
    });
  }
  /** Fetch only persisted bytes. Never accepts replacement bytes from caller. */
  async rebroadcast(jobKey, broadcast) {
    const { value } = await this.snapshot();
    const attempt = latest(value.jobs[jobKey] || { attempts: [] });
    if (!attempt || attempt.state !== 'signed' || value.active?.jobKey !== jobKey) throw new JournalError('No signed transaction awaiting receipt');
    if (keccak256(attempt.rawTransaction) !== attempt.transactionHash) throw new JournalError('Stored transaction integrity failure');
    const returnedHash = await broadcast(attempt.rawTransaction);
    if (hash(returnedHash) !== attempt.transactionHash) throw new JournalError('Broadcast hash mismatch; retain signed recovery state');
    return { transactionHash: attempt.transactionHash };
  }
  /** Receipt must come from trusted chain RPC, never an HTTP user's request.
   * IC hash must be decoded from this receipt's expected consensus event. */
  async recordReceipt(jobKey, receipt, { icTransactionHash = null } = {}) {
    const receiptHash = hash(receipt?.transactionHash);
    if (!['0x0', '0x1'].includes(receipt.status) || !receipt.blockHash || !receipt.blockNumber) throw new JournalError('Mined EVM receipt required');
    if (icTransactionHash !== null) icTransactionHash = hash(icTransactionHash);
    if (receipt.status === '0x1' && !icTransactionHash) throw new JournalError('Successful receipt requires recovered IC transaction hash');
    if (receipt.status === '0x0' && icTransactionHash) throw new JournalError('Reverted transaction cannot create an IC transaction');
    return this.mutate(state => {
      const job = state.jobs[jobKey]; const attempt = job && latest(job);
      if (!attempt || attempt.transactionHash !== receiptHash) throw new JournalError('Receipt does not match current signed attempt');
      if (attempt.state === 'mined' || attempt.state === 'reverted') {
        if (attempt.receiptStatus !== receipt.status || attempt.blockHash !== receipt.blockHash || attempt.icTransactionHash !== icTransactionHash) throw new JournalError('Receipt changed; manual chain recovery required');
        return { noWrite: true, result: { state: attempt.state } };
      }
      if (attempt.state !== 'signed' || state.active?.jobKey !== jobKey) throw new JournalError('Attempt is not signed');
      Object.assign(attempt, { state: receipt.status === '0x0' ? 'reverted' : 'mined', receiptStatus: receipt.status, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, icTransactionHash });
      state.active = null;
      return { result: { state: attempt.state, icTransactionHash } };
    });
  }
  async recordIcResult(jobKey, icTransactionHash, result) {
    icTransactionHash = hash(icTransactionHash);
    if (!['pending', 'accepted', 'finalized', 'failed'].includes(result)) throw new JournalError('Unknown IC result');
    return this.mutate(state => {
      const job = state.jobs[jobKey]; const attempt = job && latest(job);
      if (!attempt || attempt.state !== 'mined' || attempt.icTransactionHash !== icTransactionHash) throw new JournalError('IC result does not match mined attempt');
      if (job.icResult && ['finalized', 'failed'].includes(job.icResult) && job.icResult !== result) throw new JournalError('Terminal IC result cannot be overwritten');
      job.icResult = result;
      return { result: { icTransactionHash, result } };
    });
  }
}
