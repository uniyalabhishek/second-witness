import { installCopy } from './format.ts';
import { render, renderUnavailable } from './render.ts';
import type { PopupState } from './state.ts';

const app = document.getElementById('app')!;
// The end-to-end test opens this page as a tab, so it names the tab being checked. Chrome's popup has no query string.
const tabId = Number(new URLSearchParams(location.search).get('tab')) || undefined;

async function refresh(): Promise<void> {
  try {
    const state = (await chrome.runtime.sendMessage({ type: 'getState', tabId })) as PopupState | undefined;
    app.innerHTML = state ? render(state, Date.now()) : renderUnavailable();
  } catch {
    app.innerHTML = renderUnavailable();
  }
}

app.addEventListener('click', async e => {
  const action = (e.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
  if (!action) return;
  try {
    await chrome.runtime.sendMessage({ type: action, tabId });
  } finally {
    await refresh();
  }
});

installCopy();
chrome.storage.onChanged.addListener(() => void refresh());
void refresh();
