// ==========================================
// EDIT THESE TWO LINES WITH YOUR JSONBIN CREDENTIALS
// ==========================================
const JSONBIN_BIN_ID = '6aac1335ffd5d1605312a216';
const JSONBIN_MASTER_KEY = '$2a$10$bFPLjGCZET3w56jqQ8FUjeMpkOuUbyGh05TFWq/ZxNWkfPUpS0BRi';
// ==========================================

let currentProduct = { name: '', price: 0, flavors: [] };
let currentFlavor = '';
let quantity = 1;
let editingProductId = null;
let base64Image = '';
let currentOrderMessage = '';
let currentOrderWhatsApp = '';
let bulkQueue = [];
let bulkIndex = 0;
let editingFlavors = []; // Array of flavors being edited in the form

const defaultProducts = [
    { id: 'p1', name: 'Mini Cup', price: 100, desc: 'Small & sweet, perfect for a quick treat.', image: 'https://images.unsplash.com/photo-1575224300306-1b8da36134ec?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=80', offer: 'Best Seller', flavors: ['Strawberry', 'Vanilla', 'Bubblegum'] },
    { id: 'p2', name: 'Maxi Cup', price: 159, desc: 'Bigger serving, bigger sweetness.', image: 'https://images.unsplash.com/photo-1601000938259-9e92002320b2?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=80', offer: 'Popular', flavors: ['Chocolate', 'Mango', 'Blueberry', 'Cotton Candy'] }
];

// ---- CLOUD FUNCTIONS ----
async function loadProductsFromCloud() {
    try {
        const res = await fetch('https://api.jsonbin.io/v3/b/' + JSONBIN_BIN_ID + '/latest', {
            headers: { 'X-Master-Key': JSONBIN_MASTER_KEY }
        });
        const data = await res.json();
        let products = (data.record && data.record.products) ? data.record.products : [];
        if (products.length === 0) { products = defaultProducts; await saveProductsToCloud(products); }
        localStorage.setItem('sweetHavenProducts', JSON.stringify(products));
        return products;
    } catch (e) {
        console.warn('Cloud load failed, using local cache:', e);
        return JSON.parse(localStorage.getItem('sweetHavenProducts')) || defaultProducts;
    }
}

async function saveProductsToCloud(products) {
    try {
        await fetch('https://api.jsonbin.io/v3/b/' + JSONBIN_BIN_ID, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_MASTER_KEY },
            body: JSON.stringify({ products: products })
        });
        localStorage.setItem('sweetHavenProducts', JSON.stringify(products));
    } catch (e) {
        console.warn('Cloud save failed:', e);
        localStorage.setItem('sweetHavenProducts', JSON.stringify(products));
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const products = await loadProductsFromCloud();
    renderStoreProducts(products);
    spawnCandyBackground();
    const links = document.querySelectorAll('a[href^="#"]');
    links.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            const targetElement = document.querySelector(targetId);
            if (targetElement) targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
    // Enter key adds flavor in the manager
    const flavorInput = document.getElementById('flavorInput');
    if (flavorInput) {
        flavorInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); addFlavorTag(); }
        });
    }
});

function spawnCandyBackground() {
    const bg = document.getElementById('candyBg');
    const candies = ['🍭', '🍬', '🍫', '🧁', '🍩', '🍪', '💗', '🩷', '✨'];
    for (let i = 0; i < 15; i++) {
        const el = document.createElement('div');
        el.className = 'candy-float';
        el.innerText = candies[Math.floor(Math.random() * candies.length)];
        el.style.left = Math.random() * 100 + '%';
        el.style.animationDelay = Math.random() * 15 + 's';
        el.style.animationDuration = (12 + Math.random() * 10) + 's';
        el.style.fontSize = (1.2 + Math.random() * 1.5) + 'rem';
        bg.appendChild(el);
    }
}

function getProducts() { return JSON.parse(localStorage.getItem('sweetHavenProducts')) || defaultProducts; }

