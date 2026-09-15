/* ==========================================================================
   WE3 Order Book

   The team's view of every order. Orders arrive here on their own, because
   the site writes them to the same database — nobody retypes anything.

   Marking one verified or rejected now actually reaches the customer: they
   read their own row, so their My Orders changes the moment this does.

   Who gets in is decided by the database, not by this file. Every read and
   write goes through row-level security, and the admin policies check
   is_admin on the signed-in user's profile. A browser cannot talk its way
   past that, so this page can be honest about what it is: a view.
   ========================================================================== */
(function () {
  'use strict';

  const CONFIG = {
    supabase: {
      url: "https://bakvwxkkvzklgnkeqpfi.supabase.co",
      anonKey: "sb_publishable_j8QUhuHa8IfYlmLc8OxI2w_6BElktA7",
      userDomain: "we3users.app"
    }
  };

  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const money = n => '₹' + Number(n || 0).toLocaleString('en-IN');

  function fmtDate(value) {
    try {
      return new Date(value).toLocaleDateString('en-IN',
        { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return ''; }
  }

  let client = null;
  let orders = [];
  let filter = 'all';
  let query = '';
  let me = null;          // { id, username, is_owner }
  let history = {};       // order ref -> [ change, ... ]
  let people = [];
  let roleLog = [];

  /* ---- connection ------------------------------------------------------ */
  function connect() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return false;
    try {
      client = window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
      return true;
    } catch (e) { return false; }
  }

  const authEmail = u => String(u).trim().toLowerCase() + '@' + CONFIG.supabase.userDomain;

  /* ---- the gate -------------------------------------------------------- */
  function lockErr(text) {
    const el = $('#lockErr');
    el.hidden = !text;
    el.textContent = text || '';
  }

  function showLocked() {
    document.body.classList.add('is-locked');
    $('#lock').hidden = false;
  }

  /**
   * What the team calls each other, rather than what the column is called.
   * is_owner stays the flag the database checks; this is only the label.
   */
  function roleLabel(p) {
    if (p.is_owner) return 'Founder';
    if (p.is_admin) return 'Co-founder';
    return '';
  }

  function showUnlocked() {
    document.body.classList.remove('is-locked');
    $('#lock').hidden = true;
    $('#whoami').textContent = '@' + me.username + ' · ' + roleLabel(me);
  }

  function fmtWhen(value) {
    try {
      return new Date(value).toLocaleString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
    } catch (e) { return ''; }
  }

  /**
   * Confirms the signed-in account is an admin before showing anything.
   *
   * The check is a read the database answers, not a flag this page decides:
   * a non-admin's own profile row comes back with is_admin false, and the
   * order list they would see is empty anyway because the policies say so.
   */
  function afterSignIn(user) {
    return client.from('profiles').select('username, is_admin, is_owner').eq('id', user.id).limit(1)
      .then(function (res) {
        if (res.error) { lockErr('Could not check your account. (' + res.error.message + ')'); return false; }
        const row = (res.data || [])[0];
        if (!row) { lockErr('That account has no profile. Ask for it to be set up.'); return false; }
        if (!row.is_admin) {
          lockErr('That account is not an admin. Ask someone to switch it on for you.');
          return client.auth.signOut().then(function () { return false; });
        }
        me = {
          id: user.id,
          username: row.username,
          is_admin: true,
          is_owner: Boolean(row.is_owner)
        };
        showUnlocked();
        load();
        return true;
      });
  }

  $('#lockForm').addEventListener('submit', function (e) {
    e.preventDefault();
    lockErr('');

    const username = $('#lockUser').value.trim().toLowerCase();
    const password = $('#lockPw').value;
    if (!username || !password) { lockErr('Enter your username and password.'); return; }

    const btn = $('#lockBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Checking…';

    const done = function () {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-unlock" aria-hidden="true"></i> Sign in';
    };

    client.auth.signInWithPassword({ email: authEmail(username), password: password })
      .then(function (res) {
        if (res.error) {
          done();
          const m = String(res.error.message || '').toLowerCase();
          lockErr(m.indexOf('invalid login') > -1
            ? 'Wrong username or password.'
            : 'Could not sign in. (' + res.error.message + ')');
          return;
        }
        return afterSignIn(res.data.user).then(done);
      }, function () {
        done();
        lockErr('Could not reach the server. Check your connection.');
      });
  });

  $('#lockEye').addEventListener('click', function () {
    const el = $('#lockPw');
    const show = el.type === 'password';
    el.type = show ? 'text' : 'password';
    this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    this.innerHTML = '<i class="fa-solid fa-eye' + (show ? '-slash' : '') + '" aria-hidden="true"></i>';
    el.focus();
  });

  /* ---- my account -------------------------------------------------------
     Small on purpose: an admin needs to change their own password and fix
     their own phone number, and nothing else belongs to them here. */
  const meModal = $('#meModal');

  function meNote(el, text, cls) {
    el.hidden = !text;
    el.textContent = text || '';
    el.className = 'me__msg ' + (cls || '');
  }

  function openMe() {
    const mine = people.find(function (p) { return p.username === me.username; }) || {};
    $('#meUser').textContent = '@' + me.username;
    $('#meRole').textContent = roleLabel(me);
    $('#meRole').className = 'person__tag' + (me.is_owner ? ' person__tag--owner' : '');
    $('#meSince').textContent = mine.joined ? 'With WE3 since ' + fmtDate(mine.joined) : '';
    $('#meLast').textContent = mine.last_login ? 'Last signed in ' + fmtWhen(mine.last_login) : '';
    $('#meName').value = mine.full_name || '';
    $('#mePhone').value = mine.phone || '';
    meNote($('#meMsg'), '');
    meNote($('#mePassMsg'), '');
    $('#mePass').value = '';
    meModal.hidden = false;
    $('.modal__dialog', meModal).focus({ preventScroll: true });
  }

  function closeMe() { meModal.hidden = true; }

  $('#meBtn').addEventListener('click', openMe);
  $$('[data-close-me]', meModal).forEach(function (el) {
    el.addEventListener('click', closeMe);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !meModal.hidden) closeMe();
  });

  $('#meSave').addEventListener('click', function () {
    const msg = $('#meMsg');
    const phone = $('#mePhone').value.trim();
    if (phone && phone.replace(/\D/g, '').length < 10) {
      meNote(msg, 'That phone number does not look right.', 'is-bad');
      return;
    }
    const btn = this;
    btn.disabled = true;
    meNote(msg, 'Saving…', '');
    client.from('profiles').update({
      full_name: $('#meName').value.trim() || null,
      phone: phone || null
    }).eq('id', me.id).then(function (res) {
      btn.disabled = false;
      if (res.error) { meNote(msg, 'Could not save. (' + res.error.message + ')', 'is-bad'); return; }
      meNote(msg, 'Saved.', 'is-good');
      loadPeople();
    }, function () {
      btn.disabled = false;
      meNote(msg, 'Could not reach the server.', 'is-bad');
    });
  });

  $('#meEye').addEventListener('click', function () {
    const el = $('#mePass');
    const show = el.type === 'password';
    el.type = show ? 'text' : 'password';
    this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    this.innerHTML = '<i class="fa-solid fa-eye' + (show ? '-slash' : '') + '" aria-hidden="true"></i>';
    el.focus();
  });

  $('#mePassBtn').addEventListener('click', function () {
    const msg = $('#mePassMsg');
    const el = $('#mePass');
    if (el.value.length < 8) {
      meNote(msg, 'Use a password of at least 8 characters.', 'is-bad');
      el.focus();
      return;
    }
    const btn = this;
    btn.disabled = true;
    meNote(msg, 'Changing…', '');
    client.auth.updateUser({ password: el.value }).then(function (res) {
      btn.disabled = false;
      if (res.error) { meNote(msg, 'Could not change it. (' + res.error.message + ')', 'is-bad'); return; }
      el.value = '';
      meNote(msg, 'Password changed. Use the new one next time you sign in.', 'is-good');
    }, function () {
      btn.disabled = false;
      meNote(msg, 'Could not reach the server.', 'is-bad');
    });
  });

  $('#signOutBtn').addEventListener('click', function () {
    client.auth.signOut().then(function () { location.reload(); },
                              function () { location.reload(); });
  });

  /* ---- loading --------------------------------------------------------- */
  function setStatusLine(text, bad) {
    const el = $('#loadState');
    el.hidden = !text;
    el.textContent = text || '';
    el.className = 'adm__state' + (bad ? ' is-bad' : '');
  }

  function load() {
    setStatusLine('Loading…');

    client.from('orders').select('*').order('created_at', { ascending: false }).limit(500)
      .then(function (res) {
        if (res.error) {
          setStatusLine('Could not load orders. (' + res.error.message + ')', true);
          return;
        }
        orders = res.data || [];
        setStatusLine('');
        render();
      }, function () {
        setStatusLine('Could not reach the server.', true);
      });

    loadHistory();
    loadPeople();
  }

  function loadHistory() {
    client.from('order_events').select('*').order('at', { ascending: false }).limit(1000)
      .then(function (res) {
        if (res.error) return;          // the list is still usable without it
        history = {};
        (res.data || []).forEach(function (e) {
          (history[e.order_ref] = history[e.order_ref] || []).push(e);
        });
        render();
        renderActivity();
      }, function () { /* ignore */ });
  }

  function loadRoleLog() {
    client.from('role_events').select('*').order('at', { ascending: false }).limit(50)
      .then(function (res) {
        if (res.error) return;          // People is still usable without it
        roleLog = res.data || [];
        renderActivity();
      }, function () { /* ignore */ });
  }

  function loadPeople() {
    client.rpc('admin_people').then(function (res) {
      if (res.error) {
        $('#peopleState').hidden = false;
        $('#peopleState').textContent = 'Could not load people. (' + res.error.message + ')';
        return;
      }
      $('#peopleState').hidden = true;
      people = res.data || [];
      renderPeople();
      renderActivity();
      loadRoleLog();
    }, function () { /* ignore */ });
  }

  /* ---- summary --------------------------------------------------------- */
  function renderStats() {
    const pending  = orders.filter(o => o.status === 'pending');
    const verified = orders.filter(o => o.status === 'verified');

    // Only verified money is counted as received — a pending claim is not
    // cash in the account.
    const received = verified.reduce((s, o) => s + Number(o.paid || 0), 0);
    const due = verified.reduce(
      (s, o) => s + Math.max(0, Number(o.total || 0) - Number(o.paid || 0)), 0);

    $('#statTotal').textContent    = orders.length;
    $('#statPending').textContent  = pending.length;
    $('#statVerified').textContent = verified.length;
    $('#statMoney').textContent    = money(received);
    $('#statDue').textContent      = money(due);
  }

  /* ---- list ------------------------------------------------------------ */
  function visible() {
    const q = query.trim().toLowerCase();
    return orders.filter(function (o) {
      if (filter !== 'all' && o.status !== filter) return false;
      if (!q) return true;
      return [o.customer_name, o.business, o.phone, o.ref, o.email, o.note]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }

  function itemsText(items) {
    if (!Array.isArray(items)) return '—';
    return items.map(function (i) {
      const line = i.step ? i.price + (i.qty - 1) * i.step : i.price * i.qty;
      return i.name + ' x' + i.qty + ' — ' + money(line);
    }).join(', ');
  }

  /** Writes one field and repaints, or says why it could not. */
  function patchOrder(order, patch) {
    const before = {};
    Object.keys(patch).forEach(function (k) { before[k] = order[k]; });
    Object.assign(order, patch);           // optimistic, so the tap feels instant
    render();

    return client.from('orders')
      .update(Object.assign({ updated_at: new Date().toISOString() }, patch))
      .eq('ref', order.ref)
      .then(function (res) {
        if (res.error) {
          Object.assign(order, before);    // put it back; it did not happen
          render();
          setStatusLine(res.error.message, true);
          return false;
        }
        setStatusLine('');
        loadHistory();                     // the trigger just wrote a row
        return true;
      }, function () {
        Object.assign(order, before);
        render();
        setStatusLine('Could not reach the server — that change was not saved.', true);
        return false;
      });
  }

  function statusButton(order, status, label, icon) {
    const b = document.createElement('button');
    b.type = 'button';
    const on = order.status === status;
    b.className = 'mark mark--' + status + (on ? ' is-on' : '');
    b.innerHTML = '<i class="fa-solid ' + icon + '" aria-hidden="true"></i> ' + label;
    b.addEventListener('click', function () {
      if (order.status === status) return;
      if (!confirmStatus(order, status)) return;
      patchOrder(order, { status: status });
    });
    return b;
  }

  /**
   * Asks before moving money.
   *
   * The amount and the customer are in the question because "are you sure?"
   * on its own is answered yes by reflex. For anyone but the founder this is
   * also the last chance to change it, so the message says so.
   */
  function confirmStatus(order, status) {
    const balance = Math.max(0, Number(order.total || 0) - Number(order.paid || 0));
    const lines = [
      status === 'verified' ? 'Mark this payment as RECEIVED?'
        : status === 'rejected' ? 'Mark this payment as NOT received?'
        : 'Put this order back to pending?',
      '',
      order.ref + ' — ' + (order.business || order.customer_name),
      (order.customer_name || '') + ' · ' + (order.phone || ''),
      'Paid ' + money(order.paid) + ' of ' + money(order.total) +
        (balance > 0 ? '  (balance ' + money(balance) + ')' : ''),
      ''
    ];

    // It can be changed again afterwards, so the warning is not about
    // permanence — it is that the customer sees it immediately and that the
    // change is recorded against whoever made it.
    lines.push('The customer sees this straight away, and this is saved ' +
               'against your name.');

    return confirm(lines.join('\n'));
  }

  /** One line of an order's history: who moved it where, and when. */
  function eventLine(e) {
    const li = document.createElement('li');
    const when = document.createElement('span');
    when.className = 'hist__when';
    when.textContent = fmtWhen(e.at);

    const what = document.createElement('span');
    if (e.from_status !== e.to_status) {
      what.innerHTML = '<strong></strong> marked it <em></em>';
      what.querySelector('strong').textContent = '@' + (e.actor || 'someone');
      what.querySelector('em').textContent = e.to_status;
      what.querySelector('em').className = 'hist__to hist__to--' + e.to_status;
    } else {
      what.innerHTML = '<strong></strong> changed the note';
      what.querySelector('strong').textContent = '@' + (e.actor || 'someone');
    }

    li.appendChild(what);
    li.appendChild(when);
    return li;
  }

  function render() {
    renderStats();

    const list = $('#orderList');
    const rows = visible();
    list.innerHTML = '';
    $('#listEmpty').hidden = rows.length > 0;
    $('#listEmpty').textContent = orders.length
      ? 'No orders match this filter.'
      : 'No orders yet. They appear here the moment a customer places one.';

    rows.forEach(function (order) {
      const li = document.createElement('li');
      li.className = 'adm-order adm-order--' + (order.status || 'pending');

      const head = document.createElement('div');
      head.className = 'adm-order__head';
      const who = document.createElement('span');
      who.className = 'adm-order__who';
      who.textContent = order.business || order.customer_name;
      const ref = document.createElement('span');
      ref.className = 'adm-order__ref';
      ref.textContent = (order.ref || '—') + ' · ' + fmtDate(order.created_at);
      head.appendChild(who);
      head.appendChild(ref);

      const meta = document.createElement('div');
      meta.className = 'adm-order__meta';
      [
        ['Contact', order.customer_name],
        ['Phone', order.phone],
        ['Ordered', itemsText(order.items)],
        ['Total', money(order.total)],
        ['Paid', money(order.paid) + (order.pay_mode === 'half' ? ' (50%)' : ' (full)')],
        ['Balance', money(Math.max(0, Number(order.total || 0) - Number(order.paid || 0)))]
      ].forEach(function (pair) {
        const span = document.createElement('span');
        span.innerHTML = pair[0] + ' <strong></strong>';
        span.querySelector('strong').textContent = pair[1];
        meta.appendChild(span);
      });

      li.appendChild(head);
      li.appendChild(meta);

      if (order.brief) {
        const brief = document.createElement('p');
        brief.className = 'adm-order__brief';
        brief.innerHTML = '<strong>What they need:</strong> ';
        brief.appendChild(document.createTextNode(order.brief));
        li.appendChild(brief);
      }

      // The note is shown to the customer on their own order, so it is worth
      // writing as a message to them rather than a memo to ourselves.
      const noteRow = document.createElement('div');
      noteRow.className = 'adm-order__noterow';
      const note = document.createElement('input');
      note.className = 'input';
      note.type = 'text';
      note.value = order.note || '';
      note.placeholder = 'Message shown to the customer (optional)';
      note.setAttribute('aria-label', 'Note for ' + order.ref);
      const saveNote = document.createElement('button');
      saveNote.type = 'button';
      saveNote.className = 'adm-order__notesave';
      saveNote.textContent = 'Save note';
      saveNote.addEventListener('click', function () {
        const value = note.value.trim();
        if (value === (order.note || '')) return;
        saveNote.disabled = true;
        patchOrder(order, { note: value || null }).then(function () {
          saveNote.disabled = false;
        });
      });
      noteRow.appendChild(note);
      noteRow.appendChild(saveNote);
      li.appendChild(noteRow);

      const events = history[order.ref] || [];
      if (events.length) {
        const hist = document.createElement('ul');
        hist.className = 'hist';
        events.forEach(function (e) { hist.appendChild(eventLine(e)); });
        li.appendChild(hist);
      }

      const foot = document.createElement('div');
      foot.className = 'adm-order__foot';
      foot.appendChild(statusButton(order, 'pending', 'Pending', 'fa-hourglass-half'));
      foot.appendChild(statusButton(order, 'verified', 'Verified', 'fa-check'));
      foot.appendChild(statusButton(order, 'rejected', 'Rejected', 'fa-xmark'));

      const spacer = document.createElement('span');
      spacer.className = 'spacer';
      foot.appendChild(spacer);

      const wa = document.createElement('button');
      wa.type = 'button';
      wa.className = 'adm-order__wa';
      wa.innerHTML = '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Message';
      wa.addEventListener('click', function () { messageCustomer(order); });
      foot.appendChild(wa);

      li.appendChild(foot);
      list.appendChild(li);
    });
  }

  /* ---- People -----------------------------------------------------------
     Filtered, searchable, and with the access buttons hidden behind a
     deliberate switch. Showing "Make co-founder" against every name all the
     time makes granting admin a one-tap slip. */
  let peopleFilter = 'all';
  let peopleQuery = '';
  let manageAccess = false;

  function visiblePeople() {
    const q = peopleQuery.trim().toLowerCase();
    return people.filter(function (p) {
      if (peopleFilter === 'team' && !p.is_admin) return false;
      if (peopleFilter === 'customers' && p.is_admin) return false;
      if (!q) return true;
      return [p.username, p.full_name, p.business, p.phone]
        .some(function (v) { return String(v || '').toLowerCase().includes(q); });
    });
  }

  function renderPeople() {
    // The switch only exists for the founder; the database refuses everyone
    // else anyway, so this is about keeping the page calm, not about access.
    const toggle = $('#manageBtn');
    toggle.hidden = !me.is_owner;
    toggle.classList.toggle('is-on', manageAccess);
    toggle.innerHTML = '<i class="fa-solid ' + (manageAccess ? 'fa-lock-open' : 'fa-lock') +
      '" aria-hidden="true"></i> ' + (manageAccess ? 'Done managing' : 'Manage access');

    const rows = visiblePeople();
    const list = $('#peopleList');
    list.innerHTML = '';
    $('#peopleEmpty').hidden = rows.length > 0;
    $('#peopleEmpty').textContent = people.length
      ? 'Nobody matches that.'
      : 'Nobody has signed up yet.';

    rows.forEach(function (p) {
      const li = document.createElement('li');
      li.className = 'person' + (p.is_admin ? ' person--admin' : '');

      const head = document.createElement('div');
      head.className = 'person__head';

      const name = document.createElement('span');
      name.className = 'person__name';
      name.textContent = '@' + p.username;
      head.appendChild(name);

      const role = roleLabel(p);
      if (role) {
        const tag = document.createElement('span');
        tag.className = 'person__tag' + (p.is_owner ? ' person__tag--owner' : '');
        tag.textContent = role;
        head.appendChild(tag);
      }

      const last = document.createElement('span');
      last.className = 'person__last';
      last.textContent = p.last_login ? 'Last seen ' + fmtWhen(p.last_login) : 'Never signed in';
      head.appendChild(last);

      if (manageAccess && me.is_owner && !p.is_owner && p.username !== me.username) {
        const grant = document.createElement('button');
        grant.type = 'button';
        grant.className = 'person__grant' + (p.is_admin ? ' person__grant--off' : '');
        grant.innerHTML = '<i class="fa-solid ' +
          (p.is_admin ? 'fa-user-minus' : 'fa-user-plus') + '" aria-hidden="true"></i> ' +
          (p.is_admin ? 'Remove admin' : 'Make co-founder');
        grant.addEventListener('click', function () {
          if (!confirmAccess(p, !p.is_admin)) return;
          grant.disabled = true;
          setTeamAdmin(p.username, !p.is_admin, grant);
        });
        head.appendChild(grant);
      }

      li.appendChild(head);

      const meta = document.createElement('div');
      meta.className = 'person__meta';
      [
        ['Name', p.full_name || '—'],
        ['Business', p.business || '—'],
        ['Phone', p.phone || '—'],
        ['Joined', fmtDate(p.joined)],
        ['Orders', String(p.orders)],
        ['Paid (verified)', money(p.paid)]
      ].forEach(function (pair) {
        const span = document.createElement('span');
        span.innerHTML = pair[0] + ' <strong></strong>';
        span.querySelector('strong').textContent = pair[1];
        meta.appendChild(span);
      });
      li.appendChild(meta);

      const mine = orders.filter(function (o) { return p.phone && o.phone === p.phone; });
      if (mine.length) {
        const ul = document.createElement('ul');
        ul.className = 'person__orders';
        mine.forEach(function (o) {
          const row = document.createElement('li');
          const chip = document.createElement('span');
          chip.className = 'order__status order__status--' + (o.status || 'pending');
          chip.textContent = o.status || 'pending';
          row.appendChild(chip);
          row.appendChild(document.createTextNode(
            ' ' + o.ref + ' · ' + fmtDate(o.created_at) + ' · ' +
            money(o.paid) + ' of ' + money(o.total)));
          ul.appendChild(row);
        });
        li.appendChild(ul);
      }

      list.appendChild(li);
    });
  }

  /** Granting admin is not a thing to do by accident. */
  function confirmAccess(p, makeAdmin) {
    const who = '@' + p.username + (p.full_name ? ' (' + p.full_name + ')' : '');
    return confirm(makeAdmin
      ? 'Make ' + who + ' a co-founder?\n\n' +
        'They will see every order and every customer, and be able to mark ' +
        'payments received or not received.'
      : 'Remove admin from ' + who + '?\n\n' +
        'They lose access to the Order Book straight away.');
  }

  /* ---- Activity ---------------------------------------------------------
     Who signed in, and who changed what, kept apart. Mixed together they
     answer neither question quickly. */
  let activityTab = 'logins';

  function renderActivity() {
    const list = $('#activityList');
    const empty = $('#activityEmpty');
    list.innerHTML = '';

    let rows = [];

    if (activityTab === 'logins') {
      rows = people.slice()
        .filter(function (p) { return p.last_login; })
        .sort(function (a, b) { return Date.parse(b.last_login) - Date.parse(a.last_login); })
        .map(function (p) {
          return {
            when: p.last_login,
            html: '<strong></strong> signed in',
            fill: function (el) {
              el.querySelector('strong').textContent = '@' + p.username;
              if (roleLabel(p)) {
                const tag = document.createElement('span');
                tag.className = 'person__tag' + (p.is_owner ? ' person__tag--owner' : '');
                tag.textContent = roleLabel(p);
                el.appendChild(document.createTextNode(' '));
                el.appendChild(tag);
              }
            }
          };
        });
      empty.textContent = 'Nobody has signed in yet.';

    } else if (activityTab === 'orders') {
      Object.keys(history).forEach(function (ref) {
        history[ref].forEach(function (e) { rows.push(e); });
      });
      rows.sort(function (a, b) { return Date.parse(b.at) - Date.parse(a.at); });
      rows = rows.map(function (e) {
        return {
          when: e.at,
          html: e.from_status !== e.to_status
            ? '<strong></strong> marked <code></code> <em></em>'
            : '<strong></strong> changed the note on <code></code>',
          fill: function (el) {
            el.querySelector('strong').textContent = '@' + (e.actor || 'someone');
            el.querySelector('code').textContent = e.order_ref;
            const to = el.querySelector('em');
            if (to) {
              to.textContent = e.to_status;
              to.className = 'hist__to hist__to--' + e.to_status;
            }
          }
        };
      });
      empty.textContent = 'No order has been changed yet.';

    } else {
      rows = roleLog.map(function (e) {
        return {
          when: e.at,
          html: '<strong></strong> made <strong></strong> <em></em>',
          fill: function (el) {
            const names = el.querySelectorAll('strong');
            names[0].textContent = '@' + (e.actor || 'someone');
            names[1].textContent = '@' + e.target;
            el.querySelector('em').textContent =
              e.made_admin ? 'a co-founder' : 'no longer an admin';
          }
        };
      });
      empty.textContent = 'Nobody\u2019s access has changed yet.';
    }

    empty.hidden = rows.length > 0;

    rows.forEach(function (r) {
      const li = document.createElement('li');
      const what = document.createElement('span');
      what.innerHTML = r.html;
      r.fill(what);
      const when = document.createElement('span');
      when.className = 'hist__when';
      when.textContent = fmtWhen(r.when);
      li.appendChild(what);
      li.appendChild(when);
      list.appendChild(li);
    });
  }

  function setTeamAdmin(username, makeAdmin, btn) {
    client.rpc('set_team_admin', { p_username: username, p_admin: makeAdmin })
      .then(function (res) {
        if (btn) btn.disabled = false;
        if (res.error) {
          $('#peopleState').hidden = false;
          $('#peopleState').className = 'adm__state is-bad';
          $('#peopleState').textContent = res.error.message;
          return;
        }
        $('#peopleState').hidden = true;
        loadPeople();
      }, function () {
        if (btn) btn.disabled = false;
        $('#peopleState').hidden = false;
        $('#peopleState').className = 'adm__state is-bad';
        $('#peopleState').textContent = 'Could not reach the server.';
      });
  }

  /** Opens WhatsApp with a message that matches the order's current status. */
  function messageCustomer(order) {
    const digits = String(order.phone || '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) {
      alert('That phone number does not look like a 10-digit mobile.');
      return;
    }

    const balance = Math.max(0, Number(order.total || 0) - Number(order.paid || 0));
    const name = order.customer_name || '';
    let msg;

    if (order.status === 'verified') {
      msg = 'Hi ' + name + ', your payment of ' + money(order.paid) +
            ' for order ' + order.ref + ' is confirmed. We are starting work now.' +
            (balance > 0 ? ' Balance of ' + money(balance) + ' is due on delivery.' : '');
    } else if (order.status === 'rejected') {
      msg = 'Hi ' + name + ', we could not find your payment of ' + money(order.paid) +
            ' for order ' + order.ref + ' yet. Could you send the payment screenshot again?';
    } else {
      msg = 'Hi ' + name + ', we have your order ' + order.ref +
            ' and are checking the payment of ' + money(order.paid) + '. We will confirm shortly.';
    }

    if (order.note) msg += '\n\n' + order.note;

    // No status link any more: the customer reads their own row, so their
    // My Orders already shows whatever was set here.
    msg += '\n\nYou can see it under My Orders on our site.';

    window.open('https://wa.me/91' + digits + '?text=' + encodeURIComponent(msg),
                '_blank', 'noopener,noreferrer');
  }

  /* ---- filters + search ------------------------------------------------ */

  /** Chips in one group behave as one choice. */
  function chipGroup(selector, onPick) {
    const chips = $$(selector);
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        chips.forEach(function (c) {
          const on = c === chip;
          c.classList.toggle('is-active', on);
          c.setAttribute('aria-selected', String(on));
        });
        onPick(chip.dataset.value);
      });
    });
  }

  chipGroup('#orderChips .chip', function (v) { filter = v; render(); });
  chipGroup('#peopleChips .chip', function (v) { peopleFilter = v; renderPeople(); });
  chipGroup('#activityChips .chip', function (v) { activityTab = v; renderActivity(); });

  $('#search').addEventListener('input', function () {
    query = this.value;
    render();
  });

  $('#peopleSearch').addEventListener('input', function () {
    peopleQuery = this.value;
    renderPeople();
  });

  $('#manageBtn').addEventListener('click', function () {
    manageAccess = !manageAccess;
    renderPeople();
  });

  /* ---- start ----------------------------------------------------------- */
  if (!connect()) {
    showLocked();
    lockErr('Could not load the database library. Check your connection and reload.');
    $('#lockUser').disabled = true;
    $('#lockPw').disabled = true;
    $('#lockBtn').disabled = true;
    return;
  }

  showLocked();
  client.auth.getSession().then(function (res) {
    const session = res && res.data && res.data.session;
    if (session) afterSignIn(session.user);
  }, function () { /* stay locked */ });
}());
