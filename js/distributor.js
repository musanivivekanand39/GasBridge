/**
 * GasBridge - Distributor Features & Order Fulfillment
 * Distributor strictly manages bookings belonging to their own authorized service areas.
 */

import { getCurrentUser } from "./auth.js";
import { 
  getBookings, 
  getBookingById, 
  updateBookingRecord, 
  updateBookingStatus, 
  getDistributorInventory, 
  updateDistributorInventory, 
  getDistributorById,
  getServiceAreas,
  getDeliveryAgents,
  getPendingDeliveryAgents,
  getPendingDistributorCustomers,
  getDistributorCustomers,
  approveCustomer,
  rejectCustomer,
  approveDeliveryAgent,
  rejectDeliveryAgent,
  createNotification
} from "./firestore.js";
import { formatCurrency, formatDateTime, getStatusBadgeHTML, showToast, escapeHTML, openModal, closeModal } from "./utils.js";

function resolveDistributorId(user) {
  if (user?.distributorId) return user.distributorId;
  if (user?.role === 'admin') return 'dist-01';
  throw new Error('Your distributor profile has no assigned depot ID. Sign out and sign in again, or contact support.');
}

function normalizePincodes(...values) {
  const raw = values.flatMap(value => Array.isArray(value) ? value : [value])
    .flatMap(value => String(value ?? '').split(/[,;\s]+/))
    .map(value => value.trim())
    .filter(Boolean);
  return [...new Set(raw.filter(value => /^\d{6}$/.test(value)))];
}

