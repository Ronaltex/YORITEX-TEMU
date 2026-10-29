import { setupVisualProducts } from './visual-products.js?v=20261028-productos';
import { moneyRound, freightPolicy, freightCharge, interestCharge, pricingFor, minimumText } from './pricing.js';
import { quantityState, validatePending, pendingEditor, readPending, bindPendingEditors } from './quantities.js?v=20261028-productos';
import { financialSummary, pendingNotices } from './dashboard.js';
import { captureRows as getCaptureRows } from './invoice-layout.js';
import { setupManagement } from './management.js?v=20261028-productos';
import {
  isConfigured, getSession, onAuthChange, signIn, signOut, sendPasswordReset, updatePassword,
  ensureSettings, updateSettings, listClosures, createClosure, createClient,
  addPayment, createPurchase, createVisualPurchase, registerArrival, addWeight, setClientClosed,
  loadClosure, signedCaptureUrls, subscribeToChanges, confirmPrice
} from './database.js?v=20261028-productos';
import { generateInvoiceBlob, downloadBlob, copyImage, shareImage } from './comprobante.js?v=20261028-productos';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
const number = value => Number(value) || 0;
const today = () => new Date().toISOString().slice(0, 10);
const dateLabel = value => new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
const shortDate = value => new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00`));
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const initials = name => String(name).trim().split(/\s+/).slice(0, 2).map(item => item[0]).join('').toUpperCase();

const state = {
  session: null,
  settings: null,
  closures: [],
  selectedClosureId: null,
  data: null,
  activeClient: null,
  invoiceDetail: null,
  filter: 'all',
  stopRealtime: null,
  reloadTimer: null
};

bindPendingEditors();
const visual = setupVisualProducts({state,refresh:()=>refreshClosures(state.selectedClosureId),toast});
document.addEventListener('visual-manage',event=>visual.open(event.detail.clientId).catch(e=>toast(e.message)));
const management = setupManagement({ state, refresh: () => refreshClosures(state.selectedClosureId), toast, escapeHTML, money, quantitiesChanged: () => { if ($('#purchaseDialog').open) { openPurchaseDialog(true); toast('Cantidades actualizadas. Vuelve a seleccionar las personas de esta compra.'); } } });

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(element.timer);
  element.timer = setTimeout(() => element.classList.remove('show'), 3200);
}

function loading(show, text = 'Guardando información…') {
  $('#loading p').textContent = text;
  $('#loading').hidden = !show;
}

async function run(task, successMessage) {
  loading(true);
  try {
    const result = await task();
    if (successMessage) toast(successMessage);
    return result;
  } catch (error) {
    console.error(error);
    toast(error.message || 'No se pudo completar la operación.');
    throw error;
  } finally {
    loading(false);
  }
}

function showDialog(selector) {
  const dialog = $(selector);
  if (!dialog.open) dialog.showModal();
}

function closeDialog(selector) {
  const dialog = typeof selector === 'string' ? $(selector) : selector;
  if (dialog?.open) dialog.close();
}

function clientFinance(client) {
  const payments = state.data.payments.filter(item => item.client_id === client.id);
  const paid = payments.reduce((sum, item) => sum + (item.payment_type === 'refund' ? -number(item.amount) : number(item.amount)), 0);
  const incidents = state.data.incidents.filter(item => item.client_id === client.id);
  const deduction = incidents.reduce((sum, item) => sum + number(item.deduction), 0);
  const adjustedProducts = Math.max(0, number(client.products_total) - deduction);
  const weights = state.data.weights.filter(item => item.client_id === client.id);
  const totalWeight = weights.reduce((sum, item) => sum + number(item.weight_lbs), 0);
  const pricing = pricingFor(client,state.settings,adjustedProducts,totalWeight);
  const charge = pricing.pounds;
  const balance = moneyRound(pricing.products + charge + pricing.interest - paid);
  const parts = state.data.parts.filter(item => item.client_id === client.id);
  const unresolved = parts.filter(item => ['pending','in_transit'].includes(item.status));
  const received = parts.filter(item => item.status === 'received');
  const captures = state.data.captures.filter(item => item.client_id === client.id);
  return {
    client, payments, paid, incidents, deduction, adjustedProducts:pricing.products, rawProducts:adjustedProducts, interest:pricing.interest, pricing, weights,
    totalWeight, poundCharge: charge, due: Math.max(0, balance), credit: Math.max(0, -balance),
    parts, unresolved, received, captures, quantity: quantityState(client,state.data.parts)
  };
}

function statusFor(finance) {
  if (finance.client.is_closed) return { key: 'completed', label: 'Finalizado', cls: 'green' };
  if (finance.parts.length && finance.unresolved.length) {
    const complete = finance.parts.length - finance.unresolved.length;
    return { key: 'attention', label: complete ? `${complete} de ${finance.parts.length} partes resueltas` : 'En tránsito o pendiente', cls: 'violet' };
  }
  if (finance.parts.length && !finance.totalWeight) return { key: 'attention', label: 'Todo recibido · Falta pesar', cls: 'green' };
  if (finance.totalWeight && finance.due > .009) return { key: 'attention', label: 'Detalle listo · Por cobrar', cls: 'blue' };
  if (finance.totalWeight && finance.due <= .009) return { key: 'completed', label: 'Pagado · Listo para cerrar', cls: 'green' };
  if (!finance.payments.length && finance.client.payment_mode !== 'on_delivery') return {key:'attention',label:'Anticipo pendiente (no bloquea el pedido)',cls:'orange'};
  return {key:'all',label:finance.client.payment_mode==='on_delivery'?'Paga al recibir · Pendiente de compra':'Anticipo registrado · Falta comprar',cls:'blue'};
}

function partLabel(part) {
  const labels = {
    pending: 'Pendiente de compra', in_transit: 'En tránsito', received: 'Recibida',
    lost: 'Perdida', cancelled: 'Cancelada', reassigned: 'Reubicada en otra compra'
  };
  return labels[part.status] || part.status;
}

function clientAction(finance) {
  const id=finance.client.id;
  let html='<button data-action="visual" data-client="'+id+'">'+(finance.quantity.known&&finance.quantity.remaining>0?'Pendiente de comprar: '+finance.quantity.remaining+' · Ver / descontar':'Productos · Corregir / no llegó')+'</button><button data-action="payment" data-client="'+id+'">Registrar pago</button><button data-action="weight" data-client="'+id+'">'+(finance.totalWeight?'Registrar otra entrega':'Registrar libras')+'</button>';
  if(finance.unresolved.length) html+='<button class="main-action" data-action="arrival" data-client="'+id+'">Registrar llegada</button>';
  if(finance.client.is_closed)html+='<button data-action="reopen-client" data-client="'+id+'">Reabrir</button>';
  else if(finance.totalWeight && finance.due<=.009 && !finance.unresolved.length && !(finance.quantity.known&&finance.quantity.remaining>0) && finance.pricing.confirmed && !finance.pricing.review) html+='<button data-action="close-client" data-client="'+id+'">Finalizar cliente</button>';
  return html;
}

function renderClosures() {
  const count=state.closures.length, full=count>=4;
  $('#closureSelect').innerHTML=count?state.closures.map(c=>'<option value="'+c.id+'" '+(c.id===state.selectedClosureId?'selected':'')+'>'+escapeHTML(c.title)+'</option>').join(''):'<option value="">Sin cierres todavía</option>';
  $('#closureSelect').disabled=!count;
  $('#closureCapacity').textContent=count+' de 4 cierres guardados. '+(full?'Elimina uno terminado para liberar espacio.':'Puedes crear otro aunque los anteriores tengan saldos pendientes.');
  for(const id of ['newClosureBtn','newClosureTopBtn','firstClosureBtn']) {$('#'+id).disabled=full;$('#'+id).title=full?'Límite de cuatro cierres. Elimina uno terminado.':'Crear otro cierre independiente';}

  $('#closureList').innerHTML = state.closures.map(closure => {
    const dateParts=new Intl.DateTimeFormat('es-EC',{day:'2-digit',month:'short'}).formatToParts(new Date(closure.announced_date+'T12:00:00'));
    const day=dateParts.find(p=>p.type==='day')?.value||'', month=(dateParts.find(p=>p.type==='month')?.value||'').toUpperCase().replace('.','');
    return `<button class="closure-button ${closure.id === state.selectedClosureId ? 'active' : ''}" data-closure="${closure.id}"><span class="date">${day}<small>${month}</small></span><span><strong>${escapeHTML(closure.title)}</strong><small>${escapeHTML(closure.status.replace('_', ' '))}</small></span></button>`;
  }).join('');
}

function renderClients() {
  const container = $('#clientList');
  const rows = state.data.clients.map(client => ({ finance: clientFinance(client) }));
  const filtered = rows.filter(({ finance }) => {
    const status = statusFor(finance);
    return state.filter === 'all' || status.key === state.filter;
  });
  $('#emptyClients').hidden = state.data.clients.length > 0;
  container.innerHTML = filtered.map(({ finance }) => {
    const status = statusFor(finance);
    const creditOrDue = finance.credit > 0
      ? `<strong class="credit">A favor ${money(finance.credit)}</strong>`
      : `<strong class="${finance.due > 0 ? 'due' : ''}">${money(finance.due)}</strong>`;
    const parts = finance.parts.map((part, index) => `<div class="part-chip"><strong>Parte ${index + 1} · ${part.purchased_quantity == null ? "Cantidad por completar" : part.purchased_quantity + " unidad(es)"}</strong><span>${partLabel(part)}${part.missing_note ? ` · ${escapeHTML(part.missing_note)}` : ''}</span>${['pending','in_transit'].includes(part.status) ? `<button data-action="arrival-part" data-client="${finance.client.id}" data-part="${part.id}">Registrar llegada</button>` : ''}</div>`).join('');
    return `<article class="client-card ${finance.client.is_closed ? 'completed' : ''}" data-status="${status.key}"><div class="client-person"><span class="client-avatar">${escapeHTML(initials(finance.client.name))}</span><div><strong>${escapeHTML(finance.client.name)}</strong><small>${finance.captures.length} captura(s) · ${escapeHTML(finance.client.phone || 'Sin teléfono')}</small></div></div><div class="client-status"><span class="pill ${status.cls}">${escapeHTML(status.label)}</span><small class="pricing-state">${finance.pricing.review?"Revisar precio acordado":finance.pricing.confirmed?"Precio confirmado":"Precio sin confirmar"}</small></div><div class="money-column"><span>Productos</span><strong>${money(finance.adjustedProducts)}</strong></div><div class="money-column"><span>Abonado</span><strong>${money(finance.paid)}</strong></div><div class="money-column"><span>Saldo</span>${creditOrDue}</div><div class="client-actions">${clientAction(finance)}${management.button('clients',finance.client.id,'edit','Editar')}${management.button('clients',finance.client.id,'history','Historial')}${management.button('clients',finance.client.id,'delete','Eliminar')}<button data-action="detail" data-client="${finance.client.id}">Ver detalle</button><button data-action="price" data-client="${finance.client.id}">${finance.pricing.confirmed?"Revisar precio confirmado":"Confirmar precio final"}</button></div>${parts ? `<div class="parts-strip">${parts}</div>` : ''}</article>`;
  }).join('');
}

function renderPurchases() {
  $('#emptyPurchases').hidden = state.data.purchases.length > 0;
  $('#purchaseList').innerHTML = state.data.purchases.map(purchase => {
    const parts = state.data.parts.filter(item => item.purchase_id === purchase.id);
    const chips = parts.map(part => {
      const client = state.data.clients.find(item => item.id === part.client_id);
      return `<span>${escapeHTML(client?.name || 'Cliente')} · ${part.purchased_quantity == null ? 'Cantidad por completar' : part.purchased_quantity+' unidad(es)'} · ${escapeHTML(partLabel(part))}</span>`;
    }).join('');
    return `<article class="purchase-card"><div class="purchase-number">${purchase.purchase_number}</div><div><span class="pill blue">${escapeHTML(purchase.status.replace('_', ' ').toUpperCase())}</span><h4>Compra Temu #${purchase.purchase_number}</h4><p>${dateLabel(purchase.purchase_date)} · ${escapeHTML(purchase.account_label)}</p></div><div class="management-actions">${management.button('purchases',purchase.id,'edit','Editar compra')}${management.button('purchases',purchase.id,'units','Editar unidades')}${management.button('purchases',purchase.id,'delete','Eliminar compra')}</div><div class="purchase-parts">${chips || '<span>Sin partes vinculadas</span>'}</div></article>`;
  }).join('');
}

