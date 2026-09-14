-- =====================================================================
-- WE3 — run this once in the Supabase SQL Editor.
--
-- Safe to run again. Every statement either creates something or replaces
-- what is already there, and it all runs as one transaction: if any line
-- fails, nothing is left half-made.
--
-- After it finishes, the last query prints what exists. Every row should
-- say "yes".
-- =====================================================================

begin;

-- ------------------------------------------------------------ profiles
-- One row per customer. The username lives here; auth.users holds only the
-- internal address and the password hash.
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null unique,
  phone      text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

do $$
begin
  alter table public.profiles
    add constraint username_format check (username ~ '^[a-z0-9_]{3,20}$');
exception when duplicate_object then null;
end $$;

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- A customer may edit their phone number and nothing else. Without this they
-- could set is_admin on their own row and read every order in the table.
revoke update on public.profiles from authenticated;
grant update (phone) on public.profiles to authenticated;

-- The profile is created by the database as part of the signup, so a taken
-- username fails the whole signup instead of leaving a half-made account.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, phone)
  values (new.id,
          lower(new.raw_user_meta_data->>'username'),
          new.raw_user_meta_data->>'phone');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- "Is this username free?" for the registration screen. A function rather
-- than a plain select, so nobody can pull down the whole customer list.
create or replace function public.username_available(p_username text)
returns boolean language sql security definer set search_path = public as $$
  select not exists (
    select 1 from public.profiles where username = lower(p_username)
  );
$$;
grant execute on function public.username_available(text) to anon, authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- -------------------------------------------------------------- orders
create table if not exists public.orders (
  ref           text primary key,          -- WE3-7K2M, the code the customer sees
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  customer_name text    not null,
  business      text    not null,
  phone         text    not null,
  email         text,
  brief         text,
  items         jsonb   not null,          -- [{ name, qty, price }]
  total         integer not null,
  paid          integer not null,
  pay_mode      text    not null,          -- 'half' or 'full'
  status        text    not null default 'pending',
  note          text,                      -- your message back to the customer
  updated_at    timestamptz not null default now()
);

create index if not exists orders_user_idx
  on public.orders (user_id, created_at desc);

alter table public.orders enable row level security;

drop policy if exists "read own orders" on public.orders;
create policy "read own orders" on public.orders
  for select to authenticated using (user_id = auth.uid());

-- A customer places an order as themselves, always pending. The status check
-- is the important half: without it the browser could post an order that
-- already claims to be verified.
drop policy if exists "place own order" on public.orders;
create policy "place own order" on public.orders
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and note is null);

drop policy if exists "admin reads every order" on public.orders;
create policy "admin reads every order" on public.orders
  for select to authenticated using (public.is_admin());

drop policy if exists "admin updates orders" on public.orders;
create policy "admin updates orders" on public.orders
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

commit;

-- PostgREST caches the shape of the schema; without this the site keeps
-- being told the table does not exist for a minute or two after creating it.
notify pgrst, 'reload schema';

-- --------------------------------------------------------------- check
-- Every row must say "yes".
select 'profiles table'          as thing,
       to_regclass('public.profiles') is not null as ok
union all
select 'orders table',
       to_regclass('public.orders') is not null
union all
select 'username_available()',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'username_available')
union all
select 'is_admin()',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'is_admin')
union all
select 'signup trigger',
       exists (select 1 from pg_trigger where tgname = 'on_auth_user_created');
