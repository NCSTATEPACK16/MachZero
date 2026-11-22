/**
 * The Storm Cup, whole and headless (src/sim/cupSim.ts): available once Abyss Line is built (IMPLEMENTATION §X6), five
 * races mixing old and new worlds, ending on Abyss Line: Sunset Mesa, Tempest Spire, Jade Ruins, Cinder Forge.
 */
import { vi } from 'vitest';
import { describeWholeCup } from './cupSim';

vi.setConfig({ testTimeout: 300_000 });

describeWholeCup('storm');
