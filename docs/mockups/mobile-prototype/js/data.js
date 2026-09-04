/* Demo data — fictional only. Scheme from docs/12-ui-spec.md § 0. */
window.AMS = window.AMS || {};

AMS.TODAY = "2026-09-03";

AMS.TYPE_LABEL = {
  DataLogger: "Data logger",
  Geophone: "Geophone",
  SoundLevelMeter: "Sound level meter",
  DustMonitor: "Dust monitor",
  Modem: "Modem",
  Accessory: "Accessory",
  SIM: "SIM",
};

AMS.STATUS_LABEL = {
  Available: "Available",
  CheckedOut: "Checked out",
  Deployed: "Deployed",
  InCalibration: "In calibration",
  NeedsRepair: "Needs repair",
  Missing: "Missing",
  Retired: "Retired",
};

AMS.MODELS = {
  UM: { mfr: "Instantel", model: "Minimate Plus", type: "DataLogger" },
  MP: { mfr: "Instantel", model: "Minimate Pro", type: "DataLogger" },
  V12: { mfr: "Instantel", model: "Geophone V12", type: "Geophone" },
  S50: { mfr: "Norsonic", model: "Nor140 / S50", type: "SoundLevelMeter" },
  DST: { mfr: "Met One", model: "E-Sampler", type: "DustMonitor" },
  BE: { mfr: "Sierra Wireless", model: "AirLink", type: "Modem" },
  SIM: { mfr: "Demo Mobile", model: "SIM", type: "SIM" },
  MIC: { mfr: "Instantel", model: "Microphone", type: "Accessory" },
  CBL: { mfr: "Generic", model: "Cable", type: "Accessory" },
};

AMS.PROJECTS = [
  { id: "02208928", name: "337 Power St monitoring", active: true },
  { id: "02210044", name: "LRT Stage 2 Cut 14", active: true },
  { id: "02209311", name: "Sudbury pit blast", active: true },
  { id: "02207755", name: "Toronto yard dust", active: true },
  { id: "02201100", name: "Pier 3 (closed)", active: true },
  { id: "02205512", name: "Kitchener transit", active: false },
];

AMS.OFFICES = ["Ottawa", "Toronto", "Sudbury", "SWO"];

AMS.PEOPLE = [
  { name: "Maya Tremblay", upn: "tech@englobecorp.com", office: "Ottawa" },
  { name: "Jules Moreau", upn: "j.moreau@englobecorp.com", office: "Ottawa" },
  { name: "Kemi Oyelaran", upn: "k.oyelaran@englobecorp.com", office: "Toronto" },
  { name: "Devon Chan", upn: "d.chan@englobecorp.com", office: "SWO" },
  { name: "Office Admin", upn: "admin@englobecorp.com", office: "Ottawa" },
];

AMS.USERS = {
  field: { name: "Maya Tremblay", upn: "tech@englobecorp.com", office: "Ottawa", initials: "MT", admin: false, roleLabel: "Field User" },
  admin: { name: "Office Admin", upn: "admin@englobecorp.com", office: "Ottawa", initials: "OA", admin: true, roleLabel: "Office Admin" },
  owner: { name: "Jay Patel", upn: "jay.patel@englobecorp.com", office: "Ottawa", initials: "JP", admin: true, roleLabel: "System Owner" },
};

AMS.LABS = ["Montreal Calibration", "Vibra-Tech Lab", "In-house"];

