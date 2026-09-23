import { captureLayout, invoiceResolution } from './invoice-layout.js';
const money = value => new Intl.NumberFormat('es-EC', { style:'currency', currency:'USD' }).format(Number(value) || 0);
function loadImage(src) {
  return new Promise((resolve,reject)=> {
    const image = new Image(); image.crossOrigin='anonymous';
    image.onload=()=>resolve(image); image.onerror=()=>reject(new Error('No se pudo cargar una captura. Actualiza el detalle y vuelve a intentarlo.'));
    image.src=src;
  });
}
function drawContained(ctx,image,x,y,width,height) {
  const ratio=Math.min(width/image.width,height/image.height);
  const w=image.width*ratio,h=image.height*ratio;
  ctx.drawImage(image,x+(width-w)/2,y+(height-h)/2,w,h);
}
function fitText(ctx,text,x,y,width,size=28,color='#06182d',weight=700) {
  ctx.fillStyle=color;
  ctx.font=weight+' '+size+'px Arial';
  while(ctx.measureText(String(text)).width>width && size>10) ctx.font=weight+' '+(--size)+'px Arial';
  ctx.fillText(String(text),x,y,width);
}
function noteLines(ctx,text,width,size) {
  ctx.font=size+'px Arial';
  const lines=[];let line='';
  for(const char of String(text)) {
    if(char==='\n' || (line && ctx.measureText(line+char).width>width)) {lines.push(line);line='';}
    if(char!=='\n') line+=char;
  }
  if(line) lines.push(line);
  return lines;
}
export async function generateInvoiceBlob(detail) {
  const urls=Array.isArray(detail.captureUrls)?detail.captureUrls.filter(Boolean):[];
  const [logo,watermark,...results]=await Promise.allSettled([
    loadImage('assets/yori-tex-badge.png'),loadImage('assets/yori-tex-watermark.png'),...urls.map(loadImage)
  ]);
  if(results.some(result=>result.status!=='fulfilled')) throw new Error('No se cargaron todas las capturas. Actualiza el detalle antes de exportar.');
  const images=results.map(result=>result.value);
  const layout=captureLayout(images,Boolean(detail.incidentText));
  const resolution=invoiceResolution(images.length);
  const canvas=document.createElement('canvas');
  canvas.width=resolution.width;canvas.height=resolution.height;
  const ctx=canvas.getContext('2d');
  if(!ctx) throw new Error('No se pudo crear el comprobante. Cierra otras pestañas y vuelve a intentarlo.');
  ctx.scale(resolution.scale,resolution.scale);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.fillStyle='#f4f7fb';ctx.fillRect(0,0,1080,1350);
  ctx.fillStyle='#06182d';ctx.fillRect(0,0,1080,145);
  ctx.fillStyle='#ff8200';ctx.fillRect(0,139,1080,6);
  if(logo.status==='fulfilled') drawContained(ctx,logo.value,38,16,110,110);
  fitText(ctx,'DETALLE DE PEDIDO',175,65,850,39,'#fff');
  fitText(ctx,detail.closureTitle,175,105,850,24,'#c6d2df',400);
  ctx.fillStyle='#fff';ctx.fillRect(35,165,1010,1120);
  if(watermark.status==='fulfilled') {
    ctx.save();ctx.globalAlpha=.025;drawContained(ctx,watermark.value,110,450,860,800);ctx.restore();
  }
  fitText(ctx,'CLIENTE',60,191,460,15,'#708096');
  fitText(ctx,detail.clientName,60,226,460,31);
  fitText(ctx,'ESTADO DEL PEDIDO',570,191,450,15,'#708096');
  fitText(ctx,detail.statusText,570,226,450,25);
  ctx.fillStyle='#06182d';ctx.fillRect(60,245,960,108);
  const credit=Number(detail.credit)>0;
  fitText(ctx,credit?'SALDO A FAVOR':'TOTAL PENDIENTE',85,283,540,25,'#ff9a31');
  fitText(ctx,credit?'Crédito del cliente':'Valor por pagar · USD',85,324,540,22,'#fff',400);
  ctx.textAlign='right';
  fitText(ctx,money(credit?detail.credit:detail.due),994,318,405,62,'#fff');
  ctx.textAlign='left';
  const metrics=[['PRODUCTOS',money(detail.adjustedProducts)],['ABONADO',money(detail.paid)],['LIBRAS · '+Number(detail.totalWeight||0).toFixed(2)+' lb',money(detail.poundCharge)]];
  metrics.forEach(([label,value],i)=>{
    const x=60+i*325;ctx.fillStyle='#edf2f7';ctx.fillRect(x,369,310,71);
    fitText(ctx,label,x+15,391,280,15,'#708096');fitText(ctx,value,x+15,423,280,28);
  });
  fitText(ctx,'PRODUCTOS CONFIRMADOS',60,474,720,20);
  ctx.textAlign='right';fitText(ctx,images.length+' captura(s)',1020,474,240,17,'#708096',400);ctx.textAlign='left';
  if(!images.length) {
    ctx.textAlign='center';fitText(ctx,'No se adjuntaron capturas a este pedido',540,835,920,25,'#708096',400);ctx.textAlign='left';
  }
  images.forEach((image,index)=>{
    const box=layout.boxes[index];
    ctx.fillStyle='#fff';ctx.fillRect(box.x,box.y,box.width,box.height);
    ctx.strokeStyle='#d5dee8';ctx.lineWidth=1;ctx.strokeRect(box.x,box.y,box.width,box.height);
    const padding=Math.min(5,box.width/6,box.height/6);
    drawContained(ctx,image,box.x+padding,box.y+padding,box.width-2*padding,box.height-2*padding);
  });
  if(detail.incidentText) {
    ctx.fillStyle='#fff0e1';ctx.fillRect(60,1200,960,76);
    let size=18,lines=noteLines(ctx,detail.incidentText,928,size);
    while(lines.length*(size+2)>58 && size>8) lines=noteLines(ctx,detail.incidentText,928,--size);
    ctx.save();ctx.beginPath();ctx.rect(72,1205,936,67);ctx.clip();ctx.fillStyle='#934c12';
    lines.forEach((line,i)=>ctx.fillText(line,76,1219+i*(size+2)));ctx.restore();
  }
  ctx.textAlign='center';fitText(ctx,'Gracias por confiar en YORI-TEX',540,1318,960,23);ctx.textAlign='left';
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>{
    canvas.width=canvas.height=1;
    if(blob) resolve(blob);else reject(new Error('No se pudo generar la imagen. Cierra otras pestañas y vuelve a intentarlo.'));
  },'image/png'));
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
