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

test('a family item listing says it is a private sale, a shop listing does not', () => {
  const base = { title: { fr: 'Vélo d’enfant', nl: 'Kinderfiets' }, dims: '', price: 40, state: 'fair', notes: {} };
  assert.match(E.listingText({ ...base, scope: 'private' }, 'fr', 'Schaerbeek').body, /Vente entre particuliers/);
  assert.match(E.listingText({ ...base, scope: 'private' }, 'nl', 'Schaarbeek').body, /Verkoop tussen particulieren/);
  assert.doesNotMatch(E.listingText(base, 'fr', 'Schaerbeek').body, /particuliers/);
});

test('a scanned conversation is linked to a known customer by handle, phone or e-mail', () => {
  const customers = [
    { id: 'c1', handle: '@demo_sophie', phone: '+32 470 00 00 11', email: 'sophie@demo.test' },
    { id: 'c2', handle: '', phone: '+32 470 00 00 44', email: '' },
  ];
  assert.equal(E.matchCustomer({ handles: ['@Demo_Sophie'], phones: [], emails: [] }, customers), 'c1');
  assert.equal(E.matchCustomer({ handles: [], phones: ['+32 470 00 00 44'], emails: [] }, customers), 'c2');
  assert.equal(E.matchCustomer({ handles: [], phones: [], emails: ['SOPHIE@demo.test'] }, customers), 'c1');
  assert.equal(E.matchCustomer({ handles: ['@inconnu'], phones: [], emails: [] }, customers), null);
});

test('the agreed price is the last amount close to the asking price, never a delivery fee', () => {
  assert.equal(E.agreedPrice([450, 400], 480), 400);
  assert.equal(E.agreedPrice([40, 450], 480), 450);
  assert.equal(E.agreedPrice([40], 480), null);
  assert.equal(E.agreedPrice([], 480), null);
});

test('phones match whatever the format (+32, 0032, 0)', () => {
  const customers = [{ id: 'c9', handle: '', phone: '0470 00 00 99', email: '' }];
  assert.equal(E.matchCustomer({ handles: [], phones: ['+32 470 00 00 99'], emails: [] }, customers), 'c9');
  assert.equal(E.matchCustomer({ handles: [], phones: ['0032470000099'], emails: [] }, customers), 'c9');
});

test('a family listing has no empty size line and no shop delivery terms', () => {
  const body = E.listingText({ title: { fr: 'Vélo d’enfant' }, dims: '', price: 40, state: 'fair', notes: {}, scope: 'private' }, 'fr', 'Schaerbeek').body;
  assert.doesNotMatch(body, /Dimensions/);
  assert.doesNotMatch(body, /livraison possible sur devis/);
  assert.match(body, /Retrait à convenir/);
});

test('landlines and addresses written with a dash are recognised too', () => {
  const c = E.parseContact('L’Andalou — Rue du Marché au Charbon 45 - 1000 Bruxelles\nRéservations : 02 512 34 56 / +32 2 512 34 57\ninfo@restaurant.test');
  assert.deepEqual(c.addresses, [{ street: 'Rue du Marché au Charbon 45', zip: '1000', city: 'Bruxelles' }]);
  assert.deepEqual(c.phones, ['+32 2 512 34 56', '+32 2 512 34 57']);
  assert.deepEqual(c.emails, ['info@restaurant.test']);
  assert.deepEqual(E.parseContact('Ma rue : Avenue Louise 54 – 1050 Ixelles').addresses, [{ street: 'Avenue Louise 54', zip: '1050', city: 'Ixelles' }]);
  assert.deepEqual(E.parseContact('fixe 03 123 45 67').phones, ['+32 3 123 45 67']);
});

test('the agreed price comes from "ok pour", "d’accord", "deal" or "akkoord" first', () => {
  assert.equal(E.parseContact('Oui ! 750 € livraison incluse\nOk pour 700€ ?\nOk pour 700 €').agreed, 700);
  assert.equal(E.parseContact('Je propose 600 € ? Akkoord voor 650 euro').agreed, 650);
  assert.equal(E.parseContact('Il est à combien ? 450 €').agreed, null);
});

test('OCR look-alikes (l, I, 1) do not create two handles for the same person', () => {
  assert.deepEqual(E.parseContact('@sophie.d_bxl\n@sophie.d_bxI').handles, ['@sophie.d_bxl']);
});

test('contact links open WhatsApp, SMS, Instagram and e-mail with the message encoded', () => {
  const l = E.contactLinks({ phone: '+32 470 00 00 11', handle: '@demo_sophie', email: 'sophie@demo.test' }, 'Bonjour & merci ? 450 €');
  assert.equal(l.whatsapp, 'https://wa.me/32470000011?text=Bonjour%20%26%20merci%20%3F%20450%20%E2%82%AC');
  assert.equal(l.sms, 'sms:+32470000011?&body=Bonjour%20%26%20merci%20%3F%20450%20%E2%82%AC');
  assert.equal(l.instagram, 'https://ig.me/m/demo_sophie');
  assert.equal(l.email, 'mailto:sophie@demo.test?body=Bonjour%20%26%20merci%20%3F%20450%20%E2%82%AC');
  const none = E.contactLinks({ phone: '', handle: '@x y', email: 'pas-un-mail' }, 'x');
  assert.deepEqual([none.whatsapp, none.sms, none.instagram, none.email], [null, null, null, null]);
  assert.equal(E.contactLinks({ phone: '0470 00 00 11' }, 'x').whatsapp, 'https://wa.me/32470000011?text=x');
});

