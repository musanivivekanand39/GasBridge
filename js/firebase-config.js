/**
 * GasBridge - Firebase Configuration & Seed Master Data
 * Tagline: Fueling Better Homes
 */

// Your web app's live Firebase configuration
export const firebaseConfig = {
  apiKey: "AIzaSyAydr3nNF7YaR6A53g5TXKZZroa2cmlKXw",
  authDomain: "gasbridge-fcc48.firebaseapp.com",
  projectId: "gasbridge-fcc48",
  storageBucket: "gasbridge-fcc48.firebasestorage.app",
  messagingSenderId: "607187182000",
  appId: "1:607187182000:web:d75a244109a3c4639fb675",
  measurementId: "G-H8XLBRN9RW"
};

// Returns true if the configuration has not been updated with real keys
export function isDemoConfig() {
  return !firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY" || firebaseConfig.projectId === "YOUR_PROJECT_ID";
}

// Single System Administrator identifier (Rule 2)
export const ADMIN_CONFIG = {
  email: "admin@gasbridge.com",
  role: "admin",
  name: "GasBridge Administrator"
};

// Master Service Areas & Assigned Authorized Distributors
export const SEED_SERVICE_AREAS = [
  {
    id: "sa-01",
    name: "Shadnagar Service Area",
    city: "Shadnagar",
    district: "Rangareddy",
    state: "Telangana",
    pincodes: ["509216"],
    distributorId: "dist-01",
    active: true
  },
  {
    id: "sa-02",
    name: "Jadcherla Service Area",
    city: "Jadcherla",
    district: "Mahabubnagar",
    state: "Telangana",
    pincodes: ["509301"],
    distributorId: "dist-02",
    active: true
  },
  {
    id: "sa-03",
    name: "Mahabubnagar Service Area",
    city: "Mahabubnagar",
    district: "Mahabubnagar",
    state: "Telangana",
    pincodes: ["509001", "509002"],
    distributorId: "dist-03",
    active: true
  }
];

// Master Authorized LPG Distributors (Rule 3)
export const SEED_DISTRIBUTORS = [
  {
    id: "dist-01",
    userId: "user-dist-01",
    name: "GasBridge Shadnagar Depot",
    businessName: "GasBridge Shadnagar Depot",
    email: "distributor@gasbridge.com",
    mobile: "+91 9440112233",
    address: "Plot 14, Industrial Area, Shadnagar, Rangareddy, Telangana 509216",
    pincode: "509216",
    serviceAreaId: "sa-01",
    serviceAreaIds: ["sa-01"],
    status: "approved",
    approvalStatus: "approved",
    approvedAt: "2026-09-01T09:00:00.000Z",
    approvedBy: "admin",
    active: true
  },
  {
    id: "dist-02",
    userId: "user-dist-02",
    name: "GasBridge Jadcherla Depot",
    businessName: "GasBridge Jadcherla Depot",
    email: "distributor.jadcherla@gasbridge.com",
    mobile: "+91 9440223344",
    address: "NH 44 Highway Junction, Jadcherla, Mahabubnagar, Telangana 509301",
    pincode: "509301",
    serviceAreaId: "sa-02",
    serviceAreaIds: ["sa-02"],
    status: "approved",
    approvalStatus: "approved",
    approvedAt: "2026-09-01T09:00:00.000Z",
    approvedBy: "admin",
    active: true
  },
  {
    id: "dist-03",
    userId: "user-dist-03",
    name: "GasBridge Mahabubnagar Depot",
    businessName: "GasBridge Mahabubnagar Depot",
    email: "distributor.mbnr@gasbridge.com",
    mobile: "+91 9440334455",
    address: "Near Clock Tower, Station Road, Mahabubnagar, Telangana 509001",
    pincode: "509001",
    serviceAreaId: "sa-03",
    serviceAreaIds: ["sa-03"],
    status: "approved",
    approvalStatus: "approved",
    approvedAt: "2026-09-01T09:00:00.000Z",
    approvedBy: "admin",
    active: true
  }
];

