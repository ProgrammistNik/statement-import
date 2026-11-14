import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { createMockServer } from '../mobile-engineer-kit/mock-server.mjs';
import { ImportController, inspectFile, MAX_BYTES, Operation, Storage, FileAccess, Job, Api } from '../src/core';
import { makeApi } from '../src/api';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const fixture = (name: string) => readFile(new URL(`../mobile-engineer-kit/fixtures/${name}`, import.meta.url));

async function setup(t: any) {
  const dir = await mkdtemp(join(tmpdir(), 'statement-test-'));
  const server = createMockServer({ statePath: join(dir, 'state.json') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  let saved: Operation | null = null;
  const copies = new Map<string, Buffer>();
  const storage: Storage = { read: async () => structuredClone(saved), write: async value => { saved = structuredClone(value); } };
  const files: FileAccess = { exists: uri => copies.has(uri), remove: async uri => { copies.delete(uri); }, sweep: async keep => { for (const uri of copies.keys()) if (uri !== keep) copies.delete(uri); } };
  const api = makeApi(fetch, uri => copies.get(uri), 500);
  const client = () => new ImportController(storage, files, api, randomUUID);
  const controller = client(); await controller.initialize();
  const mode = async (mode: string) => { await fetch(`${base}/__test/scenario`, { method: 'POST', body: JSON.stringify({ mode }) }); };
  const counters = async () => (await fetch(`${base}/__test/state`)).json();
  const select = async (name = 'statement.csv', target = controller) => {
    const bytes = await fixture(name);
    const format = inspectFile(bytes.length, bytes.subarray(0,4096), bytes.subarray(-1024));
    const uri = `private/${randomUUID()}`;
    copies.set(uri, bytes);
    await target.select({ uri, name, size: bytes.length, format }, base);
    return bytes;
  };
  return { controller, client, storage, files, api, copies, base, mode, counters, select, saved: () => saved };
}

for (const name of ['statement.csv', 'statement.pdf']) test(`real HTTP upload and ready report: ${name}`, async t => {
  const f = await setup(t);
  const bytes = await f.select(name);
  const key = f.saved()!.key;
  assert.ok(key.length >= 8);
  assert.equal(f.saved()!.phase, 'selected');
  await f.controller.submit();
  assert.equal(f.controller.getSnapshot().operation!.phase, 'queued');
  assert.equal(f.copies.size, 0);
  await pause(1100); await f.controller.refresh();
  const op = f.controller.getSnapshot().operation!;
  assert.equal(op.key, key); assert.equal(op.phase, 'ready');
  assert.equal(op.job!.items!.reduce((sum, item) => sum + item.amountMinor, 0),15199);
  const state = await f.counters();
  assert.equal(state.stats.newJobs,1); assert.equal(state.stats.acceptedBytes,bytes.length);
  assert.equal(state.jobs[0].sha256,createHash('sha256').update(bytes).digest('hex'));
});

test('lost acknowledgement and relaunch recover one job without another POST', async t => {
  const f = await setup(t); await f.mode('lost_ack'); await f.select();
  const key = f.saved()!.key;
  await f.controller.submit(); assert.equal(f.saved()!.phase,'unknown');
  assert.equal(f.copies.size,1); f.controller.close();
  const restarted = f.client(); await restarted.initialize();
  assert.equal(f.saved()!.key,key); assert.ok(f.saved()!.job);
  await pause(1100); await restarted.refresh();
  assert.equal(f.saved()!.phase,'ready'); assert.equal(f.copies.size,0);
  const state = await f.counters(); assert.equal(state.stats.newJobs,1); assert.equal(state.stats.createRequests,1);
});

test('lookup 404 on retry reuses persisted key and identical bytes', async t => {
  const f = await setup(t); await f.select();
  const op = f.saved()!;
  await f.storage.write({ ...op, phase:'unknown' });
  const restarted = f.client(); await restarted.initialize();
  assert.equal((await f.counters()).stats.createRequests,0);
  await restarted.recover(); assert.equal(f.saved()!.key,op.key);
  assert.equal((await f.counters()).stats.newJobs,1);
});

test('late creation after lookup 404 still produces only one job', async t => {
  const f = await setup(t); await f.select(); const op=f.saved()!;
  const delayed: Api = { ...f.api, find: async value => { await f.api.create(value); return null; } };
  await f.storage.write({...op,phase:'unknown'});
  const client = new ImportController(f.storage,f.files,delayed,randomUUID);
  await client.initialize(); await client.recover();
  const state=await f.counters(); assert.equal(state.stats.newJobs,1); assert.ok(state.stats.duplicateHits>=1); assert.equal(f.saved()!.key,op.key);
});

test('ready revision 3 cannot regress to processing revision 2', async t => {
  const f=await setup(t); await f.mode('stale_status'); await f.select(); await f.controller.submit();
  await f.controller.refresh(); assert.equal(f.saved()!.phase,'ready');
  await f.controller.refresh(); assert.equal(f.saved()!.phase,'ready'); assert.equal(f.saved()!.job!.revision,3);
  assert.equal(f.controller.getSnapshot().ignored,1);
});

test('failed deletion preserves intent and key across relaunch; only GET deleted confirms removal', async t => {
  const f=await setup(t); await f.select(); await f.controller.submit(); await f.mode('delete_failure');
  await f.controller.remove(); assert.equal(f.saved()!.phase,'delete-error');
  const key=f.saved()!.deleteKey; assert.ok(key);
  f.controller.close(); const restarted=f.client(); await restarted.initialize();
  assert.equal(f.saved()!.phase,'delete-error');
  await f.mode('happy'); await restarted.remove(); assert.equal(f.saved()!.phase,'deleting'); assert.equal(f.saved()!.deleteKey,key);
  await pause(1100); await restarted.refresh(); assert.equal(f.saved()!.phase,'deleted'); assert.equal(f.copies.size,0);
  assert.equal((await f.counters()).stats.deleteRequests,2);
});

test('deleted tombstone cannot be resurrected by a late ready response', async t => {
  const f=await setup(t); await f.select(); await f.controller.submit(); await f.controller.remove(); await pause(1100); await f.controller.refresh();
  const old=f.saved()!.job!;
  await (f.controller as any).accept({ ...old,status:'ready',revision:99,items:[] });
  assert.equal(f.saved()!.phase,'deleted');
});

test('spoofed PDF and oversized files are rejected before HTTP', async t => {
  const f=await setup(t); const before=(await f.counters()).stats.createRequests;
  const spoof=await fixture('spoofed.pdf');
  assert.throws(()=>inspectFile(spoof.length,spoof,spoof));
  assert.throws(()=>inspectFile(MAX_BYTES+1,new Uint8Array(),new Uint8Array()));
  assert.throws(()=>inspectFile(0,new Uint8Array(),new Uint8Array()));
  assert.equal((await f.counters()).stats.createRequests,before);
});

test('cancel selection and startup sweep remove private copies', async t => {
  const f=await setup(t); await f.select(); await f.controller.cancel(); assert.equal(f.copies.size,0); assert.equal(f.saved(),null);
  f.copies.set('orphan',Buffer.from('unused')); await f.client().initialize(); assert.equal(f.copies.size,0);
});

test('failure to persist posting state prevents POST', async t => {
  const f=await setup(t); await f.select();
  const broken: Storage={read:f.storage.read,write:async value=>{if(value?.phase==='posting')throw new Error('disk full');await f.storage.write(value);}};
  const client=new ImportController(broken,f.files,f.api,randomUUID);await client.initialize();await client.submit();
  assert.equal((await f.counters()).stats.createRequests,0);assert.equal(f.saved()!.phase,'selected');
});

test('relaunch during pending DELETE polls without creating a second deletion key', async t => {
  const f=await setup(t);await f.select();await f.controller.submit();await f.controller.remove();
  const key=f.saved()!.deleteKey;f.controller.close();await pause(1100);await f.client().initialize();
  assert.equal(f.saved()!.phase,'deleted');assert.equal(f.saved()!.deleteKey,key);assert.equal((await f.counters()).stats.deleteRequests,1);
});

test('DELETE response alone never confirms removal', async t => {
  const f=await setup(t);await f.select();await f.controller.submit();
  const api: Api={...f.api,remove:async op=>({...op.job!,status:'deleted',revision:5})};
  const client=new ImportController(f.storage,f.files,api,randomUUID);await client.initialize();await client.remove();
  assert.equal(f.saved()!.phase,'delete-error');assert.notEqual(f.saved()!.job!.status,'deleted');
});

test('selected file survives relaunch without an automatic POST', async t => {
  const f=await setup(t);await f.select();const key=f.saved()!.key;
  f.controller.close();await f.client().initialize();
  assert.equal(f.saved()!.phase,'selected');assert.equal(f.saved()!.key,key);assert.equal(f.copies.size,1);
  assert.equal((await f.counters()).stats.createRequests,0);
});

test('unknown upload waits for explicit recovery or relaunch', async t => {
  const f=await setup(t);await f.mode('lost_ack');await f.select();await f.controller.submit();
  await f.controller.refresh();assert.equal(f.saved()!.phase,'unknown');
  await f.controller.recover();assert.ok(f.saved()!.job);assert.equal((await f.counters()).stats.createRequests,1);
});
