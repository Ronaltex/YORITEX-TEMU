// Share the same balanced rows between the preview and the exported PNG.
export function captureRows(count) {
  if (!Number.isInteger(count) || count < 0) throw new Error('Cantidad de capturas no válida.');
  const rows = [];
  while (count > 0) {
    const size = count === 4 ? 2 : Math.min(3, count);
    rows.push(size);
    count -= size;
  }
  return rows;
}

export function captureLayout(images) {
  const rowSizes = captureRows(images.length);
  const gap = 25;
  const boxes = [];
  let top = 505, index = 0;
  for (const size of rowSizes) {
    const width = (910 - gap * (size - 1)) / size;
    // Preserve standard layout for one/two images. Larger sets use their real
    // aspect ratios so long phone screenshots no longer shrink into low boxes.
    const height = images.length <= 2 ? (images.length === 1 ? 720 : 560) : Math.ceil(Math.max(...images.slice(index, index + size).map(image => {
      const w = image?.naturalWidth || image?.width;
      const h = image?.naturalHeight || image?.height;
      return w > 0 && h > 0 ? (width - 20) * h / w + 26 : 560;
    })));
    for (let column = 0; column < size; column += 1) {
      boxes.push({ x:85 + column * (width + gap), y:top, width, height });
      index += 1;
    }
    top += height + gap;
  }
  return { boxes, areaHeight:images.length ? top - gap - 505 : 74 };
}

export function invoiceResolution(count, logicalHeight) {
  const desiredScale = count <= 2 ? 2 : count <= 4 ? 3 : 4;
  // Bound canvas allocation for phones and unusually long/many screenshots.
  const maxPixels = 48_000_000, maxSide = 16_000;
  const scale = Math.min(desiredScale, maxSide / 1080, maxSide / logicalHeight,
    Math.sqrt(maxPixels / (1080 * logicalHeight)));
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('No se pudo calcular el tamaño del comprobante.');
  return { scale, width:Math.floor(1080 * scale), height:Math.floor(logicalHeight * scale) };
}
