const money = value => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawContained(ctx, image, x, y, width, height) {
  const ratio = Math.min(width / image.width, height / image.height);
  const w = image.width * ratio;
  const h = image.height * ratio;
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

function wrap(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = String(text || '').split(/\s+/);
  let line = '';
  let lines = 0;
  for (const word of words) {
    const test = `${line}${word} `;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line.trim(), x, y);
      line = `${word} `;
      y += lineHeight;
      lines += 1;
      if (lines >= maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (line && lines < maxLines) ctx.fillText(line.trim(), x, y);
}

export async function generateInvoiceBlob(detail) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  const [logoResult, watermarkResult, ...captureResults] = await Promise.allSettled([
    loadImage('assets/yori-tex-badge.png'),
    loadImage('assets/yori-tex-watermark.png'),
    ...detail.captureUrls.slice(0, 3).map(loadImage)
  ]);

  ctx.fillStyle = '#f4f7fb';
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = '#06182d';
  ctx.fillRect(0, 0, 1080, 240);
  ctx.fillStyle = '#ff8200';
  ctx.fillRect(0, 230, 1080, 10);

  if (logoResult.status === 'fulfilled') drawContained(ctx, logoResult.value, 55, 28, 182, 182);
  ctx.fillStyle = '#fff';
  ctx.font = '700 44px Arial';
  ctx.fillText('DETALLE DE PEDIDO', 270, 103);
  ctx.fillStyle = '#b9c6d5';
  ctx.font = '25px Arial';
  ctx.fillText(detail.closureTitle, 270, 145);
  ctx.fillStyle = '#ff9a31';
  ctx.font = '700 18px Arial';
  ctx.textAlign = 'right';
  ctx.fillText('YORI-TEX · COMPROBANTE', 1015, 94);
  ctx.fillStyle = '#fff';
  ctx.font = '16px Arial';
  ctx.fillText('Valores expresados en USD', 1015, 126);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#fff';
  ctx.fillRect(55, 275, 970, 1018);
  if (watermarkResult.status === 'fulfilled') {
    ctx.save();
    ctx.globalAlpha = .035;
    ctx.drawImage(watermarkResult.value, 90, 305, 900, 900);
    ctx.restore();
  }

  ctx.fillStyle = '#ff8200';
  ctx.fillRect(85, 318, 6, 92);
  ctx.fillRect(555, 318, 6, 92);
  ctx.fillStyle = '#708096';
  ctx.font = '700 17px Arial';
  ctx.fillText('CLIENTE', 110, 345);
  ctx.fillText('ESTADO DEL PEDIDO', 580, 345);
  ctx.fillStyle = '#06182d';
  ctx.font = '700 32px Arial';
  wrap(ctx, detail.clientName, 110, 390, 410, 34, 2);
  ctx.font = '700 22px Arial';
  wrap(ctx, detail.statusText, 580, 386, 390, 27, 2);
  ctx.fillStyle = '#dce3eb';
  ctx.fillRect(85, 440, 910, 2);

  ctx.fillStyle = '#06182d';
  ctx.font = '700 19px Arial';
  ctx.fillText('PRODUCTOS CONFIRMADOS', 85, 482);
  ctx.fillStyle = '#7d8999';
  ctx.font = '17px Arial';
  ctx.textAlign = 'right';
  ctx.fillText('Capturas del pedido', 995, 482);
  ctx.textAlign = 'left';

  for (let index = 0; index < 3; index += 1) {
    const x = 85 + index * 305;
    ctx.fillStyle = '#eef3f8';
    ctx.fillRect(x, 505, 280, 220);
    ctx.fillStyle = '#ff8200';
    ctx.fillRect(x, 505, 280, 6);
    ctx.strokeStyle = '#c6d1dd';
    ctx.setLineDash([9, 7]);
    ctx.strokeRect(x + .5, 505.5, 279, 219);
    ctx.setLineDash([]);
    const result = captureResults[index];
    if (result?.status === 'fulfilled') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 1, 511, 278, 213);
      drawContained(ctx, result.value, x + 6, 516, 268, 203);
    } else {
      ctx.fillStyle = '#93a0af';
      ctx.font = '700 18px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`CAPTURA ${index + 1}`, x + 140, 625);
      ctx.textAlign = 'left';
    }
  }

  ctx.fillStyle = '#06182d';
  ctx.font = '700 19px Arial';
  ctx.fillText('RESUMEN DE VALORES', 85, 785);
  ctx.fillStyle = '#7d8999';
  ctx.font = '17px Arial';
  ctx.textAlign = 'right';
  ctx.fillText('USD', 995, 785);
  ctx.textAlign = 'left';

  let y = 835;
  const lines = [
    ['Valor de productos', money(detail.adjustedProducts)],
    ['Total abonado', `− ${money(detail.paid)}`],
    [`${detail.totalWeight.toFixed(2)} lb acumuladas`, money(detail.poundCharge)]
  ];
  for (const [label, value] of lines) {
    ctx.fillStyle = '#647287';
    ctx.font = '23px Arial';
    ctx.fillText(label, 105, y);
    ctx.fillStyle = '#06182d';
    ctx.font = '700 24px Arial';
    ctx.textAlign = 'right';
    ctx.fillText(value, 975, y);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e0e6ed';
    ctx.fillRect(105, y + 23, 870, 2);
    y += 70;
  }

  if (detail.incidentText) {
    ctx.fillStyle = '#fff0e1';
    ctx.fillRect(85, 1045, 910, 78);
    ctx.fillStyle = '#934c12';
    ctx.font = '19px Arial';
    wrap(ctx, detail.incidentText, 108, 1077, 865, 25, 2);
  }

  ctx.fillStyle = '#06182d';
  ctx.fillRect(85, 1145, 910, 108);
  ctx.fillStyle = '#ff9a31';
  ctx.font = '700 16px Arial';
  ctx.fillText(detail.credit > 0 ? 'SALDO A FAVOR' : 'SALDO FINAL', 115, 1180);
  ctx.fillStyle = '#fff';
  ctx.font = '700 25px Arial';
  ctx.fillText(detail.credit > 0 ? 'CRÉDITO DEL CLIENTE' : 'TOTAL PENDIENTE', 115, 1220);
  ctx.textAlign = 'right';
  ctx.font = '700 46px Arial';
  ctx.fillText(money(detail.credit > 0 ? detail.credit : detail.due), 965, 1215);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#06182d';
  ctx.font = '700 20px Arial';
  ctx.fillText('Gracias por confiar en YORI-TEX', 540, 1318);
  ctx.textAlign = 'left';

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export async function copyImage(blob) {
  if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Este navegador no permite copiar imágenes.');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export async function shareImage(blob, fileName) {
  const file = new File([blob], fileName, { type: 'image/png' });
  if (!navigator.share || !navigator.canShare?.({ files: [file] })) return false;
  await navigator.share({ files: [file], title: 'Detalle de pedido YORI-TEX' });
  return true;
}

