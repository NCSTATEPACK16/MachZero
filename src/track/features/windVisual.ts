/**
 * Crosswind zone visuals: the telegraph a driver reads before and inside a zone. Streamers on both rail tops stand
 * out across the road, pointing the way the gust pushes, and hang limp between gusts; rows of chevrons on the deck
 * light up with the gust and run across the road in its direction. Both follow the same hazard-clock timeline as
 * the physics (`windGust`), so what the driver sees is what pushes the ship.
 *
 * Two instanced meshes (two draw calls for every zone of the track). Their materials exist from the first frame,
 * dark while the wind is still, so the shader warm-up covers them.
 */
import * as THREE from 'three';
import { CONFIG } from '../../core/config';
import type { TrackData, TrackSample } from '../../core/contracts';
import { type BuiltWind, windGust, windSpan } from './wind';

export interface WindVisual {
  group: THREE.Group;
  /** Pose the streamers and light the chevrons for physics time t (seconds since the race reset). */
  update(t: number): void;
}

/** Metres between streamers along a rail, and between chevron rows along the deck. */
const STREAMER_SPACING = 22;
const CHEVRON_SPACING = 30;
const STREAMER_LENGTH = 5;
/** Chevrons per row, and the row's reach across the road as a fraction of the half-width. */
const CHEVRONS_PER_ROW = 4;
const CHEVRON_REACH = 0.72;
/** Height of the chevrons above the deck (m): clear of z-fighting, under the hulls. */
const DECK_LIFT = 0.07;

interface Streamer {
  zone: BuiltWind;
  /** Mount point on the rail top, and the road frame there. */
  mount: THREE.Vector3;
  across: THREE.Vector3;
  up: THREE.Vector3;
  forward: THREE.Vector3;
  span: number;
  seed: number;
}

interface Chevron {
  zone: BuiltWind;
  span: number;
  /** Position across the row, 0 (upwind) to 1 (downwind): the light runs this way. */
  order: number;
}

/** A flat chevron pointing along +X, in the XZ plane, 4 m long and 4.6 m wide. */
function chevronGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // Two bars meeting at the tip (1.3, 0): each a thin parallelogram.
  const p = [
    -2, 0, -2.3, -0.7, 0, -2.3, 2, 0, 0, 0.7, 0, 0,
    -2, 0, 2.3, -0.7, 0, 2.3,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex([0, 3, 1, 1, 3, 2, 4, 5, 3, 5, 2, 3]);
  g.computeVertexNormals();
  return g;
}

