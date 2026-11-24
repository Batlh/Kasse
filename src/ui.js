'use strict';
(function () {
  var C = window.KasseCore;
  var S = null;
  var ui = { tab: 'kasse', mode: 'sale', sheet: null, dialog: null, saveError: false, toastTimer: 0, pendingUndo: null };
  var fmt = C.fmt;

  var NAV = [
    ['kasse', 'Kasse', '<path d="M4 9h16l1 11H3L4 9Z"/><path d="M7 9V4h10v5M7 13h2M11 13h2M15 13h2M7 16.5h2M11 16.5h2M15 16.5h2"/>'],
    ['artikel', 'Artikel', '<path d="M3 8l9-5 9 5v8l-9 5-9-5V8Z"/><path d="M3 8l9 5 9-5M12 13v8"/>'],
    ['geld', 'Geld', '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><circle cx="12" cy="12" r="3"/><path d="M6 9.5v5M18 9.5v5"/>'],
    ['verlauf', 'Verlauf', '<path d="M4 5h16M4 10h16M4 15h16M4 20h10"/>'],
    ['bericht', 'Bericht', '<path d="M5 3h14v18H5z"/><path d="M9 16v-3M12 16V9M15 16v-5"/>']
  ];

  var DSTYLE = {
    50000: ['#7A5AA6', '#fff'], 20000: ['#D4B13C', '#231A00'], 10000: ['#3F8F62', '#fff'],
    5000: ['#DD8330', '#231000'], 2000: ['#3573B5', '#fff'], 1000: ['#C2473F', '#fff'], 500: ['#7E8990', '#fff'],
    200: ['#D3B45A', '#231A00'], 100: ['#C9CFD3', '#1B2329'], 50: ['#D3B45A', '#231A00'], 20: ['#D3B45A', '#231A00'],
    10: ['#D3B45A', '#231A00'], 5: ['#BF7446', '#231000'], 2: ['#BF7446', '#231000'], 1: ['#BF7446', '#231000']
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(s) { return document.querySelector(s); }
  function dLabel(d) { return C.denomLabel(d); }
  function dStyle(d) { var s = DSTYLE[d]; return '--dbg:' + s[0] + ';--dfg:' + s[1]; }
  function timeStr(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ', ' +
      d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  }
  function pieceList(p) {
    var o = [];
    C.DENOMS.forEach(function (d) { if (p && p[d]) o.push(p[d] + ' × ' + dLabel(d)); });
    return o.join(', ');
  }

  /* ---------- Speicher: Android, Windows-Programm oder Browser ---------- */
  var Store = (function () {
    if (window.KasseAndroid) {
      return {
        load: function () { return Promise.resolve(window.KasseAndroid.load()); },
        save: function (j) { return Promise.resolve(window.KasseAndroid.save(j)); }
      };
    }
    if (window.KASSE_DESKTOP) {
      var queue = Promise.resolve(), head = { 'X-Kasse-Token': window.KASSE_DESKTOP.token };
      return {
        load: function () {
          return fetch('/api/state', { headers: head }).then(function (r) { return r.status === 200 ? r.text() : ''; });
        },
        save: function (j) {
          queue = queue.then(function () {
            return fetch('/api/state', { method: 'POST', headers: head, body: j }).then(function (r) { return r.ok; });
          }).catch(function () { return false; });
          return queue;
        }
      };
    }
    return {
      load: function () { try { return Promise.resolve(localStorage.getItem('kasse')); } catch (e) { return Promise.resolve(null); } },
      save: function (j) { try { localStorage.setItem('kasse', j); return Promise.resolve(true); } catch (e) { return Promise.resolve(false); } }
    };
  })();

  function save() {
    var seen = ui.saveError;
    Store.save(JSON.stringify(S)).then(function (ok) {
      ui.saveError = !ok;
      if (seen !== ui.saveError) renderTop();
    });
  }
  function commit() { save(); render(); }

  function downloadFile(name, mime, text) {
    if (window.KasseAndroid) { window.KasseAndroid.saveFile(name, mime, text); return; }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    toast('Datei gespeichert: ' + name);
  }
  function fileBase() {
    var n = (S.eventName || 'Kasse').replace(/[^\wäöüÄÖÜß-]+/g, '-').replace(/^-+|-+$/g, '');
    return 'Kasse-' + (n || 'Veranstaltung') + '-' + new Date().toISOString().slice(0, 10);
  }
  window.kasseFileSaved = function (ok) { toast(ok ? 'Datei gespeichert.' : 'Datei wurde nicht gespeichert.'); };
  window.kasseSetTheme = function (t) { document.documentElement.dataset.theme = t; };

  /* ---------- Toast und Rückfrage ---------- */
  function toast(msg, undoId, fixId) {
    var t = $('#toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>' +
      (fixId ? '<button data-act="txFix" data-id="' + fixId + '">Korrigieren</button>' : '') +
      (undoId ? '<button data-act="undo" data-id="' + undoId + '">Rückgängig</button>' : '');
    t.className = 'show';
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(function () { t.className = ''; }, undoId ? 7000 : 3500);
  }

  function ask(o) {
    return new Promise(function (res) {
      ui.dialog = { res: res };
      var btns = '<button class="btn" data-act="dlg" data-v="0">' + esc(o.cancel || 'Abbrechen') + '</button>';
      if (o.alt) btns += '<button class="btn" data-act="dlg" data-v="2">' + esc(o.alt) + '</button>';
      btns += '<button class="btn ' + (o.danger ? 'danger' : 'primary') + '" data-act="dlg" data-v="1">' + esc(o.ok || 'OK') + '</button>';
      $('#dialog').innerHTML = '<div class="dlg" role="alertdialog" aria-modal="true"><h2>' + esc(o.title) + '</h2>' +
        (o.body ? '<p>' + o.body + '</p>' : '') + '<div class="dlg-btns">' + btns + '</div></div>';
      $('#dialog').className = 'show';
      var last = $('#dialog .dlg-btns button:last-child'); if (last) last.focus();
    });
  }
  function closeDialog(v) {
    var d = ui.dialog; ui.dialog = null;
    $('#dialog').className = ''; $('#dialog').innerHTML = '';
    if (d) d.res(v);
  }

  /* ---------- Grundgerüst ---------- */
  function render() { renderNav(); renderTop(); renderMain(); renderSheet(); }

  function renderNav() {
    $('#nav').innerHTML = NAV.map(function (n) {
      return '<button data-act="tab" data-tab="' + n[0] + '"' + (ui.tab === n[0] ? ' class="on" aria-current="page"' : '') +
        '><svg viewBox="0 0 24 24" aria-hidden="true">' + n[2] + '</svg><span>' + n[1] + '</span></button>';
    }).join('');
  }
  function renderTop() {
    var d = C.derive(S);
    $('#top').innerHTML = '<div class="ev">' + esc(S.eventName || 'Kasse') + '</div>' +
      '<div class="tot"><span>In der Kasse</span> <b>' + fmt(d.cashTotal) + '</b></div>' +
      (ui.saveError ? '<div class="saveerr">Speichern fehlgeschlagen. Exportiere im Bericht eine Sicherung und starte die App neu.</div>' : '');
  }
  function renderMain() {
    var m = $('#main');
    var keep = {};
    m.querySelectorAll('[data-keep]').forEach(function (e) { keep[e.dataset.keep] = e.scrollTop; });
    var top = m.scrollTop;
    m.innerHTML = ({ kasse: vKasse, artikel: vArtikel, geld: vGeld, verlauf: vVerlauf, bericht: vBericht })[ui.tab]();
    m.scrollTop = top;
    m.querySelectorAll('[data-keep]').forEach(function (e) { if (keep[e.dataset.keep]) e.scrollTop = keep[e.dataset.keep]; });
    m.dataset.tab = ui.tab;
  }

  /* ---------- Kasse ---------- */
  function vKasse() {
    var d = C.derive(S), isRet = ui.mode === 'return';
    var list = S.articles.filter(function (a) { return a.active !== false && (!isRet || a.refund != null); });
    var tiles = list.map(function (a) {
      var x = d.arts[a.id];
      var inCart = S.cart.filter(function (c) { return c.articleId === a.id && c.kind === ui.mode; })[0];
      var sub;
      if (isRet) sub = x.outstanding + ' offen';
      else if (x.stock == null) sub = a.refund != null ? 'Rückgabe ' + fmt(a.refund) : '';
      else sub = x.stock <= 0 ? 'ausverkauft' : x.stock + ' auf Lager';
      var packs = packsOf(a), unit = isRet ? a.refund : a.price;
      return '<div class="tw"><button class="tile' + (!isRet && x.stock != null && x.stock <= 0 ? ' out' : '') + '" data-act="add" data-id="' + a.id + '">' +
        (inCart ? '<i class="badge">' + inCart.qty + '</i>' : '') +
        '<span class="t-name">' + esc(a.name) + '</span><b class="t-price">' + fmt(isRet ? a.refund : a.price) + '</b>' +
        '<small>' + esc(sub) + '</small></button>' +
        (packs.length ? '<div class="packs">' + packs.map(function (n) {
          return '<button data-act="addN" data-id="' + a.id + '" data-n="' + n + '" aria-label="' + n + ' × ' + esc(a.name) + (isRet ? ' zurücknehmen">' : ' hinzufügen">') +
            '<b>' + n + 'er</b><small>' + fmt(n * unit) + '</small></button>';
        }).join('') + '</div>' : '') + '</div>';
    }).join('');

    var empty = '';
    if (!S.articles.length) {
      empty = '<div class="empty"><h2>Lege an, was du verkaufst</h2><p>Zum Beispiel Marken, Abendkasse-Tickets oder Getränke.</p>' +
        '<button class="btn primary" data-act="artNew">Artikel anlegen</button> ' +
        '<button class="btn" data-act="examples">Beispiele übernehmen</button></div>';
    } else if (!list.length) {
      empty = '<div class="empty"><h2>' + (isRet ? 'Nichts für die Rückgabe freigegeben' : 'Alle Artikel sind ausgeblendet') + '</h2>' +
        '<p>' + (isRet ? 'Schalte bei einem Artikel die Rückgabe ein, zum Beispiel bei deinen Marken.' : 'Blende im Bereich Artikel wieder etwas ein.') + '</p>' +
        '<button class="btn primary" data-act="tab" data-tab="artikel">Zu den Artikeln</button></div>';
    }

    var lines = C.cartLines(S, S.cart), total = C.linesTotal(lines);
    var rows = S.cart.map(function (c, i) {
      var a = C.articleById(S, c.articleId); if (!a) return '';
      var unit = c.kind === 'return' ? a.refund : a.price;
      var sum = c.qty * unit * (c.kind === 'return' ? -1 : 1);
      return '<div class="cline' + (c.kind === 'return' ? ' ret' : '') + '"><div class="cn"><b>' + esc(a.name) + '</b><small>' +
        (c.kind === 'return' ? 'Rückgabe, je ' : 'je ') + fmt(unit) + '</small></div>' +
        '<div class="stepper"><button data-act="qty" data-i="' + i + '" data-d="-1" aria-label="Eins weniger">−</button>' +
        '<input data-qty="' + i + '" inputmode="numeric" value="' + c.qty + '" aria-label="Anzahl ' + esc(a.name) + '">' +
        '<button data-act="qty" data-i="' + i + '" data-d="1" aria-label="Eins mehr">+</button></div>' +
        '<b class="cs">' + fmt(sum) + '</b></div>';
    }).join('');

    var payLabel = !S.cart.length ? 'Kassieren' : total > 0 ? 'Kassieren' : total < 0 ? 'Auszahlen' : 'Abschließen';
    return '<div class="kasse" data-mode="' + ui.mode + '">' +
      '<div class="modebar" role="tablist">' +
      '<button role="tab" aria-selected="' + !isRet + '" data-act="mode" data-m="sale"' + (!isRet ? ' class="on"' : '') + '>Verkauf</button>' +
      '<button role="tab" aria-selected="' + isRet + '" data-act="mode" data-m="return"' + (isRet ? ' class="on"' : '') + '>Rückgabe' + (d.open ? ' <small>' + d.open + ' offen</small>' : '') + '</button></div>' +
      '<div class="tiles" data-keep="tiles">' + (empty || tiles) + '</div>' +
      '<aside class="cart">' +
      (S.cart.length
        ? '<div class="clines" data-keep="cart">' + rows + '</div>'
        : '<p class="chint">' + (isRet ? 'Tippe an, was der Gast zurückgibt.' : 'Tippe an, was der Gast kauft.') + '</p>') +
      (isRet && !S.cart.length && list.length ? '<div class="cextra"><button class="btn" data-act="redeemOpen">Eingelöste Marken von der Theke buchen</button></div>' : '') +
      (S.cart.length && S.cart.every(function (c) { return c.kind === 'return'; })
        ? '<div class="cextra"><button class="btn" data-act="tokenTip">Gast lässt das Geld da: als Trinkgeld behalten</button></div>' : '') +
      '<div class="cfoot"><div class="ctotal"><span>' + (total < 0 ? 'Auszahlen' : 'Summe') + '</span><b>' + fmt(Math.abs(total)) + '</b></div>' +
      (S.cart.length ? '<button class="btn" data-act="clearCart">Leeren</button>' : '') +
      '<button class="btn pay" data-act="checkout"' + (S.cart.length ? '' : ' disabled') + '>' + payLabel + '</button></div>' +
      '</aside></div>';
  }

  /* Packs sind nur Abkürzungen: 5er = 5 Stück des Artikels, zählt also normal als offene Marken. */
  function packsOf(a) {
    if (Array.isArray(a.packs)) return a.packs;
    return a.refund != null ? [5, 10] : [];
  }
  function parsePacks(s) {
    s = s.trim();
    if (!s) return [];
    var parts = s.split(/[\s,;]+/).filter(Boolean), out = [];
    for (var i = 0; i < parts.length; i++) {
      if (!/^\d+$/.test(parts[i])) return null;
      var n = parseInt(parts[i], 10);
      if (n < 2 || n > 999) return null;
      if (out.indexOf(n) < 0) out.push(n);
    }
    return out.length > 4 ? null : out.sort(function (x, y) { return x - y; });
  }
  function cartAdd(id, n) {
    n = n || 1;
    var c = S.cart.filter(function (x) { return x.articleId === id && x.kind === ui.mode; })[0];
    if (c) c.qty += n; else S.cart.push({ articleId: id, qty: n, kind: ui.mode });
    commit();
  }
  function cartSet(i, q) {
    if (!S.cart[i]) return;
    if (q > 0) S.cart[i].qty = q; else S.cart.splice(i, 1);
    commit();
  }

  /* ---------- Bezahlen ---------- */
  function openPay(p) {
    $('#toast').className = '';
    ui.sheet = { kind: 'pay', title: p.title, flow: p.flow, lines: p.lines || null, onDone: p.onDone,
      cIn: {}, cOut: {}, manual: false, side: 'in', noChange: false, flowLabel: p.flowLabel,
      tip: 0, allowTip: !!p.allowTip, fixable: !!p.fixable, undo: p.undo !== false, doneMsg: p.doneMsg };
    if (p.flow < 0) ui.sheet.side = 'out';
    autoChange();
    renderSheet();
  }
  function availFor(sh, withIn) {
    var cash = C.derive(S).cash, a = {};
    C.DENOMS.forEach(function (d) { a[d] = Math.max(0, cash[d] || 0) + (withIn ? (sh.cIn[d] || 0) : 0); });
    return a;
  }
  function autoChange() {
    var sh = ui.sheet; if (sh.manual) return;
    var need = C.sum(sh.cIn) - sh.flow - sh.tip;
    sh.noChange = false;
    if (need <= 0) { sh.cOut = {}; return; }
    var r = C.makeChange(need, availFor(sh, false)) || C.makeChange(need, availFor(sh, true));
    if (r) sh.cOut = r; else { sh.cOut = {}; sh.noChange = true; }
  }
  function moneyTile(d, sh) {
    var av = availFor(sh, true)[d] - (sh.cOut[d] || 0);
    var cnt = sh.side === 'in' ? (sh.cIn[d] || 0) : (sh.cOut[d] || 0);
    var off = sh.side === 'out' && av <= 0;
    return '<button class="money ' + (d >= 500 ? 'bill' : 'coin') + (d === 200 ? ' two' : d === 100 ? ' one' : '') + '" style="' + dStyle(d) +
      '" data-act="payTap" data-d="' + d + '"' + (off ? ' disabled' : '') + ' aria-label="' + dLabel(d) + '">' +
      '<span>' + dLabel(d) + '</span>' + (cnt ? '<i class="badge">' + cnt + '</i>' : '') + '<small>' + av + '</small></button>';
  }
  function chips(p, side) {
    var h = C.DENOMS.filter(function (d) { return p[d]; }).map(function (d) {
      return '<button class="chip" style="' + dStyle(d) + '" data-act="payUn" data-side="' + side + '" data-d="' + d + '" aria-label="' + dLabel(d) + ' entfernen">' +
        p[d] + ' × ' + dLabel(d) + '</button>';
    }).join('');
    return h || '<span class="none">nichts</span>';
  }
  function vPay(sh) {
    var received = C.sum(sh.cIn), given = C.sum(sh.cOut), need = received - sh.flow - sh.tip, open = need - given;
    var balanced = open === 0;
    var lead, status = '', cls = '';
    if (sh.flow > 0) lead = [sh.flowLabel || 'Gast zahlt', fmt(sh.flow)];
    else if (sh.flow < 0) lead = [sh.flowLabel || 'Auszahlen an Gast', fmt(-sh.flow)];
    else lead = ['Geld wechseln', 'Betrag antippen'];
    if (need < 0 && sh.flow > 0) { status = 'Es fehlen noch ' + fmt(-need); cls = 'wait'; }
    else if (sh.noChange) {
      status = sh.flow < 0
        ? fmt(need) + ' geht mit dem Bargeld nicht genau. Gib mehr heraus und trage das Wechselgeld unter „Ich bekomme“ ein.'
        : 'Wechselgeld reicht nicht für ' + fmt(need) + '. Nimm andere Scheine an oder wähle von Hand.';
      cls = 'bad';
    }
    else if (open > 0) { status = 'Noch ' + fmt(open) + ' herausgeben'; cls = 'wait'; }
    else if (open < 0) { status = fmt(-open) + ' zu viel herausgegeben'; cls = 'bad'; }
    else if (sh.tip) { status = 'Stimmt, ' + fmt(sh.tip) + ' Trinkgeld'; cls = 'good'; }
    else if (given > 0) { status = 'Stimmt'; cls = 'good'; }
    else if (received > 0) { status = 'Passend bezahlt'; cls = 'good'; }

    var lines = sh.lines ? '<div class="paylines">' + sh.lines.map(function (l) {
      return '<div><span>' + (l.qty < 0 ? 'Rückgabe: ' + (-l.qty) : l.qty) + ' × ' + esc(l.name) + '</span><span>' + fmt(l.qty * l.unit) + '</span></div>';
    }).join('') + '</div>' : '';

    var canBook = balanced && (sh.flow !== 0 || received > 0 || !!sh.lines);
    var okText = given > 0 && sh.flow >= 0 ? fmt(given) + ' zurückgeben und buchen' : given > 0 ? fmt(given) + ' auszahlen und buchen' : 'Buchen';
    if (sh.tip) okText = given > 0 ? fmt(given) + ' zurück, ' + fmt(sh.tip) + ' Trinkgeld' : 'Mit ' + fmt(sh.tip) + ' Trinkgeld buchen';
    var tipChip = sh.tip ? '<button class="chip tipchip" data-act="payTipOff" aria-label="Trinkgeld entfernen">Trinkgeld ' + fmt(sh.tip) + ' ×</button>' : '';

    return '<div class="sheet pay" data-mode="' + (sh.flow < 0 ? 'return' : 'sale') + '">' +
      '<div class="sh-head"><h2>' + esc(sh.title) + '</h2><button class="x" data-act="close" aria-label="Schließen">×</button></div>' +
      '<div class="sh-body paybody"><div class="payL">' +
      '<div class="lead"><span>' + lead[0] + '</span><b>' + lead[1] + '</b></div>' + lines +
      '<div class="flowbox"><div class="fb"><span>Bekommen <b>' + fmt(received) + '</b></span><div class="chips">' + chips(sh.cIn, 'in') + '</div></div>' +
      '<div class="fb"><span>' + (sh.flow >= 0 ? 'Rückgeld' : 'Herausgeben') + ' <b>' + fmt(given) + '</b></span><div class="chips">' + (C.sum(sh.cOut) || !tipChip ? chips(sh.cOut, 'out') : '') + tipChip + '</div></div></div>' +
      (status ? '<div class="status ' + cls + '">' + esc(status) + '</div>' : '') +
      '</div><div class="payR">' +
      '<div class="seg" role="tablist">' +
      '<button data-act="paySide" data-s="in"' + (sh.side === 'in' ? ' class="on"' : '') + '>Ich bekomme</button>' +
      '<button data-act="paySide" data-s="out"' + (sh.side === 'out' ? ' class="on"' : '') + '>Ich gebe heraus</button></div>' +
      '<div class="drawer">' +
      '<div class="bills">' + C.BILLS.map(function (d) { return moneyTile(d, sh); }).join('') + '</div>' +
      '<div class="coins">' + C.COINS.map(function (d) { return moneyTile(d, sh); }).join('') + '</div></div>' +
      '<p class="fine">Die kleine Zahl zeigt, wie viele davon in der Kasse liegen.</p>' +
      '<div class="payextra">' +
      (sh.flow > 0 && received === 0 ? '<button class="btn" data-act="payExact">Passend erhalten</button>' : '') +
      (sh.allowTip && !sh.tip && received - sh.flow - (sh.manual ? given : 0) > 0 ? '<button class="btn" data-act="payTip">Rest als Trinkgeld</button>' : '') +
      (sh.manual ? '<button class="btn" data-act="payAuto">Rückgeld neu vorschlagen</button>' : '') +
      (!balanced && (received > 0 || given > 0) ? '<button class="btn" data-act="payDiff">Mit Differenz buchen</button>' : '') +
      '</div></div></div>' +
      '<div class="sh-foot"><button class="btn pay wide" data-act="payOk"' + (canBook ? '' : ' disabled') + '>' + okText + '</button></div></div>';
  }
  function finishPay(diff) {
    var sh = ui.sheet;
    var tx = sh.onDone(C.clean(sh.cIn), C.clean(sh.cOut), sh.tip);
    ui.sheet = null;
    commit();
    var msg = sh.doneMsg || (sh.tip ? 'Gebucht, ' + fmt(sh.tip) + ' Trinkgeld.' : 'Gebucht.');
    toast(diff ? msg.replace(/\.$/, '') + ', Differenz ' + fmt(diff) + '.' : msg, sh.undo ? tx.id : null, sh.fixable ? tx.id : null);
  }

  /* ---------- Artikel ---------- */
  function vArtikel() {
    var d = C.derive(S);
    var rows = S.articles.map(function (a, i) {
      var x = d.arts[a.id];
      return '<div class="row art' + (a.active === false ? ' hidden' : '') + '">' +
        '<button class="rowmain" data-act="artEdit" data-id="' + a.id + '">' +
        '<b>' + esc(a.name) + '</b>' +
        '<span>' + fmt(a.price) + (a.refund != null ? ', Rückgabe ' + fmt(a.refund) : '') + (a.active === false ? ', ausgeblendet' : '') + '</span></button>' +
        '<div class="stock"><b' + (x.stock != null && x.stock < 0 ? ' class="neg"' : '') + '>' + (x.stock == null ? 'kein Limit' : x.stock) + '</b>' +
        '<span>' + x.sold + ' verkauft' + (a.refund != null ? ', ' + x.returned + ' zurück' : '') + '</span></div>' +
        '<div class="ord"><button data-act="artMove" data-i="' + i + '" data-d="-1" aria-label="Nach oben"' + (i ? '' : ' disabled') + '>▲</button>' +
        '<button data-act="artMove" data-i="' + i + '" data-d="1" aria-label="Nach unten"' + (i < S.articles.length - 1 ? '' : ' disabled') + '>▼</button></div></div>';
    }).join('');
    return '<div class="page"><div class="pagehead"><h1>Artikel und Inventar</h1><button class="btn primary" data-act="artNew">Artikel anlegen</button></div>' +
      (rows ? '<div class="list">' + rows + '</div>'
        : '<div class="empty"><h2>Noch keine Artikel</h2><p>Lege Marken, Tickets, Getränke oder alles andere an, was du verkaufst.</p><button class="btn" data-act="examples">Beispiele übernehmen</button></div>') +
      '</div>';
  }
  function vArticleSheet(sh) {
    var a = sh.art || {}, x = sh.art ? C.derive(S).arts[a.id] : null, hasRefund = sh.refundOn;
    var used = sh.art && S.log.some(function (t) { return (t.lines || []).some(function (l) { return l.articleId === a.id; }) || t.articleId === a.id; });
    return '<div class="sheet form"><div class="sh-head"><h2>' + (sh.art ? 'Artikel bearbeiten' : 'Artikel anlegen') + '</h2><button class="x" data-act="close" aria-label="Schließen">×</button></div>' +
      '<div class="sh-body">' +
      '<label class="f">Name<input id="fName" maxlength="40" value="' + esc(a.name || '') + '" placeholder="z. B. Marke"></label>' +
      '<label class="f">Verkaufspreis in €<input id="fPrice" inputmode="decimal" value="' + (sh.art ? esc(fmt(a.price).replace(' €', '')) : '') + '" placeholder="2,00"></label>' +
      '<label class="f check"><input type="checkbox" id="fRefOn"' + (hasRefund ? ' checked' : '') + '> Kann gegen Geld zurückgegeben werden</label>' +
      '<label class="f" id="fRefWrap"' + (hasRefund ? '' : ' hidden') + '>Rückgabewert pro Stück in €<input id="fRefund" inputmode="decimal" value="' + (a.refund != null ? esc(fmt(a.refund).replace(' €', '')) : '') + '" placeholder="gleich wie Verkaufspreis"></label>' +
      '<label class="f">Packs zum schnellen Antippen<input id="fPacks" inputmode="text" value="' + esc(packsOf(a).join(', ')) + '" placeholder="z. B. 5, 10"><small>Ein 5er bucht 5 einzelne Stück zum normalen Preis, beim Verkauf und bei der Rückgabe. Leer lassen für keine Packs.</small></label>' +
      '<label class="f">Anfangsbestand<input id="fStock" inputmode="numeric" value="' + (a.stock != null ? a.stock : '') + '" placeholder="leer lassen, wenn es kein Limit gibt"></label>' +
      (sh.art && a.stock != null ? '<label class="f">Bestand nachbuchen<input id="fAdj" inputmode="text" placeholder="z. B. 50 oder -3"><small>Aktuell ' + x.stock + ' Stück.</small></label>' : '') +
      (sh.art ? '<label class="f check"><input type="checkbox" id="fActive"' + (a.active === false ? '' : ' checked') + '> In der Kasse anzeigen</label>' : '') +
      '<p class="ferr" id="fErr" hidden></p>' +
      (sh.art ? '<button class="btn danger-text" data-act="artDel">' + (used ? 'Artikel ausblenden' : 'Artikel löschen') + '</button>' : '') +
      '</div><div class="sh-foot"><button class="btn pay wide" data-act="artSave">' + (sh.art ? 'Änderungen speichern' : 'Artikel anlegen') + '</button></div></div>';
  }
  function artSave() {
    var sh = ui.sheet, err = $('#fErr');
    function fail(m) { err.textContent = m; err.hidden = false; }
    var name = $('#fName').value.trim();
    if (!name) return fail('Gib dem Artikel einen Namen.');
    var price = C.parseEuro($('#fPrice').value);
    if (price == null) return fail('Gib den Preis als Zahl ein, zum Beispiel 2,50.');
    var refund = null;
    if ($('#fRefOn').checked) {
      var r = $('#fRefund').value.trim();
      refund = r ? C.parseEuro(r) : price;
      if (refund == null) return fail('Gib den Rückgabewert als Zahl ein, zum Beispiel 2,00.');
    }
    var st = $('#fStock').value.trim(), stock = null;
    if (st) {
      if (!/^\d+$/.test(st)) return fail('Der Anfangsbestand muss eine ganze Zahl sein.');
      stock = parseInt(st, 10);
    }
    var packs = parsePacks($('#fPacks').value);
    if (packs == null) return fail('Packs: Gib bis zu 4 ganze Zahlen ab 2 ein, zum Beispiel 5, 10.');
    var adj = $('#fAdj'), n = 0;
    if (adj && adj.value.trim()) {
      n = parseInt(adj.value.replace('+', '').replace('−', '-'), 10);
      if (isNaN(n)) return fail('Bestand nachbuchen: Gib eine Zahl ein, zum Beispiel 50 oder -3.');
    }
    var a = sh.art;
    if (!a) { a = { id: S.nextId++, active: true }; S.articles.push(a); }
    a.name = name; a.price = price; a.refund = refund; a.stock = stock; a.packs = packs;
    if ($('#fActive')) a.active = $('#fActive').checked;
    if (n) C.addTx(S, { type: 'adjust', articleId: a.id, qty: n, note: a.name + ': ' + (n > 0 ? '+' : '') + n, flow: 0 });
    ui.sheet = null; commit(); toast('Artikel gespeichert.');
  }

  /* ---------- Kategorien ---------- */
  function allCats() {
    var out = C.COST_CATS.slice();
    function add(c) { if (c && out.indexOf(c) < 0) out.push(c); }
    (S.costs || []).forEach(function (c) { add(c.cat); });
    S.log.forEach(function (t) { if (t.type === 'expense') add(t.cat); });
    return out;
  }
  function catField(id, value) {
    return '<label class="f">Kategorie<input id="' + id + '" maxlength="30" value="' + esc(value || '') + '" placeholder="z. B. Band"></label>' +
      '<div class="catchips">' + allCats().map(function (c) {
        return '<button class="chip2' + (c === value ? ' on' : '') + '" data-act="catPick" data-for="' + id + '" data-v="' + esc(c) + '">' + esc(c) + '</button>';
      }).join('') + '</div>';
  }

  /* ---------- Geld ---------- */
  function vGeld() {
    var d = C.derive(S);
    var rows = C.DENOMS.map(function (k) {
      var st = S.startCash[k] || 0, now = d.cash[k] || 0;
      if (!st && !now) return '';
      return '<div class="trow"><span class="dpill" style="' + dStyle(k) + '">' + dLabel(k) + '</span><span class="n">' + st + '</span>' +
        '<b class="n' + (now < 0 ? ' neg' : '') + '">' + now + '</b><span class="n">' + fmt(now * k) + '</span></div>';
    }).join('');
    return '<div class="page"><div class="pagehead"><h1>Geld</h1></div>' +
      '<div class="bigsum"><div><span>In der Kasse</span><b>' + fmt(d.cashTotal) + '</b></div><div><span>Startgeld</span><b>' + fmt(d.startTotal) + '</b></div></div>' +
      '<div class="actions">' +
      '<button class="btn primary" data-act="money" data-t="expense">Ausgabe buchen</button>' +
      '<button class="btn" data-act="money" data-t="income">Einnahme buchen</button>' +
      '<button class="btn" data-act="money" data-t="deposit">Geld einlegen</button>' +
      '<button class="btn" data-act="money" data-t="withdrawal">Geld entnehmen</button>' +
      '<button class="btn" data-act="exchange">Geld wechseln</button>' +
      '<button class="btn" data-act="countOpen">Kasse zählen</button></div>' +
      '<div class="table"><div class="trow head"><span>Sorte</span><span class="n">Start</span><span class="n">Jetzt</span><span class="n">Wert</span></div>' +
      (rows || '<p class="chint">Kein Bargeld in der Kasse.</p>') + '</div>' +
      '<button class="btn" data-act="startOpen">Startgeld ändern</button></div>';
  }
  var MONEY = {
    expense: ['Ausgabe', 'Wofür?', 'z. B. Eis nachgekauft'], income: ['Einnahme', 'Wofür?', 'z. B. Spende'],
    deposit: ['Geld einlegen', 'Grund', 'z. B. Wechselgeld nachgelegt'], withdrawal: ['Geld entnehmen', 'Grund', 'z. B. in den Tresor']
  };
  function vMoneySheet(sh) {
    var m = MONEY[sh.t];
    return '<div class="sheet form"><div class="sh-head"><h2>' + m[0] + '</h2><button class="x" data-act="close" aria-label="Schließen">×</button></div>' +
      '<div class="sh-body">' + (sh.t === 'expense' ? catField('mCat', '') : '') +
      '<label class="f">' + m[1] + '<input id="mNote" maxlength="80" placeholder="' + esc(m[2]) + '"></label>' +
      '<label class="f">Betrag in €<input id="mAmt" inputmode="decimal" placeholder="0,00"></label><p class="ferr" id="fErr" hidden></p></div>' +
      '<div class="sh-foot"><button class="btn pay wide" data-act="moneyNext">Weiter zu Scheinen und Münzen</button></div></div>';
  }
  function moneyNext() {
    var t = ui.sheet.t, note = $('#mNote').value.trim(), amt = C.parseEuro($('#mAmt').value), err = $('#fErr');
    var cat = $('#mCat') ? $('#mCat').value.trim() || 'Sonstiges' : null;
    if (!amt) { err.textContent = 'Gib den Betrag als Zahl ein, zum Beispiel 12,50.'; err.hidden = false; return; }
    var flow = (t === 'expense' || t === 'withdrawal') ? -amt : amt;
    openPay({
      title: MONEY[t][0], flow: flow, flowLabel: MONEY[t][0],
      onDone: function (i, o) {
        var tx = { type: t, note: note || (cat || MONEY[t][0]), flow: flow, cashIn: i, cashOut: o };
        if (cat) tx.cat = cat;
        return C.addTx(S, tx);
      }
    });
  }

  function countRows(vals, compare) {
    return C.DENOMS.map(function (k) {
      return '<div class="crow"><span class="dpill" style="' + dStyle(k) + '">' + dLabel(k) + '</span>' +
        '<div class="stepper"><button data-act="cStep" data-k="' + k + '" data-d="-1" aria-label="Eins weniger">−</button>' +
        '<input data-count="' + k + '" inputmode="numeric" value="' + (vals[k] || '') + '" placeholder="0" aria-label="Anzahl ' + dLabel(k) + '">' +
        '<button data-act="cStep" data-k="' + k + '" data-d="1" aria-label="Eins mehr">+</button></div>' +
        '<b class="n" data-sub="' + k + '">' + fmt((vals[k] || 0) * k) + '</b>' +
        (compare ? '<small class="n" data-diff="' + k + '"></small>' : '') + '</div>';
    }).join('');
  }
  function vCountSheet(sh) {
    var isSetup = sh.kind === 'setup', isCount = sh.kind === 'count';
    var title = isSetup ? 'Neue Kasse' : isCount ? 'Kasse zählen' : 'Startgeld ändern';
    var intro = isSetup ? 'Zähle das Wechselgeld, mit dem du startest.' : isCount
      ? 'Trage ein, was wirklich in der Kasse liegt. Abweichungen werden als Differenz gebucht.'
      : 'Das ändert den Anfangswert. Alle Buchungen bleiben erhalten.';
    return '<div class="sheet form' + (isSetup ? ' setup' : '') + '"><div class="sh-head"><h2>' + title + '</h2>' +
      (isSetup ? '' : '<button class="x" data-act="close" aria-label="Schließen">×</button>') + '</div>' +
      '<div class="sh-body">' +
      (isSetup ? '<label class="f">Name der Veranstaltung<input id="sName" maxlength="50" placeholder="z. B. Sommerfest"></label>' : '') +
      '<p class="intro">' + intro + '</p>' +
      '<div class="crows">' + countRows(sh.vals, isCount) + '</div></div>' +
      '<div class="sh-foot"><div class="ctotal"><span>' + (isCount ? 'Gezählt' : 'Startgeld') + '</span><b id="cSum">' + fmt(C.sum(sh.vals)) + '</b></div>' +
      (isCount ? '<div class="ctotal small"><span>Laut App</span><b>' + fmt(C.derive(S).cashTotal) + '</b></div>' : '') +
      (isSetup ? '<button class="btn" data-act="importFile">Sicherung laden</button>' : '') +
      '<button class="btn pay" data-act="cSave">' + (isSetup ? 'Kasse öffnen' : isCount ? 'Zählung buchen' : 'Startgeld speichern') + '</button></div></div>';
  }
  function countUpdate(k) {
    var sh = ui.sheet, sub = document.querySelector('[data-sub="' + k + '"]');
    if (sub) sub.textContent = fmt((sh.vals[k] || 0) * k);
    $('#cSum').textContent = fmt(C.sum(sh.vals));
  }
  function cSave() {
    var sh = ui.sheet;
    if (sh.kind === 'setup') {
      S.eventName = $('#sName').value.trim() || 'Kasse';
      S.startCash = C.clean(sh.vals); S.setupDone = true; ui.sheet = null; commit();
      return;
    }
    if (sh.kind === 'start') {
      S.startCash = C.clean(sh.vals); ui.sheet = null; commit(); toast('Startgeld gespeichert.');
      return;
    }
    var diff = C.sum(sh.vals) - C.derive(S).cashTotal;
    ask({ title: 'Zählung buchen?', ok: 'Zählung buchen',
      body: diff === 0 ? 'Der Betrag stimmt. Die gezählten Stückzahlen werden übernommen.' : 'Abweichung zur App: <b>' + fmt(diff) + '</b>. Sie erscheint im Bericht als Differenz.' })
      .then(function (v) {
        if (v !== 1) return;
        C.bookCount(S, sh.vals); ui.sheet = null; commit(); toast('Zählung gebucht.');
      });
  }

  /* ---------- Verlauf ---------- */
  function txAmount(t) {
    if (t.type === 'count') return (t.diff > 0 ? '+' : '') + fmt(t.diff);
    if (t.type === 'adjust' || t.type === 'exchange' || t.type === 'redeem') return '';
    if (t.type === 'tokentip') return 'Trinkgeld ' + fmt(C.linesTotal(t.lines));
    return (t.flow > 0 ? '+' : '') + fmt(t.flow);
  }
  function txDesc(t) {
    if (t.lines) return C.linesText(t.lines) + (t.tip ? ', ' + fmt(t.tip) + ' Trinkgeld' : '');
    if (t.type === 'expense') return (t.cat ? t.cat + ': ' : '') + (t.note || '');
    if (t.note) return t.note;
    if (t.type === 'exchange' || t.type === 'count') return pieceList(t.cashIn) || pieceList(t.cashOut) || 'Keine Abweichung';
    return '';
  }
  function vVerlauf() {
    var rows = S.log.slice().reverse().map(function (t) {
      return '<button class="row tx' + (t.voided ? ' void' : '') + '" data-act="txOpen" data-id="' + t.id + '"><div><b>' + esc(C.txTitle(t)) + '</b><span>' + esc(txDesc(t)) + '</span>' +
        '<small>' + timeStr(t.ts) + (t.voided ? ', storniert' : '') + (t.history ? ', korrigiert' : '') + '</small></div><b class="amt' + (t.flow < 0 ? ' minus' : '') + '">' + esc(txAmount(t)) + '</b></button>';
    }).join('');
    return '<div class="page"><div class="pagehead"><h1>Verlauf</h1></div>' +
      (rows ? '<div class="list">' + rows + '</div>' : '<div class="empty"><h2>Noch keine Buchungen</h2><p>Jeder Verkauf, jede Rückgabe und jede Ausgabe erscheint hier.</p></div>') + '</div>';
  }
  var MONEY_TYPES = ['expense', 'income', 'deposit', 'withdrawal'];
  function fixable(t) { return t && !t.voided && (t.type === 'sale' || MONEY_TYPES.indexOf(t.type) >= 0); }
  function txById(id) { return S.log.filter(function (x) { return x.id === id; })[0]; }

  function vTxSheet(sh) {
    var t = sh.tx;
    var lines = (t.lines || []).map(function (l) {
      var q = t.type === 'tokentip' ? l.qty : l.qty;
      return '<div><span>' + (t.type !== 'tokentip' && l.qty < 0 ? 'Rückgabe: ' + (-l.qty) : q) + ' × ' + esc(l.name) + ' zu ' + fmt(l.unit) + '</span><span>' + fmt(q * l.unit) + '</span></div>';
    }).join('');
    var hist = (t.history || []).map(function (h) {
      return '<li>' + timeStr(h.ts) + ': vorher ' + esc(h.lines ? C.linesText(h.lines) : (h.cat ? h.cat + ', ' : '') + (h.note || '')) + ', ' + fmt(h.flow) + '</li>';
    }).join('');
    var money = t.type !== 'adjust' && t.type !== 'redeem' && t.type !== 'tokentip';
    return '<div class="sheet form"><div class="sh-head"><h2>' + esc(C.txTitle(t)) + '</h2><button class="x" data-act="close" aria-label="Schließen">×</button></div>' +
      '<div class="sh-body"><p class="intro">' + timeStr(t.ts) + (t.voided ? ', storniert' : '') + '</p>' +
      (t.cat ? '<p><b>' + esc(t.cat) + '</b></p>' : '') +
      (t.note ? '<p>' + esc(t.note) + '</p>' : '') +
      (lines ? '<div class="paylines">' + lines + '</div>' : '') +
      (t.type === 'tokentip' ? '<p class="intro">Der Gast hat die Marken zurückgegeben und das Geld als Trinkgeld dagelassen.</p>' : '') +
      (money ? '<dl class="kv"><dt>Betrag</dt><dd>' + fmt(t.flow) + '</dd>' + (t.tip ? '<dt>Trinkgeld</dt><dd>' + fmt(t.tip) + '</dd>' : '') +
        '<dt>Bekommen</dt><dd>' + (esc(pieceList(t.cashIn)) || 'nichts') + '</dd>' +
        '<dt>Herausgegeben</dt><dd>' + (esc(pieceList(t.cashOut)) || 'nichts') + '</dd>' +
        (t.diff ? '<dt>Differenz</dt><dd>' + fmt(t.diff) + '</dd>' : '') + '</dl>' : '') +
      (hist ? '<div class="hist"><h3>Korrekturen</h3><ul>' + hist + '</ul></div>' : '') +
      '</div><div class="sh-foot">' +
      (t.voided ? '' : '<button class="btn danger-text" data-act="txVoid" data-id="' + t.id + '">Stornieren</button>') +
      (fixable(t) ? '<button class="btn pay wide2" data-act="txFix" data-id="' + t.id + '">Korrigieren</button>' : '') +
      '</div></div>';
  }

  /* ---------- Korrigieren ---------- */
  function openFix(t) {
    $('#toast').className = '';
    if (t.type === 'sale') {
      ui.sheet = { kind: 'fix', tx: t, items: t.lines.map(function (l) {
        return { articleId: l.articleId, name: l.name, unit: l.unit, count: Math.abs(l.qty), ret: l.qty < 0 };
      }) };
    } else {
      ui.sheet = { kind: 'fixm', tx: t };
    }
    renderSheet();
  }
  function fixLines(sh) {
    return sh.items.filter(function (x) { return x.count > 0; }).map(function (x) {
      return { articleId: x.articleId, name: x.name, qty: x.ret ? -x.count : x.count, unit: x.unit };
    });
  }
  function diffText(diff, kind) {
    if (!diff) return 'Kein Geld zu bewegen.';
    if (kind === 'sale') return diff < 0 ? 'Gast bekommt ' + fmt(-diff) + ' zurück.' : 'Gast zahlt ' + fmt(diff) + ' nach.';
    return diff > 0 ? fmt(diff) + ' kommen in die Kasse.' : fmt(-diff) + ' gehen aus der Kasse.';
  }
  function vFixSheet(sh) {
    var t = sh.tx, lines = fixLines(sh), total = C.linesTotal(lines), diff = total - t.flow;
    var rows = sh.items.map(function (x, i) {
      return '<div class="cline' + (x.ret ? ' ret' : '') + (x.count ? '' : ' gone') + '"><div class="cn"><b>' + esc(x.name) + '</b><small>' + (x.ret ? 'Rückgabe, je ' : 'je ') + fmt(x.unit) + '</small></div>' +
        '<div class="stepper"><button data-act="fStep" data-i="' + i + '" data-d="-1" aria-label="Eins weniger">−</button>' +
        '<input data-fix="' + i + '" inputmode="numeric" value="' + x.count + '" aria-label="Anzahl ' + esc(x.name) + '">' +
        '<button data-act="fStep" data-i="' + i + '" data-d="1" aria-label="Eins mehr">+</button></div>' +
        '<b class="cs">' + fmt((x.ret ? -1 : 1) * x.count * x.unit) + '</b></div>';
    }).join('');
    var have = sh.items.filter(function (x) { return !x.ret; }).map(function (x) { return x.articleId; });
    var addable = S.articles.filter(function (a) { return a.active !== false && have.indexOf(a.id) < 0; });
    return '<div class="sheet form"><div class="sh-head"><h2>Verkauf korrigieren</h2><button class="x" data-act="close" aria-label="Schließen">×</button></div>' +
      '<div class="sh-body"><p class="intro">Gebucht war: ' + esc(C.linesText(t.lines)) + ', ' + fmt(t.flow) + '. Stell die Anzahl so ein, wie es richtig gewesen wäre.</p>' +
      '<div>' + rows + '</div>' +
      (addable.length ? '<div class="catchips">' + addable.map(function (a) {
        return '<button class="chip2" data-act="fAdd" data-id="' + a.id + '">+ ' + esc(a.name) + '</button>';
      }).join('') + '</div>' : '') +
      '<div class="fixsum">' + fixSumHtml(sh) + '</div>' +
      '<p class="ferr" id="fErr" hidden></p></div>' +
      '<div class="sh-foot"><button class="btn pay wide" data-act="fixNext" id="fixBtn">' + (diff ? 'Weiter zum Geld' : 'Korrektur buchen') + '</button></div></div>';
  }
  function fixSumHtml(sh) {
    var t = sh.tx, total = C.linesTotal(fixLines(sh)), diff = total - t.flow;
    return '<div class="rrow"><span>Bisher</span><b>' + fmt(t.flow) + '</b></div><div class="rrow"><span>Richtig</span><b>' + fmt(total) + '</b></div>' +
      '<div class="status ' + (diff ? 'wait' : 'good') + '">' + diffText(diff, 'sale') + '</div>';
  }
  /* Aktualisiert nur Zahlen, damit ein Tipp auf den Knopf nicht verloren geht. */
  function fixUpdate(i) {
    var sh = ui.sheet, x = sh.items[i], row = document.querySelector('[data-fix="' + i + '"]').closest('.cline');
    row.querySelector('.cs').textContent = fmt((x.ret ? -1 : 1) * x.count * x.unit);
    row.classList.toggle('gone', !x.count);
    $('.fixsum').innerHTML = fixSumHtml(sh);
    $('#fixBtn').textContent = C.linesTotal(fixLines(sh)) - sh.tx.flow ? 'Weiter zum Geld' : 'Korrektur buchen';
  }
  function fixWarnings(id, ch) {
    var T = JSON.parse(JSON.stringify(S)), before = C.derive(S);
    C.correctTx(T, id, ch, {}, {});
    var after = C.derive(T), w = [];
    S.articles.forEach(function (a) {
      var b = before.arts[a.id], n = after.arts[a.id];
      if (!b || !n) return;
      if (n.circ < 0 && n.circ < b.circ) w.push(a.name + ': dann wären mehr zurückgegeben oder eingelöst als verkauft.');
      if (n.stock != null && n.stock < 0 && n.stock < b.stock) w.push(a.name + ': dann wäre der Bestand ' + n.stock + '.');
    });
    return w;
  }
  function applyFix(t, ch, diff, kind, label) {
    if (!diff) {
      C.correctTx(S, t.id, ch, {}, {}); ui.sheet = null; commit(); toast('Korrigiert.');
      return;
    }
    openPay({ title: 'Korrektur', flow: diff, flowLabel: label, undo: false, doneMsg: 'Korrigiert.',
      onDone: function (i, o) { return C.correctTx(S, t.id, ch, i, o); } });
  }
  function fixNext() {
    var sh = ui.sheet, t = sh.tx, lines = fixLines(sh);
    if (!lines.length) { var e = $('#fErr'); e.textContent = 'Es muss mindestens eine Position übrig bleiben. Soll die ganze Buchung weg, nimm Stornieren.'; e.hidden = false; return; }
    var diff = C.linesTotal(lines) - t.flow, ch = { lines: lines }, w = fixWarnings(t.id, ch);
    var go = function () { applyFix(t, ch, diff, 'sale', diff > 0 ? 'Gast zahlt nach' : 'Gast bekommt zurück'); };
    if (w.length) ask({ title: 'Bitte prüfen', body: w.map(esc).join('<br>'), ok: 'Trotzdem korrigieren', cancel: 'Ändern' }).then(function (v) { if (v === 1) go(); });
    else go();
  }
  function vFixMoneySheet(sh) {
    var t = sh.tx, out = t.flow < 0;
    return '<div class="sheet form"><div class="sh-head"><h2>' + esc(C.txTitle(t)) + ' korrigieren</h2><button class="x" data-act="close" aria-label="Schließen">×</button></div>' +
      '<div class="sh-body">' + (t.type === 'expense' ? catField('mCat', t.cat || '') : '') +
      '<label class="f">' + (MONEY[t.type] ? MONEY[t.type][1] : 'Text') + '<input id="mNote" maxlength="80" value="' + esc(t.note || '') + '"></label>' +
      '<label class="f">Betrag in €<input id="mAmt" inputmode="decimal" value="' + esc(fmt(out ? -t.flow : t.flow).replace(' €', '')) + '"><small>Gebucht waren ' + fmt(out ? -t.flow : t.flow) + '.</small></label>' +
      '<p class="ferr" id="fErr" hidden></p></div>' +
      '<div class="sh-foot"><button class="btn pay wide" data-act="fixmNext">Korrektur buchen</button></div></div>';
  }
  function fixmNext() {
    var t = ui.sheet.t || ui.sheet.tx, amt = C.parseEuro($('#mAmt').value), err = $('#fErr');
    if (!amt) { err.textContent = 'Gib den Betrag als Zahl ein, zum Beispiel 12,50.'; err.hidden = false; return; }
    var flow = t.flow < 0 ? -amt : amt, ch = { flow: flow, note: $('#mNote').value.trim() || t.note };
    if ($('#mCat')) ch.cat = $('#mCat').value.trim() || 'Sonstiges';
    var diff = flow - t.flow;
    applyFix(t, ch, diff, 'money', diff > 0 ? 'Kommt in die Kasse' : 'Geht aus der Kasse');
  }

  /* ---------- Kosten der Veranstaltung ---------- */
  function vCostSheet(sh) {
    var c = sh.cost || {};
    return '<div class="sheet form"><div class="sh-head"><h2>' + (sh.cost ? 'Kosten bearbeiten' : 'Kosten hinzufügen') + '</h2><button class="x" data-act="close" aria-label="Schließen">×</button></div>' +
      '<div class="sh-body"><p class="intro">Für Kosten, die nicht aus der Kasse bezahlt werden, zum Beispiel überwiesen. Sie ändern das Bargeld nicht und zählen nur für das Ergebnis.</p>' +
      catField('kCat', c.cat || '') +
      '<label class="f">Beschreibung<input id="kNote" maxlength="80" value="' + esc(c.note || '') + '" placeholder="optional, z. B. Saalmiete"></label>' +
      '<label class="f">Betrag in €<input id="kAmt" inputmode="decimal" value="' + (sh.cost ? esc(fmt(c.amount).replace(' €', '')) : '') + '" placeholder="0,00"></label>' +
      '<p class="ferr" id="fErr" hidden></p>' +
      (sh.cost ? '<button class="btn danger-text" data-act="costDel">Kosten löschen</button>' : '') +
      '</div><div class="sh-foot"><button class="btn pay wide" data-act="costSave">' + (sh.cost ? 'Änderungen speichern' : 'Kosten hinzufügen') + '</button></div></div>';
  }
  function costSave() {
    var sh = ui.sheet, err = $('#fErr'), amt = C.parseEuro($('#kAmt').value);
    var cat = $('#kCat').value.trim();
    if (!cat) { err.textContent = 'Wähle oder schreib eine Kategorie, zum Beispiel Band.'; err.hidden = false; return; }
    if (!amt) { err.textContent = 'Gib den Betrag als Zahl ein, zum Beispiel 250,00.'; err.hidden = false; return; }
    var c = sh.cost;
    if (!c) { c = { id: S.nextId++, ts: Date.now() }; S.costs.push(c); }
    c.cat = cat; c.note = $('#kNote').value.trim(); c.amount = amt;
    ui.sheet = null; commit(); toast('Kosten gespeichert.');
  }

  /* ---------- Bericht ---------- */
  function vBericht() {
    var d = C.derive(S);
    function l(k, v, cls, sub) {
      return '<div class="rrow ' + (cls || '') + '"><span>' + k + (sub ? '<small>' + sub + '</small>' : '') + '</span><b>' + v + '</b></div>';
    }
    function minus(v) { return v ? fmt(-v) : fmt(0); }

    var cats = Object.keys(d.byCat).sort(function (a, b) { return d.byCat[b].total - d.byCat[a].total; });
    var costRows = cats.map(function (k) {
      var c = d.byCat[k];
      var sub = c.cash === c.total ? 'bar aus der Kasse' : c.cash ? 'davon ' + fmt(c.cash) + ' bar aus der Kasse' : '';
      return l(esc(k), minus(c.total), 'in', sub);
    }).join('');
    var plus = d.result >= 0;
    var result = '<div class="result ' + (plus ? 'plus' : 'minus') + '"><span>' + (plus ? 'Plus' : 'Minus') + '</span><b>' + (plus ? '+' : '') + fmt(d.result) + '</b>' +
      '<small>' + (plus ? 'Die Veranstaltung ist im Plus.' : 'Die Veranstaltung ist im Minus.') + '</small></div>';

    var bilanz = '<section><h2>Ergebnis der Veranstaltung</h2>' +
      l('Verkäufe', fmt(d.sales), 'in') + l('Rückgaben', minus(d.refunds), 'in') +
      (d.tokenTips ? l('Marken als Trinkgeld', minus(d.tokenTips), 'in', 'gehört den Helfern') : '') +
      (d.income ? l('Sonstige Einnahmen', fmt(d.income), 'in') : '') +
      l('Einnahmen', fmt(d.revenue), 'sub') +
      (costRows || '<p class="chint">Noch keine Kosten eingetragen.</p>') +
      l('Kosten', minus(d.costTotal), 'sub') +
      (d.diffs ? l('Kassendifferenzen', fmt(d.diffs), 'in') : '') +
      result +
      (d.open ? '<p class="note"><b>' + d.open + ' Marken sind noch im Umlauf</b> (' + fmt(d.openValue) + '). Werden sie nicht mehr zurückgegeben, ' +
        'bleiben sie Einnahme. Kommen alle zurück, wäre das Ergebnis ' + fmt(d.resultIfAllReturned) + '.</p>' : '') +
      (d.tips ? '<p class="note tip"><b>Trinkgeld für die Helfer: ' + fmt(d.tips) + '</b>' +
        (d.tipsCash && d.tokenTips ? ', davon ' + fmt(d.tipsCash) + ' beim Bezahlen und ' + fmt(d.tokenTips) + ' aus Marken' : '') +
        '. Es liegt in der Kasse und ist nicht im Ergebnis enthalten. Zum Auszahlen: Geld, dann Geld entnehmen.</p>' : '') +
      '</section>';

    var lc = d.lastCount;
    var kasse = '<section><h2>Kasse</h2>' +
      l('Startgeld', fmt(d.startTotal), 'in') + l('Verkäufe', fmt(d.sales), 'in') + l('Rückgaben', minus(d.refunds), 'in') +
      (d.income ? l('Sonstige Einnahmen', fmt(d.income), 'in') : '') +
      (d.expenses ? l('Ausgaben bar', minus(d.expenses), 'in') : '') +
      (d.deposits ? l('Geld eingelegt', fmt(d.deposits), 'in') : '') +
      (d.withdrawals ? l('Geld entnommen', minus(d.withdrawals), 'in') : '') +
      (d.tipsCash ? l('Trinkgeld beim Bezahlen', fmt(d.tipsCash), 'in') : '') +
      (d.diffs ? l('Differenzen', fmt(d.diffs), 'in') : '') +
      l('Muss in der Kasse sein', fmt(d.cashTotal), 'sum') +
      (lc ? '<p class="intro">Zuletzt gezählt: ' + timeStr(lc.ts) + (lc.diff ? ', Abweichung ' + fmt(lc.diff) : ', stimmte') + '.</p>' : '') +
      '<button class="btn primary" data-act="countOpen">Kasse zählen</button></section>';

    var costList = (S.costs || []).map(function (c) {
      return { k: 'c', id: c.id, cat: c.cat, note: c.note, amount: c.amount, ts: c.ts };
    }).concat(S.log.filter(function (t) { return t.type === 'expense' && !t.voided; }).map(function (t) {
      return { k: 't', id: t.id, cat: t.cat || 'Sonstiges', note: t.note, amount: -t.flow, ts: t.ts };
    })).map(function (c) {
      return '<button class="row tx" data-act="' + (c.k === 'c' ? 'costEdit' : 'txOpen') + '" data-id="' + c.id + '"><div><b>' + esc(c.cat) + '</b>' +
        '<span>' + esc(c.note && c.note !== c.cat ? c.note : '') + '</span><small>' + (c.k === 'c' ? 'nicht aus der Kasse' : 'bar aus der Kasse') + '</small></div>' +
        '<b class="amt minus">' + fmt(-c.amount) + '</b></button>';
    }).join('');
    var kosten = '<section class="wide"><div class="pagehead"><h2>Kosten der Veranstaltung</h2><button class="btn" data-act="costNew">Kosten hinzufügen</button></div>' +
      '<p class="intro">Trag hier ein, was du nicht aus der Kasse bezahlst, zum Beispiel Location, Band oder Getränke-Einkauf. Bar bezahlte Ausgaben aus Geld stehen automatisch mit dabei.</p>' +
      (costList ? '<div class="list">' + costList + '</div>' : '') + '</section>';

    var refundable = S.articles.filter(function (a) { return a.refund != null; });
    var marken = refundable.length ? '<section class="wide"><div class="pagehead"><h2>Marken</h2><button class="btn" data-act="redeemOpen">Eingelöste Marken buchen</button></div>' +
      '<div class="mgrid">' + refundable.map(function (a) {
        var x = d.arts[a.id];
        return '<div class="mcard"><h3>' + esc(a.name) + '</h3>' + l('Verkauft', x.sold, 'in') + l('Zurückgegeben', x.returned, 'in') +
          l('An der Theke eingelöst', x.redeemed, 'in') + (x.tipped ? l('Als Trinkgeld dagelassen', x.tipped, 'in') : '') +
          l('Noch im Umlauf', x.outstanding, 'sub') + '</div>';
      }).join('') + '</div></section>' : '';

    var arts = S.articles.map(function (a) {
      var x = d.arts[a.id];
      return '<div class="trow art4"><span>' + esc(a.name) + '</span><span class="n">' + x.sold + '</span><span class="n">' + (a.refund != null ? x.returned : '') + '</span>' +
        '<span class="n">' + fmt(x.revenue - x.refunded) + '</span></div>';
    }).join('');

    return '<div class="page report"><div class="pagehead"><h1>Bericht</h1></div><div class="rgrid">' + bilanz + kasse + kosten + marken +
      '<section class="wide"><h2>Artikel</h2><div class="table"><div class="trow art4 head"><span>Artikel</span><span class="n">Verkauft</span><span class="n">Zurück</span><span class="n">Summe</span></div>' +
      (arts || '<p class="chint">Noch keine Artikel.</p>') + '</div></section>' +
      '<section class="wide"><h2>Daten</h2>' +
      '<p class="intro">Mit einer Sicherung nimmst du den ganzen Stand auf das andere Gerät mit. Dort lädst du sie hier wieder.</p>' +
      '<div class="actions"><button class="btn primary" data-act="exportJson">Sicherung speichern</button>' +
      '<button class="btn" data-act="importFile">Sicherung laden</button>' +
      '<button class="btn" data-act="exportCsv">Abrechnung für Excel speichern</button>' +
      '<button class="btn danger-text" data-act="reset">Neue Veranstaltung beginnen</button></div>' +
      '<p class="intro">Kasse ' + esc(window.KASSE_VERSION || '') + ', Updates unter github.com/Batlh/kasse</p>' +
      '</section></div></div>';
  }

  /* ---------- Blatt-Verwaltung ---------- */
  function renderSheet() {
    var w = $('#sheet'), sh = ui.sheet;
    if (!sh) { w.className = ''; w.innerHTML = ''; return; }
    var body = w.querySelector('.sh-body'), top = body ? body.scrollTop : 0, kind = w.dataset.kind;
    if (w.className !== 'show') $('#toast').className = '';
    var v = { pay: vPay, article: vArticleSheet, money: vMoneySheet, setup: vCountSheet, start: vCountSheet, count: vCountSheet, tx: vTxSheet,
      redeem: vRedeemSheet, fix: vFixSheet, fixm: vFixMoneySheet, cost: vCostSheet }[sh.kind];
    w.innerHTML = v(sh);
    w.className = 'show';
    w.dataset.kind = sh.kind;
    var nb = w.querySelector('.sh-body');
    if (nb && kind === sh.kind) nb.scrollTop = top;
  }

  function examples() {
    S.articles.push({ id: S.nextId++, name: 'Marke', price: 200, refund: 200, stock: null, active: true });
    S.articles.push({ id: S.nextId++, name: 'Ticket Abendkasse', price: 1000, refund: null, stock: null, active: true });
    commit();
    toast('Beispiele angelegt. Prüfe die Preise unter Artikel.');
  }

  function checkout() {
    if (!S.cart.length) return;
    var w = C.cartWarnings(S, S.cart);
    var go = function () {
      var lines = C.cartLines(S, S.cart), total = C.linesTotal(lines);
      var title = lines.some(function (l) { return l.qty > 0; }) ? (lines.some(function (l) { return l.qty < 0; }) ? 'Verkauf und Rückgabe' : 'Verkauf') : 'Rückgabe';
      var cart = S.cart;
      openPay({ title: title, flow: total, lines: lines, allowTip: total > 0, fixable: true, onDone: function (i, o, tip) {
        var tx = C.bookSale(S, cart, i, o, tip);
        S.cart = [];
        return tx;
      } });
    };
    if (w.length) {
      ask({ title: 'Bitte prüfen', body: w.map(esc).join('<br>'), ok: 'Trotzdem weiter', cancel: 'Korb ändern' })
        .then(function (v) { if (v === 1) go(); });
    } else go();
  }

  function tokenTip() {
    var lines = C.cartLines(S, S.cart), value = -C.linesTotal(lines), w = C.cartWarnings(S, S.cart);
    ask({ title: 'Als Trinkgeld behalten?', ok: 'Als Trinkgeld behalten',
      body: (w.length ? w.map(esc).join('<br>') + '<br><br>' : '') + esc(C.linesText(lines).replace(/zurück: /g, '')) +
        ' gehen aus dem Umlauf. Du zahlst nichts aus, <b>' + fmt(value) + '</b> zählen als Trinkgeld für die Helfer.' })
      .then(function (v) {
        if (v !== 1) return;
        var tx = C.bookTokenTip(S, S.cart); S.cart = []; commit(); toast('Als Trinkgeld gebucht.', tx.id);
      });
  }

  function redeemArts() {
    var d = C.derive(S);
    return S.articles.filter(function (a) { return a.refund != null && (a.active !== false || d.arts[a.id].outstanding > 0); });
  }
  function vRedeemSheet(sh) {
    var d = C.derive(S);
    var rows = redeemArts().map(function (a) {
      var v = sh.vals[a.id] || 0;
      return '<div class="cline"><div class="cn"><b>' + esc(a.name) + '</b><small>' + d.arts[a.id].outstanding + ' im Umlauf</small></div>' +
        '<div class="stepper"><button data-act="rStep" data-id="' + a.id + '" data-d="-1" aria-label="Eins weniger">−</button>' +
        '<input data-redeem="' + a.id + '" inputmode="numeric" value="' + (v || '') + '" placeholder="0" aria-label="Eingelöst ' + esc(a.name) + '">' +
        '<button data-act="rStep" data-id="' + a.id + '" data-d="1" aria-label="Eins mehr">+</button></div><span></span></div>';
    }).join('');
    return '<div class="sheet form"><div class="sh-head"><h2>Eingelöste Marken</h2><button class="x" data-act="close" aria-label="Schließen">×</button></div>' +
      '<div class="sh-body"><p class="intro">Zähle die Marken, die an der Theke gegen Getränke abgegeben wurden. Geld bewegt sich dabei nicht, die Marken sind danach nur nicht mehr im Umlauf. Das geht beliebig oft, zum Beispiel jedes Mal, wenn die Box geleert wird.</p>' +
      rows + '<p class="ferr" id="fErr" hidden></p></div>' +
      '<div class="sh-foot"><button class="btn pay wide" data-act="rSave">Eingelöst buchen</button></div></div>';
  }
  function rSave() {
    var sh = ui.sheet, d = C.derive(S), w = [], any = false;
    redeemArts().forEach(function (a) {
      var v = sh.vals[a.id] || 0; if (!v) return; any = true;
      if (v > d.arts[a.id].outstanding) w.push(a.name + ': nur ' + d.arts[a.id].outstanding + ' im Umlauf, ' + v + ' eingetragen.');
    });
    if (!any) { var e = $('#fErr'); e.textContent = 'Trage ein, wie viele Marken eingelöst wurden.'; e.hidden = false; return; }
    var go = function () {
      var n = 0;
      redeemArts().forEach(function (a) { var v = sh.vals[a.id] || 0; if (v) { C.bookRedeem(S, a.id, v); n += v; } });
      ui.sheet = null; commit(); toast(n + ' Marken als eingelöst gebucht.');
    };
    if (w.length) ask({ title: 'Bitte prüfen', body: w.map(esc).join('<br>'), ok: 'Trotzdem buchen', cancel: 'Ändern' }).then(function (v) { if (v === 1) go(); });
    else go();
  }

  /* ---------- Ereignisse ---------- */
  var ACT = {
    tab: function (e) { ui.tab = e.dataset.tab; $('#main').scrollTop = 0; $('#toast').className = ''; render(); },
    mode: function (e) { ui.mode = e.dataset.m; renderMain(); },
    add: function (e) { cartAdd(Number(e.dataset.id)); },
    addN: function (e) { cartAdd(Number(e.dataset.id), Number(e.dataset.n)); },
    qty: function (e) { var i = Number(e.dataset.i); cartSet(i, S.cart[i].qty + Number(e.dataset.d)); },
    clearCart: function () { S.cart = []; commit(); },
    checkout: checkout,
    examples: examples,
    tokenTip: tokenTip,
    redeemOpen: function () { ui.sheet = { kind: 'redeem', vals: {} }; renderSheet(); },
    rStep: function (e) {
      var sh = ui.sheet, id = e.dataset.id, v = Math.max(0, (sh.vals[id] || 0) + Number(e.dataset.d));
      sh.vals[id] = v; document.querySelector('[data-redeem="' + id + '"]').value = v || '';
    },
    rSave: rSave,
    txFix: function (e) { var t = txById(Number(e.dataset.id)); if (fixable(t)) openFix(t); },
    fStep: function (e) { var x = ui.sheet.items[Number(e.dataset.i)]; x.count = Math.max(0, x.count + Number(e.dataset.d)); renderSheet(); },
    fAdd: function (e) {
      var a = C.articleById(S, Number(e.dataset.id));
      ui.sheet.items.push({ articleId: a.id, name: a.name, unit: a.price, count: 1, ret: false }); renderSheet();
    },
    fixNext: fixNext,
    fixmNext: fixmNext,
    catPick: function (e) {
      var f = document.getElementById(e.dataset.for); f.value = e.dataset.v;
      e.parentNode.querySelectorAll('.chip2').forEach(function (b) { b.classList.toggle('on', b === e); });
    },
    costNew: function () { ui.sheet = { kind: 'cost', cost: null }; renderSheet(); },
    costEdit: function (e) {
      var id = Number(e.dataset.id); ui.sheet = { kind: 'cost', cost: S.costs.filter(function (c) { return c.id === id; })[0] }; renderSheet();
    },
    costSave: costSave,
    costDel: function () {
      var c = ui.sheet.cost;
      ask({ title: 'Kosten löschen?', body: esc(c.cat) + ', ' + fmt(c.amount), ok: 'Löschen', danger: true }).then(function (v) {
        if (v !== 1) return;
        S.costs = S.costs.filter(function (x) { return x !== c; }); ui.sheet = null; commit(); toast('Kosten gelöscht.');
      });
    },
    close: function () { ui.sheet = null; renderSheet(); },
    undo: function (e) {
      var id = Number(e.dataset.id);
      C.voidTx(S, id); $('#toast').className = ''; commit(); toast('Buchung storniert.');
    },
    dlg: function (e) { closeDialog(Number(e.dataset.v)); },
    paySide: function (e) { ui.sheet.side = e.dataset.s; renderSheet(); },
    payTap: function (e) {
      var sh = ui.sheet, d = e.dataset.d;
      if (sh.side === 'in') { sh.cIn[d] = (sh.cIn[d] || 0) + 1; autoChange(); }
      else { sh.cOut[d] = (sh.cOut[d] || 0) + 1; sh.manual = true; sh.noChange = false; }
      renderSheet();
    },
    payUn: function (e) {
      var sh = ui.sheet, d = e.dataset.d, p = e.dataset.side === 'in' ? sh.cIn : sh.cOut;
      if (p[d]) p[d]--; if (!p[d]) delete p[d];
      if (e.dataset.side === 'out') { sh.manual = true; sh.noChange = false; } else autoChange();
      renderSheet();
    },
    payTip: function () {
      var sh = ui.sheet, rest = C.sum(sh.cIn) - sh.flow - (sh.manual ? C.sum(sh.cOut) : 0);
      if (rest <= 0) return;
      sh.tip = rest; if (!sh.manual) sh.cOut = {};
      sh.noChange = false; renderSheet();
    },
    payTipOff: function () { var sh = ui.sheet; sh.tip = 0; autoChange(); renderSheet(); },
    payExact: function () { var sh = ui.sheet; sh.cIn = C.canonical(sh.flow); sh.cOut = {}; sh.manual = false; autoChange(); renderSheet(); },
    payAuto: function () { ui.sheet.manual = false; autoChange(); renderSheet(); },
    payOk: function () { finishPay(0); },
    payDiff: function () {
      var sh = ui.sheet, diff = C.sum(sh.cIn) - C.sum(sh.cOut) - sh.flow - sh.tip;
      ask({ title: 'Mit Differenz buchen?', ok: 'Mit Differenz buchen',
        body: 'Die Kasse weicht danach um <b>' + fmt(diff) + '</b> vom Betrag ab. Das erscheint im Bericht.' })
        .then(function (v) { if (v === 1) finishPay(diff); });
    },
    artNew: function () { ui.sheet = { kind: 'article', art: null, refundOn: false }; renderSheet(); setTimeout(function () { var f = $('#fName'); if (f) f.focus(); }, 30); },
    artEdit: function (e) { var a = C.articleById(S, Number(e.dataset.id)); ui.sheet = { kind: 'article', art: a, refundOn: a.refund != null }; renderSheet(); },
    artSave: artSave,
    artMove: function (e) {
      var i = Number(e.dataset.i), j = i + Number(e.dataset.d), a = S.articles;
      if (a[j]) { var t = a[i]; a[i] = a[j]; a[j] = t; commit(); }
    },
    artDel: function () {
      var a = ui.sheet.art;
      var used = S.log.some(function (t) { return (t.lines || []).some(function (l) { return l.articleId === a.id; }) || t.articleId === a.id; });
      S.cart = S.cart.filter(function (c) { return c.articleId !== a.id; });
      if (used) a.active = false; else S.articles = S.articles.filter(function (x) { return x !== a; });
      ui.sheet = null; commit(); toast(used ? 'Artikel ausgeblendet.' : 'Artikel gelöscht.');
    },
    money: function (e) { ui.sheet = { kind: 'money', t: e.dataset.t }; renderSheet(); setTimeout(function () { var f = $('#mNote'); if (f) f.focus(); }, 30); },
    moneyNext: moneyNext,
    exchange: function () {
      openPay({ title: 'Geld wechseln', flow: 0, onDone: function (i, o) { return C.addTx(S, { type: 'exchange', flow: 0, cashIn: i, cashOut: o }); } });
    },
    countOpen: function () {
      var c = C.derive(S).cash, v = {}; C.DENOMS.forEach(function (d) { if (c[d] > 0) v[d] = c[d]; });
      ui.sheet = { kind: 'count', vals: v }; renderSheet();
    },
    startOpen: function () { ui.sheet = { kind: 'start', vals: Object.assign({}, S.startCash) }; renderSheet(); },
    cStep: function (e) {
      var k = e.dataset.k, sh = ui.sheet, v = Math.max(0, (sh.vals[k] || 0) + Number(e.dataset.d));
      sh.vals[k] = v;
      document.querySelector('[data-count="' + k + '"]').value = v || '';
      countUpdate(k);
    },
    cSave: cSave,
    txOpen: function (e) {
      var id = Number(e.dataset.id), t = S.log.filter(function (x) { return x.id === id; })[0];
      ui.sheet = { kind: 'tx', tx: t }; renderSheet();
    },
    txVoid: function (e) {
      ask({ title: 'Buchung stornieren?', body: 'Geld und Bestand werden zurückgerechnet. Lege das Geld auch wirklich zurück.', ok: 'Buchung stornieren', cancel: 'Behalten', danger: true })
        .then(function (v) {
          if (v !== 1) return;
          C.voidTx(S, Number(e.dataset.id)); ui.sheet = null; commit(); toast('Buchung storniert.');
        });
    },
    exportJson: function () { downloadFile(fileBase() + '.json', 'application/json', JSON.stringify(S)); },
    exportCsv: function () { downloadFile(fileBase() + '.csv', 'text/csv', C.toCsv(S)); },
    importFile: function () { $('#file').value = ''; $('#file').click(); },
    reset: function () {
      ask({ title: 'Neue Veranstaltung beginnen?', body: 'Buchungen und Startgeld werden gelöscht. Speichere vorher eine Sicherung, wenn du sie noch brauchst.',
        ok: 'Alles löschen', alt: 'Artikel behalten', danger: true }).then(function (v) {
        if (!v) return;
        var keep = v === 2 ? S.articles : [], nid = S.nextId;
        S = C.emptyState(); S.articles = keep; S.nextId = nid;
        ui.tab = 'kasse'; ui.sheet = { kind: 'setup', vals: {} }; commit();
      });
    }
  };

  document.addEventListener('click', function (ev) {
    var e = ev.target.closest('[data-act]');
    if (!e || e.disabled) return;
    var f = ACT[e.dataset.act];
    if (f) f(e);
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'fRefOn') { ui.sheet.refundOn = t.checked; $('#fRefWrap').hidden = !t.checked; }
    if (t.dataset.qty != null) {
      var q = parseInt(t.value, 10);
      if (isNaN(q) || q <= 0) cartSet(Number(t.dataset.qty), 0);
      else setTimeout(renderMain, 300);
    }
    if (t.id === 'file') {
      var f = t.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var o, err = null;
        try { o = JSON.parse(String(r.result).replace(/^﻿/, '')); err = C.validate(o); } catch (e) { err = 'Die Datei lässt sich nicht lesen.'; }
        if (err) { ask({ title: 'Sicherung nicht geladen', body: esc(err), ok: 'OK' }); return; }
        ask({ title: 'Sicherung laden?', ok: 'Stand ersetzen', danger: true,
          body: 'Der aktuelle Stand auf diesem Gerät (' + S.log.length + ' Buchungen) wird durch „' + esc(o.eventName) + '“ (' + o.log.length + ' Buchungen) ersetzt.' })
          .then(function (v) {
            if (v !== 1) return;
            S = o; S.setupDone = true; ui.sheet = null; commit(); toast('Sicherung geladen.');
          });
      };
      r.readAsText(f);
    }
  });
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.dataset.qty != null) {
      var q = parseInt(t.value, 10), c = S.cart[Number(t.dataset.qty)];
      if (c && q > 0) {
        c.qty = q; save();
        var a = C.articleById(S, c.articleId);
        t.closest('.cline').querySelector('.cs').textContent = fmt(q * (c.kind === 'return' ? -a.refund : a.price));
        document.querySelector('.ctotal b').textContent = fmt(Math.abs(C.linesTotal(C.cartLines(S, S.cart))));
      }
    }
    if (t.dataset.fix != null) {
      var fv = parseInt(t.value.replace(/[^0-9]/g, ''), 10);
      ui.sheet.items[Number(t.dataset.fix)].count = isNaN(fv) ? 0 : fv;
      fixUpdate(Number(t.dataset.fix));
    }
    if (t.dataset.redeem != null) {
      var rv = parseInt(t.value.replace(/[^0-9]/g, ''), 10);
      ui.sheet.vals[t.dataset.redeem] = isNaN(rv) ? 0 : rv;
    }
    if (t.dataset.count != null) {
      var v = parseInt(t.value.replace(/\D/g, ''), 10);
      ui.sheet.vals[t.dataset.count] = isNaN(v) ? 0 : v;
      countUpdate(t.dataset.count);
    }
  });
  document.addEventListener('focusin', function (ev) { if (ev.target.matches('input[inputmode]')) ev.target.select && ev.target.select(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') window.kasseBack(); });

  window.kasseBack = function () {
    if (ui.dialog) { closeDialog(0); return true; }
    if (ui.sheet && ui.sheet.kind !== 'setup') { ui.sheet = null; renderSheet(); return true; }
    if (ui.tab !== 'kasse' && !ui.sheet) { ui.tab = 'kasse'; render(); return true; }
    return false;
  };

  /* ---------- Start ---------- */
  Store.load().then(function (j) {
    var o = null;
    try { if (j) { o = JSON.parse(j); if (C.validate(o)) o = null; } } catch (e) { o = null; }
    S = o || C.emptyState();
    if (!S.setupDone) ui.sheet = { kind: 'setup', vals: {} };
    render();
    document.documentElement.classList.add('ready');
  });
  window.addEventListener('pagehide', function () {
    if (window.KASSE_DESKTOP && navigator.sendBeacon) navigator.sendBeacon('/api/closing?t=' + window.KASSE_DESKTOP.token);
  });
  if (window.KASSE_DESKTOP) {
    setInterval(function () {
      fetch('/api/ping', { headers: { 'X-Kasse-Token': window.KASSE_DESKTOP.token } }).catch(function () {});
    }, 2000);
  }
})();
