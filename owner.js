'use strict';

/* ============================================================
   owner.js — T&D Closet Owner Dashboard (lazy-loaded)
   Exports initOwner(context). The context provides:
   state, db, fs, auth, authFns, SITE_URL, OWNER_WHATSAPP,
   DEFAULT_SETTINGS, onClose, and helper formatters.
   ============================================================ */

let ctx = null;
let unsubOrders = null;
let orderList = [];
let orderFilters = { search: '', status: 'all', payment: 'all', date: 'all', kind: 'all' };
let currentTab = 'overview';
let settingsPublic = {};
let settingsPrivate = {};
let productsCache = [];
let customersCache = [];
let bulkQueue = [];
let bulkIndex = 0;
let bulkProcessing = false;
let editingImages = [];
let editingSizes = [];
let signOutOnce = false;

export async function initOwner(context){
  ctx = context;
  const { auth, authFns } = ctx;
  renderLoginShell();
  authFns.onAuthStateChanged(auth, user => {
    if (user){ onSignedIn(user); }
    else { showLogin(); }
  });
}

/* ============================================================
   LOGIN SHELL
   ============================================================ */
function renderLoginShell(){
  const view = document.getElementById('ownerView');
  view.innerHTML =
    '<div id="ownerLogin" class="owner-login">' +
      '<div class="login-card">' +
        '<span class="brand-text">T<span class="amp">&amp;</span>D Closet</span>' +
        '<h2>Owner Dashboard</h2>' +
        '<p>Sign in with your owner email and password.</p>' +
        '<form id="ownerLoginForm" autocomplete="off">' +
          '<div class="input-wrap">' +
            '<input type="email" id="ownerEmail" placeholder="you@example.com" autocomplete="email" required>' +
          '</div>' +
          '<div class="input-wrap" style="margin-top:8px">' +
            '<input type="password" id="ownerPassword" placeholder="Password" autocomplete="current-password" required>' +
            '<button type="button" id="ownerPasswordToggle" class="icon-btn" aria-label="Show password"><svg width="20" height="20"><use href="#i-eye"/></svg></button>' +
          '</div>' +
          '<p class="field-error" id="ownerLoginError" hidden></p>' +
          '<button type="submit" class="btn btn-dark btn-block" id="ownerLoginBtn">Login</button>' +
        '</form>' +
        '<button id="ownerForgotBtn" class="link-btn" style="margin-top:10px">Forgot password</button>' +
        '<button id="ownerBackToShop" class="link-btn">Back to shop</button>' +
      '</div>' +
    '</div>' +
    '<div id="ownerDashboard" class="owner-dashboard" hidden></div>';

  document.getElementById('ownerBackToShop').addEventListener('click', ctx.onClose);
  document.getElementById('ownerLoginForm').addEventListener('submit', handleLoginSubmit);
  document.getElementById('ownerPasswordToggle').addEventListener('click', () => {
    const inp = document.getElementById('ownerPassword');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('ownerForgotBtn').addEventListener('click', handleForgot);
}

function showLogin(){
  const login = document.getElementById('ownerLogin');
  const dash = document.getElementById('ownerDashboard');
  if (login) login.hidden = false;
  if (dash) dash.hidden = true;
  if (unsubOrders){ unsubOrders(); unsubOrders = null; }
}
function showDashboard(){
  const login = document.getElementById('ownerLogin');
  const dash = document.getElementById('ownerDashboard');
  if (login) login.hidden = true;
  if (dash) dash.hidden = false;
}

async function handleLoginSubmit(e){
  e.preventDefault();
  const email = document.getElementById('ownerEmail').value.trim();
  const pw = document.getElementById('ownerPassword').value;
  const err = document.getElementById('ownerLoginError');
  const btn = document.getElementById('ownerLoginBtn');
  btn.disabled = true; btn.textContent = 'Signing in...';
  err.hidden = true;
  try{
    await ctx.authFns.signInWithEmailAndPassword(ctx.auth, email, pw);
  } catch(ex){
    console.warn('[T&D] login error:', ex);
    let msg = 'Could not sign in. Check your details and try again.';
    if (ex && ex.code){
      if (ex.code === 'auth/wrong-password' || ex.code === 'auth/invalid-credential') msg = 'Wrong email or password.';
      else if (ex.code === 'auth/user-not-found') msg = 'No owner account with that email.';
      else if (ex.code === 'auth/too-many-requests') msg = 'Too many attempts. Try again in a few minutes.';
      else if (ex.code === 'auth/network-request-failed') msg = 'Network error. Check your connection.';
      else if (ex.code === 'auth/invalid-email') msg = 'That email does not look right.';
    }
    err.textContent = msg;
    err.hidden = false;
    const card = document.querySelector('.login-card');
    if (card){ card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); }
  } finally {
    btn.disabled = false; btn.textContent = 'Login';
  }
}
async function handleForgot(){
  const email = document.getElementById('ownerEmail').value.trim();
  if (!email){ ctx.toast('Enter your email above first.', 'error'); return; }
  try{
    await ctx.authFns.sendPasswordResetEmail(ctx.auth, email);
    ctx.toast('Reset email sent.', 'success');
  } catch(e){ ctx.toast('Could not send reset email.', 'error'); }
}

async function onSignedIn(user){
  showDashboard();
  renderDashboardShell();
  await loadSettings();
  await loadProducts();
  await loadCustomers();
  subscribeOrders();
}

/* ============================================================
   DASHBOARD SHELL
   ============================================================ */
function renderDashboardShell(){
  const dash = document.getElementById('ownerDashboard');
  dash.innerHTML =
    '<header class="owner-bar">' +
      '<span class="brand-text">T<span class="amp">&amp;</span>D Closet</span>' +
      '<span class="owner-tag">Owner Dashboard</span>' +
      '<div class="owner-bar-actions">' +
        '<button id="ownerRefreshBtn" class="icon-btn" aria-label="Refresh"><svg width="20" height="20"><use href="#i-refresh"/></svg></button>' +
        '<button id="ownerViewShopBtn" class="btn btn-outline btn-sm">View shop</button>' +
        '<button id="ownerLogoutBtn" class="icon-btn" aria-label="Logout"><svg width="20" height="20"><use href="#i-logout"/></svg></button>' +
      '</div>' +
    '</header>' +
    '<nav class="owner-tabs" id="ownerTabs">' +
      '<button class="tab active" data-tab="overview"><svg width="16" height="16"><use href="#i-grid"/></svg> Overview</button>' +
      '<button class="tab" data-tab="orders"><svg width="16" height="16"><use href="#i-list"/></svg> Orders <span id="tabBadgeNew" class="tab-badge" hidden></span></button>' +
      '<button class="tab" data-tab="bookings"><svg width="16" height="16"><use href="#i-clock"/></svg> Bookings</button>' +
      '<button class="tab" data-tab="products"><svg width="16" height="16"><use href="#i-package"/></svg> Products</button>' +
      '<button class="tab" data-tab="customers"><svg width="16" height="16"><use href="#i-heart"/></svg> Customers</button>' +
      '<button class="tab" data-tab="reports"><svg width="16" height="16"><use href="#i-doc"/></svg> Reports</button>' +
      '<button class="tab" data-tab="settings"><svg width="16" height="16"><use href="#i-tag"/></svg> Settings</button>' +
      '<button class="tab" data-tab="tools"><svg width="16" height="16"><use href="#i-refresh"/></svg> Tools</button>' +
    '</nav>' +
    '<div class="owner-content" id="ownerContent"></div>' +
    '<div id="bulkPanel" class="bulk-panel" hidden>' +
      '<div class="bulk-panel-inner">' +
        '<div><strong id="bulkPanelText">Sending...</strong><p id="bulkPanelSub" class="muted"></p></div>' +
        '<div class="bulk-panel-actions">' +
          '<button id="bulkNextBtn" class="btn btn-dark btn-sm">Open WhatsApp for next</button>' +
          '<button id="bulkSkipBtn" class="btn btn-outline btn-sm">Skip</button>' +
          '<button id="bulkCancelBtn" class="icon-btn" aria-label="Cancel"><svg width="18" height="18"><use href="#i-x"/></svg></button>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.getElementById('ownerViewShopBtn').addEventListener('click', ctx.onClose);
  document.getElementById('ownerLogoutBtn').addEventListener('click', handleLogout);
  document.getElementById('ownerRefreshBtn').addEventListener('click', refreshAll);
  document.querySelectorAll('#ownerTabs .tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.getAttribute('data-tab')));
  });
  document.getElementById('bulkNextBtn').addEventListener('click', bulkNext);
  document.getElementById('bulkSkipBtn').addEventListener('click', bulkSkip);
  document.getElementById('bulkCancelBtn').addEventListener('click', endBulk);
}
function switchTab(name){
  currentTab = name;
  document.querySelectorAll('#ownerTabs .tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-tab') === name);
  });
  renderCurrentTab();
}
function renderCurrentTab(){
  const c = document.getElementById('ownerContent');
  if (!c) return;
  if (currentTab === 'overview') c.innerHTML = renderOverviewHTML();
  else if (currentTab === 'orders') { c.innerHTML = renderOrdersHTML(); bindOrdersTab(); }
  else if (currentTab === 'bookings') { c.innerHTML = renderBookingsHTML(); bindBookingsTab(); }
  else if (currentTab === 'products') { c.innerHTML = renderProductsHTML(); bindProductsTab(); }
  else if (currentTab === 'customers') { c.innerHTML = renderCustomersHTML(); bindCustomersTab(); }
  else if (currentTab === 'reports') { c.innerHTML = renderReportsHTML(); bindReportsTab(); }
  else if (currentTab === 'settings') { c.innerHTML = renderSettingsHTML(); bindSettingsTab(); }
  else if (currentTab === 'tools') { c.innerHTML = renderToolsHTML(); bindToolsTab(); }
}

