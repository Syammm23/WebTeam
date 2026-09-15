# Supabase setup — username login + real order history

Once this is in:

- A customer registers with a **username and password only**. No email, no OTP.
- Their orders live in the database, so they show up on **any phone**, and after
  clearing browser data.
- When you mark a payment **verified** or **rejected**, the customer actually
  sees it — no link to send, it just changes.
- All three of you share **one order book** instead of each having your own.
- The order book's password gate becomes a real login instead of a check that
  runs in the browser.

Setup is about 15 minutes and all of it is yours to do once. Then send me two
values and I write the code.

---

## Step 1 — Make the project

1. https://supabase.com → sign up (GitHub login works).
2. **New project**, name it `we3`, region **Mumbai (ap-south-1)**.
3. It asks for a database password — save it in your password manager. The
   website never uses it; it is for opening the database directly.
4. Wait ~2 minutes.

## Step 2 — Turn off email confirmation

**Authentication → Sign In / Providers → Email.**

- **Confirm email — turn OFF.** This one matters. Supabase always stores an
  email internally, so a username signs up as `name@we3users.app` behind the
  scenes. Nobody ever sees or types that address, and no mail is ever sent —
  but if confirmation is left on, every signup waits forever for an email that
  cannot arrive.
- Leave **Allow new users to sign up** ON — customers need it.

## Step 3 — Create the tables

Open **SQL Editor** in the left sidebar. Copy the whole of
[`supabase-setup.sql`](supabase-setup.sql), paste it in, press **Run**.

It is safe to run more than once, and it runs as a single transaction — if a
line fails, nothing is left half-made, so you can fix and re-run.

When it finishes it prints five rows. **Every one must say `true`.** If any says
`false`, or you get a red error instead of a result, send me what it says.

## Step 4 — Register yourselves, then give out the roles

Open the live site and **register normally** — pick your usernames like any
customer would. Then run `docs/supabase-admin.sql`, which creates the panel's
tables and the five roles.

The founder is set by that script (`adminlogbook`). Everyone else gets their
role from the panel itself: **Team → Manage access**, pick a role from the
dropdown next to their name.

| Role | What they may change |
| --- | --- |
| Founder | Everything, and decides who else gets in |
| Co-founder | Everything except changing who gets in — including deciding payments |
| Web Developer | Projects, tasks and the service catalogue |
| Editor | Enquiries, notes and the service catalogue |
| Assistant | Enquiries and notes |

Every role reads everything. What the role decides is what they may *change*,
and the database decides it, not the page: a hidden button is a courtesy, the
policy is the fence.

A second **founder** is deliberately not offered in that dropdown — a founder
can overrule every decision in the book and hand out access themselves, so it
takes a line of SQL:

```sql
update public.profiles
   set role = 'founder', is_admin = true, is_owner = true
 where username = 'their_username';
```

## Step 5 — Send me two values

**Project Settings → API.** Copy:

- **Project URL** — `https://abcdefgh.supabase.co`
- **anon / public key** (newer dashboards call it the **publishable key**) — a
  long string starting `eyJ...`

Both are meant to sit in public JavaScript. They are safe because of the rules
above: that key can register a user, sign in, check a username, and create or
read a row the signed-in user owns. Nothing else.

**Never send the `service_role` / secret key.** It is on the same page and it
ignores every rule above. If it ever leaks, rotate it immediately.

---

## One thing to decide: forgotten passwords

No email means **no "forgot password" link**. There is nowhere to send a reset
to. If a customer forgets their password, somebody has to fix it by hand.

Three ways to handle it, pick one:

1. **Phone at registration (my suggestion).** Registration asks for a phone
   number alongside the username. A customer who forgets messages you on
   WhatsApp from that number, you check it matches, and you reset the password
   from the Supabase dashboard. No extra cost, and you already ask for a phone
   number at checkout.
2. **Optional email at registration.** Anyone who fills it in gets a normal
   reset link. Anyone who skips it is back to option 1.
3. **Nothing.** Forgotten password means making a new account, and the old
   order history is stranded on it.

Tell me which and I will build it that way.

## Cost

Free tier: 500 MB database, 50,000 monthly active users. An order row is about
half a kilobyte. You will not come near any limit, there is no card on file,
and nothing to cancel.

## What I cannot check from here

My sandbox blocks `supabase.co` and the CDN the client library loads from, so I
can build and test the screens against a stand-in but I cannot run a real
signup against your project. First real registration will be yours — do it
while I am here so anything that needs fixing gets fixed straight away.