test('ready-made messages fit the situation: B2C, B2B, family (C2C), delivery, address', () => {
  const d = { name: 'Sophie', item: 'Armoire vintage', price: '750,00 €', ogm: '+++202/6000/06054+++', iban: 'BE00 0000 0000 0000', shop: 'OctoPuces',
    date: '31/10/2026', slot: '18:00–20:00', address: 'Rue de la Victoire 12, 1060 Saint-Gilles', no: 'F-2026-0060' };
  assert.match(E.message('b2c', d, 'fr'), /Bonjour Sophie.*Armoire vintage.*750,00 €.*\+\+\+202\/6000\/06054\+\+\+/s);
  assert.match(E.message('b2b', d, 'fr'), /F-2026-0060.*Peppol/s);
  const c2c = E.message('c2c', d, 'fr');
  assert.match(c2c, /entre particuliers/);
  assert.doesNotMatch(c2c, /OctoPuces|\+\+\+/);
  assert.match(E.message('delivery', d, 'nl'), /31\/10\/2026.*18:00–20:00.*Rue de la Victoire/s);
  assert.match(E.message('address', d, 'fr'), /adresse complète/);
});

test('company numbers are not phones; Belgian formats with slash, (0) or 2-digit groups are', () => {
  assert.deepEqual(E.parseContact('BCE 0412.345.678 — TVA BE 0403 170 701').phones, []);
  assert.deepEqual(E.parseContact('0470/12 34 56').phones, ['+32 470 12 34 56']);
  assert.deepEqual(E.parseContact('0470/12.34.56').phones, ['+32 470 12 34 56']);
  assert.deepEqual(E.parseContact('02/123.45.67').phones, ['+32 2 123 45 67']);
  assert.deepEqual(E.parseContact('+32 (0)470 12 34 56').phones, ['+32 470 12 34 56']);
  assert.deepEqual(E.parseContact('04 70 12 34 56').phones, ['+32 470 12 34 56']);
});

test('a refused offer is not an agreed price', () => {
  assert.equal(E.parseContact('Pas ok pour 200 €, mon prix c’est 250 €').agreed, null);
  assert.equal(E.parseContact('Niet akkoord voor 200 euro').agreed, null);
});

test('e-mail links refuse hidden recipients; messages have no empty gaps', () => {
  assert.equal(E.contactLinks({ email: 'a@b.com?bcc=x%40evil.org&z=.be' }, 'x').email, null);
  assert.equal(E.contactLinks({ email: 'a@b.com%0Abcc:x@y.be' }, 'x').email, null);
  const m = E.message('b2c', { name: 'Sophie', item: 'Armoire', price: '750,00 €', ogm: '+++1+++', iban: 'BE00', shop: 'OctoPuces' }, 'fr');
  assert.doesNotMatch(m, /undefined|Livraison le|  /);
  assert.doesNotMatch(E.message('delivery', { name: 'Sophie', item: 'Armoire' }, 'fr'), /undefined|le  |entre  /);
});

test('a delivery message gives date, time slot and address (FR and NL), today = Wednesday 28/10/2026', () => {
  const T = '2026-10-28';
  assert.deepEqual(E.parseDelivery('Plutôt samedi entre 14h et 16h svp', T), { date: '2026-10-31', slot: '14:00–16:00', address: null });
  assert.deepEqual(E.parseDelivery('demain vers 18h ?', T), { date: '2026-10-29', slot: '18:00–20:00', address: null });
  assert.deepEqual(E.parseDelivery('le 3/11 le matin', T), { date: '2026-11-03', slot: '09:00–12:00', address: null });
  assert.deepEqual(E.parseDelivery('zaterdag tussen 10u en 12u', T), { date: '2026-10-31', slot: '10:00–12:00', address: null });
  assert.deepEqual(E.parseDelivery('Kan het op 5 november rond 19u?', T), { date: '2026-11-05', slot: '19:00–21:00', address: null });
  assert.deepEqual(E.parseDelivery('après-demain 14:30-16:00', T), { date: '2026-10-30', slot: '14:30–16:00', address: null });
  const moved = E.parseDelivery('Nouvelle adresse : Avenue Louise 54, 1050 Ixelles. Lundi après-midi ?', T);
  assert.deepEqual(moved, { date: '2026-11-02', slot: '13:00–17:00', address: { street: 'Avenue Louise 54', zip: '1050', city: 'Ixelles' } });
  assert.deepEqual(E.parseDelivery('le 12/01', T).date, '2027-01-12');
  assert.deepEqual(E.parseDelivery('merci beaucoup', T), { date: null, slot: null, address: null });
});