async function refreshAll(){
  ctx.toast('Refreshing...');
  await loadSettings();
  await loadProducts();
  await loadCustomers();
  renderCurrentTab();
  ctx.toast('Refreshed.', 'success');
}
async function handleLogout(){
  if (signOutOnce) return;
  signOutOnce = true;
  try{ await ctx.authFns.signOut(ctx.auth); } catch(e){}
  signOutOnce = false;
  ctx.onClose();
}

/* ============================================================
   ORDERS LISTENER
   ============================================================ */
function subscribeOrders(){
  if (unsubOrders) unsubOrders();
  const { collection, query, orderBy, limit, onSnapshot } = ctx.fs;
  const q = query(collection(ctx.db, 'orders'), orderBy('createdAt', 'desc'), limit(100));
  unsubOrders = onSnapshot(q, snap => {
    orderList = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    renderCurrentTab();
  }, err => {
    console.warn('[T&D] orders listener failed:', err);
    ctx.toast('Could not read orders. Check your permissions.', 'error');
  });
}

/* ============================================================
   LOAD SETTINGS + PRODUCTS + CUSTOMERS
   ============================================================ */
async function loadSettings(){
  try{
    const pub = await ctx.fs.getDoc(ctx.fs.doc(ctx.db, 'settings', 'public'));
    settingsPublic = pub.exists() ? Object.assign({}, ctx.DEFAULT_SETTINGS, pub.data()) : Object.assign({}, ctx.DEFAULT_SETTINGS);
  } catch(e){ settingsPublic = Object.assign({}, ctx.DEFAULT_SETTINGS); }
  try{
    const priv = await ctx.fs.getDoc(ctx.fs.doc(ctx.db, 'settings', 'private'));
    settingsPrivate = priv.exists() ? priv.data() : {};
  } catch(e){ settingsPrivate = {}; }
}
async function loadProducts(){
  try{
    const snap = await ctx.fs.getDocs(ctx.fs.collection(ctx.db, 'products'));
    productsCache = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  } catch(e){ productsCache = []; }
}
async function loadCustomers(){
  const map = new Map();
  orderList.forEach(o => {
    if (!o.phone) return;
    if (!map.has(o.phone)) map.set(o.phone, { name: o.customerName, phone: o.phone, orders: 0, total: 0, last: 0 });
    const c = map.get(o.phone);
    c.name = o.customerName || c.name;
    c.orders += 1;
    if (o.paymentStatus === 'verified') c.total += Number(o.total || 0);
    const t = o.createdAt && o.createdAt.toMillis ? o.createdAt.toMillis() : 0;
    if (t > c.last) c.last = t;
  });
  customersCache = Array.from(map.values()).sort((a,b) => b.last - a.last);
}

/* ============================================================
   OVERVIEW
   ============================================================ */
function renderOverviewHTML(){
  const now = Date.now();
  const dayMs = 86400000;
  const verified = orderList.filter(o => o.paymentStatus === 'verified');
  const claimed = orderList.filter(o => o.paymentStatus === 'claimed');
  const open = orderList.filter(o => ['awaiting_payment','booked','pay_on_pickup','confirmed','ready'].includes(o.status));

  const sum = (arr, from) => arr.filter(o => {
    const t = o.createdAt && o.createdAt.toMillis ? o.createdAt.toMillis() : 0;
    return t >= from;
  }).reduce((s,o) => s + Number(o.total || 0), 0);

  const revenueToday = sum(verified, new Date().setHours(0,0,0,0));
  const revenueWeek  = sum(verified, now - 7*dayMs);
  const revenueMonth = sum(verified, now - 30*dayMs);
  const revenueAll   = verified.reduce((s,o) => s + Number(o.total || 0), 0);
  const claimedTotal = claimed.reduce((s,o) => s + Number(o.total || 0), 0);

  const activeHolds = productsCache.filter(p => {
    if (p.status !== 'held') return false;
    const until = p.holdUntil && p.holdUntil.toMillis ? p.holdUntil.toMillis() : 0;
    return until > now;
  }).length;

  const stats = [
    { label: 'Verified today', value: ctx.formatKSh(revenueToday) },
    { label: 'Verified this week', value: ctx.formatKSh(revenueWeek) },
    { label: 'Verified this month', value: ctx.formatKSh(revenueMonth) },
    { label: 'Verified all time', value: ctx.formatKSh(revenueAll) },
    { label: 'Awaiting verification', value: ctx.formatKSh(claimedTotal), sub: claimed.length + ' order' + (claimed.length === 1 ? '' : 's') },
    { label: 'Open orders', value: String(open.length) },
    { label: 'Active holds', value: String(activeHolds) },
    { label: 'Items listed', value: String(productsCache.filter(p => !p.deleted).length) }
  ];

  const last14 = [];
  for (let i = 13; i >= 0; i--){
    const from = new Date(now - i*dayMs); from.setHours(0,0,0,0);
    const to = from.getTime() + dayMs;
    const total = verified.reduce((s,o) => {
      const t = o.createdAt && o.createdAt.toMillis ? o.createdAt.toMillis() : 0;
      return (t >= from.getTime() && t < to) ? s + Number(o.total || 0) : s;
    }, 0);
    last14.push({ label: from.getDate(), value: total });
  }
  const maxDaily = Math.max.apply(null, last14.map(d => d.value)) || 1;

  const topSellers = {};
  orderList.forEach(o => {
    const k = o.productName || 'Unknown';
    topSellers[k] = topSellers[k] || { units: 0, revenue: 0 };
    topSellers[k].units += Number(o.qty || 1);
    topSellers[k].revenue += Number(o.total || 0);
  });
  const top = Object.entries(topSellers).sort((a,b) => b[1].revenue - a[1].revenue).slice(0,5);

  return '' +
    '<div class="stat-grid">' +
      stats.map(s => '<div class="stat-card"><span>' + ctx.escapeHTML(s.label) + '</span><strong>' + ctx.escapeHTML(s.value) + '</strong>' + (s.sub ? '<small>' + ctx.escapeHTML(s.sub) + '</small>' : '') + '</div>').join('') +
    '</div>' +
    '<div class="panel"><h3>Verified revenue, last 14 days</h3>' +
      '<div class="bar-list" style="grid-template-columns:repeat(14,1fr);display:grid;gap:6px">' +
        last14.map(d => '<div class="bar-row"><div class="bar-track" style="height:80px;position:relative;display:flex;align-items:flex-end"><div class="bar-fill" style="width:100%;height:' + Math.max(2, (d.value/maxDaily)*100) + '%"></div></div><div style="text-align:center;font-size:10px;color:var(--muted);margin-top:4px">' + d.label + '</div></div>').join('') +
      '</div>' +
    '</div>' +
    '<div class="panel"><h3>Top sellers</h3>' +
      (top.length ? '<div class="bar-list">' + top.map(t => '<div class="bar-row"><div class="bar-top"><span>' + ctx.escapeHTML(t[0]) + '</span><span>' + ctx.formatKSh(t[1].revenue) + ' / ' + t[1].units + ' units</span></div></div>').join('') + '</div>' : '<p class="muted">No sales yet.</p>') +
    '</div>' +
    '<div class="panel"><h3>Quick actions</h3>' +
      '<div class="form-actions">' +
        '<button class="btn btn-dark" data-quick="addprod">Add product</button>' +
        '<button class="btn btn-outline" data-quick="walkin">Record walk-in sale</button>' +
        '<button class="btn btn-outline" data-quick="release">Release expired holds</button>' +
      '</div>' +
    '</div>';
}

/* CONTINUE WITH: owner.js (part 2) */

/* ============================================================
   ORDERS TAB
   ============================================================ */
