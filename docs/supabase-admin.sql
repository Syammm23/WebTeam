-- =====================================================================
-- WE3 — the tables the admin panel manages, and who may do what in it.
--
-- Run once in the Supabase SQL Editor. Safe to run again, at any point,
-- in any state. It needs only `profiles` and `orders`, which the site is
-- already using; everything else it either creates or brings up to date.
--
-- Nothing here touches auth or the login. Accounts, passwords, sessions
-- and the order flow keep working exactly as they do now.
--
-- Every row of the check at the bottom must say true.
-- =====================================================================

begin;

-- =====================================================================
-- ROLES
--
--   founder     everything, and decides who else gets in
--   cofounder   everything except changing who gets in
--   developer   projects, tasks and the service catalogue
--   editor      enquiries, notes and the service catalogue
--   assistant   enquiries and notes
--
-- Every role reads everything — five people in one office, and hiding a
-- customer's phone number from the person answering the phone helps
-- nobody. What the roles decide is who may CHANGE what, and the answer
-- is enforced here rather than by hiding a button.
-- =====================================================================

alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists is_owner boolean not null default false;
alter table public.profiles add column if not exists role     text;

do $$
begin
  alter table public.profiles
    add constraint profiles_role_check
    check (role is null or role in
           ('founder', 'cofounder', 'developer', 'editor', 'assistant'));
exception when duplicate_object then null;
end $$;

-- A customer may edit these four columns and nothing else. The narrow
-- grant is what stops someone writing `role` onto their own row.
revoke update on public.profiles from authenticated;
grant update (phone, full_name, business, email) on public.profiles to authenticated;

-- Bring existing accounts across: the founder stays the founder, anyone
-- who was an admin becomes a co-founder, everyone else stays a customer.
update public.profiles set role = 'founder'
 where coalesce(is_owner, false) and role is null;
update public.profiles set role = 'cofounder'
 where coalesce(is_admin, false) and not coalesce(is_owner, false) and role is null;

-- `role` is the answer from here on; these two are kept in step with it
-- so that the policies written before roles existed still hold.
-- coalesce, not a bare comparison: `role = 'founder'` is NULL for a customer,
-- and is_owner is NOT NULL, so the plain form fails on the first customer row.
update public.profiles
   set is_admin = (role is not null),
       is_owner = coalesce(role = 'founder', false)
 where is_admin is distinct from (role is not null)
    or is_owner is distinct from coalesce(role = 'founder', false);

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() is not null;
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() = 'founder';
$$;

-- Money and deletions. A wrong answer here either takes cash off a real
-- order or throws a record away, so it stays with the two people whose
-- business it is.
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('founder', 'cofounder');
$$;

-- The work itself: projects and the tasks under them.
create or replace function public.can_build()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('founder', 'cofounder', 'developer');
$$;

-- What the services are called and what they cost.
create or replace function public.can_catalogue()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('founder', 'cofounder', 'developer', 'editor');
$$;

grant execute on function public.my_role()       to authenticated;
grant execute on function public.is_admin()      to authenticated;
grant execute on function public.is_owner()      to authenticated;
grant execute on function public.is_manager()    to authenticated;
grant execute on function public.can_build()     to authenticated;
grant execute on function public.can_catalogue() to authenticated;

-- ---------------------------------------------------------- enquiries
-- Everyone who fills in the contact form or the WhatsApp box. The public
-- site writes these; only the team reads them.
create table if not exists public.enquiries (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  name          text not null,
  business      text,
  phone         text,
  email         text,
  service       text,
  source        text not null default 'Website',
  message       text,
  status        text not null default 'New',
  internal_note text,
  handled_by    text,
  updated_at    timestamptz not null default now()
);

create index if not exists enquiries_created_idx on public.enquiries (created_at desc);
alter table public.enquiries enable row level security;

-- A visitor may leave an enquiry and nothing else. Pinning status and
-- internal_note is what stops the public key posting a row that already
-- claims to be handled, or writing notes into the team's own column.
drop policy if exists "anyone may enquire" on public.enquiries;
create policy "anyone may enquire" on public.enquiries
  for insert to anon, authenticated
  with check (status = 'New' and internal_note is null and handled_by is null);

