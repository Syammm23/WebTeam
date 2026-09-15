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

## Step 6 — What keeps this safe

None of this is a paid service. It is the free parts of Supabase and GitHub
Pages, set up so that a mistake somewhere does not turn into a break-in.

### The key in the page is meant to be public

`sb_publishable_…` sits in plain JavaScript on purpose. It identifies the
project; it grants nothing. Every table has row-level security on, and the
policies are what decide the answer. Tested against a real Postgres, here is
what each kind of visitor actually gets back:

| Asking for | A stranger | A signed-in customer | An assistant |
| --- | --- | --- | --- |
| orders | nothing | their own, only | all of them |
| enquiries | nothing | nothing | all of them |
| people | nothing | their own row | their own row |
| activity | nothing | nothing | all of it |
| services | the public list | the public list | the public list |

A customer trying to write where they should not — `is_admin = true` on their
own row, a role for themselves, a price, someone else's order — is refused by
the database every time.

### An order is checked against our own prices

Everything in the cart is worked out in the browser, so the number arriving at
the database is whatever the browser chose to send. A rewritten page could
have placed a ₹4,999 order for ₹1. Now the total is recomputed in SQL from the
`services` table and an order that does not add up is refused — including one
that smuggles in a line we do not sell, or pays ₹1 of a correct total, or
prices two reels as 2 × 1,999 instead of the 3,999 ladder.

This is why **prices are set in SQL, not in the panel.** The Services page
lets the team rename a service, describe it, or switch it off; `price` and
`step` are not granted to anyone signed in. If a price changes on the site, it
has to change in this script too, or real orders will start being refused.

### Admin passwords last 14 days

`password_changed_at` is moved by a trigger on `auth.users`, and only when the
stored password hash actually changes — the browser cannot set it, so nobody
can restart their own clock without genuinely changing their password.

* 12 days in, the panel starts saying so, on every screen.
* At 14 days `is_admin()`, `is_manager()` and the rest go false. The panel
  closes and the database stops answering for that account.
* Signing in still works, and so does changing the password. That is the way
  back in, and it deliberately does not depend on the thing being withheld.

The panel also signs itself out after 30 minutes of nothing at all — a phone
left on a counter is every customer's number, to whoever picks it up next.

### The browser is told what the page may do

Both pages carry a Content-Security-Policy. Scripts may come from this site
and nowhere else, and anything that did run could reach nothing but our own
Supabase project. Verified in a real browser: a `<script>` injected into the
page does not run, a script from another origin does not load, and a `fetch`
to an outside server is refused.

The policy names this Supabase project by URL, in the `connect-src` of both
`index.html` and `orderbook-k7x2m9f4.html`. **If the project ever changes, both
of those have to change too**, or the site will silently stop being able to
reach its own database.

That is also why `supabase-js` now lives in `vendor/` instead of a CDN, pinned
to one version and checked against the hash npm publishes for it. It is the
script that holds the signed-in session; it should not be whatever a third
party served that morning. See `vendor/README.md`.

Neither page can be put in a frame: both climb out of one if they find
themselves in it.

### What this does not do

* **It does not stop somebody sending a thousand enquiries.** Length limits
  keep any one of them small and well-formed; volume would need rate limiting
  we do not have on the free tier.
* **There is no password reset by email**, because accounts have no real email
  address. A forgotten password is reset by the founder in SQL.
* **`username_available()` tells a stranger whether a username exists.** The
  registration form needs it. It gives away nothing else.
