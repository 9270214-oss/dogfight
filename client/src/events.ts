export const eventBus = new EventTarget();

export function emitGameEvent<T = Record<string, unknown>>(type: string, detail?: T): void {
  eventBus.dispatchEvent(new CustomEvent(type, { detail }));
}