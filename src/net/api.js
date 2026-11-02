import { fetchJson, withRetry } from '../assets/loader.js';

export async function fetchRooms({ signal } = {}) {
  try {
    return await withRetry(() => fetchJson('/api/rooms', { signal }), { attempts: 2, signal });
  } catch (err) {
    console.warn('[API Warning] Не вдалося отримати кімнати з сервера, використовуємо локальний список:', err);
    // Фолбек-список кімнат для локального тестування
    return [
      { id: 'room-1', name: 'Альфа-Сектор (2/4)', players: 2, maxPlayers: 4 },
      { id: 'room-2', name: 'Оріон-Бета (1/2)', players: 1, maxPlayers: 2 },
      { id: 'room-3', name: 'Тренувальна арена (0/4)', players: 0, maxPlayers: 4 }
    ];
  }
}