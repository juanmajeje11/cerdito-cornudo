-- Hardening pass following the first database advisor review.
-- Move privileged implementations out of the exposed public API schema;
-- keep narrow SECURITY INVOKER RPC wrappers in public.

alter function public.create_order(uuid, uuid, jsonb) set schema private;
alter function public.close_order(uuid) set schema private;
alter function public.cancel_order(uuid, text) set schema private;

create function public.create_order(
  p_request_id uuid, p_dining_table_id uuid, p_items jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.create_order(p_request_id, p_dining_table_id, p_items) $$;

create function public.close_order(p_order_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.close_order(p_order_id) $$;

create function public.cancel_order(p_order_id uuid, p_reason text)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.cancel_order(p_order_id, p_reason) $$;

revoke all on function public.create_order(uuid, uuid, jsonb) from public, anon;
revoke all on function public.close_order(uuid) from public, anon;
revoke all on function public.cancel_order(uuid, text) from public, anon;
grant execute on function public.create_order(uuid, uuid, jsonb) to authenticated;
grant execute on function public.close_order(uuid) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;

drop policy admins_manage_tables on public.dining_tables;
create policy admins_insert_tables on public.dining_tables
  for insert to authenticated
  with check ((select private.is_restaurant_admin(restaurant_id)));
create policy admins_update_tables on public.dining_tables
  for update to authenticated
  using ((select private.is_restaurant_admin(restaurant_id)))
  with check ((select private.is_restaurant_admin(restaurant_id)));
create policy admins_delete_tables on public.dining_tables
  for delete to authenticated
  using ((select private.is_restaurant_admin(restaurant_id)));

drop policy admins_manage_categories on public.categories;
create policy admins_insert_categories on public.categories
  for insert to authenticated
  with check ((select private.is_restaurant_admin(restaurant_id)));
create policy admins_update_categories on public.categories
  for update to authenticated
  using ((select private.is_restaurant_admin(restaurant_id)))
  with check ((select private.is_restaurant_admin(restaurant_id)));
create policy admins_delete_categories on public.categories
  for delete to authenticated
  using ((select private.is_restaurant_admin(restaurant_id)));

drop policy admins_manage_products on public.products;
create policy admins_insert_products on public.products
  for insert to authenticated
  with check ((select private.is_restaurant_admin(restaurant_id)));
create policy admins_update_products on public.products
  for update to authenticated
  using ((select private.is_restaurant_admin(restaurant_id)))
  with check ((select private.is_restaurant_admin(restaurant_id)));
create policy admins_delete_products on public.products
  for delete to authenticated
  using ((select private.is_restaurant_admin(restaurant_id)));

create index if not exists orders_closed_by_idx on public.orders(closed_by);
create index if not exists orders_cancelled_by_idx on public.orders(cancelled_by);
create index if not exists orders_created_by_idx on public.orders(created_by);
create index if not exists orders_table_restaurant_idx
  on public.orders(dining_table_id, restaurant_id);
create index if not exists products_category_restaurant_idx
  on public.products(category_id, restaurant_id);