drop policy if exists "admin reads enquiries" on public.enquiries;
create policy "admin reads enquiries" on public.enquiries
  for select to authenticated using (public.is_admin());

-- Answering an enquiry is the job everyone on the team does.
drop policy if exists "admin updates enquiries" on public.enquiries;
create policy "admin updates enquiries" on public.enquiries
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin deletes enquiries" on public.enquiries;
create policy "admin deletes enquiries" on public.enquiries
  for delete to authenticated using (public.is_manager());

-- --------------------------------------------------------- activities
-- What people actually do on the site. Written by the public page, read
-- only by the team.
create table if not exists public.activities (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  session_id text,
  user_id    uuid,
  username   text,
  kind       text not null,
  detail     text,
  page       text,
  device     text,
  referrer   text
);

create index if not exists activities_at_idx on public.activities (at desc);
alter table public.activities enable row level security;

-- A signed-out visitor logs anonymously; a signed-in one may only log as
-- themselves. Without this, anyone holding the public key could write rows
-- that blame someone else for what they did.
drop policy if exists "anyone may log activity" on public.activities;
create policy "anyone may log activity" on public.activities
  for insert to anon, authenticated
  with check (
    (user_id is null and username is null)      -- a signed-out visitor
    or user_id = auth.uid()                     -- or an account, as itself
  );

drop policy if exists "admin reads activity" on public.activities;
create policy "admin reads activity" on public.activities
  for select to authenticated using (public.is_admin());

