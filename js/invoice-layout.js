export function captureRows(count) {
  if (!Number.isInteger(count) || count < 0) throw new Error('Cantidad de capturas no válida.');
  const rows=[];
  while(count>0){const size=count===4?2:Math.min(3,count);rows.push(size);count-=size;}
  return rows;
}
function aspect(image) {
  const width=image?.naturalWidth||image?.width, height=image?.naturalHeight||image?.height;
  return width>0&&height>0?width/height:1;
}
// Justified rows share a height, but each frame has the exact image proportion.
function pack(images,sizes,area) {
  const gap=Math.min(12,area.width/(Math.max(1,...sizes)*3),area.height/(Math.max(1,sizes.length)*3)), ratios=images.map(aspect), groups=[];
  let index=0;
  for(const size of sizes){const row=ratios.slice(index,index+size);const sum=row.reduce((a,b)=>a+b,0);groups.push({row,sum,height:(area.width-gap*(size-1))/sum});index+=size;}
  const naturalHeight=groups.reduce((sum,row)=>sum+row.height,0);
  const scale=Math.min(1,(area.height-gap*Math.max(0,groups.length-1))/(naturalHeight||1));
  const boxes=[];let y=area.y,usedWidth=0;
  for(const group of groups){let x=area.x;const height=group.height*scale;for(const ratio of group.row){const width=height*ratio;boxes.push({x,y,width,height});x+=width+gap;}usedWidth=Math.max(usedWidth,x-area.x-gap);y+=height+gap;}
  return {boxes,usedWidth,areaHeight:y-area.y-(groups.length?gap:0)};
}
export function captureLayout(images,hasIncident=false) {
  const ratios=images.map(aspect);
  // Only predominantly narrow phone captures use the side-by-side composition.
  const vertical=images.length>0&&images.length!==3&&ratios.filter(r=>r<=.60).length/images.length>=.75&&ratios.every(r=>r<1);
  if(vertical){
    const area={x:60,y:300,width:610,height:960};
    let best=null;
    for(let rows=1;rows<=(images.length<=3?1:images.length);rows++){
      const sizes=Array.from({length:rows},(_,i)=>Math.floor(images.length/rows)+(i<images.length%rows?1:0));
      const candidate=pack(images,sizes,area);
      const score=candidate.boxes.reduce((sum,b)=>sum+b.width*b.height,0);
      if(!best||score>best.score)best={...candidate,score};
    }
    const summaryX=Math.max(480,60+best.usedWidth+28);
    return {...best,mode:'side',summary:{x:summaryX,y:hasIncident?650:820,width:1020-summaryX}};
  }
  const packed=pack(images,captureRows(images.length),{x:60,y:300,width:960,height:hasIncident?535:630});
  // Center compact rows as a group; no empty padding is added to the frames.
  const shift=(960-packed.usedWidth)/2;
  packed.boxes.forEach(box=>box.x+=shift);
  return {...packed,mode:'bottom',summary:{x:60,y:hasIncident?875:955,width:960}};
}
export function invoiceResolution(count) {
  captureRows(count);
  const scale=count<=2?2:count===3?3:count<=6?4:5;
  return {scale,width:1080*scale,height:1350*scale};
}