test('delivery parsing ignores quantities, prices, words and house numbers; understands ranges and evenings', () => {
  const T = '2026-10-28', P = s => E.parseDelivery(s, T);
  assert.equal(P('canapé 3/4 places, samedi').date, '2026-10-31');
  assert.equal(P('2-3 personnes pour porter').date, null);
  assert.equal(P('ok 3.10 € de plus').date, null);
  assert.equal(P('Tél 0470/12.34.56, livraison le 3/11').date, '2026-11-03');
  assert.equal(P('kast met 2 uitschuifbare laden').slot, null);
  assert.equal(P('Avenue Brugmann 12, 1180 Uccle').slot, null);
  assert.equal(P('entre 9 et 11h').slot, '09:00–11:00');
  assert.equal(P('tussen 9 en 11 uur').slot, '09:00–11:00');
  assert.equal(P('entre 16h et 14h').slot, null);
  assert.equal(P('pas samedi, plutôt dimanche').date, '2026-11-01');
  assert.deepEqual([P('ce soir').date, P('ce soir').slot], ['2026-10-28', '18:00–21:00']);
  assert.deepEqual([P('zaterdagavond').date, P('zaterdagavond').slot], ['2026-10-31', '18:00–21:00']);
  assert.equal(P('vanavond').date, '2026-10-28');
  assert.equal(P('le 03/11/25').date, null);
});

test('dictated text is normalised before reading: spoken @, dots, capitals after the postcode', () => {
  assert.equal(E.fromSpeech('mon mail c\'est sarah point dupont arobase gmail point com'), 'mon mail c\'est sarah.dupont@gmail.com');
  assert.equal(E.fromSpeech('mijn mail is jan apenstaartje telenet punt be'), 'mijn mail is jan@telenet.be');
  assert.equal(E.fromSpeech('son compte arobase lea underscore bxl'), 'son compte @lea_bxl');
  const c = E.parseContact(E.fromSpeech('livraison avenue louise 54 1050 ixelles ok pour 300 euros'));
  assert.deepEqual(c.addresses, [{ street: 'avenue louise 54', zip: '1050', city: 'Ixelles' }]);
  assert.equal(c.agreed, 300);
  assert.deepEqual(E.parseContact(E.fromSpeech('kerkstraat 5 2000 antwerpen')).addresses, [{ street: 'Kerkstraat 5', zip: '2000', city: 'Antwerpen' }]);
});

test('a name is only taken from an explicit phrase, never from the rest of the chat', () => {
  assert.deepEqual(E.parseContact('Bonjour, je m’appelle Sarah Dupont, 0470 00 00 55').names, ['Sarah Dupont']);
  assert.deepEqual(E.parseContact('Mijn naam is Jan Peeters').names, ['Jan Peeters']);
  assert.deepEqual(E.parseContact('Nom : Léa Martin\nadresse…').names, ['Léa Martin']);
  assert.deepEqual(E.parseContact('Je suis intéressée par la commode').names, []);
});

test('each field read from a conversation gets a verdict before it is used', () => {
  assert.equal(E.checkField('phone', '+32 470 00 00 55'), 'ok');
  assert.equal(E.checkField('phone', '0470 00 00'), 'bad');
  assert.equal(E.checkField('email', 'sarah@gmail.com'), 'ok');
  assert.equal(E.checkField('email', 'sarah@gmail'), 'bad');
  assert.equal(E.checkField('handle', '@lea_bxl'), 'ok');
  assert.equal(E.checkField('handle', '@lé a'), 'bad');
  assert.equal(E.checkField('address', { street: 'Avenue Louise 54', zip: '1050', city: 'Ixelles' }), 'ok');
  assert.equal(E.checkField('address', { street: 'Avenue Louise', zip: '1050', city: 'Ixelles' }), 'bad');  // pas de numéro
  assert.equal(E.checkField('address', { street: 'Avenue Louise 54', zip: '105', city: 'Ixelles' }), 'bad');
  assert.equal(E.checkField('amount', 300), 'ok');
  assert.equal(E.checkField('amount', 0), 'bad');
  assert.equal(E.checkField('name', 'Sarah'), 'ok');
  assert.equal(E.checkField('phone', ''), 'empty');
});

test('dictated names get their capitals back, foreign numbers and number-first streets are accepted', () => {
  assert.deepEqual(E.parseContact(E.fromSpeech("je m'appelle léa martin et mon numéro 0470 00 00 77")).names, ['Léa Martin']);
  assert.deepEqual(E.parseContact(E.fromSpeech('mijn naam is jan peeters')).names, ['Jan Peeters']);
  assert.equal(E.checkField('phone', '+33 6 12 34 56 78'), 'ok');
  assert.equal(E.checkField('address', { street: '54 rue de la Paix', zip: '1000', city: 'Bruxelles' }), 'ok');
  assert.equal(E.checkField('amount', '1 450'), 'ok');
  assert.equal(E.checkField('amount', '1.450,00'), 'ok');
  assert.equal(E.checkField('amount', 'abc'), 'bad');
});
