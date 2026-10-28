/* Calculs purs de la démo (aucun accès au DOM) : TVA sur la marge (art. 58 §4 CTVA, AR n° 53), grilles de la déclaration,
   plafond espèces, dépôt-vente, communication structurée, annonce FR/NL et facture Peppol UBL. Testé par tests/engine.test.js.
   Règle de calcul « par bien » : hypothèse à faire valider par un conseiller TVA (étude §6.2), comme toutes les grilles. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CASH_LIMIT = 3000;
  const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;

  function marginVat(purchase, sale, rate = 21) {
    const margin = round2(sale - purchase);
    if (margin <= 0) return { margin, base: 0, vat: 0 };
    const vat = round2(margin * rate / (100 + rate));
    return { margin, base: round2(margin - vat), vat };
  }

  // particulier, déposant ou revendeur qui a lui-même appliqué la marge : régime de la marge ; achat à un pro avec TVA : régime normal
  // (21 %, ou 6 % pour une antiquité achetée au taux réduit depuis la loi du 19/12/2025).
  function regimeOf(piece) {
    if (piece.origin === 'pro-21') return 'normal21';
    if (piece.origin === 'pro-6') return 'normal6';
    return 'margin';
  }

  function consignment(sale, rate) {
    const payout = round2(sale * (1 - rate));
    return { payout, commission: round2(sale - payout) };
  }

  function saleTax(piece, sale) {
    const regime = regimeOf(piece);
    if (regime === 'margin') {
      const purchase = piece.origin === 'depot' ? consignment(sale, piece.commission).payout : piece.purchase;
      const m = marginVat(purchase, sale);
      const g00 = m.margin > 0 ? round2(sale - m.margin) : sale;
      return { regime, purchase, ...m, grids: { g00, g01: 0, g03: m.base, g54: m.vat } };
    }
    const rate = regime === 'normal6' ? 6 : 21;
    const base = round2(sale * 100 / (100 + rate));
    const vat = round2(sale - base);
    return { regime, purchase: piece.purchase, margin: round2(base - piece.purchase), base, vat,
      grids: { g00: 0, g01: rate === 6 ? base : 0, g03: rate === 21 ? base : 0, g54: vat } };
  }

  const quarterOf = iso => `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;

  function quarterGrids(sales, quarter) {
    const sum = { g00: 0, g01: 0, g03: 0, g54: 0 };
    for (const s of sales) {
      if (s.private || quarterOf(s.date) !== quarter) continue;  // objets de la famille : hors activité
      const g = saleTax(s.piece, Math.abs(s.price)).grids;
      const sign = s.price < 0 ? -1 : 1;  // note de crédit : écriture inverse, jamais une suppression
      for (const k of Object.keys(sum)) sum[k] = round2(sum[k] + sign * g[k]);
    }
    return sum;
  }

  const cashCheck = amount => ({ ok: amount <= CASH_LIMIT, limit: CASH_LIMIT });

  function missingFields(p) {
    const missing = [];
    if (!p.title) missing.push('title');
    if (!p.photos) missing.push('photos');
    if (p.price == null || p.price <= 0) missing.push('price');
    if (!p.origin) missing.push('origin');
    if (!p.dims) missing.push('dims');
    if (p.origin && p.origin !== 'depot' && !(Number.isFinite(p.purchase) && p.purchase >= 0)) missing.push('purchase');
    return missing;
  }

  // Numéro d'entreprise belge : 10 chiffres, les 2 derniers = 97 - (8 premiers mod 97).
  function validBce(s) {
    const d = String(s).replace(/\D/g, '');
    if (d.length !== 10 || !/^[01]/.test(d)) return false;
    return 97 - (Number(d.slice(0, 8)) % 97) === Number(d.slice(8));
  }

  function structuredComm(n) {
    const base = String(n).padStart(10, '0').slice(-10);
    const check = String(Number(BigInt(base) % 97n) || 97).padStart(2, '0');
    const d = base + check;
    return `+++${d.slice(0, 3)}/${d.slice(3, 7)}/${d.slice(7)}+++`;
  }

  function money(x) {
    const neg = x < 0;
    const [int, dec] = Math.abs(round2(x)).toFixed(2).split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${neg ? '-' : ''}${grouped},${dec} €`;
  }

  const date = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

  const STATE = {
    fr: { new: 'Comme neuf', good: 'Très bon état', fair: "Bon état, traces d'usage", restore: 'À restaurer' },
    nl: { new: 'Als nieuw', good: 'Zeer goede staat', fair: 'Goede staat, gebruikssporen', restore: 'Te restaureren' },
  };
  const LISTING = {
    fr: (p, place) => [p.notes?.fr, p.dims ? `Dimensions (L × P × H) : ${p.dims}.` : null, `État : ${STATE.fr[p.state] || ''}.`,
      p.scope === 'private' ? 'Retrait à convenir.' : `Retrait à ${place}, livraison possible sur devis. Paiement Bancontact, virement ou espèces.`],
    nl: (p, place) => [p.notes?.nl, p.dims ? `Afmetingen (B × D × H): ${p.dims}.` : null, `Staat: ${STATE.nl[p.state] || ''}.`,
      p.scope === 'private' ? 'Afhalen in onderling overleg.' : `Afhalen in ${place}, levering mogelijk op offerte. Betalen met Bancontact, overschrijving of cash.`],
  };

  // objet de la famille : l'acheteur doit savoir qu'il achète à un particulier (pas de garantie commerciale)
  const PRIVATE = {
    fr: 'Vente entre particuliers : objet personnel de la famille, hors boutique, sans garantie commerciale.',
    nl: 'Verkoop tussen particulieren: persoonlijk voorwerp van de familie, buiten de winkel, zonder handelsgarantie.',
  };
  function listingText(p, lang, place) {
    const title = `${p.title[lang] || p.title.fr} — ${String(p.price).replace('.', ',')} €`;
    const lines = LISTING[lang](p, place).filter(Boolean);
    if (p.scope === 'private') lines.push(PRIVATE[lang]);
    return { title, body: lines.join('\n') };
  }

  function agreedPrice(amounts, asking) {
    const ok = amounts.filter(a => a >= asking * 0.5 && a <= asking * 1.5);
    return ok.length ? ok[ok.length - 1] : null;
  }

  // Client déjà connu ? Même @compte, même téléphone (chiffres) ou même e-mail, sans tenir compte de la casse.
  function matchCustomer(found, customers) {
    const lc = s => String(s || '').trim().toLowerCase();
    const digits = s => String(s || '').replace(/\D/g, '').replace(/^0032/, '').replace(/^32/, '').replace(/^0/, '');
    const hit = customers.find(c =>
      (c.handle && found.handles.some(x => lc(x) === lc(c.handle))) ||
      (c.phone && found.phones.some(x => digits(x) === digits(c.phone))) ||
      (c.email && found.emails.some(x => lc(x) === lc(c.email))));
    return hit ? hit.id : null;
  }

  const MENTION = {
    fr: "Livraison soumise au régime particulier d'imposition de la marge bénéficiaire. TVA non déductible.",
    nl: 'Levering onderworpen aan de bijzondere regeling van belastingheffing over de winstmarge. Btw niet aftrekbaar.',
  };

  const esc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const amt = x => round2(x).toFixed(2);
  const endpoint = vat => String(vat).replace(/\D/g, '');

  // Peppol BIS Billing 3.0. Marge : catégorie E à 0 %, mention légale en motif d'exemption, sans code VATEX (note efacture.belgium.be
  // du 25/02/2026) ; prix d'achat et marge n'apparaissent jamais. Ligne au régime normal : catégorie S, TVA comprise dans le prix.
  function peppolUbl(inv) {
    const groups = {};
    const lines = inv.lines.map((l, i) => {
      const cat = l.regime === 'margin' ? 'E' : 'S';
      const pct = l.regime === 'normal6' ? 6 : l.regime === 'normal21' ? 21 : 0;
      const net = round2(l.price * 100 / (100 + pct));
      const g = groups[cat + pct] ||= { cat, pct, net: 0 };
      g.net = round2(g.net + net);
      return { ...l, n: i + 1, cat, pct, net };
    });
    const subtotals = Object.values(groups).map(g => ({ ...g, tax: round2(g.net * g.pct / 100) }));
    const net = round2(subtotals.reduce((s, g) => s + g.net, 0));
    const tax = round2(subtotals.reduce((s, g) => s + g.tax, 0));
    // le prix affiché est TVA comprise : l'arrondi par ligne peut laisser un centime, rendu par PayableRoundingAmount (BR-CO-16)
    const total = round2(inv.lines.reduce((s, l) => s + l.price, 0));
    const rounding = round2(total - net - tax);
    const hasMargin = lines.some(l => l.cat === 'E');
    const due = new Date(Date.parse(inv.date) + 30 * 864e5).toISOString().slice(0, 10);
    const address = a => `<cac:PostalAddress><cbc:StreetName>${esc(a?.street || '')}</cbc:StreetName><cbc:CityName>${esc(a?.city || '')}</cbc:CityName>` +
      `<cbc:PostalZone>${esc(a?.zip || '')}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>BE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>`;
    const party = (tag, p) => `  <cac:${tag}><cac:Party>
    <cbc:EndpointID schemeID="0208">${esc(endpoint(p.vat))}</cbc:EndpointID>
    <cac:PartyName><cbc:Name>${esc(p.name)}</cbc:Name></cac:PartyName>
    ${address(p.address)}
    <cac:PartyTaxScheme><cbc:CompanyID>${esc(p.vat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:${tag}>`;
    const category = g => `<cac:TaxCategory><cbc:ID>${g.cat}</cbc:ID><cbc:Percent>${amt(g.pct)}</cbc:Percent>` +
      (g.cat === 'E' ? `<cbc:TaxExemptionReason>${esc(MENTION[inv.lang] || MENTION.fr)}</cbc:TaxExemptionReason>` : '') +
      '<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>';
    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${esc(inv.number)}</cbc:ID>
  <cbc:IssueDate>${esc(inv.date)}</cbc:IssueDate>
  <cbc:DueDate>${due}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
${hasMargin ? `  <cbc:Note>${esc(MENTION[inv.lang] || MENTION.fr)}</cbc:Note>
` : ''}  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${esc(inv.buyerRef || inv.number)}</cbc:BuyerReference>
${party('AccountingSupplierParty', inv.seller)}
${party('AccountingCustomerParty', inv.buyer)}
  <cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>${inv.ogm ? `<cbc:PaymentID>${esc(inv.ogm)}</cbc:PaymentID>` : ''}${inv.iban ? `<cac:PayeeFinancialAccount><cbc:ID>${esc(String(inv.iban).replace(/\s/g, ''))}</cbc:ID></cac:PayeeFinancialAccount>` : ''}</cac:PaymentMeans>
  <cac:PaymentTerms><cbc:Note>30 jours / 30 dagen</cbc:Note></cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${amt(tax)}</cbc:TaxAmount>
${subtotals.map(g => `    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">${amt(g.net)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">${amt(g.tax)}</cbc:TaxAmount>${category(g)}</cac:TaxSubtotal>`).join('\n')}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${amt(net)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${amt(net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${amt(net + tax)}</cbc:TaxInclusiveAmount>
${rounding ? `    <cbc:PayableRoundingAmount currencyID="EUR">${amt(rounding)}</cbc:PayableRoundingAmount>
` : ''}    <cbc:PayableAmount currencyID="EUR">${amt(total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines.map(l => `  <cac:InvoiceLine><cbc:ID>${l.n}</cbc:ID><cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">${amt(l.net)}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>${esc(l.label)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${l.cat}</cbc:ID><cbc:Percent>${amt(l.pct)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">${amt(l.net)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`).join('\n')}
</Invoice>`;
  }

  // Rang : communication structurée identique, puis nom du client dans le libellé bancaire, puis montant seul.
  function matchPayment(payment, openSales) {
    const cents = x => Math.round(x * 100);
    const from = String(payment.from || '').toUpperCase();
    const rank = s => (payment.ref && s.ogm === payment.ref ? 0 : from.includes(String(s.customer).toUpperCase()) ? 1 : 2);
    return openSales.filter(s => cents(s.balance) === cents(payment.amount))
      .map(s => ({ s, r: rank(s) })).sort((a, b) => a.r - b.r).map(x => x.s);
  }

  /* ---------- Acomptes : un acompte « promis » n'est pas encore de l'argent ---------- */
  const paidAmount = pays => round2(pays.filter(y => y.state !== 'promised' && y.state !== 'void').reduce((t, y) => t + y.amount, 0));
  const promisedAmount = pays => round2(pays.filter(y => y.state === 'promised').reduce((t, y) => t + y.amount, 0));

  /* ---------- Légende Instagram → brouillon (format des publications OctoPuces, FR/NL/EN) ---------- */
  function num(s) {
    let x = String(s).replace(/[\s\u00a0]/g, '');
    x = x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x.replace(/\.(?=\d{3}$)/, '');
    return Number(x);
  }
  function parseCaption(text) {
    const t = String(text || '');
    const marked = t.match(/<><>\s*(.*?)\s*<><>/);
    const title = (marked ? marked[1] : t.split('\n').find(l => l.trim()) || '').trim();
    const pm = t.match(/(?:sale price|price|prix|prijs)\s*:?\s*(\d[\d\s.,]*)\s*€/i);
    const size = t.match(/(?:size|taille|dimensions?|afmetingen)\s*:\s*L\s*([\d.,]+)\s*[DP]\s*([\d.,]+)\s*H\s*([\d.,]+)/i);
    const seat = t.match(/(?:sitting height|hauteur d'assise|zithoogte)\s*:\s*([\d.,]+)\s*cm/i);
    const cond = (t.match(/in (excellent|great|good|fair) condition/i) || [])[1];
    return {
      title,
      price: pm ? num(pm[1]) : null,
      dims: size ? `${size[1]} × ${size[2]} × ${size[3]} cm` : seat ? `assise ${seat[1]} cm` : '',
      state: ({ excellent: 'good', great: 'good', good: 'fair', fair: 'fair' })[cond?.toLowerCase()] || 'good',
      delivery: /free delivery|livraison gratuite|gratis levering/i.test(t),
    };
  }

  /* ---------- Conversation scannée (OCR) → coordonnées proposées, toujours relues par l'utilisateur ---------- */
  const anyCase = w => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`;
  const FR_ST = String.raw`(?:${['rue', 'avenue', 'av\.', 'chaussée', 'boulevard', 'bd', 'place', 'quai', 'drève', 'clos', 'square', 'allée', 'impasse', 'chemin'].map(anyCase).join('|')})(?:\s+[A-Za-zÀ-ÿ'’.-]+){1,5}?`;
  const NL_ST = "[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]*(?:straat|laan|lei|steenweg|plein|weg|dreef|kaai|vest)";
  const ADDRESS = new RegExp(String.raw`((?:${FR_ST}|${NL_ST})\s+\d{1,4}[a-zA-Z]?(?:\s*(?:bte|bus|boîte)\s*\w+)?)\s*[,\-–—]?\s*(\d{4})\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+(?:[ -][A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+)*)`, 'g');
  function parseContact(text) {
    const t = String(text || '');
    const uniq = a => [...new Set(a)];
    const emails = uniq(t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []);
    // l, I et 1 se confondent à la lecture : deux variantes du même @compte n'en font qu'un (la première lue est gardée)
    const lookalike = s => s.toLowerCase().replace(/[i1|]/g, 'l');
    const handles = (t.match(/(?:^|[\s(])@[A-Za-z0-9._]{3,30}/g) || []).map(s => s.trim().replace(/^\(/, '').replace(/\.$/, ''))
      .filter((x, i, all) => all.findIndex(y => lookalike(y) === lookalike(x)) === i);
    // GSM (04xx xx xx xx) et fixes (02 xxx xx xx, 010 xx xx xx…) : on garde le numéro national et on le remet au format belge
    // GSM et fixes belges (séparateurs espace . - /, « (0) » après +32) ; un numéro d'entreprise (BCE, TVA, KBO, groupé 4.3.3) n'est pas un téléphone
    const phoneRe = /(?:\+32\s?(?:\(0\)\s?)?|0032\s?|\b0)\d{1,3}(?:[\s./-]?\d{2,3}){2,4}\b/g;
    const phones = uniq([...t.matchAll(phoneRe)].filter(m => !/(?:BE|BCE|KBO|TVA|BTW|VAT)[\s:.]*$/i.test(t.slice(Math.max(0, m.index - 8), m.index))
      && !/^0\d{3}[.\s]\d{3}[.\s]\d{3}$/.test(m[0])).map(m => {
      const d = m[0].replace(/\(0\)/, '').replace(/\D/g, '').replace(/^0032/, '').replace(/^32/, '').replace(/^0/, '');
      if (d.length === 9 && d[0] === '4') return `+32 ${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
      if (d.length === 8 && '2349'.includes(d[0])) return `+32 ${d[0]} ${d.slice(1, 4)} ${d.slice(4, 6)} ${d.slice(6, 8)}`;
      if (d.length === 8) return `+32 ${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 6)} ${d.slice(6, 8)}`;
      return null;
    }).filter(Boolean));
    const addresses = [...t.matchAll(ADDRESS)].map(m => ({ street: m[1].replace(/\s+/g, ' ').trim(), zip: m[2], city: m[3] }));
    const amounts = uniq([...t.matchAll(/(\d{1,3}(?:[ .\u00a0]\d{3})+|\d+)(?:,(\d{1,2}))?\s?(?:€|EUR\b|euros?\b)/gi)]
      .map(m => Number(m[1].replace(/\D/g, '') + (m[2] ? `.${m[2]}` : ''))));
    // prix convenu : dernier montant qui suit une formule d'accord (FR, NL, EN)
    const deals = [...t.matchAll(/(?:\bok\b|\bokay\b|d['’]accord|\bdeal\b|akkoord|\bparfait\b|\bc['’]est bon\b)\s*(?:pour|voor|for|à|aan)?\s*(\d{1,3}(?:[ . ]\d{3})+|\d+)(?:,(\d{1,2}))?\s?(?:€|eur\b|euros?\b)/gi)]
      .filter(m => !/\b(?:pas|niet|not|no)\s*$/i.test(t.slice(Math.max(0, m.index - 8), m.index)));  // « pas ok pour… » n'est pas un accord
    const last = deals[deals.length - 1];
    const agreed = last ? Number(last[1].replace(/\D/g, '') + (last[2] ? `.${last[2]}` : '')) : null;
    // nom : seulement après une formule explicite (« je m'appelle », « nom : », « mijn naam is »), jamais deviné dans le reste
    const NAME = "[A-ZÀ-Ý][a-zà-ÿ'’-]+";
    const names = uniq([...t.matchAll(new RegExp(String.raw`(?:[Jj]e m['’]appelle|[Mm]on nom (?:est|c['’]est)|\b[Nn]om\s*:|[Aa]u nom de|[Mm]ijn naam is|[Ii]k heet|\b[Nn]aam\s*:|[Oo]p naam van)\s+(${NAME}(?:[ -]${NAME})?)`, 'g'))].map(m => m[1]));
    return { phones, emails, handles, addresses, amounts, agreed, names };
  }

  // Texte dicté (reconnaissance vocale) → texte lisible par parseContact : « arobase », « point com », majuscule de la commune
  function fromSpeech(text) {
    const dots = s => s.replace(/\s+(?:point|punt)\s+/gi, '.');
    return String(text || '')
      .replace(/\s*\b(?:underscore|tiret bas|liggend streepje)\b\s*/gi, '_')
      .replace(/(\S+(?:\s+(?:point|punt)\s+\S+)*)\s+(?:arobase|apenstaartje)\s+(\S+(?:\s+(?:point|punt)\s+\S+)+)/gi, (m, a, b) => `${dots(a)}@${dots(b)}`)
      .replace(/\b(?:arobase|apenstaartje)\s+/gi, '@')
      .replace(/(@[\w.]+)\s+(?:point|punt)\s+(?=\w)/gi, '$1.')
      .replace(/\b([a-zà-ÿ][a-zà-ÿ'’-]*(?:straat|laan|lei|steenweg|plein|weg|dreef|kaai|vest))\b/g, s => s[0].toUpperCase() + s.slice(1))
      .replace(/(\b\d{4}\s+)([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase())
      // nom dit après « je m'appelle », « mijn naam is »… : la reconnaissance vocale le rend souvent en minuscules
      .replace(/((?:je m['’]appelle|mon nom (?:est|c['’]est)|nom\s*:|au nom de|mijn naam is|ik heet|naam\s*:|op naam van)\s+)([a-zà-ÿ][a-zà-ÿ'’-]+)(?:([ -])([a-zà-ÿ][a-zà-ÿ'’-]+))?/gi,
        (m, a, b, sep, c) => a + b[0].toUpperCase() + b.slice(1) + (c && !/^(?:et|en|and|mon|ma|mijn|je|ik)$/i.test(c) ? sep + c[0].toUpperCase() + c.slice(1) : sep && c ? sep + c : ''));
  }

  // Montant écrit à la belge (« 1 450 », « 1.450,00 », « 300,5 ») → nombre, ou NaN
  function toAmount(v) {
    if (typeof v === 'number') return v;
    let s = String(v ?? '').replace(/[\s €]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  // Verdict d'un champ repris d'une conversation : 'ok', 'bad' (à corriger) ou 'empty'.
  // Mêmes exigences que l'enregistrement : adresse = rue avec numéro, code postal à 4 chiffres, commune.
  function checkField(kind, v) {
    if (kind === 'address') {
      const a = v || {};
      if (![a.street, a.zip, a.city].some(x => String(x || '').trim())) return 'empty';
      return /\p{L}{2}/u.test(a.street || '') && /\d/.test(a.street || '') && /^\d{4}$/.test(String(a.zip || '').trim()) && /\p{L}{2}/u.test(a.city || '') ? 'ok' : 'bad';
    }
    if (kind === 'amount') { if (v == null || String(v).trim() === '') return 'empty'; const n = toAmount(v); return n > 0 && n < 1e6 ? 'ok' : 'bad'; }
    const s = String(v ?? '').trim();
    if (!s) return 'empty';
    if (kind === 'phone') {
      const all = s.replace(/\(0\)/, '').replace(/\D/g, '');
      if (/^\s*(?:\+|00)(?!32)/.test(s)) return all.length >= 9 && all.length <= 15 ? 'ok' : 'bad';  // numéro étranger : longueur plausible
      const d = all.replace(/^0032/, '').replace(/^32/, '').replace(/^0/, '');
      return (d.length === 9 && d[0] === '4') || (d.length === 8 && d[0] !== '4') ? 'ok' : 'bad';
    }
    if (kind === 'email') return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s) ? 'ok' : 'bad';
    if (kind === 'handle') return /^@?[A-Za-z0-9._]{1,30}$/.test(s) ? 'ok' : 'bad';
    return /\p{L}{2}/u.test(s) ? 'ok' : 'bad';
  }

  /* ---------- Écrire au client depuis le téléphone ---------- */
  // Liens d'ouverture : le texte est encodé, rien n'est envoyé sans que l'utilisateur appuie sur « Envoyer » dans l'app choisie.
  function contactLinks(c, text) {
    const enc = encodeURIComponent(String(text || ''));
    let d = String(c.phone || '').replace(/\D/g, '').replace(/^00/, '');
    if (d.startsWith('0')) d = `32${d.slice(1)}`;
    const phoneOk = /^\d{9,15}$/.test(d);
    const handle = String(c.handle || '').replace(/^@/, '');
    const handleOk = /^[A-Za-z0-9._]{1,30}$/.test(handle);
    const emailOk = /^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(c.email || ''));  // rien qui puisse ajouter un destinataire caché
    return {
      whatsapp: phoneOk ? `https://wa.me/${d}?text=${enc}` : null,
      sms: phoneOk ? `sms:+${d}?&body=${enc}` : null,  // « ?&body= » est compris par Android et par iOS
      instagram: handleOk ? `https://ig.me/m/${handle}` : null,  // Instagram ne pré-remplit pas le message : il est copié avant
      email: emailOk ? `mailto:${c.email}?body=${enc}` : null,
    };
  }
  // Messages prêts : un champ manquant ne laisse jamais de trou (« le  entre  au »), la phrase concernée disparaît.
  const MESSAGES = {
    fr: {
      b2c: d => `Bonjour ${d.name}, merci pour votre achat : ${d.item}, ${d.price}.\nPaiement par virement : ${d.iban}, communication ${d.ogm}.${d.date && d.address ? `\nLivraison le ${d.date}${d.slot ? ` ${d.slot}` : ''} au ${d.address}.` : ''}\n${d.shop}`,
      b2b: d => `Bonjour, la facture ${d.no} (${d.item}, ${d.price}) vous est envoyée par Peppol. Paiement à 30 jours, communication ${d.ogm}. Merci ! ${d.shop}`,
      c2c: d => `Bonjour ${d.name}, c'est d'accord pour ${d.item} à ${d.price}. Retrait à convenir. Vente entre particuliers.`,
      deposit: d => `Bonjour ${d.name}, pour réserver ${d.item}, un acompte de ${d.amount || d.price} suffit : virement ${d.iban}, communication ${d.ogm}. ${d.shop}`,
      delivery: d => `Bonjour ${d.name}, la livraison de ${d.item} est prévue${d.date ? ` le ${d.date}` : ''}${d.slot ? ` entre ${d.slot}` : ''}${d.address ? ` au ${d.address}` : ''}. Pouvez-vous confirmer ? ${d.shop}`,
      address: d => `Bonjour ${d.name}, pouvez-vous m'envoyer votre adresse complète (rue, numéro, code postal, commune) et un numéro de téléphone pour la livraison ? Merci !`,
    },
    nl: {
      b2c: d => `Dag ${d.name}, bedankt voor uw aankoop: ${d.item}, ${d.price}.\nBetaling per overschrijving: ${d.iban}, mededeling ${d.ogm}.${d.date && d.address ? `\nLevering op ${d.date}${d.slot ? ` ${d.slot}` : ''} op ${d.address}.` : ''}\n${d.shop}`,
      b2b: d => `Dag, factuur ${d.no} (${d.item}, ${d.price}) wordt u via Peppol bezorgd. Betaling binnen 30 dagen, mededeling ${d.ogm}. Bedankt! ${d.shop}`,
      c2c: d => `Dag ${d.name}, akkoord voor ${d.item} aan ${d.price}. Afhalen in onderling overleg. Verkoop tussen particulieren.`,
      deposit: d => `Dag ${d.name}, om ${d.item} te reserveren volstaat een voorschot van ${d.amount || d.price}: overschrijving ${d.iban}, mededeling ${d.ogm}. ${d.shop}`,
      delivery: d => `Dag ${d.name}, de levering van ${d.item} is gepland${d.date ? ` op ${d.date}` : ''}${d.slot ? ` tussen ${d.slot}` : ''}${d.address ? ` op ${d.address}` : ''}. Kunt u bevestigen? ${d.shop}`,
      address: d => `Dag ${d.name}, kunt u mij uw volledige adres (straat, nummer, postcode, gemeente) en een telefoonnummer voor de levering sturen? Bedankt!`,
    },
  };
  const MSG_FIELDS = ['name', 'item', 'price', 'amount', 'ogm', 'iban', 'shop', 'date', 'slot', 'address', 'no'];
  const message = (kind, d, lang) => {
    const safe = Object.fromEntries(MSG_FIELDS.map(k => [k, d?.[k] == null ? '' : String(d[k]).trim()]));
    return (MESSAGES[lang] || MESSAGES.fr)[kind](safe).replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?])/g, '$1').trim();
  };

  /* ---------- Message de livraison (« samedi entre 14h et 16h, nouvelle adresse… ») → date, créneau, adresse ---------- */
  const DAYS = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
    zondag: 0, maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6 };
  const MONTHS = { janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12,
    januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12 };
  const iso = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
  function parseDelivery(text, today) {
    const t = String(text || '').toLowerCase();
    const base = new Date(`${today}T12:00:00Z`);
    const plus = n => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
    // une date passée de cette année (« le 12/01 » en octobre) désigne l'année suivante ; une année explicite dans le passé est ignorée
    const ymd = (day, month, year) => {
      if (!(day >= 1 && day <= 31 && month >= 1 && month <= 12)) return null;
      const y = year ? (year < 100 ? 2000 + year : year) : base.getUTCFullYear();
      let d = new Date(Date.UTC(y, month - 1, day, 12));
      if (d.getUTCMonth() !== month - 1) return null;
      if (iso(d) < today) { if (year) return null; d = new Date(Date.UTC(y + 1, month - 1, day, 12)); }
      return iso(d);
    };
    // « 3/4 places », « 2-3 personnes », « 3.10 € » ou un morceau de numéro de téléphone ne sont pas des dates
    const numericDate = () => {
      for (const m of t.matchAll(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/g)) {
        const before = t.slice(Math.max(0, m.index - 1), m.index), after = t.slice(m.index + m[0].length);
        if (/[\d/.-]/.test(before) || /^[\d/.-]/.test(after)) continue;
        if (/^\s*(?:places?|pers|personnes?|personen|jours?|dagen|€|eur|euros?|cm|m\b|kg)/.test(after)) continue;
        const d = ymd(Number(m[1]), Number(m[2]), m[3] && Number(m[3]));
        if (d || m[3]) return d;
      }
      return null;
    };
    const named = t.match(new RegExp(`(?:^|[^\\d])(\\d{1,2})(?:er)?\\s+(${Object.keys(MONTHS).join('|')})(?![a-zà-ÿ])(?:\\s+(\\d{4}))?`));
    const days = [...t.matchAll(new RegExp(`(?:^|[^a-zà-ÿ])(${Object.keys(DAYS).join('|')})(?=$|[^a-zà-ÿ]|avond|namiddag|middag|ochtend|voormiddag)`, 'g'))];
    let date = null;
    if (/après-demain|apres-demain|overmorgen/.test(t)) date = plus(2);
    else if (/(?:^|[^a-zà-ÿ])demain(?![a-zà-ÿ])/.test(t) || /(?:^|[^a-zà-ÿ])morgen(?:ochtend|avond|namiddag|middag)?(?![a-zà-ÿ])/.test(t)) date = plus(1);
    else if (/aujourd['’]hui|vandaag|ce soir|ce matin|cet après-midi|cet apres-midi|vanavond|vanochtend|vanmiddag|vannamiddag/.test(t)) date = plus(0);
    else if (named) date = ymd(Number(named[1]), MONTHS[named[2]], named[3] && Number(named[3]));
    if (!date && !named) date = numericDate();
    if (!date && days.length) { const last = days[days.length - 1][1]; date = plus((DAYS[last] - base.getUTCDay() + 7) % 7 || 7); }  // « pas samedi, plutôt dimanche » : le dernier jour cité
    // heures : un « h », « u », « uur » qui n'est pas le début d'un mot (« uitschuifbare », « Uccle »), entre 7 h et 22 h
    const U = String.raw`(?:h|u|uur|:)(?![a-zà-ÿ])`;
    const H = String.raw`(\d{1,2})\s*${U}\s*(\d{2})?`;
    const ok = (hh, mm) => hh >= 7 && hh <= 22 && (!mm || Number(mm) < 60);
    let slot = null;
    const range = t.match(new RegExp(String.raw`(?:entre|tussen|de|van|from)\s+(\d{1,2})(?:\s*${U}\s*(\d{2})?)?\s*(?:et|en|à|a|-|–|tot|and)\s*${H}`))
      || t.match(new RegExp(String.raw`${H}\s*(?:-|–|à|a|tot|et|en|>)\s*${H}`));
    if (range) {
      const [h1, m1, h2, m2] = [Number(range[1]), range[2], Number(range[3]), range[4]];
      if (ok(h1, m1) && h2 <= 23 && h2 * 60 + Number(m2 || 0) > h1 * 60 + Number(m1 || 0)) slot = `${hhmm(h1, m1)}–${hhmm(h2, m2)}`;
    }
    if (!slot && !range) {
      const single = t.match(new RegExp(String.raw`(?:vers|à|a|om|rond|pour|tegen)\s+${H}`)) || t.match(new RegExp(String.raw`(?:^|[^\d])${H}`));
      if (single && ok(Number(single[1]), single[2])) { const hh = Number(single[1]); slot = `${hhmm(hh, single[2])}–${hhmm(hh + 2, single[2])}`; }
    }
    if (!slot && !range) {
      if (/après-midi|apres-midi|namiddag|vanmiddag/.test(t)) slot = '13:00–17:00';
      else if (/(?:^|[^a-zà-ÿ])matin(?![a-zà-ÿ])|ochtend|voormiddag/.test(t)) slot = '09:00–12:00';
      else if (/(?:^|[^a-zà-ÿ])soir(?![a-zà-ÿ])|avond/.test(t)) slot = '18:00–21:00';
    }
    const address = parseContact(text).addresses[0] || null;
    return { date, slot, address };
  }

  return { CASH_LIMIT, MENTION, PRIVATE, fromSpeech, checkField, toAmount, parseDelivery, matchCustomer, agreedPrice, contactLinks, message, round2, marginVat, regimeOf, consignment, saleTax, quarterOf, quarterGrids, cashCheck, missingFields,
    structuredComm, validBce, paidAmount, promisedAmount, parseCaption, parseContact, money, date, listingText, peppolUbl, matchPayment, STATE };
});
