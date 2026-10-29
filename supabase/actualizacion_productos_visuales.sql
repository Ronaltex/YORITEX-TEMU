-- Selección de unidades sobre capturas. Ejecutar antes de publicar la interfaz.
begin;
alter table public.clients add column if not exists visual_products jsonb;
alter table public.incidents add column if not exists visual_adjustment boolean not null default false;
create unique index if not exists yori_visual_adjustment_unique on public.incidents(client_id) where visual_adjustment;

create or replace function public.yori_save_visual_products(p_client uuid,p_items jsonb,p_revision timestamptz)
returns public.clients language plpgsql security invoker set search_path=public as $$
declare person public.clients; item jsonb; part public.purchase_parts; amount numeric:=0; previous numeric:=0; other_discount numeric; qty integer; old_qty integer; bought integer; excluded integer; snapshot jsonb; products numeric; interest numeric;
begin
 select * into person from public.clients where id=p_client and owner_id=auth.uid() for update;
 if not found then raise exception 'No se encontró la persona.'; end if;
 if person.updated_at is distinct from p_revision then raise exception 'La persona cambió. Cierra y vuelve a abrir sus productos.'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>500 then raise exception 'Revisa la lista de productos (máximo 500 unidades).'; end if;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_items)) then raise exception 'Hay marcas repetidas.'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if nullif(item->>'id','') is null or nullif(trim(item->>'label'),'') is null or length(item->>'label')>160 or coalesce(item->>'state','') not in ('pending','bought','not_bought','not_arrived') then raise exception 'Completa la descripción y el estado de cada producto.'; end if;
  if not exists(select 1 from public.captures where id=(item->>'capture_id')::uuid and client_id=p_client and owner_id=auth.uid()) then raise exception 'La captura no pertenece a esta persona.'; end if;
  if (item->>'x')::numeric is null or (item->>'y')::numeric is null or (item->>'x')::numeric not between 0 and 1 or (item->>'y')::numeric not between 0 and 1 then raise exception 'Marca el producto dentro de la captura.'; end if;
  if item->>'state' in ('bought','not_arrived') then
   if not exists(select 1 from public.purchase_parts where id=(item->>'part_id')::uuid and client_id=p_client and owner_id=auth.uid()) then raise exception 'Selecciona la compra de este producto.'; end if;
  elsif nullif(item->>'part_id','') is not null then raise exception 'Un producto sin comprar no debe tener compra asignada.'; end if;
  if coalesce((item->>'deduction')::numeric,-1)<0 or (item->>'deduction')::numeric>=10000000000 or round((item->>'deduction')::numeric,2)<>(item->>'deduction')::numeric then raise exception 'Usa un descuento válido, con máximo dos decimales.'; end if;
  if item->>'state' not in ('not_bought','not_arrived') and (item->>'deduction')::numeric<>0 then raise exception 'Solo se descuentan productos no entregados.'; end if;
  amount:=amount+(item->>'deduction')::numeric;
 end loop;
 select coalesce(sum(deduction) filter(where visual_adjustment),0),coalesce(sum(deduction) filter(where not visual_adjustment),0) into previous,other_discount from public.incidents where client_id=p_client;
 if amount+other_discount>person.products_total then raise exception 'Los descuentos superan el valor de productos. Revisa los descuentos anteriores para no duplicarlos.'; end if;
 -- Only change the units represented by marks; preserve older purchases without marks.
 if person.product_quantity is null then raise exception 'Completa primero el total de productos de la persona.'; end if;
 if jsonb_array_length(p_items)>person.product_quantity then raise exception 'Hay más marcas que unidades pedidas. Quita las marcas repetidas o corrige el total.'; end if;
 for part in select * from public.purchase_parts where client_id=p_client order by id for update loop
  select count(*) into qty from jsonb_array_elements(p_items) i where i->>'part_id'=part.id::text;
  select count(*) into old_qty from jsonb_array_elements(coalesce(person.visual_products,'[]')) i where i->>'part_id'=part.id::text;
  if part.purchased_quantity is null then
   if qty<>old_qty then raise exception 'Completa las cantidades de la compra anterior antes de corregirla.'; end if;
   continue;
  end if;
  qty:=part.purchased_quantity-old_qty+qty;
  if (select count(*) from jsonb_array_elements(p_items) i where i->>'part_id'=part.id::text and coalesce((i->>'legacy_attach')::boolean,false) and not exists(select 1 from jsonb_array_elements(coalesce(person.visual_products,'[]')) o where o->>'id'=i->>'id'))>part.purchased_quantity-old_qty then raise exception 'No quedan suficientes unidades antiguas sin identificar en esa compra.'; end if;
  qty:=qty-(select count(*) from jsonb_array_elements(p_items) i where i->>'part_id'=part.id::text and coalesce((i->>'legacy_attach')::boolean,false) and not exists(select 1 from jsonb_array_elements(coalesce(person.visual_products,'[]')) o where o->>'id'=i->>'id'));
  if qty<0 then raise exception 'Las unidades anteriores no coinciden con las marcas. Revisa la compra.'; end if;
  update public.purchase_parts set purchased_quantity=qty,status=case when qty=0 then 'reassigned' when status='reassigned' then 'in_transit' else status end where id=part.id;
 end loop;
 select coalesce(sum(purchased_quantity),0) into bought from public.purchase_parts where client_id=p_client;
 select count(*) into excluded from jsonb_array_elements(p_items) i where i->>'state'='not_bought';
 if bought+excluded>person.product_quantity then raise exception 'Las unidades compradas y descartadas superan el total del cliente.'; end if;
 if amount>0 then
  insert into public.incidents(client_id,incident_type,description,deduction,visual_adjustment)
  values(p_client,'other','Descuento por productos no entregados',amount,true)
  on conflict(client_id) where visual_adjustment do update set deduction=excluded.deduction,description=excluded.description;
 else delete from public.incidents where client_id=p_client and visual_adjustment; end if;
 snapshot:=person.price_snapshot;
 if snapshot is not null and amount<>previous then
  products:=(snapshot->>'products')::numeric+previous-amount;
  if products<0 then raise exception 'El descuento supera el precio confirmado. Revisa primero el precio final.'; end if;
  interest:=case when snapshot->>'interest_mode'='percent' then round(products*(snapshot->>'interest_value')::numeric/100,2) else (snapshot->>'interest')::numeric end;
  snapshot:=snapshot||jsonb_build_object('products',products,'interest',interest);
 end if;
 select coalesce(jsonb_agg((i-'legacy_attach')||jsonb_build_object('x',0.07) order by ordinal),'[]') into p_items from jsonb_array_elements(p_items) with ordinality a(i,ordinal);
 update public.clients set visual_products=p_items,pending_products='[]',price_snapshot=snapshot,pricing_needs_review=person.pricing_needs_review,
 is_closed=case when bought+excluded<person.product_quantity then false else person.is_closed end
 where id=p_client returning * into person;
 return person;
