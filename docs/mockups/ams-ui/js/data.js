/* Demo fleet — fictional. Asset IDs follow docs/12-ui-spec.md § 0. */
window.AMS = window.AMS || {};

AMS.TODAY = "2026-09-03";
AMS.SYNCED = "18 min ago";

AMS.STATUS_LABEL = {
  Available: "Available",
  CheckedOut: "Checked out",
  Deployed: "Deployed",
  InCalibration: "In calibration",
  NeedsRepair: "Needs repair",
  Missing: "Missing",
  Retired: "Retired",
};

AMS.ROLES = {
  field: {
    id: "field",
    name: "Maya Tremblay",
    upn: "maya.tremblay@englobecorp.com",
    office: "Ottawa",
    initials: "MT",
    roleLabel: "Field User",
    admin: false,
    data: false,
    reports: false,
  },
  office: {
    id: "office",
    name: "Office Admin",
    upn: "ottawa.admin@englobecorp.com",
    office: "Ottawa",
    initials: "OA",
    roleLabel: "Office Admin",
    admin: true,
    data: false,
    reports: true,
  },
  data: {
    id: "data",
    name: "Jay Patel",
    upn: "jay.patel@englobecorp.com",
    office: "Ottawa",
    initials: "JP",
    roleLabel: "System / Data Admin",
    admin: true,
    data: true,
    reports: true,
  },
  manager: {
    id: "manager",
    name: "Priya Nair",
    upn: "priya.nair@englobecorp.com",
    office: "Ottawa",
    initials: "PN",
    roleLabel: "Manager",
    admin: false,
    data: false,
    reports: true,
    readonly: true,
  },
};

AMS.CATEGORIES = [
  { id: "seis", name: "Seismographs", total: 286, available: 42, types: ["DataLogger", "Geophone"] },
  { id: "acou", name: "Acoustics", total: 142, available: 38, types: ["SoundLevelMeter"] },
  { id: "geo", name: "Geotechnical Monitoring", total: 198, available: 51, types: ["Piezometer", "Inclinometer"] },
  { id: "surv", name: "Geomatics / Survey", total: 164, available: 29, types: ["TotalStation", "Controller"] },
  { id: "comm", name: "Communications", total: 121, available: 44, types: ["Modem", "SIM"] },
  { id: "img", name: "Imaging", total: 67, available: 22, types: ["Camera"] },
  { id: "air", name: "Air Quality", total: 89, available: 18, types: ["DustMonitor"] },
  { id: "gen", name: "General Equipment", total: 81, available: 31, types: ["Vehicle", "Accessory"] },
];

AMS.TYPE_TO_CAT = {
  DataLogger: "seis",
  Geophone: "seis",
  SoundLevelMeter: "acou",
  Piezometer: "geo",
  Inclinometer: "geo",
  TotalStation: "surv",
  Controller: "surv",
  Modem: "comm",
  SIM: "comm",
  Camera: "img",
  DustMonitor: "air",
  Vehicle: "gen",
  Accessory: "gen",
};

AMS.TYPE_LABEL = {
  DataLogger: "Data logger",
  Geophone: "Geophone",
  SoundLevelMeter: "Sound level meter",
  Piezometer: "Piezometer",
  Inclinometer: "Inclinometer",
  TotalStation: "Total station",
  Controller: "Survey controller",
  Modem: "Modem",
  SIM: "SIM",
  Camera: "Camera",
  DustMonitor: "Dust monitor",
  Vehicle: "Vehicle",
  Accessory: "Accessory",
};

