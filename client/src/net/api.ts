import { fetchJson, withRetry } from '../assets/loader.ts';

export interface RoomDto {
  id: string;
  name: string;
  players: number;
  maxPlayers: number;
}

export async function fetchRooms({ signal }: { signal?: AbortSignal } = {}): Promise<RoomDto[]> {
  try {
    return await withRetry(() => fetchJson<RoomDto[]>('/api/rooms', { signal }), { attempts: 2, signal });
  } catch (err: unknown) {
    console.warn('[API Warning] Не вдалося отримати кімнати з сервера, використовуємо локальний список:', err);
    return [
      { id: 'room-1', name: 'Альфа-Сектор (2/4)', players: 2, maxPlayers: 4 },
      { id: 'room-2', name: 'Оріон-Бета (1/2)', players: 1, maxPlayers: 2 },
      { id: 'room-3', name: 'Тренувальна арена (0/4)', players: 0, maxPlayers: 4 }
    ];
  }
}