/**
 * GasBridge - System Administrator Module
 * Enterprise-level management of Service Areas, Distributors, Agents,
 * Customers, Full Booking Audits, and Printable Analytical Reports.
 */

import { getCurrentUser } from "./auth.js";
import { 
  getAllCustomers, 
  getDistributors, 
  getServiceAreas, 
  getDeliveryAgents, 
  getBookings, 
  getAuditLogs,
  saveServiceArea,
  saveDistributor,
  saveDeliveryAgent,
  updateBookingStatus,
  logAuditEvent,
  approveDistributor,
  rejectDistributor,
  getPendingCustomers,
  getPendingDistributors,
  getPendingDeliveryAgents
} from "./firestore.js";
import { formatCurrency, formatDateTime, getStatusBadgeHTML, showToast, escapeHTML, openModal, closeModal } from "./utils.js";

// Initialize Admin Dashboard
export async function initAdminDashboard() {
  const user = getCurrentUser();
  if (!user) return;

  const [customers, distributors, agents, serviceAreas, bookings, auditLogs, pendingDistributors] = await Promise.all([
    getAllCustomers(),
    getDistributors(),
    getDeliveryAgents(),
    getServiceAreas(),
    getBookings(),
    getAuditLogs(),
    getPendingDistributors()
  ]);

  // Set KPIs
  const activeDistributors = distributors.filter(d => d.approvalStatus === 'approved' || (d.active && d.approvalStatus !== 'rejected'));
  const activeCustomers = customers.filter(c => c.approvalStatus === 'approved' || (c.active && c.approvalStatus !== 'rejected'));
  const activeAgents = agents.filter(a => a.approvalStatus === 'approved' || (a.active && a.approvalStatus !== 'rejected'));

  setVal('kpi-total-customers', activeCustomers.length);
  setVal('kpi-total-distributors', activeDistributors.length);
  setVal('kpi-total-agents', activeAgents.length);
  setVal('kpi-total-bookings', bookings.length);
  setVal('kpi-pending-bookings', bookings.filter(b => b.bookingStatus !== 'delivered' && b.bookingStatus !== 'cancelled').length);
  setVal('kpi-delivered-bookings', bookings.filter(b => b.bookingStatus === 'delivered').length);
  setVal('kpi-cancelled-bookings', bookings.filter(b => b.bookingStatus === 'cancelled').length);
  setVal('kpi-active-areas', serviceAreas.length);

  // Check pending distributor approvals alert banner (Rule 4, 33)
  const pendingAlert = document.getElementById('admin-pending-alert');
  const pendingText = document.getElementById('pending-alert-text');
  const pendingBadge = document.getElementById('pending-distributors-count-badge');
  if (pendingBadge) pendingBadge.textContent = `${pendingDistributors.length} Pending`;

  if (pendingAlert && pendingText) {
    if (pendingDistributors.length > 0) {
      pendingAlert.style.display = 'flex';
      pendingText.textContent = `${pendingDistributors.length} distributor registration request(s) awaiting Administrator approval.`;
    } else {
      pendingAlert.style.display = 'none';
    }
  }

  // Render DISTRIBUTOR REGISTRATION REQUESTS Table (Rule 4)
  const distTable = document.getElementById('admin-pending-distributors-tbody');
  if (distTable) {
    if (pendingDistributors.length === 0) {
      distTable.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            <div style="font-size: 1.25rem; margin-bottom: 0.35rem;">✅</div>
            <div>No pending distributor registration requests awaiting approval. All agencies are up to date!</div>
          </td>
        </tr>
      `;
    } else {
      distTable.innerHTML = pendingDistributors.map(d => `
        <tr>
          <td><strong>${escapeHTML(d.name || d.contactPerson || 'Distributor')}</strong></td>
          <td><strong style="color: var(--primary);">${escapeHTML(d.businessName || d.name || 'LPG Agency')}</strong></td>
          <td>${escapeHTML(d.mobile || '-')}</td>
          <td>${escapeHTML(d.email || '-')}</td>
          <td style="font-size: 0.85rem; max-width: 180px;">${escapeHTML(d.address || '-')}</td>
          <td><span class="badge badge-info">${escapeHTML(d.pincode || '-')}</span></td>
          <td style="font-size: 0.82rem;">${formatDateTime(d.createdAt)}</td>
          <td><span class="badge badge-warning">Pending</span></td>
          <td style="text-align: right; white-space: nowrap;">
            <button class="btn btn-sm btn-outline btn-view-dist" data-id="${escapeHTML(d.id)}" style="margin-right: 0.25rem; font-weight: 600;">
              View
            </button>
            <button class="btn btn-sm btn-primary btn-approve-dist" data-id="${escapeHTML(d.id)}" style="margin-right: 0.25rem; font-weight: 600;">
              Approve
            </button>
            <button class="btn btn-sm btn-outline-danger btn-reject-dist" data-id="${escapeHTML(d.id)}" style="font-weight: 600;">
              Reject
            </button>
          </td>
        </tr>
      `).join('');

      // Bind View Modal
      distTable.querySelectorAll('.btn-view-dist').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          const dist = pendingDistributors.find(x => x.id === id);
          if (dist) {
            const bodyEl = document.getElementById('view-distributor-body');
            if (bodyEl) {
              bodyEl.innerHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Applicant Full Name</span>
                    <strong style="font-size: 1.05rem;">${escapeHTML(dist.name || dist.contactPerson || '-')}</strong>
                  </div>
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Agency / Business Name</span>
                    <strong style="font-size: 1.05rem; color: var(--primary);">${escapeHTML(dist.businessName || dist.name || '-')}</strong>
                  </div>
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Mobile Number</span>
                    <div>${escapeHTML(dist.mobile || '-')}</div>
                  </div>
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Email Address</span>
                    <div>${escapeHTML(dist.email || '-')}</div>
                  </div>
                </div>
                <div style="margin-bottom: 1rem; padding: 0.75rem; background: var(--bg-alt); border-radius: var(--radius-sm);">
                  <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; display: block;">Operating Depot Address</span>
                  <div>${escapeHTML(dist.address || '-')}</div>
                  <div style="margin-top: 0.35rem; font-size: 0.85rem;">Pincode: <strong>${escapeHTML(dist.pincode || '-')}</strong></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--text-muted);">
                  <span>Submitted Date: ${formatDateTime(dist.createdAt)}</span>
                  <span>Status: <strong class="badge badge-warning">Pending Admin Review</strong></span>
                </div>
              `;
            }
            openModal('view-distributor-modal');
          }
        });
      });

      // Bind Approve
      distTable.querySelectorAll('.btn-approve-dist').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          try {
            e.currentTarget.disabled = true;
            e.currentTarget.textContent = 'Approving...';
            await approveDistributor(id, getCurrentUser()?.uid);
            showToast("Distributor Approved", "Distributor approved successfully! Notification recorded.", "success");
            await initAdminDashboard();
          } catch (err) {
            showToast("Approval Failed", err.message || "Could not approve distributor.", "error");
            e.currentTarget.disabled = false;
            e.currentTarget.textContent = 'Approve';
          }
        });
      });

      // Bind Reject
      distTable.querySelectorAll('.btn-reject-dist').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          const confirmed = confirm("Are you sure you want to reject this distributor application?");
          if (confirmed) {
            try {
              e.currentTarget.disabled = true;
              e.currentTarget.textContent = 'Rejecting...';
              await rejectDistributor(id, "Administrative review criteria not met.", getCurrentUser()?.uid);
              showToast("Distributor Rejected", "Distributor registration declined.", "info");
              await initAdminDashboard();
            } catch (err) {
              showToast("Rejection Failed", err.message || "Could not reject application.", "error");
              e.currentTarget.disabled = false;
              e.currentTarget.textContent = 'Reject';
            }
          }
        });
      });
    }
  }

  // Render Recent Bookings
  const bTable = document.getElementById('admin-recent-bookings-tbody');
  if (bTable) {
    bTable.innerHTML = bookings.slice(0, 6).map(b => `
      <tr>
        <td><strong style="color: var(--primary); font-family: 'Outfit', sans-serif;">${escapeHTML(b.bookingId)}</strong></td>
        <td>${escapeHTML(b.customerName)}</td>
        <td>${escapeHTML(b.deliveryAddress.city)} (PIN: ${escapeHTML(b.deliveryAddress.pincode)})</td>
        <td>${escapeHTML(b.cylinderName || 'Domestic LPG')}</td>
        <td><strong>${formatCurrency(b.totalAmount)}</strong></td>
        <td>${getStatusBadgeHTML(b.bookingStatus)}</td>
        <td>${formatDateTime(b.createdAt)}</td>
      </tr>
    `).join('');
  }

  // Render System Audit Logs (Snippet)
  const auditContainer = document.getElementById('admin-audit-log-snippet');
  if (auditContainer) {
    auditContainer.innerHTML = auditLogs.slice(0, 6).map(log => `
      <div style="padding: 0.75rem 0; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; font-size: 0.88rem;">
        <div>
          <strong style="color: var(--primary); font-size: 0.8rem; text-transform: uppercase;">${escapeHTML(log.action)}</strong>
          <p style="color: var(--text-muted); font-size: 0.82rem; margin: 0.15rem 0;">${escapeHTML(log.details)}</p>
        </div>
        <span style="font-size: 0.75rem; color: var(--text-light); white-space: nowrap;">${formatDateTime(log.timestamp)}</span>
      </div>
    `).join('');
  }
}

