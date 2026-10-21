/**
 * GasBridge - Checkout Module
 * UPI and card are simulated; COD remains payable on delivery.
 * 2. Scannable QR link with one-time cross-device confirmation for the current booking.
 * 3. Forty-second confirmation window, followed by redirect to LPG booking.
 * 4. Local preview mode retains a manual simulated confirmation flow.
 * 5. Payment duplicate protection.
 * 6. Never persists card credentials.
 */

import { 
  createBooking, 
  updateBookingRecord,
  getBookingById, 
  deductInventoryStock,
  createDemoPaymentIntent,
  watchDemoPaymentConfirmation,
  logAuditEvent, 
  savePaymentRecord,
  getPaymentByBookingId,
  getDistributorById,
  createNotification
} from "./firestore.js";
import { formatCurrency, formatDateTime, showToast, generateBookingId } from "./utils.js";
import { generateQRCodeSVG } from "./qrcode.js";
import { isDemo } from "./firebase.js";
import { firebaseConfig } from "./firebase-config.js";

let activeOrderContext = null;
let currentBooking = null;
let currentTransactionRef = null;
let stopPaymentConfirmationWatch = null;
let paymentExpiryTimer = null;
let paymentCountdownTimer = null;
let paymentRedirectTimer = null;
let pendingBookingCancellation = null;
const PAYMENT_WINDOW_MS = 40_000;