function renderDashboard() {
  if (!state.data) return;
  const closure = state.data.closure;
  if (state.cmdClosureId !== closure.id) closeCmd();
  state.cmdClosureId = closure.id;
  const finances = state.data.clients.map(clientFinance);
  const products = finances.reduce((sum, item) => sum + item.adjustedProducts, 0);
  const payments = finances.reduce((sum, item) => sum + item.paid, 0);
  const costs = state.data.purchases.reduce((sum, item) => sum + number(item.real_cost), 0);
  const pounds = finances.reduce((sum, item) => sum + item.poundCharge, 0);
  const productProfit = products - costs;
  const summary = financialSummary(finances,state.data.purchases);
  $('#closureManagement').innerHTML = management.button('order_closures',closure.id,'edit','Editar cierre') + management.button('order_closures',closure.id,'delete','Eliminar terminado y liberar espacio');
  $('#topTitle').textContent = closure.title;
  $('#closureTitle').textContent = closure.title;
  $('#closureDate').textContent = `Fecha anunciada: ${dateLabel(closure.announced_date)}`;
  $('#closureStatus').textContent = closure.status.replace('_', ' ').toUpperCase();
  $('#metricClients').textContent = state.data.clients.length;
  $('#metricProducts').textContent = money(products);
  $('#metricPayments').textContent = money(payments);
  $('#metricDue').textContent = money(summary.due);
  $('#clientCountBadge').textContent = state.data.clients.length;
  $('#purchaseCountBadge').textContent = state.data.purchases.length;
  $('#profitRevenue').textContent = money(products);
  $('#profitCosts').textContent = money(costs);
  $('#profitProducts').textContent = money(productProfit);
  $('#profitPounds').textContent = money(pounds);
  $('#profitInterest').textContent = money(summary.interest);
  $('#profitTotal').textContent = money(summary.profit);
  const percent = value => value === null ? 'Pendiente de costo' : new Intl.NumberFormat('es-EC',{maximumFractionDigits:1}).format(value)+' % sobre costo';
  $('#productPercent').textContent = percent(summary.productPercent);
  $('#poundPercent').textContent = summary.weight.toFixed(2)+' lb · '+percent(summary.poundPercent);
  $('#totalPercent').textContent = percent(summary.totalPercent);
  $('#costPercentNote').textContent = summary.costs>0 ? 'Los porcentajes se calculan sobre el costo de las compras registradas, no sobre el precio de venta.' : 'Registra los costos de compra para calcular porcentajes. Los valores en dólares usan el costo registrado actual: $0,00.';
  for (const [id,value] of [['cmdRevenue',summary.revenue],['cmdPaid',summary.paid],['cmdDue',summary.due],['cmdCredit',summary.credit]]) $('#'+id).textContent=money(value);
  $('#profitProducts').classList.toggle('negative',summary.productProfit<0);
  $('#profitTotal').classList.toggle('negative',summary.profit<0);
  $('#cmdPurchases').innerHTML = state.data.purchases.length ? state.data.purchases.map(p=>'<div class="cmd-purchase"><span>Compra #'+p.purchase_number+' · '+escapeHTML(p.account_label)+'</span><strong>'+money(p.real_cost)+'</strong>'+management.button('purchases',p.id,'edit','Editar compra')+'</div>').join('') : '<p class="cmd-note">Todavía no hay compras registradas.</p>';
  renderNotices(finances);
  renderClients();
  renderPurchases();
}