// Initialize Customers Management Page
export async function initAdminCustomersPage() {
  const tbody = document.getElementById('admin-customers-tbody');
  const pendingTbody = document.getElementById('admin-pending-customers-tbody');
  const pendingBadge = document.getElementById('pending-customers-count-badge');
  const searchInput = document.getElementById('customer-search-input');

  async function loadAndRender() {
    const customers = await getAllCustomers();
    const pendingList = customers.filter(c => c.status === 'pending' || c.approvalStatus === 'pending');
    const activeList = customers.filter(c => c.status === 'approved' || c.approvalStatus === 'approved');

    if (pendingBadge) pendingBadge.textContent = `${pendingList.length} Pending`;

    // Render Pending Table
    if (pendingTbody) {
      if (pendingList.length === 0) {
        pendingTbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">
              <div style="font-size: 1.25rem; margin-bottom: 0.35rem;">✅</div>
              <div>No pending customer registrations awaiting review. All accounts are up to date!</div>
            </td>
          </tr>
        `;
      } else {
        pendingTbody.innerHTML = pendingList.map(c => `
          <tr>
            <td><strong>${escapeHTML(c.name)}</strong></td>
            <td>
              <div>${escapeHTML(c.email)}</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">${escapeHTML(c.mobile)}</div>
            </td>
            <td style="font-size: 0.85rem;">
              ${escapeHTML(c.address ? `${c.address.houseNo}, ${c.address.street}, ${c.address.city}` : 'N/A')}
            </td>
            <td><span class="badge badge-info">${escapeHTML(c.address ? c.address.pincode : '')}</span></td>
            <td>
              <span class="badge badge-warning">Pending Distributor Approval</span>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
                Routed to: ${escapeHTML(c.distributorName || 'Assigned Distributor')}
              </div>
            </td>
            <td style="text-align: right; white-space: nowrap;">
              <span style="font-size: 0.8rem; color: var(--text-muted); font-style: italic;">
                Distributor Approval Required
              </span>
            </td>
          </tr>
        `).join('');
      }
    }

    // Render Active Customers Table
    function renderActiveList(list) {
      if (!tbody) return;
      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">No authorized customers found.</td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(c => `
        <tr>
          <td><strong>${escapeHTML(c.name)}</strong></td>
          <td>${escapeHTML(c.email)}</td>
          <td>${escapeHTML(c.mobile)}</td>
          <td>${escapeHTML(c.address ? `${c.address.houseNo}, ${c.address.street}, ${c.address.city}` : 'N/A')}</td>
          <td><span class="badge badge-info">${escapeHTML(c.address ? c.address.pincode : '')}</span></td>
          <td><span class="badge ${c.active ? 'badge-success' : 'badge-danger'}">${c.active ? 'Active & Approved' : 'Inactive'}</span></td>
          <td>
            <button class="btn btn-outline btn-sm toggle-cust-btn" data-id="${c.uid}">
              ${c.active ? 'Deactivate' : 'Activate'}
            </button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.toggle-cust-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          const target = customers.find(x => x.uid === id);
          if (target) {
            target.active = !target.active;
            localStorage.setItem('gasbridge_demo_customers', JSON.stringify(customers));
            showToast("Status Updated", `Customer account ${target.name} has been ${target.active ? 'activated' : 'deactivated'}.`, "info");
            await loadAndRender();
          }
        });
      });
    }

    renderActiveList(activeList);

    if (searchInput) {
      searchInput.oninput = (e) => {
        const q = e.target.value.toLowerCase();
        const filtered = activeList.filter(c => 
          c.name.toLowerCase().includes(q) || 
          c.email.toLowerCase().includes(q) || 
          c.mobile.includes(q) ||
          (c.address && c.address.pincode.includes(q))
        );
        renderActiveList(filtered);
      };
    }
  }

  await loadAndRender();
}

