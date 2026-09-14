/* ==========================================================================
   WE3 Order Book

   A private ledger for the team. It is deliberately honest about its limits:
   the site has no server, so nothing written here can reach a customer's
   phone. Marking an order verified records OUR decision — telling the
   customer still happens on WhatsApp.

   Everything lives in this browser's localStorage. Export/Import moves the
   book between the three of us.
   ========================================================================== */
(function () {
  'use strict';

  const KEY = 'we3.orderbook.v1';

  /* ---- the gate ----------------------------------------------------------

     Be honest about what this is and is not.

     IS: a lock on a page that is published on the open web. Someone who finds
     the URL sees a password prompt instead of every customer's name, phone
     number and payment.

     IS NOT: security against anyone technical. The check runs in this file,
     which is public, and the order book sits in localStorage where devtools
     can read it whatever this code says. Do not put anything here that would
     genuinely hurt if it leaked.

     The password is not in this file. What is stored is a PBKDF2-HMAC-SHA256
     hash of it with a random salt, so reading this source does not hand
     anybody the password — deriving it back would mean brute-forcing 310,000
     rounds per guess against a 15-character password.                       */
  const GATE = {
    salt: '9a1adca5437edf692ba25f7e484736d8',
    hash: '71529b2b1c1c13196b1ee01cd27cc15ef5b1af842828edc5c898493cd974330b',
    iterations: 310000
  };
  const UNLOCKED_KEY = 'we3.unlocked.v1';

  const hex = buf => Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const unhex = str => new Uint8Array(
    str.match(/../g).map(h => parseInt(h, 16)));

  async function derive(password) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: unhex(GATE.salt),
      iterations: GATE.iterations,
      hash: 'SHA-256'
    }, key, 256);
    return hex(bits);
  }

  // Constant time, so a wrong guess cannot be narrowed down by how long the
  // comparison took. Cheap to do, and there is no reason not to.
  function sameDigest(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function unlock() {
    document.body.classList.remove('is-locked');
    $('#lock').hidden = true;
    try { sessionStorage.setItem(UNLOCKED_KEY, '1'); } catch (e) { /* private mode */ }
  }

  function relock() {
    try { sessionStorage.removeItem(UNLOCKED_KEY); } catch (e) { /* private mode */ }
    location.reload();
  }

  function initGate() {
    const form = $('#lockForm');
    const input = $('#lockPw');
    const err = $('#lockErr');
    const btn = $('#lockBtn');

    // Unlocked earlier in this tab. Closing the tab asks again.
    let already = false;
    try { already = sessionStorage.getItem(UNLOCKED_KEY) === '1'; } catch (e) { /* private mode */ }
    if (already) { unlock(); return; }

    // crypto.subtle only exists in a secure context. Over https, or on
    // localhost, it is there; opening the file straight off the disk with
    // file:// it is not, and the page would just silently never unlock.
    if (!window.crypto || !crypto.subtle) {
      err.hidden = false;
      err.textContent = 'This page has to be opened over https (your live site ' +
                        'address), not from a file on the computer.';
      input.disabled = true;
      btn.disabled = true;
      return;
    }

    $('#lockEye').addEventListener('click', function () {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      this.innerHTML = '<i class="fa-solid fa-eye' + (show ? '-slash' : '') +
                       '" aria-hidden="true"></i>';
      input.focus();
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      err.hidden = true;

      if (!input.value) {
        err.hidden = false;
        err.textContent = 'Enter the password.';
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Checking…';

      let digest;
      try {
        digest = await derive(input.value);
      } catch (e2) {
        digest = '';
      }

      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-unlock" aria-hidden="true"></i> Unlock';

      if (sameDigest(digest, GATE.hash)) { unlock(); return; }

      err.hidden = false;
      err.textContent = 'Wrong password.';
      input.select();
    });
  }

  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const money = n => '₹' + Number(n || 0).toLocaleString('en-IN');

  let book = [];
  let filter = 'all';
  let query = '';

  /* ---- storage ---- */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      book = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      book = [];
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(book));
    } catch (e) {
      alert('Could not save — the browser refused to write storage.');
    }
  }

  function makeRef() {
    return 'WE3-' + Date.now().toString(36).slice(-4).toUpperCase() +
           Math.random().toString(36).slice(2, 4).toUpperCase();
  }

  function fmtDate(ms) {
    try {
      return new Date(ms).toLocaleDateString('en-IN',
        { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return ''; }
  }

  /* ---- summary ---- */
  function renderStats() {
    const pending  = book.filter(o => o.status === 'pending');
    const verified = book.filter(o => o.status === 'verified');

    // Only verified money is counted as received — a pending claim is not
    // cash in the account.
    const received = verified.reduce((s, o) => s + Number(o.paid || 0), 0);
    const due = verified.reduce((s, o) => s + Math.max(0, Number(o.total || 0) - Number(o.paid || 0)), 0);

    $('#statTotal').textContent    = book.length;
    $('#statPending').textContent  = pending.length;
    $('#statVerified').textContent = verified.length;
    $('#statMoney').textContent    = money(received);
    $('#statDue').textContent      = money(due);
  }

  /* ---- list ---- */
  function visible() {
    const q = query.trim().toLowerCase();
    return book.filter(function (o) {
      if (filter !== 'all' && o.status !== filter) return false;
      if (!q) return true;
      return [o.name, o.business, o.phone, o.ref, o.items, o.note]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }

  function statusButton(order, status, label, icon) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mark mark--' + status + (order.status === status ? ' is-on' : '');
    b.innerHTML = '<i class="fa-solid ' + icon + '" aria-hidden="true"></i> ' + label;
    b.addEventListener('click', function () {
      order.status = status;
      save();
      render();
    });
    return b;
  }

  function render() {
    renderStats();

    const list = $('#orderList');
    const rows = visible();
    list.innerHTML = '';
    $('#listEmpty').hidden = rows.length > 0;
    $('#listEmpty').textContent = book.length
      ? 'No orders match this filter.'
      : 'No orders yet. Log one above as soon as a payment screenshot arrives.';

    rows.forEach(function (order) {
      const li = document.createElement('li');
      li.className = 'adm-order adm-order--' + order.status;

      const head = document.createElement('div');
      head.className = 'adm-order__head';
      const who = document.createElement('span');
      who.className = 'adm-order__who';
      who.textContent = order.name;
      const ref = document.createElement('span');
      ref.className = 'adm-order__ref';
      ref.textContent = (order.ref || '—') + ' · ' + fmtDate(order.at);
      head.appendChild(who);
      head.appendChild(ref);

      const meta = document.createElement('div');
      meta.className = 'adm-order__meta';
      const bits = [
        ['Business', order.business || '—'],
        ['Phone', order.phone],
        ['Ordered', order.items || '—'],
        ['Total', money(order.total)],
        ['Paid', money(order.paid)],
        ['Balance', money(Math.max(0, Number(order.total || 0) - Number(order.paid || 0)))]
      ];
      bits.forEach(function (pair) {
        const span = document.createElement('span');
        span.innerHTML = pair[0] + ' <strong></strong>';
        span.querySelector('strong').textContent = pair[1];
        meta.appendChild(span);
      });

      li.appendChild(head);
      li.appendChild(meta);

      if (order.note) {
        const note = document.createElement('p');
        note.className = 'adm-order__note';
        note.textContent = order.note;
        li.appendChild(note);
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

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'adm-order__del';
      del.textContent = 'Delete';
      del.addEventListener('click', function () {
        if (!confirm('Delete the order for ' + order.name + '? This cannot be undone.')) return;
        book = book.filter(o => o !== order);
        save();
        render();
      });
      foot.appendChild(del);

      li.appendChild(foot);
      list.appendChild(li);
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
    let msg;
    if (order.status === 'verified') {
      msg = 'Hi ' + order.name + ', your payment of ' + money(order.paid) +
            ' for order ' + (order.ref || '') + ' is confirmed. We are starting work now.' +
            (balance > 0 ? ' Balance of ' + money(balance) + ' is due on delivery.' : '');
    } else if (order.status === 'rejected') {
      msg = 'Hi ' + order.name + ', we could not find your payment of ' + money(order.paid) +
            ' for order ' + (order.ref || '') + ' yet. Could you send the payment screenshot again?';
    } else {
      msg = 'Hi ' + order.name + ', we have your order ' + (order.ref || '') +
            ' and are checking the payment of ' + money(order.paid) + '. We will confirm shortly.';
    }

    // The link is what actually tells the customer. Opening it flips the
    // order in their own My Orders from "Pending verification" to the status
    // set here, which is the only way that screen can ever change without a
    // server. Built from this page's own address so it is right on the live
    // site and right on a test server, with nothing to configure.
    if (order.ref) {
      const url = new URL('index.html', location.href);
      url.searchParams.set('order', order.ref);
      url.searchParams.set('status', order.status || 'pending');
      msg += '\n\nSee it on the site: ' + url.href;
    }

    window.open('https://wa.me/91' + digits + '?text=' + encodeURIComponent(msg),
                '_blank', 'noopener,noreferrer');
  }

  /* ---- add ---- */
  /* ---- paste the customer's WhatsApp message to fill the form ----

     orderMessage() in script.js builds that message from a fixed template, so
     it reads back cleanly. The labels below are a contract with that
     function — change one and change the other. */

  // A WhatsApp chat export prefixes every line with "[13/09/26, 4:32 pm]
  // Someone: ". Strip it once so everything after this sees a plain message.
  function stripChatPrefix(text) {
    return text.split('\n')
      .map(l => l.replace(/^\[[^\]]*\]\s*[^:]{0,40}:\s*/, ''))
      .join('\n');
  }

  // `labels` is a regex alternation. "Paid now|Paid" still reads messages sent
  // before the two templates were merged, and cannot catch "Paid to UPI:"
  // because the colon has to come straight after the label.
  function field(text, labels) {
    const m = text.match(new RegExp('^(?:' + labels + '):\\s*(.+)$', 'im'));
    return m ? m[1].trim() : '';
  }

  // Takes the FIRST number only: "₹4,500 (50% advance)" is 4500, not 450050.
  function firstNumber(str) {
    const m = String(str).match(/[\d,]+/);
    return m ? Number(m[0].replace(/,/g, '')) : 0;
  }

  function parseMessage(raw) {
    const text = stripChatPrefix(raw);

    const items = text.split('\n')
      .filter(l => /^\s*•/.test(l))
      // Drop the trailing price; the total is captured separately and the
      // line is easier to scan without it.
      .map(l => l.replace(/^\s*•\s*/, '').replace(/\s*—\s*₹[\d,]+\s*$/, '').trim())
      .filter(Boolean)
      .join(', ');

    return {
      ref:      field(text, 'Order'),
      name:     field(text, 'Name'),
      phone:    field(text, 'Phone'),
      business: field(text, 'Business'),
      email:    field(text, 'Email'),
      brief:    field(text, 'What they need'),
      total:    firstNumber(field(text, 'Total')),
      paid:     firstNumber(field(text, 'Paid now|Paid')),
      items:    items
    };
  }

  $('#pasteBox').addEventListener('input', function () {
    const msg = $('#pasteMsg');
    const text = this.value.trim();

    if (!text) { msg.hidden = true; return; }

    const o = parseMessage(text);
    const filled = [];

    if (o.business) { $('#fBusiness').value = o.business; filled.push('business'); }
    if (o.name)  { $('#fName').value  = o.name;  filled.push('name'); }
    if (o.phone) { $('#fPhone').value = o.phone; filled.push('phone'); }
    if (o.items) { $('#fItems').value = o.items; filled.push('items'); }
    if (o.total) { $('#fTotal').value = o.total; filled.push('total'); }
    if (o.paid)  { $('#fPaid').value  = o.paid;  filled.push('paid'); }
    if (o.ref)   { $('#fRef').value   = o.ref;   filled.push('reference'); }

    // The brief is the most useful thing in the message and there is nowhere
    // else for it to go, so it lands in the note alongside the email.
    const extra = [o.brief, o.email && ('Email: ' + o.email)].filter(Boolean).join(' · ');
    if (extra) { $('#fNote').value = extra; filled.push('note'); }

    msg.hidden = false;

    if (!filled.length) {
      msg.className = 'paste__msg is-bad';
      msg.textContent = 'Could not read that — it does not look like an order ' +
                        'message. Fill the form in by hand.';
      return;
    }

    const dupe = o.ref && book.find(b => b.ref === o.ref);
    if (dupe) {
      msg.className = 'paste__msg is-warn';
      msg.textContent = 'Order ' + o.ref + ' is already in the book, logged ' +
                        fmtDate(dupe.at) + '. Adding it again would double-count ' +
                        'the money.';
      return;
    }

    msg.className = 'paste__msg is-good';
    msg.textContent = 'Filled in ' + filled.join(', ') +
                      '. Check it against the screenshot, then Add order.';
  });

  $('#orderForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const err = $('#formErr');
    err.hidden = true;

    const name  = $('#fName').value.trim();
    const phone = $('#fPhone').value.trim();
    const total = Number($('#fTotal').value.replace(/[^\d]/g, ''));
    const paid  = Number($('#fPaid').value.replace(/[^\d]/g, ''));

    const fail = function (m, el) { err.textContent = m; err.hidden = false; el.focus(); };

    if (name.length < 2) return fail('Enter the customer name.', $('#fName'));
    if (phone.replace(/\D/g, '').length < 10) return fail('Enter a 10-digit phone number.', $('#fPhone'));
    if (!total) return fail('Enter the order total.', $('#fTotal'));
    if (paid > total) return fail('Paid cannot be more than the order total.', $('#fPaid'));

    const ref = $('#fRef').value.trim();
    if (ref && book.some(o => o.ref === ref)) {
      return fail('Order ' + ref + ' is already in the book.', $('#fRef'));
    }

    book.unshift({
      at: Date.now(),
      ref: ref || makeRef(),
      name: name,
      business: $('#fBusiness').value.trim(),
      phone: phone,
      items: $('#fItems').value.trim(),
      total: total,
      paid: paid,
      note: $('#fNote').value.trim(),
      status: 'pending'
    });
    save();
    render();
    e.target.reset();
    $('#pasteBox').value = '';
    $('#pasteMsg').hidden = true;
    $('#fName').focus();
  });

  /* ---- filters ---- */
  $$('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      filter = chip.dataset.status;
      $$('.chip').forEach(function (c) {
        const on = c === chip;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-selected', String(on));
      });
      render();
    });
  });

  $('#search').addEventListener('input', function (e) {
    query = e.target.value;
    render();
  });

  /* ---- export / import, so the team can share one book ---- */
  $('#exportBtn').addEventListener('click', function () {
    const blob = new Blob([JSON.stringify(book, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'we3-orders-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#importFile').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      let incoming;
      try {
        incoming = JSON.parse(reader.result);
      } catch (err) {
        alert('That file is not valid JSON.');
        return;
      }
      if (!Array.isArray(incoming)) {
        alert('That file does not look like an order book.');
        return;
      }
      // Merge rather than replace, matching on reference so re-importing the
      // same file twice does not duplicate every order.
      const seen = new Set(book.map(o => o.ref));
      let added = 0;
      incoming.forEach(function (o) {
        if (o && o.ref && !seen.has(o.ref)) { book.push(o); seen.add(o.ref); added++; }
      });
      book.sort((a, b) => (b.at || 0) - (a.at || 0));
      save();
      render();
      alert(added + ' order(s) added. ' + (incoming.length - added) + ' already in the book.');
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('#lockBackBtn').addEventListener('click', relock);

  initGate();
  load();
  render();
}());
