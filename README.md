# GasBridge - Fueling Better Homes

> **Online LPG Delivery Management System**  
> *Developed as a Software Engineering Capstone Web Application*

GasBridge is a complete, professional, responsive online LPG cylinder delivery management web application. It connects customers, authorized local distributors, and delivery agents across defined service areas, operating as an independent, modern LPG delivery network.

---

## 🏗️ Core Architecture & Business Flow

GasBridge models the real-world LPG distribution pipeline:

```
CUSTOMER
    ↓
FIXED HOME ADDRESS (Saved at Registration)
    ↓
PINCODE (e.g. 509216)
    ↓
SERVICE AREA (Shadnagar)
    ↓
AUTHORIZED DISTRIBUTOR (GasBridge Shadnagar Depot)
    ↓
DELIVERY AGENT (Auto-assigned or queued for manual depot assignment)
    ↓
LPG DELIVERY & 6-STEP LIVE TRACKING
```

### Essential Business Rules Enforced:
1. **Zero Location Picking during Booking**: The customer provides their permanent delivery address once during registration. When booking, their verified address loads automatically.
2. **Zero Distributor or Agent Choice by Customer**: The system automatically assigns the service area and authorized distributor based on the customer's permanent pincode.
3. **Unsupported Pincode Gate**: Pincodes outside authorized service areas display `"GasBridge service is currently unavailable in your area."` and prevent invalid bookings.
4. **Distributor Depot Isolation**: Distributors strictly access bookings belonging to their own authorized service areas.
5. **Real-time Inventory Check**: Available cylinders are verified at the assigned distributor depot prior to confirming any booking.
6. **Demo QR Payment with No Banking Credentials**: The academic demo displays a scannable QR with booking details; no real payment or banking credentials are used.
7. **Unique Booking ID Generation**: Every order receives a formatted tracking ID: `GB-YYYYMMDD-XXXX`.
8. **15-Minute Inactivity Auto-Logout**: Inactivity monitor tracks user inputs across touch, mouse, and keyboard, expiring the session after 15 minutes of idle time.

---

## 👥 User Roles & Dashboards

GasBridge provides **4 dedicated role-based portals**:

| Role | Portal URL | Core Capabilities |
|---|---|---|
| **Customer** | `pages/customer-dashboard.html` | Fixed home address display, 1-click LPG booking, 6-step live tracking, booking history, reordering, profile address editing with pincode re-resolution. |
| **Distributor** | `pages/distributor-dashboard.html` | Service area bookings monitor, depot inventory gauges, low stock alerts, manual agent assignment, order status progression. |
| **Delivery Agent** | `pages/agent-dashboard.html` | Assigned delivery queue, 1-click Google Maps navigation, status progression (`Picked Up` → `Out for Delivery` → `Delivered`), completed handover history. |
| **Administrator** | `pages/admin-dashboard.html` | System-wide KPIs, customer search & activation, distributor depot onboarding, service area & pincode mapping, fleet management, audit logs, printable reports. |

---

## 🛠️ Technology Stack

- **Frontend**: Semantic HTML5, Vanilla CSS3 (Custom design system with forest green `#15803d` and energetic orange `#ea580c`), Vanilla JavaScript (ES Modules).
- **Backend & Database**: Firebase Modular SDK (v10), Cloud Firestore, Firebase Authentication.
- **Imagery**: Real photographs of LPG cylinders, Indian delivery personnel, Mahindra delivery vans, and household kitchens stored locally in `assets/images/`.

---

## 📂 Project Directory Structure

```
GasBridge/
├── index.html                           # Landing page
├── pages/
│   ├── login.html                       # Role login & quick demo switcher
│   ├── register.html                    # Customer registration with fixed address
│   ├── customer-dashboard.html          # Customer central hub
│   ├── customer-booking.html            # LPG booking & order summary
│   ├── customer-bookings.html           # Booking history with reorder
│   ├── customer-tracking.html           # 6-step visual delivery tracker
│   ├── customer-profile.html            # Profile & address update
│   ├── distributor-dashboard.html       # Distributor KPIs & alerts
│   ├── distributor-bookings.html        # Service area order fulfillment
│   ├── distributor-inventory.html       # Cylinder stock & restock form
│   ├── distributor-agents.html          # Depot delivery agent roster
│   ├── agent-dashboard.html             # Agent field overview
│   ├── agent-deliveries.html            # Active tasks & Google Maps navigation
│   ├── agent-history.html               # Handover logs
│   ├── admin-dashboard.html             # System-wide command center
│   ├── admin-customers.html             # Customer management
│   ├── admin-distributors.html          # Distributor agency onboarding
│   ├── admin-service-areas.html         # Service area & pincode binding
│   ├── admin-agents.html                # Fleet agent onboarding
│   ├── admin-bookings.html              # Global bookings oversight
│   ├── admin-inventory.html             # Multi-depot inventory oversight
│   └── admin-reports.html               # Printable reports & audit log
├── css/
│   ├── style.css                        # Design tokens, hero, landing layout
│   ├── dashboard.css                    # Unified sidebar, tables, cards, stepper
│   ├── auth.css                         # Split-screen auth and address grids
│   └── responsive.css                   # Mobile and multi-device breakpoints
├── js/
│   ├── firebase-config.js               # Firebase configuration & seed master data
│   ├── firebase.js                      # Modular SDK initialization & demo bridge
│   ├── auth.js                          # Session management & 15-min auto logout
│   ├── firestore.js                     # Firestore database & local fallback store
│   ├── utils.js                         # Toasts, currency, booking ID generator
│   ├── customer.js                      # Customer greeting & address card
│   ├── booking.js                       # Booking calculation & inventory check
│   ├── payment.js                       # Demo payment modal & last 4 digits
│   ├── tracking.js                      # Stepper timeline & real-time tracker
│   ├── distributor.js                   # Distributor order processing
│   ├── delivery-agent.js                # Agent status updates & navigation
│   ├── admin.js                         # Admin controls & reports
│   └── notifications.js                 # In-app notifications
├── assets/
│   └── images/                          # High quality realistic LPG imagery
├── firestore.rules                      # Strict role-based security rules
├── storage.rules                        # Storage access rules
├── firebase.json                        # Firebase hosting configuration
├── README.md                            # Complete project overview
└── SETUP.md                             # Step-by-step setup guide
```

---

## 🚀 Getting Started

Read [`SETUP.md`](SETUP.md) for full instructions.

### Quick Start with Local Server:
```bash
# Using Python
python -m http.server 3000

# Or using Node
npx serve .
```
Then visit `http://localhost:3000` in your web browser.

---

## 🎓 College Software Engineering Project Alignment
- **Requirement Analysis**: Strictly follows the authentic Indian LPG distribution workflow.
- **Modular Design**: Fully segregated CSS and ES6 JavaScript modules with zero framework bloat.
- **Security Engineering**: 15-minute inactivity session expiration, no plaintext passwords, role-based database policies.
- **Maintainability**: Easy to read, debug, and edit in Visual Studio Code.
