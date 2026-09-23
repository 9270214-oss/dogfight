export function createLoop({
    step = 1 / 60,
    simulate,
    render,
  }) {
    let lastTime = performance.now();
    let accumulator = 0;
  
    let stepsPerSecond = 0;
    let framesPerSecond = 0;
    let lastFrameTime = 0;
  
    let stepsThisSecond = 0;
    let framesThisSecond = 0;
    let statsTime = 0;
  
    function frame(currentTime) {
      const frameStart = performance.now();
  
      const frameTime = Math.min(
        (currentTime - lastTime) / 1000,
        0.25,
      );
  
      lastTime = currentTime;
      accumulator += frameTime;
  
      while (accumulator >= step) {
        simulate(step);
        accumulator -= step;
        stepsThisSecond++;
      }
      
      const alpha = accumulator / step;

      render(alpha);
  
      framesThisSecond++;
      statsTime += frameTime;
  
      if (statsTime >= 1) {
        stepsPerSecond = stepsThisSecond / statsTime;
        framesPerSecond = framesThisSecond / statsTime;
      
        stepsThisSecond = 0;
        framesThisSecond = 0;
        statsTime -= 1;
      }
  
      lastFrameTime = performance.now() - frameStart;
  
      requestAnimationFrame(frame);
    }
  
    requestAnimationFrame(frame);

    return {
      get stepsPerSecond() {
        return stepsPerSecond;
      },
  
      get framesPerSecond() {
        return framesPerSecond;
      },
  
      get frameTime() {
        return lastFrameTime;
      },
    };
  }