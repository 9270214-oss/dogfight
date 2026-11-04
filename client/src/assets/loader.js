export async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
      const error = new Error(`HTTP Error ${response.status} for ${url}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  }
  
  export async function withRetry(fn, { attempts = 3, baseMs = 200, signal } = {}) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if ((err.status >= 400 && err.status < 500) || err.name === 'AbortError') {
          throw err;
        }
        if (attempt === attempts - 1) break;
        const delay = baseMs * Math.pow(2, attempt) + Math.random() * 100;
        await new Promise((res, rej) => {
          const timer = setTimeout(res, delay);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            rej(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      }
    }
    throw lastError;
  }
  
  // Завантаження зображення (якщо 404 — створює порожній квадрат-заглушку)
  export function loadImage(url, { signal } = {}) {
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
  
  function createPlaceholderImage() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0055';
    ctx.fillRect(0, 0, 32, 32);
    const img = new Image();
    img.src = canvas.toDataURL();
    return img;
  }
  
  export async function loadAudio(ctx, url, { signal } = {}) {
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      return await ctx.decodeAudioData(arrayBuffer);
    } catch (err) {
      console.warn(`[Loader Warning] Аудіо ${url} не знайдено (404).`);
      return null; // Повертаємо null замість падіння всієї гри
    }
  }
  
  export function loadJson(url, { signal } = {}) {
    return withRetry(() => fetchJson(url, { signal }), { signal });
  }
  
  export async function loadAll(manifestUrl, { audioContext, onProgress, signal } = {}) {
    const manifest = await loadJson(manifestUrl, { signal });
    const assets = { json: {}, images: {}, audio: {} };
  
    const jsonKeys = Object.keys(manifest.json || {});
    const imgKeys = Object.keys(manifest.images || {});
    const audioKeys = Object.keys(manifest.audio || {});
    const totalCount = jsonKeys.length + imgKeys.length + audioKeys.length;
  
    let completed = 0;
    const track = (promise) => promise.then((res) => {
      completed++;
      if (onProgress) onProgress(completed / Math.max(1, totalCount));
      return res;
    });
  
    const tasks = [];
  
    for (const key of jsonKeys) {
      tasks.push(track(withRetry(() => loadJson(manifest.json[key], { signal }), { signal })).then(d => assets.json[key] = d));
    }
    for (const key of imgKeys) {
      tasks.push(track(loadImage(manifest.images[key], { signal })).then(img => assets.images[key] = img));
    }
    for (const key of audioKeys) {
      if (audioContext) {
        tasks.push(track(loadAudio(audioContext, manifest.audio[key], { signal })).then(buf => assets.audio[key] = buf));
      }
    }
  
    if (tasks.length === 0) {
      if (onProgress) onProgress(1);
      return assets;
    }
  
    await Promise.all(tasks);
    return assets;
  }