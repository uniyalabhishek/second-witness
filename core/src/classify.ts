import type { ParsedScript, ScriptClass, Site } from './types.ts';

/**
 * First match wins, and the order matters:
 * - A page can give code any `url` through `//# sourceURL`, so that label is never believed. `embedderName`
 *   is the address the browser really loaded, which keeps a labelled file comparable and leaves eval'd code
 *   with no address. Where it's missing, anything labelled counts as eval.
 * - External files always start at 0,0 and inline scripts never do. That offset still holds after an
 *   SPA navigation, when the tab URL no longer equals the document URL an inline script reports.
 */
export function classify(script: ParsedScript, site: Site): ScriptClass {
  const address = script.embedderName ?? (script.hasSourceURL ? '' : script.url);
  if (script.isolated) return { kind: 'ignored' };
  if (address.startsWith('chrome-extension://')) return { kind: 'ignored' };
  if (script.language === 'WebAssembly') return { kind: 'uncompared', reason: 'wasm' };
  if (address === '') return { kind: 'uncompared', reason: 'eval' };
  if (script.startLine !== 0 || script.startColumn !== 0) return { kind: 'uncompared', reason: 'inline' };

  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { kind: 'uncompared', reason: 'eval' };
  }
  // blob:, data: and the like are code built at runtime. There's no file to compare.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'uncompared', reason: 'eval' };
  if (!site.origins.includes(url.origin)) {
    return { kind: 'thirdParty', host: url.hostname, listed: site.thirdParty.includes(url.hostname) };
  }
  return { kind: 'file', path: url.pathname };
}