async function refreshClosures(preferredId) {
  state.closures = await listClosures();
  const stored = localStorage.getItem('yori-tex-closure');
  state.selectedClosureId = preferredId || state.selectedClosureId || stored || state.closures[0]?.id || null;
  if (!state.closures.some(item => item.id === state.selectedClosureId)) state.selectedClosureId = state.closures[0]?.id || null;
  renderClosures();
  $('#noClosure').hidden = Boolean(state.selectedClosureId);
  $('#closureWorkspace').hidden = !state.selectedClosureId;
  if (state.selectedClosureId) await refreshSelected();
}

async function refreshSelected() {
  if (!state.selectedClosureId) return;
  state.data = await loadClosure(state.selectedClosureId);
  localStorage.setItem('yori-tex-closure', state.selectedClosureId);
  renderClosures();
  renderDashboard();
}

async function enterApp(session) {
  state.session = session;
  $('#authScreen').hidden = true;
  $('#app').hidden = false;
  $('#sessionEmail').textContent = session.user.email;
  await run(async () => {
    state.settings = await ensureSettings();
    $('#settingRate').value = state.settings.pound_rate;
    $('#settingMin').value = state.settings.minimum_pound_charge;
    $('#settingMax').value = state.settings.maximum_pound_charge;
    await refreshClosures();
  }, null);
  state.stopRealtime?.();
  state.stopRealtime = subscribeToChanges(() => {
    clearTimeout(state.reloadTimer);
    state.reloadTimer = setTimeout(() => refreshClosures(state.selectedClosureId).catch(console.error), 450);
  });
}

function leaveApp() {
  closeCmd();
  state.stopRealtime?.();
  state.stopRealtime = null;
  state.session = null;
  state.data = null;
  $('#app').hidden = true;
  $('#authScreen').hidden = false;
}