// Initialize Service Areas Page
export async function initAdminServiceAreasPage() {
  const serviceAreas = await getServiceAreas();
  const distributors = await getDistributors();
  const tbody = document.getElementById('admin-service-areas-tbody');

  function renderAreas() {
    if (!tbody) return;
    tbody.innerHTML = serviceAreas.map(sa => {
      const dist = distributors.find(d => d.id === sa.distributorId);
      return `
        <tr>
          <td><strong>${escapeHTML(sa.name)}</strong></td>
          <td>${escapeHTML(sa.city)}, ${escapeHTML(sa.district)}</td>
          <td>
            ${sa.pincodes.map(pin => `<span class="badge badge-info" style="margin-right: 4px;">${escapeHTML(pin)}</span>`).join('')}
          </td>
          <td><strong style="color: var(--primary);">${escapeHTML(dist ? dist.name : 'Unassigned')}</strong></td>
          <td><span class="badge ${sa.active ? 'badge-success' : 'badge-danger'}">${sa.active ? 'Active' : 'Inactive'}</span></td>
        </tr>
      `;
    }).join('');
  }

  renderAreas();

  // Populate distributor options in add modal
  const distSelect = document.getElementById('new-sa-distributor');
  if (distSelect) {
    distSelect.innerHTML = distributors.map(d => `<option value="${d.id}">${escapeHTML(d.name)}</option>`).join('');
  }

  // Add Service Area Form
  const form = document.getElementById('add-service-area-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('new-sa-name').value.trim();
      const city = document.getElementById('new-sa-city').value.trim();
      const district = document.getElementById('new-sa-district').value.trim();
      const pincodesStr = document.getElementById('new-sa-pincodes').value.trim();
      const distId = document.getElementById('new-sa-distributor').value;

      const pincodes = pincodesStr.split(',').map(p => p.trim()).filter(Boolean);

      const newArea = {
        id: "sa-" + Date.now().toString().slice(-4),
        name,
        city,
        district,
        state: "Telangana",
        pincodes,
        distributorId: distId,
        active: true
      };

      await saveServiceArea(newArea);
      showToast("Service Area Added", `Added ${name} mapped to ${pincodes.join(', ')}.`, "success");
      form.reset();
      closeModal('add-area-modal');
      serviceAreas.push(newArea);
      renderAreas();
    });
  }
}

// Initialize Reports Page
export async function initAdminReportsPage() {
  const bookings = await getBookings();
  const customers = await getAllCustomers();
  const distributors = await getDistributors();

  // Aggregate stats
  const totalRevenue = bookings.reduce((sum, b) => sum + (b.paymentStatus === 'paid' ? b.totalAmount : 0), 0);
  const domesticCount = bookings.filter(b => b.cylinderType === 'domestic').reduce((sum, b) => sum + b.quantity, 0);
  const commercialCount = bookings.filter(b => b.cylinderType === 'commercial').reduce((sum, b) => sum + b.quantity, 0);

  setVal('report-total-rev', formatCurrency(totalRevenue));
  setVal('report-total-bookings', bookings.length);
  setVal('report-dom-cylinders', domesticCount);
  setVal('report-com-cylinders', commercialCount);
  setVal('report-total-cust', customers.length);
  setVal('report-total-dist', distributors.length);

  // Print Report Button
  const printBtn = document.getElementById('print-report-btn');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      window.print();
    });
  }
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
