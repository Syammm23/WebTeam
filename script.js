/* ==========================================================================
   WE3 — site behaviour
   Vanilla JS, no dependencies. Every enquiry path ends in a wa.me link;
   there is no backend and no form is ever POSTed anywhere.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     CONFIG — the only block you need to edit when going live.
     PLACEHOLDER values: replace all three.
     ------------------------------------------------------------------------ */
  const CONFIG = {
    businessName: "WE3",
    email: "hello.we3agency@gmail.com",

    // Every enquiry from the site lands on this one line; the team passes
    // work along from there. The reel and photography numbers are still
    // listed under Get In Touch for anyone who wants to call that person
    // directly. Country code + number, digits only, no "+" and no spaces.
    whatsapp: {
      main: "917990853947"
    },

    // Accounts and the shared order book. Both values are meant to sit in
    // public JavaScript — the database's own rules decide what this key can
    // do, and they allow registering, signing in, and reading or creating a
    // row the signed-in user owns. Nothing else.
    //
    // If either value is blanked, or the library fails to load, the site
    // falls back to this browser's own storage with no accounts rather than
    // breaking.
    supabase: {
      url: "https://bakvwxkkvzklgnkeqpfi.supabase.co",
      anonKey: "sb_publishable_j8QUhuHa8IfYlmLc8OxI2w_6BElktA7",

      // Supabase always stores an email. A username signs up under this
      // domain so nobody has to have one; no mail is ever sent to it, and
      // the customer never sees it. It must never be a domain that could
      // receive mail.
      userDomain: "we3users.app"
    },

    upi: {
      id: "7990853947@kotakbank",
      payeeName: "WE3",

      // The name the bank has on the account. UPI apps show this, not
      // payeeName, so the payment screen says so upfront — a customer
      // expecting "WE3" and seeing a personal name would hesitate.
      accountName: "Shyamkumar Prasad",

      // Rebuild with: python3 tools/make-upi-qr.py 7990853947@kotakbank
      qrImage: "assets/we3-upi-qr.png"
    }
  };

  /* Prices used by the quote builder (₹). Keep in sync with the cards. */
  const PRICES = {
    // A year of domain + hosting is bundled into every website package
    // rather than being sold separately.
    website: 4999,
    // First reel 1,999, every one after it 2,000. The odd extra rupee is
    // deliberate: it lands every reel total on a 999 — 1,999 / 3,999 / 5,999
    // / 7,999 / 9,999 — instead of the 3,998 a flat per-unit price gives.
    reel: 1999,
    reelExtra: 2000,
    video: 999,          // editing footage the customer shot themselves
    shopShoot: 299,      // add-on: we shoot the shop for their own site
    maintenance: { "none": 0, "6 Months": 2999, "1 Year": 4999 }
  };

  // The store photoshoot and maintenance are sold as add-ons to a website,
  // not on their own. One list, so the cart and the builder agree.
  const WEB_ADDONS = ['shopshoot', 'maint6', 'maint12'];
  // What counts as "a website is being built".
  const WEB_BASE = ['website', 'combo'];

  const COMBO = {
    // Website 4,999 + 2 reels at 1,999 + video editing 999 = 9,996 bought
    // separately, so the bundle saves 997.
    price: 8999,
    reelsIncluded: 2,    // reels bundled into the combo
    videoIncluded: true  // one edited video is part of the bundle
  };

  const prefersReducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ========================================================================
     ACCOUNTS + SHARED ORDERS (Supabase)

     Everything here degrades rather than breaks. With no project configured,
     or the library blocked, or the network down, `db.ready` stays false and
     the site behaves exactly as it did before this existed: orders live in
     this browser and nothing asks anyone to sign in.
     ======================================================================== */
  const db = {
    client: null,
    ready: false,
    user: null,       // { id, username }
  };

  (function initDb() {
    const cfg = CONFIG.supabase;
    if (!cfg.url || !cfg.anonKey) return;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return;
    try {
      db.client = window.supabase.createClient(cfg.url, cfg.anonKey);
      db.ready = true;
    } catch (e) {
      db.ready = false;
    }
  }());

  /** username -> the internal address Supabase Auth files it under. */
  function authEmail(username) {
    return String(username).trim().toLowerCase() + '@' + CONFIG.supabase.userDomain;
  }

  // Same rule as the database's own CHECK constraint, so the browser and the
  // server agree on what a username is instead of the server rejecting
  // something the form accepted.
  const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

  function usernameProblem(raw) {
    const u = String(raw || '').trim().toLowerCase();
    if (!u) return 'Pick a username.';
    if (u.length < 3) return 'Usernames are at least 3 characters.';
    if (u.length > 20) return 'Usernames are at most 20 characters.';
    if (!USERNAME_RE.test(u)) return 'Use only letters, numbers and _ — no spaces.';
    return '';
  }

  /* ------------------------------------------------------------------------
     UTILITIES
     ------------------------------------------------------------------------ */
  const $  = (sel, scope) => (scope || document).querySelector(sel);
  const $$ = (sel, scope) => Array.from((scope || document).querySelectorAll(sel));

  /** 12000 -> "₹12,000" */
  function formatINR(amount) {
    return '₹' + Number(amount).toLocaleString('en-IN');
  }

  /** What `qty` reels cost, on the 1,999-then-2,000 ladder. */
  function reelTotal(qty) {
    return qty > 0 ? PRICES.reel + (qty - 1) * PRICES.reelExtra : 0;
  }

  /**
   * What one cart line costs.
   *
   * Most lines are simply price x quantity. A line carrying `step` prices the
   * first one at `price` and every one after it at `step` — reels, so their
   * totals stay on a 999. Everything that touches money goes through here so
   * the cart, the UPI amount, the WhatsApp message and the email cannot drift
   * apart.
   */
  function lineTotal(item) {
    const qty = Math.max(0, Number(item.qty) || 0);
    if (!qty) return 0;
    return item.step ? item.price + (qty - 1) * item.step : item.price * qty;
  }

  /**
   * Single entry point for every WhatsApp hand-off on the site.
   * `number` is optional and only exists so a caller can override the
   * destination; everything on the site uses the one main line.
   */
  function openWhatsApp(message, number) {
    const url = 'https://wa.me/' + (number || CONFIG.whatsapp.main) +
                '?text=' + encodeURIComponent(message);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // Kept as named helpers rather than inlining CONFIG.whatsapp.main at each
  // call site: if enquiries are ever split by type again, only these change.
  function numberForService() {
    return CONFIG.whatsapp.main;
  }

  function numberForCart() {
    return CONFIG.whatsapp.main;
  }

  /* ------------------------------------------------------------------------
     MESSAGE TEMPLATES
     ------------------------------------------------------------------------ */
  const templates = {
    service(serviceName, name) {
      return "Hi " + CONFIG.businessName + (name ? ", I'm " + name + "." : ",") +
             " I'm interested in " + serviceName + ". Can you share details?";
    },
    contact(d) {
      return "Hi " + CONFIG.businessName + ", I'm " + d.name + " from " + d.business +
             ". Phone: " + d.phone + ". I need: " + d.service +
             ". Message: " + (d.message || '-');
    }
  };

  /* ========================================================================
     1. IMAGE FALLBACKS
     Photos are remote placeholders. If one 404s we try a backup, and if that
     also fails we hide the <img> so the dark panel behind it still reads.
     ======================================================================== */
  function handleImageFailure(img) {
    if (img.dataset.triedFallback) {
      img.classList.add('is-broken');
      return;
    }
    img.dataset.triedFallback = '1';
    img.src = img.dataset.fallback;
  }

  $$('img[data-fallback]').forEach(function (img) {
    img.addEventListener('error', function () { handleImageFailure(img); });

    // This script is deferred, so an image can already have failed by the time
    // we get here — in that case the error event has been and gone.
    if (img.complete && img.naturalWidth === 0) handleImageFailure(img);
  });

  /* ========================================================================
     2. NAV — mobile drawer
     ======================================================================== */
  const navToggle = $('#navToggle');
  const navLinks  = $('#navLinks');

  // The scrim is purely a JS affordance, so it is created here rather than
  // sitting in the markup as an empty div.
  const navScrim = document.createElement('div');
  navScrim.className = 'nav__scrim';
  navScrim.hidden = true;
  document.body.appendChild(navScrim);

  function setNavOpen(open) {
    navLinks.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.classList.toggle('is-locked', open);

    // Nothing to fade any more — the scrim is transparent, so it only needs
    // to be present while the drawer is open.
    navScrim.hidden = !open;
  }

  navToggle.addEventListener('click', function () {
    setNavOpen(navToggle.getAttribute('aria-expanded') !== 'true');
  });
  navScrim.addEventListener('click', function () { setNavOpen(false); });
  $$('#navLinks a').forEach(function (a) {
    a.addEventListener('click', function () { setNavOpen(false); });
  });

  /* ========================================================================
     3. WHATSAPP MODAL — service picker + focus trap
     ======================================================================== */
  const modal            = $('#waModal');
  const modalDialog      = $('.modal__dialog', modal);
  const modalPicker      = $('#modalPicker');
  const modalName        = $('#modalName');
  const modalTitle       = $('#modalTitle');
  const modalDesc        = $('#modalDesc');

  let lastFocused = null;

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
                    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function openModal(options) {
    const opts = options || {};
    setNavOpen(false);              // in case it was opened from the drawer
    lastFocused = document.activeElement;

    modalTitle.textContent = 'Start on WhatsApp';
    modalDesc.textContent = 'Pick what you are interested in and we will take it from there.';

    const preset = $('input[name="modalService"][value="' + (opts.service || 'Not Sure') + '"]', modal);
    if (preset) preset.checked = true;

    modal.hidden = false;
    document.body.classList.add('is-locked');
    modalDialog.focus({ preventScroll: true });
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('is-locked');
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus({ preventScroll: true });
    }
  }

  $$('[data-close-modal]', modal).forEach(function (el) {
    el.addEventListener('click', closeModal);
  });

  document.addEventListener('keydown', function (e) {
    // The account dialog sits above this one and handles its own keys.
    if (!$('#authModal').hidden) return;

    if (e.key === 'Escape') {
      if (!modal.hidden) { closeModal(); return; }
      if (navLinks.classList.contains('is-open')) setNavOpen(false);
      return;
    }

    // Keep Tab cycling inside the dialog while it is open
    if (e.key !== 'Tab' || modal.hidden) return;
    const items = $$(FOCUSABLE, modalDialog).filter(function (el) { return el.offsetParent !== null; });
    if (!items.length) return;

    const first = items[0];
    const last  = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  $$('[data-wa-modal]').forEach(function (el) {
    el.addEventListener('click', function () { openModal({ service: el.dataset.service }); });
  });

  $('#modalContinue').addEventListener('click', function () {
    const name = modalName.value.trim();
    const picked = $('input[name="modalService"]:checked', modal);
    const service = picked ? picked.value : 'Not Sure';

    const message = service === 'Not Sure'
      ? "Hi " + CONFIG.businessName + (name ? ", I'm " + name + "." : ",") +
        " I'd like to get my business online but I'm not sure what I need. Can you help?"
      : templates.service(service, name);

    openWhatsApp(message, numberForService(service));
    closeModal();
  });

  /* ========================================================================
     3b. ACCOUNT — sign in / register

     Username and password only. Supabase Auth files each account under an
     internal address built from the username, so nobody needs an email.
     ======================================================================== */
  const authModal   = $('#authModal');
  const authDialog  = $('.modal__dialog', authModal);
  const authForm    = $('#authForm');
  const authUser    = $('#authUser');
  const authPhone   = $('#authPhone');
  const authPass    = $('#authPass');
  const authErr     = $('#authErr');
  const userHint    = $('#userHint');
  const navAccount  = $('#navAccount');

  let authMode = 'signin';          // or 'register'
  let afterAuth = null;             // what to run once they are in
  let lastAuthFocus = null;
  let checkSeq = 0;                 // guards against out-of-order RPC replies

  function authNote(el, text, cls) {
    el.hidden = !text;
    el.textContent = text || '';
    el.className = (el === authErr ? 'cf-err ' : 'auth__hint ') + (cls || '');
  }

  function setAuthMode(mode) {
    authMode = mode;
    const reg = mode === 'register';

    $('#tabSignIn').classList.toggle('is-on', !reg);
    $('#tabRegister').classList.toggle('is-on', reg);
    $('#tabSignIn').setAttribute('aria-selected', String(!reg));
    $('#tabRegister').setAttribute('aria-selected', String(reg));

    $('#authTitle').textContent = reg ? 'Create your account' : 'Sign in';
    $('#authDesc').textContent = reg
      ? 'Pick a username. No email, no OTP.'
      : 'Your orders follow your account, on any phone.';
    $('#authSubmitLabel').textContent = reg ? 'Create account' : 'Sign in';
    $('#rowPhone').hidden = !reg;
    authPass.setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
    authPass.placeholder = reg ? 'At least 8 characters' : 'Password';
    $('#authFoot').hidden = reg;

    authNote(authErr, '');
    authNote(userHint, '');
  }

  function openAuth(options) {
    const opts = options || {};
    setNavOpen(false);
    lastAuthFocus = document.activeElement;
    afterAuth = opts.then || null;

    setAuthMode(opts.mode || 'signin');
    if (opts.reason) authNote(userHint, opts.reason, 'is-info');

    authModal.hidden = false;
    document.body.classList.add('is-locked');
    authDialog.focus({ preventScroll: true });
  }

  function closeAuth() {
    authModal.hidden = true;
    // The cart may still be open behind it and needs the scroll lock kept.
    if (cartEl.hidden && modal.hidden) document.body.classList.remove('is-locked');
    if (lastAuthFocus && typeof lastAuthFocus.focus === 'function') {
      lastAuthFocus.focus({ preventScroll: true });
    }
  }

  $$('[data-close-auth]', authModal).forEach(function (el) {
    el.addEventListener('click', closeAuth);
  });

  document.addEventListener('keydown', function (e) {
    if (authModal.hidden) return;

    if (e.key === 'Escape') { closeAuth(); return; }

    // Tab stays inside the dialog, as it does for the WhatsApp one.
    if (e.key !== 'Tab') return;
    const items = $$(FOCUSABLE, authDialog).filter(function (el) { return el.offsetParent !== null; });
    if (!items.length) return;
    const first = items[0];
    const last  = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  $('#tabSignIn').addEventListener('click', function () { setAuthMode('signin'); });
  $('#tabRegister').addEventListener('click', function () { setAuthMode('register'); });
  $('#goRegister').addEventListener('click', function () { setAuthMode('register'); });

  $('#authEye').addEventListener('click', function () {
    const show = authPass.type === 'password';
    authPass.type = show ? 'text' : 'password';
    this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    this.innerHTML = '<i class="fa-solid fa-eye' + (show ? '-slash' : '') +
                     '" aria-hidden="true"></i>';
    authPass.focus();
  });

  /* ---- live "is this username free?" ------------------------------------
     Only a courtesy. The database's unique constraint is what actually stops
     two people taking the same name, and it is checked inside the signup, so
     a name taken in the seconds between this and the submit still fails
     properly rather than half-creating an account. */
  let checkTimer = null;
  authUser.addEventListener('input', function () {
    if (authMode !== 'register') return;
    clearTimeout(checkTimer);
    const raw = authUser.value;
    const problem = usernameProblem(raw);
    if (problem) { authNote(userHint, raw ? problem : '', 'is-bad'); return; }
    authNote(userHint, 'Checking…', '');
    const seq = ++checkSeq;
    checkTimer = setTimeout(function () { checkUsername(raw.trim().toLowerCase(), seq); }, 400);
  });

  function checkUsername(username, seq) {
    if (!db.ready) { authNote(userHint, '', ''); return; }
    db.client.rpc('username_available', { p_username: username })
      .then(function (res) {
        if (seq !== checkSeq) return;          // a newer keystroke won
        if (res.error) { authNote(userHint, '', ''); return; }
        authNote(userHint,
          res.data ? '\u201C' + username + '\u201D is available.'
                   : '\u201C' + username + '\u201D is taken — try another.',
          res.data ? 'is-good' : 'is-bad');
      }, function () { authNote(userHint, '', ''); });
  }

  /* ---- submit ---- */
  authForm.addEventListener('submit', function (e) {
    e.preventDefault();
    authNote(authErr, '');

    if (!db.ready) {
      authNote(authErr, 'Accounts are not switched on yet. You can still order — ' +
                        'your order will be saved on this phone.', '');
      return;
    }

    const username = authUser.value.trim().toLowerCase();
    const password = authPass.value;
    const reg = authMode === 'register';

    const problem = usernameProblem(username);
    if (problem) { authNote(authErr, problem); authUser.focus(); return; }

    if (reg && password.length < 8) {
      authNote(authErr, 'Use a password of at least 8 characters.');
      authPass.focus();
      return;
    }
    if (!reg && !password) {
      authNote(authErr, 'Enter your password.');
      authPass.focus();
      return;
    }

    const phone = authPhone.value.trim();
    if (reg && phone.replace(/\D/g, '').length < 10) {
      authNote(authErr, 'Enter your 10-digit mobile number — it is how we check it ' +
                        'is you if you forget your password.');
      authPhone.focus();
      return;
    }

    const btn = $('#authSubmit');
    btn.disabled = true;
    const label = $('#authSubmitLabel').textContent;
    $('#authSubmitLabel').textContent = reg ? 'Creating…' : 'Signing in…';

    const done = function () {
      btn.disabled = false;
      $('#authSubmitLabel').textContent = label;
    };

    const request = reg
      ? db.client.auth.signUp({
          email: authEmail(username),
          password: password,
          options: { data: { username: username, phone: phone } }
        })
      : db.client.auth.signInWithPassword({
          email: authEmail(username),
          password: password
        });

    request.then(function (res) {
      done();
      if (res.error) { authNote(authErr, authErrorText(res.error, reg)); return; }
      if (!res.data || !res.data.session) {
        // Only happens if email confirmation is left switched on, where the
        // session waits for a mail that can never arrive at an internal
        // address. Worth naming rather than showing a blank screen.
        authNote(authErr, 'The account was made but could not be signed in. ' +
                          'Message us on WhatsApp and we will sort it out.');
        return;
      }
      onSignedIn(res.data.session.user, username);
      closeAuth();
      const next = afterAuth;
      afterAuth = null;
      if (typeof next === 'function') next();
    }, function () {
      done();
      authNote(authErr, 'Could not reach the server. Check your connection and try again.');
    });
  });

  /** Supabase phrases errors for developers; these are for customers. */
  function authErrorText(error, registering) {
    const msg = String((error && error.message) || '').toLowerCase();
    if (msg.indexOf('already registered') > -1 || msg.indexOf('already been registered') > -1 ||
        msg.indexOf('duplicate') > -1 || msg.indexOf('profiles_username_key') > -1) {
      return 'That username is already taken — try another.';
    }
    if (msg.indexOf('invalid login') > -1) {
      return 'Wrong username or password.';
    }
    if (msg.indexOf('username_format') > -1) {
      return 'Use only letters, numbers and _ — no spaces.';
    }
    if (msg.indexOf('password') > -1) {
      return 'Use a password of at least 8 characters.';
    }
    return registering
      ? 'Could not create the account. Please try again, or message us on WhatsApp.'
      : 'Could not sign in. Please try again, or message us on WhatsApp.';
  }

  function onSignedIn(user, username) {
    db.user = {
      id: user.id,
      username: username || (user.user_metadata && user.user_metadata.username) || ''
    };
    renderAccount();
    loadOrders();
  }

  function signOut() {
    if (!db.ready) return;
    db.client.auth.signOut().then(function () {
      db.user = null;
      orders = [];
      renderAccount();
      renderOrders();
    }, function () { /* leaving them signed in is the safe failure */ });
  }

  function renderAccount() {
    if (!db.ready) { navAccount.hidden = true; return; }
    navAccount.hidden = false;
    const inUser = Boolean(db.user);
    navAccount.setAttribute('aria-label', inUser ? 'Your account' : 'Sign in');
    navAccount.classList.toggle('is-in', inUser);
    navAccount.innerHTML = inUser
      ? '<i class="fa-solid fa-user" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-user" aria-hidden="true"></i>';
  }

  navAccount.addEventListener('click', function () {
    if (!db.user) { openAuth({ mode: 'signin' }); return; }
    if (confirm('Signed in as ' + db.user.username + '. Sign out?')) signOut();
  });

  // Pick a session back up on load, so a returning customer is already in.
  if (db.ready) {
    db.client.auth.getSession().then(function (res) {
      const session = res && res.data && res.data.session;
      if (session) onSignedIn(session.user);
      else renderAccount();
    }, function () { renderAccount(); });
  } else {
    renderAccount();
  }

  /* ========================================================================
     4. QUOTE BUILDER — live estimate
     ======================================================================== */
  const builderForm  = $('#builderForm');
  const summaryLines = $('#summaryLines');
  const comboNote    = $('#comboNote');
  const comboText    = $('#comboNoteText');
  const strikeTotal  = $('#strikeTotal');
  const grandTotalEl = $('#grandTotal');
  const reelQtyEl    = $('#reelQty');
  const reelMinus    = $('#reelMinus');
  const reelPlus     = $('#reelPlus');

  const REEL_MIN = 1;
  const REEL_MAX = 5;
  let reelQty = 2;

  const TIP_DEFAULT = 'Select Website + Reel + Video Editing to get the ' +
                      formatINR(COMBO.price) + ' combo!';

  function readSelection() {
    const checked = $$('input[name="service"]:checked', builderForm)
      .map(function (i) { return i.value; });
    const website = checked.indexOf('website') > -1;
    const maint = $('#maintenance').value;

    // Both add-ons ride along with a website. Ticked without one they are
    // simply not charged, which is also what the cart does.
    const shopShoot = website && $('#shopShoot').checked;

    return {
      website: website,
      reel:    checked.indexOf('reel') > -1,
      video:   checked.indexOf('video') > -1,
      businessType: $('#businessType').value,
      shopShoot: shopShoot,
      shopShootPrice: shopShoot ? PRICES.shopShoot : 0,
      maintenance: website ? maint : 'none',
      maintenancePrice: website ? (PRICES.maintenance[maint] || 0) : 0,
      reels: reelQty
    };
  }

  /**
   * Price a selection.
   *
   * The Combo Package bundles a website, two reels, one edited video and a
   * year of domain + hosting. It is only substituted when it actually costs
   * the visitor less than the same items bought separately — a "discount"
   * that raised the price would not be one.
   */
  function priceSelection(sel) {
    const alaCarte =
      (sel.website ? PRICES.website : 0) +
      (sel.reel ? reelTotal(sel.reels) : 0) +
      (sel.video ? PRICES.video : 0);

    const allThree = sel.website && sel.reel && sel.video;
    let comboApplies = false;
    let comboTotal = 0;
    let comboListPrice = 0;

    if (allThree) {
      const reels = Math.max(sel.reels, COMBO.reelsIncluded);
      comboTotal = COMBO.price + (reels - COMBO.reelsIncluded) * PRICES.reelExtra;
      // What the combo's own contents would cost bought separately
      comboListPrice = PRICES.website + reelTotal(reels) + PRICES.video;
      comboApplies = comboTotal < comboListPrice;
    }

    const servicesTotal = comboApplies ? comboTotal : alaCarte;

    return {
      allThree: allThree,
      comboApplies: comboApplies,
      comboTotal: comboTotal,
      comboListPrice: comboListPrice,
      alaCarte: alaCarte,
      addons: sel.shopShootPrice + sel.maintenancePrice,
      total: servicesTotal + sel.shopShootPrice + sel.maintenancePrice
    };
  }

  /** Repaint the estimate. Called on every change. */
  function updateBuilder() {
    const sel = readSelection();
    const q = priceSelection(sel);

    // Reel price in the option list tracks the quantity
    const reelPriceEl = $('[data-price-for="reel"]');
    if (reelPriceEl) reelPriceEl.textContent = formatINR(reelTotal(sel.reels));

    // Sub-fields stay in place (as in the design) but go dim and inert until
    // their service is ticked, so the "(if X selected)" hints are actionable.
    // The two add-ons hang off the website, not off a service of their own.
    [['#subWebsite', sel.website], ['#subReel', sel.reel], ['#subShoot', sel.website]]
      .forEach(function (pair) {
        const field = $(pair[0]);
        if (!field) return;
        field.classList.toggle('is-dim', !pair[1]);
        $$('select, input, button', field).forEach(function (ctrl) {
          ctrl.disabled = !pair[1];
        });
      });

    // Every row is always shown; unselected ones read as a dash.
    const rows = [
      ['Website',          sel.website ? formatINR(PRICES.website) : '–'],
      ['Reels (' + sel.reels + ')', sel.reel ? formatINR(reelTotal(sel.reels)) : '–'],
      ['Video Editing',    sel.video ? formatINR(PRICES.video) : '–'],
      ['Domain + Hosting (1 yr)', (sel.website || q.comboApplies) ? 'included free' : '–'],
      ['Store Photos',     sel.shopShootPrice ? formatINR(sel.shopShootPrice) : '–'],
      ['Maintenance',      sel.maintenancePrice ? formatINR(sel.maintenancePrice) : '–']
    ];

    if (q.comboApplies) rows.push(['Combo Package', formatINR(q.comboTotal)]);

    summaryLines.innerHTML = '';
    rows.forEach(function (row) {
      const li = document.createElement('li');
      const a = document.createElement('span');
      const b = document.createElement('span');
      a.textContent = row[0];
      b.textContent = row[1];
      li.appendChild(a);
      li.appendChild(b);
      summaryLines.appendChild(li);
    });

    grandTotalEl.textContent = formatINR(q.total);

    if (q.comboApplies) {
      strikeTotal.textContent = formatINR(q.comboListPrice + q.addons);
      strikeTotal.hidden = false;
      comboText.textContent = 'Combo discount applied — you save ' +
        formatINR(q.comboListPrice - q.comboTotal) + '.';
    } else {
      strikeTotal.hidden = true;
      comboText.textContent = q.allThree
        ? 'Combo Package is ' + formatINR(COMBO.price) +
          ' and includes 1-year domain + hosting.'
        : TIP_DEFAULT;
    }

    return q;
  }

  function setReelQty(next) {
    reelQty = Math.min(REEL_MAX, Math.max(REEL_MIN, next));
    reelQtyEl.textContent = String(reelQty);
    reelMinus.disabled = reelQty === REEL_MIN;
    reelPlus.disabled  = reelQty === REEL_MAX;
    updateBuilder();
  }
  reelMinus.addEventListener('click', function () { setReelQty(reelQty - 1); });
  reelPlus.addEventListener('click',  function () { setReelQty(reelQty + 1); });

  builderForm.addEventListener('change', updateBuilder);
  builderForm.addEventListener('submit', function (e) { e.preventDefault(); });

  /* The builder is just another way to fill the cart, so everything the
     visitor ticked is added as its own line they can still edit there. */
  $('#builderSend').addEventListener('click', function () {
    const sel = readSelection();
    const q = priceSelection(sel);

    if (!sel.website && !sel.reel && !sel.video && !sel.maintenancePrice && !sel.shopShootPrice) {
      openCart();          // nothing ticked — just show them the cart
      return;
    }

    if (q.comboApplies) {
      // Cheaper as the bundle, so add that instead of the separate pieces.
      addToCart({ id: 'combo', name: 'Combo Package', price: COMBO.price, kind: 'web' });
      const extraReels = Math.max(sel.reels, COMBO.reelsIncluded) - COMBO.reelsIncluded;
      if (extraReels > 0) {
        addToCart({
          id: 'reel', name: 'Reel Making', price: PRICES.reel,
          step: PRICES.reelExtra, kind: 'media', qty: extraReels
        });
      }
    } else {
      if (sel.website) {
        addToCart({
          id: 'website', name: 'Website Development', price: PRICES.website,
          kind: 'web', note: sel.businessType
        });
      }
      if (sel.reel) {
        addToCart({
          id: 'reel', name: 'Reel Making', price: PRICES.reel,
          step: PRICES.reelExtra, kind: 'media', qty: sel.reels
        });
      }
      if (sel.video) {
        addToCart({
          id: 'video', name: 'Video Editing', price: PRICES.video,
          kind: 'media'
        });
      }
    }

    // Add-ons last, so the website they depend on is already in the cart and
    // the gate in addToCart lets them through.
    if (sel.shopShootPrice > 0) {
      addToCart({
        id: 'shopshoot', name: 'Store Photoshoot', price: PRICES.shopShoot,
        kind: 'media', max: 1
      });
    }

    if (sel.maintenancePrice > 0) {
      addToCart({
        id: sel.maintenance === '1 Year' ? 'maint12' : 'maint6',
        name: 'Maintenance — ' + sel.maintenance,
        price: sel.maintenancePrice,
        kind: 'web',
        max: 1
      });
    }

    openCart();
  });

  setReelQty(reelQty);   // paints the initial estimate too


  /* ========================================================================
     4b. CART + UPI CHECKOUT

     The cart is the whole ordering flow: pick any mix of services, choose to
     pay half or in full, and hand off to a UPI app. There is no gateway and
     no backend, which has one consequence worth stating plainly: this site
     cannot know whether a payment succeeded. A UPI transfer only tells the
     business that money arrived, not who sent it. That is why the order is
     stamped with a reference and why the last step asks the customer to send
     it over — it is the only thing linking a payment to an order.
     ======================================================================== */
  const CART_KEY = 'we3.cart.v1';   // v1 could hold the retired domain item
  const MAX_QTY  = 20;

  let cart = [];

  /* ---- persistence (best effort; private mode can throw) ---- */
  function loadCart() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      cart = Array.isArray(parsed) ? parsed.filter(function (i) {
        return i && typeof i.id === 'string' && typeof i.price === 'number';
      }) : [];
    } catch (e) {
      cart = [];
    }
  }
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* ignore */ }
  }

  /* ---- elements ---- */
  const cartEl       = $('#cart');
  const cartPanel    = $('.cart__panel', cartEl);
  const cartItemsEl  = $('#cartItems');
  const cartEmptyEl  = $('#cartEmpty');
  const cartFootEl   = $('#cartFoot');
  const cartTipEl    = $('#cartTip');
  const cartTipText  = $('#cartTipText');
  const cartBar      = $('#cartBar');
  const cartScreen   = $('#cartScreen');
  const cartDone     = $('#cartDone');
  const subtotalEl   = $('#cartSubtotal');
  const halfAmtEl    = $('#halfAmt');
  const fullAmtEl    = $('#fullAmt');
  const payNowEl     = $('#payNow');
  const payBtn       = $('#payBtn');
  const payBtnLabel  = $('#payBtnLabel');
  const cartErr      = $('#cartErr');
  const payScreen    = $('#payScreen');

  let lastCartFocus = null;
  let lastOrder = null;    // { id, amount, split, name, phone, items }

  /* ---- maths ---- */
  function cartSubtotal() {
    return cart.reduce(function (sum, i) { return sum + lineTotal(i); }, 0);
  }
  function cartCount() {
    return cart.reduce(function (n, i) { return n + i.qty; }, 0);
  }
  function amountDue(subtotal, split) {
    // Round to whole rupees so the UPI amount always matches what is shown.
    return split === 'full' ? subtotal : Math.round(subtotal / 2);
  }
  function currentSplit() {
    const picked = $('input[name="paySplit"]:checked');
    return picked ? picked.value : 'half';
  }

  /* ---- mutations ---- */
  /** Is a website package — on its own or as the combo — in the cart? */
  function hasWebBase() {
    return cart.some(function (i) { return WEB_BASE.indexOf(i.id) > -1; });
  }

  function addToCart(item) {
    // The store photoshoot and maintenance are sold with a website, never on
    // their own. The buttons for them are disabled without one, so this is
    // the backstop rather than the thing a visitor normally meets.
    if (WEB_ADDONS.indexOf(item.id) > -1 && !hasWebBase()) return;

    // A maintenance plan is bought once, so it carries max: 1 and clicking
    // its button again cannot push the quantity past one.
    const max = item.max || MAX_QTY;
    const existing = cart.find(function (i) { return i.id === item.id; });
    if (existing) {
      existing.max = max;
      // A cart saved before the ladder existed has no step; adopt it so an
      // old basket reprices the same way a new one does.
      existing.step = item.step || existing.step || 0;
      existing.qty = Math.min(max, existing.qty + (item.qty || 1));
      if (item.note) existing.note = item.note;
      if (item.name) existing.name = item.name;
    } else {
      cart.push({
        id: item.id,
        name: item.name,
        price: item.price,
        step: item.step || 0,   // price of each one after the first, if different
        kind: item.kind || 'web',
        qty: Math.min(max, item.qty || 1),
        max: max,
        note: item.note || ''
      });
    }
    saveCart();
    renderCart();
  }

  function setQty(id, qty) {
    const item = cart.find(function (i) { return i.id === id; });
    if (!item) return;
    item.qty = Math.max(1, Math.min(item.max || MAX_QTY, qty));
    saveCart();
    renderCart();
  }

  function removeFromCart(id) {
    cart = cart.filter(function (i) { return i.id !== id; });
    saveCart();
    renderCart();
  }

  /* ---- rendering ---- */
  function renderCart() {
    // Taking the website out orphans its add-ons, so they come out with it.
    const removed = pruneOrphanAddons();
    if (removed.length) saveCart();
    syncAddonGates();

    const count = cartCount();
    const subtotal = cartSubtotal();

    $$('[data-cart-count]').forEach(function (badge) {
      badge.textContent = String(count);
      badge.hidden = count === 0;
    });
    // Blinkit-style: the bar is the only thing that appears when something is
    // added, so adding never covers the page someone is reading.
    cartBar.hidden = count === 0;
    document.body.classList.toggle('has-cartbar', count > 0);
    if (count > 0) {
      $('#cartBarCount').textContent = count + (count === 1 ? ' item' : ' items');
      $('#cartBarTotal').textContent = formatINR(subtotal);
    }
    syncCartBarSpace();

    cartEmptyEl.hidden = count > 0;
    cartFootEl.hidden  = count === 0;

    cartItemsEl.innerHTML = '';
    cart.forEach(function (item) {
      const li = document.createElement('li');
      li.className = 'cart__item';

      const left = document.createElement('div');
      const nameEl = document.createElement('div');
      nameEl.className = 'cart__item-name';
      nameEl.textContent = item.name;
      left.appendChild(nameEl);

      // "each" only earns its place once there is more than one of something
      const unitBits = [];
      if (item.note) unitBits.push(item.note);
      if (item.qty > 1 && !item.step) unitBits.push(formatINR(item.price) + ' each');
      if (unitBits.length) {
        const unit = document.createElement('div');
        unit.className = 'cart__item-unit';
        unit.textContent = unitBits.join(' · ');
        left.appendChild(unit);
      }

      const price = document.createElement('div');
      price.className = 'cart__item-price';
      price.textContent = formatINR(lineTotal(item));

      const controls = document.createElement('div');
      controls.className = 'cart__item-controls';

      const fixedQty = (item.max || MAX_QTY) === 1;

      const qty = document.createElement('div');
      qty.className = 'cart__qty';

      const minus = document.createElement('button');
      minus.type = 'button';
      minus.innerHTML = '<i class="fa-solid fa-minus" aria-hidden="true"></i>';
      minus.setAttribute('aria-label', 'Reduce quantity of ' + item.name);
      minus.disabled = item.qty <= 1;
      minus.addEventListener('click', function () { setQty(item.id, item.qty - 1); });

      const num = document.createElement('span');
      num.textContent = String(item.qty);

      const plus = document.createElement('button');
      plus.type = 'button';
      plus.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i>';
      plus.setAttribute('aria-label', 'Increase quantity of ' + item.name);
      plus.disabled = item.qty >= (item.max || MAX_QTY);
      plus.addEventListener('click', function () { setQty(item.id, item.qty + 1); });

      qty.appendChild(minus);
      qty.appendChild(num);
      qty.appendChild(plus);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'cart__remove';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + item.name + ' from cart');
      remove.addEventListener('click', function () { removeFromCart(item.id); });

      if (fixedQty) {
        const one = document.createElement('span');
        one.className = 'cart__qty-fixed';
        one.textContent = 'One-time';
        controls.appendChild(one);
      } else {
        controls.appendChild(qty);
      }
      controls.appendChild(remove);

      li.appendChild(left);
      li.appendChild(price);
      li.appendChild(controls);
      cartItemsEl.appendChild(li);
    });

    subtotalEl.textContent = formatINR(subtotal);
    halfAmtEl.textContent  = formatINR(amountDue(subtotal, 'half'));
    fullAmtEl.textContent  = formatINR(amountDue(subtotal, 'full'));

    const due = amountDue(subtotal, currentSplit());
    payNowEl.textContent = formatINR(due);
    payBtnLabel.textContent = 'Proceed to Pay ' + formatINR(due);

    renderComboTip(removed);
  }

  // What the Combo Package stands in for.
  const COMBO_COVERS = ['website', 'reel', 'video'];

  /**
   * Only suggest the Combo Package when swapping to it genuinely costs less,
   * and say so when an add-on had to come out of the cart.
   *
   * The combo tip must never talk someone into paying more, so it is priced
   * against what they actually have rather than assumed to be a saving.
   */
  function renderComboTip(removed) {
    // A removal note outranks the upsell: it explains something that just
    // changed under them.
    if (removed && removed.length) {
      cartTipText.textContent =
        (removed.length === 1 ? removed[0] + ' was removed' : 'Add-ons were removed') +
        ' — ' + (removed.length === 1 ? 'it goes' : 'they go') +
        ' with a website package, and there is no longer one in your cart.';
      cartTipEl.hidden = false;
      return;
    }

    const hasCombo = cart.some(function (i) { return i.id === 'combo'; });
    const ids = cart.map(function (i) { return i.id; });
    const coversCombo = COMBO_COVERS.every(function (id) {
      return ids.indexOf(id) > -1;
    });

    if (hasCombo || !coversCombo) {
      cartTipEl.hidden = true;
      return;
    }

    // What the combo would replace, keeping anything it does not cover.
    const replaced = cart.filter(function (i) {
      return COMBO_COVERS.indexOf(i.id) > -1;
    }).reduce(function (sum, i) { return sum + lineTotal(i); }, 0);

    const saving = replaced - COMBO.price;
    if (saving <= 0) {
      cartTipEl.hidden = true;
      return;
    }

    cartTipText.textContent =
      'The Combo Package covers all of this for ' + formatINR(COMBO.price) +
      ' — you would save ' + formatINR(saving) + '.';
    cartTipEl.hidden = false;
  }

  /* ---- open / close ---- */
  function openCart() {
    setNavOpen(false);
    lastCartFocus = document.activeElement;
    cartEl.hidden = false;
    document.body.classList.add('is-locked');
    showCartScreen();
    renderCart();
    cartPanel.focus({ preventScroll: true });
  }

  function closeCart() {
    cartEl.hidden = true;
    document.body.classList.remove('is-locked');
    if (lastCartFocus && typeof lastCartFocus.focus === 'function') {
      lastCartFocus.focus({ preventScroll: true });
    }
  }

  function showCartScreen() {
    cartScreen.hidden = false;
    cartDone.hidden = true;
    payScreen.hidden = true;
    if (ordersScreen) ordersScreen.hidden = true;
  }
  function showDoneScreen() {
    cartScreen.hidden = true;
    cartDone.hidden = false;
    payScreen.hidden = true;
    if (ordersScreen) ordersScreen.hidden = true;
  }

  $$('[data-open-cart]').forEach(function (el) {
    el.addEventListener('click', openCart);
  });
  $$('[data-close-cart]', cartEl).forEach(function (el) {
    el.addEventListener('click', closeCart);
  });

  /* ---- "Add to Cart" buttons ---- */
  /**
   * Reserves exactly as much room at the foot of the page as the bar takes.
   *
   * Measured rather than guessed: the bar is taller on a phone with a home
   * indicator, and a hard-coded number left the last line of the footer
   * underneath it.
   */
  function syncCartBarSpace() {
    const h = cartBar.hidden ? 0 : Math.ceil(cartBar.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--cartbar-h', h + 'px');
  }

  window.addEventListener('resize', syncCartBarSpace);

  /**
   * Says "Added" on the button for a moment.
   *
   * Adding no longer opens the cart, so without this the click has no visible
   * answer beyond a bar at the bottom of the screen that may be nowhere near
   * the thumb that pressed it.
   */
  const addedTimers = new WeakMap();
  function flashAdded(btn) {
    if (!addedTimers.has(btn)) btn.dataset.label = btn.innerHTML;
    clearTimeout(addedTimers.get(btn));
    btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Added';
    btn.classList.add('is-added');
    addedTimers.set(btn, setTimeout(function () {
      btn.innerHTML = btn.dataset.label;
      btn.classList.remove('is-added');
    }, 1500));
  }

  $$('[data-add]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const before = cartCount();
      addToCart({
        id: btn.dataset.add,
        name: btn.dataset.name,
        price: parseInt(btn.dataset.price, 10),
        step: btn.dataset.step ? parseInt(btn.dataset.step, 10) : 0,
        kind: btn.dataset.kind,
        max: btn.dataset.max ? parseInt(btn.dataset.max, 10) : undefined
      });
      // A one-per-order add-on already at its limit changes nothing, and
      // saying "Added" then would be a lie.
      if (cartCount() > before) flashAdded(btn);
    });
  });

  /**
   * Keeps the add-on buttons honest about whether they can be used.
   *
   * Without this a visitor could buy six months of maintenance for a site
   * that does not exist, or take the disabled button as the site being
   * broken. The note under each block says which it is.
   */
  function syncAddonGates() {
    const unlocked = hasWebBase();
    $$('[data-needs-web]').forEach(function (el) {
      if (el.tagName === 'BUTTON') el.disabled = !unlocked;
      else el.classList.toggle('is-locked', !unlocked);
    });
    $$('[data-gate-note]').forEach(function (note) { note.hidden = unlocked; });
  }

  /**
   * Drops add-ons when the website they hang off is taken out of the cart.
   *
   * Returns the names removed so the cart can say what happened — silently
   * deleting a line someone paid attention to is worse than the mistake.
   */
  function pruneOrphanAddons() {
    if (hasWebBase()) return [];
    const orphans = cart.filter(function (i) { return WEB_ADDONS.indexOf(i.id) > -1; });
    if (!orphans.length) return [];
    cart = cart.filter(function (i) { return WEB_ADDONS.indexOf(i.id) === -1; });
    return orphans.map(function (i) { return i.name; });
  }

  /* ---- UPI ---- */
  function upiConfigured() {
    return Boolean(CONFIG.upi.id) && !/placeholder/i.test(CONFIG.upi.id);
  }

  function makeOrderId() {
    // Short, readable, and unique enough for a small business's volume.
    const stamp = Date.now().toString(36).slice(-4).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 4).toUpperCase();
    return 'WE3-' + stamp + rand;
  }

  function buildUpiLink(amount, orderId) {
    // Built by hand rather than with URLSearchParams, which encodes spaces as
    // "+" — some UPI apps show that literally in the payment note.
    return 'upi://pay' +
      // "@" stays raw, as every bank-issued UPI link writes it — some apps
      // do not un-escape %40 in the payee address.
      '?pa=' + encodeURIComponent(CONFIG.upi.id).replace(/%40/g, '@') +
      '&pn=' + encodeURIComponent(CONFIG.upi.payeeName) +
      '&am=' + encodeURIComponent(amount.toFixed(2)) +
      '&cu=INR' +
      '&tn=' + encodeURIComponent(CONFIG.businessName + ' order ' + orderId) +
      '&tr=' + encodeURIComponent(orderId);
  }

  /**
   * Opens the UPI link by clicking a real anchor. Assigning location.href
   * works in most browsers but iOS Safari is unreliable with custom schemes
   * unless the navigation comes from a click.
   */
  const upiLaunchEl = document.createElement('a');
  upiLaunchEl.id = 'upiLaunch';
  upiLaunchEl.hidden = true;
  document.body.appendChild(upiLaunchEl);

  function launchUpi(link) {
    upiLaunchEl.href = link;
    upiLaunchEl.click();
  }

  function showCartError(msg) {
    cartErr.textContent = msg;
    cartErr.hidden = false;
  }

  payBtn.addEventListener('click', function () {
    // With accounts switched on, ordering needs one — it is what makes the
    // order history follow them to another phone. Their details are already
    // typed in, so this comes back to exactly where they were.
    if (db.ready && !db.user) {
      openAuth({
        mode: 'register',
        reason: 'Create an account so you can see this order from any phone. ' +
                'It takes a username and a password.',
        then: function () { payBtn.click(); }
      });
      return;
    }

    const nameEl = $('#cartName');
    const phoneEl = $('#cartPhone');
    const bizEl = $('#cartBusiness');
    const name = nameEl.value.trim();
    const phone = phoneEl.value.trim();
    const business = bizEl.value.trim();
    const email = $('#cartEmail').value.trim();
    const brief = $('#cartBrief').value.trim();
    const digits = phone.replace(/\D/g, '');

    cartErr.hidden = true;

    if (name.length < 2) {
      showCartError('Please enter your name so we can match the payment to you.');
      nameEl.focus();
      return;
    }
    if (digits.length < 10 || digits.length > 13) {
      showCartError('Please enter a valid phone number.');
      phoneEl.focus();
      return;
    }
    // Without this the team gets a payment and no idea whose website it is.
    if (business.length < 2) {
      showCartError('Please enter your business or shop name — we need to know what we are building.');
      bizEl.focus();
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      showCartError('That email address does not look right. Leave it blank if you would rather not share it.');
      $('#cartEmail').focus();
      return;
    }
    if (!upiConfigured()) {
      showCartError('Online payment is not switched on yet — the UPI ID still needs to be set. ' +
                    'Please send your order on WhatsApp instead and we will share payment details.');
      return;
    }

    const subtotal = cartSubtotal();
    const split = currentSplit();
    const amount = amountDue(subtotal, split);
    const orderId = makeOrderId();

    // Held, not recorded: nothing is saved and the cart is left alone until
    // the visitor says they have actually paid.
    lastOrder = {
      id: orderId,
      amount: amount,
      subtotal: subtotal,
      split: split,
      name: name,
      phone: phone,
      business: business,
      email: email,
      brief: brief,
      items: cart.slice()
    };

    showPayScreen(lastOrder);
  });

  /* ---- The scan-and-pay screen ---- */
  function showPayScreen(order) {
    $('#payAmount').textContent = formatINR(order.amount);
    $('#paySplitNote').textContent = order.split === 'half'
      ? '50% advance of ' + formatINR(order.subtotal) +
        ' — ' + formatINR(order.subtotal - order.amount) + ' on delivery'
      : 'Full payment';
    $('#payOrderId').textContent = order.id;
    $('#payUpiId').textContent = CONFIG.upi.id;

    const acct = $('#payAccount');
    if (acct) {
      acct.textContent = CONFIG.upi.accountName
        ? 'Your UPI app will show the account name ' + CONFIG.upi.accountName + '.'
        : '';
      acct.hidden = !CONFIG.upi.accountName;
    }

    const qr = $('#payQr');
    qr.innerHTML = '';
    if (CONFIG.upi.qrImage) {
      qr.classList.remove('pay__qr--empty');
      const img = document.createElement('img');
      img.src = CONFIG.upi.qrImage;
      img.alt = 'UPI QR code for ' + CONFIG.businessName;
      qr.appendChild(img);
    } else {
      // No QR configured yet — say so rather than showing something scannable.
      qr.classList.add('pay__qr--empty');
      const note = document.createElement('p');
      note.className = 'pay__qr-missing';
      note.innerHTML = '<strong>QR not set up yet</strong>' +
        'Use the UPI ID below, or message us on WhatsApp and we will send ' +
        'payment details.';
      qr.appendChild(note);
    }

    cartScreen.hidden = true;
    cartDone.hidden = true;
    if (ordersScreen) ordersScreen.hidden = true;
    payScreen.hidden = false;
  }

  $('#payOpenApp').addEventListener('click', function () {
    if (!lastOrder) return;
    // Opens whichever UPI app the phone has, with the amount already filled
    // in. On a desktop browser nothing happens, which is why the QR and the
    // UPI ID are on screen too.
    launchUpi(buildUpiLink(lastOrder.amount, lastOrder.id));
  });

  $('#payCopyUpi').addEventListener('click', function () {
    const btn = $('#payCopyUpi');
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(CONFIG.upi.id).then(function () {
      btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Copied';
      setTimeout(function () {
        btn.innerHTML = '<i class="fa-solid fa-copy" aria-hidden="true"></i> Copy';
      }, 1800);
    }, function () { /* ignore */ });
  });

  $('#payCancel').addEventListener('click', function () {
    lastOrder = null;
    showCartScreen();
  });

  /* ---- "I have paid" — the order goes into the book as pending ---- */
  $('#payDoneBtn').addEventListener('click', function () {
    if (!lastOrder) return;

    lastOrder.status = 'pending';
    recordOrder(lastOrder);

    // Now that the order is placed the cart starts fresh; the items live on
    // in the order history rather than lingering as a half-finished basket.
    cart = [];
    saveCart();
    renderCart();

    $('#doneOrderId').textContent = lastOrder.id;
    $('#doneAmount').textContent = formatINR(lastOrder.amount) +
      (lastOrder.split === 'half' ? ' (50% advance)' : ' (full payment)');

    showDoneScreen();
  });

  $('#backToCart').addEventListener('click', showCartScreen);

  /* ---- Send the order across so the payment can be matched to it ---- */
  $('#sendOrderBtn').addEventListener('click', function () {
    if (!lastOrder) return;

    openWhatsApp(orderMessage(lastOrder), numberForCart(lastOrder.items));
    markOrderShared(lastOrder.id);
  });

  /* Re-price when the half/full choice changes */
  $$('input[name="paySplit"]').forEach(function (radio) {
    radio.addEventListener('change', function () { renderCart(); });
  });

  /* Escape closes the cart (handled before the modal, which sits above it) */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !cartEl.hidden && modal.hidden && authModal.hidden) closeCart();
  });

  loadCart();
  renderCart();


  /* ------------------------------------------------------------------------
     ORDER HISTORY

     Saved in this browser only. There is no account system and no server, so
     this cannot follow someone to another phone — the panel says so plainly
     rather than implying a real order history exists behind it.
     ------------------------------------------------------------------------ */
  const ORDERS_KEY = 'we3.orders.v1';
  const MAX_ORDERS = 25;

  let orders = [];

  const ordersScreen = $('#ordersScreen');
  const ordersListEl = $('#ordersList');
  const ordersEmpty  = $('#ordersEmpty');
  const ordersNote   = $('#ordersNote');
  const ordersNoteHi = $('#ordersNoteHi');

  function loadLocalOrders() {
    try {
      const raw = localStorage.getItem(ORDERS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      orders = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      orders = [];
    }
  }
  function saveOrders() {
    try { localStorage.setItem(ORDERS_KEY, JSON.stringify(orders)); } catch (e) { /* ignore */ }
  }

  /** A database row in the shape the rest of this file already speaks. */
  function fromRow(row) {
    return {
      id: row.ref,
      at: Date.parse(row.created_at) || Date.now(),
      name: row.customer_name,
      business: row.business,
      phone: row.phone,
      email: row.email || '',
      brief: row.brief || '',
      items: Array.isArray(row.items) ? row.items : [],
      subtotal: row.total,
      amount: row.paid,
      split: row.pay_mode,
      status: row.status || 'pending',
      note: row.note || '',
      shared: true       // it reached us, or it would not be in the table
    };
  }

  /**
   * Signed in, orders come from the database — which is the whole point: they
   * show up on any phone, and a status the team sets is really theirs. Signed
   * out, or with no project configured, this browser's own storage is all
   * there is, exactly as before.
   */
  function loadOrders() {
    if (!db.ready || !db.user) { loadLocalOrders(); renderOrders(); return; }

    db.client.from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(MAX_ORDERS)
      .then(function (res) {
        if (res.error) { loadLocalOrders(); renderOrders(); return; }
        orders = (res.data || []).map(fromRow);
        renderOrders();
      }, function () { loadLocalOrders(); renderOrders(); });
  }

  function recordOrder(order) {
    const full = Object.assign({ at: Date.now(), shared: false, status: 'pending' }, order);
    orders.unshift(full);
    orders = orders.slice(0, MAX_ORDERS);

    // Kept locally either way. If the insert fails — offline, a lapsed
    // session — the customer still has their order in front of them, and the
    // WhatsApp message still carries everything we need.
    saveOrders();
    renderOrders();

    if (!db.ready || !db.user) return;

    db.client.from('orders').insert({
      ref: full.id,
      user_id: db.user.id,
      customer_name: full.name,
      business: full.business || '',
      phone: full.phone,
      email: full.email || null,
      brief: full.brief || null,
      items: full.items.map(function (i) {
        return { name: i.name, qty: i.qty, price: i.price, step: i.step || 0 };
      }),
      total: full.subtotal,
      paid: full.amount,
      pay_mode: full.split
    }).then(function () { /* stored */ }, function () { /* local copy stands */ });
  }

  function markOrderShared(id) {
    const found = orders.find(function (o) { return o.id === id; });
    if (!found) return;
    found.shared = true;
    saveOrders();
    renderOrders();
  }

  function formatDate(ms) {
    try {
      return new Date(ms).toLocaleDateString('en-IN',
        { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  /**
   * The message a customer sends when they say they have paid.
   *
   * The admin page reads this back apart to fill its form, so the labels are
   * a contract between the two files — change one and change the other.
   */
  function orderMessage(order) {
    const balance = order.subtotal - order.amount;
    const lines = ['Hi ' + CONFIG.businessName + ', I have paid for my order.'];
    lines.push('Order: ' + order.id);
    lines.push('Name: ' + order.name);
    lines.push('Phone: ' + order.phone);
    if (order.business) lines.push('Business: ' + order.business);
    if (order.email) lines.push('Email: ' + order.email);
    lines.push('');
    order.items.forEach(function (i) {
      lines.push('• ' + i.name + ' x' + i.qty + ' — ' + formatINR(lineTotal(i)));
    });
    lines.push('');
    lines.push('Total: ' + formatINR(order.subtotal));
    lines.push('Paid now: ' + formatINR(order.amount) +
               (order.split === 'half' ? ' (50% advance)' : ' (full payment)'));
    if (balance > 0) {
      lines.push('Balance on delivery: ' + formatINR(balance));
    }
    lines.push('Paid to UPI: ' + CONFIG.upi.id);
    if (order.brief) {
      lines.push('');
      lines.push('What they need: ' + order.brief);
    }
    lines.push('');
    lines.push('Sending the payment screenshot next.');
    return lines.join('\n');
  }

  function renderOrders() {
    // The count shows in the drawer's tab and in the header
    $$('[data-orders-count]').forEach(function (badge) {
      badge.textContent = String(orders.length);
      badge.hidden = orders.length === 0;
    });

    ordersEmpty.hidden = orders.length > 0;
    ordersNote.hidden  = orders.length === 0;
    ordersNoteHi.hidden = orders.length === 0;
    ordersListEl.innerHTML = '';

    orders.forEach(function (order) {
      const li = document.createElement('li');
      li.className = 'order';

      const head = document.createElement('div');
      head.className = 'order__head';
      const idEl = document.createElement('span');
      idEl.className = 'order__id';
      idEl.textContent = order.id;
      const dateEl = document.createElement('span');
      dateEl.className = 'order__date';
      dateEl.textContent = formatDate(order.at);
      head.appendChild(idEl);
      head.appendChild(dateEl);

      // Set by us once the payment has actually been checked. Without a
      // server nothing can flip this from outside this browser, so it stays
      // "pending" until that exists — see the note in the panel.
      const state = order.status || 'pending';
      const LABELS = {
        pending:  ['pending',  'Pending verification'],
        verified: ['verified', 'Payment verified'],
        rejected: ['rejected', 'Payment not received']
      };
      const label = LABELS[state] || LABELS.pending;

      const status = document.createElement('span');
      status.className = 'order__status order__status--' + label[0];
      status.textContent = label[1];

      const itemsEl = document.createElement('div');
      itemsEl.className = 'order__items';
      order.items.forEach(function (i) {
        const row = document.createElement('span');
        row.textContent = i.name + ' x' + i.qty + ' — ' + formatINR(lineTotal(i));
        itemsEl.appendChild(row);
      });

      const totals = document.createElement('div');
      totals.className = 'order__totals';

      const totalRow = document.createElement('div');
      totalRow.innerHTML = '<span>Total</span>';
      const tv = document.createElement('strong');
      tv.textContent = formatINR(order.subtotal);
      totalRow.appendChild(tv);

      const paidRow = document.createElement('div');
      paidRow.className = 'order__paid';
      paidRow.innerHTML = '<span>' +
        (order.split === 'half' ? 'Paid (50% advance)' : 'Paid in full') + '</span>';
      const pv = document.createElement('strong');
      pv.textContent = formatINR(order.amount);
      paidRow.appendChild(pv);

      totals.appendChild(totalRow);
      totals.appendChild(paidRow);

      if (order.split === 'half') {
        const balRow = document.createElement('div');
        balRow.innerHTML = '<span>Balance on delivery</span>';
        const bv = document.createElement('strong');
        bv.textContent = formatINR(order.subtotal - order.amount);
        balRow.appendChild(bv);
        totals.appendChild(balRow);
      }

      const resend = document.createElement('button');
      resend.type = 'button';
      resend.className = 'order__resend';
      // Once a payment is confirmed, asking for the screenshot again reads as
      // if something went wrong. The button stays — people want to reach us —
      // but it stops chasing a thing that is already done.
      const resendLabel = state === 'verified' ? 'Message us on WhatsApp'
        : state === 'rejected' ? 'Send the screenshot again'
        : order.shared ? 'Send again on WhatsApp'
        : 'Send screenshot on WhatsApp';
      resend.innerHTML = '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i> ' +
                         resendLabel;
      resend.addEventListener('click', function () {
        openWhatsApp(orderMessage(order), numberForCart(order.items));
        markOrderShared(order.id);
      });

      li.appendChild(head);
      li.appendChild(status);
      li.appendChild(itemsEl);
      li.appendChild(totals);
      li.appendChild(resend);
      ordersListEl.appendChild(li);
    });
  }

  function showOrdersScreen() {
    cartScreen.hidden = true;
    cartDone.hidden = true;
    ordersScreen.hidden = false;
  }

  $$('[data-show-orders]').forEach(function (el) {
    el.addEventListener('click', function () {
      if (cartEl.hidden) openCart();
      showOrdersScreen();
    });
  });
  $$('[data-show-cart]').forEach(function (el) {
    el.addEventListener('click', showCartScreen);
  });

  /* ---- a status link flips an order to verified or rejected --------------

     Without a server this browser can never learn what the team decided, so
     the team carries the decision instead: the order book builds a link,
     sends it on WhatsApp, and opening it updates the order here.

     This is not a security boundary and is not trying to be one. A customer
     could edit the address bar and mark their own order verified in their own
     browser. It gains them nothing — the team's order book is the record, and
     the money is reconciled against that, not against this.                */
  const STATUSES = ['verified', 'rejected', 'pending'];

  function applyStatusLink() {
    let params;
    try { params = new URLSearchParams(location.search); } catch (e) { return; }

    const id = (params.get('order') || '').trim().toUpperCase();
    const status = (params.get('status') || '').trim().toLowerCase();
    if (!id || STATUSES.indexOf(status) === -1) return;

    // Take it out of the address bar, so a reload does not replay it and a
    // forwarded link does not carry someone else's status.
    try {
      history.replaceState(null, '', location.pathname + location.hash);
    } catch (e) { /* ignore */ }

    const found = orders.find(function (o) { return o.id === id; });
    if (found) {
      found.status = status;
      saveOrders();
    }
    renderOrders();
    showStatusBanner(id, status, !!found);

    openCart();
    showOrdersScreen();
  }

  function showStatusBanner(id, status, onThisDevice) {
    const box = $('#orderFlash');
    if (!box) return;

    const COPY = {
      verified: {
        cls: 'is-good',
        icon: 'fa-circle-check',
        en: 'Payment confirmed for order ' + id + '. We have started work — ' +
            'we will be in touch on WhatsApp.',
        hi: 'ऑर्डर ' + id + ' का पेमेंट कन्फर्म हो गया है। हमने काम शुरू कर दिया ' +
            'है — WhatsApp पर आपसे बात करते रहेंगे।'
      },
      rejected: {
        cls: 'is-bad',
        icon: 'fa-circle-exclamation',
        en: 'We could not find the payment for order ' + id + ' yet. Please ' +
            'send us the payment screenshot on WhatsApp and we will check again.',
        hi: 'ऑर्डर ' + id + ' का पेमेंट अभी हमें नहीं मिला है। कृपया WhatsApp पर ' +
            'पेमेंट का स्क्रीनशॉट भेज दीजिए, हम दोबारा चेक करेंगे।'
      },
      pending: {
        cls: 'is-wait',
        icon: 'fa-hourglass-half',
        en: 'Order ' + id + ' is still being checked. We confirm every payment ' +
            'by hand, usually within 3 hours.',
        hi: 'ऑर्डर ' + id + ' अभी चेक हो रहा है। हर पेमेंट हम खुद देखते हैं, ' +
            'आमतौर पर 3 घंटे के अंदर।'
      }
    };
    const c = COPY[status];

    box.className = 'flash ' + c.cls;
    box.innerHTML = '';

    const icon = document.createElement('i');
    icon.className = 'fa-solid ' + c.icon + ' flash__ico';
    icon.setAttribute('aria-hidden', 'true');
    box.appendChild(icon);

    const en = document.createElement('p');
    en.className = 'flash__en';
    en.textContent = c.en;
    box.appendChild(en);

    const hi = document.createElement('p');
    hi.className = 'flash__hi';
    hi.lang = 'hi';
    hi.textContent = c.hi;
    box.appendChild(hi);

    // The order itself was placed on another phone, or the browser was
    // cleared. Say so rather than leaving them hunting for it in the list.
    if (!onThisDevice) {
      const note = document.createElement('p');
      note.className = 'flash__note';
      note.textContent = 'This order was placed on a different phone, so it is ' +
                         'not in the list below.';
      box.appendChild(note);
    }

    box.hidden = false;
  }

  loadOrders();
  applyStatusLink();

  /* ========================================================================
     5. WORK FILTER
     ======================================================================== */
  const workCards = $$('#workGrid .work');
  const workEmpty = $('#workEmpty');

  $$('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      const filter = chip.dataset.filter;

      $$('.chip').forEach(function (c) {
        const active = c === chip;
        c.classList.toggle('is-active', active);
        c.setAttribute('aria-selected', String(active));
      });

      let shown = 0;
      workCards.forEach(function (card) {
        const match = filter === 'all' || card.dataset.category === filter;
        card.classList.toggle('is-hidden', !match);
        if (match) shown++;
      });

      workEmpty.hidden = shown > 0;
    });
  });

  /* ========================================================================
     6. FAQ ACCORDION — one panel open at a time
     ======================================================================== */
  const accButtons = $$('.acc__btn');

  accButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const isOpen = btn.getAttribute('aria-expanded') === 'true';

      accButtons.forEach(function (other) {
        other.setAttribute('aria-expanded', 'false');
        other.closest('.acc').classList.remove('is-open');
        $('#' + other.getAttribute('aria-controls')).classList.remove('is-open');
      });

      if (!isOpen) {
        btn.setAttribute('aria-expanded', 'true');
        btn.closest('.acc').classList.add('is-open');
        $('#' + btn.getAttribute('aria-controls')).classList.add('is-open');
      }
    });
  });

  /* ========================================================================
     7. CONTACT FORM — validates, then hands off to WhatsApp. Never submits.
     ======================================================================== */
  const contactForm = $('#contactForm');

  function validate(input, errorEl, test) {
    const ok = test(input.value.trim());
    input.classList.toggle('is-invalid', !ok);
    errorEl.hidden = ok;
    input.setAttribute('aria-invalid', String(!ok));
    return ok;
  }

  contactForm.addEventListener('submit', function (e) {
    e.preventDefault();      // there is no server — this never posts

    const name     = $('#cfName');
    const business = $('#cfBusiness');
    const phone    = $('#cfPhone');
    const service  = $('#cfService');

    const okName = validate(name, $('#cfNameErr'), function (v) { return v.length > 1; });
    const okBiz  = validate(business, $('#cfBusinessErr'), function (v) { return v.length > 1; });
    const okPhone = validate(phone, $('#cfPhoneErr'), function (v) {
      const digits = v.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 13;
    });
    const okSvc = validate(service, $('#cfServiceErr'), function (v) { return v !== ''; });

    if (!okName || !okBiz || !okPhone || !okSvc) {
      const firstBad = $('.is-invalid', contactForm);
      if (firstBad) firstBad.focus();
      return;
    }

    openWhatsApp(templates.contact({
      name: name.value.trim(),
      business: business.value.trim(),
      phone: phone.value.trim(),
      service: service.value,
      message: $('#cfMessage').value.trim()
    }), numberForService(service.value));
  });

  // Clear the error state as soon as the visitor starts fixing it
  $$('#contactForm .input, #contactForm select').forEach(function (field) {
    const evt = field.tagName === 'SELECT' ? 'change' : 'input';
    field.addEventListener(evt, function () {
      if (!field.classList.contains('is-invalid')) return;
      field.classList.remove('is-invalid');
      field.removeAttribute('aria-invalid');
      const err = $('#' + field.id + 'Err');
      if (err) err.hidden = true;
    });
  });

  /* ========================================================================
     8. COUNT-UP ON THE TRUST STATS
     ======================================================================== */
  const counters = $$('[data-count]');

  function runCount(el) {
    const target = parseInt(el.dataset.count, 10);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const duration = 1000;
    const start = performance.now();

    function frame(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);     // easeOutCubic
      el.textContent = prefix + Math.round(target * eased) + suffix;
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (counters.length) {
    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      // Final values are already in the markup — nothing to animate
      counters.forEach(function (el) {
        el.textContent = (el.dataset.prefix || '') + el.dataset.count + (el.dataset.suffix || '');
      });
    } else {
      const io = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          runCount(entry.target);
          obs.unobserve(entry.target);
        });
      }, { threshold: 0.6 });
      counters.forEach(function (el) { io.observe(el); });
    }
  }

  /* ========================================================================
     9. SMOOTH SCROLL for in-page anchors
        (CSS handles the motion; this keeps focus correct for keyboard users)
     ======================================================================== */
  $$('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      const id = link.getAttribute('href');
      if (id === '#' || id.length < 2) return;

      const target = document.querySelector(id);
      if (!target) return;

      e.preventDefault();
      target.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start'
      });
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      history.replaceState(null, '', id);
    });
  });

  /* ========================================================================
     9b. REVEAL ON SCROLL
     Cards ease in as they arrive. If the visitor prefers less movement, or
     the browser has no observer, everything is simply shown.
     ======================================================================== */
  const revealables = $$('[data-reveal]');

  if (revealables.length) {
    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      revealables.forEach(function (el) { el.classList.add('is-shown'); });
    } else {
      // Siblings follow each other in, which reads better than a row of
      // cards appearing all at once.
      const groups = new Map();
      revealables.forEach(function (el) {
        const parent = el.parentElement;
        if (!groups.has(parent)) groups.set(parent, 0);
        const i = groups.get(parent);
        el.style.setProperty('--reveal-delay', (i * 70) + 'ms');
        groups.set(parent, i + 1);
      });

      const io = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          obs.unobserve(entry.target);
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

      revealables.forEach(function (el) { io.observe(el); });

      // Failsafe. The reveal is decoration; content must never be stuck
      // invisible because an observer callback was missed on a slow device
      // or during a fast scroll. After a few seconds anything still hidden
      // is simply shown.
      setTimeout(function () {
        revealables.forEach(function (el) {
          if (!el.classList.contains('is-in')) el.classList.add('is-shown');
        });
      }, 4000);
    }
  }

  /* ========================================================================
     10. ODDS AND ENDS
     ======================================================================== */
  $('#year').textContent = new Date().getFullYear();

  // Keep mailto links in sync with CONFIG.email
  $$('a[href^="mailto:"]').forEach(function (a) {
    a.href = 'mailto:' + CONFIG.email;
    a.textContent = CONFIG.email;
  });
})();
