-- Cerdito Cornudo: esquema inicial para un solo restaurante.
-- Requiere Supabase Auth. Ejecutar como migración en un proyecto NUEVO.
-- No incluye credenciales ni claves privadas.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country_code text not null default 'CO' check (country_code = 'CO'),
  currency_code text not null default 'COP' check (currency_code = 'COP'),
  timezone text not null default 'America/Bogota',
  tax_rate numeric(6,5),
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id),
  full_name text not null,
  role text not null check (role in ('admin', 'waiter')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  label text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  unique (restaurant_id, label),
  unique (id, restaurant_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  unique (restaurant_id, name),
  unique (id, restaurant_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid not null,
  name text not null,
  description text not null default '',
  price_cop bigint not null check (price_cop >= 0),
  emoji text not null default '🍽️',
  available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (category_id, restaurant_id)
    references public.categories(id, restaurant_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  request_id uuid not null,
  restaurant_id uuid not null references public.restaurants(id),
  dining_table_id uuid,
  table_label text not null,
  status text not null default 'sent'
    check (status in ('sent', 'closed', 'cancelled')),
  subtotal_cop bigint not null check (subtotal_cop >= 0),
  tax_cop bigint not null default 0 check (tax_cop >= 0),
  total_cop bigint not null check (total_cop = subtotal_cop + tax_cop),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancel_reason text,
  unique (request_id, created_by),
  foreign key (dining_table_id, restaurant_id)
    references public.dining_tables(id, restaurant_id),
  check (
    (status <> 'closed' or (closed_by is not null and closed_at is not null))
    and (status <> 'cancelled' or
      (cancelled_by is not null and cancelled_at is not null
       and cancel_reason is not null and length(trim(cancel_reason)) > 0))
  )
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null,
  product_name text not null,
  unit_price_cop bigint not null check (unit_price_cop >= 0),
  quantity integer not null check (quantity between 1 and 99),
  notes text not null default '',
  line_total_cop bigint generated always as (unit_price_cop * quantity) stored
);

create index profiles_restaurant_role_idx on public.profiles(restaurant_id, role)
  where active;
create index products_restaurant_available_idx
  on public.products(restaurant_id, available, sort_order);
create index orders_restaurant_created_idx
  on public.orders(restaurant_id, created_at desc);
create index orders_restaurant_closed_idx
  on public.orders(restaurant_id, closed_at desc)
  where status = 'closed';
create index order_items_order_idx on public.order_items(order_id);

-- RLS helper functions are kept in a non-exposed schema. They only return the
-- caller's restaurant or role, never another user's profile data.
create or replace function private.my_restaurant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.restaurant_id
  from public.profiles p
  where p.user_id = (select auth.uid()) and p.active
  limit 1
$$;

create or replace function private.is_restaurant_admin(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid())
      and p.restaurant_id = p_restaurant_id
      and p.role = 'admin'
      and p.active
  )
$$;

revoke all on function private.my_restaurant_id() from public, anon;
revoke all on function private.is_restaurant_admin(uuid) from public, anon;
grant execute on function private.my_restaurant_id() to authenticated;
grant execute on function private.is_restaurant_admin(uuid) to authenticated;

alter table public.restaurants enable row level security;
alter table public.profiles enable row level security;
alter table public.dining_tables enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on public.restaurants, public.profiles, public.dining_tables,
  public.categories, public.products, public.orders, public.order_items
  from anon, authenticated;

grant select on public.restaurants, public.profiles, public.dining_tables,
  public.categories, public.products, public.orders, public.order_items
  to authenticated;
grant insert, update, delete on public.categories, public.products,
  public.dining_tables to authenticated;

create policy restaurant_members_read_restaurant on public.restaurants
  for select to authenticated
  using (id = (select private.my_restaurant_id()));

create policy users_read_own_profile on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid())
    or restaurant_id = (select private.my_restaurant_id()));

create policy members_read_tables on public.dining_tables
  for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id())
    and (active or (select private.is_restaurant_admin(restaurant_id))));
create policy admins_manage_tables on public.dining_tables
  for all to authenticated
  using ((select private.is_restaurant_admin(restaurant_id)))
  with check ((select private.is_restaurant_admin(restaurant_id)));

create policy members_read_categories on public.categories
  for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id())
    and (active or (select private.is_restaurant_admin(restaurant_id))));
create policy admins_manage_categories on public.categories
  for all to authenticated
  using ((select private.is_restaurant_admin(restaurant_id)))
  with check ((select private.is_restaurant_admin(restaurant_id)));

create policy members_read_products on public.products
  for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id())
    and (available or (select private.is_restaurant_admin(restaurant_id))));
create policy admins_manage_products on public.products
  for all to authenticated
  using ((select private.is_restaurant_admin(restaurant_id)))
  with check ((select private.is_restaurant_admin(restaurant_id)));

create policy members_read_orders on public.orders
  for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()));
create policy members_read_order_items on public.order_items
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and o.restaurant_id = (select private.my_restaurant_id())
  ));