function filterOrders(){
  let list = orderList.slice();
  const f = orderFilters;
  if (f.search){
    const q = f.search.toLowerCase();
    list = list.filter(o =>
      (o.customerName || '').toLowerCase().includes(q) ||
      (o.phone || '').toLowerCase().includes(q) ||
      (o.orderId || '').toLowerCase().includes(q)
    );
  }
  if (f.status !== 'all') list = list.filter(o => o.status === f.status);
  if (f.payment !== 'all') list = list.filter(o => o.paymentStatus === f.payment);
  if (f.kind !== 'all') list = list.filter(o => o.kind === f.kind);
  if (f.date !== 'all'){
    const now = Date.now();
    const cutoff = f.date === 'today' ? new Date().setHours(0,0,0,0) : now - (Number(f.date) * 86400000);
    list = list.filter(o => {
      const t = o.createdAt && o.createdAt.toMillis ? o.createdAt.toMillis() : 0;
      return t >= cutoff;
    });
  }
  return list;
}
function renderOrdersHTML(){
  const list = filterOrders();
  return '' +
    '<div class="orders-toolbar">' +
      '<input id="ownerSearch" class="input" type="search" placeholder="Search name, phone or order ID" value="' + ctx.escapeHTML(orderFilters.search) + '">' +
      '<select id="ownerStatus" class="select">' +
        ['all','awaiting_payment','booked','pay_on_pickup','confirmed','ready','completed','cancelled'].map(s => '<option value="' + s + '"' + (orderFilters.status===s?' selected':'') + '>' + (s==='all'?'All statuses':s.replace(/_/g,' ')) + '</option>').join('') +
      '</select>' +
      '<select id="ownerPayment" class="select">' +
        ['all','unpaid','claimed','verified','failed','refunded'].map(s => '<option value="' + s + '"' + (orderFilters.payment===s?' selected':'') + '>' + (s==='all'?'All payments':s) + '</option>').join('') +
      '</select>' +
      '<select id="ownerDate" class="select">' +
        [['all','All time'],['today','Today'],['7','Last 7 days'],['30','Last 30 days']].map(p => '<option value="' + p[0] + '"' + (orderFilters.date===p[0]?' selected':'') + '>' + p[1] + '</option>').join('') +
      '</select>' +
      '<button id="ownerExportBtn" class="btn btn-dark btn-sm"><svg width="16" height="16"><use href="#i-download"/></svg> Export CSV</button>' +
    '</div>' +
    '<div class="bulk-bar">' +
      '<label class="checkbox"><input type="checkbox" id="ownerSelectAll"> Select all filtered</label>' +
      '<button id="ownerBulkSendBtn" class="btn btn-outline btn-sm">Send reminder to selected</button>' +
      '<button id="ownerBulkReadyBtn" class="btn btn-outline btn-sm">Mark ready</button>' +
    '</div>' +
    (list.length ? renderOrdersTableHTML(list) : '<div class="empty-state"><svg width="42" height="42"><use href="#i-package"/></svg><h3>No orders found</h3><p>Adjust filters or check back later.</p></div>');
}
function renderOrdersTableHTML(list){
  return '<div class="panel table-wrap"><table class="orders-table"><thead><tr>' +
    '<th></th><th>Date</th><th>Order</th><th>Customer</th><th>Item</th><th>Total</th><th>Due</th><th>Payment</th><th>Status</th><th>Actions</th>' +
    '</tr></thead><tbody>' +
    list.map(o => renderOrderRowHTML(o)).join('') +
    '</tbody></table></div>';
}
function renderOrderRowHTML(o){
  const conflict = o.conflict ? '<span class="status-pill status-cancelled" style="margin-left:6px">Conflict</span>' : '';
  const hold = (o.status === 'booked' || o.status === 'pay_on_pickup') && o.holdUntil
    ? '<div style="font-size:11px;color:var(--muted)">Hold ends ' + ctx.escapeHTML(ctx.formatDate(o.holdUntil)) + '</div>'
    : '';
  return '<tr data-id="' + ctx.escapeHTML(o.orderId) + '">' +
    '<td><input type="checkbox" class="order-check" data-id="' + ctx.escapeHTML(o.orderId) + '"></td>' +
    '<td>' + ctx.escapeHTML(ctx.formatDate(o.createdAt)) + '</td>' +
    '<td><strong>' + ctx.escapeHTML(o.orderId) + '</strong>' + conflict + '</td>' +
    '<td>' + ctx.escapeHTML(o.customerName || '') + '<div style="font-size:11px;color:var(--muted)">' + ctx.escapeHTML(o.phone || '') + '</div></td>' +
    '<td>' + ctx.escapeHTML(o.productName || '') + (o.size ? ' / ' + ctx.escapeHTML(o.size) : '') + '<div style="font-size:11px;color:var(--muted)">' + (o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup') + '</div>' + hold + '</td>' +
    '<td>' + ctx.formatKSh(o.total) + '</td>' +
    '<td>' + ctx.formatKSh(o.amountDue || 0) + '</td>' +
    '<td><span class="payment-pill payment-' + ctx.escapeHTML(o.paymentStatus || 'unpaid') + '">' + ctx.escapeHTML(o.paymentStatus || 'unpaid') + '</span>' + (o.paymentRef ? '<div style="font-size:11px;color:var(--muted)">' + ctx.escapeHTML(o.paymentRef) + '</div>' : '') + '</td>' +
    '<td><span class="status-pill status-' + ctx.escapeHTML(o.status || 'pending') + '">' + ctx.escapeHTML((o.status || '').replace(/_/g,' ')) + '</span></td>' +
    '<td><div class="row-actions">' +
      (o.paymentStatus === 'claimed' ? '<button class="btn btn-dark btn-sm" data-action="verify" data-id="' + ctx.escapeHTML(o.orderId) + '">Verify payment</button>' : '') +
      '<button class="btn btn-outline btn-sm" data-action="ready" data-id="' + ctx.escapeHTML(o.orderId) + '">Ready</button>' +
      '<button class="btn btn-outline btn-sm" data-action="complete" data-id="' + ctx.escapeHTML(o.orderId) + '">Complete</button>' +
      '<button class="btn btn-outline btn-sm" data-action="cancel" data-id="' + ctx.escapeHTML(o.orderId) + '">Cancel</button>' +
      '<button class="btn btn-outline btn-sm" data-action="wa" data-id="' + ctx.escapeHTML(o.orderId) + '">WhatsApp</button>' +
      '<button class="btn btn-outline btn-sm" data-action="receipt" data-id="' + ctx.escapeHTML(o.orderId) + '">Receipt</button>' +
      '<button class="btn btn-outline btn-sm" data-action="note" data-id="' + ctx.escapeHTML(o.orderId) + '">Note</button>' +
      '<button class="btn btn-outline btn-sm" data-action="delete" data-id="' + ctx.escapeHTML(o.orderId) + '">Delete</button>' +
    '</div></td>' +
  '</tr>';
}
function bindOrdersTab(){
  const s = document.getElementById('ownerSearch');
  if (s) s.addEventListener('input', debounceLocal(() => { orderFilters.search = s.value; rerenderOrdersOnly(); }, 200));
  bindSelect('ownerStatus', 'status');
  bindSelect('ownerPayment', 'payment');
  bindSelect('ownerDate', 'date');
  const exportBtn = document.getElementById('ownerExportBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportOrdersCSV);
  const selAll = document.getElementById('ownerSelectAll');
  if (selAll) selAll.addEventListener('change', () => {
    document.querySelectorAll('.order-check').forEach(c => c.checked = selAll.checked);
  });
  const bulkSend = document.getElementById('ownerBulkSendBtn');
  if (bulkSend) bulkSend.addEventListener('click', startBulkReminder);
  const bulkReady = document.getElementById('ownerBulkReadyBtn');
  if (bulkReady) bulkReady.addEventListener('click', bulkMarkReady);

  document.getElementById('ownerContent').addEventListener('click', handleOrderClick, { once: false });
}
let contentClickBound = false;
function handleOrderClick(e){
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  const id = btn.getAttribute('data-id');
  orderAction(action, id);
}
function rerenderOrdersOnly(){
  const c = document.getElementById('ownerContent');
  if (!c) return;
  c.innerHTML = renderOrdersHTML();
  bindOrdersTab();
}
function bindSelect(id, key){
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => { orderFilters[key] = el.value; rerenderOrdersOnly(); });
}
function debounceLocal(fn, ms){
  let t;
  return function(){
    const a = arguments, self = this;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(self, a), ms);
  };
}
function findOrder(id){ return orderList.find(o => o.orderId === id); }

async function orderAction(action, id){
  const o = findOrder(id);
  if (!o) return;
  const { doc, updateDoc, setDoc, deleteDoc, serverTimestamp } = ctx.fs;
  try{
    if (action === 'verify'){
      const ok = await customConfirm(
        'Verify payment for ' + id + '?',
        'Amount: ' + ctx.formatKSh(o.total) + (o.paymentRef ? '  Reference: ' + o.paymentRef : '') +
        '\n\nConfirm you have seen this payment in IntaSend or M-Pesa before continuing.'
      );
      if (!ok) return;
      await updateDoc(doc(ctx.db, 'orders', id), {
        paymentStatus: 'verified',
        status: 'confirmed',
        verifiedAt: serverTimestamp()
      });
      if (o.productId){
        try{
          await updateDoc(doc(ctx.db, 'products', o.productId), {
            status: 'sold',
            stock: 0,
            updatedAt: serverTimestamp()
          });
        } catch(e){}
      }
      ctx.toast('Payment verified. Item marked sold.', 'success');
      return;
    }
    if (action === 'ready'){
      await updateDoc(doc(ctx.db, 'orders', id), { status: 'ready' });
      ctx.toast('Marked as ready.', 'success');
      return;
    }
    if (action === 'complete'){
      const updates = { status: 'completed', completedAt: serverTimestamp() };
      if (o.paymentStatus !== 'verified') updates.paymentStatus = 'verified';
      await updateDoc(doc(ctx.db, 'orders', id), updates);
      if (o.productId && o.paymentStatus !== 'verified'){
        try{ await updateDoc(doc(ctx.db, 'products', o.productId), { status: 'sold', stock: 0, updatedAt: serverTimestamp() }); } catch(e){}
      }
      ctx.toast('Order completed.', 'success');
      return;
    }
    if (action === 'cancel'){
      const ok = await customConfirm('Cancel this order?', 'The item will be released back to the shop.');
      if (!ok) return;
      await updateDoc(doc(ctx.db, 'orders', id), { status: 'cancelled' });
      if (o.productId){
        try{
          await updateDoc(doc(ctx.db, 'products', o.productId), {
            status: 'available',
            holdUntil: null,
            holdOrderId: null,
            updatedAt: serverTimestamp()
          });
        } catch(e){}
      }
      ctx.toast('Order cancelled.', 'success');
      return;
    }
    if (action === 'wa'){ whatsappOrder(id); return; }
    if (action === 'receipt'){ downloadOrderReceiptFromOwner(o); return; }
    if (action === 'note'){
      const note = prompt('Internal note (only you can see this):', o.notes || '');
      if (note === null) return;
      await updateDoc(doc(ctx.db, 'orders', id), { notes: String(note) });
      ctx.toast('Note saved.', 'success');
      return;
    }
    if (action === 'delete'){
      const ok = await customConfirm('Delete this order?', 'This cannot be undone. Do this only for data-deletion requests.');
      if (!ok) return;
      await deleteDoc(doc(ctx.db, 'orders', id));
      ctx.toast('Order deleted.', 'success');
      return;
    }
  } catch(e){
    console.error('[T&D] orderAction failed:', e);
    ctx.toast('Action failed. Check your permissions.', 'error');
  }
}

