/* ==========================================================================
   WE3 Admin Panel

   One page, one Supabase client, one sign-in. Everything below the lock
   screen is the dashboard: enquiries, clients, orders, projects, services,
   activity, team, analytics and settings.

   Two rules this file keeps to.

   The sign-in is not ours to redesign. The lock screen, the session, the
   is_admin check and the sign-out are exactly as they were; the dashboard
   simply starts after afterSignIn() succeeds.

   And nothing here decides who may see what. Every read and write goes
   through row-level security, and the admin policies check is_admin on the
   signed-in user's profile. This page is a view over data the database has
   already agreed to hand over.
   ========================================================================== */
(function () {
  'use strict';

  const CONFIG = {
    supabase: {
      url: "https://bakvwxkkvzklgnkeqpfi.supabase.co",
      anonKey: "sb_publishable_j8QUhuHa8IfYlmLc8OxI2w_6BElktA7",
      userDomain: "we3users.app"
    },
    business: {
      name: 'WE3',
      email: 'hello.we3agency@gmail.com',
      whatsapp: '917990853947'
    }
  };

  /* ------------------------------------------------------------------------
     1. SMALL HELPERS
     ------------------------------------------------------------------------ */
  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const money = n => '₹' + Number(n || 0).toLocaleString('en-IN');

  /** Everything rendered from the database goes through this. */
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(value) {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleDateString('en-IN',
        { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return '—'; }
  }

  function fmtWhen(value) {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
    } catch (e) { return '—'; }
  }

  /** "2 minutes ago" — the only sensible unit for a live feed. */
  function ago(value) {
    if (!value) return '';
    const secs = Math.max(0, (Date.now() - Date.parse(value)) / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return mins + (mins === 1 ? ' min ago' : ' mins ago');
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    const days = Math.floor(hrs / 24);
    if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
    return fmtDate(value);
  }

  const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const daysAgo = n => { const x = startOfDay(new Date()); x.setDate(x.getDate() - n); return x; };

  /** Growth against the previous window of the same length. */
  function delta(now, before) {
    if (!before) return now ? { text: 'new', cls: 'is-flat' } : { text: '—', cls: 'is-flat' };
    const pct = Math.round(((now - before) / before) * 100);
    if (pct === 0) return { text: 'no change', cls: 'is-flat' };
    return { text: (pct > 0 ? '↑ ' : '↓ ') + Math.abs(pct) + '%', cls: pct > 0 ? '' : 'is-down' };
  }

  /* ------------------------------------------------------------------------
     2. CONNECTION  (unchanged)
     ------------------------------------------------------------------------ */
  let client = null;
  let me = null;          // { id, username, is_admin, is_owner }

  function connect() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return false;
    try {
      client = window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
      return true;
    } catch (e) { return false; }
  }

  const authEmail = u => String(u).trim().toLowerCase() + '@' + CONFIG.supabase.userDomain;

  /* ------------------------------------------------------------------------
     3. THE GATE  (unchanged — do not redesign)
     ------------------------------------------------------------------------ */
  function lockErr(text) {
    const el = $('#lockErr');
    el.hidden = !text;
    el.textContent = text || '';
  }

  function showLocked() {
    document.body.classList.add('is-locked');
    $('#lock').hidden = false;
  }

  function roleLabel(p) {
    if (p.is_owner) return 'Founder';
    if (p.is_admin) return 'Co-founder';
    return '';
  }

  function showUnlocked() {
    document.body.classList.remove('is-locked');
    $('#lock').hidden = true;
    $('#whoami').textContent = '@' + me.username;
    $('#whoAvatar').textContent = (me.username[0] || '?').toUpperCase();
  }

  /**
   * Confirms the signed-in account is an admin before showing anything.
   * A non-admin is told so and signed straight back out.
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
        startApp();
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

  $('#signOutBtn').addEventListener('click', function () {
    client.auth.signOut().then(function () { location.reload(); },
                              function () { location.reload(); });
  });

  /* ------------------------------------------------------------------------
     4. REUSABLE PIECES
     ------------------------------------------------------------------------ */

  /** Toast. Success is green; anything else says so without shouting. */
  function toast(message, kind) {
    const el = document.createElement('div');
    el.className = 'toast toast--' + (kind || 'ok');
    el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
    el.innerHTML = '<i class="fa-solid ' +
      (kind === 'bad' ? 'fa-circle-exclamation' : kind === 'info' ? 'fa-circle-info' : 'fa-circle-check') +
      '" aria-hidden="true"></i><span></span>';
    el.querySelector('span').textContent = message;
    $('#toasts').appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 200);
    }, 3600);
  }

  /** Destructive actions ask, with what is about to be lost named. */
  function confirmDanger(title, detail) {
    return confirm(title + '\n\n' + detail + '\n\nThis cannot be undone.');
  }

  const STATUS_TONE = {
    'New': 'blue', 'Contacted': 'amber', 'Quoted': 'amber',
    'In Progress': 'amber', 'Completed': 'green', 'Cancelled': 'red',
    'pending': 'amber', 'verified': 'green', 'rejected': 'red',
    'Not Started': '', 'Planning': 'blue', 'Design': 'blue',
    'Development': 'amber', 'Revision': 'amber', 'Ready': 'green',
    'On Hold': 'red',
    'Lead': 'blue', 'Active': 'green', 'Inactive': '',
    'Paid': 'green', 'Partial': 'amber', 'Pending': 'amber', 'Overdue': 'red',
    'To Do': '', 'Doing': 'amber', 'Done': 'green',
    'Low': '', 'Medium': 'blue', 'High': 'amber', 'Urgent': 'red'
  };

  function badge(value) {
    const tone = STATUS_TONE[value];
    return '<span class="tag' + (tone ? ' tag--' + tone : '') + '">' + esc(value || '—') + '</span>';
  }

  function emptyState(title, line, action) {
    return '<div class="empty">' +
      '<span class="empty__ico"><i class="fa-solid fa-inbox" aria-hidden="true"></i></span>' +
      '<h3>' + esc(title) + '</h3><p>' + esc(line) + '</p>' +
      (action || '') + '</div>';
  }

  function skeleton(rows) {
    let out = '<div class="skel">';
    for (let i = 0; i < (rows || 5); i++) out += '<div class="skel__row"></div>';
    return out + '</div>';
  }

  function errorState(what) {
    return '<div class="errstate">' +
      '<h3>Something went wrong</h3>' +
      '<p>Unable to load ' + esc(what) + '. Please try again.</p>' +
      '<button class="btn--ghost" data-retry><i class="fa-solid fa-rotate" aria-hidden="true"></i> Retry</button>' +
      '</div>';
  }

  /** CSV of exactly what is on screen, filters included. */
  function exportCsv(filename, columns, rows) {
    if (!rows.length) { toast('Nothing to export with these filters.', 'info'); return; }
    const cell = v => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [columns.map(c => cell(c.label)).join(',')];
    rows.forEach(function (r) {
      lines.push(columns.map(c => cell(c.get(r))).join(','));
    });
    // ﻿ so Excel opens the rupee sign and Devanagari correctly.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Exported ' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + '.');
  }

  /** Pager markup + the arithmetic behind it, in one place. */
  function paginate(rows, page, size) {
    const pages = Math.max(1, Math.ceil(rows.length / size));
    const safe = Math.min(Math.max(1, page), pages);
    const from = (safe - 1) * size;
    return { pages: pages, page: safe, slice: rows.slice(from, from + size), from: from, total: rows.length };
  }

  function pagerHtml(p, size) {
    if (!p.total) return '';
    let nums = '';
    // At most seven page buttons, always including the current one.
    let start = Math.max(1, p.page - 3);
    let end = Math.min(p.pages, start + 6);
    start = Math.max(1, end - 6);
    for (let i = start; i <= end; i++) {
      nums += '<button data-page="' + i + '"' + (i === p.page ? ' class="is-on" aria-current="page"' : '') + '>' + i + '</button>';
    }
    return '<div class="pager">' +
      '<span>Showing ' + (p.from + 1) + '–' + Math.min(p.from + size, p.total) + ' of ' + p.total + '</span>' +
      '<div class="pager__pages">' +
        '<button data-page="' + (p.page - 1) + '"' + (p.page === 1 ? ' disabled' : '') + ' aria-label="Previous page">←</button>' +
        nums +
        '<button data-page="' + (p.page + 1) + '"' + (p.page === p.pages ? ' disabled' : '') + ' aria-label="Next page">→</button>' +
      '</div>' +
      '<label class="pager__size">Per page ' +
        '<select class="inp" data-size style="width:auto;display:inline-block;padding:4px 26px 4px 8px">' +
          [20, 50, 100].map(n => '<option value="' + n + '"' + (n === size ? ' selected' : '') + '>' + n + '</option>').join('') +
        '</select></label>' +
      '</div>';
  }

  /* ---- the drawer ---- */
  const drawer = $('#drawer');
  let drawerReturn = null;

  function openDrawer(title, html, wire) {
    drawerReturn = document.activeElement;
    $('#drawerTitle').textContent = title;
    $('#drawerBody').innerHTML = html;
    drawer.hidden = false;
    document.body.style.overflow = 'hidden';
    if (typeof wire === 'function') wire($('#drawerBody'));
    $('.drawer__panel', drawer).focus({ preventScroll: true });
  }

  function closeDrawer() {
    drawer.hidden = true;
    document.body.style.overflow = '';
    if (drawerReturn && drawerReturn.focus) drawerReturn.focus({ preventScroll: true });
  }

  $$('[data-close-drawer]').forEach(el => el.addEventListener('click', closeDrawer));

  // Escape closes whatever is on top; Tab stays inside it.
  document.addEventListener('keydown', function (e) {
    const meModal = $('#meModal');
    const top = !meModal.hidden ? meModal : (!drawer.hidden ? drawer : null);

    if (e.key === 'Escape') {
      if (!$('#bellPop').hidden) { closeBell(); return; }
      if (!$('#searchResults').hidden) { $('#searchResults').hidden = true; return; }
      if (top === meModal) { closeMe(); return; }
      if (top === drawer) { closeDrawer(); return; }
      if (side.classList.contains('is-open')) { setSide(false); $('#burger').focus(); return; }
      return;
    }

    if (e.key === 'Tab' && top) {
      const items = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])', top)
        .filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ------------------------------------------------------------------------
     5. THE STORE

     One fetch of everything the dashboard needs, then every view reads from
     memory. The data is small — a local agency's orders and enquiries — and
     one round trip beats nine.
     ------------------------------------------------------------------------ */
  const state = {
    loading: true,
    error: null,
    enquiries: [], orders: [], people: [], projects: [], tasks: [],
    services: [], activities: [], notes: [], orderEvents: [], roleEvents: [],
    readNotifications: new Set()
  };

  try {
    const saved = JSON.parse(localStorage.getItem('we3.admin.read') || '[]');
    if (Array.isArray(saved)) state.readNotifications = new Set(saved);
  } catch (e) { /* first run */ }

  function saveRead() {
    try {
      localStorage.setItem('we3.admin.read',
        JSON.stringify(Array.from(state.readNotifications).slice(-300)));
    } catch (e) { /* private mode */ }
  }

  /** A table read that never rejects — a missing table must not blank the app. */
  function pull(table, build) {
    let q = client.from(table).select('*');
    if (build) q = build(q);
    return q.then(
      res => res.error ? { rows: [], error: res.error.message } : { rows: res.data || [], error: null },
      () => ({ rows: [], error: 'unreachable' })
    );
  }

  function loadAll() {
    state.loading = true;
    state.error = null;
    render();

    return Promise.all([
      pull('enquiries',   q => q.order('created_at', { ascending: false }).limit(2000)),
      pull('orders',      q => q.order('created_at', { ascending: false }).limit(2000)),
      pull('projects',    q => q.order('created_at', { ascending: false }).limit(2000)),
      pull('project_tasks', q => q.order('created_at', { ascending: false }).limit(2000)),
      pull('services',    q => q.order('sort', { ascending: true })),
      pull('activities',  q => q.order('at', { ascending: false }).limit(2000)),
      pull('notes',       q => q.order('at', { ascending: false }).limit(1000)),
      pull('order_events', q => q.order('at', { ascending: false }).limit(1000)),
      pull('role_events',  q => q.order('at', { ascending: false }).limit(200)),
      client.rpc('admin_people').then(
        res => res.error ? { rows: [], error: res.error.message } : { rows: res.data || [], error: null },
        () => ({ rows: [], error: 'unreachable' })
      )
    ]).then(function (r) {
      state.enquiries   = r[0].rows;
      state.orders      = r[1].rows;
      state.projects    = r[2].rows;
      state.tasks       = r[3].rows;
      state.services    = r[4].rows;
      state.activities  = r[5].rows;
      state.notes       = r[6].rows;
      state.orderEvents = r[7].rows;
      state.roleEvents  = r[8].rows;
      state.people      = r[9].rows;

      // Orders and people are what the page is fundamentally about; if those
      // two fail there is nothing worth showing.
      state.error = (r[1].error && r[9].error) ? r[1].error : null;
      state.loading = false;

      paintCounts();
      paintNotifications();
      render();
    });
  }

  function paintCounts() {
    const openEnq = state.enquiries.filter(e => e.status === 'New').length;
    const openOrd = state.orders.filter(o => o.status === 'pending').length;
    const set = (key, n) => $$('[data-count="' + key + '"]').forEach(el => { el.textContent = n || ''; });
    set('enquiries', openEnq);
    set('orders', openOrd);
  }

  /* ---- clients are derived, not a table ---------------------------------
     A client is a person who has ordered. Keeping that as a view over
     profiles and orders means there is one truth about who someone is, not
     a second copy to drift. */
  function clients() {
    return state.people.map(function (p) {
      const mine = state.orders.filter(o => p.phone && o.phone === p.phone);
      const verified = mine.filter(o => o.status === 'verified');
      const paid = verified.reduce((s, o) => s + Number(o.paid || 0), 0);
      const total = verified.reduce((s, o) => s + Number(o.total || 0), 0);
      const acts = state.activities.filter(a => a.username === p.username);
      const lastAct = acts.length ? acts[0].at : p.last_login;

      let status = 'Lead';
      if (mine.length && verified.length) status = 'Active';
      if (verified.length && verified.every(o => Number(o.paid) >= Number(o.total))) status = 'Completed';
      if (!mine.length && p.last_login &&
          Date.parse(p.last_login) < daysAgo(60).getTime()) status = 'Inactive';

      let payStatus = 'Pending';
      if (paid > 0 && paid < total) payStatus = 'Partial';
      if (total > 0 && paid >= total) payStatus = 'Paid';
      if (!mine.length) payStatus = '—';

      const services = Array.from(new Set(mine.flatMap(o =>
        (Array.isArray(o.items) ? o.items : []).map(i => i.name))));

      return {
        username: p.username,
        name: p.full_name || p.username,
        business: p.business || '',
        phone: p.phone || '',
        email: p.email || '',
        joined: p.joined,
        lastLogin: p.last_login,
        lastActivity: lastAct,
        isTeam: p.is_admin,
        isOwner: p.is_owner,
        orders: mine,
        services: services,
        total: total,
        paid: paid,
        due: Math.max(0, total - paid),
        status: status,
        payStatus: payStatus
      };
    });
  }

  /* ---- notifications, derived from what just happened ---- */
  function notifications() {
    const out = [];
    state.enquiries.slice(0, 20).forEach(e => out.push({
      id: 'enq-' + e.id, at: e.created_at,
      text: 'New enquiry from ' + (e.name || 'someone') + (e.service ? ' — ' + e.service : ''),
      go: '#enquiries'
    }));
    state.orders.slice(0, 20).forEach(o => out.push({
      id: 'ord-' + o.ref, at: o.created_at,
      text: 'New order ' + o.ref + ' — ' + money(o.paid) + ' from ' + (o.business || o.customer_name),
      go: '#orders'
    }));
    state.orderEvents.slice(0, 20).forEach(e => out.push({
      id: 'evt-' + e.id, at: e.at,
      text: '@' + (e.actor || 'someone') + ' marked ' + e.order_ref + ' ' + e.to_status,
      go: '#orders'
    }));
    state.projects.forEach(function (p) {
      if (!p.deadline || p.status === 'Completed') return;
      const days = Math.ceil((Date.parse(p.deadline) - Date.now()) / 86400000);
      if (days > 7 || days < -30) return;
      out.push({
        id: 'due-' + p.id + '-' + p.deadline, at: new Date().toISOString(),
        text: days < 0 ? p.name + ' is ' + Math.abs(days) + ' day(s) overdue'
                       : p.name + ' is due in ' + days + ' day(s)',
        go: '#projects'
      });
    });
    return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 30);
  }

  function paintNotifications() {
    const items = notifications();
    const unread = items.filter(n => !state.readNotifications.has(n.id));
    $('#bellDot').hidden = unread.length === 0;

    $('#bellList').innerHTML = items.length
      ? items.map(n => '<li' + (state.readNotifications.has(n.id) ? '' : ' class="is-unread"') + '>' +
          '<a href="' + n.go + '" data-notif="' + esc(n.id) + '">' + esc(n.text) + '</a>' +
          '<em>' + ago(n.at) + '</em></li>').join('')
      : '<li><span>Nothing new yet.</span></li>';

    $$('#bellList [data-notif]').forEach(function (a) {
      a.addEventListener('click', function () {
        state.readNotifications.add(a.dataset.notif);
        saveRead();
        closeBell();
        paintNotifications();
      });
    });
  }

  /* ------------------------------------------------------------------------
     6. SHELL CHROME
     ------------------------------------------------------------------------ */
  const side = $('#side');
  const sideScrim = $('#sideScrim');

  function setSide(open) {
    side.classList.toggle('is-open', open);
    sideScrim.hidden = !open;
    $('#burger').setAttribute('aria-expanded', String(open));
  }
  $('#burger').addEventListener('click', () => setSide(!side.classList.contains('is-open')));
  sideScrim.addEventListener('click', () => setSide(false));

  /* ---- notifications popover ---- */
  function closeBell() {
    $('#bellPop').hidden = true;
    $('#bellBtn').setAttribute('aria-expanded', 'false');
  }
  $('#bellBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    const pop = $('#bellPop');
    pop.hidden = !pop.hidden;
    this.setAttribute('aria-expanded', String(!pop.hidden));
  });
  $('#readAll').addEventListener('click', function () {
    notifications().forEach(n => state.readNotifications.add(n.id));
    saveRead();
    paintNotifications();
    toast('All notifications marked read.');
  });
  document.addEventListener('click', function (e) {
    if (!$('#bellPop').hidden && !e.target.closest('#bellPop') && !e.target.closest('#bellBtn')) closeBell();
    if (!$('#searchResults').hidden && !e.target.closest('.search')) $('#searchResults').hidden = true;
  });

  /* ---- global search ---- */
  const searchInput = $('#globalSearch');
  const searchPanel = $('#searchResults');

  function runSearch() {
    const q = searchInput.value.trim().toLowerCase();
    searchInput.setAttribute('aria-expanded', String(Boolean(q)));
    if (!q) { searchPanel.hidden = true; return; }

    const hit = (v) => String(v || '').toLowerCase().includes(q);
    const groups = [];

    const cl = clients().filter(c => [c.name, c.business, c.phone, c.email, c.username].some(hit)).slice(0, 5);
    if (cl.length) groups.push(['Clients', 'fa-user-group', cl.map(c => ({
      label: c.name + (c.business ? ' · ' + c.business : ''), meta: c.phone, go: () => openClient(c.username)
    }))]);

    const en = state.enquiries.filter(e => [e.name, e.business, e.phone, e.email, e.service, e.status].some(hit)).slice(0, 5);
    if (en.length) groups.push(['Enquiries', 'fa-file-lines', en.map(e => ({
      label: e.name + (e.service ? ' · ' + e.service : ''), meta: e.status, go: () => openEnquiry(e.id)
    }))]);

    const or = state.orders.filter(o => [o.ref, o.customer_name, o.business, o.phone, o.status].some(hit)).slice(0, 5);
    if (or.length) groups.push(['Orders', 'fa-receipt', or.map(o => ({
      label: o.ref + ' · ' + (o.business || o.customer_name), meta: money(o.paid), go: () => openOrder(o.ref)
    }))]);

    const pr = state.projects.filter(p => [p.name, p.client_name, p.service, p.status, p.assignee].some(hit)).slice(0, 5);
    if (pr.length) groups.push(['Projects', 'fa-folder-open', pr.map(p => ({
      label: p.name + (p.client_name ? ' · ' + p.client_name : ''), meta: p.status, go: () => openProject(p.id)
    }))]);

    const sv = state.services.filter(s => [s.name, s.slug, s.description].some(hit)).slice(0, 5);
    if (sv.length) groups.push(['Services', 'fa-briefcase', sv.map(s => ({
      label: s.name, meta: money(s.price), go: () => go('#services')
    }))]);

    if (!groups.length) {
      searchPanel.innerHTML = '<div class="search__group">No matches</div>';
      searchPanel.hidden = false;
      return;
    }

    searchPanel.innerHTML = groups.map(function (g, gi) {
      return '<div class="search__group">' + g[0] + '</div>' + g[2].map(function (item, i) {
        return '<button class="search__hit" data-g="' + gi + '" data-i="' + i + '" role="option">' +
          '<i class="fa-solid ' + g[1] + '" aria-hidden="true"></i>' +
          '<span>' + esc(item.label) + '</span>' +
          '<em>' + esc(item.meta || '') + '</em></button>';
      }).join('');
    }).join('');

    $$('.search__hit', searchPanel).forEach(function (btn) {
      btn.addEventListener('click', function () {
        searchPanel.hidden = true;
        searchInput.value = '';
        groups[Number(btn.dataset.g)][2][Number(btn.dataset.i)].go();
      });
    });
    searchPanel.hidden = false;
  }

  let searchTimer = null;
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 140);
  });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  /* ---- my account ---- */
  const meModal = $('#meModal');

  function meNote(el, text, cls) {
    el.hidden = !text;
    el.textContent = text || '';
    el.className = 'msg ' + (cls || '');
  }

  function openMe() {
    const mine = state.people.find(p => p.username === me.username) || {};
    $('#meUser').textContent = '@' + me.username;
    $('#meRole').textContent = roleLabel(me);
    $('#meRole').className = 'tag' + (me.is_owner ? ' tag--owner' : ' tag--green');
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
  $$('[data-close-me]', meModal).forEach(el => el.addEventListener('click', closeMe));

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
      toast('Your details were saved.');
      loadAll();
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
      toast('Password changed.');
    }, function () {
      btn.disabled = false;
      meNote(msg, 'Could not reach the server.', 'is-bad');
    });
  });

  /* ------------------------------------------------------------------------
     7. ROUTER
     ------------------------------------------------------------------------ */
  const ROUTES = ['dashboard', 'enquiries', 'clients', 'orders', 'projects',
                  'services', 'activity', 'team', 'analytics', 'settings'];
  let route = 'dashboard';

  function go(hash) {
    if (location.hash === hash) { readRoute(); render(); return; }
    location.hash = hash;
  }

  function readRoute() {
    const want = (location.hash || '#dashboard').replace('#', '');
    route = ROUTES.indexOf(want) > -1 ? want : 'dashboard';
    $$('.navit').forEach(function (a) {
      const on = a.getAttribute('href') === '#' + route;
      a.classList.toggle('is-on', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    setSide(false);
  }

  window.addEventListener('hashchange', function () { readRoute(); render(); });

  function render() {
    const view = $('#view');
    if (state.loading) { view.innerHTML = '<div class="skel">' + skeleton(6) + '</div>'; return; }
    if (state.error) {
      view.innerHTML = errorState('the dashboard');
      $('[data-retry]', view).addEventListener('click', loadAll);
      return;
    }
    VIEWS[route]();
    view.scrollTop = 0;
  }

  function startApp() {
    readRoute();
    loadAll();
  }

  /* ------------------------------------------------------------------------
     8. FILTER HELPERS
     ------------------------------------------------------------------------ */
  const DATE_CHOICES = [
    ['all', 'Any time'], ['today', 'Today'], ['yesterday', 'Yesterday'],
    ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['month', 'This month'],
    ['custom', 'Custom range']
  ];

  function inRange(value, key, from, to) {
    if (!key || key === 'all') return true;
    const t = Date.parse(value);
    if (isNaN(t)) return false;
    const now = new Date();

    if (key === 'today') return t >= startOfDay(now).getTime();
    if (key === 'yesterday') return t >= daysAgo(1).getTime() && t < startOfDay(now).getTime();
    if (key === '7')  return t >= daysAgo(6).getTime();
    if (key === '30') return t >= daysAgo(29).getTime();
    if (key === 'month') return t >= new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    if (key === 'custom') {
      if (from && t < Date.parse(from)) return false;
      if (to && t > Date.parse(to) + 86399999) return false;
      return true;
    }
    return true;
  }

  function selectHtml(id, label, options, value) {
    return '<div class="fld"><label for="' + id + '">' + esc(label) + '</label>' +
      '<select class="inp" id="' + id + '">' +
      options.map(o => '<option value="' + esc(o[0]) + '"' +
        (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') +
      '</select></div>';
  }

  function dateFilterHtml(prefix, f) {
    return selectHtml(prefix + 'Date', 'Date', DATE_CHOICES, f.date) +
      (f.date === 'custom'
        ? '<div class="fld"><label for="' + prefix + 'From">From</label>' +
          '<input class="inp" type="date" id="' + prefix + 'From" value="' + esc(f.from || '') + '" /></div>' +
          '<div class="fld"><label for="' + prefix + 'To">To</label>' +
          '<input class="inp" type="date" id="' + prefix + 'To" value="' + esc(f.to || '') + '" /></div>'
        : '');
  }

  /** Wires a set of inputs to one filter object and re-renders on change. */
  function wireFilters(map, f, after) {
    Object.keys(map).forEach(function (sel) {
      const el = $(sel);
      if (!el) return;
      const key = map[sel];
      const ev = el.tagName === 'INPUT' && el.type !== 'date' ? 'input' : 'change';
      el.addEventListener(ev, function () {
        f[key] = el.value;
        f.page = 1;
        after();
      });
    });
  }

  function sortRows(rows, by, dir, pick) {
    if (!by) return rows;
    const s = rows.slice();
    s.sort(function (a, b) {
      const x = pick(a, by), y = pick(b, by);
      if (typeof x === 'number' && typeof y === 'number') return dir === 'asc' ? x - y : y - x;
      const xs = String(x || '').toLowerCase(), ys = String(y || '').toLowerCase();
      return dir === 'asc' ? xs.localeCompare(ys) : ys.localeCompare(xs);
    });
    return s;
  }

  function sortableHead(cols, f) {
    return '<tr>' + cols.map(function (c) {
      if (!c.sort) return '<th>' + esc(c.label) + '</th>';
      const on = f.sort === c.sort;
      return '<th data-sort="' + c.sort + '" tabindex="0" role="button" aria-sort="' +
        (on ? (f.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">' + esc(c.label) +
        (on ? '<i class="fa-solid fa-caret-' + (f.dir === 'asc' ? 'up' : 'down') + '"></i>' : '') +
        '</th>';
    }).join('') + '</tr>';
  }

  function wireSort(scope, f, after) {
    $$('th[data-sort]', scope).forEach(function (th) {
      const hit = function () {
        const key = th.dataset.sort;
        if (f.sort === key) f.dir = f.dir === 'asc' ? 'desc' : 'asc';
        else { f.sort = key; f.dir = 'asc'; }
        after();
      };
      th.addEventListener('click', hit);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hit(); } });
    });
  }

  function wirePager(scope, f, after) {
    $$('[data-page]', scope).forEach(function (b) {
      b.addEventListener('click', function () { f.page = Number(b.dataset.page); after(); });
    });
    const size = $('[data-size]', scope);
    if (size) size.addEventListener('change', function () { f.size = Number(size.value); f.page = 1; after(); });
  }

  /* ------------------------------------------------------------------------
     9. VIEWS
     ------------------------------------------------------------------------ */
  const VIEWS = {};

  function pageHead(title, sub, right) {
    return '<div class="page-head"><div><h1>' + title + '</h1><p>' + esc(sub) + '</p></div>' +
      (right ? '<div class="page-head__right">' + right + '</div>' : '') + '</div>';
  }

  function kpi(label, value, icon, d, sub) {
    return '<article class="kpi"><div class="kpi__top">' +
      '<span class="kpi__ico"><i class="fa-solid ' + icon + '" aria-hidden="true"></i></span>' +
      '<span class="kpi__label">' + esc(label) + '</span></div>' +
      '<p class="kpi__value">' + esc(value) + '</p>' +
      '<div class="kpi__foot"><span class="kpi__delta ' + d.cls + '">' + esc(d.text) + '</span>' +
      '<span class="kpi__sub">' + esc(sub) + '</span></div></article>';
  }

  /* ---- DASHBOARD ---- */
  VIEWS.dashboard = function () {
    const week = daysAgo(6).getTime();
    const prevWeek = daysAgo(13).getTime();
    const month = daysAgo(29).getTime();
    const prevMonth = daysAgo(59).getTime();

    const since = (rows, key, from, to) => rows.filter(function (r) {
      const t = Date.parse(r[key]);
      return t >= from && (to === undefined || t < to);
    }).length;

    const cl = clients();
    const activeProjects = state.projects.filter(p => ['Planning','Design','Development','Revision','Ready','Not Started','On Hold'].indexOf(p.status) > -1);
    const donePro = state.projects.filter(p => p.status === 'Completed');

    const cards =
      kpi('Total Enquiries', String(state.enquiries.length), 'fa-file-lines',
          delta(since(state.enquiries, 'created_at', week), since(state.enquiries, 'created_at', prevWeek, week)),
          '+' + since(state.enquiries, 'created_at', week) + ' this week') +
      kpi('Active Projects', String(activeProjects.length), 'fa-folder-open',
          delta(since(state.projects, 'created_at', week), since(state.projects, 'created_at', prevWeek, week)),
          '+' + since(state.projects, 'created_at', week) + ' this week') +
      kpi('Orders Verified', String(state.orders.filter(o => o.status === 'verified').length), 'fa-circle-check',
          delta(since(state.orders, 'created_at', week), since(state.orders, 'created_at', prevWeek, week)),
          '+' + since(state.orders, 'created_at', week) + ' this week') +
      kpi('Total Clients', String(cl.filter(c => c.orders.length).length), 'fa-user-group',
          delta(since(state.people, 'joined', month), since(state.people, 'joined', prevMonth, month)),
          '+' + since(state.people, 'joined', month) + ' this month');

    const recent = state.enquiries.slice(0, 6);
    const enqCard = '<section class="card"><div class="card__head">' +
      '<h2><i class="fa-solid fa-file-lines"></i> Recent Enquiries</h2>' +
      '<a class="btn--ghost btn--sm" href="#enquiries">View all →</a></div>' +
      (recent.length
        ? '<div class="tablewrap"><table class="tbl tbl--tight"><thead><tr><th>Name</th><th>Business</th><th>Service</th><th>Status</th><th>Date</th></tr></thead><tbody>' +
          recent.map(e => '<tr data-enq="' + esc(e.id) + '" style="cursor:pointer">' +
            '<td><strong>' + esc(e.name) + '</strong></td><td>' + esc(e.business || '—') + '</td>' +
            '<td>' + esc(e.service || '—') + '</td><td>' + badge(e.status) + '</td>' +
            '<td class="num">' + fmtDate(e.created_at) + '</td></tr>').join('') +
          '</tbody></table></div>'
        : emptyState('No enquiries yet', 'They appear the moment someone fills in the form on the site.')) +
      '</section>';

    const feed = liveFeed().slice(0, 8);
    const feedCard = '<section class="card"><div class="card__head">' +
      '<h2><i class="fa-solid fa-wave-square"></i> User Activity</h2>' +
      '<a class="btn--ghost btn--sm" href="#activity">View all →</a></div>' +
      (feed.length
        ? '<ul class="tl">' + feed.map(a => '<li><p><strong>' + esc(a.who) + '</strong> ' + esc(a.what) + '</p>' +
            '<em>' + ago(a.at) + '</em></li>').join('') + '</ul>'
        : emptyState('No activity yet', 'Visits and clicks on the public site will show up here.')) +
      '</section>';

    const quick = '<section class="card"><div class="card__head"><h2><i class="fa-solid fa-bolt"></i> Quick Actions</h2></div>' +
      '<div class="chipbar">' +
      '<button class="btn--ghost btn--sm" data-quick="project"><i class="fa-solid fa-folder-plus"></i> Add Project</button>' +
      '<button class="btn--ghost btn--sm" data-quick="service"><i class="fa-solid fa-plus"></i> Add Service</button>' +
      '<a class="btn--ghost btn--sm" href="#clients"><i class="fa-solid fa-user-group"></i> Clients</a>' +
      '<a class="btn--ghost btn--sm" href="#analytics"><i class="fa-solid fa-chart-column"></i> Reports</a>' +
      '</div></section>';

    const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

    $('#view').innerHTML =
      pageHead('Welcome back, @' + esc(me.username) + ' 👋',
               "Here's what's happening with your business today.",
               '<span class="page-head__date">' + esc(today) + '<em>Keep building 🚀</em></span>' +
               '<button class="btn--green" id="addNew"><i class="fa-solid fa-plus"></i> Add New</button>') +
      '<div class="grid grid--kpi" style="margin-bottom:14px">' + cards + '</div>' +
      '<div class="grid grid--2">' + enqCard + '<div class="grid">' + feedCard + quick + '</div></div>';

    $$('#view [data-enq]').forEach(tr => tr.addEventListener('click', () => openEnquiry(tr.dataset.enq)));
    $$('#view [data-quick]').forEach(b => b.addEventListener('click', function () {
      if (b.dataset.quick === 'project') editProject(null);
      if (b.dataset.quick === 'service') editService(null);
    }));
    $('#addNew').addEventListener('click', function () {
      const pick = prompt('Add what?\n\n1 — Project\n2 — Service\n\nType 1 or 2:');
      if (pick === '1') editProject(null);
      else if (pick === '2') editService(null);
    });
  };

  /** One stream out of enquiries, orders, site activity and team changes. */
  function liveFeed() {
    const out = [];
    state.activities.forEach(a => out.push({
      at: a.at, who: a.username || 'A visitor',
      what: (a.kind || 'did something') + (a.detail ? ' — ' + a.detail : '')
    }));
    state.enquiries.forEach(e => out.push({
      at: e.created_at, who: e.name || 'Someone', what: 'submitted an enquiry' + (e.service ? ' for ' + e.service : '')
    }));
    state.orders.forEach(o => out.push({
      at: o.created_at, who: o.customer_name || o.business || 'A customer',
      what: 'placed order ' + o.ref + ' (' + money(o.paid) + ')'
    }));
    state.orderEvents.forEach(e => out.push({
      at: e.at, who: '@' + (e.actor || 'someone'),
      what: e.from_status !== e.to_status ? 'marked ' + e.order_ref + ' ' + e.to_status : 'changed a note on ' + e.order_ref
    }));
    return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }

  /* ---- ENQUIRIES ---- */
  const SERVICE_CHOICES = [['all', 'All services'], ['Website Development', 'Website'],
    ['Reel Making', 'Reel Making'], ['Video Editing', 'Video Editing'],
    ['Combo Package', 'Combo Package'], ['Store Photoshoot', 'Store Photoshoot'],
    ['Maintenance', 'Maintenance'], ['Not Sure', 'Not Sure']];

  const ENQ_STATUS = ['New', 'Contacted', 'Quoted', 'In Progress', 'Completed', 'Cancelled'];
  const SOURCES = ['Website', 'Instagram', 'WhatsApp', 'Referral', 'Other'];

  const enqF = { q: '', service: 'all', status: 'all', source: 'all', date: 'all',
                 from: '', to: '', sort: 'created_at', dir: 'desc', page: 1, size: 20 };

  function filteredEnquiries() {
    const q = enqF.q.trim().toLowerCase();
    let rows = state.enquiries.filter(function (e) {
      if (enqF.service !== 'all' && e.service !== enqF.service) return false;
      if (enqF.status !== 'all' && e.status !== enqF.status) return false;
      if (enqF.source !== 'all' && e.source !== enqF.source) return false;
      if (!inRange(e.created_at, enqF.date, enqF.from, enqF.to)) return false;
      if (!q) return true;
      return [e.name, e.business, e.phone, e.email].some(v => String(v || '').toLowerCase().includes(q));
    });
    return sortRows(rows, enqF.sort, enqF.dir, function (r, by) {
      if (by === 'created_at') return Date.parse(r.created_at) || 0;
      return r[by];
    });
  }

  VIEWS.enquiries = function () {
    const cols = [
      { label: '#' }, { label: 'Name', sort: 'name' }, { label: 'Business', sort: 'business' },
      { label: 'Phone' }, { label: 'Service', sort: 'service' }, { label: 'Source', sort: 'source' },
      { label: 'Status', sort: 'status' }, { label: 'Date', sort: 'created_at' }, { label: 'Actions' }
    ];

    const rows = filteredEnquiries();
    const p = paginate(rows, enqF.page, enqF.size);

    const body = rows.length
      ? '<div class="tablewrap"><table class="tbl"><thead>' + sortableHead(cols, enqF) + '</thead><tbody>' +
        p.slice.map(function (e, i) {
          return '<tr><td class="num">' + (p.from + i + 1) + '</td>' +
            '<td><strong>' + esc(e.name) + '</strong></td>' +
            '<td>' + esc(e.business || '—') + '</td>' +
            '<td class="num">' + esc(e.phone || '—') + '</td>' +
            '<td>' + esc(e.service || '—') + '</td>' +
            '<td>' + esc(e.source || '—') + '</td>' +
            '<td>' + badge(e.status) + '</td>' +
            '<td class="num">' + fmtDate(e.created_at) + '</td>' +
            '<td><div class="acts">' +
              '<button data-view="' + esc(e.id) + '" aria-label="View enquiry"><i class="fa-solid fa-eye"></i></button>' +
              '<button data-wa="' + esc(e.id) + '" aria-label="WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>' +
              '<button class="is-danger" data-del="' + esc(e.id) + '" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>' +
            '</div></td></tr>';
        }).join('') + '</tbody></table></div>' + pagerHtml(p, enqF.size)
      : emptyState(state.enquiries.length ? 'Nothing matches those filters' : 'No enquiries yet',
          state.enquiries.length ? 'Loosen a filter, or reset them.'
            : 'They appear here the moment someone fills in the form on the site.');

    $('#view').innerHTML =
      pageHead('Enquiries', 'Everyone who has asked about your services.',
        '<button class="btn--ghost" id="enqExport"><i class="fa-solid fa-file-arrow-down"></i> Export CSV</button>') +
      '<section class="card">' +
        '<div class="filters">' +
          '<div class="fld"><label for="enqQ">Search</label>' +
            '<input class="inp" id="enqQ" type="search" placeholder="Name, business, phone or email" value="' + esc(enqF.q) + '" /></div>' +
          selectHtml('enqService', 'Service', SERVICE_CHOICES, enqF.service) +
          selectHtml('enqStatus', 'Status', [['all', 'All status']].concat(ENQ_STATUS.map(s => [s, s])), enqF.status) +
          selectHtml('enqSource', 'Source', [['all', 'All sources']].concat(SOURCES.map(s => [s, s])), enqF.source) +
          dateFilterHtml('enq', enqF) +
        '</div>' +
        '<div class="filters__foot">' +
          '<span>Showing ' + rows.length + ' of ' + state.enquiries.length + ' enquiries</span>' +
          '<button class="btn--ghost btn--sm" id="enqReset"><i class="fa-solid fa-rotate-left"></i> Reset filters</button>' +
        '</div>' + body +
      '</section>';

    const again = VIEWS.enquiries;
    wireFilters({ '#enqQ': 'q', '#enqService': 'service', '#enqStatus': 'status',
                  '#enqSource': 'source', '#enqDate': 'date', '#enqFrom': 'from', '#enqTo': 'to' }, enqF, again);
    wireSort($('#view'), enqF, again);
    wirePager($('#view'), enqF, again);

    $('#enqReset').addEventListener('click', function () {
      Object.assign(enqF, { q: '', service: 'all', status: 'all', source: 'all', date: 'all', from: '', to: '', page: 1 });
      again();
    });

    $('#enqExport').addEventListener('click', function () {
      exportCsv('we3-enquiries.csv', [
        { label: 'Date', get: r => fmtWhen(r.created_at) }, { label: 'Name', get: r => r.name },
        { label: 'Business', get: r => r.business }, { label: 'Phone', get: r => r.phone },
        { label: 'Email', get: r => r.email }, { label: 'Service', get: r => r.service },
        { label: 'Source', get: r => r.source }, { label: 'Status', get: r => r.status },
        { label: 'Message', get: r => r.message }, { label: 'Internal note', get: r => r.internal_note }
      ], rows);
    });

    $$('#view [data-view]').forEach(b => b.addEventListener('click', () => openEnquiry(b.dataset.view)));
    $$('#view [data-wa]').forEach(b => b.addEventListener('click', function () {
      const e = state.enquiries.find(x => String(x.id) === b.dataset.wa);
      waTo(e && e.phone, 'Hi ' + ((e && e.name) || '') + ', this is WE3 about your enquiry' +
        (e && e.service ? ' for ' + e.service : '') + '.');
      logEnquiryTouch(e, 'WhatsApp contacted');
    }));
    $$('#view [data-del]').forEach(b => b.addEventListener('click', function () {
      const e = state.enquiries.find(x => String(x.id) === b.dataset.del);
      if (!e) return;
      if (!confirmDanger('Delete this enquiry?', e.name + (e.business ? ' — ' + e.business : ''))) return;
      client.from('enquiries').delete().eq('id', e.id).then(function (res) {
        if (res.error) { toast('Could not delete it. (' + res.error.message + ')', 'bad'); return; }
        toast('Enquiry deleted.');
        loadAll();
      });
    }));
  };

  function waTo(phone, message) {
    const digits = String(phone || '').replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) { toast('No usable phone number on this record.', 'bad'); return; }
    window.open('https://wa.me/91' + digits + '?text=' + encodeURIComponent(message), '_blank', 'noopener,noreferrer');
  }

  function notesFor(entity, id) {
    return state.notes.filter(n => n.entity === entity && String(n.entity_id) === String(id));
  }

  function addNote(entity, id, body) {
    return client.from('notes').insert({ entity: entity, entity_id: String(id), body: body, author: me.username });
  }

  function openEnquiry(id) {
    const e = state.enquiries.find(x => String(x.id) === String(id));
    if (!e) { toast('That enquiry is no longer there.', 'bad'); return; }

    const timeline = [{ at: e.created_at, text: 'Enquiry submitted from ' + (e.source || 'the website') }]
      .concat(notesFor('enquiry', e.id).map(n => ({ at: n.at, text: '@' + (n.author || '') + ': ' + n.body })))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    openDrawer('Enquiry from ' + e.name,
      '<div class="dsec"><h3>Customer</h3><dl class="dl">' +
        '<div><dt>Name</dt><dd>' + esc(e.name) + '</dd></div>' +
        '<div><dt>Business</dt><dd>' + esc(e.business || '—') + '</dd></div>' +
        '<div><dt>Phone</dt><dd>' + esc(e.phone || '—') + '</dd></div>' +
        '<div><dt>Email</dt><dd>' + esc(e.email || '—') + '</dd></div>' +
      '</dl></div>' +
      '<div class="dsec"><h3>Enquiry</h3><dl class="dl">' +
        '<div><dt>Service</dt><dd>' + esc(e.service || '—') + '</dd></div>' +
        '<div><dt>Source</dt><dd>' + esc(e.source || '—') + '</dd></div>' +
        '<div><dt>Submitted</dt><dd>' + fmtWhen(e.created_at) + '</dd></div>' +
      '</dl>' + (e.message ? '<p class="msg" style="margin-top:10px">' + esc(e.message) + '</p>' : '') + '</div>' +
      '<div class="dsec"><h3>Lead status</h3>' +
        '<select class="inp" id="dStatus">' + ENQ_STATUS.map(s =>
          '<option value="' + s + '"' + (s === e.status ? ' selected' : '') + '>' + s + '</option>').join('') +
        '</select></div>' +
      '<div class="dsec"><h3>Internal note</h3>' +
        '<textarea class="inp" id="dNote" placeholder="Private to the team — the customer never sees this.">' +
          esc(e.internal_note || '') + '</textarea>' +
        '<button class="btn--green btn--block" id="dSave"><i class="fa-solid fa-check"></i> Save changes</button>' +
        '<button class="btn--ghost btn--block" id="dWa"><i class="fa-brands fa-whatsapp"></i> Message on WhatsApp</button>' +
      '</div>' +
      '<div class="dsec"><h3>Activity</h3><ul class="tl">' +
        timeline.map(t => '<li><p>' + esc(t.text) + '</p><em>' + fmtWhen(t.at) + '</em></li>').join('') +
      '</ul>' +
        '<div class="fld" style="margin-top:12px"><label for="dAdd">Add to the timeline</label>' +
        '<input class="inp" id="dAdd" placeholder="What happened?" /></div>' +
        '<button class="btn--ghost btn--block" id="dAddBtn">Add note</button>' +
      '</div>',
      function (root) {
        $('#dSave', root).addEventListener('click', function () {
          const btn = this;
          btn.disabled = true;
          client.from('enquiries').update({
            status: $('#dStatus', root).value,
            internal_note: $('#dNote', root).value.trim() || null,
            handled_by: me.username,
            updated_at: new Date().toISOString()
          }).eq('id', e.id).then(function (res) {
            btn.disabled = false;
            if (res.error) { toast('Could not save. (' + res.error.message + ')', 'bad'); return; }
            toast('Enquiry updated successfully.');
            closeDrawer();
            loadAll();
          });
        });
        $('#dWa', root).addEventListener('click', function () {
          waTo(e.phone, 'Hi ' + e.name + ', this is WE3 about your enquiry' +
            (e.service ? ' for ' + e.service : '') + '.');
          logEnquiryTouch(e, 'WhatsApp contacted');
        });
        $('#dAddBtn', root).addEventListener('click', function () {
          const body = $('#dAdd', root).value.trim();
          if (!body) return;
          addNote('enquiry', e.id, body).then(function (res) {
            if (res.error) { toast('Could not add that note.', 'bad'); return; }
            toast('Note added.');
            closeDrawer();
            loadAll();
          });
        });
      });
  }

  function logEnquiryTouch(e, what) {
    if (!e) return;
    addNote('enquiry', e.id, what);
  }

  /* ---- CLIENTS ---- */
  const cliF = { q: '', status: 'all', pay: 'all', date: 'all', from: '', to: '',
                 sort: 'lastActivity', dir: 'desc', page: 1, size: 20 };

  function filteredClients() {
    const q = cliF.q.trim().toLowerCase();
    const rows = clients().filter(function (c) {
      if (cliF.status !== 'all' && c.status !== cliF.status) return false;
      if (cliF.pay !== 'all' && c.payStatus !== cliF.pay) return false;
      if (!inRange(c.joined, cliF.date, cliF.from, cliF.to)) return false;
      if (!q) return true;
      return [c.name, c.business, c.phone, c.email, c.username].some(v => String(v || '').toLowerCase().includes(q));
    });
    return sortRows(rows, cliF.sort, cliF.dir, function (r, by) {
      if (by === 'lastActivity' || by === 'joined') return Date.parse(r[by]) || 0;
      if (by === 'total' || by === 'paid') return Number(r[by]) || 0;
      return r[by];
    });
  }

  VIEWS.clients = function () {
    const cols = [
      { label: 'Client', sort: 'name' }, { label: 'Business', sort: 'business' },
      { label: 'Phone' }, { label: 'Services' }, { label: 'Status', sort: 'status' },
      { label: 'Paid', sort: 'paid' }, { label: 'Payment' }, { label: 'Last activity', sort: 'lastActivity' },
      { label: 'Actions' }
    ];
    const rows = filteredClients();
    const p = paginate(rows, cliF.page, cliF.size);

    const body = rows.length
      ? '<div class="tablewrap"><table class="tbl"><thead>' + sortableHead(cols, cliF) + '</thead><tbody>' +
        p.slice.map(c => '<tr>' +
          '<td><strong>' + esc(c.name) + '</strong><br /><span style="font-size:11.5px">@' + esc(c.username) + '</span></td>' +
          '<td>' + esc(c.business || '—') + '</td>' +
          '<td class="num">' + esc(c.phone || '—') + '</td>' +
          '<td>' + esc(c.services.length ? c.services.join(', ') : '—') + '</td>' +
          '<td>' + badge(c.status) + '</td>' +
          '<td class="num">' + money(c.paid) + '</td>' +
          '<td>' + badge(c.payStatus) + '</td>' +
          '<td class="num">' + (c.lastActivity ? ago(c.lastActivity) : '—') + '</td>' +
          '<td><div class="acts">' +
            '<button data-client="' + esc(c.username) + '" aria-label="Open client"><i class="fa-solid fa-eye"></i></button>' +
            '<button data-cwa="' + esc(c.username) + '" aria-label="WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>' +
          '</div></td></tr>').join('') + '</tbody></table></div>' + pagerHtml(p, cliF.size)
      : emptyState(clients().length ? 'Nothing matches those filters' : 'No clients yet',
          clients().length ? 'Loosen a filter, or reset them.' : 'Anyone who registers on the site appears here.');

    $('#view').innerHTML =
      pageHead('Clients', 'Everyone who has an account, and what they have bought.',
        '<button class="btn--ghost" id="cliExport"><i class="fa-solid fa-file-arrow-down"></i> Export CSV</button>') +
      '<section class="card">' +
        '<div class="filters">' +
          '<div class="fld"><label for="cliQ">Search</label>' +
            '<input class="inp" id="cliQ" type="search" placeholder="Name, business, phone or email" value="' + esc(cliF.q) + '" /></div>' +
          selectHtml('cliStatus', 'Status', [['all', 'All status'], ['Lead', 'Lead'], ['Active', 'Active'], ['Completed', 'Completed'], ['Inactive', 'Inactive']], cliF.status) +
          selectHtml('cliPay', 'Payment', [['all', 'All payments'], ['Paid', 'Paid'], ['Partial', 'Partial'], ['Pending', 'Pending']], cliF.pay) +
          dateFilterHtml('cli', cliF) +
        '</div>' +
        '<div class="filters__foot"><span>Showing ' + rows.length + ' of ' + clients().length + ' people</span>' +
          '<button class="btn--ghost btn--sm" id="cliReset"><i class="fa-solid fa-rotate-left"></i> Reset filters</button></div>' +
        body +
      '</section>';

    const again = VIEWS.clients;
    wireFilters({ '#cliQ': 'q', '#cliStatus': 'status', '#cliPay': 'pay',
                  '#cliDate': 'date', '#cliFrom': 'from', '#cliTo': 'to' }, cliF, again);
    wireSort($('#view'), cliF, again);
    wirePager($('#view'), cliF, again);
    $('#cliReset').addEventListener('click', function () {
      Object.assign(cliF, { q: '', status: 'all', pay: 'all', date: 'all', from: '', to: '', page: 1 });
      again();
    });
    $('#cliExport').addEventListener('click', function () {
      exportCsv('we3-clients.csv', [
        { label: 'Username', get: c => c.username }, { label: 'Name', get: c => c.name },
        { label: 'Business', get: c => c.business }, { label: 'Phone', get: c => c.phone },
        { label: 'Email', get: c => c.email }, { label: 'Services', get: c => c.services.join('; ') },
        { label: 'Status', get: c => c.status }, { label: 'Total', get: c => c.total },
        { label: 'Paid', get: c => c.paid }, { label: 'Due', get: c => c.due },
        { label: 'Joined', get: c => fmtDate(c.joined) }, { label: 'Last activity', get: c => fmtWhen(c.lastActivity) }
      ], rows);
    });
    $$('#view [data-client]').forEach(b => b.addEventListener('click', () => openClient(b.dataset.client)));
    $$('#view [data-cwa]').forEach(b => b.addEventListener('click', function () {
      const c = clients().find(x => x.username === b.dataset.cwa);
      waTo(c && c.phone, 'Hi ' + ((c && c.name) || '') + ', this is WE3.');
    }));
  };

  function openClient(username) {
    const c = clients().find(x => x.username === username);
    if (!c) { toast('That client is no longer there.', 'bad'); return; }

    const acts = state.activities.filter(a => a.username === c.username).slice(0, 12);
    const notes = notesFor('client', c.username);
    const projects = state.projects.filter(p => p.phone && p.phone === c.phone);

    openDrawer(c.name,
      '<div class="dsec"><h3>Overview</h3><dl class="dl">' +
        '<div><dt>Username</dt><dd>@' + esc(c.username) + '</dd></div>' +
        '<div><dt>Business</dt><dd>' + esc(c.business || '—') + '</dd></div>' +
        '<div><dt>Phone</dt><dd>' + esc(c.phone || '—') + '</dd></div>' +
        '<div><dt>Email</dt><dd>' + esc(c.email || '—') + '</dd></div>' +
        '<div><dt>Joined</dt><dd>' + fmtDate(c.joined) + '</dd></div>' +
        '<div><dt>Status</dt><dd>' + badge(c.status) + '</dd></div>' +
      '</dl></div>' +
      '<div class="dsec"><h3>Payments</h3><dl class="dl">' +
        '<div><dt>Order value (verified)</dt><dd>' + money(c.total) + '</dd></div>' +
        '<div><dt>Paid</dt><dd>' + money(c.paid) + '</dd></div>' +
        '<div><dt>Remaining</dt><dd>' + money(c.due) + '</dd></div>' +
        '<div><dt>Status</dt><dd>' + badge(c.payStatus) + '</dd></div>' +
      '</dl></div>' +
      '<div class="dsec"><h3>Orders</h3>' +
        (c.orders.length
          ? '<ul class="tl">' + c.orders.map(o => '<li><p><strong>' + esc(o.ref) + '</strong> ' +
              badge(o.status) + '<br />' + money(o.paid) + ' of ' + money(o.total) + '</p>' +
              '<em>' + fmtDate(o.created_at) + '</em></li>').join('') + '</ul>'
          : '<p class="msg">No orders yet.</p>') + '</div>' +
      '<div class="dsec"><h3>Projects</h3>' +
        (projects.length
          ? '<ul class="tl">' + projects.map(p => '<li><p><strong>' + esc(p.name) + '</strong> ' + badge(p.status) +
              '</p><em>' + (p.deadline ? 'Due ' + fmtDate(p.deadline) : 'No deadline') + '</em></li>').join('') + '</ul>'
          : '<p class="msg">No projects yet.</p>') + '</div>' +
      '<div class="dsec"><h3>Recent activity</h3>' +
        (acts.length
          ? '<ul class="tl">' + acts.map(a => '<li><p>' + esc(a.kind) + (a.detail ? ' — ' + esc(a.detail) : '') +
              '</p><em>' + ago(a.at) + '</em></li>').join('') + '</ul>'
          : '<p class="msg">Nothing recorded yet.</p>') + '</div>' +
      '<div class="dsec"><h3>Private notes</h3>' +
        (notes.length ? '<ul class="tl">' + notes.map(n => '<li><p>' + esc(n.body) + '</p><em>@' +
            esc(n.author || '') + ' · ' + fmtWhen(n.at) + '</em></li>').join('') + '</ul>' : '') +
        '<div class="fld" style="margin-top:10px"><input class="inp" id="cNote" placeholder="Add a private note" /></div>' +
        '<button class="btn--ghost btn--block" id="cNoteBtn">Add note</button></div>' +
      '<div class="dsec"><h3>Contact</h3>' +
        '<button class="btn--green btn--block" id="cWa"><i class="fa-brands fa-whatsapp"></i> WhatsApp</button>' +
        (c.phone ? '<a class="btn--ghost btn--block" href="tel:+91' + esc(c.phone) + '"><i class="fa-solid fa-phone"></i> Call</a>' : '') +
        (c.email ? '<a class="btn--ghost btn--block" href="mailto:' + esc(c.email) + '"><i class="fa-solid fa-envelope"></i> Email</a>' : '') +
      '</div>',
      function (root) {
        $('#cWa', root).addEventListener('click', () => waTo(c.phone, 'Hi ' + c.name + ', this is WE3.'));
        $('#cNoteBtn', root).addEventListener('click', function () {
          const body = $('#cNote', root).value.trim();
          if (!body) return;
          addNote('client', c.username, body).then(function (res) {
            if (res.error) { toast('Could not add that note.', 'bad'); return; }
            toast('Note added.');
            closeDrawer();
            loadAll();
          });
        });
      });
  }

  /* ---- ORDERS  (the payment desk) ---- */
  const ordF = { q: '', status: 'all', date: 'all', from: '', to: '',
                 sort: 'created_at', dir: 'desc', page: 1, size: 20 };

  function filteredOrders() {
    const q = ordF.q.trim().toLowerCase();
    const rows = state.orders.filter(function (o) {
      if (ordF.status !== 'all' && o.status !== ordF.status) return false;
      if (!inRange(o.created_at, ordF.date, ordF.from, ordF.to)) return false;
      if (!q) return true;
      return [o.ref, o.customer_name, o.business, o.phone, o.email].some(v => String(v || '').toLowerCase().includes(q));
    });
    return sortRows(rows, ordF.sort, ordF.dir, function (r, by) {
      if (by === 'created_at') return Date.parse(r.created_at) || 0;
      if (by === 'paid' || by === 'total') return Number(r[by]) || 0;
      return r[by];
    });
  }

  function itemsText(items) {
    if (!Array.isArray(items)) return '—';
    return items.map(function (i) {
      const line = i.step ? i.price + (i.qty - 1) * i.step : i.price * i.qty;
      return i.name + ' x' + i.qty + ' — ' + money(line);
    }).join(', ');
  }

  VIEWS.orders = function () {
    const cols = [
      { label: 'Reference', sort: 'ref' }, { label: 'Business', sort: 'business' },
      { label: 'Contact', sort: 'customer_name' }, { label: 'Phone' },
      { label: 'Paid', sort: 'paid' }, { label: 'Total', sort: 'total' },
      { label: 'Status', sort: 'status' }, { label: 'Date', sort: 'created_at' }, { label: 'Actions' }
    ];
    const rows = filteredOrders();
    const p = paginate(rows, ordF.page, ordF.size);

    const verified = state.orders.filter(o => o.status === 'verified');
    const received = verified.reduce((s, o) => s + Number(o.paid || 0), 0);
    const due = verified.reduce((s, o) => s + Math.max(0, Number(o.total || 0) - Number(o.paid || 0)), 0);

    const body = rows.length
      ? '<div class="tablewrap"><table class="tbl"><thead>' + sortableHead(cols, ordF) + '</thead><tbody>' +
        p.slice.map(o => '<tr>' +
          '<td><strong>' + esc(o.ref) + '</strong></td>' +
          '<td>' + esc(o.business || '—') + '</td>' +
          '<td>' + esc(o.customer_name || '—') + '</td>' +
          '<td class="num">' + esc(o.phone || '—') + '</td>' +
          '<td class="num">' + money(o.paid) + '</td>' +
          '<td class="num">' + money(o.total) + '</td>' +
          '<td>' + badge(o.status) + '</td>' +
          '<td class="num">' + fmtDate(o.created_at) + '</td>' +
          '<td><div class="acts">' +
            '<button data-order="' + esc(o.ref) + '" aria-label="Open order"><i class="fa-solid fa-eye"></i></button>' +
            '<button data-owa="' + esc(o.ref) + '" aria-label="WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>' +
          '</div></td></tr>').join('') + '</tbody></table></div>' + pagerHtml(p, ordF.size)
      : emptyState(state.orders.length ? 'Nothing matches those filters' : 'No orders yet',
          state.orders.length ? 'Loosen a filter, or reset them.'
            : 'They appear here the moment a customer checks out on the site.');

    $('#view').innerHTML =
      pageHead('Orders', 'Payments to check, and what each customer bought.',
        '<button class="btn--ghost" id="ordExport"><i class="fa-solid fa-file-arrow-down"></i> Export CSV</button>') +
      '<div class="grid grid--kpi" style="margin-bottom:14px">' +
        kpi('Pending', String(state.orders.filter(o => o.status === 'pending').length), 'fa-hourglass-half', { text: 'to check', cls: 'is-flat' }, '') +
        kpi('Verified', String(verified.length), 'fa-circle-check', { text: 'confirmed', cls: '' }, '') +
        kpi('Received', money(received), 'fa-indian-rupee-sign', { text: 'verified only', cls: 'is-flat' }, '') +
        kpi('Balance due', money(due), 'fa-scale-balanced', { text: 'on delivery', cls: 'is-flat' }, '') +
      '</div>' +
      '<section class="card">' +
        '<div class="filters">' +
          '<div class="fld"><label for="ordQ">Search</label>' +
            '<input class="inp" id="ordQ" type="search" placeholder="Reference, name, business or phone" value="' + esc(ordF.q) + '" /></div>' +
          selectHtml('ordStatus', 'Status', [['all', 'All status'], ['pending', 'Pending'], ['verified', 'Verified'], ['rejected', 'Rejected']], ordF.status) +
          dateFilterHtml('ord', ordF) +
        '</div>' +
        '<div class="filters__foot"><span>Showing ' + rows.length + ' of ' + state.orders.length + ' orders</span>' +
          '<button class="btn--ghost btn--sm" id="ordReset"><i class="fa-solid fa-rotate-left"></i> Reset filters</button></div>' +
        body +
      '</section>';

    const again = VIEWS.orders;
    wireFilters({ '#ordQ': 'q', '#ordStatus': 'status', '#ordDate': 'date', '#ordFrom': 'from', '#ordTo': 'to' }, ordF, again);
    wireSort($('#view'), ordF, again);
    wirePager($('#view'), ordF, again);
    $('#ordReset').addEventListener('click', function () {
      Object.assign(ordF, { q: '', status: 'all', date: 'all', from: '', to: '', page: 1 });
      again();
    });
    $('#ordExport').addEventListener('click', function () {
      exportCsv('we3-orders.csv', [
        { label: 'Reference', get: o => o.ref }, { label: 'Date', get: o => fmtWhen(o.created_at) },
        { label: 'Business', get: o => o.business }, { label: 'Contact', get: o => o.customer_name },
        { label: 'Phone', get: o => o.phone }, { label: 'Email', get: o => o.email },
        { label: 'Items', get: o => itemsText(o.items) }, { label: 'Total', get: o => o.total },
        { label: 'Paid', get: o => o.paid }, { label: 'Mode', get: o => o.pay_mode },
        { label: 'Status', get: o => o.status }, { label: 'Note', get: o => o.note }
      ], rows);
    });
    $$('#view [data-order]').forEach(b => b.addEventListener('click', () => openOrder(b.dataset.order)));
    $$('#view [data-owa]').forEach(b => b.addEventListener('click', function () {
      const o = state.orders.find(x => x.ref === b.dataset.owa);
      if (o) messageCustomer(o);
    }));
  };

  function openOrder(ref) {
    const o = state.orders.find(x => x.ref === ref);
    if (!o) { toast('That order is no longer there.', 'bad'); return; }
    const events = state.orderEvents.filter(e => e.order_ref === ref);
    const balance = Math.max(0, Number(o.total || 0) - Number(o.paid || 0));

    openDrawer('Order ' + o.ref,
      '<div class="dsec"><h3>Customer</h3><dl class="dl">' +
        '<div><dt>Business</dt><dd>' + esc(o.business || '—') + '</dd></div>' +
        '<div><dt>Contact</dt><dd>' + esc(o.customer_name || '—') + '</dd></div>' +
        '<div><dt>Phone</dt><dd>' + esc(o.phone || '—') + '</dd></div>' +
        '<div><dt>Email</dt><dd>' + esc(o.email || '—') + '</dd></div>' +
      '</dl>' + (o.brief ? '<p class="msg" style="margin-top:10px"><strong>What they need:</strong> ' + esc(o.brief) + '</p>' : '') + '</div>' +
      '<div class="dsec"><h3>Order</h3><dl class="dl">' +
        '<div><dt>Ordered</dt><dd>' + esc(itemsText(o.items)) + '</dd></div>' +
        '<div><dt>Total</dt><dd>' + money(o.total) + '</dd></div>' +
        '<div><dt>Paid now</dt><dd>' + money(o.paid) + ' (' + esc(o.pay_mode === 'half' ? '50%' : 'full') + ')</dd></div>' +
        '<div><dt>Balance</dt><dd>' + money(balance) + '</dd></div>' +
        '<div><dt>Placed</dt><dd>' + fmtWhen(o.created_at) + '</dd></div>' +
      '</dl></div>' +
      '<div class="dsec"><h3>Payment</h3>' +
        '<div class="chipbar" id="oMarks">' +
          ['pending', 'verified', 'rejected'].map(s =>
            '<button class="chip2' + (o.status === s ? ' is-on' : '') + '" data-mark="' + s + '">' +
            (s === 'pending' ? 'Pending' : s === 'verified' ? 'Verified' : 'Rejected') + '</button>').join('') +
        '</div>' +
        '<div class="fld" style="margin-top:12px"><label for="oNote">Message shown to the customer</label>' +
          '<textarea class="inp" id="oNote" placeholder="They read this on their own order.">' + esc(o.note || '') + '</textarea></div>' +
        '<button class="btn--green btn--block" id="oSaveNote"><i class="fa-solid fa-check"></i> Save note</button>' +
        '<button class="btn--ghost btn--block" id="oWa"><i class="fa-brands fa-whatsapp"></i> Message customer</button>' +
      '</div>' +
      '<div class="dsec"><h3>History</h3>' +
        (events.length
          ? '<ul class="tl">' + events.map(e => '<li><p><strong>@' + esc(e.actor || 'someone') + '</strong> ' +
              (e.from_status !== e.to_status ? 'marked it ' + esc(e.to_status) : 'changed the note') +
              '</p><em>' + fmtWhen(e.at) + '</em></li>').join('') + '</ul>'
          : '<p class="msg">No changes yet.</p>') + '</div>',
      function (root) {
        $$('[data-mark]', root).forEach(function (b) {
          b.addEventListener('click', function () {
            const status = b.dataset.mark;
            if (status === o.status) return;
            if (!confirmStatus(o, status)) return;
            b.disabled = true;
            client.from('orders').update({ status: status, updated_at: new Date().toISOString() })
              .eq('ref', o.ref).then(function (res) {
                b.disabled = false;
                if (res.error) { toast(res.error.message, 'bad'); return; }
                toast('Order marked ' + status + '.');
                closeDrawer();
                loadAll();
              });
          });
        });
        $('#oSaveNote', root).addEventListener('click', function () {
          const btn = this;
          btn.disabled = true;
          client.from('orders').update({ note: $('#oNote', root).value.trim() || null,
                                         updated_at: new Date().toISOString() })
            .eq('ref', o.ref).then(function (res) {
              btn.disabled = false;
              if (res.error) { toast(res.error.message, 'bad'); return; }
              toast('Changes saved.');
              closeDrawer();
              loadAll();
            });
        });
        $('#oWa', root).addEventListener('click', () => messageCustomer(o));
      });
  }

  /** Asks before moving money — the amount and the customer are in the question. */
  function confirmStatus(o, status) {
    const balance = Math.max(0, Number(o.total || 0) - Number(o.paid || 0));
    return confirm(
      (status === 'verified' ? 'Mark this payment as RECEIVED?'
        : status === 'rejected' ? 'Mark this payment as NOT received?'
        : 'Put this order back to pending?') + '\n\n' +
      o.ref + ' — ' + (o.business || o.customer_name) + '\n' +
      (o.customer_name || '') + ' · ' + (o.phone || '') + '\n' +
      'Paid ' + money(o.paid) + ' of ' + money(o.total) +
        (balance > 0 ? '  (balance ' + money(balance) + ')' : '') + '\n\n' +
      'The customer sees this straight away, and this is saved against your name.');
  }

  function messageCustomer(o) {
    const balance = Math.max(0, Number(o.total || 0) - Number(o.paid || 0));
    const name = o.customer_name || '';
    let msg;
    if (o.status === 'verified') {
      msg = 'Hi ' + name + ', your payment of ' + money(o.paid) + ' for order ' + o.ref +
            ' is confirmed. We are starting work now.' +
            (balance > 0 ? ' Balance of ' + money(balance) + ' is due on delivery.' : '');
    } else if (o.status === 'rejected') {
      msg = 'Hi ' + name + ', we could not find your payment of ' + money(o.paid) +
            ' for order ' + o.ref + ' yet. Could you send the payment screenshot again?';
    } else {
      msg = 'Hi ' + name + ', we have your order ' + o.ref + ' and are checking the payment of ' +
            money(o.paid) + '. We will confirm shortly.';
    }
    if (o.note) msg += '\n\n' + o.note;
    msg += '\n\nYou can see it under My Orders on our site.';
    waTo(o.phone, msg);
  }

  /* ---- PROJECTS ---- */
  const PROJECT_STATUS = ['Not Started', 'Planning', 'Design', 'Development', 'Revision', 'Ready', 'Completed', 'On Hold'];
  const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
  const TASK_STATUS = ['To Do', 'Doing', 'Done'];

  const proF = { q: '', status: 'all', date: 'all', from: '', to: '', sort: 'created_at', dir: 'desc', page: 1, size: 20 };

  VIEWS.projects = function () {
    const q = proF.q.trim().toLowerCase();
    let rows = state.projects.filter(function (p) {
      if (proF.status !== 'all' && p.status !== proF.status) return false;
      if (!inRange(p.created_at, proF.date, proF.from, proF.to)) return false;
      if (!q) return true;
      return [p.name, p.client_name, p.service, p.assignee].some(v => String(v || '').toLowerCase().includes(q));
    });
    rows = sortRows(rows, proF.sort, proF.dir, (r, by) =>
      by === 'created_at' || by === 'deadline' ? (Date.parse(r[by]) || 0)
      : by === 'budget' ? Number(r[by]) || 0 : r[by]);

    const p = paginate(rows, proF.page, proF.size);
    const cols = [
      { label: 'Project', sort: 'name' }, { label: 'Client', sort: 'client_name' },
      { label: 'Service' }, { label: 'Status', sort: 'status' }, { label: 'Progress' },
      { label: 'Budget', sort: 'budget' }, { label: 'Deadline', sort: 'deadline' }, { label: 'Actions' }
    ];

    const body = rows.length
      ? '<div class="tablewrap"><table class="tbl"><thead>' + sortableHead(cols, proF) + '</thead><tbody>' +
        p.slice.map(pr => '<tr>' +
          '<td><strong>' + esc(pr.name) + '</strong></td>' +
          '<td>' + esc(pr.client_name || '—') + '</td>' +
          '<td>' + esc(pr.service || '—') + '</td>' +
          '<td>' + badge(pr.status) + '</td>' +
          '<td style="min-width:110px"><div class="prog"><div class="prog__fill" style="width:' +
            Math.max(0, Math.min(100, Number(pr.progress) || 0)) + '%"></div></div>' +
            '<span style="font-size:11px">' + (Number(pr.progress) || 0) + '%</span></td>' +
          '<td class="num">' + money(pr.budget) + '</td>' +
          '<td class="num">' + fmtDate(pr.deadline) + '</td>' +
          '<td><div class="acts">' +
            '<button data-pro="' + esc(pr.id) + '" aria-label="Open project"><i class="fa-solid fa-eye"></i></button>' +
            '<button data-proedit="' + esc(pr.id) + '" aria-label="Edit"><i class="fa-solid fa-pen"></i></button>' +
            '<button class="is-danger" data-prodel="' + esc(pr.id) + '" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>' +
          '</div></td></tr>').join('') + '</tbody></table></div>' + pagerHtml(p, proF.size)
      : emptyState(state.projects.length ? 'Nothing matches those filters' : 'No projects yet',
          state.projects.length ? 'Loosen a filter, or reset them.' : 'Start one when a payment is confirmed.',
          '<button class="btn--green" data-newpro><i class="fa-solid fa-plus"></i> Add project</button>');

    $('#view').innerHTML =
      pageHead('Projects', 'What is being built, for whom, and by when.',
        '<button class="btn--ghost" id="proExport"><i class="fa-solid fa-file-arrow-down"></i> Export CSV</button>' +
        '<button class="btn--green" id="proNew"><i class="fa-solid fa-plus"></i> Add project</button>') +
      '<section class="card">' +
        '<div class="filters">' +
          '<div class="fld"><label for="proQ">Search</label>' +
            '<input class="inp" id="proQ" type="search" placeholder="Project, client, service or person" value="' + esc(proF.q) + '" /></div>' +
          selectHtml('proStatus', 'Status', [['all', 'All status']].concat(PROJECT_STATUS.map(s => [s, s])), proF.status) +
          dateFilterHtml('pro', proF) +
        '</div>' +
        '<div class="filters__foot"><span>Showing ' + rows.length + ' of ' + state.projects.length + ' projects</span>' +
          '<button class="btn--ghost btn--sm" id="proReset"><i class="fa-solid fa-rotate-left"></i> Reset filters</button></div>' +
        body +
      '</section>';

    const again = VIEWS.projects;
    wireFilters({ '#proQ': 'q', '#proStatus': 'status', '#proDate': 'date', '#proFrom': 'from', '#proTo': 'to' }, proF, again);
    wireSort($('#view'), proF, again);
    wirePager($('#view'), proF, again);
    $('#proReset').addEventListener('click', function () {
      Object.assign(proF, { q: '', status: 'all', date: 'all', from: '', to: '', page: 1 });
      again();
    });
    $('#proNew').addEventListener('click', () => editProject(null));
    $$('#view [data-newpro]').forEach(b => b.addEventListener('click', () => editProject(null)));
    $('#proExport').addEventListener('click', function () {
      exportCsv('we3-projects.csv', [
        { label: 'Project', get: r => r.name }, { label: 'Client', get: r => r.client_name },
        { label: 'Service', get: r => r.service }, { label: 'Status', get: r => r.status },
        { label: 'Progress', get: r => r.progress }, { label: 'Budget', get: r => r.budget },
        { label: 'Paid', get: r => r.paid }, { label: 'Start', get: r => fmtDate(r.start_date) },
        { label: 'Deadline', get: r => fmtDate(r.deadline) }, { label: 'Assignee', get: r => r.assignee }
      ], rows);
    });
    $$('#view [data-pro]').forEach(b => b.addEventListener('click', () => openProject(b.dataset.pro)));
    $$('#view [data-proedit]').forEach(b => b.addEventListener('click', () => editProject(b.dataset.proedit)));
    $$('#view [data-prodel]').forEach(b => b.addEventListener('click', function () {
      const pr = state.projects.find(x => String(x.id) === b.dataset.prodel);
      if (!pr || !confirmDanger('Delete this project?', pr.name + ' — its tasks go with it.')) return;
      client.from('projects').delete().eq('id', pr.id).then(function (res) {
        if (res.error) { toast(res.error.message, 'bad'); return; }
        toast('Project deleted.');
        loadAll();
      });
    }));
  };

  function editProject(id) {
    const pr = id ? state.projects.find(x => String(x.id) === String(id)) : null;
    const people = clients();

    openDrawer(pr ? 'Edit project' : 'New project',
      '<div class="fld"><label for="pName">Project name</label>' +
        '<input class="inp" id="pName" value="' + esc(pr ? pr.name : '') + '" placeholder="Website for Sharma Coaching" /></div>' +
      '<div class="fld"><label for="pClient">Client</label><select class="inp" id="pClient">' +
        '<option value="">— none —</option>' +
        people.map(c => '<option value="' + esc(c.username) + '"' +
          (pr && pr.client_name === c.name ? ' selected' : '') + '>' +
          esc(c.name + (c.business ? ' · ' + c.business : '')) + '</option>').join('') +
      '</select></div>' +
      '<div class="fld"><label for="pService">Service</label><select class="inp" id="pService">' +
        state.services.map(s => '<option value="' + esc(s.name) + '"' +
          (pr && pr.service === s.name ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') +
      '</select></div>' +
      '<div class="fld"><label for="pStatus">Status</label><select class="inp" id="pStatus">' +
        PROJECT_STATUS.map(s => '<option value="' + s + '"' +
          (pr && pr.status === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div>' +
      '<div class="fld"><label for="pProgress">Progress (%)</label>' +
        '<input class="inp" id="pProgress" type="number" min="0" max="100" value="' + (pr ? Number(pr.progress) || 0 : 0) + '" /></div>' +
      '<div class="fld"><label for="pStart">Start date</label>' +
        '<input class="inp" id="pStart" type="date" value="' + esc(pr && pr.start_date ? pr.start_date : '') + '" /></div>' +
      '<div class="fld"><label for="pDeadline">Deadline</label>' +
        '<input class="inp" id="pDeadline" type="date" value="' + esc(pr && pr.deadline ? pr.deadline : '') + '" /></div>' +
      '<div class="fld"><label for="pBudget">Budget ₹</label>' +
        '<input class="inp" id="pBudget" type="number" min="0" value="' + (pr ? Number(pr.budget) || 0 : 0) + '" /></div>' +
      '<div class="fld"><label for="pPaid">Paid ₹</label>' +
        '<input class="inp" id="pPaid" type="number" min="0" value="' + (pr ? Number(pr.paid) || 0 : 0) + '" /></div>' +
      '<div class="fld"><label for="pAssignee">Assigned to</label><select class="inp" id="pAssignee">' +
        '<option value="">— nobody yet —</option>' +
        state.people.filter(x => x.is_admin).map(x => '<option value="' + esc(x.username) + '"' +
          (pr && pr.assignee === x.username ? ' selected' : '') + '>@' + esc(x.username) + '</option>').join('') +
      '</select></div>' +
      '<div class="fld"><label for="pNotes">Notes</label>' +
        '<textarea class="inp" id="pNotes">' + esc(pr ? pr.notes || '' : '') + '</textarea></div>' +
      '<p class="msg" id="pErr" hidden></p>' +
      '<button class="btn--green btn--block" id="pSave"><i class="fa-solid fa-check"></i> ' +
        (pr ? 'Save changes' : 'Create project') + '</button>',
      function (root) {
        $('#pSave', root).addEventListener('click', function () {
          const name = $('#pName', root).value.trim();
          const err = $('#pErr', root);
          if (name.length < 2) {
            err.hidden = false; err.className = 'msg is-bad';
            err.textContent = 'Give the project a name.';
            return;
          }
          const chosen = people.find(c => c.username === $('#pClient', root).value);
          const row = {
            name: name,
            client_name: chosen ? chosen.name : null,
            phone: chosen ? chosen.phone : null,
            service: $('#pService', root).value || null,
            status: $('#pStatus', root).value,
            progress: Math.max(0, Math.min(100, Number($('#pProgress', root).value) || 0)),
            start_date: $('#pStart', root).value || null,
            deadline: $('#pDeadline', root).value || null,
            budget: Number($('#pBudget', root).value) || 0,
            paid: Number($('#pPaid', root).value) || 0,
            assignee: $('#pAssignee', root).value || null,
            notes: $('#pNotes', root).value.trim() || null,
            updated_at: new Date().toISOString()
          };

          const btn = this;
          btn.disabled = true;
          const req = pr
            ? client.from('projects').update(row).eq('id', pr.id)
            : client.from('projects').insert(row);

          req.then(function (res) {
            btn.disabled = false;
            if (res.error) {
              err.hidden = false; err.className = 'msg is-bad';
              err.textContent = res.error.message;
              return;
            }
            toast(pr ? 'Project updated successfully.' : 'Project created successfully.');
            closeDrawer();
            loadAll();
          });
        });
      });
  }

  function openProject(id) {
    const pr = state.projects.find(x => String(x.id) === String(id));
    if (!pr) { toast('That project is no longer there.', 'bad'); return; }
    const tasks = state.tasks.filter(t => String(t.project_id) === String(pr.id));
    const due = Math.max(0, Number(pr.budget || 0) - Number(pr.paid || 0));

    openDrawer(pr.name,
      '<div class="dsec"><h3>Overview</h3><dl class="dl">' +
        '<div><dt>Client</dt><dd>' + esc(pr.client_name || '—') + '</dd></div>' +
        '<div><dt>Service</dt><dd>' + esc(pr.service || '—') + '</dd></div>' +
        '<div><dt>Status</dt><dd>' + badge(pr.status) + '</dd></div>' +
        '<div><dt>Assigned to</dt><dd>' + (pr.assignee ? '@' + esc(pr.assignee) : '—') + '</dd></div>' +
        '<div><dt>Start</dt><dd>' + fmtDate(pr.start_date) + '</dd></div>' +
        '<div><dt>Deadline</dt><dd>' + fmtDate(pr.deadline) + '</dd></div>' +
      '</dl>' +
      '<div class="prog" style="margin-top:12px"><div class="prog__fill" style="width:' +
        Math.max(0, Math.min(100, Number(pr.progress) || 0)) + '%"></div></div>' +
      '<p class="msg">' + (Number(pr.progress) || 0) + '% complete</p></div>' +
      '<div class="dsec"><h3>Payment</h3><dl class="dl">' +
        '<div><dt>Budget</dt><dd>' + money(pr.budget) + '</dd></div>' +
        '<div><dt>Paid</dt><dd>' + money(pr.paid) + '</dd></div>' +
        '<div><dt>Remaining</dt><dd>' + money(due) + '</dd></div>' +
        '<div><dt>Status</dt><dd>' + badge(!Number(pr.budget) ? '—' : Number(pr.paid) >= Number(pr.budget) ? 'Paid' : Number(pr.paid) > 0 ? 'Partial' : 'Pending') + '</dd></div>' +
      '</dl></div>' +
      (pr.notes ? '<div class="dsec"><h3>Notes</h3><p class="msg">' + esc(pr.notes) + '</p></div>' : '') +
      '<div class="dsec"><h3>Tasks</h3>' +
        (tasks.length
          ? '<ul class="tl" id="tList">' + tasks.map(t => '<li><p><strong>' + esc(t.title) + '</strong> ' +
              badge(t.status) + ' ' + badge(t.priority) + '</p><em>' +
              (t.assignee ? '@' + esc(t.assignee) + ' · ' : '') +
              (t.due_date ? 'due ' + fmtDate(t.due_date) : 'no due date') + '</em>' +
              '<div class="acts" style="margin-top:6px">' +
                '<button data-tnext="' + esc(t.id) + '" aria-label="Advance"><i class="fa-solid fa-forward-step"></i></button>' +
                '<button class="is-danger" data-tdel="' + esc(t.id) + '" aria-label="Delete task"><i class="fa-solid fa-trash"></i></button>' +
              '</div></li>').join('') + '</ul>'
          : '<p class="msg">No tasks yet.</p>') +
        '<div class="fld" style="margin-top:12px"><label for="tTitle">New task</label>' +
          '<input class="inp" id="tTitle" placeholder="What needs doing?" /></div>' +
        '<div class="fld"><label for="tPriority">Priority</label><select class="inp" id="tPriority">' +
          PRIORITIES.map(x => '<option' + (x === 'Medium' ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>' +
        '<div class="fld"><label for="tDue">Due date</label><input class="inp" id="tDue" type="date" /></div>' +
        '<button class="btn--ghost btn--block" id="tAdd">Add task</button>' +
      '</div>' +
      '<button class="btn--green btn--block" id="pEdit"><i class="fa-solid fa-pen"></i> Edit project</button>',
      function (root) {
        $('#pEdit', root).addEventListener('click', function () { closeDrawer(); editProject(pr.id); });

        $('#tAdd', root).addEventListener('click', function () {
          const title = $('#tTitle', root).value.trim();
          if (!title) return;
          this.disabled = true;
          client.from('project_tasks').insert({
            project_id: pr.id, title: title,
            priority: $('#tPriority', root).value,
            due_date: $('#tDue', root).value || null,
            assignee: pr.assignee || null
          }).then(function (res) {
            if (res.error) { toast(res.error.message, 'bad'); return; }
            toast('Task added.');
            closeDrawer();
            loadAll();
          });
        });

        $$('[data-tnext]', root).forEach(b => b.addEventListener('click', function () {
          const t = tasks.find(x => String(x.id) === b.dataset.tnext);
          const next = TASK_STATUS[(TASK_STATUS.indexOf(t.status) + 1) % TASK_STATUS.length];
          client.from('project_tasks').update({ status: next }).eq('id', t.id).then(function (res) {
            if (res.error) { toast(res.error.message, 'bad'); return; }
            toast('Task moved to ' + next + '.');
            closeDrawer();
            loadAll();
          });
        }));

        $$('[data-tdel]', root).forEach(b => b.addEventListener('click', function () {
          const t = tasks.find(x => String(x.id) === b.dataset.tdel);
          if (!t || !confirmDanger('Delete this task?', t.title)) return;
          client.from('project_tasks').delete().eq('id', t.id).then(function (res) {
            if (res.error) { toast(res.error.message, 'bad'); return; }
            toast('Task deleted.');
            closeDrawer();
            loadAll();
          });
        }));
      });
  }

  /* ---- SERVICES ---- */
  VIEWS.services = function () {
    const cards = state.services.map(function (s) {
      const enq = state.enquiries.filter(e => e.service === s.name).length;
      const sold = state.orders.filter(o => o.status === 'verified' &&
        (Array.isArray(o.items) ? o.items : []).some(i => i.name === s.name)).length;
      return '<article class="card">' +
        '<div class="card__head"><h2>' + esc(s.name) + '</h2>' +
        (s.active ? '<span class="tag tag--green">Active</span>' : '<span class="tag">Off</span>') + '</div>' +
        '<p class="kpi__value" style="font-size:24px">' + money(s.price) + '</p>' +
        '<p class="msg" style="margin:8px 0 12px">' + esc(s.description || '') + '</p>' +
        '<dl class="dl"><div><dt>Enquiries</dt><dd>' + enq + '</dd></div>' +
        '<div><dt>Orders (verified)</dt><dd>' + sold + '</dd></div></dl>' +
        '<div class="chipbar" style="margin-top:12px">' +
          '<button class="btn--ghost btn--sm" data-sedit="' + esc(s.id) + '"><i class="fa-solid fa-pen"></i> Edit</button>' +
          '<button class="btn--ghost btn--sm" data-stoggle="' + esc(s.id) + '">' +
            (s.active ? '<i class="fa-solid fa-eye-slash"></i> Disable' : '<i class="fa-solid fa-eye"></i> Enable') + '</button>' +
          '<button class="btn--ghost btn--sm btn--danger" data-sdel="' + esc(s.id) + '" aria-label="Delete service"><i class="fa-solid fa-trash"></i></button>' +
        '</div></article>';
    }).join('');

    $('#view').innerHTML =
      pageHead('Services', 'Your catalogue, and how much interest each one gets.',
        '<button class="btn--green" id="svcNew"><i class="fa-solid fa-plus"></i> Add service</button>') +
      (state.services.length
        ? '<div class="grid grid--halves">' + cards + '</div>' +
          '<p class="msg" style="margin-top:14px">The public site keeps its own prices. Changing one here ' +
          'records the change for the team — it does not rewrite the website.</p>'
        : emptyState('No services yet', 'Add the work you sell so enquiries and orders can be counted against it.',
            '<button class="btn--green" id="svcNew2"><i class="fa-solid fa-plus"></i> Add service</button>'));

    const open = () => editService(null);
    if ($('#svcNew')) $('#svcNew').addEventListener('click', open);
    if ($('#svcNew2')) $('#svcNew2').addEventListener('click', open);

    $$('#view [data-sedit]').forEach(b => b.addEventListener('click', () => editService(b.dataset.sedit)));
    $$('#view [data-stoggle]').forEach(b => b.addEventListener('click', function () {
      const s = state.services.find(x => String(x.id) === b.dataset.stoggle);
      client.from('services').update({ active: !s.active }).eq('id', s.id).then(function (res) {
        if (res.error) { toast(res.error.message, 'bad'); return; }
        toast(s.name + (s.active ? ' disabled.' : ' enabled.'));
        loadAll();
      });
    }));
    $$('#view [data-sdel]').forEach(b => b.addEventListener('click', function () {
      const s = state.services.find(x => String(x.id) === b.dataset.sdel);
      if (!s || !confirmDanger('Delete this service?', s.name)) return;
      client.from('services').delete().eq('id', s.id).then(function (res) {
        if (res.error) { toast(res.error.message, 'bad'); return; }
        toast('Service deleted.');
        loadAll();
      });
    }));
  };

  function editService(id) {
    const s = id ? state.services.find(x => String(x.id) === String(id)) : null;
    openDrawer(s ? 'Edit service' : 'New service',
      '<div class="fld"><label for="sName">Name</label>' +
        '<input class="inp" id="sName" value="' + esc(s ? s.name : '') + '" /></div>' +
      '<div class="fld"><label for="sSlug">Short code</label>' +
        '<input class="inp" id="sSlug" value="' + esc(s ? s.slug : '') + '" placeholder="website" ' +
        (s ? 'readonly' : '') + ' /></div>' +
      '<div class="fld"><label for="sPrice">Price ₹</label>' +
        '<input class="inp" id="sPrice" type="number" min="0" value="' + (s ? Number(s.price) || 0 : 0) + '" /></div>' +
      '<div class="fld"><label for="sDesc">Description</label>' +
        '<textarea class="inp" id="sDesc">' + esc(s ? s.description || '' : '') + '</textarea></div>' +
      '<p class="msg" id="sErr" hidden></p>' +
      '<button class="btn--green btn--block" id="sSave"><i class="fa-solid fa-check"></i> ' +
        (s ? 'Save changes' : 'Create service') + '</button>',
      function (root) {
        $('#sSave', root).addEventListener('click', function () {
          const name = $('#sName', root).value.trim();
          const slug = $('#sSlug', root).value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
          const err = $('#sErr', root);
          const bad = m => { err.hidden = false; err.className = 'msg is-bad'; err.textContent = m; };

          if (name.length < 2) return bad('Give the service a name.');
          if (!slug) return bad('A short code is needed — letters and numbers only.');

          const row = {
            name: name, slug: slug,
            price: Number($('#sPrice', root).value) || 0,
            description: $('#sDesc', root).value.trim() || null
          };
          const btn = this;
          btn.disabled = true;
          const req = s ? client.from('services').update(row).eq('id', s.id)
                        : client.from('services').insert(row);
          req.then(function (res) {
            btn.disabled = false;
            if (res.error) return bad(res.error.message);
            toast(s ? 'Service updated.' : 'Service created successfully.');
            closeDrawer();
            loadAll();
          });
        });
      });
  }

  /* ---- USER ACTIVITY ---- */
  const actF = { q: '', kind: 'all', device: 'all', date: 'all', from: '', to: '', page: 1, size: 50 };

  VIEWS.activity = function () {
    const kinds = Array.from(new Set(state.activities.map(a => a.kind).filter(Boolean))).sort();
    const devices = Array.from(new Set(state.activities.map(a => a.device).filter(Boolean))).sort();
    const q = actF.q.trim().toLowerCase();

    const rows = state.activities.filter(function (a) {
      if (actF.kind !== 'all' && a.kind !== actF.kind) return false;
      if (actF.device !== 'all' && a.device !== actF.device) return false;
      if (!inRange(a.at, actF.date, actF.from, actF.to)) return false;
      if (!q) return true;
      return [a.username, a.session_id, a.detail, a.page, a.referrer].some(v => String(v || '').toLowerCase().includes(q));
    });
    const p = paginate(rows, actF.page, actF.size);

    const body = rows.length
      ? '<div class="tablewrap"><table class="tbl"><thead><tr>' +
          '<th>Who</th><th>Did what</th><th>Detail</th><th>Page</th><th>Device</th><th>Source</th><th>When</th>' +
        '</tr></thead><tbody>' +
        p.slice.map(a => '<tr>' +
          '<td><strong>' + esc(a.username ? '@' + a.username : 'Visitor') + '</strong>' +
            (a.session_id ? '<br /><span style="font-size:11px">' + esc(String(a.session_id).slice(0, 10)) + '</span>' : '') + '</td>' +
          '<td>' + esc(a.kind) + '</td>' +
          '<td>' + esc(a.detail || '—') + '</td>' +
          '<td>' + esc(a.page || '—') + '</td>' +
          '<td>' + esc(a.device || '—') + '</td>' +
          '<td>' + esc(a.referrer || 'direct') + '</td>' +
          '<td class="num">' + ago(a.at) + '</td></tr>').join('') +
        '</tbody></table></div>' + pagerHtml(p, actF.size)
      : emptyState(state.activities.length ? 'Nothing matches those filters' : 'No activity yet',
          state.activities.length ? 'Loosen a filter, or clear them.'
            : 'Visits, clicks and form opens on the public site will appear here.');

    $('#view').innerHTML =
      pageHead('User Activity', 'What people are actually doing on the website.',
        '<button class="btn--ghost" id="actExport"><i class="fa-solid fa-file-arrow-down"></i> Export activity</button>') +
      '<section class="card">' +
        '<div class="filters">' +
          '<div class="fld"><label for="actQ">Search</label>' +
            '<input class="inp" id="actQ" type="search" placeholder="User, session, page or detail" value="' + esc(actF.q) + '" /></div>' +
          selectHtml('actKind', 'Activity', [['all', 'All activity']].concat(kinds.map(k => [k, k])), actF.kind) +
          selectHtml('actDevice', 'Device', [['all', 'All devices']].concat(devices.map(d => [d, d])), actF.device) +
          dateFilterHtml('act', actF) +
        '</div>' +
        '<div class="filters__foot"><span>Showing ' + rows.length + ' of ' + state.activities.length + ' events</span>' +
          '<button class="btn--ghost btn--sm" id="actReset"><i class="fa-solid fa-rotate-left"></i> Clear filters</button></div>' +
        body +
      '</section>';

    const again = VIEWS.activity;
    wireFilters({ '#actQ': 'q', '#actKind': 'kind', '#actDevice': 'device',
                  '#actDate': 'date', '#actFrom': 'from', '#actTo': 'to' }, actF, again);
    wirePager($('#view'), actF, again);
    $('#actReset').addEventListener('click', function () {
      Object.assign(actF, { q: '', kind: 'all', device: 'all', date: 'all', from: '', to: '', page: 1 });
      again();
    });
    $('#actExport').addEventListener('click', function () {
      exportCsv('we3-activity.csv', [
        { label: 'When', get: a => fmtWhen(a.at) }, { label: 'User', get: a => a.username },
        { label: 'Session', get: a => a.session_id }, { label: 'Activity', get: a => a.kind },
        { label: 'Detail', get: a => a.detail }, { label: 'Page', get: a => a.page },
        { label: 'Device', get: a => a.device }, { label: 'Source', get: a => a.referrer }
      ], rows);
    });
  };

  /* ---- TEAM ---- */
  let manageAccess = false;

  VIEWS.team = function () {
    const team = state.people.filter(p => p.is_admin);
    const others = state.people.filter(p => !p.is_admin);

    const row = p => '<article class="card" style="padding:14px">' +
      '<div class="card__head" style="margin-bottom:8px">' +
        '<h2 style="font-size:14px">@' + esc(p.username) + ' ' +
          (roleLabel(p) ? '<span class="tag ' + (p.is_owner ? 'tag--owner' : 'tag--green') + '">' + roleLabel(p) + '</span>' : '') +
        '</h2>' +
        (manageAccess && me.is_owner && !p.is_owner && p.username !== me.username
          ? '<button class="btn--ghost btn--sm' + (p.is_admin ? ' btn--danger' : '') + '" data-grant="' + esc(p.username) + '">' +
            '<i class="fa-solid ' + (p.is_admin ? 'fa-user-minus' : 'fa-user-plus') + '"></i> ' +
            (p.is_admin ? 'Remove admin' : 'Make co-founder') + '</button>'
          : '') +
      '</div>' +
      '<dl class="dl">' +
        '<div><dt>Name</dt><dd>' + esc(p.full_name || '—') + '</dd></div>' +
        '<div><dt>Phone</dt><dd>' + esc(p.phone || '—') + '</dd></div>' +
        '<div><dt>Joined</dt><dd>' + fmtDate(p.joined) + '</dd></div>' +
        '<div><dt>Last signed in</dt><dd>' + (p.last_login ? fmtWhen(p.last_login) : 'never') + '</dd></div>' +
      '</dl></article>';

    $('#view').innerHTML =
      pageHead('Team', 'Who can get into this panel, and who has been in lately.',
        me.is_owner
          ? '<button class="btn--ghost' + (manageAccess ? ' btn--danger' : '') + '" id="manageBtn">' +
            '<i class="fa-solid ' + (manageAccess ? 'fa-lock-open' : 'fa-lock') + '"></i> ' +
            (manageAccess ? 'Done managing' : 'Manage access') + '</button>'
          : '') +
      '<section class="card" style="margin-bottom:14px"><div class="card__head">' +
        '<h2><i class="fa-solid fa-users-gear"></i> Admins</h2></div>' +
        '<div class="grid grid--halves">' + team.map(row).join('') + '</div></section>' +
      (manageAccess
        ? '<section class="card" style="margin-bottom:14px"><div class="card__head">' +
          '<h2><i class="fa-solid fa-user-plus"></i> Everyone else</h2></div>' +
          (others.length ? '<div class="grid grid--halves">' + others.map(row).join('') + '</div>'
                         : '<p class="msg">Nobody else has registered yet.</p>') + '</section>'
        : '') +
      '<section class="card"><div class="card__head"><h2><i class="fa-solid fa-clock-rotate-left"></i> Access changes</h2></div>' +
        (state.roleEvents.length
          ? '<ul class="tl">' + state.roleEvents.map(e => '<li><p><strong>@' + esc(e.actor || 'someone') +
              '</strong> made <strong>@' + esc(e.target) + '</strong> ' +
              (e.made_admin ? 'a co-founder' : 'no longer an admin') + '</p><em>' + fmtWhen(e.at) + '</em></li>').join('') + '</ul>'
          : '<p class="msg">Nobody’s access has changed yet.</p>') + '</section>';

    if ($('#manageBtn')) $('#manageBtn').addEventListener('click', function () {
      manageAccess = !manageAccess;
      VIEWS.team();
    });

    $$('#view [data-grant]').forEach(b => b.addEventListener('click', function () {
      const p = state.people.find(x => x.username === b.dataset.grant);
      const makeAdmin = !p.is_admin;
      const who = '@' + p.username + (p.full_name ? ' (' + p.full_name + ')' : '');
      const ok = confirm(makeAdmin
        ? 'Make ' + who + ' a co-founder?\n\nThey will see every order and every customer, ' +
          'and be able to mark payments received or not received.'
        : 'Remove admin from ' + who + '?\n\nThey lose access to this panel straight away.');
      if (!ok) return;
      b.disabled = true;
      client.rpc('set_team_admin', { p_username: p.username, p_admin: makeAdmin })
        .then(function (res) {
          b.disabled = false;
          if (res.error) { toast(res.error.message, 'bad'); return; }
          toast(makeAdmin ? 'Added as a co-founder.' : 'Admin removed.');
          loadAll();
        }, function () {
          b.disabled = false;
          toast('Could not reach the server.', 'bad');
        });
    }));
  };

  /* ---- ANALYTICS ---------------------------------------------------------
     Charts are CSS — bars, a conic-gradient ring and a funnel. No plotting
     library, and nothing drawn unless there is data behind it. */
  const anaF = { range: '30' };

  function bucketByDay(rows, key, days) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const start = daysAgo(i).getTime();
      const end = start + 86400000;
      out.push({
        label: new Date(start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        n: rows.filter(r => { const t = Date.parse(r[key]); return t >= start && t < end; }).length
      });
    }
    return out;
  }

  function barsHtml(series) {
    const max = Math.max(1, ...series.map(s => s.n));
    const every = series.length > 14 ? Math.ceil(series.length / 8) : 1;
    return '<div class="bars">' + series.map((s, i) =>
      '<div class="bars__col" title="' + esc(s.label + ': ' + s.n) + '">' +
      '<div class="bars__bar" style="height:' + Math.round((s.n / max) * 130) + 'px"></div>' +
      '<span class="bars__tick">' + (i % every === 0 ? esc(s.label.split(' ')[0]) : '') + '</span></div>').join('') +
      '</div>';
  }

  function donutHtml(parts) {
    const total = parts.reduce((s, p) => s + p.n, 0);
    if (!total) return '';
    const shades = ['#22C55E', '#16A34A', '#4ADE80', '#86EFAC', '#0E7C3A'];
    let at = 0;
    const stops = parts.map(function (p, i) {
      const from = (at / total) * 360;
      at += p.n;
      const to = (at / total) * 360;
      return shades[i % shades.length] + ' ' + from + 'deg ' + to + 'deg';
    }).join(', ');
    return '<div class="donut"><div class="donut__ring" style="background:conic-gradient(' + stops + ')"></div>' +
      '<ul class="donut__key">' + parts.map((p, i) =>
        '<li><i style="background:' + shades[i % shades.length] + '"></i>' + esc(p.label) +
        '<strong>' + p.n + '</strong></li>').join('') + '</ul></div>';
  }

  function hbarsHtml(parts) {
    const max = Math.max(1, ...parts.map(p => p.n));
    return '<div class="hbars">' + parts.map(p =>
      '<div><div class="hbar__top"><span>' + esc(p.label) + '</span><strong>' + p.n + '</strong></div>' +
      '<div class="hbar__track"><div class="hbar__fill" style="width:' +
      Math.round((p.n / max) * 100) + '%"></div></div></div>').join('') + '</div>';
  }

  VIEWS.analytics = function () {
    const days = anaF.range === 'custom' ? 30 : Number(anaF.range);
    const since = daysAgo(days - 1).getTime();
    const inWindow = (rows, key) => rows.filter(r => Date.parse(r[key]) >= since);

    const enq = inWindow(state.enquiries, 'created_at');
    const ord = inWindow(state.orders, 'created_at');
    const acts = inWindow(state.activities, 'at');

    const sources = SOURCES.map(s => ({ label: s, n: enq.filter(e => e.source === s).length }))
      .filter(s => s.n > 0);

    const servicePop = state.services.map(function (s) {
      return {
        label: s.name,
        n: enq.filter(e => e.service === s.name).length +
           ord.filter(o => (Array.isArray(o.items) ? o.items : []).some(i => i.name === s.name)).length
      };
    }).filter(s => s.n > 0).sort((a, b) => b.n - a.n);

    const visitors = new Set(acts.map(a => a.session_id).filter(Boolean)).size;
    const contacted = enq.filter(e => e.status !== 'New').length;
    const quoted = enq.filter(e => ['Quoted', 'In Progress', 'Completed'].indexOf(e.status) > -1).length;
    const converted = ord.filter(o => o.status === 'verified').length;
    const funnel = [
      { label: 'Visitors', n: visitors }, { label: 'Enquiries', n: enq.length },
      { label: 'Contacted', n: contacted }, { label: 'Quoted', n: quoted },
      { label: 'Converted', n: converted }
    ];
    const funnelMax = Math.max(1, ...funnel.map(f => f.n));

    const verified = state.orders.filter(o => o.status === 'verified');
    const revenue = verified.reduce((s, o) => s + Number(o.paid || 0), 0);
    const thisMonth = verified.filter(o => Date.parse(o.created_at) >=
      new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime())
      .reduce((s, o) => s + Number(o.paid || 0), 0);
    const pendingMoney = state.orders.filter(o => o.status === 'pending')
      .reduce((s, o) => s + Number(o.paid || 0), 0);
    const outstanding = verified.reduce((s, o) => s + Math.max(0, Number(o.total || 0) - Number(o.paid || 0)), 0);

    const card = (title, icon, inner, empty) => '<section class="card"><div class="card__head">' +
      '<h2><i class="fa-solid ' + icon + '"></i> ' + esc(title) + '</h2></div>' +
      (inner || emptyState('Nothing to chart yet', empty)) + '</section>';

    $('#view').innerHTML =
      pageHead('Analytics', 'Only what the database actually holds — no invented numbers.',
        '<div class="chipbar" id="anaRange">' +
          [['7', '7 days'], ['30', '30 days'], ['90', '3 months'], ['180', '6 months'], ['365', '1 year']]
            .map(r => '<button class="chip2' + (anaF.range === r[0] ? ' is-on' : '') + '" data-range="' + r[0] + '">' + r[1] + '</button>').join('') +
        '</div>') +
      '<div class="grid grid--kpi" style="margin-bottom:14px">' +
        kpi('Total revenue', money(revenue), 'fa-indian-rupee-sign', { text: 'verified', cls: '' }, 'all time') +
        kpi('This month', money(thisMonth), 'fa-calendar-day', { text: 'so far', cls: 'is-flat' }, '') +
        kpi('Awaiting check', money(pendingMoney), 'fa-hourglass-half', { text: 'unverified', cls: 'is-flat' }, '') +
        kpi('Balance on delivery', money(outstanding), 'fa-scale-balanced', { text: 'owed', cls: 'is-flat' }, '') +
      '</div>' +
      '<div class="grid grid--halves" style="margin-bottom:14px">' +
        card('Enquiries over time', 'fa-chart-column',
          enq.length ? barsHtml(bucketByDay(state.enquiries, 'created_at', Math.min(days, 30))) : null,
          'Enquiries from the site will build this chart.') +
        card('Enquiry sources', 'fa-share-nodes', sources.length ? donutHtml(sources) : null,
          'Where enquiries come from is recorded with each one.') +
      '</div>' +
      '<div class="grid grid--halves">' +
        card('Service popularity', 'fa-fire', servicePop.length ? hbarsHtml(servicePop) : null,
          'Counted from enquiries and verified orders.') +
        card('Conversion funnel', 'fa-filter',
          funnel.some(f => f.n)
            ? '<div class="funnel">' + funnel.map(f =>
                '<div class="funnel__row"><span class="funnel__label">' + esc(f.label) + '</span>' +
                '<div class="funnel__bar" style="width:' + Math.max(12, Math.round((f.n / funnelMax) * 100)) + '%">' +
                f.n + '</div></div>').join('') + '</div>'
            : null,
          'Visitors come from site activity; the rest from enquiries and orders.') +
      '</div>';

    $$('#anaRange [data-range]').forEach(b => b.addEventListener('click', function () {
      anaF.range = b.dataset.range;
      VIEWS.analytics();
    }));
  };

  /* ---- SETTINGS ---- */
  VIEWS.settings = function () {
    const mine = state.people.find(p => p.username === me.username) || {};
    $('#view').innerHTML =
      pageHead('Settings', 'Your account, and how this panel is set up.') +
      '<div class="grid grid--halves">' +
        '<section class="card"><div class="card__head"><h2><i class="fa-solid fa-user"></i> Admin profile</h2></div>' +
          '<dl class="dl">' +
            '<div><dt>Username</dt><dd>@' + esc(me.username) + '</dd></div>' +
            '<div><dt>Role</dt><dd>' + badge(roleLabel(me)) + '</dd></div>' +
            '<div><dt>Name</dt><dd>' + esc(mine.full_name || '—') + '</dd></div>' +
            '<div><dt>Phone</dt><dd>' + esc(mine.phone || '—') + '</dd></div>' +
            '<div><dt>Last signed in</dt><dd>' + (mine.last_login ? fmtWhen(mine.last_login) : '—') + '</dd></div>' +
          '</dl>' +
          '<button class="btn--green btn--block" id="setMe"><i class="fa-solid fa-pen"></i> Edit profile &amp; password</button>' +
        '</section>' +
        '<section class="card"><div class="card__head"><h2><i class="fa-solid fa-building"></i> Business</h2></div>' +
          '<dl class="dl">' +
            '<div><dt>Name</dt><dd>' + esc(CONFIG.business.name) + '</dd></div>' +
            '<div><dt>Email</dt><dd>' + esc(CONFIG.business.email) + '</dd></div>' +
            '<div><dt>WhatsApp</dt><dd>+' + esc(CONFIG.business.whatsapp) + '</dd></div>' +
          '</dl>' +
          '<p class="msg" style="margin-top:12px">These come from the site’s own configuration. ' +
          'Keys and passwords are never shown here.</p>' +
        '</section>' +
        '<section class="card"><div class="card__head"><h2><i class="fa-solid fa-bell"></i> Notifications</h2></div>' +
          '<p class="msg">Read state is remembered in this browser, so marking something read here ' +
          'does not mark it read for the rest of the team.</p>' +
          '<button class="btn--ghost btn--block" id="setClearRead">Mark everything unread again</button>' +
        '</section>' +
        '<section class="card"><div class="card__head"><h2><i class="fa-solid fa-database"></i> Data</h2></div>' +
          '<dl class="dl">' +
            '<div><dt>Enquiries</dt><dd>' + state.enquiries.length + '</dd></div>' +
            '<div><dt>Orders</dt><dd>' + state.orders.length + '</dd></div>' +
            '<div><dt>People</dt><dd>' + state.people.length + '</dd></div>' +
            '<div><dt>Projects</dt><dd>' + state.projects.length + '</dd></div>' +
            '<div><dt>Activity events</dt><dd>' + state.activities.length + '</dd></div>' +
          '</dl>' +
          '<button class="btn--ghost btn--block" id="setReload"><i class="fa-solid fa-rotate"></i> Reload everything</button>' +
        '</section>' +
      '</div>';

    $('#setMe').addEventListener('click', openMe);
    $('#setReload').addEventListener('click', function () { loadAll(); toast('Reloading…', 'info'); });
    $('#setClearRead').addEventListener('click', function () {
      state.readNotifications = new Set();
      saveRead();
      paintNotifications();
      toast('Notifications reset.');
    });
  };

  /* ------------------------------------------------------------------------
     10. START  (unchanged)
     ------------------------------------------------------------------------ */
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
