export const moneyRound = n => Math.round(((Number(n)||0)+Number.EPSILON)*100)/100;
export function freightPolicy(client, settings) {
  return client.freight_policy || {rate:Number(settings?.pound_rate)||0,minimum:Number(settings?.minimum_pound_charge)||0,maximum:Number(settings?.maximum_pound_charge)||0};
}
export function freightCharge(weight, policy) {
  return weight>0 ? moneyRound(Math.min(policy.maximum,Math.max(policy.minimum,weight*policy.rate))) : 0;
}
export function interestCharge(products, mode, value) {
  return moneyRound(mode==='percent'?products*Number(value||0)/100:mode==='fixed'?value:0);
}
export function pricingFor(client, settings, products, weight) {
  const policy=freightPolicy(client,settings), snapshot=client.price_snapshot;
  const interest=interestCharge(products,client.interest_mode,client.interest_value);
  const pounds=freightCharge(weight,policy);
  return {policy,draftProducts:moneyRound(products),draftPounds:pounds,draftInterest:interest,
    products: snapshot ? Number(snapshot.products) : moneyRound(products),
    pounds: snapshot ? Number(snapshot.pounds) : pounds,
    interest: snapshot ? Number(snapshot.interest) : interest,
    confirmed:Boolean(snapshot),review:Boolean(client.pricing_needs_review),snapshot};
}
export function minimumText(snapshot) {
  if(!snapshot?.show_minimum || !(Number(snapshot.minimum_charge)>0)) return '';
  const amount=new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD'}).format(snapshot.minimum_charge);
  return snapshot.minimum_weight ? 'Cobro mínimo: '+Number(snapshot.minimum_weight).toLocaleString('es-EC',{maximumFractionDigits:2})+' lb · '+amount : 'Cobro mínimo por libras: '+amount;
}
