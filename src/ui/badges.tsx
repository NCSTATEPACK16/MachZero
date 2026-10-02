/** Profile badges: 12 neon emblems drawn in SVG (no image assets). Index = Profile.badge. */
import { BADGE_COUNT } from '../save/schema';

type Shape = 'bolt' | 'star' | 'hex' | 'chevron' | 'ring' | 'diamond';
const SHAPES: readonly Shape[] = ['bolt', 'star', 'hex', 'chevron', 'ring', 'diamond'];
const COLORS = ['#19f0ff', '#ff2bd6', '#ffb319', '#7dff3a', '#8a4dff', '#ff5a2b'];

export const BADGE_NAMES = ['BOLT', 'STAR', 'HIVE', 'ARROW', 'HALO', 'GEM', 'SPARK', 'NOVA', 'CORE', 'WING', 'ORBIT', 'PRISM'];

function shapePath(shape: Shape): string {
  switch (shape) {
    case 'bolt':
      return 'M27 6 L12 27 H22 L18 42 L36 19 H25 Z';
    case 'star':
      return 'M24 5 L29 18 L43 18 L32 27 L36 41 L24 33 L12 41 L16 27 L5 18 L19 18 Z';
    case 'hex':
      return 'M24 5 L40 14 V34 L24 43 L8 34 V14 Z M24 14 L32 19 V29 L24 34 L16 29 V19 Z';
    case 'chevron':
      return 'M8 12 L24 22 L40 12 V22 L24 32 L8 22 Z M8 26 L24 36 L40 26 V32 L24 42 L8 32 Z';
    case 'ring':
      return 'M24 6 A18 18 0 1 1 23.9 6 Z M24 14 A10 10 0 1 0 24.1 14 Z';
    case 'diamond':
      return 'M24 4 L42 24 L24 44 L6 24 Z M24 14 L33 24 L24 34 L15 24 Z';
  }
}

export function Badge({ index, size = 48 }: { index: number; size?: number }) {
  const i = ((index % BADGE_COUNT) + BADGE_COUNT) % BADGE_COUNT;
  const shape = SHAPES[i % SHAPES.length];
  const color = COLORS[(i + Math.floor(i / SHAPES.length) * 3) % COLORS.length];
  return (
    <svg class="mzu-badge" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ color }}>
      <rect x="1.5" y="1.5" width="45" height="45" rx="10" fill="rgba(8,6,26,0.85)" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.5" />
      <path d={shapePath(shape)} fill="currentColor" fill-rule="evenodd" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
    </svg>
  );
}
