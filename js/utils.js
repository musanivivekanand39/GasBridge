/**
 * GasBridge - Utilities & Helper Functions
 */

// Toast Notifications
export function showToast(title, message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-content">
      <div class="toast-title">${escapeHTML(title)}</div>
      <div class="toast-msg">${escapeHTML(message)}</div>
    </div>
    <button class="toast-close" aria-label="Close">&times;</button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.remove();
  });

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// HTML escape helper
export function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Currency Formatter
export function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return '₹' + num.toLocaleString('en-IN');
}

// Date & Time Formatter
export function formatDateTime(isoString) {
  if (!isoString) return 'N/A';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Generate Unique Booking ID: GB-YYYYMMDD-XXXX
export function generateBookingId() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `GB-${year}${month}${day}-${randomNum}`;
}

// Status Badges
export function getStatusBadgeHTML(status) {
  const map = {
    confirmed: { label: 'Confirmed', class: 'badge-info' },
    pending_payment: { label: 'Awaiting Payment', class: 'badge-warning' },
    processing: { label: 'Processing', class: 'badge-warning' },
    agent_assigned: { label: 'Agent Assigned', class: 'badge-info' },
    picked_up: { label: 'Picked Up', class: 'badge-warning' },
    out_for_delivery: { label: 'Out for Delivery', class: 'badge-secondary' },
    delivered: { label: 'Delivered', class: 'badge-success' },
    cancelled: { label: 'Cancelled', class: 'badge-danger' },
    paid: { label: 'Paid', class: 'badge-success' },
    cod_pending: { label: 'Cash due on delivery', class: 'badge-warning' },
    pending: { label: 'Pending', class: 'badge-warning' },
    failed: { label: 'Failed', class: 'badge-danger' }
  };

  const item = map[status] || { label: status, class: 'badge-secondary' };
  return `<span class="badge ${item.class}">${escapeHTML(item.label)}</span>`;
}

// Modal management
export function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) {
    el.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

export function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) {
    el.classList.remove('active');
    document.body.style.overflow = '';
  }
}

// 15-Minute Inactivity Auto Logout
export function initInactivityTimer(onTimeout, timeoutMinutes = 15) {
  const timeoutMs = timeoutMinutes * 60 * 1000;
  let timer;

  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      onTimeout();
    }, timeoutMs);
  };

  const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
  events.forEach(event => {
    document.addEventListener(event, resetTimer, { passive: true });
  });

  resetTimer();

  return () => {
    clearTimeout(timer);
    events.forEach(event => document.removeEventListener(event, resetTimer));
  };
}

// Google Maps Navigation URL generator
export function getGoogleMapsUrl(address) {
  if (!address) return '#';
  const parts = [
    address.houseNo,
    address.street,
    address.area,
    address.city,
    address.district,
    address.state,
    address.pincode
  ].filter(Boolean);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(', '))}`;
}

// Setup global modal close listeners on [data-close-modal]
export function initModalListeners() {
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close-modal]');
    const backdrop = e.target.classList?.contains('modal-backdrop') ? e.target : null;
    const modal = closeBtn?.closest('.modal-backdrop') || backdrop;
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  });
}
