export function createInput() {
    const keys = new Set();
    const pressed = new Set();
  
    function onKeyDown(event) {
      if (!keys.has(event.code)) {
        pressed.add(event.code);
      }
  
      keys.add(event.code);
    }
  
    function onKeyUp(event) {
      keys.delete(event.code);
    }
  
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  
    return {
      isDown(code) {
        return keys.has(code);
      },
  
      justPressed(code) {
        return pressed.has(code);
      },
  
      endFrame() {
        pressed.clear();
      },
    };
  }