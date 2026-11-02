// Глобальна шина подій на базі нативного EventTarget
export const eventBus = new EventTarget();

export function emitGameEvent(type, detail = {}) {
  eventBus.dispatchEvent(new CustomEvent(type, { detail }));
}