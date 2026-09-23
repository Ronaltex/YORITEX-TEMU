export const isQuantity = value => Number.isSafeInteger(value) && value >= 0;
export function quantityState(client, parts) {
  const rows=parts.filter(p=>p.client_id===client.id);
  const legacyZero=p=>p.result==='not_purchased'||['pending','reassigned'].includes(p.status);
  const unknown=rows.filter(p=>!isQuantity(p.purchased_quantity)&&!legacyZero(p));
  const bought=rows.reduce((sum,p)=>sum+(isQuantity(p.purchased_quantity)?p.purchased_quantity:0),0);
  const total=isQuantity(client.product_quantity)?client.product_quantity:null;
  const known=total!==null&&!unknown.length;
  const remaining=known?Math.max(0,total-bought):null;
  return {total,bought,unknown,known,remaining,excess:total!==null&&bought>total,
    pending:Array.isArray(client.pending_products)?client.pending_products:[]};
}
export function validatePending(items, remaining, required=true) {
  if(!Array.isArray(items))throw new Error('Revisa el detalle de productos pendientes.');
  if(items.some(i=>!i.description?.trim()||!Number.isSafeInteger(i.quantity)||i.quantity<=0))throw new Error('Cada pendiente necesita una descripción y una cantidad entera mayor que cero.');
  const sum=items.reduce((n,i)=>n+i.quantity,0);
  if(remaining!==null&&(required||items.length)&&sum!==remaining)throw new Error(`El detalle de pendientes suma ${sum}; debe sumar ${remaining}.`);
  return items;
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function pendingEditor(items=[]) {
  return `<div class="quantity-pending"><p>Productos que quedan pendientes <small>Modifica las filas para dejar solo lo que falta comprar.</small></p><div class="pending-items">${items.map(pendingRow).join('')}</div><button type="button" class="secondary" data-add-pending>＋ Añadir producto pendiente</button></div>`;
}
function pendingRow(item={description:'',quantity:1}) {
  return `<div class="pending-item"><label>Producto / talla / color<input class="pending-description" value="${esc(item.description)}"></label><label>Unidades<input class="pending-quantity" type="number" min="1" step="1" value="${esc(item.quantity)}"></label><button type="button" class="secondary" data-remove-pending>Quitar</button></div>`;
}
export function readPending(container) {
  return [...container.querySelectorAll('.pending-item')].map(row=>({description:row.querySelector('.pending-description').value.trim(),quantity:Number(row.querySelector('.pending-quantity').value)}));
}
export function bindPendingEditors() {
  document.addEventListener('click',event=>{
    const add=event.target.closest('[data-add-pending]');
    if(add)add.closest('.quantity-pending').querySelector('.pending-items').insertAdjacentHTML('beforeend',pendingRow());
    const remove=event.target.closest('[data-remove-pending]');
    if(remove)remove.closest('.pending-item').remove();
  });
}