async function initialize() {
  if (!isConfigured()) {
    $('#setupScreen').hidden = false;
    return;
  }
  const session = await getSession();
  if (session) await enterApp(session);
  else $('#authScreen').hidden = false;
  onAuthChange((sessionValue, event) => {
    if (event === 'PASSWORD_RECOVERY') showDialog('#passwordDialog');
    if (!sessionValue && state.session) leaveApp();
  });
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('#loginError').hidden = true;
  try {
    const session = await run(() => signIn($('#loginEmail').value.trim(), $('#loginPassword').value), null);
    await enterApp(session);
  } catch (error) {
    $('#loginError').textContent = 'Correo o contraseña incorrectos. Revisa los datos e inténtalo nuevamente.';
    $('#loginError').hidden = false;
  }
});

$('#resetPasswordBtn').addEventListener('click', async () => {
  const email = $('#loginEmail').value.trim();
  if (!email) return toast('Primero escribe tu correo electrónico.');
  await run(() => sendPasswordReset(email), 'Revisa tu correo para cambiar la contraseña.').catch(() => {});
});

$('#passwordForm').addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('#newPassword').value;
  if (password.length < 10) return toast('La contraseña debe tener al menos 10 caracteres.');
  if (password !== $('#confirmPassword').value) return toast('Las contraseñas no coinciden.');
  try {
    await run(() => updatePassword(password), 'Contraseña actualizada correctamente.');
    closeDialog('#passwordDialog');
    $('#passwordForm').reset();
  } catch {}
});

$('#signOutBtn').addEventListener('click', () => run(signOut, null).catch(() => {}));
$('#refreshBtn').addEventListener('click', () => run(() => refreshClosures(state.selectedClosureId), 'Información actualizada.').catch(() => {}));

$('#closureList').addEventListener('click', event => {
  const button = event.target.closest('[data-closure]');
  if (!button) return;
  closeCmd();
  state.selectedClosureId = button.dataset.closure;
  run(refreshSelected, null).catch(() => {});
});

function openClosureDialog() {
  if(state.closures.length>=4)return toast('Ya tienes cuatro cierres. Elimina uno terminado para liberar espacio.');
  closeCmd();
  $('#closureCreateError').textContent='';
  $('#closureDialogHint').textContent='Tienes '+state.closures.length+' de 4 cierres. Este nuevo pedido tendrá sus propias personas, compras y pagos; los anteriores se conservan.';
  $('#closureForm').reset();
  $('#newClosureDate').value = today();
  showDialog('#closureDialog');
}
$('#newClosureBtn').addEventListener('click', openClosureDialog);
$('#newClosureTopBtn').addEventListener('click',openClosureDialog);
$('#closureSelect').addEventListener('change',event=>{if(!event.target.value)return;closeCmd();state.selectedClosureId=event.target.value;run(refreshSelected,null).catch(()=>{});});
$('#firstClosureBtn').addEventListener('click', openClosureDialog);

$('#closureForm').addEventListener('submit',async event=>{
  event.preventDefault();if(event.target.dataset.saving)return;
  const submit=event.target.querySelector('button[type="submit"]');
  $('#closureCreateError').textContent='';
  if(state.closures.length>=4){$('#closureCreateError').textContent='Elimina un cierre terminado antes de crear otro.';return;}
  const title=$('#newClosureTitle').value.trim();if(!title){$('#closureCreateError').textContent='Escribe un nombre para este cierre.';return;}
  event.target.dataset.saving='true';submit.disabled=true;
  try {
    const row=await run(()=>createClosure({title,announced_date:$('#newClosureDate').value,notes:$('#newClosureNotes').value.trim()||null}),'Cierre creado correctamente.');
    closeDialog('#closureDialog');await refreshClosures(row.id);selectTab('people');
  } catch(error){$('#closureCreateError').textContent=error.message;}
  finally{delete event.target.dataset.saving;submit.disabled=false;}
});

function openClientDialog() {
  $('#clientForm').reset();
  $('#clientInterestValue').disabled=true;
  $('#clientForm .quote-preview').hidden=false;
  $('#depositPreview').textContent = money(0);
  $('#capturePreview').innerHTML = '<p>Puedes seleccionar varias capturas a la vez.</p>';
  showDialog('#clientDialog');
}
$('#newClientBtn').addEventListener('click', openClientDialog);
$('#emptyAddClient').addEventListener('click', openClientDialog);
$('#clientProducts').addEventListener('input', () => $('#depositPreview').textContent = money(number($('#clientProducts').value) / 2));
$('#clientCaptures').addEventListener('change', () => {
  const files = [...$('#clientCaptures').files];
  $('#capturePreview').innerHTML = files.length ? files.map(file => `<img src="${URL.createObjectURL(file)}" alt="Vista previa">`).join('') : '<p>Puedes seleccionar varias capturas a la vez.</p>';
});

$('#clientForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (event.target.dataset.saving) return;
  const duplicate = state.data.clients.find(client => client.name.trim().toLocaleLowerCase() === $('#clientName').value.trim().toLocaleLowerCase());
  if (duplicate && !confirm('Ya existe una persona con este nombre en el cierre. ¿Quieres crear otra de todas formas?')) return;
  event.target.dataset.saving = 'true';
  const submit = event.target.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    const saved = await run(() => createClient({
      closure_id: state.selectedClosureId,
      name: $('#clientName').value.trim(),
      phone: $('#clientPhone').value.trim() || null,
      products_total: number($('#clientProducts').value),
      product_quantity: Number($('#clientQuantity').value),
      payment_mode: $('#clientPaymentMode').value,
      interest_mode: $('#clientInterestMode').value,
      interest_value: $('#clientInterestMode').value==='none'?0:number($('#clientInterestValue').value),
      estimated_weight: $('#clientEstimatedWeight').value ? number($('#clientEstimatedWeight').value) : null,
      notes: $('#clientNotes').value.trim() || null
    }, [...$('#clientCaptures').files]), 'Persona y capturas guardadas.');
    closeDialog('#clientDialog');
    await refreshSelected();
    if (saved.uploadWarning) alert('La persona se guardó, pero algunas capturas no se subieron. Abre Historial para añadir las que faltan. No vuelvas a crear a la persona.\n\n' + saved.uploadWarning);
  } catch {}
  finally { delete event.target.dataset.saving; submit.disabled = false; }
});

function getClient(id) {
  return state.data.clients.find(item => item.id === id);
}

