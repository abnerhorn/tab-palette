import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryCache} from '../extension/history-cache.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const signal=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},emit(value){for(const listener of this.listeners)listener(value);}});
const api=search=>({search,onVisited:signal(),onVisitRemoved:signal()});
const row=(name,time=1)=>({url:`https://${name}.test/`,title:name,lastVisitTime:time});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('recent cache is bounded, token-matched, and reused until the refresh TTL',async()=>{
  let time=100,calls=0;
  const history=api(async options=>{
    calls++;
    assert.deepEqual(options,{text:'',startTime:0,maxResults:3});
    return [row('old',1),row('recent',4),{...row('cafe',3),title:'Café meeting'},row('middle',2)];
  });
  const cache=createHistoryCache(history,{maxItems:3,ttlMs:60,now:()=>time});
  await Promise.all([cache.prewarm(),cache.prewarm()]);
  assert.equal(calls,1);
  assert.deepEqual(cache.matches('test').map(item=>item.title),['recent','Café meeting','middle']);
  assert.deepEqual(cache.matches('MEETING cafe').map(item=>item.url),['https://cafe.test/']);
  assert.deepEqual(cache.matches('old'),[]);
  time=159;await cache.prewarm();assert.equal(calls,1);
  time=160;await cache.prewarm();assert.equal(calls,2);
});

test('visits observed during prewarm are retained and updated entries remain bounded',async()=>{
  const loading=deferred();
  const history=api(()=>loading.promise);
  const cache=createHistoryCache(history,{maxItems:2,now:()=>10});
  const warm=cache.prewarm();
  history.onVisited.emit({...row('updated',20),title:'New title'});
  loading.resolve([row('updated',1),row('recent',3),row('older',2)]);
  await warm;
  assert.deepEqual(cache.matches('test').map(item=>item.title),['New title','recent']);
  history.onVisited.emit({url:'https://updated.test/',lastVisitTime:30});
  assert.equal(cache.matches('updated')[0].title,'New title');
  history.onVisited.emit(row('newest',40));
  assert.deepEqual(cache.matches('test').map(item=>item.url),['https://newest.test/','https://updated.test/']);
});

test('full queries run one at a time and skip intermediate queued queries for each window',async()=>{
  const pending=[],queries=[];
  const history=api(options=>{queries.push(options.text);const next=deferred();pending.push(next);return next.promise;});
  const cache=createHistoryCache(history);
  const first=cache.refine('a',1);
  const discarded=cache.refine('ab',1);
  const newest=cache.refine('abc',1);
  const otherWindow=cache.refine('other',2);
  assert.equal((await discarded).superseded,true);
  await tick();
  assert.deepEqual(queries,['a']);
  pending[0].resolve([row('a')]);
  assert.equal((await first).superseded,true);
  await tick();assert.deepEqual(queries,['a','abc']);
  pending[1].resolve([row('abc')]);
  assert.equal((await newest).history[0].title,'abc');
  await tick();assert.deepEqual(queries,['a','abc','other']);
  pending[2].resolve([row('other')]);
  assert.equal((await otherWindow).superseded,false);
});

test('identical current-window queries share the same Chrome read',async()=>{
  const pending=deferred();let calls=0;
  const cache=createHistoryCache(api(()=>{calls++;return pending.promise;}));
  const first=cache.refine('same',1),second=cache.refine('same',1);
  assert.equal(first,second);
  await tick();assert.equal(calls,1);
  pending.resolve([row('same')]);
  assert.equal((await first).history.length,1);
});

test('partial deletion removes cached pages and invalidates pending prewarm and full-query results',async()=>{
  const loading=deferred(),refining=deferred();
  const history=api(options=>options.text?refining.promise:loading.promise);
  const cache=createHistoryCache(history);
  history.onVisited.emit(row('deleted',2));history.onVisited.emit(row('kept',1));
  const warm=cache.prewarm(),fresh=cache.refine('deleted',1),queued=cache.refine('queued',2);
  await tick();
  history.onVisitRemoved.emit({allHistory:false,urls:['https://deleted.test/']});
  assert.deepEqual(cache.matches('deleted'),[]);
  assert.equal(cache.matches('kept').length,1);
  assert.equal((await queued).superseded,true);
  loading.resolve([row('deleted',10)]);refining.resolve([row('deleted',10)]);
  await warm;
  assert.deepEqual(cache.matches('deleted'),[]);
  const result=await fresh;
  assert.equal(result.superseded,true);assert.deepEqual(result.history,[]);
  assert.equal(cache.isCurrent(result),false);
});

test('clearing all history prevents both old responses and prior cache contents from returning',async()=>{
  const loading=deferred();let calls=0;
  const history=api(()=>{calls++;return calls===1?loading.promise:Promise.resolve([row('new')]);});
  const cache=createHistoryCache(history);
  history.onVisited.emit(row('old'));
  const warm=cache.prewarm();await tick();
  history.onVisitRemoved.emit({allHistory:true,urls:[]});
  assert.deepEqual(cache.matches('test'),[]);
  loading.resolve([row('old')]);await warm;
  assert.deepEqual(cache.matches('old'),[]);
  await cache.prewarm();
  assert.equal(calls,2);assert.equal(cache.matches('new').length,1);
});

test('a failed full query releases the queue for the latest query',async()=>{
  const queries=[];
  const history=api(async options=>{queries.push(options.text);if(options.text==='failed')throw Error('Chrome busy');return [row('recovered')];});
  const cache=createHistoryCache(history);
  const failed=cache.refine('failed',1),next=cache.refine('recovered',2);
  assert.deepEqual((await failed).history,[]);
  assert.equal((await next).history[0].title,'recovered');
  assert.deepEqual(queries,['failed','recovered']);
});
