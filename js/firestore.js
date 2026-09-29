/**
 * GasBridge - Cloud Firestore Operations & Database Abstraction Layer
 * Supports live Cloud Firestore collections as well as instant seeded demo store.
 * NO passwords stored in Firestore.
 */

import { 
  auth,
  db, 
  isDemo, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  writeBatch,
  runTransaction,
  updateDoc, 
  query, 
  where
} from "./firebase.js";

import { 
  SEED_SERVICE_AREAS, 
  SEED_DISTRIBUTORS, 
  SEED_DELIVERY_AGENTS, 
  SEED_INVENTORY,
  ADMIN_CONFIG
} from "./firebase-config.js";

import { generateBookingId } from "./utils.js";
import { sendApprovalNotification } from "./notifications.js";

// Local Storage Keys for Demo Mode persistence
const STORAGE_KEYS = {
  USERS: 'gasbridge_users',
  CUSTOMERS: 'gasbridge_customers',
  SERVICE_AREAS: 'gasbridge_service_areas',
  DISTRIBUTORS: 'gasbridge_distributors',
  DELIVERY_AGENTS: 'gasbridge_delivery_agents',
  INVENTORY: 'gasbridge_inventory',
  BOOKINGS: 'gasbridge_bookings',
  PAYMENTS: 'gasbridge_payments',
  NOTIFICATIONS: 'gasbridge_notifications',
  AUDIT_LOGS: 'gasbridge_audit_logs'
};

function persistLocally() { return isDemo || !db; }
function requireLiveWrite(write) { return isDemo || !db ? Promise.resolve() : write(); }
function normalizePincodeValues(...values) {
  const raw = values.flatMap(value => Array.isArray(value) ? value : [value])
    .flatMap(value => String(value ?? '').split(/[,;\s]+/))
    .map(value => value.trim())
    .filter(Boolean);
  return [...new Set(raw.filter(value => /^\d{6}$/.test(value)))];
}
function isCurrentAdmin() {
  return auth?.currentUser?.email?.toLowerCase() === ADMIN_CONFIG.email.toLowerCase();
}
async function hasAdminAccess() {
  if (isCurrentAdmin()) return true;
  const uid = auth?.currentUser?.uid;
  return uid ? (await getUserProfile(uid))?.role === 'admin' : false;
}

// Initialize Demo Seed Storage if not already populated
function initDemoStore() {
  if (!localStorage.getItem(STORAGE_KEYS.SERVICE_AREAS)) {
    localStorage.setItem(STORAGE_KEYS.SERVICE_AREAS, JSON.stringify(SEED_SERVICE_AREAS));
  }
  if (!localStorage.getItem(STORAGE_KEYS.DISTRIBUTORS)) {
    localStorage.setItem(STORAGE_KEYS.DISTRIBUTORS, JSON.stringify(SEED_DISTRIBUTORS));
  }
  if (!localStorage.getItem(STORAGE_KEYS.DELIVERY_AGENTS)) {
    localStorage.setItem(STORAGE_KEYS.DELIVERY_AGENTS, JSON.stringify(SEED_DELIVERY_AGENTS));
  }
  if (!localStorage.getItem(STORAGE_KEYS.INVENTORY)) {
    localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(SEED_INVENTORY));
  }

  if (!localStorage.getItem(STORAGE_KEYS.BOOKINGS)) {
    const initialBooking = {
      bookingId: "GB-20260928-0012",
      customerId: "user-cust-01",
      customerName: "Ramesh Sharma",
      customerMobile: "+91 9876500001",
      deliveryAddress: {
        houseNo: "12-45",
        street: "Main Road",
        area: "Shadnagar Town",
        city: "Shadnagar",
        district: "Rangareddy",
        state: "Telangana",
        pincode: "509216"
      },
      serviceAreaId: "sa-01",
      distributorId: "dist-01",
      deliveryAgentId: "agent-01",
      cylinderType: "domestic",
      cylinderName: "Domestic LPG Cylinder (14.2 kg)",
      quantity: 1,
      unitPrice: 950,
      totalAmount: 950,
      paymentId: "PAY-DEMO-9912",
      paymentStatus: "paid",
      paymentMethod: "demo_qr",
      transactionReference: "GBPAY-INIT0012",
      bookingStatus: "out_for_delivery",
      estimatedDelivery: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
      updatedAt: new Date().toISOString(),
      statusTimeline: [
        { status: "confirmed", time: new Date(Date.now() - 3600000 * 3).toISOString(), note: "Booking confirmed via Demo QR Payment." },
        { status: "processing", time: new Date(Date.now() - 3600000 * 2).toISOString(), note: "Distributor processed order." },
        { status: "agent_assigned", time: new Date(Date.now() - 3600000 * 1.5).toISOString(), note: "Agent Suresh Kumar assigned." },
        { status: "picked_up", time: new Date(Date.now() - 3600000 * 1).toISOString(), note: "Cylinder loaded onto delivery vehicle." },
        { status: "out_for_delivery", time: new Date(Date.now() - 1800000).toISOString(), note: "Agent en route to delivery address." }
      ]
    };
    localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify([initialBooking]));
  }

  if (!localStorage.getItem(STORAGE_KEYS.PAYMENTS)) {
    const initialPayment = {
      paymentId: "PAY-DEMO-9912",
      bookingId: "GB-20260928-0012",
      customerId: "user-cust-01",
      amount: 950,
      paymentMethod: "demo_qr",
      status: "success",
      transactionReference: "GBPAY-INIT0012",
      createdAt: new Date(Date.now() - 3600000 * 3).toISOString()
    };
    localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify([initialPayment]));
  }

  // Preserve a genuinely empty demo identity store; no seed accounts have passwords.
}

initDemoStore();

// Master data is provisioned through the authenticated administrator workflow.
export async function seedLiveFirestoreIfEmpty() {
  return false;
}

/* ==========================================================================
   SERVICE AREA & DISTRIBUTOR RESOLUTION RULES (Rule 12)
   Customer fixed pincode -> Service Area -> Authorized Distributor
   ========================================================================== */

export async function resolveServiceAreaByPincode(pincode) {
  const cleanPin = String(pincode || '').trim();
  if (!/^\d{6}$/.test(cleanPin)) {
    return { supported: false, message: "Please enter a valid 6-digit pincode." };
  }

  const serviceAreas = await getServiceAreas();
  const distributors = await getDistributors();
  const approvedDistributors = distributors.filter(distributor => {
    const status = String(distributor.status || distributor.approvalStatus || '').toLowerCase();
    return ['approved', 'active'].includes(status) || (!status && distributor.active === true);
  });
  const registeredCoverage = distributor => {
    const coverage = normalizePincodeValues(distributor.pincodes);
    return coverage.length ? coverage : normalizePincodeValues(distributor.pincode);
  };
  const matchingDistributors = approvedDistributors.filter(distributor => registeredCoverage(distributor).includes(cleanPin));
  const mappedArea = serviceAreas.find(area => area.active && normalizePincodeValues(area.pincodes).includes(cleanPin) &&
    matchingDistributors.some(distributor => distributor.id === area.distributorId));

  if (matchingDistributors.length) {
    const distributor = mappedArea
      ? matchingDistributors.find(candidate => candidate.id === mappedArea.distributorId)
      : matchingDistributors[0];
    const distributorArea = serviceAreas.find(candidate => candidate.distributorId === distributor.id && candidate.active &&
      normalizePincodeValues(candidate.pincodes).includes(cleanPin));
    const area = mappedArea || distributorArea || {
      id: `sa-${String(distributor.id).replace(/^dist-/, '')}`,
      name: `${distributor.city || distributor.name || 'Local'} Service Area`,
      city: distributor.city || '', district: distributor.district || '', state: distributor.state || '',
      pincodes: [cleanPin], distributorId: distributor.id, active: true
    };
    return { supported: true, serviceArea: area, distributor };
  }

  const area = serviceAreas.find(sa => sa.active && normalizePincodeValues(sa.pincodes).includes(cleanPin));

  if (!area) {
    return {
      supported: false,
      message: "GasBridge is currently unavailable in this pincode."
    };
  }

  const distributor = approvedDistributors.find(d => d.id === area.distributorId);

  return {
    supported: true,
    serviceArea: area,
    distributor: distributor || null
  };
}

