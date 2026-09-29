import type { ControlInput, IInputManager, MenuAction } from '../core/contracts';
import { neutralControls } from '../core/controls';

// STUB — replaced by Agent 1.
export class InputManager implements IInputManager {
  constructor(_target: Window) {}
  sample(): ControlInput {
    return neutralControls();
  }
  consume(_action: MenuAction): boolean {
    return false;
  }
  update(): void {}
  dispose(): void {}
}