// Initialize Distributor Dashboard
export async function initDistributorDashboard() {
  const user = getCurrentUser();
  if (!user) return;

  const distributorId = resolveDistributorId(user);

  const [distributor, serviceAreas] = await Promise.all([
    getDistributorById(distributorId),
    getServiceAreas()
  ]);
  const assignedAreas = serviceAreas.filter(area => area.distributorId === distributorId);
  const registeredPins = normalizePincodes(distributor?.pincodes);
  const registeredPrimaryPin = normalizePincodes(distributor?.pincode)[0];
  const coveredPincodes = registeredPins.length ? registeredPins : registeredPrimaryPin ? [registeredPrimaryPin] : normalizePincodes(...assignedAreas.map(area => area.pincodes));

  const primaryArea = assignedAreas.find(area => area.city?.toLowerCase() === distributor?.city?.toLowerCase()) || assignedAreas[0];
  const areaCity = distributor?.city || primaryArea?.city || '';
  const areaNameEl = document.getElementById('dash-sa-name');
  const areaPincodesEl = document.getElementById('dash-sa-pincodes');
  const areaStatusEl = document.getElementById('dash-sa-status');
  if (areaNameEl) areaNameEl.textContent = areaCity ? `${areaCity} Service Area` : primaryArea?.name || distributor?.name || 'Service area not configured';
  if (areaPincodesEl) areaPincodesEl.innerHTML = coveredPincodes.length
    ? coveredPincodes.map(pin => `<span class="badge badge-info">${escapeHTML(pin)}</span>`).join(' ')
    : '<span class="badge badge-warning">No service pincode set</span>';
  if (areaStatusEl) {
    const status = (distributor?.status || distributor?.approvalStatus || '').toLowerCase();
    areaStatusEl.textContent = ['approved', 'active'].includes(status) && distributor?.active !== false ? 'Active & Serving' : status || 'Status unavailable';
    areaStatusEl.className = `badge ${['approved', 'active'].includes(status) && distributor?.active !== false ? 'badge-success' : 'badge-warning'}`;
  }

  // 1. Fetch bookings strictly for this distributor
  const bookings = await getBookings({ distributorId });

  // 2. Fetch inventory
  const inventory = await getDistributorInventory(distributorId);

  // 3. Fetch agents, customers, and pending requests
  const [agents, pendingAgents, pendingCustomers, allCustomers] = await Promise.all([
    getDeliveryAgents(distributorId),
    getPendingDeliveryAgents(distributorId),
    getPendingDistributorCustomers(distributorId),
    getDistributorCustomers(distributorId)
  ]);

  // Calculate KPIs
  const todayStr = new Date().toISOString().split('T')[0];
  const todayBookings = bookings.filter(b => String(b.createdAt || '').startsWith(todayStr));
  const pendingAgentAssignment = bookings.filter(b => !b.deliveryAgentId && b.bookingStatus !== 'cancelled' && b.bookingStatus !== 'delivered');
  const processingCount = bookings.filter(b => b.bookingStatus === 'processing' || b.bookingStatus === 'agent_assigned' || b.bookingStatus === 'picked_up');
  const deliveredCount = bookings.filter(b => b.bookingStatus === 'delivered');
  const approvedCustomers = allCustomers.filter(c => c.approvalStatus === 'approved' || (c.active && c.approvalStatus !== 'rejected'));
  const approvedAgents = agents.filter(a => a.approvalStatus === 'approved' || (a.active && a.approvalStatus !== 'rejected'));

  // Populate KPI Elements
  setKPI('kpi-today-bookings', todayBookings.length);
  setKPI('kpi-pending-assignment', pendingAgentAssignment.length);
  setKPI('kpi-processing', processingCount.length);
  setKPI('kpi-delivered', deliveredCount.length);
  setKPI('kpi-domestic-stock', inventory.domestic ? inventory.domestic.available : 0);
  setKPI('kpi-commercial-stock', inventory.commercial ? inventory.commercial.available : 0);
  setKPI('kpi-approved-customers', approvedCustomers.length);
  setKPI('kpi-approved-agents', approvedAgents.length);

  // Set Inventory Breakdown Card
  setKPI('dash-inv-domestic', inventory.domestic ? inventory.domestic.available : 0);
  setKPI('dash-inv-commercial', inventory.commercial ? inventory.commercial.available : 0);

  // Badges
  const custBadge = document.getElementById('pending-customers-count-badge');
  const agentBadge = document.getElementById('pending-agents-count-badge');
  if (custBadge) custBadge.textContent = `${pendingCustomers.length} Pending`;
  if (agentBadge) agentBadge.textContent = `${pendingAgents.length} Pending`;

  // Render 1. CUSTOMER REGISTRATION REQUESTS Table (Rule 13, 14)
  const custTable = document.getElementById('distributor-pending-customers-tbody');
  if (custTable) {
    if (pendingCustomers.length === 0) {
      custTable.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            <div style="font-size: 1.25rem; margin-bottom: 0.35rem;">✅</div>
            <div>No pending customer registration requests for your service area.</div>
          </td>
        </tr>
      `;
    } else {
      custTable.innerHTML = pendingCustomers.map(c => {
        const addr = c.address || {};
        const fullAddr = [addr.houseNo, addr.street, addr.area, addr.city].filter(Boolean).join(', ') || 'Address on file';
        const cylinderLabel = c.cylinderType === 'commercial' 
          ? '<span class="badge badge-warning">Commercial (19kg)</span>' 
          : '<span class="badge badge-success">Domestic (14.2kg)</span>';

        return `
          <tr>
            <td><strong>${escapeHTML(c.name)}</strong></td>
            <td>${escapeHTML(c.mobile || '-')}</td>
            <td>${escapeHTML(c.email || '-')}</td>
            <td style="font-size: 0.85rem; max-width: 180px;">${escapeHTML(fullAddr)}</td>
            <td><span class="badge badge-info">${escapeHTML(addr.pincode || c.pincode || '-')}</span></td>
            <td>${cylinderLabel}</td>
            <td style="font-size: 0.82rem;">${formatDateTime(c.createdAt)}</td>
            <td><span class="badge badge-warning">Pending</span></td>
            <td style="text-align: right; white-space: nowrap;">
              <button class="btn btn-sm btn-outline btn-view-cust" data-id="${escapeHTML(c.uid || c.id)}" style="margin-right: 0.25rem; font-weight: 600;">
                View
              </button>
              <button class="btn btn-sm btn-primary btn-approve-cust" data-id="${escapeHTML(c.uid || c.id)}" style="margin-right: 0.25rem; font-weight: 600;">
                Approve
              </button>
              <button class="btn btn-sm btn-outline-danger btn-reject-cust" data-id="${escapeHTML(c.uid || c.id)}" style="font-weight: 600;">
                Reject
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Bind view modal
      custTable.querySelectorAll('.btn-view-cust').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const custId = e.currentTarget.getAttribute('data-id');
          const cust = pendingCustomers.find(x => (x.uid || x.id) === custId);
          if (cust) {
            const addr = cust.address || {};
            const bodyEl = document.getElementById('view-customer-body');
            if (bodyEl) {
              bodyEl.innerHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Customer Name</span>
                    <strong style="font-size: 1.05rem;">${escapeHTML(cust.name || '-')}</strong>
                  </div>
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Cylinder Type</span>
                    <strong style="font-size: 1.05rem; color: var(--primary);">${cust.cylinderType === 'commercial' ? 'Commercial (19 kg)' : 'Domestic (14.2 kg)'}</strong>
                  </div>
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Mobile</span>
                    <div>${escapeHTML(cust.mobile || '-')}</div>
                  </div>
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Email</span>
                    <div>${escapeHTML(cust.email || '-')}</div>
                  </div>
                </div>
                <div style="margin-bottom: 1rem; padding: 0.75rem; background: var(--bg-alt); border-radius: var(--radius-sm);">
                  <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Permanent Home Address</span>
                  <div>${escapeHTML(addr.houseNo || '')} ${escapeHTML(addr.street || '')}, ${escapeHTML(addr.area || '')}</div>
                  <div>${escapeHTML(addr.city || '')}, ${escapeHTML(addr.district || '')}, ${escapeHTML(addr.state || '')}</div>
                  <div style="margin-top: 0.35rem; font-size: 0.85rem;">Pincode: <strong>${escapeHTML(addr.pincode || cust.pincode || '-')}</strong></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--text-muted);">
                  <span>Submitted: ${formatDateTime(cust.createdAt)}</span>
                  <span>Status: <strong class="badge badge-warning">Pending Distributor Review</strong></span>
                </div>
              `;
            }
            openModal('view-customer-modal');
          }
        });
      });

      // Bind approve
      custTable.querySelectorAll('.btn-approve-cust').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const custId = e.currentTarget.getAttribute('data-id');
          try {
            e.currentTarget.disabled = true;
            e.currentTarget.textContent = 'Approving...';
            await approveCustomer(custId, user.uid, user.name || "Distributor Depot");
            showToast("Customer Approved", "Customer registration approved! Notification recorded.", "success");
            await initDistributorDashboard();
          } catch (err) {
            showToast("Approval Error", err.message || "Failed to approve customer.", "error");
            e.currentTarget.disabled = false;
            e.currentTarget.textContent = 'Approve';
          }
        });
      });

      // Bind reject
      custTable.querySelectorAll('.btn-reject-cust').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const custId = e.currentTarget.getAttribute('data-id');
          const confirmed = confirm("Are you sure you want to reject this customer registration?");
          if (confirmed) {
            try {
              e.currentTarget.disabled = true;
              e.currentTarget.textContent = 'Rejecting...';
              await rejectCustomer(custId, "Verification criteria not met.", user.uid);
              showToast("Customer Rejected", "Customer registration was rejected.", "info");
              await initDistributorDashboard();
            } catch (err) {
              showToast("Rejection Error", err.message || "Failed to reject customer.", "error");
              e.currentTarget.disabled = false;
              e.currentTarget.textContent = 'Reject';
            }
          }
        });
      });
    }
  }

  // Render 2. DELIVERY AGENT REQUESTS Table (Rule 8, 31)
  const agentTable = document.getElementById('distributor-pending-agents-tbody');
  if (agentTable) {
    if (pendingAgents.length === 0) {
      agentTable.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            <div style="font-size: 1.25rem; margin-bottom: 0.35rem;">✅</div>
            <div>No pending delivery agent requests for your depot.</div>
          </td>
        </tr>
      `;
    } else {
      agentTable.innerHTML = pendingAgents.map(a => `
        <tr>
          <td><strong>${escapeHTML(a.name)}</strong></td>
          <td>${escapeHTML(a.mobile || '-')}</td>
          <td>${escapeHTML(a.email || '-')}</td>
          <td style="font-size: 0.85rem; max-width: 180px;">${escapeHTML(a.address || '-')}</td>
          <td style="font-size: 0.82rem;">${formatDateTime(a.createdAt)}</td>
          <td><span class="badge badge-warning">Pending</span></td>
          <td style="text-align: right; white-space: nowrap;">
            <button class="btn btn-sm btn-outline btn-view-agent" data-id="${escapeHTML(a.id)}" style="margin-right: 0.25rem; font-weight: 600;">
              View
            </button>
            <button class="btn btn-sm btn-primary btn-approve-agent" data-id="${escapeHTML(a.id)}" style="margin-right: 0.25rem; font-weight: 600;">
              Approve
            </button>
            <button class="btn btn-sm btn-outline-danger btn-reject-agent" data-id="${escapeHTML(a.id)}" style="font-weight: 600;">
              Reject
            </button>
          </td>
        </tr>
      `).join('');

      // Bind view modal
      agentTable.querySelectorAll('.btn-view-agent').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const agentId = e.currentTarget.getAttribute('data-id');
          const agent = pendingAgents.find(x => x.id === agentId);
          if (agent) {
            const bodyEl = document.getElementById('view-agent-body');
            if (bodyEl) {
              bodyEl.innerHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Agent Name</span>
                    <strong style="font-size: 1.05rem;">${escapeHTML(agent.name || '-')}</strong>
                  </div>
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Assigned Distributor</span>
                    <strong style="font-size: 1.05rem; color: var(--primary);">${escapeHTML(agent.distributorName || user.name || 'Your Depot')}</strong>
                  </div>
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Mobile</span>
                    <div>${escapeHTML(agent.mobile || '-')}</div>
                  </div>
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Email</span>
                    <div>${escapeHTML(agent.email || '-')}</div>
                  </div>
                </div>
                <div style="margin-bottom: 1rem; padding: 0.75rem; background: var(--bg-alt); border-radius: var(--radius-sm);">
                  <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Residential Address</span>
                  <div>${escapeHTML(agent.address || '-')}</div>
                  <div style="margin-top: 0.35rem; font-size: 0.85rem;">Pincode: <strong>${escapeHTML(agent.pincode || '-')}</strong></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--text-muted);">
                  <span>Submitted: ${formatDateTime(agent.createdAt)}</span>
                  <span>Status: <strong class="badge badge-warning">Pending Distributor Review</strong></span>
                </div>
              `;
            }
            openModal('view-agent-modal');
          }
        });
      });

      // Bind approve
      agentTable.querySelectorAll('.btn-approve-agent').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const agentId = e.currentTarget.getAttribute('data-id');
          try {
            e.currentTarget.disabled = true;
            e.currentTarget.textContent = 'Approving...';
            await approveDeliveryAgent(agentId, user.uid, user.name || 'Distributor Depot');
            showToast("Agent Approved", "Delivery agent approved! Notification recorded.", "success");
            await initDistributorDashboard();
          } catch (err) {
            showToast("Approval Failed", err.message || "Could not approve agent.", "error");
            e.currentTarget.disabled = false;
            e.currentTarget.textContent = 'Approve';
          }
        });
      });

      // Bind reject
      agentTable.querySelectorAll('.btn-reject-agent').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const agentId = e.currentTarget.getAttribute('data-id');
          const confirmed = confirm("Are you sure you want to reject this delivery agent application?");
          if (confirmed) {
            try {
              e.currentTarget.disabled = true;
              e.currentTarget.textContent = 'Rejecting...';
              await rejectDeliveryAgent(agentId, "Depot fleet capacity reached.", user.uid);
              showToast("Agent Rejected", "Delivery agent registration was rejected.", "info");
              await initDistributorDashboard();
            } catch (err) {
              showToast("Rejection Failed", err.message || "Could not reject agent.", "error");
              e.currentTarget.disabled = false;
              e.currentTarget.textContent = 'Reject';
            }
          }
        });
      });
    }
  }

  // Populate Recent Bookings Table
  const tbody = document.getElementById('distributor-recent-bookings-tbody');
  if (tbody) {
    if (bookings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-muted);">No bookings for your service area yet.</td></tr>`;
    } else {
      tbody.innerHTML = bookings.slice(0, 6).map(b => {
        const agent = agents.find(a => a.id === b.deliveryAgentId);
        return `
          <tr>
            <td><strong style="color: var(--primary); font-family: 'Outfit', sans-serif;">${escapeHTML(b.bookingId)}</strong></td>
            <td>${escapeHTML(b.customerName)}</td>
            <td>${escapeHTML(b.deliveryAddress ? b.deliveryAddress.city : '')} (${escapeHTML(b.deliveryAddress ? b.deliveryAddress.pincode : '')})</td>
            <td>${escapeHTML(b.cylinderName || 'Domestic LPG')} (${b.quantity})</td>
            <td>${getStatusBadgeHTML(b.paymentStatus)}</td>
            <td>${getStatusBadgeHTML(b.bookingStatus)}</td>
            <td>${agent ? `<span style="font-weight: 600;">${escapeHTML(agent.name)}</span>` : `<span class="badge badge-warning">Unassigned</span>`}</td>
            <td>
              <a href="distributor-bookings.html?highlight=${b.bookingId}" class="btn btn-outline btn-sm">Manage</a>
            </td>
          </tr>
        `;
      }).join('');
    }
  }
}

// Initialize Distributor Bookings Page
export async function initDistributorBookingsPage() {
  const user = getCurrentUser();
  if (!user) return;

  const distributorId = resolveDistributorId(user);
  const bookings = await getBookings({ distributorId });
  const agents = (await getDeliveryAgents(distributorId)).filter(a => a.status === 'approved' && a.active !== false);

  const tbody = document.getElementById('distributor-bookings-full-tbody');
  if (!tbody) return;

  renderBookingsTable(bookings, agents);

  // Setup Status Filter
  const filterSelect = document.getElementById('filter-booking-status');
  if (filterSelect) {
    filterSelect.addEventListener('change', () => {
      const val = filterSelect.value;
      const filtered = val ? bookings.filter(b => b.bookingStatus === val) : bookings;
      renderBookingsTable(filtered, agents);
    });
  }

  // Setup Manual Assign Agent Modal Handler
  setupAgentAssignmentModal(agents, user);
}

function renderBookingsTable(bookings, agents) {
  const tbody = document.getElementById('distributor-bookings-full-tbody');
  if (!tbody) return;

  if (bookings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-muted);">No bookings found matching filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = bookings.map(b => {
    const agent = agents.find(a => a.id === b.deliveryAgentId);
    return `
      <tr id="row-${b.bookingId}">
        <td><strong style="color: var(--primary); font-family: 'Outfit', sans-serif;">${escapeHTML(b.bookingId)}</strong></td>
        <td>
          <div style="font-weight: 600;">${escapeHTML(b.customerName)}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHTML(b.customerMobile)}</div>
        </td>
        <td>
          <div style="font-size: 0.85rem;">${escapeHTML(b.deliveryAddress.houseNo)}, ${escapeHTML(b.deliveryAddress.street)}, ${escapeHTML(b.deliveryAddress.city)}</div>
          <div style="font-size: 0.78rem; font-weight: 700; color: var(--primary);">PIN: ${escapeHTML(b.deliveryAddress.pincode)}</div>
        </td>
        <td>${escapeHTML(b.cylinderName || 'Domestic LPG')} (${b.quantity})</td>
        <td>${getStatusBadgeHTML(b.bookingStatus)}</td>
        <td>
          ${agent ? `
            <div style="font-weight: 600; font-size: 0.88rem;">${escapeHTML(agent.name)}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHTML(agent.vehicleNumber || 'Van')}</div>
          ` : `
            <span class="badge badge-warning">Assignment Pending</span>
          `}
        </td>
        <td>
          <div class="flex gap-1">
            ${['confirmed', 'processing'].includes(b.bookingStatus) ? `
              <button class="btn btn-outline btn-sm assign-agent-btn" data-booking-id="${b.bookingId}">
                ${agent ? 'Change Agent' : 'Assign Agent'}
              </button>
              <button class="btn btn-primary btn-sm update-status-btn" data-booking-id="${b.bookingId}" data-status="${b.bookingStatus}">Update</button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Attach button events
  tbody.querySelectorAll('.assign-agent-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const bId = btn.dataset.bookingId;
      openAssignAgentModal(bId);
    });
  });

  tbody.querySelectorAll('.update-status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const bId = btn.dataset.bookingId;
      const current = btn.dataset.status;
      openUpdateStatusModal(bId, current);
    });
  });
}

