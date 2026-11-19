/**
 * The touch-scheme sim (IMPLEMENTATION §M7b step 9), shared by the two sim files so each half of the tracks runs in
 * its own worker. `ScriptedThumbs` stands in for a person's two thumbs on the default scheme: the left thumb moves the
 * steering slider toward the position that gives the steer a Pilot AIDriver wants, at no more than 600 points per
 * second and in whole points; the right thumb does one thing per step (brake, else boost); throttle comes from
 * auto-accelerate; air-brakes only from pushing the slider past full lock. The ship gets `sliderControls` of the thumb.
 */
import { CONFIG } from '../core/config';
import type { Assists, ControlInput, ShipId, TrackData } from '../core/contracts';
import { neutralControls } from '../core/controls';
import { EventBus, type GameEvents } from '../core/events';
import { HAZARDS_NORMAL, HAZARDS_ROOKIE } from '../core/hazards';
import { buildRaceField, defaultLoadout } from '../content/pilots';
import { TRACK_DEFS } from '../content/tracks';
import { AIDriver, RaceManager } from '../game';
import { PhysicsSystem } from '../physics';
import { ASSIST, PlayerAssists } from '../physics/Assists';
import { AIRBRAKE_RAMP, AIRBRAKE_START, SLIDER_CURVE, SLIDER_LOCK, sliderControls, type SliderOut } from '../physics/touchSteer';
import type { AirbrakeStyle, Step3 } from '../save/schema';
import { trackFromSource } from '../track';

/** The left thumb's top speed (points per second). */
export const THUMB_SPEED = 600;

export class ScriptedThumbs {
  /** The left thumb's travel from where it landed, in whole points. */
  thumb = 0;
  private readonly slider: SliderOut = { steer: 0, airbrakeLeft: 0, airbrakeRight: 0 };
  private readonly out = neutralControls();

  constructor(
    private readonly sensitivity: Step3 = 1,
    private readonly airbrake: AirbrakeStyle = 'slider',
  ) {}

  /** The thumb travel that gives `steer` (the inverse of the slider's curve), or the overdrive for an air-brake. */
  targetTravel(ai: Readonly<ControlInput>): number {
    const lock = SLIDER_LOCK[this.sensitivity];
    const ab = Math.max(ai.airbrakeLeft, ai.airbrakeRight);
    if (this.airbrake === 'slider' && ab > 0) {
      const side = ai.airbrakeRight >= ai.airbrakeLeft ? 1 : -1;
      return side * (lock + AIRBRAKE_START + AIRBRAKE_RAMP * Math.min(1, ab));
    }
    const s = Math.max(-1, Math.min(1, ai.steer));
    return Math.sign(s) * Math.pow(Math.abs(s), 1 / SLIDER_CURVE) * lock;
  }

  /** What the two thumbs send this step, given what the AI wants. Throttle is left at 0 (auto-accelerate adds it). */
  step(ai: Readonly<ControlInput>, dt: number): ControlInput {
    const target = Math.round(this.targetTravel(ai));
    const max = Math.round(THUMB_SPEED * dt);
    this.thumb += Math.max(-max, Math.min(max, target - this.thumb));
    const s = sliderControls(this.thumb, this.sensitivity, this.airbrake, this.slider);
    const o = this.out;
    o.throttle = 0;
    o.steer = s.steer;
    o.airbrakeLeft = s.airbrakeLeft;
    o.airbrakeRight = s.airbrakeRight;
    // The right thumb: one button at a time.
    const braking = ai.brake > ASSIST.BRAKE_RELEASE;
    o.brake = braking ? 1 : 0;
    o.boost = !braking && ai.boost;
    return o;
  }
}

export interface ThumbRun {
  track: TrackData;
  laps: number;
  totalTime: number;
  respawns: number;
  destroyed: boolean;
  maxLateral: number;
}

const tracks = new Map<string, TrackData>();
function trackOf(id: string): TrackData {
  let t = tracks.get(id);
  if (!t) {
    t = trackFromSource({ kind: 'authored', def: TRACK_DEFS[id] });
    tracks.set(id, t);
  }
  return t;
}

/**
 * A solo three-lap race on `trackId` by a Pilot AIDriver at full thrust: directly (`thumbs` null), or through the
 * scripted thumbs with the given assists (auto-accelerate at least). With No-KO the Rookie hazard rules apply, as in
 * the App.
 */
export async function thumbRace(trackId: string, thumbs: ScriptedThumbs | null, assists: Readonly<Assists>): Promise<ThumbRun> {
  const track = trackOf(trackId);
  const bus = new EventBus<GameEvents>();
  const physics = await PhysicsSystem.create(track, bus, { hazards: assists.noKO ? HAZARDS_ROOKIE : HAZARDS_NORMAL });
  const [def] = buildRaceField({ playerName: 'T', playerLoadout: defaultLoadout(), tier: 'pilot' });
  def.tier = 'pilot';
  const ship = physics.addShip(def, track.startGrid[def.gridIndex]);
  if (thumbs) {
    ship.noKO = assists.noKO;
    ship.earlyBoost = assists.earlyBoost;
  }
  const driver = new AIDriver(ship, track, 'steady', 4242, [ship], { hazardClock: () => physics.hazardTime, liveMines: () => physics.mines });
  const help = new PlayerAssists(track);
  const race = new RaceManager(track, [ship], bus, { load: () => null, save: () => undefined });
  const run: ThumbRun = { track, laps: 0, totalTime: Infinity, respawns: 0, destroyed: false, maxLateral: 0 };
  bus.on('race:lap', () => run.laps++);
  bus.on('race:finish', (e) => (run.totalTime = e.totalTime));
  bus.on('ship:respawn', () => run.respawns++);
  bus.on('ship:destroyed', () => (run.destroyed = true));
  const controls = new Map<ShipId, ControlInput>();
  const dt = CONFIG.FIXED_DT;
  race.start();
  for (let t = 0; t < 300 && run.totalTime === Infinity && !run.destroyed; t += dt) {
    const ai = driver.update(dt);
    controls.set(0, thumbs ? help.apply(ship, thumbs.step(ai, dt), assists) : ai);
    physics.step(dt, controls);
    race.fixedUpdate(dt);
    if (ship.status === 'racing' && !ship.airborne) run.maxLateral = Math.max(run.maxLateral, Math.abs(ship.lateral));
  }
  physics.dispose();
  return run;
}
