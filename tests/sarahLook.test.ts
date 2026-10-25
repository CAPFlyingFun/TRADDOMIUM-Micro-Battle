import { describe, expect, it } from 'vitest';
import { parseShape } from '../src/actor/bodyShape';
import { SARAH_LOOK } from '../src/sarahlab/sarahLook';
import { OUTFITS, SARAH_LEGGINGS } from '../src/sarahlab/sarahLabTool';

describe('Sarah as Joshua set her (2026-10-24: "Here is Sarah and the minor tweaks I did")', () => {
  it('reads back through the saves\' own door, exactly as his phone saved her', () => {
    expect(SARAH_LOOK).not.toBeNull();
    const look = SARAH_LOOK!;
    expect(look.body.model).toBe('v2-body');
    expect(look.body.bump).toBe(73);
    expect(parseShape(look.body.shape).navel).toBe(20);
    expect(OUTFITS.some((o) => o.name === look.clothes.outfit)).toBe(true);
  });

  it('wears his tee dye and the charcoal leggings, their detail held as he set it', () => {
    const c = SARAH_LOOK!.clothes;
    expect(c.garments.shirtSpandexLite?.fabric).toEqual({ family: 'athletic', colour: 8 });
    const legs = c.layers[0]!;
    expect(legs.template?.id).toBe('leggingsFull');
    expect(legs.choice.fabric?.tint).toBe(SARAH_LEGGINGS);
    expect(legs.detail?.override).toEqual({ nipple: 0.45, navel: 0.8 });
  });
});
