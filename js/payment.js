/**
 * GasBridge - Academic Demo QR Payment Processing Module
 * Fully conforms to requirements:
 * 1. Realistic DEMO payment flow (No real money, no bank credentials, no CVV/cards/UPI PIN).
 * 2. Scannable Dynamic Demo QR Code encoding Booking ID, Amount, Transaction Ref.
 * 3. Two-step confirmation: "I've Scanned the QR" -> "Confirm Demo Payment".
 * 4. Distinct failure simulation option with retry mechanism.
 * 5. Payment duplicate protection.
 * 6. Records payment in payments/{paymentId} with paymentMethod: "demo_qr".
 */

import { 
  createBooking, 
  getBookingById, 
  deductInventoryStock,
  logAuditEvent, 
  savePaymentRecord,
  getPaymentByBookingId,
  getDistributorById,
  createNotification
} from "./firestore.js";
import { formatCurrency, formatDateTime, showToast, generateBookingId } from "./utils.js";
import { generateQRCodeSVG } from "./qrcode.js";
import { isDemo } from "./firebase.js";

let activeOrderContext = null;
let currentBooking = null;
let currentTransactionRef = null;

// Generate unique transaction reference: GBPAY-XXXXXXXX
function generateTransactionRef() {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let ref = 'GBPAY-';
  for (let i = 0; i < 8; i++) {
    ref += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return ref;
}

// Ensure Demo Payment Modal exists in DOM
function ensurePaymentModalExists() {
  let modal = document.getElementById('demo-payment-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'demo-payment-modal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 520px; width: 92%; border-radius: var(--radius-lg); overflow: hidden; box-shadow: 0 20px 45px rgba(0,0,0,0.25);">
      <!-- Modal Header -->
      <div class="modal-header" style="background: linear-gradient(135deg, #15803d 0%, #166534 100%); color: white; padding: 1.25rem 1.5rem;">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="background: rgba(255,255,255,0.18); width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.25rem;">
            📱
          </div>
          <div>
            <h3 style="font-size: 1.15rem; margin: 0; color: #ffffff; font-family: 'Outfit', sans-serif;">DEMO PAYMENT</h3>
            <span style="font-size: 0.76rem; color: #bbf7d0; display: block;">Scan this QR using your phone</span>
          </div>
        </div>
        <button class="btn-icon" id="close-payment-modal-btn" aria-label="Close" style="color: white; background: rgba(255,255,255,0.12); border-radius: 50%;">&times;</button>
      </div>

      <!-- Academic Disclaimer Banner -->
      <div style="background: #fffbeb; border-bottom: 1px solid #fef3c7; color: #92400e; padding: 0.6rem 1.25rem; font-size: 0.78rem; text-align: center; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 0.4rem;">
        <span>🎓</span>
        <span>Academic Demo – No Real Money Is Transferred</span>
      </div>

      <div class="modal-body" style="padding: 1.5rem;">
        <!-- Container 1: QR Display View -->
        <div id="payment-view-qr">
          <div style="background: #f8fafc; border: 1px solid var(--border); padding: 0.9rem 1.15rem; border-radius: var(--radius-md); margin-bottom: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
              <span style="color: var(--text-muted); font-size: 0.85rem;">Booking ID:</span>
              <strong id="qr-booking-id" style="font-family: 'Outfit', sans-serif; color: var(--primary); font-size: 1rem;">-</strong>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
              <span style="color: var(--text-muted); font-size: 0.85rem;">Order Item:</span>
              <span id="qr-order-item" style="font-size: 0.88rem; font-weight: 600;">-</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
              <span style="color: var(--text-muted); font-size: 0.85rem;">Payable Amount:</span>
              <strong id="qr-pay-amount" style="font-size: 1.25rem; color: var(--text-main); font-family: 'Outfit', sans-serif;">₹0</strong>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; color: var(--text-muted); border-top: 1px dashed var(--border); padding-top: 0.35rem; margin-top: 0.35rem;">
              <span>Demo Transaction Ref:</span>
              <code id="qr-tx-ref" style="background: #e2e8f0; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 700; color: #334155;">-</code>
            </div>
          </div>

          <!-- Dynamic Scannable QR Code Container -->
          <div style="text-align: center; margin-bottom: 1.25rem;">
            <div id="qr-code-svg-container" style="display: inline-block; padding: 12px; background: white; border: 2px solid #e2e8f0; border-radius: var(--radius-lg); box-shadow: 0 4px 14px rgba(0,0,0,0.06);">
              <!-- SVG QR inserted dynamically -->
            </div>
            <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.6rem;">
              Point your smartphone camera at this code to view demo order details
            </div>
          </div>

          <!-- Already Paid Banner (Duplicate Protection) -->
          <div id="payment-already-paid-alert" style="display: none; background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; padding: 0.75rem 1rem; border-radius: var(--radius-md); font-size: 0.88rem; margin-bottom: 1rem; text-align: center;">
            <strong>✓ Payment already completed.</strong>
            <p style="margin: 0.25rem 0 0 0; font-size: 0.8rem;">This booking has already been paid and confirmed.</p>
          </div>

          <!-- QR Action Buttons -->
          <div id="qr-actions-container" style="display: flex; flex-direction: column; gap: 0.65rem;">
            <button type="button" class="btn btn-primary btn-full btn-lg" id="btn-scanned-qr" style="font-size: 1rem; padding: 0.85rem;">
              I've Scanned the QR &rarr;
            </button>
            <div style="display: flex; gap: 0.5rem;">
              <button type="button" class="btn btn-outline btn-sm" id="btn-simulate-fail" style="flex: 1; color: #dc2626; border-color: #fca5a5;">
                Simulate Payment Failure
              </button>
              <button type="button" class="btn btn-outline btn-sm" id="btn-cancel-payment" style="flex: 1;">
                Cancel
              </button>
            </div>
          </div>
        </div>

        <!-- Container 2: Confirmation Step View -->
        <div id="payment-view-confirm" style="display: none; text-align: center; padding: 1rem 0;">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: #dcfce7; color: #15803d; font-size: 1.75rem; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
            ✓
          </div>
          <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.35rem; margin-bottom: 0.4rem; color: var(--text-main);">Confirm Demo Payment</h3>
          <p style="color: var(--text-muted); font-size: 0.88rem; line-height: 1.5; max-width: 380px; margin: 0 auto 1.25rem;">
            Confirm that you have scanned the QR code on your phone. In this academic demo, clicking Confirm Payment will finalize your cylinder booking.
          </p>

          <div style="background: #f1f5f9; border-radius: var(--radius-md); padding: 0.85rem; margin-bottom: 1.5rem; text-align: left; font-size: 0.85rem;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
              <span style="color: var(--text-muted);">Amount to Confirm:</span>
              <strong id="confirm-pay-amount" style="color: var(--primary); font-size: 1.1rem;">₹0</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-muted);">Simulation Mode:</span>
              <span class="badge badge-warning" style="font-size: 0.72rem;">Academic Demo - No Real Money</span>
            </div>
          </div>

          <div style="display: flex; gap: 0.75rem;">
            <button type="button" class="btn btn-outline" id="btn-back-to-qr" style="flex: 1;">
              &larr; Back / Cancel
            </button>
            <button type="button" class="btn btn-primary" id="btn-confirm-final-payment" style="flex: 1; font-weight: 700;">
              Confirm Payment
            </button>
          </div>
        </div>

        <!-- Container 3: Failure View -->
        <div id="payment-view-failure" style="display: none; text-align: center; padding: 1.5rem 0;">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: #fee2e2; color: #dc2626; font-size: 1.75rem; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
            ✕
          </div>
          <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.35rem; margin-bottom: 0.4rem; color: #dc2626;">Payment Status: Failed</h3>
          <p style="color: var(--text-muted); font-size: 0.9rem; line-height: 1.5; margin-bottom: 1.5rem;">
            Demo payment failed.
          </p>
          <div style="display: flex; gap: 0.75rem; justify-content: center;">
            <button type="button" class="btn btn-primary" id="btn-retry-payment" style="padding: 0.75rem 1.75rem;">
              Retry Payment
            </button>
            <button type="button" class="btn btn-outline" id="btn-dismiss-failure" style="padding: 0.75rem 1.25rem;">
              Close
            </button>
          </div>
        </div>

        <!-- Container 4: Success View -->
        <div id="payment-view-success" style="display: none; text-align: center; padding: 1rem 0;">
          <div style="width: 60px; height: 60px; border-radius: 50%; background: #dcfce7; color: #15803d; font-size: 2rem; display: flex; align-items: center; justify-content: center; margin: 0 auto 0.75rem;">
            ✓
          </div>
          <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.45rem; color: #15803d; margin-bottom: 0.25rem;">✓ Payment Successful</h3>
          <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1.25rem;">
            Your cylinder refill order has been confirmed.
          </p>

          <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem 1.25rem; margin-bottom: 1.5rem; text-align: left; font-size: 0.86rem; line-height: 1.6;">
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; margin-bottom: 0.4rem;">
              <span style="color: var(--text-muted);">Booking ID:</span>
              <strong id="success-booking-id" style="color: var(--primary); font-family: 'Outfit', sans-serif;">-</strong>
            </div>
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; margin-bottom: 0.4rem;">
              <span style="color: var(--text-muted);">Transaction ID:</span>
              <strong id="success-tx-id" style="color: var(--text-main); font-family: monospace;">-</strong>
            </div>
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; margin-bottom: 0.4rem;">
              <span style="color: var(--text-muted);">Amount:</span>
              <strong id="success-amount" style="color: var(--text-main);">-</strong>
            </div>
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; margin-bottom: 0.4rem;">
              <span style="color: var(--text-muted);">Payment Method:</span>
              <span style="font-weight: 600;">Demo QR</span>
            </div>
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; margin-bottom: 0.4rem;">
              <span style="color: var(--text-muted);">Payment Status:</span>
              <span class="badge badge-success" style="font-size: 0.72rem;">Paid</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-muted);">Date / Time:</span>
              <span id="success-datetime" style="color: var(--text-main); font-size: 0.82rem;">-</span>
            </div>
          </div>

          <div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
            <a href="#" class="btn btn-primary" id="btn-view-booking" style="flex: 1; padding: 0.75rem 1.25rem;">
              View Booking &rarr;
            </a>
            <a href="customer-dashboard.html" class="btn btn-outline" style="flex: 1; padding: 0.75rem 1.25rem;">
              Go to Dashboard
            </a>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close handlers
  modal.querySelector('#close-payment-modal-btn').addEventListener('click', closeModalHandler);
  modal.querySelector('#btn-cancel-payment').addEventListener('click', closeModalHandler);
  modal.querySelector('#btn-dismiss-failure').addEventListener('click', closeModalHandler);

  // Step transitions
  modal.querySelector('#btn-scanned-qr').addEventListener('click', showConfirmationView);
  modal.querySelector('#btn-back-to-qr').addEventListener('click', showQRView);
  modal.querySelector('#btn-simulate-fail').addEventListener('click', handlePaymentFailure);
  modal.querySelector('#btn-retry-payment').addEventListener('click', showQRView);
  modal.querySelector('#btn-confirm-final-payment').addEventListener('click', handlePaymentSuccess);

  return modal;
}

