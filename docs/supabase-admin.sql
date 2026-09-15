-- =====================================================================
-- WE3 — tables the admin panel manages.
-- Run once in the Supabase SQL Editor. Safe to run again.
--
-- Nothing here touches auth, profiles or orders: the login, the accounts
-- and the order flow keep working exactly as they do now.
-- =====================================================================

begin;

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

drop policy if exists "admin updates enquiries" on public.enquiries;
create policy "admin updates enquiries" on public.enquiries
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin deletes enquiries" on public.enquiries;
create policy "admin deletes enquiries" on public.enquiries
  for delete to authenticated using (public.is_admin());

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

alter table public.services enable row level security;

drop policy if exists "anyone reads active services" on public.services;
create policy "anyone reads active services" on public.services
  for select to anon, authenticated using (active or public.is_admin());

drop policy if exists "admin writes services" on public.services;
create policy "admin writes services" on public.services
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.services (slug, name, price, description, sort) values
  ('website',   'Website Development', 4999, 'Custom website, mobile responsive, 1-year domain + hosting included.', 1),
  ('combo',     'Combo Package',       8999, 'Website + 2 Instagram reels + one edited video.', 2),
  ('reel',      'Reel Making',         1999, 'Shooting and professional editing, delivered ready to post.', 3),
  ('video',     'Video Editing',        999, 'You shoot it, we edit it — cuts, colour, captions and music.', 4),
  ('shopshoot', 'Store Photoshoot',     299, 'We shoot your shop, so your site is not built on stock photos.', 5),
  ('maint6',    'Maintenance — 6 Months', 2999, 'Content updates, bug fixes and uptime monitoring.', 6),
  ('maint12',   'Maintenance — 1 Year',   4999, 'Content updates, bug fixes and uptime monitoring.', 7)
on conflict (slug) do nothing;

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
create policy "admin manages projects" on public.projects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

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
create policy "admin manages tasks" on public.project_tasks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

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
create policy "admin manages notes" on public.notes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

commit;

notify pgrst, 'reload schema';

select 'enquiries'     as thing, to_regclass('public.enquiries')     is not null as ok
union all select 'activities',    to_regclass('public.activities')    is not null
union all select 'services',      to_regclass('public.services')      is not null
union all select 'projects',      to_regclass('public.projects')      is not null
union all select 'project_tasks', to_regclass('public.project_tasks') is not null
union all select 'notes',         to_regclass('public.notes')         is not null;
