'use strict';

/* ============================================================
   script.js — T&D Closet customer side
   ============================================================
   Sections in this file:
     1. Imports and constants
     2. Utility helpers
     3. State
     4. Setup notice (when Firebase isn't configured yet)
     5. Settings loader
     6. Products cache + incremental sync
     7. Availability helpers
     8. Hero collage
     9. Shop rendering (grid, filters, sort, load more)
    10. Product card interaction
    11. Wishlist
    12. Policy modals
    13. Cookie notice
    14. Offline banner
   Part 2 continues with checkout, payment, receipts, tracking,
   owner login trigger, and init.
   ============================================================ */

import {
  FIREBASE_CONFIG, SITE_URL, OWNER_WHATSAPP,
  DEFAULT_INTASEND_PUBLIC_KEY,
  isConfigReady, db,
  fs, DEFAULT_SETTINGS
} from './firebase.js';

const {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  query, where, orderBy, limit, startAfter, runTransaction,
  serverTimestamp, Timestamp
} = fs;

/* ============================================================
   1. CONSTANTS
   ============================================================ */
const CATEGORIES = ['Jeans','Polos','Shirts','Sweatpants','Jackets'];
const PAGE_SIZE = 12;
const PRODUCTS_CACHE_KEY = 'td_products_cache';
const MY_ORDERS_KEY = 'td_my_orders';
const WISHLIST_KEY = 'td_wishlist';
const COOKIE_KEY = 'td_cookie_ok';
const PENDING_CLAIMS_KEY = 'td_pending_claims';
const RESYNC_AFTER_MS = 5 * 60 * 1000;
const HOLD_TICK_MS = 30 * 1000;
const NAIROBI = 'Africa/Nairobi';
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* ============================================================
   2. UTILITY HELPERS
   ============================================================ */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

function escapeHTML(str){
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function formatKSh(n){
  const v = Math.round(Number(n) || 0);
  return 'KSh ' + v.toLocaleString('en-KE');
}
function formatDate(ts){
  try{
    const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d)) return String(ts);
    const dateStr = new Intl.DateTimeFormat('en-GB',
      { timeZone: NAIROBI, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    const timeStr = new Intl.DateTimeFormat('en-GB',
      { timeZone: NAIROBI, hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
    return dateStr + ', ' + timeStr;
  } catch(e){ return String(ts); }
}
function formatTimeShort(ts){
  try{
    const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
    return new Intl.DateTimeFormat('en-GB',
      { timeZone: NAIROBI, hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
  } catch(e){ return ''; }
}
function nowNairobiDateKey(){
  const parts = new Intl.DateTimeFormat('en-GB',
    { timeZone: NAIROBI, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const get = k => (parts.find(p => p.type === k) || {}).value || '';
  return get('year') + get('month') + get('day');
}
function normalizePhone(raw){
  if (!raw) return '';
  let p = String(raw).replace(/[\s\-()]/g,'');
  if (p.charAt(0) === '+') p = p.slice(1);
  if (p.charAt(0) === '0') p = '254' + p.slice(1);
  if (p.charAt(0) === '7' || p.charAt(0) === '1') p = '254' + p;
  return p;
}
function isValidKenyanPhone(raw){
  return /^254(7|1)\d{8}$/.test(normalizePhone(raw));
}
function waLink(phone, text){
  return 'https://wa.me/' + normalizePhone(phone) + '?text=' + encodeURIComponent(text || '');
}
function debounce(fn, ms){
  let t;
  return function(){
    const a = arguments, self = this;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(self, a), ms);
  };
}
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function randomOrderId(){
  const bytes = new Uint8Array(10);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < 10; i++) s += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return 'TD-' + s.slice(0, 5) + '-' + s.slice(5);
}
function toast(msg, type){
  const c = $('#toastContainer');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(10px)'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}
function showConfirm(title, text){
  return new Promise(resolve => {
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmDialog').hidden = false;
    const cleanup = ans => {
      $('#confirmDialog').hidden = true;
      $('#confirmOk').removeEventListener('click', okFn);
      $('#confirmCancel').removeEventListener('click', noFn);
      $('#confirmDialog .modal-overlay').removeEventListener('click', noFn);
      resolve(ans);
    };
    const okFn = () => cleanup(true);
    const noFn = () => cleanup(false);
    $('#confirmOk').addEventListener('click', okFn);
    $('#confirmCancel').addEventListener('click', noFn);
    $('#confirmDialog .modal-overlay').addEventListener('click', noFn);
  });
}

/* ============================================================
   3. STATE
   ============================================================ */
const state = {
  products: [],
  settings: Object.assign({}, DEFAULT_SETTINGS),
  lastSyncMs: 0,
  filterCat: 'all',
  filterSearch: '',
  filterSort: 'newest',
  filterHideSold: false,
  page: 1,
  wishlist: [],
  cartProduct: null,
  cartSize: '',
  cartQty: 1,
  cartFulfilment: 'pickup',
  cartZone: '',
  cartPayOption: 'paynow',
  isSubmitting: false,
  intasendReady: false,
  currentOrderId: null,
  jsPdfLoading: null
};

/* ============================================================
   4. SETUP NOTICE
   ============================================================ */
function showSetupNotice(){
  document.body.innerHTML =
    '<div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,sans-serif;background:#F6F5F2;color:#0E0E0E;text-align:center">' +
    '<div style="max-width:420px">' +
    '<div style="font-family:\'Bebas Neue\',Impact,sans-serif;font-size:44px;letter-spacing:1px;color:#C9962B">T&D Closet</div>' +
    '<h1 style="font-size:20px;margin:16px 0 8px">Shop is being set up</h1>' +
    '<p style="color:#6B6B6B;font-size:14px;line-height:1.6">Firebase is not configured yet. Open <code>firebase.js</code> and paste your Firebase web config. See SETUP.md for the exact steps.</p>' +
    '</div></div>';
}

/* ============================================================
   5. SETTINGS LOADER
   ============================================================ */
async function loadSettings(){
  try{
    const snap = await getDoc(doc(db, 'settings', 'public'));
    if (snap.exists()){
      state.settings = Object.assign({}, DEFAULT_SETTINGS, snap.data());
    } else {
      state.settings = Object.assign({}, DEFAULT_SETTINGS);
    }
  } catch(e){
    console.warn('[T&D] settings load failed, using defaults:', e);
    state.settings = Object.assign({}, DEFAULT_SETTINGS);
  }
  applySettingsToUI();
}
function applySettingsToUI(){
  const s = state.settings;
  if (s.announcement){
    const track = $('#announceTrack');
    if (track){
      const parts = String(s.announcement).split('|').map(x => x.trim()).filter(Boolean);
      track.innerHTML = parts.map(p => '<span>' + escapeHTML(p) + '</span><span class="dot"></span>').join('');
    }
  }
  const till = s.tillNumber || '[ADD TILL NUMBER]';
  const paybill = s.paybill || '[ADD PAYBILL]';
  const send = s.phone || '0740 552 916';
  [['payTill', till],['omTill', till],['payPaybill', paybill],['omPaybill', paybill],['paySend', send]].forEach(pair => {
    const el = document.getElementById(pair[0]);
    if (el) el.textContent = pair[1];
  });
  $$('.copy-btn').forEach(btn => {
    const t = btn.getAttribute('data-copy-target');
    if (t){
      const el = document.getElementById(t);
      if (el) btn.setAttribute('data-copy', el.textContent.trim());
    }
  });
  const legalLine = $('#footerLegalLine');
  if (legalLine){
    const bits = [];
    if (s.legalName) bits.push(escapeHTML(s.legalName));
    if (s.registrationNo) bits.push('Reg No. ' + escapeHTML(s.registrationNo));
    if (s.kraPin) bits.push('KRA PIN ' + escapeHTML(s.kraPin));
    if (bits.length){ legalLine.innerHTML = bits.join('  |  '); legalLine.hidden = false; }
  }
}

/* ============================================================
   6. PRODUCTS CACHE + INCREMENTAL SYNC
   ============================================================ */
function loadProductsFromCache(){
  try{
    const raw = localStorage.getItem(PRODUCTS_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.products = Array.isArray(parsed.items) ? parsed.items : [];
    state.lastSyncMs = Number(parsed.lastSync) || 0;
  } catch(e){ state.products = []; state.lastSyncMs = 0; }
}
function saveProductsToCache(){
  try{
    localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({
      items: state.products.map(p => ({
        id: p.id, name: p.name, category: p.category,
        price: p.price, oldPrice: p.oldPrice || 0,
        sizes: p.sizes || [], images: p.images || [],
        description: p.description || '', condition: p.condition || '',
        stock: p.stock == null ? 1 : p.stock,
        status: p.status || 'available',
        holdUntil: p.holdUntil && p.holdUntil.toMillis ? p.holdUntil.toMillis() : (p.holdUntil || null),
        holdOrderId: p.holdOrderId || null,
        isNew: !!p.isNew, deleted: !!p.deleted,
        createdAt: p.createdAt && p.createdAt.toMillis ? p.createdAt.toMillis() : (p.createdAt || null),
        updatedAt: p.updatedAt && p.updatedAt.toMillis ? p.updatedAt.toMillis() : (p.updatedAt || null)
      })),
      lastSync: state.lastSyncMs
    }));
  } catch(e){}
}
function mergeProducts(list){
  const map = new Map(state.products.map(p => [p.id, p]));
  let maxUpdated = state.lastSyncMs;
  list.forEach(p => {
    if (p.deleted){ map.delete(p.id); return; }
    map.set(p.id, p);
    if (p.updatedAt && p.updatedAt.toMillis) maxUpdated = Math.max(maxUpdated, p.updatedAt.toMillis());
  });
  state.products = Array.from(map.values());
  state.lastSyncMs = maxUpdated;
}
async function syncProducts(){
  try{
    let docs = [];
    if (!state.lastSyncMs){
      const snap = await getDocs(collection(db, 'products'));
      docs = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    } else {
      const since = Timestamp.fromMillis(state.lastSyncMs);
      const q = query(collection(db, 'products'), where('updatedAt', '>', since));
      const snap = await getDocs(q);
      docs = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }
    mergeProducts(docs);
    saveProductsToCache();
    return true;
  } catch(e){
    console.warn('[T&D] product sync failed:', e);
    return false;
  }
}

/* ============================================================
   7. AVAILABILITY HELPERS
   ============================================================ */
function productState(p){
  if (p.deleted) return 'removed';
  const stock = p.stock == null ? 1 : Number(p.stock);
  if (p.status === 'sold' || stock <= 0) return 'sold';
  if (p.status === 'held'){
    const until = p.holdUntil && p.holdUntil.toMillis ? p.holdUntil.toMillis() : (p.holdUntil || 0);
    if (until > Date.now()) return 'reserved';
    return 'available';
  }
  return 'available';
}
function holdRemainingMs(p){
  const until = p.holdUntil && p.holdUntil.toMillis ? p.holdUntil.toMillis() : (p.holdUntil || 0);
  return Math.max(0, until - Date.now());
}
function formatHoldRemaining(ms){
  const totalMins = Math.ceil(ms / 60000);
  if (totalMins >= 60){
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return h + 'h ' + (m ? m + 'm' : '').trim();
  }
  return totalMins + ' min';
}

/* ============================================================
   8. HERO COLLAGE
   ============================================================ */
function renderHeroCollage(){
  const withImages = state.products.filter(p => p.images && p.images.length);
  ['1','2','3'].forEach((slot, i) => {
    const el = document.querySelector('.hero-collage .tile-' + slot);
    if (!el) return;
    const p = withImages[i];
    if (p){
      el.style.backgroundImage = 'url("' + String(p.images[0]).replace(/"/g, '%22') + '")';
      el.classList.remove('empty');
      el.removeAttribute('data-label');
    } else {
      el.classList.add('empty');
      el.setAttribute('data-label', 'New drops');
    }
  });
}

/* ============================================================
   9. SHOP RENDERING
   ============================================================ */
function applyFilters(){
  let list = state.products.slice();
  if (state.filterCat !== 'all') list = list.filter(p => p.category === state.filterCat);
  if (state.filterHideSold) list = list.filter(p => productState(p) !== 'sold');
  if (state.filterSearch){
    const q = state.filterSearch.toLowerCase();
    list = list.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q)
    );
  }
  if (state.filterSort === 'price-asc') list.sort((a,b) => (a.price||0)-(b.price||0));
  else if (state.filterSort === 'price-desc') list.sort((a,b) => (b.price||0)-(a.price||0));
  else list.sort((a,b) => {
    const am = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : (a.createdAt || 0);
    const bm = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : (b.createdAt || 0);
    return bm - am;
  });
  return list;
}
function productCardHTML(p){
  const st = productState(p);
  const hasImg = p.images && p.images.length;
  const hasOld = p.oldPrice && Number(p.oldPrice) > Number(p.price);
  const discount = hasOld ? Math.round((1 - p.price / p.oldPrice) * 100) : 0;
  const imgHTML = hasImg
    ? '<img src="' + escapeHTML(p.images[0]) + '" alt="' + escapeHTML(p.name) + '" loading="lazy" decoding="async">'
    : '<div class="placeholder">' + escapeHTML(p.category || 'Item') + '</div>';
  const badges = [];
  if (p.isNew && st === 'available') badges.push('<span class="badge badge-new">New</span>');
  if (hasOld && st === 'available')  badges.push('<span class="badge badge-sale">-' + discount + '%</span>');
  if (st === 'reserved') badges.push('<span class="badge" style="background:#C9962B;color:#fff">Reserved</span>');
  if (st === 'sold')     badges.push('<span class="badge badge-sold">Sold out</span>');
  const isWished = state.wishlist.includes(p.id);
  const sizes = Array.isArray(p.sizes) ? p.sizes : [];
  const sizeChips = sizes.map(s =>
    '<button class="size-btn" data-size="' + escapeHTML(s) + '" aria-pressed="false">' + escapeHTML(s) + '</button>'
  ).join('');
  const disabled = st === 'sold' || st === 'reserved';
  const label = st === 'sold' ? 'Sold out' : (st === 'reserved' ? 'Reserved' : 'Reserve');
  const btnClass = st === 'reserved' ? 'reserve-btn reserved' : (st === 'sold' ? 'reserve-btn' : 'reserve-btn');
  return '<article class="product-card" data-id="' + escapeHTML(p.id) + '" data-state="' + st + '">' +
    '<div class="product-media" data-open>' + imgHTML +
      '<div class="badges">' + badges.join('') + '</div>' +
      '<button class="heart-btn ' + (isWished?'active':'') + '" data-heart aria-label="Wishlist"><svg width="18" height="18"><use href="#i-heart"/></svg></button>' +
    '</div>' +
    '<div class="product-body">' +
      '<span class="product-cat">' + escapeHTML(p.category || '') + '</span>' +
      '<h3 class="product-name">' + escapeHTML(p.name || '') + '</h3>' +
      '<div class="product-price-row"><span class="product-price">' + formatKSh(p.price) + '</span>' +
        (hasOld ? '<span class="product-old">' + formatKSh(p.oldPrice) + '</span>' : '') + '</div>' +
      (p.condition ? '<span class="product-cond">Condition: ' + escapeHTML(p.condition) + '</span>' : '') +
      (sizes.length ? '<div class="product-sizes" data-sizes>' + sizeChips + '</div>' : '') +
      '<button class="' + btnClass + '" data-reserve ' + (disabled ? 'disabled' : '') + '>' +
        '<svg width="16" height="16"><use href="#i-bag"/></svg>' + label +
      '</button>' +
    '</div>' +
  '</article>';
}
function renderShop(){
  const grid = $('#productGrid');
  const empty = $('#emptyState');
  const count = $('#productCount');
  const loadMore = $('#loadMoreBtn');
  if (!grid) return;
  const filtered = applyFilters();
  const total = filtered.length;
  const visible = filtered.slice(0, state.page * PAGE_SIZE);
  grid.innerHTML = visible.map(productCardHTML).join('');
  if (count) count.textContent = total + (total === 1 ? ' item' : ' items');
  if (empty) empty.hidden = total > 0;
  if (loadMore) loadMore.hidden = visible.length >= total;
  observeCards();
}
function observeCards(){
  const cards = $$('#productGrid .product-card');
  if (!('IntersectionObserver' in window)){
    cards.forEach(c => c.classList.add('in-view'));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting){
        const idx = cards.indexOf(e.target);
        e.target.style.transitionDelay = ((idx % 8) * 40) + 'ms';
        e.target.classList.add('in-view');
        io.unobserve(e.target);
      }
    });
  }, { rootMargin: '0px 0px -40px 0px', threshold: 0.05 });
  cards.forEach(c => io.observe(c));
}
function renderSkeletons(){
  const s = $('#skeletons');
  if (!s) return;
  let html = '';
  for (let i = 0; i < 8; i++) html += '<div class="skeleton-card"></div>';
  s.innerHTML = html;
}
function clearSkeletons(){ const s = $('#skeletons'); if (s) s.innerHTML = ''; }