function openPayment(clientId) {
  const client = getClient(clientId);
  const finance = clientFinance(client);
  state.activeClient = client;
  const firstPayment = !finance.payments.length && client.payment_mode!=='on_delivery' && !finance.totalWeight && !finance.pricing.confirmed;
  const suggested = firstPayment ? Math.max(0, finance.adjustedProducts / 2) : finance.due;
  $('#paymentTitle').textContent = `Pago de ${client.name}`;
  $('#paymentCurrentDue').textContent = money(finance.due);
  $('#paymentSuggestionLabel').textContent = firstPayment ? 'Anticipo mínimo 50 %' : 'Saldo pendiente';
  $('#paymentSuggested').textContent = money(suggested);
  $('#paymentAmount').value = suggested.toFixed(2);
  $('#paymentNote').value = '';
  showDialog('#paymentDialog');
}

function paymentMessage(finance, amount) {
  const firstName = finance.client.name.split(' ')[0];
  if (finance.credit > .009) return `${firstName}, hemos registrado tu pago de ${money(amount)}. Tu pedido está cubierto y tienes ${money(finance.credit)} a favor; este valor se descontará de cualquier cobro pendiente. Gracias por tu compra con YORI-TEX.`;
  if (finance.due <= .009) return `${firstName}, hemos registrado tu pago de ${money(amount)}. Tu pedido quedó pagado en su totalidad. ¡Muchas gracias por tu compra y por confiar en YORI-TEX!`;
  return `${firstName}, hemos registrado tu pago de ${money(amount)}. Tu saldo pendiente actualizado es de ${money(finance.due)}. Gracias por tu abono.`;
}

function phoneForWhatsApp(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `593${digits.slice(1)}`;
  return digits;
}

function openWhatsApp(phone, message) {
  const digits = phoneForWhatsApp(phone);
  if (!digits) return toast('Este cliente no tiene número de WhatsApp registrado.');
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
}

$('#paymentForm').addEventListener('submit', async event => {
  event.preventDefault();
  const client = state.activeClient;
  const before = clientFinance(client);
  const amount = number($('#paymentAmount').value);
  const type = !before.payments.length && client.payment_mode!=='on_delivery' && !before.totalWeight && !before.pricing.confirmed ? 'deposit' : 'payment';
  try {
    await run(() => addPayment(client.id, amount, type, $('#paymentNote').value.trim()), 'Pago registrado.');
    closeDialog('#paymentDialog');
    await refreshSelected();
    const after = clientFinance(getClient(client.id));
    state.activeClient = after.client;
    $('#paymentMessage').textContent = paymentMessage(after, amount);
    showDialog('#messageDialog');
  } catch {}
});

$('#copyMessageBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#paymentMessage').textContent);
  toast('Mensaje copiado.');
});
$('#whatsappMessageBtn').addEventListener('click', () => openWhatsApp(state.activeClient.phone, $('#paymentMessage').textContent));

function openPurchaseDialog(preserve=false) {
  if(preserve!==true){$('#purchaseForm').reset();$('#purchaseDate').value=today();visual.reset();}
  $('#purchaseError').textContent='';
  const all=state.data.clients.map(client=>({client,q:quantityState(client,state.data.parts)}));
  const available=all.filter(({q})=>!q.known||q.excess||q.remaining>0);
  $('#purchaseClients').innerHTML=available.map(({client,q})=>'<article class="visual-client"><strong>'+escapeHTML(client.name)+'</strong><p>'+(q.known?'Pedido: '+q.total+' · Comprados: '+q.bought+' · Pendientes: '+q.remaining:'Completa las cantidades de esta persona y sus compras anteriores.')+'</p>'+(q.known&&!q.excess?'<button type="button" class="primary" data-purchase-captures="'+client.id+'">Ver capturas y marcar comprados</button><span class="visual-selected-count" data-count-client="'+client.id+'">Seleccionados: '+visual.summary(client.id)+'</span>':management.button('clients',client.id,'edit','Editar persona')+management.button('clients',client.id,'history','Ver compras anteriores'))+'</article>').join('')||'<p>No quedan productos pendientes de compra.</p>';
  $('#purchaseQuantitySummary').textContent=(all.length-available.length)+' persona(s) completas; no se muestran. Cada toque sobre un producto coloca su visto para esta compra.';
  $('#purchaseForm [type="submit"]').disabled=!available.some(({q})=>q.known&&!q.excess&&q.remaining>0);
  showDialog('#purchaseDialog');
}
$('#newPurchaseBtn').addEventListener('click',()=>openPurchaseDialog());
$('#newPurchaseBtn2').addEventListener('click',()=>openPurchaseDialog());
$('#purchaseClients').addEventListener('click',event=>{const button=event.target.closest('[data-purchase-captures]');if(button)visual.open(button.dataset.purchaseCaptures,'purchase').catch(e=>toast(e.message));});
document.addEventListener('visual-selection',event=>{const label=document.querySelector('[data-count-client="'+event.detail.id+'"]');if(label)label.textContent='Seleccionados: '+event.detail.count;});
$('#purchaseForm').addEventListener('submit',async event=>{
 event.preventDefault();if(event.target.dataset.saving)return;const submit=event.target.querySelector('[type="submit"]');$('#purchaseError').textContent='';
 try{const parts=visual.payload();if(!parts.length)throw new Error('Abre las capturas y toca los productos comprados.');
  event.target.dataset.saving='true';submit.disabled=true;
  await run(()=>createVisualPurchase(state.selectedClosureId,{purchase_date:$('#purchaseDate').value,account_label:$('#purchaseAccount').value.trim(),real_cost:number($('#purchaseCost').value),notes:$('#purchaseNotes').value.trim()},parts),'Compra y vistos guardados.');
  closeDialog('#purchaseDialog');visual.reset();await refreshSelected();selectTab('purchases');
 }catch(e){$('#purchaseError').textContent=e.message;}finally{delete event.target.dataset.saving;submit.disabled=false;}
});

