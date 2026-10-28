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
  const P = Object.assign({ lang: 'fr', theme: 'entrepot' }, store.get(PREFS, {}));
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
  const tagEl = (p, big) => h('div', { class: `${big ? 'tag big' : 'tag'}${isPrivate(p) ? ' private' : ''}` }, h('span', { class: 'no', text: String(p.no) }),
    p.price ? h('span', { class: 'price', text: money(p.price).replace(',00', '') }) : null);
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
      if (email.value.trim().toLowerCase() === S.login.email && pass.value === S.login.password) { session.set(true); location.hash = '#/'; render(); }
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
  const NAV = [['home', '#/', 'home'], ['stock', '#/stock', 'stock'], ['listings', '#/listings', 'listings'], ['sales', '#/sales', 'sales'],
    ['deliveries', '#/deliveries', 'truck'], ['customers', '#/customers', 'user'], ['payments', '#/payments', 'payments'], ['accounting', '#/accounting', 'accounting'],
    ['consign', '#/consign', 'consign'], ['brocante', '#/brocante', 'tent'], ['settings', '#/settings', 'settings']];
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
      link('#/stock?focus=1', { class: 'icon-btn search-btn', 'aria-label': l.search }, icon('search')), langBtn);
    const MOBILE = ['home', 'stock', 'add', 'sales'];
    const more = () => sheet(l.nav.more, h('nav', { class: 'menu' }, NAV.filter(([k]) => !MOBILE.includes(k)).map(([k, href, ic]) =>
      link(href, { onclick: () => document.querySelector('dialog')?.close() }, icon(ic), l.nav[k], c[k] ? h('span', { class: 'count', text: String(c[k]) }) : null))));
    const bottom = h('nav', { class: 'bottom', 'aria-label': 'Navigation' },
      link('#/', { 'aria-current': cur('home') }, icon('home'), h('span', { text: l.nav.home })),
      link('#/stock', { 'aria-current': cur('stock') }, icon('stock'), h('span', { text: l.nav.stock })),
      link('#/add', { class: 'add-tab', 'aria-current': cur('add') }, h('span', { class: 'plus' }, icon('plus')), h('span', { text: l.nav.add })),
      link('#/sales', { 'aria-current': cur('sales') }, icon('sales'), h('span', { text: l.nav.sales })),
      h('button', { type: 'button', 'aria-current': MOBILE.includes(section) ? null : 'page', onclick: more }, icon('more'), h('span', { text: l.nav.more }),
        Object.entries(c).some(([k, v]) => v && !MOBILE.includes(k)) ? h('span', { class: 'dot', 'aria-hidden': 'true' }) : null));
    return h('div', { class: 'shell' }, side, h('div', { class: 'col' }, top, h('p', { class: 'demo-banner', text: l.demoBanner }), h('main', { id: 'main' }, content)), bottom);
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
      head(l.nav.stock, `${S.pieces.filter(p => !isPrivate(p)).length} ${P.lang === 'nl' ? 'stukken' : 'pièces'}`, link('#/add', { class: 'btn tagged' }, icon('plus'), l.nav.add)),
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
  const fullListing = (p, lang) => { const x = E.listingText({ ...p, price: p.price || 0 }, lang, S.shop.city[lang]); return `${x.title}\n\n${x.body}\n\n${S.shop.delivery[lang]}.`; };
  function listingRows(p) {
    const l = L();
    return CHANNELS.map(ch => {
      const lst = p.listings?.[ch];
      const st = lst?.state || 'none';
      let acts = [];
      if (ch === 'site') acts = st === 'none' ? [] : [h('span', { class: 'muted', text: l.lstSite })];
      else if (ch === 'ig' && (st === 'none' || st === 'draft')) acts = [btn(l.ig.publish, () => { p.listings.ig = { state: 'live', url: `https://www.instagram.com/${S.shop.instagram}/` }; save(); render(); toast(l.ig.published); }, 'small primary', 'instagram')];
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
    const fillText = () => { const x = E.listingText({ ...p, price: p.price || 0 }, lang, S.shop.city[lang]); fill(textBox, h('b', { text: x.title }), x.body, `\n\n${S.shop.delivery[lang]}.`); };
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
        h('div', { class: 'gallery' }, h('div', { class: 'card-ph' }, photoEl(p)),
          thumbs > 1 ? h('div', { class: 'thumbs' }, Array.from({ length: thumbs }, (_, i) => {
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
              p.status === 'live' && !priv ? btn(l.piece.reserve, () => { p.status = 'reserved'; save(); render(); toast(l.status.reserved); }) : null,
              p.status === 'reserved' && !s ? btn(l.piece.unreserve, () => { p.status = 'live'; save(); render(); }) : null,
              s ? link(`#/sale/${s.id}`, { class: 'btn' }, icon('sales'), l.piece.seeSale) : null,
              btn(l.piece.printTag, () => window.print(), '', 'print'))),
          priv ? h('p', { class: 'alert' }, icon('tent'), l.broc.noInvoice) : null,
          h('dl', { class: 'facts' }, facts.map(([dt, dd]) => h('div', {}, h('dt', { text: dt }), h('dd', { text: dd })))),
          priv ? null : panel(l.piece.channels, null, h('div', { class: 'chan' }, listingRows(p))),
          priv ? null : panel(l.piece.listingText, segBox, textBox, h('div', { class: 'row', style: 'margin-top:10px' }, btn(l.piece.copy, () => copy(fullListing(p, lang)), '', 'copy'))),
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
      if (document.visibilityState === 'visible') { p.entryMs += 1000; chrono.lastChild.textContent = fmt(p.entryMs); if (p.entryMs % 5000 === 0) save(); }
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
    if (!sellForm || sellForm.pid !== p.id || sellForm.pay !== (linked?.id || null)) {
      const start = linked ? linked.amount : p.price || 0;
      sellForm = { pid: p.id, pay: linked?.id || null, customer: null, newCustomer: false, newName: '', newHandle: '', newVat: '', price: start,
        method: linked ? linked.method : 'bancontact', amount: start, deposit: false, depositState: 'validated',
        mode: 'pickup', address: { street: '', zip: '', city: '' }, date: TODAY, slot: '' };
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
      if (f.mode === 'delivery' && !(f.address.street && f.address.zip && f.address.city)) return l.deliv.address;
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
    const submit = e => {
      e.preventDefault();
      if (submitted || problem()) return;
      submitted = true; confirm.disabled = true;
      let cid = f.customer;
      if (f.newCustomer) {
        cid = `c${Date.now()}`;
        S.customers.push({ id: cid, name: f.newName || f.newHandle || (P.lang === 'nl' ? 'Nieuwe klant' : 'Nouveau client'), handle: f.newHandle, channel: f.newHandle ? 'instagram' : 'shop',
          phone: '', email: '', status: 'ok', vat: f.newVat || undefined, addresses: f.mode === 'delivery' ? [{ ...f.address }] : [], notes: '', since: TODAY });
      } else if (cid && f.mode === 'delivery') {
        const c = customer(cid); if (!c.addresses.some(a => fmtAddr(a) === fmtAddr(f.address))) c.addresses.push({ ...f.address });
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
          panel(l.sell.who, null, who),
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
        active ? btn(s.private ? l.broc.deleteSale : l.cancel.title, () => cancelSale(s), 'danger', s.private ? 'trash' : 'sync') : null),
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
  function deliveryPanel(s) {
    const l = L(), d = s.delivery, b = buyer(s);
    if (d.mode !== 'delivery') return panel(l.deliv.title, null, h('p', { class: 'row' }, icon('stock'), l.deliv.mode.pickup));
    const editAddr = () => sheet(l.deliv.address, close => {
      const a = { ...d.address };
      return h('form', { class: 'stack', onsubmit: e => {
        e.preventDefault(); if (!(a.street && a.zip && a.city)) return;
        d.address = a; if (b.c && !b.c.addresses.some(x => fmtAddr(x) === fmtAddr(a))) b.c.addresses.push({ ...a });
        save(); close(); render(); toast(l.deliv.saved);
      } }, b.c?.addresses?.length ? h('div', { class: 'choices' }, b.c.addresses.map((x, i) => radio('addr', String(i), fmtAddr(x), () => { Object.assign(a, x); close(); d.address = { ...x }; save(); render(); toast(l.deliv.saved); }, fmtAddr(x) === fmtAddr(d.address)))) : null,
      addressFields(a), h('button', { type: 'submit', class: 'btn primary big', text: l.cust.save }));
    });
    const reschedule = () => sheet(l.deliv.reschedule, close => {
      let date = d.date, slot = d.slot || '';
      return h('form', { class: 'stack', onsubmit: e => { e.preventDefault(); d.date = date; d.slot = slot; d.status = 'planned'; delete d.note; save(); close(); render(); toast(l.deliv.saved); } },
        h('div', { class: 'grid2' }, field(l.deliv.date, h('input', { class: 'input', type: 'date', value: date, min: TODAY, oninput: e => { date = e.target.value; } })),
          field(l.deliv.slot, h('input', { class: 'input', value: slot, oninput: e => { slot = e.target.value; } }))), h('button', { type: 'submit', class: 'btn primary big', text: l.deliv.reschedule }));
    });
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
        btn(l.deliv.edit, editAddr, 'small', 'edit'), btn(l.deliv.reschedule, reschedule, 'small', 'clock'),
        btn(l.deliv.copy, () => copy(fmtAddr(d.address)), 'small', 'copy'),
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
          link(`#/sale/${s.id}`, { class: 'btn small' }, l.deliv.edit));
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
  async function readImage(file, onProgress) {
    const T = await loadTesseract();
    const worker = await T.createWorker(['fra', 'nld', 'eng'], 1, { logger: m => { if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100)); } });
    try { return (await worker.recognize(file)).data.text; } finally { await worker.terminate(); }
  }
  window.EtiketOCR = { readImage, parse: E.parseContact };  // exposé pour les tests de bout en bout
  function scanSheet(onApply) {
    const l = L();
    sheet(l.cust.scan, close => {
      const out = h('div', { class: 'stack' });
      const input = h('input', { type: 'file', accept: 'image/*', class: 'sr', id: 'scan-in', onchange: async e => {
        const file = e.target.files[0]; if (!file) return;
        const preview = h('img', { class: 'scan-preview', alt: '' }); preview.src = URL.createObjectURL(file);
        const status = h('p', { class: 'row', role: 'status' }, icon('clock'), h('span', { text: l.cust.scanLoading }));
        fill(out, preview, status);
        try {
          const text = await readImage(file, pr => { status.lastChild.textContent = l.cust.scanning(pr); });
          showParsed(text);
        } catch { fill(out, preview, h('p', { class: 'alert bad' }, icon('alert'), l.cust.scanFail)); }
      } });
      const showParsed = text => {
        const c = E.parseContact(text);
        const rows = [[l.cust.phone, c.phones], [l.cust.email, c.emails], [l.cust.handle, c.handles], [l.cust.addresses, c.addresses.map(fmtAddr)], [l.cust.amounts, c.amounts.map(money)]].filter(([, v]) => v.length);
        fill(out, rows.length ? h('div', { class: 'stack' }, h('h3', { text: l.cust.found }),
          h('dl', { class: 'facts' }, rows.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v.join(' — ') })))),
          btn(l.cust.apply, () => { onApply(c, text); close(); }, 'primary big', 'check')) : h('p', { class: 'alert' }, icon('alert'), l.cust.none),
          h('details', {}, h('summary', { text: l.cust.read }), h('pre', { class: 'code', text: text })));
      };
      const paste = h('textarea', { class: 'input', rows: 3, placeholder: P.lang === 'nl' ? 'Of plak hier de tekst van het gesprek' : 'Ou collez ici le texte de la conversation' });
      return h('div', { class: 'stack' }, h('p', { class: 'muted', text: l.cust.scanHint }),
        h('label', { class: 'dropzone', for: 'scan-in' }, icon('scan'), l.cust.scan), input,
        paste, btn(P.lang === 'nl' ? 'Tekst analyseren' : 'Analyser le texte', () => showParsed(paste.value), 'small', 'search'), out);
    });
  }
  function mergeContact(c, found) {
    if (found.phones[0] && !c.phone) c.phone = found.phones[0];
    if (found.emails[0] && !c.email) c.email = found.emails[0];
    if (found.handles[0] && !c.handle) { c.handle = found.handles[0]; c.channel = c.channel || 'instagram'; }
    if (!c.name && c.handle) c.name = c.handle;
    for (const a of found.addresses) if (!c.addresses.some(x => fmtAddr(x) === fmtAddr(a))) c.addresses.push(a);
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
        btn(l.cust.scan, () => scanSheet(found => { mergeContact(c, found); paint(); }), 'tagged', 'scan'), btn(l.cust.save, saveIt, 'primary', 'check')),
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
      title: { fr: x.title, nl: x.title, en: x.title }, notes: { fr: '', nl: '' }, dims: x.dims, state: x.state, source: 'ig', ig: post.code, seller: { name: '', kind: 'particulier' },
      listings: { ig: { state: 'live', url: `https://www.instagram.com/${S.shop.instagram}/p/${post.code}/` } } };
    S.pieces.push(p); post.imported = p.id; save(); toast(l.ig.created);
    return p;
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
      link(`#/piece/${p.id}`, { class: 'main rowlink' }, h('b', { text: `n° ${p.no} ${title(p)}` }), h('span', { text: chLabel(ch) })), h('span', {}), h('div', { class: 'sub' }, acts));
    return [
      head(l.listings.title, l.listings.intro),
      h('section', { class: 'ig-band' },
        h('div', { class: 'ig-head' }, h('div', {}, h('h2', { class: 'row' }, icon('instagram'), l.ig.title), h('p', { class: 'muted', text: `${l.ig.connected} — ${l.ig.last(`${E.date(S.ig.lastSync.slice(0, 10))} ${S.ig.lastSync.slice(11)}`)}` })),
          h('div', { class: 'row' }, h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: S.ig.auto, onchange: e => { S.ig.auto = e.target.checked; save(); } }), h('span', { text: l.ig.auto })),
            btn(l.ig.sync, () => { S.ig.lastSync = stamp(); save(); render(); toast(l.ig.synced); }, 'small', 'sync'))),
        newPosts().length ? h('div', { class: 'ig-posts' }, newPosts().map(post => { const x = E.parseCaption(post.caption);
          return h('article', { class: 'ig-post' }, h('div', { class: 'card-ph' }, photoEl({ photo: post.photo, cat: guessCat(x.title), tone: 3, photos: 1 })),
            h('div', { class: 'stack', style: 'gap:4px' }, h('b', { text: x.title }), h('span', { class: 'muted', text: [x.price ? money(x.price) : null, x.dims].filter(Boolean).join(' — ') }),
              h('span', { class: 'muted', text: E.date(post.date) })),
            btn(l.ig.create, () => { const p = importPost(post); go(`#/add/${p.id}`); }, 'small primary', 'plus'));
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
  function viewBrocante() {
    const l = L();
    const items = S.pieces.filter(isPrivate);
    const owners = [...new Set(items.map(p => p.owner))];
    const sales = S.sales.filter(s => s.private);
    const addItem = () => sheet(l.broc.add, close => {
      const f = { owner: owners[0] || '', title: '', price: null, cat: 'other', images: [] };
      const ph = h('div', {});
      const input = h('input', { type: 'file', accept: 'image/*', class: 'sr', id: 'broc-photo', onchange: async e => { const d = e.target.files[0] && await shrink(e.target.files[0], 640); if (d) { f.images = [d]; fill(ph, h('img', { class: 'scan-preview', src: d, alt: '' })); } } });
      return h('form', { class: 'stack', onsubmit: e => {
        e.preventDefault(); if (!f.owner.trim() || !f.title.trim() || !(f.price > 0)) return;
        const no = S.nextPrivNo++;
        S.pieces.push({ id: `p${no}`, no, cat: f.cat, status: 'live', price: f.price, scope: 'private', owner: f.owner.trim(), bought: TODAY, photos: f.images.length, images: f.images, tone: no % 8,
          title: { fr: f.title, nl: f.title }, dims: '', state: 'fair', notes: { fr: '', nl: '' }, listings: {} });
        save(); close(); render(); toast(l.broc.added);
      } }, h('p', { class: 'alert' }, icon('alert'), l.broc.rule),
      field(l.broc.owner, h('input', { class: 'input', list: 'owners', value: f.owner, placeholder: l.broc.ownerP, oninput: e => { f.owner = e.target.value; } })),
      h('datalist', { id: 'owners' }, owners.map(o => h('option', { value: o }))),
      field(l.broc.item, h('input', { class: 'input', placeholder: l.broc.itemP, oninput: e => { f.title = e.target.value; } })),
      h('div', { class: 'grid2' }, field(l.broc.price, numIn(null, v => { f.price = v; })),
        field(l.add.catL, h('select', { class: 'input', onchange: e => { f.cat = e.target.value; } }, Object.keys(l.cat).map(k => h('option', { value: k, selected: k === 'other', text: l.cat[k] }))))),
      h('label', { class: 'dropzone', for: 'broc-photo' }, icon('camera'), l.add.takePhoto), input, ph,
      h('button', { type: 'submit', class: 'btn primary big', text: l.broc.add }));
    });
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

  /* ---------- Réglages ---------- */
  const THEME_SW = { entrepot: ['#172126', '#1F2B31', '#D4AC74', '#8FCAB8', '#ECE8DF'], atelier: ['#EDF0F2', '#FFFFFF', '#CB9A5E', '#2348B5', '#15212A'], formica: ['#D6E5DC', '#F3F8F4', '#EDB43A', '#B8322A', '#17322C'] };
  function viewSettings() {
    const l = L();
    return [
      head(l.settings.title, null, btn(l.login.logout, () => { session.set(false); location.hash = '#/login'; render(); }, '', 'close')),
      h('div', { class: 'stack' },
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
      deliveries: ['deliveries', () => viewDeliveries()], customers: ['customers', () => viewCustomers(q)], customer: ['customers', () => viewCustomer(b)], brocante: ['brocante', () => viewBrocante()],
    };
    const [section, view] = routes[a] || routes[''];
    const content = view();
    if (!content.length) return;
    const y = window.scrollY;
    app.replaceChildren(shell(section, content));
    document.title = `${document.querySelector('main h1')?.textContent || 'Etiket'} — Etiket`;
    if (!first && renderReason === 'nav') { window.scrollTo(0, 0); document.querySelector('main h1')?.focus({ preventScroll: true }); } else window.scrollTo(0, y);
    renderReason = 'update'; first = false;
  }
  window.addEventListener('hashchange', () => { renderReason = 'nav'; render(); });
  render();
})();