/* ============================================================
   10. PRODUCT CARD INTERACTION
   ============================================================ */
function bindProductGrid(){
  const grid = $('#productGrid');
  if (!grid) return;
  grid.addEventListener('click', e => {
    const card = e.target.closest('.product-card');
    if (!card) return;
    const id = card.dataset.id;
    const p = state.products.find(x => x.id === id);
    if (!p) return;

    const heart = e.target.closest('[data-heart]');
    if (heart){
      e.stopPropagation();
      toggleWishlist(id, heart);
      return;
    }
    const sizeBtn = e.target.closest('.size-btn');
    if (sizeBtn){
      e.stopPropagation();
      $$('.size-btn', card).forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
      sizeBtn.classList.add('active');
      sizeBtn.setAttribute('aria-pressed','true');
      card.dataset.selectedSize = sizeBtn.dataset.size;
      return;
    }
    const reserveBtn = e.target.closest('[data-reserve]');
    if (reserveBtn && !reserveBtn.disabled){
      e.stopPropagation();
      openCheckout(id, card.dataset.selectedSize || '');
      return;
    }
    if (e.target.closest('[data-open]') || e.target.closest('.product-name')){
      const st = productState(p);
      if (st === 'sold' || st === 'reserved'){
        notifyMe(p);
        return;
      }
      openCheckout(id, card.dataset.selectedSize || '');
    }
  });
}
function notifyMe(p){
  const msg = 'Hi T&D Closet, please tell me if "' + p.name + '" becomes available again.';
  window.open(waLink(OWNER_WHATSAPP, msg), '_blank');
}

/* ============================================================
   11. WISHLIST
   ============================================================ */
function loadWishlist(){
  try{ state.wishlist = JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]'); }
  catch(e){ state.wishlist = []; }
}
function saveWishlist(){
  try{ localStorage.setItem(WISHLIST_KEY, JSON.stringify(state.wishlist)); }catch(e){}
}
function toggleWishlist(id, heartEl){
  const i = state.wishlist.indexOf(id);
  if (i >= 0) state.wishlist.splice(i,1); else state.wishlist.push(id);
  saveWishlist();
  if (heartEl) heartEl.classList.toggle('active');
  updateWishlistBadge();
}
function updateWishlistBadge(){
  const badge = $('#navWishlistCount');
  if (!badge) return;
  const n = state.wishlist.length;
  badge.textContent = n;
  badge.hidden = n === 0;
}

/* ============================================================
   12. POLICY MODALS
   ============================================================ */
