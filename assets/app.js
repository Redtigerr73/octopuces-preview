/* Démo « Etiket » pour OctoPuces : application d'une page, sans serveur. Tout le texte passe par textContent ; l'état vit dans localStorage.
   Connexion factice (sessionStorage) : aucune donnée réelle n'est protégée par le mot de passe de démonstration. */
(() => {
  'use strict';
  const E = window.Engine, IC = window.ICONS;
  const KEY = 'etiket-octo-v1';
  const PREFS = 'etiket-prefs-v1';
  const SESSION = 'etiket-session';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };
  const session = {
    on() { try { return sessionStorage.getItem(SESSION) === '1'; } catch { return window.__etiketSession === true; } },
    set(v) { try { if (v) sessionStorage.setItem(SESSION, '1'); else sessionStorage.removeItem(SESSION); } catch { window.__etiketSession = v; } },
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  const fresh = () => Object.assign(clone(window.SEED), { timings: [], nextNo: 112, nextPrivNo: 203, counters: { F: 66, B: 2, NC: 1 } });
  let S = store.get(KEY, null) || fresh();
  for (const post of S.igPosts || []) if (window.SEED.igPosts.find(x => x.code === post.code)?.gone) post.gone = true;
  const P = Object.assign({ lang: 'fr', theme: 'entrepot', guide: true, costs: false }, store.get(PREFS, {}));  // guide et costs : propres à cet appareil
  let storageWarned = false;
  const save = () => { if (!store.set(KEY, S) && !storageWarned) { storageWarned = true; toast(P.lang === 'nl' ? 'Opslag niet beschikbaar of vol: wijzigingen blijven niet bewaard.' : 'Stockage indisponible ou plein : les changements ne seront pas conservés.'); } };
  const savePrefs = () => store.set(PREFS, P);
  const L = () => window.I18N[P.lang];
  const TODAY = S.today;

  /* ---------- DOM ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function svg(d, cls, box) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', box); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p);
    return s;
  }
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));
  const icon = n => svg(IC.ui[n] || IC.ui.more, 'ic', '0 0 24 24');
  const drawing = cat => svg(IC.furniture[cat] || IC.furniture.other, 'f', '0 0 120 90');
  const link = (href, attrs, ...kids) => h('a', Object.assign({ href }, attrs), ...kids);
  const ext = (href, ...kids) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'btn small' }, ...kids, icon('external'));
  const btn = (text, onclick, cls = '', ic) => h('button', { type: 'button', class: `btn ${cls}`, onclick }, ic ? icon(ic) : null, text);

  /* ---------- Données ---------- */
  const piece = id => S.pieces.find(p => p.id === id);
  const sale = id => S.sales.find(s => s.id === id);
  const customer = id => S.customers.find(c => c.id === id);
  const depositor = id => S.depositors.find(d => d.id === id);
  const title = p => (p.title && (p.title[P.lang] || p.title.fr || p.title.en)) || (P.lang === 'nl' ? 'Zonder titel' : 'Sans titre');
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const isPrivate = p => p?.scope === 'private';
  const paid = s => E.paidAmount(s.payments);
  const balance = s => (s.credit || s.cancelled ? 0 : E.round2(s.price - paid(s)));
  const ogmOf = s => (/^s\d+$/.test(s.id) ? E.structuredComm(2026000000 + Number(s.id.slice(1))) : '');
  function buyer(s) {
    const c = s.customer ? customer(s.customer) : null;
    return { c, type: c?.vat ? 'b2b' : 'b2c', vat: c?.vat, address: s.delivery?.address || c?.addresses?.[0],
      name: c?.name || (s.private ? L().broc.receipt : P.lang === 'nl' ? 'Particulier' : 'Client particulier') };
  }
  const openSales = () => S.sales.filter(s => balance(s) > 0).map(s => ({ id: s.id, balance: balance(s), customer: buyer(s).name.replace(/^@/, '').split(/[\s.]/)[0], ogm: ogmOf(s) }));
  // un virement peut solder la vente ou correspondre à un acompte promis : les deux sont proposés, la communication structurée en premier
  const matchables = () => S.sales.filter(s => !s.credit && !s.cancelled && !s.private).flatMap(s => {
    const who = buyer(s).name.replace(/^@/, '').split(/[\s.]/)[0];
    return [...(balance(s) > 0 ? [{ id: s.id, balance: balance(s), customer: who, ogm: ogmOf(s) }] : []),
      ...s.payments.filter(y => y.state === 'promised').map(y => ({ id: s.id, balance: y.amount, customer: who, ogm: ogmOf(s) }))];
  });
  // registres, grilles et CSV : uniquement l'activité ; une réservation n'y entre qu'une fois soldée ; une note de crédit y entre en négatif
  const saleRows = () => S.sales.filter(s => !s.reservation && !s.private).flatMap(s => s.pieces.map(id => ({ date: s.date, piece: piece(id), price: s.price / s.pieces.length, sale: s, private: false })));
  const money = E.money;
  const nowTime = () => new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
  const stamp = () => `${TODAY} ${new Date().toTimeString().slice(0, 5)}`;
  const pct = x => `${Math.round(x * 100)} %`;
  const pad4 = n => String(n).padStart(4, '0');
  const missingOf = p => (isPrivate(p) ? [] : E.missingFields({ title: p.title?.fr || p.title?.nl, photos: p.photos, price: p.price, origin: p.origin, dims: p.dims, purchase: p.purchase }));
  const CHANNELS = ['ig', 'fb', 'ad2', 'vinted', 'site'];
  const chLabel = c => (c === 'ig' ? 'Instagram' : L().ch[c]);
  const short = c => ({ ig: 'IG', fb: 'FB', ad2: P.lang === 'nl' ? '2dh' : '2m', vinted: 'V', site: 'Web' })[c];
  const createUrl = ch => ({ ig: 'https://www.instagram.com/', fb: 'https://www.facebook.com/marketplace/create/item',
    ad2: P.lang === 'nl' ? 'https://www.2dehands.be/plaats' : 'https://www.2ememain.be/plaats', vinted: 'https://www.vinted.be/items/new' })[ch];
  const HOSTS = { ig: /^(www\.)?instagram\.com$/, fb: /^(www\.|m\.|web\.)?facebook\.com$/, ad2: /^(www\.)?(2ememain|2dehands)\.be$/, vinted: /^(www\.)?vinted\.(be|fr|nl|com)$/ };
  function safeUrl(s, ch) {
    try { const u = new URL(String(s).trim()); return u.protocol === 'https:' && (ch ? HOSTS[ch].test(u.hostname) : Object.values(HOSTS).some(r => r.test(u.hostname))) ? u.href : null; } catch { return null; }
  }
  function channelOf(url) { const u = safeUrl(url); if (!u) return null; const host = new URL(u).hostname; return Object.keys(HOSTS).find(k => HOSTS[k].test(host)) || null; }
  const toRemove = () => S.pieces.flatMap(p => Object.entries(p.listings || {}).filter(([, l]) => l.state === 'to-remove').map(([ch, l]) => ({ p, ch, l })));
  const unmatched = () => S.feed.filter(f => !f.saleId && !f.payout);
  const duePayouts = () => S.payouts.filter(o => o.state === 'due');
  const promised = () => S.sales.filter(s => !s.cancelled).flatMap(s => s.payments.filter(y => y.state === 'promised').map(y => ({ s, y })));
  const newPosts = () => S.igPosts.filter(x => !x.imported);
  const deliveries = () => S.sales.filter(s => s.delivery?.mode === 'delivery' && !s.credit);
  const privateDue = () => S.sales.filter(s => s.private && !s.givenBack);
  function nextNumber(kind) {
    const n = S.counters[kind]++;
    return kind === 'F' ? { id: `s${n}`, no: `F-2026-${pad4(n)}` } : kind === 'B' ? { id: `b${n}`, no: `B-${pad4(n)}` } : { id: `nc${n}`, no: `NC-2026-${pad4(n)}` };
  }
  const fmtAddr = a => (a ? `${a.street}, ${a.zip} ${a.city}`.replace(/^, /, '') : '—');
  const addrKey = a => fmtAddr(a).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const sameAddr = (a, b) => addrKey(a) === addrKey(b);
  const fullAddr = a => !!(a && a.street && /^\d{4}$/.test(String(a.zip).trim()) && a.city);
  const inFreeZone = a => !!a && /^1\d{3}$/.test(a.zip);  // codes postaux 1000–1999 : Bruxelles et Brabant (zone indicative de la démo)

  /* ---------- Briques d'interface ---------- */
  function photoEl(p, cls = '') {
    const box = h('div', { class: `ph ${cls}`, style: `background: var(--ph${(p.tone ?? p.no) % 8})` });
    const src = p.images?.[0] || (window.SEED.photosAvailable.includes(p.photo) ? p.photo : null);
    if (src) {
      const img = h('img', { src, alt: '', loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', () => { img.replaceWith(drawing(p.cat || 'other')); box.classList.add('drawn'); });
      box.append(img);
    } else if (!p.photos) { box.classList.add('empty'); box.append(drawing(p.cat || 'other'), h('span', { class: 'count', text: L().noPhoto })); return box; }
    else { box.append(drawing(p.cat || 'other')); box.classList.add('drawn'); }
    if (p.photos > 1) box.append(h('span', { class: 'count', text: L().photosN(p.photos) }));
    return box;
  }
  const hasPhoto = p => !!(p.images?.length || window.SEED.photosAvailable.includes(p.photo));
  // intégration officielle d'Instagram (iframe /embed/) : la photo reste chez Instagram, rien n'est copié
  function igEmbed(code, p) {
    if (!/^[A-Za-z0-9_-]{5,20}$/.test(code)) return null;
    const fig = h('figure', { class: 'ig-embed' });
    const load = () => fill(fig, h('iframe', { src: `https://www.instagram.com/p/${code}/embed/`, title: L().igx.embed, loading: 'lazy',
      sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox', referrerpolicy: 'strict-origin-when-cross-origin' }),
      h('figcaption', { class: 'note', text: L().igx.embedNote }));
    fill(fig, h('div', { class: 'card-ph' }, photoEl(p)), h('div', { class: 'ig-consent' }, btn(L().igx.load, load, 'small', 'instagram'), h('p', { class: 'note', text: L().igx.loadNote })));
    return fig;
  }
  // Lien vers Instagram, toujours présent : la publication si on la connaît, sinon le profil de la boutique
  const igProfile = () => `https://www.instagram.com/${S.shop.instagram}/`;
  // publication connue par son code (ou par la publication reçue) ; retirée d'Instagram (gone) : le profil
  const igPostUrl = c => { const code = typeof c === 'object' ? (c.gone ? '' : c.code) : c; return /^[A-Za-z0-9_-]{5,20}$/.test(code || '') ? `https://www.instagram.com/p/${code}/` : igProfile(); };
  const igHref = p => safeUrl(p.listings?.ig?.url || '', 'ig') || (p.ig ? igPostUrl(p.ig) : igProfile());
  const igLink = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'ig-link' }, icon('instagram'), h('span', { text }), icon('external'));
  const tagEl = (p, big) => {
    const l = L(), cost = P.costs && !isPrivate(p) && p.purchase != null;
    return h('div', { class: `${big ? 'tag big' : 'tag'}${isPrivate(p) ? ' private' : ''}${cost ? ' with-cost' : ''}` },
      h('span', { class: 'no' }, h('small', { text: 'N°' }), String(p.no)),
      p.price ? h('span', { class: 'price' }, h('small', { text: l.costs.sale }), money(p.price).replace(',00', '')) : null,
      cost ? h('span', { class: 'cost no-print', title: l.costs.only }, icon('eye'), `${l.costs.buy} ${money(p.purchase).replace(',00', '')}`,
        p.price ? h('b', { text: `${l.costs.margin} ${p.price - p.purchase >= 0 ? '+' : ''}${money(p.price - p.purchase).replace(',00', '')}` }) : null) : null);
  };
  // vue propriétaire : prix d'achat et marge sur les étiquettes, mémorisé sur cet appareil seulement
  const costToggle = () => btn(P.costs ? L().costs.hide : L().costs.show, () => { P.costs = !P.costs; savePrefs(); render(); toast(P.costs ? L().costs.shown : L().costs.hidden); },
    `cost-toggle${P.costs ? ' on' : ''}`, 'eye');
  const pill = (state, text) => h('span', { class: `pill ${state}`, text });
  function cardEl(p) {
    const miss = p.status === 'draft' ? missingOf(p) : [];
    const chs = CHANNELS.filter(c => p.listings?.[c] && p.listings[c].state !== 'removed');
    return link(`#/piece/${p.id}`, { class: 'card' }, h('div', { class: 'card-ph' }, tagEl(p), photoEl(p)),
      h('span', { class: 't', text: title(p) }),
      h('span', { class: 'meta' }, pill(p.status, L().status[p.status]), isPrivate(p) ? h('span', { class: 'fam', text: p.owner }) : h('span', { text: L().inStock(daysBetween(p.bought, TODAY)) })),
      miss.length ? h('span', { class: 'miss', text: L().missingList(miss.map(m => L().missing[m]).join(', ')) }) : null,
      chs.length ? h('span', { class: 'chs' }, chs.map(c => h('span', { class: `ch-dot ${p.listings[c].state}`, title: chLabel(c), text: short(c) }))) : null);
  }
  const panel = (titleText, extra, ...kids) => h('section', { class: 'panel' }, titleText ? h('div', { class: 'panel-title' }, h('h2', { text: titleText }), extra) : null, ...kids);
  function head(t, sub, ...actions) {
    return h('div', { class: 'page-head' }, h('div', {}, h('h1', { tabindex: '-1', text: t }), sub ? h('p', { class: 'muted', text: sub }) : null),
      actions.filter(Boolean).length ? h('div', { class: 'row' }, actions) : null);
  }
  const crumb = (href, text) => link(href, { class: 'crumb no-print' }, icon('back'), text);
  function chips(items, current, onPick) {
    return h('div', { class: 'chips', role: 'group' }, items.map(([k, label, n]) =>
      h('button', { type: 'button', 'aria-pressed': String(k === current), onclick: () => onPick(k) }, label, n != null ? h('span', { class: 'n', text: String(n) }) : null)));
  }
  function seg(items, current, onPick) {
    return h('div', { class: 'seg', role: 'group' }, items.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(k === current), onclick: () => onPick(k), text: label })));
  }
  function field(label, input, hint) {
    const id = `f${Math.random().toString(36).slice(2, 8)}`; input.id = id;
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), input, hint ? h('p', { class: 'hint', text: hint }) : null);
  }
  const radio = (name, k, label, onPick, checked, sub) => h('label', { class: 'choice' }, h('input', { type: 'radio', name, value: k, checked, onchange: () => onPick(k) }),
    h('span', { class: 'box' }), h('span', {}, h('b', { text: label }), sub ? h('small', { text: sub }) : null));
  const numIn = (value, on, cls = 'input money') => h('input', { class: cls, inputmode: 'decimal', value: value ?? '', oninput: e => {
    const v = parseFloat(String(e.target.value).replace(',', '.')); on(Number.isFinite(v) ? v : null); } });

  let toastTimer;
  function toast(text, actionLabel, action) {
    document.querySelector('.toast')?.remove();
    const el = h('div', { class: 'toast', role: 'status' }, icon('check'), h('span', { text }),
      actionLabel ? h('button', { type: 'button', class: 'btn small', onclick: () => { action(); el.remove(); }, text: actionLabel }) : null);
    document.body.append(el);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 4200);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch { const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast(L().piece.copied);
  }
  function sheet(titleText, body, onClose) {
    const d = h('dialog', { class: 'sheet', 'aria-label': titleText });
    const close = () => d.close();
    d.append(h('div', { class: 'sheet-in' }, h('div', { class: 'sheet-head' }, h('h2', { text: titleText }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': P.lang === 'nl' ? 'Sluiten' : 'Fermer', onclick: close }, icon('close'))), typeof body === 'function' ? body(close) : body));
    d.addEventListener('close', () => { d.remove(); onClose?.(); });
    d.addEventListener('click', e => { if (e.target === d) close(); });
    document.body.append(d); d.showModal();
    return d;
  }
  const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };
  function shrink(file, max = 900) {
    return new Promise(res => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = h('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) });
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => { URL.revokeObjectURL(url); res(null); };
      img.src = url;
    });
  }

  /* ---------- Connexion (factice, pour la présentation) ---------- */
  function viewLogin() {
    const l = L();
    const email = h('input', { class: 'input', type: 'email', autocomplete: 'username', name: 'email' });
    const pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', name: 'password' });
    const err = h('p', { class: 'alert bad', hidden: true, role: 'alert' }, icon('alert'), l.login.bad);
    const submit = e => {
      e.preventDefault();
      if (email.value.trim().toLowerCase() === S.login.email && pass.value === S.login.password) {
        session.set(true); location.hash = '#/'; render();
        maybeStartGuide(450);
      }
      else { err.hidden = false; pass.focus(); }
    };
    const langBtn = h('div', { class: 'lang', role: 'group', 'aria-label': 'Langue / Taal' },
      ['fr', 'nl'].map(k => h('button', { type: 'button', 'aria-pressed': String(P.lang === k), onclick: () => { P.lang = k; savePrefs(); render(); }, text: k.toUpperCase() })));
    const cover = h('div', { class: 'login-cover' }, photoEl({ photo: 'assets/photos/octo-01.jpg', cat: 'sideboard', tone: 0, photos: 1 }),
      h('div', { class: 'login-cover-text' }, h('span', { class: 'brand-mark', text: 'E' }), h('p', { text: `${S.shop.name}, ${S.shop.city[P.lang]}` })));
    return h('div', { class: 'login' }, cover,
      h('div', { class: 'login-form' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', { class: 'brand-name', text: 'Etiket' }), langBtn),
        h('h1', { tabindex: '-1', text: l.login.title }), h('p', { class: 'muted', text: l.login.welcome }),
        h('form', { class: 'stack', onsubmit: submit }, field(l.login.email, email), field(l.login.password, pass), err,
          h('button', { type: 'submit', class: 'btn primary big block', text: l.login.submit }),
          h('button', { type: 'button', class: 'btn big block', onclick: () => { email.value = S.login.email; pass.value = S.login.password; err.hidden = true; } }, icon('check'), l.login.autofill)),
        h('p', { class: 'note', text: l.login.note })));
  }

  /* ---------- Coque ---------- */
  const NAV = [['home', '#/', 'home'], ['scan', '#/scan', 'scan'], ['stock', '#/stock', 'stock'], ['listings', '#/listings', 'listings'], ['sales', '#/sales', 'sales'],
    ['deliveries', '#/deliveries', 'truck'], ['customers', '#/customers', 'user'], ['payments', '#/payments', 'payments'], ['accounting', '#/accounting', 'accounting'],
    ['consign', '#/consign', 'consign'], ['brocante', '#/brocante', 'tent'], ['guide', '#/guide', 'guide'], ['settings', '#/settings', 'settings']];
  function counts() {
    return { stock: S.pieces.filter(p => p.status === 'draft').length, listings: toRemove().length + newPosts().length, payments: unmatched().length + promised().length,
      consign: duePayouts().length, accounting: S.inbox.filter(i => i.state === 'new').length, deliveries: deliveries().filter(s => s.delivery.status === 'failed').length,
      brocante: privateDue().length };
  }
  function shell(section, content) {
    const l = L(), c = counts();
    const cur = k => (k === section ? 'page' : null);
    const langBtn = h('div', { class: 'lang', role: 'group', 'aria-label': 'Langue / Taal' },
      ['fr', 'nl'].map(k => h('button', { type: 'button', 'aria-pressed': String(P.lang === k), onclick: () => { P.lang = k; savePrefs(); render(); }, text: k.toUpperCase() })));
    const brand = () => link('#/', { class: 'brand' }, h('span', { class: 'brand-mark', text: 'E' }),
      h('span', { class: 'brand-name' }, 'Etiket', h('span', { class: 'brand-shop', text: `${S.shop.name}, ${S.shop.city[P.lang]}` })));
    const side = h('aside', { class: 'side' }, brand(),
      link('#/add', { class: 'btn tagged big add-big' }, icon('plus'), l.nav.add),
      h('nav', { 'aria-label': 'Navigation' }, NAV.map(([k, href, ic]) => link(href, { 'aria-current': cur(k) }, icon(ic), h('span', { text: l.nav[k] }),
        c[k] ? h('span', { class: 'count', text: String(c[k]) }) : null))),
      h('p', { class: 'foot', text: l.settings.about }));
    const search = h('form', { class: 'searchbox', role: 'search', onsubmit: e => { e.preventDefault(); go(`#/stock?q=${encodeURIComponent(e.target.q.value)}`); } },
      icon('search'), h('input', { name: 'q', type: 'search', placeholder: l.search, 'aria-label': l.search }));
    const top = h('header', { class: 'top' }, brand(), search, h('span', { class: 'grow' }),
      link('#/stock?focus=1', { class: 'icon-btn search-btn', 'aria-label': l.search }, icon('search')),
      P.guide ? h('button', { type: 'button', class: 'guide-top no-print', 'aria-label': l.full.fab, onclick: () => startTour('page') }, icon('guide'), h('span', { text: l.full.fabShort })) : null, langBtn);
    const MOBILE = ['home', 'stock', 'add', 'sales', 'scan'];
    const more = () => sheet(l.nav.more, h('nav', { class: 'menu' }, NAV.filter(([k]) => !MOBILE.includes(k)).map(([k, href, ic]) =>
      link(href, { onclick: () => document.querySelector('dialog')?.close() }, icon(ic), l.nav[k], c[k] ? h('span', { class: 'count', text: String(c[k]) }) : null))));
    const bottom = h('nav', { class: 'bottom', 'aria-label': 'Navigation' },
      link('#/', { 'aria-current': cur('home') }, icon('home'), h('span', { text: l.nav.home })),
      link('#/stock', { 'aria-current': cur('stock') }, icon('stock'), h('span', { text: l.nav.stock })),
      h('button', { type: 'button', class: 'add-tab', 'aria-current': cur('add'), 'aria-haspopup': 'dialog', onclick: () => sheet(l.quick.title, h('nav', { class: 'menu quick' },
        [['#/add', 'camera', l.quick.add], ['#/scan', 'scan', l.quick.scan], ['#/stock?f=live', 'sales', l.quick.sell], ['#/brocante?add=1', 'tent', l.quick.family]].map(([href, ic, text]) =>
          link(href, { onclick: () => document.querySelector('dialog')?.close() }, icon(ic), h('span', { text })))) ) }, h('span', { class: 'plus' }, icon('plus')), h('span', { text: l.nav.add })),
      link('#/sales', { 'aria-current': cur('sales') }, icon('sales'), h('span', { text: l.nav.sales })),
      h('button', { type: 'button', 'aria-current': MOBILE.includes(section) ? null : 'page', onclick: more }, icon('more'), h('span', { text: l.nav.more }),
        Object.entries(c).some(([k, v]) => v && !MOBILE.includes(k)) ? h('span', { class: 'dot', 'aria-hidden': 'true' }) : null));
    const fab = P.guide ? h('button', { type: 'button', class: 'guide-fab no-print', onclick: () => startTour('page') }, icon('guide'), h('span', { text: l.full.fab })) : null;
    return h('div', { class: `shell${P.guide ? ' has-guide' : ''}` }, side, h('div', { class: 'col' }, top, h('p', { class: 'demo-banner', text: l.demoBanner }), h('main', { id: 'main' }, content)), bottom, fab);
  }

  /* ---------- Accueil ---------- */
  function viewHome() {
    const l = L(), d = new Date(TODAY + 'T12:00:00');
    const todayText = `${l.days[d.getDay()]} ${d.getDate()} ${l.months[d.getMonth()]} ${d.getFullYear()}`;
    const drafts = S.pieces.filter(p => p.status === 'draft');
    const soon = deliveries().filter(s => s.delivery.status === 'planned' && daysBetween(TODAY, s.delivery.date) <= 2);
    const failed = deliveries().filter(s => s.delivery.status === 'failed');
    const refunds = S.refunds.filter(r => r.state === 'due');
    const items = [
      failed.length && ['#/deliveries', 'alert', `${failed.length} ${l.deliv.failed.toLowerCase()} : ${failed.map(s => buyer(s).name).join(', ')}`, 'bad'],
      soon.length && ['#/deliveries', 'truck', `${soon.length} ${l.deliv.title.toLowerCase()} — ${soon.map(s => `${E.date(s.delivery.date)} ${s.delivery.slot || ''}`).join(', ')}`],
      newPosts().length && ['#/listings', 'instagram', `${newPosts().length} ${l.ig.newPosts.toLowerCase()} (Instagram)`],
      promised().length && ['#/payments', 'clock', `${promised().length} ${l.dep.list.toLowerCase()}`],
      drafts.length && ['#/stock?f=draft', 'camera', l.todoDrafts(drafts.length)],
      toRemove().length && ['#/listings', 'listings', l.todoRemove(toRemove().length)],
      unmatched().length && ['#/payments?f=match', 'payments', l.todoMatch(unmatched().length)],
      refunds.length && ['#/payments', 'payments', `${l.cancel.refunds} : ${money(refunds.reduce((t, r) => t + r.amount, 0))}`, 'bad'],
      duePayouts().length && ['#/consign', 'consign', l.todoPayouts(duePayouts().length, money(duePayouts().reduce((t, o) => t + o.amount, 0)))],
      privateDue().length && ['#/brocante', 'tent', `${l.broc.toGive} : ${money(privateDue().reduce((t, s) => t + paid(s), 0))}`],
      S.inbox.some(i => i.state === 'new') && ['#/accounting', 'peppol', l.todoInbox(S.inbox.filter(i => i.state === 'new').length)],
    ].filter(Boolean);
    const month = TODAY.slice(0, 7);
    const monthSales = S.sales.filter(s => s.date.startsWith(month) && !s.private && !s.credit && !s.cancelled);
    const cashed = S.feed.filter(f => f.date.startsWith(month) && f.amount > 0 && !f.private).reduce((t, f) => t + f.amount, 0);
    const vat = E.quarterGrids(saleRows(), E.quarterOf(TODAY)).g54;
    const onSale = S.pieces.filter(p => !isPrivate(p) && (p.status === 'live' || p.status === 'reserved'));
    const t = S.timings.slice().sort((a, b) => a - b);
    const median = t.length ? t[Math.floor((t.length - 1) / 2)] : 0;
    const fmtS = s => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;
    return [
      head(l.hello(S.shop.owner), todayText, link('#/add', { class: 'btn tagged big' }, icon('plus'), l.nav.add)),
      S.guideSeen ? null : h('div', { class: 'guide-banner' }, icon('guide'), h('span', { text: l.guide.banner }),
        h('span', { class: 'row' }, btn(l.tour.launch, () => startTour('full', 0), 'small primary', 'guide'), link('#/guide', { class: 'btn small' }, l.guide.see), btn(l.guide.hide, () => { S.guideSeen = true; save(); render(); }, 'small'))),
      h('div', { class: 'figures' },
        h('div', { class: 'fig' }, h('span', { class: 'lbl', text: l.kSales }), h('b', { text: money(monthSales.reduce((x, s) => x + s.price, 0)) }), h('span', { text: l.kSalesN(monthSales.length) })),
        h('div', { class: 'fig' }, h('span', { class: 'lbl', text: l.kCashed }), h('b', { text: money(cashed) }), h('span', { text: P.lang === 'nl' ? 'Mollie, bank, kassa' : 'Mollie, banque, caisse' })),
        h('div', { class: 'fig' }, h('span', { class: 'lbl', text: l.kVat }), h('b', { text: money(vat) }), h('span', { text: l.kVatHint })),
        h('div', { class: 'fig' }, h('span', { class: 'lbl', text: l.kStock }), h('b', { text: money(onSale.reduce((x, p) => x + (p.price || 0), 0)) }), h('span', { text: l.kStockHint(onSale.length) }))),
      h('div', { class: 'home' },
        panel(l.todo, null, items.length ? h('ul', { class: 'todo' }, items.map(([href, ic, text, tone]) => h('li', { class: tone || '' }, link(href, {}, icon(ic), h('span', { text }), h('span', { class: 'go', 'aria-hidden': 'true' }, '›')))))
          : h('p', { class: 'muted', text: l.todoNone })),
        panel(l.recent, link('#/stock', { text: l.seeAll }), h('div', { class: 'hscroll' }, S.pieces.filter(p => !isPrivate(p)).sort((a, b) => b.bought.localeCompare(a.bought) || b.no - a.no).slice(0, 8).map(cardEl)))),
      panel(l.e0, null, h('p', { class: 'row' }, icon('clock'), h('span', { text: l.e0Text(t.length ? fmtS(median) : '', t.length) })))
    ];
  }

  /* ---------- Stock ---------- */
  function viewStock(q) {
    const l = L(), f = q.get('f') || 'all', sort = q.get('s') || 'new', term = (q.get('q') || '').trim().toLowerCase();
    const match = { all: p => !isPrivate(p), draft: p => p.status === 'draft', live: p => !isPrivate(p) && p.status === 'live', reserved: p => p.status === 'reserved',
      sold: p => !isPrivate(p) && p.status === 'sold', depot: p => p.origin === 'depot' && p.status !== 'sold', private: isPrivate };
    const labels = Object.assign({}, l.filters, { private: l.nav.brocante });
    const nav = (k, v) => { const n = new URLSearchParams(q); n.set(k, v); n.delete('focus'); go(`#/stock?${n}`); };
    let list = S.pieces.filter(match[f] || match.all);
    if (term) list = S.pieces.filter(p => [p.no, p.title?.fr, p.title?.nl, p.title?.en, p.notes?.fr, l.cat[p.cat], p.owner].join(' ').toLowerCase().includes(term));
    list.sort(sort === 'old' ? (a, b) => a.bought.localeCompare(b.bought) : sort === 'price' ? (a, b) => (b.price || 0) - (a.price || 0) : (a, b) => b.bought.localeCompare(a.bought) || b.no - a.no);
    const searchIn = h('input', { class: 'input', type: 'search', placeholder: l.search, 'aria-label': l.search, value: q.get('q') || '', onchange: e => nav('q', e.target.value) });
    if (q.get('focus')) setTimeout(() => searchIn.focus(), 0);
    return [
      head(l.nav.stock, `${S.pieces.filter(p => !isPrivate(p)).length} ${P.lang === 'nl' ? 'stukken' : 'pièces'}`, costToggle(), link('#/add', { class: 'btn tagged' }, icon('plus'), l.nav.add)),
      h('div', { class: 'row toolbar' }, h('div', { style: 'flex:1;min-width:200px' }, searchIn),
        h('label', { class: 'row' }, h('span', { class: 'sr', text: l.sort }),
          h('select', { class: 'input', style: 'width:auto', onchange: e => nav('s', e.target.value) },
            [['new', l.sortNew], ['old', l.sortOld], ['price', l.sortPrice]].map(([k, t]) => h('option', { value: k, selected: k === sort, text: t }))))),
      chips(Object.keys(match).map(k => [k, labels[k], S.pieces.filter(match[k]).length]), f, k => nav('f', k)),
      list.length ? h('div', { class: 'cards' }, list.map(cardEl))
        : h('div', { class: 'stack empty-state' }, h('p', { text: l.empty }), link('#/add', { class: 'btn tagged' }, icon('plus'), l.emptyAdd)),
    ];
  }

  /* ---------- Fiche pièce ---------- */
  const fullListing = (p, lang) => { const x = E.listingText({ ...p, price: p.price || 0 }, lang, S.shop.city[lang]); return `${x.title}\n\n${x.body}${isPrivate(p) ? '' : `\n\n${S.shop.delivery[lang]}.`}`; };
  function listingRows(p) {
    const l = L();
    return CHANNELS.filter(ch => !(isPrivate(p) && ch === 'site')).map(ch => {
      const lst = p.listings?.[ch];
      const st = lst?.state || 'none';
      let acts = [];
      if (ch === 'site') acts = st === 'none' ? [] : [h('span', { class: 'muted', text: l.lstSite })];
      else if (ch === 'ig' && !isPrivate(p) && (st === 'none' || st === 'draft')) acts = [btn(l.ig.publish, () => { p.listings.ig = { state: 'live', url: `https://www.instagram.com/${S.shop.instagram}/` }; save(); render(); toast(l.ig.published); }, 'small primary', 'instagram'),
        igLink(igProfile(), l.igx.seeProfile(S.shop.instagram))];
      else if (st === 'none' || st === 'draft') acts = [btn(l.piece.copy, () => copy(fullListing(p, P.lang)), 'small', 'copy'), ext(createUrl(ch), l.lstOpen), btn(l.lstDone, () => published(p, ch), 'small primary', 'check')];
      else if (st === 'live' && lst.url) acts = [ext(lst.url, ch === 'ig' ? l.ig.open : l.lstSeen)];
      else if (st === 'to-remove') acts = [lst.url ? ext(lst.url, l.lstSeen) : null, btn(l.lstRemoved, () => { lst.state = 'removed'; save(); render(); toast(l.lstRemoved); }, 'small primary', 'check')];
      return h('div', { class: 'chan-row' }, h('span', { class: 'name', text: chLabel(ch) }), pill(st, l.lst[st]), acts.length ? h('div', { class: 'acts' }, acts) : null);
    });
  }
  function published(p, ch) {
    const l = L();
    sheet(chLabel(ch), close => {
      const input = h('input', { class: 'input', type: 'url', inputmode: 'url', placeholder: 'https://', 'aria-label': l.lstAddPrompt });
      const err = h('p', { class: 'alert bad', hidden: true, role: 'alert', text: l.lstBadUrl });
      return h('form', { class: 'stack', onsubmit: e => {
        e.preventDefault();
        const url = safeUrl(input.value, ch);
        if (!url) { err.hidden = false; input.focus(); return; }
        p.listings = p.listings || {}; p.listings[ch] = { state: 'live', url }; save(); close(); render(); toast(l.lst.live);
      } }, h('div', { class: 'field' }, h('label', { text: l.lstAddPrompt }), input), err, h('button', { class: 'btn primary big', type: 'submit', text: l.lstDone }));
    });
  }
  function viewPiece(id) {
    const l = L(), p = piece(id);
    if (!p) return [crumb('#/stock', l.piece.back), h('p', { text: l.empty })];
    let lang = P.lang;
    const priv = isPrivate(p);
    const dep = p.origin === 'depot' ? depositor(p.depositor) : null;
    const textBox = h('div', { class: 'textbox' });
    const fillText = () => { const x = E.listingText({ ...p, price: p.price || 0 }, lang, S.shop.city[lang]); fill(textBox, h('b', { text: x.title }), x.body, priv ? null : `\n\n${S.shop.delivery[lang]}.`); };
    fillText();
    const segBox = h('span', {});
    const paintSeg = () => fill(segBox, seg([['fr', 'FR'], ['nl', 'NL']], lang, k => { lang = k; fillText(); paintSeg(); }));
    paintSeg();
    const s = p.saleId ? sale(p.saleId) : null;
    const thumbs = Math.min(p.images?.length || p.photos || 0, 6);
    const history = [[p.bought, l.piece.bought(E.date(p.bought))]];
    if (p.source === 'ig') history.push([p.bought, P.lang === 'nl' ? 'Aangemaakt vanuit een Instagram-post' : 'Créée depuis une publication Instagram']);
    if (p.views) history.push([TODAY, l.piece.views(p.views, p.asks || 0)]);
    if (s) history.push([s.date, l.piece.soldOn(E.date(s.date))]);
    const facts = priv
      ? [[l.add.catL, l.cat[p.cat]], [l.scope.owner, p.owner], [l.piece.state, E.STATE[P.lang][p.state] || '—']]
      : [[l.add.catL, l.cat[p.cat]], [l.piece.dims, p.dims || '—'], [l.piece.state, E.STATE[P.lang][p.state] || '—'], [l.piece.origin, p.origin ? l.origin[p.origin] : '—'],
        dep ? [l.piece.depositor, `${dep.name} (${pct(p.commission)})`] : [l.piece.seller, p.seller?.name || '—']];
    return [
      crumb(priv ? '#/brocante' : '#/stock', priv ? l.nav.brocante : l.piece.back),
      h('div', { class: 'piece' },
        h('div', { class: 'gallery' }, !hasPhoto(p) && p.ig ? igEmbed(p.ig, p) : h('div', { class: 'card-ph' }, photoEl(p)),
          thumbs > 1 && (hasPhoto(p) || !p.ig) ? h('div', { class: 'thumbs' }, Array.from({ length: thumbs }, (_, i) => {
            const t = h('div', { class: 'ph drawn', style: `background: var(--ph${((p.tone || 0) + i) % 8})` });
            if (p.images?.[i]) t.append(h('img', { src: p.images[i], alt: '' })); else t.append(drawing(p.cat));
            return t;
          })) : null),
        h('div', { class: 'stack' },
          h('div', { class: 'piece-head' }, tagEl(p, true), h('h1', { tabindex: '-1', text: title(p) }),
            h('div', { class: 'row' }, pill(p.status, l.status[p.status]), priv ? pill('fam', l.scope.private) : h('span', { class: 'muted', text: l.inStock(daysBetween(p.bought, TODAY)) })),
            h('div', { class: 'row no-print' },
              p.status === 'draft' ? link(`#/add/${p.id}`, { class: 'btn tagged' }, icon('camera'), l.piece.edit) : null,
              ['live', 'reserved'].includes(p.status) && !s ? link(`#/sell/${p.id}`, { class: 'btn primary' }, icon('sales'), l.piece.sell) : null,
              ['live', 'reserved'].includes(p.status) && !s ? link(`#/sell/${p.id}?scan=1`, { class: 'btn tagged' }, icon('scan'), l.sellx.interested) : null,
              p.status === 'live' && !priv ? btn(l.piece.reserve, () => { p.status = 'reserved'; save(); render(); toast(l.status.reserved); }) : null,
              p.status === 'reserved' && !s ? btn(l.piece.unreserve, () => { p.status = 'live'; save(); render(); }) : null,
              s ? link(`#/sale/${s.id}`, { class: 'btn' }, icon('sales'), l.piece.seeSale) : null,
              btn(l.piece.printTag, () => window.print(), '', 'print'))),
          priv ? h('p', { class: 'alert' }, icon('tent'), l.broc.noInvoice) : null,
          h('dl', { class: 'facts' }, facts.map(([dt, dd]) => h('div', {}, h('dt', { text: dt }), h('dd', { text: dd })))),
          (prepareShare(p), null),
          panel(l.piece.channels, btn(l.sendx.shareListing, () => shareListing(p), 'small tagged', 'share'), priv ? h('p', { class: 'hint', style: 'margin-bottom:10px', text: l.famx.hint }) : null, h('div', { class: 'chan' }, listingRows(p))),
          panel(l.piece.listingText, segBox, textBox, h('div', { class: 'row', style: 'margin-top:10px' }, btn(l.piece.copy, () => copy(fullListing(p, lang)), '', 'copy'))),
          priv ? null : panel(l.piece.fiscal, null, p.price ? fiscalBlock(p, s ? Math.abs(s.price) : p.price) : h('p', { class: 'muted', text: l.missingList(l.missing.price) })),
          panel(l.piece.history, null, h('ol', { class: 'timeline' }, history.map(([d, t]) => h('li', {}, h('span', {}, h('time', { text: E.date(d) }), t)))))))
    ];
  }
  function fiscalBlock(p, price) {
    const l = L();
    if (p.origin !== 'depot' && !Number.isFinite(p.purchase)) return h('p', { class: 'muted', text: l.missingList(l.missing.purchase) });
    const x = E.saleTax(p, price), margin = x.regime === 'margin';
    const rows = margin
      ? [[p.origin === 'depot' ? l.piece.payout : l.piece.purchase, money(x.purchase)], [l.piece.margin, money(x.margin)], [l.piece.vat, money(x.vat)]]
      : [[l.piece.purchase, money(p.purchase || 0)], ['HTVA', money(x.base)], [l.piece.vat, money(x.vat)]];
    const keep = margin ? E.round2(Math.max(x.margin, 0) - x.vat) + Math.min(x.margin, 0) : E.round2(x.base - (p.purchase || 0));
    return h('div', {}, h('p', { class: 'row', style: 'margin-bottom:10px' }, h('b', { text: l.regime[x.regime] }), h('span', { class: 'muted', text: l.piece.ifSold(money(price)) })),
      h('dl', { class: 'calc' }, rows.map(([a, b]) => h('div', {}, h('dt', { text: a }), h('dd', { text: b }))),
        h('div', { class: 'total' }, h('dt', { text: l.piece.keep }), h('dd', { text: money(keep) }))),
      h('p', { class: 'note', text: margin ? l.piece.fiscalNote : l.piece.normalNote }));
  }

  /* ---------- Assistant d'ajout (brouillon enregistré à chaque frappe) ---------- */
  let chronoTimer;
  function viewAdd(id) {
    const l = L();
    if (!id) {
      const wip = S.wip && piece(S.wip);
      if (wip && wip.status === 'draft') { location.replace(`#/add/${wip.id}`); return []; }
      const no = S.nextNo++;
      const p = { id: `p${no}`, no, cat: 'other', status: 'draft', price: null, origin: null, bought: TODAY, photos: 0, images: [], tone: no % 8,
        title: { fr: '', nl: '' }, notes: { fr: '', nl: '' }, dims: '', state: 'good', listings: {}, entryMs: 0, step: 0 };
      S.pieces.push(p); S.wip = p.id; save();
      location.replace(`#/add/${p.id}`); return [];
    }
    const p = piece(id);
    if (!p) return viewStock(new URLSearchParams());
    if (p.status !== 'draft' || isPrivate(p)) { location.replace(`#/piece/${p.id}`); return []; }
    if (p.step == null) p.step = 0;
    p.images = p.images || []; p.listings = p.listings || {}; p.notes = p.notes || { fr: '', nl: '' }; p.title = p.title || { fr: '', nl: '' };
    p.entryMs = p.entryMs || 0;
    const saved = h('span', { text: l.add.saved(nowTime()) });
    const chrono = h('span', { class: 'chrono' }, icon('clock'), h('span', { text: '0:00' }));
    const fmt = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
    chrono.lastChild.textContent = fmt(p.entryMs);
    clearInterval(chronoTimer);
    chronoTimer = setInterval(() => {
      if (!location.hash.startsWith(`#/add/${p.id}`)) { clearInterval(chronoTimer); return; }
      if (document.visibilityState === 'visible' && !tour) { p.entryMs += 1000; chrono.lastChild.textContent = fmt(p.entryMs); if (p.entryMs % 5000 === 0) save(); }
    }, 1000);
    const preview = h('div', {});
    const touch = () => { save(); saved.textContent = l.add.saved(nowTime()); fill(preview, cardEl(p)); updateNav(); };
    const body = h('div', { class: 'stack' });
    const nav = h('div', { class: 'wiz-nav no-print' });
    const steps = h('ol', { class: 'steps', 'aria-label': l.add.title });
    function paint() {
      fill(steps, l.add.steps.map((s, i) => h('li', { class: i === p.step ? 'on' : i < p.step ? 'done' : '', 'aria-current': i === p.step ? 'step' : null, text: s })));
      fill(body, [stepPhotos, stepDesc, stepOrigin, stepPrice][p.step](p, touch, paint));
      fill(preview, cardEl(p));
      updateNav();
    }
    function updateNav() {
      const miss = missingOf(p);
      const finish = () => {
        p.status = 'live';
        for (const ch of CHANNELS) if (p.listings[ch] && p.listings[ch].state !== 'live') p.listings[ch].state = ch === 'site' ? 'live' : 'draft';
        S.timings.push(Math.round(p.entryMs / 1000)); delete S.wip; delete p.step; save();
        toast(l.add.done(p.no)); go(`#/piece/${p.id}`);
      };
      fill(nav,
        p.step > 0 ? h('button', { type: 'button', class: 'btn big', onclick: () => { p.step--; save(); paint(); window.scrollTo(0, 0); } }, icon('back'), l.add.prev) : null,
        p.step < 3 ? h('button', { type: 'button', class: 'btn primary big', onclick: () => { p.step++; save(); paint(); window.scrollTo(0, 0); } }, l.add.next)
          : h('button', { type: 'button', class: 'btn primary big', disabled: miss.length > 0, onclick: finish }, icon('check'), l.add.finish));
    }
    paint();
    const drop = () => sheet(l.add.discard, close => h('div', { class: 'row' },
      btn(l.add.discard, () => { S.pieces = S.pieces.filter(x => x.id !== p.id); delete S.wip; save(); close(); go('#/stock'); }, 'danger big', 'trash'),
      btn(l.add.keepDraft, close, 'big')));
    return [
      crumb('#/stock', l.nav.stock),
      head(`${l.add.title} n° ${p.no}`, null),
      h('div', { class: 'wizard' },
        h('div', { class: 'stack' }, steps, h('div', { class: 'savebar' }, saved, chrono), body,
          h('div', { class: 'row' }, btn(l.add.keepDraft, () => { delete S.wip; save(); toast(l.add.draftKept); go('#/stock?f=draft'); }, 'small'),
            btn(l.add.discard, drop, 'small danger', 'trash')), nav),
        h('aside', { class: 'stack wiz-aside' }, preview, h('p', { class: 'note', text: l.add.photoHint })))
    ];
  }
  const bindText = (obj, key, touch, extra) => e => { obj[key] = e.target.value; extra?.(); touch(); };
  function stepPhotos(p, touch, paint) {
    const l = L();
    const input = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr', id: 'photo-in', onchange: async e => {
      for (const f of [...e.target.files].slice(0, 8)) { const d = await shrink(f, 640); if (d) p.images.push(d); }
      p.photos = p.images.length; touch(); paint();
    } });
    return [
      h('label', { class: 'dropzone', for: 'photo-in' }, icon('camera'), l.add.takePhoto, h('span', { class: 'muted', style: 'font-weight:400', text: l.add.photoHint })), input,
      p.images.length ? h('div', { class: 'photo-grid' }, p.images.map((src, i) => h('div', { class: 'ph' }, h('img', { src, alt: `${i + 1}` }),
        h('button', { type: 'button', class: 'rm', 'aria-label': l.add.discard, onclick: () => { p.images.splice(i, 1); p.photos = p.images.length; touch(); paint(); } }, icon('close'))))) : null,
      !p.images.length && p.photo ? h('div', { class: 'photo-grid' }, h('div', { class: 'ph' }, photoEl(p))) : null,
    ];
  }
  function stepDesc(p, touch) {
    const l = L();
    return [h('div', { class: 'grid2' },
      field('Titre (FR)', h('input', { class: 'input', value: p.title.fr, placeholder: l.add.titleP, oninput: bindText(p.title, 'fr', touch), autocomplete: 'off' })),
      field('Titel (NL)', h('input', { class: 'input', value: p.title.nl, placeholder: l.add.titleNlP, oninput: bindText(p.title, 'nl', touch), autocomplete: 'off' }), l.add.autoNl)),
    h('div', { class: 'grid2' },
      field(l.add.catL, h('select', { class: 'input', onchange: bindText(p, 'cat', touch) }, Object.keys(l.cat).map(k => h('option', { value: k, selected: k === p.cat, text: l.cat[k] })))),
      field(l.add.stateL, h('select', { class: 'input', onchange: bindText(p, 'state', touch) }, Object.keys(E.STATE.fr).map(k => h('option', { value: k, selected: k === p.state, text: E.STATE[P.lang][k] }))))),
    field(l.add.dimsL, h('input', { class: 'input', value: p.dims, placeholder: l.add.dimsP, inputmode: 'text', oninput: bindText(p, 'dims', touch) })),
    h('div', { class: 'grid2' },
      field(`${l.add.notesL} (FR)`, h('textarea', { class: 'input', placeholder: l.add.notesP, oninput: bindText(p.notes, 'fr', touch) }, p.notes.fr)),
      field(`${l.add.notesL} (NL)`, h('textarea', { class: 'input', oninput: bindText(p.notes, 'nl', touch) }, p.notes.nl)))];
  }
  function stepOrigin(p, touch, paint) {
    const l = L();
    const choice = (k, sub) => radio('origin', k, l.origin[k], () => {
      p.origin = k; if (k === 'depot') { p.depositor = p.depositor || S.depositors[0].id; p.commission = depositor(p.depositor).commission; } touch(); paint();
    }, p.origin === k, sub);
    const out = [h('p', { class: 'lbl', text: l.add.originQ }), h('div', { class: 'choices cols' },
      choice('particulier', l.regime.margin), choice('depot', l.regime.margin), choice('revendeur-marge', l.regime.margin), choice('pro-21', l.regime.normal21), choice('pro-6', l.regime.normal6)),
      h('p', { class: 'hint', text: l.broc.rule })];
    if (p.origin === 'particulier') {
      p.seller = p.seller && p.seller.kind === 'particulier' ? p.seller : { name: '', addr: '', idNo: 'fictif', kind: 'particulier', how: 'cash' };
      p.seller.idNo = p.seller.idNo || 'fictif'; p.seller.how = p.seller.how || 'cash';
      const warn = h('p', { class: 'alert', hidden: !(p.seller.how === 'cash' && p.purchase > 3000) }, icon('alert'), l.add.cashBuy);
      const check = () => { warn.hidden = !(p.seller.how === 'cash' && p.purchase > 3000); };
      out.push(h('div', { class: 'sub-panel stack' }, h('h3', { text: l.piece.slip }),
        h('div', { class: 'grid2' }, field(l.add.sellerName, h('input', { class: 'input', value: p.seller.name || '', autocomplete: 'off', oninput: bindText(p.seller, 'name', touch) })),
          field(l.add.sellerId, h('input', { class: 'input', value: p.seller.idNo, oninput: bindText(p.seller, 'idNo', touch) }), l.add.sellerIdHint)),
        field(l.add.sellerAddr, h('input', { class: 'input', value: p.seller.addr || '', oninput: bindText(p.seller, 'addr', touch) })),
        h('div', { class: 'grid2' }, field(`${l.add.paid} (€)`, numIn(p.purchase, v => { p.purchase = v; check(); touch(); })),
          field(l.add.paidHow, h('select', { class: 'input', onchange: e => { p.seller.how = e.target.value; check(); touch(); } },
            ['cash', 'transfer'].map(k => h('option', { value: k, selected: p.seller.how === k, text: l.pay[k] }))))), warn,
        h('div', { class: 'field' }, h('span', { class: 'lbl', text: l.add.sign }), signature(p, touch), h('p', { class: 'hint', text: l.add.signHint }))));
    } else if (p.origin === 'depot') {
      out.push(h('div', { class: 'sub-panel stack' }, h('div', { class: 'grid2' },
        field(l.add.depositorL, h('select', { class: 'input', onchange: e => { p.depositor = e.target.value; p.commission = depositor(p.depositor).commission; touch(); paint(); } },
          S.depositors.map(d => h('option', { value: d.id, selected: d.id === p.depositor, text: d.name })))),
        field(`${l.add.commissionL} (%)`, h('input', { class: 'input money', inputmode: 'numeric', value: Math.round((p.commission || 0) * 100),
          oninput: e => { const v = parseFloat(e.target.value); p.commission = Number.isFinite(v) ? Math.min(Math.max(v, 0), 100) / 100 : 0; touch(); } })))));
    } else if (p.origin) {
      p.seller = p.seller && p.seller.kind === 'pro' ? p.seller : { name: '', kind: 'pro' };
      out.push(h('div', { class: 'sub-panel stack' }, h('div', { class: 'grid2' },
        field(l.add.invoiceL, h('input', { class: 'input', value: p.seller.name || '', oninput: bindText(p.seller, 'name', touch) })),
        field(`${l.add.paid} (€)`, numIn(p.purchase, v => { p.purchase = v; touch(); })))));
    }
    return out;
  }
  function signature(p, touch) {
    const c = h('canvas', { class: 'sign', 'aria-label': L().add.sign, role: 'img' });
    let down = false, ctx;
    const setup = () => { const r = c.getBoundingClientRect(); c.width = r.width * devicePixelRatio; c.height = r.height * devicePixelRatio;
      ctx = c.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.strokeStyle = getComputedStyle(c).color;
      if (p.signature) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = p.signature; } };
    requestAnimationFrame(setup);
    const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('pointerdown', e => { down = true; c.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
    c.addEventListener('pointermove', e => { if (!down) return; ctx.lineTo(...pos(e)); ctx.stroke(); });
    c.addEventListener('pointerup', () => { down = false; p.signature = c.toDataURL('image/png'); touch(); });
    return h('div', { class: 'stack', style: 'gap:6px' }, c, h('button', { type: 'button', class: 'btn small', style: 'justify-self:start', onclick: () => {
      ctx.clearRect(0, 0, c.width, c.height); delete p.signature; touch(); }, text: L().add.clear }));
  }
  function stepPrice(p, touch) {
    const l = L();
    const calc = h('div', {});
    const miss = h('p', { class: 'alert', role: 'status' });
    const refresh = () => {
      fill(calc, p.price && p.origin ? fiscalBlock(p, p.price) : h('p', { class: 'muted', text: l.piece.fiscalNote }));
      const m = missingOf(p); miss.hidden = !m.length; fill(miss, icon('alert'), l.missingList(m.map(x => l.missing[x]).join(', ')));
    };
    refresh();
    const chBox = k => h('label', { class: 'choice' }, h('input', { type: 'checkbox', checked: !!p.listings[k], onchange: e => {
      if (e.target.checked) p.listings[k] = p.listings[k] || { state: 'draft' }; else delete p.listings[k]; touch(); } }), h('span', { class: 'box' }), h('span', {}, h('b', { text: chLabel(k) })));
    return [field(`${l.add.priceL} (€)`, numIn(p.price, v => { p.price = v; refresh(); touch(); })), h('div', { class: 'sub-panel' }, h('h3', { text: l.piece.fiscal }), calc),
      h('p', { class: 'lbl', text: l.add.channelsL }), h('div', { class: 'choices cols' }, CHANNELS.map(chBox)), miss];
  }

  /* ---------- Client : sélection ou création rapide ---------- */
  function customerPicker(f, onChange) {
    const l = L();
    const sel = h('select', { class: 'input', onchange: e => { f.customer = e.target.value || null; f.newCustomer = e.target.value === '__new'; onChange(); } },
      h('option', { value: '', text: l.cust.none2, selected: !f.customer && !f.newCustomer }),
      S.customers.map(c => h('option', { value: c.id, selected: f.customer === c.id, text: `${c.name}${c.handle ? ` (${c.handle})` : ''}${c.status === 'fake' ? ' ⚠' : ''}` })),
      h('option', { value: '__new', selected: f.newCustomer, text: `+ ${l.cust.new}` }));
    return field(l.cust.pick, sel);
  }

  /* ---------- Vente ---------- */
  let sellForm = null;  // garde la saisie si on change de langue en cours de vente
  function viewSell(id, q) {
    const l = L(), p = piece(id);
    if (!p || p.saleId || !['live', 'reserved'].includes(p.status)) { location.replace(p ? `#/piece/${p.id}` : '#/stock'); return []; }
    const priv = isPrivate(p);
    const linked = q.get('pay') ? S.feed.find(x => x.id === q.get('pay') && !x.saleId) : null;
    const fromScan = !!q.get('scan');
    if (fromScan) history.replaceState(null, '', `#/sell/${p.id}`);
    if (fromScan || !sellForm || sellForm.pid !== p.id || sellForm.pay !== (linked?.id || null)) {
      const start = linked ? linked.amount : p.price || 0;
      sellForm = { pid: p.id, pay: linked?.id || null, customer: null, newCustomer: false, newName: '', newHandle: '', newVat: '', price: start,
        method: linked ? linked.method : 'bancontact', amount: start, deposit: false, depositState: 'validated',
        mode: 'pickup', address: { street: '', zip: '', city: '' }, date: TODAY, slot: '', newPhone: '', newEmail: '' };
    }
    const f = sellForm;
    let submitted = false;
    const ogm = E.structuredComm(2026000000 + S.counters.F);
    let fis, amountIn;
    const extra = h('div', { class: 'stack' }), who = h('div', { class: 'stack' }), deliv = h('div', { class: 'stack' });
    const confirm = h('button', { type: 'submit', class: 'btn primary big block' }, icon('check'), l.sell.confirm);
    const cust = () => (f.customer ? customer(f.customer) : null);
    const isB2b = () => !priv && (cust()?.vat || (f.newCustomer && f.newVat));
    const problem = () => {
      if (isB2b() && !E.validBce(cust()?.vat || f.newVat)) return l.sell.badVat;
      if (f.mode === 'delivery' && !fullAddr(f.address)) return l.delivx.incomplete;
      if (linked) return null;
      if (!(f.amount > 0 && f.amount <= f.price)) return l.sell.badAmount;
      if (f.method === 'cash' && !E.cashCheck(f.amount).ok) return l.sell.cashBlocked;
      return null;
    };
    const paintExtra = () => {
      const why = problem();
      confirm.disabled = !!why || submitted;
      fill(extra,
        why ? h('p', { class: 'alert bad', role: 'alert' }, icon('alert'), why) : null,
        cust()?.status === 'fake' ? h('p', { class: 'alert bad' }, icon('alert'), l.cust.fakeWarn) : null,
        f.method === 'link' && !linked ? h('div', { class: 'alert good' }, icon('link'), h('span', {}, h('b', { text: l.sell.linkMade }), h('br'), 'https://pay.example/etiket/demo')) : null,
        (f.method === 'transfer' || f.method === 'link') && !linked && !priv ? h('p', { class: 'row' }, h('span', { class: 'muted', text: l.sell.ogm }), h('b', { class: 'num', text: ogm }),
          btn(l.piece.copy, () => copy(ogm), 'small', 'copy')) : null);
    };
    const paintWho = () => fill(who, customerPicker(f, () => { if (cust()?.addresses?.[0]) f.address = { ...cust().addresses[0] }; paintWho(); paintDeliv(); paintExtra(); }),
      f.newCustomer ? h('div', { class: 'grid2' },
        field(l.cust.name, h('input', { class: 'input', value: f.newName, autocomplete: 'off', oninput: e => { f.newName = e.target.value; } })),
        field(l.cust.handle, h('input', { class: 'input', value: f.newHandle, autocomplete: 'off', placeholder: '@', oninput: e => { f.newHandle = e.target.value; } })),
        field(l.sellx.phone, h('input', { class: 'input', type: 'tel', value: f.newPhone || '', oninput: e => { f.newPhone = e.target.value; } })),
        field(l.sellx.email, h('input', { class: 'input', type: 'email', value: f.newEmail || '', oninput: e => { f.newEmail = e.target.value; } })),
        priv ? null : field(`${l.sell.vat} (${P.lang === 'nl' ? 'bedrijf' : 'entreprise'})`, h('input', { class: 'input', value: f.newVat, placeholder: 'BE0400000086', oninput: e => { f.newVat = e.target.value; paintExtra(); } }))) : null,
      isB2b() ? h('p', { class: E.validBce(cust()?.vat || f.newVat) ? 'alert good' : 'alert bad' }, icon('peppol'),
        E.validBce(cust()?.vat || f.newVat) ? `${l.sell.found} 0208:${String(cust()?.vat || f.newVat).replace(/\D/g, '')}` : l.sell.notFound)
        : h('p', { class: 'muted', text: priv ? l.broc.noInvoice : l.sales.b2cNote }));
    const paintDeliv = () => fill(deliv,
      h('div', { class: 'choices cols' }, radio('mode', 'pickup', l.deliv.mode.pickup, m => { f.mode = m; paintDeliv(); paintExtra(); }, f.mode === 'pickup'),
        radio('mode', 'delivery', l.deliv.mode.delivery, m => { f.mode = m; paintDeliv(); paintExtra(); }, f.mode === 'delivery', S.shop.delivery[P.lang])),
      f.mode === 'delivery' ? [addressFields(f.address, () => paintExtra()),
        h('div', { class: 'grid2' }, field(l.deliv.date, h('input', { class: 'input', type: 'date', value: f.date, min: TODAY, oninput: e => { f.date = e.target.value; } })),
          field(l.deliv.slot, h('input', { class: 'input', value: f.slot, placeholder: '18:00–20:00', oninput: e => { f.slot = e.target.value; } }))),
        f.address.zip && !inFreeZone(f.address) ? h('p', { class: 'alert' }, icon('alert'), l.deliv.outZone) : null] : null);
    paintWho(); paintDeliv();
    // Conversation scannée : client reconnu ou nouveau, adresse de livraison et prix convenu repris, toujours modifiables
    const scanNote = h('div', {});
    const applyScan = (raw, text) => {
      const own = `@${S.shop.instagram}`.toLowerCase();
      const found = { ...raw, handles: raw.handles.filter(x => x.toLowerCase() !== own) };
      const known = E.matchCustomer(found, S.customers);
      if (known) { f.customer = known; f.newCustomer = false; }
      else {
        f.customer = null; f.newCustomer = true;
        f.newHandle = found.handles[0] || f.newHandle; f.newName = found.names?.[0] || f.newName || found.handles[0] || '';
        f.newPhone = found.phones[0] || ''; f.newEmail = found.emails[0] || '';
      }
      const fake = known && customer(known).status === 'fake';
      const addr = found.addresses[0] || (known && customer(known).addresses[0]);
      if (addr && !fake) { f.mode = 'delivery'; f.address = { ...addr }; }
      const near = v => v && v >= (p.price || 0) * 0.5 && v <= (p.price || v) * 1.5;
      const agreed = linked ? null : near(found.agreed) ? found.agreed : E.agreedPrice(found.amounts, p.price || 0);
      const usePrice = () => { f.price = agreed; priceIn.value = agreed; if (!f.deposit) { f.amount = agreed; if (amountIn) amountIn.value = agreed; } fill(fis, priv ? null : fiscalBlock(p, f.price)); paintExtra(); toast(l.sellx.price(money(agreed))); };
      f.conv = String(text || '').slice(0, 600);
      fill(scanNote, h('div', { class: fake ? 'alert bad' : 'alert good' }, icon(fake ? 'alert' : 'scan'), h('div', { class: 'stack', style: 'gap:6px' },
        h('b', { text: l.sellx.scanned }),
        h('span', { text: [known ? l.sellx.known(customer(known).name) : l.sellx.newFrom, addr ? fmtAddr(addr) : null].filter(Boolean).join(' — ') }),
        fake ? h('span', { text: l.cust.fakeWarn }) : null,
        agreed && agreed !== f.price ? btn(`${l.sellx.apply} ${money(agreed)}`, usePrice, 'small primary', 'check') : null)));
      paintWho(); paintDeliv(); paintExtra();
    };
    const scanBtn = btn(l.sellx.scan, () => scanSheet(applyScan), 'tagged', 'scan');
    if (fromScan) setTimeout(() => scanSheet(applyScan), 60);
    if (q.get('fromscan') && pendingScan) { const ps = pendingScan; pendingScan = null; history.replaceState(null, '', `#/sell/${p.id}`); setTimeout(() => applyScan(ps.found, ps.text), 30); }
    const submit = e => {
      e.preventDefault();
      if (submitted || problem()) return;
      submitted = true; confirm.disabled = true;
      let cid = f.customer;
      if (f.newCustomer) {
        cid = `c${Date.now()}`;
        S.customers.push({ id: cid, name: f.newName || f.newHandle || (P.lang === 'nl' ? 'Nieuwe klant' : 'Nouveau client'), handle: f.newHandle, channel: f.newHandle ? 'instagram' : 'shop',
          phone: f.newPhone || '', email: f.newEmail || '', status: 'ok', vat: f.newVat || undefined, addresses: f.mode === 'delivery' ? [{ ...f.address }] : [], notes: '', since: TODAY, conv: f.conv });
      } else if (cid && f.conv) { customer(cid).conv = f.conv; }
      if (!f.newCustomer && cid && f.mode === 'delivery') {
        const c = customer(cid); if (!c.addresses.some(a => sameAddr(a, f.address))) c.addresses.push({ ...f.address });
      }
      const n = nextNumber(priv ? 'B' : 'F');
      const sNew = { id: n.id, no: n.no, date: TODAY, pieces: [p.id], price: f.price, customer: cid, reservation: f.deposit, private: priv || undefined, payments: [],
        delivery: f.mode === 'delivery' ? { mode: 'delivery', address: { ...f.address }, date: f.date, slot: f.slot, status: 'planned' } : { mode: 'pickup', status: f.deposit ? 'planned' : 'done' } };
      const immediate = ['bancontact', 'cash', 'payconiq', 'card'].includes(f.method);
      const promisedOnly = f.deposit && f.depositState === 'promised';
      if (linked) {
        sNew.payments.push({ id: `y${Date.now()}`, method: linked.method, amount: linked.amount, date: linked.date });
        linked.saleId = sNew.id;
      } else if (promisedOnly) {
        sNew.payments.push({ id: `y${Date.now()}`, method: f.method, amount: f.amount, date: TODAY, state: 'promised' });
      } else if (immediate || f.deposit) {
        sNew.payments.push({ id: `y${Date.now()}`, method: f.method, amount: f.amount, date: TODAY });
        S.feed.unshift({ id: `f${Date.now()}`, date: TODAY, time: new Date().toTimeString().slice(0, 5), source: f.method === 'cash' ? 'cash' : f.method === 'transfer' ? 'bank' : 'mollie', method: f.method, amount: f.amount,
          from: f.method === 'cash' ? 'Caisse' : `${l.pay[f.method]} •• 0000`, ref: f.method === 'cash' ? '' : 'tr_demo', saleId: sNew.id, fee: f.method === 'cash' ? 0 : 0.39, private: priv || undefined });
      }
      if (isB2b()) sNew.peppol = { state: 'sent', steps: [['sent', stamp()]] };
      S.sales.unshift(sNew);
      p.saleId = sNew.id;
      p.status = f.deposit ? 'reserved' : 'sold';
      if (f.deposit && !promisedOnly) settle(sNew);  // acompte égal au prix : la réservation est déjà soldée
      let removeN = 0;
      if (!f.deposit && p.status === 'sold') {
        for (const [ch, lst] of Object.entries(p.listings || {})) {
          if (lst.state === 'live' && ch !== 'site') { lst.state = 'to-remove'; removeN++; } else if (lst.state === 'live') lst.state = 'removed'; else if (lst.state === 'draft') delete p.listings[ch];
        }
        if (p.origin === 'depot') S.payouts.push({ id: `o${Date.now()}`, depositor: p.depositor, piece: p.id, sale: sNew.id, amount: E.consignment(f.price, p.commission).payout, state: 'due', since: TODAY });
      }
      if (!priv) S.accounting.pending++;
      sellForm = null;
      save();
      if (sNew.peppol) simulatePeppol(sNew.id);
      toast(`${l.sell.done(n.no)} ${l.sell.removeAfter(removeN)}`.trim());
      go(`#/sale/${sNew.id}`);
    };
    const depBox = h('div', { class: 'sub-panel stack', hidden: !f.deposit }, h('p', { class: 'lbl', text: l.dep.choose }),
      h('div', { class: 'choices cols' }, radio('dep', 'validated', l.dep.yes, k => { f.depositState = k; }, f.depositState === 'validated'),
        radio('dep', 'promised', l.dep.no, k => { f.depositState = k; }, f.depositState === 'promised')), h('p', { class: 'hint', text: l.dep.note }));
    const payPanel = linked
      ? panel(l.sell.how, null, h('p', { class: 'alert good' }, icon('check'), l.sell.alreadyPaid(money(linked.amount), l.pay[linked.method] || linked.method)))
      : panel(l.sell.how, null, h('div', { class: 'choices' }, ['bancontact', 'payconiq', 'link', 'transfer', 'cash'].map(k => radio('how', k, l.pay[k], m => { f.method = m; paintExtra(); }, k === f.method))),
        h('div', { class: 'grid2', style: 'margin-top:14px' }, field(l.sales.total, amountIn = numIn(f.amount, v => { f.amount = v || 0; paintExtra(); })),
          h('label', { class: 'choice', style: 'align-self:end' }, h('input', { type: 'checkbox', checked: f.deposit, onchange: e => { f.deposit = e.target.checked; depBox.hidden = !f.deposit; } }),
            h('span', { class: 'box' }), h('b', { text: l.sell.deposit }))),
        depBox);
    const priceIn = numIn(f.price, v => { f.price = v || 0; if (!f.deposit && amountIn) { f.amount = f.price; amountIn.value = f.price; } paintExtra(); fill(fis, priv ? null : fiscalBlock(p, f.price)); });
    if (linked) priceIn.readOnly = true;
    fis = h('div', {}, priv ? null : fiscalBlock(p, f.price));
    paintExtra();
    return [
      crumb(`#/piece/${p.id}`, title(p)),
      head(`${l.sell.title} : n° ${p.no}`, title(p)),
      h('form', { class: 'cols', onsubmit: submit },
        h('div', { class: 'stack' },
          panel(l.sell.who, scanBtn, scanNote, who),
          panel(l.deliv.choose, null, deliv),
          panel(l.sell.price, null, field(`${l.sell.price} (€)`, priceIn), h('div', { style: 'margin-top:14px' }, fis))),
        h('div', { class: 'stack' }, payPanel, extra, confirm))
    ];
  }
  function addressFields(a, onChange) {
    const l = L();
    const inp = (k, ph, mode) => h('input', { class: 'input', value: a[k] || '', placeholder: ph, inputmode: mode, autocomplete: { street: 'address-line1', zip: 'postal-code', city: 'address-level2' }[k],
      oninput: e => { a[k] = e.target.value.trim(); onChange?.(); } });
    return h('div', { class: 'stack' }, field(l.cust.street, inp('street', 'Rue de la Victoire 12 bte 3')),
      h('div', { class: 'grid2' }, field(l.cust.zip, inp('zip', '1060', 'numeric')), field(l.cust.city, inp('city', 'Saint-Gilles'))));
  }
  function simulatePeppol(id) {
    const s = sale(id);
    setTimeout(() => { s.peppol.steps.push(['delivered', stamp()]); s.peppol.state = 'delivered'; save(); if (location.hash === `#/sale/${id}`) render(); }, 2500);
    setTimeout(() => { s.peppol.steps.push(['accepted', stamp()]); s.peppol.state = 'accepted'; save(); if (location.hash === `#/sale/${id}`) render(); toast(`${s.no} : ${L().sales.steps.accepted}`); }, 6500);
  }

  /* ---------- Annuler une vente : note de crédit (activité) ou suppression (famille) ---------- */
  function relistPiece(s) {
    for (const p of s.pieces.map(piece).filter(Boolean)) {
      p.status = 'live'; delete p.saleId;
      for (const lst of Object.values(p.listings || {})) {
        if (lst.state === 'to-remove') lst.state = 'live';
        else if (lst.state === 'removed') lst.state = lst.url ? 'draft' : 'live';
      }
    }
  }
  function cancelSale(s) {
    const l = L();
    if (s.private) {
      sheet(l.broc.deleteSale, close => h('div', { class: 'stack' }, h('p', { text: l.broc.noInvoice }),
        btn(l.broc.deleteSale, () => {
          relistPiece(s);
          S.feed = S.feed.filter(y => y.saleId !== s.id);
          S.sales = S.sales.filter(x => x.id !== s.id);
          save(); close(); toast(l.broc.deleted); go('#/brocante');
        }, 'danger big', 'trash')));
      return;
    }
    sheet(l.cancel.title, close => {
      let reason = l.cancel.reasons[0];
      const validated = paid(s);
      return h('div', { class: 'stack' }, h('p', { text: l.cancel.explain }),
        field(l.cancel.reason, h('select', { class: 'input', onchange: e => { reason = e.target.value; } }, l.cancel.reasons.map(r => h('option', { value: r, text: r })))),
        validated > 0 ? h('p', { class: 'alert' }, icon('alert'), l.cancel.refund(money(validated))) : null,
        btn(l.cancel.confirm, () => {
          const n = nextNumber('NC');
          S.sales.unshift({ id: n.id, no: n.no, date: TODAY, pieces: [...s.pieces], price: -s.price, customer: s.customer, credit: true, creditOf: s.id, reason,
            reservation: s.reservation || undefined, payments: [] });
          s.cancelled = n.no;
          if (s.delivery) s.delivery.status = s.delivery.status === 'done' ? 'done' : 'cancelled';
          for (const y of s.payments) if (y.state === 'promised') y.state = 'void';
          if (validated > 0) S.refunds.push({ id: `r${Date.now()}`, sale: s.id, amount: validated, state: 'due' });
          for (const o of S.payouts) if (o.sale === s.id && o.state === 'due') o.state = 'cancelled';
          if (s.peppol) { s.peppol.credit = n.no; S.sales[0].peppol = { state: 'sent', steps: [['sent', stamp()]], creditNote: true }; }
          relistPiece(s);
          S.accounting.pending++;
          save(); close(); if (S.sales[0].peppol) simulatePeppol(n.id); toast(l.cancel.done(n.no)); go(`#/sale/${n.id}`);
        }, 'danger big', 'sync'));
    });
  }

  /* ---------- Ventes ---------- */
  function viewSales(q) {
    const l = L(), f = q.get('f') || 'all';
    const match = { all: s => !s.private, b2b: s => !!s.peppol, open: s => balance(s) > 0, credit: s => s.credit || s.cancelled, private: s => s.private };
    const labels = { all: l.sales.all, b2b: l.sales.b2b, open: l.sales.open, credit: l.cancel.credit, private: l.nav.brocante };
    const list = S.sales.filter(match[f] || match.all);
    return [
      head(l.sales.title, null),
      chips(Object.keys(match).map(k => [k, labels[k], S.sales.filter(match[k]).length]), f, k => go(`#/sales?f=${k}`)),
      list.length ? h('ul', { class: 'list' }, list.map(s => {
        const p = piece(s.pieces[0]), b = buyer(s);
        return h('li', {}, h('span', { class: 'lead' }, icon(s.credit ? 'sync' : s.private ? 'tent' : s.peppol ? 'peppol' : 'sales')),
          link(`#/sale/${s.id}`, { class: 'main rowlink' }, h('b', { text: `${s.no}, ${b.name}` }), h('span', { text: `${E.date(s.date)} — n° ${p?.no ?? '?'} ${p ? title(p) : ''}` })),
          h('span', { class: `amt ${s.price < 0 ? 'neg' : ''}`, text: money(s.price) }),
          h('div', { class: 'sub' },
            s.credit ? pill('sold', `${l.cancel.credit} → ${sale(s.creditOf)?.no || ''}`) : s.cancelled ? pill('removed', l.cancel.cancelled(s.cancelled))
              : balance(s) > 0 ? pill('reserved', `${l.sales.balance} ${money(balance(s))}`) : pill('live', l.sales.paid),
            s.payments.some(y => y.state === 'promised') ? pill('reserved', l.dep.promised) : null,
            s.private ? pill('fam', l.scope.private) : null,
            s.delivery?.mode === 'delivery' && !s.credit ? pill(s.delivery.status === 'failed' ? 'sold' : s.delivery.status === 'done' ? 'live' : 'reserved', `${l.deliv.mode.delivery} : ${l.deliv.st[s.delivery.status] || s.delivery.status}`) : null,
            s.peppol && !s.credit ? pill(s.peppol.state === 'accepted' ? 'live' : 'reserved', `Peppol : ${l.sales.steps[s.peppol.state]}`) : null));
      })) : h('p', { class: 'muted', text: l.deliv.none })
    ];
  }
  function viewSale(id) {
    const l = L(), s = sale(id);
    if (!s) return viewSales(new URLSearchParams());
    const ps = s.pieces.map(piece).filter(Boolean);
    const b = buyer(s);
    const margin = ps.every(p => E.regimeOf(p) === 'margin');
    const docTitle = s.credit ? l.cancel.credit : s.private ? l.broc.receipt : l.sales.invoice;
    const ubl = () => E.peppolUbl({ number: s.no, date: s.date, lang: P.lang, ogm: ogmOf(s), iban: S.shop.iban, seller: { name: S.shop.legal, vat: S.shop.vat, address: S.shop.address },
      buyer: { name: b.name, vat: b.vat, address: b.c?.addresses?.[0] }, lines: ps.map(p => ({ label: title(p), price: s.price / ps.length, regime: E.regimeOf(p) })) });
    const code = h('pre', { class: 'code', hidden: true });
    const invoice = h('article', { class: 'invoice', 'aria-label': docTitle },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', { text: `${docTitle} ${s.no}` }), h('span', { text: E.date(s.date) })),
      s.credit ? h('p', { text: `${P.lang === 'nl' ? 'Annuleert factuur' : 'Annule la facture'} ${sale(s.creditOf)?.no || ''} — ${s.reason || ''}` }) : null,
      h('div', { class: 'parties' }, h('div', {}, h('b', { text: l.sales.seller }), h('br'), s.private ? `${l.scope.private}` : [`${S.shop.name} — ${S.shop.legal}`, h('br'), S.shop.vat, h('br'), fmtAddr(S.shop.address)]),
        h('div', {}, h('b', { text: l.sales.buyer }), h('br'), b.name, b.vat ? [h('br'), b.vat] : null, b.address ? [h('br'), fmtAddr(b.address)] : null)),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: l.acc.cols.no }), h('th', { text: l.acc.cols.item }), h('th', { class: 'r', text: l.acc.cols.sale }))),
        h('tbody', {}, ps.map(p => h('tr', {}, h('td', { text: String(p.no) }), h('td', { text: title(p) }), h('td', { class: 'r', text: money(s.price / ps.length) }))),
          margin || s.private ? null : h('tr', {}, h('td', {}), h('td', { text: P.lang === 'nl' ? 'Btw inbegrepen' : 'TVA comprise' }), h('td', { class: 'r', text: money(ps.reduce((t, p) => t + E.saleTax(p, Math.abs(s.price) / ps.length).vat, 0) * Math.sign(s.price)) })),
          h('tr', {}, h('td', {}), h('td', {}, h('b', { text: l.sales.total })), h('td', { class: 'r' }, h('b', { text: money(s.price) }))))),
      margin && !s.private ? h('p', { class: 'mention', text: E.MENTION[P.lang] }) : null,
      s.private ? h('p', { class: 'mention', text: l.broc.noInvoice }) : null,
      !s.credit && !s.private ? h('p', { style: 'margin-top:10px', text: `${l.sell.ogm} : ${ogmOf(s)} — IBAN ${S.shop.iban}` }) : null,
      !s.credit && !s.private ? h('p', { style: 'margin-top:6px;color:#555', text: l.sales.warranty }) : null);
    const addPay = () => sheet(l.sales.addPayment, close => {
      let m = 'bancontact', a = balance(s);
      const err = h('p', { class: 'alert bad', hidden: true, role: 'alert' }, icon('alert'), l.sell.cashBlocked);
      const errAmt = h('p', { class: 'alert bad', hidden: true, role: 'alert' }, icon('alert'), l.sales.badAmount);
      return h('form', { class: 'stack', onsubmit: e => {
        e.preventDefault();
        if (!(a > 0 && a <= balance(s))) { errAmt.hidden = false; return; }
        const already = s.payments.filter(y => y.method === 'cash' && y.state !== 'void').reduce((t, y) => t + y.amount, 0);
        if (m === 'cash' && !E.cashCheck(already + a).ok) { err.hidden = false; return; }
        s.payments.push({ id: `y${Date.now()}`, method: m, amount: a, date: TODAY });
        S.feed.unshift({ id: `f${Date.now()}`, date: TODAY, time: new Date().toTimeString().slice(0, 5), source: m === 'cash' ? 'cash' : 'mollie', method: m, amount: a, from: m === 'cash' ? 'Caisse' : l.pay[m], saleId: s.id, private: s.private || undefined });
        settle(s); save(); close(); render(); toast(l.payments.matched);
      } }, h('div', { class: 'choices' }, ['bancontact', 'payconiq', 'cash'].map(k => radio('m', k, l.pay[k], () => { m = k; err.hidden = true; }, k === m))),
      field(l.sales.balance, numIn(a, v => { a = v || 0; errAmt.hidden = true; })), err, errAmt, h('button', { type: 'submit', class: 'btn primary big', text: l.sales.addPayment }));
    });
    const active = !s.credit && !s.cancelled;
    return [
      crumb(s.private ? '#/brocante' : '#/sales', s.private ? l.nav.brocante : l.sales.title),
      head(`${docTitle} ${s.no}`, `${b.name} — ${E.date(s.date)}`,
        active && balance(s) > 0 ? btn(l.sales.addPayment, addPay, 'primary', 'payments') : null,
        btn(l.sales.print, () => window.print(), '', 'print'),
        s.peppol && !s.credit ? btn(l.sales.ubl, () => { code.textContent = ubl(); code.hidden = !code.hidden; }, '', 'peppol') : null,
        !s.credit ? btn(l.sendx.button, () => sendSheet(b.c, saleKinds(s), saleMsgData(s)), 'tagged', 'chat') : null,
        active ? btn(s.private ? l.broc.deleteSale : l.cancel.title, () => cancelSale(s), 'danger', s.private ? 'trash' : 'sync') : null),
      !s.credit ? h('div', { class: 'mobile-actions no-print' }, btn(l.sendx.button, () => sendSheet(b.c, saleKinds(s), saleMsgData(s)), 'tagged', 'chat'),
        active && balance(s) > 0 ? btn(l.sales.addPayment, addPay, 'primary', 'payments') : null) : null,
      s.cancelled ? h('p', { class: 'alert bad' }, icon('alert'), l.cancel.cancelled(s.cancelled)) : null,
      h('div', { class: 'cols-3' }, h('div', { class: 'stack' }, invoice, code),
        h('div', { class: 'stack no-print' },
          b.c ? panel(l.cust.pick, null, link(`#/customer/${b.c.id}`, { class: 'person' }, h('span', { class: 'avatar', text: b.c.name.replace(/^@/, '').slice(0, 1).toUpperCase() }),
            h('span', {}, h('b', { text: b.c.name }), h('span', { class: 'muted', text: [b.c.handle, b.c.phone].filter(Boolean).join(' — ') })), pill(b.c.status === 'ok' ? 'live' : b.c.status === 'watch' ? 'reserved' : 'sold', l.cust.st[b.c.status]))) : null,
          s.delivery && !s.credit ? deliveryPanel(s) : null,
          s.reservation && active ? h('p', { class: 'alert' }, icon('clock'), l.sales.reservation) : null,
          panel(l.nav.payments, null, s.payments.length ? h('ul', { class: 'list' }, s.payments.map(y => h('li', {}, h('span', { class: 'lead' }, icon(y.state === 'promised' ? 'clock' : 'payments')),
            h('span', { class: 'main' }, h('b', { text: `${l.pay[y.method] || y.method}${y.state === 'promised' ? ` — ${l.dep.promised}` : y.state === 'void' ? ' — ✕' : ''}` }), h('span', { text: E.date(y.date) })),
            h('span', { class: `amt ${y.state === 'promised' || y.state === 'void' ? 'neg' : ''}`, text: money(y.amount) }),
            y.state === 'promised' && active ? h('div', { class: 'sub' }, btn(l.dep.validate, () => validateDeposit(s, y), 'small primary', 'check')) : null))) : h('p', { class: 'muted', text: '—' }),
            active ? h('p', { class: 'row', style: 'margin-top:10px;justify-content:space-between' }, h('span', { text: l.sales.balance }), h('b', { text: money(balance(s)) })) : null),
          s.peppol ? panel(l.sales.peppol, null, h('ol', { class: 'timeline' }, ['sent', 'delivered', 'accepted'].map(k => {
            const st = s.peppol.steps.find(x => x[0] === k);
            return h('li', { class: st ? '' : 'off' }, h('span', {}, h('time', { text: st ? `${E.date(st[1].slice(0, 10))} ${st[1].slice(11)}` : '…' }), l.sales.steps[k]));
          })), h('p', { class: 'note', text: `${S.shop.peppol} → 0208:${String(b.vat || '').replace(/\D/g, '')}` })) : null,
          !s.private ? panel(l.acc.title, null, h('p', { class: 'row' }, icon('sync'), l.sales.toAccounting, h('b', { text: providerName(S.accounting.provider) }))) : null,
          ps.map(p => link(`#/piece/${p.id}`, { class: 'card', style: 'max-width:280px' }, h('div', { class: 'card-ph' }, tagEl(p), photoEl(p)), h('span', { class: 't', text: title(p) })))))
    ];
  }
  function validateDeposit(s, y) {
    if (y.method === 'cash') {
      const cash = s.payments.filter(z => z.method === 'cash' && z.state !== 'void' && z !== y).reduce((t, z) => t + z.amount, 0);
      if (!E.cashCheck(cash + y.amount).ok) { toast(L().sell.cashBlocked); return; }
    }
    y.state = 'validated'; y.date = TODAY;
    // un virement déjà arrivé sur le compte est repris tel quel, sinon on note l'encaissement
    const line = !s.private && S.feed.find(f => !f.saleId && !f.payout && f.amount === y.amount && (f.ref === ogmOf(s) || f.method === y.method));
    if (line) line.saleId = s.id;
    else S.feed.unshift({ id: `f${Date.now()}`, date: TODAY, time: new Date().toTimeString().slice(0, 5), source: y.method === 'cash' ? 'cash' : 'bank', method: y.method, amount: y.amount,
      from: buyer(s).name, ref: ogmOf(s), saleId: s.id, private: s.private || undefined });
    settle(s); save(); render(); toast(L().dep.validatedT);
  }
  function settle(s) {
    if (balance(s) > 0) return;
    const p = piece(s.pieces[0]);
    if (p && p.status === 'reserved') {
      p.status = 'sold'; s.reservation = false;
      for (const [ch, lst] of Object.entries(p.listings || {})) if (lst.state === 'live') lst.state = ch === 'site' ? 'removed' : 'to-remove';
      if (p.origin === 'depot') S.payouts.push({ id: `o${Date.now()}`, depositor: p.depositor, piece: p.id, sale: s.id, amount: E.consignment(s.price, p.commission).payout, state: 'due', since: TODAY });
    }
  }

  /* ---------- Livraisons ---------- */
  // Modifier une livraison : on colle (ou on scanne) le message du client, l'app propose date, créneau et adresse ; tout reste modifiable.
  function editDelivery(s) {
    const l = L(), x = l.delivx, d = s.delivery, b = buyer(s);
    let ctrl = null, dict = null;
    sheet(x.title, close => {
      const f = { address: { ...(d.address || { street: '', zip: '', city: '' }) }, date: d.date && d.date >= TODAY ? d.date : TODAY, slot: d.slot || '' };
      const msg = h('textarea', { class: 'input', rows: 3, placeholder: x.msgPh });
      const found = h('div', {});
      const fields = h('div', { class: 'stack' });
      const err = h('p', { class: 'alert bad', hidden: true, role: 'alert' }, icon('alert'), x.incomplete);
      const paintFields = () => fill(fields,
        b.c?.addresses?.length ? h('div', { class: 'choices' }, b.c.addresses.map((a, i) => radio(`addr-${s.id}`, String(i), fmtAddr(a), () => { f.address = { ...a }; paintFields(); }, fmtAddr(a) === fmtAddr(f.address)))) : null,
        addressFields(f.address),
        h('div', { class: 'grid2' }, field(l.deliv.date, h('input', { class: 'input', type: 'date', value: f.date, min: TODAY, oninput: e => { f.date = e.target.value; } })),
          field(l.deliv.slot, h('input', { class: 'input', value: f.slot, placeholder: '14:00–16:00', oninput: e => { f.slot = e.target.value; } }))),
        f.address.zip && !inFreeZone(f.address) ? h('p', { class: 'alert' }, icon('alert'), l.deliv.outZone) : null);
      const analyse = text => {
        const r = E.parseDelivery(text, TODAY);
        if (r.address) f.address = { ...r.address };
        if (r.date) f.date = r.date;
        if (r.slot) f.slot = r.slot;
        const got = [r.date ? `${l.deliv.date} : ${E.date(r.date)}` : null, r.slot ? `${l.deliv.slot} : ${r.slot}` : null, r.address ? `${l.deliv.address} : ${fmtAddr(r.address)}` : null].filter(Boolean);
        fill(found, got.length ? h('p', { class: 'alert good' }, icon('check'), h('span', {}, h('b', { text: x.found }), h('br'), got.join(' — ')))
          : h('p', { class: 'alert' }, icon('alert'), x.nothing));
        paintFields();
      };
      const stage = h('div', {});
      const shotIn = h('input', { type: 'file', accept: 'image/*', class: 'sr', id: `deliv-shot-${s.id}`, onchange: async e => {
        const file = e.target.files[0]; e.target.value = ''; if (!file) return;
        ctrl?.abort();
        const my = ctrl = new AbortController(), st = ocrStage(file, () => my.abort());
        fill(stage, st.el); fill(found);
        try {
          const text = await readImage(file, pr => { if (ctrl === my) st.set(pr); }, my.signal);
          if (ctrl !== my) return;  // une capture plus récente a été choisie entre-temps
          msg.value = text; st.done(text.length); analyse(text);
        } catch (err) { if (ctrl !== my) return; if (err?.name === 'AbortError') { fill(stage); msg.focus(); } else st.fail(l.cust.scanFail); }
        finally { if (ctrl === my) ctrl = null; }
      } });
      dict = dictate(msg, analyse);
      paintFields();
      return h('form', { class: 'stack', onsubmit: e => {
        e.preventDefault();
        if (!(fullAddr(f.address) && f.date && f.date >= TODAY)) { err.hidden = false; return; }
        d.address = { ...f.address }; d.date = f.date; d.slot = f.slot.trim();
        if (d.status === 'failed') { d.status = 'planned'; delete d.note; }
        if (b.c && !b.c.addresses.some(a => sameAddr(a, d.address))) b.c.addresses.push({ ...d.address });
        save(); close(); render(); toast(l.deliv.saved);
      } },
        h('div', { class: 'sub-panel stack' }, h('h3', { text: x.fromMsg }), h('p', { class: 'hint', text: x.fromMsgHint }), msg,
          h('div', { class: 'row' }, btn(x.analyse, () => analyse(msg.value), 'small primary', 'search'), dict,
            h('label', { class: 'btn small', for: `deliv-shot-${s.id}` }, icon('scan'), x.shot), shotIn,
            (navigator.clipboard || {}).readText ? btn(l.scanx.pasteText, async () => { try { msg.value = await navigator.clipboard.readText(); analyse(msg.value); } catch { toast(l.scanx.clipDenied); } }, 'small', 'copy') : null),
          stage, found),
        fields, err, h('button', { type: 'submit', class: 'btn primary big', text: x.save }));
    }, () => { ctrl?.abort(); dict?.stop?.(); });
  }
  function deliveryPanel(s) {
    const l = L(), d = s.delivery, b = buyer(s);
    if (d.mode !== 'delivery') return panel(l.deliv.title, null, h('p', { class: 'row' }, icon('stock'), l.deliv.mode.pickup));
    const fail = () => sheet(l.deliv.fail, close => {
      let note = '', markFake = false;
      return h('form', { class: 'stack', onsubmit: e => {
        e.preventDefault(); d.status = 'failed'; d.note = note; if (markFake && b.c) b.c.status = 'fake'; save(); close(); render(); toast(l.deliv.saved);
      } }, field(l.deliv.failNote, h('textarea', { class: 'input', oninput: e => { note = e.target.value; } })),
      b.c ? h('label', { class: 'choice' }, h('input', { type: 'checkbox', onchange: e => { markFake = e.target.checked; } }), h('span', { class: 'box' }), h('b', { text: `${l.cust.status} : ${l.cust.st.fake}` })) : null,
      h('button', { type: 'submit', class: 'btn danger big', text: l.deliv.fail }));
    });
    const active = !s.cancelled;
    return panel(l.deliv.title, pill(d.status === 'failed' || d.status === 'cancelled' ? 'sold' : d.status === 'done' ? 'live' : 'reserved', l.deliv.st[d.status] || (P.lang === 'nl' ? 'Geannuleerd' : 'Annulée')),
      h('dl', { class: 'facts' }, h('div', {}, h('dt', { text: l.deliv.date }), h('dd', { text: d.date ? `${E.date(d.date)} ${d.slot || ''}` : '—' })),
        h('div', {}, h('dt', { text: l.deliv.address }), h('dd', { text: fmtAddr(d.address) }))),
      d.note ? h('p', { class: 'note', text: d.note }) : null,
      d.address && !inFreeZone(d.address) ? h('p', { class: 'note', text: l.deliv.outZone }) : null,
      active && d.status !== 'done' ? h('div', { class: 'row', style: 'margin-top:12px' },
        d.status === 'planned' ? btn(l.deliv.markDone, () => { d.status = 'done'; save(); render(); toast(l.deliv.saved); }, 'small primary', 'check') : null,
        d.status === 'planned' ? btn(l.deliv.fail, fail, 'small', 'alert') : null,
        btn(l.delivx.edit, () => editDelivery(s), 'small', 'edit'),
        btn(l.deliv.copy, () => copy(fmtAddr(d.address)), 'small', 'copy'),
        btn(l.sendx.notify, () => sendSheet(b.c, ['delivery', 'address'], saleMsgData(s)), 'small', 'chat'),
        d.status === 'failed' ? btn(s.private ? l.broc.deleteSale : l.deliv.relist, () => cancelSale(s), 'small danger', 'sync') : null) : null);
  }
  function viewDeliveries() {
    const l = L();
    const all = deliveries().filter(s => !s.cancelled);
    const groups = [['failed', l.deliv.failed, all.filter(s => s.delivery.status === 'failed')],
      ['planned', l.deliv.upcoming, all.filter(s => s.delivery.status === 'planned').sort((a, b) => a.delivery.date.localeCompare(b.delivery.date))],
      ['done', l.deliv.done, all.filter(s => s.delivery.status === 'done')]];
    return [
      head(l.deliv.title, S.shop.delivery[P.lang]),
      h('div', { class: 'stack' }, groups.map(([k, label, list]) => panel(`${label} (${list.length})`, null, list.length ? h('div', { class: 'deliv-grid' }, list.map(s => {
        const p = piece(s.pieces[0]), b = buyer(s);
        return h('article', { class: `deliv ${k}` },
          h('div', { class: 'deliv-when' }, h('b', { text: s.delivery.date ? E.date(s.delivery.date) : '—' }), h('span', { text: s.delivery.slot || '' })),
          h('div', { class: 'stack', style: 'gap:6px' },
            link(`#/sale/${s.id}`, { class: 'rowlink' }, h('b', { text: `${p ? `n° ${p.no} ${title(p)}` : s.no}` })),
            h('span', { class: 'row' }, b.name, b.c ? pill(b.c.status === 'ok' ? 'live' : b.c.status === 'watch' ? 'reserved' : 'sold', l.cust.st[b.c.status]) : null),
            h('span', { class: 'muted', text: fmtAddr(s.delivery.address) }),
            s.delivery.note ? h('span', { class: 'note', text: s.delivery.note }) : null,
            balance(s) > 0 ? pill('reserved', `${l.sales.balance} ${money(balance(s))}`) : null),
          h('div', { class: 'row deliv-acts' }, k !== 'done' ? btn(l.delivx.edit, () => editDelivery(s), 'small primary', 'edit') : null, link(`#/sale/${s.id}`, { class: 'btn small' }, l.piece.seeSale)));
      })) : h('p', { class: 'muted', text: l.deliv.none })))) ];
  }

  /* ---------- Clients et scan de conversation (OCR dans le navigateur) ---------- */
  const TESS = { src: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js', sri: 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F' };
  let tessLoading;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    tessLoading = tessLoading || new Promise((res, rej) => {
      const sc = h('script', { src: TESS.src, crossorigin: 'anonymous', integrity: TESS.sri || null });
      sc.onload = () => res(window.Tesseract);
      sc.onerror = () => { tessLoading = null; rej(new Error('tesseract')); };
      document.head.append(sc);
    });
    return tessLoading;
  }
  // Prépare la capture pour la lecture : agrandie si petite, en niveaux de gris ; deux versions lues l'une après l'autre
  // (les conversations mélangent bulles claires et foncées, et beaucoup de captures sont en mode sombre).
  async function prepareImage(file) {
    const bmp = await createImageBitmap(file);
    let k = bmp.width < 1200 ? Math.min(2.5, 1600 / bmp.width) : Math.min(1, 2400 / bmp.width);
    if (bmp.width * k * bmp.height * k > 14e6) k = Math.sqrt(14e6 / (bmp.width * bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), hgt = Math.max(1, Math.round(bmp.height * k));
    // « normal » : texte foncé sur fond clair ; « clair » : seul le texte presque blanc est gardé, en noir sur blanc
    // (bulles bleues, grises ou noires du mode sombre).
    const make = mode => {
      const c = h('canvas', { width: w, height: hgt });
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(bmp, 0, 0, w, hgt);
      const img = x.getImageData(0, 0, w, hgt), d = img.data;
      let min = 255, max = 0;
      for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = g; if (g < min) min = g; if (g > max) max = g; }
      const span = Math.max(1, max - min);
      for (let i = 0; i < d.length; i += 4) {
        const g = mode === 'bright' ? (d[i] > 190 ? 0 : 255) : ((d[i] - min) * 255) / span;
        d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      return c;
    };
    return [make('normal'), make('bright')];
  }
  // Lecture d'une capture. onProgress reçoit { stage: 'load' | 'prep' | 'read', pct, pass, passes } ; signal (AbortSignal) arrête la lecture.
  async function readImage(file, onProgress = () => {}, signal) {
    const stopped = new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new DOMException('stop', 'AbortError')), { once: true }));
    stopped.catch(() => {});
    const until = p => (signal ? Promise.race([p, stopped]) : p);
    onProgress({ stage: 'load', pct: 0 });
    const T = await until(loadTesseract());
    onProgress({ stage: 'prep', pct: 0 });
    const passes = await until(prepareImage(file));
    let pass = 0;
    const made = T.createWorker(['fra', 'nld', 'eng'], 1, { logger: m => {
      if (m.status === 'recognizing text') onProgress({ stage: 'read', pct: Math.round(((pass + m.progress) / passes.length) * 100), pass, passes: passes.length });
      else if (/loading/.test(m.status || '')) onProgress({ stage: 'load', pct: Math.round((m.progress || 0) * 100) });
    } });
    signal?.addEventListener('abort', () => made.then(w => w.terminate()).catch(() => {}), { once: true });  // arrêté pendant le chargement
    const worker = await until(made);
    try {
      const seen = new Set(), lines = [];
      for (const canvas of passes) {
        onProgress({ stage: 'read', pct: Math.round((pass / passes.length) * 100), pass, passes: passes.length });
        const text = (await until(worker.recognize(canvas))).data.text || '';
        for (const line of text.split('\n').map(s => s.trim()).filter(s => s.length > 1)) {
          const key = line.toLowerCase().replace(/\s+/g, ' ');
          if (!seen.has(key)) { seen.add(key); lines.push(line); }
        }
        pass++;
      }
      return lines.join('\n');
    } finally { worker.terminate(); }
  }
  window.EtiketOCR = { readImage, parse: E.parseContact };  // exposé pour les tests de bout en bout

  // Lecture en cours : la capture avec une ligne de balayage, l'étape en clair, une barre de progression et « Arrêter »
  function ocrStage(file, onCancel) {
    const x = L().scanx;
    const bar = h('span', {});
    const track = h('div', { class: 'scan-bar indet', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': x.reading }, bar);
    const label = h('b', { text: x.stage.load }), pctEl = h('span', { class: 'scan-pct', 'aria-hidden': 'true' }), sub = h('span', { class: 'hint', text: x.loadHint });
    const img = h('img', { alt: x.shotAlt }); img.src = URL.createObjectURL(file);
    const free = () => URL.revokeObjectURL(img.src);
    img.addEventListener('load', free, { once: true }); img.addEventListener('error', free, { once: true });
    const fig = h('figure', { class: 'scan-shot busy' }, img, h('span', { class: 'scan-beam', 'aria-hidden': 'true' }));
    // seul le nom de l'étape est annoncé (role=status) ; le pourcentage passe par la barre (aria-valuenow)
    const state = h('div', { class: 'scan-state' }, h('p', { class: 'row' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { role: 'status' }, label), pctEl), track, sub,
      onCancel ? btn(x.cancel, onCancel, 'small', 'close') : null);
    const el = h('div', { class: 'scan-stage', 'aria-busy': 'true' }, fig, state);
    const t0 = Date.now();
    const finish = () => { fig.classList.remove('busy'); el.removeAttribute('aria-busy'); };
    return {
      el,
      set({ stage, pct = 0, pass = 0, passes = 2 }) {
        const all = stage === 'load' ? pct * 0.15 : stage === 'prep' ? 15 : 15 + pct * 0.83;
        bar.style.width = `${Math.max(4, Math.round(all))}%`;
        track.setAttribute('aria-valuenow', String(Math.round(all)));
        track.classList.toggle('indet', stage === 'load' && !pct);
        if (label.textContent !== x.stage[stage]) label.textContent = x.stage[stage];
        pctEl.textContent = stage === 'read' ? `${pct} %` : '';
        const note = stage === 'read' ? x.pass(pass + 1, passes) : stage === 'load' ? x.loadHint : '';
        if (sub.textContent !== note) sub.textContent = note;
      },
      done(chars) { finish(); fill(state, h('p', { class: 'row scan-ok' }, icon('check'), h('b', { text: x.doneIn(Math.max(1, Math.round((Date.now() - t0) / 1000)), chars) }))); },
      fail(msg) { finish(); fill(state, h('p', { class: 'alert bad' }, icon('alert'), msg)); },
    };
  }

  // Dictée : la reconnaissance vocale du navigateur (fr-BE ou nl-BE) écrit dans le champ ; à l'arrêt, onDone relance l'analyse
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  function dictate(target, onDone) {
    const x = L().voice;
    if (!Speech) return h('p', { class: 'hint', text: x.none });
    let rec = null;
    const live = h('span', { class: 'dictate-live' });  // texte provisoire : visible, pas annoncé à chaque mot
    const b = h('button', { type: 'button', class: 'btn small dictate', 'aria-pressed': 'false', onclick: () => (rec ? rec.stop() : start()) }, icon('mic'), h('span', { text: x.start }));
    const idle = () => { rec = null; b.setAttribute('aria-pressed', 'false'); b.lastChild.textContent = x.start; live.textContent = ''; };
    function start() {
      const base = target.value.trim();
      let heard = '';
      rec = new Speech();
      rec.lang = P.lang === 'nl' ? 'nl-BE' : 'fr-BE'; rec.interimResults = true; rec.continuous = true;
      rec.onresult = e => {
        if (!b.isConnected) { rec?.abort(); return; }  // fenêtre fermée ou écran quitté : le micro se coupe
        let fin = '', tmp = '';
        for (const r of Array.from(e.results)) { if (r.isFinal) fin += `${r[0].transcript} `; else tmp += r[0].transcript; }
        heard = fin.trim();
        target.value = [base, E.fromSpeech(heard)].filter(Boolean).join('\n');
        live.textContent = tmp ? `« ${tmp} »` : x.listening;
      };
      rec.onerror = e => toast(['not-allowed', 'service-not-allowed'].includes(e.error) ? x.denied : e.error === 'no-speech' ? x.silence : x.fail);
      rec.onend = () => { idle(); if (heard) onDone?.(target.value); };
      try { rec.start(); b.setAttribute('aria-pressed', 'true'); b.lastChild.textContent = x.stop; live.textContent = x.listening; } catch { idle(); toast(x.fail); }
    }
    const wrap = h('span', { class: 'dictate-wrap' }, b, live);
    wrap.stop = () => rec?.abort();
    return wrap;
  }

  // Capture d'exemple (conversation fictive dessinée dans le navigateur) : essayer le scan sans avoir de vraie capture
  function sampleShot() {
    const nl = P.lang === 'nl';
    const msgs = nl
      ? [[0, 'Dag, is de vintage commode nog te koop?'], [1, 'Dag! Ja, ze kost 320 €.'], [0, 'Akkoord voor 300 €? Mijn naam is Lea Martin'], [1, 'Akkoord voor 300 €'],
        [0, 'Levering Kerkstraat 5, 2000 Antwerpen'], [0, 'Gsm 0470 00 00 77'], [0, 'lea.martin@demo.test']]
      : [[0, 'Bonjour, la commode vintage est toujours dispo ?'], [1, 'Bonjour ! Oui, elle est à 320 €.'], [0, 'Ok pour 300 € ? Je m’appelle Léa Martin'], [1, 'D’accord pour 300 €'],
        [0, 'Livraison Avenue Louise 54, 1050 Ixelles'], [0, 'Mon GSM : 0470 00 00 77'], [0, 'lea.martin@demo.test']];
    const W = 720, c = h('canvas', { width: W, height: 1180 }), g = c.getContext('2d');
    g.fillStyle = '#ECE5DD'; g.fillRect(0, 0, W, 1180);
    g.fillStyle = '#075E54'; g.fillRect(0, 0, W, 110);
    g.fillStyle = '#FFFFFF'; g.font = '600 34px Arial, sans-serif'; g.fillText(nl ? 'Lea (fictief)' : 'Léa (fictive)', 36, 68);
    g.font = '28px Arial, sans-serif';
    let y = 160;
    for (const [me, text] of msgs) {
      const tw = g.measureText(text).width, bw = tw + 48, bx = me ? W - bw - 28 : 28;
      g.fillStyle = me ? '#DCF8C6' : '#FFFFFF';
      g.beginPath(); if (g.roundRect) g.roundRect(bx, y, bw, 70, 16); else g.rect(bx, y, bw, 70); g.fill();
      g.fillStyle = '#111111'; g.fillText(text, bx + 24, y + 46);
      y += 70 + 26;
    }
    return new Promise(res => c.toBlob(b => res(new File([b], 'exemple.png', { type: 'image/png' })), 'image/png'));
  }

  // Bloc de scan réutilisable (fenêtre ou écran), en trois étapes : 1 la source (capture, collage, exemple), 2 la lecture,
  // 3 la vérification champ par champ. Le texte reste modifiable (clavier ou dictée) ; actions(c, text) fournit les boutons finaux.
  let scanOff = null;  // arrêt du bloc de scan précédent (lecture, dictée, écouteur de collage)
  function scanUI(actions) {
    const l = L(), x = l.scanx;
    scanOff?.();
    const out = h('div', { class: 'stack' });
    const stageBox = h('div', {});
    const paste = h('textarea', { class: 'input', rows: 5, placeholder: x.pastePh });
    const steps = h('ol', { class: 'scan-steps' }, x.steps.map((t, i) => h('li', { 'aria-current': i === 0 ? 'step' : null }, h('span', { class: 'n', text: String(i + 1) }), h('span', { text: t }))));
    const stepTo = n => [...steps.children].forEach((li, i) => { if (i === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); li.classList.toggle('done', i < n); });
    let ctrl = null;
    const showParsed = text => {
      if (text.replace(/\s/g, '').length < 3) { fill(out, h('p', { class: 'alert' }, icon('alert'), x.editHint)); stepTo(0); return; }
      stepTo(2);
      fill(out, review(E.parseContact(text), text, actions));
      out.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    const runFile = async file => {
      if (!/^image\//.test(file.type || 'image/') || file.size > 15 * 1024 * 1024) { fill(out, h('p', { class: 'alert bad' }, icon('alert'), x.tooBig)); return; }
      ctrl?.abort();
      const my = ctrl = new AbortController();
      const st = ocrStage(file, () => my.abort());
      fill(stageBox, st.el); fill(out); stepTo(1);
      el.classList.add('has-shot');
      const reset = () => { el.classList.remove('has-shot'); stepTo(0); };  // la zone de choix se réduit : la lecture en cours passe au premier plan
      st.el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      try {
        const text = await readImage(file, p => { if (!el.isConnected) my.abort(); else if (ctrl === my) st.set(p); }, my.signal);
        if (ctrl !== my) return;
        paste.value = text;
        if (text.replace(/\s/g, '').length < 3) { st.fail(x.noText); reset(); }
        else { st.done(text.length); showParsed(text); }
      } catch (err) {
        if (ctrl !== my) return;
        if (err?.name === 'AbortError') { fill(stageBox); reset(); if (el.isConnected) { toast(x.stopped); paste.focus(); } } else { st.fail(l.cust.scanFail); reset(); }
      } finally { if (ctrl === my) ctrl = null; }
    };
    const setText = t => { paste.value = t; showParsed(t); };
    const inputId = `scan-in-${Math.random().toString(36).slice(2, 7)}`;
    const input = h('input', { type: 'file', accept: 'image/*', class: 'sr', id: inputId, onchange: e => { const f = e.target.files[0]; if (f) runFile(f); e.target.value = ''; } });
    const clip = navigator.clipboard || {};
    const pasteAny = async () => {
      try {
        if (clip.read) for (const item of await clip.read()) { const type = item.types.find(t => t.startsWith('image/')); if (type) { runFile(await item.getType(type)); return; } }
        const t = clip.readText ? await clip.readText() : '';
        if (t.trim()) setText(t); else toast(x.clipEmpty);
      } catch { toast(x.clipDenied); }
    };
    const drop = h('label', { class: 'dropzone scan-pick', for: inputId,
      ondragover: e => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
      ondrop: e => { e.preventDefault(); drop.classList.remove('over'); const f = [...(e.dataTransfer?.files || [])].find(ff => /^image\//.test(ff.type)); if (f) runFile(f); } },
      icon('scan'), h('b', { text: x.pick }), h('span', { class: 'hint', text: x.pickHint }));
    // Ctrl+V d'une capture n'importe où sur l'écran, tant que le bloc est affiché
    const listen = new AbortController();
    document.addEventListener('paste', e => {
      if (!el.isConnected) { listen.abort(); return; }
      const f = [...(e.clipboardData?.files || [])].find(ff => /^image\//.test(ff.type));
      if (f) { e.preventDefault(); runFile(f); }
    }, { signal: listen.signal });
    const dict = dictate(paste, t => showParsed(t));
    const el = h('div', { class: 'scan-flow stack' }, steps,
      h('p', { class: 'muted', text: l.cust.scanHint }),
      h('div', { class: 'scan-sources' }, drop, input,
        h('div', { class: 'scan-alt' },
          clip.read || clip.readText ? btn(x.pasteAny, pasteAny, '', 'copy') : null,
          btn(x.sample, async () => runFile(await sampleShot()), '', 'image'))),
      h('p', { class: 'hint', text: x.shareHint }),
      stageBox,
      h('div', { class: 'sub-panel stack scan-text' }, field(x.textLabel, paste, x.textHint),
        h('div', { class: 'row' }, dict, btn(x.analyse, () => showParsed(paste.value), 'small primary', 'search')),
        Speech ? h('p', { class: 'note', text: l.voice.privacy }) : null),
      out);
    const stop = () => { ctrl?.abort(); ctrl = null; dict.stop?.(); listen.abort(); if (scanOff === stop) scanOff = null; };
    scanOff = stop;
    return { el, runFile, setText, stop };
  }

  // Étape 3 : chaque information trouvée devient un champ modifiable avec son verdict ; seules les cases cochées sont reprises.
  // Les champs vides restent proposés pour être complétés au clavier. Tant qu'un champ coché est à corriger, les actions sont bloquées.
  function review(found, text, actions) {
    const l = L(), x = l.scanx, v = l.verify;
    const handle0 = found.handles.find(hh => hh.toLowerCase() !== `@${S.shop.instagram}`.toLowerCase()) || '';
    const amount0 = found.agreed ?? (found.amounts.length ? found.amounts[found.amounts.length - 1] : null);
    const F = {
      name: { on: !!found.names[0], val: found.names[0] || '', alts: found.names },
      phone: { on: !!found.phones[0], val: found.phones[0] || '', alts: found.phones },
      email: { on: !!found.emails[0], val: found.emails[0] || '', alts: found.emails },
      handle: { on: !!handle0, val: handle0, alts: found.handles.filter(hh => hh.toLowerCase() !== `@${S.shop.instagram}`.toLowerCase()) },
      address: { on: !!found.addresses[0], val: { ...(found.addresses[0] || { street: '', zip: '', city: '' }) }, alts: found.addresses.map(fmtAddr) },
      amount: { on: amount0 != null, val: amount0 ?? '', alts: found.amounts.map(a => String(a)) },
    };
    const verdict = k => E.checkField(k, F[k].val);
    const summary = h('p', { class: 'row verify-sum', role: 'status' });
    const acts = h('div', { class: 'stack' });
    const current = () => {
      const on = k => F[k].on && verdict(k) === 'ok';
      const amt = on('amount') ? E.toAmount(F.amount.val) : null;
      const hd = String(F.handle.val).trim();
      return { names: on('name') ? [F.name.val.trim()] : [], phones: on('phone') ? [F.phone.val.trim()] : [], emails: on('email') ? [F.email.val.trim()] : [],
        handles: on('handle') ? [hd.startsWith('@') ? hd : `@${hd}`] : [], addresses: on('address') ? [{ ...F.address.val }] : [],
        amounts: amt != null ? [amt] : [], agreed: amt };
    };
    const rows = {};
    const paintRow = k => {
      const r = rows[k], ver = verdict(k);
      r.el.className = `verify-row ${F[k].on ? ver : 'off'}`;
      fill(r.badge, ver === 'ok' ? [icon('check'), v.ok] : ver === 'bad' ? [icon('alert'), v.bad[k]] : v.empty);
    };
    const refresh = () => {
      Object.keys(F).forEach(paintRow);
      const kept = Object.keys(F).filter(k => F[k].on && verdict(k) !== 'empty');
      const bad = kept.filter(k => verdict(k) === 'bad');
      const said = kept.length ? v.sum(kept.length, bad.length) : v.nothing;
      if (summary.textContent !== said) fill(summary, icon(bad.length ? 'alert' : 'check'), h('span', { text: said }));
      summary.className = `row verify-sum ${bad.length ? 'bad' : kept.length ? 'ok' : ''}`;
      fill(acts, bad.length ? h('p', { class: 'hint', text: v.blocked }) : null, actions(current(), text));
      if (bad.length || !kept.length) acts.querySelectorAll('button').forEach(b => { b.disabled = true; });
    };
    const touch = k => { F[k].on = verdict(k) !== 'empty'; rows[k].box.checked = F[k].on; refresh(); };  // écrit = coché, vidé = décoché
    const input = (k, attrs) => h('input', Object.assign({ class: 'input', value: F[k].val, autocomplete: 'off', oninput: e => { F[k].val = e.target.value; touch(k); } }, attrs));
    const editors = {
      name: () => input('name', { placeholder: v.ph.name }),
      phone: () => input('phone', { type: 'tel', inputmode: 'tel', placeholder: '+32 470 00 00 00' }),
      email: () => input('email', { type: 'email', inputmode: 'email', placeholder: 'nom@exemple.be' }),
      handle: () => input('handle', { placeholder: '@compte' }),
      address: () => addressFields(F.address.val, () => touch('address')),
      amount: () => h('input', { class: 'input money', inputmode: 'decimal', value: F.amount.val, placeholder: '0', oninput: e => { F.amount.val = e.target.value; touch('amount'); } }),
    };
    const labels = { name: l.cust.name, phone: l.cust.phone, email: l.cust.email, handle: l.cust.handle, address: l.deliv.address, amount: v.price };
    const list = Object.keys(F).map(k => {
      const box = h('input', { type: 'checkbox', checked: F[k].on, 'aria-label': v.keep(labels[k]), onchange: e => { F[k].on = e.target.checked; refresh(); } });
      const badge = h('span', { class: 'verdict' });
      const ed = h('div', {}, editors[k]());
      const others = F[k].alts.length > 1 ? h('div', { class: 'chips small' }, h('span', { class: 'hint', text: v.others }),
        F[k].alts.map((a, i) => h('button', { type: 'button', text: a, onclick: () => {
          F[k].val = k === 'address' ? { ...found.addresses[i] } : k === 'amount' ? found.amounts[i] : a;
          fill(ed, editors[k]()); touch(k);
        } }))) : null;
      const el = h('div', { class: 'verify-row' }, h('label', { class: 'verify-keep' }, box, h('span', { class: 'box' })),
        h('div', { class: 'verify-main' }, h('div', { class: 'verify-head' }, h('b', { text: labels[k] }), badge), ed, others));
      rows[k] = { el, box, badge };
      return el;
    });
    refresh();
    return h('section', { class: 'verify stack', 'aria-label': x.steps[2] }, h('h3', { text: v.title }), summary, h('p', { class: 'hint', text: v.hint }), list, acts);
  }

  function scanSheet(onApply) {
    const l = L();
    let ui = null;
    sheet(l.cust.scan, close => (ui = scanUI((c, text) => [btn(l.cust.apply, () => { onApply(c, text); close(); }, 'primary big', 'check')])).el, () => ui?.stop());
  }

  /* ---------- Écran « Scanner » : capture partagée depuis WhatsApp, Instagram, SMS ou la galerie ---------- */
  let pendingScan = null;
  function viewScan(q) {
    const l = L(), x = l.scanx;
    const forSale = S.pieces.filter(p => ['live', 'reserved'].includes(p.status) && !p.saleId);
    let pick = forSale[0]?.id || '';  // gardé quand les actions se redessinent pendant la vérification
    const ui = scanUI((c, text) => {
      const known = E.matchCustomer({ ...c, handles: c.handles.filter(hh => hh.toLowerCase() !== `@${S.shop.instagram}`) }, S.customers);
      return [
        known ? h('p', { class: customer(known).status === 'fake' ? 'alert bad' : 'alert good' }, icon(customer(known).status === 'fake' ? 'alert' : 'user'), l.sellx.known(customer(known).name)) : null,
        h('div', { class: 'sub-panel stack' }, h('h3', { text: x.sellTitle }),
          field(x.whichPiece, h('select', { class: 'input', onchange: e => { pick = e.target.value; } },
            forSale.map(p => h('option', { value: p.id, selected: p.id === pick, text: `n° ${p.no} ${title(p)} — ${money(p.price || 0)}${isPrivate(p) ? ` (${l.scope.private})` : ''}` })))),
          btn(x.sellGo, () => { if (!pick) return; pendingScan = { found: c, text }; go(`#/sell/${pick}?fromscan=1`); }, 'primary big', 'sales')),
        btn(known ? x.updateCust : x.newCust, () => {
          if (known) { const k = customer(known); mergeContact(k, c); k.conv = text.slice(0, 600); save(); toast(l.cust.saved); go(`#/customer/${known}`); return; }
          custDraft = { id: '', name: '', handle: '', channel: 'instagram', phone: '', email: '', status: 'ok', addresses: [], notes: '', since: TODAY, conv: text.slice(0, 600) };
          mergeContact(custDraft, c); go('#/customer/new');
        }, '', 'user')];
    });
    // capture ou texte partagés vers l'app installée (Android : « Partager → Etiket »), déposés par le service worker
    if ('caches' in window) caches.open('etiket-share').then(async cache => {
      const shotRes = await cache.match('shared-shot'), textRes = await cache.match('shared-text');
      if (shotRes) { ui.runFile(await shotRes.blob()); await cache.delete('shared-shot'); }
      if (textRes) { const t = await textRes.text(); await cache.delete('shared-text'); if (!shotRes && t.trim()) ui.setText(t); }
    }).catch(() => {});
    // « Essayer avec l'exemple » depuis la visite : la capture fictive est lue tout de suite
    if (q?.get('demo')) { history.replaceState(null, '', '#/scan'); sampleShot().then(ui.runFile); }
    return [head(l.cust.scan, x.intro), h('div', { class: 'cols' }, h('div', {}, ui.el),
      panel(x.howT, null, h('ol', { class: 'bullets' }, x.how.map(s => h('li', { text: s })))))];
  }

  /* ---------- Envoyer au client : message prêt, ouvert dans WhatsApp, SMS, Instagram, e-mail ou le partage du téléphone ---------- */
  function firstName(c) { const n = (c?.name || '').replace(/\s*\(.*\)$/, '').replace(/^@/, '').split(/[\s._]/)[0]; return n ? n[0].toUpperCase() + n.slice(1) : (P.lang === 'nl' ? 'klant' : 'client'); }
  function saleMsgData(s) {
    const b = buyer(s), p = piece(s.pieces[0]);
    const promisedAmt = s.payments.filter(y => y.state === 'promised').reduce((t, y) => t + y.amount, 0);
    return { name: firstName(b.c), item: p ? title(p) : '', price: money(Math.abs(s.price)), amount: promisedAmt ? money(promisedAmt) : '', ogm: ogmOf(s), iban: S.shop.iban, shop: S.shop.name,
      date: s.delivery?.date ? E.date(s.delivery.date) : '', slot: s.delivery?.slot || '', address: s.delivery?.address ? fmtAddr(s.delivery.address) : '', no: s.no };
  }
  function saleKinds(s) {
    const b = buyer(s), kinds = [s.private ? 'c2c' : b.type === 'b2b' ? 'b2b' : 'b2c'];
    if (s.payments.some(y => y.state === 'promised')) kinds.push('deposit');
    if (s.delivery?.mode === 'delivery' && s.delivery.date) kinds.push('delivery');
    kinds.push('address');
    return kinds;
  }
  function sendSheet(c, kinds, data, first) {
    const l = L(), x = l.sendx;
    sheet(x.title, () => {
      let kind = first || kinds[0];
      const ta = h('textarea', { class: 'input', rows: 7 });
      const links = h('div', { class: 'send-grid' });
      const a = (href, label, ic, blank, extra) => h('a', { href, class: 'btn big', target: blank ? '_blank' : null, rel: blank ? 'noopener noreferrer' : null, onclick: extra }, icon(ic), label);
      const paintLinks = () => {
        const k = E.contactLinks(c || {}, ta.value);
        fill(links,
          k.whatsapp ? a(k.whatsapp, 'WhatsApp', 'chat', true) : null,
          k.sms ? a(k.sms, 'SMS', 'chat', false) : null,
          k.instagram ? a(k.instagram, 'Instagram', 'instagram', true, () => copy(ta.value)) : null,
          k.email ? a(k.email, 'E-mail', 'mail', false) : null,
          navigator.share ? btn(x.share, () => navigator.share({ text: ta.value }).catch(() => {}), 'big', 'share') : null,
          btn(l.piece.copy, () => copy(ta.value), 'big', 'copy'));
      };
      const paint = () => { ta.value = E.message(kind, data, P.lang); paintLinks(); };
      ta.addEventListener('input', paintLinks);
      paint();
      return h('div', { class: 'stack' },
        kinds.length > 1 ? h('div', { class: 'choices cols' }, kinds.map(k => radio('kind', k, x.kinds[k], v => { kind = v; paint(); }, k === kind))) : null,
        field(x.message, ta),
        h('p', { class: 'hint', text: c ? x.to([c.name, c.phone, c.handle].filter(Boolean).join(' — ')) : x.noContact }),
        links, h('p', { class: 'note', text: x.note }));
    });
  }
  // Partager l'annonce avec sa photo : sur téléphone, Instagram, Facebook (Marketplace), WhatsApp… apparaissent dans la feuille de partage.
  const shareFiles = new Map();  // photo prête avant le geste : Safari refuse un partage lancé trop longtemps après le toucher
  async function prepareShare(p) {
    if (shareFiles.has(p.id)) return;
    shareFiles.set(p.id, null);
    try {
      const src = p.images?.[0] || (hasPhoto(p) ? p.photo : null);
      if (src) { const blob = await (await fetch(src)).blob(); shareFiles.set(p.id, new File([blob], `piece-${p.no}.jpg`, { type: blob.type || 'image/jpeg' })); }
    } catch { shareFiles.set(p.id, null); }
  }
  async function shareListing(p) {
    const l = L(), text = fullListing(p, P.lang), file = shareFiles.get(p.id);
    try {
      if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
      if (navigator.share) { await navigator.share({ text }); return; }
    } catch (err) { if (err?.name === 'AbortError') return; }
    copy(text); toast(l.sendx.copiedShare);
  }

  function mergeContact(c, found) {
    if (found.phones[0] && !c.phone) c.phone = found.phones[0];
    if (found.emails[0] && !c.email) c.email = found.emails[0];
    if (found.handles[0] && !c.handle) { c.handle = found.handles[0]; c.channel = c.channel || 'instagram'; }
    if (found.names?.[0] && (!c.name || c.name === c.handle)) c.name = found.names[0];
    if (!c.name && c.handle) c.name = c.handle;
    for (const a of found.addresses) if (!c.addresses.some(x => sameAddr(x, a))) c.addresses.push(a);
  }
  let custDraft = null;
  function viewCustomers(q) {
    const l = L(), f = q.get('f') || 'all', term = (q.get('q') || '').toLowerCase();
    let list = S.customers.filter(c => f === 'all' || c.status === f);
    if (term) list = list.filter(c => [c.name, c.handle, c.phone, c.email, ...c.addresses.map(fmtAddr)].join(' ').toLowerCase().includes(term));
    const startScan = () => scanSheet((found, text) => {
      custDraft = { id: '', name: '', handle: '', channel: 'instagram', phone: '', email: '', status: 'ok', addresses: [], notes: '', since: TODAY, conv: text.slice(0, 600) };
      mergeContact(custDraft, found); go('#/customer/new');
    });
    return [
      head(l.cust.title, `${S.customers.length}`, btn(l.cust.scan, startScan, 'tagged', 'scan'), link('#/customer/new', { class: 'btn' }, icon('plus'), l.cust.new)),
      h('div', { class: 'row toolbar' }, h('input', { class: 'input', type: 'search', placeholder: l.cust.search, 'aria-label': l.cust.search, value: q.get('q') || '',
        onchange: e => go(`#/customers?f=${f}&q=${encodeURIComponent(e.target.value)}`) })),
      chips([['all', l.sales.all, S.customers.length], ...['ok', 'watch', 'fake'].map(k => [k, l.cust.st[k], S.customers.filter(c => c.status === k).length])], f, k => go(`#/customers?f=${k}`)),
      list.length ? h('ul', { class: 'list' }, list.map(c => {
        const sales = S.sales.filter(s => s.customer === c.id && !s.credit);
        return h('li', {}, h('span', { class: 'avatar', text: c.name.replace(/^@/, '').slice(0, 1).toUpperCase() }),
          link(`#/customer/${c.id}`, { class: 'main rowlink' }, h('b', { text: c.name }), h('span', { text: [c.handle, l.cust.channels[c.channel], c.phone].filter(Boolean).join(' — ') })),
          h('span', { class: 'amt', text: money(sales.filter(s => !s.cancelled).reduce((t, s) => t + s.price, 0)) }),
          h('div', { class: 'sub' }, pill(c.status === 'ok' ? 'live' : c.status === 'watch' ? 'reserved' : 'sold', l.cust.st[c.status]),
            c.addresses[0] ? h('span', { class: 'muted', text: fmtAddr(c.addresses[0]) }) : null));
      })) : h('p', { class: 'muted', text: l.cust.empty }),
      panel(l.cust.igT, pill('live', l.payments.connected), h('p', { class: 'muted', text: l.cust.ig }))
    ];
  }
  function viewCustomer(id) {
    const l = L();
    const existing = id !== 'new' ? customer(id) : null;
    if (id !== 'new' && !existing) return viewCustomers(new URLSearchParams());
    const c = existing ? clone(existing) : (custDraft || { id: '', name: '', handle: '', channel: 'instagram', phone: '', email: '', status: 'ok', addresses: [], notes: '', since: TODAY });
    const form = h('div', { class: 'stack' });
    const inp = (k, ph, type = 'text') => h('input', { class: 'input', type, value: c[k] || '', placeholder: ph || '', oninput: e => { c[k] = e.target.value; } });
    const paint = () => fill(form,
      h('div', { class: 'grid2' }, field(l.cust.name, inp('name')), field(l.cust.handle, inp('handle', '@'))),
      /^@?[A-Za-z0-9._]{1,30}$/.test(c.handle || '') ? igLink(`https://www.instagram.com/${c.handle.replace(/^@/, '')}/`, l.igx.seeCustomer(c.handle)) : null,
      h('div', { class: 'grid2' }, field(l.cust.phone, inp('phone', '+32 4…', 'tel')), field(l.cust.email, inp('email', '', 'email'))),
      h('div', { class: 'grid2' }, field(l.cust.channel, h('select', { class: 'input', onchange: e => { c.channel = e.target.value; } },
        Object.entries(l.cust.channels).map(([k, v]) => h('option', { value: k, selected: c.channel === k, text: v })))),
        field(l.sell.vat, h('input', { class: 'input', value: c.vat || '', placeholder: P.lang === 'nl' ? 'enkel voor een bedrijf' : 'seulement pour une entreprise', oninput: e => { c.vat = e.target.value || undefined; } }))),
      h('p', { class: 'lbl', text: l.cust.status }),
      h('div', { class: 'choices cols' }, ['ok', 'watch', 'fake'].map(k => radio('st', k, l.cust.st[k], v => { c.status = v; }, c.status === k))),
      h('h3', { text: l.cust.addresses }),
      c.addresses.map((a, i) => h('div', { class: 'sub-panel stack' }, addressFields(a), btn(l.cust.remove, () => { c.addresses.splice(i, 1); paint(); }, 'small danger', 'trash'))),
      btn(l.cust.addAddress, () => { c.addresses.push({ street: '', zip: '', city: '' }); paint(); }, 'small', 'plus'),
      field(l.cust.notes, h('textarea', { class: 'input', oninput: e => { c.notes = e.target.value; } }, c.notes || '')),
      c.conv ? h('details', {}, h('summary', { text: l.cust.read }), h('pre', { class: 'code', text: c.conv })) : null);
    paint();
    const saveIt = () => {
      c.addresses = c.addresses.filter(a => a.street || a.city);
      if (!c.name.trim() && !c.handle) { toast(l.cust.name); return; }
      if (!c.name.trim()) c.name = c.handle;
      if (existing) Object.assign(existing, c); else { c.id = `c${Date.now()}`; S.customers.push(c); }
      custDraft = null; save(); toast(l.cust.saved); go(`#/customer/${existing ? existing.id : c.id}`);
    };
    const sales = existing ? S.sales.filter(s => s.customer === existing.id) : [];
    return [
      crumb('#/customers', l.cust.title),
      head(existing ? existing.name : l.cust.new, existing ? l.cust.since(E.date(existing.since)) : null,
        btn(l.cust.scan, () => scanSheet(found => { mergeContact(c, found); paint(); }), 'tagged', 'scan'),
        existing ? btn(l.sendx.write, () => sendSheet(existing, ['address'], { name: firstName(existing) }), '', 'chat') : null,
        btn(l.cust.save, saveIt, 'primary', 'check')),
      c.status === 'fake' ? h('p', { class: 'alert bad' }, icon('alert'), l.cust.fakeWarn) : null,
      h('div', { class: 'cols' }, panel(null, null, form),
        panel(l.cust.sales, null, sales.length ? h('ul', { class: 'list' }, sales.map(s => { const p = piece(s.pieces[0]);
          return h('li', {}, h('span', { class: 'lead' }, icon(s.credit ? 'sync' : 'sales')), link(`#/sale/${s.id}`, { class: 'main rowlink' }, h('b', { text: `${s.no} — ${p ? title(p) : ''}` }),
            h('span', { text: `${E.date(s.date)}${s.delivery?.mode === 'delivery' ? ` — ${l.deliv.st[s.delivery.status] || ''}` : ''}` })), h('span', { class: `amt ${s.price < 0 ? 'neg' : ''}`, text: money(s.price) })); }))
          : h('p', { class: 'muted', text: '—' })))
    ];
  }

  /* ---------- Paiements ---------- */
  function viewPayments(q) {
    const l = L(), f = q.get('f') || 'all';
    const list = (f === 'match' ? unmatched() : S.feed).filter(y => !y.private);
    const month = TODAY.slice(0, 7);
    const row = y => {
      const s = y.saleId ? sale(y.saleId) : null;
      let sub = null;
      if (s) sub = link(`#/sale/${s.id}`, { class: 'pill live', text: `${l.payments.matched} : ${s.no}` });
      else if (y.payout) sub = h('span', { class: 'muted', text: l.payments.settlementNote });
      else {
        const cands = [...new Set(E.matchPayment(y, matchables()).map(c => c.id))].map(sale);
        const pcs = S.pieces.filter(p => !isPrivate(p) && ['live', 'reserved'].includes(p.status) && !p.saleId && p.price === y.amount);
        sub = [cands.map(c => btn(`${l.payments.match} : ${c.no} (${buyer(c).name})`, () => {
          const pending = c.payments.find(z => z.state === 'promised' && z.amount === y.amount);
          if (pending) { pending.state = 'validated'; pending.date = y.date; } else c.payments.push({ id: `y${Date.now()}`, method: y.method, amount: y.amount, date: y.date });
          y.saleId = c.id; settle(c); save(); render(); toast(`${l.payments.matched} : ${c.no}`);
        }, 'small primary', 'link')),
        pcs.slice(0, 2).map(p => link(`#/sell/${p.id}?pay=${y.id}`, { class: 'btn small' }, icon('sales'), l.payments.createSale(`n° ${p.no} ${title(p)}`)))];
      }
      return h('li', {}, h('span', { class: 'lead' }, icon(y.source === 'bank' ? 'accounting' : y.source === 'cash' ? 'sales' : 'payments')),
        h('span', { class: 'main' }, h('b', { text: y.from }), h('span', { text: `${l.pay[y.method] || y.method} — ${E.date(y.date)} ${y.time || ''}${y.fee ? ` — ${l.payments.fee(money(y.fee))}` : ''}` })),
        h('span', { class: `amt ${y.amount < 0 ? 'neg' : ''}`, text: money(y.amount) }), h('div', { class: 'sub' }, sub));
    };
    const refunds = S.refunds.filter(r => r.state === 'due');
    return [
      head(l.payments.title, `${l.kCashed} : ${money(S.feed.filter(x => x.date.startsWith(month) && x.amount > 0 && !x.private).reduce((t, x) => t + x.amount, 0))}`),
      chips([['all', l.payments.all, S.feed.filter(y => !y.private).length], ['match', l.payments.toMatch, unmatched().filter(y => !y.private).length]], f, k => go(`#/payments?f=${k}`)),
      h('div', { class: 'cols-3' },
        panel(null, null, list.length ? h('ul', { class: 'list' }, list.map(row)) : h('p', { class: 'muted', text: l.payments.unmatchedNone })),
        h('div', { class: 'stack' },
          panel(l.dep.list, null, promised().length ? h('ul', { class: 'list' }, promised().map(({ s, y }) => h('li', {}, h('span', { class: 'lead' }, icon('clock')),
            link(`#/sale/${s.id}`, { class: 'main rowlink' }, h('b', { text: `${s.no}, ${buyer(s).name}` }), h('span', { text: `${l.pay[y.method] || ''} — ${E.date(y.date)}` })),
            h('span', { class: 'amt', text: money(y.amount) }), h('div', { class: 'sub' }, btn(l.dep.validate, () => validateDeposit(s, y), 'small primary', 'check')))))
            : h('p', { class: 'muted', text: '—' }), h('p', { class: 'note', text: l.dep.note })),
          refunds.length ? panel(l.cancel.refunds, null, h('ul', { class: 'list' }, refunds.map(r => { const s = sale(r.sale);
            return h('li', {}, h('span', { class: 'lead' }, icon('payments')), h('span', { class: 'main' }, h('b', { text: `${s?.no || ''}, ${s ? buyer(s).name : ''}` })),
              h('span', { class: 'amt', text: money(r.amount) }), h('div', { class: 'sub' }, btn(l.cancel.refundDone, () => {
                r.state = 'done'; S.feed.unshift({ id: `f${Date.now()}`, date: TODAY, time: new Date().toTimeString().slice(0, 5), source: 'bank', method: 'transfer', amount: -r.amount, from: `${P.lang === 'nl' ? 'Terugbetaling' : 'Remboursement'} ${s?.no || ''}`, saleId: r.sale, payout: true });
                save(); render(); }, 'small', 'check'))); }))) : null,
          panel(l.payments.sources, null, h('ul', { class: 'list' },
            [[l.payments.srcMollie, l.payments.connected], [l.payments.srcBank, `${l.payments.connected} (${l.payments.srcBankHint})`], [l.payments.srcCash, l.payments.connected]]
              .map(([a, b2]) => h('li', {}, h('span', { class: 'lead' }, icon('payments')), h('span', { class: 'main' }, h('b', { text: a }), pill('live', b2))))))))
    ];
  }

  /* ---------- Annonces et Instagram ---------- */
  function importPost(post) {
    const l = L(), x = E.parseCaption(post.caption);
    const no = S.nextNo++;
    const p = { id: `p${no}`, no, cat: guessCat(x.title), status: 'draft', price: x.price, purchase: null, origin: 'particulier', bought: post.date, photos: 1, tone: no % 8, photo: post.photo,
      title: { fr: x.title, nl: x.title, en: x.title }, notes: { fr: '', nl: '' }, dims: x.dims, state: x.state, source: 'ig', ig: post.gone ? undefined : post.code, seller: { name: '', kind: 'particulier' },
      listings: { ig: { state: 'live', url: igPostUrl(post) } } };
    S.pieces.push(p); post.imported = p.id; save(); toast(l.ig.created);
    return p;
  }
  function importFamily(post) {
    const l = L(), x = E.parseCaption(post.caption);
    sheet(l.igx.family, close => {
      let owner = '', price = x.price;
      return h('form', { class: 'stack', onsubmit: e => {
        e.preventDefault(); if (!owner.trim() || !(price > 0)) return;
        const no = S.nextPrivNo++;
        S.pieces.push({ id: `p${no}`, no, cat: guessCat(x.title), status: 'live', price, scope: 'private', owner: owner.trim(), bought: post.date, photos: 1, tone: no % 8, photo: post.photo,
          title: { fr: x.title, nl: x.title }, dims: x.dims, state: x.state, notes: { fr: '', nl: '' }, ig: post.gone ? undefined : post.code, source: 'ig',
          listings: { ig: { state: 'live', url: igPostUrl(post) } } });
        post.imported = `p${no}`; save(); close(); toast(l.broc.added); go(`#/piece/p${no}`);
      } }, h('p', { class: 'alert' }, icon('alert'), l.broc.rule),
      h('p', { class: 'alert' }, icon('alert'), l.igx.shopWarn),
      field(l.igx.owner, h('input', { class: 'input', placeholder: l.broc.ownerP, oninput: e => { owner = e.target.value; } })),
      field(l.broc.price, numIn(price, v => { price = v; })),
      h('button', { type: 'submit', class: 'btn primary big', text: l.igx.family }));
    });
  }
  const guessCat = t => (/sideboard|enfilade|buffet|dressoir/i.test(t) ? 'sideboard' : /armchair|fauteuil/i.test(t) ? 'armchair' : /chair|chaise|stoel/i.test(t) ? 'chair'
    : /table/i.test(t) ? 'table' : /desk|bureau/i.test(t) ? 'desk' : /sofa|canapé|zetel/i.test(t) ? 'sofa' : /lamp|lampe/i.test(t) ? 'lamp' : /mirror|miroir/i.test(t) ? 'mirror'
    : /wardrobe|armoire|nightstand|chevet|commode|chest/i.test(t) ? 'chest' : /shelf|étagère|hanger|portemanteau/i.test(t) ? 'shelf' : 'other');
  function viewListings() {
    const l = L();
    const rem = toRemove();
    const ready = S.pieces.filter(p => p.status === 'live' && !isPrivate(p)).flatMap(p => CHANNELS.filter(ch => ch !== 'site' && ch !== 'ig' && p.listings?.[ch]?.state === 'draft').map(ch => ({ p, ch })));
    const ta = h('textarea', { class: 'input', rows: 4, placeholder: 'https://www.instagram.com/p/…\nhttps://www.facebook.com/marketplace/item/…\nhttps://www.2ememain.be/v/…', 'aria-label': l.listings.importT });
    const importLinks = () => {
      const urls = ta.value.split(/\s+/).map(s => safeUrl(s)).filter(Boolean);
      let n = 0;
      for (const url of urls) {
        const ch = channelOf(url); if (!ch) continue;
        if (S.pieces.some(p => Object.values(p.listings || {}).some(x => x.url === url))) continue;
        const no = S.nextNo++;
        S.pieces.push({ id: `p${no}`, no, cat: 'other', status: 'draft', price: null, origin: null, bought: TODAY, photos: 0, images: [], tone: no % 8, source: ch,
          title: { fr: '', nl: '' }, notes: { fr: '', nl: '' }, dims: '', state: 'good', listings: { [ch]: { state: 'live', url } } });
        n++;
      }
      save(); render(); toast(n ? l.listings.imported(n) : l.listings.importNone);
    };
    const pieceRow = (p, ch, acts) => h('li', {}, h('span', { class: 'lead thumb' }, photoEl(p)),
      link(`#/piece/${p.id}`, { class: 'main rowlink' }, h('b', { text: `n° ${p.no} ${title(p)}` }), h('span', { text: chLabel(ch) })), h('span', {}),
      h('div', { class: 'sub' }, acts, (() => {
        const ig = igHref(p);
        if (acts.some(a => a?.getAttribute?.('href') === ig) || (isPrivate(p) && ig === igProfile())) return null;
        return igLink(ig, ig === igProfile() ? l.igx.seeProfile(S.shop.instagram) : l.igx.seePost);
      })()));
    return [
      head(l.listings.title, l.listings.intro),
      h('section', { class: 'ig-band' },
        h('div', { class: 'ig-head' }, h('div', {}, h('h2', { class: 'row' }, icon('instagram'), l.ig.title), h('p', { class: 'muted', text: `${l.ig.connected} — ${l.ig.last(`${E.date(S.ig.lastSync.slice(0, 10))} ${S.ig.lastSync.slice(11)}`)}` }),
          igLink(igProfile(), l.igx.seeProfile(S.shop.instagram))),
          h('div', { class: 'row' }, h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: S.ig.auto, onchange: e => { S.ig.auto = e.target.checked; save(); } }), h('span', { text: l.ig.auto })),
            btn(l.ig.sync, () => { S.ig.lastSync = stamp(); save(); render(); toast(l.ig.synced); }, 'small', 'sync'))),
        newPosts().length ? h('div', { class: 'ig-posts' }, newPosts().map(post => { const x = E.parseCaption(post.caption);
          return h('article', { class: 'ig-post' }, h('div', { class: 'card-ph' }, photoEl({ photo: post.photo, cat: guessCat(x.title), tone: 3, photos: 1 }),
            x.price ? h('div', { class: 'tag' }, h('span', { class: 'price', text: money(x.price).replace(',00', '') })) : null),
            h('div', { class: 'ig-post-body' }, h('b', { class: 't', text: x.title }),
              h('span', { class: 'muted', text: [x.dims, E.date(post.date)].filter(Boolean).join(' · ') }),
              igLink(igPostUrl(post), post.gone ? l.igx.seeProfile(S.shop.instagram) : l.igx.seePost)),
            h('div', { class: 'ig-post-acts' }, btn(l.ig.create, () => { const p = importPost(post); go(`#/add/${p.id}`); }, 'small primary', 'plus'),
              btn(l.igx.family, () => importFamily(post), 'small', 'tent')));
        })) : h('p', { class: 'muted', text: l.ig.none }),
        h('details', { class: 'how' }, h('summary', { text: l.ig.howT }), h('ol', {}, l.ig.how.map(x => h('li', { text: x }))), h('p', { class: 'note', text: l.ig.fbNote }))),
      h('div', { class: 'cols' },
        h('div', { class: 'stack' },
          panel(l.listings.toRemove, null, rem.length ? h('ul', { class: 'list' }, rem.map(({ p, ch, l: lst }) => pieceRow(p, ch, [lst.url ? ext(lst.url, l.lstSeen) : null,
            btn(l.lstRemoved, () => { lst.state = 'removed'; save(); render(); toast(l.lstRemoved); }, 'small primary', 'check')]))) : h('p', { class: 'muted', text: '—' })),
          panel(l.listings.toPublish, null, ready.length ? h('ul', { class: 'list' }, ready.map(({ p, ch }) => pieceRow(p, ch, [
            btn(l.piece.copy, () => copy(fullListing(p, P.lang)), 'small', 'copy'), ext(createUrl(ch), l.lstOpen), btn(l.lstDone, () => published(p, ch), 'small primary', 'check')])))
            : h('p', { class: 'muted', text: '—' })),
          h('p', { class: 'alert' }, icon('alert'), l.listings.honest)),
        h('div', { class: 'stack' },
          panel(l.listings.importT, null, h('p', { class: 'muted', style: 'margin-bottom:10px', text: l.listings.importHint }), ta,
            btn(l.listings.importBtn, importLinks, 'primary', 'download')),
          panel(l.listings.replies, null, h('div', { class: 'replies' }, l.replies.map(([qq, a]) => h('div', { class: 'textbox' }, h('b', { text: qq }), a,
            h('div', { style: 'margin-top:8px' }, btn(l.piece.copy, () => copy(a), 'small', 'copy')))))),
          panel(l.listings.admarkt, pill('none', l.listings.notConnected), h('p', { class: 'muted', text: l.listings.admarktHint }))))
    ];
  }

  /* ---------- Compta et Peppol ---------- */
  const PROVIDERS = [['yuki', 'Yuki', 'API'], ['exact', 'Exact Online', 'API'], ['octopus', 'Octopus', 'API'], ['winbooks', 'WinBooks', 'API'], ['odoo', 'Odoo', 'API'],
    ['billit', 'Billit', 'API + Peppol'], ['export', null, 'CSV + PDF + UBL']];
  const providerName = k => { const p = PROVIDERS.find(x => x[0] === k); return p?.[1] || L().acc.exportOnly; };
  let accTab = 'vat';
  function viewAccounting() {
    const l = L(), a = S.accounting;
    const rows = saleRows();
    const q = E.quarterOf(TODAY);
    const grids = E.quarterGrids(rows, q);
    const purchases = S.pieces.filter(p => !isPrivate(p) && p.status !== 'draft').slice().sort((x, y) => x.no - y.no);
    const comp = rows.filter(r => r.piece && E.regimeOf(r.piece) === 'margin');
    const tables = {
      purchases: () => h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, [l.acc.cols.no, l.acc.cols.item, l.acc.cols.date, l.acc.cols.from, l.acc.cols.price].map((c, i) => h('th', { class: i === 4 ? 'r' : null, text: c })))),
        h('tbody', {}, purchases.map(p => h('tr', {}, h('td', { text: String(p.no) }), h('td', { text: title(p) }), h('td', { text: E.date(p.bought) }),
          h('td', { text: p.origin === 'depot' ? `${depositor(p.depositor)?.name} (${l.filters.depot})` : p.seller?.name || '—' }),
          h('td', { class: 'r', text: p.origin === 'depot' ? '—' : money(p.purchase || 0) })))))),
      comparison: () => h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, [l.acc.cols.no, l.acc.cols.item, l.acc.cols.price, l.acc.cols.sold, l.acc.cols.sale, l.acc.cols.margin, l.acc.cols.vat]
        .map((c, i) => h('th', { class: [2, 4, 5, 6].includes(i) ? 'r' : null, text: c })))),
        h('tbody', {}, comp.map(r => { const x = E.saleTax(r.piece, Math.abs(r.price)), sg = Math.sign(r.price);
          return h('tr', {}, h('td', { text: `${r.piece.no}${r.sale.credit ? ` (${r.sale.no})` : ''}` }), h('td', { text: title(r.piece) }),
            h('td', { class: 'r', text: money(sg * x.purchase) }), h('td', { text: E.date(r.date) }), h('td', { class: 'r', text: money(r.price) }), h('td', { class: 'r', text: money(sg * x.margin) }), h('td', { class: 'r', text: money(sg * x.vat) })); })))),
      vat: () => h('div', { class: 'stack' }, h('div', { class: 'grids' }, ['g00', 'g01', 'g03', 'g54'].map(g => h('div', { class: 'grid-box' },
        h('span', { class: 'g', text: g.slice(1) }), h('b', { text: money(grids[g]) }), h('span', { text: l.acc.gridLabels[g] })))), h('p', { class: 'note', text: l.acc.vatNote })),
    };
    const tabBox = h('div', {}, tables[accTab]());
    const segBox = h('span', {});
    const paintSeg = () => fill(segBox, seg([['vat', l.acc.vatT], ['purchases', l.acc.purchases], ['comparison', l.acc.comparison]], accTab, k => { accTab = k; fill(tabBox, tables[k]()); paintSeg(); }));
    paintSeg();
    return [
      head(l.acc.title, null),
      h('div', { class: 'cols' },
        h('div', { class: 'stack' },
          panel(l.acc.link, null,
            h('p', { class: 'row', style: 'margin-bottom:12px' }, pill('live', l.acc.linked(providerName(a.provider))), h('span', { class: 'muted', text: l.acc.lastSync(`${E.date(a.lastSync.slice(0, 10))} ${a.lastSync.slice(11)}`) }),
              a.pending ? pill('reserved', l.acc.pending(a.pending)) : null),
            btn(l.acc.syncNow, () => { a.pending = 0; a.lastSync = stamp(); save(); render(); toast(l.acc.synced); }, 'primary', 'sync'),
            h('h3', { style: 'margin:18px 0 8px', text: l.acc.what }), h('ul', { class: 'bullets' }, l.acc.whatList.map(x => h('li', { text: x }))),
            h('h3', { style: 'margin:18px 0 8px', text: l.acc.choose }),
            h('div', { class: 'providers' }, PROVIDERS.map(([k, name, how]) => h('button', { type: 'button', class: 'provider', 'aria-pressed': String(a.provider === k),
              onclick: () => { a.provider = k; save(); render(); } }, h('b', { text: name || l.acc.exportOnly }), h('small', { text: how }))))),
          panel(l.acc.peppolT, null, h('p', { class: 'row' }, icon('peppol'), h('b', { class: 'num', text: S.shop.peppol }), pill('live', l.shopx.peppolSince(E.date(S.shop.peppolSince)))),
            h('p', { class: 'note', text: l.shopx.peppolExisting }),
            h('h3', { style: 'margin:16px 0 4px', text: l.acc.inbox }),
            h('ul', { class: 'list' }, S.inbox.map(i => h('li', {}, h('span', { class: 'lead' }, icon('accounting')),
              h('span', { class: 'main' }, h('b', { text: i.from }), h('span', { text: `${E.date(i.date)} — ${i.label[P.lang]}` })), h('span', { class: 'amt', text: money(i.amount) }),
              h('div', { class: 'sub' }, i.state === 'new' ? btn(l.acc.book, () => { i.state = 'booked'; a.pending++; save(); render(); }, 'small primary', 'check') : pill('live', l.acc.booked))))))),
        panel(l.acc.registers, segBox, h('p', { class: 'muted', style: 'margin-bottom:12px', text: l.acc.quarter(`${P.lang === 'nl' ? 'K' : 'T'}${q.slice(-1)} ${q.slice(0, 4)}`) }), tabBox,
          btn(l.acc.csv, downloadCsv, '', 'download'), h('p', { class: 'note', text: l.broc.noInvoice })))
    ];
  }
  function downloadCsv() {
    const n = x => (x == null ? '' : String(E.round2(x)).replace('.', ','));
    const cell = v => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@\t\r]/, "'$&")}"`;
    const head = ['document', 'numero', 'bien', 'date_achat', 'fournisseur', 'prix_achat', 'date_vente', 'prix_vente', 'regime', 'marge', 'base', 'tva', 'g00', 'g01', 'g03', 'g54'];
    const lines = [head.join(';')];
    for (const r of saleRows()) {
      const x = E.saleTax(r.piece, Math.abs(r.price)), g = x.grids, sg = Math.sign(r.price);
      lines.push([r.sale.no, r.piece.no, cell(title(r.piece)), E.date(r.piece.bought), cell(r.piece.origin === 'depot' ? depositor(r.piece.depositor)?.name : r.piece.seller?.name), n(sg * x.purchase), E.date(r.date), n(r.price),
        x.regime, n(sg * x.margin), n(sg * x.base), n(sg * x.vat), n(sg * g.g00), n(sg * g.g01), n(sg * g.g03), n(sg * g.g54)].join(';'));
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `registre-marge-${E.quarterOf(TODAY)}.csv` });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- Dépôt-vente ---------- */
  function viewConsign() {
    const l = L();
    return [
      head(l.consign.title, null),
      h('div', { class: 'cols' }, S.depositors.map(d => {
        const mine = S.pieces.filter(p => p.origin === 'depot' && p.depositor === d.id);
        const outs = S.payouts.filter(o => o.depositor === d.id && o.state !== 'cancelled');
        const due = outs.filter(o => o.state === 'due').reduce((t, o) => t + o.amount, 0);
        return panel(d.name, pill(due ? 'reserved' : 'live', due ? `${l.consign.due} ${money(due)}` : '0 €'),
          h('p', { class: 'muted', text: `${l.consign.commission(pct(d.commission))} — ${mine.filter(p => p.status !== 'sold').length} ${l.consign.inShop}, ${mine.filter(p => p.status === 'sold').length} ${l.consign.sold}` }),
          mine.length ? h('div', { class: 'hscroll', style: 'margin-top:12px' }, mine.map(cardEl)) : null,
          outs.length ? h('ul', { class: 'list', style: 'margin-top:8px' }, outs.map(o => {
            const p = piece(o.piece) || { no: '?', title: { fr: '—' } };
            return h('li', {}, h('span', { class: 'lead' }, icon('consign')), h('span', { class: 'main' }, h('b', { text: `n° ${p.no} ${title(p)}` }), h('span', { text: E.date(o.since) })),
              h('span', { class: 'amt', text: money(o.amount) }),
              h('div', { class: 'sub' }, o.state === 'due' ? btn(l.consign.pay, () => {
                copy(`${d.iban} — ${money(o.amount)} — ${E.structuredComm(Number(String(Date.now()).slice(-10)))}`); o.state = 'paid'; save(); render(); toast(l.consign.payoutDone);
              }, 'small primary', 'payments') : pill('live', l.consign.paid)));
          })) : null,
          h('p', { class: 'note', text: l.consign.payNote }));
      }))
    ];
  }

  /* ---------- Stand brocante (famille, hors activité) ---------- */
  function viewBrocante(q) {
    const l = L();
    const items = S.pieces.filter(isPrivate);
    const owners = [...new Set(items.map(p => p.owner))];
    const sales = S.sales.filter(s => s.private);
    const addItem = () => sheet(l.broc.add, close => {
      const f = { owner: owners[0] || '', title: '', price: null, cat: 'other', images: [], listings: {} };
      const ph = h('div', {});
      const input = h('input', { type: 'file', accept: 'image/*', class: 'sr', id: 'broc-photo', onchange: async e => { const d = e.target.files[0] && await shrink(e.target.files[0], 640); if (d) { f.images = [d]; fill(ph, h('img', { class: 'scan-preview', src: d, alt: '' })); } } });
      return h('form', { class: 'stack', onsubmit: e => {
        e.preventDefault(); if (!f.owner.trim() || !f.title.trim() || !(f.price > 0)) return;
        const no = S.nextPrivNo++;
        S.pieces.push({ id: `p${no}`, no, cat: f.cat, status: 'live', price: f.price, scope: 'private', owner: f.owner.trim(), bought: TODAY, photos: f.images.length, images: f.images, tone: no % 8,
          title: { fr: f.title, nl: f.title }, dims: '', state: 'fair', notes: { fr: '', nl: '' }, listings: f.listings });
        save(); close(); render(); toast(l.broc.added);
      } }, h('p', { class: 'alert' }, icon('alert'), l.broc.rule),
      field(l.broc.owner, h('input', { class: 'input', list: 'owners', value: f.owner, placeholder: l.broc.ownerP, oninput: e => { f.owner = e.target.value; } })),
      h('datalist', { id: 'owners' }, owners.map(o => h('option', { value: o }))),
      field(l.broc.item, h('input', { class: 'input', placeholder: l.broc.itemP, oninput: e => { f.title = e.target.value; } })),
      h('div', { class: 'grid2' }, field(l.broc.price, numIn(null, v => { f.price = v; })),
        field(l.add.catL, h('select', { class: 'input', onchange: e => { f.cat = e.target.value; } }, Object.keys(l.cat).map(k => h('option', { value: k, selected: k === 'other', text: l.cat[k] }))))),
      h('label', { class: 'dropzone', for: 'broc-photo' }, icon('camera'), l.add.takePhoto), input, ph,
      h('p', { class: 'lbl', text: l.famx.channels }),
      h('div', { class: 'choices cols' }, ['ig', 'fb', 'ad2', 'vinted'].map(k => h('label', { class: 'choice' }, h('input', { type: 'checkbox', onchange: e => { if (e.target.checked) f.listings[k] = { state: 'draft' }; else delete f.listings[k]; } }),
        h('span', { class: 'box' }), h('b', { text: chLabel(k) })))), h('p', { class: 'hint', text: l.famx.hint }),
      h('button', { type: 'submit', class: 'btn primary big', text: l.broc.add }));
    });
    if (q?.get('add')) { history.replaceState(null, '', '#/brocante'); setTimeout(addItem, 60); }
    return [
      head(l.broc.title, l.broc.intro, btn(l.broc.add, addItem, 'tagged', 'plus')),
      h('p', { class: 'alert', style: 'margin-bottom:18px' }, icon('alert'), l.broc.rule),
      h('div', { class: 'cols' },
        panel(l.broc.title, null, items.length ? h('div', { class: 'cards' }, items.map(cardEl)) : h('p', { class: 'muted', text: l.empty })),
        h('div', { class: 'stack' },
          panel(l.broc.toGive, null, owners.length ? h('ul', { class: 'list' }, owners.map(o => {
            const mine = sales.filter(s => s.pieces.some(id => piece(id)?.owner === o));
            const dueS = mine.filter(s => !s.givenBack);
            return h('li', {}, h('span', { class: 'avatar', text: o.slice(0, 1).toUpperCase() }), h('span', { class: 'main' }, h('b', { text: o }),
              h('span', { text: `${items.filter(p => p.owner === o && p.status !== 'sold').length} ${l.broc.inStand}, ${mine.length} ${l.broc.sold}` })),
              h('span', { class: 'amt', text: money(dueS.reduce((t, s) => t + paid(s), 0)) }),
              dueS.length ? h('div', { class: 'sub' }, btn(l.broc.give, () => { dueS.forEach(s => { s.givenBack = true; }); save(); render(); }, 'small', 'check')) : null);
          })) : h('p', { class: 'muted', text: '—' })),
          panel(l.sales.title, null, sales.length ? h('ul', { class: 'list' }, sales.map(s => { const p = piece(s.pieces[0]);
            return h('li', {}, h('span', { class: 'lead' }, icon('tent')), link(`#/sale/${s.id}`, { class: 'main rowlink' }, h('b', { text: `${s.no} — ${p ? title(p) : ''}` }),
              h('span', { text: `${E.date(s.date)} — ${p?.owner || ''}` })), h('span', { class: 'amt', text: money(s.price) }),
              h('div', { class: 'sub' }, s.givenBack ? pill('live', l.broc.given) : null, btn(l.broc.deleteSale, () => cancelSale(s), 'small danger', 'trash'))); }))
            : h('p', { class: 'muted', text: '—' }), h('p', { class: 'note', text: l.broc.noInvoice }))))
    ];
  }

  /* ---------- Visites guidées : de page en page, un projecteur sur le tableau ou le bouton expliqué ----------
     Trois visites sur le même moteur : « complète » (chaque page, chaque tableau, chaque bouton), « l'essentiel » (l'histoire
     d'une pièce en 5 chapitres) et « cette page » (bouton Guide). En mode démo guidée (Réglages), la visite complète se propose
     à chaque connexion et le bouton Guide reste sur toutes les pages, jusqu'à ce qu'on désactive le mode. */
  const TOUR_KEY = 'etiket-tour-v2';
  const GUIDE_SESSION = 'etiket-guide-shown';  // une proposition par session de navigateur, pas à chaque page
  const CHAPTERS = [['receive', 'instagram'], ['sell', 'scan'], ['deliver', 'truck'], ['money', 'payments'], ['daily', 'home']];
  const TOUR = [
    { key: 'welcome', route: '#/', icon: 'tag' },
    { key: 'instagram', ch: 0, route: '#/listings', sel: ['.ig-post', '.ig-band'], icon: 'instagram' },
    { key: 'stock', ch: 0, route: '#/stock', sel: ['.cards .card'], icon: 'stock' },
    { key: 'piece', ch: 0, route: () => `#/piece/${tourPiece()}`, sel: ['.piece-head'], icon: 'tag' },
    { key: 'scanBtn', ch: 1, route: () => `#/piece/${tourPiece()}`, sel: () => [`a[href="#/sell/${tourPiece()}?scan=1"]`], icon: 'scan' },
    { key: 'scan', ch: 1, route: '#/scan', sel: ['main .scan-sources'], icon: 'scan', try: '#/scan?demo=1' },
    { key: 'send', ch: 1, route: () => `#/sale/${tourSale()}`, sel: ['.mobile-actions', '.page-head .btn.tagged'], icon: 'chat' },
    { key: 'delivery', ch: 2, route: '#/deliveries', sel: ['.deliv-acts .btn.primary', '.deliv'], icon: 'truck' },
    { key: 'payments', ch: 3, route: '#/payments', sel: ['main .list li', 'main .list'], icon: 'payments' },
    { key: 'vat', ch: 3, route: '#/accounting', sel: ['.grids'], icon: 'accounting' },
    { key: 'todo', ch: 4, route: '#/', sel: ['.todo', '.home .panel'], icon: 'check' },
    { key: 'plus', ch: 4, route: '#/', sel: ['.bottom .add-tab', '.side .add-big'], icon: 'plus' },
    { key: 'family', ch: 4, route: '#/brocante', sel: ['main .cards .card', '.page-head'], icon: 'tent' },
    { key: 'end', route: '#/', icon: 'guide' },
  ];
  const tourPiece = () => (S.pieces.find(p => !isPrivate(p) && p.status === 'live' && !p.saleId) || S.pieces.find(p => !isPrivate(p)) || {}).id;
  const tourSale = () => (S.sales.find(s => !s.credit && !s.cancelled && !s.private) || S.sales[0] || {}).id;
  const tourDraft = () => (S.pieces.find(p => p.status === 'draft' && !isPrivate(p)) || {}).id;
  const tourCustomer = () => (S.customers.find(c => c.status === 'ok') || S.customers[0] || {}).id;
  // le n-ième panneau visible de la page (les titres changent avec la langue, l'ordre des panneaux non)
  const panelAt = n => () => [...document.querySelectorAll('main section.panel')].filter(visible)[n];
  // panneau dont le titre est ce texte (pris dans la langue affichée) ; « Livraisons à régler (1) » compte aussi
  const panelBy = key => () => { const t = key(L()); return [...document.querySelectorAll('main section.panel')].find(p => visible(p) && (txt => txt === t || txt?.startsWith(`${t} (`))(p.querySelector(':scope > .panel-title h2')?.textContent)); };
  const panelUntitled = () => [...document.querySelectorAll('main section.panel')].find(p => visible(p) && !p.querySelector(':scope > .panel-title'));

  // Visite complète : une page = un chapitre ; chaque étape vise un tableau, une liste ou un bouton précis
  const PAGES = [
    ['home', '#/', 'home', [['figures', '.figures'], ['todo', '.todo'], ['recent', panelBy(l => l.recent)], ['timing', panelBy(l => l.e0)], ['add', ['.side .add-big', '.bottom .add-tab']],
      ['nav', ['.side nav', '.bottom']], ['search', ['.searchbox', '.search-btn']]]],
    ['stock', '#/stock', 'stock', [['filters', 'main .chips'], ['card', 'main .cards .card'], ['tag', 'main .cards .card .tag'], ['costs', '.page-head .cost-toggle']]],
    ['piece', () => `#/piece/${tourPiece()}`, 'tag', [['head', '.piece-head'], ['actions', ['.piece-head .row.no-print', '.piece-head']], ['listings', panelBy(l => l.piece.channels)],
      ['text', panelBy(l => l.piece.listingText)], ['vat', [panelBy(l => l.piece.fiscal), '.piece-head']], ['history', panelBy(l => l.piece.history)]]],
    ['add', () => (tourDraft() ? `#/add/${tourDraft()}` : '#/stock'), 'camera', [['wizard', ['main .wiz', 'main form', 'main .page-head']], ['next', ['.wiz-nav', 'main .btn.primary']]]],
    ['listings', '#/listings', 'listings', [['ig', '.ig-head'], ['post', '.ig-post'], ['remove', panelBy(l => l.listings.toRemove)], ['publish', panelBy(l => l.listings.toPublish)], ['import', panelBy(l => l.listings.importT)], ['replies', panelBy(l => l.listings.replies)]]],
    ['scan', '#/scan', 'scan', [['steps', '.scan-steps'], ['sources', '.scan-sources', '#/scan?demo=1'], ['text', '.scan-text']]],
    ['sell', () => `#/sell/${tourPiece()}`, 'sales', [['who', panelBy(l => l.sell.who)], ['deliv', panelBy(l => l.deliv.choose)], ['price', panelBy(l => l.sell.price)], ['pay', panelBy(l => l.sell.how)], ['confirm', 'main form button[type="submit"]']]],
    ['sales', '#/sales', 'sales', [['filters', 'main .chips'], ['list', 'main .list']]],
    ['sale', () => `#/sale/${tourSale()}`, 'print', [['invoice', 'main .invoice'], ['actions', ['.page-head .row', '.mobile-actions']], ['delivery', [panelBy(l => l.deliv.title), 'main .invoice']], ['payments', panelBy(l => l.nav.payments)], ['peppol', [panelBy(l => l.sales.peppol), panelBy(l => l.acc.title)]]]],
    ['deliveries', '#/deliveries', 'truck', [['failed', panelBy(l => l.deliv.failed)], ['upcoming', panelBy(l => l.deliv.upcoming)], ['edit', '.deliv-acts .btn.primary']]],
    ['customers', '#/customers', 'user', [['list', 'main .list'], ['filters', 'main .chips'], ['scan', '.page-head .btn.tagged'], ['ig', panelBy(l => l.cust.igT)]]],
    ['customer', () => `#/customer/${tourCustomer()}`, 'user', [['form', 'main .grid2'], ['status', 'main .choices'], ['addresses', ['main section.panel .sub-panel', panelUntitled]], ['purchases', panelBy(l => l.cust.sales)]]],
    ['payments', '#/payments', 'payments', [['feed', panelUntitled], ['match', 'main .list .btn.primary'], ['promised', panelBy(l => l.dep.list)], ['sources', panelBy(l => l.payments.sources)]]],
    ['accounting', '#/accounting', 'accounting', [['software', panelBy(l => l.acc.link)], ['peppol', panelBy(l => l.acc.peppolT)], ['registers', panelBy(l => l.acc.registers)]]],
    ['consign', '#/consign', 'consign', [['depositor', panelAt(0)]]],
    ['brocante', '#/brocante', 'tent', [['stand', panelBy(l => l.broc.title)], ['owner', panelBy(l => l.broc.toGive)], ['sales', panelBy(l => l.sales.title)]]],
    ['settings', '#/settings', 'settings', [['guide', panelBy(l => l.full.settingsT)], ['themes', '.themes'], ['reset', 'main .btn.danger']]],
  ];
  const FULL = [{ key: 'welcome', route: '#/', icon: 'guide' },
    ...PAGES.flatMap(([page, route, ic, steps], ch) => steps.map(([k, sel, tryRoute]) => ({ key: `${page}.${k}`, page, ch, route, icon: ic, try: tryRoute,
      sel: typeof sel === 'function' ? [sel] : Array.isArray(sel) ? sel : [sel] }))),
    { key: 'end', route: '#/', icon: 'check' }];
  const TOURS = {
    full: { steps: FULL, chapters: PAGES.map(([k, , ic]) => [k, ic]), text: l => l.full.steps, chName: (l, k) => l.full.pages[k], count: (l, i, n, name) => l.full.page(i, n, name) },
    story: { steps: TOUR, chapters: CHAPTERS, text: l => l.tour.steps, chName: (l, k) => l.tour.chapters[k][0], count: (l, i, n, name) => l.tour.chapter(i, n, name) },
  };
  const pageOf = hash => { const p = hash.replace(/^#\/?/, '').split(/[/?]/)[0]; return p === '' ? 'home' : p; };
  const stepRoute = st => (typeof st.route === 'function' ? st.route() : st.route);
  const stepSel = st => (typeof st.sel === 'function' ? st.sel() : st.sel);
  let tour = null;  // { kind, steps, i, root, spot, card } tant que la visite est ouverte
  const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const findEl = sels => (sels || []).map(s => (typeof s === 'function' ? [s()].filter(visible)[0] : [...document.querySelectorAll(s)].find(visible))).find(Boolean) || null;
  function waitFor(sels, ms = 1600) {
    return new Promise(res => {
      const t0 = Date.now();
      const look = () => { const el = findEl(sels); if (el || !sels || Date.now() - t0 > ms) res(el); else setTimeout(look, 60); };
      look();
    });
  }
  // kind : 'full', 'story' ou 'page' (les étapes de la page affichée, puis « Page suivante » enchaîne sur la visite complète)
  function startTour(kind = 'full', i = 0) {
    let def = TOURS[kind], steps = def?.steps;
    if (kind === 'page') {
      const page = pageOf(location.hash);
      def = TOURS.full;
      steps = FULL.filter(st => st.page === page).map(st => ({ ...st, route: location.hash }));  // la page affichée, pas une autre pièce
      if (!steps.length) { startTour('full', 0); return; }
    }
    endTour(false);
    const spot = h('div', { class: 'tour-spot', 'aria-hidden': 'true' });
    const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title' });
    const root = h('div', { class: 'tour', onclick: e => { if (e.target === root) nextStep(1); } }, spot, card);
    document.body.append(root);
    document.addEventListener('keydown', tourKeys);
    window.addEventListener('resize', placeTour);
    window.addEventListener('scroll', placeTour, true);
    const app = document.getElementById('app');
    tour = { kind, def, steps, i, root, spot, card, target: null, back: document.activeElement };
    app.inert = true; app.setAttribute('aria-hidden', 'true');
    try { sessionStorage.setItem(GUIDE_SESSION, '1'); } catch { /* sans stockage : proposée à chaque chargement */ }
    showStep(i);
  }
  function endTour(done) {
    if (!tour) return;
    const back = tour.back;
    tour.root.remove(); tour = null;
    const app = document.getElementById('app'); app.inert = false; app.removeAttribute('aria-hidden');
    if (back && back.isConnected) back.focus({ preventScroll: true });
    document.removeEventListener('keydown', tourKeys);
    window.removeEventListener('resize', placeTour);
    window.removeEventListener('scroll', placeTour, true);
    if (done) { try { localStorage.setItem(TOUR_KEY, 'done'); } catch { /* stockage bloqué : la visite pourra revenir */ } }
  }
  function tourKeys(e) {
    if (!tour) return;
    if (e.key === 'Escape') endTour(true);
    else if (e.key === 'ArrowRight') nextStep(1);
    else if (e.key === 'ArrowLeft') nextStep(-1);
  }
  // index de la première étape de la page suivante dans la visite complète (après une visite « cette page »)
  const nextPageStart = page => { const k = PAGES.findIndex(([p]) => p === page); const nxt = PAGES[k + 1]?.[0]; return nxt ? FULL.findIndex(st => st.page === nxt) : -1; };
  function nextStep(delta) {
    if (!tour) return;
    const i = tour.i + delta;
    if (i < 0) return;
    if (i >= tour.steps.length) {
      if (tour.kind === 'page') { const at = nextPageStart(tour.steps[0].page); endTour(true); if (at > 0) startTour('full', at); return; }
      endTour(true); go('#/'); return;
    }
    showStep(i);
  }
  async function showStep(i) {
    const t = tour, l = L(), { def, steps, kind } = t, step = steps[i], txt = def.text(l)[step.key] || ['', ''];
    t.i = i;
    const route = stepRoute(step);
    if (location.hash !== route && !(route === '#/' && ['', '#', '#/'].includes(location.hash))) {
      location.replace(route);  // pas d'historique : « Retour » après la visite ne rejoue pas ses pages
      await new Promise(r => setTimeout(r, 150));  // laisse le nouvel écran se dessiner : sinon on viserait un élément de l'ancien
    }
    const el = await waitFor(stepSel(step));
    if (tour !== t || t.i !== i) return;
    tour.target = el;
    // téléphone : l'élément remonte en haut de l'écran, la carte reste en bas et ne le cache pas
    const phone = innerWidth < 700;
    // défilement immédiat : avec un défilement animé, le projecteur se plaçait parfois avant la fin et visait à côté
    if (el) { el.style.scrollMarginTop = phone ? '72px' : ''; el.scrollIntoView({ block: phone ? 'start' : 'center', behavior: 'auto' }); }
    const last = i === steps.length - 1, first = i === 0;
    const chs = def.chapters, inCh = steps.filter(t => t.ch === step.ch), pos = inCh.indexOf(step);
    // barre en segments, un par chapitre (ou par page) : on voit où on en est
    const bars = kind === 'page' ? null : h('div', { class: 'tour-chapters', style: `grid-template-columns:repeat(${chs.length}, 1fr)`, 'aria-hidden': 'true' }, chs.map((c, k) => {
      const all = steps.filter(t => t.ch === k), done = step.ch == null ? (last ? all.length : 0) : k < step.ch ? all.length : k === step.ch ? pos + 1 : 0;
      return h('span', { class: k === step.ch ? 'on' : '' }, h('i', { style: `width:${Math.round((done / Math.max(1, all.length)) * 100)}%` }));
    }));
    const map = (first || last) && kind !== 'page' ? h('ol', { class: `tour-map${chs.length > 6 ? ' many' : ''}` }, chs.map(([k, ic], n) => h('li', {}, h('span', { class: 'tour-badge' }, icon(ic)),
      h('span', {}, h('b', { text: `${n + 1}. ${def.chName(l, k)}` }), kind === 'story' ? h('small', { text: l.tour.chapters[k][1] }) : null)))) : null;
    const countText = step.ch != null ? def.count(l, step.ch + 1, chs.length, def.chName(l, chs[step.ch][0])) : l.tour.count(i + 1, steps.length);
    const nextLabel = last ? (kind === 'page' && nextPageStart(step.page) > 0 ? l.full.nextPage(def.chName(l, PAGES[PAGES.findIndex(([p]) => p === step.page) + 1][0])) : l.tour.finish)
      : first && kind === 'full' ? l.full.start : first && kind === 'story' ? l.tour.start : l.tour.next;
    fill(tour.card,
      bars,
      h('div', { class: 'tour-top' }, h('span', { class: 'tour-badge' }, icon(step.icon)),
        h('span', { class: 'tour-count', text: kind === 'page' ? l.full.thisPage(def.chName(l, chs[step.ch][0])) : countText }),
        inCh.length > 1 && step.ch != null ? h('span', { class: 'tour-sub', text: `${pos + 1}/${inCh.length}` }) : null),
      h('h2', { id: 'tour-title', tabindex: '-1', text: txt[0] }),
      h('p', { id: 'tour-text', text: txt[1] }),
      txt[2] ? h('p', { class: 'tour-do' }, icon('check'), h('span', { text: txt[2] })) : null,
      map,
      first && kind === 'full' ? btn(l.full.short, () => startTour('story', 1), 'small', 'guide') : null,
      step.try ? btn(l.tour.try, () => { endTour(true); go(step.try); }, 'small tagged', 'image') : null,
      h('div', { class: 'tour-nav' },
        last ? null : btn(first ? l.tour.later : l.tour.skip, () => endTour(!first), 'small'),
        i > 0 ? btn(l.tour.prev, () => nextStep(-1), 'small', 'back') : null,
        btn(nextLabel, () => nextStep(1), 'primary', last ? 'check' : null)));
    tour.card.classList.remove('enter'); void tour.card.offsetWidth; tour.card.classList.add('enter');
    tour.root.classList.toggle('no-target', !el);
    placeTour(); setTimeout(placeTour, 120); setTimeout(placeTour, 600);  // après le dessin de la carte, puis après le chargement des images
    tour.card.setAttribute('aria-describedby', 'tour-text');
    tour.card.querySelector('h2')?.focus({ preventScroll: true });  // le lecteur d'écran annonce le titre puis le texte de l'étape
  }
  window.EtiketTour = { start: startTour, state: () => (tour ? { kind: tour.kind, i: tour.i, total: tour.steps.length, key: tour.steps[tour.i].key, target: !!tour.target,
      what: tour.target ? tour.target.querySelector(':scope > .panel-title h2')?.textContent || tour.target.className : null } : null),
    keys: () => FULL.map(st => st.key) };  // pour les tests de bout en bout
  // mode démo guidée : la visite complète se propose une fois par session, tant que le mode reste actif
  function maybeStartGuide(delay = 450) {
    let shown = false; try { shown = sessionStorage.getItem(GUIDE_SESSION) === '1'; } catch { shown = false; }
    let seen = false; try { seen = localStorage.getItem(TOUR_KEY) === 'done'; } catch { seen = false; }
    if (!shown && (P.guide || !seen)) setTimeout(() => { if (!tour && session.on()) startTour('full', 0); }, delay);
  }
  function placeTour() {
    if (!tour) return;
    if (tour.target && !tour.target.isConnected) tour.target = findEl(stepSel(tour.steps[tour.i]));
    const { spot, card, target } = tour;
    const vw = innerWidth, vh = innerHeight, pad = 8;
    if (!target || !visible(target)) { spot.style.cssText = `top:${vh / 2}px;left:${vw / 2}px;width:0;height:0`; card.style.cssText = ''; card.classList.add('center'); return; }
    card.classList.remove('center');
    const r = target.getBoundingClientRect();
    const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
    const w = Math.min(vw - left - 4, r.width + pad * 2), hh = Math.min(vh - top - 4, r.height + pad * 2);
    spot.style.cssText = `top:${top}px;left:${left}px;width:${w}px;height:${hh}px`;
    const cw = Math.min(400, vw - 24), ch = card.offsetHeight || 220;
    if (vw < 700) {  // téléphone : la carte en bas ; l'éclairage s'arrête au-dessus d'elle (en haut seulement si l'élément est tout en bas)
      const bottom = r.top < vh - ch - 40;
      card.style.cssText = bottom ? 'left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom))' : 'left:12px;right:12px;top:12px';
      if (bottom) spot.style.height = `${Math.max(40, Math.min(hh, vh - ch - 32 - top))}px`;
      return;
    }
    let ct = r.bottom + 16, cl = Math.min(Math.max(12, r.left), vw - cw - 12);
    if (ct + ch > vh - 12) ct = r.top - ch - 16;
    if (ct < 12) {  // ni dessous ni dessus : la carte se met à côté de l'élément plutôt que dessus
      ct = Math.min(Math.max(12, r.top + r.height / 2 - ch / 2), vh - ch - 12);
      if (r.right + 16 + cw <= vw - 12) cl = r.right + 16;
      else if (r.left - 16 - cw >= 12) cl = r.left - 16 - cw;
      else ct = Math.max(12, vh - ch - 12);
    }
    card.style.cssText = `top:${ct}px;left:${cl}px;width:${cw}px`;
  }

  /* ---------- Mode d'emploi : le parcours d'une pièce ---------- */
  let guideTrack = 'pro';
  function viewGuide() {
    const l = L(), g = l.guide;
    const track = (steps, label) => h('section', { class: 'guide-track' }, h('h2', { text: label }),
      h('ol', { class: 'flow' }, steps.map(([t, you, app, href]) => h('li', { class: 'flow-step' },
        h('div', { class: 'flow-head' }, h('h3', { text: t }), link(href, { class: 'btn small' }, g.open)),
        h('dl', { class: 'flow-who' }, h('div', {}, h('dt', { text: g.you }), h('dd', { text: you })), h('div', { class: 'app' }, h('dt', { text: g.app }), h('dd', { text: app })))))));
    const segBox = h('div', { class: 'guide-switch' });
    const tracks = h('div', { class: 'guide-tracks' });
    const paint = () => {
      fill(segBox, seg([['pro', g.pro], ['fam', g.fam]], guideTrack, k => { guideTrack = k; paint(); }));
      fill(tracks, h('div', { class: guideTrack === 'pro' ? 'on' : 'off' }, track(g.proSteps, g.pro)), h('div', { class: guideTrack === 'fam' ? 'on' : 'off' }, track(g.famSteps, g.fam)));
    };
    paint();
    if (!S.guideSeen) { S.guideSeen = true; save(); }
    return [head(g.title, g.intro),
      h('section', { class: 'tour-hero' }, h('div', { class: 'tour-hero-art', 'aria-hidden': 'true' }, h('span', { class: 'tag' }, h('span', { class: 'no', text: '101' }), h('span', { class: 'price', text: '1 450 €' })),
        h('span', { class: 'tour-hero-ring' })),
        h('div', { class: 'stack' }, h('h2', { text: l.tour.heroTitle }), h('p', { text: l.tour.heroText }),
          h('div', { class: 'row' }, btn(l.full.launch, () => startTour('full', 0), 'primary big', 'guide'), btn(l.full.short, () => startTour('story', 0), '', 'tag'),
            h('span', { class: 'muted', text: l.full.duration })))),
      segBox, tracks];
  }

  /* ---------- Réglages ---------- */
  const THEME_SW = { entrepot: ['#172126', '#1F2B31', '#D4AC74', '#8FCAB8', '#ECE8DF'], atelier: ['#EDF0F2', '#FFFFFF', '#CB9A5E', '#2348B5', '#15212A'], formica: ['#D6E5DC', '#F3F8F4', '#EDB43A', '#B8322A', '#17322C'] };
  function viewSettings() {
    const l = L();
    return [
      head(l.settings.title, null, btn(l.login.logout, () => { session.set(false); location.hash = '#/login'; render(); }, '', 'close')),
      h('div', { class: 'stack' },
        panel(l.full.settingsT, pill(P.guide ? 'live' : 'none', P.guide ? l.full.on : l.full.off),
          h('label', { class: 'switch big-switch' }, h('input', { type: 'checkbox', checked: P.guide, onchange: e => { P.guide = e.target.checked; savePrefs(); render(); toast(P.guide ? l.full.onToast : l.full.offToast); } }),
            h('span', { text: l.full.toggle })),
          h('p', { class: 'hint', text: l.full.settingsHint }),
          h('div', { class: 'row' }, btn(l.full.launch, () => startTour('full', 0), 'primary', 'guide'), btn(l.full.short, () => startTour('story', 0), '', 'tag')),
          h('hr', { class: 'sep' }),
          h('label', { class: 'switch big-switch' }, h('input', { type: 'checkbox', checked: P.costs, onchange: e => { P.costs = e.target.checked; savePrefs(); render(); } }),
            h('span', { text: l.costs.toggle })),
          h('p', { class: 'hint', text: l.costs.only })),
        panel(l.settings.look, null, h('p', { class: 'muted', style: 'margin-bottom:12px', text: l.settings.lookHint }),
          h('div', { class: 'themes' }, Object.keys(THEME_SW).map(k => h('button', { type: 'button', class: 'theme-card', 'aria-pressed': String(P.theme === k), onclick: () => { P.theme = k; savePrefs(); applyPrefs(); render(); } },
            h('span', { class: 'swatch' }, THEME_SW[k].map(c => h('i', { style: `background:${c}` }))), h('b', { text: l.settings.themes[k][0] }), h('span', { class: 'muted', text: l.settings.themes[k][1] }))))),
        h('div', { class: 'cols' },
          panel(l.settings.shop, null, h('dl', { class: 'facts' }, [[P.lang === 'nl' ? 'Winkel' : 'Boutique', S.shop.name], [P.lang === 'nl' ? 'Onderneming' : 'Entreprise', S.shop.legal],
            ['BCE / KBO', S.shop.vat], [P.lang === 'nl' ? 'Adres' : 'Adresse', fmtAddr(S.shop.address)], ['Peppol', `${S.shop.peppol} — ${l.shopx.peppolSince(E.date(S.shop.peppolSince))}`],
            ['Instagram', `@${S.shop.instagram}`], ['NACE', `${S.shop.nace} — ${P.lang === 'nl' ? 'kleinhandel in tweedehandsgoederen' : 'commerce de biens d’occasion'}`], ['IBAN', `${S.shop.iban} (${P.lang === 'nl' ? 'fictief' : 'fictif'})`]]
            .map(([a, b]) => h('div', {}, h('dt', { text: a }), h('dd', { text: b }))))),
          panel(l.settings.lang, null, seg([['fr', 'Français'], ['nl', 'Nederlands']], P.lang, k => { P.lang = k; savePrefs(); render(); }))),
        panel(l.settings.about, null, h('p', { text: l.settings.aboutText }),
          btn(l.settings.reset, () => { S = fresh(); save(); render(); toast(l.settings.resetDone); }, 'danger', 'sync')))
    ];
  }

  /* ---------- Routeur ---------- */
  function applyPrefs() { document.documentElement.dataset.theme = P.theme; document.documentElement.lang = P.lang; }
  let first = true, renderReason = 'nav';
  function render() {
    applyPrefs();
    const app = document.getElementById('app');
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    if (!session.on() || path === 'login') {
      if (session.on() && path === 'login') { location.replace('#/'); return; }
      app.replaceChildren(viewLogin()); document.title = 'Etiket — OctoPuces';
      if (!first) document.querySelector('h1')?.focus({ preventScroll: true });
      first = false; return;
    }
    const q = new URLSearchParams(qs || '');
    const [a, b] = path.split('/');
    const routes = {
      '': ['home', () => viewHome()], stock: ['stock', () => viewStock(q)], piece: ['stock', () => viewPiece(b)], add: ['add', () => viewAdd(b)],
      sell: ['sales', () => viewSell(b, q)], sales: ['sales', () => viewSales(q)], sale: ['sales', () => viewSale(b)], payments: ['payments', () => viewPayments(q)],
      listings: ['listings', () => viewListings()], accounting: ['accounting', () => viewAccounting()], consign: ['consign', () => viewConsign()], settings: ['settings', () => viewSettings()],
      deliveries: ['deliveries', () => viewDeliveries()], customers: ['customers', () => viewCustomers(q)], customer: ['customers', () => viewCustomer(b)], brocante: ['brocante', () => viewBrocante(q)], scan: ['scan', () => viewScan(q)], guide: ['guide', () => viewGuide()],
    };
    const [section, view] = routes[a] || routes[''];
    const content = view();
    if (!content.length) return;
    const y = window.scrollY;
    app.replaceChildren(shell(section, content));
    document.title = `${document.querySelector('main h1')?.textContent || 'Etiket'} — Etiket`;
    if (!first && renderReason === 'nav') { window.scrollTo(0, 0); document.querySelector('main h1')?.focus({ preventScroll: true }); } else window.scrollTo(0, y);
    if (first) maybeStartGuide(900);  // app rouverte avec une session déjà ouverte
    renderReason = 'update'; first = false;
  }
  window.addEventListener('hashchange', () => { renderReason = 'nav'; render(); });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  render();
})();
