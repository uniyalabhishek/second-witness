import replay from '../../replay/output.json';
import { installCopy } from '../../extension/src/format.ts';
import { ARKIV_RPC, fetchCatalogue, fetchRoster, SEPOLIA_RPC } from '../../reader/src/index.ts';
import { renderFeed, renderWithoutRecords } from './render.ts';

const app = document.getElementById('app')!;
installCopy();
app.innerHTML = renderWithoutRecords(replay, 'Reading witness records.');

try {
  const roster = await fetchRoster(SEPOLIA_RPC);
  const catalogue = await fetchCatalogue(ARKIV_RPC, roster, Date.now());
  app.innerHTML = renderFeed({ catalogue, replay, now: Date.now() });
} catch {
  app.innerHTML = renderWithoutRecords(replay, "Witness records couldn't be read right now.");
}