AMS.MODELS = {
  UM: { mfr: "Instantel", model: "Micromate", type: "DataLogger" },
  MP: { mfr: "Instantel", model: "Minimate Pro", type: "DataLogger" },
  V12: { mfr: "Sigicom", model: "V12", type: "Geophone" },
  S50: { mfr: "Norsonic", model: "Nor140", type: "SoundLevelMeter" },
  DST: { mfr: "Met One", model: "E-Sampler", type: "DustMonitor" },
  BE: { mfr: "Sierra Wireless", model: "AirLink", type: "Modem" },
  SIM: { mfr: "Demo Mobile", model: "SIM", type: "SIM" },
  MIC: { mfr: "Instantel", model: "Microphone", type: "Accessory" },
  TS: { mfr: "Leica", model: "TS16", type: "TotalStation" },
  CS: { mfr: "Leica", model: "CS20", type: "Controller" },
  CAM: { mfr: "Reconyx", model: "HF2X", type: "Camera" },
  PZ: { mfr: "RST", model: "VW Piezo", type: "Piezometer" },
  VAN: { mfr: "Ford", model: "Transit", type: "Vehicle" },
};

AMS.PROJECTS = [
  { id: "02208928", name: "337 Power St monitoring", active: true, office: "Ottawa" },
  { id: "02210044", name: "LRT Stage 2 Cut 14", active: true, office: "Ottawa" },
  { id: "02209311", name: "Sudbury pit blast", active: true, office: "Sudbury" },
  { id: "02207755", name: "Toronto yard dust", active: true, office: "Toronto" },
];

AMS.OFFICES = ["Ottawa", "Toronto", "Sudbury", "SWO"];

AMS.PEOPLE = [
  { name: "Maya Tremblay", upn: "maya.tremblay@englobecorp.com", office: "Ottawa", role: "Field User", status: "Active", last: "Today 7:14 AM" },
  { name: "Jules Moreau", upn: "j.moreau@englobecorp.com", office: "Ottawa", role: "Field User", status: "Active", last: "Yesterday" },
  { name: "James Ross", upn: "james.ross@englobecorp.com", office: "Ottawa", role: "Field User", status: "Active", last: "Today 8:42 AM" },
  { name: "Kemi Oyelaran", upn: "k.oyelaran@englobecorp.com", office: "Toronto", role: "Office Admin", status: "Active", last: "Today 9:01 AM" },
  { name: "Devon Chan", upn: "d.chan@englobecorp.com", office: "SWO", role: "Office Admin", status: "Active", last: "Mon" },
  { name: "Office Admin", upn: "ottawa.admin@englobecorp.com", office: "Ottawa", role: "Office Admin", status: "Active", last: "Today 6:50 AM" },
  { name: "Jay Patel", upn: "jay.patel@englobecorp.com", office: "Ottawa", role: "System Owner", status: "Active", last: "Today 6:12 AM" },
  { name: "Priya Nair", upn: "priya.nair@englobecorp.com", office: "Ottawa", role: "Report Reader", status: "Active", last: "Tue" },
];

AMS.LABS = ["Montreal Calibration", "Vibra-Tech Lab", "In-house"];

AMS.ACTION_MATRIX = {
  Available: ["checkout", "transfer", "deploy", "fault", "missing", "sendCal", "recordCal", "retire"],
  CheckedOut: ["return", "transfer", "deploy", "fault", "missing", "recordCal"],
  Deployed: ["recover", "transfer", "fault", "missing", "recordCal"],
  InCalibration: ["fault", "recordCal", "retire"],
  NeedsRepair: ["repair", "sendCal", "recordCal", "retire"],
  Missing: ["found", "retire"],
  Retired: [],
};

AMS.FLEET = {
  total: 1148,
  available: 275,
  checkedOut: 412,
  deployed: 318,
  repair: 38,
  missing: 12,
  calOverdue: 14,
  inCal: 41,
};