const POLICY_TITLES = {
  terms: 'Terms of Sale',
  privacy: 'Privacy Policy',
  returns: 'Returns and Exchange Policy',
  delivery: 'Delivery Policy'
};
function policyContentHTML(key){
  const s = state.settings;
  const custom = { terms: s.termsText, privacy: s.privacyText, returns: s.returnsText, delivery: s.deliveryText }[key];
  if (custom && String(custom).trim()){
    return String(custom).split(/\n\n+/).map(par =>
      '<p>' + escapeHTML(par).replace(/\n/g, '<br>') + '</p>'
    ).join('');
  }
  const biz = escapeHTML(s.businessName || 'T&D Closet');
  const addr = escapeHTML(s.address || '');
  const phone = escapeHTML(s.phone || '');
  if (key === 'terms'){
    return [
      '<p>These Terms of Sale govern your purchase of items from ' + biz + ' (' + addr + '). By placing an order you agree to them.</p>',
      '<h3>Prices</h3><p>All prices are in Kenyan Shillings (KSh) and include VAT where applicable. Delivery is charged separately and shown before payment.</p>',
      '<h3>Reservation and confirmation</h3><p>Each item is one of a kind. Items are reserved on a first-paid or first-held basis. A hold expires automatically after the period shown at checkout. An order is confirmed only once we have verified payment or agreed pickup.</p>',
      '<h3>Right to cancel</h3><p>If an item becomes unavailable, or a payment cannot be verified, we may cancel the order and refund any verified amount by M-Pesa.</p>',
      '<h3>Delivery</h3><p>Delivery timelines depend on the zone you selected. Risk passes to you when the item is handed to the courier or on pickup.</p>',
      '<h3>Governing law</h3><p>These terms are governed by the laws of Kenya. Questions? WhatsApp us on ' + phone + '.</p>'
    ].join('');
  }
  if (key === 'privacy'){
    return [
      '<p>' + biz + ' respects your privacy and complies with the Kenya Data Protection Act, 2019.</p>',
      '<h3>What we collect</h3><p>Name, phone number, email (optional), delivery address, order details and, for payments, the M-Pesa reference. We never see your M-Pesa PIN.</p>',
      '<h3>Why we collect it</h3><p>To fulfil orders, contact you about them, process payments, prevent fraud, and keep accounting records. We rely on your consent and on the contract we have with you.</p>',
      '<h3>Who we share with</h3><p>IntaSend and Safaricom M-Pesa for payments; Firebase (Google) hosts our database; WhatsApp for messaging. We do not sell your data.</p>',
      '<h3>How long we keep it</h3><p>Up to 24 months from your last order, unless the law requires longer.</p>',
      '<h3>Your rights</h3><p>You may ask to see, correct or delete your data, or object to processing. Message us on ' + phone + ' with your order number. Registered with the Office of the Data Protection Commissioner: [registration number].</p>',
      '<h3>Local storage</h3><p>We store your cart, wishlist and past order numbers in your own browser. Clearing browser data removes them.</p>'
    ].join('');
  }
  if (key === 'returns'){
    return [
      '<p>Thrifted items are pre-owned. Condition is graded and shown on every listing.</p>',
      '<h3>When we accept returns</h3><p>Within 48 hours of receiving your item, if it is materially not as described or you were sent the wrong item. The item must be unaltered, unworn outside fitting, and in the same condition you received it.</p>',
      '<h3>How to start a return</h3><p>WhatsApp ' + phone + ' with your order number and photos of the issue. We will arrange a return or exchange.</p>',
      '<h3>Refunds</h3><p>Approved refunds are sent back to your M-Pesa number within 3 working days.</p>',
      '<h3>Not covered</h3><p>Change of mind, sale items marked final, or damage after delivery.</p>'
    ].join('');
  }
  if (key === 'delivery'){
    const zones = Array.isArray(s.deliveryZones) ? s.deliveryZones : [];
    const rows = zones.map(z => '<li>' + escapeHTML(z.name) + ' — ' + formatKSh(z.fee) + ' — ' + escapeHTML(z.eta || '') + '</li>').join('');
    return [
      '<p>We deliver countrywide via courier or bus parcel. Pickup is free at ' + addr + '.</p>',
      '<h3>Zones and fees</h3><ul>' + (rows || '<li>Delivery fee is confirmed at checkout.</li>') + '</ul>',
      '<h3>Timelines</h3><p>Typical delivery is 1 to 3 days after payment is verified. You will receive the tracking details on WhatsApp.</p>',
      '<h3>Inspection</h3><p>Please inspect your parcel when you receive it. Report any issue within 48 hours.</p>'
    ].join('');
  }
  return '<p>Policy text is being prepared.</p>';
}
function openPolicy(key){
  const title = POLICY_TITLES[key] || 'Policy';
  $('#pmTitle').textContent = title;
  $('#pmContent').innerHTML = policyContentHTML(key);
  $('#policyModal').hidden = false;
  document.body.style.overflow = 'hidden';
  if (location.hash !== '#' + key) history.replaceState(null, '', '#' + key);
}
function closePolicy(){
  $('#policyModal').hidden = true;
  document.body.style.overflow = '';
  if (['#terms','#privacy','#returns','#delivery-policy'].includes(location.hash)){
    history.replaceState(null, '', location.pathname + location.search);
  }
}
function bindPolicy(){
  document.addEventListener('click', e => {
    const link = e.target.closest('[data-policy]');
    if (link){
      e.preventDefault();
      openPolicy(link.getAttribute('data-policy'));
      return;
    }
    if (e.target.closest('[data-policy-close]')) closePolicy();
  });
}

/* ============================================================
   13. COOKIE NOTICE
   ============================================================ */
function bindCookieNotice(){
  const el = $('#cookieNotice');
  if (!el) return;
  if (localStorage.getItem(COOKIE_KEY) === '1') return;
  el.hidden = false;
  $('#cookieAccept').addEventListener('click', () => {
    localStorage.setItem(COOKIE_KEY, '1');
    el.hidden = true;
  });
}

/* ============================================================
   14. OFFLINE BANNER
   ============================================================ */
