/**
 * GasBridge - Authentication & Role-Based Access Control
 * Handles login, registration, session persistence, 15-min auto-logout, and role routing.
 * Strictly adheres to rules:
 * - NO passwords stored in Firestore or hard-coded in code.
 * - Single Administrator verified securely.
 * - Approval status enforcement: pending/rejected accounts blocked from dashboards.
 * - 15-minute inactivity monitor.
 */

import { 
  auth, 
  isDemo, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  onAuthStateChanged
} from "./firebase.js";

import { 
  resolveServiceAreaByPincode, 
  saveCustomerProfile, 
  saveDistributor,
  saveDeliveryAgent,
  getDistributors,
  getDeliveryAgents,
  getServiceAreas,
  getAllCustomers,
  createNotification,
  logAuditEvent,
  getCustomerProfile,
  getUserProfile,
  getDistributorById
} from "./firestore.js";

import { ADMIN_CONFIG } from "./firebase-config.js";
import { showToast, initInactivityTimer } from "./utils.js";

const ACTIVE_USER_KEY = 'gasbridge_active_user';

// Get currently authenticated user object from session
export function getCurrentUser() {
  const data = localStorage.getItem(ACTIVE_USER_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

// Set active user session (NEVER contains password - Rule 47)
export function setActiveUser(userObj) {
  const safeUser = { ...userObj };
  delete safeUser.password;
  delete safeUser.passwordHash;
  localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(safeUser));
}

// Clear active user session
export function clearActiveUser() {
  localStorage.removeItem(ACTIVE_USER_KEY);
}

// Role dashboard destinations
export const ROLE_DASHBOARD_MAP = {
  customer: 'customer-dashboard.html',
  distributor: 'distributor-dashboard.html',
  agent: 'agent-dashboard.html',
  deliveryAgent: 'agent-dashboard.html',
  admin: 'admin-dashboard.html'
};

/**
 * Route protection: Call on top of any dashboard page.
 * Blocks unauthenticated users, unauthorized roles, and pending/rejected accounts.
 */
export async function requireAuth(allowedRoles = []) {
  if (!isDemo && auth) {
    await new Promise(resolve => {
      let unsubscribe = () => {};
      unsubscribe = onAuthStateChanged(auth, firebaseUser => {
        unsubscribe();
        resolve(firebaseUser);
      }, () => resolve(null));
    });
  }
  const user = getCurrentUser();

  if (!user) {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    window.location.href = `login.html?redirect=${encodeURIComponent(currentPage)}`;
    return null;
  }

  if (!isDemo && (!auth?.currentUser || auth.currentUser.uid !== user.uid)) {
    clearActiveUser();
    window.location.href = 'login.html';
    return null;
  }

  if (!isDemo && !['admin', 'agent', 'deliveryAgent', 'distributor'].includes(user.role)) {
    const statusNow = (user.status || user.approvalStatus || '').toLowerCase();
    if (!['approved', 'active'].includes(statusNow)) {
      clearActiveUser();
      signOut(auth).catch(() => {});
      window.location.href = `login.html?status=${encodeURIComponent(statusNow || 'pending')}`;
      return null;
    }
  }

  // Check Approval Status (Rule 3, 6, 8, 14, 16, 45)
  const status = (user.status || user.approvalStatus || (isDemo ? 'approved' : 'pending')).toLowerCase();
  if (status === 'pending') {
    clearActiveUser();
    if (!isDemo && auth) signOut(auth).catch(() => {});
    let pendingMsg = "Your account is waiting for approval.";
    if (user.role === 'customer') pendingMsg = "Your customer registration is waiting for distributor approval.";
    else if (user.role === 'distributor') pendingMsg = "Your distributor account is waiting for administrator approval.";
    else if (user.role === 'agent' || user.role === 'deliveryAgent') pendingMsg = "Your delivery agent registration is waiting for distributor approval.";
    alert(pendingMsg);
    window.location.href = `login.html?status=pending`;
    return null;
  }

  if (status === 'rejected') {
    clearActiveUser();
    if (!isDemo && auth) signOut(auth).catch(() => {});
    let rejectedMsg = "Your registration was rejected.";
    if (user.role === 'customer') rejectedMsg = "Your registration was rejected. Please contact your distributor.";
    else if (user.role === 'distributor') rejectedMsg = "Your registration was rejected. Please contact the administrator.";
    else if (user.role === 'agent' || user.role === 'deliveryAgent') rejectedMsg = "Your registration was rejected. Please contact your distributor.";
    alert(rejectedMsg);
    window.location.href = `login.html?status=rejected`;
    return null;
  }

  // Check role authorization
  const userRole = user.role;
  const isAuthorized = allowedRoles.length === 0 || allowedRoles.some(r => {
    if (r === userRole) return true;
    if ((r === 'agent' || r === 'deliveryAgent') && (userRole === 'agent' || userRole === 'deliveryAgent')) return true;
    return false;
  });

  if (!isAuthorized) {
    const properPage = ROLE_DASHBOARD_MAP[userRole] || 'login.html';
    window.location.href = properPage;
    return null;
  }

  // Setup 15-Minute Inactivity Auto-Logout (Rule 42)
  setupInactivityAutoLogout(user);

  return user;
}

// 15-minute inactivity monitor (Rule 42)
function setupInactivityAutoLogout(user) {
  initInactivityTimer(async () => {
    await logAuditEvent(user.uid, user.role, "USER_AUTO_LOGOUT", user.uid, "Logged out due to 15 minutes of inactivity.");
    clearActiveUser();
    if (!isDemo && auth) {
      try { await signOut(auth); } catch (e) {}
    }
    window.location.href = "login.html?expired=1";
  }, 15);
}

/**
 * Perform Login (Rule 2, 6, 16, 18, 39)
 * Firebase Authentication -> UID -> Read profile -> Check status.
 */
export async function loginUser(emailOrMobile, password) {
  const identifier = String(emailOrMobile || '').trim().toLowerCase();

  if (!identifier || !password) {
    throw new Error("Please enter both email/mobile and password.");
  }

  if (isDemo) {
    throw new Error("Demo mode has no secure authentication configured. Connect Firebase Authentication before signing in.");
  }

  // Resolve email if user entered mobile number
  let targetEmail = identifier;
  if (!identifier.includes('@')) {
    throw new Error("Use the email address registered with your account.");
  }

  // 1. Live Firebase Authentication
  if (!isDemo && auth) {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, targetEmail, password);
      const firebaseUser = userCredential.user;
      const isAdminAccount = firebaseUser.email?.toLowerCase() === ADMIN_CONFIG.email.toLowerCase();
      if (!firebaseUser.emailVerified && !isAdminAccount) {
        await signOut(auth);
        throw new Error("Verify your email address before signing in.");
      }

      const persistedProfile = isAdminAccount ? null : await getUserProfile(firebaseUser.uid);
      if (!persistedProfile && !isAdminAccount) {
        await signOut(auth);
        throw new Error("No GasBridge profile is linked to this account. Submit registration first.");
      }

      // Single Administrator verification (Rule 2)
      if (isAdminAccount) {
        const adminSession = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          name: ADMIN_CONFIG.name,
          role: "admin",
          status: "approved",
          approvalStatus: "approved"
        };
        setActiveUser(adminSession);
        try {
          await logAuditEvent(adminSession.uid, "admin", "USER_LOGIN", adminSession.uid, "Admin authenticated via Firebase Auth.");
        } catch (auditError) {
          console.warn("Admin login succeeded, but the audit log could not be saved:", auditError);
        }
        return adminSession;
      }

      const distributorRecords = await getDistributors();
      const distributorRecord = distributorRecords.find(d => d.userId === firebaseUser.uid || d.email?.toLowerCase() === firebaseUser.email?.toLowerCase());
      if (distributorRecord) {
        const status = (distributorRecord.status || distributorRecord.approvalStatus || 'pending').toLowerCase();
        if (!['approved', 'active'].includes(status)) {
          await signOut(auth);
          throw new Error(status === 'rejected' ? 'Your registration was rejected. Contact the administrator.' : 'Your account is waiting for admin approval.');
        }
        const session = { uid: firebaseUser.uid, email: firebaseUser.email, name: distributorRecord.name, role: 'distributor', status, approvalStatus: status, distributorId: distributorRecord.id };
        setActiveUser(session);
        return session;
      }

      const agents = await getDeliveryAgents();
      const agentRecord = agents.find(a => a.userId === firebaseUser.uid || a.email?.toLowerCase() === firebaseUser.email?.toLowerCase());
      if (agentRecord) {
        const status = (agentRecord.status || agentRecord.approvalStatus || 'pending').toLowerCase();
        if (!['approved', 'active'].includes(status)) {
          await signOut(auth);
          throw new Error(status === 'rejected' ? 'Your registration was rejected. Contact your distributor.' : 'Your account is waiting for distributor approval.');
        }
        const session = { uid: firebaseUser.uid, email: firebaseUser.email, name: agentRecord.name, role: 'agent', status, approvalStatus: status, agentId: agentRecord.id, distributorId: agentRecord.distributorId };
        setActiveUser(session);
        return session;
      }

      // Read profile from users/{uid}
      let userDoc = persistedProfile;
      let userRole = userDoc?.role || 'customer';
      let extraData = userDoc || {};

      // If customer, merge customer profile
      if (userRole === 'customer') {
        const custProfile = await getCustomerProfile(firebaseUser.uid);
        if (custProfile) extraData = { ...extraData, ...custProfile };
      }

      // Check Approval Status (Rule 6, 16)
      const currentStatus = (extraData.status || extraData.approvalStatus || 'pending').toLowerCase();
      if (currentStatus === 'pending') {
        await signOut(auth);
        if (userRole === 'distributor') throw new Error("Your account is waiting for admin approval.");
        if (userRole === 'agent' || userRole === 'deliveryAgent') throw new Error("Your account is waiting for distributor approval.");
        throw new Error("Your account is waiting for distributor approval.");
      }

      if (currentStatus === 'rejected') {
        await signOut(auth);
        if (userRole === 'distributor') throw new Error("Your registration was rejected. Please contact the administrator.");
        if (userRole === 'agent' || userRole === 'deliveryAgent') throw new Error("Your registration was rejected. Please contact your distributor.");
        throw new Error("Your registration was rejected. Please contact your distributor.");
      }

      const userSession = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        name: extraData.name || firebaseUser.displayName || 'User',
        role: userRole,
        status: currentStatus,
        approvalStatus: currentStatus,
        ...extraData
      };

      if (!['customer', 'distributor', 'agent', 'deliveryAgent', 'admin'].includes(userSession.role) ||
          !['approved', 'active'].includes(currentStatus)) {
        await signOut(auth);
        throw new Error(currentStatus === 'rejected'
          ? "Your registration was rejected. Contact your approving organization."
          : "Your account is awaiting approval.");
      }

      setActiveUser(userSession);
      await logAuditEvent(userSession.uid, userSession.role, "USER_LOGIN", userSession.uid, "Firebase login successful.");
      return userSession;

    } catch (err) {
      if (err.message && (err.message.includes("waiting for") || err.message.includes("rejected") || err.message.includes("awaiting approval") || err.message.includes("Verify your email") || err.message.includes("No GasBridge profile"))) {
        throw err;
      }
      if (err.code === 'auth/user-not-found' || 
          err.code === 'auth/wrong-password' || 
          err.code === 'auth/invalid-credential' || 
          err.code === 'auth/invalid-login-credentials') {
        throw new Error("Invalid email or password.");
      } else if (err.code === 'auth/invalid-email') {
        throw new Error("Please enter a valid email address.");
      } else if (err.code === 'auth/too-many-requests') {
        throw new Error("Too many failed login attempts. Please wait a moment and try again.");
      }
      throw new Error(err.message || "Unable to sign in. Check your Firebase connection and account status.");
    }
  }

  throw new Error("Firebase Authentication is not configured. Connect Firebase before signing in.");
}

