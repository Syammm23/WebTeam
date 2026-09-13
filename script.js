/* ==========================================================================
   BrandName — site behaviour
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
    businessName: "BrandName",
    email: "hello@brandname.com",          // PLACEHOLDER

    // Two lines, split by what the enquiry is about. Country code + number,
    // digits only, no "+" and no spaces.
    whatsapp: {
      web:   "917990853947",               // websites, domain/hosting, maintenance
      media: "917990487721"                // reels and photo shoots
    },

    upi: {
      // ------------------------------------------------------------------
      // PLACEHOLDER — REPLACE THIS BEFORE GOING LIVE.
      // Put your real UPI ID here (e.g. "7990853947@ybl" or "name@okaxis").
      // Until it is changed the Pay button refuses to open a UPI app, so no
      // money can be sent to the wrong person by mistake.
      // ------------------------------------------------------------------
      id: "PLACEHOLDER@upi",
      payeeName: "BrandName"               // name shown inside the UPI app
    }
  };

  /* Prices used by the quote builder (₹). Keep in sync with the cards. */
  const PRICES = {
    website: 5000,
    reel: 2000,          // per reel
    photo: 1000,
    domain: 1500,        // domain + hosting, 1 year
    maintenance: { "none": 0, "6 Months": 2000, "1 Year": 4000 }
  };

  const COMBO = {
    price: 12000,        // Combo Package headline price
    reelsIncluded: 2     // reels bundled into the combo
  };

  const prefersReducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------------
     UTILITIES
     ------------------------------------------------------------------------ */
  const $  = (sel, scope) => (scope || document).querySelector(sel);
  const $$ = (sel, scope) => Array.from((scope || document).querySelectorAll(sel));

  /** 12000 -> "₹12,000" */
  function formatINR(amount) {
    return '₹' + Number(amount).toLocaleString('en-IN');
  }

  /**
   * Single entry point for every WhatsApp hand-off on the site.
   * `number` decides which of the two lines the message goes to; it falls
   * back to the website line when nothing is passed.
   */
  function openWhatsApp(message, number) {
    const url = 'https://wa.me/' + (number || CONFIG.whatsapp.web) +
                '?text=' + encodeURIComponent(message);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /** Reels and photo shoots go to the media line; everything else to web. */
  const MEDIA_SERVICES = ['Reel Making', 'Photo Shoot'];
  function numberForService(service) {
    return MEDIA_SERVICES.indexOf(service) > -1
      ? CONFIG.whatsapp.media
      : CONFIG.whatsapp.web;
  }

  /**
   * A mixed cart goes to the website line — that is the bigger job and the
   * person there can loop in the media side.
   */
  function numberForCart(items) {
    const hasWeb = items.some(function (i) { return i.kind === 'web'; });
    return hasWeb ? CONFIG.whatsapp.web : CONFIG.whatsapp.media;
  }

  function formatPhone(number) {
    // 917990853947 -> +91 79908 53947
    const d = String(number).replace(/\D/g, '').slice(-10);
    return '+91 ' + d.slice(0, 5) + ' ' + d.slice(5);
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

    if (open) {
      navScrim.hidden = false;
      requestAnimationFrame(function () { navScrim.classList.add('is-open'); });
    } else {
      navScrim.classList.remove('is-open');
      setTimeout(function () {
        if (!navLinks.classList.contains('is-open')) navScrim.hidden = true;
      }, 200);
    }
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

  const TIP_DEFAULT = 'Select Website + Reel + Photo Shoot to get the ₹12,000 combo!';

  function readSelection() {
    const checked = $$('input[name="service"]:checked', builderForm)
      .map(function (i) { return i.value; });
    const maint = $('#maintenance').value;

    return {
      website: checked.indexOf('website') > -1,
      reel:    checked.indexOf('reel') > -1,
      photo:   checked.indexOf('photo') > -1,
      domain:  checked.indexOf('domain') > -1,
      businessType: $('#businessType').value,
      photoType: ($('input[name="photoType"]:checked', builderForm) || {}).value || 'Product Photos',
      maintenance: maint,
      maintenancePrice: PRICES.maintenance[maint] || 0,
      reels: reelQty
    };
  }

  /**
   * Price a selection.
   *
   * The Combo Package bundles a website, two reels, a photo shoot and a year
   * of domain + hosting for a flat ₹12,000. It is only substituted when it
   * actually costs the visitor less than the same items bought separately —
   * a "discount" that raised the price would not be one.
   */
  function priceSelection(sel) {
    const alaCarte =
      (sel.website ? PRICES.website : 0) +
      (sel.reel ? sel.reels * PRICES.reel : 0) +
      (sel.photo ? PRICES.photo : 0) +
      (sel.domain ? PRICES.domain : 0);

    const allThree = sel.website && sel.reel && sel.photo;
    let comboApplies = false;
    let comboTotal = 0;
    let comboListPrice = 0;

    if (allThree) {
      const reels = Math.max(sel.reels, COMBO.reelsIncluded);
      comboTotal = COMBO.price + (reels - COMBO.reelsIncluded) * PRICES.reel;
      // What the combo's own contents would cost bought separately
      comboListPrice = PRICES.website + reels * PRICES.reel + PRICES.photo + PRICES.domain;
      comboApplies = comboTotal < comboListPrice;
    }

    const servicesTotal = comboApplies ? comboTotal : alaCarte;

    return {
      allThree: allThree,
      comboApplies: comboApplies,
      comboTotal: comboTotal,
      comboListPrice: comboListPrice,
      alaCarte: alaCarte,
      total: servicesTotal + sel.maintenancePrice
    };
  }

  /** Repaint the estimate. Called on every change. */
  function updateBuilder() {
    const sel = readSelection();
    const q = priceSelection(sel);

    // Reel price in the option list tracks the quantity
    const reelPriceEl = $('[data-price-for="reel"]');
    if (reelPriceEl) reelPriceEl.textContent = formatINR(sel.reels * PRICES.reel);

    // Sub-fields stay in place (as in the design) but go dim and inert until
    // their service is ticked, so the "(if X selected)" hints are actionable.
    [['#subWebsite', sel.website], ['#subReel', sel.reel], ['#subPhoto', sel.photo]]
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
      ['Reels (' + sel.reels + ')', sel.reel ? formatINR(sel.reels * PRICES.reel) : '–'],
      ['Photo Shoot',      sel.photo ? formatINR(PRICES.photo) : '–'],
      ['Domain + Hosting', (sel.domain || q.comboApplies) ? (q.comboApplies ? 'included' : formatINR(PRICES.domain)) : '–'],
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
      strikeTotal.textContent = formatINR(q.comboListPrice + sel.maintenancePrice);
      strikeTotal.hidden = false;
      comboText.textContent = 'Combo discount applied — you save ' +
        formatINR(q.comboListPrice - q.comboTotal) + '.';
    } else {
      strikeTotal.hidden = true;
      comboText.textContent = q.allThree
        ? 'Combo Package is ₹12,000 and includes 1-year domain + hosting.'
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

    if (!sel.website && !sel.reel && !sel.photo && !sel.domain && !sel.maintenancePrice) {
      openCart();          // nothing ticked — just show them the cart
      return;
    }

    if (q.comboApplies) {
      // Cheaper as the bundle, so add that instead of the separate pieces.
      addToCart({ id: 'combo', name: 'Combo Package', price: COMBO.price, kind: 'web' });
      const extraReels = Math.max(sel.reels, COMBO.reelsIncluded) - COMBO.reelsIncluded;
      if (extraReels > 0) {
        addToCart({ id: 'reel', name: 'Reel Making', price: PRICES.reel, kind: 'media', qty: extraReels });
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
          kind: 'media', qty: sel.reels
        });
      }
      if (sel.photo) {
        addToCart({
          id: 'photo', name: 'Photo Shoot', price: PRICES.photo,
          kind: 'media', note: sel.photoType
        });
      }
      if (sel.domain) {
        addToCart({
          id: 'domain', name: 'Domain + Hosting (1 Year)', price: PRICES.domain, kind: 'web'
        });
      }
    }

    if (sel.maintenancePrice > 0) {
      addToCart({
        id: sel.maintenance === '1 Year' ? 'maint12' : 'maint6',
        name: 'Maintenance — ' + sel.maintenance,
        price: sel.maintenancePrice,
        kind: 'web'
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
  const CART_KEY = 'brandname.cart.v1';
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
  const cartFab      = $('#cartFab');
  const cartScreen   = $('#cartScreen');
  const cartDone     = $('#cartDone');
  const subtotalEl   = $('#cartSubtotal');
  const halfAmtEl    = $('#halfAmt');
  const fullAmtEl    = $('#fullAmt');
  const payNowEl     = $('#payNow');
  const payBtn       = $('#payBtn');
  const payBtnLabel  = $('#payBtnLabel');
  const cartErr      = $('#cartErr');
  const upiIdText    = $('#upiIdText');

  let lastCartFocus = null;
  let lastOrder = null;    // { id, amount, split, name, phone, items }

  /* ---- maths ---- */
  function cartSubtotal() {
    return cart.reduce(function (sum, i) { return sum + i.price * i.qty; }, 0);
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
  function addToCart(item) {
    const existing = cart.find(function (i) { return i.id === item.id; });
    if (existing) {
      existing.qty = Math.min(MAX_QTY, existing.qty + (item.qty || 1));
      if (item.note) existing.note = item.note;
      if (item.name) existing.name = item.name;
    } else {
      cart.push({
        id: item.id,
        name: item.name,
        price: item.price,
        kind: item.kind || 'web',
        qty: Math.min(MAX_QTY, item.qty || 1),
        note: item.note || ''
      });
    }
    saveCart();
    renderCart();
  }

  function setQty(id, qty) {
    const item = cart.find(function (i) { return i.id === id; });
    if (!item) return;
    item.qty = Math.max(1, Math.min(MAX_QTY, qty));
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
    const count = cartCount();
    const subtotal = cartSubtotal();

    $$('[data-cart-count]').forEach(function (badge) {
      badge.textContent = String(count);
      badge.hidden = count === 0;
    });
    cartFab.hidden = count === 0;

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
      if (item.qty > 1) unitBits.push(formatINR(item.price) + ' each');
      if (unitBits.length) {
        const unit = document.createElement('div');
        unit.className = 'cart__item-unit';
        unit.textContent = unitBits.join(' · ');
        left.appendChild(unit);
      }

      const price = document.createElement('div');
      price.className = 'cart__item-price';
      price.textContent = formatINR(item.price * item.qty);

      const controls = document.createElement('div');
      controls.className = 'cart__item-controls';

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
      plus.disabled = item.qty >= MAX_QTY;
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

      controls.appendChild(qty);
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
    payBtnLabel.textContent = 'Pay ' + formatINR(due) + ' via UPI';

    renderComboTip(subtotal);
    upiIdText.textContent = CONFIG.upi.id;
  }

  /**
   * Only suggest the Combo Package when swapping to it genuinely costs less.
   * At the current prices it does not, so this stays quiet — which is the
   * point: it must never talk someone into paying more.
   */
  function renderComboTip(subtotal) {
    const hasCombo = cart.some(function (i) { return i.id === 'combo'; });
    const ids = cart.map(function (i) { return i.id; });
    const coversCombo = ['website', 'reel', 'photo'].every(function (id) {
      return ids.indexOf(id) > -1;
    });

    if (hasCombo || !coversCombo) {
      cartTipEl.hidden = true;
      return;
    }

    // What the combo would replace, keeping anything it does not cover.
    const replaced = cart.filter(function (i) {
      return ['website', 'reel', 'photo', 'domain'].indexOf(i.id) > -1;
    }).reduce(function (sum, i) { return sum + i.price * i.qty; }, 0);

    const saving = replaced - 12000;
    if (saving <= 0) {
      cartTipEl.hidden = true;
      return;
    }

    cartTipText.textContent =
      'The Combo Package covers all of this for ₹12,000 — you would save ' +
      formatINR(saving) + '.';
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
  }
  function showDoneScreen() {
    cartScreen.hidden = true;
    cartDone.hidden = false;
  }

  $$('[data-open-cart]').forEach(function (el) {
    el.addEventListener('click', openCart);
  });
  $$('[data-close-cart]', cartEl).forEach(function (el) {
    el.addEventListener('click', closeCart);
  });

  /* ---- "Add to Cart" buttons ---- */
  $$('[data-add]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      addToCart({
        id: btn.dataset.add,
        name: btn.dataset.name,
        price: parseInt(btn.dataset.price, 10),
        kind: btn.dataset.kind
      });
      openCart();
    });
  });

  /* ---- UPI ---- */
  function upiConfigured() {
    return Boolean(CONFIG.upi.id) && !/placeholder/i.test(CONFIG.upi.id);
  }

  function makeOrderId() {
    // Short, readable, and unique enough for a small business's volume.
    const stamp = Date.now().toString(36).slice(-4).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 4).toUpperCase();
    return 'BN-' + stamp + rand;
  }

  function buildUpiLink(amount, orderId) {
    // Built by hand rather than with URLSearchParams, which encodes spaces as
    // "+" — some UPI apps show that literally in the payment note.
    return 'upi://pay' +
      '?pa=' + encodeURIComponent(CONFIG.upi.id) +
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
    const nameEl = $('#cartName');
    const phoneEl = $('#cartPhone');
    const name = nameEl.value.trim();
    const phone = phoneEl.value.trim();
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
    if (!upiConfigured()) {
      showCartError('Online payment is not switched on yet — the UPI ID still needs to be set. ' +
                    'Please send your order on WhatsApp instead and we will share payment details.');
      return;
    }

    const subtotal = cartSubtotal();
    const split = currentSplit();
    const amount = amountDue(subtotal, split);
    const orderId = makeOrderId();

    lastOrder = {
      id: orderId,
      amount: amount,
      subtotal: subtotal,
      split: split,
      name: name,
      phone: phone,
      items: cart.slice()
    };

    $('#doneOrderId').textContent = orderId;
    $('#doneAmount').textContent = formatINR(amount) +
      (split === 'half' ? ' (50% advance)' : ' (full payment)');

    showDoneScreen();

    // Hands off to whichever UPI app the phone has. On a desktop browser
    // nothing will happen, which is why the UPI ID is also shown on screen.
    launchUpi(buildUpiLink(amount, orderId));
  });

  $('#backToCart').addEventListener('click', showCartScreen);

  $('#copyUpi').addEventListener('click', function () {
    const btn = $('#copyUpi');
    const done = function () {
      btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Copied';
      setTimeout(function () {
        btn.innerHTML = '<i class="fa-regular fa-copy" aria-hidden="true"></i> Copy';
      }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(CONFIG.upi.id).then(done, function () { /* ignore */ });
    }
  });

  /* ---- Send the order across so the payment can be matched to it ---- */
  $('#sendOrderBtn').addEventListener('click', function () {
    if (!lastOrder) return;

    const lines = ['Hi ' + CONFIG.businessName + ', I have placed an order.'];
    lines.push('Order: ' + lastOrder.id);
    lines.push('Name: ' + lastOrder.name);
    lines.push('Phone: ' + lastOrder.phone);
    lines.push('');
    lastOrder.items.forEach(function (i) {
      lines.push('• ' + i.name + ' x' + i.qty + ' — ' + formatINR(i.price * i.qty));
    });
    lines.push('');
    lines.push('Total: ' + formatINR(lastOrder.subtotal));
    lines.push('Paid now: ' + formatINR(lastOrder.amount) +
               (lastOrder.split === 'half' ? ' (50% advance)' : ' (full payment)'));
    lines.push('Paid to UPI: ' + CONFIG.upi.id);

    openWhatsApp(lines.join('\n'), numberForCart(lastOrder.items));
  });

  /* Re-price when the half/full choice changes */
  $$('input[name="paySplit"]').forEach(function (radio) {
    radio.addEventListener('change', function () { renderCart(); });
  });

  /* Escape closes the cart (handled before the modal, which sits above it) */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !cartEl.hidden && modal.hidden) closeCart();
  });

  loadCart();
  renderCart();

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
     10. ODDS AND ENDS
     ======================================================================== */
  $('#year').textContent = new Date().getFullYear();

  // Keep mailto links in sync with CONFIG.email
  $$('a[href^="mailto:"]').forEach(function (a) {
    a.href = 'mailto:' + CONFIG.email;
    a.textContent = CONFIG.email;
  });
})();