/* ==========================================================================
   GETTERS & SETTERS (Cross-compatible Firestore & Storage)
   ========================================================================== */

export async function getServiceAreas() {
  if (!isDemo && db) {
    try {
      const snap = await getDocs(collection(db, "serviceAreas"));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn("Firestore error reading serviceAreas:", e);
      throw e;
    }
  }
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.SERVICE_AREAS) || '[]');
}

export async function getDistributors() {
  if (!isDemo && db) {
    try {
      const snap = await getDocs(collection(db, "distributors"));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn("Firestore error reading distributors:", e);
      throw e;
    }
  }
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.DISTRIBUTORS) || '[]');
}

export async function getDistributorById(distributorId) {
  const dists = await getDistributors();
  return dists.find(d => d.id === distributorId) || null;
}

export async function getDeliveryAgents(distributorId = null) {
  let agents = [];
  if (!isDemo && db) {
    try {
      let q = collection(db, "deliveryAgents");
      if (distributorId) {
        q = query(q, where("distributorId", "==", distributorId));
      }
      const snap = await getDocs(q);
      agents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn("Firestore error reading deliveryAgents:", e);
      throw e;
    }
  }
  if (agents.length === 0 && persistLocally()) {
    agents = JSON.parse(localStorage.getItem(STORAGE_KEYS.DELIVERY_AGENTS) || '[]');
  }
  if (distributorId) {
    return agents.filter(a => a.distributorId === distributorId);
  }
  return agents;
}

export async function getDeliveryAgentById(agentId) {
  if (!persistLocally()) {
    const snap = await getDoc(doc(db, 'deliveryAgents', agentId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }
  return (await getDeliveryAgents()).find(agent => agent.id === agentId) || null;
}

export async function getCustomerProfile(customerId) {
  if (!isDemo && db) {
    try {
      const docRef = doc(db, "customers", customerId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return { uid: snap.id, ...snap.data() };
      }
      return null;
    } catch (e) {
      console.warn("Firestore error reading customer profile:", e);
      throw e;
    }
  }
  const customers = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS) || '[]');
  return customers.find(c => c.uid === customerId || c.userId === customerId) || null;
}

export async function getUserProfile(uid) {
  if (!isDemo && db) {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) {
        return snap.data();
      }
      return null;
    } catch (e) {
      console.warn("Firestore error reading user profile:", e);
      throw e;
    }
  }
  const users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
  return users.find(u => u.uid === uid) || null;
}

export async function saveCustomerProfile(profileData) {
  const timestamp = new Date().toISOString();
  const cleanProfile = {
    userId: profileData.userId || profileData.uid,
    uid: profileData.userId || profileData.uid,
    name: profileData.name,
    mobile: profileData.mobile,
    email: profileData.email,
    address: profileData.address,
    pincode: profileData.pincode || (profileData.address ? profileData.address.pincode : ''),
    serviceAreaId: profileData.serviceAreaId || '',
    serviceAreaName: profileData.serviceAreaName || '',
    distributorId: profileData.distributorId || '',
    distributorName: profileData.distributorName || '',
    cylinderType: profileData.cylinderType || 'domestic',
    status: profileData.status || profileData.approvalStatus || 'pending',
    approvalStatus: profileData.status || profileData.approvalStatus || 'pending',
    active: profileData.active === true || profileData.status === 'approved' || profileData.approvalStatus === 'approved',
    createdAt: profileData.createdAt || timestamp,
    updatedAt: timestamp
  };

  if (profileData.approvedAt) cleanProfile.approvedAt = profileData.approvedAt;
  if (profileData.approvedBy) cleanProfile.approvedBy = profileData.approvedBy;
  if (profileData.rejectedAt) cleanProfile.rejectedAt = profileData.rejectedAt;
  if (profileData.rejectedBy) cleanProfile.rejectedBy = profileData.rejectedBy;
  if (profileData.rejectionReason) cleanProfile.rejectionReason = profileData.rejectionReason;

  if (!persistLocally() && cleanProfile.status === 'pending') {
    const caller = await getUserProfile(auth.currentUser?.uid || '');
    if (caller?.role !== 'customer' || (profileData.userId || profileData.uid) !== auth.currentUser.uid) {
      throw new Error('Customer registration must use the signed-in customer account.');
    }
  }

  const userRec = {
        uid: cleanProfile.uid,
        name: cleanProfile.name,
        email: cleanProfile.email,
        mobile: cleanProfile.mobile,
        role: "customer",
        cylinderType: cleanProfile.cylinderType,
        status: cleanProfile.status,
        approvalStatus: cleanProfile.status,
        distributorId: cleanProfile.distributorId,
        createdAt: cleanProfile.createdAt,
        updatedAt: timestamp
      };
  if (!persistLocally()) {
    if (cleanProfile.status !== 'pending') {
      const batch = writeBatch(db);
      batch.update(doc(db, 'customers', cleanProfile.uid), {
        status: cleanProfile.status, approvalStatus: cleanProfile.approvalStatus, active: cleanProfile.active,
        approvedAt: cleanProfile.approvedAt || null, approvedBy: cleanProfile.approvedBy || null,
        rejectedAt: cleanProfile.rejectedAt || null, rejectedBy: cleanProfile.rejectedBy || null,
        rejectionReason: cleanProfile.rejectionReason || null, updatedAt: timestamp
      });
      batch.update(doc(db, 'users', cleanProfile.uid), {
        status: cleanProfile.status, approvalStatus: cleanProfile.approvalStatus, active: cleanProfile.active,
        approvedAt: cleanProfile.approvedAt || null, approvedBy: cleanProfile.approvedBy || null,
        rejectedAt: cleanProfile.rejectedAt || null, rejectedBy: cleanProfile.rejectedBy || null,
        rejectionReason: cleanProfile.rejectionReason || null, updatedAt: timestamp
      });
      await batch.commit();
      return cleanProfile;
    }
    const batch = writeBatch(db);
    batch.set(doc(db, "customers", cleanProfile.uid), cleanProfile);
    const userRef = doc(db, "users", cleanProfile.uid);
    batch.set(userRef, userRec);
    await batch.commit();
    return cleanProfile;
  }
  await requireLiveWrite(async () => {
      await setDoc(doc(db, "customers", cleanProfile.uid), cleanProfile, { merge: true });
      await setDoc(doc(db, "users", cleanProfile.uid), userRec, { merge: true });
  });
  const customers = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS) || '[]');
  const idx = customers.findIndex(c => (c.uid === cleanProfile.uid || c.userId === cleanProfile.uid));
  if (idx >= 0) {
    customers[idx] = { ...customers[idx], ...cleanProfile };
  } else {
    customers.push(cleanProfile);
  }
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(customers));

  // Sync users
  const users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
  const uIdx = users.findIndex(u => u.uid === cleanProfile.uid);
  const userRecLocal = userRec;
  if (uIdx >= 0) users[uIdx] = { ...users[uIdx], ...userRecLocal };
  else users.push(userRecLocal);
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));

  return cleanProfile;
}

