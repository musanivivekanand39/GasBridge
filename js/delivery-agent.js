/**
 * GasBridge - Delivery Agent Operations Module
 * Provides delivery workflow: Accept -> Picked Up -> Out for Delivery -> Delivered
 * and 1-click Google Maps GPS navigation link for customer address.
 */

import { getCurrentUser } from "./auth.js";
import { getBookings, updateBookingStatus, logAuditEvent } from "./firestore.js";
import { 
  formatCurrency, 
  formatDateTime, 
  getStatusBadgeHTML, 
  showToast, 
  escapeHTML, 
  getGoogleMapsUrl 
} from "./utils.js";

// Initialize Agent Dashboard
export async function initAgentDashboard() {
  const user = getCurrentUser();
  if (!user) return;

  const agentId = user.agentId || 'agent-01';

  // 1. Fetch only bookings assigned to this delivery agent (Rule 15)
  const allAssigned = await getBookings({ deliveryAgentId: agentId });

  // Filter metrics
  const activeDeliveries = allAssigned.filter(b => b.bookingStatus !== 'delivered' && b.bookingStatus !== 'cancelled');
  const completedDeliveries = allAssigned.filter(b => b.bookingStatus === 'delivered');
  const todayStr = new Date().toISOString().split('T')[0];
  const todayCount = allAssigned.filter(b => b.createdAt.startsWith(todayStr)).length;

  const kpiToday = document.getElementById('agent-kpi-today');
  const kpiPending = document.getElementById('agent-kpi-pending');
  const kpiDone = document.getElementById('agent-kpi-done');

  if (kpiToday) kpiToday.textContent = todayCount;
  if (kpiPending) kpiPending.textContent = activeDeliveries.length;
  if (kpiDone) kpiDone.textContent = completedDeliveries.length;

  // Render Active Deliveries List
  const queueContainer = document.getElementById('agent-queue-container');
  if (queueContainer) {
    if (activeDeliveries.length === 0) {
      queueContainer.innerHTML = `
        <div class="card text-center" style="padding: 2.5rem; color: var(--text-muted);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">🎉</div>
          <h3>All Caught Up!</h3>
          <p>You have no pending cylinder deliveries in your queue right now.</p>
        </div>
      `;
    } else {
      queueContainer.innerHTML = activeDeliveries.map(b => renderDeliveryCard(b)).join('');
      attachAgentActionListeners(queueContainer, user);
    }
  }
}

