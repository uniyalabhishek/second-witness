import type { ResultKind, Verdict } from '../../core/src/types.ts';

/** What the service worker stores for a tab and the popup renders. Serialisable. */
export type PopupState =
  | { phase: 'idle'; host: string; listed: boolean; catalogueAgeSeconds: number | null; lastCheck?: { result: ResultKind; finishedAt: number }; attachFailed?: boolean }
  | { phase: 'checking'; host: string; hashed: number; total: number; startedAt: number; catalogueAgeSeconds: number | null }
  | { phase: 'attached'; host: string; verdict: Verdict; scriptsSeen: number; updatedAt: number };