export async function saveDistributor(distData) {
  const timestamp = new Date().toISOString();
  const normalizedPincodes = normalizePincodeValues(distData.pincodes);
  const primaryPincode = normalizedPincodes[0] || normalizePincodeValues(distData.pincode)[0] || '';
  const storedPincodes = normalizedPincodes.length ? normalizedPincodes : primaryPincode ? [primaryPincode] : [];
  const cleanDist = {
    id: distData.id,
    userId: distData.userId || distData.id,
    name: distData.name,
    businessName: distData.businessName || distData.name,
    mobile: distData.mobile,
    email: distData.email,
    address: distData.address,
    city: distData.city || '',
    district: distData.district || '',
    state: distData.state || 'Telangana',
    pincode: primaryPincode,
    pincodes: storedPincodes,
    serviceAreaId: distData.serviceAreaId || '',
    serviceAreaIds: distData.serviceAreaIds || [],
    status: distData.status || distData.approvalStatus || 'pending',
    approvalStatus: distData.status || distData.approvalStatus || 'pending',
    active: distData.active === true || distData.status === 'approved' || distData.approvalStatus === 'approved',
    createdAt: distData.createdAt || timestamp,
    updatedAt: timestamp
  };

  if (distData.approvedAt) cleanDist.approvedAt = distData.approvedAt;
  if (distData.approvedBy) cleanDist.approvedBy = distData.approvedBy;
  if (distData.rejectedAt) cleanDist.rejectedAt = distData.rejectedAt;
  if (distData.rejectedBy) cleanDist.rejectedBy = distData.rejectedBy;
  if (distData.rejectionReason) cleanDist.rejectionReason = distData.rejectionReason;

  if (!persistLocally() && cleanDist.status === 'pending' && cleanDist.userId !== auth.currentUser?.uid) {
    throw new Error('Distributor registration must use the signed-in account.');
  }

  const linkedUser = {
    uid: cleanDist.userId, name: cleanDist.contactPerson || cleanDist.name, email: cleanDist.email,
    mobile: cleanDist.mobile, role: 'distributor', distributorId: cleanDist.id,
    status: cleanDist.status, approvalStatus: cleanDist.status, createdAt: cleanDist.createdAt, updatedAt: timestamp
  };
  if (cleanDist.status !== 'pending') {
    if (!persistLocally()) {
      const batch = writeBatch(db);
      batch.update(doc(db, 'distributors', cleanDist.id), {
        status: cleanDist.status, approvalStatus: cleanDist.approvalStatus, active: cleanDist.active,
        approvedAt: cleanDist.approvedAt || null, approvedBy: cleanDist.approvedBy || null,
        rejectedAt: cleanDist.rejectedAt || null, rejectedBy: cleanDist.rejectedBy || null,
        rejectionReason: cleanDist.rejectionReason || null, updatedAt: timestamp
      });
      batch.update(doc(db, 'users', cleanDist.userId), { status: cleanDist.status, approvalStatus: cleanDist.status, updatedAt: timestamp });
      await batch.commit();
      return cleanDist;
    }
    const dists = await getDistributors();
    const idx = dists.findIndex(item => item.id === cleanDist.id);
    if (idx >= 0) dists[idx] = { ...dists[idx], ...cleanDist };
    localStorage.setItem(STORAGE_KEYS.DISTRIBUTORS, JSON.stringify(dists));
    return cleanDist;
  }
  if (!persistLocally()) {
    const batch = writeBatch(db);
    batch.set(doc(db, 'distributors', cleanDist.id), cleanDist);
    const userRef = doc(db, 'users', cleanDist.userId);
    if (cleanDist.status === 'pending') batch.set(userRef, linkedUser);
    else batch.update(userRef, { status: cleanDist.status, approvalStatus: cleanDist.status, updatedAt: timestamp });
    await batch.commit();
    return cleanDist;
  }
  await requireLiveWrite(() => setDoc(doc(db, "distributors", cleanDist.id), cleanDist, { merge: true }));

  if (!persistLocally()) return cleanDist;
  const dists = await getDistributors();
  const idx = dists.findIndex(d => d.id === cleanDist.id);
  if (idx >= 0) dists[idx] = { ...dists[idx], ...cleanDist };
  else dists.push(cleanDist);
  localStorage.setItem(STORAGE_KEYS.DISTRIBUTORS, JSON.stringify(dists));
  return cleanDist;
}

export async function saveDeliveryAgent(agentData) {
  const timestamp = new Date().toISOString();
  const cleanAgent = {
    id: agentData.id,
    userId: agentData.userId || agentData.id,
    name: agentData.name,
    mobile: agentData.mobile,
    email: agentData.email,
    address: agentData.address || '',
    pincode: agentData.pincode || (agentData.pincodes ? agentData.pincodes[0] : ''),
    pincodes: agentData.pincodes || (agentData.pincode ? [agentData.pincode] : []),
    vehicleType: agentData.vehicleType || '',
    vehicleNumber: agentData.vehicleNumber || '',
    distributorId: agentData.distributorId || '',
    status: agentData.status || agentData.approvalStatus || 'pending',
    approvalStatus: agentData.status || agentData.approvalStatus || 'pending',
    dutyStatus: agentData.dutyStatus || 'offline',
    active: agentData.active === true || agentData.status === 'approved' || agentData.approvalStatus === 'approved',
    createdAt: agentData.createdAt || timestamp,
    updatedAt: timestamp
  };

  if (agentData.approvedAt) cleanAgent.approvedAt = agentData.approvedAt;
  if (agentData.approvedBy) cleanAgent.approvedBy = agentData.approvedBy;
  if (agentData.rejectedAt) cleanAgent.rejectedAt = agentData.rejectedAt;
  if (agentData.rejectedBy) cleanAgent.rejectedBy = agentData.rejectedBy;
  if (agentData.rejectionReason) cleanAgent.rejectionReason = agentData.rejectionReason;

  const linkedUser = {
    uid: cleanAgent.userId, name: cleanAgent.name, email: cleanAgent.email,
    mobile: cleanAgent.mobile, role: 'agent', agentId: cleanAgent.id,
    distributorId: cleanAgent.distributorId, status: cleanAgent.status,
    approvalStatus: cleanAgent.status, createdAt: cleanAgent.createdAt, updatedAt: timestamp
  };
  if (!persistLocally() && cleanAgent.status === 'pending' && cleanAgent.distributorId) {
    const distributor = await getDistributorById(cleanAgent.distributorId);
    if (!distributor || (distributor.userId !== auth.currentUser?.uid && !(await hasAdminAccess()))) {
      throw new Error('A delivery agent can only register with its assigned distributor.');
    }
  }
  if (cleanAgent.status !== 'pending') {
    if (!persistLocally()) {
      const batch = writeBatch(db);
      batch.update(doc(db, 'deliveryAgents', cleanAgent.id), {
        status: cleanAgent.status, approvalStatus: cleanAgent.approvalStatus, active: cleanAgent.active,
        dutyStatus: cleanAgent.dutyStatus, approvedAt: cleanAgent.approvedAt || null, approvedBy: cleanAgent.approvedBy || null,
        rejectedAt: cleanAgent.rejectedAt || null, rejectedBy: cleanAgent.rejectedBy || null,
        rejectionReason: cleanAgent.rejectionReason || null, updatedAt: timestamp
      });
      batch.update(doc(db, 'users', cleanAgent.userId), {
        status: cleanAgent.status, approvalStatus: cleanAgent.status, active: cleanAgent.active,
        approvedAt: cleanAgent.approvedAt || null, approvedBy: cleanAgent.approvedBy || null,
        rejectedAt: cleanAgent.rejectedAt || null, rejectedBy: cleanAgent.rejectedBy || null,
        rejectionReason: cleanAgent.rejectionReason || null, updatedAt: timestamp
      });
      await batch.commit();
      return cleanAgent;
    }
    const agents = await getDeliveryAgents();
    const idx = agents.findIndex(item => item.id === cleanAgent.id);
    if (idx >= 0) agents[idx] = { ...agents[idx], ...cleanAgent };
    localStorage.setItem(STORAGE_KEYS.DELIVERY_AGENTS, JSON.stringify(agents));
    return cleanAgent;
  }
  if (!persistLocally()) {
    const batch = writeBatch(db);
    batch.set(doc(db, 'deliveryAgents', cleanAgent.id), cleanAgent);
    const userRef = doc(db, 'users', cleanAgent.userId);
    if (cleanAgent.status === 'pending') batch.set(userRef, linkedUser);
    else batch.update(userRef, { status: cleanAgent.status, approvalStatus: cleanAgent.status, updatedAt: timestamp });
    await batch.commit();
    return cleanAgent;
  }
  await requireLiveWrite(() => setDoc(doc(db, "deliveryAgents", cleanAgent.id), cleanAgent, { merge: true }));

  if (!persistLocally()) return cleanAgent;
  const agents = await getDeliveryAgents();
  const idx = agents.findIndex(a => a.id === cleanAgent.id);
  if (idx >= 0) agents[idx] = { ...agents[idx], ...cleanAgent };
  else agents.push(cleanAgent);
  localStorage.setItem(STORAGE_KEYS.DELIVERY_AGENTS, JSON.stringify(agents));
  return cleanAgent;
}