// Initialize Full Deliveries Queue Page
export async function initAgentDeliveriesPage() {
  const user = getCurrentUser();
  if (!user) return;

  const agentId = user.agentId || 'agent-01';
  const allAssigned = await getBookings({ deliveryAgentId: agentId });
  const active = allAssigned.filter(b => b.bookingStatus !== 'delivered' && b.bookingStatus !== 'cancelled');

  const container = document.getElementById('agent-full-queue');
  if (!container) return;

  if (active.length === 0) {
    container.innerHTML = `
      <div class="card text-center" style="padding: 3rem; color: var(--text-muted);">
        <h3>No Deliveries in Progress</h3>
        <p>Your delivery assignments will appear here once booked by customers in your service area.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = active.map(b => renderDeliveryCard(b)).join('');
  attachAgentActionListeners(container, user);
}

// Initialize Delivery History Page
export async function initAgentHistoryPage() {
  const user = getCurrentUser();
  if (!user) return;

  const agentId = user.agentId || 'agent-01';
  const allAssigned = await getBookings({ deliveryAgentId: agentId });
  const completed = allAssigned.filter(b => b.bookingStatus === 'delivered');

  const tbody = document.getElementById('agent-history-tbody');
  if (!tbody) return;

  if (completed.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">No completed deliveries recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = completed.map(b => `
    <tr>
      <td><strong style="color: var(--primary); font-family: 'Outfit', sans-serif;">${escapeHTML(b.bookingId)}</strong></td>
      <td>${formatDateTime(b.updatedAt)}</td>
      <td>${escapeHTML(b.customerName)}</td>
      <td>${escapeHTML(b.deliveryAddress.houseNo)}, ${escapeHTML(b.deliveryAddress.area)}, ${escapeHTML(b.deliveryAddress.city)}</td>
      <td>${escapeHTML(b.cylinderName || 'Domestic LPG')} (${b.quantity})</td>
      <td><strong>${formatCurrency(b.totalAmount)}</strong></td>
      <td>${getStatusBadgeHTML(b.bookingStatus)}</td>
    </tr>
  `).join('');
}

// Helper to render individual delivery card
function renderDeliveryCard(booking) {
  const addr = booking.deliveryAddress || {};
  const mapsUrl = getGoogleMapsUrl(addr);

  return `
    <div class="card delivery-task-card" style="border-left: 5px solid var(--primary); margin-bottom: 1.5rem;" id="card-${booking.bookingId}">
      <div class="card-header" style="margin-bottom: 0.75rem;">
        <div>
          <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Delivery Task</span>
          <h3 style="color: var(--primary); font-family: 'Outfit', sans-serif; font-size: 1.25rem;">${escapeHTML(booking.bookingId)}</h3>
        </div>
        <div>
          ${getStatusBadgeHTML(booking.bookingStatus)}
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.25rem; margin-bottom: 1.25rem;">
        <div>
          <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; display: block; margin-bottom: 0.25rem;">Customer Info</label>
          <div style="font-weight: 700; font-size: 1rem;">${escapeHTML(booking.customerName)}</div>
          <a href="tel:${booking.customerMobile}" style="font-size: 0.88rem; color: var(--primary); font-weight: 600; display: inline-flex; align-items: center; gap: 0.35rem; margin-top: 0.2rem;">
            📞 ${escapeHTML(booking.customerMobile)}
          </a>
        </div>

        <div>
          <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; display: block; margin-bottom: 0.25rem;">Delivery Address</label>
          <div style="font-size: 0.92rem; font-weight: 600;">${escapeHTML(addr.houseNo)}, ${escapeHTML(addr.street)}</div>
          <div style="font-size: 0.85rem; color: var(--text-muted);">${escapeHTML(addr.area)}, ${escapeHTML(addr.city)} - PIN: ${escapeHTML(addr.pincode)}</div>
        </div>

        <div>
          <label style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; display: block; margin-bottom: 0.25rem;">Cylinder Order</label>
          <div style="font-weight: 700;">${escapeHTML(booking.cylinderName || 'Domestic LPG')}</div>
          <div style="font-size: 0.85rem; color: var(--text-muted);">Quantity: ${booking.quantity} | Total: ${formatCurrency(booking.totalAmount)}</div>
        </div>
      </div>

      <div class="flex items-center justify-between" style="padding-top: 1rem; border-top: 1px solid var(--border); flex-wrap: wrap; gap: 0.75rem;">
        <!-- Google Maps Navigation Button -->
        <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm" style="display: inline-flex; align-items: center; gap: 0.5rem;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
          Navigate (Google Maps)
        </a>

        <!-- Status Progress Action Buttons -->
        <div class="flex gap-1" style="flex-wrap: wrap;">
          ${renderActionButtonsForStatus(booking.bookingId, booking.bookingStatus, booking.paymentStatus)}
        </div>
      </div>
    </div>
  `;
}

function renderActionButtonsForStatus(bookingId, status, paymentStatus) {
  if (status === 'agent_assigned') {
    return `
      <button class="btn btn-outline btn-sm agent-action-btn" data-id="${bookingId}" data-next="picked_up">
        Mark Picked Up
      </button>
    `;
  }
  if (status === 'picked_up') {
    return `
      <button class="btn btn-secondary btn-sm agent-action-btn" data-id="${bookingId}" data-next="out_for_delivery">
        Start Delivery (Out for Delivery)
      </button>
    `;
  }
  if (status === 'out_for_delivery') {
    return `
      <button class="btn btn-primary btn-sm agent-action-btn" data-id="${bookingId}" data-next="delivered" data-cod="${paymentStatus === 'cod_pending'}">
        ✓ Confirm Handover (Mark Delivered)
      </button>
    `;
  }
  return `<span class="badge badge-success">Completed</span>`;
}

function attachAgentActionListeners(container, user) {
  container.querySelectorAll('.agent-action-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const bId = btn.dataset.id;
      const nextStatus = btn.dataset.next;
      if (nextStatus === 'delivered' && btn.dataset.cod === 'true' && !window.confirm('Confirm that you collected the cash payment from the customer?')) return;

      btn.disabled = true;
      btn.textContent = "Updating...";

      try {
        await updateBookingStatus(
          bId,
          nextStatus,
          `Updated by Delivery Agent ${user.name || 'Agent'}`,
          { id: user.uid, role: 'agent', agentId: user.agentId }
        );
      } catch (err) {
        showToast("Delivery Update Failed", err.message, "error");
        btn.disabled = false;
        btn.textContent = "Try Again";
        return;
      }

      showToast("Delivery Updated", `Booking ${bId} marked as ${nextStatus.replace(/_/g, ' ')}.`, "success");

      // Refresh current page
      if (document.getElementById('agent-queue-container')) {
        initAgentDashboard();
      } else {
        initAgentDeliveriesPage();
      }
    });
  });
}