-- ----------------------------------------------------------- services
-- The catalogue the team manages. The public site keeps its own prices
-- for now; changing those from here would need the site to read them, so
-- this stays a record rather than a remote control.
create table if not exists public.services (
  id          bigserial primary key,
  slug        text unique not null,
  name        text not null,
  price       integer not null default 0,
  description text,
  active      boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Reels do not multiply: the first is 1,999 and each one after it is 2,000,
-- so two come to 3,999. `step` is what the site calls the same rule, and it
-- lives here as well so the database can check an order's arithmetic.
alter table public.services add column if not exists step integer not null default 0;

alter table public.services enable row level security;

drop policy if exists "anyone reads active services" on public.services;
create policy "anyone reads active services" on public.services
  for select to anon, authenticated using (active or public.is_admin());

-- Named on purpose rather than left as one "for all" policy: writing a
-- price and deleting the service are not the same decision.
drop policy if exists "admin writes services" on public.services;
drop policy if exists "catalogue adds services" on public.services;
create policy "catalogue adds services" on public.services
  for insert to authenticated with check (public.can_catalogue());

drop policy if exists "catalogue edits services" on public.services;
create policy "catalogue edits services" on public.services
  for update to authenticated using (public.can_catalogue()) with check (public.can_catalogue());

drop policy if exists "manager deletes services" on public.services;
create policy "manager deletes services" on public.services
  for delete to authenticated using (public.is_manager());

-- The price is not the panel's to change. index.html charges it and the
-- order check below enforces it, so a price edited in one place and not
-- the others would start turning real customers away. Name, description,
-- on/off and order are the team's; price and step are set here.
revoke update on public.services from authenticated;
grant update (name, description, active, sort) on public.services to authenticated;

-- These names and prices must match index.html exactly: an order is checked
-- against this table before it is accepted, so a price changed on the site
-- and not here would start turning real customers away.
insert into public.services (slug, name, price, step, description, sort) values
  ('website',   'Website Development',    4999,    0, 'Custom website, mobile responsive, 1-year domain + hosting included.', 1),
  ('combo',     'Combo Package',          8999,    0, 'Website + 2 Instagram reels + one edited video.', 2),
  ('reel',      'Reel Making',            1999, 2000, 'Shooting and professional editing, delivered ready to post.', 3),
  ('video',     'Video Editing',           999,    0, 'You shoot it, we edit it — cuts, colour, captions and music.', 4),
  ('shopshoot', 'Store Photoshoot',        299,    0, 'We shoot your shop, so your site is not built on stock photos.', 5),
  ('maint6',    'Maintenance — 6 Months', 2999,    0, 'Content updates, bug fixes and uptime monitoring.', 6),
  ('maint12',   'Maintenance — 1 Year',   4999,    0, 'Content updates, bug fixes and uptime monitoring.', 7)
on conflict (slug) do update
  set name = excluded.name, price = excluded.price, step = excluded.step, sort = excluded.sort;

-- ----------------------------------------------------------- projects
create table if not exists public.projects (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  name        text not null,
  client_id   uuid references auth.users(id) on delete set null,
  client_name text,
  phone       text,
  service     text,
  order_ref   text,
  start_date  date,
  deadline    date,
  status      text not null default 'Not Started',
  progress    integer not null default 0,
  budget      integer not null default 0,
  paid        integer not null default 0,
  assignee    text,
  notes       text,
  updated_at  timestamptz not null default now()
);

alter table public.projects enable row level security;

drop policy if exists "admin manages projects" on public.projects;
drop policy if exists "admin reads projects" on public.projects;
create policy "admin reads projects" on public.projects
  for select to authenticated using (public.is_admin());

drop policy if exists "builder adds projects" on public.projects;
create policy "builder adds projects" on public.projects
  for insert to authenticated with check (public.can_build());

drop policy if exists "builder edits projects" on public.projects;
create policy "builder edits projects" on public.projects
  for update to authenticated using (public.can_build()) with check (public.can_build());

drop policy if exists "manager deletes projects" on public.projects;
create policy "manager deletes projects" on public.projects
  for delete to authenticated using (public.is_manager());

create table if not exists public.project_tasks (
  id         bigserial primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  title      text not null,
  assignee   text,
  due_date   date,
  priority   text not null default 'Medium',
  status     text not null default 'To Do',
  created_at timestamptz not null default now()
);

create index if not exists project_tasks_project_idx on public.project_tasks (project_id);
alter table public.project_tasks enable row level security;

drop policy if exists "admin manages tasks" on public.project_tasks;
drop policy if exists "admin reads tasks" on public.project_tasks;
create policy "admin reads tasks" on public.project_tasks
  for select to authenticated using (public.is_admin());

drop policy if exists "builder writes tasks" on public.project_tasks;
create policy "builder writes tasks" on public.project_tasks
  for all to authenticated using (public.can_build()) with check (public.can_build());

-- -------------------------------------------------------------- notes
-- Private to the team. Kept apart from orders.note, which the customer
-- reads — mixing the two would put an internal remark on their screen.
create table if not exists public.notes (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  entity    text not null,          -- 'client' | 'enquiry' | 'project'
  entity_id text not null,
  body      text not null,
  author    text
);

create index if not exists notes_entity_idx on public.notes (entity, entity_id, at desc);
alter table public.notes enable row level security;

drop policy if exists "admin manages notes" on public.notes;
drop policy if exists "admin reads notes" on public.notes;
create policy "admin reads notes" on public.notes
  for select to authenticated using (public.is_admin());

drop policy if exists "admin writes notes" on public.notes;
create policy "admin writes notes" on public.notes
  for insert to authenticated with check (public.is_admin());

drop policy if exists "manager deletes notes" on public.notes;
create policy "manager deletes notes" on public.notes
  for delete to authenticated using (public.is_manager());

-- =====================================================================
-- MONEY
-- Deciding a payment is a manager's call. The policy stops the write and
-- the trigger stops it again, because this is the one place in the panel
-- where being wrong costs somebody money.
-- =====================================================================
-- Written by the trigger below, never by the browser, so nobody can decide
-- an order without leaving the record of it.
create table if not exists public.order_events (
  id          bigserial primary key,
  order_ref   text not null references public.orders(ref) on delete cascade,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor       text,                     -- username, kept as text so the
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

revoke insert, update, delete on public.order_events from authenticated, anon;

drop policy if exists "admin updates orders" on public.orders;
create policy "admin updates orders" on public.orders
  for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

create or replace function public.guard_order_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_id   uuid := auth.uid();
  actor_name text;
begin
  select username into actor_name from public.profiles where id = actor_id;

  if not public.is_manager() then
    raise exception 'Only the founder or a co-founder can decide a payment.';
  end if;

  -- Anyone who may decide may decide again, as many times as it takes.
  -- What keeps that honest is the record below, not a lock: every change
  -- carries the name of whoever made it.
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

-- =====================================================================
-- WHO GETS IN
-- =====================================================================

-- Who changed whose access, and to what. Written by the function that
-- does the work, so it cannot be skipped.
create table if not exists public.role_events (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text,
  target     text,
  made_admin boolean
);
alter table public.role_events add column if not exists from_role text;
alter table public.role_events add column if not exists to_role   text;

alter table public.role_events enable row level security;

drop policy if exists "admin reads role history" on public.role_events;
create policy "admin reads role history" on public.role_events
  for select to authenticated using (public.is_admin());

revoke insert, update, delete on public.role_events from authenticated, anon;

create or replace function public.set_team_role(p_username text, p_role text)
returns text language plpgsql security definer set search_path = public as $$
declare
  actor_name  text;
  target_id   uuid;
  target_role text;
  uname       text := lower(trim(p_username));
  newrole     text := nullif(lower(trim(coalesce(p_role, ''))), '');
begin
  -- The check that matters. A co-founder calling this by hand gets nowhere.
  if not public.is_owner() then
    raise exception 'Only the founder can change who has access.';
  end if;

  -- 'founder' is deliberately missing. A second founder can overrule every
  -- decision in the book and hand out access themselves; that should take a
  -- deliberate line of SQL, not one tap on a phone.
  if newrole is not null and newrole not in ('cofounder', 'developer', 'editor', 'assistant') then
    raise exception 'Unknown role: %.', newrole;
  end if;

  select username into actor_name from public.profiles where id = auth.uid();
  select id, role into target_id, target_role from public.profiles where username = uname;

  if target_id is null then
    raise exception 'No account called %.', uname;
  end if;

  -- Changing your own access would lock everyone out of granting it back.
  if target_id = auth.uid() then
    raise exception 'You cannot change your own access.';
  end if;

  if target_role = 'founder' then
    raise exception 'That account is a founder.';
  end if;

  update public.profiles
     set role     = newrole,
         is_admin = (newrole is not null),
         is_owner = false
   where id = target_id;

  insert into public.role_events (actor, target, made_admin, from_role, to_role)
  values (actor_name, uname, newrole is not null, target_role, newrole);

  return coalesce(newrole, 'none');
end;
$$;

-- Kept so that anything still calling the old name keeps working.
create or replace function public.set_team_admin(p_username text, p_admin boolean)
returns text language plpgsql security definer set search_path = public as $$
begin
  return public.set_team_role(p_username, case when p_admin then 'cofounder' else null end);
end;
$$;

-- EXECUTE is granted to PUBLIC by default, which would leave these callable
-- by anyone holding the public key. Both check is_owner() as well, but the
-- grant is the fence that should not have to be tested.
revoke execute on function public.set_team_role(text, text)     from public, anon;
revoke execute on function public.set_team_admin(text, boolean) from public, anon;
grant  execute on function public.set_team_role(text, text)     to authenticated;
grant  execute on function public.set_team_admin(text, boolean) to authenticated;

-- Who signed up, when they last signed in, and what they have ordered.
-- last_sign_in_at lives in the auth schema, which the browser cannot read
-- directly, so it comes through here — and only for an admin.
drop function if exists public.admin_people();
create function public.admin_people()
returns table (
  username   text,
  phone      text,
  full_name  text,
  business   text,
  role       text,
  is_admin   boolean,
  is_owner   boolean,
  joined     timestamptz,
  last_login timestamptz,
  orders     integer,
  paid       integer
)
language sql stable security definer set search_path = public as $$
  select p.username, p.phone, p.full_name, p.business, p.role,
         p.role is not null, coalesce(p.role = 'founder', false),
         p.created_at, u.last_sign_in_at,
         count(o.ref)::int,
         coalesce(sum(o.paid) filter (where o.status = 'verified'), 0)::int
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.orders o on o.user_id = p.id
   where public.is_admin()
   group by p.username, p.phone, p.full_name, p.business, p.role,
            p.created_at, u.last_sign_in_at
   order by u.last_sign_in_at desc nulls last;
$$;

revoke execute on function public.admin_people() from public, anon;
grant  execute on function public.admin_people() to authenticated;

-- =====================================================================
-- PASSWORDS EXPIRE AFTER 14 DAYS
--
-- The panel holds every customer's phone number and every payment. A
-- password that has been the same since the shop opened is the likeliest
-- way in, so it stops working after a fortnight.
--
-- `password_changed_at` is moved by a trigger on auth.users, and only when
-- the stored hash actually changes. The browser cannot set it, so nobody
-- can restart their own clock without genuinely changing the password.
-- =====================================================================

alter table public.profiles add column if not exists password_changed_at timestamptz;
alter table public.profiles alter column password_changed_at set default now();

-- Everyone alive today gets a fresh fortnight rather than being locked out
-- the moment this runs.
update public.profiles set password_changed_at = now() where password_changed_at is null;

create or replace function public.on_password_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles set password_changed_at = now() where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_password_changed on auth.users;
create trigger on_auth_password_changed
  after update of encrypted_password on auth.users
  for each row execute function public.on_password_changed();

-- One number the panel can ask for: days until this password must change.
-- Negative means it already had to.
create or replace function public.password_days_left()
returns integer language sql stable security definer set search_path = public as $$
  select 14 - floor(
    extract(epoch from (now() - coalesce(
      (select password_changed_at from public.profiles where id = auth.uid()), now()
    ))) / 86400
  )::int;
$$;

-- Null is treated as fresh on purpose. A missing timestamp is a setup
-- problem, and locking the whole team out of their own panel is not the
-- right answer to one.
create or replace function public.password_fresh()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select password_changed_at from public.profiles where id = auth.uid()), now()
  ) > now() - interval '14 days';