export async function saveServiceArea(areaData) {
  if (!persistLocally()) {
    if (!(await hasAdminAccess())) throw new Error('Only an administrator can maintain service areas.');
    await setDoc(doc(db, "serviceAreas", areaData.id), areaData, { merge: true });
  }
  if (!persistLocally()) return areaData;
  const areas = await getServiceAreas();
  const idx = areas.findIndex(a => a.id === areaData.id);
  if (idx >= 0) areas[idx] = areaData;
  else areas.push(areaData);
  localStorage.setItem(STORAGE_KEYS.SERVICE_AREAS, JSON.stringify(areas));
  return areaData;
}

/* ==========================================================================
   INVENTORY MANAGEMENT (Rule 27: Separate Domestic & Commercial)
   ========================================================================== */

export async function getDistributorInventory(distributorId) {
  if (!isDemo && db) {
    try {
      const snap = await getDoc(doc(db, "inventory", distributorId));
      if (snap.exists()) {
        return snap.data();
      }
    } catch (e) {
      console.warn("Firestore inventory read error:", e);
      throw e;
    }
    return { distributorId, domestic: { available: 0, reserved: 0 }, commercial: { available: 0, reserved: 0 }, lowStockThreshold: 15 };
  }
  const allInventory = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVENTORY) || '{}');
  return allInventory[distributorId] || {
    distributorId,
    domestic: { available: 80, reserved: 0 },
    commercial: { available: 30, reserved: 0 },
    lowStockThreshold: 15,
    updatedAt: new Date().toISOString()
  };
}

export async function initializeDistributorInventory(distributorId, inventoryData) {
  const payload = { ...inventoryData, distributorId, updatedAt: new Date().toISOString() };
  if (!persistLocally()) {
    if (!(await hasAdminAccess())) throw new Error('Only an administrator can initialize distributor inventory.');
    await setDoc(doc(db, 'inventory', distributorId), payload);
    return payload;
  }
  return updateDistributorInventory(distributorId, payload);
}

export async function updateDistributorInventory(distributorId, inventoryData) {
  const payload = {
    ...inventoryData,
    distributorId,
    updatedAt: new Date().toISOString()
  };

  await requireLiveWrite(() => setDoc(doc(db, "inventory", distributorId), payload, { merge: true }));

  if (!persistLocally()) return payload;
  const allInventory = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVENTORY) || '{}');
  allInventory[distributorId] = payload;
  localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(allInventory));
  return payload;
}

export async function checkInventoryAvailable(distributorId, cylinderType, quantity) {
  const inv = await getDistributorInventory(distributorId);
  const typeKey = (cylinderType || 'domestic').toLowerCase();
  const stock = inv[typeKey] ? inv[typeKey].available : 0;
  return stock >= quantity;
}

export async function deductInventoryStock(distributorId, cylinderType, quantity) {
  const inv = await getDistributorInventory(distributorId);
  const typeKey = (cylinderType || 'domestic').toLowerCase();
  if (!inv[typeKey] || inv[typeKey].available < quantity) throw new Error('Insufficient cylinder inventory.');
  inv[typeKey].available -= quantity;
  inv[typeKey].reserved = (inv[typeKey].reserved || 0) + quantity;
  return await updateDistributorInventory(distributorId, inv);
}

/* ==========================================================================
   BOOKINGS MANAGEMENT (Rule 28, 29, 30)
   ========================================================================== */

