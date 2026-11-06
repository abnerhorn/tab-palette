import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFaviconLoader} from '../extension/favicons.mjs';

const own = 'chrome-extension://testid/';
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const tab = (id, hint = 'https://icons.test/icon.png') => ({id, title:`Tab ${id}`, url:`https://private-${id}.test/page?token=local`, favIconUrl:hint});
const response = (bytes = png) => ({ok:true, headers:{get:()=>String(bytes.byteLength)}, arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)});
const options = fetchImpl => ({getURL:path=>own+path, fetchImpl});

test('only requests Chrome’s local favicon route, then caches by URL and icon identity', async()=>{
  const calls = [];
  const loader = createFaviconLoader(options(async(url,init)=>{
    calls.push(url);
    const request = new URL(url);
    assert.equal(request.protocol, 'chrome-extension:');
    assert.equal(request.host, 'testid');
    assert.equal(request.pathname, '/_favicon/');
    assert.equal(request.searchParams.get('pageUrl'), tab(1).url);
    assert.equal(request.searchParams.get('size'), '32');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.referrerPolicy, 'no-referrer');
    assert.equal(init.redirect, 'error');
    return response();
  }));
  const a = await loader.loadTabs([tab(1)]);
  assert.match(a[0], /^data:image\/png;base64,/);
  assert.deepEqual(await loader.loadTabs([tab(1)]), a);
  assert.equal(calls.length, 1);
  await loader.loadTabs([tab(1, 'https://icons.test/changed.png')]);
  assert.equal(calls.length, 2);
});

test('coalesces overlapping snapshots and limits all concurrent work to eight requests', async()=>{
  let calls = 0, active = 0, peak = 0;
  const loader = createFaviconLoader(options(async()=>{
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve=>setTimeout(resolve, 3));
    active--; return response();
  }));
  const first = Array.from({length:24},(_,i)=>tab(i));
  const second = Array.from({length:24},(_,i)=>tab(i+12));
  const [a,b,c] = await Promise.all([loader.loadTabs(first),loader.loadTabs(first),loader.loadTabs(second)]);
  assert.deepEqual(a,b);
  assert.equal(c.length,24);
  assert.ok(a.every(Boolean)&&c.every(Boolean));
  assert.equal(calls,36);
  assert.ok(peak<=8, `observed ${peak} concurrent fetches`);
});

test('LRU bounds cached URLs and retains the most recently used icon',async()=>{
  let calls = 0;
  const loader = createFaviconLoader({...options(async()=>{calls++;return response();}),maxEntries:2});
  await loader.loadTabs([tab(1),tab(2)]);
  await loader.loadTabs([tab(1)]);
  await loader.loadTabs([tab(3)]);
  await loader.loadTabs([tab(1)]);
  assert.equal(calls,3);
  await loader.loadTabs([tab(2)]);
  assert.equal(calls,4);
});

test('missing, malformed, oversized, and unsupported icons fall back to null',async()=>{
  let calls = 0;
  const loader = createFaviconLoader(options(async()=>{
    calls++;
    if(calls===1)return {ok:false};
    if(calls===2)return response(new Uint8Array([1,2,3]));
    return response(new Uint8Array(9000));
  }));
  assert.deepEqual(await loader.loadTabs([tab(1),tab(2),tab(3),{url:'chrome://settings/'},{url:'javascript:alert(1)'},{url:'https://user:password@private.test/'}]),Array(6).fill(null));
  assert.equal(calls,3);
  const remote = createFaviconLoader({getURL:()=> 'https://icons.example/_favicon/',fetchImpl:async()=>{throw new Error('must not fetch');}});
  assert.deepEqual(await remote.loadTabs([tab(1)]),[null]);
});

test('favicon requests and bodies time out without blocking the palette',async()=>{
  let signal;
  const loader = createFaviconLoader({...options(async(_url,init)=>{
    signal = init.signal;
    return new Promise(()=>{});
  }),timeoutMs:15});
  const start = Date.now();
  assert.deepEqual(await loader.loadTabs([tab(1)]),[null]);
  assert.ok(Date.now()-start<500);
  assert.equal(signal.aborted,true);
});

test('large snapshots preserve ordering while bounding icon and message sizes',async()=>{
  const padded = new Uint8Array(3000);padded.set(png);
  const loader = createFaviconLoader({...options(async()=>response(padded)),maxSnapshotBytes:100_000});
  const tabs = Array.from({length:200},(_,i)=>tab(i));
  const icons = await loader.loadTabs(tabs);
  assert.equal(icons.length,tabs.length);
  assert.ok(icons.some(Boolean));
  assert.ok(icons.some(value=>value===null));
  assert.ok(icons.filter(Boolean).every(value=>value.length<=8192));
  const snapshot={tabs:tabs.map((value,i)=>({...value,faviconDataUrl:icons[i]}))};
  assert.ok(new TextEncoder().encode(JSON.stringify(snapshot)).length<=100_000);
  const firstMissing=icons.indexOf(null);
  assert.ok(icons.slice(firstMissing).every(value=>value===null));
});

test('a stale miss retries after its short negative-cache TTL',async()=>{
  let time=0,calls=0;
  const loader=createFaviconLoader({...options(async()=>{calls++;return calls===1?{ok:false}:response();}),now:()=>time});
  assert.deepEqual(await loader.loadTabs([tab(1)]),[null]);
  await loader.loadTabs([tab(1)]);assert.equal(calls,1);
  time=15_001;
  assert.match((await loader.loadTabs([tab(1)]))[0],/^data:image\/png/);
  assert.equal(calls,2);
});
