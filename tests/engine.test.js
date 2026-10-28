const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../assets/engine.js');

test('margin VAT follows the official SPF example (buy 200, sell 300)', () => {
  assert.deepEqual(E.marginVat(200, 300), { margin: 100, base: 82.64, vat: 17.36 });
});

test('a loss or zero margin carries no VAT', () => {
  assert.deepEqual(E.marginVat(300, 250), { margin: -50, base: 0, vat: 0 });
});

test('regime depends on where the piece came from', () => {
  assert.equal(E.regimeOf({ origin: 'particulier' }), 'margin');
  assert.equal(E.regimeOf({ origin: 'depot' }), 'margin');
  assert.equal(E.regimeOf({ origin: 'revendeur-marge' }), 'margin');
  assert.equal(E.regimeOf({ origin: 'pro-21' }), 'normal21');
  assert.equal(E.regimeOf({ origin: 'pro-6' }), 'normal6');
});

test('sale tax fills the declaration grids for each regime', () => {
  assert.deepEqual(E.saleTax({ origin: 'particulier', purchase: 200 }, 300).grids, { g00: 200, g01: 0, g03: 82.64, g54: 17.36 });
  assert.deepEqual(E.saleTax({ origin: 'particulier', purchase: 300 }, 250).grids, { g00: 250, g01: 0, g03: 0, g54: 0 });
  assert.deepEqual(E.saleTax({ origin: 'pro-21', purchase: 100 }, 242).grids, { g00: 0, g01: 0, g03: 200, g54: 42 });
  assert.deepEqual(E.saleTax({ origin: 'pro-6', purchase: 500 }, 1060).grids, { g00: 0, g01: 1000, g03: 0, g54: 60 });
});

test('consignment uses the depositor payout as purchase price', () => {
  const t = E.saleTax({ origin: 'depot', commission: 0.3 }, 240);
  assert.equal(t.purchase, 168);
  assert.equal(t.margin, 72);
  assert.equal(t.vat, 12.5);
  assert.deepEqual(E.consignment(240, 0.3), { payout: 168, commission: 72 });
});

test('quarter grids add up sales of the same quarter only', () => {
  const sales = [
    { date: '2026-10-03', piece: { origin: 'particulier', purchase: 200 }, price: 300 },
    { date: '2026-11-12', piece: { origin: 'pro-21', purchase: 100 }, price: 242 },
    { date: '2026-09-30', piece: { origin: 'particulier', purchase: 10 }, price: 1000 },
  ];
  assert.deepEqual(E.quarterGrids(sales, '2026-Q4'), { g00: 200, g01: 0, g03: 282.64, g54: 59.36 });
  assert.equal(E.quarterOf('2026-09-30'), '2026-Q3');
});

test('cash above 3 000 € is refused, 3 000 € exactly is allowed', () => {
  assert.equal(E.cashCheck(3000).ok, true);
  assert.equal(E.cashCheck(3000.01).ok, false);
});

test('a draft lists what is still missing before it can be listed', () => {
  assert.deepEqual(E.missingFields({ title: 'Buffet', photos: 0, price: null, origin: 'particulier', purchase: 60, dims: '' }), ['photos', 'price', 'dims']);
  assert.deepEqual(E.missingFields({ title: 'Buffet', photos: 3, price: 690, origin: 'particulier', purchase: 180, dims: '180 × 45 × 80' }), []);
});

test('a bought piece needs its purchase price, a consigned piece does not', () => {
  const base = { title: 'Buffet', photos: 3, price: 690, dims: '180 × 45 × 80' };
  assert.deepEqual(E.missingFields({ ...base, origin: 'particulier' }), ['purchase']);
  assert.deepEqual(E.missingFields({ ...base, origin: 'pro-21', purchase: NaN }), ['purchase']);
  assert.deepEqual(E.missingFields({ ...base, origin: 'depot' }), []);
  assert.deepEqual(E.missingFields({ ...base, origin: 'particulier', purchase: 0 }), []);
});

test('Belgian enterprise numbers are checked with mod 97', () => {
  assert.equal(E.validBce('BE0700.000.005'), true);
  assert.equal(E.validBce('0400000086'), true);
  assert.equal(E.validBce('BE0400000002'), false);
  assert.equal(E.validBce('BE070000000'), false);
});

