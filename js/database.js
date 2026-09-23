import { createClient as createSupabaseClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const isPlaceholder = value => !value || value.includes('PEGA_AQUI');
export const isConfigured = () => !isPlaceholder(SUPABASE_URL) && !isPlaceholder(SUPABASE_PUBLISHABLE_KEY);

let client;
export function db() {
  if (!isConfigured()) throw new Error('Supabase todavía no está configurado.');
  if (!client) {
    client = createSupabaseClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return client;
}

function fail(error) {
  if (error) throw new Error(/product_quantity|pending_products|purchased_quantity|yori_/.test(error.message || '') && /does not exist|schema cache|Could not find/i.test(error.message || '') ? 'Falta instalar la actualización de cantidades en Supabase. Ejecuta actualizacion_cantidades.sql antes de usar esta función.' : error.message || 'Ocurrió un error al guardar la información.');
}

export async function getSession() {
  if (!isConfigured()) return null;
  const { data, error } = await db().auth.getSession();
  fail(error);
  return data.session;
}

export function onAuthChange(callback) {
  if (!isConfigured()) return { data: { subscription: { unsubscribe() {} } } };
  return db().auth.onAuthStateChange((event, session) => callback(session, event));
}

export async function signIn(email, password) {
  const { data, error } = await db().auth.signInWithPassword({ email, password });
  fail(error);
  return data.session;
}

export async function signOut() {
  const { error } = await db().auth.signOut();
  fail(error);
}

export async function sendPasswordReset(email) {
  const redirectTo = `${location.origin}${location.pathname}`;
  const { error } = await db().auth.resetPasswordForEmail(email, { redirectTo });
  fail(error);
}

export async function updatePassword(password) {
  const { error } = await db().auth.updateUser({ password });
  fail(error);
}

export async function ensureSettings() {
  const { data: existing, error: readError } = await db()
    .from('app_settings').select('*').maybeSingle();
  fail(readError);
  if (existing) return existing;
  const { data, error } = await db().from('app_settings').insert({}).select().single();
  fail(error);
  return data;
}

export async function updateSettings(values) {
  const current = await ensureSettings();
  const { data, error } = await db().from('app_settings')
    .update(values).eq('id', current.id).select().single();
  fail(error);
  return data;
}

export async function listClosures() {
  const { data, error } = await db().from('order_closures')
    .select('*').order('announced_date', { ascending: false });
  fail(error);
  return data || [];
}

export async function createClosure(values) {
  const { data, error } = await db().from('order_closures')
    .insert(values).select().single();
  fail(error);
  return data;
}

export async function updateClosure(id, values) {
  const { data, error } = await db().from('order_closures')
    .update(values).eq('id', id).select().single();
  fail(error);
  return data;
}

export async function createClient(values, files = []) {
  const { data: row, error } = await db().from('clients').insert(values).select().single();
  fail(error);
  try { await addCaptures(row.id, files); }
  catch (error) { return { ...row, uploadWarning: error.message }; }
  return row;
}

export async function addCaptures(clientId, files = []) {
  if (!files.length) return;
  const session = await getSession();
  const { data: captures, error: readError } = await db().from('captures').select('sort_order').eq('client_id', clientId);
  fail(readError);
  const startOrder = Math.max(-1, ...(captures || []).map(row => row.sort_order)) + 1;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const safeName = `${crypto.randomUUID()}.${extension}`;
    const storagePath = `${session.user.id}/${clientId}/${safeName}`;
    const { error: uploadError } = await db().storage.from('client-captures')
      .upload(storagePath, file, { upsert: false, contentType: file.type });
    fail(uploadError);
    const { error: captureError } = await db().from('captures').insert({
      client_id: clientId,
      storage_path: storagePath,
      original_name: file.name,
      sort_order: startOrder + index
    });
    if (captureError) {
      await db().storage.from('client-captures').remove([storagePath]);
      fail(captureError);
    }
  }
}

export async function addPayment(clientId, amount, paymentType, note = '') {
  const { data, error } = await db().from('payments').insert({
    client_id: clientId,
    amount,
    payment_type: paymentType,
    note: note || null
  }).select().single();
  fail(error);
  return data;
}

export async function createPurchase(closureId,values,parts) {
  const {data,error}=await db().rpc('yori_create_purchase_units',{p_closure:closureId,p_values:values,p_parts:parts});
  fail(error);return data;
}

export async function savePartUnits(id,values,pending,revision) {
  const {data,error}=await db().rpc('yori_save_part_units',{p_id:id,p_values:values,p_pending:pending,p_revision:revision});
  fail(error);return {data};
}

export async function registerArrival(partId, clientId, outcome) {
  const update = {
    status: outcome.status,
    arrived_at: ['received','lost','cancelled'].includes(outcome.status) ? new Date().toISOString() : null,
    missing_note: outcome.description || null
  };
  const { data: part, error } = await db().from('purchase_parts').update(update).eq('id', partId).select('purchase_id').single();
  fail(error);
  if (outcome.description || Number(outcome.deduction) > 0 || outcome.status !== 'received') {
    const typeMap = { lost: 'lost_part', cancelled: 'cancelled_part', received: 'missing_product' };
    const { error: incidentError } = await db().from('incidents').insert({
      client_id: clientId,
      part_id: partId,
      incident_type: typeMap[outcome.status] || 'other',
      description: outcome.description || `Parte marcada como ${outcome.status}`,
      deduction: Number(outcome.deduction) || 0
    });
    fail(incidentError);
  }
  const { data: siblingParts, error: siblingError } = await db().from('purchase_parts')
    .select('status').eq('purchase_id', part.purchase_id);
  fail(siblingError);
  const unresolved = siblingParts.some(item => ['pending','in_transit'].includes(item.status));
  const received = siblingParts.some(item => item.status === 'received');
  const { error: purchaseError } = await db().from('purchases').update({
    status: unresolved ? (received ? 'partially_received' : 'in_transit') : 'received'
  }).eq('id', part.purchase_id);
  fail(purchaseError);
}

export async function addWeight(clientId, values) {
  const { data, error } = await db().from('weight_entries').insert({
    client_id: clientId,
    weight_lbs: values.weight_lbs,
    delivery_type: values.delivery_type,
    pending_reason: values.pending_reason || null,
    note: values.note || null
  }).select().single();
  fail(error);
  return data;
}

export async function setClientClosed(clientId, isClosed) {
  const { error } = await db().from('clients').update({ is_closed: isClosed }).eq('id', clientId);
  fail(error);
}

export async function loadClosure(closureId) {
  const [closureResult, clientsResult, purchasesResult] = await Promise.all([
    db().from('order_closures').select('*').eq('id', closureId).single(),
    db().from('clients').select('*').eq('closure_id', closureId).order('is_closed').order('created_at'),
    db().from('purchases').select('*').eq('closure_id', closureId).order('purchase_number')
  ]);
  fail(closureResult.error); fail(clientsResult.error); fail(purchasesResult.error);
  const clients = clientsResult.data || [];
  const clientIds = clients.map(item => item.id);
  const purchaseIds = (purchasesResult.data || []).map(item => item.id);
  let payments = [], captures = [], parts = [], incidents = [], weights = [];
  if (clientIds.length) {
    const results = await Promise.all([
      db().from('payments').select('*').in('client_id', clientIds).order('paid_at'),
      db().from('captures').select('*').in('client_id', clientIds).order('sort_order'),
      db().from('incidents').select('*').in('client_id', clientIds).order('created_at'),
      db().from('weight_entries').select('*').in('client_id', clientIds).order('weighed_at')
    ]);
    results.forEach(result => fail(result.error));
    [payments, captures, incidents, weights] = results.map(result => result.data || []);
  }
  if (purchaseIds.length) {
    const result = await db().from('purchase_parts').select('*')
      .in('purchase_id', purchaseIds).order('created_at');
    fail(result.error);
    parts = result.data || [];
  }
  return {
    closure: closureResult.data,
    clients,
    purchases: purchasesResult.data || [],
    payments,
    captures,
    parts,
    incidents,
    weights
  };
}

export async function signedCaptureUrls(captures, expiresIn = 3600) {
  const rows = await Promise.all(captures.map(async capture => {
    const { data, error } = await db().storage.from('client-captures')
      .createSignedUrl(capture.storage_path, expiresIn);
    fail(error);
    return { ...capture, signed_url: data.signedUrl };
  }));
  return rows;
}

export function subscribeToChanges(callback) {
  const tables = ['app_settings','order_closures','clients','captures','payments','purchases','purchase_parts','incidents','weight_entries'];
  const channel = db().channel(`yori-tex-${crypto.randomUUID()}`);
  tables.forEach(table => channel.on('postgres_changes', { event: '*', schema: 'public', table }, callback));
  channel.subscribe();
  return () => db().removeChannel(channel);
}

const editableFields = {
  clients: ['product_quantity','pending_products','name','phone','products_total','estimated_weight','notes','is_closed'],
  order_closures: ['title','announced_date','status','notes'],
  purchases: ['purchase_date','account_label','real_cost','notes'],
  payments: ['amount','payment_type','note'],
  weight_entries: ['weight_lbs','delivery_type','pending_reason','note'],
  purchase_parts: ['assigned_value','result','status','missing_note','arrived_at'],
  incidents: ['incident_type','description','deduction'],
  captures: ['original_name','sort_order']
};

function checkTable(table) {
  if (!Object.hasOwn(editableFields, table)) throw new Error('Tipo de registro no permitido.');
}

async function reconcilePurchases(ids) {
  for (const id of new Set(ids)) {
    const { data, error } = await db().from('purchase_parts').select('status').eq('purchase_id', id);
    fail(error);
    const pending = data.some(part => ['pending','in_transit'].includes(part.status));
    const received = data.some(part => part.status === 'received');
    const status = !data.length ? 'draft' : pending ? (received ? 'partially_received' : 'in_transit') : 'received';
    const result = await db().from('purchases').update({ status }).eq('id',id);
    fail(result.error);
  }
}

export async function updateRecord(table, id, values, revision) {
  checkTable(table);
  if (Object.keys(values).some(key => !editableFields[table].includes(key))) throw new Error('Campo no permitido.');
  let query = db().from(table).update(values).eq('id',id);
  if(revision && table==='clients') query=query.eq('updated_at',revision);
  const { data, error } = await query.select().single();
  if(error?.code==='PGRST116' && revision) throw new Error('La persona cambió. Actualiza la página y vuelve a editar.');
  fail(error);
  let warning;
  if (table === 'purchase_parts') {
    try { await reconcilePurchases([data.purchase_id]); }
    catch { warning = 'La parte se guardó, pero no se pudo actualizar el estado de la compra. Reabre la parte y guarda para reintentarlo.'; }
  }
  return { data, warning };
}

export async function deleteRecord(table, id) {
  checkTable(table);
  let captures = [], purchaseIds = [];
  if (table === 'clients' || table === 'order_closures') {
    let clientIds = [id];
    if (table === 'order_closures') {
      const result = await db().from('clients').select('id').eq('closure_id',id);
      fail(result.error);
      clientIds = result.data.map(row => row.id);
    }
    if (clientIds.length) {
      const result = await db().from('captures').select('storage_path').in('client_id',clientIds);
      fail(result.error);
      captures = result.data;
    }
    if (table === 'clients') {
      const result = await db().from('purchase_parts').select('purchase_id').eq('client_id',id);
      fail(result.error);
      purchaseIds = result.data.map(row => row.purchase_id);
    }
  }
  // SELECT confirms an actual deletion; an RLS-filtered no-op is not success.
  const { data, error } = await db().from(table).delete().eq('id',id).select().single();
  fail(error);
  if (table === 'captures') captures = [data];
  if (table === 'purchase_parts') purchaseIds = [data.purchase_id];
  const warnings = [];
  // Delete storage only after the database cascade succeeds, preserving files on DB failure.
  if (captures.length) {
    try {
      const result = await db().storage.from('client-captures').remove(captures.map(row=>row.storage_path));
      fail(result.error);
    } catch { warnings.push('El registro se eliminó, pero quedaron archivos privados pendientes de limpieza en el almacenamiento.'); }
  }
  try { await reconcilePurchases(purchaseIds); }
  catch { warnings.push('El registro se eliminó, pero no se pudo actualizar el estado de una compra.'); }
  return { warning: warnings.join(' ') };
}