// Master Authorized Delivery Agents (Rule 7)
export const SEED_DELIVERY_AGENTS = [
  {
    id: "agent-01",
    userId: "user-agent-01",
    name: "Suresh Kumar",
    email: "agent@gasbridge.com",
    mobile: "+91 9876543210",
    address: "Near RTC Bus Station, Shadnagar",
    pincode: "509216",
    vehicleNumber: "TS 08 UB 4512",
    vehicleType: "Tata Ace Delivery Van",
    distributorId: "dist-01",
    serviceAreaId: "sa-01",
    pincodes: ["509216"],
    status: "approved",
    approvalStatus: "approved",
    approvedAt: "2026-09-02T10:00:00.000Z",
    approvedBy: "dist-01",
    dutyStatus: "available",
    active: true
  },
  {
    id: "agent-02",
    userId: "user-agent-02",
    name: "Ramesh Reddy",
    email: "ramesh.agent@gasbridge.com",
    mobile: "+91 9876543211",
    address: "Main Road, Shadnagar",
    pincode: "509216",
    vehicleNumber: "TS 08 EA 9921",
    vehicleType: "Mahindra Bolero Maxi Truck",
    distributorId: "dist-01",
    serviceAreaId: "sa-01",
    pincodes: ["509216"],
    status: "approved",
    approvalStatus: "approved",
    approvedAt: "2026-09-02T10:00:00.000Z",
    approvedBy: "dist-01",
    dutyStatus: "available",
    active: true
  },
  {
    id: "agent-03",
    userId: "user-agent-03",
    name: "Vijay Varma",
    email: "vijay.agent@gasbridge.com",
    mobile: "+91 9876543212",
    address: "Station Road, Jadcherla",
    pincode: "509301",
    vehicleNumber: "TS 06 AC 1182",
    vehicleType: "Tata Ace Delivery Van",
    distributorId: "dist-02",
    serviceAreaId: "sa-02",
    pincodes: ["509301"],
    status: "approved",
    approvalStatus: "approved",
    approvedAt: "2026-09-02T10:00:00.000Z",
    approvedBy: "dist-02",
    dutyStatus: "available",
    active: true
  },
  {
    id: "agent-04",
    userId: "user-agent-04",
    name: "Anil Rao",
    email: "anil.agent@gasbridge.com",
    mobile: "+91 9876543213",
    address: "Clock Tower Area, Mahabubnagar",
    pincode: "509001",
    vehicleNumber: "TS 06 BR 3490",
    vehicleType: "Three-Wheeler LPG Cargo Auto",
    distributorId: "dist-03",
    serviceAreaId: "sa-03",
    pincodes: ["509001", "509002"],
    status: "approved",
    approvalStatus: "approved",
    approvedAt: "2026-09-02T10:00:00.000Z",
    approvedBy: "dist-03",
    dutyStatus: "available",
    active: true
  }
];

// Master Cylinder Types and Pricing (Rule 11, 27)
export const LPG_CYLINDER_TYPES = {
  domestic: {
    type: "domestic",
    name: "Domestic LPG Cylinder (14.2 kg)",
    shortName: "Domestic LPG",
    weight: "14.2 kg",
    price: 950,
    subsidyEligible: true,
    description: "Standard subsidized Indian household cooking cylinder for domestic kitchen use.",
    image: "../assets/images/lpg-cylinder.jpg"
  },
  commercial: {
    type: "commercial",
    name: "Commercial LPG Cylinder (19.0 kg)",
    shortName: "Commercial LPG",
    weight: "19.0 kg",
    price: 1850,
    subsidyEligible: false,
    description: "High capacity blue commercial cylinder designed for restaurants, hotels, and businesses.",
    image: "../assets/images/lpg-vehicle.jpg"
  }
};

// Initial Stock per Distributor - Separated Domestic and Commercial (Rule 27)
export const SEED_INVENTORY = {
  "dist-01": {
    distributorId: "dist-01",
    domestic: { available: 120, reserved: 0 },
    commercial: { available: 40, reserved: 0 },
    lowStockThreshold: 15,
    updatedAt: new Date().toISOString()
  },
  "dist-02": {
    distributorId: "dist-02",
    domestic: { available: 95, reserved: 0 },
    commercial: { available: 30, reserved: 0 },
    lowStockThreshold: 15,
    updatedAt: new Date().toISOString()
  },
  "dist-03": {
    distributorId: "dist-03",
    domestic: { available: 150, reserved: 0 },
    commercial: { available: 50, reserved: 0 },
    lowStockThreshold: 20,
    updatedAt: new Date().toISOString()
  }
};
