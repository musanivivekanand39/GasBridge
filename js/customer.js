/**
 * GasBridge - Customer Features & Profile Management
 */

import { getCurrentUser, setActiveUser } from "./auth.js";
import { 
  getCustomerProfile, 
  saveCustomerProfile, 
  getBookings, 
  resolveServiceAreaByPincode, 
  logAuditEvent 
} from "./firestore.js";
import { formatCurrency, formatDateTime, getStatusBadgeHTML, showToast, escapeHTML } from "./utils.js";

// Initialize Customer Dashboard
export async function initCustomerDashboard() {
  const user = getCurrentUser();
  if (!user) return;

  // 1. Time-based personalized greeting
  const greetingEl = document.getElementById('customer-greeting');
  if (greetingEl) {
    const hour = new Date().getHours();
    let timeGreeting = "Good Morning";
    if (hour >= 12 && hour < 17) timeGreeting = "Good Afternoon";
    else if (hour >= 17) timeGreeting = "Good Evening";
    greetingEl.textContent = `${timeGreeting}, ${user.name || 'Customer'} 👋`;
  }

  // 2. Fetch fresh profile
  const profile = await getCustomerProfile(user.uid) || user;

  // 3. Populate Fixed Home Address Card
  const addressCard = document.getElementById('customer-address-box');
  if (addressCard && profile.address) {
    const addr = profile.address;
    addressCard.innerHTML = `
      <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-main); margin-bottom: 0.25rem;">
        ${escapeHTML(addr.houseNo)}, ${escapeHTML(addr.street)}
      </div>
      <div style="color: var(--text-muted); font-size: 0.95rem;">
        ${escapeHTML(addr.area)}, ${escapeHTML(addr.city)}, ${escapeHTML(addr.district)}, ${escapeHTML(addr.state)} - <strong>${escapeHTML(addr.pincode)}</strong>
      </div>
    `;
  }

  // Service Area & Distributor
  const saEl = document.getElementById('customer-service-area');
  if (saEl) saEl.textContent = profile.serviceAreaName || "Shadnagar Service Area";

  const distEl = document.getElementById('customer-distributor');
  if (distEl) distEl.textContent = profile.distributorName || "Authorized GasBridge Distributor";

  // 4. Load Active/Latest Booking
  const customerBookings = await getBookings({ customerId: user.uid, paymentStatus: ['paid', 'cod_pending'] });
  const activeBooking = customerBookings.find(b => b.bookingStatus !== 'delivered' && b.bookingStatus !== 'cancelled') || customerBookings[0];

  const currentOrderCard = document.getElementById('current-order-card');
  if (currentOrderCard) {
    if (activeBooking) {
      currentOrderCard.innerHTML = `
        <div class="flex items-center justify-between" style="margin-bottom: 1rem;">
          <div>
            <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Active Booking ID</div>
            <div style="font-size: 1.25rem; font-weight: 800; color: var(--primary); font-family: 'Outfit', sans-serif;">${escapeHTML(activeBooking.bookingId)}</div>
          </div>
          <div>${getStatusBadgeHTML(activeBooking.bookingStatus)}</div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1.25rem; font-size: 0.9rem;">
          <div>
            <span style="color: var(--text-muted); font-size: 0.8rem; display: block;">Cylinder Type:</span>
            <strong>${escapeHTML(activeBooking.cylinderName || 'Domestic LPG')}</strong>
          </div>
          <div>
            <span style="color: var(--text-muted); font-size: 0.8rem; display: block;">Quantity & Total:</span>
            <strong>${activeBooking.quantity} cylinder (${formatCurrency(activeBooking.totalAmount)})</strong>
          </div>
        </div>
        <a href="customer-tracking.html?id=${activeBooking.bookingId}" class="btn btn-primary btn-sm btn-full">
          Track Live Delivery &rarr;
        </a>
      `;
    } else {
      currentOrderCard.innerHTML = `
        <div style="text-align: center; padding: 1.5rem 0;">
          <p style="color: var(--text-muted); margin-bottom: 1rem; font-size: 0.95rem;">No active cylinder delivery in progress.</p>
          <a href="customer-booking.html" class="btn btn-secondary btn-sm">Book New LPG Cylinder</a>
        </div>
      `;
    }
  }

  // 5. Load Recent Bookings Table
  const recentTableBody = document.getElementById('recent-bookings-tbody');
  if (recentTableBody) {
    if (customerBookings.length === 0) {
      recentTableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            You haven't made any LPG bookings yet.
          </td>
        </tr>
      `;
    } else {
      recentTableBody.innerHTML = customerBookings.slice(0, 5).map(b => `
        <tr>
          <td><strong style="color: var(--primary); font-family: 'Outfit', sans-serif;">${escapeHTML(b.bookingId)}</strong></td>
          <td>${formatDateTime(b.createdAt)}</td>
          <td>${escapeHTML(b.cylinderName || 'Domestic LPG')} (${b.quantity})</td>
          <td><strong>${formatCurrency(b.totalAmount)}</strong></td>
          <td>${getStatusBadgeHTML(b.paymentStatus)}</td>
          <td>${getStatusBadgeHTML(b.bookingStatus)}</td>
          <td>
            <div class="flex gap-1">
              <a href="customer-tracking.html?id=${b.bookingId}" class="btn btn-outline btn-sm" title="Track">Track</a>
              <button class="btn btn-secondary btn-sm reorder-btn" data-type="${b.cylinderType}" data-qty="${b.quantity}" title="Reorder">Reorder</button>
            </div>
          </td>
        </tr>
      `).join('');

      // Setup Reorder action
      recentTableBody.querySelectorAll('.reorder-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const type = btn.dataset.type;
          const qty = btn.dataset.qty;
          window.location.href = `customer-booking.html?type=${type}&qty=${qty}`;
        });
      });
    }
  }
}

// Initialize Profile and Address Management Page
export async function initCustomerProfile() {
  const user = getCurrentUser();
  if (!user) return;

  const profile = await getCustomerProfile(user.uid) || user;

  // Overview elements
  const overviewName = document.getElementById('prof-overview-name');
  const overviewEmail = document.getElementById('prof-overview-email');
  const cylinderDisplay = document.getElementById('prof-cylinder-type-display');
  const statusBadge = document.getElementById('prof-account-status');

  if (overviewName) overviewName.textContent = profile.name || 'Customer';
  if (overviewEmail) overviewEmail.textContent = profile.email || '';
  if (cylinderDisplay) {
    const isCommercial = profile.cylinderType === 'commercial';
    cylinderDisplay.textContent = isCommercial ? 'Commercial LPG (19.0 kg)' : 'Domestic LPG (14.2 kg)';
  }
  if (statusBadge) {
    const st = profile.status || 'approved';
    statusBadge.textContent = st.charAt(0).toUpperCase() + st.slice(1);
    if (st === 'approved') statusBadge.className = 'badge badge-success';
    else if (st === 'pending') statusBadge.className = 'badge badge-warning';
    else if (st === 'rejected') statusBadge.className = 'badge badge-danger';
    else statusBadge.className = 'badge badge-neutral';
  }

  // Fill profile input fields
  const nameInput = document.getElementById('prof-name');
  const emailInput = document.getElementById('prof-email');
  const mobileInput = document.getElementById('prof-mobile');
  const houseNoInput = document.getElementById('prof-houseNo');
  const streetInput = document.getElementById('prof-street');
  const areaInput = document.getElementById('prof-area');
  const cityInput = document.getElementById('prof-city');
  const districtInput = document.getElementById('prof-district');
  const stateInput = document.getElementById('prof-state');
  const pincodeInput = document.getElementById('prof-pincode');

  if (nameInput) nameInput.value = profile.name || '';
  if (emailInput) emailInput.value = profile.email || '';
  if (mobileInput) mobileInput.value = profile.mobile || '';

  if (profile.address) {
    if (houseNoInput) houseNoInput.value = profile.address.houseNo || '';
    if (streetInput) streetInput.value = profile.address.street || '';
    if (areaInput) areaInput.value = profile.address.area || '';
    if (cityInput) cityInput.value = profile.address.city || '';
    if (districtInput) districtInput.value = profile.address.district || '';
    if (stateInput) stateInput.value = profile.address.state || '';
    if (pincodeInput) pincodeInput.value = profile.address.pincode || '';
  }

  // Display current resolved service area & distributor
  const resolvedAreaEl = document.getElementById('prof-service-area-display');
  const resolvedDistEl = document.getElementById('prof-distributor-display');
  if (resolvedAreaEl) resolvedAreaEl.textContent = profile.serviceAreaName || 'None';
  if (resolvedDistEl) resolvedDistEl.textContent = profile.distributorName || 'None';

  // Address change form listener
  const form = document.getElementById('profile-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('save-profile-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = "Validating Pincode & Updating...";

      try {
        const newPincode = pincodeInput.value.trim();

        // Validate new pincode against service areas (Rule 12 & 40)
        const resolution = await resolveServiceAreaByPincode(newPincode);
        if (!resolution.supported) {
          showToast("Unavailable Pincode", "GasBridge is currently unavailable in this pincode.", "error");
          saveBtn.disabled = false;
          saveBtn.textContent = "Save Changes & Update Address";
          return;
        }

        const updatedProfile = {
          ...profile,
          name: nameInput.value.trim(),
          mobile: mobileInput.value.trim(),
          address: {
            houseNo: houseNoInput.value.trim(),
            street: streetInput.value.trim(),
            area: areaInput.value.trim(),
            city: cityInput.value.trim(),
            district: districtInput.value.trim(),
            state: stateInput.value.trim(),
            pincode: newPincode
          },
          serviceAreaId: resolution.serviceArea.id,
          serviceAreaName: resolution.serviceArea.name,
          distributorId: resolution.distributor ? resolution.distributor.id : '',
          distributorName: resolution.distributor ? resolution.distributor.name : 'Unassigned',
          updatedAt: new Date().toISOString()
        };

        await saveCustomerProfile(updatedProfile);

        // Update local session
        const sessionUser = {
          ...user,
          name: updatedProfile.name,
          mobile: updatedProfile.mobile,
          serviceAreaId: updatedProfile.serviceAreaId,
          distributorId: updatedProfile.distributorId
        };
        setActiveUser(sessionUser);

        await logAuditEvent(
          user.uid,
          "customer",
          "ADDRESS_UPDATED",
          user.uid,
          `Home address updated to pincode ${newPincode}. Re-resolved to ${updatedProfile.serviceAreaName}.`
        );

        if (resolvedAreaEl) resolvedAreaEl.textContent = updatedProfile.serviceAreaName;
        if (resolvedDistEl) resolvedDistEl.textContent = updatedProfile.distributorName;
        if (overviewName) overviewName.textContent = updatedProfile.name;

        showToast("Address Updated", "Your permanent home address and service area have been updated successfully.", "success");
      } catch (err) {
        showToast("Error", err.message || "Failed to update profile.", "error");
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Changes & Update Address";
      }
    });
  }
}
