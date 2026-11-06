import {test} from 'node:test';
import assert from 'node:assert/strict';
import {navigationURL,allowedURL,buildSuggestions,relevance} from '../extension/search.mjs';
import {decorateTabs,filterTabs,shortcutLabel,physicalShortcutCharacter} from '../extension/core.mjs';

test('tab filtering preserves browser order and original shortcut positions',()=>{
  const tabs=decorateTabs([{id:41,title:'Notes',url:'https://notes.test'},{id:42,title:'Product — Linear',url:'https://linear.app/team',groupTitle:'Product'},{id:43,title:'Product docs',url:'https://docs.test'}]);
  const matches=filterTabs(tabs,'product');
  assert.deepEqual(matches.map(tab=>tab.id),[42,43]);
  assert.deepEqual(matches.map(tab=>tab.shortcut),['2','3']);
  assert.equal(filterTabs(tabs,'linear product').length,1);
});
test('shortcuts cover digits then letters, including physical Option keys',()=>{
  assert.deepEqual([0,8,9,10,34].map(shortcutLabel),['1','9','0','A','Z']);
  assert.equal(physicalShortcutCharacter({code:'KeyA',key:'å'}),'A');
  assert.equal(physicalShortcutCharacter({code:'Digit1',key:'¡'}),'1');
  const labels=Array.from({length:160},(_,i)=>shortcutLabel(i));
  assert.equal(new Set(labels).size,labels.length);
});
test('address detection handles domains, localhost ports, and explicit URLs safely',()=>{
  assert.equal(navigationURL('example.com/docs'),'https://example.com/docs');
  assert.equal(navigationURL('localhost:3000/test'),'http://localhost:3000/test');
  assert.equal(navigationURL('https://example.com/?q=a%20b'),'https://example.com/?q=a%20b');
  assert.equal(navigationURL('chrome://settings/privacy'),'chrome://settings/privacy');
  for(const unsafe of ['javascript:alert(1)','data:text/html,hello','chrome://crash','https://user:secret@example.com','two words']) assert.equal(navigationURL(unsafe),null);
  assert.equal(allowedURL('javascript:alert(1)'),null);
});
test('suggestions combine local sources, deduplicate, omit open tabs, and search by default provider',()=>{
  const rows=buildSuggestions('twitter',[
    {title:'Twitter home',url:'https://twitter.com/',visitCount:40,lastVisitTime:Date.now()},
    {title:'Twitter engineering',url:'https://engineering.test/twitter'}
  ],[{title:'Twitter home',url:'https://twitter.com/'}],[{url:'https://engineering.test/twitter'}]);
  assert.equal(rows.filter(row=>row.url==='https://twitter.com/').length,1);
  assert.ok(!rows.some(row=>row.url==='https://engineering.test/twitter'));
  assert.equal(rows.at(-1).type,'search');
  assert.equal(rows.at(-1).query,'twitter');
  assert.ok(relevance({title:'José',url:'https://notes.test'},'jose')>0);
  assert.deepEqual(buildSuggestions(''),[]);
});
