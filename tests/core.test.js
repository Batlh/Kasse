const assert = require('assert');
const C = require('../src/core.js');

function setup() {
  const S = C.emptyState();
  S.startCash = { 2000: 2, 1000: 3, 500: 4, 200: 10, 100: 10, 50: 10 };
  S.articles.push({ id: 900, name: 'Marke', price: 200, refund: 200, stock: 100, active: true });
  S.articles.push({ id: 901, name: 'Abendkasse', price: 1500, refund: null, stock: null, active: true });
  return S;
}

// Beispiel des Nutzers: 10 Marken für 20 €, 6 verbraucht, 4 zurück = 8 €
{
  const S = setup();
  const start = C.derive(S).cashTotal;
  assert.strictEqual(start, 2 * 2000 + 3 * 1000 + 4 * 500 + 10 * 200 + 10 * 100 + 10 * 50);
  const cart = [{ articleId: 900, qty: 10, kind: 'sale' }];
  assert.strictEqual(C.linesTotal(C.cartLines(S, cart)), 2000);
  // zahlt mit 50 €, bekommt 30 € zurück
  const avail = C.derive(S).cash;
  const change = C.makeChange(3000, avail);
  assert.strictEqual(C.sum(change), 3000);
  C.bookSale(S, cart, { 5000: 1 }, change);
  let d = C.derive(S);
  assert.strictEqual(d.cashTotal, start + 2000);
  assert.strictEqual(d.arts[900].stock, 90);
  assert.strictEqual(d.open, 10);
  assert.strictEqual(d.openValue, 2000);

  const ret = [{ articleId: 900, qty: 4, kind: 'return' }];
  const lines = C.cartLines(S, ret);
  assert.strictEqual(C.linesTotal(lines), -800, 'Rückgabe von 4 Marken muss 8 € sein');
  const out = C.makeChange(800, d.cash);
  const tx = C.bookSale(S, ret, {}, out);
  assert.strictEqual(tx.diff, 0);
  d = C.derive(S);
  assert.strictEqual(d.cashTotal, start + 1200);
  assert.strictEqual(d.arts[900].sold, 10);
  assert.strictEqual(d.arts[900].returned, 4);
  assert.strictEqual(d.arts[900].outstanding, 6);
  assert.strictEqual(d.arts[900].stock, 94);
  assert.strictEqual(d.result, 1200);
  assert.strictEqual(d.resultIfAllReturned, 0);
}

// Abendkasse, Ausgabe, Einlage, Entnahme: Bestand muss zur Abrechnung passen
{
  const S = setup();
  C.bookSale(S, [{ articleId: 901, qty: 2, kind: 'sale' }], { 2000: 1, 1000: 1 }, {});
  C.addTx(S, { type: 'expense', flow: -1340, note: 'Eis', cashIn: {}, cashOut: { 1000: 1, 200: 2 } }).diff;
  assert.strictEqual(S.log[1].diff, 1340 * -1 * -1 - 1400, 'Ausgabe mit 14 € statt 13,40 € zeigt −60 ct Differenz');
  C.addTx(S, { type: 'deposit', flow: 5000, cashIn: { 5000: 1 } });
  C.addTx(S, { type: 'withdrawal', flow: -2000, cashOut: { 2000: 1 } });
  C.addTx(S, { type: 'income', flow: 300, cashIn: { 200: 1, 100: 1 } });
  C.addTx(S, { type: 'exchange', flow: 0, cashIn: { 1000: 1 }, cashOut: { 500: 2 } });
  const d = C.derive(S);
  assert.strictEqual(d.cashTotal,
    d.startTotal + d.sales - d.refunds + d.income - d.expenses + d.deposits - d.withdrawals + d.diffs);
  assert.strictEqual(d.result, 3000 + 300 - 1340 - 60);
}

// Storno stellt Geld und Bestand wieder her
{
  const S = setup();
  const before = C.derive(S);
  const tx = C.bookSale(S, [{ articleId: 900, qty: 3, kind: 'sale' }], { 1000: 1 }, { 200: 2 });
  C.voidTx(S, tx.id);
  const after = C.derive(S);
  assert.deepStrictEqual(after.cash, before.cash);
  assert.strictEqual(after.arts[900].stock, 100);
  assert.strictEqual(after.sales, 0);
}

