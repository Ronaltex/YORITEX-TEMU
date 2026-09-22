-- YORI-TEX · Configuración inicial de Supabase
-- Ejecuta este archivo completo una sola vez en SQL Editor > New query > Run.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  business_name text not null default 'YORI-TEX',
  pound_rate numeric(10,2) not null default 4 check (pound_rate >= 0),
  minimum_pound_charge numeric(10,2) not null default 4 check (minimum_pound_charge >= 0),
  maximum_pound_charge numeric(10,2) not null default 10 check (maximum_pound_charge >= minimum_pound_charge),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id)
);

create table if not exists public.order_closures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  announced_date date not null,
  status text not null default 'open' check (status in ('open','ordered','in_transit','receiving','completed','archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  closure_id uuid not null,
  name text not null,
  phone text,
  products_total numeric(10,2) not null default 0 check (products_total >= 0),
  estimated_weight numeric(10,2) check (estimated_weight is null or estimated_weight >= 0),
  notes text,
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  constraint clients_closure_owner_fk foreign key (closure_id, owner_id)
    references public.order_closures(id, owner_id) on delete cascade
);

create table if not exists public.captures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null,
  storage_path text not null,
  original_name text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint captures_client_owner_fk foreign key (client_id, owner_id)
    references public.clients(id, owner_id) on delete cascade
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null,
  amount numeric(10,2) not null check (amount > 0),
  payment_type text not null default 'payment' check (payment_type in ('deposit','payment','refund','correction')),
  note text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint payments_client_owner_fk foreign key (client_id, owner_id)
    references public.clients(id, owner_id) on delete cascade
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  closure_id uuid not null,
  purchase_number integer not null,
  purchase_date date not null default current_date,
  account_label text not null,
  real_cost numeric(10,2) not null default 0 check (real_cost >= 0),
  status text not null default 'in_transit' check (status in ('draft','in_transit','partially_received','received','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (closure_id, purchase_number),
  constraint purchases_closure_owner_fk foreign key (closure_id, owner_id)
    references public.order_closures(id, owner_id) on delete cascade
);

create table if not exists public.purchase_parts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  purchase_id uuid not null,
  client_id uuid not null,
  assigned_value numeric(10,2) not null default 0 check (assigned_value >= 0),
  result text not null default 'complete' check (result in ('complete','missing_items','not_purchased')),
  status text not null default 'in_transit' check (status in ('pending','in_transit','received','lost','cancelled','reassigned')),
  missing_note text,
  arrived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  constraint parts_purchase_owner_fk foreign key (purchase_id, owner_id)
    references public.purchases(id, owner_id) on delete cascade,
  constraint parts_client_owner_fk foreign key (client_id, owner_id)
    references public.clients(id, owner_id) on delete cascade
);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null,
  part_id uuid,
  incident_type text not null check (incident_type in ('missing_product','lost_part','cancelled_part','partial_delivery','other')),
  description text not null,
  deduction numeric(10,2) not null default 0 check (deduction >= 0),
  created_at timestamptz not null default now(),
  constraint incidents_client_owner_fk foreign key (client_id, owner_id)
    references public.clients(id, owner_id) on delete cascade,
  constraint incidents_part_owner_fk foreign key (part_id, owner_id)
    references public.purchase_parts(id, owner_id) on delete cascade
);

create table if not exists public.weight_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null,
  weight_lbs numeric(10,2) not null check (weight_lbs > 0),
  delivery_type text not null default 'final' check (delivery_type in ('partial','final')),
  pending_reason text,
  note text,
  weighed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint weights_client_owner_fk foreign key (client_id, owner_id)
    references public.clients(id, owner_id) on delete cascade
);

create index if not exists clients_closure_idx on public.clients(closure_id);
create index if not exists captures_client_idx on public.captures(client_id);
create index if not exists payments_client_idx on public.payments(client_id);
create index if not exists purchases_closure_idx on public.purchases(closure_id);
create index if not exists parts_client_idx on public.purchase_parts(client_id);
create index if not exists parts_purchase_idx on public.purchase_parts(purchase_id);
create index if not exists incidents_client_idx on public.incidents(client_id);
create index if not exists weights_client_idx on public.weight_entries(client_id);

drop trigger if exists app_settings_updated_at on public.app_settings;
create trigger app_settings_updated_at before update on public.app_settings
for each row execute function public.set_updated_at();
drop trigger if exists order_closures_updated_at on public.order_closures;
create trigger order_closures_updated_at before update on public.order_closures
for each row execute function public.set_updated_at();
drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at before update on public.clients
for each row execute function public.set_updated_at();
drop trigger if exists purchases_updated_at on public.purchases;
create trigger purchases_updated_at before update on public.purchases
for each row execute function public.set_updated_at();
drop trigger if exists purchase_parts_updated_at on public.purchase_parts;
create trigger purchase_parts_updated_at before update on public.purchase_parts
for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
alter table public.order_closures enable row level security;
alter table public.clients enable row level security;
alter table public.captures enable row level security;
alter table public.payments enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_parts enable row level security;
alter table public.incidents enable row level security;
alter table public.weight_entries enable row level security;

revoke all on public.app_settings, public.order_closures, public.clients, public.captures,
  public.payments, public.purchases, public.purchase_parts, public.incidents,
  public.weight_entries from anon;
grant select, insert, update, delete on public.app_settings, public.order_closures,
  public.clients, public.captures, public.payments, public.purchases,
  public.purchase_parts, public.incidents, public.weight_entries to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_settings','order_closures','clients','captures','payments',
    'purchases','purchase_parts','incidents','weight_entries'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_owner_all', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
      table_name || '_owner_all', table_name
    );
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-captures',
  'client-captures',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists client_captures_select on storage.objects;
create policy client_captures_select on storage.objects
for select to authenticated
using (bucket_id = 'client-captures' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists client_captures_insert on storage.objects;
create policy client_captures_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'client-captures' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists client_captures_update on storage.objects;
create policy client_captures_update on storage.objects
for update to authenticated
using (bucket_id = 'client-captures' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'client-captures' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists client_captures_delete on storage.objects;
create policy client_captures_delete on storage.objects
for delete to authenticated
using (bucket_id = 'client-captures' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Activa eventos en tiempo real para que otra pestaña o dispositivo se actualice.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_settings','order_closures','clients','captures','payments',
    'purchases','purchase_parts','incidents','weight_entries'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