export async function createBooking(bookingData) {
  const bookingId = bookingData.bookingId || generateBookingId();
  const fullBooking = {
    ...bookingData,
    bookingId,
    bookingStatus: bookingData.bookingStatus || "pending_payment",
    paymentStatus: bookingData.paymentStatus || "unpaid",
    createdAt: bookingData.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusTimeline: bookingData.statusTimeline || (bookingData.paymentStatus === 'paid'
      ? [{ status: "confirmed", time: new Date().toISOString(), note: "Demo payment confirmed." }]
      : [])
  };

  if (fullBooking.paymentStatus === 'paid' && (!fullBooking.paymentId || !/^GBPAY-[A-Z0-9]{8}$/.test(fullBooking.transactionReference || ''))) {
    throw new Error('Paid bookings require a payment ID and transaction reference.');
  }

  if (fullBooking.paymentStatus === 'paid' && fullBooking.bookingStatus !== 'confirmed') {
    throw new Error('Paid bookings must enter the confirmed status.');
  }

  if (!persistLocally() && fullBooking.paymentStatus === 'paid') {
      const bookingRef = doc(db, 'bookings', bookingId);
      const inventoryRef = doc(db, 'inventory', fullBooking.distributorId);
      await runTransaction(db, async tx => {
      const current = await tx.get(bookingRef);
      const inventorySnap = await tx.get(inventoryRef);
      if (!current.exists() || current.data().paymentStatus !== 'unpaid' || current.data().bookingStatus !== 'pending_payment') {
        throw new Error('Booking is not awaiting payment or has already been paid.');
      }
      if (!inventorySnap.exists()) throw new Error('Distributor inventory is not configured.');
      const inventory = inventorySnap.data();
      const typeKey = (fullBooking.cylinderType || 'domestic').toLowerCase();
      const stock = inventory[typeKey];
      if (!stock || Number(stock.available || 0) < Number(fullBooking.quantity)) throw new Error('Not enough cylinder stock is available.');
      const paymentRef = doc(db, 'payments', fullBooking.transactionReference);
      const existingPayment = await tx.get(paymentRef);
      if (existingPayment.exists()) throw new Error('A payment already exists for this booking.');
      tx.update(bookingRef, {
        paymentStatus: 'paid', bookingStatus: 'confirmed', paymentId: fullBooking.paymentId,
        transactionReference: fullBooking.transactionReference, updatedAt: fullBooking.updatedAt,
        estimatedDelivery: fullBooking.estimatedDelivery
      });
      tx.set(paymentRef, {
        paymentId: fullBooking.transactionReference,
        bookingId: fullBooking.bookingId,
        customerId: fullBooking.customerId,
        amount: fullBooking.totalAmount,
        paymentMethod: 'demo_qr',
        status: 'success',
        transactionReference: fullBooking.transactionReference,
        createdAt: fullBooking.updatedAt
      });
      tx.update(inventoryRef, {
        [`${typeKey}.available`]: Number(stock.available || 0) - Number(fullBooking.quantity),
        [`${typeKey}.reserved`]: Number(stock.reserved || 0) + Number(fullBooking.quantity),
        lastReservation: {
          bookingId: fullBooking.bookingId,
          customerId: fullBooking.customerId,
          cylinderType: typeKey,
          quantity: Number(fullBooking.quantity),
          transactionReference: fullBooking.transactionReference
        }
      });
    });
    return fullBooking;
  }
  if (!persistLocally()) {
    await requireLiveWrite(() => setDoc(doc(db, "bookings", bookingId), fullBooking));
    return fullBooking;
  }

  const bookings = JSON.parse(localStorage.getItem(STORAGE_KEYS.BOOKINGS) || '[]');
  const existIdx = bookings.findIndex(b => b.bookingId === bookingId);
  if (existIdx >= 0) {
    bookings[existIdx] = { ...bookings[existIdx], ...fullBooking };
  } else {
    bookings.unshift(fullBooking);
  }
  localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify(bookings));

  // Deduct inventory stock for the appropriate cylinder type (Rule 27)
  // Reserve stock only after payment has been confirmed, through the payment completion path.

  // Auto assign a delivery agent only after payment is complete.
  if (fullBooking.paymentStatus === 'paid' && !fullBooking.deliveryAgentId) {
    const autoAgent = await findAndAssignEligibleAgent(fullBooking);
    if (autoAgent) {
      fullBooking.deliveryAgentId = autoAgent.id;
      fullBooking.deliveryAgentName = autoAgent.name || '';
      fullBooking.deliveryAgentMobile = autoAgent.mobile || '';
      fullBooking.deliveryAgentVehicleNumber = autoAgent.vehicleNumber || '';
      fullBooking.statusTimeline.push({
        status: "agent_assigned",
        time: new Date().toISOString(),
        note: `Delivery agent ${autoAgent.name} assigned automatically.`
      });
      await updateBookingRecord(fullBooking.bookingId, {
        deliveryAgentId: autoAgent.id,
        deliveryAgentName: fullBooking.deliveryAgentName,
        deliveryAgentMobile: fullBooking.deliveryAgentMobile,
        deliveryAgentVehicleNumber: fullBooking.deliveryAgentVehicleNumber,
        statusTimeline: fullBooking.statusTimeline
      });
      const savedBooking = bookings.find(b => b.bookingId === bookingId);
      if (savedBooking) {
        savedBooking.deliveryAgentId = autoAgent.id;
        localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify(bookings));
      }

      // Notify Delivery Agent
      await createNotification(
        autoAgent.userId || autoAgent.id,
        "agent",
        "New Delivery Assigned",
        `New delivery ${bookingId} assigned to you in ${fullBooking.deliveryAddress.city}.`,
        "agent-deliveries.html"
      );
    } else {
      // Alert Distributor
      await createNotification(
        (await getDistributorById(fullBooking.distributorId))?.userId || fullBooking.distributorId,
        "distributor",
        "Agent Assignment Pending",
        `Booking ${bookingId} requires delivery agent assignment.`,
        "distributor-bookings.html"
      );
    }
  }

  if (fullBooking.paymentStatus === 'paid') {
    await createNotification(
      fullBooking.customerId,
      "customer",
      "Booking Confirmed",
      `Your LPG cylinder refill booking ${bookingId} has been confirmed.`,
      `customer-tracking.html?id=${bookingId}`
    );
  }

  return fullBooking;
}

export async function findAndAssignEligibleAgent(booking) {
  const agents = await getDeliveryAgents(booking.distributorId);
  const eligible = agents.find(a => (a.status === 'approved' || a.active) && (a.dutyStatus === 'available' || a.status === 'available'));
  return eligible || null;
}