AMS.ACTION_MATRIX = {
  Available: ["checkout", "transfer", "fault", "missing", "sendCal", "recordCal", "retire"],
  CheckedOut: ["return", "transfer", "fault", "missing", "recordCal"],
  Deployed: ["return", "transfer", "fault", "missing", "recordCal"],
  InCalibration: ["fault", "recordCal", "retire"],
  NeedsRepair: ["repair", "sendCal", "recordCal", "retire"],
  Missing: ["found", "retire"],
  Retired: [],
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
        status,
        office,
        loc: office,
        cust: null,
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
    A("DL-UM-16984", "UM", "Available", "Ottawa", {
      serial: "UM16984",
      nextcal: "2026-03-01",
      lastcal: "2025-03-01",
      notes: "Keyboard membrane replaced 2026-02.",
    }),
    A("DL-UM-17021", "UM", "Deployed", "Ottawa", {
      serial: "UM17021",
      loc: "337-POWER-ST",
      cust: "tech@englobecorp.com",
      proj: "02208928",
      nextcal: "2026-12-01",
      lastcal: "2025-12-01",
      children: ["ACC-MIC-0442"],
    }),
    A("DL-MP-11204", "MP", "CheckedOut", "Toronto", {
      serial: "MP11204",
      nextcal: "2026-10-15",
      lastcal: "2025-10-15",
    }),
    A("DL-UM-17105", "UM", "CheckedOut", "Sudbury", {
      serial: "UM17105",
      cust: "j.moreau@englobecorp.com",
      proj: "02209311",
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
    A("DL-MP-11001", "MP", "Retired", "Toronto", {
      serial: "MP11001",
      lastcal: "2024-08-01",
    }),
    A("TMP-0031", "UM", "Available", "Ottawa", { serial: null }),
    A("GEO-V12-30220", "V12", "Deployed", "Ottawa", {
      serial: "UM16984",
      loc: "337-POWER-ST",
      cust: "tech@englobecorp.com",
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
      loc: "LRT-CUT-14",
      cust: "k.oyelaran@englobecorp.com",
      proj: "02210044",
      nextcal: "2027-01-05",
      lastcal: "2026-01-05",
    }),
    A("SLM-S50-13595", "S50", "Available", "Ottawa", {
      serial: "S5013595",
      nextcal: "2026-09-15",
      lastcal: "2025-09-15",
    }),
    A("SLM-S50-13601", "S50", "CheckedOut", "Ottawa", {
      serial: "S5013601",
      cust: "tech@englobecorp.com",
      proj: "02208928",
      nextcal: "2026-11-20",
      lastcal: "2025-11-20",
    }),
    A("SLM-S50-13299", "S50", "Deployed", "Toronto", {
      serial: "S5013299",
      loc: "LRT-CUT-14",
      cust: "k.oyelaran@englobecorp.com",
      proj: "02210044",
      nextcal: "2026-12-19",
      lastcal: "2025-12-19",
    }),
    A("DST-0246", "DST", "Available", "Ottawa", {
      serial: "G2-0246",
      nextcal: "2026-10-08",
      lastcal: "2025-10-08",
    }),
    A("MOD-BE-18794", "BE", "Deployed", "Ottawa", {
      serial: "BE18794",
      loc: "337-POWER-ST",
      cust: "tech@englobecorp.com",
      proj: "02208928",
    }),
    A("SIM-0007", "SIM", "Available", "Ottawa", {
      serial: "SIM0007",
      parent: "MOD-BE-18794",
      permanent: true,
      sim: {
        iccid: "8900 0000 0000 0000 007",
        phone: "+1 555-0100 (demo)",
        ip: "203.0.113.7 (demo range)",
        carrier: "Demo Mobile",
      },
    }),
    A("ACC-MIC-0442", "MIC", "Available", "Ottawa", {
      serial: "MIC0442",
      parent: "DL-UM-17021",
    }),
  ];

  const installations = [
    {
      id: "INST-004",
      site: "337-POWER-ST",
      sitename: "337 Power St",
      project: "02208928",
      start: "2026-05-02",
      end: null,
      power: "Solar",
      position: "POR-403, Pier 3",
      lat: "45.4215",
      lon: "-75.6972",
      components: [
        { asset: "DL-UM-17021", role: "Primary", orientation: null },
        { asset: "GEO-V12-30220", role: "Sensor1", orientation: "V" },
        { asset: "MOD-BE-18794", role: "Modem", orientation: null },
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
      components: [
        { asset: "GEO-V12-30455", role: "Sensor1", orientation: "V" },
        { asset: "SLM-S50-13299", role: "Microphone", orientation: null },
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
      components: [
        { asset: "DL-UM-16984", role: "Primary", orientation: null },
        { asset: "GEO-V12-30221", role: "Sensor1", orientation: "H" },
      ],
    },
  ];

  const history = {
    "DL-UM-16984": [
      { date: "2026-01-15, 4:12 PM", type: "Recover", before: "Deployed", after: "Available", extra: " · to Ottawa", by: "tech@englobecorp.com" },
      { date: "2025-11-02, 8:40 AM", type: "Deploy", before: "CheckedOut", after: "Deployed", extra: " · to PIER-3 · project 02201100", by: "tech@englobecorp.com" },
      { date: "2025-10-30, 7:55 AM", type: "Checkout", before: "Available", after: "CheckedOut", extra: " · to tech@englobecorp.com", by: "tech@englobecorp.com" },
    ],
    "DL-UM-17021": [
      { date: "2026-05-02, 2:01 PM", type: "Deploy", before: "CheckedOut", after: "Deployed", extra: " · to 337-POWER-ST", by: "tech@englobecorp.com" },
      { date: "2026-05-02, 9:14 AM", type: "Checkout", before: "Available", after: "CheckedOut", extra: " · to tech@englobecorp.com", by: "tech@englobecorp.com" },
    ],
    "DL-MP-11204": [
      { date: "2026-04-30, 11:02 AM", type: "Migration", before: "Available", after: "CheckedOut", extra: "", by: "migration@englobecorp.com" },
    ],
  };

  const cals = {
    "DL-UM-16984": [
      { date: "2025-03-01", due: "2026-03-01", lab: "Montreal Calibration", cert: true },
      { date: "2024-02-28", due: "2025-02-28", lab: "Montreal Calibration", cert: false },
    ],
    "DL-UM-17021": [{ date: "2025-12-01", due: "2026-12-01", lab: "Montreal Calibration", cert: true }],
    "SLM-S50-13595": [{ date: "2025-09-15", due: "2026-09-15", lab: "Vibra-Tech Lab", cert: false }],
  };

  const admins = {
    Ottawa: ["admin@englobecorp.com", "j.moreau@englobecorp.com"],
    Toronto: ["k.oyelaran@englobecorp.com"],
    Sudbury: [],
    SWO: ["d.chan@englobecorp.com"],
  };

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
      kind: "Return",
      assets: ["DL-MP-11204"],
      at: "1:47 PM",
      state: "rejected",
      reason: "DL-MP-11204 changed since you added it — nothing was submitted.",
    },
  ];

  return { assets, installations, history, cals, admins, queue };
};
