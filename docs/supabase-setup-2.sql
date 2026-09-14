-- =====================================================================
-- WE3 — everything the Order Book needs, in one script.
--
--   * is_owner, so the founder can overrule a decided order
--   * order_events + a trigger: decide once, and record who decided
--   * admin_people(): who signed up, when they last signed in
--   * role_events + set_team_admin(): the founder grants admin from the page
--
-- Run once in the Supabase SQL Editor. Safe to run again.
-- Every row of the final check must say true.
-- =====================================================================

begin;

-- The owner. A plain admin decides an order once; the owner can always
-- change it afterwards, which is the whole point of the distinction.
alter table public.profiles add column if not exists is_owner boolean not null default false;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_owner from public.profiles where id = auth.uid()), false);
$$;

-- ------------------------------------------------------------ history
-- Written by a trigger, never by the browser, so nobody can change an
-- order without leaving the record of it.
create table if not exists public.order_events (
  id         bigserial primary key,
  order_ref  text not null references public.orders(ref) on delete cascade,
  at         timestamptz not null default now(),
  actor_id   uuid,
  actor      text,                       -- username, kept as text so the
                                         -- history survives an account going
  from_status text,
  to_status   text,
  from_note   text,
  to_note     text
);

create index if not exists order_events_ref_idx on public.order_events (order_ref, at desc);

alter table public.order_events enable row level security;

drop policy if exists "admin reads history" on public.order_events;
create policy "admin reads history" on public.order_events
  for select to authenticated using (public.is_admin());

-- Nobody writes this table directly. The trigger runs as its definer, so
-- it does not need a policy of its own.
revoke insert, update, delete on public.order_events from authenticated, anon;

-- ------------------------------------------------- the rule + the record
create or replace function public.guard_order_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_id   uuid := auth.uid();
  actor_name text;
  admin      boolean;
  owner      boolean;
begin
  select username, is_admin, is_owner
    into actor_name, admin, owner
    from public.profiles where id = actor_id;

  if not coalesce(admin, false) then
    raise exception 'Only an admin can change an order.';
  end if;

  -- Decided once. After that only the owner may move it, so a payment
  -- cannot be quietly flipped between verified and rejected.
  if new.status is distinct from old.status
     and old.status <> 'pending'
     and not coalesce(owner, false) then
    raise exception
      'Order % is already %. Only the owner can change it now.', old.ref, old.status;
  end if;

  if new.status is distinct from old.status
     or new.note is distinct from old.note then
    insert into public.order_events (order_ref, actor_id, actor,
                                     from_status, to_status, from_note, to_note)
    values (old.ref, actor_id, actor_name,
            old.status, new.status, old.note, new.note);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists on_order_changed on public.orders;
create trigger on_order_changed
  before update on public.orders
  for each row execute function public.guard_order_change();

-- ------------------------------------------------------------- people
-- Who signed up, when they last signed in, and what they have ordered.
-- last_sign_in_at lives in the auth schema, which the browser cannot read
-- directly, so it comes through here — and only for an admin.
create or replace function public.admin_people()
returns table (
  username   text,
  phone      text,
  full_name  text,
  business   text,
  is_admin   boolean,
  is_owner   boolean,
  joined     timestamptz,
  last_login timestamptz,
  orders     integer,
  paid       integer
)
language sql stable security definer set search_path = public as $$
  select p.username, p.phone, p.full_name, p.business, p.is_admin, p.is_owner,
         p.created_at, u.last_sign_in_at,
         count(o.ref)::int,
         coalesce(sum(o.paid) filter (where o.status = 'verified'), 0)::int
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.orders o on o.user_id = p.id
   where public.is_admin()
   group by p.username, p.phone, p.full_name, p.business,
            p.is_admin, p.is_owner, p.created_at, u.last_sign_in_at
   order by u.last_sign_in_at desc nulls last;
$$;

grant execute on function public.admin_people() to authenticated;
grant execute on function public.is_owner() to authenticated;



-- Who changed whose access, and when. Same reasoning as the order history:
-- written by the function that does the work, so it cannot be skipped.
create table if not exists public.role_events (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text,
  target     text,
  made_admin boolean
);

alter table public.role_events enable row level security;

drop policy if exists "admin reads role history" on public.role_events;
create policy "admin reads role history" on public.role_events
  for select to authenticated using (public.is_admin());

revoke insert, update, delete on public.role_events from authenticated, anon;

create or replace function public.set_team_admin(p_username text, p_admin boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  actor_name   text;
  target_id    uuid;
  target_owner boolean;
  uname        text := lower(trim(p_username));
begin
  -- The check that matters. A co-founder calling this by hand gets nowhere.
  if not public.is_owner() then
    raise exception 'Only the founder can change who is an admin.';
  end if;

  select username into actor_name from public.profiles where id = auth.uid();

  select id, is_owner into target_id, target_owner
    from public.profiles where username = uname;

  if target_id is null then
    raise exception 'No account called %.', uname;
  end if;

  -- Removing your own access would lock everyone out of granting it back.
  if target_id = auth.uid() then
    raise exception 'You cannot change your own access.';
  end if;

  -- Founders are set in SQL on purpose. One button should not be able to
  -- create someone who can overrule every decision in the book.
  if coalesce(target_owner, false) then
    raise exception 'That account is a founder.';
  end if;

  update public.profiles set is_admin = p_admin where id = target_id;

  insert into public.role_events (actor, target, made_admin)
  values (actor_name, uname, p_admin);

  return case when p_admin then 'now a co-founder' else 'no longer an admin' end;
end;
$$;

-- EXECUTE is granted to PUBLIC by default, which would leave this callable by
-- anyone with the public key. The function checks is_owner() as well, but the
-- grant is the fence that should not have to be tested.
revoke execute on function public.set_team_admin(text, boolean) from public, anon;
grant  execute on function public.set_team_admin(text, boolean) to authenticated;

commit;

notify pgrst, 'reload schema';

-- The founder.
update public.profiles set is_owner = true where username = 'adminlogbook';

select 'is_owner column' as thing,
       exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='profiles'
                  and column_name='is_owner') as ok
union all select 'order_events table', to_regclass('public.order_events') is not null
union all select 'role_events table',  to_regclass('public.role_events') is not null
union all select 'change trigger',     exists (select 1 from pg_trigger where tgname='on_order_changed')
union all select 'admin_people()',     exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                                                where n.nspname='public' and p.proname='admin_people')
union all select 'set_team_admin()',   exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                                                where n.nspname='public' and p.proname='set_team_admin')
union all select 'founder is set',     exists (select 1 from public.profiles
                                                where username='adminlogbook' and is_owner);