export async function getBookings(filter = {}) {
  let all = [];
  if (!isDemo && db) {
    try {
      const currentUser = isCurrentAdmin() ? { role: 'admin' } : await getUserProfile(auth.currentUser?.uid || '');
      let bookingQuery = collection(db, 'bookings');
      if (currentUser?.role === 'customer') bookingQuery = query(bookingQuery, where('customerId', '==', auth.currentUser.uid));
      else if (currentUser?.role === 'agent') bookingQuery = query(bookingQuery, where('deliveryAgentId', '==', currentUser.agentId));
      else if (currentUser?.role === 'distributor') bookingQuery = query(bookingQuery, where('distributorId', '==', currentUser.distributorId));
      else if (currentUser?.role !== 'admin') return [];
      const snap = await getDocs(bookingQuery);
      all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn("Firestore error reading bookings:", e);
      throw e;
    }
    if (all.length === 0) return [];
  }
  if (all.length === 0 && persistLocally()) {
    all = JSON.parse(localStorage.getItem(STORAGE_KEYS.BOOKINGS) || '[]');
  }

  return all.filter(b => {
    if (filter.customerId && b.customerId !== filter.customerId) return false;
    if (filter.distributorId && b.distributorId !== filter.distributorId) return false;
    if (filter.deliveryAgentId && b.deliveryAgentId !== filter.deliveryAgentId) return false;
    if (filter.status && b.bookingStatus !== filter.status) return false;
    return true;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getBookingById(bookingId) {
  if (!isDemo && db) {
    try {
      const snap = await getDoc(doc(db, "bookings", bookingId));
      if (snap.exists()) {
        return snap.data();
      }
    } catch (e) {
      console.warn("Firestore booking read error:", e);
    }
  }
  if (!persistLocally()) return null;
  const bookings = JSON.parse(localStorage.getItem(STORAGE_KEYS.BOOKINGS) || '[]');
  return bookings.find(b => b.bookingId === bookingId) || null;
}

export async function updateBookingRecord(bookingId, updates) {
  const existing = await getBookingById(bookingId);
  if (!existing) throw new Error('Booking not found.');
  const cleanUpdates = {
    ...updates,
    updatedAt: new Date().toISOString()
  };

  if (!persistLocally()) {
    if (Object.prototype.hasOwnProperty.call(updates, 'deliveryAgentId')) {
      if (existing.bookingStatus !== 'processing' || !existing.distributorId) throw new Error('Booking must be processing before agent assignment.');
      const user = await getUserProfile(auth.currentUser?.uid || '');
      if (user?.role !== 'distributor' || user.distributorId !== existing.distributorId) throw new Error('Only the assigned distributor can assign this booking.');
      const agent = await getDeliveryAgentById(updates.deliveryAgentId);
      if (!agent || agent.status !== 'approved' || agent.distributorId !== existing.distributorId) throw new Error('Select an approved agent from this distributor.');
      cleanUpdates.deliveryAgentName = agent.name || '';
      cleanUpdates.deliveryAgentMobile = agent.mobile || '';
      cleanUpdates.deliveryAgentVehicleNumber = agent.vehicleNumber || '';
    }
    await requireLiveWrite(() => updateDoc(doc(db, "bookings", bookingId), cleanUpdates));
    return { bookingId, ...cleanUpdates };
  }

  const bookings = JSON.parse(localStorage.getItem(STORAGE_KEYS.BOOKINGS) || '[]');
  const idx = bookings.findIndex(b => b.bookingId === bookingId);
  if (idx >= 0) {
    bookings[idx] = { ...bookings[idx], ...cleanUpdates };
    localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify(bookings));
    return bookings[idx];
  }
  return null;
}

export async function updateBookingStatus(bookingId, newStatus, note = "", actor = { id: "", role: "" }) {
  const booking = await getBookingById(bookingId);
  if (!booking) return null;
  if (actor.role === 'agent' && booking.deliveryAgentId !== (actor.agentId || actor.id)) throw new Error("This delivery is assigned to a different agent.");
  if (actor.role === 'distributor' && booking.distributorId !== actor.distributorId) throw new Error("This booking belongs to a different distributor.");

  const transitions = {
    confirmed: ['processing'],
    processing: ['agent_assigned'],
    agent_assigned: ['picked_up'],
    picked_up: ['out_for_delivery'],
    out_for_delivery: ['delivered']
  };
  if (!transitions[booking.bookingStatus]?.includes(newStatus)) {
    throw new Error(`Invalid booking status transition: ${booking.bookingStatus} → ${newStatus}.`);
  }
  if (actor.role === 'agent' && !['picked_up', 'out_for_delivery', 'delivered'].includes(newStatus)) {
    throw new Error("Delivery agents can only update delivery progress.");
  }
  if (actor.role === 'distributor' && !['processing', 'agent_assigned'].includes(newStatus)) {
    throw new Error("Distributors can only process an order or assign an agent.");
  }
  if (actor.role === 'distributor' && newStatus === 'agent_assigned' && !booking.deliveryAgentId) {
    throw new Error("Assign an approved delivery agent before advancing this booking.");
  }

  const timeline = booking.statusTimeline || [];
  timeline.push({
    status: newStatus,
    time: new Date().toISOString(),
    note: note || `Status updated to ${newStatus}`
  });

  const updates = {
    bookingStatus: newStatus,
    statusTimeline: timeline
  };

  // Delivery agents cannot mutate depot inventory. Distributor/admin completion releases live reservations.
  if (newStatus === 'delivered' && (persistLocally() || actor.role === 'admin')) {
    const inv = await getDistributorInventory(booking.distributorId);
    const typeKey = (booking.cylinderType || 'domestic').toLowerCase();
    if (inv[typeKey]) {
      inv[typeKey].reserved = Math.max(0, (inv[typeKey].reserved || 0) - booking.quantity);
      await updateDistributorInventory(booking.distributorId, inv);
    }
  }

  let updated;
  try {
    updated = await updateBookingRecord(bookingId, updates);
  } catch (error) {
    if (newStatus === 'delivered' && persistLocally()) {
      const inv = await getDistributorInventory(booking.distributorId);
      const typeKey = (booking.cylinderType || 'domestic').toLowerCase();
      if (inv[typeKey]) {
        inv[typeKey].reserved = (inv[typeKey].reserved || 0) + booking.quantity;
        await updateDistributorInventory(booking.distributorId, inv);
      }
    }
    throw error;
  }

  const statusLabels = {
    confirmed: "Booking Confirmed",
    processing: "Processing Order",
    agent_assigned: "Delivery Agent Assigned",
    picked_up: "Cylinder Picked Up",
    out_for_delivery: "Out for Delivery",
    delivered: "Cylinder Delivered Successfully",
    cancelled: "Booking Cancelled"
  };

  await createNotification(
    booking.customerId,
    "customer",
    statusLabels[newStatus] || "Order Status Update",
    `Booking ${bookingId}: ${note || `Delivery status is now ${newStatus.replace(/_/g, ' ')}.`}`,
    `customer-tracking.html?id=${bookingId}`,
    'in_app', 'sent', null, { bookingId }
  );

  await logAuditEvent(
    actor.id || "system",
    actor.role || "system",
    `BOOKING_STATUS_${newStatus.toUpperCase()}`,
    bookingId,
    `Booking status updated to ${newStatus}`
  );

  return updated;
}

/* ==========================================================================
   PAYMENTS MANAGEMENT (Rule 25, 26)
   ========================================================================== */

export async function savePaymentRecord(paymentData) {
  const timestamp = new Date().toISOString();
  const cleanPayment = {
    paymentId: paymentData.paymentId,
    bookingId: paymentData.bookingId,
    customerId: paymentData.customerId,
    amount: paymentData.amount,
    paymentMethod: "demo_qr",
    status: paymentData.status || "success",
    transactionReference: paymentData.transactionReference,
    createdAt: paymentData.createdAt || timestamp
  };

  if (!persistLocally()) return cleanPayment;
  const payments = JSON.parse(localStorage.getItem(STORAGE_KEYS.PAYMENTS) || '[]');
  if (payments.some(p => p.bookingId === cleanPayment.bookingId)) {
    throw new Error('A payment already exists for this booking.');
  }
  payments.unshift(cleanPayment);
  localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(payments));
  return cleanPayment;
}

export async function getPaymentByBookingId(bookingId) {
  if (!isDemo && db) {
    try {
      const direct = await getDoc(doc(db, "payments", bookingId));
      if (direct.exists()) return direct.data();
      const q = query(collection(db, "payments"), where("bookingId", "==", bookingId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        return snap.docs[0].data();
      }
    } catch (e) {
      console.warn("Firestore error getting payment by booking:", e);
      throw e;
    }
  }
  if (!persistLocally()) return null;
  const payments = JSON.parse(localStorage.getItem(STORAGE_KEYS.PAYMENTS) || '[]');
  return payments.find(p => p.bookingId === bookingId) || null;
}

/* ==========================================================================
   NOTIFICATIONS & AUDIT LOGS (Rule 35, 41)
   ========================================================================== */

export async function createNotification(recipientUserId, role, title, message, link = "", channel = "in_app", status = "sent", error = null, metadata = {}) {
  const notif = {
    id: "notif-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
    recipientUserId,
    recipientId: recipientUserId,
    role,
    title,
    message,
    channel,
    status,
    error,
    link,
    ...metadata,
    read: false,
    createdAt: new Date().toISOString()
  };

  if (!persistLocally()) {
    await requireLiveWrite(() => setDoc(doc(db, "notifications", notif.id), notif));
    return notif;
  }

  const notifications = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS) || '[]');
  notifications.unshift(notif);
  localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifications));
  return notif;
}

export async function getNotifications(recipientUserId, role = null) {
  let all = [];
  if (!isDemo && db) {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) return [];
    const queries = [query(collection(db, "notifications"), where("recipientUserId", "==", currentUid))];
    if (isCurrentAdmin()) queries.push(query(collection(db, "notifications"), where("recipientUserId", "==", ADMIN_CONFIG.email)));
    const snapshots = await Promise.all(queries.map(notificationQuery => getDocs(notificationQuery)));
    all = snapshots.flatMap(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }
  if (all.length === 0 && persistLocally()) {
    all = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS) || '[]');
  }

  return all.filter(n => {
    if (n.recipientUserId === recipientUserId || n.recipientId === recipientUserId ||
        (isCurrentAdmin() && n.recipientUserId === ADMIN_CONFIG.email)) return true;
    return false;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function markNotificationRead(notifId) {
  await requireLiveWrite(() => updateDoc(doc(db, "notifications", notifId), { read: true }));

  if (!persistLocally()) return;
  const list = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS) || '[]');
  const item = list.find(n => n.id === notifId);
  if (item) {
    item.read = true;
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(list));
  }
}

export async function logAuditEvent(actorUserId, actorRole, action, targetUserId, details = "") {
  const log = {
    logId: "log-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
    actorUserId,
    actorRole,
    action,
    targetUserId,
    details,
    timestamp: new Date().toISOString()
  };

  if (!persistLocally()) {
    log.actorUserId = auth.currentUser?.uid || actorUserId;
    await requireLiveWrite(() => setDoc(doc(db, "auditLogs", log.logId), log));
    return log;
  }

  const logs = JSON.parse(localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS) || '[]');
  logs.unshift(log);
  if (logs.length > 200) logs.pop();
  localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(logs));
  return log;
}

