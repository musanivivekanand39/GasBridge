/**
 * GasBridge - Customer LPG Cylinder Booking Module
 * Strictly adheres to rule: No location picker, automatic fixed home address resolution.
 */

import { getCurrentUser } from "./auth.js";
import { getCustomerProfile, checkInventoryAvailable } from "./firestore.js";
import { LPG_CYLINDER_TYPES } from "./firebase-config.js";
import { formatCurrency, showToast, escapeHTML } from "./utils.js";
import { openDemoPaymentModal } from "./payment.js";

let currentCustomer = null;
let selectedCylinderType = 'domestic';
let selectedQuantity = 1;

export async function initBookingPage() {
  const user = getCurrentUser();
  if (!user) return;

  currentCustomer = await getCustomerProfile(user.uid) || user;
  selectedCylinderType = currentCustomer.cylinderType || 'domestic';

  // 1. Populate Fixed Delivery Address (Read-only, NO location picker)
  const addressDisplay = document.getElementById('fixed-address-display');
  if (addressDisplay && currentCustomer.address) {
    const a = currentCustomer.address;
    addressDisplay.innerHTML = `
      <div style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin-bottom: 0.25rem;">
        ${escapeHTML(a.houseNo || '')}, ${escapeHTML(a.street || '')}
      </div>
      <div style="color: var(--text-muted); font-size: 0.92rem;">
        ${escapeHTML(a.area || '')}, ${escapeHTML(a.city || '')}, ${escapeHTML(a.district || '')}, ${escapeHTML(a.state || '')} - <strong>${escapeHTML(a.pincode || '')}</strong>
      </div>
      <div style="margin-top: 0.5rem; font-size: 0.8rem; color: var(--primary); font-weight: 600;">
        ✓ Permanent Home Address (Loaded from Registered Profile)
      </div>
    `;
  }

  // 2. Automatically determined Service Area & Distributor
  const saDisplay = document.getElementById('service-area-display');
  const distDisplay = document.getElementById('distributor-display');
  if (saDisplay) saDisplay.textContent = currentCustomer.serviceAreaName || 'Service Area';
  if (distDisplay) distDisplay.textContent = currentCustomer.distributorName || 'Authorized GasBridge Distributor';

  // 3. Render Registered LPG Connection Card
  renderConnectionCard();

  // 4. Quantity Selector Listener
  const qtySelect = document.getElementById('booking-quantity');
  if (qtySelect) {
    qtySelect.value = selectedQuantity;
    qtySelect.addEventListener('change', (e) => {
      selectedQuantity = parseInt(e.target.value, 10) || 1;
      updateOrderSummary();
    });
  }

  // 5. Setup Proceed to Payment Button
  const proceedBtn = document.getElementById('proceed-to-payment-btn');
  const paymentMethodHint = document.getElementById('payment-method-hint');
  document.querySelectorAll('input[name="payment-method"]').forEach(input => {
    input.addEventListener('change', () => {
      const hints = {
        upi_qr: 'UPI checkout uses a QR code. This project runs test payments only; no real money is charged.',
        card: 'Card checkout is simulated for this project. Do not enter real card details.',
        cod: 'Pay the delivery agent in cash when your cylinder arrives. No online payment is taken now.'
      };
      if (paymentMethodHint) paymentMethodHint.textContent = hints[input.value];
    });
  });
  if (proceedBtn) {
    proceedBtn.addEventListener('click', async () => {
      proceedBtn.disabled = true;
      proceedBtn.textContent = "Checking Distributor Inventory...";

      const distributorId = currentCustomer.distributorId || 'dist-01';
      let isAvailable;
      try {
        isAvailable = await checkInventoryAvailable(distributorId, selectedCylinderType, selectedQuantity);
      } catch (error) {
        showToast("Inventory Check Failed", error.message || "Could not check distributor stock.", "error");
        proceedBtn.disabled = false;
        proceedBtn.textContent = "Proceed to Demo Payment \u2192";
        return;
      }

      if (!isAvailable) {
        showToast("Stock Unavailable", `LPG ${selectedCylinderType} cylinders are currently unavailable at your distributor depot.`, "error");
        proceedBtn.disabled = false;
        proceedBtn.textContent = "Proceed to Demo Payment \u2192";
        return;
      }

      const cylinderMeta = LPG_CYLINDER_TYPES[selectedCylinderType] || LPG_CYLINDER_TYPES.domestic;
      const totalAmount = cylinderMeta.price * selectedQuantity;
      const paymentMethod = document.querySelector('input[name="payment-method"]:checked')?.value || 'upi_qr';

      // Open Demo Payment Modal
      await openDemoPaymentModal({
        customer: currentCustomer,
        cylinderType: selectedCylinderType,
        cylinderMeta,
        quantity: selectedQuantity,
        totalAmount,
        distributorId,
        paymentMethod
      });

      proceedBtn.disabled = false;
      proceedBtn.textContent = "Proceed to Demo Payment \u2192";
    });
  }

  // Initial calculation
  updateOrderSummary();
}

function renderConnectionCard() {
  const meta = LPG_CYLINDER_TYPES[selectedCylinderType] || LPG_CYLINDER_TYPES.domestic;
  const badgeEl = document.getElementById('badge-connection-type');
  const titleEl = document.getElementById('connection-title');
  const descEl = document.getElementById('connection-desc');
  const priceEl = document.getElementById('connection-price');

  if (badgeEl) {
    badgeEl.textContent = `${meta.name} (${meta.weight})`;
    badgeEl.className = `connection-badge ${selectedCylinderType}`;
  }
  if (titleEl) {
    titleEl.textContent = `${meta.name} (${meta.weight})`;
  }
  if (descEl) {
    descEl.textContent = meta.description || (selectedCylinderType === 'commercial' 
      ? 'Non-domestic LPG cylinder tailored for commercial kitchens, hotels, and businesses.' 
      : 'Standard subsidized household cooking cylinder for residential kitchen use.');
  }
  if (priceEl) {
    priceEl.textContent = formatCurrency(meta.price);
  }
}

function updateOrderSummary() {
  const meta = LPG_CYLINDER_TYPES[selectedCylinderType] || LPG_CYLINDER_TYPES.domestic;
  const total = meta.price * selectedQuantity;

  const sumTypeEl = document.getElementById('summary-cylinder-type');
  const sumWeightEl = document.getElementById('summary-cylinder-weight');
  const sumPriceEl = document.getElementById('summary-unit-price');
  const sumQtyEl = document.getElementById('summary-quantity');
  const sumTotalEl = document.getElementById('summary-total-amount');

  if (sumTypeEl) sumTypeEl.textContent = meta.name;
  if (sumWeightEl) sumWeightEl.textContent = meta.weight;
  if (sumPriceEl) sumPriceEl.textContent = formatCurrency(meta.price);
  if (sumQtyEl) sumQtyEl.textContent = selectedQuantity;
  if (sumTotalEl) sumTotalEl.textContent = formatCurrency(total);
}