$$;

grant execute on function public.password_days_left() to authenticated;
grant execute on function public.password_fresh()     to authenticated;

-- A stale password stops being an admin password. Signing in still works,
-- and so does changing it — that is the way back in, and it deliberately
-- does not depend on the thing being withheld.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() is not null and public.password_fresh();
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('founder', 'cofounder') and public.password_fresh();
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() = 'founder' and public.password_fresh();
$$;

create or replace function public.can_build()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('founder', 'cofounder', 'developer') and public.password_fresh();
$$;

create or replace function public.can_catalogue()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('founder', 'cofounder', 'developer', 'editor')
     and public.password_fresh();
$$;

-- =====================================================================
-- AN ORDER IS CHECKED AGAINST OUR OWN PRICES
--
-- Everything in the cart is worked out in the browser, which means the
-- number arriving here is whatever the browser chose to send. Until now
-- the only rule was that it said "pending". A rewritten page could have
-- placed a 4,999 order for 1 rupee and it would have been filed like any
-- other. So the total is recomputed here, from this table, and an order
-- that does not add up is refused.
-- =====================================================================

create or replace function public.order_total(p_items jsonb)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(
    case when s.step > 0 then s.price + (i.qty - 1) * s.step
         else s.price * i.qty end
  ), 0)::int
  from jsonb_to_recordset(p_items) as i(name text, qty int)
  join public.services s on s.name = i.name;
