import { quantityState, validatePending, pendingEditor, readPending } from './quantities.js';
import { updateRecord, deleteRecord, addCaptures, signedCaptureUrls, savePartUnits } from './database.js';

// Only business fields are editable; ownership and relationships stay protected.
const choices = {
  status: { open:'Abierto', ordered:'Comprado', in_transit:'En tránsito', receiving:'Recibiendo', completed:'Completado', archived:'Archivado', pending:'Pendiente de compra', received:'Recibida', lost:'Perdida', cancelled:'Cancelada', reassigned:'Reubicada' },
  result: { complete:'Completa', missing_items:'Faltaron artículos', not_purchased:'No se compró' },
  payment_type: { deposit:'Anticipo', payment:'Pago', refund:'Devolución', correction:'Corrección a favor del cliente' },
  delivery_type: { partial:'Parcial', final:'Final' },
  incident_type: { missing_product:'Producto faltante', lost_part:'Parte perdida', cancelled_part:'Parte cancelada', partial_delivery:'Entrega parcial', other:'Otro' }
};
const field = (key, label, type = 'text', required = false, options) => ({ key, label, type, required, options });
const schemas = {
  clients: ['persona', [field('name','Nombre completo','text',true),field('phone','WhatsApp','tel'),field('products_total','Valor de productos ($)','number',true),field('product_quantity','Total de unidades pedidas','integer',true),field('estimated_weight','Peso estimado (lb)','number'),field('notes','Nota interna','textarea'),field('is_closed','Finalizado','checkbox')]],
  order_closures: ['cierre', [field('title','Nombre del cierre','text',true),field('announced_date','Fecha anunciada','date',true),field('status','Estado','select',true,['open','ordered','in_transit','receiving','completed','archived']),field('notes','Nota interna','textarea')]],
  purchases: ['compra', [field('purchase_date','Fecha de compra','date',true),field('account_label','Cuenta utilizada','text',true),field('real_cost','Costo real ($)','number',true),field('notes','Nota interna','textarea')]],
  payments: ['pago', [field('amount','Valor ($)','number',true),field('payment_type','Tipo de movimiento','select',true,Object.keys(choices.payment_type)),field('note','Nota','textarea')]],
  weight_entries: ['entrega', [field('weight_lbs','Peso (lb)','number',true),field('delivery_type','Tipo de entrega','select',true,['partial','final']),field('pending_reason','Motivo de entrega parcial'),field('note','Nota','textarea')]],
  purchase_parts: ['parte del pedido', [field('purchased_quantity','Unidades compradas en esta parte','integer',true),field('assigned_value','Valor incluido ($)','number',true),field('result','Resultado de compra','select',true,Object.keys(choices.result)),field('status','Estado','select',true,['pending','in_transit','received','lost','cancelled','reassigned']),field('missing_note','Qué faltó / observación','textarea')]],
  incidents: ['incidencia', [field('incident_type','Tipo','select',true,Object.keys(choices.incident_type)),field('description','Descripción','textarea',true),field('deduction','Descuento ($)','number',true)]],
  captures: ['captura', [field('original_name','Nombre de la captura','text',true),field('sort_order','Orden','integer',true)]]
};