function openArrival(clientId, preferredPartId) {
  const client = getClient(clientId);
  const finance = clientFinance(client);
  const unresolved = finance.parts.filter(part => ['pending','in_transit'].includes(part.status));
  if (!unresolved.length) return toast('No hay partes pendientes de llegada.');
  state.activeClient = client;
  $('#arrivalTitle').textContent = `Pedido de ${client.name}`;
  $('#arrivalPart').innerHTML = unresolved.map((part, index) => `<option value="${part.id}" ${part.id === preferredPartId ? 'selected' : ''}>Parte ${finance.parts.indexOf(part) + 1} · ${part.purchased_quantity == null ? "Cantidad por completar" : part.purchased_quantity + " unidad(es)"} · ${partLabel(part)}</option>`).join('');
  $('#arrivalStatus').value = 'received';
  $('#arrivalDescription').value = '';
  $('#arrivalDeduction').value = '0';
  $('#arrivalDetails').hidden = true;
  showDialog('#arrivalDialog');
}

$('#arrivalStatus').addEventListener('change', () => $('#arrivalDetails').hidden = $('#arrivalStatus').value === 'received');
$('#arrivalForm').addEventListener('submit', async event => {
  event.preventDefault();
  const rawStatus = $('#arrivalStatus').value;
  const status = rawStatus === 'received_missing' ? 'received' : rawStatus;
  try {
    await run(() => registerArrival($('#arrivalPart').value, state.activeClient.id, {
      status,
      description: rawStatus === 'received' ? '' : $('#arrivalDescription').value.trim(),
      deduction: rawStatus === 'received' ? 0 : number($('#arrivalDeduction').value)
    }), 'Llegada registrada.');
    closeDialog('#arrivalDialog');
    await refreshSelected();
  } catch {}
});

function updateWeightPreview() {
  if (!state.activeClient) return;
  const finance=clientFinance(state.activeClient), cumulative=finance.totalWeight+number($('#weightAmount').value);
  const policy=freightPolicy(state.activeClient,state.settings), charge=freightCharge(cumulative,policy);
  const due=Math.max(0,moneyRound(finance.rawProducts+charge+interestCharge(finance.rawProducts,state.activeClient.interest_mode,state.activeClient.interest_value)-finance.paid));
  $('#weightCumulative').textContent=cumulative.toFixed(2)+' lb';
  $('#weightChargePreview').textContent=money(charge);
  $('#weightDuePreview').textContent=money(due);
  $('#weightRuleNote').textContent='Tarifa de esta persona: '+money(policy.rate)+'/lb · mínimo '+money(policy.minimum)+' · máximo '+money(policy.maximum)+'. Después de guardar podrás ajustar el cobro y confirmar el precio.'+(finance.pricing.confirmed?' El precio confirmado actual se conserva hasta que lo confirmes de nuevo.':'');
}

function openWeight(clientId) {
  const client = getClient(clientId);
  const finance = clientFinance(client);
  state.activeClient = client;
  $('#weightTitle').textContent = `Pedido de ${client.name}`;
  $('#weightForm').reset();
  $('#weightAmount').value = '0.90';
  $('#pendingPartsWarning').hidden = !finance.unresolved.length;
  $('#deliveryType').value = finance.unresolved.length ? 'partial' : 'final';
  updateWeightPreview();
  showDialog('#weightDialog');
}
$('#weightAmount').addEventListener('input', updateWeightPreview);

$('#weightForm').addEventListener('submit', async event => {
  event.preventDefault();
  const finance = clientFinance(state.activeClient);
  if (finance.unresolved.length && !$('#pendingReason').value) return toast('Indica qué ocurre con la parte pendiente.');
  try {
    await run(() => addWeight(state.activeClient.id, {
      weight_lbs: number($('#weightAmount').value),
      delivery_type: $('#deliveryType').value,
      pending_reason: $('#pendingReason').value,
      note: $('#weightNote').value.trim()
    }), 'Peso guardado y total actualizado.');
    closeDialog('#weightDialog');
    await refreshSelected();
    openPricing(state.activeClient.id);
  } catch {}
});