-- Transactional order creation: price and product name are read from the
-- database, never trusted from the phone. request_id makes retries idempotent.
create or replace function public.create_order(
  p_request_id uuid,
  p_dining_table_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_restaurant uuid;
  v_table_label text;
  v_order_id uuid;
  v_subtotal bigint;
  v_item_count integer;
begin
  if v_user is null then raise exception 'Debes iniciar sesión'; end if;
  v_restaurant := private.my_restaurant_id();
  if v_restaurant is null then raise exception 'Usuario sin restaurante activo'; end if;
  if p_request_id is null then raise exception 'Pedido inválido'; end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Pedido inválido';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 60 then
    raise exception 'Pedido inválido';
  end if;

  select o.id into v_order_id
  from public.orders o
  where o.request_id = p_request_id and o.created_by = v_user;
  if v_order_id is not null then return v_order_id; end if;

  if p_dining_table_id is null then
    v_table_label := 'Para llevar';
  else
    select t.label into v_table_label
    from public.dining_tables t
    where t.id = p_dining_table_id
      and t.restaurant_id = v_restaurant and t.active;
    if v_table_label is null then raise exception 'Mesa no disponible'; end if;
  end if;

  select count(*), coalesce(sum(p.price_cop * i.quantity), 0)
    into v_item_count, v_subtotal
  from jsonb_to_recordset(p_items)
    as i(product_id uuid, quantity integer, notes text)
  join public.products p
    on p.id = i.product_id and p.restaurant_id = v_restaurant and p.available
  where i.quantity between 1 and 99;

  if v_item_count <> jsonb_array_length(p_items) then
    raise exception 'Uno o más productos no están disponibles';
  end if;

  insert into public.orders (
    request_id, restaurant_id, dining_table_id, table_label, status,
    subtotal_cop, tax_cop, total_cop, created_by
  ) values (
    p_request_id, v_restaurant, p_dining_table_id, v_table_label, 'sent',
    v_subtotal, 0, v_subtotal, v_user
  ) returning id into v_order_id;

  insert into public.order_items (
    order_id, product_id, product_name, unit_price_cop, quantity, notes
  )
  select v_order_id, p.id, p.name, p.price_cop, i.quantity,
         coalesce(left(i.notes, 240), '')
  from jsonb_to_recordset(p_items)
    as i(product_id uuid, quantity integer, notes text)
  join public.products p
    on p.id = i.product_id and p.restaurant_id = v_restaurant and p.available;

  return v_order_id;
end;
$$;

create or replace function public.close_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_user is null then raise exception 'Debes iniciar sesión'; end if;
  select * into v_order from public.orders where id = p_order_id
    and restaurant_id = private.my_restaurant_id() for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if v_order.status <> 'sent' then raise exception 'El pedido ya no está enviado'; end if;
  if v_order.created_by <> v_user
     and not private.is_restaurant_admin(v_order.restaurant_id) then
    raise exception 'No tienes permiso para cerrar este pedido';
  end if;
  update public.orders set status = 'closed', closed_by = v_user,
    closed_at = now() where id = p_order_id;
end;
$$;

create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_restaurant uuid;
begin
  if v_user is null then raise exception 'Debes iniciar sesión'; end if;
  v_restaurant := private.my_restaurant_id();
  if not private.is_restaurant_admin(v_restaurant) then
    raise exception 'Solo administración puede anular pedidos';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Escribe el motivo de anulación';
  end if;
  update public.orders set status = 'cancelled', cancelled_by = v_user,
    cancelled_at = now(), cancel_reason = left(trim(p_reason), 500)
  where id = p_order_id and restaurant_id = v_restaurant
    and status in ('sent', 'closed');
  if not found then raise exception 'Pedido no encontrado o no anulable'; end if;
end;
$$;

revoke all on function public.create_order(uuid, uuid, jsonb) from public, anon;
revoke all on function public.close_order(uuid) from public, anon;
revoke all on function public.cancel_order(uuid, text) from public, anon;
grant execute on function public.create_order(uuid, uuid, jsonb) to authenticated;
grant execute on function public.close_order(uuid) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;

-- The Supabase project must expose only public tables/functions used by this app
-- in Data API settings. Explicit grants above remain necessary.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders') then
      alter publication supabase_realtime add table public.orders;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='order_items') then
      alter publication supabase_realtime add table public.order_items;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='products') then
      alter publication supabase_realtime add table public.products;
    end if;
  end if;
end $$;

-- Initial restaurant and demo table layout. Real products are loaded separately.
insert into public.restaurants(name, country_code, currency_code, timezone)
values ('Cerdito Cornudo', 'CO', 'COP', 'America/Bogota');

insert into public.dining_tables(restaurant_id, label, sort_order)
select r.id, 'Mesa ' || lpad(n::text, 2, '0'), n
from public.restaurants r
cross join generate_series(1, 12) as n
where r.name = 'Cerdito Cornudo';

-- Bootstrap the first administrator only after creating that user in
-- Supabase Auth. See supabase/README.md for the safe setup steps.

