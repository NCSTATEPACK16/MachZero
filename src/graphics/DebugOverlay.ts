import type * as THREE from 'three';
import type { ShipState } from '../core/contracts';

/** Small fixed monospace panel (top-left) shown only with ?debug=1. */
export class DebugOverlay {
  private readonly el: HTMLDivElement;
  private acc = 0;
  private frames = 0;
  private fps = 0;
  private frameMs = 0;
  private lastText = '';

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      zIndex: '50',
      padding: '6px 8px',
      font: '11px/1.35 ui-monospace, Menlo, Consolas, monospace',
      color: '#19f0ff',
      background: 'rgba(5, 3, 15, 0.72)',
      border: '1px solid rgba(25, 240, 255, 0.35)',
      borderRadius: '4px',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      textShadow: '0 0 6px rgba(25, 240, 255, 0.6)',
    } satisfies Partial<CSSStyleDeclaration>);
    this.el.setAttribute('data-debug', 'graphics');
    container.appendChild(this.el);
  }

  /** Call once per frame after rendering. */
  update(dt: number, renderer: THREE.WebGLRenderer, player: ShipState | null): void {
    this.acc += dt;
    this.frames++;
    if (this.acc < 0.25) return;
    this.fps = this.frames / this.acc;
    this.frameMs = (this.acc / this.frames) * 1000;
    this.acc = 0;
    this.frames = 0;

    const info = renderer.info.render;
    let text =
      `FPS        ${this.fps.toFixed(0)}\n` +
      `frame      ${this.frameMs.toFixed(2)} ms\n` +
      `draw calls ${info.calls}\n` +
      `triangles  ${info.triangles}\n` +
      `geometries ${renderer.info.memory.geometries}  textures ${renderer.info.memory.textures}`;
    if (player) {
      text +=
        `\nspeed      ${player.speed.toFixed(1)} m/s (${(player.forwardSpeed).toFixed(1)} fwd)` +
        `\ntrackU     ${player.trackU.toFixed(4)}` +
        `\nlateral    ${player.lateral.toFixed(2)} m` +
        `\nheight     ${player.heightAboveTrack.toFixed(2)} m` +
        `\ngrounded   ${player.grounded}` +
        `\nenergy     ${player.energy.toFixed(1)}${player.boosting ? '  BOOST' : ''}${player.inPit ? '  PIT' : ''}`;
    }
    if (text !== this.lastText) {
      this.el.textContent = text;
      this.lastText = text;
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
