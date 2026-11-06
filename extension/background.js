import {buildSuggestions, allowedURL} from './search.mjs';
import {getTabFavicons} from './favicons.mjs';

const HOST = 'ai.tesar.tab_palette';
const MINIMUM_HOST_VERSION = '1.1.0';
const own = chrome.runtime.getURL('');
let hostPort = null;
let hostReady = false;
let hostStatus = {};
let lastWindowId = null;
let popupWindowId = null;
let launching = null;
let updateTimer;
const previousTabs = new Map();
const relayTabs = new Map();
const isLauncher = tab => {
  const url=tab.pendingUrl||tab.url||'';
  return url.startsWith(own)||/^chrome:\/\/(newtab|new-tab-page)\/?$/.test(url);
};

function supportedHostVersion(value) {
  if (typeof value!=='string' || !/^\d+(?:\.\d+){0,3}$/.test(value)) return false;
  const actual=value.split('.').map(Number),minimum=MINIMUM_HOST_VERSION.split('.').map(Number);
  if(actual.some(part=>!Number.isSafeInteger(part)))return false;
  for(let i=0;i<Math.max(actual.length,minimum.length);i++) {
    const difference=(actual[i]||0)-(minimum[i]||0);
    if(difference)return difference>0;
  }
  return true;
}

async function normalWindow(preferred) {
  if (Number.isInteger(preferred)) {
    try { const win = await chrome.windows.get(preferred); if (win.type==='normal') return win; } catch {}
  }
  if (lastWindowId) {
    try { const win = await chrome.windows.get(lastWindowId); if (win.type==='normal') return win; } catch {}
  }
  const win = await chrome.windows.getLastFocused({windowTypes:['normal']});
  lastWindowId = win.id;
  return win;
}

async function snapshot(preferred) {
  return snapshotWindow(await normalWindow(preferred));
}

async function snapshotWindow(win, includeFavicons=true) {
  const raw = (await chrome.tabs.query({windowId:win.id})).filter(tab=>!isLauncher(tab));
  const groups = new Map();
  for (const id of new Set(raw.map(tab=>tab.groupId).filter(id=>id>=0))) {
    try { groups.set(id, await chrome.tabGroups.get(id)); } catch {}
  }
  const ordered = raw.sort((a,b)=>a.index-b.index);
  const tabs = ordered.map((tab,index)=>({id:tab.id,windowId:tab.windowId,index,title:tab.title||tab.pendingUrl||tab.url||'New tab',url:tab.url||tab.pendingUrl||'',active:tab.active,pinned:tab.pinned,audible:tab.audible,lastAccessed:tab.lastAccessed||0,groupTitle:groups.get(tab.groupId)?.title||'',groupColor:groups.get(tab.groupId)?.color||''}));
  const favicons = includeFavicons ? await getTabFavicons(tabs, ordered) : [];
  return {tabs:tabs.map((tab,index)=>({...tab,faviconDataUrl:favicons[index]})),sourceWindowId:win.id,mode:'extension',shortcutModifier:'⌥',native:hostStatus};
}

async function hotkeySnapshot() {
  // A native event tap sees Chrome shortcuts across profiles and Incognito.
  // Only this profile's *currently focused* regular window is eligible. Never
  // fall back to lastWindowId/getLastFocused, which may expose regular-profile
  // tabs or turn an Incognito search into a normal-history navigation.
  const denied = {eligible:false,reason:'unsupported-window'};
  try {
    const windows = await chrome.windows.getAll({populate:false,windowTypes:['normal']});
    const win = windows.find(candidate=>candidate.focused===true && candidate.type==='normal' && candidate.incognito!==true);
    if (!win) return denied;
    // Keep eligibility independent of cold favicon reads. The native panel's
    // normal snapshot request fills its icons after this fast validation.
    const state = await snapshotWindow(win,false);
    // Tab/group reads are asynchronous. If focus changed or the original window
    // closed during the read, discard its metadata rather than showing it.
    const current = await chrome.windows.get(win.id);
    if (current.focused!==true || current.type!=='normal' || current.incognito===true) return denied;
    lastWindowId=win.id;
    return {...state,eligible:true};
  } catch { return denied; }
}

