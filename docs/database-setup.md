# Adding a real database (no backend server)

Right now every order lives in `localStorage` — one browser, one device. Clear
the browser data and the order history is gone. That is the problem this fixes.

You do **not** need to run a server. Supabase gives you a hosted Postgres
database that the site talks to directly over HTTPS. The site stays exactly
where it is on GitHub Pages. Free tier is enough for this volume — no card
needed, no monthly bill.

Setup is about 10 minutes and it is all yours to do once; after that I wire the
site to it.

---

## Step 1 — Make the project

1. Go to https://supabase.com and sign up (GitHub login works).
2. **New project.** Name it `we3`. Pick region **Mumbai (ap-south-1)** — closest
   to Daman, so the site feels fast.
3. It asks for a database password. Save it in your password manager. You will
   not need it for the website, only if you ever open the database directly.
4. Wait ~2 minutes while it builds.

## Step 2 — Create the orders table

Open **SQL Editor** in the left sidebar, paste all of this, press **Run**.

```sql
create table public.orders (
  ref            text primary key,                 -- WE3-7K2M, the code the customer sees
  created_at     timestamptz not null default now(),
  customer_name  text    not null,
  phone          text    not null,                 -- 10 digits, no +91
  items          jsonb   not null,                 -- [{ name, qty, price }]
  total          integer not null,                 -- whole rupees
  paid_now       integer not null,                 -- what they actually paid at checkout
  pay_mode       text    not null,                 -- 'half' or 'full'
  status         text    not null default 'pending',
  note           text,                             -- your message to the customer
  updated_at     timestamptz not null default now()
);

create index orders_phone_idx on public.orders (phone);

alter table public.orders enable row level security;

-- A visitor may place an order, and nothing else.
-- The `status = 'pending'` check is the important bit: without it someone could
-- post an order to your database that already says "verified".
create policy "place an order"
  on public.orders for insert to anon
  with check (status = 'pending' and note is null);

-- Only you, signed in, can read the whole table or change a status.
create policy "admin reads all"
  on public.orders for select to authenticated using (true);

create policy "admin updates status"
  on public.orders for update to authenticated
  using (true) with check (true);

-- Customers cannot read the table directly. They go through this one function,
-- which only ever returns rows matching the phone number they typed in.
create or replace function public.find_orders(p_phone text)
returns table (
  ref text, created_at timestamptz, customer_name text, items jsonb,
  total integer, paid_now integer, pay_mode text, status text, note text
)
language sql
security definer
set search_path = public
as $$
  select o.ref, o.created_at, o.customer_name, o.items, o.total,
         o.paid_now, o.pay_mode, o.status, o.note
  from public.orders o
  where o.phone = p_phone
  order by o.created_at desc
  limit 50;
$$;

grant execute on function public.find_orders(text) to anon;
```

## Step 3 — Make your admin login

**Authentication → Users → Add user → Create new user.**

Use a real email and a strong password. This is the account you sign in with on
`admin.html` to mark payments verified or rejected. Make one per person who
needs to verify payments.

Turn **off** public sign-ups so nobody else can create an account:
**Authentication → Sign In / Providers → Email → uncheck "Allow new users to
sign up" → Save.**

## Step 4 — Send me two values

**Project Settings → API.** Copy:

- **Project URL** — looks like `https://abcdefgh.supabase.co`
- **anon / public key** — a long string starting `eyJ...`

Both of these are *meant* to be public — they sit in the website's JavaScript
where anyone can read them. They are safe because of the rules in Step 2: that
key can create a pending order and call `find_orders`, and nothing else.

**Never** send me the `service_role` key on the same page. That one bypasses
every rule above. If it ever leaks, rotate it immediately.

---

## What changes on the site once this is in

- Checkout writes the order to the database as well as this browser.
- **My Orders** gets a "find my orders" box — type your phone number, see every
  order you ever placed, from any phone, even after clearing browser data.
- When you mark a payment **verified** or **rejected** in the admin page, the
  customer actually sees it. Today they never can — their browser has no way to
  learn your decision. This is the real fix for that.
- The admin page becomes a shared order book. All of you see the same list
  instead of each having your own.
- If the database is ever unreachable, the site falls back to the current
  behaviour rather than breaking the checkout.

## One tradeoff to know about

Looking up by phone number means anyone who types a customer's number sees that
customer's order list — their name, amounts and status. For this business that
is a small risk, and it keeps the customer experience simple: no password, no
OTP, nothing to forget.

If you would rather lock it down, the alternative is requiring the order code
(`WE3-7K2M`) *and* the phone number together. Safer, but a customer who loses
the code cannot look themselves up and has to WhatsApp you. Tell me which you
want — changing it is a few lines.

## Cost

Free tier: 500 MB database, 50,000 monthly active users. An order row is about
half a kilobyte, so 500 MB is roughly a million orders. You will not approach
any limit. There is no card on file and nothing to cancel.