function bindOfflineBanner(){
  const el = $('#offlineBanner');
  if (!el) return;
  const update = () => { el.hidden = navigator.onLine; };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

/* ============================================================
   15. COPY BUTTONS (global)
   ============================================================ */
function bindCopyButtons(){
  document.addEventListener('click', async e => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    const text = btn.getAttribute('data-copy') || '';
    if (!text) return;
    try{
      if (navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast('Copied.', 'success');
    } catch(err){ toast('Copy failed.', 'error'); }
  });
}

/* ============================================================
   16. OPEN-HOURS STATUS
   ============================================================ */
function updateOpenStatus(){
  const el = $('#openStatus');
  if (!el) return;
  try{
    const parts = new Intl.DateTimeFormat('en-GB',
      { timeZone: NAIROBI, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date());
    const get = k => { const p = parts.find(x => x.type === k); return p ? p.value : ''; };
    const weekday = get('weekday');
    const hour = Number(get('hour'));
    const minute = Number(get('minute'));
    const open = weekday !== 'Sun' && (hour > 8 || (hour === 8 && minute >= 0)) && hour < 20;
    el.classList.toggle('open', open);
    el.classList.toggle('closed', !open);
    el.innerHTML = '<span class="dot-status"></span>' + (open ? 'Open now' : 'Closed now');
  } catch(e){
    el.innerHTML = '<span class="dot-status"></span>Mon - Sat, 8AM - 8PM';
  }
}

/* ============================================================
   17. NAV / MISC UI BINDINGS
   ============================================================ */
function bindNav(){
  const navbar = $('#navbar');
  const onScroll = () => {
    if (!navbar) return;
    if (window.scrollY > 10) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
    const bt = $('#backToTop');
    if (bt) bt.hidden = window.scrollY < 600;
    const mb = $('#mobileBottomBar');
    if (mb) mb.hidden = window.scrollY < 400;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const backTop = $('#backToTop');
  if (backTop) backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  const menuBtn = $('#navMenuBtn');
  const menu = $('#mobileMenu');
  const overlay = $('#mobileMenuOverlay');
  const closeMenu = () => {
    if (!menu) return;
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden','true');
    if (overlay){ overlay.classList.remove('show'); setTimeout(() => overlay.hidden = true, 250); }
    if (menuBtn) menuBtn.setAttribute('aria-expanded','false');
    document.body.style.overflow = '';
  };
  const openMenu = () => {
    if (!menu) return;
    menu.classList.add('open');
    menu.setAttribute('aria-hidden','false');
    if (overlay){ overlay.hidden = false; requestAnimationFrame(() => overlay.classList.add('show')); }
    if (menuBtn) menuBtn.setAttribute('aria-expanded','true');
    document.body.style.overflow = 'hidden';
  };
  if (menuBtn) menuBtn.addEventListener('click', openMenu);
  const closeBtn = $('#mobileMenuClose');
  if (closeBtn) closeBtn.addEventListener('click', closeMenu);
  if (overlay) overlay.addEventListener('click', closeMenu);
  $$('#mobileMenu a').forEach(a => a.addEventListener('click', closeMenu));

  const searchBar = $('#navSearchBar');
  const searchInput = $('#navSearchInput');
  const searchBtn = $('#navSearchBtn');
  if (searchBtn && searchBar){
    searchBtn.addEventListener('click', () => {
      searchBar.hidden = !searchBar.hidden;
      if (!searchBar.hidden && searchInput) searchInput.focus();
    });
  }
  const searchClose = $('#navSearchClose');
  if (searchClose && searchBar) searchClose.addEventListener('click', () => searchBar.hidden = true);
  if (searchInput){
    searchInput.addEventListener('input', debounce(() => {
      state.filterSearch = searchInput.value;
      state.page = 1;
      const mainSearch = $('#searchInput');
      if (mainSearch) mainSearch.value = searchInput.value;
      renderShop();
    }, 220));
  }

  const wishBtn = $('#navWishlistBtn');
  if (wishBtn) wishBtn.addEventListener('click', () => {
    if (!state.wishlist.length){ toast('No items in your wishlist yet.'); return; }
    state.filterCat = 'all';
    state.filterSearch = '';
    renderShop();
    const shop = $('#shop'); if (shop) shop.scrollIntoView({ behavior: 'smooth' });
    toast(state.wishlist.length + ' wishlisted item(s)');
  });

  const chips = $$('#categoryChips .chip');
  chips.forEach(c => c.addEventListener('click', () => {
    chips.forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    state.filterCat = c.dataset.cat;
    state.page = 1;
    renderShop();
  }));

  const sortSel = $('#sortSelect');
  if (sortSel) sortSel.addEventListener('change', e => { state.filterSort = e.target.value; renderShop(); });
  const hideSold = $('#hideSoldToggle');
  if (hideSold) hideSold.addEventListener('change', e => { state.filterHideSold = e.target.checked; renderShop(); });

  const mainSearch = $('#searchInput');
  if (mainSearch){
    mainSearch.addEventListener('input', debounce(e => {
      state.filterSearch = e.target.value;
      state.page = 1;
      renderShop();
    }, 220));
  }
  const clearBtn = $('#clearFiltersBtn');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    state.filterCat = 'all';
    state.filterSearch = '';
    state.filterHideSold = false;
    state.filterSort = 'newest';
    state.page = 1;
    chips.forEach(x => x.classList.toggle('active', x.dataset.cat === 'all'));
    if (mainSearch) mainSearch.value = '';
    if (sortSel) sortSel.value = 'newest';
    if (hideSold) hideSold.checked = false;
    renderShop();
  });
  const loadMore = $('#loadMoreBtn');
  if (loadMore) loadMore.addEventListener('click', () => { state.page++; renderShop(); });

  const retryBtn = $('#shopRetryBtn');
  if (retryBtn) retryBtn.addEventListener('click', async () => {
    $('#shopError').hidden = true;
    const ok = await syncProducts();
    if (ok) renderShop(); else $('#shopError').hidden = false;
  });
}

/* ============================================================
   18. HASH ROUTES
   ============================================================ */
function handleHash(){
  if (location.hash === '#owner'){ openOwner(); return; }
  const h = location.hash;
  if (h === '#terms' || h === '#privacy' || h === '#returns' || h === '#delivery-policy'){
    const key = h.slice(1) === 'delivery-policy' ? 'delivery' : h.slice(1);
    openPolicy(key);
  }
}

/* CONTINUE WITH: script.js (part 2) */

/* ============================================================
   19. CHECKOUT MODAL
   ============================================================ */
function openCheckout(productId, preselectSize){
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  const st = productState(p);
  if (st === 'sold'){ toast('This item is sold out.', 'error'); return; }
  if (st === 'reserved'){ notifyMe(p); return; }

  state.cartProduct = p;
  state.cartSize = preselectSize || '';
  state.cartQty = 1;
  state.cartFulfilment = 'pickup';
  state.cartZone = (state.settings.deliveryZones && state.settings.deliveryZones[0]) ? state.settings.deliveryZones[0].name : '';
  state.cartPayOption = pickDefaultPayOption();

  // Gallery
  const imgs = (p.images && p.images.length) ? p.images : [];
  const main = $('#omMainImg');
  if (main){
    if (imgs.length) main.innerHTML = '<img src="' + escapeHTML(imgs[0]) + '" alt="' + escapeHTML(p.name) + '">';
    else main.innerHTML = '<div class="placeholder">' + escapeHTML(p.category || 'Item') + '</div>';
  }
  const thumbs = $('#omThumbs');
  if (thumbs){
    if (imgs.length > 1){
      thumbs.innerHTML = imgs.map((url, i) =>
        '<button class="om-thumb ' + (i===0?'active':'') + '" data-thumb="' + i + '"><img src="' + escapeHTML(url) + '" alt=""></button>'
      ).join('');
    } else thumbs.innerHTML = '';
  }

  // Text
  $('#omCat').textContent = p.category || '';
  $('#omTitle').textContent = p.name || '';
  $('#omPrice').textContent = formatKSh(p.price);
  const oldEl = $('#omOldPrice');
  if (p.oldPrice && p.oldPrice > p.price){ oldEl.hidden = false; oldEl.textContent = formatKSh(p.oldPrice); }
  else oldEl.hidden = true;
  $('#omDesc').textContent = p.description || '';
  const meta = [];
  if (p.condition) meta.push('Condition: ' + p.condition);
  if (p.isNew) meta.push('New arrival');
  $('#omMeta').innerHTML = meta.map(m => '<span>' + escapeHTML(m) + '</span>').join('');

  // Sizes
  const sizes = Array.isArray(p.sizes) ? p.sizes : [];
  const sizeHTML = sizes.map(s =>
    '<button type="button" class="size-btn" data-size="' + escapeHTML(s) + '" aria-pressed="false">' + escapeHTML(s) + '</button>'
  ).join('');
  $('#omSizeChips').innerHTML = sizeHTML || '<p class="field-hint">No sizes listed. Mention your size on WhatsApp after paying.</p>';

  // Delivery zone select
  const zoneSel = $('#omZone');
  if (zoneSel){
    const zones = state.settings.deliveryZones || [];
    zoneSel.innerHTML = zones.map(z =>
      '<option value="' + escapeHTML(z.name) + '" data-fee="' + Number(z.fee || 0) + '">' +
      escapeHTML(z.name) + ' - ' + formatKSh(z.fee) + (z.eta ? ' (' + escapeHTML(z.eta) + ')' : '') +
      '</option>'
    ).join('');
  }

  // Reset fields
  $('#omName').value = '';
  $('#omPhone').value = '';
  $('#omEmail').value = '';
  $('#omAddress').value = '';
  $('#omMpesaCode').value = '';
  $('#omConsent').checked = false;
  $$('.field-error').forEach(e => e.hidden = true);
  $$('#omFulfilment .seg').forEach(s => s.classList.toggle('active', s.dataset.fulfilment === 'pickup'));
  $('#omDeliveryGroup').hidden = true;
  $('#omManualBlock').hidden = true;

  applyPayOptionVisibility();
  selectPayOption(state.cartPayOption);
  updateCartTotal();

  $('#orderModal').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => { const inp = $('#omName'); if (inp) inp.focus(); }, 120);
}
function closeCheckout(){
  $('#orderModal').hidden = true;
  document.body.style.overflow = '';
  state.cartProduct = null;
  state.cartSize = '';
  state.cartQty = 1;
}
function pickDefaultPayOption(){
  if (state.settings.enableOnlinePayment && window.IntaSend) return 'paynow';
  if (state.settings.enableManualMpesa) return 'manual';
  if (state.settings.enableBooking) return 'booking';
  return 'pickup';
}
function applyPayOptionVisibility(){
  const s = state.settings;
  const paynow = document.querySelector('.pay-option[data-option="paynow"]');
  const booking = document.querySelector('.pay-option[data-option="booking"]');
  const pickup = document.querySelector('.pay-option[data-option="pickup"]');
  const manual = document.querySelector('.pay-option[data-option="manual"]');
  if (paynow) paynow.hidden = !s.enableOnlinePayment;
  if (booking) booking.hidden = !s.enableBooking;
  if (manual) manual.hidden = !s.enableManualMpesa;
  if (pickup) pickup.hidden = (state.cartFulfilment !== 'delivery' ? false : true) || !s.enablePayOnPickup;
  // Pickup option is only relevant when fulfilment is pickup
  if (pickup) pickup.hidden = (state.cartFulfilment === 'pickup' && s.enablePayOnPickup) ? false : true;
}
function selectPayOption(name){
  state.cartPayOption = name;
  $$('#omPayOptions .pay-option').forEach(el => el.classList.toggle('selected', el.dataset.option === name));
  const radio = document.querySelector('#omPayOptions input[value="' + name + '"]');
  if (radio) radio.checked = true;
  $('#omManualBlock').hidden = name !== 'manual';
  updateSubmitLabel();
  updateCartTotal();
}
function updateSubmitLabel(){
  const label = $('#omSubmitLabel');
  if (!label) return;
  const due = computeDueNow();
  if (state.cartPayOption === 'paynow') label.textContent = due > 0 ? 'Pay ' + formatKSh(due) + ' now' : 'Pay now';
  else if (state.cartPayOption === 'booking') label.textContent = due > 0 ? 'Book and pay ' + formatKSh(due) + ' deposit' : 'Book now (free hold)';
  else if (state.cartPayOption === 'pickup') label.textContent = 'Reserve for pickup';
  else if (state.cartPayOption === 'manual') label.textContent = 'Submit M-Pesa code';
  else label.textContent = 'Place order';
}
function computeDeliveryFee(){
  if (state.cartFulfilment !== 'delivery') return 0;
  const sel = $('#omZone');
  if (!sel) return 0;
  const opt = sel.options[sel.selectedIndex];
  return opt ? (Number(opt.getAttribute('data-fee')) || 0) : 0;
}
function computeTotal(){
  const p = state.cartProduct; if (!p) return 0;
  return (Number(p.price) || 0) * state.cartQty + computeDeliveryFee();
}
function computeDueNow(){
  const total = computeTotal();
  if (state.cartPayOption === 'paynow') return total;
  if (state.cartPayOption === 'manual') return total;
  if (state.cartPayOption === 'booking'){
    const pct = Number(state.settings.bookingDepositPercent || 0);
    return Math.round(total * pct / 100);
  }
  return 0;
}
function updateCartTotal(){
  const p = state.cartProduct;
  if (!p) return;
  const itemTotal = (Number(p.price) || 0) * state.cartQty;
  const delivery = computeDeliveryFee();
  const total = itemTotal + delivery;
  const due = computeDueNow();
  $('#omSummaryItem').textContent = formatKSh(itemTotal);
  const dRow = $('#omSummaryDeliveryRow');
  if (dRow) dRow.hidden = delivery <= 0;
  $('#omSummaryDelivery').textContent = formatKSh(delivery);
  $('#omTotal').textContent = formatKSh(total);
  $('#omDueNow').textContent = formatKSh(due);
  updateSubmitLabel();
}

/* ============================================================
   20. CHECKOUT MODAL BINDINGS
   ============================================================ */