export function setupManagement({ state, refresh, toast, escapeHTML: esc, money, quantitiesChanged = () => {} }) {
  const $ = s => document.querySelector(s);
  let editing, historyClientId, historyPurchaseId, busy = false;
  const rows = table => table === 'order_closures' ? state.closures : state.data?.[({weight_entries:'weights',purchase_parts:'parts'})[table] || table] || [];
  const button = (table, id, action, label) => `<button type="button" class="${action === 'delete' ? 'danger' : 'secondary'}" data-manage="${action}" data-table="${table}" data-id="${id}">${label}</button>`;
  const describe = (table, row) => {
    if (table === 'clients') return row.name;
    if (table === 'order_closures') return row.title;
    if (table === 'purchases') return `Compra #${row.purchase_number}`;
    if (table === 'payments') return `${choices.payment_type[row.payment_type]} · ${money(row.amount)} · ${new Date(row.paid_at).toLocaleDateString('es-EC')}${row.note ? ` · ${row.note}` : ''}`;
    if (table === 'weight_entries') return `${row.weight_lbs} lb · ${choices.delivery_type[row.delivery_type]}${row.note ? ` · ${row.note}` : ''}`;
    if (table === 'purchase_parts') return `Compra #${rows('purchases').find(p=>p.id === row.purchase_id)?.purchase_number ?? '—'} · ${row.purchased_quantity ?? "Por completar"} unidades · ${choices.status[row.status]}`;
    if (table === 'incidents') return `${row.description} · descuento ${money(row.deduction)}`;
    return row.original_name || 'Captura';
  };
  function openEditor(table, id) {
    const row = rows(table).find(r => r.id === id);
    if (!row) return toast('Este registro ya no está disponible. Actualiza la página.');
    const person = table === 'clients' ? row : table === 'purchase_parts' ? rows('clients').find(c=>c.id===row.client_id) : null;
    editing = { table, id, row: { ...row }, clientRevision: person?.updated_at };

    $('#editRecordTitle').textContent = `Editar ${schemas[table][0]}`;
    $('#editRecordFields').innerHTML = schemas[table][1].map(f => {
      const attrs = `name="${f.key}" ${f.required ? 'required' : ''}`;
      let control;
      if (f.type === 'select') control = `<select ${attrs}>${f.options.map(v=>`<option value="${v}" ${row[f.key] === v ? 'selected' : ''}>${esc(choices[f.key][v])}</option>`).join('')}</select>`;
      else if (f.type === 'textarea') control = `<textarea ${attrs}>${esc(row[f.key])}</textarea>`;
      else if (f.type === 'checkbox') control = `<input ${attrs} type="checkbox" ${row[f.key] ? 'checked' : ''}>`;
      else control = `<input ${attrs} type="${f.type === 'integer' ? 'number' : f.type}" value="${esc(row[f.key] ?? '')}" ${['number','integer'].includes(f.type) ? `min="${f.key === 'weight_lbs' ? '0.01' : '0'}" step="${f.type === 'integer' ? '1' : '0.01'}"` : ''}>`;
      return `<label>${esc(f.label)}${control}</label>`;
    }).join('');
    $('#editRecordNote').textContent = table === 'purchase_parts' ? 'Los descuentos se corrigen por separado en «Incidencias y descuentos». Cambiar el estado no elimina descuentos existentes.' : 'Los saldos y el comprobante se actualizarán al guardar.';
    if(person) {
      $('#editRecordFields').insertAdjacentHTML('beforeend', '<div class="quantity-edit-summary"></div>'+pendingEditor(person.pending_products || []));
      const updateSummary=()=>{
        const input=$('#editRecordFields input[name="'+(table==='clients'?'product_quantity':'purchased_quantity')+'"]');
        const value=input.value===''?null:Number(input.value);
        const q=quantityState(table==='clients'?{...person,product_quantity:value}:person, rows('purchase_parts').map(p=>table==='purchase_parts'&&p.id===id?{...p,purchased_quantity:value}:p));
        $('#editRecordFields .quantity-edit-summary').textContent=q.known?'Pedido: '+q.total+' · Comprados: '+q.bought+' · Pendientes: '+q.remaining+(table==='clients'?' (puedes detallar los pendientes ahora o al comprar).':' · Describe abajo los productos que faltan.'):'Completa también las cantidades de los registros anteriores para calcular el pendiente.';
      };
      $('#editRecordFields input[name="'+(table==='clients'?'product_quantity':'purchased_quantity')+'"]').addEventListener('input',updateSummary);
      updateSummary();
      $('#editRecordNote').textContent='Las cantidades y el detalle pendiente son internos; no se añaden al comprobante. Los precios y descuentos se editan por separado.';
    }
    $('#editRecordError').textContent = '';
    $('#editRecordDialog').showModal();
  }
  function history(id) {
    const client = rows('clients').find(r=>r.id === id);
    if (!client) { $('#historyDialog').close(); return; }
    historyClientId = id; historyPurchaseId = null;
    $('#captureUpload').closest('label').hidden=false; $('#uploadCapturesBtn').hidden=false;
    $('#historyTitle').textContent = `Registros de ${client.name}`;
    $('#historyContent').innerHTML = [['payments','Pagos'],['weight_entries','Libras y entregas'],['purchase_parts','Partes del pedido'],['incidents','Incidencias y descuentos'],['captures','Capturas']].map(([table,label])=> {
      const list = rows(table).filter(r=>r.client_id === id);
      return `<section class="history-section"><h3>${label}</h3>${list.length ? list.map(row=>`<article class="history-row"><span>${esc(describe(table,row))}</span><div>${table === 'captures' ? button(table,row.id,'view','Ver') : ''}${button(table,row.id,'edit','Editar')}${button(table,row.id,'delete','Eliminar')}</div></article>`).join('') : '<p>Sin registros.</p>'}</section>`;
    }).join('');
    $('#captureUpload').value = '';
    $('#historyError').textContent = '';
    if (!$('#historyDialog').open) $('#historyDialog').showModal();
  }
  function purchaseUnits(id) {
    historyPurchaseId=id; historyClientId=null;
    const purchase=rows('purchases').find(p=>p.id===id);
    if(!purchase) { $('#historyDialog').close();return; }
    $('#historyTitle').textContent='Unidades de la compra #'+purchase.purchase_number;
    $('#historyContent').innerHTML=rows('purchase_parts').filter(p=>p.purchase_id===id).map(p=>'<article class="history-row"><span>'+esc(rows('clients').find(c=>c.id===p.client_id)?.name)+' · '+esc(describe('purchase_parts',p))+'</span>'+button('purchase_parts',p.id,'edit','Editar unidades')+'</article>').join('') || '<p>Sin partes registradas.</p>';
    $('#captureUpload').closest('label').hidden=true; $('#uploadCapturesBtn').hidden=true;
    $('#historyError').textContent='';
    if(!$('#historyDialog').open)$('#historyDialog').showModal();
  }
  async function reload() {
    await refresh();
    if ($('#historyDialog').open) historyPurchaseId ? purchaseUnits(historyPurchaseId) : history(historyClientId);
    quantitiesChanged();
  }
  async function remove(table, id) {
    const row = rows(table).find(r=>r.id === id);
    if (!row) return;
    const effects = {
      clients:'También se eliminarán sus pagos, capturas, partes, incidencias y libras. Las compras compartidas y su costo se conservarán.',
      order_closures:'También se eliminarán TODAS las personas, pagos, capturas, compras, partes, incidencias y libras de este cierre.',
      purchases:'También se eliminarán sus partes y las incidencias vinculadas. Los clientes, pagos y libras se conservarán.',
      purchase_parts:'También se eliminarán las incidencias y descuentos vinculados a esta parte.'
    };
    if (!confirm(`¿Eliminar ${schemas[table][0]}: ${describe(table,row)}?\n\n${effects[table] || 'Los totales se recalcularán.'}\n\nEsta acción no se puede deshacer.`)) return;
    const result = await deleteRecord(table, id);
    await reload();
    toast(result.warning || 'Registro eliminado.');
  }
  async function action(task, errorSelector = '#historyError') {
    if (busy) return;
    busy = true;
    const buttons = [...document.querySelectorAll('#editRecordDialog button, #historyDialog button, [data-manage]')];
    buttons.forEach(b=>b.disabled = true);
    try { await task(); }
    catch (error) { $(errorSelector).textContent = error.message; toast(error.message); }
    finally { busy = false; buttons.forEach(b=>b.disabled = false); }
  }
  document.addEventListener('click', event => {
    const b = event.target.closest('[data-manage]');
    if (!b || busy) return;
    const { manage, table, id } = b.dataset;
    if (manage === 'edit') openEditor(table, id);
    if (manage === 'history') history(id);
    if (manage === 'units') purchaseUnits(id);
    if (manage === 'delete') action(()=>remove(table,id));
    if (manage === 'view') action(async()=> {
      const [capture] = await signedCaptureUrls([rows('captures').find(r=>r.id === id)]);
      $('#captureImage').src = capture.signed_url;
      $('#captureViewDialog').showModal();
    });
  });
  $('#editRecordForm').addEventListener('submit', event => {
    event.preventDefault();
    action(async()=> {
      const {table,id,row} = editing;
      const values = {};
      for (const f of schemas[table][1]) {
        const input = event.target.elements.namedItem(f.key);
        values[f.key] = f.type === 'checkbox' ? input.checked : input.value.trim() || null;
        if (f.required && values[f.key] === null) throw new Error(`Completa: ${f.label}.`);
        if (['number','integer'].includes(f.type) && values[f.key] !== null) values[f.key] = Number(values[f.key]);
      }
      if (table === 'purchase_parts') {
        if (values.result === 'not_purchased' && values.assigned_value !== 0) throw new Error('Una parte no comprada debe tener valor 0.');
        values.arrived_at = ['received','lost','cancelled'].includes(values.status) ? row.arrived_at || new Date().toISOString() : null;
      }
      let result;
      if(table==='clients'||table==='purchase_parts') {
        const key=table==='clients'?'product_quantity':'purchased_quantity';
        if(!Number.isSafeInteger(values[key])||values[key]<0)throw new Error('Usa una cantidad entera mayor o igual a cero.');
        if(table==='purchase_parts'&&values.result==='not_purchased'&&values.purchased_quantity!==0)throw new Error('Una parte no comprada debe tener cero unidades.');
        const person=table==='clients'?{...row,...values}:rows('clients').find(c=>c.id===row.client_id);
        const q=quantityState(person,rows('purchase_parts').map(p=>table==='purchase_parts'&&p.id===id?{...p,...values}:p));
        if(q.excess)throw new Error('Lo comprado supera el total de unidades. Corrige primero las compras anteriores.');
        const pending=q.known&&q.remaining===0?[]:validatePending(readPending($('#editRecordFields')),q.remaining,table==='purchase_parts');
        if(table==='clients') { values.pending_products=pending; result=await updateRecord(table,id,values,row.updated_at); }
        else result=await savePartUnits(id,values,pending,editing.clientRevision);
      } else result = await updateRecord(table,id,values);
      $('#editRecordDialog').close();
      await reload();
      toast(result.warning || 'Cambios guardados.');
    }, '#editRecordError');
  });
  $('#uploadCapturesBtn').addEventListener('click', ()=>action(async()=> {
    const files = [...$('#captureUpload').files];
    if (!files.length) throw new Error('Selecciona al menos una captura.');
    try { await addCaptures(historyClientId,files); }
    catch (error) {
      await reload();
      throw new Error(`No se completó la subida. Revisa las capturas guardadas y selecciona solo las que faltan. ${error.message}`);
    }
    await reload();
    toast('Capturas añadidas.');
  }));
  for (const id of ['editRecordDialog','historyDialog','captureViewDialog']) {
    const dialog = $(`#${id}`);
    dialog.addEventListener('cancel', event=> { if (busy) event.preventDefault(); });
  }
  return { button };
}