// Kassensturz macht gezählten Stand zum neuen Stand
{
  const S = setup();
  const counted = Object.assign({}, C.derive(S).cash);
  counted[200] -= 1; counted[5000] = 1;
  const tx = C.bookCount(S, counted);
  assert.strictEqual(tx.diff, 4800);
  assert.deepStrictEqual(C.clean(C.derive(S).cash), C.clean(counted));
}

// Wechselgeld
assert.deepStrictEqual(C.makeChange(60, { 50: 1, 20: 3 }), { 20: 3 }, 'Darf nicht an der 50 hängen bleiben');
assert.deepStrictEqual(C.makeChange(3000, { 2000: 1, 1000: 1 }), { 2000: 1, 1000: 1 });
assert.strictEqual(C.makeChange(30, { 50: 5 }), null);
assert.deepStrictEqual(C.makeChange(0, {}), {});
for (let i = 0; i < 3000; i++) {
  const av = {}; C.DENOMS.forEach(d => { av[d] = Math.floor(Math.random() * 4); });
  const amt = Math.floor(Math.random() * 30000);
  const r = C.makeChange(amt, av);
  if (r) {
    assert.strictEqual(C.sum(r), amt);
    Object.keys(r).forEach(k => assert.ok(r[k] <= av[k]));
  }
}
const impossible = {}; C.DENOMS.forEach(d => { impossible[d] = 20; }); impossible[1] = 0; impossible[2] = 0; impossible[5] = 0;
assert.strictEqual(C.makeChange(123401, impossible), null);

// Warnungen
{
  const S = setup();
  assert.strictEqual(C.cartWarnings(S, [{ articleId: 900, qty: 4, kind: 'return' }]).length, 1);
  assert.strictEqual(C.cartWarnings(S, [{ articleId: 900, qty: 101, kind: 'sale' }]).length, 1);
  assert.strictEqual(C.cartWarnings(S, [{ articleId: 900, qty: 100, kind: 'sale' }]).length, 0);
  assert.strictEqual(C.cartWarnings(S, [{ articleId: 901, qty: 999, kind: 'sale' }]).length, 0);
}

// Spätere Preisänderung ändert alte Buchungen nicht
{
  const S = setup();
  C.bookSale(S, [{ articleId: 900, qty: 1, kind: 'sale' }], { 200: 1 }, {});
  S.articles[0].price = 500;
  assert.strictEqual(C.derive(S).sales, 200);
}

// Geldformat und Eingabe
assert.strictEqual(C.fmt(123456), '1.234,56 €');
assert.strictEqual(C.fmt(-800), '−8,00 €');
assert.strictEqual(C.fmt(5), '0,05 €');
for (const [i, o] of [['2', 200], ['2,5', 250], ['2,50', 250], ['2.50', 250], ['1.234,50', 123450], ['1.234', 123400], ['0,05', 5], ['19,99', 1999], ['abc', null], ['', null], ['-1', null], ['1,234', null]])
  assert.strictEqual(C.parseEuro(i), o, i);
assert.strictEqual(C.denomLabel(50000), '500 €');
assert.strictEqual(C.denomLabel(50), '50 ct');

// Sicherung
{
  const S = setup();
  C.bookSale(S, [{ articleId: 900, qty: 1, kind: 'sale' }], { 200: 1 }, {});
  const back = JSON.parse(JSON.stringify(S));
  assert.strictEqual(C.validate(back), null);
  assert.ok(C.validate({ foo: 1 }));
  assert.deepStrictEqual(C.derive(back).cash, C.derive(S).cash);
  const csv = C.toCsv(S);
  assert.ok(csv.includes('Marke;2,00;2,00;1;0;0;0;1;2,00;0,00;99'), csv);
}

// Kosten der Veranstaltung: nur Bilanz, keine Kassenbewegung
{
  const S = setup();
  const cash0 = C.derive(S).cashTotal;
  C.bookSale(S, [{ articleId: 900, qty: 50, kind: 'sale' }], { 5000: 2 }, {});
  S.costs.push({ id: 1, cat: 'Band', note: 'Band', amount: 3000, ts: 1 });
  S.costs.push({ id: 2, cat: 'Location', amount: 4000, ts: 1 });
  C.addTx(S, { type: 'expense', cat: 'Band', note: 'Band Getränke', flow: -1000, cashOut: { 1000: 1 } });
  const d = C.derive(S);
  assert.strictEqual(d.cashTotal, cash0 + 10000 - 1000, 'Kosten ändern das Bargeld nicht');
  assert.strictEqual(d.costTotal, 8000);
  assert.strictEqual(d.byCat.Band.total, 4000);
  assert.strictEqual(d.byCat.Band.cash, 1000);
  assert.strictEqual(d.result, 10000 - 8000);
}