// Generate unique transaction reference: GBPAY-XXXXXXXX
function generateTransactionRef() {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let ref = 'GBPAY-';
  for (let i = 0; i < 8; i++) {
    ref += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return ref;
}

function generateSecureToken(byteCount = 24) {
  const bytes = new Uint8Array(byteCount);
  if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function stopPaymentWindow() {
  if (paymentExpiryTimer) clearTimeout(paymentExpiryTimer);
  if (paymentCountdownTimer) clearInterval(paymentCountdownTimer);
  if (paymentRedirectTimer) clearTimeout(paymentRedirectTimer);
  if (stopPaymentConfirmationWatch) stopPaymentConfirmationWatch();
  paymentExpiryTimer = null;
  paymentCountdownTimer = null;
  paymentRedirectTimer = null;
  stopPaymentConfirmationWatch = null;
}

async function cancelPendingBooking(reason) {
  if (!currentBooking || currentBooking.paymentStatus !== 'unpaid' || currentBooking.bookingStatus !== 'pending_payment') return;
  if (pendingBookingCancellation) return pendingBookingCancellation;

  const timeline = [...(currentBooking.statusTimeline || []), {
    status: 'cancelled',
    time: new Date().toISOString(),
    note: reason
  }];
  pendingBookingCancellation = updateBookingRecord(currentBooking.bookingId, {
    bookingStatus: 'cancelled',
    statusTimeline: timeline
  }).then(updated => {
    if (updated) currentBooking = { ...currentBooking, ...updated, statusTimeline: timeline };
  }).catch(error => {
    console.warn('Could not cancel the unpaid checkout booking:', error);
  }).finally(() => {
    pendingBookingCancellation = null;
  });
  return pendingBookingCancellation;
}

async function failExpiredPayment() {
  stopPaymentWindow();
  const modal = document.getElementById('payment-modal');
  if (modal) {
    modal.querySelector('#payment-failure-message').textContent = 'The payment request expired. No charge was made. Returning to LPG booking…';
    modal.querySelector('#btn-retry-payment').style.display = 'none';
    modal.querySelector('#btn-dismiss-failure').style.display = 'none';
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    switchView('failure');
  }
  showToast('Payment Failed', 'The 40-second payment window expired.', 'error');
  await cancelPendingBooking('Payment window expired before confirmation.');
  paymentRedirectTimer = setTimeout(() => {
    closeModalHandler();
    window.location.href = new URL('customer-booking.html', window.location.href).href;
  }, 2200);
}

function startPaymentWindow(expiresAt) {
  stopPaymentWindow();
  const countdown = document.getElementById('qr-payment-countdown');
  const updateCountdown = () => {
    const remainingMs = Math.max(0, expiresAt - Date.now());
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    if (countdown) countdown.textContent = `00:${String(remainingSeconds).padStart(2, '0')}`;
    if (remainingMs <= 0) {
      failExpiredPayment();
    }
  };
  updateCountdown();
  paymentCountdownTimer = setInterval(updateCountdown, 250);
  paymentExpiryTimer = setTimeout(updateCountdown, Math.max(0, expiresAt - Date.now()));
}

// Ensure the payment modal exists in the DOM
function ensurePaymentModalExists() {
  let modal = document.getElementById('payment-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'payment-modal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 480px; width: min(92%, 480px); max-height: calc(100dvh - 24px); display: flex; flex-direction: column; border-radius: var(--radius-lg); overflow: hidden; box-shadow: 0 20px 45px rgba(0,0,0,0.25);">
      <!-- Modal Header -->
      <div class="modal-header" style="background: linear-gradient(135deg, #15803d 0%, #166534 100%); color: white; padding: 1.25rem 1.5rem;">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="background: rgba(255,255,255,0.18); width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.25rem;">
            📱
          </div>
          <div>
            <h3 style="font-size: 1.15rem; margin: 0; color: #ffffff; font-family: 'Outfit', sans-serif;">SECURE CHECKOUT</h3>
            <span id="payment-header-hint" style="font-size: 0.76rem; color: #bbf7d0; display: block;">Scan with Google Lens and open the GasBridge payment link</span>
          </div>
        </div>
        <button class="btn-icon" id="close-payment-modal-btn" aria-label="Close" style="color: white; background: rgba(255,255,255,0.12); border-radius: 50%;">&times;</button>
      </div>

      <!-- Simulation disclosure -->
      <div id="payment-disclosure" style="background: #fffbeb; border-bottom: 1px solid #fef3c7; color: #92400e; padding: 0.6rem 1.25rem; font-size: 0.78rem; text-align: center; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 0.4rem;">
        <span>🎓</span>
        <span>Simulated payment · No real charge will be made</span>
      </div>

        <div class="modal-body" style="padding: 1rem; overflow-y: auto; min-height: 0;">
        <div id="payment-view-method" style="display:none;">
          <h3 style="margin:0 0 .35rem;">Choose a payment method</h3>
          <p style="color:var(--text-muted);font-size:.88rem;margin:0 0 1rem;">Select how you want to complete this order.</p>
          <div style="display:grid;gap:.65rem;">
            <button type="button" class="btn btn-outline" data-payment-method-choice="upi_qr" style="display:flex;justify-content:space-between;align-items:center;text-align:left;padding:.9rem 1rem;">
              <span><strong>UPI</strong><small style="display:block;color:var(--text-muted);font-weight:400;">Scan a QR code · simulated payment</small></span><span aria-hidden="true">›</span>
            </button>
            <button type="button" class="btn btn-outline" data-payment-method-choice="card" style="display:flex;justify-content:space-between;align-items:center;text-align:left;padding:.9rem 1rem;">
              <span><strong>Credit or debit card</strong><small style="display:block;color:var(--text-muted);font-weight:400;">Complete a simulated card payment</small></span><span aria-hidden="true">›</span>
            </button>
            <button type="button" class="btn btn-outline" data-payment-method-choice="cod" style="display:flex;justify-content:space-between;align-items:center;text-align:left;padding:.9rem 1rem;">
              <span><strong>Cash on delivery</strong><small style="display:block;color:var(--text-muted);font-weight:400;">Pay the delivery agent when your order arrives</small></span><span aria-hidden="true">›</span>
            </button>
          </div>
          <button type="button" class="btn btn-outline btn-full" id="btn-cancel-method-choice" style="margin-top:1rem;">Cancel</button>
        </div>
        <div id="payment-view-card" style="display:none;">
          <h3 style="margin:0 0 .4rem;">Pay by card</h3>
          <p style="color:var(--text-muted);font-size:.88rem;">Simulation only: no money is charged and card details are not saved. Use evaluator test details only; do not enter a real card.</p>
          <p style="margin:.9rem 0;font-weight:700;">Amount: <span id="card-pay-amount"></span></p>
          <div class="form-group">
            <label for="cardholder-name">Cardholder name</label>
            <input id="cardholder-name" class="form-control" type="text" autocomplete="off" required>
          </div>
          <div class="form-group">
            <label for="card-number">Credit / debit card number</label>
            <input id="card-number" class="form-control" type="text" inputmode="numeric" autocomplete="off" maxlength="23" placeholder="Enter card number" required>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem;">
            <div class="form-group" style="margin:0;">
              <label for="card-expiry">Expiry (MM/YY)</label>
              <input id="card-expiry" class="form-control" type="text" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="MM/YY" required>
            </div>
            <div class="form-group" style="margin:0;">
              <label for="card-cvv">CVV</label>
              <input id="card-cvv" class="form-control" type="password" inputmode="numeric" autocomplete="new-password" maxlength="4" placeholder="CVV" required>
            </div>
          </div>
          <div style="display:flex;gap:.65rem;"><button class="btn btn-outline" type="button" id="btn-card-back">Back to booking</button><button class="btn btn-primary" type="button" id="btn-card-pay" style="flex:1;">Complete simulated payment</button></div>
        </div>
        <div id="payment-view-cod" style="display:none;text-align:center;padding:1rem 0;">
          <div style="font-size:2rem;">💵</div><h3>Cash on delivery</h3>
          <p style="color:var(--text-muted);">Pay <strong id="cod-pay-amount"></strong> in cash to the delivery agent when your cylinder arrives. Your order will be sent to the distributor as unpaid.</p>
          <div style="display:flex;gap:.65rem;"><button class="btn btn-outline" type="button" id="btn-cod-back">Back to booking</button><button class="btn btn-primary" type="button" id="btn-place-cod-order" style="flex:1;">Place order</button></div>
        </div>
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
              <span>Transaction Ref:</span>
              <code id="qr-tx-ref" style="background: #e2e8f0; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 700; color: #334155;">-</code>
            </div>
          </div>

          <!-- Dynamic Scannable QR Code Container -->
          <div style="text-align: center; margin-bottom: .75rem;">
            <div id="qr-code-svg-container" style="display: inline-block; padding: 10px; background: white; border: 2px solid #e2e8f0; border-radius: var(--radius-lg); box-shadow: 0 4px 14px rgba(0,0,0,0.06);">
              <!-- SVG QR inserted dynamically -->
            </div>

            <!-- Distributor UPI Details Badge -->
            <div id="qr-distributor-upi-box" style="margin-top: 0.65rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: var(--radius-md); padding: 0.5rem 0.75rem; text-align: center; font-size: 0.82rem;">
              <div style="color: var(--text-muted); font-size: 0.74rem; text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em;">Authorized Depot UPI</div>
              <strong id="qr-distributor-payee" style="color: var(--text-main); display: block; font-size: 0.9rem; margin-top: 0.15rem;">-</strong>
              <div style="margin-top: 0.2rem;">
                <code id="qr-distributor-vpa" style="background: white; border: 1px solid #86efac; color: #15803d; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.84rem;">-</code>
              </div>
            </div>

            <div id="qr-scan-help" style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.45rem;">
              Scan using any UPI App (Google Pay, PhonePe, Paytm, BHIM)
            </div>
            <a id="qr-open-payment-link" href="#" target="_blank" rel="noopener noreferrer" style="display:none; margin-top:0.45rem; font-size:0.85rem; font-weight:700;">Open payment link</a>
            <div id="qr-live-waiting" style="display:none; margin-top:0.55rem; font-size:0.9rem; font-weight:700; color:#166534;">
              Waiting for scan · Link expires in <span id="qr-payment-countdown">00:40</span>
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
                Payment didn't work
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
          <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.35rem; margin-bottom: 0.4rem; color: var(--text-main);">Confirm Payment</h3>
          <p style="color: var(--text-muted); font-size: 0.88rem; line-height: 1.5; max-width: 380px; margin: 0 auto 1.25rem;">
            Confirm the simulated checkout to complete this booking. No money will be charged.
          </p>

          <div style="background: #f1f5f9; border-radius: var(--radius-md); padding: 0.85rem; margin-bottom: 1.5rem; text-align: left; font-size: 0.85rem;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
              <span style="color: var(--text-muted);">Amount to Confirm:</span>
              <strong id="confirm-pay-amount" style="color: var(--primary); font-size: 1.1rem;">₹0</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-muted);">Payment mode:</span>
              <span class="badge badge-warning" style="font-size: 0.72rem;">Simulation · no charge</span>
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
          <p id="payment-failure-message" style="color: var(--text-muted); font-size: 0.9rem; line-height: 1.5; margin-bottom: 1.5rem;">
            Payment failed. No charge was made.
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
          <h3 id="success-title" style="font-family: 'Outfit', sans-serif; font-size: 1.45rem; color: #15803d; margin-bottom: 0.25rem;">✓ Payment Confirmed</h3>
          <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1.25rem;">
            Your order has been confirmed. No money was charged in this simulation.
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
              <span id="success-payment-method" style="font-weight: 600;">UPI simulation</span>
            </div>
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; margin-bottom: 0.4rem;">
              <span style="color: var(--text-muted);">Payment Status:</span>
              <span id="success-payment-status" class="badge badge-success" style="font-size: 0.72rem;">Paid</span>
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

  modal.querySelector('#payment-view-success h3').id = 'success-title';
  modal.querySelector('#payment-view-success h3 + p').id = 'success-message';
  document.body.appendChild(modal);

  // Close handlers
  modal.querySelector('#close-payment-modal-btn').addEventListener('click', closeModalHandler);
  modal.querySelector('#btn-cancel-payment').addEventListener('click', closeModalHandler);
  modal.querySelector('#btn-cancel-method-choice').addEventListener('click', closeModalHandler);
  modal.querySelector('#btn-dismiss-failure').addEventListener('click', closeModalHandler);

  // Step transitions
  modal.querySelector('#btn-scanned-qr').addEventListener('click', showConfirmationView);
  modal.querySelector('#btn-back-to-qr').addEventListener('click', showQRView);
  modal.querySelector('#btn-simulate-fail').addEventListener('click', handlePaymentFailure);
  modal.querySelector('#btn-retry-payment').addEventListener('click', showQRView);
  modal.querySelector('#btn-confirm-final-payment').addEventListener('click', handlePaymentSuccess);
  modal.querySelector('#btn-card-back').addEventListener('click', closeModalHandler);
  modal.querySelector('#btn-cod-back').addEventListener('click', closeModalHandler);
  modal.querySelector('#btn-place-cod-order').addEventListener('click', handleCodOrder);
  modal.querySelectorAll('[data-payment-method-choice]').forEach(button => {
    button.addEventListener('click', async () => {
      const choices = modal.querySelectorAll('[data-payment-method-choice]');
      choices.forEach(choice => { choice.disabled = true; });
      try {
        await beginSelectedPayment(button.dataset.paymentMethodChoice);
      } catch (error) {
        showToast('Could Not Start Checkout', error.message || 'Please try again.', 'error');
      } finally {
        choices.forEach(choice => { choice.disabled = false; });
      }
    });
  });
  modal.querySelector('#btn-card-pay').addEventListener('click', () => {
    const payButton = modal.querySelector('#btn-card-pay');
    const validationError = validateCardEntry(modal);
    if (validationError) {
      showToast('Check card details', validationError, 'error');
      return;
    }
    // Card details are only used for local form validation and are discarded
    // before the simulation continues. They are never added to the payment data.
    clearCardEntry(modal);
    payButton.disabled = true;
    payButton.textContent = 'Processing…';
    handlePaymentSuccess();
  });

  modal.querySelector('#card-number').addEventListener('input', event => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 19);
    event.target.value = digits.replace(/(.{4})/g, '$1 ').trim();
  });
  modal.querySelector('#card-expiry').addEventListener('input', event => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 4);
    event.target.value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
  });
  modal.querySelector('#card-cvv').addEventListener('input', event => {
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, 4);
  });

  return modal;
}

