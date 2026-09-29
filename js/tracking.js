/**
 * GasBridge - Real-Time LPG Delivery Tracking
 * 6-step visual delivery tracker with timeline updates and agent info
 */

import { getCurrentUser } from "./auth.js";
import { getBookingById, getBookings, getDistributors } from "./firestore.js";
import { formatCurrency, formatDateTime, getStatusBadgeHTML, escapeHTML } from "./utils.js";

const STEPS_ORDER = [
  'confirmed',
  'processing',
  'agent_assigned',
  'picked_up',
  'out_for_delivery',
  'delivered'
];

export async function initTrackingPage() {
  const user = getCurrentUser();
  if (!user) return;

  const urlParams = new URLSearchParams(window.location.search);
  let bookingId = urlParams.get('id');

  // If no ID in URL, fetch customer's latest booking
  if (!bookingId) {
    const customerBookings = await getBookings({ customerId: user.uid });
    if (customerBookings.length > 0) {
      bookingId = customerBookings[0].bookingId;
    }
  }

  if (!bookingId) {
    renderNoBookingsFound();
    return;
  }

  loadAndRenderTracking(bookingId);

  // Periodic poll or real-time simulation check every 8 seconds
  setInterval(() => {
    loadAndRenderTracking(bookingId, true);
  }, 8000);
}