/**
 * Customer Registration (Rule 10, 11, 12, 13)
 * Collects Personal Details, Permanent Home Address, and Mandatory Cylinder Type.
 * Initial status: "pending".
 * NEVER stores password in Firestore!
 */
export async function registerCustomer(formData) {
  const {
    name,
    mobile,
    email,
    password,
    houseNo,
    street,
    area,
    city,
    district,
    state,
    pincode,
    cylinderType
  } = formData;

  // 1. Mandatory validation
  if (!name || !mobile || !email || !password || !houseNo || !street || !area || !city || !district || !state || !pincode) {
    throw new Error("All fields including full address and pincode are required.");
  }

  // Mandatory Cylinder Type validation (Rule 10, 11)
  const validCylinderType = String(cylinderType || '').toLowerCase();
  if (validCylinderType !== 'domestic' && validCylinderType !== 'commercial') {
    throw new Error("Please select your cylinder type (Domestic Cylinder or Commercial Cylinder).");
  }

  const cleanMobile = mobile.replace(/[^0-9]/g, '');
  if (cleanMobile.length !== 10) {
    throw new Error("Please enter a valid 10-digit mobile number.");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }

  const cleanEmail = email.trim().toLowerCase();

  // 2. Validate Pincode and resolve service area & authorized distributor (Rule 12)
  const resolution = await resolveServiceAreaByPincode(pincode);
  if (!resolution.supported) {
    throw new Error(resolution.message || "GasBridge is currently unavailable in this pincode.");
  }

  const serviceArea = resolution.serviceArea;
  const distributor = resolution.distributor;

  if (!distributor) {
    throw new Error("No authorized LPG distributor is currently active for your service area.");
  }

  // 3. Create Firebase Authentication account (Password handled ONLY by Firebase Auth - Rule 47)
  let uid = "cust-" + Date.now();
  if (!isDemo && auth) {
    try {
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      uid = cred.user.uid;
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        throw new Error("This email is already registered. Please sign in.");
      } else if (err.code === 'auth/weak-password') {
        throw new Error("Password must be at least 8 characters long.");
      }
      throw new Error(err.message || "Unable to create your account in Firebase Authentication.");
    }
  }
  if (isDemo || !auth) throw new Error("Connect Firebase Authentication before creating an account.");

  // 4. Save Customer Profile in Firestore (Rule 11: customers/{customerId})
  const customerProfile = {
    userId: uid,
    uid,
    name: name.trim(),
    email: cleanEmail,
    mobile: `+91 ${cleanMobile}`,
    address: {
      houseNo: houseNo.trim(),
      street: street.trim(),
      area: area.trim(),
      city: city.trim(),
      district: district.trim(),
      state: state.trim(),
      pincode: String(pincode).trim()
    },
    pincode: String(pincode).trim(),
    serviceAreaId: serviceArea.id,
    serviceAreaName: serviceArea.name,
    distributorId: distributor.id,
    distributorName: distributor.name,
    cylinderType: validCylinderType, // "domestic" | "commercial"
    status: "pending", // Initial status: pending (Rule 13)
    approvalStatus: "pending",
    active: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await saveCustomerProfile(customerProfile);

  // In-app alert for the assigned distributor (Rule 13)
  await createNotification(
    distributor.userId || distributor.id,
    "distributor",
    "Customer Registration Request",
    `New customer ${name.trim()} (${validCylinderType.toUpperCase()} LPG) at ${houseNo.trim()}, ${city.trim()} (${pincode}) awaits your approval.`,
    "distributor-customers.html"
  );

  await logAuditEvent(
    uid,
    "customer",
    "CUSTOMER_REGISTERED",
    uid,
    `Customer registered at ${houseNo}, ${city} (${pincode}). Cylinder type: ${validCylinderType}. Routed to distributor: ${distributor.name}. Status: pending.`
  );

  return {
    success: true,
    customerProfile,
    message: "Registration submitted successfully. Your customer registration is waiting for distributor approval."
  };
}