let pricingClientId, pricingRevision, pricingBusy=false;
function updatePricingPreview() {
  const client=getClient(pricingClientId);if(!client)return;
  const finance=clientFinance(client), freight=number($('#pricePounds').value), mode=$('#priceInterestMode').value;
  $('#priceInterestValue').disabled=mode==='none';
  const interest=interestCharge(finance.rawProducts,mode,$('#priceInterestValue').value);
  $('#priceProducts').textContent=money(finance.rawProducts);
  $('#priceInterestPreview').textContent=money(interest);
  const total=moneyRound(finance.rawProducts+freight+interest),balance=moneyRound(total-finance.paid);
  $('#priceTotal').textContent=money(total);
  $('#priceBalance').textContent=(balance<0?'A favor: ':'Por pagar: ')+money(Math.abs(balance));
  $('#pricePaid').textContent=money(finance.paid);
  const policy=finance.pricing.policy, minimum=Math.min(policy.minimum,freight);
  const text=minimumText({show_minimum:true,minimum_charge:minimum,minimum_weight:minimum===policy.minimum&&policy.rate>0?moneyRound(minimum/policy.rate):null});
  $('#priceMinimumPreview').textContent=$('#priceShowMinimum').checked?text||'Sin cobro mínimo que mostrar.':'Esta aclaración no aparecerá en el comprobante.';
}
function openPricing(id) {
  const client=getClient(id),finance=clientFinance(client);
  pricingClientId=id;pricingRevision=client.updated_at;
  $('#priceTitle').textContent='Precio de '+client.name;
  $('#priceForm').reset();$('#priceError').textContent='';
  $('#pricePounds').value=finance.pricing.pounds.toFixed(2);
  $('#priceInterestMode').value=client.interest_mode||'none';
  $('#priceInterestValue').value=number(client.interest_value).toFixed(2);
  $('#priceShowMinimum').checked=Boolean(client.price_snapshot?.show_minimum);
  $('#priceSuggested').textContent='Peso actual: '+finance.totalWeight.toFixed(2)+' lb. Según la tarifa guardada: '+money(finance.pricing.draftPounds)+'. Puedes escribir el importe acordado para esta persona.';
  $('#priceReviewNote').textContent=finance.pricing.review?'Revisa el cobro acordado. Los registros anteriores no guardaban descuentos especiales; si ya cobraste otro importe, escríbelo en «Cobro total por libras».':finance.pricing.confirmed?'Este precio está confirmado. Solo cambiará si guardas una nueva confirmación. Los pagos se siguen descontando normalmente.':'Confirma los importes que vas a cobrar. No tendrás que cambiar la configuración general para hacer una excepción.';
  $('#priceUseSuggested').onclick=()=>{$('#pricePounds').value=finance.pricing.draftPounds.toFixed(2);updatePricingPreview();};
  updatePricingPreview();showDialog('#priceDialog');
}
$('#priceForm').addEventListener('input',updatePricingPreview);
$('#priceForm').addEventListener('change',updatePricingPreview);
$('#detailPriceBtn').addEventListener('click',()=>openPricing(state.activeClient.id));
$('#priceForm').addEventListener('submit',async event=>{
  event.preventDefault();if(pricingBusy)return;
  const pounds=Number($('#pricePounds').value),value=Number($('#priceInterestValue').value),mode=$('#priceInterestMode').value;
  if(!Number.isFinite(pounds)||pounds<0||!Number.isFinite(value)||value<0){$('#priceError').textContent='Usa valores válidos mayores o iguales a cero.';return;}
  pricingBusy=true;$('#priceSaveBtn').disabled=true;
  try {
    await run(()=>confirmPrice(pricingClientId,{pounds,mode,interest:mode==='none'?0:value,showMinimum:$('#priceShowMinimum').checked,revision:pricingRevision}),'Precio final confirmado.');
    closeDialog('#priceDialog');await refreshSelected();await openDetail(pricingClientId);
  } catch(error){$('#priceError').textContent=error.message;if(!$('#priceDialog').open)toast(error.message);}
  finally{pricingBusy=false;$('#priceSaveBtn').disabled=false;}
});
$('#clientPaymentMode').addEventListener('change',()=>{$('#clientForm .quote-preview').hidden=$('#clientPaymentMode').value==='on_delivery';});
$('#clientInterestMode').addEventListener('change',()=>{$('#clientInterestValue').disabled=$('#clientInterestMode').value==='none';});

async function openDetail(clientId) {
  const client = getClient(clientId);
  const finance = clientFinance(client);
  state.activeClient = client;
  const captureRows = await signedCaptureUrls(finance.captures);
  const captureUrls = captureRows.map(item => item.signed_url);
  const status = statusFor(finance);
  const incidentText = [
    ...finance.incidents.filter(item=>!item.visual_adjustment).map(item => `${item.description}${number(item.deduction) ? ` · descuento ${money(item.deduction)}` : ''}`),
    ...(client.visual_products||[]).filter(item=>['not_bought','not_arrived'].includes(item.state)).map(item=>'Producto no entregado: '+item.label+(number(item.deduction)?' · − '+money(item.deduction):''))
  ].join(' · ');
  state.invoiceDetail = {
    closureTitle: state.data.closure.title,
    clientName: client.name,
    statusText: status.label,
    adjustedProducts: finance.adjustedProducts,
    interest: finance.interest,
    minimumNote: minimumText(finance.pricing.snapshot),
    paid: finance.paid,
    totalWeight: finance.totalWeight,
    poundCharge: finance.poundCharge,
    due: finance.due,
    credit: finance.credit,
    incidentText,
    captureUrls,
    captureMarks:captureRows.map(c=>(client.visual_products||[]).filter(i=>i.capture_id===c.id)),
    visualDiscount:finance.incidents.filter(i=>i.visual_adjustment).reduce((n,i)=>n+number(i.deduction),0)
  };
  $('#invoiceClosure').textContent = state.data.closure.title;
  $('#invoiceName').textContent = client.name;
  $('#invoiceStatus').textContent = status.label;
  $('#invoiceProducts').textContent = money(finance.adjustedProducts);
  $('#invoiceInterestRow').hidden=finance.interest<=0;
  $('#invoiceInterest').textContent='+ '+money(finance.interest);
  $('#detailPricingNote').textContent=finance.pricing.review?'Hay cambios o un cobro antiguo por revisar. Revisa el precio acordado antes de compartir.':finance.pricing.confirmed?'Precio confirmado. Cambiar la configuración general no lo modifica.':'Precio todavía sin confirmar.';
  $('#invoicePaid').textContent = `− ${money(finance.paid)}`;
  $('#invoiceWeightLabel').textContent = `${finance.totalWeight.toFixed(2)} lb acumuladas`;
  $('#invoicePoundCharge').textContent = money(finance.poundCharge);
  $('#invoiceDue').textContent = money(finance.due);
  $('#invoiceCredit').hidden = finance.credit <= .009;
  $('#invoiceCredit').textContent = finance.credit > .009 ? `Saldo a favor del cliente: ${money(finance.credit)}` : '';
  $('#invoiceIncidents').hidden = !incidentText;
  $('#invoiceIncidents').textContent = incidentText;
  const captureContainer = $('#invoiceCaptures');
  captureContainer.className = `invoice-captures capture-count-${captureUrls.length}`;
  const rowSizes = getCaptureRows(captureUrls.length).flatMap(size => Array(size).fill(size));
  captureContainer.innerHTML = captureUrls.length
    ? captureUrls.map((url, index) => `<figure style="grid-column:span ${6 / rowSizes[index]}"><img src="${escapeHTML(url)}" alt="Captura ${index + 1}"></figure>`).join('')
    : '<p class="no-captures">No se adjuntaron capturas a este pedido.</p>';
  // Display the actual export so the preview and shared image have identical 4:5 proportions.
  const previewBlob = await generateInvoiceBlob(state.invoiceDetail);
  const previewUrl = URL.createObjectURL(previewBlob);
  if (state.invoicePreviewUrl) URL.revokeObjectURL(state.invoicePreviewUrl);
  state.invoicePreviewUrl = previewUrl;
  state.invoiceBlob = previewBlob;
  let preview = $('#invoiceExportPreview');
  if (!preview) {
    preview = document.createElement('img');
    preview.id = 'invoiceExportPreview';
    preview.alt = 'Comprobante completo del pedido en formato 4:5';
    preview.style.cssText = 'display:block;width:100%;height:auto;aspect-ratio:4/5;';
    $('#invoice').after(preview);
  }
  preview.src = previewUrl;
  $('#invoice').hidden = true;
  showDialog('#detailDialog');
}

