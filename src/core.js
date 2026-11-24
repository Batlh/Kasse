/* Rechenkern der Kasse. Alle Beträge sind ganze Cent, damit keine Rundungsfehler entstehen.
   Bestände werden nie direkt verändert, sondern immer aus Startwerten + Buchungen berechnet. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KasseCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DENOMS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
  var BILLS = [500, 1000, 2000, 5000, 10000, 20000, 50000];
  var COINS = [200, 100, 50, 20, 10, 5, 2, 1];

  function emptyState() {
    return { v: 1, eventName: '', setupDone: false, createdAt: Date.now(),
      startCash: {}, articles: [], log: [], cart: [], costs: [], nextId: 1 };
  }

  function fmt(c) {
    c = Math.round(c || 0);
    var neg = c < 0; c = Math.abs(c);
    var e = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var ct = String(c % 100); if (ct.length < 2) ct = '0' + ct;
    return (neg ? '−' : '') + e + ',' + ct + ' €';
  }

  function parseEuro(s) {
    s = String(s == null ? '' : s).trim().replace(/€|\s/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
    var p = s.split('.');
    var ct = ((p[1] || '') + '00').slice(0, 2);
    return parseInt(p[0], 10) * 100 + parseInt(ct, 10);
  }

  function denomLabel(d) { return d >= 100 ? (d / 100) + ' €' : d + ' ct'; }
  function sum(p) { var t = 0; for (var k in (p || {})) t += Number(k) * p[k]; return t; }
  function pieces(p) { var t = 0; for (var k in (p || {})) t += p[k]; return t; }
  function clean(p) { var o = {}; for (var k in (p || {})) if (p[k]) o[k] = p[k]; return o; }

  /* Findet eine Stückelung aus dem vorhandenen Bestand. Null, wenn es nicht exakt geht. */
  function makeChange(amount, avail) {
    if (amount === 0) return {};
    if (amount < 0) return null;
    var dead = {};
    function go(i, rest) {
      if (rest === 0) return {};
      if (i >= DENOMS.length) return null;
      var key = i + ':' + rest;
      if (dead[key]) return null;
      var d = DENOMS[i];
      var max = Math.min(Math.max(0, (avail && avail[d]) || 0), Math.floor(rest / d));
      for (var n = max; n >= 0; n--) {
        var r = go(i + 1, rest - n * d);
        if (r) { if (n) r[d] = n; return r; }
      }
      dead[key] = true;
      return null;
    }
    return go(0, amount);
  }

  /* Stückelung ohne Bestandsgrenze, für die Schaltfläche "Passend". */
  function canonical(amount) {
    var r = {};
    DENOMS.forEach(function (d) {
      var n = Math.floor(amount / d);
      if (n) { r[d] = n; amount -= n * d; }
    });
    return r;
  }

  var COST_CATS = ['Getränke', 'Location', 'Band', 'Deko', 'Technik', 'Sonstiges'];

  function newArt() { return { sold: 0, returned: 0, redeemed: 0, tipped: 0, adjusted: 0, revenue: 0, refunded: 0, tippedValue: 0 }; }

  function derive(S) {
    var cash = {}, a;
    DENOMS.forEach(function (d) { cash[d] = (S.startCash && S.startCash[d]) || 0; });
    var startTotal = sum(cash);
    var arts = {};
    (S.articles || []).forEach(function (x) { arts[x.id] = newArt(); });
    function art(id) { return arts[id] || (arts[id] = newArt()); }
    var r = { sales: 0, refunds: 0, income: 0, expenses: 0, deposits: 0, withdrawals: 0,
      diffs: 0, count: 0, tipsCash: 0, tokenTips: 0, costs: 0, byCat: {}, lastCount: null };
    function cat(name, amount, fromCash) {
      name = name || 'Sonstiges';
      var c = r.byCat[name] || (r.byCat[name] = { total: 0, cash: 0 });
      c.total += amount; if (fromCash) c.cash += amount;
    }

    (S.log || []).forEach(function (tx) {
      if (tx.voided) return;
      var k;
      for (k in (tx.cashIn || {})) cash[k] = (cash[k] || 0) + tx.cashIn[k];
      for (k in (tx.cashOut || {})) cash[k] = (cash[k] || 0) - tx.cashOut[k];
      r.diffs += tx.diff || 0;
      r.tipsCash += tx.tip || 0;
      if (tx.type === 'sale') {
        r.count++;
        (tx.lines || []).forEach(function (l) {
          a = art(l.articleId);
          if (l.qty > 0) { a.sold += l.qty; a.revenue += l.qty * l.unit; r.sales += l.qty * l.unit; }
          else { a.returned += -l.qty; a.refunded += -l.qty * l.unit; r.refunds += -l.qty * l.unit; }
        });
      }
      else if (tx.type === 'tokentip') {
        (tx.lines || []).forEach(function (l) {
          a = art(l.articleId); a.tipped += l.qty; a.tippedValue += l.qty * l.unit; r.tokenTips += l.qty * l.unit;
        });
      }
      else if (tx.type === 'redeem') art(tx.articleId).redeemed += tx.qty;
      else if (tx.type === 'expense') { r.expenses += -tx.flow; cat(tx.cat, -tx.flow, true); }
      else if (tx.type === 'income') r.income += tx.flow;
      else if (tx.type === 'deposit') r.deposits += tx.flow;
      else if (tx.type === 'withdrawal') r.withdrawals += -tx.flow;
      else if (tx.type === 'adjust') art(tx.articleId).adjusted += tx.qty;
      else if (tx.type === 'count') r.lastCount = tx;
    });
    (S.costs || []).forEach(function (c) { r.costs += c.amount; cat(c.cat, c.amount, false); });

    var open = 0, openValue = 0;
    (S.articles || []).forEach(function (x) {
      a = arts[x.id];
      a.stock = x.stock == null ? null : x.stock + a.adjusted - a.sold + a.returned;
      a.circ = a.sold - a.returned - a.redeemed - a.tipped;
      a.outstanding = Math.max(0, a.circ);
      if (x.refund != null) { open += a.outstanding; openValue += a.outstanding * x.refund; }
    });

    r.cash = cash; r.cashTotal = sum(cash); r.startTotal = startTotal; r.arts = arts;
    r.open = open; r.openValue = openValue;
    r.tips = r.tipsCash + r.tokenTips;
    r.revenue = r.sales - r.refunds - r.tokenTips + r.income;
    r.costTotal = r.expenses + r.costs;
    r.result = r.revenue - r.costTotal + r.diffs;
    r.resultIfAllReturned = r.result - openValue;
    return r;
  }

  function articleById(S, id) {
    for (var i = 0; i < S.articles.length; i++) if (S.articles[i].id === id) return S.articles[i];
    return null;
  }

  /* Warenkorb: {articleId, qty, kind:'sale'|'return'} -> gebuchte Zeilen mit Preisen von diesem Moment. */
  function cartLines(S, cart) {
    var out = [];
    (cart || []).forEach(function (c) {
      var a = articleById(S, c.articleId);
      if (!a || !c.qty) return;
      if (c.kind === 'return') out.push({ articleId: a.id, name: a.name, qty: -c.qty, unit: a.refund || 0 });
      else out.push({ articleId: a.id, name: a.name, qty: c.qty, unit: a.price });
    });
    return out;
  }

  function linesTotal(lines) {
    var t = 0; lines.forEach(function (l) { t += l.qty * l.unit; }); return t;
  }

  function cartWarnings(S, cart) {
    var d = derive(S), w = [], sale = {}, ret = {};
    (cart || []).forEach(function (c) {
      if (c.kind === 'return') ret[c.articleId] = (ret[c.articleId] || 0) + c.qty;
      else sale[c.articleId] = (sale[c.articleId] || 0) + c.qty;
    });
    Object.keys(sale).forEach(function (id) {
      var a = articleById(S, Number(id)); if (!a) return;
      var st = d.arts[id].stock, back = ret[id] || 0;
      if (st != null && sale[id] > st + back)
        w.push(a.name + ': nur noch ' + (st + back) + ' auf Lager, ' + sale[id] + ' im Korb.');
    });
    Object.keys(ret).forEach(function (id) {
      var a = articleById(S, Number(id)); if (!a) return;
      var o = d.arts[id].outstanding;
      if (ret[id] > o)
        w.push(a.name + ': nur ' + o + ' im Umlauf, ' + ret[id] + ' sollen zurück.');
    });
    return w;
  }

  function addTx(S, tx) {
    tx.id = S.nextId++;
    tx.ts = tx.ts || Date.now();
    tx.cashIn = clean(tx.cashIn);
    tx.cashOut = clean(tx.cashOut);
    if (tx.flow == null) tx.flow = 0;
    if (!tx.tip) delete tx.tip;
    tx.diff = sum(tx.cashIn) - sum(tx.cashOut) - tx.flow - (tx.tip || 0);
    S.log.push(tx);
    return tx;
  }

  function bookSale(S, cart, cashIn, cashOut, tip) {
    var lines = cartLines(S, cart);
    return addTx(S, { type: 'sale', lines: lines, flow: linesTotal(lines), cashIn: cashIn, cashOut: cashOut, tip: tip || 0 });
  }

  /* Gast gibt Marken zurück und lässt das Geld als Trinkgeld da: kein Bargeld, Marken aus dem Umlauf. */
  function bookTokenTip(S, cart) {
    var lines = cartLines(S, cart).filter(function (l) { return l.qty < 0; }).map(function (l) {
      return { articleId: l.articleId, name: l.name, qty: -l.qty, unit: l.unit };
    });
    return addTx(S, { type: 'tokentip', lines: lines, flow: 0 });
  }

  /* An der Theke eingesammelte Marken: kein Bargeld, nur weniger im Umlauf. */
  function bookRedeem(S, articleId, qty) {
    var a = articleById(S, articleId);
    return addTx(S, { type: 'redeem', articleId: articleId, qty: qty, note: qty + ' × ' + (a ? a.name : '') + ' eingelöst', flow: 0 });
  }

  function cloneLines(l) { return (l || []).map(function (x) { return { articleId: x.articleId, name: x.name, qty: x.qty, unit: x.unit }; }); }

  /* Korrektur ohne Storno. Die alte Fassung bleibt in tx.history, das Differenz-Geld kommt zum Bargeld der Buchung. */
  function correctTx(S, id, ch, cashIn, cashOut) {
    var tx = null;
    S.log.forEach(function (t) { if (t.id === id) tx = t; });
    if (!tx || tx.voided) return null;
    var old = { ts: Date.now(), flow: tx.flow };
    if (tx.lines) old.lines = cloneLines(tx.lines);
    if (tx.note != null) old.note = tx.note;
    if (tx.cat != null) old.cat = tx.cat;
    (tx.history || (tx.history = [])).push(old);
    if (ch.lines) { tx.lines = cloneLines(ch.lines).filter(function (l) { return l.qty; }); tx.flow = linesTotal(tx.lines); }
    if (ch.flow != null) tx.flow = ch.flow;
    if (ch.note != null) tx.note = ch.note;
    if (ch.cat != null) tx.cat = ch.cat;
    var k;
    tx.cashIn = clean(tx.cashIn); tx.cashOut = clean(tx.cashOut);
    for (k in (cashIn || {})) tx.cashIn[k] = (tx.cashIn[k] || 0) + cashIn[k];
    for (k in (cashOut || {})) tx.cashOut[k] = (tx.cashOut[k] || 0) + cashOut[k];
    tx.cashIn = clean(tx.cashIn); tx.cashOut = clean(tx.cashOut);
    tx.diff = sum(tx.cashIn) - sum(tx.cashOut) - tx.flow - (tx.tip || 0);
    return tx;
  }

  function linesText(lines) {
    return (lines || []).map(function (l) { return (l.qty < 0 ? 'zurück: ' + (-l.qty) : l.qty) + ' × ' + l.name; }).join(', ');
  }

  /* Kassensturz: gezählte Stückzahlen werden zum neuen Stand, die Abweichung wird als Differenz gebucht. */
  function bookCount(S, counted) {
    var cash = derive(S).cash, cIn = {}, cOut = {};
    DENOMS.forEach(function (d) {
      var delta = (counted[d] || 0) - (cash[d] || 0);
      if (delta > 0) cIn[d] = delta;
      if (delta < 0) cOut[d] = -delta;
    });
    return addTx(S, { type: 'count', flow: 0, cashIn: cIn, cashOut: cOut });
  }

  function voidTx(S, id) {
    for (var i = 0; i < S.log.length; i++) {
      if (S.log[i].id === id) { S.log[i].voided = true; S.log[i].voidedAt = Date.now(); return true; }
    }
    return false;
  }

  function validate(o) {
    if (!o || typeof o !== 'object' || o.v !== 1) return 'Das ist keine Sicherung dieser Kasse.';
    if (!Array.isArray(o.articles) || !Array.isArray(o.log) || typeof o.startCash !== 'object' || !o.startCash)
      return 'Die Datei ist unvollständig.';
    if (typeof o.nextId !== 'number') return 'Die Datei ist unvollständig.';
    if (!Array.isArray(o.cart)) o.cart = [];
    if (!Array.isArray(o.costs)) o.costs = [];
    return null;
  }

  var TYPE_LABEL = { sale: 'Verkauf', expense: 'Ausgabe', income: 'Einnahme', deposit: 'Einlage',
    withdrawal: 'Entnahme', exchange: 'Geld gewechselt', count: 'Kasse gezählt', adjust: 'Bestand geändert',
    redeem: 'Marken eingelöst', tokentip: 'Marken als Trinkgeld' };

  function txTitle(tx) {
    if (tx.type === 'sale') {
      var buy = (tx.lines || []).some(function (l) { return l.qty > 0; });
      var back = (tx.lines || []).some(function (l) { return l.qty < 0; });
      return buy && back ? 'Verkauf und Rückgabe' : back ? 'Rückgabe' : 'Verkauf';
    }
    return TYPE_LABEL[tx.type] || tx.type;
  }

  function csvNum(c) { return (c / 100).toFixed(2).replace('.', ','); }
  function csvCell(s) { s = String(s == null ? '' : s); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  function toCsv(S) {
    var d = derive(S), rows = [];
    function row() { rows.push(Array.prototype.map.call(arguments, csvCell).join(';')); }
    row('Veranstaltung', S.eventName); row('');
    row('Ergebnis der Veranstaltung', 'Euro');
    row('Verkäufe', csvNum(d.sales));
    row('Rückgaben', csvNum(-d.refunds));
    if (d.tokenTips) row('Marken als Trinkgeld', csvNum(-d.tokenTips));
    if (d.income) row('Sonstige Einnahmen', csvNum(d.income));
    row('Einnahmen', csvNum(d.revenue));
    Object.keys(d.byCat).forEach(function (k) { row('Kosten ' + k, csvNum(-d.byCat[k].total)); });
    row('Kosten gesamt', csvNum(-d.costTotal));
    if (d.diffs) row('Kassendifferenzen', csvNum(d.diffs));
    row('Ergebnis', csvNum(d.result));
    row('Trinkgeld für Helfer (nicht im Ergebnis)', csvNum(d.tips));
    row('');
    row('Kasse', 'Euro');
    row('Startgeld', csvNum(d.startTotal));
    row('Verkäufe', csvNum(d.sales));
    row('Rückgaben', csvNum(-d.refunds));
    row('Sonstige Einnahmen', csvNum(d.income));
    row('Ausgaben bar', csvNum(-d.expenses));
    row('Einlagen', csvNum(d.deposits));
    row('Entnahmen', csvNum(-d.withdrawals));
    row('Trinkgeld beim Bezahlen', csvNum(d.tipsCash));
    row('Differenzen', csvNum(d.diffs));
    row('Kassenbestand laut App', csvNum(d.cashTotal));
    row('');
    row('Kosten der Veranstaltung', 'Kategorie', 'Betrag', 'Bezahlt');
    (S.costs || []).forEach(function (c) { row(c.note || c.cat, c.cat, csvNum(c.amount), 'nicht aus der Kasse'); });
    S.log.forEach(function (t) { if (t.type === 'expense' && !t.voided) row(t.note, t.cat || 'Sonstiges', csvNum(-t.flow), 'bar aus der Kasse'); });
    row('');
    row('Artikel', 'Preis', 'Rückgabewert', 'Verkauft', 'Zurück', 'Eingelöst', 'Trinkgeld', 'Im Umlauf', 'Umsatz', 'Ausgezahlt', 'Bestand');
    S.articles.forEach(function (a) {
      var x = d.arts[a.id], r = a.refund != null;
      row(a.name, csvNum(a.price), r ? csvNum(a.refund) : '', x.sold, x.returned, r ? x.redeemed : '', r ? x.tipped : '',
        r ? x.outstanding : '', csvNum(x.revenue), csvNum(x.refunded), x.stock == null ? '' : x.stock);
    });
    row('');
    row('Scheine und Münzen', 'Start', 'Aktuell');
    DENOMS.forEach(function (k) { row(denomLabel(k), (S.startCash[k] || 0), d.cash[k] || 0); });
    row('');
    row('Nr', 'Zeit', 'Art', 'Details', 'Betrag', 'Trinkgeld', 'Differenz', 'Storniert', 'Korrigiert');
    S.log.forEach(function (t) {
      var det = t.lines ? linesText(t.lines) : (t.note || '');
      if (t.type === 'tokentip') det = linesText(t.lines);
      row(t.id, new Date(t.ts).toLocaleString('de-DE'), txTitle(t), det, csvNum(t.flow), t.tip ? csvNum(t.tip) : '',
        csvNum(t.diff || 0), t.voided ? 'ja' : '', t.history ? 'ja' : '');
    });
    return '﻿' + rows.join('\r\n') + '\r\n';
  }

  return { DENOMS: DENOMS, BILLS: BILLS, COINS: COINS, emptyState: emptyState, fmt: fmt, parseEuro: parseEuro,
    denomLabel: denomLabel, sum: sum, pieces: pieces, clean: clean, makeChange: makeChange, canonical: canonical,
    derive: derive, articleById: articleById, cartLines: cartLines, linesTotal: linesTotal,
    cartWarnings: cartWarnings, addTx: addTx, bookSale: bookSale, bookCount: bookCount, voidTx: voidTx,
    validate: validate, txTitle: txTitle, toCsv: toCsv, COST_CATS: COST_CATS, bookTokenTip: bookTokenTip,
    bookRedeem: bookRedeem, correctTx: correctTx, linesText: linesText };
});
