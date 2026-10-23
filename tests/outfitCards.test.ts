// @vitest-environment jsdom
/**
 * The OUTFIT section's picture cards (src/sarahlab/outfitCards.ts): every outfit as a card with a picture of her in
 * it, a tap to wear it, a ✕ that asks once before deleting, names that are only ever text, and cards kept by id so a
 * refresh never reloads a picture that did not change.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type OutfitCard, OUTFIT_CARDS_ROLE, outfitCards } from '../src/sarahlab/outfitCards';

const A = 'https://example.test/a.jpg', B = 'data:image/jpeg;base64,/9j/AAAA';
const card = (id: string, extra: Partial<OutfitCard> = {}): OutfitCard => ({ id, name: id, action: `wear:${id}`, ...extra });
const wrapOf = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-card-id="${id}"]`)!;
const mainOf = (root: HTMLElement, id: string) => wrapOf(root, id).querySelector<HTMLButtonElement>('button')!;
const xOf = (root: HTMLElement, id: string) => wrapOf(root, id).querySelector<HTMLButtonElement>('button[title]');
const imgOf = (root: HTMLElement, id: string) => wrapOf(root, id).querySelector('img');
const svgOf = (root: HTMLElement, id: string) => wrapOf(root, id).querySelector('svg');

function setup(withRemove = true) {
  const onPick = vi.fn<(id: string) => void>(), onRemove = vi.fn<(id: string) => void>();
  const cards = outfitCards(withRemove ? { onPick, onRemove } : { onPick });
  document.body.appendChild(cards.element);
  return { cards, root: cards.element, onPick, onRemove };
}

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('the outfit cards', () => {
  it('is a grid with its role, and shows the cards in the order given with their name and note', () => {
    const { cards, root } = setup();
    expect(root.dataset.role).toBe(OUTFIT_CARDS_ROLE);
    expect(root.style.display).toBe('grid');
    cards.set([card('b', { name: 'Sarah casual', note: '3 painted pieces · worn by Lena' }), card('a', { name: 'Painted tee', note: 'Built-in' }), card('c')]);
    const wraps = [...root.children] as HTMLElement[];
    expect(wraps.map((w) => w.dataset.cardId)).toEqual(['b', 'a', 'c']);
    expect(wraps[0].textContent).toContain('Sarah casual');
    expect(wraps[0].textContent).toContain('3 painted pieces · worn by Lena');
    expect(wraps[1].textContent).toContain('Built-in');
    const main = mainOf(root, 'b');
    expect(main.type).toBe('button');
    expect(main.dataset.action).toBe('wear:b');
    expect(main.getAttribute('aria-label')).toBe('Sarah casual');
  });

  it('shows a hostile name as text and never builds markup from it', () => {
    const { cards, root } = setup();
    const evil = '<img src=x onerror=alert(1)>';
    cards.set([card('evil', { name: evil, note: '<b>bold</b>', thumb: null }), card('ok', { thumb: A }), card('ok2', { thumb: B })]);
    expect(root.querySelectorAll('img')).toHaveLength(2); // exactly the thumbs that are set
    expect(root.querySelector('b')).toBeNull();
    expect(wrapOf(root, 'evil').textContent).toContain(evil);
    expect(mainOf(root, 'evil').getAttribute('aria-label')).toBe(evil);
  });

  it('a tap on a card picks it', () => {
    const { cards, root, onPick, onRemove } = setup();
    cards.set([card('a'), card('b', { remove: { action: 'delete:b' } })]);
    mainOf(root, 'b').click();
    expect(onPick).toHaveBeenCalledExactlyOnceWith('b');
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('rings only what she has on now', () => {
    const { cards, root } = setup();
    cards.set([card('a'), card('b', { worn: true }), card('c', { worn: false })]);
    expect(['a', 'b', 'c'].map((id) => mainOf(root, id).getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(mainOf(root, 'b').style.boxShadow).toContain('--sl-accent');
    expect(mainOf(root, 'a').style.boxShadow).toBe('');
    cards.set([card('a', { worn: true }), card('b'), card('c')]);
    expect(['a', 'b', 'c'].map((id) => mainOf(root, id).getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(mainOf(root, 'b').style.boxShadow).toBe('');
  });

  it('the ✕ asks once: the first tap arms it, the second deletes', () => {
    const { cards, root, onPick, onRemove } = setup();
    cards.set([card('s', { remove: { action: 'delete:s' } })]);
    const x = xOf(root, 's')!;
    expect(x.dataset.action).toBe('delete:s');
    expect(x.title).toBe('delete (tap twice)');
    expect(x.textContent).toBe('✕');
    x.click();
    expect(x.textContent).toBe('DELETE?');
    expect(x.style.borderColor).toContain('--sl-danger');
    expect(onRemove).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
    x.click();
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('s');
    expect(onPick).not.toHaveBeenCalled();
    expect(x.textContent).toBe('✕');
  });

  it('an armed ✕ lets go after four seconds', () => {
    vi.useFakeTimers();
    const { cards, root, onRemove } = setup();
    cards.set([card('s', { remove: { action: 'delete:s' } })]);
    const x = xOf(root, 's')!;
    x.click();
    vi.advanceTimersByTime(3999);
    expect(x.textContent).toBe('DELETE?');
    vi.advanceTimersByTime(1);
    expect(x.textContent).toBe('✕');
    expect(x.style.borderColor).not.toContain('--sl-danger');
    x.click(); // arms again, does not delete
    expect(onRemove).not.toHaveBeenCalled();
    expect(x.textContent).toBe('DELETE?');
  });

  it('the ✕ click does not reach anything behind it', () => {
    const { cards, root } = setup();
    const outside = vi.fn();
    document.body.addEventListener('click', outside);
    cards.set([card('s', { remove: { action: 'delete:s' } })]);
    xOf(root, 's')!.click();
    mainOf(root, 's').click();
    expect(outside).not.toHaveBeenCalled();
    document.body.removeEventListener('click', outside);
  });

  it('has no ✕ where nothing can be deleted', () => {
    const { cards, root } = setup();
    cards.set([card('builtin'), card('saved', { remove: { action: 'delete:saved' } })]);
    expect(xOf(root, 'builtin')).toBeNull();
    expect(xOf(root, 'saved')).not.toBeNull();
    cards.set([card('builtin'), card('saved')]);
    expect(xOf(root, 'saved')).toBeNull();
    // a ✕ with no hook to call would only look functional
    const bare = setup(false);
    bare.cards.set([card('saved', { remove: { action: 'delete:saved' } })]);
    expect(xOf(bare.root, 'saved')).toBeNull();
  });

  it('keeps the very same picture when the thumb has not changed, and updates it when it has', () => {
    const { cards, root } = setup();
    cards.set([card('a', { thumb: A }), card('b', { thumb: B })]);
    const img = imgOf(root, 'a')!, src = img.src;
    expect(img.alt).toBe('a');
    expect(img.loading).toBe('lazy');
    expect(img.decoding).toBe('async');
    expect(img.draggable).toBe(false);
    expect(img.style.objectFit).toBe('cover');
    expect(src).toBe(A);
    cards.set([card('b', { thumb: B }), card('a', { thumb: A, name: 'renamed', worn: true })]);
    expect(imgOf(root, 'a')).toBe(img);
    expect(img.src).toBe(src);
    expect(img.alt).toBe('renamed');
    expect([...root.children].map((w) => (w as HTMLElement).dataset.cardId)).toEqual(['b', 'a']);
    cards.set([card('b', { thumb: B }), card('a', { thumb: B })]);
    expect(imgOf(root, 'a')!.src).toBe(B);
  });

  it('shows the silhouette for no picture or a broken one, and tries a new picture again', () => {
    const { cards, root } = setup();
    cards.set([card('none', { thumb: null }), card('undef'), card('bad', { thumb: A })]);
    expect(svgOf(root, 'none')).not.toBeNull();
    expect(svgOf(root, 'undef')).not.toBeNull();
    expect(imgOf(root, 'none')).toBeNull();
    expect(svgOf(root, 'bad')).toBeNull();
    const img = imgOf(root, 'bad')!;
    img.dispatchEvent(new Event('error'));
    expect(imgOf(root, 'bad')).toBeNull();
    expect(svgOf(root, 'bad')).not.toBeNull();
    cards.set([card('bad', { thumb: A })]); // the same broken thumb is not retried
    expect(svgOf(root, 'bad')).not.toBeNull();
    cards.set([card('bad', { thumb: B })]);
    expect(svgOf(root, 'bad')).toBeNull();
    expect(imgOf(root, 'bad')!.src).toBe(B);
    cards.set([card('bad', { thumb: null })]);
    expect(svgOf(root, 'bad')).not.toBeNull();
    expect(imgOf(root, 'bad')).toBeNull();
  });

  it('drops the cards a later set() leaves out', () => {
    const { cards, root } = setup();
    cards.set([card('a'), card('b'), card('c')]);
    const c = wrapOf(root, 'c');
    cards.set([card('c'), card('a')]);
    expect([...root.children].map((w) => (w as HTMLElement).dataset.cardId)).toEqual(['c', 'a']);
    expect(wrapOf(root, 'c')).toBe(c);
    expect(root.querySelector('[data-card-id="b"]')).toBeNull();
    cards.set([]);
    expect(root.children).toHaveLength(0);
  });

  it('keeps pointer and wheel events off the 3D view behind it', () => {
    const { cards, root } = setup();
    const parent = document.createElement('div');
    parent.appendChild(root);
    document.body.appendChild(parent);
    const behind = vi.fn();
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) parent.addEventListener(ev, behind);
    cards.set([card('a')]);
    const main = mainOf(root, 'a');
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) main.dispatchEvent(new Event(ev, { bubbles: true }));
    expect(behind).not.toHaveBeenCalled();
  });

  it('dispose clears its timers, its listeners and its cards', () => {
    vi.useFakeTimers();
    const { cards, root, onRemove } = setup();
    const parent = document.createElement('div');
    parent.appendChild(root);
    const behind = vi.fn();
    parent.addEventListener('pointerdown', behind);
    cards.set([card('s', { remove: { action: 'delete:s' } }), card('t', { thumb: A })]);
    xOf(root, 's')!.click();
    expect(vi.getTimerCount()).toBe(1);
    cards.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(root.children).toHaveLength(0);
    root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(behind).toHaveBeenCalledOnce();
    cards.set([card('late')]);
    expect(root.children).toHaveLength(0);
    expect(onRemove).not.toHaveBeenCalled();
  });
});
