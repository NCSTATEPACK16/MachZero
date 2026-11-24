import { describe, expect, it } from 'vitest';
import { EventBus, type GameEvents } from '../../core/events';
import { AudioSystem } from '../AudioSystem';

describe('AudioSystem (headless)', () => {
  it('tracks mute state and tolerates events before an AudioContext exists', () => {
    const bus = new EventBus<GameEvents>();
    const audio = new AudioSystem(bus);
    expect(audio.muted).toBe(false);
    audio.setMuted(true);
    expect(audio.muted).toBe(true);
    audio.setMuted(false);
    expect(audio.muted).toBe(false);
    // No user gesture yet: all events must be safe no-ops.
    bus.emit('race:countdown', { value: 3 });
    bus.emit('ship:boost', { shipId: 0 });
    bus.emit('ship:lowEnergy', { shipId: 0 });
  });
});
