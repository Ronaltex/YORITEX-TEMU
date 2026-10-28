-- YORI-TEX: hasta cuatro cierres por propietario. No crea ni elimina pedidos existentes.
begin;
create or replace function public.yori_limit_closures()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,0));
  if (select count(*) from public.order_closures where owner_id=new.owner_id)>=4 then
    raise exception 'Ya tienes cuatro cierres guardados. Elimina un cierre terminado para liberar espacio y crear otro.';
  end if;
  return new;
end; $$;
drop trigger if exists yori_limit_closures on public.order_closures;
create trigger yori_limit_closures before insert on public.order_closures for each row execute function public.yori_limit_closures();

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
    if person.product_quantity is not null and unknown_count=0 and quantity<person.product_quantity then raise exception 'Todavía hay productos pendientes de compra.'; end if;
  end loop;
  return old;
end; $$;
drop trigger if exists yori_guard_finished_closure on public.order_closures;
create trigger yori_guard_finished_closure before delete on public.order_closures for each row execute function public.yori_guard_finished_closure();
commit;