AMS.buildDb = function buildDb() {
  function A(id, modelKey, status, office, extra) {
    const m = AMS.MODELS[modelKey];
    return Object.assign(
      {
        id,
        modelKey,
        mfr: m.mfr,
        model: m.model,
        type: m.type,
        category: AMS.TYPE_TO_CAT[m.type],
        status,
        office,
        loc: office,
        cust: null,
        custName: null,
        proj: null,
        serial: null,
        nextcal: null,
        lastcal: null,
        parent: null,
        children: [],
        pending: false,
        notes: "",
        sim: null,
        permanent: false,
      },
      extra || {}
    );
  }

  const assets = [
    A("DL-UM-16984", "UM", "CheckedOut", "Sudbury", {
      serial: "UM16984",
      loc: "—",
      cust: "james.ross@englobecorp.com",
      custName: "James Ross",
      proj: "02208928",
      nextcal: "2026-11-18",
      lastcal: "2025-11-18",
      notes: "Keyboard membrane replaced 2026-02.",
    }),
    A("DL-UM-17021", "UM", "Deployed", "Ottawa", {
      serial: "UM17021",
      loc: "337 Power St",
      cust: "maya.tremblay@englobecorp.com",
      custName: "Maya Tremblay",
      proj: "02208928",
      nextcal: "2026-12-01",
      lastcal: "2025-12-01",
      children: ["ACC-MIC-0442"],
    }),
    A("DL-MP-11204", "MP", "CheckedOut", "Toronto", {
      serial: "MP11204",
      cust: "k.oyelaran@englobecorp.com",
      custName: "Kemi Oyelaran",
      proj: "02207755",
      nextcal: "2026-10-15",
      lastcal: "2025-10-15",
    }),
    A("DL-UM-17105", "UM", "CheckedOut", "Ottawa", {
      serial: "UM17105",
      cust: "maya.tremblay@englobecorp.com",
      custName: "Maya Tremblay",
      proj: "02208928",
      nextcal: "2027-01-20",
      lastcal: "2026-01-20",
    }),
    A("DL-MP-11330", "MP", "InCalibration", "SWO", {
      serial: "MP11330",
      loc: "Montreal Calibration",
      lastcal: "2025-02-11",
    }),
    A("DL-UM-16888", "UM", "NeedsRepair", "Ottawa", {
      serial: "UM16888",
      nextcal: "2026-10-30",
      lastcal: "2025-10-30",
      notes: "Channel 2 reads zero on self-test.",
    }),
    A("DL-UM-16777", "UM", "Missing", "Sudbury", {
      serial: "UM16777",
      nextcal: "2026-06-14",
      lastcal: "2025-06-14",
    }),
    A("TMP-0031", "UM", "Available", "Ottawa", { serial: null }),
    A("GEO-V12-30220", "V12", "Deployed", "Ottawa", {
      serial: "UM16984",
      loc: "337 Power St",
      cust: "maya.tremblay@englobecorp.com",
      custName: "Maya Tremblay",
      proj: "02208928",
      nextcal: "2026-10-04",
      lastcal: "2025-10-04",
    }),
    A("GEO-V12-30221", "V12", "Available", "Ottawa", {
      serial: "V1230221",
      nextcal: "2026-10-04",
      lastcal: "2025-10-04",
    }),
    A("GEO-V12-30455", "V12", "Deployed", "Toronto", {
      serial: "V1230455",
      loc: "LRT Cut 14",
      cust: "k.oyelaran@englobecorp.com",
      custName: "Kemi Oyelaran",
      proj: "02210044",
      nextcal: "2027-01-05",
      lastcal: "2026-01-05",
    }),
    A("SLM-S50-13595", "S50", "InCalibration", "Ottawa", {
      serial: "S5013595",
      loc: "Vibra-Tech Lab",
      nextcal: "2026-09-15",
      lastcal: "2025-09-15",
    }),
    A("SLM-S50-13601", "S50", "CheckedOut", "Ottawa", {
      serial: "S5013601",
      cust: "maya.tremblay@englobecorp.com",
      custName: "Maya Tremblay",
      proj: "02208928",
      nextcal: "2026-11-20",
      lastcal: "2025-11-20",
    }),
    A("SLM-S50-13299", "S50", "Deployed", "Toronto", {
      serial: "S5013299",
      loc: "LRT Cut 14",
      cust: "k.oyelaran@englobecorp.com",
      custName: "Kemi Oyelaran",
      proj: "02210044",
      nextcal: "2026-08-12",
      lastcal: "2025-08-12",
    }),
    A("DST-0246", "DST", "Available", "Ottawa", {
      serial: "G2-0246",
      nextcal: "2026-10-08",
      lastcal: "2025-10-08",
    }),
    A("MOD-BE-18794", "BE", "Deployed", "Ottawa", {
      serial: "BE18794",
      loc: "337 Power St",
      cust: "maya.tremblay@englobecorp.com",
      custName: "Maya Tremblay",
      proj: "02208928",
    }),
    A("SIM-0007", "SIM", "Available", "Ottawa", {
      serial: "SIM0007",
      parent: "MOD-BE-18794",
      permanent: true,
      sim: { iccid: "8900 0000 0000 0000 007", phone: "+1 555-0100 (demo)", ip: "203.0.113.7", carrier: "Demo Mobile" },
    }),
    A("ACC-MIC-0442", "MIC", "Deployed", "Ottawa", {
      serial: "MIC0442",
      parent: "DL-UM-17021",
      loc: "337 Power St",
      proj: "02208928",
    }),
    A("TS-LEI-04112", "TS", "Available", "Ottawa", {
      serial: "TS164112",
      nextcal: "2026-09-20",
      lastcal: "2025-09-20",
    }),
    A("CS-LEI-2201", "CS", "CheckedOut", "Ottawa", {
      serial: "CS202201",
      cust: "j.moreau@englobecorp.com",
      custName: "Jules Moreau",
      proj: "02210044",
      nextcal: "2027-02-01",
    }),
    A("CAM-HF-018", "CAM", "Available", "Sudbury", {
      serial: "HF2X018",
      nextcal: "2026-12-12",
    }),
    A("PZ-RST-4410", "PZ", "Deployed", "Sudbury", {
      serial: "RST4410",
      loc: "Sudbury pit — hole 12",
      cust: "j.moreau@englobecorp.com",
      custName: "Jules Moreau",
      proj: "02209311",
      nextcal: "2026-08-28",
    }),
    A("VAN-OTT-09", "VAN", "CheckedOut", "Ottawa", {
      serial: "1FTBW9CM4KKA00009",
      cust: "maya.tremblay@englobecorp.com",
      custName: "Maya Tremblay",
      proj: "02208928",
      loc: "With custodian",
    }),
    A("GEO-V12-30110", "V12", "Available", "Ottawa", {
      serial: "V1230110",
      nextcal: "2026-08-01",
      lastcal: "2025-08-01",
    }),
    A("DL-UM-16601", "UM", "Available", "Ottawa", {
      serial: "UM16601",
      nextcal: "2026-09-10",
      lastcal: "2025-09-10",
    }),
  ];

  const installations = [
    {
      id: "INST-004",
      site: "337-POWER-ST",
      sitename: "337 Power Street",
      project: "02208928",
      start: "2026-05-02",
      end: null,
      power: "Solar",
      position: "POR-403, Pier 3",
      lat: "45.4215",
      lon: "-75.6972",
      current: true,
      components: [
        { asset: "DL-UM-17021", role: "Primary logger", orientation: "—" },
        { asset: "GEO-V12-30220", role: "Sensor 1", orientation: "V" },
        { asset: "MOD-BE-18794", role: "Modem", orientation: "—" },
        { asset: "ACC-MIC-0442", role: "Microphone", orientation: "—" },
      ],
    },
    {
      id: "INST-003",
      site: "LRT-CUT-14",
      sitename: "Cut 14, Stage 2",
      project: "02210044",
      start: "2026-07-11",
      end: null,
      power: "Battery",
      position: "Chainage 14+220",
      lat: "45.3480",
      lon: "-75.7590",
      current: true,
      components: [
        { asset: "GEO-V12-30455", role: "Sensor 1", orientation: "V" },
        { asset: "SLM-S50-13299", role: "Microphone", orientation: "—" },
      ],
    },
    {
      id: "INST-002",
      site: "PIER-3",
      sitename: "Pier 3",
      project: "02201100",
      start: "2025-11-02",
      end: "2026-01-15",
      power: "AC",
      position: "Pier 3 deck",
      lat: "43.6510",
      lon: "-79.3810",
      current: false,
      components: [
        { asset: "DL-UM-16984", role: "Primary", orientation: "—" },
        { asset: "GEO-V12-30221", role: "Sensor 1", orientation: "H" },
      ],
    },
  ];

  const history = {
    "DL-UM-16984": [
      { date: "Sep 3, 2026 8:42 AM", type: "Checkout", before: "Available", after: "CheckedOut", extra: " · James Ross · project 02208928", by: "James Ross", txn: "TXN-000123" },
      { date: "Jan 15, 2026 4:12 PM", type: "Recover", before: "Deployed", after: "Available", extra: " · to Ottawa", by: "Maya Tremblay", txn: "TXN-000088" },
      { date: "Nov 2, 2025 8:40 AM", type: "Deploy", before: "CheckedOut", after: "Deployed", extra: " · Pier 3 · 02201100", by: "Maya Tremblay", txn: "TXN-000071" },
    ],
    "GEO-V12-30220": [
      { date: "May 2, 2026 2:10 PM", type: "Deploy", before: "CheckedOut", after: "Deployed", extra: " · 337 Power St", by: "Maya Tremblay", txn: "TXN-000101" },
    ],
  };

  const cals = {
    "DL-UM-16984": [
      { date: "2025-11-18", due: "2026-11-18", result: "Pass", lab: "Montreal Calibration", cost: "$185", cert: true, by: "ottawa.admin@englobecorp.com" },
    ],
    "SLM-S50-13595": [
      { date: "2025-09-15", due: "2026-09-15", result: "Pass", lab: "Vibra-Tech Lab", cost: "$210", cert: false, by: "ottawa.admin@englobecorp.com" },
    ],
  };

  const activity = [
    { asset: "DL-UM-16984", action: "checked out", who: "James Ross", where: "Project 02208928", at: "Today 8:42 AM" },
    { asset: "GEO-V12-30220", action: "returned to Ottawa", who: "Maya Tremblay", where: "Ottawa", at: "Yesterday 4:05 PM" },
    { asset: "SLM-S50-13595", action: "sent to calibration", who: "Office Admin", where: "Vibra-Tech Lab", at: "Yesterday 11:20 AM" },
    { asset: "DST-0246", action: "transferred", who: "Devon Chan", where: "Sudbury → Ottawa", at: "Tue 3:14 PM" },
  ];

  const queue = [
    {
      id: "Q-001",
      kind: "Checkout",
      assets: ["DST-0246"],
      at: "Yesterday 4:12 PM",
      state: "pending",
      reason: null,
    },
    {
      id: "Q-002",
      kind: "Checkout",
      assets: ["GEO-V12-30220"],
      at: "1:47 PM",
      state: "rejected",
      reason: "This asset was checked out by another user while you were offline.",
    },
  ];

  const issues = [
    { id: "DQ-1044", issue: "Temporary Asset ID still open", record: "TMP-0031", rule: "ID-COMPLETE", sev: "High", office: "Ottawa", owner: "Office Admin", age: "41 d", status: "Open" },
    { id: "DQ-1031", issue: "Calibration due unknown", record: "MOD-BE-18794", rule: "CAL-PRESENT", sev: "High", office: "Ottawa", owner: "Office Admin", age: "12 d", status: "Open" },
    { id: "DQ-1022", issue: "Unknown custodian on checked-out asset", record: "DL-MP-11204", rule: "CUSTODY-KNOWN", sev: "Critical", office: "Toronto", owner: "Kemi Oyelaran", age: "3 d", status: "Open" },
    { id: "DQ-1018", issue: "Possible duplicate serial", record: "DL-UM-16984", rule: "SERIAL-UNIQUE-HINT", sev: "High", office: "Ottawa", owner: "Jay Patel", age: "6 d", status: "Open" },
    { id: "DQ-1009", issue: "Retired asset still has project", record: "DL-MP-11001", rule: "RETIRE-CLEAN", sev: "Medium", office: "Toronto", owner: "Data Steward", age: "18 d", status: "Open" },
  ];

  const jobs = [
    { id: "JOB-088", type: "Import", file: "ottawa-loggers-2026-09.csv", by: "Jay Patel", status: "Applied", valid: 42, warn: 3, err: 0, applied: 42, start: "Sep 2 16:10", end: "Sep 2 16:14" },
    { id: "JOB-089", type: "Import", file: "swo-slm.xlsx", by: "Devon Chan", status: "Dry-run", valid: 18, warn: 5, err: 2, applied: 0, start: "Sep 3 09:02", end: "—" },
    { id: "JOB-090", type: "Bulk correction", file: "office-codes.csv", by: "Jay Patel", status: "Failed", valid: 0, warn: 0, err: 1, applied: 0, start: "Sep 3 08:11", end: "Sep 3 08:11" },
  ];

  const dupes = [
    {
      id: "DUP-12",
      a: "DL-UM-16984",
      b: "GEO-V12-30220",
      reason: "Shared serial UM16984",
      status: "Needs review",
    },
  ];

  const corrections = [
    { id: "COR-41", record: "DL-UM-16888", field: "Model", old: "Minimate Plus", neu: "Micromate", reason: "Source sheet used old marketing name", by: "Office Admin", appr: "—", status: "Awaiting approval" },
    { id: "COR-38", record: "TS-LEI-04112", field: "Home office", old: "Toronto", neu: "Ottawa", reason: "Permanently transferred 2026-06", by: "Jay Patel", appr: "Jay Patel", status: "Completed" },
  ];

  const exports = [
    { id: "EXP-19", template: "Office inventory", by: "Office Admin", purpose: "Quarterly count", rows: 286, class: "Internal", created: "Sep 3 07:40", expires: "Sep 3 19:40" },
    { id: "EXP-18", template: "Calibration compliance", by: "Priya Nair", purpose: "ISO evidence pack", rows: 1148, class: "Confidential", created: "Sep 1 14:02", expires: "Sep 2 14:02" },
  ];

  const retention = [
    { class: "Transaction history", policy: "RET-TXN-01", period: "10 years", hold: "None", next: "—" },
    { class: "Calibration certificates", policy: "RET-CAL-01", period: "Life of asset + 7 years", hold: "Legal hold LH-3 (2 assets)", next: "Held" },
    { class: "Import job artifacts", policy: "RET-JOB-01", period: "3 years", hold: "None", next: "Eligible Nov 2027" },
    { class: "Export artifacts", policy: "RET-EXP-01", period: "72 hours", hold: "None", next: "Auto-expire" },
  ];

  const adminActivity = [
    { what: "Import JOB-088 completed", who: "Jay Patel", at: "Yesterday 4:14 PM" },
    { what: "Equipment model Instantel Micromate label updated", who: "Jay Patel", at: "Yesterday 2:02 PM" },
    { what: "Asset TMP-0031 flagged incomplete", who: "Office Admin", at: "Tue 11:18 AM" },
    { what: "Duplicate review DUP-11 marked not duplicate", who: "Jay Patel", at: "Tue 9:40 AM" },
    { what: "Office SWO satellite yard added", who: "Jay Patel", at: "Mon 3:22 PM" },
    { what: "Role changed: Devon Chan → Office Admin", who: "Jay Patel", at: "Mon 10:05 AM" },
  ];

  const models = [
    { id: "MDL-UM", mfr: "Instantel", model: "Micromate", type: "Data logger", group: "Seismographs", active: true },
    { id: "MDL-V12", mfr: "Sigicom", model: "V12", type: "Geophone", group: "Seismographs", active: true },
    { id: "MDL-TS16", mfr: "Leica", model: "TS16", type: "Total station", group: "Geomatics / Survey", active: true },
  ];

  return { assets, installations, history, cals, activity, queue, issues, jobs, dupes, corrections, exports, retention, adminActivity, models };
};