function renderStoreProducts(products) {
    const grid = document.getElementById('productGrid');
    if (!products) products = getProducts();
    if (products.length === 0) { grid.innerHTML = '<p style="text-align: center; width: 100%; color: #888;">No products available right now.</p>'; return; }
    grid.innerHTML = products.map(prod => {
        const flavors = prod.flavors || [];
        return `
        <div class="product-card">
            ${prod.offer ? `<div class="badge">${prod.offer}</div>` : ''}
            <img src="${prod.image}" alt="${prod.name}" class="product-img" onerror="this.src='https://via.placeholder.com/300x200?text=Sweet+Haven'">
            <h3 class="product-title">${prod.name.toUpperCase()}</h3>
            <p class="product-desc">🍭 ${prod.desc}</p>
            ${flavors.length > 0 ? `<div class="flavor-tags">${flavors.map(f => `<span class="flavor-tag">${f}</span>`).join('')}</div>` : ''}
            <div class="product-price">KSh ${prod.price}</div>
            <button onclick="openOrderModalById('${prod.id}')" class="btn btn-order">Order Now →</button>
        </div>
        `;
    }).join('');
}

function openOrderModalById(id) {
    const products = getProducts();
    const prod = products.find(p => p.id === id);
    if (!prod) return;
    openOrderModal(prod.name, prod.price, prod.flavors || []);
}

function openOrderModal(productName, price, flavors) {
    currentProduct = { name: productName, price: price, flavors: flavors || [] };
    currentFlavor = '';
    quantity = 1;
    document.getElementById('modalProductName').value = productName;
    document.getElementById('modalQuantity').value = 1;
    document.getElementById('modalPhone').value = '';
    document.getElementById('modalDestination').value = '';
    document.getElementById('destinationGroup').style.display = 'none';
    document.querySelector('input[name="orderType"][value="Pickup"]').checked = true;

    const flavorGroup = document.getElementById('flavorGroup');
    const flavorOptions = document.getElementById('flavorOptions');
    if (flavors && flavors.length > 0) {
        flavorGroup.style.display = 'block';
        flavorOptions.innerHTML = flavors.map((f, i) => {
            const safe = f.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            return `<button type="button" class="flavor-chip" style="animation-delay:${i * 0.08}s" onclick="selectFlavor('${safe}', this)">${f}</button>`;
        }).join('');
    } else {
        flavorGroup.style.display = 'none';
        flavorOptions.innerHTML = '';
    }
    updateTotal();
    document.getElementById('orderModal').style.display = 'flex';
}

function selectFlavor(flavor, btn) {
    currentFlavor = flavor;
    document.querySelectorAll('.flavor-chip').forEach(c => c.classList.remove('selected', 'sparkling'));
    btn.classList.add('selected', 'sparkling');
    setTimeout(() => btn.classList.remove('sparkling'), 800);
}

function closeOrderModal() { document.getElementById('orderModal').style.display = 'none'; }
function changeQty(amount) { quantity += amount; if (quantity < 1) quantity = 1; document.getElementById('modalQuantity').value = quantity; updateTotal(); }
function toggleDestination() { const type = document.querySelector('input[name="orderType"]:checked').value; document.getElementById('destinationGroup').style.display = (type === 'Delivery') ? 'block' : 'none'; }
function updateTotal() { let baseTotal = currentProduct.price * quantity; document.getElementById('modalTotalPrice').innerText = (currentProduct.price === 0) ? 'To be confirmed' : 'KSh ' + baseTotal; }