// Korrektur: 30 Marken + 2 Karten statt 10 Marken + 2 Karten -> 40 € zurück
{
  const S = setup();
  const cash0 = C.derive(S).cashTotal;
  const tx = C.bookSale(S, [{ articleId: 900, qty: 30, kind: 'sale' }, { articleId: 901, qty: 2, kind: 'sale' }], { 5000: 1, 2000: 2 }, {});
  assert.strictEqual(tx.flow, 9000);
  const lines = tx.lines.map(l => Object.assign({}, l)); lines[0].qty = 10;
  const diff = C.linesTotal(lines) - tx.flow;
  assert.strictEqual(diff, -4000);
  C.correctTx(S, tx.id, { lines }, {}, { 2000: 2 });
  const d = C.derive(S);
  assert.strictEqual(tx.flow, 5000);
  assert.strictEqual(tx.diff, 0);
  assert.strictEqual(tx.history.length, 1);
  assert.strictEqual(tx.history[0].lines[0].qty, 30);
  assert.strictEqual(d.cashTotal, cash0 + 5000);
  assert.strictEqual(d.arts[900].sold, 10);
  assert.strictEqual(d.arts[900].stock, 90);
  assert.strictEqual(d.sales, 5000);
  // Ausgabe korrigieren: 13,40 statt 14,40, 1 € zurück in die Kasse
  const e = C.addTx(S, { type: 'expense', note: 'Eis', cat: 'Getränke', flow: -1440, cashOut: { 1000: 1, 200: 2, 20: 2 } });
  C.correctTx(S, e.id, { flow: -1340, note: 'Eis', cat: 'Getränke' }, { 100: 1 }, {});
  assert.strictEqual(e.diff, 0);
  assert.strictEqual(C.derive(S).expenses, 1340);
}

// Eingelöst und Marken als Trinkgeld
{
  const S = setup();
  C.bookSale(S, [{ articleId: 900, qty: 20, kind: 'sale' }], { 2000: 2 }, {});
  C.bookRedeem(S, 900, 12);
  let d = C.derive(S);
  assert.strictEqual(d.arts[900].outstanding, 8);
  assert.strictEqual(d.open, 8);
  assert.strictEqual(C.cartWarnings(S, [{ articleId: 900, qty: 9, kind: 'return' }]).length, 1);
  const cash1 = d.cashTotal;
  C.bookTokenTip(S, [{ articleId: 900, qty: 3, kind: 'return' }]);
  d = C.derive(S);
  assert.strictEqual(d.cashTotal, cash1, 'Marken-Trinkgeld bewegt kein Bargeld');
  assert.strictEqual(d.arts[900].outstanding, 5);
  assert.strictEqual(d.tokenTips, 600);
  assert.strictEqual(d.result, 4000 - 600, 'Trinkgeld steht getrennt vom Ergebnis');
  assert.strictEqual(d.tips, 600);
  // Rest beim Bezahlen als Trinkgeld: 5 € für 2 Marken (4 €), 1 € Trinkgeld
  const t = C.bookSale(S, [{ articleId: 900, qty: 2, kind: 'sale' }], { 500: 1 }, {}, 100);
  assert.strictEqual(t.diff, 0);
  d = C.derive(S);
  assert.strictEqual(d.tipsCash, 100);
  assert.strictEqual(d.tips, 700);
  assert.strictEqual(d.result, 4400 - 600);
  assert.strictEqual(d.cashTotal,
    d.startTotal + d.sales - d.refunds + d.income - d.expenses + d.deposits - d.withdrawals + d.tipsCash + d.diffs);
}

// Alter Stand ohne Kosten lädt weiter
{
  const o = JSON.parse(JSON.stringify(setup())); delete o.costs;
  assert.strictEqual(C.validate(o), null);
  assert.deepStrictEqual(o.costs, []);
}
console.log('Alle Rechenprüfungen bestanden.');
