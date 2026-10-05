import type {SaveState} from './state';

/** The opening belongs to the first two canonical wake narration lines. */
export function openingSegment(save: Pick<SaveState, 'queue'|'line'>): 0|1|null {
  return save.queue === 'wake' && (save.line === 0 || save.line === 1) ? save.line : null;
}