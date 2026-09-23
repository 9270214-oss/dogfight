export function createCanvas(canvas) {
    const context = canvas.getContext("2d");
  
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
  
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
  
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  
    window.addEventListener("resize", resize);
    resize();
  
    return {
      context,
      resize,
    };
  }