function submitOrder() {
    const qty = document.getElementById('modalQuantity').value;
    const phone = document.getElementById('modalPhone').value.trim();
    const orderType = document.querySelector('input[name="orderType"]:checked').value;
    const destination = document.getElementById('modalDestination').value.trim();
    const total = currentProduct.price * qty;
    const receiptId = 'SH-' + Math.floor(1000 + Math.random() * 9000);
    if (phone === '') { alert('Please enter your phone number.'); return; }
    if (orderType === 'Delivery' && destination === '') { alert('Please enter your delivery destination.'); return; }
    if (currentProduct.flavors && currentProduct.flavors.length > 0 && !currentFlavor) { alert('Please choose your favorite flavor 🍬'); return; }

    let message = `*🧾 SWEET HAVEN ORDER*\n----------------------------\n*Order ID:* ${receiptId}\n*Customer Phone:* ${phone}\n*Item:* ${currentProduct.name}\n`;
    if (currentFlavor) message += `*Flavor:* ${currentFlavor}\n`;
    message += `*Quantity:* ${qty}\n*Order Type:* ${orderType}\n`;
    if (orderType === 'Delivery') message += `*Destination:* ${destination}\n*Delivery Fee:* To be confirmed\n`;
    if (currentProduct.price > 0) message += `*Total Amount:* KSh ${total}\n`;
    message += `----------------------------\nHello Sweet Haven! Please confirm my order 🍭`;

    let orders = JSON.parse(localStorage.getItem('sweetHavenOrders')) || [];
    orders.push({ id: receiptId, phone: phone, item: currentProduct.name, flavor: currentFlavor, qty: qty, type: orderType, destination: destination, total: total, status: 'Pending', date: new Date().toLocaleString() });
    localStorage.setItem('sweetHavenOrders', JSON.stringify(orders));

    currentOrderWhatsApp = `https://wa.me/254740503058?text=${encodeURIComponent(message)}`;
    closeOrderModal();

    // PLAY CELEBRATION ANIMATION, THEN OPEN WHATSAPP
    playPaymentCelebration();
    setTimeout(() => {
        window.open(currentOrderWhatsApp, '_blank');
    }, 2400); // opens after celebration is mostly done
}

// ============ PAYMENT CELEBRATION ============
function playPaymentCelebration() {
    const overlay = document.getElementById('paymentCelebration');
    const container = document.getElementById('confettiContainer');
    container.innerHTML = '';
    const emojis = ['🍭', '🍬', '🍫', '🧁', '🍩', '💗', '✨', '🎉', '🎊', '💖', '🩷', '🍪'];
    // Confetti falling
    for (let i = 0; i < 60; i++) {
        const c = document.createElement('div');
        c.className = 'confetti-piece';
        c.innerText = emojis[Math.floor(Math.random() * emojis.length)];
        c.style.left = Math.random() * 100 + '%';
        c.style.animationDelay = Math.random() * 1.5 + 's';
        c.style.animationDuration = (2 + Math.random() * 1.5) + 's';
        c.style.fontSize = (1.2 + Math.random() * 1.5) + 'rem';
        container.appendChild(c);
    }
    // Emoji burst around checkmark
    const burstEmojis = ['✨', '💖', '🍭', '🎉', '🍬', '💕', '⭐', '🌟'];
    burstEmojis.forEach((em, i) => {
        const b = document.createElement('div');
        b.className = 'celebration-burst';
        b.innerText = em;
        const angle = (i / burstEmojis.length) * Math.PI * 2;
        const dist = 130;
        b.style.setProperty('--bx', Math.cos(angle) * dist * 0.6 + 'px');
        b.style.setProperty('--by', Math.sin(angle) * dist * 0.6 + 'px');
        b.style.setProperty('--bx2', Math.cos(angle) * dist + 'px');
        b.style.setProperty('--by2', Math.sin(angle) * dist + 'px');
        b.style.animationDelay = '0.6s';
        document.querySelector('.celebration-center').appendChild(b);
        setTimeout(() => b.remove(), 2200);
    });
    overlay.classList.add('active');
    // Fade out after animation
    setTimeout(() => {
        overlay.classList.remove('active');
        document.getElementById('thankYouModal').style.display = 'flex';
    }, 2600);
}

function sendWhatsAppFromThankYou() { if (currentOrderWhatsApp) window.open(currentOrderWhatsApp, '_blank'); }
function closeThankYou() { document.getElementById('thankYouModal').style.display = 'none'; }

