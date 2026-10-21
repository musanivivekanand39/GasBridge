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
    refunded: { label: 'Refunded', class: 'badge-warning' },
    cod_pending: { label: 'Cash due on delivery', class: 'badge-warning' },
    pending: { label: 'Pending', class: 'badge-warning' },
    failed: { label: 'Failed', class: 'badge-danger' }
  };

  const item = map[status] || { label: status, class: 'badge-secondary' };
  return `<span class="badge table-status-badge ${item.class}">${escapeHTML(item.label)}</span>`;
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
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(parts.join(', '))}&travelmode=driving&dir_action=navigate`;
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

/**
 * --------------------------------------------------------------------------
 * Standard Input Validation Suite
 * --------------------------------------------------------------------------
 */

// Name: Only letters and spaces, minimum 3 characters
export function validateName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'Name is required.';
  if (!/^[A-Za-z\s]+$/.test(trimmed)) {
    return 'Name must contain only letters and spaces.';
  }
  if (trimmed.length < 3) {
    return 'Name must be at least 3 characters long.';
  }
  return '';
}

// Email: Must follow a valid email format
export function validateEmail(email) {
  const trimmed = String(email || '').trim();
  if (!trimmed) return 'Email address is required.';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return 'Please enter a valid email address.';
  }
  return '';
}

// Mobile Number: Exactly 10 digits and must start with 6, 7, 8, or 9
export function validateMobile(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  if (!digits) return 'Mobile number is required.';
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return 'Mobile number must be exactly 10 digits and start with 6, 7, 8, or 9.';
  }
  return '';
}

// Password: Minimum 8 characters, at least 1 uppercase, 1 lowercase, 1 number, 1 special char
export function validatePassword(password) {
  const pass = String(password || '');
  if (!pass) return 'Password is required.';
  if (pass.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[A-Z]/.test(pass)) {
    return 'Password must contain at least one uppercase letter (A-Z).';
  }
  if (!/[a-z]/.test(pass)) {
    return 'Password must contain at least one lowercase letter (a-z).';
  }
  if (!/[0-9]/.test(pass)) {
    return 'Password must contain at least one number (0-9).';
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pass)) {
    return 'Password must contain at least one special character (!@#$%^&* etc.).';
  }
  return '';
}

// Confirm Password: Must match password
export function validateConfirmPassword(password, confirmPassword) {
  if (!confirmPassword) return 'Please confirm your password.';
  if (password !== confirmPassword) {
    return 'Passwords do not match.';
  }
  return '';
}

// Username: Allow letters, numbers, and underscores
export function validateUsername(username) {
  const trimmed = String(username || '').trim();
  if (!trimmed) return 'Username is required.';
  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) {
    return 'Username can only contain letters, numbers, and underscores.';
  }
  if (trimmed.length < 3) {
    return 'Username must be at least 3 characters long.';
  }
  return '';
}

// Address: Must not be empty when required
export function validateAddress(address) {
  const trimmed = String(address || '').trim();
  if (!trimmed) return 'Address is required.';
  if (trimmed.length < 5) return 'Please enter a complete address.';
  return '';
}

// PIN: Exactly 4 digits wherever a 4-digit PIN is required
export function validatePin4(pin) {
  const trimmed = String(pin || '').trim();
  if (!trimmed) return 'PIN is required.';
  if (!/^\d{4}$/.test(trimmed)) {
    return 'PIN must be exactly 4 digits.';
  }
  return '';
}

// OTP: Validate according to authentication requirements (typically 6-digit numeric)
export function validateOtp(otp, length = 6) {
  const trimmed = String(otp || '').trim();
  if (!trimmed) return 'OTP is required.';
  const regex = new RegExp(`^\\d{${length}}$`);
  if (!regex.test(trimmed)) {
    return `OTP must be exactly ${length} digits.`;
  }
  return '';
}

// Helper to attach or display inline field errors
export function setFieldValidation(inputEl, errorElOrId, errorMessage) {
  const errorEl = typeof errorElOrId === 'string' ? document.getElementById(errorElOrId) : errorElOrId;
  if (inputEl) {
    if (errorMessage) {
      inputEl.classList.add('input-error');
      inputEl.setAttribute('aria-invalid', 'true');
    } else {
      inputEl.classList.remove('input-error');
      inputEl.removeAttribute('aria-invalid');
    }
  }
  if (errorEl) {
    if (errorMessage) {
      errorEl.textContent = errorMessage;
      errorEl.classList.add('active');
      errorEl.style.display = 'block';
    } else {
      errorEl.textContent = '';
      errorEl.classList.remove('active');
      errorEl.style.display = 'none';
    }
  }
}
