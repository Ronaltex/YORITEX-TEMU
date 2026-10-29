import { signedCaptureUrls, saveVisualProducts } from './database.js?v=20261028-productos';
import { quantityState } from './quantities.js?v=20261028-productos';
import { excludedProduct, productStateText } from './product-marks.js?v=20261028-productos';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=v=>JSON.parse(JSON.stringify(v));
export function setupVisualProducts({state,refresh,toast}) {
 const drafts=new Map();let current=null,busy=false,active=null,token=0;
 const dialog=document.createElement('dialog');dialog.id='visualProductsDialog';
 dialog.innerHTML=`<section class="dialog-card xlarge"><header><div><span>PRODUCTOS EN CAPTURAS</span><h2 id="visualTitle"></h2></div><button type="button" data-visual-close aria-label="Cerrar">×</button></header><div class="dialog-body"><p id="visualHelp"></p><p id="visualCounts" role="status"></p><p class="rule-note">Cada visto representa una unidad. No marques otra vez un producto repetido en dos capturas. Los vistos se alinean automáticamente a la izquierda.</p><div id="visualCaptures"></div><div id="visualEditor" hidden></div><p id="visualError" class="form-error" role="alert"></p></div><footer><button type="button" data-visual-close class="secondary">Cancelar</button><button type="button" id="visualSave" class="primary"></button></footer></section>`;
 document.body.append(dialog);const $=s=>dialog.querySelector(s);
 function reset(){drafts.clear();}
 function payload(){return [...drafts.entries()].filter(([,d])=>d.new_items.length||d.item_ids.length).map(([client_id,d])=>({client_id,...copy(d)}));}
 function summary(id){const d=drafts.get(id);return d?d.new_items.length+d.item_ids.length:0;}
 function count(){return current.mode==='purchase'?current.additions.length+current.selected.size:0;}
 function render(){
  const c=current,q=quantityState(c.client,state.data.parts),items=c.mode==='purchase'?[...c.items,...c.additions]:c.items;
  $('#visualCounts').textContent=c.mode==='purchase'?`Pedido: ${q.total} · Comprados: ${q.bought} · Seleccionados ahora: ${count()} · Quedarán pendientes: ${q.remaining-count()}`:`Pedido: ${q.total} · Comprados: ${q.bought} · Pendientes: ${q.remaining}. Guarda para actualizar los cambios.`;
  $('#visualCaptures').innerHTML=c.captures.map((cap,index)=>`<section class="visual-capture"><h3>Captura ${index+1}</h3><label>Ampliar <select data-zoom="${cap.id}">${[1,1.5,2].map(z=>`<option value="${z}" ${Number(c.zoom[cap.id]||1)===z?'selected':''}>${z===1?'Normal':z*100+' %'}</option>`).join('')}</select></label><div class="visual-scroll"><div class="visual-image" style="width:${Number(c.zoom[cap.id]||1)*100}%" data-capture="${cap.id}"><img src="${esc(cap.signed_url)}" alt="Captura ${index+1} de ${esc(c.client.name)}" draggable="false">${items.filter(i=>i.capture_id===cap.id).map(i=>{const selected=c.selected.has(i.id)||c.additions.some(n=>n.id===i.id);const symbol=excludedProduct(i)?'✕':i.state==='pending'&&!selected?'○':'✓';return `<button type="button" class="product-mark ${excludedProduct(i)?'excluded':selected?'selected':i.state==='pending'?'pending':'saved'}" data-mark="${esc(i.id)}" style="left:7%;top:${100*i.y}%" aria-label="${esc(i.label)}: ${selected?'seleccionado':productStateText[i.state]}" title="${esc(i.label)}">${symbol}</button>`;}).join('')}</div></div></section>`).join('')||'<p>No hay capturas. Añádelas desde el historial de esta persona.</p>';
 }
 async function open(id,mode='manage'){
  if(busy)return;const client=state.data.clients.find(c=>c.id===id);if(!client)return;
  const q=quantityState(client,state.data.parts);
  if(!q.known||q.excess)return toast('Completa o corrige las cantidades de esta persona y sus compras anteriores.');
  const version=++token;current={client:copy(client),mode,items:copy(client.visual_products||[]),captures:[],additions:[],selected:new Set(),zoom:{}};active=null;
  if(mode==='purchase') {const d=drafts.get(id);if(d&&d.revision!==client.updated_at){drafts.delete(id);toast('Los productos cambiaron; vuelve a seleccionar esta persona.');}else if(d){current.additions=copy(d.new_items);current.selected=new Set(d.item_ids);}}
  $('#visualTitle').textContent=client.name;$('#visualHelp').textContent=mode==='purchase'?'Toca cada producto comprado: un toque coloca el visto y lo selecciona. Toca un visto nuevo para quitarlo. Los verdes ya pertenecen a compras guardadas.':'Toca un visto para corregirlo, o toca un producto sin marca para registrar «No se compró». Para productos de compras antiguas sin vistos, elige «Ya estaba contado en esa compra».';
  $('#visualSave').textContent=mode==='purchase'?'Usar selección en esta compra':'Guardar correcciones y descuentos';
  $('#visualEditor').hidden=true;$('#visualError').textContent='';$('#visualCaptures').textContent='Cargando capturas…';dialog.showModal();
  try{const captures=await signedCaptureUrls(state.data.captures.filter(c=>c.client_id===id));if(version!==token)return;current.captures=captures;render();}catch(e){$('#visualError').textContent=e.message;}
 }
 function close(){if(busy)return;token++;dialog.close();current=null;active=null;}
 dialog.querySelectorAll('[data-visual-close]').forEach(b=>b.onclick=close);
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 dialog.addEventListener('click',e=>{if(e.target===dialog)close();});
 function selectMark(id){
  const c=current,added=c.additions.find(i=>i.id===id),item=c.items.find(i=>i.id===id)||added;
  if(c.mode==='manage')return edit(item);
  if(added)c.additions=c.additions.filter(i=>i.id!==id);
  else if(item.state==='pending'){if(c.selected.has(id))c.selected.delete(id);else if(count()<quantityState(c.client,state.data.parts).remaining)c.selected.add(id);}
  else return toast(excludedProduct(item)?'Este producto fue descontado. Corrígelo desde la tarjeta de la persona.':'Ya está en una compra guardada. Puedes corregirlo desde la tarjeta de la persona.');
  render();
 }
 $('#visualCaptures').addEventListener('click',event=>{
  if(busy||!current)return;const button=event.target.closest('[data-mark]');if(button)return selectMark(button.dataset.mark);
  if(event.target.tagName!=='IMG')return;
  const box=event.target.getBoundingClientRect(),y=Math.max(.012,Math.min(.988,(event.clientY-box.top)/box.height)),capture=event.target.closest('[data-capture]').dataset.capture;
  const all=[...current.items,...current.additions],near=all.find(i=>i.capture_id===capture&&Math.abs(i.y-y)<.012);
  if(near)return selectMark(near.id);
  if(current.mode==='purchase'&&count()>=quantityState(current.client,state.data.parts).remaining)return toast('Ya seleccionaste todas las unidades pendientes de esta persona.');
  const item={id:crypto.randomUUID(),capture_id:capture,x:.07,y,label:'Producto '+(all.length+1),state:'pending',part_id:null,deduction:0};
  if(current.mode==='purchase'){current.additions.push(item);render();}else {current.items.push(item);render();edit(item);}
 });
 $('#visualCaptures').addEventListener('change',event=>{if(event.target.matches('[data-zoom]')){current.zoom[event.target.dataset.zoom]=Number(event.target.value);event.target.closest('.visual-capture').querySelector('.visual-image').style.width=(Number(event.target.value)*100)+'%';}});
 function edit(item){
  active=item;const parts=state.data.parts.filter(p=>p.client_id===current.client.id);
  const saved=(current.client.visual_products||[]).some(i=>i.id===item.id);
  $('#visualEditor').hidden=false;$('#visualEditor').innerHTML=`<h3>Corregir este producto</h3><label>Descripción<input id="markLabel" maxlength="160" value="${esc(item.label)}"></label><label>Estado<select id="markState">${Object.entries(productStateText).map(([v,t])=>`<option value="${v}" ${v===item.state?'selected':''}>${t}</option>`).join('')}</select></label><label>Compra anterior (si se compró)<select id="markPart"><option value="">Sin compra</option>${parts.map(p=>`<option value="${p.id}" ${p.id===item.part_id?'selected':''}>Compra #${state.data.purchases.find(b=>b.id===p.purchase_id)?.purchase_number} · ${p.purchased_quantity??'?'} unidades</option>`).join('')}</select></label>${!saved?'<label class="checkbox-label"><input type="checkbox" id="markLegacy" checked>Ya estaba contado en esa compra (no sumar otra unidad)</label>':''}<label>Descuento por esta unidad ($)<input id="markDeduction" type="number" min="0" step="0.01" value="${Number(item.deduction)||0}"></label><p>«No se compró» y «No llegó» colocan una X. El comprobante dice «Producto no entregado». Al revertirlos, se revierte también su descuento. Revisa que no exista ya otro descuento por el mismo producto.</p><button type="button" id="applyMark" class="primary">Aplicar a este producto</button><button type="button" id="removeMark" class="secondary">Quitar visto / devolver a pendiente</button>`;
  $('#visualEditor').scrollIntoView({behavior:'smooth',block:'nearest'});
  $('#applyMark').onclick=()=>{
   const status=$('#markState').value,part=['bought','not_arrived'].includes(status)?$('#markPart').value:null,discount=['not_bought','not_arrived'].includes(status)?Number($('#markDeduction').value):0,label=$('#markLabel').value.trim();
   if(!label||!Number.isFinite(discount)||discount<0||Math.round(discount*100)!==discount*100&&Math.abs(Math.round(discount*100)-discount*100)>1e-7||(['bought','not_arrived'].includes(status)&&!part)){toast('Revisa descripción, compra y descuento (máximo dos decimales).');return;}
   Object.assign(item,{state:status,part_id:part||null,deduction:discount,label,legacy_attach:Boolean(!saved&&part&&$('#markLegacy')?.checked)});$('#visualEditor').hidden=true;active=null;render();
  };
  $('#removeMark').onclick=()=>{if(saved){Object.assign(item,{state:'pending',part_id:null,deduction:0});}else current.items=current.items.filter(i=>i.id!==item.id);$('#visualEditor').hidden=true;active=null;render();};
 }
 $('#visualSave').onclick=async()=>{
  if(busy||!current)return;if(active)return toast('Aplica primero la corrección de este producto.');
  if(current.mode==='purchase'){
   drafts.set(current.client.id,{revision:current.client.updated_at,item_ids:[...current.selected],new_items:copy(current.additions)});
   const id=current.client.id;close();document.dispatchEvent(new CustomEvent('visual-selection',{detail:{id,count:summary(id)}}));return;
  }
  busy=true;$('#visualSave').disabled=true;$('#visualError').textContent='';
  try{await saveVisualProducts(current.client.id,current.items,current.client.updated_at);await refresh();busy=false;close();toast('Productos y descuentos actualizados.');}catch(e){$('#visualError').textContent=e.message;}finally{busy=false;$('#visualSave').disabled=false;}
 };
 return {open,reset,payload,summary};
}