async function loadAndRenderTracking(bookingId, isSilentRefresh = false) {
  const booking = await getBookingById(bookingId);
  if (!booking) {
    if (!isSilentRefresh) renderNoBookingsFound(bookingId);
    return;
  }

  const distributors = await getDistributors();
  const distributor = distributors.find(d => d.id === booking.distributorId);

  const agent = booking.deliveryAgentId ? {
    name: booking.deliveryAgentName,
    mobile: booking.deliveryAgentMobile,
    vehicleNumber: booking.deliveryAgentVehicleNumber
  } : null;

  // 1. Update Booking ID & Status in Header
  const idEl = document.getElementById('track-booking-id');
  const badgeEl = document.getElementById('track-status-badge');
  const estEl = document.getElementById('track-est-delivery');
  if (idEl) idEl.textContent = booking.bookingId;
  if (badgeEl) badgeEl.innerHTML = getStatusBadgeHTML(booking.bookingStatus);
  if (estEl) estEl.textContent = booking.estimatedDelivery || "Next Business Day";

  // 2. Render 6-step Visual Stepper
  renderStepper(booking.bookingStatus);

  // 3. Render Order Details Card
  const detailsEl = document.getElementById('track-order-details');
  if (detailsEl) {
    const a = booking.deliveryAddress || {};
    detailsEl.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.25rem;">
        <div>
          <span style="color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 0.25rem;">Cylinder</span>
          <strong style="font-size: 1.05rem;">${escapeHTML(booking.cylinderName || 'Domestic LPG')}</strong>
          <div style="font-size: 0.85rem; color: var(--text-muted);">Quantity: ${booking.quantity}</div>
        </div>
        <div>
          <span style="color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 0.25rem;">Amount Paid</span>
          <strong style="font-size: 1.15rem; color: var(--primary); font-family: 'Outfit', sans-serif;">${formatCurrency(booking.totalAmount)}</strong>
          <div style="font-size: 0.85rem; color: var(--success); font-weight: 600;">✓ Demo Payment Verified</div>
        </div>
        <div>
          <span style="color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 0.25rem;">Authorized Distributor</span>
          <strong style="font-size: 0.95rem;">${escapeHTML(distributor ? distributor.name : 'GasBridge Shadnagar Depot')}</strong>
          <div style="font-size: 0.82rem; color: var(--text-muted);">${escapeHTML(distributor ? distributor.mobile : '')}</div>
        </div>
        <div>
          <span style="color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 0.25rem;">Delivery Personnel</span>
          ${agent ? `
            <strong style="font-size: 0.95rem; color: var(--primary);">${escapeHTML(agent.name)}</strong>
            <div style="font-size: 0.82rem; color: var(--text-muted);">Vehicle: ${escapeHTML(agent.vehicleNumber || 'LPG Van')}</div>
            <div style="font-size: 0.82rem; color: var(--text-muted);">Contact: ${escapeHTML(agent.mobile)}</div>
          ` : `
            <span class="badge badge-warning">Agent Assignment Pending</span>
          `}
        </div>
      </div>

      <div style="margin-top: 1.5rem; padding-top: 1.25rem; border-top: 1px solid var(--border);">
        <span style="color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 0.35rem;">Destination Home Address</span>
        <p style="font-weight: 600; font-size: 0.95rem; margin-bottom: 0.15rem;">
          ${escapeHTML(a.houseNo)}, ${escapeHTML(a.street)}, ${escapeHTML(a.area)}
        </p>
        <p style="color: var(--text-muted); font-size: 0.88rem;">
          ${escapeHTML(a.city)}, ${escapeHTML(a.district)}, ${escapeHTML(a.state)} - <strong>${escapeHTML(a.pincode)}</strong>
        </p>
      </div>
    `;
  }

  // 4. Render Timeline Events
  const timelineEl = document.getElementById('track-timeline-list');
  if (timelineEl && booking.statusTimeline) {
    timelineEl.innerHTML = booking.statusTimeline.map(item => `
      <div style="display: flex; gap: 1rem; margin-bottom: 1.25rem; position: relative;">
        <div style="width: 10px; height: 10px; border-radius: 50%; background: var(--primary); margin-top: 6px; flex-shrink: 0; box-shadow: 0 0 0 4px var(--primary-light);"></div>
        <div>
          <strong style="text-transform: capitalize; font-size: 0.92rem; display: block;">${escapeHTML(item.status.replace(/_/g, ' '))}</strong>
          <p style="color: var(--text-muted); font-size: 0.85rem; margin: 0.15rem 0;">${escapeHTML(item.note)}</p>
          <span style="font-size: 0.75rem; color: var(--text-light);">${formatDateTime(item.time)}</span>
        </div>
      </div>
    `).join('');
  }
}

function renderStepper(currentStatus) {
  const stepperContainer = document.getElementById('tracking-stepper-container');
  if (!stepperContainer) return;

  const currentIndex = STEPS_ORDER.indexOf(currentStatus);
  const activeIdx = currentIndex >= 0 ? currentIndex : 0;
  const progressPercent = Math.round((activeIdx / (STEPS_ORDER.length - 1)) * 100);

  const stepsMeta = [
    { key: 'confirmed', label: 'Booking Confirmed', icon: '1' },
    { key: 'processing', label: 'Processing', icon: '2' },
    { key: 'agent_assigned', label: 'Agent Assigned', icon: '3' },
    { key: 'picked_up', label: 'Picked Up', icon: '4' },
    { key: 'out_for_delivery', label: 'Out for Delivery', icon: '5' },
    { key: 'delivered', label: 'Delivered', icon: '✓' }
  ];

  stepperContainer.innerHTML = `
    <div class="tracking-stepper">
      <div class="tracking-progress-bar" style="width: ${progressPercent}%;"></div>
      ${stepsMeta.map((s, idx) => {
        let nodeClass = '';
        if (idx < activeIdx) nodeClass = 'completed';
        else if (idx === activeIdx) nodeClass = 'active';

        return `
          <div class="step-node ${nodeClass}">
            <div class="step-node-icon">${idx < activeIdx ? '✓' : s.icon}</div>
            <div class="step-node-label">${s.label}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderNoBookingsFound(id = "") {
  const main = document.getElementById('tracking-content-area');
  if (main) {
    main.innerHTML = `
      <div class="card text-center" style="padding: 3rem 1.5rem;">
        <h3 style="margin-bottom: 0.5rem;">No Active Delivery Tracking Found</h3>
        <p style="color: var(--text-muted); margin-bottom: 1.5rem;">${id ? `Could not locate booking ID: ${escapeHTML(id)}` : 'You currently do not have any active or previous LPG bookings.'}</p>
        <a href="customer-booking.html" class="btn btn-primary">Book an LPG Cylinder</a>
      </div>
    `;
  }
}
