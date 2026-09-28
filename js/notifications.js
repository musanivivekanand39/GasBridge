/**
 * GasBridge - Notifications & Real-Time Alert System
 * Supports In-App Notifications, truthful SMS status, and Email fallbacks.
 * Adheres strictly to requirements:
 * - Do NOT fake SMS or Email delivery.
 * - If SMS provider is not configured, clearly log/display: "SMS provider configuration required."
 * - Never send passwords in notifications.
 */

import { getCurrentUser } from "./auth.js";
import { 
  getNotifications, 
  markNotificationRead, 
  createNotification 
} from "./firestore.js";
import { formatDateTime, escapeHTML, showToast } from "./utils.js";

// Check if external SMS / Email services are configured
export const NOTIFICATION_CONFIG = {
  smsProviderConfigured: false, // Set to true when backend SMS API webhook/secret is integrated
  emailServiceConfigured: false // Set to true when backend SMTP/SendGrid/SES webhook is integrated
};

/**
 * Dispatch an approval notification to a recipient user.
 * Tries SMS (preferred) -> Email (fallback) -> In-App (always saved).
 */
export async function sendApprovalNotification({
  recipientUserId,
  recipientMobile = "",
  recipientEmail = "",
  recipientRole,
  type = "approval", // "distributor_approval" | "customer_approval" | "agent_approval"
  title,
  message,
  link = ""
}) {
  const timestamp = new Date().toISOString();
  const results = {
    inApp: false,
    smsStatus: "unconfigured",
    emailStatus: "unconfigured"
  };

  // 1. Always record in-app notification in Firestore / storage
  try {
    await createNotification(
      recipientUserId,
      recipientRole,
      title,
      message,
      link,
      "in_app",
      "sent"
    );
    results.inApp = true;
  } catch (err) {
    console.warn("Error creating in-app notification:", err);
  }

  // 2. Preferred: SMS Notification
  if (NOTIFICATION_CONFIG.smsProviderConfigured && recipientMobile) {
    results.smsStatus = "SMS Provider Integration Required";
    await createNotification(
      recipientUserId,
      recipientRole,
      title,
      message,
      link,
      "sms",
      "pending",
      "SMS provider is marked configured but no sending integration exists."
    );
  } else {
    // Truthfully record unconfigured status - DO NOT FAKE SMS (Rule 5, 9, 15, 36, 48)
    results.smsStatus = "SMS Provider Configuration Required";
    await createNotification(
      recipientUserId,
      recipientRole,
      title,
      message,
      link,
      "sms",
      "pending",
      "SMS Provider Integration Required"
    );
  }

  // 3. Secondary: Email Notification
  if (NOTIFICATION_CONFIG.emailServiceConfigured && recipientEmail) {
    results.emailStatus = "Email Provider Integration Required";
    await createNotification(
      recipientUserId,
      recipientRole,
      title,
      message,
      link,
      "email",
      "pending",
      "Email provider is marked configured but no sending integration exists."
    );
  } else {
    // Truthfully record unconfigured status - DO NOT FAKE EMAIL (Rule 37)
    results.emailStatus = "Email Service Configuration Required";
    await createNotification(
      recipientUserId,
      recipientRole,
      title,
      message,
      link,
      "email",
      "pending",
      "Email Provider Integration Required"
    );
  }

  return results;
}

/**
 * Initialize Notification Dropdown UI in topbar
 */
export function initNotificationsUI() {
  const user = getCurrentUser();
  if (!user) return;

  const wrapper = document.querySelector('.notification-wrapper');
  if (!wrapper) return;

  wrapper.innerHTML = `
    <button class="notification-btn" id="notif-btn" aria-label="Notifications" title="Notifications">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </svg>
      <span class="notification-badge-count" id="notif-badge" style="display: none;">0</span>
    </button>
    <div class="notification-dropdown" id="notif-dropdown">
      <div class="notification-header">
        <h4>Notifications</h4>
        <button class="btn btn-sm btn-outline" id="mark-all-read-btn" style="font-size: 0.72rem; padding: 0.2rem 0.5rem;">Mark all read</button>
      </div>
      <div class="notification-list" id="notif-list">
        <div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
          Loading notifications...
        </div>
      </div>
    </div>
  `;

  const btn = document.getElementById('notif-btn');
  const dropdown = document.getElementById('notif-dropdown');
  const markAllBtn = document.getElementById('mark-all-read-btn');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('active');
  });

  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      dropdown.classList.remove('active');
    }
  });

  markAllBtn.addEventListener('click', async () => {
    const list = await getNotifications(user.uid, user.role);
    for (const item of list) {
      if (!item.read) await markNotificationRead(item.id);
    }
    await refreshNotifications(user);
  });

  refreshNotifications(user);
}

export async function refreshNotifications(user) {
  if (!user) return;
  const listEl = document.getElementById('notif-list');
  const badgeEl = document.getElementById('notif-badge');
  if (!listEl || !badgeEl) return;

  const notifs = await getNotifications(user.uid, user.role);
  const unreadCount = notifs.filter(n => !n.read).length;

  if (unreadCount > 0) {
    badgeEl.textContent = unreadCount > 9 ? '9+' : unreadCount;
    badgeEl.style.display = 'flex';
  } else {
    badgeEl.style.display = 'none';
  }

  if (notifs.length === 0) {
    listEl.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No notifications yet.
      </div>
    `;
    return;
  }

  listEl.innerHTML = notifs.slice(0, 10).map(n => {
    const isSmsPending = n.channel === 'sms' && n.status === 'pending';
    return `
      <div class="notification-item ${n.read ? '' : 'unread'}" data-notif-id="${n.id}">
        <div class="notification-item-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <div class="notification-item-body">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
            <h5>${escapeHTML(n.title)}</h5>
            ${n.channel && n.channel !== 'in_app' ? `<span class="badge badge-info" style="font-size: 0.65rem; text-transform: uppercase;">${escapeHTML(n.channel)}</span>` : ''}
          </div>
          <p>${escapeHTML(n.message)}</p>
          ${isSmsPending ? `<span style="font-size: 0.72rem; color: #b45309; display: block; margin-top: 0.2rem;">ℹ️ SMS Provider Configuration Required</span>` : ''}
          <div class="notification-item-time">${formatDateTime(n.createdAt)}</div>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.notification-item').forEach(item => {
    item.addEventListener('click', async () => {
      const id = item.dataset.notifId;
      await markNotificationRead(id);
      item.classList.remove('unread');
      refreshNotifications(user);
    });
  });
}
