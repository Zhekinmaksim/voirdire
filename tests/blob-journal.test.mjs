import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobPreconditionFailedError } from '@vercel/blob';
import { blobJournalStore } from '../lib/blob-journal.mjs';
process.env.BLOB_STORE_ID='store_test';
test('journal uses uncached private reads and atomic create or ETag writes',async()=>{
  const calls=[];
  const sdk={get:async(path,options)=>{calls.push({path,options});return {statusCode:200,blob:{etag:'revision-7',size:7},stream:new Response('{"v":1}').body};},
    put:async(path,body,options)=>{calls.push({path,body,options});}};
  const store=blobJournalStore('signer',{sdk});
  assert.deepEqual(await store.read(),{value:{v:1},etag:'revision-7'});
  await store.compareAndSwap(null,{v:2});await store.compareAndSwap('revision-7',{v:3});
  assert.equal(calls[0].options.useCache,false);assert.ok(calls.every(c=>c.options.access==='private'));
  assert.equal(calls[1].options.allowOverwrite,false);assert.equal(calls[1].options.addRandomSuffix,false);
  assert.equal(calls[2].options.ifMatch,'revision-7');
});
test('only proven precondition failure becomes conflict; ambiguous storage errors stay fatal',async()=>{
  let error=new BlobPreconditionFailedError();
  const store=blobJournalStore('signer',{sdk:{put:async()=>{throw error;}}});
  await assert.rejects(store.compareAndSwap('etag',{}),e=>e.code==='CAS_CONFLICT');
  error=new Error('write timed out after it might have committed');
  await assert.rejects(store.compareAndSwap('etag',{}),e=>e===error&&e.code!=='CAS_CONFLICT');
});
test('weak transport ETag triggers fresh identity read; its exact body and strong version are paired',async()=>{
  const calls=[];const sdk={get:async(_path,options)=>{
    calls.push(options);const identity=options.headers?.['accept-encoding']==='identity';
    return {statusCode:200,blob:{etag:identity?'"strong-new"':'W/"compressed-old"',size:20},headers:new Headers({'content-encoding':identity?'identity':'br'}),stream:new Response(JSON.stringify({version:identity?2:1})).body};
  }};
  const store=blobJournalStore('signer',{sdk});
  assert.deepEqual(await store.read(),{value:{version:2},etag:'"strong-new"'});assert.equal(calls.length,2);
  await store.read();assert.equal(calls.length,3);assert.equal(calls[2].headers['accept-encoding'],'identity');
});
test('missing store, excessive payload and operation budget stop before network access',async()=>{
  delete process.env.BLOB_STORE_ID;assert.throws(()=>blobJournalStore('signer'),/not configured/);process.env.BLOB_STORE_ID='store_test';
  let calls=0;const store=blobJournalStore('signer',{maxOperations:1,sdk:{get:async()=>{calls++;return null;},put:async()=>{calls++;}}});
  await assert.rejects(store.compareAndSwap(null,{large:'x'.repeat(65536)}),/capacity/);assert.equal(calls,0);
  assert.equal(await store.read(),null);await assert.rejects(store.read(),/operation limit/);assert.equal(calls,1);
});
