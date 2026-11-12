import { fetchRooms, type RoomDto } from '../net/api.ts';

export function showLobby(): Promise<RoomDto> {
  return new Promise<RoomDto>((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'lobby-overlay';
    overlay.style.cssText = `
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(11, 13, 23, 0.9);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      color: #fff; font-family: sans-serif; z-index: 10;
    `;
    overlay.innerHTML = `
      <h1 style="color: #00ffcc; margin-bottom: 20px;">Лобі ігрових кімнат</h1>
      <div id="rooms-list" style="width: 320px; margin-bottom: 20px; text-align: left;">
        <p style="color: #aaa;">Завантаження списку кімнат...</p>
      </div>
      <button id="refresh-btn" style="padding: 8px 16px; margin-bottom: 12px; cursor: pointer; background: #222; color: #fff; border: 1px solid #00ffcc; border-radius: 4px;">Оновити список</button>
    `;
    document.body.appendChild(overlay);

    const roomsList = overlay.querySelector<HTMLDivElement>('#rooms-list');
    const refreshBtn = overlay.querySelector<HTMLButtonElement>('#refresh-btn');

    async function loadAndRenderRooms(): Promise<void> {
      if (!roomsList) return;
      roomsList.innerHTML = '<p style="color: #aaa;">Оновлення...</p>';
      const rooms = await fetchRooms();
      roomsList.innerHTML = '';

      rooms.forEach((room) => {
        const btn = document.createElement('button');
        btn.style.cssText = `
          width: 100%; padding: 12px; margin-bottom: 8px;
          background: #1a1d2d; color: #fff; border: 1px solid #00ffcc;
          border-radius: 6px; cursor: pointer; text-align: left;
          display: flex; justify-content: space-between; font-size: 14px;
        `;
        btn.innerHTML = `<span><strong>${room.name}</strong></span> <span>${room.players}/${room.maxPlayers}</span>`;
        btn.onclick = () => {
          document.body.removeChild(overlay);
          resolve(room);
        };
        roomsList.appendChild(btn);
      });
    }

    if (refreshBtn) {
      refreshBtn.onclick = () => {
        void loadAndRenderRooms();
      };
    }

    void loadAndRenderRooms();
  });
}