/* ============================================================
   WHATSAPP TEMPLATES
   ============================================================ */
function orderTemplates(o){
  const name = (o.customerName || '').split(' ')[0];
  const link = ctx.SITE_URL + '/?order=' + o.orderId;
  return {
    payment_received: 'Hello ' + name + ', we have received your payment for order ' + o.orderId + ' (' + o.productName + '). We are confirming it now.\n' + link + '\n- ' + 'T&D Closet',
    confirmed: 'Hello ' + name + ', your order ' + o.orderId + ' is confirmed. We are preparing it now.\n' + link + '\n- T&D Closet',
    ready: 'Hello ' + name + ', your order ' + o.orderId + ' is ready. ' + (o.fulfilment === 'delivery' ? 'It will be dispatched shortly.' : 'Please come pick it up at Horizon Plaza, 4th Floor, Shop 1011.') + '\n' + link + '\n- T&D Closet',
    out: 'Hello ' + name + ', your order ' + o.orderId + ' is out for delivery. Please be reachable.\n' + link + '\n- T&D Closet',
    completed: 'Hello ' + name + ', your order ' + o.orderId + ' is complete. Thank you for shopping with T&D Closet.\n' + link + '\n- T&D Closet',
    booking_reminder: 'Hello ' + name + ', your booking for ' + o.productName + ' (order ' + o.orderId + ') is still held. Please confirm payment or pick it up in time.\n' + link + '\n- T&D Closet',
    reminder: 'Hello ' + name + ', a reminder about your order ' + o.orderId + ' for ' + o.productName + '. Total ' + ctx.formatKSh(o.total) + '. Reply if you need help.\n' + link + '\n- T&D Closet',
    refund: 'Hello ' + name + ', your refund for order ' + o.orderId + ' has been processed to your M-Pesa. Thank you for your patience.\n- T&D Closet'
  };
}
function whatsappOrder(id){
  const o = findOrder(id);
  if (!o) return;
  const tpl = orderTemplates(o);
  const keys = Object.keys(tpl);
  const choice = prompt('Choose template:\n' + keys.join('\n'), o.paymentStatus === 'claimed' ? 'payment_received' : 'confirmed');
  if (!choice || !tpl[choice]) return;
  window.open(ctx.waLink(o.phone, tpl[choice]), '_blank');
}

/* ============================================================
   RECEIPT (owner)
   ============================================================ */
