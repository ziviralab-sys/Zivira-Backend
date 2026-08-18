/**
 * Single source of truth for every "document master" — the 40 master/sub-tab
 * tables defined in the Zivira Technical Report (Division, Region/Zone,
 * Territory/HQ, Therapy → Molecule → Brand → Product → Rate, Field Force,
 * Doctor's 7 sub-tabs, Input, Patch Name, Attendance, Holiday, Stockist's
 * 8 sub-tabs, Expense Setup, Manager Expense, Personal Information).
 *
 * This is intentionally independent of the older per-master Mongoose models
 * (SubdivisionModel, ProductCategoryModel, etc.) — those stay as-is for the
 * screens already wired to them. Everything here is served through one
 * generic collection-per-key store (see master-record.model.ts) so the
 * backend doesn't need 40 near-identical model files.
 *
 * `key` doubles as the MongoDB collection name.
 * `label` is a field's exact header text from the document.
 * `keyFields` are the field(s) that make a record unique per tenant —
 * used by the API to upsert safely and reject duplicates.
 *
 * Dropdown wiring: a field is either a plain input, a fixed-choice dropdown
 * (`options`), or a live dropdown sourced from another master's current data
 * (`sourceMaster` + `sourceField`) — e.g. a Brand's Division dropdown always
 * reflects whatever divisions currently exist in Division Master, so adding
 * a division there immediately shows up everywhere it's referenced.
 */

export type MasterField = {
  key: string; // camelCase field name stored in Mongo / sent over the API
  label: string; // exact header text from the document
  type?: "string" | "number" | "date";
  options?: string[];
  sourceMaster?: string;
  sourceField?: string;
  // Derived, read-only display field — e.g. showing a Doctor's Name next to
  // the Doctor Code the user actually picks. Computed client-side by looking
  // up `sourceMaster` for a record where `lookupField` equals the current
  // value of `fromField`, then displaying that record's `displayField`.
  computed?: { fromField: string; sourceMaster: string; lookupField: string; displayField: string };
};

export type MasterConfig = {
  key: string; // collection name
  title: string; // human title shown in the admin UI
  fields: MasterField[];
  keyFields: string[]; // natural unique key (besides tenantSlug) — used for upsert/update matching
  // Additional fields (besides keyFields) that must also be unique per tenant,
  // e.g. Doctor Name — two doctors can't share a name even though their
  // Doctor Codes differ.
  uniqueFields?: string[];
};

const ACTIVE_INACTIVE = ["Active", "Inactive"];

const INDIAN_STATES = [
  "Tamil Nadu", "Kerala", "Karnataka", "Andhra Pradesh", "Telangana", "Maharashtra",
  "Delhi", "West Bengal", "Gujarat", "Punjab", "All States"
];

