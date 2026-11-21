/**
 * The Neon Cup, whole and headless (src/sim/cupSim.ts): five races on the five original worlds.
 */
import { vi } from 'vitest';
import { describeWholeCup } from './cupSim';

vi.setConfig({ testTimeout: 300_000 });

describeWholeCup('neon');