end; $$;

create or replace function public.yori_create_purchase_visual(p_closure uuid,p_values jsonb,p_parts jsonb)
returns public.purchases language plpgsql security invoker set search_path=public as $$
declare purchase public.purchases; person public.clients; item jsonb; mark jsonb; new_part uuid; number_next integer; items jsonb; selected jsonb; additions jsonb; qty integer;
begin
 perform 1 from public.order_closures where id=p_closure and owner_id=auth.uid() for update;
 if not found then raise exception 'No se encontró el cierre.'; end if;
 if p_parts is null or jsonb_typeof(p_parts)<>'array' or jsonb_array_length(p_parts)=0 then raise exception 'Selecciona productos.'; end if;
 if (select count(*)<>count(distinct value->>'client_id') from jsonb_array_elements(p_parts)) then raise exception 'Persona repetida.'; end if;
 select coalesce(max(purchase_number),0)+1 into number_next from public.purchases where closure_id=p_closure;
 insert into public.purchases(closure_id,purchase_number,purchase_date,account_label,real_cost,notes,status)
 values(p_closure,number_next,(p_values->>'purchase_date')::date,p_values->>'account_label',(p_values->>'real_cost')::numeric,p_values->>'notes','in_transit') returning * into purchase;
 for item in select value from jsonb_array_elements(p_parts) order by value->>'client_id' loop
  select * into person from public.clients where id=(item->>'client_id')::uuid and closure_id=p_closure and owner_id=auth.uid() for update;
  if not found then raise exception 'No se encontró la persona de este cierre.'; end if;
  if person.updated_at is distinct from (item->>'revision')::timestamptz then raise exception 'Los productos cambiaron. Vuelve a abrir la compra.'; end if;
  if exists(select 1 from public.purchase_parts where client_id=person.id and purchased_quantity is null and result<>'not_purchased' and status not in ('pending','reassigned')) then raise exception 'Completa las cantidades de las compras anteriores de %.',person.name; end if;
  selected:=coalesce(item->'item_ids','[]');additions:=coalesce(item->'new_items','[]');
  if jsonb_typeof(selected)<>'array' or jsonb_typeof(additions)<>'array' or jsonb_array_length(selected)+jsonb_array_length(additions)=0 then raise exception 'Selecciona productos de cada persona incluida.'; end if;
  if (select count(*)<>count(distinct value) from jsonb_array_elements_text(selected)) then raise exception 'Producto repetido.'; end if;
  select count(*) into qty from jsonb_array_elements(coalesce(person.visual_products,'[]')) i where selected ? (i->>'id') and i->>'state'='pending';
  if qty<>jsonb_array_length(selected) then raise exception 'Algún producto ya fue comprado o descartado. Actualiza.'; end if;
  insert into public.purchase_parts(purchase_id,client_id,assigned_value,purchased_quantity,result,status)
  values(purchase.id,person.id,0,0,'complete','in_transit') returning id into new_part;
  select coalesce(jsonb_agg(case when selected ? (i->>'id') then i||jsonb_build_object('state','bought','part_id',new_part,'deduction',0) else i end order by ordinal),'[]')
  into items from jsonb_array_elements(coalesce(person.visual_products,'[]')) with ordinality a(i,ordinal);
  for mark in select value from jsonb_array_elements(additions) loop
   items:=items||jsonb_build_array(mark||jsonb_build_object('state','bought','part_id',new_part,'deduction',0));
  end loop;
  perform public.yori_save_visual_products(person.id,items,person.updated_at);
 end loop;
 update public.order_closures set status='in_transit' where id=p_closure;
 return purchase;
