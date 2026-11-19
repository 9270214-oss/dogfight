import { expect, test } from '@playwright/test';

test.describe('Мультиплеєр E2E (два вікна браузера)', () => {
  test('два гравці заходять в одну кімнату, бачать рух одне одного та отримують повідомлення в чаті', async ({
    browser
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await Promise.all([pageA.goto('/'), pageB.goto('/')]);

      // Обидва гравці обирають першу кімнату ("Альфа-Сектор") у лобі
      const roomBtnA = pageA.locator('#rooms-list button', { hasText: 'Альфа-Сектор' });
      const roomBtnB = pageB.locator('#rooms-list button', { hasText: 'Альфа-Сектор' });

      await expect(roomBtnA).toBeVisible();
      await expect(roomBtnB).toBeVisible();

      await roomBtnA.click();
      await roomBtnB.click();

      // Очікуємо, поки обидва гравці побачать 2 учасників у кімнаті
      await expect(pageA.getByTestId('players-hud')).toContainText('ГРАВЦІ У КІМНАТІ (2)');
      await expect(pageB.getByTestId('players-hud')).toContainText('ГРАВЦІ У КІМНАТІ (2)');

      // Фіксуємо початковий рядок першого гравця на екрані другого
      const remoteShipOnB = pageB.locator('[data-testid^="remote-player-"]').first();
      await expect(remoteShipOnB).toBeVisible();
      const initialCoordsText = await remoteShipOnB.textContent();

      // Гравець A вмикає двигун і повертає корабель
      await pageA.locator('canvas').click();
      await pageA.keyboard.down('ArrowUp');
      await pageA.keyboard.down('ArrowRight');
      await pageA.waitForTimeout(700);
      await pageA.keyboard.up('ArrowUp');
      await pageA.keyboard.up('ArrowRight');

      // Перевіряємо, що на екрані гравця B координати першого гравця оновилися
      await expect
        .poll(async () => remoteShipOnB.textContent(), { timeout: 5_000 })
        .not.toBe(initialCoordsText);

      // Гравець A надсилає повідомлення в чат кімнати
      const messageText = 'Привіт із першого вікна!';
      await pageA.getByTestId('chat-input').fill(messageText);
      await pageA.getByTestId('chat-send').click();

      // Обидва гравці бачать це повідомлення у вікні чату
      await expect(pageA.getByTestId('chat-messages')).toContainText(messageText);
      await expect(pageB.getByTestId('chat-messages')).toContainText(messageText);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});