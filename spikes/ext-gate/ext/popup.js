// globalThis.__tabId lets the test harness target a tab from a popup page opened as a tab. Everything else is the real button path.
const tabId = async () => globalThis.__tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id;
const render = async () => { const id = await tabId(); const s = (await chrome.storage.session.get('tab:' + id))['tab:' + id];
  document.getElementById('out').textContent = s ? `${s.scripts.length} scripts, done ${s.doneMs} ms` : 'not attached'; };
document.getElementById('check').onclick = async () => { globalThis.__last = await chrome.runtime.sendMessage({ type: 'start', tabId: await tabId(), opts: globalThis.__opts }); render(); };
document.getElementById('finish').onclick = async () => { globalThis.__last = await chrome.runtime.sendMessage({ type: 'finish', tabId: await tabId() }); render(); };