// Agent Assignment Modal Logic
let targetBookingForAssignment = null;

function setupAgentAssignmentModal(agents, user) {
  let modal = document.getElementById('assign-agent-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'assign-agent-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3 style="font-size: 1.15rem;">Assign Delivery Agent</h3>
          <button class="btn-icon" data-close-modal>&times;</button>
        </div>
        <div class="modal-body">
          <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem;">
            Select an authorized delivery agent from your service area depot:
          </p>
          <div class="form-group">
            <label>Available Delivery Agents</label>
            <select class="form-control" id="agent-select-dropdown">
              ${agents.filter(a => a.status === 'approved' && a.active !== false).map(a => `
                <option value="${a.id}">${a.name} (${a.vehicleNumber || 'Van'}) - Status: ${a.status.toUpperCase()}</option>
              `).join('')}
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" data-close-modal>Cancel</button>
          <button class="btn btn-primary" id="confirm-assign-agent-btn">Confirm Assignment</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#confirm-assign-agent-btn').addEventListener('click', async () => {
      if (!targetBookingForAssignment) return;
      const select = modal.querySelector('#agent-select-dropdown');
      const selectedAgentId = select.value;
      const agent = agents.find(a => a.id === selectedAgentId);

      const booking = await getBookingById(targetBookingForAssignment);
      if (booking) {
        if (!['confirmed', 'processing'].includes(booking.bookingStatus) || !agent) {
          showToast("Assignment Unavailable", "Assign an approved agent to a confirmed or processing booking.", "warning");
          return;
        }
        if (booking.bookingStatus === 'confirmed') {
          try {
            await updateBookingStatus(booking.bookingId, 'processing', 'Order prepared for delivery.', { id: user.uid, role: 'distributor', distributorId: user.distributorId });
          } catch (err) {
            showToast("Status Update Failed", err.message, "error");
            return;
          }
        }
        const effectiveBookingStatus = booking.bookingStatus === 'confirmed' ? 'processing' : booking.bookingStatus;
        try {
            await updateBookingRecord(targetBookingForAssignment, {
              deliveryAgentId: selectedAgentId,
              bookingStatus: effectiveBookingStatus
            });
            if (booking.bookingStatus === 'processing') {
              await updateBookingStatus(targetBookingForAssignment, 'agent_assigned', `Assigned delivery agent ${agent?.name || ''}.`, {
                id: user.uid, role: 'distributor', distributorId: user.distributorId
              });
            }
        } catch (err) {
          showToast("Assignment Failed", err.message, "error");
          return;
        }

        // Send notification to the newly assigned agent
        if (agent) {
          await createNotification(
            agent.userId || agent.uid,
            "agent",
            "New Delivery Assigned",
            `Distributor assigned you delivery ${targetBookingForAssignment} in ${booking.deliveryAddress.city}.`,
            "agent-deliveries.html"
          );
        }

        showToast("Agent Assigned", `Assigned ${agent ? agent.name : 'agent'} to booking ${targetBookingForAssignment}.`, "success");
        closeModal('assign-agent-modal');
        initDistributorBookingsPage();
      }
    });
  }
}