export async function getAuditLogs() {
  if (!isDemo && db) {
    if (!(await hasAdminAccess())) return [];
    const snap = await getDocs(collection(db, "auditLogs"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS) || '[]');
}

/* ==========================================================================
   APPROVALS HIERARCHY (Rule 1, 4, 8, 13, 14, 17)
   ADMIN -> Approves Distributor
   DISTRIBUTOR -> Approves Customer & Delivery Agent
   ========================================================================== */

export async function getAllCustomers() {
  if (!isDemo && db) {
    try {
      if (!(await hasAdminAccess())) return [];
      const snap = await getDocs(collection(db, "customers"));
      return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    } catch (e) { throw e; }
  }
  if (!persistLocally()) return [];
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS) || '[]');
}

export async function getPendingCustomers() {
  if (!persistLocally() && !(await hasAdminAccess())) return [];
  const customers = await getAllCustomers();
  return customers.filter(customer => customer.status === 'pending' || customer.approvalStatus === 'pending');
}

export async function getPendingDeliveryAgentsForAdmin() {
  if (!persistLocally() && !(await hasAdminAccess())) return [];
  const agents = await getDeliveryAgents();
  return agents.filter(agent => agent.status === 'pending' || agent.approvalStatus === 'pending');
}

async function persistApprovalProfile(collectionName, recordId, record, userId) {
  if (collectionName === 'customers') await saveCustomerProfile(record);
  else if (collectionName === 'distributors') await saveDistributor(record);
  else await saveDeliveryAgent(record);
  if (!persistLocally() && !(await getUserProfile(userId))) throw new Error(`Missing users/${userId} profile; approval cannot be synchronized.`);
  if (persistLocally()) {
    const users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
    const user = users.find(item => item.uid === userId);
    if (user) {
      user.status = record.status;
      user.approvalStatus = record.approvalStatus;
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
    }
  }
}

// --------------------------------------------------------------------------
// 1. ADMIN APPROVES DISTRIBUTOR (Rule 4, 5)
// --------------------------------------------------------------------------
export async function approveDistributor(distributorId, approvedBy = "admin") {
  if (!persistLocally() && !(await hasAdminAccess())) throw new Error('Only the administrator can approve distributors.');
  approvedBy = auth?.currentUser?.uid || approvedBy;
  const dists = await getDistributors();
  const dist = dists.find(d => d.id === distributorId);
  if (!dist) throw new Error("Distributor record not found.");
  const registeredPincodes = normalizePincodeValues(dist.pincodes);
  const primaryPincode = registeredPincodes[0] || normalizePincodeValues(dist.pincode)[0];
  const pincodes = registeredPincodes.length ? registeredPincodes : primaryPincode ? [primaryPincode] : [];
  if (!pincodes.length) throw new Error('Add at least one valid 6-digit service pincode before approving this distributor.');
  dist.pincode = primaryPincode;
  dist.pincodes = pincodes;

  const nowIso = new Date().toISOString();
  dist.status = "approved";
  dist.approvalStatus = "approved";
  dist.active = true;
  dist.approvedAt = nowIso;
  dist.approvedBy = approvedBy;
  dist.updatedAt = nowIso;
  await persistApprovalProfile('distributors', dist.id, dist, dist.userId || dist.uid);

  const user = persistLocally()
    ? JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]').find(u => u.distributorId === distributorId)
    : await getUserProfile(dist.userId);

  // Upsert all mappings for this distributor so old or stale pincodes cannot keep routing customers to the wrong depot.
  const serviceAreas = await getServiceAreas();
  const existingAreas = serviceAreas.filter(area => area.distributorId === distributorId);
  const areaIds = existingAreas.length
    ? existingAreas.map(area => area.id)
    : [`sa-${dist.id.replace(/^dist-/, '')}`];
  const fallbackArea = existingAreas[0] || {};
  const city = dist.city || fallbackArea.city || 'Local City';
  const areaName = fallbackArea.city?.toLowerCase() === city.toLowerCase() && fallbackArea.name
    ? fallbackArea.name
    : `${city} Service Area`;
  const updatedAreas = areaIds.map(id => {
    const previous = existingAreas.find(area => area.id === id) || {};
    return {
      ...previous, id, name: areaName, city,
      district: dist.district || previous.district || 'Local District',
      state: dist.state || previous.state || 'Telangana',
      pincodes, distributorId: dist.id, active: true, updatedAt: new Date().toISOString()
    };
  });
  await Promise.all(updatedAreas.map(saveServiceArea));
  dist.serviceAreaId = updatedAreas[0].id;
  dist.serviceAreaIds = updatedAreas.map(area => area.id);
  if (!persistLocally()) {
    await updateDoc(doc(db, 'distributors', distributorId), {
      pincode: dist.pincode, pincodes: dist.pincodes,
      serviceAreaId: dist.serviceAreaId, serviceAreaIds: dist.serviceAreaIds,
      updatedAt: new Date().toISOString()
    });
  } else {
    await saveDistributor(dist);
  }

  // Ensure inventory record exists
    const inv = await getDistributorInventory(distributorId);
    if (!inv || !inv.domestic) {
    await initializeDistributorInventory(distributorId, {
      distributorId,
      domestic: { available: 100, reserved: 0 },
      commercial: { available: 30, reserved: 0 },
      lowStockThreshold: 15
    });
  }

  // Send Notification (Rule 5: SMS preferred, Email fallback)
  await sendApprovalNotification({
    recipientUserId: user ? user.uid : dist.id,
    recipientMobile: dist.mobile,
    recipientEmail: dist.email,
    recipientRole: "distributor",
    type: "distributor_approval",
    title: "Distributor Registration Approved",
    message: "GasBridge: Your distributor registration has been approved. You can now log in to your GasBridge account.",
    link: "distributor-dashboard.html"
  });

  await logAuditEvent(
    approvedBy,
    "admin",
    "DISTRIBUTOR_APPROVED",
    distributorId,
    `Admin approved LPG Distributor: ${dist.name} (${dist.email}).`
  );

  return dist;
}

// --------------------------------------------------------------------------
// 2. ADMIN REJECTS DISTRIBUTOR (Rule 4)
// --------------------------------------------------------------------------
export async function rejectDistributor(distributorId, reason = "Registration verification criteria not met.", rejectedBy = "admin") {
  if (!persistLocally() && !(await hasAdminAccess())) throw new Error('Only the administrator can reject distributors.');
  rejectedBy = auth?.currentUser?.uid || rejectedBy;
  const dists = await getDistributors();
  const dist = dists.find(d => d.id === distributorId);
  if (!dist) throw new Error("Distributor record not found.");

  const nowIso = new Date().toISOString();
  dist.status = "rejected";
  dist.approvalStatus = "rejected";
  dist.active = false;
  dist.rejectionReason = reason;
  dist.rejectedAt = nowIso;
  dist.rejectedBy = rejectedBy;
  dist.updatedAt = nowIso;
  await persistApprovalProfile('distributors', dist.id, dist, dist.userId || dist.uid);

  await logAuditEvent(
    rejectedBy,
    "admin",
    "DISTRIBUTOR_REJECTED",
    distributorId,
    `Admin rejected distributor application for ${dist.name}. Reason: ${reason}`
  );

  return dist;
}

export async function getPendingDistributors() {
  const dists = await getDistributors();
  return dists.filter(d => d.status === "pending" || d.approvalStatus === "pending");
}