async function search(query, requestId, sourceWindowId) {
  const text = String(query||'').trim().slice(0,1000);
  if (!text) return {suggestions:[],requestId};
  const [history,bookmarks,state] = await Promise.all([
    chrome.history.search({text,startTime:0,maxResults:80}).catch(()=>[]),
    chrome.bookmarks.search(text).catch(()=>[]),snapshot(sourceWindowId)
  ]);
  const suggestions=buildSuggestions(text,history,bookmarks,state.tabs);
  const settings=await chrome.storage.local.get({webSuggestions:false});
  const maySuggest=settings.webSuggestions && await chrome.permissions.contains({origins:['https://suggestqueries.google.com/*']}).catch(()=>false);
  if(maySuggest && text.length<=200 && !/^\w+:\/\//.test(text)) {
    try {
      const response=await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(text)}`,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(1400)});
      const data=await response.json();
      const existing=new Set(suggestions.filter(item=>item.type==='search').map(item=>item.query.toLocaleLowerCase()));
      for(const query of (Array.isArray(data[1])?data[1]:[]).slice(0,5)) {
        if(typeof query!=='string'||query.length>300||existing.has(query.toLocaleLowerCase()))continue;
        suggestions.push({id:`web:${query}`,type:'search',title:query,query});existing.add(query.toLocaleLowerCase());
      }
    }catch{}
  }
  return {suggestions,requestId};
}

async function closePalette() {
  if (popupWindowId) {
    const closing = popupWindowId;popupWindowId=null;
    try { await chrome.windows.remove(closing); } catch {}
  }
}

async function cleanRelays(windowId) {
  const ids=relayTabs.get(windowId);
  if(!ids)return;
  const remaining=await chrome.tabs.query({windowId});
  if(!remaining.some(tab=>!isLauncher(tab)))return;
  for(const id of ids) {
    try {const tab=await chrome.tabs.get(id);if(tab.windowId===windowId&&isLauncher(tab))await chrome.tabs.remove(id);}catch{}
  }
  relayTabs.delete(windowId);
}

async function execute(item, disposition, sourceWindowId) {
  if (!item || typeof item!=='object') throw new Error('Choose a tab or suggestion.');
  if (item.type==='tab') {
    const id = Number(item.tabId ?? item.id);
    const tab = await chrome.tabs.get(id);
    if ((tab.url||'').startsWith(own)) throw new Error('The launcher is not a destination tab.');
    if (tab.groupId>=0) {
      try { await chrome.tabGroups.update(tab.groupId,{collapsed:false}); } catch {}
    }
    await chrome.windows.update(tab.windowId,{focused:true});
    await chrome.tabs.update(tab.id,{active:true});
  } else {
    const win=Number.isInteger(sourceWindowId)?await chrome.windows.get(sourceWindowId):await normalWindow();
    if(win.type!=='normal')throw new Error('The original Chrome window is no longer available.');
    // Opening the palette replaces New Tab, so destinations open a new tab.
    // Never overwrite an existing page, even if a malformed caller asks to.
    const tab = await chrome.tabs.create({windowId:win.id,active:true,url:'about:blank'});
    try {
      if (item.type==='search') {
        const query=String(item.query||'').trim().slice(0,1000);
        if (!query) throw new Error('Type something to search for.');
        await chrome.search.query({tabId:tab.id,text:query});
      } else {
        const url=allowedURL(item.url);
        if (!url) throw new Error('This address cannot be opened.');
        await chrome.tabs.update(tab.id,{url});
      }
      await chrome.windows.update(win.id,{focused:true});
      await cleanRelays(win.id);
    } catch (error) { await chrome.tabs.remove(tab.id).catch(()=>{}); throw error; }
  }
  await closePalette();
  return {ok:true};
}

async function openPalette(sourceWindowId, bridgeId) {
  if (launching) return launching;
  launching = (async()=>{
    const win = await normalWindow(sourceWindowId);
    lastWindowId=win.id;
    const state=await snapshot(win.id);
    if (bridgeId) {
      const previous=previousTabs.get(win.id);
      const target=state.tabs.find(tab=>tab.id===previous)||state.tabs.find(tab=>tab.active)||[...state.tabs].sort((a,b)=>b.lastAccessed-a.lastAccessed)[0];
      if (target) await chrome.tabs.update(target.id,{active:true});
    }
    if (hostReady && hostPort) {
      hostPort.postMessage({type:'open',payload:{...state,mode:'native',shortcutModifier:'⌘'}});
    } else if (popupWindowId) {
      try { await chrome.windows.update(popupWindowId,{focused:true}); } catch { popupWindowId=null; }
    }
    if (!hostReady && !popupWindowId) {
      const width=Math.min(800,win.width||800),height=Math.min(660,win.height||660);
      const popup=await chrome.windows.create({type:'popup',url:chrome.runtime.getURL('palette.html'),width,height,left:Math.round((win.left||0)+((win.width||width)-width)/2),top:Math.round((win.top||0)+Math.max(40,((win.height||height)-height)*.25)),focused:true});
      popupWindowId=popup.id;
    }
    if (bridgeId && state.tabs.length) await chrome.tabs.remove(bridgeId).catch(()=>{});
    else if (bridgeId) {
      if(!relayTabs.has(win.id))relayTabs.set(win.id,new Set());
      relayTabs.get(win.id).add(bridgeId);
    }
    return {ok:true};
  })().finally(()=>{launching=null;});
  return launching;
}

async function handle(message,sender={}) {
  switch(message?.type) {
    case 'launch': return openPalette(sender.tab?.windowId,sender.tab?.id);
    case 'snapshot': return snapshot(message.sourceWindowId);
    case 'hotkey-snapshot': return hotkeySnapshot();
    case 'search': return search(message.query,message.requestId,message.sourceWindowId);
    case 'execute': return execute(message.item,message.disposition,message.sourceWindowId);
    case 'close': await closePalette();return {ok:true};
    default: throw new Error('Unknown launcher request.');
  }
}

chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if (sender.id!==chrome.runtime.id) return false;
  handle(message,sender).then(reply).catch(error=>reply({error:error.message}));
  return true;
});

function connectHost() {
  if (hostPort) return;
  try {
    const port=chrome.runtime.connectNative(HOST);hostPort=port;
    port.onMessage.addListener(async message=>{
      if(hostPort!==port)return;
      if (message.type==='ready') {
        const status=message.payload||message;
        if(!supportedHostVersion(status.hostVersion)) {
          hostReady=false;
          hostStatus={...status,hostVersion:typeof status.hostVersion==='string'?status.hostVersion:'unknown',
            tapActive:false,connected:false,upgradeRequired:true,minimumHostVersion:MINIMUM_HOST_VERSION};
          hostPort=null;
          // A previously registered prototype may still intercept every Chrome
          // Cmd+T. Disconnect it so its EOF handler exits and removes that tap.
          try{port.disconnect();}catch{}
          return;
        }
        hostReady=true;
        hostStatus={...status,connected:true,upgradeRequired:false,minimumHostVersion:MINIMUM_HOST_VERSION};
        return;
      }
      if (message.type==='status') {hostStatus={...hostStatus,...(message.payload||message)};return;}
      try {
        const payload=await handle(message);
        port.postMessage({type:message.type==='execute'?'executed':message.type,payload:{...payload,...(['snapshot','hotkey-snapshot'].includes(message.type)?{mode:'native',shortcutModifier:'⌘'}:{})},requestId:message.requestId});
      } catch(error) {port.postMessage({type:'error',payload:{message:error.message},requestId:message.requestId});}
    });
    port.onDisconnect.addListener(()=>{
      const unused=chrome.runtime.lastError;
      if(hostPort!==port)return;
      hostReady=false;hostPort=null;
      hostStatus={...hostStatus,connected:false,tapActive:false};
    });
  } catch {hostPort=null;hostReady=false;}
}

function pushSnapshot() {
  clearTimeout(updateTimer);
  updateTimer=setTimeout(async()=>{
    if (!hostReady||!hostPort) return;
    try {hostPort.postMessage({type:'snapshot',payload:{...await snapshot(),mode:'native',shortcutModifier:'⌘'}});}catch{}
  },120);
}
chrome.tabs.onActivated.addListener(async info=>{
  try {
    const tab=await chrome.tabs.get(info.tabId);
    if (!isLauncher(tab)) {
      const win=await chrome.windows.get(info.windowId);
      if(win.type==='normal') {lastWindowId=win.id;previousTabs.set(win.id,tab.id);}
    }
  } catch{}
  pushSnapshot();
});
for(const event of [chrome.tabs.onCreated,chrome.tabs.onRemoved,chrome.tabs.onMoved,chrome.tabs.onUpdated,chrome.tabs.onAttached,chrome.tabs.onDetached]) event.addListener(pushSnapshot);
chrome.windows.onFocusChanged.addListener(async id=>{
  if(id<0)return;
  try{const win=await chrome.windows.get(id);if(win.type==='normal')lastWindowId=id;}catch{}
});
chrome.windows.onRemoved.addListener(id=>{if(id===popupWindowId)popupWindowId=null;});
chrome.action.onClicked.addListener(tab=>openPalette(tab.windowId).catch(console.error));
chrome.commands.onCommand.addListener(command=>{if(command==='open-palette')openPalette().catch(console.error);});
chrome.runtime.onStartup.addListener(connectHost);
chrome.runtime.onInstalled.addListener(connectHost);
connectHost();