async function downloadOrderReceiptFromOwner(o){
  try{
    await loadJsPDFIfNeeded();
    const s = settingsPublic;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a5' });
    let y = 14;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text((s.businessName || 'T&D Closet').toUpperCase(), 10, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    const title = o.paymentStatus === 'verified' ? 'PAYMENT RECEIPT' : (o.paymentStatus === 'claimed' ? 'PROVISIONAL RECEIPT' : 'ORDER CONFIRMATION');
    doc.text(title, 10, y); y += 6;
    const row = (l, v) => { doc.setFont('helvetica','bold'); doc.text(l, 10, y); doc.setFont('helvetica','normal'); doc.text(String(v||''), 60, y); y += 4.5; };
    row('Order', o.orderId);
    row('Date', ctx.formatDate(o.createdAt));
    row('Customer', o.customerName);
    row('Phone', o.phone);
    row('Item', o.productName + (o.size ? ' / ' + o.size : ''));
    row('Qty', o.qty);
    row('Unit price', ctx.formatKSh(o.unitPrice));
    row('Delivery', ctx.formatKSh(o.deliveryFee));
    doc.setFont('helvetica','bold'); doc.text('Total', 10, y); doc.text(ctx.formatKSh(o.total), 60, y); y += 5;
    doc.setFont('helvetica','normal');
    row('Payment', (o.paymentMethod || '') + ' ' + (o.paymentRef || ''));
    row('Fulfilment', o.fulfilment === 'delivery' ? 'Delivery - ' + (o.address || '') : 'Pickup');
    doc.setFontSize(7.5);
    doc.text('Generated electronically by T&D Closet.', 10, 195);
    doc.save('TD-Closet-Receipt-' + o.orderId + '.pdf');
  } catch(e){
    ctx.toast('Could not generate PDF.', 'error');
  }
}
function loadJsPDFIfNeeded(){
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ============================================================
   BULK SENDER
   ============================================================ */
function startBulkReminder(){
  const ids = Array.from(document.querySelectorAll('.order-check:checked')).map(c => c.getAttribute('data-id'));
  if (!ids.length){ ctx.toast('Select at least one order.', 'error'); return; }
  bulkQueue = ids.map(findOrder).filter(Boolean);
  bulkIndex = 0;
  bulkProcessing = true;
  updateBulkPanel();
  openCurrentBulk();
}
function updateBulkPanel(){
  const p = document.getElementById('bulkPanel');
  if (!p) return;
  if (!bulkProcessing || bulkIndex >= bulkQueue.length){ p.hidden = true; return; }
  p.hidden = false;
  const total = bulkQueue.length, current = bulkIndex + 1;
  const o = bulkQueue[bulkIndex];
  document.getElementById('bulkPanelText').textContent = 'Sending ' + current + ' of ' + total + ' - ' + (o.customerName || o.phone);
  document.getElementById('bulkPanelSub').textContent = o.orderId + ' - ' + o.productName;
}
function openCurrentBulk(){
  const o = bulkQueue[bulkIndex];
  if (!o){ endBulk(); return; }
  const tpl = orderTemplates(o);
  window.open(ctx.waLink(o.phone, tpl.reminder), '_blank');
}
function bulkNext(){
  bulkIndex++;
  if (bulkIndex >= bulkQueue.length){ endBulk(); return; }
  updateBulkPanel();
  openCurrentBulk();
}
function bulkSkip(){
  bulkIndex++;
  if (bulkIndex >= bulkQueue.length){ endBulk(); return; }
  updateBulkPanel();
}
function endBulk(){
  bulkProcessing = false;
  bulkQueue = []; bulkIndex = 0;
  const p = document.getElementById('bulkPanel');
  if (p) p.hidden = true;
  ctx.toast('Bulk send finished.', 'success');
}
async function bulkMarkReady(){
  const ids = Array.from(document.querySelectorAll('.order-check:checked')).map(c => c.getAttribute('data-id'));
  if (!ids.length){ ctx.toast('Select at least one order.', 'error'); return; }
  const { doc, updateDoc } = ctx.fs;
  for (const id of ids){
    try{ await updateDoc(doc(ctx.db, 'orders', id), { status: 'ready' }); } catch(e){}
  }
  ctx.toast('Marked ' + ids.length + ' order(s) as ready.', 'success');
}

/* ============================================================
   CSV EXPORT
   ============================================================ */
function csvCell(v){ return '"' + String(v == null ? '' : v).replace(/"/g,'""') + '"'; }
function exportOrdersCSV(){
  const orders = filterOrders();
  const verified = orders.filter(o => o.paymentStatus === 'verified');
  const claimed = orders.filter(o => o.paymentStatus === 'claimed');
  const total = verified.reduce((s,o) => s + Number(o.total||0), 0);
  const claimedTotal = claimed.reduce((s,o) => s + Number(o.total||0), 0);
  const lines = [];
  lines.push(csvCell('T&D Closet - Orders report'));
  lines.push(csvCell('Generated: ' + ctx.formatDate(new Date())));
  lines.push('');
  lines.push(csvCell('SUMMARY'));
  lines.push([csvCell('Orders'), csvCell(orders.length)].join(','));
  lines.push([csvCell('Verified revenue'), csvCell(total)].join(','));
  lines.push([csvCell('Awaiting verification'), csvCell(claimedTotal)].join(','));
  lines.push([csvCell('Average order value'), csvCell(orders.length ? Math.round(total/orders.length) : 0)].join(','));
  lines.push('');
  lines.push(csvCell('STATUS BREAKDOWN'));
  lines.push([csvCell('Status'), csvCell('Count'), csvCell('Value')].join(','));
  ['awaiting_payment','booked','pay_on_pickup','confirmed','ready','completed','cancelled'].forEach(st => {
    const arr = orders.filter(o => o.status === st);
    lines.push([csvCell(st), csvCell(arr.length), csvCell(arr.reduce((s,o) => s + Number(o.total||0), 0))].join(','));
  });
  lines.push('');
  lines.push(csvCell('SALES BY PRODUCT'));
  lines.push([csvCell('Product'), csvCell('Units'), csvCell('Revenue')].join(','));
  const byProd = {};
  orders.forEach(o => {
    const k = o.productName || 'Unknown';
    byProd[k] = byProd[k] || { units: 0, revenue: 0 };
    byProd[k].units += Number(o.qty||1);
    byProd[k].revenue += Number(o.total||0);
  });
  Object.keys(byProd).sort((a,b) => byProd[b].revenue - byProd[a].revenue).forEach(k => {
    lines.push([csvCell(k), csvCell(byProd[k].units), csvCell(byProd[k].revenue)].join(','));
  });
  lines.push('');
  lines.push(csvCell('ITEMISED ORDERS'));
  lines.push(['Date','Order','Customer','Phone','Item','Size','Qty','Unit Price','Delivery','Total','Due','Payment','Ref','Status','Kind','Fulfilment','Address'].map(csvCell).join(','));
  orders.forEach(o => {
    lines.push([
      csvCell(ctx.formatDate(o.createdAt)),
      csvCell(o.orderId), csvCell(o.customerName), csvCell(o.phone),
      csvCell(o.productName), csvCell(o.size || ''), csvCell(o.qty),
      csvCell(o.unitPrice), csvCell(o.deliveryFee), csvCell(o.total), csvCell(o.amountDue || 0),
      csvCell(o.paymentStatus), csvCell(o.paymentRef || ''), csvCell(o.status), csvCell(o.kind),
      csvCell(o.fulfilment), csvCell(o.address || '')
    ].join(','));
  });
  const csv = '\ufeff' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'T&D-Closet-Report-' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  ctx.toast('Report downloaded.', 'success');
}

/* ============================================================
   BOOKINGS TAB
   ============================================================ */
function renderBookingsHTML(){
  const list = orderList.filter(o => o.status === 'booked' || o.status === 'pay_on_pickup')
    .sort((a, b) => {
      const at = a.holdUntil && a.holdUntil.toMillis ? a.holdUntil.toMillis() : 0;
      const bt = b.holdUntil && b.holdUntil.toMillis ? b.holdUntil.toMillis() : 0;
      return at - bt;
    });
  if (!list.length){
    return '<div class="empty-state"><svg width="42" height="42"><use href="#i-clock"/></svg><h3>No active bookings</h3><p>Bookings and pickup reservations will appear here.</p></div>';
  }
  return '<div class="panel table-wrap"><table class="orders-table"><thead><tr>' +
    '<th>Hold ends</th><th>Order</th><th>Customer</th><th>Item</th><th>Total</th><th>Actions</th>' +
    '</tr></thead><tbody>' +
    list.map(o => {
      const hold = o.holdUntil ? ctx.formatDate(o.holdUntil) : '-';
      return '<tr>' +
        '<td>' + ctx.escapeHTML(hold) + '</td>' +
        '<td><strong>' + ctx.escapeHTML(o.orderId) + '</strong></td>' +
        '<td>' + ctx.escapeHTML(o.customerName || '') + '<div style="font-size:11px;color:var(--muted)">' + ctx.escapeHTML(o.phone || '') + '</div></td>' +
        '<td>' + ctx.escapeHTML(o.productName || '') + (o.size ? ' / ' + ctx.escapeHTML(o.size) : '') + '</td>' +
        '<td>' + ctx.formatKSh(o.total) + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="btn btn-outline btn-sm" data-action="wa" data-id="' + ctx.escapeHTML(o.orderId) + '">WhatsApp</button>' +
          '<button class="btn btn-outline btn-sm" data-action="cancel" data-id="' + ctx.escapeHTML(o.orderId) + '">Cancel</button>' +
        '</div></td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>' +
    '<div class="panel"><button id="releaseExpiredBtn" class="btn btn-dark">Release expired holds</button></div>';
}
function bindBookingsTab(){
  document.getElementById('ownerContent').addEventListener('click', handleOrderClick);
  const btn = document.getElementById('releaseExpiredBtn');
  if (btn) btn.addEventListener('click', releaseExpiredHolds);
}
async function releaseExpiredHolds(){
  const { doc, updateDoc } = ctx.fs;
  const now = Date.now();
  let count = 0;
  for (const p of productsCache){
    if (p.status !== 'held') continue;
    const until = p.holdUntil && p.holdUntil.toMillis ? p.holdUntil.toMillis() : 0;
    if (until && until < now){
      try{
        await updateDoc(doc(ctx.db, 'products', p.id), {
          status: 'available', holdUntil: null, holdOrderId: null, updatedAt: ctx.fs.serverTimestamp()
        });
        count++;
      } catch(e){}
    }
  }
  ctx.toast('Released ' + count + ' expired hold(s).', 'success');
  await loadProducts();
  renderCurrentTab();
}

/* ============================================================
   PRODUCTS TAB
   ============================================================ */
function renderProductsHTML(){
  return '' +
    '<div class="products-manager">' +
      '<div class="panel prod-form-panel">' +
        '<div class="panel-head"><h3 id="prodFormTitle">Add product</h3><button id="prodNewBtn" class="btn btn-outline btn-sm">New</button></div>' +
        '<form id="prodForm" class="prod-form">' +
          '<input type="hidden" id="prodEditId">' +
          '<label>Item name <span class="req">*</span><input id="prodName" type="text" required></label>' +
          '<div class="row-2">' +
            '<label>Category<select id="prodCategory">' + ['Jeans','Polos','Shirts','Sweatpants','Jackets'].map(c => '<option>' + c + '</option>').join('') + '</select></label>' +
            '<label>Condition<select id="prodCondition"><option>Excellent</option><option>Very good</option><option>Good</option></select></label>' +
          '</div>' +
          '<div class="row-2">' +
            '<label>Price (KSh) <span class="req">*</span><input id="prodPrice" type="number" min="0" required></label>' +
            '<label>Old price<input id="prodOldPrice" type="number" min="0"></label>' +
          '</div>' +
          '<label>Description<textarea id="prodDesc" rows="3"></textarea></label>' +
          '<div class="prod-sizes">' +
            '<span class="prod-label">Sizes</span>' +
            '<div class="size-quick-row" id="sizeQuickRow">' +
              ['S','M','L','XL','XXL'].map(s => '<button type="button" data-size="' + s + '">' + s + '</button>').join('') +
              '<span class="size-divider"></span>' +
              ['28','30','32','34','36','38'].map(s => '<button type="button" data-size="' + s + '">' + s + '</button>').join('') +
            '</div>' +
            '<div class="size-custom-row"><input id="prodSizeCustom" placeholder="Custom size"><button type="button" id="prodSizeAdd" class="btn btn-outline btn-sm">Add</button></div>' +
            '<div class="size-chips selected-sizes" id="prodSelectedSizes"></div>' +
          '</div>' +
          '<div class="row-2">' +
            '<label>Stock<input id="prodStock" type="number" min="1" value="1"></label>' +
            '<label>Status<select id="prodStatus"><option value="available">Available</option><option value="sold">Sold</option></select></label>' +
          '</div>' +
          '<label class="checkbox"><input id="prodIsNew" type="checkbox"> Mark as new</label>' +
          '<label>Photos <input id="prodImages" type="file" accept="image/*" multiple><span class="field-hint">Up to 4 photos. First is cover.</span></label>' +
          '<div id="prodImagePreviews" class="image-previews"></div>' +
          '<div class="form-actions">' +
            '<button type="submit" class="btn btn-dark" id="prodSaveBtn">Save product</button>' +
            '<button type="button" id="prodCancelEdit" class="btn btn-outline" hidden>Cancel edit</button>' +
          '</div>' +
        '</form>' +
      '</div>' +
      '<div class="panel">' +
        '<div class="panel-head"><h3>Inventory <span id="invCount" class="muted"></span></h3></div>' +
        '<div id="prodList" class="prod-list"></div>' +
      '</div>' +
    '</div>';
}
function bindProductsTab(){
  const { collection, doc, updateDoc, deleteDoc, serverTimestamp } = ctx.fs;
  resetProdForm();
  renderProdList();

  document.getElementById('sizeQuickRow').addEventListener('click', e => {
    const b = e.target.closest('[data-size]');
    if (b) addEditSize(b.getAttribute('data-size'));
  });
  document.getElementById('prodSizeAdd').addEventListener('click', () => {
    const v = document.getElementById('prodSizeCustom').value.trim();
    if (v){ addEditSize(v); document.getElementById('prodSizeCustom').value = ''; }
  });
  document.getElementById('prodSelectedSizes').addEventListener('click', e => {
    const r = e.target.closest('[data-remove]');
    if (!r) return;
    editingSizes = editingSizes.filter(s => s !== r.getAttribute('data-remove'));
    renderEditSizes();
  });
  document.getElementById('prodImages').addEventListener('change', e => handleProductImages(e.target.files));
  document.getElementById('prodImagePreviews').addEventListener('click', e => {
    const r = e.target.closest('[data-remove-img]');
    if (!r) return;
    editingImages.splice(Number(r.getAttribute('data-remove-img')), 1);
    renderEditPreviews();
  });
  document.getElementById('prodForm').addEventListener('submit', saveProduct);
  document.getElementById('prodNewBtn').addEventListener('click', resetProdForm);
  document.getElementById('prodCancelEdit').addEventListener('click', resetProdForm);
  document.getElementById('prodList').addEventListener('click', async e => {
    const edit = e.target.closest('[data-edit]');
    const toggle = e.target.closest('[data-toggle]');
    const del = e.target.closest('[data-delete]');
    const markSoldInStore = e.target.closest('[data-soldstore]');
    if (edit){
      const p = productsCache.find(x => x.id === edit.getAttribute('data-edit'));
      if (!p) return;
      document.getElementById('prodEditId').value = p.id;
      document.getElementById('prodName').value = p.name || '';
      document.getElementById('prodCategory').value = p.category || 'Jeans';
      document.getElementById('prodCondition').value = p.condition || 'Excellent';
      document.getElementById('prodPrice').value = p.price || '';
      document.getElementById('prodOldPrice').value = p.oldPrice || '';
      document.getElementById('prodDesc').value = p.description || '';
      document.getElementById('prodStock').value = p.stock == null ? 1 : p.stock;
      document.getElementById('prodStatus').value = p.status === 'sold' ? 'sold' : 'available';
      document.getElementById('prodIsNew').checked = !!p.isNew;
      editingImages = (p.images || []).slice();
      editingSizes = (p.sizes || []).slice();
      renderEditSizes(); renderEditPreviews();
      document.getElementById('prodFormTitle').textContent = 'Edit product';
      document.getElementById('prodCancelEdit').hidden = false;
      return;
    }
    if (toggle){
      const p = productsCache.find(x => x.id === toggle.getAttribute('data-toggle'));
      if (!p) return;
      const newStatus = p.status === 'sold' ? 'available' : 'sold';
      await updateDoc(doc(ctx.db, 'products', p.id), { status: newStatus, updatedAt: serverTimestamp() });
      await loadProducts(); renderCurrentTab();
      return;
    }
    if (markSoldInStore){
      const p = productsCache.find(x => x.id === markSoldInStore.getAttribute('data-soldstore'));
      if (!p) return;
      await updateDoc(doc(ctx.db, 'products', p.id), { status: 'sold', stock: 0, updatedAt: serverTimestamp() });
      ctx.toast('Marked sold in store.', 'success');
      await loadProducts(); renderCurrentTab();
      return;
    }
    if (del){
      const p = productsCache.find(x => x.id === del.getAttribute('data-delete'));
      if (!p) return;
      const ok = await customConfirm('Delete product?', p.name + ' will be hidden from the shop.');
      if (!ok) return;
      await updateDoc(doc(ctx.db, 'products', p.id), { deleted: true, updatedAt: serverTimestamp() });
      ctx.toast('Product removed.', 'success');
      await loadProducts(); renderCurrentTab();
      return;
    }
  });
}
function resetProdForm(){
  document.getElementById('prodEditId').value = '';
  document.getElementById('prodName').value = '';
  document.getElementById('prodCategory').value = 'Jeans';
  document.getElementById('prodCondition').value = 'Excellent';
  document.getElementById('prodPrice').value = '';
  document.getElementById('prodOldPrice').value = '';
  document.getElementById('prodDesc').value = '';
  document.getElementById('prodStock').value = 1;
  document.getElementById('prodStatus').value = 'available';
  document.getElementById('prodIsNew').checked = false;
  document.getElementById('prodImages').value = '';
  document.getElementById('prodImagePreviews').innerHTML = '';
  document.getElementById('prodFormTitle').textContent = 'Add product';
  document.getElementById('prodCancelEdit').hidden = true;
  editingImages = []; editingSizes = [];
  renderEditSizes();
}
function addEditSize(s){
  s = String(s || '').trim();
  if (!s || editingSizes.includes(s)) return;
  editingSizes.push(s);
  renderEditSizes();
}
function renderEditSizes(){
  const wrap = document.getElementById('prodSelectedSizes');
  if (!wrap) return;
  wrap.innerHTML = editingSizes.map(s =>
    '<span class="size-btn" data-size="' + ctx.escapeHTML(s) + '">' + ctx.escapeHTML(s) + '<span class="remove-size" data-remove="' + ctx.escapeHTML(s) + '">x</span></span>'
  ).join('');
}
function renderEditPreviews(){
  const wrap = document.getElementById('prodImagePreviews');
  if (!wrap) return;
  wrap.innerHTML = editingImages.map((url, i) =>
    '<div class="image-preview"><img src="' + ctx.escapeHTML(url) + '" alt=""><button type="button" class="remove-img" data-remove-img="' + i + '">x</button></div>'
  ).join('');
}
async function handleProductImages(files){
  if (!files || !files.length) return;
  const allowed = Array.prototype.slice.call(files, 0, 4 - editingImages.length);
  const key = settingsPrivate.imgbbKey;
  if (!key){ ctx.toast('Add your imgbb key in Settings first.', 'error'); return; }
  for (const f of allowed){
    const placeholderURL = URL.createObjectURL(f);
    editingImages.push(placeholderURL);
    renderEditPreviews();
    try{
      const dataUrl = await compressImageOwner(f);
      const base64 = dataUrl.split(',')[1];
      const fd = new FormData();
      fd.append('image', base64);
      const res = await fetch('https://api.imgbb.com/1/upload?key=' + encodeURIComponent(key), { method: 'POST', body: fd });
      if (!res.ok) throw new Error('imgbb ' + res.status);
      const j = await res.json();
      const url = (j && j.data && (j.data.url || j.data.display_url)) || '';
      if (!url) throw new Error('no url');
      const idx = editingImages.indexOf(placeholderURL);
      if (idx >= 0) editingImages[idx] = url;
      renderEditPreviews();
    } catch(e){
      ctx.toast('Upload failed: ' + e.message, 'error');
      const idx = editingImages.indexOf(placeholderURL);
      if (idx >= 0) editingImages.splice(idx, 1);
      renderEditPreviews();
    }
  }
}
function compressImageOwner(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('read'));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode'));
      img.onload = () => {
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX){ const ratio = Math.min(MAX/w, MAX/h); w = Math.round(w*ratio); h = Math.round(h*ratio); }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
async function saveProduct(e){
  e.preventDefault();
  const { doc, setDoc, updateDoc, serverTimestamp } = ctx.fs;
  const id = document.getElementById('prodEditId').value;
  const name = document.getElementById('prodName').value.trim();
  const category = document.getElementById('prodCategory').value;
  const condition = document.getElementById('prodCondition').value;
  const price = Number(document.getElementById('prodPrice').value);
  const oldPrice = Number(document.getElementById('prodOldPrice').value) || 0;
  const desc = document.getElementById('prodDesc').value.trim();
  const stock = Number(document.getElementById('prodStock').value) || 1;
  const status = document.getElementById('prodStatus').value;
  const isNew = document.getElementById('prodIsNew').checked;
  if (!name || !price){ ctx.toast('Name and price are required.', 'error'); return; }

  const productId = id || ('p_' + Date.now() + '_' + Math.floor(Math.random()*1000));
  const payload = {
    name, category, condition,
    price, oldPrice,
    description: desc,
    stock, status,
    sizes: editingSizes.slice(),
    images: editingImages.slice(),
    isNew,
    deleted: false,
    updatedAt: serverTimestamp()
  };
  if (!id){
    payload.createdAt = serverTimestamp();
  }
  const btn = document.getElementById('prodSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving...';
  try{
    if (id){
      await updateDoc(doc(ctx.db, 'products', id), payload);
    } else {
      await setDoc(doc(ctx.db, 'products', productId), payload);
    }
    ctx.toast('Product saved.', 'success');
    await loadProducts();
    resetProdForm();
    renderProdList();
  } catch(e){
    ctx.toast('Save failed. Check your permissions.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save product';
  }
}
function renderProdList(){
  const list = document.getElementById('prodList');
  const count = document.getElementById('invCount');
  if (!list) return;
  const items = productsCache.filter(p => !p.deleted);
  if (count) count.textContent = '(' + items.length + ')';
  if (!items.length){ list.innerHTML = '<p class="muted">No products yet.</p>'; return; }
  list.innerHTML = items.map(p => {
    const img = (p.images && p.images[0]) || '';
    const thumb = img ? '<img src="' + ctx.escapeHTML(img) + '" alt="">' : '';
    const st = p.status === 'sold' ? 'sold' : (p.status === 'held' ? 'held' : 'available');
    return '<div class="prod-item">' +
      '<div class="prod-item-img">' + thumb + '</div>' +
      '<div class="prod-item-body">' +
        '<div class="prod-item-name">' + ctx.escapeHTML(p.name) + '</div>' +
        '<div class="prod-item-meta">' + ctx.escapeHTML(p.category || '') + ' - ' + ctx.formatKSh(p.price) + ' - ' + ctx.escapeHTML(st) + '</div>' +
        ((p.sizes || []).length ? '<div class="prod-item-sizes">' + ctx.escapeHTML(p.sizes.join(', ')) + '</div>' : '') +
      '</div>' +
      '<div class="prod-item-actions">' +
        '<button class="btn btn-outline btn-sm" data-edit="' + ctx.escapeHTML(p.id) + '">Edit</button>' +
        '<button class="btn btn-outline btn-sm" data-toggle="' + ctx.escapeHTML(p.id) + '">' + (st === 'sold' ? 'Available' : 'Mark sold') + '</button>' +
        '<button class="btn btn-outline btn-sm" data-delete="' + ctx.escapeHTML(p.id) + '">Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* ============================================================
   CUSTOMERS TAB
   ============================================================ */
function renderCustomersHTML(){
  if (!customersCache.length) return '<div class="empty-state"><svg width="42" height="42"><use href="#i-heart"/></svg><h3>No customers yet</h3><p>Customer list is built from orders.</p></div>';
  return '<div class="panel table-wrap"><table class="orders-table"><thead><tr>' +
    '<th>Name</th><th>Phone</th><th>Orders</th><th>Verified spend</th><th>Last order</th><th></th>' +
    '</tr></thead><tbody>' +
    customersCache.map(c => '<tr>' +
      '<td>' + ctx.escapeHTML(c.name || '') + '</td>' +
      '<td>' + ctx.escapeHTML(c.phone || '') + '</td>' +
      '<td>' + c.orders + '</td>' +
      '<td>' + ctx.formatKSh(c.total) + '</td>' +
      '<td>' + (c.last ? ctx.escapeHTML(ctx.formatDate(c.last)) : '-') + '</td>' +
      '<td><button class="btn btn-outline btn-sm" data-wa-phone="' + ctx.escapeHTML(c.phone || '') + '">WhatsApp</button></td>' +
    '</tr>').join('') +
    '</tbody></table></div>' +
    '<div class="panel form-actions">' +
      '<button id="exportCustomersBtn" class="btn btn-dark">Export customer list</button>' +
    '</div>';
}
function bindCustomersTab(){
  const c = document.getElementById('ownerContent');
  c.addEventListener('click', e => {
    const b = e.target.closest('[data-wa-phone]');
    if (b) window.open(ctx.waLink(b.getAttribute('data-wa-phone'), 'Hi from T&D Closet.'), '_blank');
  });
  const ex = document.getElementById('exportCustomersBtn');
  if (ex) ex.addEventListener('click', () => {
    const lines = [['Name','Phone','Orders','Verified spend','Last order'].map(csvCell).join(',')];
    customersCache.forEach(c => {
      lines.push([csvCell(c.name), csvCell(c.phone), csvCell(c.orders), csvCell(c.total), csvCell(c.last ? ctx.formatDate(c.last) : '')].join(','));
    });
    const csv = '\ufeff' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'T&D-Closet-Customers-' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    ctx.toast('Customer list exported.', 'success');
  });
}

/* ============================================================
   REPORTS TAB
   ============================================================ */
function renderReportsHTML(){
  return '<div class="panel">' +
    '<h3>Reports</h3>' +
    '<p class="muted">The Orders tab already loads the latest 100 orders. Use "Load all orders" to page through the entire history for complete reports, then export.</p>' +
    '<div class="form-actions">' +
      '<button id="loadAllOrdersBtn" class="btn btn-dark">Load all orders</button>' +
      '<button id="exportReportBtn" class="btn btn-outline">Export report (CSV)</button>' +
      '<button id="exportBackupBtn" class="btn btn-outline">Download full backup (JSON)</button>' +
    '</div>' +
    '<div id="reportProgress" class="muted" style="margin-top:10px"></div>' +
  '</div>';
}
function bindReportsTab(){
  document.getElementById('loadAllOrdersBtn').addEventListener('click', loadAllOrders);
  document.getElementById('exportReportBtn').addEventListener('click', exportOrdersCSV);
  document.getElementById('exportBackupBtn').addEventListener('click', downloadBackup);
}
async function loadAllOrders(){
  const prog = document.getElementById('reportProgress');
  const { collection, query, orderBy, limit, startAfter, getDocs } = ctx.fs;
  let all = [];
  let last = null;
  try{
    while (true){
      const base = [collection(ctx.db, 'orders'), orderBy('createdAt', 'desc'), limit(300)];
      const q = last ? query(base[0], base[1], base[2], startAfter(last)) : query(base[0], base[1], base[2]);
      const snap = await getDocs(q);
      if (snap.empty) break;
      snap.forEach(d => all.push(Object.assign({ id: d.id }, d.data())));
      last = snap.docs[snap.docs.length - 1];
      prog.textContent = 'Loaded ' + all.length + ' orders...';
      if (snap.size < 300) break;
    }
    orderList = all;
    prog.textContent = 'Loaded all ' + all.length + ' orders. You can now export.';
    ctx.toast('All orders loaded.', 'success');
  } catch(e){
    prog.textContent = 'Could not load all orders: ' + e.message;
  }
}
function downloadBackup(){
  const payload = {
    generated: new Date().toISOString(),
    settingsPublic,
    products: productsCache,
    orders: orderList
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'T&D-Closet-Backup-' + new Date().toISOString().slice(0,10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  ctx.toast('Backup downloaded.', 'success');
}

/* ============================================================
   SETTINGS TAB
   ============================================================ */
function renderSettingsHTML(){
  const s = settingsPublic;
  const zones = (s.deliveryZones || []).map(z => ({ name: z.name || '', fee: z.fee || 0, eta: z.eta || '' }));
  return '<div class="panel"><h3>Business details</h3>' +
    '<div class="prod-form">' +
      '<label>Business name<input id="setBusinessName" value="' + ctx.escapeHTML(s.businessName || '') + '"></label>' +
      '<div class="row-2"><label>Legal name<input id="setLegalName" value="' + ctx.escapeHTML(s.legalName || '') + '"></label>' +
      '<label>Registration no.<input id="setReg" value="' + ctx.escapeHTML(s.registrationNo || '') + '"></label></div>' +
      '<div class="row-2"><label>KRA PIN<input id="setKra" value="' + ctx.escapeHTML(s.kraPin || '') + '"></label>' +
      '<label>Phone<input id="setPhone" value="' + ctx.escapeHTML(s.phone || '') + '"></label></div>' +
      '<label>Address<textarea id="setAddress" rows="2">' + ctx.escapeHTML(s.address || '') + '</textarea></label>' +
      '<label>Maps URL<input id="setMaps" value="' + ctx.escapeHTML(s.mapsUrl || '') + '"></label>' +
      '<label>Hours text<textarea id="setHours" rows="2">' + ctx.escapeHTML(s.hoursText || '') + '</textarea></label>' +
    '</div></div>' +
    '<div class="panel"><h3>Payments</h3>' +
    '<div class="prod-form">' +
      '<div class="row-2"><label>Till number<input id="setTill" value="' + ctx.escapeHTML(s.tillNumber || '') + '"></label>' +
      '<label>Paybill<input id="setPaybill" value="' + ctx.escapeHTML(s.paybill || '') + '"></label></div>' +
      '<label>IntaSend public key<input id="setIntaKey" value="' + ctx.escapeHTML(s.intasendPublicKey || '') + '"></label>' +
      '<label class="checkbox"><input type="checkbox" id="setIntaLive"' + (s.intasendLive ? ' checked' : '') + '> IntaSend live mode (off = sandbox)</label>' +
    '</div></div>' +
    '<div class="panel"><h3>Feature toggles</h3>' +
    '<div class="prod-form">' +
      '<label class="checkbox"><input type="checkbox" id="setEnableOnline"' + (s.enableOnlinePayment ? ' checked' : '') + '> Enable online payment</label>' +
      '<label class="checkbox"><input type="checkbox" id="setEnableManual"' + (s.enableManualMpesa ? ' checked' : '') + '> Enable manual M-Pesa</label>' +
      '<label class="checkbox"><input type="checkbox" id="setEnablePickup"' + (s.enablePayOnPickup ? ' checked' : '') + '> Enable pay on pickup</label>' +
      '<label class="checkbox"><input type="checkbox" id="setEnableBooking"' + (s.enableBooking ? ' checked' : '') + '> Enable booking / hold</label>' +
    '</div></div>' +
    '<div class="panel"><h3>Holds and deposits</h3>' +
    '<div class="prod-form">' +
      '<div class="row-2"><label>Pay-now hold minutes<input id="setPayNowHold" type="number" min="5" value="' + Number(s.payNowHoldMinutes || 15) + '"></label>' +
      '<label>Booking hold hours<input id="setBookHold" type="number" min="1" value="' + Number(s.bookingHoldHours || 24) + '"></label></div>' +
      '<label>Booking deposit percent (0 for free hold)<input id="setBookPct" type="number" min="0" max="100" value="' + Number(s.bookingDepositPercent || 0) + '"></label>' +
    '</div></div>' +
    '<div class="panel"><h3>Delivery zones</h3>' +
      '<div id="zonesList" class="prod-form"></div>' +
      '<button id="addZoneBtn" class="btn btn-outline btn-sm" type="button">Add zone</button>' +
    '</div>' +
    '<div class="panel"><h3>Announcement</h3>' +
    '<div class="prod-form"><label>Announcement bar text (use | to separate phrases)<input id="setAnnounce" value="' + ctx.escapeHTML(s.announcement || '') + '"></label></div>' +
    '</div>' +
    '<div class="panel"><h3>imgbb key (private)</h3>' +
    '<div class="prod-form">' +
      '<label>imgbb API key<input id="setImgbbKey" type="password" value="' + ctx.escapeHTML(settingsPrivate.imgbbKey || '') + '"><span class="field-hint">Used only in the dashboard to upload product photos.</span></label>' +
    '</div></div>' +
    '<div class="panel form-actions">' +
      '<button id="saveSettingsBtn" class="btn btn-dark">Save settings</button>' +
    '</div>';
}
function bindSettingsTab(){
  const list = document.getElementById('zonesList');
  function renderZones(){
    list.innerHTML = (settingsPublic.deliveryZones || []).map((z, i) =>
      '<div class="row-2" style="align-items:end">' +
        '<label>Name<input data-zone-name="' + i + '" value="' + ctx.escapeHTML(z.name || '') + '"></label>' +
        '<div class="row-2">' +
          '<label>Fee<input data-zone-fee="' + i + '" type="number" value="' + Number(z.fee || 0) + '"></label>' +
          '<label>ETA<input data-zone-eta="' + i + '" value="' + ctx.escapeHTML(z.eta || '') + '"></label>' +
        '</div>' +
        '<button class="btn btn-outline btn-sm" data-remove-zone="' + i + '" type="button" style="grid-column:span 2">Remove</button>' +
      '</div>'
    ).join('');
  }
  renderZones();
  list.addEventListener('click', e => {
    const r = e.target.closest('[data-remove-zone]');
    if (!r) return;
    const i = Number(r.getAttribute('data-remove-zone'));
    settingsPublic.deliveryZones.splice(i, 1);
    renderZones();
  });
  document.getElementById('addZoneBtn').addEventListener('click', () => {
    settingsPublic.deliveryZones = settingsPublic.deliveryZones || [];
    settingsPublic.deliveryZones.push({ name: '', fee: 0, eta: '' });
    renderZones();
  });
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
}
async function saveSettings(){
  const { doc, setDoc, serverTimestamp } = ctx.fs;
  const zones = [];
  document.querySelectorAll('[data-zone-name]').forEach((el, i) => {
    const name = el.value.trim();
    if (!name) return;
    zones.push({
      name,
      fee: Number(document.querySelector('[data-zone-fee="' + i + '"]').value) || 0,
      eta: document.querySelector('[data-zone-eta="' + i + '"]').value.trim()
    });
  });
  const pub = {
    businessName: document.getElementById('setBusinessName').value.trim(),
    legalName: document.getElementById('setLegalName').value.trim(),
    registrationNo: document.getElementById('setReg').value.trim(),
    kraPin: document.getElementById('setKra').value.trim(),
    phone: document.getElementById('setPhone').value.trim(),
    address: document.getElementById('setAddress').value.trim(),
    mapsUrl: document.getElementById('setMaps').value.trim(),
    hoursText: document.getElementById('setHours').value.trim(),
    tillNumber: document.getElementById('setTill').value.trim(),
    paybill: document.getElementById('setPaybill').value.trim(),
    intasendPublicKey: document.getElementById('setIntaKey').value.trim(),
    intasendLive: document.getElementById('setIntaLive').checked,
    enableOnlinePayment: document.getElementById('setEnableOnline').checked,
    enableManualMpesa: document.getElementById('setEnableManual').checked,
    enablePayOnPickup: document.getElementById('setEnablePickup').checked,
    enableBooking: document.getElementById('setEnableBooking').checked,
    payNowHoldMinutes: Number(document.getElementById('setPayNowHold').value) || 15,
    bookingHoldHours: Number(document.getElementById('setBookHold').value) || 24,
    bookingDepositPercent: Number(document.getElementById('setBookPct').value) || 0,
    deliveryZones: zones,
    announcement: document.getElementById('setAnnounce').value.trim(),
    updatedAt: serverTimestamp()
  };
  const imgbb = document.getElementById('setImgbbKey').value.trim();
  try{
    await setDoc(doc(ctx.db, 'settings', 'public'), pub, { merge: true });
    await setDoc(doc(ctx.db, 'settings', 'private'), { imgbbKey: imgbb }, { merge: true });
    ctx.toast('Settings saved.', 'success');
    await loadSettings();
  } catch(e){
    ctx.toast('Save failed. Check your permissions.', 'error');
  }
}

/* ============================================================
   TOOLS TAB
   ============================================================ */
function renderToolsHTML(){
  return '<div class="panel"><h3>Record walk-in sale</h3>' +
    '<p class="muted">Use this when a customer pays in store.</p>' +
    '<div class="prod-form">' +
      '<label>Product<select id="walkProduct">' +
        '<option value="">- Select -</option>' +
        productsCache.filter(p => !p.deleted).map(p => '<option value="' + ctx.escapeHTML(p.id) + '">' + ctx.escapeHTML(p.name) + ' - ' + ctx.formatKSh(p.price) + '</option>').join('') +
      '</select></label>' +
      '<div class="row-2"><label>Price override<input id="walkPrice" type="number" min="0"></label>' +
      '<label>Method<select id="walkMethod"><option value="cash">Cash</option><option value="mpesa_manual">M-Pesa</option></select></label></div>' +
      '<div class="row-2"><label>Customer name<input id="walkName"></label><label>Customer phone<input id="walkPhone"></label></div>' +
      '<button id="walkSaveBtn" class="btn btn-dark" type="button">Record walk-in sale</button>' +
    '</div></div>' +
    '<div class="panel"><h3>Import old products from JSONBin</h3>' +
    '<p class="muted">One-time import. Your old bin ID and key are used only in this browser and are not stored.</p>' +
    '<div class="prod-form">' +
      '<div class="row-2"><label>JSONBin Bin ID<input id="importBin"></label><label>JSONBin Master Key<input id="importKey" type="password"></label></div>' +
      '<button id="importPreviewBtn" class="btn btn-outline" type="button">Preview</button>' +
      '<div id="importPreview" class="muted" style="margin-top:10px"></div>' +
      '<button id="importConfirmBtn" class="btn btn-dark" type="button" hidden>Import products</button>' +
    '</div></div>' +
    '<div class="panel"><h3>Backup</h3>' +
    '<p class="muted">Download a full backup weekly and keep it safe.</p>' +
    '<button id="backupBtn2" class="btn btn-dark" type="button">Download full backup (JSON)</button>' +
    '</div>';
}
function bindToolsTab(){
  document.getElementById('walkSaveBtn').addEventListener('click', recordWalkIn);
  document.getElementById('importPreviewBtn').addEventListener('click', previewImport);
  document.getElementById('importConfirmBtn').addEventListener('click', confirmImport);
  document.getElementById('backupBtn2').addEventListener('click', downloadBackup);
}
async function recordWalkIn(){
  const { doc, setDoc, updateDoc, serverTimestamp } = ctx.fs;
  const productId = document.getElementById('walkProduct').value;
  const priceOverride = Number(document.getElementById('walkPrice').value) || 0;
  const method = document.getElementById('walkMethod').value;
  const name = document.getElementById('walkName').value.trim() || 'Walk-in customer';
  const phoneRaw = document.getElementById('walkPhone').value.trim();
  const phone = phoneRaw ? ctx.normalizePhone(phoneRaw) : '254000000000';
  const p = productsCache.find(x => x.id === productId);
  if (!p){ ctx.toast('Choose a product.', 'error'); return; }
  const price = priceOverride > 0 ? priceOverride : Number(p.price);
  const orderId = 'TD-WALK-' + Date.now().toString().slice(-6);
  const payload = {
    orderId, kind: 'walkin',
    status: 'completed',
    paymentStatus: 'verified',
    paymentMethod: method === 'mpesa_manual' ? 'mpesa_manual' : 'cash',
    paymentRef: '',
    productId,
    productName: p.name || '',
    productImage: (p.images && p.images[0]) || '',
    size: '',
    qty: 1,
    unitPrice: price,
    deliveryFee: 0,
    total: price,
    amountDue: price,
    customerName: name,
    phone,
    email: '',
    fulfilment: 'pickup',
    deliveryZone: '',
    address: '',
    consent: true,
    holdUntil: null,
    createdAt: serverTimestamp(),
    completedAt: serverTimestamp(),
    verifiedAt: serverTimestamp()
  };
  try{
    await setDoc(doc(ctx.db, 'orders', orderId), payload);
    await updateDoc(doc(ctx.db, 'products', productId), { status: 'sold', stock: 0, updatedAt: serverTimestamp() });
    ctx.toast('Walk-in sale recorded.', 'success');
    await loadProducts();
    renderCurrentTab();
  } catch(e){
    ctx.toast('Could not record sale.', 'error');
  }
}
let importPreviewData = null;
async function previewImport(){
  const bin = document.getElementById('importBin').value.trim();
  const key = document.getElementById('importKey').value.trim();
  if (!bin || !key){ ctx.toast('Enter both Bin ID and Master Key.', 'error'); return; }
  const box = document.getElementById('importPreview');
  box.textContent = 'Loading...';
  try{
    const res = await fetch('https://api.jsonbin.io/v3/b/' + bin + '/latest', { headers: { 'X-Master-Key': key } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const rec = j.record || {};
    const products = Array.isArray(rec.products) ? rec.products : [];
    importPreviewData = products;
    box.textContent = 'Found ' + products.length + ' product(s). Preview: ' + products.slice(0, 3).map(p => p.name).join(', ');
    document.getElementById('importConfirmBtn').hidden = products.length === 0;
  } catch(e){
    box.textContent = 'Could not read bin: ' + e.message;
  }
}
async function confirmImport(){
  if (!importPreviewData || !importPreviewData.length) return;
  const { doc, writeBatch, serverTimestamp } = ctx.fs;
  let count = 0;
  try{
    const chunks = [];
    for (let i = 0; i < importPreviewData.length; i += 400){
      chunks.push(importPreviewData.slice(i, i + 400));
    }
    for (const chunk of chunks){
      const batch = writeBatch(ctx.db);
      chunk.forEach(p => {
        const id = 'p_' + Date.now() + '_' + Math.floor(Math.random()*100000);
        batch.set(doc(ctx.db, 'products', id), {
          name: p.name || 'Item',
          category: p.category || p.desc || 'Jeans',
          condition: 'Very good',
          price: Number(p.price) || 0,
          oldPrice: Number(p.oldPrice) || 0,
          description: p.description || '',
          stock: 1,
          status: 'available',
          sizes: Array.isArray(p.sizes) ? p.sizes : (Array.isArray(p.flavors) ? p.flavors : []),
          images: Array.isArray(p.images) ? p.images : (p.image ? [p.image] : []),
          isNew: false,
          deleted: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        count++;
      });
      await batch.commit();
    }
    ctx.toast('Imported ' + count + ' product(s).', 'success');
    await loadProducts();
    renderCurrentTab();
  } catch(e){
    ctx.toast('Import failed: ' + e.message, 'error');
  }
}

/* ============================================================
   QUICK ACTIONS (Overview)
   ============================================================ */
document.addEventListener('click', e => {
  const q = e.target.closest('[data-quick]');
  if (!q) return;
  const action = q.getAttribute('data-quick');
  if (action === 'addprod') switchTab('products');
  else if (action === 'walkin') switchTab('tools');
  else if (action === 'release') releaseExpiredHolds();
});

/* ============================================================
   HELPERS
   ============================================================ */
function customConfirm(title, text){
  return new Promise(resolve => {
    const dlg = document.getElementById('confirmDialog');
    const t = document.getElementById('confirmTitle');
    const b = document.getElementById('confirmText');
    const okBtn = document.getElementById('confirmOk');
    const noBtn = document.getElementById('confirmCancel');
    t.textContent = title;
    b.textContent = text;
    dlg.hidden = false;
    const cleanup = val => {
      dlg.hidden = true;
      okBtn.removeEventListener('click', onOk);
      noBtn.removeEventListener('click', onNo);
      resolve(val);
    };
    const onOk = () => cleanup(true);
    const onNo = () => cleanup(false);
    okBtn.addEventListener('click', onOk);
    noBtn.addEventListener('click', onNo);
  });
}
