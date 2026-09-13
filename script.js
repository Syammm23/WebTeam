/* ==========================================================================
   BrandName — site behaviour
   Vanilla JS, no dependencies. Everything funnels into WhatsApp; there is no
   backend and no form is ever POSTed anywhere.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     CONFIG — the only block you need to edit when going live.
     PLACEHOLDER values: replace all three.
     ------------------------------------------------------------------------ */
  const CONFIG = {
    whatsappNumber: "91XXXXXXXXXX",   // country code + number, digits only
    businessName: "BrandName",
    email: "hello@brandname.com"
  };

  /* Pricing used by the service builder (all amounts in ₹).
     Keep these in sync with the pricing cards in index.html. */
  const PRICES = {
    website: 5000,
    reel: 2000,          // per reel
    photo: 1000,
    domain: 3000,        // PLACEHOLDER: domain + hosting, 1 year, at cost
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

  /** Format a number as Indian rupees, e.g. 12000 -> "₹12,000" */
  function formatINR(amount) {
    return '₹' + Number(amount).toLocaleString('en-IN');
  }

  /**
   * Single entry point for every WhatsApp hand-off on the site.
   * URL-encodes the message and opens wa.me in a new tab.
   */
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
      const who = name ? ", I'm " + name + "." : ",";
      return "Hi " + CONFIG.businessName + who +
             " I'm interested in " + serviceName + ". Can you share details?";
    },
    pkg(packageName, price, name) {
      const who = name ? ", I'm " + name + "." : ",";
      return "Hi " + CONFIG.businessName + who +
             " I want to book the " + packageName + " package (₹" + price + "). " +
             "Please share the next steps.";
    },
    contact(data) {
      return "Hi " + CONFIG.businessName + ", I'm " + data.name +
             " from " + data.business + ". Phone: " + data.phone +
             ". I need: " + data.service +
             ". Message: " + (data.message || '-');
    }
  };

  /* ========================================================================
     1. NAVBAR — sticky state + mobile drawer
     ======================================================================== */
  const nav       = $('#nav');
  const navToggle = $('#navToggle');
  const navLinks  = $('#navLinks');
  const navScrim  = $('#navScrim');

  function setNavOpen(open) {
    navLinks.classList.toggle('is-open', open);
    navScrim.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.classList.toggle('is-locked', open);
    if (open) {
      navScrim.hidden = false;
    } else {
      // Wait for the fade-out before removing it from the a11y tree
      setTimeout(function () {
        if (!navLinks.classList.contains('is-open')) navScrim.hidden = true;
      }, 260);
    }
  }

  navToggle.addEventListener('click', function () {
    setNavOpen(navToggle.getAttribute('aria-expanded') !== 'true');
  });
  navScrim.addEventListener('click', function () { setNavOpen(false); });

  // Any link inside the drawer closes it
  $$('#navLinks a').forEach(function (link) {
    link.addEventListener('click', function () { setNavOpen(false); });
  });

  // Solid background once the page has scrolled past the hero top
  function onScroll() {
    nav.classList.toggle('is-stuck', window.scrollY > 12);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ========================================================================
     2. WHATSAPP MODAL — service picker + focus trap
     ======================================================================== */
  const modal        = $('#waModal');
  const modalDialog  = $('.modal__dialog', modal);
  const modalPicker  = $('#modalPicker');
  const modalBooking = $('#modalBooking');
  const modalBookingText = $('#modalBookingText');
  const modalName    = $('#modalName');
  const modalContinue = $('#modalContinue');
  const modalTitle   = $('#modalTitle');
  const modalDesc    = $('#modalDesc');

  let lastFocused = null;     // element to restore focus to on close
  let bookingContext = null;  // { name, price } when opened from a pricing card

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /**
   * Open the modal.
   * @param {Object} options
   * @param {string} [options.service]  pre-selected service pill
   * @param {Object} [options.booking]  { name, price } — switches to booking mode
   */
  function openModal(options) {
    const opts = options || {};
    setNavOpen(false);            // in case it was opened from the mobile drawer
    lastFocused = document.activeElement;
    bookingContext = opts.booking || null;

    if (bookingContext) {
      // Booking mode: the package is already decided, hide the picker
      modalPicker.hidden = true;
      modalBooking.hidden = false;
      modalBookingText.textContent =
        bookingContext.name + ' — ₹' + bookingContext.price;
      modalTitle.textContent = 'Book on WhatsApp';
      modalDesc.textContent =
        'Add your name if you like, then continue — we will confirm everything on chat.';
    } else {
      modalPicker.hidden = false;
      modalBooking.hidden = true;
      modalTitle.textContent = 'Start on WhatsApp';
      modalDesc.textContent =
        'Pick what you are interested in and we will pick it up from there.';

      const preset = $('input[name="modalService"][value="' + (opts.service || 'Not Sure') + '"]', modal);
      if (preset) preset.checked = true;
    }

    modal.hidden = false;
    document.body.classList.add('is-locked');

    // Focus the dialog itself — screen readers announce it and Tab then walks
    // the controls in order (the service pills are visually hidden inputs).
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

  // Close on the X button and on backdrop click
  $$('[data-close-modal]', modal).forEach(function (el) {
    el.addEventListener('click', closeModal);
  });

  // Escape closes the modal (or the mobile drawer)
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!modal.hidden) { closeModal(); return; }
    if (navLinks.classList.contains('is-open')) setNavOpen(false);
  });

  // Focus trap — keep Tab cycling inside the dialog while it is open
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || modal.hidden) return;

    const items = $$(FOCUSABLE, modalDialog).filter(function (el) {
      return el.offsetParent !== null;   // skip anything hidden
    });
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

  // Any element with data-wa-modal opens the picker
  $$('[data-wa-modal]').forEach(function (el) {
    el.addEventListener('click', function () {
      openModal({ service: el.dataset.service });
    });
  });

  // Pricing cards / maintenance options open the modal in booking mode
  $$('[data-wa-package]').forEach(function (el) {
    el.addEventListener('click', function () {
      openModal({
        booking: { name: el.dataset.waPackage, price: el.dataset.waPrice }
      });
    });
  });

  modalContinue.addEventListener('click', function () {
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
     3. SERVICE BUILDER — live price estimate
     ======================================================================== */
  const builderForm = $('#builderForm');
  const summaryEl   = $('#summary');
  const summaryLines = $('#summaryLines');
  const comboNote    = $('#comboNote');
  const strikeTotal  = $('#strikeTotal');
  const grandTotalEl = $('#grandTotal');
  const reelQtyEl    = $('#reelQty');
  const reelMinus    = $('#reelMinus');
  const reelPlus     = $('#reelPlus');
  const fab          = $('#fab');

  const REEL_MIN = 1;
  const REEL_MAX = 5;
  let reelQty = 1;

  /** Read every control and return the current selection. */
  function readSelection() {
    const checked = $$('input[name="service"]:checked', builderForm)
      .map(function (input) { return input.value; });

    const maintenanceSelect = $('#maintenance');

    return {
      website: checked.indexOf('website') > -1,
      reel:    checked.indexOf('reel') > -1,
      photo:   checked.indexOf('photo') > -1,
      domain:  checked.indexOf('domain') > -1,
      businessType: $('#businessType').value,
      photoType: ($('input[name="photoType"]:checked', builderForm) || {}).value || 'Product Photos',
      maintenance: maintenanceSelect.value,
      maintenancePrice: PRICES.maintenance[maintenanceSelect.value] || 0,
      reels: reelQty
    };
  }

  /**
   * Turn a selection into priced line items plus a total.
   * The combo kicks in only when Website + Reel + Photo Shoot are all picked;
   * it bundles domain + hosting and two reels, so a single-reel selection is
   * lifted to the two the package includes.
   */
  function priceSelection(sel) {
    const lines = [];
    let total = 0;
    let isCombo = sel.website && sel.reel && sel.photo;
    let reels = sel.reels;
    let bumped = false;

    if (isCombo && reels < COMBO.reelsIncluded) {
      reels = COMBO.reelsIncluded;   // the package already includes two
      bumped = true;
    }

    if (isCombo) {
      const extraReels = reels - COMBO.reelsIncluded;
      const comboTotal = COMBO.price + extraReels * PRICES.reel;

      // What the same contents would cost bought separately
      const listTotal = PRICES.website + reels * PRICES.reel +
                        PRICES.photo + PRICES.domain;

      lines.push({ label: 'Custom website (' + sel.businessType + ')', value: 'included' });
      lines.push({
        label: 'Instagram reels × ' + reels + (bumped ? ' (combo includes 2)' : ''),
        value: extraReels > 0 ? formatINR(extraReels * PRICES.reel) + ' extra' : 'included'
      });
      lines.push({ label: 'Photo shoot (' + sel.photoType + ')', value: 'included' });
      lines.push({ label: 'Domain + hosting (1 year)', value: 'free' });
      lines.push({ label: 'Combo Package', value: formatINR(COMBO.price), strong: true });

      total = comboTotal;
      strikeTotal.textContent = formatINR(listTotal + sel.maintenancePrice);
      strikeTotal.hidden = false;
      comboNote.hidden = false;
    } else {
      strikeTotal.hidden = true;
      comboNote.hidden = true;

      if (sel.website) {
        lines.push({
          label: 'Website (' + sel.businessType + ')',
          value: formatINR(PRICES.website)
        });
        total += PRICES.website;
      }
      if (sel.reel) {
        lines.push({
          label: 'Instagram reels × ' + reels,
          value: formatINR(reels * PRICES.reel)
        });
        total += reels * PRICES.reel;
      }
      if (sel.photo) {
        lines.push({
          label: 'Photo shoot (' + sel.photoType + ')',
          value: formatINR(PRICES.photo)
        });
        total += PRICES.photo;
      }
      if (sel.domain) {
        lines.push({
          label: 'Domain + hosting (1 year)',
          value: formatINR(PRICES.domain)
        });
        total += PRICES.domain;
      }
    }

    if (sel.maintenancePrice > 0) {
      lines.push({
        label: 'Maintenance — ' + sel.maintenance,
        value: formatINR(sel.maintenancePrice)
      });
      total += sel.maintenancePrice;
    }

    return { lines: lines, total: total, isCombo: isCombo, reels: reels };
  }

  /** Repaint the summary panel. Called on every change. */
  function updateBuilder() {
    const sel = readSelection();

    // Show or hide the dependent sub-fields
    $('#subWebsite').hidden = !sel.website;
    $('#subReel').hidden    = !sel.reel;
    $('#subPhoto').hidden   = !sel.photo;

    const quote = priceSelection(sel);

    summaryLines.innerHTML = '';
    if (!quote.lines.length) {
      const li = document.createElement('li');
      li.className = 'summary__empty';
      li.textContent = 'Nothing selected yet — tick a service to see your price.';
      summaryLines.appendChild(li);
    } else {
      quote.lines.forEach(function (line) {
        const li = document.createElement('li');
        const label = document.createElement('span');
        const value = document.createElement('span');
        label.textContent = line.label;
        value.textContent = line.value;
        if (line.strong) {
          label.style.color = 'var(--c-heading)';
          label.style.fontWeight = '600';
        }
        li.appendChild(label);
        li.appendChild(value);
        summaryLines.appendChild(li);
      });
    }

    grandTotalEl.textContent = formatINR(quote.total);
    return quote;
  }

  // Reel stepper
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

  // Send the built quote to WhatsApp
  $('#builderSend').addEventListener('click', function () {
    const sel = readSelection();
    const quote = priceSelection(sel);

    if (!quote.lines.length) {
      openWhatsApp("Hi " + CONFIG.businessName +
        ", I'd like a quote but I'm not sure what I need yet. Can you help?");
      return;
    }

    // Human-readable service list
    const services = [];
    if (sel.website) services.push('Website');
    if (sel.reel)    services.push(quote.reels + ' Reel' + (quote.reels > 1 ? 's' : ''));
    if (sel.photo)   services.push('Photo Shoot (' + sel.photoType + ')');
    if (sel.domain || quote.isCombo) services.push('Domain + Hosting');

    const parts = ["Hi " + CONFIG.businessName + ", I'd like a quote."];
    parts.push('Services: ' + services.join(', '));
    if (sel.website) parts.push('Business Type: ' + sel.businessType);
    parts.push('Maintenance: ' + (sel.maintenance === 'none' ? 'None' : sel.maintenance));
    if (quote.isCombo) parts.push('Combo discount applied');
    parts.push('Estimated Total: ' + formatINR(quote.total));

    openWhatsApp(parts.join('\n'));
  });

  setReelQty(1);   // paints the initial state of the summary too

  /* The summary is a bottom sheet on mobile — only show it while the builder
     section is on screen, and tuck the floating button away while it is up. */
  const builderSection = $('#builder');
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        const isMobile = window.matchMedia('(max-width: 1023px)').matches;
        const show = entry.isIntersecting && isMobile;
        summaryEl.classList.toggle('is-visible', show);
        fab.classList.toggle('is-tucked', show);
      });
    }, { threshold: 0.18 }).observe(builderSection);
  }

  /* ========================================================================
     4. PORTFOLIO FILTER
     ======================================================================== */
  const workCards = $$('#workGrid .card--work');
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
     5. FAQ ACCORDION — one panel open at a time
     ======================================================================== */
  const accButtons = $$('.acc__btn');

  accButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const isOpen = btn.getAttribute('aria-expanded') === 'true';

      // Close everything first
      accButtons.forEach(function (other) {
        other.setAttribute('aria-expanded', 'false');
        other.closest('.acc').classList.remove('is-open');
        $('#' + other.getAttribute('aria-controls')).classList.remove('is-open');
      });

      // Then reopen this one if it was closed
      if (!isOpen) {
        btn.setAttribute('aria-expanded', 'true');
        btn.closest('.acc').classList.add('is-open');
        $('#' + btn.getAttribute('aria-controls')).classList.add('is-open');
      }
    });
  });

  /* ========================================================================
     6. CONTACT FORM — validates, then hands off to WhatsApp. Never submits.
     ======================================================================== */
  const contactForm = $('#contactForm');

  function validateField(input, errorEl, test) {
    const ok = test(input.value.trim());
    input.classList.toggle('is-invalid', !ok);
    errorEl.hidden = ok;
    input.setAttribute('aria-invalid', String(!ok));
    return ok;
  }

  contactForm.addEventListener('submit', function (e) {
    e.preventDefault();   // there is no server — this never posts

    const name     = $('#cfName');
    const business = $('#cfBusiness');
    const phone    = $('#cfPhone');

    const okName = validateField(name, $('#cfNameErr'), function (v) { return v.length > 1; });
    const okBiz  = validateField(business, $('#cfBusinessErr'), function (v) { return v.length > 1; });
    const okPhone = validateField(phone, $('#cfPhoneErr'), function (v) {
      const digits = v.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 13;
    });

    if (!okName || !okBiz || !okPhone) {
      const firstBad = $('.input.is-invalid', contactForm);
      if (firstBad) firstBad.focus();
      return;
    }

    openWhatsApp(templates.contact({
      name: name.value.trim(),
      business: business.value.trim(),
      phone: phone.value.trim(),
      service: $('#cfService').value,
      message: $('#cfMessage').value.trim()
    }));
  });

  // Clear the error state as soon as the visitor starts fixing it
  $$('#contactForm .input').forEach(function (input) {
    input.addEventListener('input', function () {
      if (!input.classList.contains('is-invalid')) return;
      input.classList.remove('is-invalid');
      input.removeAttribute('aria-invalid');
      const err = $('#' + input.id + 'Err');
      if (err) err.hidden = true;
    });
  });

  /* ========================================================================
     7. SCROLL REVEALS — staggered by child index
     ======================================================================== */
  // Give children of a .stagger container an increasing delay
  $$('.stagger').forEach(function (group) {
    $$('.reveal', group).forEach(function (el, i) {
      el.style.setProperty('--reveal-delay', (i * 70) + 'ms');
    });
  });

  const revealEls = $$('.reveal');

  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    const revealObserver = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);   // reveal once, then stop watching
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ========================================================================
     8. COUNT-UP ON THE TRUST STATS
     ======================================================================== */
  const counters = $$('[data-count]');

  function runCount(el) {
    const target = parseInt(el.dataset.count, 10);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const duration = 1100;
    const start = performance.now();

    function frame(now) {
      const progress = Math.min((now - start) / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
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
      const countObserver = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          runCount(entry.target);
          obs.unobserve(entry.target);
        });
      }, { threshold: 0.6 });

      counters.forEach(function (el) { countObserver.observe(el); });
    }
  }

  /* ========================================================================
     9. SMOOTH SCROLL for in-page anchors
        (CSS handles it too; this keeps focus correct for keyboard users)
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

      // Move focus to the section so screen readers follow along
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      history.replaceState(null, '', id);
    });
  });

  /* ========================================================================
     10. ODDS AND ENDS
     ======================================================================== */
  // Footer copyright year
  $('#year').textContent = new Date().getFullYear();

  // Keep the mailto / tel links in sync with CONFIG.email
  $$('a[href^="mailto:"]').forEach(function (a) {
    a.href = 'mailto:' + CONFIG.email;
    a.textContent = CONFIG.email;
  });

  // Render the CDN icon set once the DOM is ready
  function renderIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }
  renderIcons();
})();
