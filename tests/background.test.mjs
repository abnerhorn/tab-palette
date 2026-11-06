import {test} from 'node:test';
import assert from 'node:assert/strict';

const signal=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}});
const runtimeMessages=signal();
const nativeMessages=signal();
const calls=[];
const nativePorts=[];
let nativeDisconnects=0;
const tabs=new Map([
  [11,{id:11,windowId:1,index:0,title:'First',url:'https://first.test/',active:false,groupId:-1,lastAccessed:10}],
  [12,{id:12,windowId:1,index:1,title:'Second',url:'https://second.test/',active:true,groupId:3,lastAccessed:100}],
  [21,{id:21,windowId:2,index:0,title:'Other window',url:'https://other.test/',active:true,groupId:-1}],
]);
const own='chrome-extension://testid/';
let webSuggestions=false;
let webRequests=0;
let faviconRequests=0;
let webPermission=true;
let focusedWindowId=1;
let tabQueryCalls=0;
let focusAfterTabQuery;
let windowsQueryFails=false;
const incognitoWindowIds=new Set();
const popupWindowIds=new Set();
const closedWindowIds=new Set();
const mockWindow=id=>({id,type:popupWindowIds.has(id)?'popup':'normal',focused:id===focusedWindowId,incognito:incognitoWindowIds.has(id),left:0,top:0,width:1400,height:900});
globalThis.fetch=async(url,options)=>{if(String(url).startsWith(own+'_favicon/')){faviconRequests++;return {ok:false};}webRequests++;assert.match(url,/^https:\/\/suggestqueries\.google\.com\//);assert.equal(options.credentials,'omit');return {json:async()=>['hello',['hello','hello world','hello there']]};};
globalThis.chrome={
  runtime:{getURL:path=>own+path,id:'testid',onMessage:runtimeMessages,onStartup:signal(),onInstalled:signal(),connectNative(){const port={postMessage(message){calls.push(['native',message]);},onMessage:nativePorts.length?signal():nativeMessages,onDisconnect:signal(),disconnect(){nativeDisconnects++;for(const listener of this.onDisconnect.listeners)listener();}};nativePorts.push(port);return port;}},
  permissions:{contains:async()=>webPermission},
  windows:{get:async id=>{if(closedWindowIds.has(id))throw Error('Window closed');return mockWindow(id);},getAll:async options=>{if(windowsQueryFails)throw Error('Cannot enumerate windows');return [1,2,3,4].filter(id=>!closedWindowIds.has(id)).map(mockWindow).filter(win=>!options.windowTypes||options.windowTypes.includes(win.type));},getLastFocused:async()=>mockWindow(1),create:async info=>{calls.push(['window.create',info]);return {id:99};},update:async(id,info)=>{calls.push(['window.update',id,info]);},remove:async id=>{calls.push(['window.remove',id]);},onFocusChanged:signal(),onRemoved:signal()},
  tabs:{query:async query=>{tabQueryCalls++;const matching=[...tabs.values()].filter(tab=>tab.windowId===query.windowId);if(focusAfterTabQuery!==undefined){focusedWindowId=focusAfterTabQuery;focusAfterTabQuery=undefined;}return matching;},get:async id=>{if(!tabs.has(id))throw Error('Tab closed');return tabs.get(id);},create:async info=>{const tab={id:50,...info};tabs.set(50,tab);calls.push(['tab.create',info]);return tab;},update:async(id,info)=>{if(!tabs.has(id))throw Error('Tab closed');Object.assign(tabs.get(id),info);calls.push(['tab.update',id,info]);return tabs.get(id);},remove:async id=>{tabs.delete(id);calls.push(['tab.remove',id]);},onActivated:signal(),onCreated:signal(),onRemoved:signal(),onMoved:signal(),onUpdated:signal(),onAttached:signal(),onDetached:signal()},
  tabGroups:{get:async id=>({id,title:'Work',color:'blue'}),update:async(id,info)=>{calls.push(['group.update',id,info]);}},
  history:{search:async()=>[{title:'First result',url:'https://first-result.test/'}]},bookmarks:{search:async()=>[]},search:{query:async info=>{calls.push(['search',info]);}},storage:{local:{get:async defaults=>({...defaults,webSuggestions})}},action:{onClicked:signal()},commands:{onCommand:signal()}
};
await import('../extension/background.js');
const send=(message,sender={id:'testid'})=>new Promise(resolve=>runtimeMessages.listeners[0](message,sender,resolve));
const reconnectNative=()=>{nativePorts.at(-1)?.disconnect();chrome.runtime.onStartup.listeners[0]();return nativePorts.at(-1);};
const nativeReady=(payload,port=nativePorts.at(-1))=>port.onMessage.listeners[0]({type:'ready',payload});

test('snapshot is current normal window order, with group labels and no other-window tabs',async()=>{
  const result=await send({type:'snapshot'});
  assert.deepEqual(result.tabs.map(tab=>tab.id),[11,12]);
  assert.deepEqual(result.tabs.map(tab=>tab.index),[0,1]);
  assert.equal(result.tabs[1].groupTitle,'Work');
});
test('new-tab relay returns to origin and closes only its disposable launcher',async()=>{
  tabs.set(30,{id:30,windowId:1,index:2,url:'chrome://newtab/',active:true,groupId:-1,lastAccessed:200});
  tabs.get(12).active=false;
  const result=await send({type:'launch'},{id:'testid',tab:tabs.get(30)});
  assert.equal(result.ok,true);
  assert.ok(calls.some(call=>call[0]==='tab.update'&&call[1]===12&&call[2].active));
  assert.ok(calls.some(call=>call[0]==='tab.remove'&&call[1]===30));
  assert.ok(tabs.has(11)&&tabs.has(12));
});
test('tab activation expands group and focuses its existing window',async()=>{
  const result=await send({type:'execute',item:{type:'tab',tabId:12}});
  assert.equal(result.ok,true);
  assert.ok(calls.some(call=>call[0]==='group.update'&&call[1]===3&&call[2].collapsed===false));
  assert.ok(calls.some(call=>call[0]==='window.update'&&call[1]===1&&call[2].focused));
});
test('search respects default provider and never overwrites the active page',async()=>{
  const before=tabs.get(12).url;
  const result=await send({type:'execute',item:{type:'search',query:'hello world'},disposition:'current'});
  assert.equal(result.ok,true);
  assert.equal(tabs.get(12).url,before);
  assert.ok(calls.some(call=>call[0]==='search'&&call[1].text==='hello world'&&call[1].tabId===50));
});
test('unsafe addresses are rejected and temporary destination removed',async()=>{
  const result=await send({type:'execute',item:{type:'url',url:'javascript:alert(1)'}});
  assert.match(result.error,/cannot be opened/);
  assert.ok(!tabs.has(50));
});
test('navigation remains in the palette source window after focus changes',async()=>{
  const result=await send({type:'execute',sourceWindowId:2,item:{type:'url',url:'https://destination.test/'}});
  assert.equal(result.ok,true);
  assert.equal(tabs.get(50).windowId,2);
});
test('local suggestions make no remote requests until explicitly enabled',async()=>{
  const result=await send({type:'search',query:'first',requestId:1});
  assert.equal(result.requestId,1);
  assert.ok(result.suggestions.some(item=>item.type==='history'));
  assert.equal(webRequests,0);
  webSuggestions=true;
  const online=await send({type:'search',query:'hello',requestId:2});
  assert.equal(webRequests,1);
  assert.ok(online.suggestions.some(item=>item.query==='hello world'));
  assert.equal(online.suggestions.filter(item=>item.query==='hello').length,1);
  await send({type:'search',query:'https://private.test/?token=secret',requestId:3});
  assert.equal(webRequests,1);
  webPermission=false;
  await send({type:'search',query:'private words',requestId:4});
  assert.equal(webRequests,1);
});
test('empty-window relay is removed once a real destination exists',async()=>{
  tabs.set(40,{id:40,windowId:3,index:0,url:'chrome://newtab/',active:true,groupId:-1});
  await send({type:'launch'},{id:'testid',tab:tabs.get(40)});
  assert.ok(tabs.has(40));
  await send({type:'execute',sourceWindowId:3,item:{type:'url',url:'https://first-page.test/'}});
  assert.equal(tabs.get(50).windowId,3);
  assert.ok(!tabs.has(40));
});

test('native hotkey returns only the currently focused regular-profile window',async()=>{
  focusedWindowId=2;
  const beforeIcons=faviconRequests;
  const result=await send({type:'hotkey-snapshot'});
  assert.equal(result.eligible,true);
  assert.equal(result.sourceWindowId,2);
  assert.deepEqual(result.tabs.map(tab=>tab.id),[21]);
  assert.equal(faviconRequests,beforeIcons,'eligibility must not await cold favicon requests');
});

test('native hotkey never falls back to a remembered window when this profile is not focused',async()=>{
  // A regular window was just eligible, and earlier calls populated lastWindowId.
  // An unsupported Chrome profile or another app may now hold keyboard focus.
  focusedWindowId=null;
  const beforeQueries=tabQueryCalls;
  const result=await send({type:'hotkey-snapshot'});
  assert.deepEqual(result,{eligible:false,reason:'unsupported-window'});
  assert.equal(tabQueryCalls,beforeQueries);
  assert.equal('tabs' in result,false);
});

test('native hotkey rejects focused Incognito and popup windows without reading their tabs',async()=>{
  focusedWindowId=4;incognitoWindowIds.add(4);
  const beforeQueries=tabQueryCalls;
  assert.deepEqual(await send({type:'hotkey-snapshot'}),{eligible:false,reason:'unsupported-window'});
  incognitoWindowIds.delete(4);popupWindowIds.add(4);
  assert.deepEqual(await send({type:'hotkey-snapshot'}),{eligible:false,reason:'unsupported-window'});
  assert.equal(tabQueryCalls,beforeQueries);
  popupWindowIds.delete(4);
});

test('native hotkey discards a snapshot if focus changes during its asynchronous read',async()=>{
  focusedWindowId=1;focusAfterTabQuery=2;
  const result=await send({type:'hotkey-snapshot'});
  assert.deepEqual(result,{eligible:false,reason:'unsupported-window'});
  assert.equal('tabs' in result,false);
});

test('native hotkey fails closed when window enumeration is unavailable',async()=>{
  focusedWindowId=1;windowsQueryFails=true;
  const beforeQueries=tabQueryCalls;
  assert.deepEqual(await send({type:'hotkey-snapshot'}),{eligible:false,reason:'unsupported-window'});
  assert.equal(tabQueryCalls,beforeQueries);
  windowsQueryFails=false;
});

test('native hotkey protocol echoes eligibility and request ID without changing existing snapshot behavior',async()=>{
  focusedWindowId=2;
  const requestId='native-hotkey-test';
  await nativeMessages.listeners[0]({type:'hotkey-snapshot',requestId});
  const reply=calls.findLast(call=>call[0]==='native'&&call[1].requestId===requestId)?.[1];
  assert.equal(reply.type,'hotkey-snapshot');
  assert.equal(reply.payload.eligible,true);
  assert.equal(reply.payload.sourceWindowId,2);
  assert.equal(reply.payload.mode,'native');
  assert.equal(reply.payload.shortcutModifier,'⌘');
  focusedWindowId=null;
  await nativeMessages.listeners[0]({type:'hotkey-snapshot',requestId:'native-hotkey-unsupported'});
  const denied=calls.findLast(call=>call[0]==='native'&&call[1].requestId==='native-hotkey-unsupported')?.[1];
  assert.equal(denied.payload.eligible,false);
  assert.equal('tabs' in denied.payload,false);
  // Toolbar/popup snapshots may still explicitly target a normal source window.
  const regular=await send({type:'snapshot',sourceWindowId:1});
  assert.equal(regular.sourceWindowId,1);
  assert.ok(regular.tabs.length>0);
});

test('native ready handshake accepts current and newer compatible numeric versions',async()=>{
  for(const hostVersion of ['1.1.0','1.1.2','1.2.0','2.0.0']) {
    const port=reconnectNative();
    const before=nativeDisconnects;
    await nativeReady({hostVersion,tapActive:true,accessibilityTrusted:true},port);
    const {native}=await send({type:'snapshot',sourceWindowId:1});
    assert.equal(native.connected,true);
    assert.equal(native.upgradeRequired,false);
    assert.equal(native.tapActive,true);
    assert.equal(nativeDisconnects,before);
  }
});

test('old native host is disconnected and cannot overwrite the upgrade hint with stale status',async()=>{
  const port=reconnectNative();
  const before=nativeDisconnects;
  await nativeReady({hostVersion:'1.0.0',tapActive:true,accessibilityTrusted:true},port);
  assert.equal(nativeDisconnects,before+1);
  await port.onMessage.listeners[0]({type:'status',payload:{tapActive:true,upgradeRequired:false}});
  const {native}=await send({type:'snapshot',sourceWindowId:1});
  assert.equal(native.upgradeRequired,true);
  assert.equal(native.minimumHostVersion,'1.1.0');
  assert.equal(native.hostVersion,'1.0.0');
  assert.equal(native.connected,false);
  assert.equal(native.tapActive,false);
});

test('missing and malformed host version metadata are rejected as unsupported',async()=>{
  for(const hostVersion of [undefined,null,'unknown','v1.1.0','1.1.0-beta','999999999999999999999.0.0']) {
    const port=reconnectNative();
    const before=nativeDisconnects;
    await nativeReady({hostVersion,tapActive:true},port);
    const {native}=await send({type:'snapshot',sourceWindowId:1});
    assert.equal(native.upgradeRequired,true);
    assert.equal(native.tapActive,false);
    assert.equal(nativeDisconnects,before+1);
  }
});

test('extension-only launcher remains usable after an incompatible companion is disconnected',async()=>{
  const port=reconnectNative();
  await nativeReady({hostVersion:'1.0.0',tapActive:true},port);
  const beforeWindows=calls.filter(call=>call[0]==='window.create').length;
  const beforeNative=calls.filter(call=>call[0]==='native'&&call[1].type==='open').length;
  const result=await send({type:'launch'},{id:'testid',tab:tabs.get(11)});
  assert.equal(result.ok,true);
  assert.equal(calls.filter(call=>call[0]==='window.create').length,beforeWindows+1);
  assert.equal(calls.filter(call=>call[0]==='native'&&call[1].type==='open').length,beforeNative);
});

test('a compatible reconnect clears upgrade status and ignores an old port’s late disconnect',async()=>{
  const old=nativePorts.at(-1);
  const port=reconnectNative();
  await nativeReady({hostVersion:'1.1.0',tapActive:true},port);
  for(const listener of old.onDisconnect.listeners)listener();
  const {native}=await send({type:'snapshot',sourceWindowId:1});
  assert.equal(native.upgradeRequired,false);
  assert.equal(native.connected,true);
  assert.equal(native.tapActive,true);
});
