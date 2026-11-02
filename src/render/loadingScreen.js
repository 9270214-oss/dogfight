export function drawLoadingScreen(ctx, width, height, progress, statusText = "Завантаження ресурсів...") {
    ctx.save();
    
    // Темний фон
    ctx.fillStyle = '#0b0d17';
    ctx.fillRect(0, 0, width, height);
  
    // Текст статусу
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(statusText, width / 2, height / 2 - 30);
  
    // Контур прогрес-бару
    const barWidth = Math.min(400, width * 0.8);
    const barHeight = 24;
    const x = (width - barWidth) / 2;
    const y = height / 2;
  
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, barWidth, barHeight);
  
    // Індикатор прогресу (заповнення)
    ctx.fillStyle = '#00ffcc';
    const fillWidth = Math.max(0, Math.min(barWidth - 4, (barWidth - 4) * progress));
    ctx.fillRect(x + 2, y + 2, fillWidth, barHeight - 4);
  
    // Відсотки
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '14px monospace';
    ctx.fillText(`${Math.round(progress * 100)}%`, width / 2, y + barHeight + 25);
  
    ctx.restore();
  }