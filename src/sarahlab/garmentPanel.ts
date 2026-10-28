/**
 * THE NEW TEE'S CONTROLS (Stage 3), in the OUTFIT tab while the new tee is worn.
 *
 * CONTRACT STUB (the contract commit): the hooks, the names a probe finds the controls by, and the class's surface are
 * what the room is written against; the body is a placeholder with no controls in it.
 */
import type { GarmentSettings, GarmentStops } from './garment/settings';

/** What the panel reads and drives; it never imports the room or the garment. */
export interface GarmentPanelHooks {
  /** The settings as they stand (the panel shows them). */
  readonly settings: () => GarmentSettings;
  /**
   * A control moved: `final` false as a finger drags, true when it lets go or taps a button. The room cuts at once for an
   * instant setting and re-tailors on `final` for the others (`settings.ts` RETAILOR_KEYS).
   */
  readonly change: (next: GarmentSettings, final: boolean) => void;
  /** Her landmarks for the lines and presets (`cuts.ts` garmentStops), null until the tee is tailored. */
  readonly stops: () => GarmentStops | null;
  /** True while the tee is being re-tailored. */
  readonly tailoring: () => boolean;
}

/** `data-field` of each control's line (its input follows it), for a probe. */
export const GARMENT_PANEL_FIELD = Object.freeze({
  length: 'sarahlab-garment-length',
  frontHem: 'sarahlab-garment-front-hem',
  backHem: 'sarahlab-garment-back-hem',
  hemCurve: 'sarahlab-garment-hem-curve',
  sleeve: 'sarahlab-garment-sleeve',
  neckDepth: 'sarahlab-garment-neck-depth',
  neckWidth: 'sarahlab-garment-neck-width',
  neckCurve: 'sarahlab-garment-neck-curve',
  bellyRoom: 'sarahlab-garment-belly-room',
  bust: 'sarahlab-garment-bust',
  waist: 'sarahlab-garment-waist',
  hip: 'sarahlab-garment-hip',
  gusset: 'sarahlab-garment-gusset',
  status: 'sarahlab-garment-status',
});

/** `data-action` of each button, for a probe: `${lengthStop}<stop id>`, `${sleeveStop}<stop id>`, `${construction}<raglan|setIn>`. */
export const GARMENT_PANEL_ACTION = Object.freeze({
  lengthStop: 'sarahlab:garment:length:',
  sleeveStop: 'sarahlab:garment:sleeve:',
  construction: 'sarahlab:garment:construction:',
  defaults: 'sarahlab:garment:defaults',
});

export class GarmentPanel {
  readonly element: HTMLElement;
  private readonly hooks: GarmentPanelHooks;

  constructor(hooks: GarmentPanelHooks) {
    this.hooks = hooks;
    this.element = document.createElement('div');
    this.element.dataset.tab = 'outfit';
    this.element.dataset.role = 'sarahlab-garment-panel';
  }

  /** Show the settings, lines and state as they stand now (the room calls it from its own refresh). */
  refresh(): void { void this.hooks; }

  dispose(): void { this.element.remove(); }
}