end; $$;
revoke all on function public.yori_save_visual_products(uuid,jsonb,timestamptz) from public;
revoke all on function public.yori_create_purchase_visual(uuid,jsonb,jsonb) from public;
grant execute on function public.yori_save_visual_products(uuid,jsonb,timestamptz) to authenticated;
grant execute on function public.yori_create_purchase_visual(uuid,jsonb,jsonb) to authenticated;


-- Guards for existing editors
create or replace function public.yori_save_part_units(p_id uuid,p_values jsonb,p_pending jsonb,p_revision timestamptz)
returns public.purchase_parts language plpgsql security invoker set search_path=public as $$
declare part public.purchase_parts; person public.clients; bought integer; unknown_count integer; qty integer;
begin
  select * into part from public.purchase_parts where id=p_id and owner_id=auth.uid();
  if not found then raise exception 'No se encontró la parte del pedido.'; end if;
  select * into person from public.clients where id=part.client_id and owner_id=auth.uid() for update;
  if exists(select 1 from jsonb_array_elements(person.visual_products) i where i->>'part_id'=p_id::text) then raise exception 'Corrige los productos desde las capturas de la persona.'; end if;
  if person.updated_at is distinct from p_revision then raise exception 'La persona cambió en otro dispositivo. Actualiza antes de guardar.'; end if;
  if coalesce(p_values->>'purchased_quantity','') !~ '^[0-9]+$' then raise exception 'Completa las unidades compradas con un número entero.'; end if;
  qty:=(p_values->>'purchased_quantity')::integer;
  if p_values->>'result'='not_purchased' and qty<>0 then raise exception 'Una parte no comprada debe tener cero unidades.'; end if;
  select coalesce(sum(purchased_quantity),0),count(*) filter(where purchased_quantity is null and result<>'not_purchased' and status not in ('pending','reassigned'))
    into bought,unknown_count from public.purchase_parts where client_id=person.id and id<>p_id;
  bought:=bought+qty;
  if person.product_quantity is not null and bought>person.product_quantity then raise exception 'La cantidad comprada supera el total de la persona.'; end if;
  perform public.yori_validate_pending(p_pending,case when unknown_count=0 and person.product_quantity is not null then person.product_quantity-bought-(select count(*) from jsonb_array_elements(person.visual_products) i where i->>'state'='not_bought') else null end,person.visual_products is null);
  update public.purchase_parts set purchased_quantity=qty,
    assigned_value=(p_values->>'assigned_value')::numeric,
    result=p_values->>'result',status=p_values->>'status',missing_note=p_values->>'missing_note',
    arrived_at=(p_values->>'arrived_at')::timestamptz
    where id=p_id returning * into part;
  update public.clients set pending_products=p_pending where id=person.id;
  update public.purchases set status=case
    when exists(select 1 from public.purchase_parts where purchase_id=part.purchase_id and status in ('pending','in_transit')) then
      case when exists(select 1 from public.purchase_parts where purchase_id=part.purchase_id and status='received') then 'partially_received' else 'in_transit' end
    else 'received' end where id=part.purchase_id;
  return part;