function bindCheckout(){
  const modal = $('#orderModal');
  if (!modal) return;
  modal.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) closeCheckout();
  });

  $('#omSizeChips').addEventListener('click', e => {
    const btn = e.target.closest('.size-btn');
    if (!btn) return;
    $$('#omSizeChips .size-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed','true');
    state.cartSize = btn.dataset.size;
    $('#omSizeError').hidden = true;
  });

  $$('#omFulfilment .seg').forEach(s => {
    s.addEventListener('click', () => {
      $$('#omFulfilment .seg').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      state.cartFulfilment = s.dataset.fulfilment;
      $('#omDeliveryGroup').hidden = state.cartFulfilment !== 'delivery';
      applyPayOptionVisibility();
      if (state.cartFulfilment === 'delivery' && state.cartPayOption === 'pickup'){
        selectPayOption(state.settings.enableOnlinePayment ? 'paynow' : 'manual');
      }
      updateCartTotal();
    });
  });

  const zoneSel = $('#omZone');
  if (zoneSel) zoneSel.addEventListener('change', () => {
    state.cartZone = zoneSel.value;
    updateCartTotal();
  });

  $('#omPayOptions').addEventListener('click', e => {
    const opt = e.target.closest('.pay-option');
    if (!opt || opt.hidden) return;
    selectPayOption(opt.dataset.option);
  });

  $('#omThumbs').addEventListener('click', e => {
    const t = e.target.closest('[data-thumb]');
    if (!t) return;
    const i = Number(t.dataset.thumb);
    const p = state.cartProduct;
    if (!p || !p.images || !p.images[i]) return;
    $('#omMainImg').innerHTML = '<img src="' + escapeHTML(p.images[i]) + '" alt="' + escapeHTML(p.name) + '">';
    $$('#omThumbs .om-thumb').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
  });

  $('#omSubmit').addEventListener('click', submitOrder);
}

/* ============================================================
   21. SUBMIT ORDER
   ============================================================ */
async function submitOrder(){
  if (state.isSubmitting) return;
  const p = state.cartProduct;
  if (!p) return;

  // Validate
  let ok = true;
  const hasSizes = Array.isArray(p.sizes) && p.sizes.length > 0;
  if (hasSizes && !state.cartSize){ $('#omSizeError').hidden = false; ok = false; }
  const name = $('#omName').value.trim();
  if (name.length < 2){ $('#omNameError').hidden = false; ok = false; }
  const phoneRaw = $('#omPhone').value.trim();
  if (!isValidKenyanPhone(phoneRaw)){ $('#omPhoneError').hidden = false; ok = false; }
  const isDelivery = state.cartFulfilment === 'delivery';
  const address = $('#omAddress').value.trim();
  if (isDelivery && address.length < 2){ $('#omAddressError').hidden = false; ok = false; }
  if (!$('#omConsent').checked){ $('#omConsentError').hidden = false; ok = false; }
  if (state.cartPayOption === 'manual'){
    const code = $('#omMpesaCode').value.trim();
    if (!/^[A-Z0-9]{10}$/i.test(code)){ $('#omMpesaCodeError').hidden = false; ok = false; }
  }
  if (!ok){
    const first = document.querySelector('.field-error:not([hidden])');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  state.isSubmitting = true;
  const btn = $('#omSubmit');
  btn.disabled = true;
  btn.textContent = 'Reserving...';

  const orderId = randomOrderId();
  state.currentOrderId = orderId;

  try{
    // 1. Claim the item
    const claimed = await claimItem(p, orderId);
    if (!claimed){
      state.isSubmitting = false;
      btn.disabled = false;
      updateSubmitLabel();
      toast('Sorry, this piece was just taken.', 'error');
      await syncProducts();
      renderShop();
      closeCheckout();
      return;
    }

    // 2. Create order
    const itemTotal = Number(p.price) * state.cartQty;
    const deliveryFee = computeDeliveryFee();
    const total = itemTotal + deliveryFee;
    const dueNow = computeDueNow();

    let status, kind, paymentMethod, holdMs;
    if (state.cartPayOption === 'paynow'){
      kind = 'purchase'; status = 'awaiting_payment'; paymentMethod = 'mpesa_stk';
      holdMs = (Number(state.settings.payNowHoldMinutes) || 15) * 60 * 1000;
    } else if (state.cartPayOption === 'booking'){
      kind = 'booking'; status = 'booked'; paymentMethod = 'none';
      holdMs = (Number(state.settings.bookingHoldHours) || 24) * 60 * 60 * 1000;
    } else if (state.cartPayOption === 'pickup'){
      kind = 'purchase'; status = 'pay_on_pickup'; paymentMethod = 'pickup';
      holdMs = (Number(state.settings.bookingHoldHours) || 24) * 60 * 60 * 1000;
    } else {
      kind = 'purchase'; status = 'awaiting_payment'; paymentMethod = 'mpesa_manual';
      holdMs = (Number(state.settings.payNowHoldMinutes) || 15) * 60 * 1000;
    }

    const holdUntil = Timestamp.fromMillis(Date.now() + holdMs);

    const order = {
      orderId, kind, status,
      paymentStatus: 'unpaid',
      paymentMethod,
      paymentRef: '',
      productId: p.id,
      productName: p.name || '',
      productImage: (p.images && p.images[0]) || '',
      size: state.cartSize || '',
      qty: state.cartQty,
      unitPrice: Number(p.price),
      deliveryFee,
      total,
      amountDue: dueNow,
      customerName: name,
      phone: normalizePhone(phoneRaw),
      email: ($('#omEmail') && $('#omEmail').value.trim()) || '',
      fulfilment: state.cartFulfilment,
      deliveryZone: isDelivery ? state.cartZone : '',
      address: isDelivery ? address : '',
      consent: true,
      holdUntil,
      createdAt: serverTimestamp()
    };

    await setDoc(doc(db, 'orders', orderId), order);

    // 3. Local record
    const list = loadMyOrdersList();
    list.unshift({ orderId, createdAt: Date.now(), item: p.name, total });
    localStorage.setItem(MY_ORDERS_KEY, JSON.stringify(list.slice(0, 30)));

    // 4. Branch on payment method
    if (state.cartPayOption === 'paynow'){
      closeCheckout();
      await runIntaSendPayment(order);
    } else if (state.cartPayOption === 'manual'){
      const code = $('#omMpesaCode').value.trim().toUpperCase();
      await recordPaymentClaim(orderId, 'mpesa_manual', code, false);
      closeCheckout();
      showSuccess(orderId, 'Payment claim received', 'We are verifying your M-Pesa payment. You will be contacted on WhatsApp.');
    } else {
      closeCheckout();
      const title = state.cartPayOption === 'booking' ? 'Booking confirmed' : 'Pickup reserved';
      const sub = state.cartPayOption === 'booking'
        ? 'We are holding this piece for you. Pay or collect within the hold window.'
        : 'Pay when you collect in store. See you soon.';
      showSuccess(orderId, title, sub);
    }
  } catch(e){
    console.error('[T&D] submit error:', e);
    toast('Something went wrong. Please try again.', 'error');
    state.isSubmitting = false;
    btn.disabled = false;
    updateSubmitLabel();
  }
}

/* ============================================================
   22. CLAIM ITEM TRANSACTION
   ============================================================ */
async function claimItem(product, orderId){
  const stock = product.stock == null ? 1 : Number(product.stock);
  if (stock > 1) return true; // Not one-of-one, skip the hold
  try{
    let ok = false;
    await runTransaction(db, async tx => {
      const ref = doc(db, 'products', product.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.deleted || data.status === 'sold') return;
      if (data.status === 'held'){
        const until = data.holdUntil && data.holdUntil.toMillis ? data.holdUntil.toMillis() : 0;
        if (until > Date.now() && data.holdOrderId !== orderId) return;
      }
      const payNowHoldMs = state.cartPayOption === 'paynow' || state.cartPayOption === 'manual'
        ? (Number(state.settings.payNowHoldMinutes) || 15) * 60 * 1000
        : (Number(state.settings.bookingHoldHours) || 24) * 60 * 60 * 1000;
      tx.update(ref, {
        status: 'held',
        holdUntil: Timestamp.fromMillis(Date.now() + payNowHoldMs),
        holdOrderId: orderId,
        updatedAt: serverTimestamp()
      });
      ok = true;
    });
    return ok;
  } catch(e){
    console.warn('[T&D] claim failed:', e);
    return false;
  }
}

/* ============================================================
   23. PAYMENT CLAIM WRITE
   ============================================================ */
async function recordPaymentClaim(orderId, method, ref, conflict){
  try{
    await updateDoc(doc(db, 'orders', orderId), {
      paymentStatus: 'claimed',
      paymentMethod: method,
      paymentRef: ref || '',
      paidClaimedAt: serverTimestamp(),
      conflict: !!conflict
    });
    // Extend the item hold by 48h so the owner has time to verify
    const orderSnap = await getDoc(doc(db, 'orders', orderId));
    if (orderSnap.exists()){
      const o = orderSnap.data();
      if (o.productId){
        try{
          await updateDoc(doc(db, 'products', o.productId), {
            status: 'held',
            holdUntil: Timestamp.fromMillis(Date.now() + 48 * 60 * 60 * 1000),
            holdOrderId: orderId,
            updatedAt: serverTimestamp()
          });
        } catch(e){ /* may fail if product already sold */ }
      }
    }
  } catch(e){
    console.warn('[T&D] claim write failed, queuing:', e);
    try{
      const q = JSON.parse(localStorage.getItem(PENDING_CLAIMS_KEY) || '[]');
      q.push({ orderId, method, ref, ts: Date.now() });
      localStorage.setItem(PENDING_CLAIMS_KEY, JSON.stringify(q));
    } catch(err){}
  }
}
async function flushPendingClaims(){
  try{
    const q = JSON.parse(localStorage.getItem(PENDING_CLAIMS_KEY) || '[]');
    if (!q.length) return;
    for (const item of q){
      try{
        await recordPaymentClaim(item.orderId, item.method, item.ref, false);
      } catch(e){ return; }
    }
    localStorage.removeItem(PENDING_CLAIMS_KEY);
  } catch(e){}
}

/* ============================================================
   24. INTASEND POPUP
   ============================================================ */
async function initIntaSend(){
  const s = state.settings;
  if (!s.enableOnlinePayment) return;
  if (!window.IntaSend) return;
  const key = s.intasendPublicKey || DEFAULT_INTASEND_PUBLIC_KEY;
  if (!key) return;
  try{
    const btn = $('#intasendBtn');
    if (!btn) return;
    // Instantiate once; SDK binds to element by class
    window.__tdIntaSend = new window.IntaSend({
      publicAPIKey: key,
      live: s.intasendLive === true
    })
    .on('COMPLETE', results => {
      const ref = (results && results.invoice && results.invoice.invoice_id) ||
                  (results && results.invoice_id) ||
                  (results && results.tracking_id) ||
                  (results && results.id) || '';
      onPaymentComplete(ref);
    })
    .on('FAILED', results => { onPaymentFailed(results); })
    .on('IN-PROGRESS', () => { /* ignore */ });
    state.intasendReady = true;
  } catch(e){
    console.warn('[T&D] IntaSend init failed:', e);
  }
}
async function runIntaSendPayment(order){
  if (!state.intasendReady){
    toast('Online payment unavailable. Choose manual M-Pesa.', 'error');
    return;
  }
  const due = order.amountDue;
  if (!due || due <= 0){ showSuccess(order.orderId, 'Booking confirmed', 'No deposit required. We are holding this piece for you.'); return; }
  const btn = $('#intasendBtn');
  const names = (order.customerName || '').split(' ');
  const first = names[0] || '';
  const last = names.slice(1).join(' ') || '';
  btn.setAttribute('data-amount', String(due));
  btn.setAttribute('data-currency', 'KES');
  btn.setAttribute('data-api_ref', order.orderId);
  btn.setAttribute('data-email', order.email || 'customer@tdcloset.example');
  btn.setAttribute('data-phone_number', order.phone);
  btn.setAttribute('data-first_name', first);
  btn.setAttribute('data-last_name', last);
  btn.setAttribute('data-country', 'KE');
  btn.setAttribute('data-narrative', 'T&D Closet order ' + order.orderId);
  btn.click();
}
async function onPaymentComplete(ref){
  const orderId = state.currentOrderId;
  if (!orderId) return;
  let conflict = false;
  try{
    const snap = await getDoc(doc(db, 'orders', orderId));
    if (snap.exists()){
      const o = snap.data();
      if (o.productId){
        const ps = await getDoc(doc(db, 'products', o.productId));
        if (ps.exists() && ps.data().holdOrderId && ps.data().holdOrderId !== orderId) conflict = true;
      }
    }
  } catch(e){}
  await recordPaymentClaim(orderId, 'mpesa_stk', ref, conflict);
  if (conflict){
    showSuccess(orderId, 'Payment received', 'Your payment was received, but the item may have been reserved by someone else. The owner will contact you within the hour or refund you.');
  } else {
    showSuccess(orderId, 'Payment received', 'Your order is being confirmed. You will be notified on WhatsApp.');
  }
}
function onPaymentFailed(results){
  const orderId = state.currentOrderId;
  if (!orderId) return;
  updateDoc(doc(db, 'orders', orderId), { paymentStatus: 'failed' }).catch(()=>{});
  toast('Payment failed or was cancelled.', 'error');
}

/* ============================================================
   25. SUCCESS SCREEN
   ============================================================ */
function showSuccess(orderId, title, sub){
  state.isSubmitting = false;
  $('#smTitle').textContent = title || 'Order placed';
  $('#smSub').textContent = sub || '';
  $('#smOrderId').textContent = orderId;
  const p = state.cartProduct;
  $('#smItem').textContent = p ? (p.name || '') : '';
  $('#smTotal').textContent = p ? formatKSh(computeTotal()) : '';
  $('#smStatus').textContent = title || '';
  const waMsg = buildCustomerMessage(orderId);
  const waUrl = waLink(OWNER_WHATSAPP, waMsg);
  $('#smWaBtn').href = waUrl;
  $('#successModal').hidden = false;
  document.body.style.overflow = 'hidden';
  celebrate(waUrl, 'Order placed', 'Confirming with the shop...');
}

/* ============================================================
   26. CELEBRATION
   ============================================================ */
function celebrate(waUrl, title, sub){
  const el = $('#celebration');
  if (!el) return;
  const conf = $('#confetti');
  if (title) $('#celebrationTitle').textContent = title;
  if (sub) $('#celebrationSub').textContent = sub;
  const link = $('#celebrationWa');
  if (link) link.href = waUrl;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (conf) conf.innerHTML = '';
  if (!reduce && conf){
    const colors = ['#C9962B', '#0E0E0E', '#FFFFFF', '#E6B95C', '#9E7414'];
    const shapes = ['square', 'circle', 'rect'];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 60; i++){
      const d = document.createElement('div');
      d.className = 'confetti-piece';
      const shape = shapes[i % shapes.length];
      const size = 6 + Math.random() * 8;
      d.style.left = (Math.random() * 100) + '%';
      d.style.width = size + 'px';
      d.style.height = (shape === 'rect' ? size * 1.8 : size) + 'px';
      d.style.background = colors[i % colors.length];
      if (shape === 'circle') d.style.borderRadius = '50%';
      d.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
      d.style.setProperty('--rot', (Math.random() * 720 + 360) + 'deg');
      d.style.animation = 'confettiFall ' + (1.6 + Math.random() * 1.2) + 's ' + (Math.random() * 0.4) + 's cubic-bezier(.3,.8,.4,1) forwards';
      frag.appendChild(d);
    }
    conf.appendChild(frag);
  }
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  const progressBar = el.querySelector('.progress-bar');
  if (progressBar){ progressBar.style.animation = 'none'; void progressBar.offsetWidth; progressBar.style.animation = ''; }

  setTimeout(() => { try{ window.open(waUrl, '_blank'); } catch(e){} }, 2300);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; if (conf) conf.innerHTML = ''; }, 300);
  }, 2800);
}