$$;

create or replace function public.guard_new_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n_sent  integer;
  n_known integer;
  bad_qty integer;
  want    integer;
  half    integer;
begin
  if jsonb_typeof(new.items) is distinct from 'array' then
    raise exception 'That order has no items.';
  end if;

  select count(*) into n_sent from jsonb_array_elements(new.items);

  select count(*), count(*) filter (where i.qty is null or i.qty < 1 or i.qty > 20)
    into n_known, bad_qty
    from jsonb_to_recordset(new.items) as i(name text, qty int)
    join public.services s on s.name = i.name;

  if n_sent = 0 then
    raise exception 'That order has no items.';
  end if;

  -- Every line must be something we sell. Without this check an unknown
  -- line could ride along free beside a total that happens to add up.
  if n_sent <> n_known then
    raise exception 'That order has an item we do not sell.';
  end if;

  if bad_qty > 0 then
    raise exception 'That order asks for an impossible quantity.';
  end if;

  want := public.order_total(new.items);
  half := round(want / 2.0)::int;

  if new.total is distinct from want then
    raise exception 'Order total is % but our prices make it %. If a price changed on the site, change it in Services too.',
      new.total, want;
  end if;

  if new.pay_mode = 'half' then
    if new.paid is distinct from half then
      raise exception 'Half of % is %, not %.', want, half, new.paid;
    end if;
  elsif new.pay_mode = 'full' then
    if new.paid is distinct from want then
      raise exception 'A full payment of % is %, not %.', want, want, new.paid;
    end if;
  else
    raise exception 'Unknown payment mode "%".', new.pay_mode;
  end if;

  return new;