end; $$;

create or replace function public.yori_create_purchase_units(p_closure uuid,p_values jsonb,p_parts jsonb)
returns public.purchases language plpgsql security invoker set search_path=public as $$
declare purchase public.purchases; person public.clients; item jsonb; qty integer; bought integer; unknown_count integer; number_next integer;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  perform 1 from public.order_closures where id=p_closure and owner_id=auth.uid() for update;
  if not found then raise exception 'No se encontró el cierre.'; end if;
  if p_parts is null or jsonb_typeof(p_parts)<>'array' or jsonb_array_length(p_parts)=0 then raise exception 'Selecciona al menos una persona.'; end if;
  if (select count(*)<>count(distinct value->>'client_id') from jsonb_array_elements(p_parts)) then raise exception 'Persona repetida en esta compra.'; end if;
  -- Stable lock order, fresh limits and a single transaction prevent double purchases.
  for item in select value from jsonb_array_elements(p_parts) order by value->>'client_id' loop
    select * into person from public.clients where id=(item->>'client_id')::uuid and closure_id=p_closure and owner_id=auth.uid() for update;
    if not found then raise exception 'Persona ajena a este cierre.'; end if;
    if person.visual_products is not null then raise exception 'Selecciona los productos en las capturas para esta persona.'; end if;
    if person.updated_at is distinct from (item->>'revision')::timestamptz then raise exception 'Los pendientes cambiaron. Actualiza y revisa las cantidades.'; end if;
    if person.product_quantity is null then raise exception 'Completa la cantidad total de %.',person.name; end if;
    if coalesce(item->>'purchased_quantity','') !~ '^[1-9][0-9]*$' then raise exception 'Las unidades compradas deben ser enteras mayores que cero.'; end if;
    qty:=(item->>'purchased_quantity')::integer;
    select coalesce(sum(purchased_quantity),0),count(*) filter(where purchased_quantity is null and result<>'not_purchased' and status not in ('pending','reassigned'))
      into bought,unknown_count from public.purchase_parts where client_id=person.id;
    if unknown_count>0 then raise exception 'Completa las unidades de las compras anteriores de %.',person.name; end if;
    if bought+qty>person.product_quantity then raise exception 'La compra supera las unidades pendientes de %.',person.name; end if;
    perform public.yori_validate_pending(item->'pending_products',person.product_quantity-bought-qty,true);
  end loop;
  select coalesce(max(purchase_number),0)+1 into number_next from public.purchases where closure_id=p_closure;
  insert into public.purchases(closure_id,purchase_number,purchase_date,account_label,real_cost,notes,status)
    values(p_closure,number_next,(p_values->>'purchase_date')::date,p_values->>'account_label',(p_values->>'real_cost')::numeric,p_values->>'notes','in_transit') returning * into purchase;
  for item in select value from jsonb_array_elements(p_parts) loop
    insert into public.purchase_parts(purchase_id,client_id,assigned_value,purchased_quantity,result,status)
      values(purchase.id,(item->>'client_id')::uuid,0,(item->>'purchased_quantity')::integer,'complete','in_transit');
    update public.clients set pending_products=item->'pending_products' where id=(item->>'client_id')::uuid;
  end loop;
  update public.order_closures set status='in_transit' where id=p_closure;
  return purchase;
