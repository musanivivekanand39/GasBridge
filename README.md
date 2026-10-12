# GasBridge

GasBridge is a responsive LPG cylinder booking and delivery management web application. It connects customers with their authorized distributor and supports booking, payment confirmation, inventory management, delivery assignment, and order tracking.

This project is an academic application. Its QR checkout is a test flow and does not charge real money.

## Features

- Customer, distributor, delivery agent, and administrator portals.
- Customer registration with address and pincode based service-area lookup.
- Domestic and commercial cylinder bookings, up to three cylinders per booking.
- UPI QR and credit/debit card payment simulation, plus cash on delivery. Simulated online methods do not charge money; COD remains due until cash is collected at delivery.
- Card checkout uses a blank cardholder, card number, expiry, and CVV form. Values are validated for the simulation only and are not stored or sent to Firebase.
- Distributor booking management, inventory and delivery-agent assignment.
- Delivery status updates, customer order tracking, and address-based Google Maps navigation for delivery agents.
- In-app notifications for account, booking, payment, assignment, delivery, and refund status changes.
- Cancellation of eligible paid bookings records a simulated refund and notifies the customer; no real money is transferred.
- Firebase Authentication and Cloud Firestore in configured live mode, with a local browser storage fallback when Firebase settings are placeholders.

## Roles and main pages

| Role | Main pages | Main tasks |
| --- | --- | --- |
| Customer | `pages/customer-dashboard.html`, `pages/customer-booking.html`, `pages/customer-bookings.html`, `pages/customer-tracking.html`, `pages/customer-profile.html` | Maintain profile and delivery address, book cylinders, complete checkout simulation, and follow deliveries. |
| Distributor | `pages/distributor-dashboard.html`, `pages/distributor-bookings.html`, `pages/distributor-inventory.html`, `pages/distributor-agents.html`, `pages/distributor-customers.html` | Review customers and agents in its service area, manage inventory, and fulfill paid and cash-on-delivery bookings. |
| Delivery agent | `pages/agent-dashboard.html`, `pages/agent-deliveries.html`, `pages/agent-history.html` | View assigned deliveries, navigate to delivery addresses, and update delivery progress. |
| Administrator | `pages/admin-dashboard.html`, `pages/admin-customers.html`, `pages/admin-distributors.html`, `pages/admin-agents.html`, `pages/admin-service-areas.html`, `pages/admin-bookings.html`, `pages/admin-inventory.html`, `pages/admin-reports.html` | Oversee users, distributors, service areas, bookings, inventory, and reports. |

Customers select neither their distributor nor delivery agent during booking. The service-area data maps their pincode to a distributor. Distributors manage bookings belonging to their depot and assign approved agents. The normal delivery progression is confirmed, processing, agent assigned, picked up, out for delivery, then delivered.

## Checkout and booking lifecycle

UPI and card checkout use a payment simulation; no real payment provider or money transfer is involved. Card checkout presents blank fields for cardholder name, card number, expiry, and CVV. The app validates these values locally for the simulated flow, then discards them without saving or sending them to Firebase. Do not enter real payment credentials. The UPI QR link requires the site to be deployed at a reachable URL for use from a phone. Cash-on-delivery bookings are confirmed as orders while payment remains due; the delivery agent records cash collection at handover. Cancelling an eligible booking that was already paid records a simulated refund in the booking and sends an in-app notification to the customer; it does not move real money. An unpaid online checkout that expires or is cancelled is not a fulfilled order.

## Interface design

The customer booking and checkout flow applies [Shneiderman's Eight Golden Rules](https://www.cs.umd.edu/users/ben/goldenrules.html):

1. **Consistency:** Reuse the app's shared buttons, status badges, currency format, and plain payment labels.
2. **Universal usability:** Use responsive layouts, native radio controls, visible labels, and keyboard-operable actions.
3. **Informative feedback:** Show stock checks, processing states, validation errors, payment status, and order confirmation.
4. **Clear completion:** End checkout with the booking ID, amount, selected payment method, and next action.
5. **Prevent errors:** Check stock before checkout, validate required card fields for the simulation without storing them, and distinguish cash due from paid.
6. **Easy reversal:** Let customers go back between checkout steps or cancel before an order is placed.
7. **User control:** Let customers choose UPI, credit/debit card, or cash on delivery and show what each choice does before continuing.
8. **Reduce memory load:** Keep the cylinder, quantity, total amount, and payment choice together through checkout and in the confirmation.

Cylinder prices are configured in `js/firebase-config.js` (currently ₹950 for domestic and ₹1,850 for commercial). Booking IDs use the format `GB-YYYYMMDD-XXXX`.

## Technology

- HTML, CSS, and vanilla JavaScript ES modules.
- Firebase JavaScript SDK, Firebase Authentication, and Cloud Firestore.
- Firebase Hosting configuration in `firebase.json`.

## Run locally

Serve the project over HTTP because the application uses JavaScript modules; do not open the HTML files directly with `file://`.

```sh
python -m http.server 3000
```

Then open <http://localhost:3000>.

Alternatively, with Node.js installed:

```sh
npx serve .
```

For Firebase configuration, Authentication/Firestore setup, service-area provisioning, and rules deployment, see [`SETUP.md`](SETUP.md).

## Firebase deployment

Install and authenticate the Firebase CLI, select the intended Firebase project, then deploy the resources configured in `firebase.json`:

```sh
firebase use <project-id>
firebase deploy --only hosting,firestore:rules,storage
```

The app's Firebase web configuration is in `js/firebase-config.js`. Configure Firebase Authentication with Email/Password, provision service-area and distributor data, and deploy the included Firestore and Storage rules before using a live Firebase project. Do not replace the security rules with open rules for production.

## Project structure

```text
.
├── index.html
├── pages/                 # Role-specific application pages
├── css/                   # Shared, dashboard, auth, and responsive styles
├── js/                    # Auth, Firebase, booking, checkout, and role workflows
├── assets/images/         # Application imagery
├── firestore.rules        # Cloud Firestore access controls
├── storage.rules          # Firebase Storage access controls
├── firebase.json          # Firebase Hosting and rules configuration
├── SETUP.md               # Firebase setup and local run instructions
└── README.md
```
