/**
 * GasBridge - Real-Time LPG Delivery Tracking
 * 6-step visual delivery tracker with timeline updates and agent info
 */

import { getCurrentUser } from "./auth.js";
import { getBookingById, getBookings, getDistributors } from "./firestore.js";
import { formatCurrency, getStatusBadgeHTML, escapeHTML } from "./utils.js";

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
    const customerBookings = await getBookings({ customerId: user.uid, paymentStatus: ['paid', 'cod_pending'] });
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
  const estLabelEl = document.getElementById('track-est-label');
  if (idEl) idEl.textContent = booking.bookingId;
  if (badgeEl) badgeEl.innerHTML = getStatusBadgeHTML(booking.bookingStatus);
  if (booking.bookingStatus === 'cancelled') {
    if (estLabelEl) estLabelEl.textContent = 'Final status:';
    if (estEl) estEl.textContent = 'Cancelled';
  } else {
    if (estLabelEl) estLabelEl.textContent = 'Est. Delivery:';
    if (estEl) estEl.textContent = booking.estimatedDelivery || "Next Business Day";
  }

  // 2. Render 6-step Visual Stepper
  renderStepper(booking.bookingStatus);

  // 3. Render Order Details Card
  const detailsEl = document.getElementById('track-order-details');
  if (detailsEl) {
    const a = booking.deliveryAddress || {};
    const isRefunded = booking.paymentStatus === 'refunded' && booking.refundStatus === 'simulated_refunded';
    const paymentHeading = isRefunded
      ? 'Simulated Refund Amount'
      : booking.paymentStatus === 'cod_pending'
        ? 'Amount Due on Delivery'
        : booking.paymentStatus === 'paid'
          ? 'Amount Paid'
          : 'Payment Status';
    const paymentDescription = isRefunded
      ? 'Simulated refund recorded - no real money moved'
      : booking.paymentStatus === 'cod_pending'
        ? 'Cash payment due at delivery'
        : booking.paymentStatus === 'paid'
          ? 'Payment confirmed'
          : booking.bookingStatus === 'cancelled'
            ? 'Order cancelled - no payment collected'
            : 'Payment pending';
    const paymentDescriptionColor = isRefunded || booking.paymentStatus === 'cod_pending'
      ? 'var(--warning)'
      : booking.paymentStatus === 'paid'
        ? 'var(--success)'
        : 'var(--text-muted)';
    const displayedPaymentAmount = isRefunded ? booking.refundAmount : booking.totalAmount;
    detailsEl.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.25rem;">
        <div>
          <span style="color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 0.25rem;">Cylinder</span>
          <strong style="font-size: 1.05rem;">${escapeHTML(booking.cylinderName || 'Domestic LPG')}</strong>
          <div style="font-size: 0.85rem; color: var(--text-muted);">Quantity: ${booking.quantity}</div>
        </div>
        <div>
          <span style="color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 0.25rem;">${paymentHeading}</span>
          <strong style="font-size: 1.15rem; color: var(--primary); font-family: 'Outfit', sans-serif;">${formatCurrency(displayedPaymentAmount)}</strong>
          <div style="font-size: 0.85rem; color: ${paymentDescriptionColor}; font-weight: 600;">${paymentDescription}</div>
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
  if (timelineEl) {
    const timeline = Array.isArray(booking.statusTimeline) ? booking.statusTimeline : [];
    const eventByStatus = new Map();
    timeline.forEach(item => {
      if (item?.status) eventByStatus.set(item.status, item);
    });
    const isCancelled = booking.bookingStatus === 'cancelled';
    if (!isCancelled && !eventByStatus.has('confirmed')) {
      eventByStatus.set('confirmed', { time: booking.createdAt || booking.updatedAt });
    }

    const currentIndex = STEPS_ORDER.indexOf(booking.bookingStatus);
    const activeIndex = currentIndex >= 0 ? currentIndex : 0;
    const deliveryMilestones = [
      { key: 'confirmed', label: 'Booking Confirmed' },
      { key: 'processing', label: 'Processing' },
      { key: 'agent_assigned', label: 'Agent Assigned' },
      { key: 'picked_up', label: 'Picked Up' },
      { key: 'out_for_delivery', label: 'Out for Delivery' },
      { key: 'delivered', label: 'Delivered' }
    ];
    const milestones = isCancelled
      ? [
          ...deliveryMilestones.filter(milestone => eventByStatus.has(milestone.key)),
          { key: 'cancelled', label: 'Order Cancelled' }
        ]
      : deliveryMilestones;

    timelineEl.innerHTML = `<div class="milestone-list">${milestones.map((milestone, index) => {
      const cancelled = isCancelled && milestone.key === 'cancelled';
      const complete = isCancelled
        ? !cancelled
        : index < activeIndex || (booking.bookingStatus === 'delivered' && index === activeIndex);
      const active = !isCancelled && index === activeIndex && booking.bookingStatus !== 'delivered';
      const event = eventByStatus.get(milestone.key);
      const badge = complete
        ? ''
        : cancelled
          ? `<span class="milestone-state milestone-state-cancelled">Cancelled</span>`
          : active
          ? `<span class="milestone-state milestone-state-active">In Progress</span>`
          : `<span class="milestone-state milestone-state-pending">Pending</span>`;
      const marker = complete
        ? '<span class="milestone-marker milestone-marker-complete">✓</span>'
        : `<span class="milestone-marker ${cancelled ? 'milestone-marker-cancelled' : active ? 'milestone-marker-active' : ''}">${cancelled ? '×' : index + 1}</span>`;
      const timestamp = event?.time
        ? new Date(event.time).toLocaleString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '';

      return `<div class="milestone-row ${complete ? 'is-complete' : ''} ${active ? 'is-active' : ''} ${cancelled ? 'is-cancelled' : ''}">
        ${marker}
        <span class="milestone-label">${milestone.label}</span>
        ${timestamp ? `<time class="milestone-time" datetime="${escapeHTML(event.time)}">${escapeHTML(timestamp)}</time>` : ''}
        ${badge}
      </div>`;
    }).join('')}</div>`;
  }
}

function renderStepper(currentStatus) {
  const stepperContainer = document.getElementById('tracking-stepper-container');
  if (!stepperContainer) return;

  if (currentStatus === 'cancelled') {
    stepperContainer.innerHTML = `
      <div class="tracking-stepper tracking-stepper-cancelled">
        <div class="tracking-progress-bar"></div>
        <div class="step-node completed">
          <div class="step-node-icon">✓</div>
          <div class="step-node-label">Booking Confirmed</div>
        </div>
        <div class="step-node cancelled">
          <div class="step-node-icon">×</div>
          <div class="step-node-label">Order Cancelled</div>
        </div>
      </div>
    `;
    return;
  }

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
      <div class="tracking-progress-bar" style="--progress: ${progressPercent / 100};"></div>
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
