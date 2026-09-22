import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const isPlaceholder = value => !value || value.includes('PEGA_AQUI');
export const isConfigured = () => !isPlaceholder(SUPABASE_URL) && !isPlaceholder(SUPABASE_PUBLISHABLE_KEY);

let client;
export function db() {
  if (!isConfigured()) throw new Error('Supabase todavía no está configurado.');
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return client;
}

function fail(error) {
  if (error) throw new Error(error.message || 'Ocurrió un error al guardar la información.');
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
  const session = await getSession();
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const safeName = `${crypto.randomUUID()}.${extension}`;
    const storagePath = `${session.user.id}/${row.id}/${safeName}`;
    const { error: uploadError } = await db().storage.from('client-captures')
      .upload(storagePath, file, { upsert: false, contentType: file.type });
    fail(uploadError);
    const { error: captureError } = await db().from('captures').insert({
      client_id: row.id,
      storage_path: storagePath,
      original_name: file.name,
      sort_order: index
    });
    fail(captureError);
  }
  return row;
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

export async function createPurchase(closureId, values, parts) {
  const { count, error: countError } = await db().from('purchases')
    .select('*', { count: 'exact', head: true }).eq('closure_id', closureId);
  fail(countError);
  const { data: purchase, error } = await db().from('purchases').insert({
    closure_id: closureId,
    purchase_number: (count || 0) + 1,
    purchase_date: values.purchase_date,
    account_label: values.account_label,
    real_cost: values.real_cost,
    notes: values.notes || null,
    status: 'in_transit'
  }).select().single();
  fail(error);
  if (parts.length) {
    for (const part of parts.filter(item => item.result !== 'not_purchased')) {
      const { error: previousError } = await db().from('purchase_parts')
        .update({ status: 'reassigned', missing_note: `Reubicada en Compra #${purchase.purchase_number}` })
        .eq('client_id', part.client_id).eq('status', 'pending');
      fail(previousError);
    }
    const payload = parts.flatMap(part => {
      const purchased = {
        purchase_id: purchase.id,
        client_id: part.client_id,
        assigned_value: part.result === 'not_purchased' ? 0 : part.assigned_value,
        result: part.result,
        status: part.result === 'not_purchased' ? 'pending' : 'in_transit',
        missing_note: part.missing_note || null
      };
      if (part.result !== 'missing_items') return [purchased];
      return [
        purchased,
        {
          purchase_id: purchase.id,
          client_id: part.client_id,
          assigned_value: 0,
          result: 'not_purchased',
          status: 'pending',
          missing_note: part.missing_note ? `Pendiente: ${part.missing_note}` : 'Artículo pendiente para la próxima compra'
        }
      ];
    });
    const { error: partsError } = await db().from('purchase_parts').insert(payload);
    fail(partsError);
  }
  await updateClosure(closureId, { status: 'in_transit' });
  return purchase;
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