end; $$;
create or replace function public.yori_guard_finished_closure()
returns trigger language plpgsql security invoker set search_path=public as $$
declare person public.clients; paid numeric; due numeric; quantity integer; unknown_count integer;
begin
  for person in select * from public.clients where closure_id=old.id order by id for update loop
    if not person.is_closed or person.price_snapshot is null or person.pricing_needs_review then
      raise exception 'Finaliza todas las personas y confirma sus precios antes de eliminar este cierre.';
    end if;
    select coalesce(sum(case when payment_type='refund' then -amount else amount end),0) into paid from public.payments where client_id=person.id;
    due:=round((person.price_snapshot->>'products')::numeric+(person.price_snapshot->>'pounds')::numeric+(person.price_snapshot->>'interest')::numeric-paid,2);
    if due is null or due<>0 then raise exception 'Este cierre tiene saldos pendientes o a favor. Resuélvelos antes de eliminarlo.'; end if;
    if exists(select 1 from public.purchase_parts where client_id=person.id and status in ('pending','in_transit')) then raise exception 'Todavía hay partes pendientes de compra o llegada.'; end if;
    select coalesce(sum(purchased_quantity),0),count(*) filter(where purchased_quantity is null and result<>'not_purchased' and status not in ('pending','reassigned')) into quantity,unknown_count from public.purchase_parts where client_id=person.id;
    if person.visual_products is not null and (quantity+(select count(*) from jsonb_array_elements(person.visual_products) i where i->>'state'='not_bought')<person.product_quantity or exists(select 1 from jsonb_array_elements(person.visual_products) i where i->>'state'='pending')) then raise exception 'Todavía hay productos pendientes de compra.'; end if;
    if person.visual_products is null and person.product_quantity is not null and unknown_count=0 and quantity<person.product_quantity then raise exception 'Todavía hay productos pendientes de compra.'; end if;
  end loop;
  return old;
end; $$;

create or replace function public.yori_guard_visual_delete() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if tg_table_name='captures' and exists(select 1 from public.clients c,jsonb_array_elements(c.visual_products) i where c.id=old.client_id and i->>'capture_id'=old.id::text) then
  raise exception 'Esta captura tiene productos marcados. Corrige sus marcas antes de eliminarla.';
 elsif tg_table_name='purchase_parts' and exists(select 1 from public.clients c,jsonb_array_elements(c.visual_products) i where c.id=old.client_id and i->>'part_id'=old.id::text) then
  raise exception 'Esta compra tiene productos seleccionados. Corrige los vistos de la persona antes de eliminarla.';
 end if;
 return old;
end; $$;
drop trigger if exists yori_guard_visual_delete on public.captures;
create trigger yori_guard_visual_delete before delete on public.captures for each row execute function public.yori_guard_visual_delete();
drop trigger if exists yori_guard_visual_delete on public.purchase_parts;
create trigger yori_guard_visual_delete before delete on public.purchase_parts for each row execute function public.yori_guard_visual_delete();


create or replace function public.yori_guard_client_quantity()
returns trigger language plpgsql security invoker set search_path=public as $$
declare bought integer; unknown_count integer; excluded integer;
begin
 select coalesce(sum(purchased_quantity),0),count(*) filter(where purchased_quantity is null and result<>'not_purchased' and status not in ('pending','reassigned')) into bought,unknown_count from public.purchase_parts where client_id=new.id;
 select count(*) into excluded from jsonb_array_elements(new.visual_products) i where i->>'state'='not_bought';
 if new.product_quantity is not null and bought+excluded>new.product_quantity then raise exception 'Lo comprado y descartado supera el total de unidades.'; end if;
 perform public.yori_validate_pending(new.pending_products,case when new.product_quantity is not null and unknown_count=0 then new.product_quantity-bought-excluded else null end,false);
 return new;
end; $$;

commit;