end;
$$;

drop trigger if exists on_order_placed on public.orders;
create trigger on_order_placed
  before insert on public.orders
  for each row execute function public.guard_new_order();

-- =====================================================================
-- WHAT A STRANGER MAY WRITE
--
-- enquiries and activities are the only two tables the public key may
-- insert into, so they are the only two anyone can aim at. Nothing here
-- stops somebody sending a thousand enquiries; what it stops is one
-- enquiry carrying a megabyte, or a status the panel cannot render.
-- =====================================================================

-- `not valid` throughout: every new write is checked, and rows already in
-- the table are left alone. One odd legacy row should not abort the script.
do $$
begin
  alter table public.enquiries add constraint enquiries_sane check (
    length(name) between 1 and 80
    and coalesce(length(business), 0) <= 80
    and coalesce(length(phone), 0)    <= 20
    and coalesce(length(email), 0)    <= 120
    and coalesce(length(service), 0)  <= 60
    and coalesce(length(message), 0)  <= 2000
    and length(source) <= 30
    and status in ('New', 'Contacted', 'Quoted', 'In Progress', 'Completed', 'Lost')
    and coalesce(length(internal_note), 0) <= 2000
  ) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.activities add constraint activities_sane check (
    length(kind) between 1 and 60
    and coalesce(length(detail), 0)     <= 200
    and coalesce(length(page), 0)       <= 200
    and coalesce(length(device), 0)     <= 20
    and coalesce(length(referrer), 0)   <= 120
    and coalesce(length(session_id), 0) <= 60
    and coalesce(length(username), 0)   <= 20
  ) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.orders add constraint orders_sane check (
    status in ('pending', 'verified', 'rejected')
    and pay_mode in ('half', 'full')
    and total between 0 and 10000000
    and paid  between 0 and 10000000
    and paid <= total
    and length(customer_name) between 1 and 80
    and length(business) <= 80
    and length(phone) between 1 and 20
    and coalesce(length(email), 0) <= 120
    and coalesce(length(brief), 0) <= 2000
    and coalesce(length(note), 0)  <= 2000
  ) not valid;
exception when duplicate_object then null;
end $$;

commit;

notify pgrst, 'reload schema';

-- The founder.
update public.profiles
   set role = 'founder', is_admin = true, is_owner = true
 where username = 'adminlogbook';

-- --------------------------------------------------------------- check
-- Every row must say true.
select 'enquiries'      as thing, to_regclass('public.enquiries')     is not null as ok
union all select 'activities',    to_regclass('public.activities')    is not null
union all select 'services',      to_regclass('public.services')      is not null
union all select 'projects',      to_regclass('public.projects')      is not null
union all select 'project_tasks', to_regclass('public.project_tasks') is not null
union all select 'notes',         to_regclass('public.notes')         is not null
union all select 'order_events',  to_regclass('public.order_events')  is not null
union all select 'role column',   exists (select 1 from information_schema.columns
                                           where table_schema = 'public' and table_name = 'profiles'
                                             and column_name = 'role')
union all select 'set_team_role()', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                             where n.nspname = 'public' and p.proname = 'set_team_role')
union all select 'is_manager()',    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                             where n.nspname = 'public' and p.proname = 'is_manager')
union all select 'founder is set',  exists (select 1 from public.profiles
                                             where username = 'adminlogbook' and role = 'founder')
union all select 'password clock',  exists (select 1 from information_schema.columns
                                             where table_schema = 'public' and table_name = 'profiles'
                                               and column_name = 'password_changed_at')
union all select 'password trigger', exists (select 1 from pg_trigger where tgname = 'on_auth_password_changed')
union all select 'order price check', exists (select 1 from pg_trigger where tgname = 'on_order_placed');
