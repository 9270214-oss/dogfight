export interface InputController {
  isDown(code: string): boolean;
  justPressed(code: string): boolean;
  endFrame(): void;
}

export function createInput(): InputController {
  const keys = new Set<string>();
  const pressed = new Set<string>();

  function onKeyDown(event: KeyboardEvent): void {
    if (!keys.has(event.code)) {
      pressed.add(event.code);
    }
    keys.add(event.code);
  }

  function onKeyUp(event: KeyboardEvent): void {
    keys.delete(event.code);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return {
    isDown(code: string): boolean {
      return keys.has(code);
    },
    justPressed(code: string): boolean {
      return pressed.has(code);
    },
    endFrame(): void {
      pressed.clear();
    }
  };
}