async function invoiceBlob() {
  loading(true, 'Generando imagen…');
  try { return state.invoiceBlob || await generateInvoiceBlob(state.invoiceDetail); }
  catch (error) { toast(error.message || 'No se pudo generar el comprobante.'); throw error; }
  finally { loading(false); }
}

$('#copyImageBtn').addEventListener('click', async () => {
  const blob = await invoiceBlob();
  try {
    await copyImage(blob);
    toast('Imagen copiada. Ya puedes pegarla en WhatsApp.');
  } catch (error) {
    downloadBlob(blob, `detalle-${state.activeClient.name.replace(/\s+/g, '-').toLowerCase()}.png`);
    toast('El navegador no permitió copiarla; se descargó el PNG automáticamente.');
  }
});
$('#downloadImageBtn').addEventListener('click', async () => downloadBlob(await invoiceBlob(), `detalle-${state.activeClient.name.replace(/\s+/g, '-').toLowerCase()}.png`));
$('#shareImageBtn').addEventListener('click', async () => {
  try {
    const blob = await invoiceBlob();
    const shared = await shareImage(blob, 'detalle-yori-tex.png');
    if (!shared) { downloadBlob(blob, 'detalle-yori-tex.png'); toast('Se descargó la imagen porque este navegador no permite compartir archivos.'); }
  } catch (error) { if (error.name !== 'AbortError') toast('No se pudo compartir la imagen.'); }
});
$('#whatsappDetailBtn').addEventListener('click', () => {
  const detail = state.invoiceDetail;
  const message = `Hola ${state.activeClient.name.split(' ')[0]}, te envío el detalle actualizado de tu pedido YORI-TEX. ${detail.credit > 0 ? `Tienes ${money(detail.credit)} a favor.` : `Tu saldo pendiente es ${money(detail.due)}.`}`;
  openWhatsApp(state.activeClient.phone, message);
});

$('#closureWorkspace').addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, client, part } = button.dataset;
  if (action === 'purchase') {
    openPurchaseDialog();
    if(client) await visual.open(client,'purchase').catch(e=>toast(e.message));
  }
  if (action === 'visual') await visual.open(client).catch(e=>toast(e.message));
  if (action === 'price') openPricing(client);
  if (action === 'payment') openPayment(client);
  if (action === 'arrival' || action === 'arrival-part') openArrival(client, part);
  if (action === 'weight') openWeight(client);
  if (action === 'detail') await run(() => openDetail(client), null).catch(() => {});
  if (action === 'close-client') {
    await run(() => setClientClosed(client, true), 'Cliente finalizado.').catch(() => {});
    await refreshSelected();
  }
  if (action === 'reopen-client') {
    await run(() => setClientClosed(client, false), 'Cliente reabierto.').catch(() => {});
    await refreshSelected();
  }
});

function selectTab(name) {
  closeCmd();
  $$('#tabs button').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
  $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `${name}Panel`));
}
$('#tabs').addEventListener('click', event => {
  const button = event.target.closest('[data-tab]');
  if (button) selectTab(button.dataset.tab);
});

$('.filters').addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state.filter = button.dataset.filter;
  $$('.filters button').forEach(item => item.classList.toggle('active', item === button));
  renderClients();
});

function closeCmd() {
  $('#profitGrid').hidden = true;
  $('#toggleProfitBtn').textContent = 'Abrir panel';
  $('#toggleProfitBtn').setAttribute('aria-expanded','false');
  $('#cmdStatus').textContent = 'Panel cerrado.';
}
$('#toggleProfitBtn').addEventListener('click', () => {
  const hidden = !$('#profitGrid').hidden;
  $('#profitGrid').hidden = hidden;
  $('#toggleProfitBtn').textContent = hidden ? 'Abrir panel' : 'Cerrar panel';
  $('#toggleProfitBtn').setAttribute('aria-expanded',String(!hidden));
  $('#cmdStatus').textContent = hidden ? 'Panel cerrado.' : 'Resumen del cierre seleccionado.';
});
document.addEventListener('visibilitychange',()=> { if(document.hidden) closeCmd(); });
window.addEventListener('blur',closeCmd);

function renderNotices(finances) {
  const notices=pendingNotices(finances);
  $('#pendingCount').textContent=notices.length;
  const row = n => '<article class="pending-row"><div><strong>'+escapeHTML(n.name)+'</strong><span>'+escapeHTML(n.title)+(n.amount!==null?' · '+money(n.amount):'')+'</span></div><button class="secondary" data-action="'+n.action+'" data-client="'+escapeHTML(n.client)+'">'+escapeHTML(n.label)+'</button></article>';
  $('#pendingList').innerHTML=notices.length ? notices.slice(0,5).map(row).join('')+(notices.length>5?'<details><summary>Ver '+(notices.length-5)+' pendientes más</summary>'+notices.slice(5).map(row).join('')+'</details>':'') : '<p class="pending-empty">Sin acciones pendientes por ahora.</p>';
}

$('#settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    state.settings = await run(() => updateSettings({
      pound_rate: number($('#settingRate').value),
      minimum_pound_charge: number($('#settingMin').value),
      maximum_pound_charge: number($('#settingMax').value)
    }), 'Configuración guardada.');
    renderDashboard();
  } catch {}
});

$$('button[value="cancel"]').forEach(button => button.addEventListener('click', event => {
  event.preventDefault();
  closeDialog(button.closest('dialog'));
}));
$$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
$$('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if(dialog.id==='visualProductsDialog')return;
  if (event.target === dialog) closeDialog(dialog);
}));

initialize().catch(error => {
  console.error(error);
  $('#authScreen').hidden = false;
  toast(error.message || 'No se pudo iniciar la aplicación.');
});
