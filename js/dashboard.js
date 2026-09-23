const cents = n => Math.round((Number(n) || 0) * 100);
const total = (rows,key) => rows.reduce((sum,row)=>sum+cents(row[key]),0)/100;

export function financialSummary(finances,purchases) {
  const products=total(finances,'adjustedProducts'), pounds=total(finances,'poundCharge');
  const costs=total(purchases,'real_cost');
  const productProfit=(cents(products)-cents(costs))/100;
  const profit=(cents(productProfit)+cents(pounds))/100;
  return {products,pounds,costs,productProfit,profit,
    revenue:(cents(products)+cents(pounds))/100,
    paid:total(finances,'paid'),due:total(finances,'due'),credit:total(finances,'credit'),
    weight:finances.reduce((sum,f)=>sum+(Number(f.totalWeight)||0),0),
    productPercent:costs>0?productProfit/costs*100:null,
    totalPercent:costs>0?profit/costs*100:null,
    poundPercent:costs>0?pounds/costs*100:null};
}

export function pendingNotices(finances) {
  const notices=[];
  const add=(f,kind,title,action,label,amount=null,priority=2)=>notices.push({client:f.client.id,name:f.client.name,kind,title,action,label,amount,priority});
  for(const f of finances) {
    if(f.client.is_closed) {
      if(f.due>.009)add(f,'closed-due','Finalizado con saldo pendiente','payment','Registrar pago',f.due,0);
      continue;
    }
    const deposit=Math.max(0,f.adjustedProducts/2-f.paid);
    if(!f.parts.length&&!f.totalWeight&&deposit>.009)
      add(f,'deposit',f.paid>0?'Anticipo incompleto':'Falta el anticipo','payment','Registrar anticipo',Math.round(deposit*100)/100,0);
    if(f.totalWeight>0&&f.due>.009)
      add(f,'balance','Saldo por cobrar','payment','Registrar pago',f.due,0);
    if((!f.parts.length&&f.paid>0&&deposit<=.009&&f.adjustedProducts>0)||f.parts.some(p=>p.status==='pending'))
      add(f,'purchase','Productos pendientes de compra','purchase','Registrar compra');
    if(f.parts.some(p=>p.status==='in_transit'))
      add(f,'arrival','Partes en tránsito; llegada pendiente','arrival','Registrar llegada',null,3);
    const latestArrival=Math.max(0,...f.received.map(p=>Date.parse(p.arrived_at)||0));
    const latestWeight=Math.max(0,...f.weights.map(w=>Date.parse(w.weighed_at)||0));
    if(f.received.length&&(!f.weights.length||latestArrival>latestWeight))
      add(f,'weight',f.weights.length?'Nueva llegada: revisar peso pendiente':'Productos recibidos sin pesar','weight','Registrar libras',null,1);
    if(f.totalWeight>0&&f.due<=.009&&!f.unresolved.length)
      add(f,'close','Pagado y sin partes pendientes','close-client','Finalizar cliente',null,4);
  }
  return notices.sort((a,b)=>a.priority-b.priority||a.name.localeCompare(b.name,'es'));
}
