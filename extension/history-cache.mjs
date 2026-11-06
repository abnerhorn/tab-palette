import {normalize} from './search.mjs';

// This is a bounded, volatile view of Chrome history, never an on-disk index.
// Local suggestions can use it while Chrome's slower full query runs separately.
export function createHistoryCache(historyAPI, {maxItems=5000, ttlMs=60000, now=Date.now}={}) {
  let entries=new Map();
  let epoch=0;
  let mutation=0;
  let lastWarmAt=-Infinity;
  let warming=null;
  let running=null;
  const queued=new Map();
  const latest=new Map();

  function entry(item, changedAt=0) {
    if(!item || typeof item.url!=='string' || !item.url)return null;
    const row={url:item.url,title:typeof item.title==='string'?item.title:'',
      lastVisitTime:Number.isFinite(item.lastVisitTime)?item.lastVisitTime:0,
      visitCount:Number.isFinite(item.visitCount)?item.visitCount:0};
    return {row,text:normalize(`${row.title} ${row.url}`),changedAt};
  }

  function trim(map) {
    return new Map([...map].sort((a,b)=>b[1].row.lastVisitTime-a[1].row.lastVisitTime).slice(0,maxItems));
  }

  function prewarm() {
    if(warming)return warming;
    if(now()-lastWarmAt<ttlMs)return Promise.resolve();
    const startedEpoch=epoch,startedMutation=mutation;
    const pending=Promise.resolve().then(()=>historyAPI.search({text:'',startTime:0,maxResults:maxItems})).then(items=>{
      if(epoch!==startedEpoch)return;
      const loaded=new Map();
      for(const item of items || []) {
        const value=entry(item);
        if(value && (!loaded.has(value.row.url) || loaded.get(value.row.url).row.lastVisitTime<value.row.lastVisitTime))loaded.set(value.row.url,value);
      }
      // A visit observed during the asynchronous read is newer than its result.
      for(const [url,value] of entries)if(value.changedAt>startedMutation)loaded.set(url,value);
      entries=trim(loaded);
    }).catch(()=>{}).finally(()=>{
      if(epoch===startedEpoch)lastWarmAt=now();
      if(warming===pending)warming=null;
    });
    warming=pending;
    return pending;
  }

  function matches(query, maxResults=80) {
    const tokens=normalize(query).trim().split(/\s+/).filter(Boolean);
    if(!tokens.length)return [];
    const result=[];
    for(const value of entries.values()) {
      if(tokens.every(token=>value.text.includes(token)))result.push({...value.row});
      if(result.length>=maxResults)break;
    }
    return result;
  }

  function finish(job, result) {
    if(latest.get(job.windowKey)===job)latest.delete(job.windowKey);
    job.resolve(result);
  }

  function drain() {
    if(running || !queued.size)return;
    const [windowKey,job]=queued.entries().next().value;
    queued.delete(windowKey);
    running=job;
    Promise.resolve().then(()=>historyAPI.search({text:job.query,startTime:0,maxResults:80})).then(history=>{
      const superseded=job.epoch!==epoch || latest.get(job.windowKey)!==job;
      finish(job,{history:superseded?[]:history || [],epoch:job.epoch,superseded});
    },()=>finish(job,{history:[],epoch:job.epoch,superseded:job.epoch!==epoch || latest.get(job.windowKey)!==job})).finally(()=>{
      running=null;
      drain();
    });
  }

  function refine(query, windowKey='default') {
    const previous=latest.get(windowKey);
    if(previous?.query===query && previous.epoch===epoch)return previous.promise;
    const waiting=queued.get(windowKey);
    if(waiting) {
      queued.delete(windowKey);
      finish(waiting,{history:[],epoch:waiting.epoch,superseded:true});
    }
    let resolve;
    const promise=new Promise(done=>{resolve=done;});
    const job={query,windowKey,epoch,promise,resolve};
    latest.set(windowKey,job);
    queued.set(windowKey,job);
    drain();
    return promise;
  }

  historyAPI.onVisited?.addListener(item=>{
    const previous=entries.get(item?.url)?.row;
    const value=entry({...previous,...item,
      title:item?.title || previous?.title || '',
      lastVisitTime:Number.isFinite(item?.lastVisitTime)?item.lastVisitTime:now()},++mutation);
    if(!value)return;
    entries.set(value.row.url,value);
    entries=trim(entries);
  });
  historyAPI.onVisitRemoved?.addListener(info=>{
    // Every deletion invalidates in-flight reads too: a response that started
    // before Chrome's deletion event must not put removed pages back on screen.
    epoch++;
    lastWarmAt=-Infinity;
    if(info?.allHistory || !Array.isArray(info?.urls))entries.clear();
    else for(const url of info.urls)entries.delete(url);
    for(const job of queued.values())finish(job,{history:[],epoch:job.epoch,superseded:true});
    queued.clear();
  });

  return {prewarm,matches,refine,isCurrent:result=>result.epoch===epoch};
}
