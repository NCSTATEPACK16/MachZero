/** Names of keys and pad buttons as prompts show them (Settings → Controls, the HUD's tutorial prompts). */

/** Human-readable key name for a KeyboardEvent.code. */
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'SPACE',
    ShiftLeft: 'L-SHIFT',
    ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL',
    ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT',
    AltRight: 'R-ALT',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    BracketLeft: '[',
    BracketRight: ']',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
  };
  return map[code] ?? code.replace(/^Numpad/, 'NUM ').toUpperCase();
}

/** Standard-mapping gamepad buttons by index. */
export const PAD_BUTTON_NAMES: readonly string[] = ['Ⓐ', 'Ⓑ', 'Ⓧ', 'Ⓨ', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'START', 'L3', 'R3', 'D-PAD ▲', 'D-PAD ▼', 'D-PAD ◀', 'D-PAD ▶'];
