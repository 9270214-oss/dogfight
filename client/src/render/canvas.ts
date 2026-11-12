export function createCanvas(canvas: HTMLCanvasElement): {
  context: CanvasRenderingContext2D;
  resize: () => void;
} {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Не вдалося отримати 2D-контекст Canvas');
  }

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    context!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    context,
    resize
  };
}