// ============ OWNER DASHBOARD ============
function showOwnerLogin() { document.getElementById('publicSite').style.display = 'none'; document.getElementById('ownerSite').style.display = 'block'; document.getElementById('ownerLoginBox').style.display = 'block'; document.getElementById('ownerDashboardBox').style.display = 'none'; window.scrollTo(0, 0); }
function loginOwner() { const pass = document.getElementById('ownerPassword').value; if (pass === 'admin123') { document.getElementById('ownerLoginBox').style.display = 'none'; document.getElementById('ownerDashboardBox').style.display = 'block'; renderOwnerOrders(); renderDashboardProducts(); } else { alert('Incorrect Password. Hint: admin123'); } }
function logoutOwner() { document.getElementById('ownerSite').style.display = 'none'; document.getElementById('publicSite').style.display = 'block'; document.getElementById('ownerPassword').value = ''; window.scrollTo(0, 0); }
function showTab(tabId) { document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none'); document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active')); document.getElementById(tabId).style.display = 'block'; document.getElementById(tabId === 'ordersTab' ? 'btnOrders' : 'btnProducts').classList.add('active'); }

// ============ FLAVOR MANAGER (Owner Form) ============
function addFlavorTag() {
    const input = document.getElementById('flavorInput');
    const val = input.value.trim();
    if (!val) return;
    if (editingFlavors.includes(val)) { alert('That flavor is already added.'); return; }
    editingFlavors.push(val);
    input.value = '';
    input.focus();
    renderFlavorTags();
}

function removeFlavorTag(index) {
    editingFlavors.splice(index, 1);
    renderFlavorTags();
}

function renderFlavorTags() {
    const list = document.getElementById('flavorManagerList');
    if (!list) return;
    if (editingFlavors.length === 0) {
        list.innerHTML = '<small style="color: #bbb; font-style: italic;">No flavors added yet</small>';
        return;
    }
    list.innerHTML = editingFlavors.map((f, i) =>
        `<span class="flavor-manager-tag">${f}<button type="button" onclick="removeFlavorTag(${i})" title="Remove">×</button></span>`
    ).join('');
}

// ============ ORDERS ============
function formatKenyanPhone(phone) {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) return '254' + cleaned.substring(1);
    if (cleaned.startsWith('254')) return cleaned;
    if (cleaned.length === 9) return '254' + cleaned;
    return cleaned;
}