/**
 * Distributor Registration (Rule 3)
 * Collects Personal Details and Business Details.
 * Initial status: "pending".
 * Only Admin can approve (Rule 4).
 * NEVER stores password in Firestore!
 */
export async function registerDistributor(formData) {
  const {
    name,
    contactPerson,
    businessName,
    agencyName,
    email,
    mobile,
    password,
    address,
    premise,
    street,
    city,
    district,
    state,
    pincode,
    pincodes
  } = formData;

  const distName = (businessName || agencyName || '').trim();
  const contactName = (name || contactPerson || distName).trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanMobile = String(mobile || '').replace(/[^0-9]/g, '');

  if (!distName || !contactName || !cleanEmail || !password || cleanMobile.length !== 10) {
    throw new Error("Full name, business name, official email, 10-digit mobile, and password are required.");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }

  const cleanPin = String(pincode || (Array.isArray(pincodes) ? pincodes[0] : pincodes) || '').trim();
  const pincodeList = cleanPin ? cleanPin.split(',').map(p => p.trim()).filter(Boolean) : ["509216"];

  const fullAddress = address ? address.trim() : `${premise ? premise.trim() + ', ' : ''}${street ? street.trim() + ', ' : ''}${city ? city.trim() + ', ' : ''}${district ? district.trim() + ', ' : ''}${state ? state.trim() : 'Telangana'} ${pincodeList[0] || ''}`;

  let uid = "user-dist-" + Date.now().toString().slice(-6);
  const distId = "dist-" + Date.now().toString().slice(-5);

  if (!isDemo && auth) {
    try {
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      uid = cred.user.uid;
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        throw new Error("This email is already registered. Please sign in.");
      }
      throw new Error(err.message || "Unable to register distributor in Firebase Authentication.");
    }
  }
  if (isDemo || !auth) throw new Error("Connect Firebase Authentication before creating an account.");

  // Create distributor profile in Firestore: distributors/{distributorId} (Rule 3)
  const distributorRecord = {
    id: distId,
    userId: uid,
    name: distName,
    businessName: distName,
    contactPerson: contactName,
    email: cleanEmail,
    mobile: `+91 ${cleanMobile}`,
    address: fullAddress,
    city: (city || "Local City").trim(),
    district: (district || "Local District").trim(),
    state: (state || "Telangana").trim(),
    pincode: pincodeList[0] || "509216",
    pincodes: pincodeList,
    serviceAreaId: "",
    serviceAreaIds: [],
    status: "pending", // Initial status: pending (Rule 3)
    approvalStatus: "pending",
    active: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await saveDistributor(distributorRecord);

  // In-app alert for Administrator (Rule 4)
  await createNotification(
    "admin@gasbridge.com",
    "admin",
    "Distributor Registration Request",
    `New distributor "${distName}" has submitted registration and awaits your approval.`,
    "admin-dashboard.html"
  );

  await logAuditEvent(
    uid,
    "distributor",
    "DISTRIBUTOR_REGISTRATION_SUBMITTED",
    distId,
    `Distributor "${distName}" registered with pincodes [${pincodeList.join(', ')}]. Status: pending.`
  );

  return {
    success: true,
    distributorId: distId,
    message: "Registration submitted successfully. Your distributor account is waiting for administrator approval."
  };
}