export function buildWindVisual(
  winds: readonly BuiltWind[],
  track: Pick<TrackData, 'length' | 'halfWidth'> & { sampleAt(u: number, out?: TrackSample): TrackSample },
  color: number,
): WindVisual {
  const group = new THREE.Group();
  group.name = 'wind-zones';
  const L = track.length;
  const at = (d: number): TrackSample => track.sampleAt((((d / L) % 1) + 1) % 1);

  const streamers: Streamer[] = [];
  const chevrons: Chevron[] = [];
  const chevronMatrices: THREE.Matrix4[] = [];
  const basis = new THREE.Matrix4();
  const railOffset = track.halfWidth + CONFIG.RAIL_THICKNESS / 2;
  for (const zone of winds) {
    const across = new THREE.Vector3();
    for (let d = zone.dStart + 6; d <= zone.dEnd - 6; d += STREAMER_SPACING) {
      const s = at(d);
      for (const side of [-1, 1]) {
        streamers.push({
          zone,
          mount: s.position.clone().addScaledVector(s.right, side * railOffset).addScaledVector(s.up, CONFIG.RAIL_HEIGHT + 0.5),
          across: across.copy(s.right).multiplyScalar(zone.dir).clone(),
          up: s.up.clone(),
          forward: s.forward.clone(),
          span: windSpan(zone, d, L),
          seed: streamers.length * 1.7,
        });
      }
    }
    for (let d = zone.dStart + 14; d <= zone.dEnd - 14; d += CHEVRON_SPACING) {
      const s = at(d);
      // Local +X = the way the gust pushes, +Y = the deck normal.
      across.copy(s.right).multiplyScalar(zone.dir);
      const z = new THREE.Vector3().crossVectors(across, s.up);
      for (let k = 0; k < CHEVRONS_PER_ROW; k++) {
        const order = k / (CHEVRONS_PER_ROW - 1);
        const lateral = (order * 2 - 1) * CHEVRON_REACH * track.halfWidth;
        basis.makeBasis(across, s.up, z).setPosition(s.position.clone().addScaledVector(across, lateral).addScaledVector(s.up, DECK_LIFT));
        chevronMatrices.push(basis.clone());
        chevrons.push({ zone, span: windSpan(zone, d, L), order });
      }
    }
  }

  const material = (): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });

  // Streamers: a tapered ribbon from the mount (x = 0) to its tip (x = 1), scaled to length each frame.
  const ribbon = new THREE.BufferGeometry();
  ribbon.setAttribute('position', new THREE.Float32BufferAttribute([0, -0.3, 0, 0, 0.3, 0, 1, 0.06, 0, 1, -0.06, 0], 3));
  ribbon.setIndex([0, 2, 1, 0, 3, 2]);
  const streamerMesh = new THREE.InstancedMesh(ribbon, material(), Math.max(1, streamers.length));
  streamerMesh.name = 'wind-streamers';
  streamerMesh.count = streamers.length;
  streamerMesh.frustumCulled = false;
  const chevronMat = material();
  chevronMat.polygonOffset = true;
  chevronMat.polygonOffsetFactor = -2;
  const chevronMesh = new THREE.InstancedMesh(chevronGeometry(), chevronMat, Math.max(1, chevrons.length));
  chevronMesh.name = 'wind-chevrons';
  chevronMesh.count = chevrons.length;
  chevronMesh.frustumCulled = false;
  chevronMatrices.forEach((m, i) => chevronMesh.setMatrixAt(i, m));
  chevronMesh.instanceMatrix.needsUpdate = true;
  group.add(streamerMesh, chevronMesh);

  const base = new THREE.Color(color);
  const tint = new THREE.Color();
  const m = new THREE.Matrix4();
  const x = new THREE.Vector3();
  const y = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  const update = (t: number): void => {
    for (let i = 0; i < streamers.length; i++) {
      const s = streamers[i];
      const g = windGust(s.zone, t) * s.span;
      // Limp: the ribbon hangs down the rail. In the gust: it stands out across the road and flutters.
      const droop = (1 - g) * 1.35;
      const flutter = g * 0.16 * Math.sin(t * 13 + s.seed) + (1 - g) * 0.05 * Math.sin(t * 2.1 + s.seed);
      const angle = -(droop + flutter);
      x.copy(s.across).multiplyScalar(Math.cos(angle)).addScaledVector(s.up, Math.sin(angle));
      y.copy(s.up).multiplyScalar(Math.cos(angle)).addScaledVector(s.across, -Math.sin(angle));
      zAxis.crossVectors(x, y);
      basis.makeBasis(x, y, zAxis);
      quat.setFromRotationMatrix(basis);
      scale.set(STREAMER_LENGTH * (0.55 + 0.45 * g), 1, 1);
      streamerMesh.setMatrixAt(i, m.compose(s.mount, quat, scale));
      streamerMesh.setColorAt(i, tint.copy(base).multiplyScalar(0.25 + 1.5 * g));
    }
    for (let i = 0; i < chevrons.length; i++) {
      const c = chevrons[i];
      const g = windGust(c.zone, t) * c.span;
      // A bright band runs across each row in the gust's direction, about twice a second.
      const wave = 0.35 + 0.65 * Math.max(0, Math.sin(t * 11 - c.order * 4.2));
      chevronMesh.setColorAt(i, tint.copy(base).multiplyScalar(g * wave * 2.4));
    }
    if (streamers.length > 0) {
      streamerMesh.instanceMatrix.needsUpdate = true;
      if (streamerMesh.instanceColor) streamerMesh.instanceColor.needsUpdate = true;
    }
    if (chevrons.length > 0 && chevronMesh.instanceColor) chevronMesh.instanceColor.needsUpdate = true;
  };
  update(0);
  return { group, update };
}