function openAssignAgentModal(bookingId) {
  targetBookingForAssignment = bookingId;
  openModal('assign-agent-modal');
}

// Quick Status Update Modal for Distributor
function openUpdateStatusModal(bookingId, currentStatus) {
  let modal = document.getElementById('distributor-status-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'distributor-status-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>Update Order Status</h3>
          <button class="btn-icon" data-close-modal>&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Progress Booking Status</label>
            <select class="form-control" id="dist-new-status-select">
              <option value="confirmed">Confirmed</option>
              <option value="processing">Processing at Depot</option>
              <option value="agent_assigned">Agent Assigned</option>
            </select>
          </div>
          <div class="form-group">
            <label>Status Note / Reason</label>
            <input type="text" class="form-control" id="dist-status-note" placeholder="e.g. Cylinder inspected and ready for pickup">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" data-close-modal>Cancel</button>
          <button class="btn btn-primary" id="confirm-status-update-btn">Save Status</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const select = modal.querySelector('#dist-new-status-select');
  const allowedNext = {
    confirmed: ['processing'],
    processing: ['agent_assigned']
  }[currentStatus] || [];
  select.innerHTML = allowedNext.map(status => `<option value="${status}">${status.replace(/_/g, ' ')}</option>`).join('');
  select.disabled = allowedNext.length === 0;

  modal.querySelector('#confirm-status-update-btn').onclick = async () => {
    const newStatus = select.value;
    const note = modal.querySelector('#dist-status-note').value;
    const user = getCurrentUser();

    try {
      await updateBookingStatus(bookingId, newStatus, note, { id: user.uid, role: 'distributor', distributorId: user.distributorId });
    } catch (err) {
      showToast("Status Update Failed", err.message, "error");
      return;
    }
    showToast("Status Updated", `Booking ${bookingId} marked as ${newStatus}.`, "success");
    closeModal('distributor-status-modal');
    initDistributorBookingsPage();
  };

  openModal('distributor-status-modal');
}

// Initialize Distributor Inventory Page
export async function initDistributorInventoryPage() {
  const user = getCurrentUser();
  if (!user) return;

  const distributorId = resolveDistributorId(user);
  const inventory = await getDistributorInventory(distributorId);

  // Set current stock displays
  const domAvail = document.getElementById('dom-available');
  const domRes = document.getElementById('dom-reserved');
  const comAvail = document.getElementById('com-available');
  const comRes = document.getElementById('com-reserved');

  if (domAvail) domAvail.textContent = inventory.domestic ? inventory.domestic.available : 0;
  if (domRes) domRes.textContent = inventory.domestic ? inventory.domestic.reserved : 0;
  if (comAvail) comAvail.textContent = inventory.commercial ? inventory.commercial.available : 0;
  if (comRes) comRes.textContent = inventory.commercial ? inventory.commercial.reserved : 0;

  // Add stock form
  const restockForm = document.getElementById('restock-form');
  if (restockForm) {
    restockForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const type = document.getElementById('restock-cylinder-type').value;
      const addedQty = parseInt(document.getElementById('restock-quantity').value, 10) || 0;

      if (addedQty <= 0) {
        showToast("Invalid Quantity", "Please enter a valid stock quantity to add.", "warning");
        return;
      }

      const inv = await getDistributorInventory(distributorId);
      if (inv[type]) {
        inv[type].available = (inv[type].available || 0) + addedQty;
      }
      await updateDistributorInventory(distributorId, inv);

      showToast("Stock Updated", `Successfully added ${addedQty} units to ${type} inventory.`, "success");
      restockForm.reset();
      initDistributorInventoryPage();
    });
  }
}

// Helper to safely set element text
function setKPI(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
