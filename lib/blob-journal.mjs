import { get, put, BlobError, BlobPreconditionFailedError } from '@vercel/blob';
import { JournalError, JournalConflict, MAX_JOURNAL_BYTES } from './attestation-journal.mjs';

// Pinned Blob SDK exposes this retry setting. An ambiguous write must return to
// our recovery path, not silently spend more operations retrying behind CAS.
process.env.VERCEL_BLOB_RETRIES = '0';
export function blobJournalStore(key, { sdk = { get, put }, maxOperations = 24 } = {}) {
  if (!process.env.BLOB_STORE_ID?.trim()) throw new JournalError('Durable collector storage is not configured');
  let operations = 0;
  const options = () => {
    if (++operations > maxOperations) throw new JournalError('Journal operation limit reached');
    return { storeId: process.env.BLOB_STORE_ID.trim(), access: 'private', abortSignal: AbortSignal.timeout(8000) };
  };
  const pathname = key + '.json';
  return {
    async read() {
      const result = await sdk.get(pathname, { ...options(), useCache: false });
      if (result === null) return null;
      if (result.statusCode !== 200 || !result.blob?.etag || result.blob.size > MAX_JOURNAL_BYTES) throw new JournalError('Invalid journal storage response');
      const text = await new Response(result.stream).text();
      if (Buffer.byteLength(text) > MAX_JOURNAL_BYTES) throw new JournalError('Journal capacity exhausted');
      return { value: JSON.parse(text), etag: result.blob.etag };
    },
    async compareAndSwap(etag, value) {
      const body = JSON.stringify(value);
      if (Buffer.byteLength(body) > MAX_JOURNAL_BYTES) throw new JournalError('Journal capacity exhausted');
      try {
        await sdk.put(pathname, body, { ...options(), addRandomSuffix: false,
          contentType: 'application/json', ...(etag === null ? { allowOverwrite: false } : { ifMatch: etag }) });
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError ||
            (etag === null && error instanceof BlobError && /already exists/i.test(error.message))) throw new JournalConflict();
        throw error; // Timeout/unknown outcome must stop before broadcast.
      }
    },
    get operations() { return operations; },
  };
}
