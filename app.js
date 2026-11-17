// Deal Math: back-of-envelope multifamily calculator.
// Everything recalculates live on every keystroke or slider move.

(function () {
  'use strict';

  // ---------- Starting values ----------
  var DEFAULTS = {
    units: 100,
    rent: 1500,        // $/unit/month
    occ: 95,           // %
    otherMode: 'unit', // 'unit' = $/unit/month, 'total' = $/year
    otherUnit: 50,
    otherTotal: 60000,
    expMode: 'unit',   // 'unit' = $/unit/year, 'pct' = % of EGI
    expUnit: 6000,
    expPct: 40,
    cap: 5.5,          // %
    price: 0,          // filled in from cap on first run
    anchor: 'cap'      // which pricing number to hold when income/expenses change
  };

  var STORAGE_KEY = 'dealmath.v1';
  var state = load();

  // ---------- Formatting helpers ----------
  function money(n) {
    if (!isFinite(n)) return '—';
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  }
  function moneyShort(n) {
    if (!isFinite(n)) return '—';
    var a = Math.abs(n), sign = n < 0 ? '-' : '';
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e5) return sign + '$' + Math.round(a / 1e3) + 'K';
    if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
    return sign + '$' + Math.round(a);
  }
  function pct(n, dp) {
    if (!isFinite(n)) return '—';
    return n.toFixed(dp === undefined ? 2 : dp) + '%';
  }
  function plain(n, dp) {
    // For text inputs: commas, no symbol
    if (!isFinite(n)) return '';
    return n.toLocaleString('en-US', { maximumFractionDigits: dp === undefined ? 2 : dp });
  }

  // Reads "18.5m", "$185k", "1,250", "5.5%" etc. Returns NaN if not a number.
  function parse(str) {
    if (str == null) return NaN;
    var s = String(str).trim().toLowerCase().replace(/[$,%\s]/g, '');
    if (s === '') return NaN;
    var mult = 1;
    var last = s.slice(-1);
    if (last === 'k') mult = 1e3;
    else if (last === 'm') mult = 1e6;
    else if (last === 'b') mult = 1e9;
    if (mult !== 1) s = s.slice(0, -1);
    var n = parseFloat(s);
    return isFinite(n) ? n * mult : NaN;
  }

  // ---------- The math ----------
  function compute() {
    var units = state.units;
    var gpr = units * state.rent * 12;
    var vac = gpr * (1 - state.occ / 100);
    var other = state.otherMode === 'unit' ? state.otherUnit * units * 12 : state.otherTotal;
    var egi = gpr - vac + other;
    var exp = state.expMode === 'unit' ? state.expUnit * units : egi * state.expPct / 100;
    var noi = egi - exp;
    return { gpr: gpr, vac: vac, other: other, egi: egi, exp: exp, noi: noi };
  }

  // Keep cap and price in sync, holding whichever one you touched last.
  function syncPricing(noi) {
    if (state.anchor === 'cap') {
      state.price = state.cap > 0 && noi > 0 ? noi / (state.cap / 100) : 0;
    } else {
      state.cap = state.price > 0 ? (noi / state.price) * 100 : 0;
    }
  }

  // ---------- Wiring up the page ----------
  var $ = function (id) { return document.getElementById(id); };

  // Number formatting for each editable field
  var FIELD_FMT = {
    units: function (v) { return plain(v, 0); },
    rent: function (v) { return plain(v, 0); },
    occ: function (v) { return plain(v, 1); },
    otherUnit: function (v) { return plain(v, 0); },
    otherTotal: function (v) { return plain(v, 0); },
    expUnit: function (v) { return plain(v, 0); },
    expPct: function (v) { return plain(v, 1); },
    cap: function (v) { return v > 0 ? v.toFixed(2) : ''; },
    price: function (v) { return v > 0 ? plain(v, 0) : ''; },
    ppd: function (v) { return v > 0 ? plain(v, 0) : ''; }
  };

  function setSliderFill(slider) {
    var min = +slider.min, max = +slider.max, v = +slider.value;
    var p = max > min ? ((v - min) / (max - min)) * 100 : 0;
    slider.style.setProperty('--fill', Math.max(0, Math.min(100, p)) + '%');
  }

  // Write a value into a text box (unless you're typing in it) and its slider
  function show(key, value) {
    var box = $(key);
    if (box && document.activeElement !== box) box.value = FIELD_FMT[key](value);
    var slider = $(key + '-r');
    if (slider) {
      slider.value = value;
      setSliderFill(slider);
    }
  }

  function bindInput(key) {
    var box = $(key), slider = $(key + '-r');

    box.addEventListener('input', function () {
      var v = parse(box.value);
      if (!isFinite(v) || v < 0) return;   // ignore half-typed values
      state[key] = v;
      if (slider) { slider.value = v; setSliderFill(slider); }
      update();
    });
    box.addEventListener('blur', function () { box.value = FIELD_FMT[key](state[key]); });
    box.addEventListener('focus', function () { setTimeout(function () { box.select(); }, 0); });

    if (slider) {
      slider.addEventListener('input', function () {
        state[key] = +slider.value;
        box.value = FIELD_FMT[key](state[key]);
        setSliderFill(slider);
        update();
      });
    }
  }

  ['units', 'rent', 'occ', 'otherUnit', 'otherTotal', 'expUnit', 'expPct'].forEach(bindInput);

  // --- Pricing: cap rate (box + slider + nudge buttons), price, price/door ---
  var capBox = $('cap'), capSlider = $('cap-r'), priceBox = $('price'), ppdBox = $('ppd');

  function setCap(v) {
    state.cap = Math.max(0, Math.round(v * 100) / 100);
    state.anchor = 'cap';
    update();
  }
  capBox.addEventListener('input', function () {
    var v = parse(capBox.value);
    if (isFinite(v) && v > 0) setCap(v);
  });
  capBox.addEventListener('blur', function () { capBox.value = FIELD_FMT.cap(state.cap); });
  capBox.addEventListener('focus', function () { setTimeout(function () { capBox.select(); }, 0); });
  capSlider.addEventListener('input', function () { setCap(+capSlider.value); });
  Array.prototype.forEach.call(document.querySelectorAll('.nudge'), function (btn) {
    btn.addEventListener('click', function () { setCap(state.cap + parseFloat(btn.dataset.nudge)); });
  });

  priceBox.addEventListener('input', function () {
    var v = parse(priceBox.value);
    if (!isFinite(v) || v <= 0) return;
    state.price = v;
    state.anchor = 'price';
    update();
  });
  priceBox.addEventListener('blur', function () { priceBox.value = FIELD_FMT.price(state.price); });
  priceBox.addEventListener('focus', function () { setTimeout(function () { priceBox.select(); }, 0); });

  ppdBox.addEventListener('input', function () {
    var v = parse(ppdBox.value);
    if (!isFinite(v) || v <= 0 || state.units <= 0) return;
    state.price = v * state.units;
    state.anchor = 'price';
    update();
  });
  ppdBox.addEventListener('blur', function () {
    ppdBox.value = FIELD_FMT.ppd(state.units > 0 ? state.price / state.units : 0);
  });
  ppdBox.addEventListener('focus', function () { setTimeout(function () { ppdBox.select(); }, 0); });

  // --- Segmented toggles (other income + expense modes) ---
  Array.prototype.forEach.call(document.querySelectorAll('.seg'), function (seg) {
    var modeKey = seg.dataset.mode;
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () {
        state[modeKey] = btn.dataset.val;
        update();
      });
    });
  });

  function renderModes() {
    Array.prototype.forEach.call(document.querySelectorAll('.seg'), function (seg) {
      var current = state[seg.dataset.mode];
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function (btn) {
        btn.classList.toggle('on', btn.dataset.val === current);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-show]'), function (el) {
      var parts = el.dataset.show.split(':');
      el.hidden = state[parts[0]] !== parts[1];
    });
  }

  $('reset').addEventListener('click', function () {
    state = JSON.parse(JSON.stringify(DEFAULTS));
    if (document.activeElement) document.activeElement.blur();
    update();
  });

  // ---------- Redraw everything ----------
  function update() {
    var r = compute();
    syncPricing(r.noi);

    var units = state.units;
    var ppd = units > 0 ? state.price / units : NaN;

    // Inputs
    ['units', 'rent', 'occ', 'otherUnit', 'otherTotal', 'expUnit', 'expPct'].forEach(function (k) { show(k, state[k]); });
    show('cap', state.cap);
    show('price', state.price);
    if (document.activeElement !== ppdBox) ppdBox.value = FIELD_FMT.ppd(ppd);
    renderModes();
    $('hold-note').textContent = state.anchor === 'cap' ? 'holding cap rate' : 'holding price';

    // Big outputs
    var noiOk = r.noi > 0;
    $('out-noi').textContent = moneyShort(r.noi);
    $('out-noi').classList.toggle('bad', !noiOk);
    $('out-noi-sub').textContent = money(r.noi);

    $('out-value-label').textContent = 'Value @ ' + pct(state.cap) + ' cap';
    $('out-value').textContent = state.price > 0 ? moneyShort(state.price) : '—';
    $('out-value-sub').textContent = state.price > 0 ? money(state.price) : 'NOI must be positive';

    $('out-ppd').textContent = state.price > 0 ? moneyShort(ppd) : '—';
    $('out-ppd-sub').textContent = state.price > 0 ? money(ppd) + ' per unit' : ' ';

    $('out-cap-label').textContent = state.price > 0 ? 'Cap @ ' + moneyShort(state.price) : 'Cap rate';
    $('out-cap').textContent = state.price > 0 ? pct(state.cap) : '—';
    $('out-cap').classList.toggle('bad', state.cap <= 0 && state.price > 0);
    $('out-cap-sub').textContent = state.price > 0 ? Math.round(state.cap * 100) + ' bps' : ' ';

    // Breakdown
    $('b-gpr').textContent = money(r.gpr);
    $('b-vac').textContent = r.vac > 0 ? '(' + money(r.vac) + ')' : money(0);
    $('b-other').textContent = money(r.other);
    $('b-egi').textContent = money(r.egi);
    $('b-exp').textContent = '(' + money(r.exp) + ')';
    $('b-exp-sub').textContent = (units > 0 ? money(r.exp / units) : '—') + ' · ' + (r.egi > 0 ? pct((r.exp / r.egi) * 100, 1) : '—');
    $('b-noi').textContent = money(r.noi);
    $('b-noi-unit').textContent = units > 0 ? money(r.noi / units) : '—';

    save();
  }

  // ---------- Remember inputs on this phone ----------
  function load() {
    var base = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        Object.keys(base).forEach(function (k) {
          if (typeof saved[k] === typeof base[k]) base[k] = saved[k];
        });
      }
    } catch (e) { /* storage unavailable: just use defaults */ }
    return base;
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  update();

  // Service worker: lets the app open instantly and work offline
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }
})();
