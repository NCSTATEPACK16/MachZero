import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus, type MenuEvents } from '../../core/events';
import { resultsOpenOf } from '../../game/modes/raceResult';
import { AudioSystem } from '../AudioSystem';
import { PRESET_IDS } from '../sfx/presets';
import { FakeAudioContext, makeFakeDom } from './fakeAudio';

beforeEach(() => FakeAudioContext.reset('running'));
afterEach(() => vi.unstubAllGlobals());

function setup(modern = true) {
  const dom = makeFakeDom();
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('navigator', dom.navigator);
  const audio = new AudioSystem({ modern });
  dom.fire('pointerdown');
  for (const id of PRESET_IDS) audio.bank.addRendered(id, new Float32Array(64).fill(0.3), 44100);
  const ac = FakeAudioContext.instances.at(-1)!;
  const events = new EventBus<MenuEvents>();
  const unbind = audio.bindMenus(events);
  return { audio, ac, events, unbind };
}

describe('MenuSounds (§M6.2 menu rows)', () => {
  it('plays the shop, results and tutorial sounds on the ui bus', () => {
    const { audio, ac, events } = setup();
    const ui = audio.engine.ui!;
    events.emit('shop:buy', { slot: 'engine' });
    ac.currentTime += 0.1;
    events.emit('shop:deny', {});
    ac.currentTime += 0.1;
    events.emit('shop:equip', { slot: 'hull' });
    events.emit('ui:locked', {});
    events.emit('results:tally', { amount: 10 });
    events.emit('results:total', { credits: 100 });
    events.emit('tutorial:step', { step: 'steer' });
    events.emit('tutorial:done', {});
    expect(audio.debug().played).toEqual(['ui.buy', 'ui.deny', 'ui.equip', 'ui.locked', 'ui.tally', 'ui.coin', 'ui.tutorial', 'ui.sparkle']);
    const gains = ac.nodes.filter((n) => n.kind === 'Gain' && [...n.outputs].some((o) => o === (ui as unknown)));
    expect(gains.length).toBe(8);
  });

  it('raises the tally tick a little per line, and starts again at each results screen', () => {
    const { ac, events } = setup();
    const rates = () => ac.nodes.filter((n) => n.kind === 'BufferSource' && (n.prop('buffer') as { length: number } | null)?.length === 64).map((n) => n.param('playbackRate').value);
    events.emit('results:open', resultsOpenOf({ mode: 'tour', standings: [], playerId: 0 }));
    for (let i = 0; i < 3; i++) events.emit('results:tally', { amount: 5 });
    events.emit('results:open', resultsOpenOf({ mode: 'tour', standings: [], playerId: 0 }));
    events.emit('results:tally', { amount: 5 });
    const r = rates();
    expect(r[0]).toBe(1);
    expect(r[1]).toBeCloseTo(1.06);
    expect(r[2]).toBeCloseTo(1.12);
    expect(r[3]).toBe(1);
  });

  it('limits UI sounds to one per 40 ms, but a confirm right after a move still plays', () => {
    const { audio, ac } = setup();
    audio.uiSound('move');
    audio.uiSound('move');
    audio.uiSound('confirm');
    audio.uiSound('back');
    ac.currentTime += 0.05;
    audio.uiSound('slider', 1);
    expect(audio.debug().played).toEqual(['ui.move', 'ui.confirm', 'ui.slider']);
    const slider = ac.nodes.filter((n) => n.kind === 'BufferSource').at(-1)!;
    expect(slider.param('playbackRate').value).toBeCloseTo(1.5);
  });

  it('is silent with music off', () => {
    const { audio, events } = setup(false);
    events.emit('shop:buy', { slot: 'item' });
    audio.uiSound('confirm');
    expect(audio.debug().played).toEqual([]);
  });

  it('unbinds', () => {
    const { audio, events, unbind } = setup();
    unbind();
    events.emit('shop:buy', { slot: 'item' });
    expect(audio.debug().played).toEqual([]);
  });
});