// --------------------------------------------------------------------------
// 3. DISTRIBUTOR APPROVES CUSTOMER (Rule 13, 14, 15)
// --------------------------------------------------------------------------
export async function approveCustomer(customerId, approvedBy = "distributor", distributorName = "Authorized Distributor") {
  const cust = await getCustomerProfile(customerId);
  if (!cust) throw new Error("Customer record not found.");
  const approverUid = auth?.currentUser?.uid;
  const approver = await getUserProfile(approverUid || approvedBy);
  if (!persistLocally() && (approver?.distributorId !== cust.distributorId || approver?.role !== 'distributor' || approverUid !== approvedBy)) {
    throw new Error('Only the assigned distributor can approve this customer.');
  }
  approvedBy = approverUid || approvedBy;

  const nowIso = new Date().toISOString();
  cust.status = "approved";
  cust.approvalStatus = "approved";
  cust.active = true;
  cust.approvedAt = nowIso;
  cust.approvedBy = approvedBy;
  cust.updatedAt = nowIso;
  await persistApprovalProfile('customers', customerId, cust, customerId);

  // Send Notification (Rule 15: SMS preferred, Email fallback)
  await sendApprovalNotification({
    recipientUserId: cust.uid,
    recipientMobile: cust.mobile,
    recipientEmail: cust.email,
    recipientRole: "customer",
    type: "customer_approval",
    title: "Customer Registration Approved",
    message: "GasBridge: Your customer registration has been approved. You can now log in and book your LPG cylinder.",
    link: "customer-booking.html"
  });

  await logAuditEvent(
    approvedBy,
    "distributor",
    "CUSTOMER_APPROVED",
    customerId,
    `Distributor (${distributorName}) approved customer connection for ${cust.name} (${cust.email}). Cylinder type: ${cust.cylinderType || 'domestic'}.`
  );

  return cust;
}

// --------------------------------------------------------------------------
// 4. DISTRIBUTOR REJECTS CUSTOMER (Rule 14)
// --------------------------------------------------------------------------
export async function rejectCustomer(customerId, reason = "Address verification mismatch or unsupported routing.", rejectedBy = "distributor") {
  const cust = await getCustomerProfile(customerId);
  if (!cust) throw new Error("Customer record not found.");
  const approverUid = auth?.currentUser?.uid;
  const approver = await getUserProfile(approverUid || rejectedBy);
  if (!persistLocally() && (approver?.distributorId !== cust.distributorId || approver?.role !== 'distributor' || approverUid !== rejectedBy)) {
    throw new Error('Only the assigned distributor can reject this customer.');
  }
  rejectedBy = approverUid || rejectedBy;

  const nowIso = new Date().toISOString();
  cust.status = "rejected";
  cust.approvalStatus = "rejected";
  cust.active = false;
  cust.rejectionReason = reason;
  cust.rejectedAt = nowIso;
  cust.rejectedBy = rejectedBy;
  cust.updatedAt = nowIso;
  await persistApprovalProfile('customers', customerId, cust, customerId);

  await logAuditEvent(
    rejectedBy,
    "distributor",
    "CUSTOMER_REJECTED",
    customerId,
    `Distributor declined customer registration for ${cust.name}. Reason: ${reason}`
  );

  return cust;
}

export async function getPendingDistributorCustomers(distributorId = null) {
  let custs = await getAllCustomers();
  if (!persistLocally() && distributorId) {
    const snap = await getDocs(query(collection(db, 'customers'), where('distributorId', '==', distributorId)));
    custs = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  }
  return custs.filter(c => {
    const isPending = c.status === "pending" || c.approvalStatus === "pending";
    if (!isPending) return false;
    if (distributorId) return c.distributorId === distributorId;
    return true;
  });
}

export async function getDistributorCustomers(distributorId = null) {
  let custs = await getAllCustomers();
  if (!persistLocally() && distributorId) {
    const snap = await getDocs(query(collection(db, 'customers'), where('distributorId', '==', distributorId)));
    custs = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  }
  if (!distributorId) return custs;
  return custs.filter(c => c.distributorId === distributorId);
}

// --------------------------------------------------------------------------
// 5. DISTRIBUTOR APPROVES DELIVERY AGENT (Rule 8, 9)
// --------------------------------------------------------------------------
export async function approveDeliveryAgent(agentId, approvedBy = "distributor", distributorName = "Authorized Distributor") {
  const agent = await getDeliveryAgentById(agentId);
  if (!agent) throw new Error("Delivery agent record not found.");
  const approver = await getUserProfile(auth?.currentUser?.uid || approvedBy);
  const adminApproval = await hasAdminAccess();
  if (!persistLocally() && !adminApproval && (approver?.distributorId !== agent.distributorId || approver?.role !== 'distributor' || auth?.currentUser?.uid !== approvedBy)) {
    throw new Error('Only the assigned distributor can approve this agent.');
  }
  approvedBy = auth?.currentUser?.uid || approvedBy;

  const nowIso = new Date().toISOString();
  agent.status = "approved";
  agent.approvalStatus = "approved";
  agent.active = true;
  agent.dutyStatus = "available";
  agent.approvedAt = nowIso;
  agent.approvedBy = approvedBy;
  agent.updatedAt = nowIso;
  await persistApprovalProfile('deliveryAgents', agentId, agent, agent.userId || agent.uid);

  // Send Notification (Rule 9: SMS preferred, Email fallback)
  await sendApprovalNotification({
    recipientUserId: agent.userId || agent.id,
    recipientMobile: agent.mobile,
    recipientEmail: agent.email,
    recipientRole: "agent",
    type: "agent_approval",
    title: "Delivery Agent Registration Approved",
    message: "GasBridge: Your delivery agent registration has been approved. You can now log in to your account.",
    link: "agent-dashboard.html"
  });

  await logAuditEvent(
    approvedBy,
    adminApproval ? "admin" : "distributor",
    "AGENT_APPROVED",
    agentId,
    `Distributor (${distributorName}) approved delivery agent: ${agent.name} (${agent.vehicleNumber || 'Van'}).`
  );

  return agent;
}

// --------------------------------------------------------------------------
// 6. DISTRIBUTOR REJECTS DELIVERY AGENT (Rule 8)
// --------------------------------------------------------------------------
export async function rejectDeliveryAgent(agentId, reason = "Depot roster capacity reached.", rejectedBy = "distributor") {
  const agent = await getDeliveryAgentById(agentId);
  if (!agent) throw new Error("Delivery agent record not found.");
  const approver = await getUserProfile(auth?.currentUser?.uid || rejectedBy);
  const adminApproval = await hasAdminAccess();
  if (!persistLocally() && !adminApproval && (approver?.distributorId !== agent.distributorId || approver?.role !== 'distributor' || auth?.currentUser?.uid !== rejectedBy)) {
    throw new Error('Only the assigned distributor can reject this agent.');
  }
  rejectedBy = auth?.currentUser?.uid || rejectedBy;

  const nowIso = new Date().toISOString();
  agent.status = "rejected";
  agent.approvalStatus = "rejected";
  agent.active = false;
  agent.dutyStatus = "offline";
  agent.rejectionReason = reason;
  agent.rejectedAt = nowIso;
  agent.rejectedBy = rejectedBy;
  agent.updatedAt = nowIso;
  await persistApprovalProfile('deliveryAgents', agentId, agent, agent.userId || agent.uid);

  await logAuditEvent(
    rejectedBy,
    adminApproval ? "admin" : "distributor",
    "AGENT_REJECTED",
    agentId,
    `Distributor rejected agent application for ${agent.name}. Reason: ${reason}`
  );

  return agent;
}

export async function getPendingDeliveryAgents(distributorId = null) {
  const agents = await getDeliveryAgents(distributorId);
  return agents.filter(a => {
    const isPending = a.status === "pending" || a.approvalStatus === "pending";
    if (!isPending) return false;
    if (distributorId) return a.distributorId === distributorId;
    return true;
  });
}
