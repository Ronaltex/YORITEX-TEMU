export function captureRows(count) {
  if (!Number.isInteger(count) || count < 0) throw new Error('Cantidad de capturas no válida.');
  const rows = [];
  while (count > 0) {
    const size = count === 4 ? 2 : Math.min(3, count);
    rows.push(size); count -= size;
  }
  return rows;
}
export function captureLayout(images, hasIncident = false) {
  const rows = captureRows(images.length);
  const top = 490, areaHeight = hasIncident ? 694 : 780;
  const gap = rows.length > 1 ? Math.min(16, areaHeight / (rows.length * 4)) : 0;
  const height = rows.length ? (areaHeight - gap * (rows.length - 1)) / rows.length : areaHeight;
  const boxes = [];
  rows.forEach((size,row) => {
    const width = (960 - 18 * (size - 1)) / size;
    for (let column = 0; column < size; column++) boxes.push({x:60 + column * (width + 18), y:top + row * (height + gap), width, height});
  });
  return { boxes, areaHeight };
}
export function invoiceResolution(count) {
  captureRows(count);
  const scale = count <= 2 ? 2 : count === 3 ? 3 : count <= 6 ? 4 : 5;
  return { scale, width:1080 * scale, height:1350 * scale };
}