/* ============================================================
   27. RECEIPTS (PDF or print)
   ============================================================ */
function loadJsPDF(){
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (state.jsPdfLoading) return state.jsPdfLoading;
  state.jsPdfLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => resolve(window.jspdf && window.jspdf.jsPDF);
    s.onerror = () => reject(new Error('jsPDF failed to load'));
    document.head.appendChild(s);
  });
  return state.jsPdfLoading;
}
function receiptTitle(order){
  if (order.paymentStatus === 'verified') return 'PAYMENT RECEIPT';
  if (order.paymentStatus === 'claimed') return 'PROVISIONAL RECEIPT - PAYMENT BEING VERIFIED';
  if (order.paymentStatus === 'refunded') return 'REFUND NOTICE';
  if (order.status === 'pay_on_pickup') return 'ORDER CONFIRMATION - PAYMENT DUE ON PICKUP';
  if (order.status === 'booked') return 'BOOKING CONFIRMATION';
  return 'ORDER CONFIRMATION';
}
async function downloadReceipt(order){
  const title = receiptTitle(order);
  try{
    const JsPDF = await loadJsPDF();
    const doc = new JsPDF({ unit: 'mm', format: 'a5' });
    const s = state.settings;
    let y = 14;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text((s.businessName || 'T&D Closet').toUpperCase(), 10, y); y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(title, 10, y); y += 4;
    if (s.legalName) { doc.text('Legal name: ' + s.legalName, 10, y); y += 3.5; }
    if (s.address)   { doc.text(s.address, 10, y, { maxWidth: 130 }); y += 7; }
    if (s.phone)     { doc.text('Phone: ' + s.phone, 10, y); y += 3.5; }
    if (s.registrationNo){ doc.text('Reg No: ' + s.registrationNo, 10, y); y += 3.5; }
    if (s.kraPin)    { doc.text('KRA PIN: ' + s.kraPin, 10, y); y += 3.5; }
    y += 2;
    doc.setDrawColor(180);
    doc.line(10, y, 138, y); y += 5;

    const row = (label, value) => {
      doc.setFont('helvetica', 'bold'); doc.text(label, 10, y);
      doc.setFont('helvetica', 'normal'); doc.text(String(value || ''), 60, y);
      y += 4.5;
    };
    row('Order number', order.orderId);
    row('Date', formatDate(order.createdAt));
    row('Customer', order.customerName);
    row('Phone', order.phone);
    y += 1;
    row('Item', order.productName);
    row('Size', order.size || '-');
    row('Quantity', order.qty);
    row('Unit price', formatKSh(order.unitPrice));
    row('Delivery', formatKSh(order.deliveryFee));
    doc.setFont('helvetica', 'bold');
    doc.text('Total', 10, y);
    doc.text(formatKSh(order.total), 60, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    row('Payment method', order.paymentMethod || '-');
    row('Payment reference', order.paymentRef || '-');
    row('Fulfilment', order.fulfilment === 'delivery' ? 'Delivery - ' + (order.address || '') : 'Pickup - Horizon Plaza, 4th Floor, Shop 1011');
    if (order.holdUntil) row('Hold until', formatDate(order.holdUntil));

    doc.setFontSize(7.5);
    doc.text('Thank you for shopping at ' + (s.businessName || 'T&D Closet') + '. Returns per our Returns Policy.', 10, 195);
    doc.text('This receipt was generated electronically.', 10, 198);
    doc.save('TD-Closet-Receipt-' + order.orderId + '.pdf');
    toast('Receipt downloaded.', 'success');
  } catch(e){
    console.warn('[T&D] jsPDF failed, using print view:', e);
    openPrintReceipt(order);
  }
}
function openPrintReceipt(order){
  const s = state.settings;
  const html =
    '<div id="printReceipt">' +
      '<h1>' + escapeHTML(s.businessName || 'T&D Closet') + '</h1>' +
      '<div>' + escapeHTML(s.address || '') + '</div>' +
      '<div>' + escapeHTML(s.phone || '') + '</div>' +
      '<h2>' + escapeHTML(receiptTitle(order)) + '</h2>' +
      '<div class="print-row"><span>Order</span><strong>' + escapeHTML(order.orderId) + '</strong></div>' +
      '<div class="print-row"><span>Date</span><strong>' + escapeHTML(formatDate(order.createdAt)) + '</strong></div>' +
      '<div class="print-row"><span>Customer</span><strong>' + escapeHTML(order.customerName) + '</strong></div>' +
      '<div class="print-row"><span>Phone</span><strong>' + escapeHTML(order.phone) + '</strong></div>' +
      '<div class="print-row"><span>Item</span><strong>' + escapeHTML(order.productName) + '</strong></div>' +
      '<div class="print-row"><span>Size / Qty</span><strong>' + escapeHTML(order.size || '-') + ' / ' + escapeHTML(order.qty) + '</strong></div>' +
      '<div class="print-row"><span>Unit price</span><strong>' + escapeHTML(formatKSh(order.unitPrice)) + '</strong></div>' +
      '<div class="print-row"><span>Delivery</span><strong>' + escapeHTML(formatKSh(order.deliveryFee)) + '</strong></div>' +
      '<div class="print-total"><span>Total</span><span>' + escapeHTML(formatKSh(order.total)) + '</span></div>' +
      '<div class="print-row"><span>Payment</span><strong>' + escapeHTML(order.paymentMethod || '-') + ' ' + escapeHTML(order.paymentRef || '') + '</strong></div>' +
      '<div class="print-footer">Thank you for shopping at ' + escapeHTML(s.businessName || 'T&D Closet') + '. Returns per our Returns Policy. This receipt was generated electronically.</div>' +
    '</div>';
  const w = window.open('', '_blank');
  if (!w){ toast('Allow popups to print the receipt.', 'error'); return; }
  w.document.write('<html><head><title>Receipt ' + escapeHTML(order.orderId) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">' +
    '<link rel="stylesheet" href="style.css"></head><body>' + html + '</body></html>');
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 600);
}