function closeModalHandler() {
  const modal = document.getElementById('demo-payment-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function switchView(viewName) {
  const modal = document.getElementById('demo-payment-modal');
  if (!modal) return;
  modal.querySelector('#payment-view-qr').style.display = viewName === 'qr' ? 'block' : 'none';
  modal.querySelector('#payment-view-confirm').style.display = viewName === 'confirm' ? 'block' : 'none';
  modal.querySelector('#payment-view-failure').style.display = viewName === 'failure' ? 'block' : 'none';
  modal.querySelector('#payment-view-success').style.display = viewName === 'success' ? 'block' : 'none';
}

function showQRView() {
  switchView('qr');
}

function showConfirmationView() {
  const modal = document.getElementById('demo-payment-modal');
  const confirmAmt = modal.querySelector('#confirm-pay-amount');
  if (confirmAmt && activeOrderContext) {
    confirmAmt.textContent = formatCurrency(activeOrderContext.totalAmount);
  }
  switchView('confirm');
}

/**
 * Open Demo Payment Modal for an order context.
 * Adheres to rule 26: Duplicate Protection & Rule 21: Dynamic Scannable QR.
 */
export async function openDemoPaymentModal(context) {
  activeOrderContext = context;
  const modal = ensurePaymentModalExists();

  // Create initial booking in database or check existing
  let bookingId = context.bookingId || generateBookingId();
  if (!context.bookingId) {
    currentBooking = {
      bookingId,
      customerId: context.customer.uid,
      customerName: context.customer.name,
      customerMobile: context.customer.mobile,
      deliveryAddress: context.customer.address,
      serviceAreaId: context.customer.serviceAreaId,
      distributorId: context.distributorId,
      deliveryAgentId: "",
      cylinderType: context.cylinderType,
      cylinderName: context.cylinderMeta.name,
      quantity: context.quantity,
      unitPrice: context.cylinderMeta.price,
      totalAmount: context.totalAmount,
      paymentId: "",
      paymentStatus: "unpaid",
      bookingStatus: "pending_payment",
      createdAt: new Date().toISOString()
    };
    try {
      currentBooking = await createBooking(currentBooking);
    } catch (err) {
      showToast("Booking Could Not Be Saved", err.message || "Please try again.", "error");
      return;
    }
  } else {
    // Check if already paid (Duplicate protection - Rule 26)
    const existing = await getBookingById(bookingId);
    if (existing && existing.paymentStatus === 'paid') {
      currentBooking = existing;
      modal.querySelector('#payment-already-paid-alert').style.display = 'block';
      modal.querySelector('#qr-actions-container').style.display = 'none';
      switchView('qr');
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      return;
    }
    currentBooking = existing || { bookingId, ...context };
  }

  if (currentBooking.paymentStatus === 'paid') {
    modal.querySelector('#payment-already-paid-alert').style.display = 'block';
    modal.querySelector('#qr-actions-container').style.display = 'none';
    switchView('qr');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    return;
  }
  currentTransactionRef = generateTransactionRef();
  if (currentBooking.bookingStatus !== 'pending_payment' || currentBooking.paymentStatus !== 'unpaid') {
    showToast("Booking Unavailable", "This booking is not awaiting payment.", "error");
    return;
  }

  // Populate QR fields
  modal.querySelector('#qr-booking-id').textContent = bookingId;
  modal.querySelector('#qr-order-item').textContent = `${context.quantity}x ${context.cylinderMeta.name}`;
  modal.querySelector('#qr-pay-amount').textContent = formatCurrency(context.totalAmount);
  modal.querySelector('#qr-tx-ref').textContent = currentTransactionRef;

  modal.querySelector('#payment-already-paid-alert').style.display = 'none';
  modal.querySelector('#qr-actions-container').style.display = 'flex';

  // Generate dynamic, real scannable QR Code containing booking info
  // Rule 21: QR must contain GasBridge, Booking ID, Amount, Demo Transaction Reference
  const qrPayload = [
    `GasBridge Demo Payment`,
    `Booking ID: ${bookingId}`,
    `Amount: ${formatCurrency(context.totalAmount)}`,
    `Payment: DEMO`,
    `Ref: ${currentTransactionRef}`,
    `Academic Demo - No Real Money Transferred`
  ].join('\n');

  const qrSvg = generateQRCodeSVG(qrPayload, {
    size: 210,
    darkColor: "#14532d"
  });

  const svgContainer = modal.querySelector('#qr-code-svg-container');
  svgContainer.innerHTML = qrSvg;

  switchView('qr');
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

/**
 * Handle simulated payment failure (Rule 24).
 * Explicit user choice, not randomly generated.
 */
async function handlePaymentFailure() {
  const modal = document.getElementById('demo-payment-modal');

  await logAuditEvent(
    activeOrderContext.customer.uid,
    "customer",
    "PAYMENT_FAILED",
    currentBooking ? currentBooking.bookingId : 'unknown',
    `Demo payment simulated failure for transaction ${currentTransactionRef}.`
  );

  switchView('failure');
  showToast("Demo Payment Failed", "Simulated payment failure triggered. You can retry anytime.", "error");
}

/**
 * Handle simulated payment success (Rule 20, 22, 25).
 * Only completes after "I've Scanned the QR" + "Confirm Demo Payment".
 */
async function handlePaymentSuccess() {
  const modal = document.getElementById('demo-payment-modal');
  const confirmBtn = modal.querySelector('#btn-confirm-final-payment');
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Processing Demo Payment...";

  // Brief latency simulation (700ms)
  await new Promise(r => setTimeout(r, 700));

  try {
    const bookingId = currentBooking.bookingId;
    const latestBooking = await getBookingById(bookingId);
    if (!latestBooking || latestBooking.paymentStatus === 'paid') {
      throw new Error(latestBooking ? "This booking has already been paid." : "The pending booking could not be found.");
    }
    if (latestBooking.customerId !== activeOrderContext.customer.uid || latestBooking.bookingStatus !== 'pending_payment') {
      throw new Error("This booking is not available for payment.");
    }
    if (Number(latestBooking.totalAmount) !== Number(activeOrderContext.totalAmount) || latestBooking.cylinderType !== activeOrderContext.cylinderType) {
      throw new Error("Booking details have changed. Close this payment and start again.");
    }
    const paymentId = currentTransactionRef;
    const nowIso = new Date().toISOString();

    // Payment and booking are committed atomically by createBooking in live Firebase.
    const paymentRecord = {
      paymentId,
      bookingId,
      customerId: activeOrderContext.customer.uid,
      amount: activeOrderContext.totalAmount,
      paymentMethod: "demo_qr",
      status: "success",
      transactionReference: currentTransactionRef,
      createdAt: nowIso
    };
    const existingPayment = await getPaymentByBookingId(bookingId);
    if (existingPayment) throw new Error("A payment record already exists for this booking.");
    // Persist booking first; the pending status check above prevents paying it twice.
    const fullBookingPayload = {
      ...latestBooking,
      bookingId,
      paymentStatus: "paid",
      paymentId,
      transactionReference: currentTransactionRef,
      bookingStatus: "confirmed",
      updatedAt: nowIso,
      estimatedDelivery: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0]
    };

    const confirmedBooking = await createBooking(fullBookingPayload);
    if (!confirmedBooking || confirmedBooking.paymentStatus !== 'paid') {
      throw new Error("Payment record was saved but booking confirmation failed. Contact the administrator before retrying.");
    }

    if (isDemo) {
      if (confirmedBooking.paymentStatus !== 'paid') throw new Error('Demo payment did not confirm the booking.');
      await savePaymentRecord(paymentRecord);
      await deductInventoryStock(confirmedBooking.distributorId, confirmedBooking.cylinderType, confirmedBooking.quantity);
    }

    // 3. Log audit event
    try {
      await logAuditEvent(
        activeOrderContext.customer.uid,
        "customer",
        "PAYMENT_SUCCESS",
        paymentId,
        `Demo QR payment of ${formatCurrency(activeOrderContext.totalAmount)} verified for booking ${bookingId} (Ref: ${currentTransactionRef}).`
      );
    } catch (auditError) {
      console.warn('Payment succeeded, but the audit record could not be saved:', auditError);
    }
    try {
      const distributor = await getDistributorById(activeOrderContext.distributorId);
      if (distributor) {
        await createNotification(
          distributor.userId || distributor.id,
          'distributor',
          'New LPG Booking',
          `Paid booking ${bookingId} is ready for depot processing.`,
          `distributor-bookings.html?id=${bookingId}`
        );
      }
    } catch (notificationError) {
      console.warn('Payment succeeded, but the distributor notification could not be saved:', notificationError);
    }

    // 4. Populate Success Screen
    modal.querySelector('#success-booking-id').textContent = bookingId;
    modal.querySelector('#success-tx-id').textContent = currentTransactionRef;
    modal.querySelector('#success-amount').textContent = formatCurrency(activeOrderContext.totalAmount);
    modal.querySelector('#success-datetime').textContent = formatDateTime(nowIso);

    const viewBookingLink = modal.querySelector('#btn-view-booking');
    if (viewBookingLink) {
      viewBookingLink.href = `customer-tracking.html?id=${bookingId}`;
    }

    switchView('success');
    showToast("Payment Successful!", `Booking ${bookingId} has been confirmed.`, "success");

  } catch (err) {
    console.error("Payment Confirmation Error:", err);
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Confirm Payment";
    showToast("Error", err.message || "Failed to confirm payment.", "error");
  }
}