/**
 * Delivery Agent Registration (Rule 7)
 * Associated with a Distributor.
 * Initial status: "pending".
 * Only Distributor can approve (Rule 8).
 * NEVER stores password in Firestore!
 */
export async function registerDeliveryAgent(formData) {
  const {
    name,
    mobile,
    email,
    password,
    address,
    pincode,
    vehicleType,
    vehicleNumber,
    distributorId,
    selectedDistributorId
  } = formData;

  const agentName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanMobile = String(mobile || '').replace(/[^0-9]/g, '');
  const cleanPin = String(pincode || '').trim();
  let assignedDistId = distributorId || selectedDistributorId;

  if (!agentName || !cleanEmail || !password || cleanMobile.length !== 10) {
    throw new Error("Full name, email, mobile, and password are required.");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }

  // Resolve distributor if not manually chosen
  if (!assignedDistId) {
    const resolution = await resolveServiceAreaByPincode(cleanPin);
    if (resolution.supported && resolution.distributor) {
      assignedDistId = resolution.distributor.id;
    } else {
      const allDists = await getDistributors();
      if (allDists.length > 0) assignedDistId = allDists[0].id;
      else throw new Error("No authorized distributor found to route this delivery agent registration.");
    }
  }

  const assignedDist = await getDistributorById(assignedDistId);

  let uid = "user-agent-" + Date.now().toString().slice(-6);
  const agentId = "agent-" + Date.now().toString().slice(-5);

  if (!isDemo && auth) {
    try {
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      uid = cred.user.uid;
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        throw new Error("This email is already registered. Please sign in.");
      }
      throw new Error(err.message || "Unable to register delivery agent in Firebase Authentication.");
    }
  }
  if (isDemo || !auth) throw new Error("Connect Firebase Authentication before creating an account.");

  // Create deliveryAgents/{agentId} (Rule 7)
  const agentRecord = {
    id: agentId,
    userId: uid,
    name: agentName,
    email: cleanEmail,
    mobile: `+91 ${cleanMobile}`,
    address: (address || `Pincode ${cleanPin}`).trim(),
    pincode: cleanPin,
    pincodes: [cleanPin],
    vehicleType: vehicleType || "Delivery Vehicle",
    vehicleNumber: (vehicleNumber || "TS 08 REG").trim().toUpperCase(),
    distributorId: assignedDistId,
    distributorName: assignedDist ? assignedDist.name : "Authorized LPG Depot",
    status: "pending", // Initial status: pending (Rule 7)
    approvalStatus: "pending",
    dutyStatus: "offline",
    active: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await saveDeliveryAgent(agentRecord);

  // In-app alert for the associated distributor (Rule 8)
  await createNotification(
    assignedDist ? (assignedDist.userId || assignedDist.id) : assignedDistId,
    "distributor",
    "Delivery Agent Request",
    `Delivery agent ${agentName} (${agentRecord.vehicleNumber}) has applied for your depot. Awaiting your approval.`,
    "distributor-agents.html"
  );

  await logAuditEvent(
    uid,
    "agent",
    "AGENT_REGISTRATION_SUBMITTED",
    agentId,
    `Delivery agent ${agentName} registered for pincode ${cleanPin}. Associated distributor: ${assignedDistId}. Status: pending.`
  );

  return {
    success: true,
    agentId,
    message: "Registration submitted successfully. Your delivery agent registration is waiting for distributor approval."
  };
}

// User Logout
export async function logoutUser() {
  const user = getCurrentUser();
  if (user) {
    await logAuditEvent(user.uid, user.role, "USER_LOGOUT", user.uid, "User logged out.");
  }
  clearActiveUser();
  if (!isDemo && auth) {
    try { await signOut(auth); } catch (e) {}
  }
  window.location.href = "login.html";
}