/* ============================================================
   28. WHATSAPP MESSAGES
   ============================================================ */
function buildCustomerMessage(orderId){
  const p = state.cartProduct;
  if (!p) return '';
  const itemTotal = Number(p.price) * state.cartQty;
  const delivery = computeDeliveryFee();
  const total = itemTotal + delivery;
  const methodText = state.cartPayOption === 'paynow'
    ? 'Paid via M-Pesa (awaiting verification)'
    : state.cartPayOption === 'manual'
    ? 'Paid manually via M-Pesa (awaiting verification)'
    : state.cartPayOption === 'booking'
    ? 'Booking - held for ' + (state.settings.bookingHoldHours || 24) + 'h'
    : 'Pay on pickup';
  return [
    '*T&D CLOSET - ORDER ' + orderId + '*',
    kindText() + ' | ' + formatDate(new Date()),
    '--------------------------',
    'Customer: ' + ($('#omName') ? $('#omName').value.trim() : ''),
    'Phone: ' + ($('#omPhone') ? $('#omPhone').value.trim() : ''),
    '--------------------------',
    'Item: ' + p.name + ' | Size: ' + (state.cartSize || '-') + ' | Qty: ' + state.cartQty,
    'Item price: ' + formatKSh(Number(p.price)),
    (delivery > 0 ? 'Delivery: ' + formatKSh(delivery) + ' (' + state.cartZone + ')' : 'Delivery: Pickup'),
    'TOTAL: ' + formatKSh(total),
    '--------------------------',
    'Payment: ' + methodText,
    'Method: ' + (state.cartFulfilment === 'delivery' ? 'Delivery - ' + ($('#omAddress') ? $('#omAddress').value.trim() : '') : 'Pickup at Horizon Plaza'),
    'Track / receipt: ' + SITE_URL + '/?order=' + orderId
  ].join('\n');
}
function kindText(){
  if (state.cartPayOption === 'booking') return 'Booking';
  if (state.cartPayOption === 'pickup') return 'Pay on pickup';
  return 'Purchase';
}

/* ============================================================
   29. TRACK ORDER
   ============================================================ */
async function openTrackModal(orderId){
  $('#trackModal').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#trackResult').hidden = true;
  $('#trackError').hidden = true;
  if (orderId) $('#trackInput').value = orderId;
}
function closeTrackModal(){
  $('#trackModal').hidden = true;
  document.body.style.overflow = '';
  if (location.hash === '#track'){
    history.replaceState(null, '', location.pathname + location.search);
  }
}
async function doTrack(){
  const raw = $('#trackInput').value.trim().toUpperCase();
  if (!/^TD-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(raw)){
    $('#trackError').textContent = 'Order number should look like TD-XXXXX-XXXXX.';
    $('#trackError').hidden = false;
    $('#trackResult').hidden = true;
    return;
  }
  try{
    const snap = await getDoc(doc(db, 'orders', raw));
    if (!snap.exists()){
      $('#trackError').textContent = 'Order not found. Check the number and try again.';
      $('#trackError').hidden = false;
      $('#trackResult').hidden = true;
      return;
    }
    renderTrackResult(snap.data());
    $('#trackError').hidden = true;
  } catch(e){
    $('#trackError').textContent = 'Could not check the order. Try again.';
    $('#trackError').hidden = false;
  }
}
function renderTrackResult(o){
  $('#trackResult').hidden = false;
  $('#trackOrderId').textContent = o.orderId;
  const statusPill = $('#trackStatusPill');
  statusPill.textContent = (o.status || '').replace(/_/g,' ');
  statusPill.className = 'status-pill status-' + (o.status || 'Pending');

  const steps = [
    { key: 'placed', label: 'Order placed', when: o.createdAt, active: true },
    { key: 'paid', label: o.paymentStatus === 'verified' ? 'Payment verified' : (o.paymentStatus === 'claimed' ? 'Payment being verified' : 'Payment'), when: o.paidClaimedAt || null, active: ['claimed','verified'].includes(o.paymentStatus) },
    { key: 'confirmed', label: 'Confirmed by shop', when: null, active: ['confirmed','ready','completed'].includes(o.status) },
    { key: 'ready', label: o.fulfilment === 'delivery' ? 'Out for delivery' : 'Ready for pickup', when: null, active: ['ready','completed'].includes(o.status) },
    { key: 'done', label: 'Completed', when: o.completedAt || null, active: o.status === 'completed' }
  ];
  if (o.status === 'cancelled'){
    steps.push({ key: 'cancelled', label: 'Cancelled', when: null, active: true, cancelled: true });
  }
  const html = steps.map((s, i) => {
    const cls = s.cancelled ? 'cancelled' : (s.active ? (isLastActive(steps, i) ? 'current' : 'done') : '');
    return '<div class="track-step ' + cls + '"><strong>' + escapeHTML(s.label) + '</strong>' +
      (s.when ? '<span>' + escapeHTML(formatDate(s.when)) + '</span>' : '') +
    '</div>';
  }).join('');
  $('#trackTimeline').innerHTML = html;

  $('#trackItem').textContent = o.productName + (o.size ? ' / ' + o.size : '');
  $('#trackTotal').textContent = formatKSh(o.total);
  $('#trackPayment').textContent = (o.paymentMethod || '-') + ' / ' + (o.paymentStatus || '-');
  $('#trackFulfilment').textContent = o.fulfilment === 'delivery' ? 'Delivery - ' + (o.deliveryZone || '') : 'Pickup';
  const holdRow = $('#trackHoldRow');
  if (o.holdUntil && (o.status === 'booked' || o.status === 'pay_on_pickup')){
    holdRow.hidden = false;
    $('#trackHold').textContent = formatDate(o.holdUntil);
  } else {
    holdRow.hidden = true;
  }
  $('#trackReceiptBtn').onclick = () => downloadReceipt(o);
  $('#trackWaBtn').href = waLink(OWNER_WHATSAPP, 'Hi, I want to ask about my order ' + o.orderId);
}
function isLastActive(steps, i){
  for (let j = i + 1; j < steps.length; j++) if (steps[j].active) return false;
  return true;
}
function bindTrack(){
  const navLinks = [ $('#navTrackLink'), $('#mobileTrackLink'), $('#footerTrackLink'), $('#paymentTrackLink') ];
  navLinks.forEach(l => {
    if (!l) return;
    l.addEventListener('click', e => {
      e.preventDefault();
      openTrackModal('');
    });
  });
  $('#trackSearchBtn').addEventListener('click', doTrack);
  $('#trackInput').addEventListener('keydown', e => { if (e.key === 'Enter') doTrack(); });
  $('#trackModal').addEventListener('click', e => {
    if (e.target.closest('[data-track-close]')) closeTrackModal();
  });
}

/* ============================================================
   30. MY ORDERS DRAWER (this device)
   ============================================================ */
function loadMyOrdersList(){
  try{ return JSON.parse(localStorage.getItem(MY_ORDERS_KEY) || '[]'); }
  catch(e){ return []; }
}
function openMyOrdersDrawer(){
  const drawer = $('#myOrdersDrawer');
  const overlay = $('#myOrdersOverlay');
  const list = $('#myOrdersList');
  if (!drawer || !list) return;
  const orders = loadMyOrdersList();
  if (!orders.length){
    list.innerHTML = '<p class="muted" style="padding:20px;text-align:center">No orders yet on this device.</p>';
  } else {
    list.innerHTML = orders.map(o =>
      '<div class="my-order">' +
        '<span class="mo-id">' + escapeHTML(o.orderId) + '</span>' +
        '<span class="mo-line">' + escapeHTML(o.item || '') + '</span>' +
        '<span class="mo-line">' + formatKSh(o.total) + '</span>' +
        '<span class="mo-line">' + escapeHTML(formatDate(o.createdAt)) + '</span>' +
        '<button class="btn btn-outline btn-sm" data-track-order="' + escapeHTML(o.orderId) + '">Track</button>' +
      '</div>'
    ).join('');
  }
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden','false');
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('show'));
  document.body.style.overflow = 'hidden';
}
function closeMyOrdersDrawer(){
  const drawer = $('#myOrdersDrawer');
  const overlay = $('#myOrdersOverlay');
  if (!drawer) return;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden','true');
  if (overlay){ overlay.classList.remove('show'); setTimeout(() => overlay.hidden = true, 250); }
  document.body.style.overflow = '';
}

/* ============================================================
   31. SUCCESS + RECEIPT + COPY + CELEBRATION BINDINGS
   ============================================================ */
