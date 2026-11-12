export interface HttpError extends Error {
  status?: number;
}

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  signal?: AbortSignal;
}

export interface LoadOptions {
  signal?: AbortSignal;
}

export interface AssetManifest {
  json?: Record<string, string>;
  images?: Record<string, string>;
  audio?: Record<string, string>;
}

export interface LoadedAssets {
  json: Record<string, unknown>;
  images: Record<string, HTMLImageElement>;
  audio: Record<string, AudioBuffer | null>;
}

export interface LoadAllOptions {
  audioContext?: AudioContext;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export async function fetchJson<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const error: HttpError = new Error(`HTTP Error ${response.status} for ${url}`);
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseMs = 200, signal }: RetryOptions = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const httpErr = err as HttpError;
      if (
        (typeof httpErr.status === 'number' && httpErr.status >= 400 && httpErr.status < 500) ||
        httpErr.name === 'AbortError'
      ) {
        throw err;
      }
      if (attempt === attempts - 1) break;
      const delay = baseMs * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise<void>((res, rej) => {
        const timer = setTimeout(res, delay);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            rej(new DOMException('Aborted', 'AbortError'));
          },
          { once: true }
        );
      });
    }
  }
  throw lastError;
}

export function loadImage(url: string, { signal }: LoadOptions = {}): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(createPlaceholderImage());
    const img = new Image();

    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`[Loader Warning] Зображення ${url} не знайдено (404). Використовується заглушка.`);
      resolve(createPlaceholderImage());
    };
    img.src = url;
  });
}

function createPlaceholderImage(): HTMLImageElement {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ff0055';
    ctx.fillRect(0, 0, 32, 32);
  }
  const img = new Image();
  img.src = canvas.toDataURL();
  return img;
}

export async function loadAudio(
  ctx: AudioContext,
  url: string,
  { signal }: LoadOptions = {}
): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
  } catch {
    console.warn(`[Loader Warning] Аудіо ${url} не знайдено (404).`);
    return null;
  }
}

export function loadJson<T = unknown>(url: string, { signal }: LoadOptions = {}): Promise<T> {
  return withRetry(() => fetchJson<T>(url, { signal }), { signal });
}

export async function loadAll(
  manifestUrl: string,
  { audioContext, onProgress, signal }: LoadAllOptions = {}
): Promise<LoadedAssets> {
  const manifest = await loadJson<AssetManifest>(manifestUrl, { signal });
  const assets: LoadedAssets = { json: {}, images: {}, audio: {} };

  const jsonKeys = Object.keys(manifest.json ?? {});
  const imgKeys = Object.keys(manifest.images ?? {});
  const audioKeys = Object.keys(manifest.audio ?? {});
  const totalCount = jsonKeys.length + imgKeys.length + audioKeys.length;

  let completed = 0;
  const track = <T>(promise: Promise<T>): Promise<T> =>
    promise.then((res) => {
      completed++;
      if (onProgress) onProgress(completed / Math.max(1, totalCount));
      return res;
    });

  const tasks: Promise<unknown>[] = [];

  for (const key of jsonKeys) {
    const url = manifest.json?.[key];
    if (!url) continue;
    tasks.push(
      track(withRetry(() => loadJson(url, { signal }), { signal })).then((d) => {
        assets.json[key] = d;
      })
    );
  }
  for (const key of imgKeys) {
    const url = manifest.images?.[key];
    if (!url) continue;
    tasks.push(
      track(loadImage(url, { signal })).then((img) => {
        assets.images[key] = img;
      })
    );
  }
  for (const key of audioKeys) {
    const url = manifest.audio?.[key];
    if (!url || !audioContext) continue;
    tasks.push(
      track(loadAudio(audioContext, url, { signal })).then((buf) => {
        assets.audio[key] = buf;
      })
    );
  }

  if (tasks.length === 0) {
    if (onProgress) onProgress(1);
    return assets;
  }

  await Promise.all(tasks);
  return assets;
}