function renderOwnerOrders() {
    const tbody = document.getElementById('ordersTableBody');
    let orders = JSON.parse(localStorage.getItem('sweetHavenOrders')) || [];
    let totalRevenue = 0, pendingCount = 0;
    if (orders.length === 0) { tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; color: #888; padding: 20px;">No orders yet.</td></tr>'; }
    else {
        tbody.innerHTML = orders.map((order, index) => {
            if(order.status === 'Pending') pendingCount++;
            totalRevenue += parseInt(order.total) || 0;
            const statusClass = order.status === 'Pending' ? 'status-pending' : (order.status === 'Confirmed' ? 'status-confirmed' : 'status-completed');
            return `<tr>
                <td><input type="checkbox" class="order-checkbox" data-index="${index}"></td>
                <td>${order.date}</td>
                <td><strong>${order.id}</strong></td>
                <td><strong>${order.phone}</strong></td>
                <td>${order.item}</td>
                <td>${order.flavor || '—'}</td>
                <td>${order.qty}</td>
                <td>${order.type}</td>
                <td>KSh ${order.total}</td>
                <td><span class="status-badge ${statusClass}">${order.status}</span></td>
                <td>
                    <button class="action-btn blue" onclick="sendStatusMsg(${index}, 'Pending')">📩 Pending</button>
                    <button class="action-btn green" onclick="sendStatusMsg(${index}, 'Confirmed')">✅ Received</button>
                    <button class="action-btn" onclick="markCompleted(${index})">🎉 Completed</button>
                </td>
            </tr>`;
        }).join('');
    }
    document.getElementById('statRevenue').innerText = 'KSh ' + totalRevenue;
    document.getElementById('statOrders').innerText = orders.length;
    document.getElementById('statPending').innerText = pendingCount;
}

function buildPendingMessage(order) { return `Hi! 👋 Thank you for your order at *Sweet Haven* 🍭\n\n*Order ID:* ${order.id}\n*Item:* ${order.item}${order.flavor ? ' (' + order.flavor + ')' : ''} (x${order.qty})\n*Total:* KSh ${order.total}\n\n⏳ Your order is currently being reviewed. We'll notify you once it's confirmed. Please wait a moment! 💕`; }
function buildConfirmedMessage(order) { return `Hi! 👋 Great news from *Sweet Haven* 🍭\n\n*Order ID:* ${order.id}\n*Item:* ${order.item}${order.flavor ? ' (' + order.flavor + ')' : ''} (x${order.qty})\n*Total:* KSh ${order.total}\n\n✅ We have *received* your order and it's been confirmed! We'll update you once it's on the way. Thank you! 💕`; }
function buildCompletedMessage(order) { return `Hi! 👋 Thank you so much for choosing *Sweet Haven* 🍭💕\n\nYour order *${order.id}* has been *completed*. We hope you enjoy your cotton candy! 🍬✨\n\nWe'd love it if you could share your experience with us on TikTok or Instagram. See you again soon! 🎉`; }

function sendStatusMsg(index, statusType) {
    let orders = JSON.parse(localStorage.getItem('sweetHavenOrders')) || [];
    const order = orders[index];
    if (!order) return;
    const phone = formatKenyanPhone(order.phone);
    let message = '';
    if (statusType === 'Pending') { message = buildPendingMessage(order); }
    else if (statusType === 'Confirmed') {
        message = buildConfirmedMessage(order);
        orders[index].status = 'Confirmed';
        localStorage.setItem('sweetHavenOrders', JSON.stringify(orders));
        renderOwnerOrders();
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
}

function markCompleted(index) {
    let orders = JSON.parse(localStorage.getItem('sweetHavenOrders')) || [];
    if(orders[index]) {
        orders[index].status = 'Completed';
        localStorage.setItem('sweetHavenOrders', JSON.stringify(orders));
        renderOwnerOrders();
        const phone = formatKenyanPhone(orders[index].phone);
        const message = buildCompletedMessage(orders[index]);
        if (confirm('Order marked as Completed. Send a thank-you message to the customer on WhatsApp?')) {
            window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
        }
    }
}

function toggleSelectAll(checkbox) { document.querySelectorAll('.order-checkbox').forEach(cb => cb.checked = checkbox.checked); }

function bulkSendPending() {
    const selected = document.querySelectorAll('.order-checkbox:checked');
    if (selected.length === 0) { alert('Please select at least one order.'); return; }
    let orders = JSON.parse(localStorage.getItem('sweetHavenOrders')) || [];
    bulkQueue = [];
    selected.forEach(cb => { const index = parseInt(cb.dataset.index); if (orders[index]) bulkQueue.push(orders[index]); });
    if (bulkQueue.length === 0) { alert('No valid orders found.'); return; }
    bulkIndex = 0;
    document.getElementById('bulkPanel').style.display = 'block';
    updateBulkPanel();
}

function updateBulkPanel() {
    const total = bulkQueue.length;
    const done = bulkIndex;
    const percent = total > 0 ? (done / total) * 100 : 0;
    document.getElementById('bulkProgressBar').style.width = percent + '%';
    if (done >= total) {
        document.getElementById('bulkProgressText').innerText = `✅ All ${total} messages sent!`;
        document.getElementById('bulkCurrentOrder').innerHTML = '<strong>Done!</strong> You can close this panel now.';
        const btn = document.getElementById('bulkNextBtn');
        btn.innerText = 'Close';
        btn.onclick = closeBulkPanel;
        document.getElementById('selectAllOrders').checked = false;
        document.querySelectorAll('.order-checkbox').forEach(cb => cb.checked = false);
        return;
    }
    const order = bulkQueue[done];
    document.getElementById('bulkProgressText').innerText = `Sending ${done + 1} of ${total}`;
    document.getElementById('bulkCurrentOrder').innerHTML = `<strong>${order.id}</strong><br>📞 ${order.phone}<br>🍭 ${order.item}${order.flavor ? ' (' + order.flavor + ')' : ''} (x${order.qty})<br>💰 KSh ${order.total}`;
    const btn = document.getElementById('bulkNextBtn');
    btn.innerText = done === 0 ? 'Send to First Customer →' : `Send to Customer ${done + 1} →`;
    btn.onclick = sendNextInQueue;
}

function sendNextInQueue() {
    if (bulkIndex >= bulkQueue.length) { closeBulkPanel(); return; }
    const order = bulkQueue[bulkIndex];
    const phone = formatKenyanPhone(order.phone);
    const message = buildPendingMessage(order);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
    bulkIndex++;
    updateBulkPanel();
}

function closeBulkPanel() { document.getElementById('bulkPanel').style.display = 'none'; bulkQueue = []; bulkIndex = 0; }

function exportCSV() {
    let orders = JSON.parse(localStorage.getItem('sweetHavenOrders')) || [];
    if (orders.length === 0) { alert('No orders to export.'); return; }
    let totalRevenue = 0, pending = 0, confirmed = 0, completed = 0;
    let pickupCount = 0, deliveryCount = 0, deliveryTotal = 0;
    let itemTotals = {};
    orders.forEach(function(order) {
        const amt = parseFloat(order.total) || 0;
        totalRevenue += amt;
        if (order.status === 'Pending') pending++; else if (order.status === 'Confirmed') confirmed++; else if (order.status === 'Completed') completed++;
        if (order.type === 'Delivery') { deliveryCount++; deliveryTotal += amt; } else pickupCount++;
        const key = order.item + (order.flavor ? ' (' + order.flavor + ')' : '');
        if (!itemTotals[key]) itemTotals[key] = { qty: 0, revenue: 0 };
        itemTotals[key].qty += parseInt(order.qty) || 0;
        itemTotals[key].revenue += amt;
    });
    const today = new Date().toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' });
    let csv = '\uFEFF';
    csv += 'SWEET HAVEN - SALES REPORT\n';
    csv += 'Report Generated,' + today + '\n';
    csv += 'Business Location,"Bungoma Town, Kenya"\n';
    csv += 'Contact,0740 503 058\n\n';
    csv += 'FINANCIAL SUMMARY\nMetric,Value\n';
    csv += 'Total Revenue (KSh),' + totalRevenue.toFixed(2) + '\n';
    csv += 'Total Orders,' + orders.length + '\n';
    csv += 'Average Order Value (KSh),' + (orders.length > 0 ? (totalRevenue / orders.length).toFixed(2) : '0.00') + '\n\n';
    csv += 'ORDER STATUS BREAKDOWN\nStatus,Count\nPending,' + pending + '\nConfirmed,' + confirmed + '\nCompleted,' + completed + '\n\n';
    csv += 'ORDER TYPE BREAKDOWN\nType,Count,Revenue (KSh)\nPickup,' + pickupCount + ',' + (totalRevenue - deliveryTotal).toFixed(2) + '\nDelivery,' + deliveryCount + ',' + deliveryTotal.toFixed(2) + '\n\n';
    csv += 'SALES BY PRODUCT & FLAVOR\nProduct,Quantity Sold,Revenue (KSh)\n';
    Object.keys(itemTotals).forEach(function(item) { csv += '"' + item + '",' + itemTotals[item].qty + ',' + itemTotals[item].revenue.toFixed(2) + '\n'; });
    csv += '\nITEMIZED ORDERS\nDate,Order ID,Customer Phone,Item,Flavor,Quantity,Order Type,Delivery Destination,Unit Price (KSh),Total (KSh),Status\n';
    orders.forEach(function(order) {
        const unitPrice = order.qty > 0 ? (parseFloat(order.total) / parseInt(order.qty)).toFixed(2) : '0.00';
        csv += ['"' + order.date + '"', '"' + order.id + '"', '"' + order.phone + '"', '"' + order.item + '"', '"' + (order.flavor || 'N/A') + '"', order.qty, order.type, '"' + (order.destination || 'N/A') + '"', unitPrice, parseFloat(order.total).toFixed(2), order.status].join(',') + '\n';
    });
    csv += '\nGRAND TOTAL,' + totalRevenue.toFixed(2) + '\n\nGenerated by JENGA WEB - We build, you grow.\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const fileDate = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', 'Sweet_Haven_Sales_Report_' + fileDate + '.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

function renderDashboardProducts() {
    const container = document.getElementById('dashboardProductList');
    const products = getProducts();
    if (products.length === 0) { container.innerHTML = '<p style="color: #888;">No products added yet.</p>'; return; }
    container.innerHTML = products.map(prod => `
        <div class="dash-product-item">
            <img src="${prod.image}" alt="${prod.name}" onerror="this.src='https://via.placeholder.com/60?text=No+Img'">
            <div class="dash-product-info">
                <h4>${prod.name} - KSh ${prod.price}</h4>
                <p>${prod.desc} ${prod.offer ? `| <strong>${prod.offer}</strong>` : ''}</p>
                ${prod.flavors && prod.flavors.length > 0 ? `<div style="margin-top: 6px;">${prod.flavors.map(f => `<span class="flavor-manager-tag" style="font-size: 0.65rem; padding: 4px 8px;">${f}</span>`).join(' ')}</div>` : ''}
            </div>
            <div class="dash-actions"><button class="btn-icon edit" onclick="editProduct('${prod.id}')">✏️</button><button class="btn-icon delete" onclick="deleteProduct('${prod.id}')">🗑️</button></div>
        </div>
    `).join('');
}

function previewImage(event) { const reader = new FileReader(); reader.onload = function(){ const output = document.getElementById('imagePreview'); output.src = reader.result; output.style.display = 'block'; base64Image = reader.result; }; if(event.target.files[0]) reader.readAsDataURL(event.target.files[0]); }

async function saveProduct() {
    const name = document.getElementById('prodName').value.trim();
    const price = document.getElementById('prodPrice').value.trim();
    const desc = document.getElementById('prodDesc').value.trim();
    const offer = document.getElementById('prodOffer').value.trim();
    if (!name || !price) { alert('Please enter at least a product name and price.'); return; }
    let products = getProducts();
    let imageUrl = base64Image;
    if (!imageUrl) { if (editingProductId) { const existing = products.find(p => p.id === editingProductId); if (existing) imageUrl = existing.image; } else { imageUrl = 'https://via.placeholder.com/300x200?text=Sweet+Haven'; } }
    if (editingProductId) {
        const index = products.findIndex(p => p.id === editingProductId);
        if (index !== -1) { products[index] = { ...products[index], name, price: Number(price), desc, offer, flavors: [...editingFlavors], image: imageUrl }; }
    }
    else { const newId = 'p' + Date.now(); products.push({ id: newId, name, price: Number(price), desc, offer, flavors: [...editingFlavors], image: imageUrl }); }
    await saveProductsToCloud(products);
    clearForm(); renderDashboardProducts(); renderStoreProducts(products);
    alert('✅ Product saved to cloud! Customers will see this update.');
}

function editProduct(id) {
    const products = getProducts(); const prod = products.find(p => p.id === id); if (!prod) return;
    editingProductId = id;
    document.getElementById('formTitle').innerText = 'Edit Product';
    document.getElementById('prodName').value = prod.name; document.getElementById('prodPrice').value = prod.price;
    document.getElementById('prodDesc').value = prod.desc; document.getElementById('prodOffer').value = prod.offer || '';
    editingFlavors = [...(prod.flavors || [])];
    renderFlavorTags();
    const preview = document.getElementById('imagePreview'); preview.src = prod.image; preview.style.display = 'block'; base64Image = '';
    document.querySelector('.manager-form').scrollIntoView({ behavior: 'smooth' });
}

async function deleteProduct(id) {
    if (!confirm('Are you sure you want to delete this product?')) return;
    let products = getProducts(); products = products.filter(p => p.id !== id);
    await saveProductsToCloud(products);
    renderDashboardProducts(); renderStoreProducts(products);
    alert('✅ Product deleted from cloud!');
}

function clearForm() {
    editingProductId = null;
    editingFlavors = [];
    document.getElementById('formTitle').innerText = 'Add New Product';
    document.getElementById('prodName').value = ''; document.getElementById('prodPrice').value = '';
    document.getElementById('prodDesc').value = ''; document.getElementById('prodOffer').value = '';
    document.getElementById('flavorInput').value = '';
    document.getElementById('prodImage').value = ''; document.getElementById('imagePreview').style.display = 'none';
    renderFlavorTags();
    base64Image = '';
}

// Initialize flavor tag list on load
document.addEventListener('DOMContentLoaded', () => {
    const list = document.getElementById('flavorManagerList');
    if (list) renderFlavorTags();
});
