chrome.runtime.sendMessage({type:'launch'}).then(result=>{
  if(result?.error) document.getElementById('status').textContent=result.error;
}).catch(()=>{document.getElementById('status').textContent='Use the launcher link below, or reload the extension.';});
