const toggle=document.getElementById('web');
const status=document.getElementById('status');
async function updateCompanionStatus(){
  try{
    const data=await chrome.runtime.sendMessage({type:'snapshot'});
    const native=data.native||{};
    document.getElementById('companion-status').textContent=native.upgradeRequired
      ? `Companion upgrade required (version ${native.minimumHostVersion||'1.1.0'} or later). Run python3 install.py --apply --rebuild-native, then reload this extension. The extension-only launcher remains available.`
      : native.tapActive
      ? 'Direct Cmd+T capture is active.'
      : native.accessibilityTrusted ? 'Accessibility is enabled; direct Cmd+T capture is not active.'
      : 'The companion is waiting for Accessibility approval or a restart.';
  }catch{document.getElementById('companion-status').textContent='The companion is not connected.';}
}
updateCompanionStatus();setInterval(updateCompanionStatus,3000);
toggle.checked=(await chrome.storage.local.get({webSuggestions:false})).webSuggestions;
toggle.addEventListener('change',async()=>{
  if(toggle.checked){
    const allowed=await chrome.permissions.request({origins:['https://suggestqueries.google.com/*']});
    if(!allowed){toggle.checked=false;status.textContent='Google suggestions remain off.';return;}
  }
  await chrome.storage.local.set({webSuggestions:toggle.checked});
  if(!toggle.checked) await chrome.permissions.remove({origins:['https://suggestqueries.google.com/*']});
  status.textContent=toggle.checked?'Google suggestions enabled.':'Local suggestions only.';
});