function bindSuccess(){
  $('#smContinueBtn').addEventListener('click', () => {
    $('#successModal').hidden = true;
    document.body.style.overflow = '';
  });
  $('#smCopyBtn').addEventListener('click', async () => {
    const txt = $('#smOrderId').textContent;
    try{
      if (navigator.clipboard) await navigator.clipboard.writeText(txt);
      toast('Order number copied.', 'success');
    } catch(e){ toast('Copy failed.', 'error'); }
  });
  $('#smTrackBtn').addEventListener('click', () => {
    const id = $('#smOrderId').textContent;
    $('#successModal').hidden = true;
    document.body.style.overflow = '';
    openTrackModal(id);
  });
  $('#smReceiptBtn').addEventListener('click', async () => {
    const id = $('#smOrderId').textContent;
    try{
      const snap = await getDoc(doc(db, 'orders', id));
      if (snap.exists()) downloadReceipt(snap.data());
    } catch(e){ toast('Could not load receipt.', 'error'); }
  });
}
function bindMyOrdersDrawer(){
  $('#navBagBtn').addEventListener('click', openMyOrdersDrawer);
  $('#myOrdersClose').addEventListener('click', closeMyOrdersDrawer);
  $('#myOrdersOverlay').addEventListener('click', closeMyOrdersDrawer);
  $('#myOrdersList').addEventListener('click', e => {
    const btn = e.target.closest('[data-track-order]');
    if (!btn) return;
    const id = btn.getAttribute('data-track-order');
    closeMyOrdersDrawer();
    openTrackModal(id);
  });
}
function bindKeyboard(){
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#orderModal').hidden) closeCheckout();
    if (!$('#successModal').hidden){ $('#successModal').hidden = true; document.body.style.overflow = ''; }
    if (!$('#trackModal').hidden) closeTrackModal();
    if (!$('#policyModal').hidden) closePolicy();
    if ($('#myOrdersDrawer').classList.contains('open')) closeMyOrdersDrawer();
    if ($('#mobileMenu').classList.contains('open')) $('#mobileMenuClose').click();
  });
}

/* ============================================================
   32. OWNER LOGIN TRIGGER
   ============================================================ */
async function openOwner(){
  const view = $('#ownerView');
  if (!view) return;
  view.hidden = false;
  document.body.style.overflow = 'hidden';
  try{
    const mod = await import('./owner.js');
    await mod.initOwner({
      state,
      db,
      fs,
      authFns: (await import('./firebase.js')).authFns,
      auth: (await import('./firebase.js')).auth,
      SITE_URL, OWNER_WHATSAPP, DEFAULT_SETTINGS,
      onClose: () => {
        view.hidden = true;
        view.innerHTML = '';
        document.body.style.overflow = '';
      },
      toast, formatKSh, formatDate, escapeHTML, waLink, normalizePhone
    });
  } catch(e){
    console.error('[T&D] owner module failed:', e);
    toast('Could not load the owner dashboard.', 'error');
    view.hidden = true;
    document.body.style.overflow = '';
  }
}

/* ============================================================
   33. HOLD TICK (re-render cards when holds expire)
   ============================================================ */
function startHoldTick(){
  setInterval(() => {
    let changed = false;
    state.products.forEach(p => {
      if (p.status === 'held'){
        const until = p.holdUntil && p.holdUntil.toMillis ? p.holdUntil.toMillis() : 0;
        if (until > 0 && until <= Date.now()) changed = true;
      }
    });
    if (changed) renderShop();
  }, HOLD_TICK_MS);
}

/* ============================================================
   34. VISIBILITY RESYNC
   ============================================================ */
function startVisibilityResync(){
  let lastHiddenAt = Date.now();
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden){ lastHiddenAt = Date.now(); return; }
    if (Date.now() - lastHiddenAt > RESYNC_AFTER_MS){
      const ok = await syncProducts();
      if (ok) renderShop();
      await flushPendingClaims();
    }
  });
}

/* ============================================================
   35. INIT
   ============================================================ */
async function init(){
  if (!isConfigReady()){ showSetupNotice(); return; }
  $('#year').textContent = new Date().getFullYear();

  // Load cache instantly
  loadWishlist();
  updateWishlistBadge();
  loadProductsFromCache();
  renderSkeletons();
  renderShop();
  renderHeroCollage();

  // Bindings
  bindNav();
  bindProductGrid();
  bindCheckout();
  bindSuccess();
  bindMyOrdersDrawer();
  bindTrack();
  bindPolicy();
  bindCookieNotice();
  bindOfflineBanner();
  bindCopyButtons();
  bindKeyboard();
  updateOpenStatus();
  setInterval(updateOpenStatus, 60000);

  // Owner link
  const ownerLink = $('#ownerLoginLink');
  if (ownerLink) ownerLink.addEventListener('click', openOwner);

  // Load settings + first sync
  await loadSettings();
  const ok = await syncProducts();
  if (!ok) $('#shopError').hidden = false;
  clearSkeletons();
  renderShop();
  renderHeroCollage();

  // Init IntaSend once settings loaded
  await initIntaSend();

  // Pending claims retry
  await flushPendingClaims();

  // Background loops
  startHoldTick();
  startVisibilityResync();

  // Deep link: ?order=TD-... opens tracking
  try{
    const params = new URLSearchParams(location.search);
    const q = params.get('order');
    if (q && /^TD-/.test(q)) openTrackModal(q);
  } catch(e){}

  // Hash routes
  handleHash();
  window.addEventListener('hashchange', handleHash);

  // Fade splash away after first paint of the real content
  try {
    var sp = document.getElementById('splash');
    if (sp) { sp.classList.add('hide'); setTimeout(function(){ if (sp.parentNode) sp.parentNode.removeChild(sp); }, 400); }
  } catch(e){}
}

document.addEventListener('DOMContentLoaded', init);
window.addEventListener('error', e => { console.error('[T&D] runtime error:', e.message); });
window.addEventListener('unhandledrejection', e => {
  console.error('[T&D] unhandled promise:', e.reason);
  try { toast('Something went wrong. Please try again.', 'error'); } catch(_){}
});

/* ============================================================
   GALLERY SWIPE — swipe left/right inside the product modal
   to browse photos. Also shows dot indicators on mobile.
   ============================================================ */
(function(){
  var startX = 0, startY = 0, movedX = 0, movedY = 0, tracking = false;
  var mDown = false, mStartX = 0;

  function getImages(){
    var thumbs = document.querySelectorAll('#omThumbs .om-thumb img');
    if (thumbs.length) return Array.prototype.map.call(thumbs, function(t){ return t.getAttribute('src'); });
    var main = document.querySelector('#omMainImg img');
    return main ? [main.getAttribute('src')] : [];
  }
  function currentIndex(){
    var active = document.querySelector('#omThumbs .om-thumb.active');
    if (!active) return 0;
    return Number(active.getAttribute('data-thumb')) || 0;
  }
  function updateDots(i, total){
    var dots = document.getElementById('omDots');
    if (!dots) return;
    Array.prototype.forEach.call(dots.children, function(d, idx){
      d.classList.toggle('active', idx === i);
    });
  }
  function showIndex(i){
    var imgs = getImages();
    if (!imgs.length) return;
    if (i < 0) i = imgs.length - 1;
    if (i >= imgs.length) i = 0;
    var main = document.getElementById('omMainImg');
    if (!main) return;
    var nameEl = document.getElementById('omTitle');
    var alt = nameEl ? nameEl.textContent : '';
    main.innerHTML = '<img src="' + imgs[i].replace(/"/g, '&quot;') + '" alt="' + alt.replace(/"/g, '&quot;') + '">';
    var thumbs = document.querySelectorAll('#omThumbs .om-thumb');
    Array.prototype.forEach.call(thumbs, function(t, idx){
      t.classList.toggle('active', idx === i);
    });
    updateDots(i, imgs.length);
  }
  function ensureDots(){
    var main = document.getElementById('omMainImg');
    if (!main) return;
    var imgs = getImages();
    var dots = document.getElementById('omDots');
    if (imgs.length < 2){
      if (dots) dots.parentNode.removeChild(dots);
      return;
    }
    if (!dots){
      dots = document.createElement('div');
      dots.id = 'omDots';
      dots.className = 'om-dots';
      if (main.nextSibling) main.parentNode.insertBefore(dots, main.nextSibling);
      else main.parentNode.appendChild(dots);
    }
    var idx = currentIndex();
    var html = '';
    for (var j = 0; j < imgs.length; j++){
      html += '<span class="om-dot' + (j === idx ? ' active' : '') + '"></span>';
    }
    dots.innerHTML = html;
  }

  // Touch swipe
  document.addEventListener('touchstart', function(e){
    var main = e.target.closest && e.target.closest('#omMainImg');
    if (!main) return;
    var t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
    movedX = 0; movedY = 0; tracking = true;
    ensureDots();
  }, { passive: true });

  document.addEventListener('touchmove', function(e){
    if (!tracking) return;
    var t = e.touches[0];
    movedX = t.clientX - startX;
    movedY = t.clientY - startY;
    var main = document.getElementById('omMainImg');
    if (main && Math.abs(movedX) > Math.abs(movedY)){
      main.style.transform = 'translateX(' + (movedX * 0.25) + 'px)';
    }
  }, { passive: true });

  document.addEventListener('touchend', function(){
    if (!tracking) return;
    tracking = false;
    var main = document.getElementById('omMainImg');
    if (main){
      main.style.transition = 'transform .18s ease';
      main.style.transform = '';
      setTimeout(function(){ if (main) main.style.transition = ''; }, 200);
    }
    if (Math.abs(movedX) < 40 || Math.abs(movedY) > Math.abs(movedX)) return;
    var idx = currentIndex();
    if (movedX < 0) showIndex(idx + 1);
    else showIndex(idx - 1);
  }, { passive: true });

  // Mouse drag for desktop
  document.addEventListener('mousedown', function(e){
    var main = e.target.closest && e.target.closest('#omMainImg');
    if (!main) return;
    mDown = true; mStartX = e.clientX;
  });
  document.addEventListener('mouseup', function(e){
    if (!mDown) return;
    mDown = false;
    var diff = e.clientX - mStartX;
    if (Math.abs(diff) < 60) return;
    var idx = currentIndex();
    if (diff < 0) showIndex(idx + 1);
    else showIndex(idx - 1);
  });

  // When a thumbnail is clicked, update the dots
  document.addEventListener('click', function(e){
    var t = e.target.closest && e.target.closest('#omThumbs .om-thumb');
    if (t) setTimeout(function(){ updateDots(currentIndex(), getImages().length); }, 10);
  });

  // Whenever the modal opens, make sure dots are in sync
  var modal = document.getElementById('orderModal');
  if (modal && window.MutationObserver){
    var obs = new MutationObserver(function(){
      if (!modal.hidden) setTimeout(ensureDots, 60);
    });
    obs.observe(modal, { attributes: true, attributeFilter: ['hidden'] });
  }
})();