function closeModalHandler() {
  stopPaymentWindow();
  void cancelPendingBooking('Checkout was closed before payment confirmation.');
  const modal = document.getElementById('payment-modal');
  if (modal) {
    clearCardEntry(modal);
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function validateCardEntry(modal) {
  const name = modal.querySelector('#cardholder-name').value.trim();
  const number = modal.querySelector('#card-number').value.replace(/\D/g, '');
  const expiry = modal.querySelector('#card-expiry').value.trim();
  const cvv = modal.querySelector('#card-cvv').value.trim();
  if (!name) return 'Enter the cardholder name.';
  if (!/^\d{13,19}$/.test(number)) return 'Enter a card number containing 13 to 19 digits.';
  const expiryMatch = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(expiry);
  if (!expiryMatch) return 'Enter the expiry date in MM/YY format.';
  const expiryMonth = Number(expiryMatch[1]);
  const expiryYear = 2000 + Number(expiryMatch[2]);
  const now = new Date();
  if (expiryYear < now.getFullYear() || (expiryYear === now.getFullYear() && expiryMonth < now.getMonth() + 1)) {
    return 'The card expiry date has passed.';
  }
  if (!/^\d{3,4}$/.test(cvv)) return 'Enter a 3 or 4 digit CVV.';
  return '';
}

function clearCardEntry(modal) {
  ['#cardholder-name', '#card-number', '#card-expiry', '#card-cvv'].forEach(selector => {
    const input = modal.querySelector(selector);
    if (input) input.value = '';
  });
}

function switchView(viewName) {
  const modal = document.getElementById('payment-modal');
  if (!modal) return;
  modal.querySelector('#payment-view-method').style.display = viewName === 'method' ? 'block' : 'none';
  modal.querySelector('#payment-view-qr').style.display = viewName === 'qr' ? 'block' : 'none';
  modal.querySelector('#payment-view-confirm').style.display = viewName === 'confirm' ? 'block' : 'none';
  modal.querySelector('#payment-view-failure').style.display = viewName === 'failure' ? 'block' : 'none';
  modal.querySelector('#payment-view-success').style.display = viewName === 'success' ? 'block' : 'none';
  modal.querySelector('#payment-view-card').style.display = viewName === 'card' ? 'block' : 'none';
  modal.querySelector('#payment-view-cod').style.display = viewName === 'cod' ? 'block' : 'none';
}

function showQRView() {
  switchView('qr');
}

function showConfirmationView() {
  const modal = document.getElementById('payment-modal');
  const confirmAmt = modal.querySelector('#confirm-pay-amount');
  if (confirmAmt && activeOrderContext) {
    confirmAmt.textContent = formatCurrency(activeOrderContext.totalAmount);
  }
  switchView('confirm');
}

function paymentMethodLabel(method) {
  return ({ upi_qr: 'UPI', card: 'Card', cod: 'Cash on delivery' })[method] || 'UPI';
}

/**
 * Open payment modal for an order context.
 * Adheres to rule 26: Duplicate Protection & Rule 21: Dynamic Scannable QR.
 */
export async function openDemoPaymentModal(context) {
  stopPaymentWindow();
  currentBooking = null;
  activeOrderContext = context;
  const modal = ensurePaymentModalExists();
  modal.querySelector('#payment-header-hint').textContent = 'Choose how you want to pay';
  modal.querySelector('#payment-disclosure span:last-child').textContent = 'UPI and card are simulated · COD is paid at delivery';
  modal.querySelector('#btn-retry-payment').style.display = '';
  modal.querySelector('#btn-dismiss-failure').style.display = '';
  switchView('method');
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

async function beginSelectedPayment(paymentMethod) {
  stopPaymentWindow();
  const context = { ...activeOrderContext, paymentMethod };
  activeOrderContext = context;
  const modal = ensurePaymentModalExists();
  const methodText = {
    upi_qr: ['Scan the QR code with your UPI app', 'Simulated payment · No real charge will be made'],
    card: ['Complete the card simulation', 'Simulated payment · No card details or money are collected'],
    cod: ['Pay cash when the delivery arrives', 'No online payment · Cash due at delivery']
  }[context.paymentMethod] || ['Scan the QR code with your UPI app', 'Simulated payment · No real charge will be made'];
  modal.querySelector('#payment-header-hint').textContent = methodText[0];
  modal.querySelector('#payment-disclosure span:last-child').textContent = methodText[1];
  modal.querySelector('#btn-retry-payment').style.display = '';
  modal.querySelector('#btn-dismiss-failure').style.display = '';

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
  modal.querySelector('#card-pay-amount').textContent = formatCurrency(context.totalAmount);
  modal.querySelector('#cod-pay-amount').textContent = formatCurrency(context.totalAmount);

  modal.querySelector('#payment-already-paid-alert').style.display = 'none';
  modal.querySelector('#qr-actions-container').style.display = 'flex';

  let qrPayload;
  let confirmationId = '';
  let confirmationToken = generateSecureToken(32);
  const expiresAt = Date.now() + PAYMENT_WINDOW_MS;
  if (context.paymentMethod === 'cod') {
    modal.querySelector('#success-payment-method').textContent = 'Cash on delivery';
    switchView('cod');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    return;
  }
  if (context.paymentMethod === 'card') {
    modal.querySelector('#success-payment-method').textContent = 'Credit / debit card simulation';
    switchView('card');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    return;
  }
  if (!isDemo) {
    confirmationId = bookingId;
    try {
      await createDemoPaymentIntent({
        bookingId,
        customerId: context.customer.uid,
        amount: context.totalAmount,
        confirmationId,
        token: confirmationToken,
        expiresAt
      });
    } catch (error) {
      showToast('Could Not Start QR Payment', error.message || 'Check your connection and try again.', 'error');
      return;
    }
  }
  // Fetch distributor's real UPI ID and business name
  let distributor = null;
  if (context.distributorId) {
    try {
      distributor = await getDistributorById(context.distributorId);
    } catch (e) {
      console.warn('Could not load distributor profile for UPI:', e);
    }
  }

  const distUpiId = (distributor?.upiId || 'gasbridge.shadnagar@upi').trim();
  const distPayee = (distributor?.upiPayeeName || distributor?.businessName || distributor?.name || 'GasBridge LPG Depot').trim();

  // Populate Distributor UPI Info Badge
  const payeeEl = modal.querySelector('#qr-distributor-payee');
  const vpaEl = modal.querySelector('#qr-distributor-vpa');
  if (payeeEl) payeeEl.textContent = distPayee;
  if (vpaEl) vpaEl.textContent = distUpiId;

  // Real UPI deep link URI (NPCI standard specification: upi://pay)
  // Encodes: payee VPA (pa), payee name (pn), amount (am), transaction ref (tr), currency (cu), transaction note (tn)
  const upiIntentUri = `upi://pay?pa=${encodeURIComponent(distUpiId)}&pn=${encodeURIComponent(distPayee)}&am=${encodeURIComponent(context.totalAmount.toFixed(2))}&cu=INR&tr=${encodeURIComponent(currentTransactionRef)}&tn=${encodeURIComponent(`Refill LPG ${bookingId}`)}`;

  // Use the standard UPI payload for the scannable QR code
  qrPayload = upiIntentUri;

  const qrSvg = generateQRCodeSVG(qrPayload, {
    size: 190,
    margin: 4,
    darkColor: "#0f172a"
  });

  const svgContainer = modal.querySelector('#qr-code-svg-container');
  svgContainer.innerHTML = qrSvg;
  const paymentLink = modal.querySelector('#qr-open-payment-link');
  if (paymentLink) {
    paymentLink.style.display = 'inline-block';
    paymentLink.href = upiIntentUri;
    paymentLink.textContent = 'Pay via UPI App (on this phone)';
  }

  modal.querySelector('#btn-scanned-qr').style.display = 'block';
  modal.querySelector('#btn-simulate-fail').style.display = 'block';
  modal.querySelector('#qr-live-waiting').style.display = isDemo ? 'none' : 'block';
  modal.querySelector('#qr-scan-help').textContent =
    `Scan with any UPI App (GPay, PhonePe, Paytm) to pay ${formatCurrency(context.totalAmount)} directly to ${distUpiId}.`;

  switchView('qr');
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  startPaymentWindow(expiresAt);
  if (!isDemo) {
    stopPaymentConfirmationWatch = watchDemoPaymentConfirmation(
      confirmationId,
      confirmationToken,
      () => {
        handlePaymentSuccess();
      },
      error => {
        console.error('QR confirmation listener failed:', error);
        showToast('Waiting for QR Confirmation', error.message || 'Keep this payment window open and try scanning again.', 'warning');
      }
    );
  }
}

async function handleCodOrder() {
  const button = document.getElementById('btn-place-cod-order');
  button.disabled = true;
  button.textContent = 'Placing order…';
  try {
    const now = new Date().toISOString();
    const timeline = [...(currentBooking.statusTimeline || []), {
      status: 'confirmed', time: now, note: 'Cash on delivery selected; payment due on delivery.'
    }];
    currentBooking = await updateBookingRecord(currentBooking.bookingId, {
      paymentStatus: 'cod_pending',
      paymentMethod: 'cod',
      transactionReference: currentTransactionRef,
      bookingStatus: 'confirmed',
      estimatedDelivery: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
      statusTimeline: timeline
    });
    try {
      await createNotification(
        activeOrderContext.customer.uid,
        'customer',
        'Booking confirmed',
        `Your cash-on-delivery booking ${currentBooking.bookingId} is confirmed. Cash is due when it is delivered.`,
        `customer-tracking.html?id=${currentBooking.bookingId}`
      );
    } catch (notificationError) {
      console.warn('COD order placed, but the customer notification could not be saved:', notificationError);
    }
    try {
      const distributor = await getDistributorById(activeOrderContext.distributorId);
      if (distributor) {
        await createNotification(
          distributor.userId || distributor.id,
          'distributor',
          'New cash-on-delivery booking',
          `COD booking ${currentBooking.bookingId} is ready for depot processing.`,
          `distributor-bookings.html?id=${currentBooking.bookingId}`
        );
      }
    } catch (notificationError) {
      console.warn('COD order placed, but distributor notification could not be saved:', notificationError);
    }
    const modal = document.getElementById('payment-modal');
    modal.querySelector('#success-booking-id').textContent = currentBooking.bookingId;
    modal.querySelector('#success-tx-id').textContent = 'Pay on delivery';
    modal.querySelector('#success-amount').textContent = formatCurrency(activeOrderContext.totalAmount);
    modal.querySelector('#success-datetime').textContent = formatDateTime(now);
    modal.querySelector('#success-payment-method').textContent = 'Cash on delivery';
    modal.querySelector('#success-payment-status').textContent = 'Due on delivery';
    modal.querySelector('#success-title').textContent = 'Order placed';
    modal.querySelector('#success-message').textContent = 'Your distributor received the order. Cash is due to the delivery agent when the cylinder arrives.';
    modal.querySelector('#btn-view-booking').href = `customer-tracking.html?id=${currentBooking.bookingId}`;
    switchView('success');
    showToast('Order placed', 'Cash is due to the delivery agent when your cylinder arrives.', 'success');
  } catch (error) {
    showToast('Could not place order', error.message || 'Please try again.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Place order';
  }
}

/**
 * Handle simulated payment failure (Rule 24).
 * Explicit user choice, not randomly generated.
 */
async function handlePaymentFailure() {
  const modal = document.getElementById('payment-modal');

  await logAuditEvent(
    activeOrderContext.customer.uid,
    "customer",
    "PAYMENT_FAILED",
    currentBooking ? currentBooking.bookingId : 'unknown',
    `Simulated payment failed for transaction ${currentTransactionRef}.`
  );

  switchView('failure');
  showToast("Payment Failed", "The simulated payment was not completed. No charge was made.", "error");
}

/**
 * Handle simulated payment success (Rule 20, 22, 25).
 * Completes after explicit in-page payment confirmation.
 */
async function handlePaymentSuccess() {
  // A scan received before expiry owns the attempt; stop the expiry callback
  // before the confirmation write can race it.
  stopPaymentWindow();
  const modal = document.getElementById('payment-modal');
  const confirmBtn = modal.querySelector('#btn-confirm-final-payment');
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Processing payment...";
  let paymentStep = 'loading booking details';

  // Brief latency simulation (700ms)
  await new Promise(r => setTimeout(r, 700));

  try {
    const bookingId = currentBooking.bookingId;
    paymentStep = 'loading booking details';
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
      paymentMethod: activeOrderContext.paymentMethod || "upi_qr",
      status: "success",
      transactionReference: currentTransactionRef,
      createdAt: nowIso
    };
    paymentStep = 'checking for an existing payment';
    const existingPayment = isDemo ? await getPaymentByBookingId(bookingId) : null;
    if (existingPayment) throw new Error("A payment record already exists for this booking.");
    // Persist booking first; the pending status check above prevents paying it twice.
    const fullBookingPayload = {
      ...latestBooking,
      bookingId,
      paymentStatus: "paid",
      paymentMethod: activeOrderContext.paymentMethod || 'upi_qr',
      paymentId,
      transactionReference: currentTransactionRef,
      bookingStatus: "confirmed",
      updatedAt: nowIso,
      estimatedDelivery: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
      statusTimeline: [
        ...(Array.isArray(latestBooking.statusTimeline) ? latestBooking.statusTimeline : []),
        { status: 'confirmed', time: nowIso, note: `${paymentMethodLabel(activeOrderContext.paymentMethod)} payment confirmed.` }
      ]
    };

    paymentStep = 'saving the payment, confirming the booking, and reserving stock';
    const confirmedBooking = await createBooking(fullBookingPayload);
    if (!confirmedBooking || confirmedBooking.paymentStatus !== 'paid') {
      throw new Error("Payment record was saved but booking confirmation failed. Contact the administrator before retrying.");
    }
    stopPaymentWindow();
    currentBooking = confirmedBooking;

    if (isDemo) {
      if (confirmedBooking.paymentStatus !== 'paid') throw new Error('Payment simulation did not confirm the booking.');
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
        `${paymentMethodLabel(activeOrderContext.paymentMethod)} simulated payment of ${formatCurrency(activeOrderContext.totalAmount)} confirmed for booking ${bookingId} (Ref: ${currentTransactionRef}).`
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
    if (!isDemo) {
      try {
        await createNotification(
          activeOrderContext.customer.uid,
          'customer',
          'Booking confirmed',
          `Your ${paymentMethodLabel(activeOrderContext.paymentMethod)} booking ${bookingId} is confirmed.`,
          `customer-tracking.html?id=${bookingId}`
        );
      } catch (notificationError) {
        console.warn('Payment succeeded, but the customer notification could not be saved:', notificationError);
      }
    }

    // 4. Populate Success Screen
    modal.querySelector('#success-booking-id').textContent = bookingId;
    modal.querySelector('#success-tx-id').textContent = currentTransactionRef;
    modal.querySelector('#success-amount').textContent = formatCurrency(activeOrderContext.totalAmount);
    modal.querySelector('#success-datetime').textContent = formatDateTime(nowIso);
    modal.querySelector('#success-payment-method').textContent = `${paymentMethodLabel(activeOrderContext.paymentMethod)} · simulation`;
    modal.querySelector('#success-payment-status').textContent = 'Paid';

    const viewBookingLink = modal.querySelector('#btn-view-booking');
    if (viewBookingLink) {
      viewBookingLink.href = `customer-tracking.html?id=${bookingId}`;
    }

    stopPaymentWindow();
    switchView('success');
    showToast("Payment Confirmed", `Booking ${bookingId} has been confirmed. No money was charged in this simulation.`, "success");

  } catch (err) {
    console.error("Payment Confirmation Error:", err);
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Confirm Payment";
    const cardPayBtn = modal.querySelector('#btn-card-pay');
    if (cardPayBtn) {
      cardPayBtn.disabled = false;
      cardPayBtn.textContent = 'Pay';
    }
    const detail = err.code === 'permission-denied'
      ? `Firestore denied access while ${paymentStep}.`
      : err.message || 'Failed to confirm payment.';
    showToast("Payment Could Not Complete", detail, "error");
  }
}
