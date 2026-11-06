globalThis.__keepIso = () => 'isolated world content script';
// Older wallets: inject the provider as a <script src=chrome-extension://...> tag, and sometimes as an inline tag.
const s = document.createElement('script'); s.src = chrome.runtime.getURL('inpage-war.js'); (document.head || document.documentElement).append(s);
const i = document.createElement('script'); i.textContent = 'window.__walletInline = () => "inline tag injected by a wallet";'; (document.head || document.documentElement).append(i);