export const MASTERS: MasterConfig[] = [
  {
    key: "divisionMaster",
    title: "Division Master",
    keyFields: ["divisionCode"],
    fields: [
      { key: "divisionCode", label: "Division Code" },
      { key: "divisionName", label: "Division Name", options: ["Astra", "Aura", "Zivira"] },
      { key: "divisionShortName", label: "Division Short Name", options: ["AST", "AUR", "ZIV"] },
      { key: "description", label: "Description" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "regionZoneMaster",
    title: "Region / Zone Master",
    keyFields: ["regionCode"],
    fields: [
      { key: "zoneName", label: "Zone Name", options: ["North", "South", "East", "West"] },
      { key: "regionName", label: "Region Name" },
      { key: "regionCode", label: "Region Code" },
      { key: "state", label: "State", options: INDIAN_STATES },
      { key: "manager", label: "Manager", sourceMaster: "employees", sourceField: "name" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "territoryHqMaster",
    title: "Territory / Headquarters Master",
    keyFields: ["hqCode"],
    fields: [
      { key: "hqCode", label: "HQ Code" },
      { key: "headquartersName", label: "Headquarters Name" },
      { key: "state", label: "State", options: INDIAN_STATES },
      { key: "city", label: "City" },
      { key: "metroNonMetro", label: "Metro / Non-Metro", options: ["Metro", "Non-Metro"] },
      { key: "zone", label: "Zone", sourceMaster: "regionZoneMaster", sourceField: "zoneName" },
      { key: "region", label: "Region", sourceMaster: "regionZoneMaster", sourceField: "regionName" },
      { key: "patchName", label: "Patch Name" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "therapyMaster",
    title: "Therapy Master",
    keyFields: ["therapyCode"],
    fields: [
      { key: "therapyCode", label: "Therapy Code" },
      { key: "therapyName", label: "Therapy Name" },
      { key: "description", label: "Description" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "moleculeMaster",
    title: "Molecule Master",
    keyFields: ["moleculeCode"],
    fields: [
      { key: "moleculeCode", label: "Molecule Code" },
      { key: "moleculeName", label: "Molecule Name" },
      { key: "therapy", label: "Therapy", sourceMaster: "therapyMaster", sourceField: "therapyName" },
      { key: "description", label: "Description" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "brandMaster",
    title: "Brand Master",
    keyFields: ["brandCode"],
    fields: [
      { key: "brandCode", label: "Brand Code" },
      { key: "brandName", label: "Brand Name" },
      { key: "molecule", label: "Molecule", sourceMaster: "moleculeMaster", sourceField: "moleculeName" },
      { key: "therapy", label: "Therapy", sourceMaster: "therapyMaster", sourceField: "therapyName" },
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "productMaster",
    title: "Product Master",
    keyFields: ["productCode"],
    fields: [
      { key: "productCode", label: "Product Code" },
      { key: "productName", label: "Product Name" },
      { key: "brand", label: "Brand", sourceMaster: "brandMaster", sourceField: "brandName" },
      { key: "strength", label: "Strength" },
      { key: "pack", label: "Pack" },
      { key: "sku", label: "SKU" },
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "uom", label: "UOM", options: ["Tube", "Strip", "Bottle", "Vial", "Box"] },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "rateMaster",
    title: "Rate Master",
    keyFields: ["product", "batchNo"],
    fields: [
      { key: "product", label: "Product", sourceMaster: "productMaster", sourceField: "productName" },
      { key: "batchNo", label: "Batch No" },
      { key: "manufacturingDate", label: "Manufacturing Date", type: "date" },
      { key: "expiryDate", label: "Expiry Date", type: "date" },
      { key: "pack", label: "Pack" },
      { key: "ptr", label: "PTR", type: "number" },
      { key: "pts", label: "PTS", type: "number" },
      { key: "mrp", label: "MRP", type: "number" },
      { key: "effectiveDate", label: "Effective Date", type: "date" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "employees",
    title: "Field Force (Employee Master)",
    keyFields: ["employeeCode"],
    fields: [
      { key: "employeeCode", label: "Employee Code" },
      { key: "name", label: "Employee Name" },
      { key: "designation", label: "Designation", options: [
        "Medical Representative", "Senior Business Executive", "Area Sales Manager",
        "Regional Sales Manager", "Zonal Sales Manager", "National Business Head"
      ] },
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "territory", label: "Territory", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "role", label: "Role", options: ["NBH", "BH", "RBM", "ABM", "SR_MR", "MR", "ZBM", "OTH2"] },
      { key: "dob", label: "DOB", type: "date" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "joinDate", label: "Join Date", type: "date" },
      { key: "city", label: "City" },
      { key: "state", label: "State", options: INDIAN_STATES },
      { key: "country", label: "Country", options: ["India"] },
      { key: "reportingManager", label: "Reporting Manager", sourceMaster: "employees", sourceField: "name" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "doctorMaster",
    title: "Doctor Master",
    keyFields: ["doctorCode"],
    uniqueFields: ["doctorName"],
    fields: [
      { key: "doctorCode", label: "Doctor Code" },
      { key: "doctorName", label: "Doctor Name" },
      { key: "qualification", label: "Qualification", options: [
        "MBBS", "MBBS, MD", "MBBS, MS", "MBBS, DM", "MBBS, MCh", "MBBS, DNB", "MBBS, DGO", "MBBS, DCH", "BAMS", "BHMS"
      ] },
      { key: "specialty", label: "Specialty", options: [
        "General Physician", "Pediatrics", "Cardiologist", "Diabetologist", "Pulmonologist",
        "Gastroenterologist", "Dermatologist", "Neurologist", "Nephrologist", "Orthopaedic Surgeon"
      ] },
      { key: "registrationNumber", label: "Registration Number" },
      // The Doctor Master screen also displays these columns (joined in from
      // the Address / Contact Details sub-tabs in the UI) — declared here so
      // the backend actually persists them instead of silently discarding
      // whatever the Add form sends, which is why they always showed blank.
      { key: "clinicName", label: "Clinic Name" },
      { key: "address", label: "Address" },
      { key: "area", label: "Area" },
      { key: "city", label: "City" },
      { key: "state", label: "State", options: INDIAN_STATES },
      { key: "country", label: "Country", options: ["India"] },
      { key: "pinCode", label: "Pin Code" },
      { key: "mobile", label: "Mobile" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "whatsapp", label: "WhatsApp" }
    ]
  },
  {
    key: "doctorAddress",
    title: "Doctor — Address",
    keyFields: ["doctorCode"],
    fields: [
      { key: "doctorCode", label: "Doctor Code", sourceMaster: "doctorMaster", sourceField: "doctorCode" },
      { key: "doctorName", label: "Doctor Name", computed: { fromField: "doctorCode", sourceMaster: "doctorMaster", lookupField: "doctorCode", displayField: "doctorName" } },
      { key: "clinicName", label: "Clinic Name" },
      { key: "address", label: "Address" },
      { key: "area", label: "Area" },
      { key: "city", label: "City" },
      { key: "state", label: "State", options: INDIAN_STATES },
      { key: "country", label: "Country", options: ["India"] },
      { key: "pinCode", label: "PIN Code" }
    ]
  },
  {
    key: "doctorClassification",
    title: "Doctor — Classification",
    keyFields: ["doctorCode"],
    fields: [
      { key: "doctorCode", label: "Doctor Code", sourceMaster: "doctorMaster", sourceField: "doctorCode" },
      { key: "doctorName", label: "Doctor Name", computed: { fromField: "doctorCode", sourceMaster: "doctorMaster", lookupField: "doctorCode", displayField: "doctorName" } },
      { key: "doctorCategory", label: "Doctor Category (A/B/C)", options: ["A", "B", "C"] },
      { key: "potential", label: "Potential", options: ["High", "Medium", "Low"] },
      { key: "visitFrequency", label: "Visit Frequency", options: [
        "Weekly", "Fortnightly", "Twice a Month", "Monthly", "Once in Two Months", "Quarterly"
      ] },
      { key: "active", label: "Active", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "doctorMapping",
    title: "Doctor — Mapping",
    keyFields: ["doctorCode"],
    fields: [
      { key: "doctorCode", label: "Doctor Code", sourceMaster: "doctorMaster", sourceField: "doctorCode" },
      { key: "doctorName", label: "Doctor Name", computed: { fromField: "doctorCode", sourceMaster: "doctorMaster", lookupField: "doctorCode", displayField: "doctorName" } },
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "patch", label: "Patch", sourceMaster: "patchNameMaster", sourceField: "patchName" },
      { key: "medicalRepresentative", label: "Medical Representative", sourceMaster: "employees", sourceField: "name" },
      { key: "areaManager", label: "Area Manager", sourceMaster: "employees", sourceField: "name" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "doctorDealerMapping",
    title: "Doctor — Dealer Mapping",
    keyFields: ["doctorCode"],
    fields: [
      { key: "doctorCode", label: "Doctor Code", sourceMaster: "doctorMaster", sourceField: "doctorCode" },
      { key: "doctorName", label: "Doctor Name", computed: { fromField: "doctorCode", sourceMaster: "doctorMaster", lookupField: "doctorCode", displayField: "doctorName" } },
      { key: "stockist", label: "Stockist", sourceMaster: "stockistMaster", sourceField: "stockistName" },
      { key: "chemist", label: "Chemist" },
      { key: "distributor", label: "Distributor" }
    ]
  },
  {
    key: "doctorContactDetails",
    title: "Doctor — Contact Details",
    keyFields: ["doctorCode"],
    fields: [
      { key: "doctorCode", label: "Doctor Code", sourceMaster: "doctorMaster", sourceField: "doctorCode" },
      { key: "doctorName", label: "Doctor Name", computed: { fromField: "doctorCode", sourceMaster: "doctorMaster", lookupField: "doctorCode", displayField: "doctorName" } },
      { key: "mobile", label: "Mobile" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "whatsapp", label: "WhatsApp" }
    ]
  },
  {
    key: "doctorAdditionalInfo",
    title: "Doctor — Additional Info",
    keyFields: ["doctorCode"],
    fields: [
      { key: "doctorCode", label: "Doctor Code", sourceMaster: "doctorMaster", sourceField: "doctorCode" },
      { key: "doctorName", label: "Doctor Name", computed: { fromField: "doctorCode", sourceMaster: "doctorMaster", lookupField: "doctorCode", displayField: "doctorName" } },
      { key: "birthDate", label: "Birth Date", type: "date" },
      { key: "anniversary", label: "Anniversary", type: "date" },
      { key: "remarks", label: "Remarks" },
      { key: "latitude", label: "Latitude", type: "number" },
      { key: "longitude", label: "Longitude", type: "number" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "inputMaster",
    title: "Input Master",
    keyFields: ["inputCode"],
    fields: [
      { key: "inputCode", label: "Input Code" },
      { key: "inputName", label: "Input Name" },
      { key: "category", label: "Category", options: [
        "Active Pharmaceutical Ingredient (API)", "Excipient", "Solvent", "Packaging Material",
        "Printing Material", "Cleaning Material", "Laboratory Reagent", "Consumable"
      ] },
      { key: "unit", label: "Unit", options: ["Kg", "Litre", "Nos", "Roll", "Box"] },
      // The Input Master screen also shows these columns — declared here so
      // the backend persists them instead of silently discarding whatever
      // the Add form sends, which is why they always showed blank.
      { key: "typeOfInput", label: "Type of Input", options: ["Physical", "Digital", "Financial"] },
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "valueOfInput", label: "Value of Input" },
      { key: "fromDate", label: "From", type: "date" },
      { key: "toDate", label: "To", type: "date" },
      { key: "financialYear", label: "Financial Year" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "patchNameMaster",
    title: "Patch Name Master",
    keyFields: ["patchCode"],
    fields: [
      { key: "patchCode", label: "Patch Code" },
      { key: "patchName", label: "Patch Name" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "region", label: "Region", sourceMaster: "regionZoneMaster", sourceField: "regionName" },
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "medicalRepresentative", label: "Medical Representative", sourceMaster: "employees", sourceField: "name" },
      { key: "areaManager", label: "Area Manager", sourceMaster: "employees", sourceField: "name" },
      { key: "noOfDoctors", label: "No of Doctors", type: "number" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "attendance",
    title: "Attendance",
    keyFields: ["date", "employee"],
    fields: [
      { key: "date", label: "Date", type: "date" },
      { key: "employee", label: "Employee", sourceMaster: "employees", sourceField: "name" },
      { key: "employeeCode", label: "Employee Code", computed: { fromField: "employee", sourceMaster: "employees", lookupField: "name", displayField: "employeeCode" } },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "attendanceType", label: "Attendance Type", options: ["Field Work", "Office", "Half Day", "Meeting", "Leave", "Admin"] },
      { key: "checkIn", label: "Check In" },
      { key: "checkOut", label: "Check Out" },
      { key: "gps", label: "GPS" },
      { key: "remarks", label: "Remarks" }
    ]
  },
  {
    key: "holidayStateMaster",
    title: "Holiday — State Master",
    keyFields: ["state", "holidayName"],
    fields: [
      { key: "state", label: "State", options: INDIAN_STATES },
      { key: "holidayName", label: "Holiday Name" },
      { key: "date", label: "Date", type: "date" },
      { key: "holidayType", label: "Holiday Type", options: ["State Holiday", "National Holiday"] },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "holidayCalendar",
    title: "Holiday Calendar",
    keyFields: ["year", "state", "holiday"],
    fields: [
      { key: "year", label: "Year", type: "number" },
      { key: "state", label: "State", options: INDIAN_STATES },
      { key: "holiday", label: "Holiday" },
      { key: "holidayDate", label: "Holiday Date", type: "date" },
      { key: "holidayType", label: "Holiday Type", options: ["State Holiday", "National Holiday"] },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "stockistMaster",
    title: "Stockist Master",
    keyFields: ["stockistCode"],
    fields: [
      { key: "stockistCode", label: "Stockist Code" },
      { key: "stockistName", label: "Stockist Name" },
      { key: "gstNo", label: "GST No" },
      { key: "licenseNo", label: "License No" },
      // The Stockist Master screen (both the regular and "Super Stockist"
      // views) also shows these columns — declared here so the backend
      // persists them instead of silently discarding whatever the Add form
      // sends, which is why they always showed blank.
      { key: "contactNumber", label: "Contact Number" },
      { key: "emailAddress", label: "Email Address" },
      { key: "territory", label: "Territory", sourceMaster: "patchNameMaster", sourceField: "patchName" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "state", label: "State", options: INDIAN_STATES },
      { key: "pinCode", label: "Pin Code" },
      { key: "location", label: "Location" },
      { key: "city", label: "City" },
      { key: "pincode", label: "Pincode" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "stockistAddress",
    title: "Stockist — Address",
    keyFields: ["stockistCode"],
    fields: [
      { key: "stockistCode", label: "Stockist Code", sourceMaster: "stockistMaster", sourceField: "stockistCode" },
      { key: "address", label: "Address" },
      { key: "city", label: "City" },
      { key: "state", label: "State", options: INDIAN_STATES },
      { key: "pin", label: "PIN" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "stockistContact",
    title: "Stockist — Contact",
    keyFields: ["stockistCode"],
    fields: [
      { key: "stockistCode", label: "Stockist Code", sourceMaster: "stockistMaster", sourceField: "stockistCode" },
      { key: "contactPerson", label: "Contact Person" },
      { key: "mobile", label: "Mobile" },
      { key: "email", label: "Email" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "stockistHeadquarters",
    title: "Stockist — Headquarters",
    keyFields: ["stockistCode"],
    fields: [
      { key: "stockistCode", label: "Stockist Code", sourceMaster: "stockistMaster", sourceField: "stockistCode" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "territory", label: "Territory", sourceMaster: "patchNameMaster", sourceField: "patchName" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "stockistDivisionMapping",
    title: "Stockist — Division Mapping",
    keyFields: ["stockistCode"],
    fields: [
      { key: "stockistCode", label: "Stockist Code", sourceMaster: "stockistMaster", sourceField: "stockistCode" },
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "products", label: "Products" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "stockistBankDetails",
    title: "Stockist — Bank Details",
    keyFields: ["stockistCode"],
    fields: [
      { key: "stockistCode", label: "Stockist Code", sourceMaster: "stockistMaster", sourceField: "stockistCode" },
      { key: "bank", label: "Bank" },
      { key: "accountNo", label: "Account No" },
      { key: "ifsc", label: "IFSC" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "stockistLicenseDetails",
    title: "Stockist — License Details",
    keyFields: ["stockistCode"],
    fields: [
      { key: "stockistCode", label: "Stockist Code", sourceMaster: "stockistMaster", sourceField: "stockistCode" },
      { key: "drugLicense", label: "Drug License" },
      { key: "expiryDate", label: "Expiry Date", type: "date" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "stockistStatus",
    title: "Stockist — Status",
    keyFields: ["stockist"],
    fields: [
      { key: "stockist", label: "Stockist", sourceMaster: "stockistMaster", sourceField: "stockistName" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "sfc",
    title: "SFC (Standard Field Coverage)",
    keyFields: ["sourceSNo"],
    fields: [
      { key: "sourceSNo", label: "S.No", type: "number" },
      { key: "employeeName", label: "Employee Name", sourceMaster: "employees", sourceField: "name" },
      { key: "employeeCode", label: "Employee Code", computed: { fromField: "employeeName", sourceMaster: "employees", lookupField: "name", displayField: "employeeCode" } },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "patchName", label: "Patch Name", sourceMaster: "patchNameMaster", sourceField: "patchName" },
      { key: "typeRaw", label: "Type", options: ["Tour", "Outstation Work", "Outstation Excursion", "Admin"] },
      { key: "oneWayKms", label: "One Way KMs", type: "number" },
      { key: "region", label: "Region", sourceMaster: "regionZoneMaster", sourceField: "regionName" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "expenseTypes",
    title: "Expense Types",
    keyFields: ["expenseType"],
    fields: [
      { key: "expenseType", label: "Expense Type" },
      { key: "description", label: "Description" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "allowanceFixation",
    title: "Allowance Fixation",
    keyFields: ["location"],
    fields: [
      { key: "location", label: "Location" },
      { key: "type", label: "Type", options: ["Metro", "Non-Metro"] },
      { key: "dailyAllowance", label: "Daily Allowance" }
    ]
  },
  {
    key: "expenseCategory",
    title: "Expense Category",
    keyFields: ["category"],
    fields: [
      { key: "category", label: "Category" },
      { key: "maximumLimit", label: "Maximum Limit" }
    ]
  },
  {
    key: "managerTravelApproval",
    title: "Manager Expense — Travel Approval",
    keyFields: ["claimId"],
    fields: [
      { key: "employee", label: "Employee", sourceMaster: "employees", sourceField: "name" },
      { key: "claimId", label: "Claim ID" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "status", label: "Status", options: ["Approved", "Pending", "Rejected"] }
    ]
  },
  {
    key: "expenseApproval",
    title: "Expense Approval",
    keyFields: ["claimId"],
    fields: [
      { key: "employee", label: "Employee", sourceMaster: "employees", sourceField: "name" },
      { key: "claimId", label: "Claim ID" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "status", label: "Status", options: ["Approved", "Pending", "Rejected"] }
    ]
  },
  {
    key: "employeePersonalInfo",
    title: "Employee Personal Information",
    keyFields: ["employeeCode"],
    fields: [
      { key: "employeeCode", label: "Employee Code", sourceMaster: "employees", sourceField: "employeeCode" },
      { key: "employeeName", label: "Employee Name", computed: { fromField: "employeeCode", sourceMaster: "employees", lookupField: "employeeCode", displayField: "name" } },
      { key: "fathersName", label: "Father's Name" },
      { key: "mothersName", label: "Mother's Name" },
      { key: "bloodGroup", label: "Blood Group", options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] },
      { key: "aadhaar", label: "Aadhaar" },
      { key: "pan", label: "PAN" },
      { key: "passport", label: "Passport" },
      { key: "emergencyContact", label: "Emergency Contact" },
      { key: "bankDetails", label: "Bank Details" }
    ]
  },
  {
    key: "expenseReports",
    title: "Manager Expense — Reports",
    keyFields: ["monthly", "team"],
    fields: [
      { key: "monthly", label: "Monthly" },
      { key: "team", label: "Team", options: ["Zivira Field Team", "Astra Field Team", "Aura Field Team", "South Zone Managers"] },
      { key: "budget", label: "Budget", type: "number" }
    ]
  },
  // "Reporting Structure" is a distinct view the frontend offers alongside
  // Manager Expense — Reports (same screen, a toggle button switches
  // between them) — but it's a genuinely different table (division's
  // reporting chain, not a monthly budget), so it gets its own registry key
  // instead of reusing expenseReports' fields/keyFields, which would make
  // every add fail validation (no monthly/team inputs are ever shown in
  // this view, so those required fields would always be missing).
  {
    key: "reportingStructure",
    title: "Reporting Structure",
    // A division alone isn't unique — there are only 3 divisions but 10
    // territories/zones, each with its own local reporting chain, so the
    // natural key pairs Division with Zone.
    keyFields: ["division", "zone"],
    fields: [
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "zone", label: "Zone", sourceMaster: "regionZoneMaster", sourceField: "zoneName" },
      { key: "bh", label: "BH", sourceMaster: "employees", sourceField: "name" },
      { key: "zbm", label: "ZBM", sourceMaster: "employees", sourceField: "name" },
      { key: "rbm", label: "RBM", sourceMaster: "employees", sourceField: "name" },
      { key: "abm", label: "ABM", sourceMaster: "employees", sourceField: "name" },
      { key: "be", label: "BE", sourceMaster: "employees", sourceField: "name" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "personalInformationView",
    title: "Personal — View",
    keyFields: ["employeeCode"],
    fields: [
      { key: "employeeCode", label: "Employee Code", sourceMaster: "employees", sourceField: "employeeCode" },
      { key: "employeeName", label: "Employee Name", computed: { fromField: "employeeCode", sourceMaster: "employees", lookupField: "employeeCode", displayField: "name" } },
      { key: "contactNo", label: "Contact No" },
      { key: "personalEmail", label: "Personal Email" },
      { key: "panNo", label: "PAN No" },
      { key: "aadharNo", label: "Aadhar No" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },

  // ── Daily MR Work (6 entry masters) ─────────────────────────────────────
  {
    key: "dcrEntry",
    title: "Daily Call Report",
    keyFields: ["date", "employee", "doctor"],
    fields: [
      { key: "date", label: "Date", type: "date" },
      { key: "employee", label: "Employee", sourceMaster: "employees", sourceField: "name" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "patch", label: "Patch", sourceMaster: "patchNameMaster", sourceField: "patchName" },
      { key: "doctor", label: "Doctor", sourceMaster: "doctorMaster", sourceField: "doctorName" },
      { key: "chemist", label: "Chemist", sourceMaster: "stockistMaster", sourceField: "stockistName" },
      { key: "hospital", label: "Hospital" },
      { key: "productsPromoted", label: "Products Promoted", sourceMaster: "productMaster", sourceField: "productName" },
      { key: "samplesIssued", label: "Samples Issued" },
      { key: "callType", label: "Call Type", options: ["Single", "Joint", "Group", "Conference"] },
      { key: "visitTime", label: "Visit Time" },
      { key: "remarks", label: "Remarks" },
      { key: "nextVisitDate", label: "Next Visit Date", type: "date" }
    ]
  },
  {
    key: "tourPlanEntry",
    title: "Tour Plan",
    keyFields: ["tourDate", "employee"],
    fields: [
      { key: "tourDate", label: "Tour Date", type: "date" },
      { key: "employee", label: "Employee", sourceMaster: "employees", sourceField: "name" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "patch", label: "Patch", sourceMaster: "patchNameMaster", sourceField: "patchName" },
      { key: "plannedDoctors", label: "Planned Doctors", type: "number" },
      { key: "plannedChemists", label: "Planned Chemists", type: "number" },
      { key: "plannedHospitals", label: "Planned Hospitals", type: "number" },
      { key: "purpose", label: "Purpose", options: ["Regular Coverage", "New Launch", "Camp Visit", "Joint Work", "Conference"] },
      { key: "status", label: "Status", options: ["Approved", "Pending", "Rejected"] }
    ]
  },
  {
    key: "expenseEntry",
    title: "Expense",
    keyFields: ["expenseDate", "employee", "billNumber"],
    fields: [
      { key: "expenseDate", label: "Expense Date", type: "date" },
      { key: "employee", label: "Employee", sourceMaster: "employees", sourceField: "name" },
      { key: "expenseType", label: "Expense Type", sourceMaster: "expenseTypes", sourceField: "expenseType" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "billNumber", label: "Bill Number" },
      { key: "attachment", label: "Attachment" },
      { key: "approvalStatus", label: "Approval Status", options: ["Approved", "Pending", "Rejected"] },
      { key: "remarks", label: "Remarks" }
    ]
  },
  {
    key: "leaveEntry",
    title: "Leaves",
    keyFields: ["employee", "fromDate", "toDate"],
    fields: [
      { key: "employee", label: "Employee", sourceMaster: "employees", sourceField: "name" },
      { key: "leaveType", label: "Leave Type", options: [
        "Casual Leave", "Sick Leave", "Earned Leave", "Comp-Off", "Maternity Leave", "Paternity Leave", "Loss of Pay"
      ] },
      { key: "fromDate", label: "From Date", type: "date" },
      { key: "toDate", label: "To Date", type: "date" },
      { key: "totalDays", label: "Total Days", type: "number" },
      { key: "reason", label: "Reason" },
      { key: "approvedBy", label: "Approved By", sourceMaster: "employees", sourceField: "name" },
      { key: "status", label: "Status", options: ["Approved", "Pending", "Rejected"] }
    ]
  },
  {
    key: "campEntry",
    title: "Camp",
    keyFields: ["campCode"],
    fields: [
      { key: "campCode", label: "Camp Code" },
      { key: "campName", label: "Camp Name" },
      { key: "campDate", label: "Camp Date", type: "date" },
      { key: "hospital", label: "Hospital" },
      { key: "doctor", label: "Doctor", sourceMaster: "doctorMaster", sourceField: "doctorName" },
      { key: "organizer", label: "Organizer", sourceMaster: "employees", sourceField: "name" },
      { key: "noOfPatients", label: "No. of Patients", type: "number" },
      { key: "productsDisplayed", label: "Products Displayed", sourceMaster: "productMaster", sourceField: "productName" },
      { key: "remarks", label: "Remarks" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "marketSurveyEntry",
    title: "Market Survey",
    keyFields: ["surveyDate", "employee", "competitorBrand"],
    fields: [
      { key: "surveyDate", label: "Survey Date", type: "date" },
      { key: "employee", label: "Employee", sourceMaster: "employees", sourceField: "name" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "patch", label: "Patch", sourceMaster: "patchNameMaster", sourceField: "patchName" },
      { key: "chemist", label: "Chemist", sourceMaster: "stockistMaster", sourceField: "stockistName" },
      { key: "competitorCompany", label: "Competitor Company" },
      { key: "competitorBrand", label: "Competitor Brand" },
      { key: "competitorProduct", label: "Competitor Product" },
      { key: "competitorMrp", label: "Competitor MRP", type: "number" },
      { key: "availability", label: "Availability", options: ["Available", "Out of Stock", "Short Supply"] },
      { key: "feedback", label: "Feedback" },
      { key: "remarks", label: "Remarks" }
    ]
  },

  // ── Manager Activity Report (10 report masters) ─────────────────────────
  {
    key: "attendanceReport",
    title: "Attendance Report",
    keyFields: ["date", "employeeCode"],
    fields: [
      { key: "date", label: "Date", type: "date" },
      { key: "employeeCode", label: "Employee Code", sourceMaster: "employees", sourceField: "employeeCode" },
      { key: "employeeName", label: "Employee Name", computed: { fromField: "employeeCode", sourceMaster: "employees", lookupField: "employeeCode", displayField: "name" } },
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "patch", label: "Patch", sourceMaster: "patchNameMaster", sourceField: "patchName" },
      { key: "attendanceType", label: "Attendance Type", options: ["Field Work", "Office", "Half Day", "Meeting", "Leave", "Admin"] },
      { key: "checkIn", label: "Check In" },
      { key: "checkOut", label: "Check Out" },
      { key: "totalWorkingHours", label: "Total Working Hours" },
      { key: "gpsCheckIn", label: "GPS Check-In" },
      { key: "gpsCheckOut", label: "GPS Check-Out" },
      { key: "managerApproval", label: "Manager Approval", options: ["Approved", "Pending", "Rejected"] },
      { key: "remarks", label: "Remarks" }
    ]
  },
  {
    key: "dcrSummaryReport",
    title: "Daily Call Report Summary",
    keyFields: ["date", "employeeCode"],
    fields: [
      { key: "date", label: "Date", type: "date" },
      { key: "employeeCode", label: "Employee Code", sourceMaster: "employees", sourceField: "employeeCode" },
      { key: "medicalRepresentative", label: "Medical Representative", computed: { fromField: "employeeCode", sourceMaster: "employees", lookupField: "employeeCode", displayField: "name" } },
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "patch", label: "Patch", sourceMaster: "patchNameMaster", sourceField: "patchName" },
      { key: "plannedCalls", label: "Planned Calls", type: "number" },
      { key: "callsCompleted", label: "Calls Completed", type: "number" },
      { key: "doctorsVisited", label: "Doctors Visited", type: "number" },
      { key: "chemistsVisited", label: "Chemists Visited", type: "number" },
      { key: "hospitalsVisited", label: "Hospitals Visited", type: "number" },
      { key: "productsPromoted", label: "Products Promoted" },
      { key: "samplesDistributed", label: "Samples Distributed" },
      { key: "giftsDistributed", label: "Gifts Distributed" },
      { key: "workingHours", label: "Working Hours" }
    ]
  },
  {
    key: "tourPlanReport",
    title: "Tour Plan Report",
    keyFields: ["tourDate", "employeeCode"],
    fields: [
      { key: "tourDate", label: "Tour Date", type: "date" },
      { key: "employeeCode", label: "Employee Code", sourceMaster: "employees", sourceField: "employeeCode" },
      { key: "medicalRepresentative", label: "Medical Representative", computed: { fromField: "employeeCode", sourceMaster: "employees", lookupField: "employeeCode", displayField: "name" } },
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "patch", label: "Patch", sourceMaster: "patchNameMaster", sourceField: "patchName" },
      { key: "plannedDoctorVisits", label: "Planned Doctor Visits", type: "number" },
      { key: "actualDoctorVisits", label: "Actual Doctor Visits", type: "number" },
      { key: "achievementPercentage", label: "Achievement %", type: "number" },
      { key: "tourStatus", label: "Tour Status", options: ["Completed", "Pending", "Cancelled"] },
      { key: "managerApproval", label: "Manager Approval", options: ["Approved", "Pending", "Rejected"] }
    ]
  },
  {
    key: "expenseReport",
    title: "Expense Report",
    keyFields: ["expenseDate", "employeeCode"],
    fields: [
      { key: "expenseDate", label: "Expense Date", type: "date" },
      { key: "employeeCode", label: "Employee Code", sourceMaster: "employees", sourceField: "employeeCode" },
      { key: "employeeName", label: "Employee Name", computed: { fromField: "employeeCode", sourceMaster: "employees", lookupField: "employeeCode", displayField: "name" } },
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "expenseType", label: "Expense Type", sourceMaster: "expenseTypes", sourceField: "expenseType" },
      { key: "description", label: "Description" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "receiptAttached", label: "Receipt Attached", options: ["Yes", "No"] },
      { key: "approvalStatus", label: "Approval Status", options: ["Approved", "Pending", "Rejected"] },
      { key: "approvedBy", label: "Approved By", sourceMaster: "employees", sourceField: "name" }
    ]
  },
  {
    key: "leaveReport",
    title: "Leave Report",
    keyFields: ["employee", "fromDate"],
    fields: [
      { key: "employee", label: "Employee", sourceMaster: "employees", sourceField: "name" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "leaveType", label: "Leave Type", options: [
        "Casual Leave", "Sick Leave", "Earned Leave", "Comp-Off", "Maternity Leave", "Paternity Leave", "Loss of Pay"
      ] },
      { key: "fromDate", label: "From Date", type: "date" },
      { key: "toDate", label: "To Date", type: "date" },
      { key: "totalDays", label: "Total Days", type: "number" },
      { key: "reason", label: "Reason" },
      { key: "status", label: "Status", options: ["Approved", "Pending", "Rejected"] },
      { key: "approvedBy", label: "Approved By", sourceMaster: "employees", sourceField: "name" }
    ]
  },
  {
    key: "campReport",
    title: "Camp Report",
    keyFields: ["campDate", "campName"],
    fields: [
      { key: "campDate", label: "Camp Date", type: "date" },
      { key: "campName", label: "Camp Name" },
      { key: "hospital", label: "Hospital" },
      { key: "doctor", label: "Doctor", sourceMaster: "doctorMaster", sourceField: "doctorName" },
      { key: "mr", label: "MR", sourceMaster: "employees", sourceField: "name" },
      { key: "patients", label: "Patients", type: "number" },
      { key: "productsPromoted", label: "Products Promoted", sourceMaster: "productMaster", sourceField: "productName" },
      { key: "samples", label: "Samples" },
      { key: "status", label: "Status", options: ["Completed", "Pending", "Cancelled"] }
    ]
  },
  {
    key: "marketSurveyReport",
    title: "Market Survey Report",
    keyFields: ["surveyDate", "mr", "competitorBrand"],
    fields: [
      { key: "surveyDate", label: "Survey Date", type: "date" },
      { key: "mr", label: "MR", sourceMaster: "employees", sourceField: "name" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "competitorCompany", label: "Competitor Company" },
      { key: "competitorBrand", label: "Competitor Brand" },
      { key: "competitorProduct", label: "Competitor Product" },
      { key: "mrp", label: "MRP", type: "number" },
      { key: "availability", label: "Availability", options: ["Available", "Out of Stock", "Short Supply"] },
      { key: "marketDemand", label: "Market Demand", options: ["High", "Medium", "Low"] },
      { key: "approval", label: "Approval", options: ["Approved", "Pending", "Rejected"] }
    ]
  },
  {
    key: "doctorCoverageReport",
    title: "Doctor Coverage Report",
    keyFields: ["doctor", "mr"],
    fields: [
      { key: "doctor", label: "Doctor", sourceMaster: "doctorMaster", sourceField: "doctorName" },
      { key: "category", label: "Category", options: ["Super Core", "Core", "Non Core"] },
      { key: "specialty", label: "Specialty", computed: { fromField: "doctor", sourceMaster: "doctorMaster", lookupField: "doctorName", displayField: "specialty" } },
      { key: "mr", label: "MR", sourceMaster: "employees", sourceField: "name" },
      { key: "plannedVisits", label: "Planned Visits", type: "number" },
      { key: "actualVisits", label: "Actual Visits", type: "number" },
      { key: "missedVisits", label: "Missed Visits", type: "number" },
      { key: "coveragePercentage", label: "Coverage %", type: "number" },
      { key: "status", label: "Status", options: ["Visited", "Pending", "Missed"] }
    ]
  },
  {
    key: "chemistCoverageReport",
    title: "Chemist Coverage Report",
    keyFields: ["chemist", "mr"],
    fields: [
      { key: "chemist", label: "Chemist", sourceMaster: "stockistMaster", sourceField: "stockistName" },
      { key: "type", label: "Type", options: ["Core", "Non Core"] },
      { key: "mr", label: "MR", sourceMaster: "employees", sourceField: "name" },
      { key: "plannedVisits", label: "Planned Visits", type: "number" },
      { key: "actualVisits", label: "Actual Visits", type: "number" },
      { key: "missedVisits", label: "Missed Visits", type: "number" },
      { key: "coveragePercentage", label: "Coverage %", type: "number" },
      { key: "status", label: "Status", options: ["Visited", "Pending", "Missed"] }
    ]
  },
  {
    key: "productivityDashboard",
    title: "Productivity Dashboard",
    keyFields: ["employee"],
    fields: [
      { key: "rank", label: "Rank", type: "number" },
      { key: "employee", label: "Employee", sourceMaster: "employees", sourceField: "name" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "doctorCalls", label: "Doctor Calls", type: "number" },
      { key: "tourCompliance", label: "Tour Compliance", type: "number" },
      { key: "productivityScore", label: "Productivity Score", type: "number" }
    ]
  },

  // ── Sales (4 masters) ────────────────────────────────────────────────
  // These were previously only faked client-side (a hardcoded schema in
  // generic-master-table.tsx with no backend collection behind it), so
  // every save 404'd with "Unknown master" and the tables always showed 0
  // records. Now real registry entries, cross-linked to Division/Region/
  // Territory/Product the same way every other master is.
  {
    key: "targetMaster",
    title: "Target Master",
    keyFields: ["division", "hq", "product", "month"],
    fields: [
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "zone", label: "Zone", sourceMaster: "regionZoneMaster", sourceField: "zoneName" },
      { key: "region", label: "Region", sourceMaster: "regionZoneMaster", sourceField: "regionName" },
      { key: "area", label: "Area" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "product", label: "Product", sourceMaster: "productMaster", sourceField: "productName" },
      { key: "month", label: "Month" },
      { key: "targetQty", label: "Target Qty", type: "number" },
      { key: "targetValue", label: "Target Value", type: "number" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "primarySales",
    title: "Primary Sales",
    keyFields: ["division", "hq", "product", "month"],
    fields: [
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "zone", label: "Zone", sourceMaster: "regionZoneMaster", sourceField: "zoneName" },
      { key: "region", label: "Region", sourceMaster: "regionZoneMaster", sourceField: "regionName" },
      { key: "area", label: "Area" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "product", label: "Product", sourceMaster: "productMaster", sourceField: "productName" },
      { key: "month", label: "Month" },
      { key: "achievedQty", label: "Achieved Qty", type: "number" },
      { key: "achievedValue", label: "Achieved Value", type: "number" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "secondarySales",
    title: "Secondary Sales",
    keyFields: ["division", "hq", "product", "month"],
    fields: [
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "zone", label: "Zone", sourceMaster: "regionZoneMaster", sourceField: "zoneName" },
      { key: "region", label: "Region", sourceMaster: "regionZoneMaster", sourceField: "regionName" },
      { key: "area", label: "Area" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "product", label: "Product", sourceMaster: "productMaster", sourceField: "productName" },
      { key: "month", label: "Month" },
      { key: "stockistOffQty", label: "Stockist Off-take Qty", type: "number" },
      { key: "stockistOffValue", label: "Stockist Off-take Value", type: "number" },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  },
  {
    key: "claimsMaster",
    title: "Claims Master",
    keyFields: ["division", "hq", "product", "month"],
    fields: [
      { key: "division", label: "Division", sourceMaster: "divisionMaster", sourceField: "divisionName" },
      { key: "zone", label: "Zone", sourceMaster: "regionZoneMaster", sourceField: "zoneName" },
      { key: "region", label: "Region", sourceMaster: "regionZoneMaster", sourceField: "regionName" },
      { key: "area", label: "Area" },
      { key: "hq", label: "HQ", sourceMaster: "territoryHqMaster", sourceField: "headquartersName" },
      { key: "product", label: "Product", sourceMaster: "productMaster", sourceField: "productName" },
      { key: "month", label: "Month" },
      { key: "claimAmount", label: "Claim Amount", type: "number" },
      { key: "approvalStatus", label: "Approval Status", options: ["Approved", "Pending", "Rejected"] },
      { key: "status", label: "Status", options: ACTIVE_INACTIVE }
    ]
  }
];

export const MASTERS_BY_KEY: Record<string, MasterConfig> = Object.fromEntries(
  MASTERS.map((m) => [m.key, m])
);

export function getMasterConfig(key: string): MasterConfig | undefined {
  return MASTERS_BY_KEY[key];
}
