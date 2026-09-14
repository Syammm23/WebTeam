-- =====================================================================
-- WE3 — the founder can grant and remove admin from the Order Book.
-- Run once in the Supabase SQL Editor. Safe to run again.
-- =====================================================================

begin;

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

select 'role_events table' as thing, to_regclass('public.role_events') is not null as ok
union all
select 'set_team_admin()', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                    where n.nspname = 'public' and p.proname = 'set_team_admin');
