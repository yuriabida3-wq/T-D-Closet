let currentProduct = { name: '', price: 0 };
let quantity = 1;
let editingProductId = null;
let base64Image = '';
let currentOrderMessage = '';
let currentOrderWhatsApp = '';

// Bulk sending queue
let bulkQueue = [];
let bulkIndex = 0;

const defaultProducts = [
    { id: 'p1', name: 'Mini Cup', price: 100, desc: 'Small & sweet, perfect for a quick treat.', image: 'https://images.unsplash.com/photo-1575224300306-1b8da36134ec?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=80', offer: 'Best Seller' },
    { id: 'p2', name: 'Maxi Cup', price: 159, desc: 'Bigger serving, bigger sweetness.', image: 'https://images.unsplash.com/photo-1601000938259-9e92002320b2?ixlib=rb-1.2.1&auto=format&fit=crop&w=500&q=80', offer: 'Popular' }
];

document.addEventListener('DOMContentLoaded', () => {
    if (!localStorage.getItem('sweetHavenProducts')) {
        localStorage.setItem('sweetHavenProducts', JSON.stringify(defaultProducts));
    }
    renderStoreProducts();
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
});

function spawnCandyBackground() {
    const bg = document.getElementById('candyBg');
    const candies = ['🍭', '🍬', '🍫', '🧁', '🍩', '🍪', '💗', '🩷'];
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

function getProducts() { return JSON.parse(localStorage.getItem('sweetHavenProducts')) || []; }

function renderStoreProducts() {
    const grid = document.getElementById('productGrid');
    const products = getProducts();
    if (products.length === 0) { grid.innerHTML = '<p style="text-align: center; width: 100%; color: #888;">No products available right now.</p>'; return; }
    grid.innerHTML = products.map(prod => `
        <div class="product-card">
            ${prod.offer ? `<div class="badge">${prod.offer}</div>` : ''}
            <img src="${prod.image}" alt="${prod.name}" class="product-img" onerror="this.src='https://via.placeholder.com/300x200?text=Sweet+Haven'">
            <h3 class="product-title">${prod.name.toUpperCase()}</h3>
            <p class="product-desc">🍭 ${prod.desc}</p>
            <div class="product-price">KSh ${prod.price}</div>
            <button onclick="openOrderModal('${prod.name.replace(/'/g, "\\'")}', ${prod.price})" class="btn btn-order">Order Now →</button>
        </div>
    `).join('');
}

function openOrderModal(productName, price) {
    currentProduct = { name: productName, price: price };
    quantity = 1;
    document.getElementById('modalProductName').value = productName;
    document.getElementById('modalQuantity').value = 1;
    document.getElementById('modalPhone').value = '';
    document.getElementById('modalDestination').value = '';
    document.getElementById('destinationGroup').style.display = 'none';
    document.querySelector('input[name="orderType"][value="Pickup"]').checked = true;
    updateTotal();
    document.getElementById('orderModal').style.display = 'flex';
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

    let message = `*🧾 SWEET HAVEN ORDER*\n----------------------------\n*Order ID:* ${receiptId}\n*Customer Phone:* ${phone}\n*Item:* ${currentProduct.name}\n*Quantity:* ${qty}\n*Order Type:* ${orderType}\n`;
    if (orderType === 'Delivery') message += `*Destination:* ${destination}\n*Delivery Fee:* To be confirmed\n`;
    if (currentProduct.price > 0) message += `*Total Amount:* KSh ${total}\n`;
    message += `----------------------------\nHello Sweet Haven! Please confirm my order 🍭`;

    let orders = JSON.parse(localStorage.getItem('sweetHavenOrders')) || [];
    orders.push({ id: receiptId, phone: phone, item: currentProduct.name, qty: qty, type: orderType, destination: destination, total: total, status: 'Pending', date: new Date().toLocaleString() });
    localStorage.setItem('sweetHavenOrders', JSON.stringify(orders));

    currentOrderMessage = message;
    currentOrderWhatsApp = `https://wa.me/254740503058?text=${encodeURIComponent(message)}`;
    closeOrderModal();
    showThankYou({ id: receiptId, item: currentProduct.name, qty: qty, type: orderType, total: total, destination: destination });
}

function showThankYou(order) {
    const summary = document.getElementById('thankYouSummary');
    summary.innerHTML = `<strong>Order ID:</strong> ${order.id}<br><strong>Item:</strong> ${order.item}<br><strong>Quantity:</strong> ${order.qty}<br><strong>Type:</strong> ${order.type}${order.destination ? '<br><strong>Destination:</strong> ' + order.destination : ''}<br><strong>Total:</strong> KSh ${order.total}`;
    const rain = document.getElementById('candyRain');
    rain.innerHTML = '';
    const candies = ['🍭', '🍬', '🍫', '🧁', '🍩', '💗', '✨', '🎉'];
    for (let i = 0; i < 20; i++) {
        const c = document.createElement('div');
        c.className = 'candy-fall';
        c.innerText = candies[Math.floor(Math.random() * candies.length)];
        c.style.left = Math.random() * 100 + '%';
        c.style.animationDelay = Math.random() * 2 + 's';
        c.style.animationDuration = (2 + Math.random() * 2) + 's';
        rain.appendChild(c);
    }
    document.getElementById('thankYouModal').style.display = 'flex';
}

function sendWhatsAppFromThankYou() { if (currentOrderWhatsApp) window.open(currentOrderWhatsApp, '_blank'); }
function closeThankYou() { document.getElementById('thankYouModal').style.display = 'none'; }

function showOwnerLogin() { document.getElementById('publicSite').style.display = 'none'; document.getElementById('ownerSite').style.display = 'block'; document.getElementById('ownerLoginBox').style.display = 'block'; document.getElementById('ownerDashboardBox').style.display = 'none'; window.scrollTo(0, 0); }
function loginOwner() { const pass = document.getElementById('ownerPassword').value; if (pass === 'admin123') { document.getElementById('ownerLoginBox').style.display = 'none'; document.getElementById('ownerDashboardBox').style.display = 'block'; renderOwnerOrders(); renderDashboardProducts(); } else { alert('Incorrect Password. Hint: admin123'); } }
function logoutOwner() { document.getElementById('ownerSite').style.display = 'none'; document.getElementById('publicSite').style.display = 'block'; document.getElementById('ownerPassword').value = ''; window.scrollTo(0, 0); }
function showTab(tabId) { document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none'); document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active')); document.getElementById(tabId).style.display = 'block'; document.getElementById(tabId === 'ordersTab' ? 'btnOrders' : 'btnProducts').classList.add('active'); }

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
    if (orders.length === 0) { tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: #888; padding: 20px;">No orders yet.</td></tr>'; } 
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

function buildPendingMessage(order) {
    return `Hi! 👋 Thank you for your order at *Sweet Haven* 🍭\n\n*Order ID:* ${order.id}\n*Item:* ${order.item} (x${order.qty})\n*Total:* KSh ${order.total}\n\n⏳ Your order is currently being reviewed. We'll notify you once it's confirmed. Please wait a moment! 💕`;
}

function buildConfirmedMessage(order) {
    return `Hi! 👋 Great news from *Sweet Haven* 🍭\n\n*Order ID:* ${order.id}\n*Item:* ${order.item} (x${order.qty})\n*Total:* KSh ${order.total}\n\n✅ We have *received* your order and it's been confirmed! We'll update you once it's on the way. Thank you! 💕`;
}

function buildCompletedMessage(order) {
    return `Hi! 👋 Thank you so much for choosing *Sweet Haven* 🍭💕\n\nYour order *${order.id}* has been *completed*. We hope you enjoy your cotton candy! 🍬✨\n\nWe'd love it if you could share your experience with us on TikTok or Instagram. See you again soon! 🎉`;
}

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

function toggleSelectAll(checkbox) {
    document.querySelectorAll('.order-checkbox').forEach(cb => cb.checked = checkbox.checked);
}

// --- SEQUENTIAL BULK SENDER ---
function bulkSendPending() {
    const selected = document.querySelectorAll('.order-checkbox:checked');
    if (selected.length === 0) { alert('Please select at least one order.'); return; }
    
    let orders = JSON.parse(localStorage.getItem('sweetHavenOrders')) || [];
    bulkQueue = [];
    selected.forEach(cb => {
        const index = parseInt(cb.dataset.index);
        if (orders[index]) bulkQueue.push(orders[index]);
    });
    
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
    document.getElementById('bulkCurrentOrder').innerHTML = `<strong>${order.id}</strong><br>📞 ${order.phone}<br>🍭 ${order.item} (x${order.qty})<br>💰 KSh ${order.total}`;
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

function closeBulkPanel() {
    document.getElementById('bulkPanel').style.display = 'none';
    bulkQueue = [];
    bulkIndex = 0;
}

function exportCSV() {
    let orders = JSON.parse(localStorage.getItem('sweetHavenOrders')) || [];
    if (orders.length === 0) { alert('No orders to export.'); return; }
    let csvContent = "data:text/csv;charset=utf-8,Date,Order ID,Customer Phone,Item,Quantity,Type,Destination,Total (KSh),Status\n";
    orders.forEach(function(order) { csvContent += [`"${order.date}"`, `"${order.id}"`, `"${order.phone}"`, `"${order.item}"`, `"${order.qty}"`, `"${order.type}"`, `"${order.destination || 'N/A'}"`, `"${order.total}"`, `"${order.status}"`].join(",") + "\r\n"; });
    const link = document.createElement("a"); link.setAttribute("href", encodeURI(csvContent)); link.setAttribute("download", "Sweet_Haven_Sales_Report.csv"); document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

function renderDashboardProducts() {
    const container = document.getElementById('dashboardProductList');
    const products = getProducts();
    if (products.length === 0) { container.innerHTML = '<p style="color: #888;">No products added yet.</p>'; return; }
    container.innerHTML = products.map(prod => `
        <div class="dash-product-item">
            <img src="${prod.image}" alt="${prod.name}" onerror="this.src='https://via.placeholder.com/60?text=No+Img'">
            <div class="dash-product-info"><h4>${prod.name} - KSh ${prod.price}</h4><p>${prod.desc} ${prod.offer ? `| <strong>${prod.offer}</strong>` : ''}</p></div>
            <div class="dash-actions"><button class="btn-icon edit" onclick="editProduct('${prod.id}')">✏️</button><button class="btn-icon delete" onclick="deleteProduct('${prod.id}')">🗑️</button></div>
        </div>
    `).join('');
}
function previewImage(event) { const reader = new FileReader(); reader.onload = function(){ const output = document.getElementById('imagePreview'); output.src = reader.result; output.style.display = 'block'; base64Image = reader.result; }; if(event.target.files[0]) reader.readAsDataURL(event.target.files[0]); }
function saveProduct() {
    const name = document.getElementById('prodName').value.trim();
    const price = document.getElementById('prodPrice').value.trim();
    const desc = document.getElementById('prodDesc').value.trim();
    const offer = document.getElementById('prodOffer').value.trim();
    if (!name || !price) { alert('Please enter at least a product name and price.'); return; }
    let products = getProducts();
    let imageUrl = base64Image;
    if (!imageUrl) { if (editingProductId) { const existing = products.find(p => p.id === editingProductId); if (existing) imageUrl = existing.image; } else { imageUrl = 'https://via.placeholder.com/300x200?text=Sweet+Haven'; } }
    if (editingProductId) { const index = products.findIndex(p => p.id === editingProductId); if (index !== -1) { products[index] = { ...products[index], name, price: Number(price), desc, offer, image: imageUrl }; } } 
    else { const newId = 'p' + Date.now(); products.push({ id: newId, name, price: Number(price), desc, offer, image: imageUrl }); }
    localStorage.setItem('sweetHavenProducts', JSON.stringify(products));
    clearForm(); renderDashboardProducts(); renderStoreProducts(); alert('Product saved successfully!');
}
function editProduct(id) {
    const products = getProducts(); const prod = products.find(p => p.id === id); if (!prod) return;
    editingProductId = id; document.getElementById('formTitle').innerText = 'Edit Product';
    document.getElementById('prodName').value = prod.name; document.getElementById('prodPrice').value = prod.price;
    document.getElementById('prodDesc').value = prod.desc; document.getElementById('prodOffer').value = prod.offer || '';
    const preview = document.getElementById('imagePreview'); preview.src = prod.image; preview.style.display = 'block'; base64Image = '';
    document.querySelector('.manager-form').scrollIntoView({ behavior: 'smooth' });
}
function deleteProduct(id) {
    if (!confirm('Are you sure you want to delete this product?')) return;
    let products = getProducts(); products = products.filter(p => p.id !== id);
    localStorage.setItem('sweetHavenProducts', JSON.stringify(products));
    renderDashboardProducts(); renderStoreProducts();
}
function clearForm() {
    editingProductId = null; document.getElementById('formTitle').innerText = 'Add New Product';
    document.getElementById('prodName').value = ''; document.getElementById('prodPrice').value = '';
    document.getElementById('prodDesc').value = ''; document.getElementById('prodOffer').value = '';
    document.getElementById('prodImage').value = ''; document.getElementById('imagePreview').style.display = 'none';
    base64Image = '';
}