test('Belgian structured communication has a valid mod 97 check', () => {
  assert.equal(E.structuredComm(1234567890), '+++123/4567/89002+++');
  assert.equal(E.structuredComm(97), '+++000/0000/09797+++');
});

test('money and dates use Belgian formats', () => {
  const plain = s => s.replace(/ /g, ' ');
  assert.equal(plain(E.money(1234.5)), '1 234,50 €');
  assert.equal(plain(E.money(-7)), '-7,00 €');
  assert.equal(plain(E.money(1234567)), '1 234 567,00 €');
  assert.equal(E.date('2026-10-28'), '28/10/2026');
});

test('Peppol UBL for a margin sale uses category E with the legal mention and escapes text', () => {
  const addr = { street: 'Rue Fictive 1', city: 'Ixelles', zip: '1050' };
  const xml = E.peppolUbl({ number: 'F-2026-0042', date: '2026-10-21', ogm: '+++202/6000/04236+++', iban: 'BE00 0000 0000 0000',
    seller: { name: 'La Remise SRL', vat: 'BE0700000005', address: addr },
    buyer: { name: 'Hôtel <Les Tanneurs> & Co', vat: 'BE0400000086', address: addr }, lines: [{ label: 'Canapé Chesterfield', price: 1450, regime: 'margin' }], lang: 'fr' });
  assert.match(xml, /<cbc:ID>E<\/cbc:ID>/);
  assert.match(xml, /<cbc:Percent>0.00<\/cbc:Percent>/);
  assert.match(xml, /régime particulier d'imposition de la marge bénéficiaire/);
  assert.match(xml, /Hôtel &lt;Les Tanneurs&gt; &amp; Co/);
  assert.doesNotMatch(xml, /VATEX/);
  assert.match(xml, /<cbc:PayableAmount currencyID="EUR">1450.00<\/cbc:PayableAmount>/);
  assert.match(xml, /<cac:Country><cbc:IdentificationCode>BE<\/cbc:IdentificationCode><\/cac:Country>/);
  assert.match(xml, /<cbc:DueDate>2026-11-20<\/cbc:DueDate>/);
  assert.match(xml, /<cbc:BuyerReference>F-2026-0042<\/cbc:BuyerReference>/);
  assert.match(xml, /<cbc:PaymentMeansCode>30<\/cbc:PaymentMeansCode><cbc:PaymentID>\+\+\+202\/6000\/04236\+\+\+<\/cbc:PaymentID>/);
  assert.doesNotMatch(xml, //);
});

test('Peppol UBL at the normal rate: no margin mention, rounding keeps the total equal to the price', () => {
  const addr = { street: 'Rue Fictive 1', city: 'Ixelles', zip: '1050' };
  const xml = E.peppolUbl({ number: 'F-1', date: '2026-10-21', seller: { name: 'A', vat: 'BE0700000005', address: addr },
    buyer: { name: 'B', vat: 'BE0400000086', address: addr }, lines: [{ label: 'Commode', price: 100, regime: 'normal21' }], lang: 'fr' });
  assert.doesNotMatch(xml, /marge/);
  assert.match(xml, /<cbc:PayableRoundingAmount currencyID="EUR">0.01<\/cbc:PayableRoundingAmount>/);
  assert.match(xml, /<cbc:PayableAmount currencyID="EUR">100.00<\/cbc:PayableAmount>/);
});

test('a listing is ready to paste in FR and NL, with size, price and pick-up', () => {
  const p = { title: { fr: 'Buffet en teck', nl: 'Teakhouten dressoir' }, dims: '180 × 45 × 80 cm', price: 690, state: 'good',
    notes: { fr: 'Pieds fuselés.', nl: 'Taps toelopende poten.' } };
  const fr = E.listingText(p, 'fr', 'Ixelles');
  assert.equal(fr.title, 'Buffet en teck — 690 €');
  assert.match(fr.body, /180 × 45 × 80 cm/);
  assert.match(fr.body, /Très bon état/);
  assert.match(fr.body, /Retrait à Ixelles/);
  assert.match(E.listingText(p, 'nl', 'Elsene').body, /Afhalen in Elsene/);
});

test('a payment is matched to the open sale with the same balance, name first', () => {
  const open = [
    { id: 's1', balance: 450, customer: 'Peeters' },
    { id: 's2', balance: 450, customer: 'Janssens' },
    { id: 's3', balance: 90, customer: 'Janssens' },
  ];
  assert.deepEqual(E.matchPayment({ amount: 450, from: 'JANSSENS P' }, open).map(s => s.id), ['s2', 's1']);
  assert.deepEqual(E.matchPayment({ amount: 12, from: 'X' }, open), []);
  const withComm = [{ id: 'a', balance: 450, customer: 'Janssens', ogm: '+++111/1111/11111+++' }, { id: 'b', balance: 450, customer: 'Peeters', ogm: '+++202/6000/04438+++' }];
  assert.deepEqual(E.matchPayment({ amount: 450, from: 'JANSSENS P', ref: '+++202/6000/04438+++' }, withComm).map(s => s.id), ['b', 'a']);
});

test('an Instagram caption becomes a draft: title, price, size, condition, delivery', () => {
  const cap = '<><> vintage sideboard <><>\n\nA beautiful piece in excellent condition, full of 60s & 70s charm. \n\nSale price : 1450 €\n\nSize : L 250 D 50 H 100 \n\n🚚  Free delivery in Brussels and surrounding areas.';
  assert.deepEqual(E.parseCaption(cap), { title: 'vintage sideboard', price: 1450, dims: '250 × 50 × 100 cm', state: 'good', delivery: true });
  const chairs = '<><> 6 vintage chairs <><>\nA beautiful piece in great condition.\nSale price : 600 €\nSitting height : 45 cm';
  assert.deepEqual(E.parseCaption(chairs), { title: '6 vintage chairs', price: 600, dims: 'assise 45 cm', state: 'good', delivery: false });
  assert.equal(E.parseCaption('Table en chêne\nPrix : 1 250,50 €\nTaille : L 182,5 P 40 H 86').price, 1250.5);
  assert.equal(E.parseCaption('Table en chêne\nPrix : 1 250,50 €\nTaille : L 182,5 P 40 H 86').dims, '182,5 × 40 × 86 cm');
});

test('a scanned conversation yields phone, e-mail, handle, address and amount', () => {
  const ocr = 'sophie.d_bxl\nBonjour, le buffet est encore dispo ?\nOk pour 1450€, livraison svp\nRue de la Victoire 12 bte 3, 1060 Saint-Gilles\nmon num 0478 12 34 56 ou sophie.dupont@exemple.be\n@sophie.d_bxl';
  const c = E.parseContact(ocr);
  assert.deepEqual(c.phones, ['+32 478 12 34 56']);
  assert.deepEqual(c.emails, ['sophie.dupont@exemple.be']);
  assert.deepEqual(c.handles, ['@sophie.d_bxl']);
  assert.deepEqual(c.addresses, [{ street: 'Rue de la Victoire 12 bte 3', zip: '1060', city: 'Saint-Gilles' }]);
  assert.deepEqual(c.amounts, [1450]);
  const nl = E.parseContact('Dag! Mijn adres: Kerkstraat 5, 2000 Antwerpen. Bel +32 470 00 00 01');
  assert.deepEqual(nl.addresses, [{ street: 'Kerkstraat 5', zip: '2000', city: 'Antwerpen' }]);
  assert.deepEqual(nl.phones, ['+32 470 00 00 01']);
});

test('a credit note cancels the sale in the VAT grids; family items never enter them', () => {
  const piece = { origin: 'particulier', purchase: 200 };
  const sales = [
    { date: '2026-10-03', piece, price: 300 },
    { date: '2026-10-20', piece, price: -300 },
    { date: '2026-10-21', piece: { origin: 'particulier', purchase: 0 }, price: 80, private: true },
  ];
  assert.deepEqual(E.quarterGrids(sales, '2026-Q4'), { g00: 0, g01: 0, g03: 0, g54: 0 });
});

test('only validated payments count; a promised deposit does not reduce the balance', () => {
  const pays = [{ amount: 100, state: 'promised' }, { amount: 50 }, { amount: 30, state: 'validated' }, { amount: 70, state: 'void' }];
  assert.equal(E.paidAmount(pays), 80);
  assert.equal(E.promisedAmount(pays), 100);
});
