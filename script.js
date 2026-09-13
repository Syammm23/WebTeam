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
    whatsappNumber: "919876543210",   // country code + number, digits only
    businessName: "BrandName",
    email: "hello@brandname.com"
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

  /** Single entry point for every WhatsApp hand-off on the site. */
  function openWhatsApp(message) {
    const url = 'https://wa.me/' + CONFIG.whatsappNumber +
                '?text=' + encodeURIComponent(message);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /* ------------------------------------------------------------------------
     MESSAGE TEMPLATES
     ------------------------------------------------------------------------ */
  const templates = {
    service(serviceName, name) {
      return "Hi " + CONFIG.businessName + (name ? ", I'm " + name + "." : ",") +
             " I'm interested in " + serviceName + ". Can you share details?";
    },
    pkg(packageName, price, name) {
      // Several names already end in "Package", so only add the word when it
      // is missing — otherwise the message reads "the Combo Package package".
      const label = /package$/i.test(packageName) ? packageName : packageName + ' package';
      return "Hi " + CONFIG.businessName + (name ? ", I'm " + name + "." : ",") +
             " I want to book the " + label + " (₹" + price + "). " +
             "Please share the next steps.";
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
  const modalBooking     = $('#modalBooking');
  const modalBookingText = $('#modalBookingText');
  const modalName        = $('#modalName');
  const modalTitle       = $('#modalTitle');
  const modalDesc        = $('#modalDesc');

  let lastFocused = null;
  let bookingContext = null;   // { name, price } when opened from a package

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
                    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function openModal(options) {
    const opts = options || {};
    setNavOpen(false);              // in case it was opened from the drawer
    lastFocused = document.activeElement;
    bookingContext = opts.booking || null;

    if (bookingContext) {
      modalPicker.hidden = true;
      modalBooking.hidden = false;
      modalBookingText.textContent = bookingContext.name + ' — ₹' + bookingContext.price;
      modalTitle.textContent = 'Book on WhatsApp';
      modalDesc.textContent = 'Add your name if you like, then continue — we will confirm everything on chat.';
    } else {
      modalPicker.hidden = false;
      modalBooking.hidden = true;
      modalTitle.textContent = 'Start on WhatsApp';
      modalDesc.textContent = 'Pick what you are interested in and we will take it from there.';

      const preset = $('input[name="modalService"][value="' + (opts.service || 'Not Sure') + '"]', modal);
      if (preset) preset.checked = true;
    }

    modal.hidden = false;
    document.body.classList.add('is-locked');
    modalDialog.focus({ preventScroll: true });
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('is-locked');
    bookingContext = null;
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

  $$('[data-wa-package]').forEach(function (el) {
    el.addEventListener('click', function () {
      openModal({ booking: { name: el.dataset.waPackage, price: el.dataset.waPrice } });
    });
  });

  $('#modalContinue').addEventListener('click', function () {
    const name = modalName.value.trim();
    let message;

    if (bookingContext) {
      message = templates.pkg(bookingContext.name, bookingContext.price, name);
    } else {
      const picked = $('input[name="modalService"]:checked', modal);
      const service = picked ? picked.value : 'Not Sure';
      message = service === 'Not Sure'
        ? "Hi " + CONFIG.businessName + (name ? ", I'm " + name + "." : ",") +
          " I'd like to get my business online but I'm not sure what I need. Can you help?"
        : templates.service(service, name);
    }

    openWhatsApp(message);
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

  $('#builderSend').addEventListener('click', function () {
    const sel = readSelection();
    const q = priceSelection(sel);

    if (!sel.website && !sel.reel && !sel.photo && !sel.domain && !sel.maintenancePrice) {
      openWhatsApp("Hi " + CONFIG.businessName +
        ", I'd like a quote but I'm not sure what I need yet. Can you help?");
      return;
    }

    const services = [];
    if (sel.website) services.push('Website');
    if (sel.reel)    services.push(sel.reels + ' Reel' + (sel.reels > 1 ? 's' : ''));
    if (sel.photo)   services.push('Photo Shoot (' + sel.photoType + ')');
    if (sel.domain || q.comboApplies) services.push('Domain + Hosting');

    const parts = ["Hi " + CONFIG.businessName + ", I'd like a quote."];
    if (services.length) parts.push('Services: ' + services.join(', '));
    if (sel.website) parts.push('Business Type: ' + sel.businessType);
    parts.push('Maintenance: ' + (sel.maintenance === 'none' ? 'None' : sel.maintenance));
    if (q.comboApplies) parts.push('Combo discount applied');
    parts.push('Estimated Total: ' + formatINR(q.total));

    openWhatsApp(parts.join('\n'));
  });

  setReelQty(reelQty);   // paints the initial estimate too

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
    }));
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
