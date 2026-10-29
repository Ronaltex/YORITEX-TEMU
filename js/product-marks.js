// Coordinates are normalized to the original capture, independent of screen/export size.
export const excludedProduct = item => ['not_bought','not_arrived'].includes(item.state);
export function productCounts(items=[]) {
 return {total:items.length,pending:items.filter(i=>i.state==='pending').length,bought:items.filter(i=>['bought','not_arrived'].includes(i.state)).length,excluded:items.filter(excludedProduct).length};
}
export function drawProductMarks(ctx,box,items=[]) {
 for(const item of items) {
  if(!excludedProduct(item))continue;
  const x=box.x+item.x*box.width,y=box.y+item.y*box.height,r=Math.max(7,Math.min(23,box.width*.085));
  ctx.save();ctx.strokeStyle='rgba(185,28,28,.64)';ctx.lineWidth=Math.max(2,r*.18);ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(x-r,y-r);ctx.lineTo(x+r,y+r);ctx.moveTo(x+r,y-r);ctx.lineTo(x-r,y+r);ctx.stroke();ctx.restore();
 }
}
export const productStateText={pending:'Pendiente de comprar',bought:'Comprado',not_bought:'No se compró',not_arrived:'No llegó'};
export function productSummary(client) {
 if(!Array.isArray(client.visual_products))return 'Preparar productos en capturas';
 const q=productCounts(client.visual_products);
 return q.pending?'Pendiente de comprar: '+q.pending+' · Ver productos':'Productos resueltos · Revisar / corregir';
}
