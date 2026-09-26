// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TombsHud, type TombsReadout } from '../src/tombs/TombsHud';
import { planLab } from '../src/world/tombs';
import { TOMBS_ACTION } from '../src/tombs/tombsTool';

describe('cinematic laboratory HUD', () => {
  it('keeps scene-owned actions, quotes and line boundaries intact', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const r = { room: 'Diagnostic laboratory', lighting: 'normal', running: false,
      drawCalls: 0, standing: 2, missing: 0, fps: 60, x: 0, y: 0, z: 0,
      walking: false, stance: 'stand', sprinting: false, prompt: '', reachLabel: '',
      audioRunning: false, decoded: 0, failed: 0, playing: 0,
      lineAt: 0, lineCount: 3, speaker: '', text: '', beatTitle: '' } satisfies TombsReadout;
    const actions: string[] = [];
    const hud = new TombsHud(host, planLab().rooms, { readout: () => r, onAction: a => actions.push(a) });
    const button = (action: string) => host.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
    button(TOMBS_ACTION.audio).click();
    expect(actions).toEqual([TOMBS_ACTION.audio]);
    expect(button(TOMBS_ACTION.prevLine)).toBeNull();
    r.lineAt = 2; r.speaker = 'Sarah Bennett'; r.text = 'Too clean.'; r.beatTitle = 'Too clean';
    hud.refreshNow();
    expect(host.querySelector('[data-field="tombs-line"]')?.textContent).toBe('Too clean.');
    button(TOMBS_ACTION.prevLine).click();
    expect(actions.at(-1)).toBe(TOMBS_ACTION.prevLine);
    const scroll = host.querySelector<HTMLElement>('.tombs-dialogue-text')!;
    scroll.scrollTop = 150;
    hud.refreshNow();
    expect(scroll.scrollTop).toBe(150);
    r.lineAt = 3; hud.refreshNow();
    expect(scroll.scrollTop).toBe(0);
    expect(button(TOMBS_ACTION.audio).disabled).toBe(true);
    button(TOMBS_ACTION.audio).click();
    expect(actions.length).toBe(2);
    expect(host.querySelector('details')?.open).toBe(false);
    button(TOMBS_ACTION.back).click();
    expect(actions.at(-1)).toBe(TOMBS_ACTION.back);
    hud.dispose();
    expect(host.childElementCount).toBe(0);
    host.remove();
  });
});
