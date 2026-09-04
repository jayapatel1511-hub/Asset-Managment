/* Englobe AMS — complete UI prototype. Local demo only. */
(function () {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const ICO = {
    home: '<path d="M4 11 12 4l8 7v9H4z"/><path d="M9 20v-6h6v6"/>',
    search: '<circle cx="11" cy="11" r="6.2"/><path d="m20 20-3.6-3.6"/>',
    out: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M10 5H5v14h14v-5"/>',
    back: '<path d="M8 7v10l8-5z"/>',
    xfer: '<path d="M7 8h12M15 4l4 4-4 4"/><path d="M17 16H5m4 4-4-4 4-4"/>',
    pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/>',
    alert: '<path d="M12 3 3 19h18z"/><path d="M12 9v5"/><path d="M12 16.5h.01"/>',
    more: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
    cam: '<path d="M4 8h4l1.5-2h5L16 8h4v11H4z"/><circle cx="12" cy="13.5" r="3.2"/>',
    box: '<path d="M4 8 12 4l8 4-8 4z"/><path d="M4 8v8l8 4 8-4V8"/><path d="M12 12v8"/>',
    wave: '<path d="M4 14c2-6 4 6 6 0s4 6 6 0 4 6 6 0"/>',
    mic: '<rect x="9" y="4" width="6" height="10" rx="3"/><path d="M6 12a6 6 0 0 0 12 0M12 18v3"/>',
    drill: '<path d="M4 10h10l3 3v4H4z"/><path d="M17 13h3"/>',
    tri: '<path d="M12 4 4 19h16z"/>',
    radio: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M8 8V5m8 8h.01"/>',
    cam2: '<rect x="3" y="7" width="18" height="12" rx="2"/><circle cx="12" cy="13" r="3"/>',
    wind: '<path d="M4 10h11a3 3 0 1 0-3-3"/><path d="M4 14h14a3 3 0 1 1-3 3"/>',
    crate: '<rect x="4" y="6" width="16" height="13" rx="1"/><path d="M4 10h16"/>',
    cal: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 11h16"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 2.6-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.2"/><path d="M17 14c2.2.4 4 2 4 5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    check: '<path d="M5 12.5 9.5 17 19 7"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
  };

  function ico(name, cls) {
    return `<svg class="ico ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true">${ICO[name] || ""}</svg>`;
  }

  const CAT_ICON = { seis: "wave", acou: "mic", geo: "drill", surv: "tri", comm: "radio", img: "cam2", air: "wind", gen: "crate" };

  const state = {
    route: "home",
    param: null,
    query: {},
    role: "field",
    viewport: "auto", // auto | phone | desk
    offline: false,
    uiState: "default", // default | empty | loading | error
    q: "",
    searchQ: "",
    filter: "all",
    catFilter: "all",
    sort: "id",
    tab: "overview",
    calTab: "overdue",
    cart: [],
    returnSel: [],
    conditions: {},
    selected: [],
    importStep: 2,
    toast: null,
    result: null,
    dialog: null,
    txn: 123,
    identity: false,
  };

  let db = AMS.buildDb();

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function user() {
    return AMS.ROLES[state.role];
  }

  function isDesk() {
    if (state.viewport === "phone") return false;
    if (state.viewport === "desk") return true;
    return window.innerWidth >= 900;
  }

  function find(id) {
    return db.assets.find((a) => a.id === id) || null;
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  function isOverdue(a) {
    return !!(a.nextcal && a.nextcal < AMS.TODAY);
  }

  function myAssets() {
    return db.assets.filter((a) => a.cust === user().upn && a.status !== "Retired");
  }

  function pill(status) {
    return `<span class="pill pill-${esc(status)}">${esc(AMS.STATUS_LABEL[status] || status)}</span>`;
  }

  function toast(msg) {
    state.toast = msg;
    render();
    setTimeout(() => {
      if (state.toast === msg) {
        state.toast = null;
        const t = $(".toast");
        if (t) t.classList.remove("show");
      }
    }, 2200);
  }

  function nextTxn() {
    state.txn += 1;
    return "TXN-" + String(state.txn).padStart(6, "0");
  }

  function go(route, param, query) {
    state.route = route;
    state.param = param || null;
    state.query = query || {};
    state.result = null;
    state.dialog = null;
    state.identity = false;
    if (route !== "search") state.searchQ = "";
    syncHash();
    render();
  }

  function syncHash() {
    let h = "#/" + state.route;
    if (state.param) h += "/" + encodeURIComponent(state.param);
    const qs = new URLSearchParams(state.query).toString();
    if (qs) h += "?" + qs;
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  function parseHash() {
    const raw = (location.hash || "#/home").replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    const parts = path.split("/").filter(Boolean);
    state.route = parts[0] || "home";
    state.param = parts[1] ? decodeURIComponent(parts.slice(1).join("/")) : null;
    state.query = Object.fromEntries(new URLSearchParams(qs || ""));
  }

  function assetRow(a) {
    const od = isOverdue(a);
    return `
      <button type="button" class="asset-row" data-go="asset" data-param="${esc(a.id)}">
        <div class="meta">
          <div class="t-id">${esc(a.id)}${a.pending ? ' <span class="pill pill-pending">Pending sync</span>' : ""}</div>
          <div class="sub">${esc(a.mfr)} ${esc(a.model)} · ${esc(AMS.TYPE_LABEL[a.type])}</div>
        </div>
        <div style="text-align:right">
          ${pill(a.status)}
          <div class="sub">${esc(a.loc || a.office)}${a.custName ? " · " + esc(a.custName) : ""}</div>
          ${od ? `<div class="sub" style="color:var(--danger)">Cal overdue ${daysBetween(a.nextcal, AMS.TODAY)}d</div>` : ""}
        </div>
      </button>`;
  }

  function stateWrap(inner) {
    if (state.uiState === "loading") {
      return `<div class="card"><div class="skel" style="width:40%;margin-bottom:10px"></div>${[1, 2, 3, 4].map(() => `<div class="skel" style="margin:10px 0;height:36px"></div>`).join("")}</div>`;
    }
    if (state.uiState === "error") {
      return `<div class="banner banner-err">Could not load this screen. Cached data from ${esc(AMS.SYNCED)} is shown when available.<div style="margin-top:8px"><button class="btn btn-sm" data-act="retry">Retry</button></div></div>${inner}`;
    }
    if (state.uiState === "empty") {
      return `<div class="state-box card"><h3>Nothing here</h3><p>No records match the current filters.</p><button class="btn btn-sm" data-act="clear-ui">Clear filters</button></div>`;
    }
    return inner;
  }

  /* ---------- Navigation ---------- */
  function deskNav() {
    const r = state.role;
    const ops = [
      ["home", "Home"],
      ["search", "Search"],
      ["assets", "Assets"],
      ["checkout", "Checkout / Returns"],
      ["sites", "Sites & Deployments"],
      ["calibration", "Calibration"],
      ...(r !== "field" ? [["projects", "Projects"], ["repairs", "Repairs / Missing"], ["audits", "Audits"]] : []),
    ];
    const data = r === "data"
      ? [
          ["data", "Data Quality"],
          ["import", "Imports & Bulk Jobs"],
          ["duplicates", "Duplicate Review"],
          ["reference", "Reference Data"],
          ["corrections", "Data Corrections"],
          ["exports", "Exports"],
          ["lineage", "Data Lineage"],
        ]
      : [];
    const admin = r === "data"
      ? [
          ["people", "People & Roles"],
          ["reference", "Offices & Models"],
          ["settings", "System Settings"],
          ["audit-log", "Audit Log"],
          ["health", "System Health"],
        ]
      : r === "office"
        ? [["people", "Office staff"], ["settings", "Settings"]]
        : [["settings", "Settings"]];
    const reports = user().reports
      ? [
          ["reports", "Reports home"],
          ["fleet", "Fleet"],
          ["reports", "Availability"],
          ["calibration", "Calibration"],
          ["fleet", "Utilization"],
          ["lineage", "Asset Timeline"],
        ]
      : [];
    return { OPERATIONS: ops, ...(data.length ? { "DATA MANAGEMENT": data } : {}), ...(r === "field" ? { ACCOUNT: admin } : { ADMINISTRATION: admin }), ...(reports.length ? { REPORTING: reports } : {}) };
  }

  function mobileNav() {
    const n = db.queue.filter((q) => q.state === "rejected").length;
    const items = [
      ["home", "Home", "home"],
      ["search", "Search", "search"],
      ["checkout", "Checkout", "out"],
      ["return", "Return", "back"],
      ["more", "More", "more", n],
    ];
    return items;
  }

  function navActive(id) {
    if (state.route === id) return true;
    if (id === "home" && state.route === "admin-home") return true;
    if (id === "assets" && (state.route === "asset" || state.route === "category")) return true;
    if (id === "sites" && (state.route === "site" || state.route === "deploy")) return true;
    if (id === "data" && ["quality", "import", "duplicates", "reference", "corrections", "exports", "lineage", "retention"].includes(state.route)) return true;
    if (id === "reports" && state.route === "fleet") return true;
    if (id === "checkout" && (state.route === "return" || state.route === "transfer")) return true;
    if (id === "more" && ["more", "settings", "attention", "admin-home"].includes(state.route)) return true;
    return false;
  }

  /* ---------- Shells ---------- */
  function offlineBar() {
    if (!state.offline && !db.queue.some((q) => q.state === "pending")) return "";
    const pending = db.queue.filter((q) => q.state === "pending").length;
    return `<div class="offline-bar">
      <span>${state.offline ? "Offline" : "Online"} · data synced ${esc(AMS.SYNCED)}</span>
      <button type="button" data-go="attention" style="background:none;border:0;color:#fff;font-weight:600">${pending} pending sync</button>
    </div>`;
  }

  function shellMobile(body, title, opts = {}) {
    const u = user();
    const reject = db.queue.filter((q) => q.state === "rejected").length;
    const showBack = !["home", "search", "more"].includes(state.route) && !opts.noBack;
    const nav = mobileNav()
      .map(([id, label, icon, badge]) => {
        const b = badge ? ` class="nav-badge" data-n="${badge}"` : "";
        return `<button type="button" class="${navActive(id) ? "on" : ""}" data-go="${id}"${b}>${ico(icon)}<span>${label}</span></button>`;
      })
      .join("");
    return `
      <div class="phone" id="frame">
        <div class="phone-notch"><span>9:41</span><span>●●● ▮</span></div>
        <div class="app-m">
          ${offlineBar()}
          <header class="m-header">
            ${showBack ? `<button class="back" data-act="back">${ico("chev", "ico-sm")}<span>Back</span></button>` : `<div class="title t-app">${esc(title || "Englobe AMS")}</div>`}
            ${showBack ? `<div class="title t-strong" style="flex:1">${esc(title || "")}</div>` : ""}
            <button class="avatar-btn" data-act="identity" aria-label="Profile">
              <span class="avatar">${esc(u.initials)}${reject ? `<span class="dot">${reject}</span>` : ""}</span>
              <span class="avatar-office">${esc(u.office)}</span>
            </button>
          </header>
          <main class="m-main ${opts.flush ? "flush" : ""}">${body}</main>
          <nav class="bottom-nav">${nav}</nav>
          <div id="overlay-host">${identitySheet()}${dialogHtml()}</div>
          <div class="toast ${state.toast ? "show" : ""}">${esc(state.toast || "")}</div>
        </div>
      </div>`;
  }

  function shellDesktop(body, title) {
    const u = user();
    const groups = deskNav();
    const rail = Object.entries(groups)
      .map(([g, items]) => {
        const seen = new Set();
        const links = items
          .filter(([id, label]) => {
            const k = id + label;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .map(([id, label]) => `<button type="button" class="rail-item ${navActive(id) ? "on" : ""}" data-go="${id}">${esc(label)}</button>`)
          .join("");
        return `<div class="rail-group"><div class="rail-group-label">${esc(g)}</div>${links}</div>`;
      })
      .join("");
    return `
      <div class="desk-frame layout-desk" id="frame">
        <aside class="rail">
          <div class="rail-brand"><div class="mark">Englobe AMS</div><div class="sub">${esc(u.roleLabel)} · ${esc(u.office)}</div></div>
          ${rail}
          <div class="rail-foot">Prototype · not connected</div>
        </aside>
        <div class="desk-main">
          ${offlineBar()}
          <header class="d-header">
            <div class="search-field cmd-search">
              ${ico("search", "ico-sm")}
              <input id="cmd-q" placeholder="Asset ID, serial or model" value="${esc(state.q)}" />
              <button type="button" class="scan-btn" data-act="scan" title="Scan">${ico("cam", "ico-sm")}</button>
            </div>
            <div class="d-ident">
              ${state.offline ? `<span class="pill pill-pending">Offline</span>` : ""}
              <div class="who"><div class="t-strong">${esc(u.name)}</div><div class="t-cap">${esc(u.roleLabel)}</div></div>
              <button class="avatar-btn" data-act="identity"><span class="avatar">${esc(u.initials)}</span></button>
            </div>
          </header>
          <div class="d-content">${body}</div>
          <div id="overlay-host">${identitySheet()}${dialogHtml()}</div>
          <div class="toast ${state.toast ? "show" : ""}" style="bottom:16px">${esc(state.toast || "")}</div>
        </div>
      </div>`;
  }

  function identitySheet() {
    if (!state.identity) return "";
    const u = user();
    return `<div class="overlay" data-act="close-id">
      <div class="${isDesk() ? "dialog" : "sheet"}" onclick="event.stopPropagation()">
        <div class="t-cap">${esc(u.office)}</div>
        <h2>${esc(u.name)}</h2>
        <div class="t-cap">${esc(u.upn)} · ${esc(u.roleLabel)}</div>
        <div class="cmd" style="margin-top:14px">
          <button class="btn" data-go="attention">Needs attention</button>
          <button class="btn" data-go="settings">Settings</button>
          ${user().admin ? `<button class="btn" data-go="${user().data ? "admin-home" : "home"}">Admin</button>` : ""}
          <button class="btn btn-ghost" data-act="signout">Sign out</button>
        </div>
      </div>
    </div>`;
  }

  function dialogHtml() {
    if (!state.dialog) return "";
    const d = state.dialog;
    return `<div class="overlay" data-act="close-dlg">
      <div class="${isDesk() ? "dialog" : "sheet"}" onclick="event.stopPropagation()">
        <h2>${esc(d.title)}</h2>
        <p class="t-body muted">${esc(d.body || "")}</p>
        ${d.fields || ""}
        <div class="cmd" style="margin-top:12px">
          <button class="btn btn-primary" data-act="dlg-ok">${esc(d.ok || "Submit")}</button>
          <button class="btn" data-act="close-dlg">Cancel</button>
        </div>
      </div>
    </div>`;
  }

  /* ---------- Screens ---------- */
  function pageHome() {
    if (state.role === "data") return pageAdminHome();
    if (state.role === "manager") return pageManagerHome();
    return pageUserHome();
  }

  function pageUserHome() {
    const mine = myAssets();
    const dueToday = mine.filter((a) => a.id === "SLM-S50-13601").length || (mine.length ? 1 : 0);
    const attnMine = db.queue.filter((q) => q.state === "rejected").length;
    const pending = db.queue.filter((q) => q.state === "pending").length;
    const cats = AMS.CATEGORIES.map(
      (c) => `<button class="cat" data-go="category" data-param="${c.id}">
        ${ico(CAT_ICON[c.id])}
        <span class="name">${esc(c.name)}</span>
        <span class="nums">${c.total} assets · <b>${c.available} available</b></span>
      </button>`
    ).join("");
    const myRows = mine.slice(0, 3).map(assetRow).join("") || `<div class="state-box">No equipment assigned to you.</div>`;
    const attn = attentionRows("home");
    const acts = db.activity
      .map(
        (x) => `<button class="act-row" data-go="asset" data-param="${esc(x.asset)}">
          <div class="meta" style="flex:1"><span class="t-id">${esc(x.asset)}</span> ${esc(x.action)}
          <div class="t-cap">${esc(x.who)} · ${esc(x.where)}</div></div>
          <div class="t-cap">${esc(x.at)}</div>
        </button>`
      )
      .join("");

    const hero = `
      <section class="hero">
        <h1 class="t-hero">Find any asset in seconds</h1>
        <p>Search by Asset ID, serial number, model or scan a tag.</p>
        <div class="search-field search-hero">
          ${ico("search")}
          <input id="home-q" placeholder="Asset ID, serial or model" value="${esc(state.q)}" />
          <button type="button" class="scan-btn" data-act="scan" aria-label="Scan asset">${ico("cam")}</button>
        </div>
        <div class="hero-actions">
          <button class="btn btn-primary" data-act="scan">Scan asset</button>
          <button class="btn" data-go="search">Open search</button>
        </div>
      </section>`;

    const myWork = `
      <section class="section">
        <div class="sec-label">My work</div>
        <div class="card">
          <div class="card-h">
            <div>
              <div class="sec-label">My equipment</div>
              <div class="head-stats"><span><b>${mine.length}</b> checked out / assigned</span>
              <span><b>${dueToday}</b> expected back today</span>
              <span><b>${attnMine}</b> needs attention</span>
              ${pending ? `<span><b>${pending}</b> offline</span>` : ""}</div>
            </div>
            <button class="btn btn-sm btn-ghost" data-go="search" data-query='{"filter":"mine"}'>View all</button>
          </div>
          <div class="list-frame">${myRows}</div>
        </div>
      </section>`;

    const qa = `
      <section class="section">
        <div class="sec-label">Quick actions</div>
        <div class="qa-grid">
          <button class="qa" data-go="checkout">${ico("out")}<span>Checkout equipment</span></button>
          <button class="qa" data-go="return">${ico("back")}<span>Return equipment</span></button>
          <button class="qa" data-go="transfer">${ico("xfer")}<span>Transfer</span></button>
          <button class="qa" data-go="deploy">${ico("pin")}<span>Deploy to site</span></button>
          <button class="qa" data-act="report">${ico("alert")}<span>Report issue</span></button>
        </div>
      </section>`;

    const browse = `
      <section class="section">
        <div class="sec-label">Browse equipment</div>
        <div class="cat-grid">${cats}</div>
      </section>`;

    const need = `
      <section class="section">
        <div class="sec-label">Needs attention</div>
        <div class="list-frame">${attn}</div>
      </section>`;

    const recent = `
      <section class="section">
        <div class="sec-label">Recent activity</div>
        <div class="list-frame">${acts}</div>
      </section>`;

    if (isDesk()) {
      return `<div class="page-h"><div><h1>Home</h1><p class="sub">Operational starting point — ${esc(user().office)}</p></div></div>
        <div class="desk-home">
          <div class="full">${hero}</div>
          <div>${myWork}${qa}</div>
          <div>${need}${recent}</div>
          <div class="full">${browse}</div>
        </div>`;
    }
    return hero + myWork + qa + browse + need + recent;
  }

  function attentionRows(scope) {
    const u = user();
    const rows = u.data
      ? [
          [14, "Calibration overdue", "calibration", "overdue", "bad"],
          [8, "Calibration due in 30 days", "calibration", "30", "warn"],
          [3, "Assets need repair", "repairs", null, "bad"],
          [2, "Assets marked missing", "repairs", null, "bad"],
          [4, "Returns overdue", "return", null, "warn"],
          [6, "Temporary Asset IDs need completion", "quality", null, "warn"],
        ]
      : u.admin
        ? [
            [5, "Ottawa calibration overdue", "calibration", "overdue", "bad"],
            [3, "Ottawa due in 30 days", "calibration", "30", "warn"],
            [1, "Needs repair in office", "repairs", null, "bad"],
            [2, "Returns overdue — Ottawa", "return", null, "warn"],
            [1, "Temporary ID in Ottawa", "assets", null, "warn"],
          ]
        : [
            [1, "Item assigned to you needs attention", "attention", null, "warn"],
            [1, "Calibration due on your equipment", "calibration", "30", "warn"],
            [db.queue.filter((q) => q.state === "rejected").length, "Offline submission rejected", "attention", null, "bad"],
          ];
    return rows
      .filter((r) => r[0] > 0)
      .map(
        ([n, lab, go, tab, tone]) =>
          `<button class="attn-row" data-go="${go}" ${tab ? `data-query='{"tab":"${tab}"}'` : ""}>
            <span class="attn-n ${tone}">${n}</span><span>${esc(lab)}</span>${ico("chev", "ico-sm")}
          </button>`
      )
      .join("");
  }

  function pageManagerHome() {
    return `
      <div class="page-h"><div><h1>Fleet overview</h1><p class="sub">Read-only. No operational edits.</p></div>
        <button class="btn btn-primary" data-go="fleet">Open fleet report</button></div>
      ${fleetStats()}
      <div class="split-wide">
        <div class="section"><div class="sec-label">Needs attention</div><div class="list-frame">${attentionRows()}</div></div>
        <div class="section"><div class="sec-label">By office</div>${officeBreakdown()}</div>
      </div>
      <section class="section"><div class="sec-label">Browse equipment</div><div class="cat-grid">${AMS.CATEGORIES.map(
        (c) => `<button class="cat" data-go="category" data-param="${c.id}">${ico(CAT_ICON[c.id])}<span class="name">${esc(c.name)}</span><span class="nums">${c.total} · <b>${c.available} available</b></span></button>`
      ).join("")}</div></section>`;
  }

  function pageAdminHome() {
    const f = AMS.FLEET;
    return `
      <div class="page-h">
        <div><h1>AMS Administration</h1><p class="sub">Manage fleet data, reference records and system health.</p></div>
        <div class="cmd">
          <button class="btn btn-primary" data-go="assets">New asset</button>
          <button class="btn" data-go="import">Import</button>
          <button class="btn" data-go="reference">Add equipment model</button>
          <button class="btn" data-go="reference">Add office</button>
          <button class="btn" data-go="quality">Review data issues</button>
        </div>
      </div>
      <div class="stat-strip">
        ${stat(f.total, "Total active")}
        ${stat(f.available, "Available")}
        ${stat(f.checkedOut, "Checked out")}
        ${stat(f.deployed, "Deployed")}
        ${stat(f.calOverdue, "Cal overdue", true)}
        ${stat(db.issues.length, "Data quality", true)}
      </div>
      <div class="cols-3">
        <div class="panel"><div class="panel-h"><span class="t-strong">Operational health</span></div>
          <div class="list-frame">${[
            [14, "Calibration overdue", "calibration", "bad"],
            [12, "Missing equipment", "repairs", "bad"],
            [38, "Needs repair", "repairs", "warn"],
            [1, "Unknown custodian", "quality", "warn"],
            [6, "Temporary tags", "quality", "warn"],
            [1, "Failed jobs", "import", "bad"],
          ].map(([n, l, g, t]) => `<button class="attn-row" data-go="${g}"><span class="attn-n ${t}">${n}</span>${l}</button>`).join("")}</div>
        </div>
        <div class="panel"><div class="panel-h"><span class="t-strong">Data quality</span><button class="btn btn-sm" data-go="data">Open Data Management</button></div>
          <div class="list-frame">${[
            [3, "Critical issues"],
            [12, "High-priority issues"],
            [8, "Duplicate candidates"],
            [44, "Incomplete records"],
            [5, "Reference-data issues"],
            [1, "Failed reconciliations"],
          ].map(([n, l]) => `<button class="attn-row" data-go="quality"><span class="attn-n ${n > 10 ? "warn" : "bad"}">${n}</span>${l}</button>`).join("")}</div>
        </div>
        <div class="panel"><div class="panel-h"><span class="t-strong">Recent admin activity</span></div>
          <div class="list-frame">${db.adminActivity.map((a) => `<div class="act-row"><div><div class="t-strong">${esc(a.what)}</div><div class="t-cap">${esc(a.who)} · ${esc(a.at)}</div></div></div>`).join("")}</div>
        </div>
      </div>`;
  }

  function stat(n, l, alert) {
    return `<div class="stat ${alert ? "alert" : ""}"><div class="n">${n.toLocaleString()}</div><div class="l">${esc(l)}</div></div>`;
  }

  function officeBreakdown() {
    const rows = [
      ["Ottawa", 412, 98],
      ["Toronto", 301, 71],
      ["Sudbury", 248, 54],
      ["SWO", 187, 52],
    ];
    return `<div class="list-frame">${rows.map(([o, t, a]) => `<div class="attn-row"><span class="t-strong">${o}</span><span class="t-cap" style="margin-left:auto">${t} assets · ${a} available</span></div>`).join("")}</div>`;
  }

  function pageSearch() {
    const q = (state.searchQ || state.query.q || "").trim();
    const filter = state.query.filter || state.filter;
    let rows = db.assets.slice();
    if (filter === "mine") rows = rows.filter((a) => a.cust === user().upn);
    if (filter === "avail") rows = rows.filter((a) => a.status === "Available" && a.office === user().office);
    if (filter === "out") rows = rows.filter((a) => a.status === "CheckedOut");
    if (filter === "dep") rows = rows.filter((a) => a.status === "Deployed");
    if (filter === "cal") rows = rows.filter((a) => a.nextcal && daysBetween(AMS.TODAY, a.nextcal) <= 30);
    if (filter === "office") rows = rows.filter((a) => a.office === user().office);
    if (q.length >= 2) {
      const qq = q.toLowerCase();
      rows = rows.filter((a) => [a.id, a.serial, a.model, a.mfr, AMS.TYPE_LABEL[a.type]].join(" ").toLowerCase().includes(qq));
    }
    if (q.toUpperCase() === "UM16984") {
      rows = db.assets.filter((a) => a.serial === "UM16984");
    }
    const chips = [
      ["office", "My office"],
      ["avail", "Available"],
      ["out", "Checked out"],
      ["dep", "Deployed"],
      ["cal", "Calibration due"],
      ["mine", "My equipment"],
    ]
      .map(([k, l]) => `<button class="chip ${filter === k ? "on" : ""}" data-act="sfilter" data-k="${k}">${l}</button>`)
      .join("");

    const list = !q && filter === "all"
      ? `<div class="state-box"><p>Type an Asset ID, serial or model — or scan a tag.</p></div>`
      : rows.length
        ? `<div class="list-frame">${rows.map(assetRow).join("")}</div>`
        : `<div class="state-box"><h3>Nothing matched “${esc(q)}”</h3><p>Try a model name or scan the tag.</p></div>`;

    const advanced = isDesk()
      ? `<div class="filter-bar t-cap">Advanced: Office · Location · Status · Type · Group · Custodian · Project · Lifecycle — chips above are the working set in this prototype.</div>`
      : "";

    return `
      ${isDesk() ? `<div class="page-h"><div><h1>Find asset</h1><p class="sub">Asset ID, serial, secondary ID, model or type.</p></div></div>` : ""}
      <div class="search-field search-hero" style="margin-bottom:10px">
        ${ico("search")}
        <input id="search-q" placeholder="Asset ID, serial or model" value="${esc(q)}" />
        <button class="scan-btn" data-act="scan">${ico("cam")}</button>
      </div>
      <div class="chips" style="margin-bottom:12px">${chips}</div>
      ${advanced}
      ${q.toUpperCase() === "UM16984" ? `<div class="banner banner-info" style="margin-bottom:8px">Serial UM16984 matches a logger and a geophone. Pick the physical item.</div>` : ""}
      ${list}`;
  }

  function pageCategory() {
    const cat = AMS.CATEGORIES.find((c) => c.id === state.param) || AMS.CATEGORIES[0];
    const f = state.catFilter;
    let rows = db.assets.filter((a) => a.category === cat.id);
    if (f === "avail") rows = rows.filter((a) => a.status === "Available");
    if (f === "out") rows = rows.filter((a) => a.status === "CheckedOut");
    if (f === "dep") rows = rows.filter((a) => a.status === "Deployed");
    if (f === "cal") rows = rows.filter((a) => a.nextcal && daysBetween(AMS.TODAY, a.nextcal) <= 30);
    if (f === "office") rows = rows.filter((a) => a.office === user().office);
    const chips = [
      ["all", "All"],
      ["avail", "Available"],
      ["out", "Checked out"],
      ["dep", "Deployed"],
      ["cal", "Calibration due"],
      ["office", "My office"],
    ]
      .map(([k, l]) => `<button class="chip ${f === k ? "on" : ""}" data-act="cfilter" data-k="${k}">${l}</button>`)
      .join("");

    const table = isDesk()
      ? assetTable(rows)
      : `<div class="list-frame">${rows.map(assetRow).join("") || `<div class="state-box">No assets in this filter.</div>`}</div>`;

    return `
      <div class="page-h"><div><h1>${esc(cat.name)}</h1><p class="sub">${cat.total} assets in fleet · ${rows.length} in this sample</p></div></div>
      <div class="chips" style="margin-bottom:10px">${chips}</div>
      <div class="t-cap" style="margin-bottom:8px">Sort: Asset ID · Model · Status · Location · Calibration due</div>
      ${table}`;
  }

  function assetTable(rows, selectable) {
    const body = rows
      .map((a) => {
        const sel = state.selected.includes(a.id);
        return `<tr class="${sel ? "sel" : ""}" data-go="asset" data-param="${esc(a.id)}">
          ${selectable ? `<td><input type="checkbox" data-act="sel" data-id="${esc(a.id)}" ${sel ? "checked" : ""} onclick="event.stopPropagation()"/></td>` : ""}
          <td class="t-id">${esc(a.id)}</td>
          <td>${esc(a.mfr)} ${esc(a.model)}</td>
          <td>${esc(AMS.TYPE_LABEL[a.type])}</td>
          <td>${pill(a.status)}</td>
          <td>${esc(a.loc || "—")}</td>
          <td>${esc(a.custName || "—")}</td>
          <td>${esc(a.proj || "—")}</td>
          <td>${esc(a.nextcal || "—")}</td>
          <td>${esc(a.office)}</td>
        </tr>`;
      })
      .join("");
    return `<div class="table-wrap"><table class="data">
      <thead><tr>
        ${selectable ? "<th></th>" : ""}
        <th>Asset ID</th><th>Model</th><th>Type</th><th>Status</th><th>Location</th><th>Custodian</th><th>Project</th><th>Cal due</th><th>Home office</th>
      </tr></thead>
      <tbody>${body || `<tr><td colspan="10"><div class="state-box">No rows</div></td></tr>`}</tbody>
    </table></div>`;
  }

  function pageAsset() {
    const a = find(state.param) || find("DL-UM-16984");
    const allowed = AMS.ACTION_MATRIX[a.status] || [];
    const canWrite = !user().readonly;
    const admin = user().admin;
    const showSim = admin && a.sim;
    const tab = state.tab;
    const actions = [
      ["checkout", "Checkout", allowed.includes("checkout")],
      ["return", "Return", allowed.includes("return")],
      ["transfer", "Transfer", allowed.includes("transfer")],
      ["deploy", "Deploy", allowed.includes("deploy")],
      ["recover", "Recover", allowed.includes("recover")],
      ["fault", "Report issue", allowed.includes("fault")],
    ]
      .filter(([, , on]) => on)
      .map(([act, lab]) => `<button class="btn ${act === "checkout" || act === "return" ? "btn-primary" : ""}" data-act="asset-act" data-k="${act}" ${canWrite ? "" : "disabled"}>${lab}</button>`)
      .join("");

    const adminActs = admin
      ? [
          allowed.includes("sendCal") ? `<button class="btn btn-sm" data-act="asset-act" data-k="sendCal">Send to calibration</button>` : "",
          allowed.includes("recordCal") ? `<button class="btn btn-sm" data-go="record-cal" data-param="${esc(a.id)}">Record calibration</button>` : "",
          `<button class="btn btn-sm" data-act="toast" data-msg="Attach component is a named command — not a free edit.">Attach component</button>`,
          user().data ? `<button class="btn btn-sm" data-go="corrections">Correct data</button>` : "",
          allowed.includes("retire") ? `<button class="btn btn-sm" data-act="asset-act" data-k="retire">Retire</button>` : "",
        ].join("")
      : "";

    const hist = (db.history[a.id] || [{ date: "—", type: "No events in sample", extra: "", by: "", before: "", after: "" }])
      .map((h) => `<li><div class="when">${esc(h.date)}</div><div class="t-strong">${esc(h.type)}</div><div class="t-cap">${esc(h.before)} → ${esc(h.after)}${esc(h.extra || "")} · ${esc(h.by)}${h.txn ? " · " + h.txn : ""}</div></li>`)
      .join("");

    const cal = (db.cals[a.id] || []).map((c) => `<div class="act-row"><div><div class="t-strong">${esc(c.date)} · ${esc(c.result || "Pass")}</div><div class="t-cap">${esc(c.lab)} · next ${esc(c.due)} · ${c.cert ? "Certificate on file" : "No certificate"}</div></div></div>`).join("") || `<div class="state-box">No calibration records.</div>`;

    const kids = (a.children || []).map((id) => find(id)).filter(Boolean);
    const comps = a.parent
      ? `<p class="t-body">Attached to <button class="btn btn-sm" data-go="asset" data-param="${esc(a.parent)}">${esc(a.parent)}</button></p>`
      : kids.length
        ? kids.map((c) => `<button class="asset-row" data-go="asset" data-param="${esc(c.id)}"><div class="meta"><div class="t-id">${esc(c.id)}</div><div class="sub">${esc(c.model)}</div></div></button>`).join("")
        : `<div class="state-box">No components attached.</div>`;

    const inst = db.installations.filter((i) => i.components.some((c) => c.asset === a.id));
    const deps = inst.length
      ? inst.map((i) => `<button class="act-row" data-go="site" data-param="${esc(i.site)}"><div><div class="t-strong">${esc(i.sitename)}</div><div class="t-cap">${esc(i.start)} – ${esc(i.end || "current")} · ${esc(i.project)}</div></div></button>`).join("")
      : `<div class="state-box">No deployments in sample.</div>`;

    const tabs = ["overview", "history", "calibration", "components", "deployments", "documents"]
      .map((t) => `<button class="tab ${tab === t ? "on" : ""}" data-act="tab" data-k="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`)
      .join("");

    let panel = "";
    if (tab === "history") panel = `<ul class="tl">${hist}</ul>`;
    else if (tab === "calibration") panel = cal;
    else if (tab === "components") panel = comps;
    else if (tab === "deployments") panel = deps;
    else panel = `<div class="state-box">Certificates are private. Request a time-limited link — no storage key in the browser.</div>`;

    const now = `<div class="card now-card">
        <div class="sec-label">Current status</div>
        <div style="margin:6px 0 12px">${pill(a.status)}</div>
        <div class="now-grid">
          <div><div class="lab">Custodian</div><div class="val">${esc(a.custName || "—")}</div></div>
          <div><div class="lab">Project</div><div class="val">${esc(a.proj || "—")}</div></div>
          <div><div class="lab">Current location</div><div class="val">${esc(a.loc || "—")}</div></div>
          <div><div class="lab">Home office</div><div class="val">${esc(a.office)}</div></div>
          <div><div class="lab">Calibration</div><div class="val">${a.nextcal ? (isOverdue(a) ? "Overdue " : "Due ") + a.nextcal : "Unknown"}</div></div>
          <div><div class="lab">Parent / attached</div><div class="val">${esc(a.parent || (a.children[0] || "—"))}</div></div>
        </div>
        ${showSim ? `<div class="banner banner-info" style="margin-top:12px">SIM ICCID ${esc(a.sim.iccid)} · ${esc(a.sim.phone)} · ${esc(a.sim.ip)} — admin only</div>` : ""}
        ${a.id.startsWith("TMP-") ? `<div class="banner banner-warn" style="margin-top:12px">Temporary Asset ID — complete the permanent tag.</div>` : ""}
        ${a.notes ? `<p class="t-cap" style="margin-top:10px">${esc(a.notes)}</p>` : ""}
      </div>`;

    return `
      <div class="page-h">
        <div>
          <div class="t-id-lg">${esc(a.id)}</div>
          <div class="sub">${esc(a.mfr)} ${esc(a.model)} · ${esc(AMS.TYPE_LABEL[a.type])}</div>
        </div>
        ${pill(a.status)}
      </div>
      ${now}
      <div class="actions-row">${actions || `<span class="t-cap">No field actions from ${esc(AMS.STATUS_LABEL[a.status])}.</span>`}</div>
      ${adminActs ? `<div class="actions-row">${adminActs}</div>` : ""}
      <div class="tabs">${tabs}</div>
      <div style="padding-top:12px">${tab === "overview" ? (isDesk() ? `<div class="t-cap">Why this custodian? <button class="btn btn-sm" data-go="lineage" data-param="${esc(a.id)}">Open data lineage</button></div>` : `<p class="t-cap">Overview is the Now card above. History and certificates are on the other tabs.</p>`) : panel}</div>`;
  }

  function resultBlock() {
    if (!state.result) return "";
    const r = state.result;
    return `<div class="success">
      <div class="banner ${r.kind === "queued" ? "banner-warn" : "banner-ok"}">${esc(r.title)}</div>
      <div class="txn">${esc(r.txn || "")}</div>
      <p class="t-body">${esc(r.body || "")}</p>
      <button class="btn btn-primary" data-go="${r.back || "home"}">${esc(r.backLabel || "Done")}</button>
    </div>`;
  }

  function pageCheckout() {
    if (state.result) return resultBlock();
    const lines = state.cart.map((id) => find(id)).filter(Boolean);
    return `
      ${isDesk() ? `<div class="page-h"><div><h1>Checkout equipment</h1><p class="sub">One transaction, many assets.</p></div></div>` : ""}
      <div class="field"><label>Project</label>
        <select id="co-proj">${AMS.PROJECTS.map((p) => `<option value="${p.id}">${p.id} — ${esc(p.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Assigned to</label>
        <select id="co-who">${AMS.PEOPLE.map((p) => `<option value="${p.upn}" ${p.upn === user().upn ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        <div class="hint">Server resolves the person from this pick list — not a typed name.</div></div>
      <div class="field"><label>Expected return (optional)</label><input id="co-due" type="date" /></div>
      <div class="field"><label>Notes</label><textarea id="co-notes" placeholder="Job, vehicle, kit role…"></textarea></div>
      <div class="sec-label">Asset cart · ${lines.length}</div>
      <div class="list-frame">${
        lines.length
          ? lines.map((a) => `<div class="cart-line"><div class="meta"><div class="t-id">${esc(a.id)}</div><div class="t-cap">${esc(a.model)} · ${esc(AMS.STATUS_LABEL[a.status])}</div></div><button class="btn btn-sm" data-act="cart-rm" data-id="${esc(a.id)}">Remove</button></div>`).join("")
          : `<div class="state-box">Cart is empty. Add available assets.</div>`
      }</div>
      <div class="cmd" style="margin:12px 0">
        <button class="btn" data-act="cart-add">Add asset</button>
        <button class="btn" data-act="scan">Scan</button>
      </div>
      <button class="btn btn-primary btn-block btn-lg" data-act="checkout-go" ${lines.length && !user().readonly ? "" : "disabled"}>Checkout ${lines.length} asset${lines.length === 1 ? "" : "s"}</button>`;
  }

  function pageReturn() {
    if (state.result) return resultBlock();
    const held = myAssets().filter((a) => a.status === "CheckedOut" || a.status === "Deployed");
    const sel = state.returnSel.length ? state.returnSel : held.map((a) => a.id);
    return `
      ${isDesk() ? `<div class="page-h"><div><h1>Return equipment</h1></div><button class="btn" data-act="ret-all">Select all</button></div>` : `<button class="btn btn-sm" data-act="ret-all" style="margin-bottom:8px">Return all</button>`}
      <div class="field"><label>Return location</label><select><option>${esc(user().office)}</option>${AMS.OFFICES.filter((o) => o !== user().office).map((o) => `<option>${o}</option>`).join("")}</select></div>
      <div class="list-frame">${held
        .map((a) => {
          const on = sel.includes(a.id);
          const c = state.conditions[a.id] || "Good";
          return `<div class="cart-line">
            <input type="checkbox" data-act="ret-tog" data-id="${esc(a.id)}" ${on ? "checked" : ""}/>
            <div class="meta"><div class="t-id">${esc(a.id)}</div><div class="t-cap">${esc(a.model)}</div>
              <div class="cond">${["Good", "Damaged", "Needs service"].map((x) => `<button class="chip ${c === x ? "on" : ""}" data-act="cond" data-id="${esc(a.id)}" data-k="${x}">${x}</button>`).join("")}</div>
            </div>
          </div>`;
        })
        .join("") || `<div class="state-box">You have no equipment to return.</div>`}</div>
      <button class="btn btn-primary btn-block btn-lg" style="margin-top:12px" data-act="return-go" ${sel.length && !user().readonly ? "" : "disabled"}>Return ${sel.length} asset${sel.length === 1 ? "" : "s"}</button>`;
  }

  function pageTransfer() {
    if (state.result) return resultBlock();
    const a = find(state.param) || find("DL-UM-16984");
    return `
      ${isDesk() ? `<div class="page-h"><h1>Transfer</h1></div>` : ""}
      <div class="card" style="margin-bottom:12px">
        <div class="sec-label">Current</div>
        <div class="t-id">${esc(a.id)}</div>
        <div class="kv" style="margin-top:8px">
          <dt>Custodian</dt><dd>${esc(a.custName || "—")}</dd>
          <dt>Project</dt><dd>${esc(a.proj || "—")}</dd>
          <dt>Office</dt><dd>${esc(a.office)}</dd>
        </div>
      </div>
      <div class="field"><label>New custodian</label><select id="xf-who">${AMS.PEOPLE.map((p) => `<option value="${p.upn}">${esc(p.name)}</option>`).join("")}</select></div>
      <div class="field"><label>New project</label><select id="xf-proj">${AMS.PROJECTS.map((p) => `<option value="${p.id}">${p.id} — ${esc(p.name)}</option>`).join("")}</select></div>
      <div class="field"><label>New office / location</label><select id="xf-off">${AMS.OFFICES.map((o) => `<option>${o}</option>`).join("")}</select></div>
      <div class="field"><label>Reason (required)</label><textarea id="xf-why" placeholder="Why is custody changing?"></textarea></div>
      <p class="t-cap">Do not return and check out again. Transfer is one event.</p>
      <button class="btn btn-primary btn-block" data-act="xfer-go" ${user().readonly ? "disabled" : ""}>Transfer ${esc(a.id)}</button>`;
  }

  function pageSites() {
    const only = state.query.current === "1";
    const list = db.installations.filter((i) => (only ? i.current : true));
    return `
      ${isDesk() ? `<div class="page-h"><div><h1>Sites & deployments</h1></div><button class="btn btn-primary" data-go="deploy">Deploy equipment</button></div>` : ""}
      <div class="chips" style="margin-bottom:10px">
        <button class="chip ${only ? "" : "on"}" data-act="sites-all">All</button>
        <button class="chip ${only ? "on" : ""}" data-act="sites-cur">Current</button>
      </div>
      <div class="list-frame">${list
        .map(
          (i) => `<button class="asset-row" data-go="site" data-param="${esc(i.site)}">
            <div class="meta"><div class="t-strong">${esc(i.sitename)}</div>
            <div class="sub">Project ${esc(i.project)} · ${i.components.length} assets · ${i.current ? "Current installation" : "Historical"}</div></div>
          </button>`
        )
        .join("")}</div>`;
  }

  function pageSite() {
    const i = db.installations.find((x) => x.site === state.param) || db.installations[0];
    return `
      <div class="page-h"><div><h1>${esc(i.sitename)}</h1><p class="sub">Project ${esc(i.project)} · ${i.current ? "Current" : "Closed " + i.end}</p></div></div>
      <div class="card now-card">
        <div class="now-grid">
          <div><div class="lab">Deployed</div><div class="val">${esc(i.start)}</div></div>
          <div><div class="lab">Position</div><div class="val">${esc(i.position)}</div></div>
          <div><div class="lab">Coordinates</div><div class="val">${esc(i.lat)}, ${esc(i.lon)}</div></div>
          <div><div class="lab">Power</div><div class="val">${esc(i.power)}</div></div>
        </div>
      </div>
      <div class="actions-row">
        <button class="btn btn-primary" data-go="deploy" data-param="${esc(i.site)}" ${user().readonly ? "disabled" : ""}>Deploy equipment</button>
        <button class="btn" data-act="recover" data-id="${esc(i.id)}" ${user().readonly ? "disabled" : ""}>Recover equipment</button>
        <button class="btn" data-act="toast" data-msg="Swap component is a named command (D06).">Swap component</button>
        <button class="btn" data-act="toast" data-msg="Configuration change is recorded as an event.">Change configuration</button>
      </div>
      <div class="sec-label">Installed components</div>
      <div class="list-frame">${i.components
        .map((c) => {
          const a = find(c.asset);
          return `<button class="asset-row" data-go="asset" data-param="${esc(c.asset)}">
            <div class="meta"><div class="t-id">${esc(c.asset)}</div><div class="sub">${esc(c.role)} · orientation ${esc(c.orientation)}${a ? " · " + a.model : ""}</div></div>
          </button>`;
        })
        .join("")}</div>`;
  }

  function pageDeploy() {
    if (state.result) return resultBlock();
    return `
      ${isDesk() ? `<div class="page-h"><h1>Deploy to site</h1></div>` : ""}
      <div class="field"><label>Site</label><select id="dp-site">${db.installations.map((i) => `<option value="${i.site}" ${state.param === i.site ? "selected" : ""}>${esc(i.sitename)}</option>`).join("")}<option value="new">+ New site…</option></select></div>
      <div class="field"><label>Project</label><select>${AMS.PROJECTS.map((p) => `<option>${p.id} — ${esc(p.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Primary logger</label><input value="DL-UM-17021" readonly class="mono" /></div>
      <div class="field"><label>Coordinates</label><input placeholder="Device GPS or enter" value="45.4215, -75.6972" /></div>
      <div class="field"><label>Power source</label><select><option>Solar</option><option>Battery</option><option>AC</option></select></div>
      <div class="field"><label>Notes</label><textarea></textarea></div>
      <button class="btn btn-primary btn-block" data-act="deploy-go" ${user().readonly ? "disabled" : ""}>Deploy kit</button>`;
  }

  function pageCalibration() {
    const tab = state.query.tab || state.calTab;
    const buckets = {
      overdue: db.assets.filter(isOverdue),
      "30": db.assets.filter((a) => a.nextcal && !isOverdue(a) && daysBetween(AMS.TODAY, a.nextcal) <= 30),
      "60": db.assets.filter((a) => a.nextcal && daysBetween(AMS.TODAY, a.nextcal) <= 60 && daysBetween(AMS.TODAY, a.nextcal) > 30),
      "90": db.assets.filter((a) => a.nextcal && daysBetween(AMS.TODAY, a.nextcal) <= 90 && daysBetween(AMS.TODAY, a.nextcal) > 60),
      unknown: db.assets.filter((a) => !a.nextcal && a.status !== "Retired"),
      lab: db.assets.filter((a) => a.status === "InCalibration"),
    };
    const rows = buckets[tab] || buckets.overdue;
    const tabs = [
      ["overdue", "Overdue", buckets.overdue.length],
      ["30", "Due 30 days", buckets["30"].length],
      ["60", "Due 60 days", buckets["60"].length],
      ["90", "Due 90 days", buckets["90"].length],
      ["unknown", "Unknown", buckets.unknown.length],
      ["lab", "At lab", buckets.lab.length],
    ]
      .map(([k, l, n]) => `<button class="chip ${tab === k ? "on" : ""}" data-act="caltab" data-k="${k}">${l} · ${n}</button>`)
      .join("");
    return `
      ${isDesk() ? `<div class="page-h"><div><h1>Calibration</h1><p class="sub">Counts by horizon. Office filter is implied by role.</p></div>
        ${user().admin ? `<button class="btn btn-primary" data-go="record-cal">Record calibration</button>` : ""}</div>` : ""}
      <div class="chips" style="margin-bottom:10px">${tabs}</div>
      ${isDesk() ? officeBreakdown() + "<div style='height:10px'></div>" : ""}
      ${isDesk() ? assetTable(rows) : `<div class="list-frame">${rows.map(assetRow).join("") || `<div class="state-box">None in this horizon.</div>`}</div>`}`;
  }

  function pageRecordCal() {
    const a = find(state.param) || find("SLM-S50-13595");
    if (state.result) return resultBlock();
    return `
      ${isDesk() ? `<div class="page-h"><h1>Record calibration</h1></div>` : ""}
      <div class="t-id">${esc(a.id)}</div>
      <div class="t-cap">${esc(a.model)}</div>
      <div class="field"><label>Calibration date</label><input type="date" value="2026-09-03" /></div>
      <div class="field"><label>Next due</label><input type="date" value="2027-09-03" /></div>
      <div class="field"><label>Result</label><select><option>Pass</option><option>Fail — remains in calibration</option><option>Limited</option></select></div>
      <div class="field"><label>Lab</label><select>${AMS.LABS.map((l) => `<option>${esc(l)}</option>`).join("")}</select></div>
      <div class="field"><label>Cost</label><input placeholder="$" /></div>
      <div class="field"><label>Certificate</label><button class="btn" data-act="toast" data-msg="Private blob upload — no storage credential in the browser.">Upload PDF</button></div>
      <button class="btn btn-primary btn-block" data-act="cal-go" ${user().admin && !user().readonly ? "" : "disabled"}>Save calibration</button>
      ${!user().admin ? `<p class="t-cap">Field users can view currency; recording is an admin command.</p>` : ""}`;
  }

  function pageAssets() {
    const q = (state.q || "").toLowerCase();
    let rows = db.assets.filter((a) => !q || [a.id, a.serial, a.model, a.custName].join(" ").toLowerCase().includes(q));
    const bulk = state.selected.length
      ? `<div class="bulk-bar"><b>${state.selected.length} selected</b>
          <button class="btn btn-sm" data-act="sel-clear">Clear</button>
          <button class="btn btn-sm" data-go="transfer">Transfer</button>
          <button class="btn btn-sm" data-act="toast" data-msg="Send to calibration is a bulk named command.">Send to calibration</button>
          <button class="btn btn-sm" data-go="exports">Export</button>
          ${user().admin ? `<button class="btn btn-sm btn-danger" data-act="toast" data-msg="Retire requires confirmation and remains a compensating event.">Retire</button>` : ""}
        </div>`
      : "";
    return `
      <div class="page-h">
        <div><h1>Assets <span class="count">1,148</span></h1><p class="sub">${rows.length} in this sample view</p></div>
        <div class="cmd">
          ${user().data ? `<button class="btn" data-go="import">Import</button>` : ""}
          ${user().reports ? `<button class="btn" data-go="exports">Export</button>` : ""}
          ${user().admin && !user().readonly ? `<button class="btn btn-primary" data-act="toast" data-msg="New asset is a named command (S14).">New asset</button>` : ""}
        </div>
      </div>
      <div class="filter-bar">
        <button class="chip">Office</button>
        <button class="chip">Status</button>
        <button class="chip">Type</button>
        <button class="chip">Cal due</button>
        <button class="chip">Add filter</button>
        <span class="t-cap" style="margin-left:auto">Saved views · Columns</span>
      </div>
      ${bulk}
      ${assetTable(rows, true)}
      <div class="t-cap" style="margin-top:8px">1–${rows.length} of 1,148 · Prev · Next</div>`;
  }

  function fleetStats() {
    const f = AMS.FLEET;
    return `<div class="stat-strip">
      ${stat(f.total, "Total")}
      ${stat(f.available, "Available")}
      ${stat(f.checkedOut, "Checked out")}
      ${stat(f.deployed, "Deployed")}
      ${stat(f.repair, "Needs repair", true)}
      ${stat(f.calOverdue, "Cal overdue", true)}
    </div>`;
  }

  function pageReports() {
    const cards = [
      ["fleet", "Fleet", "Counts and breakdowns"],
      ["fleet", "Availability", "By office and category"],
      ["calibration", "Calibration", "Overdue and horizons"],
      ["projects", "Projects", "Assigned equipment"],
      ["fleet", "Utilization", "Time in use vs available"],
      ["lineage", "Asset Timeline", "Where it was, and what was attached"],
      ["sites", "Site History", "Installations over time"],
    ];
    return `
      <div class="page-h"><div><h1>Reports</h1><p class="sub">Read-only products. Exports are governed separately.</p></div></div>
      <div class="cat-grid">${cards.map(([g, t, s]) => `<button class="report-card" data-go="${g}"><h3>${t}</h3><span class="t-cap">${s}</span></button>`).join("")}</div>`;
  }

  function pageFleet() {
    const f = AMS.FLEET;
    const avail = Math.round((f.available / f.total) * 100);
    const out = Math.round((f.checkedOut / f.total) * 100);
    const dep = Math.round((f.deployed / f.total) * 100);
    const oos = 100 - avail - out - dep;
    return `
      <div class="page-h"><div><h1>Fleet</h1><p class="sub">Ontario instrumentation · 1,148 active</p></div></div>
      ${fleetStats()}
      <div class="card">
        <div class="sec-label">Status mix</div>
        <div class="chart-row">
          <span style="width:${avail}%;background:#0e700e"></span>
          <span style="width:${out}%;background:#3b5b8a"></span>
          <span style="width:${dep}%;background:#0f6a62"></span>
          <span style="width:${oos}%;background:#bc2f32"></span>
        </div>
        <div class="legend">
          <span><i style="background:#0e700e"></i>Available ${avail}%</span>
          <span><i style="background:#3b5b8a"></i>Checked out ${out}%</span>
          <span><i style="background:#0f6a62"></i>Deployed ${dep}%</span>
          <span><i style="background:#bc2f32"></i>Out of service</span>
        </div>
      </div>
      <div class="split-wide" style="margin-top:16px">
        <div><div class="sec-label">By office</div>${officeBreakdown()}</div>
        <div><div class="sec-label">By category</div>
          <div class="list-frame">${AMS.CATEGORIES.map((c) => `<div class="attn-row"><span>${esc(c.name)}</span><span class="t-cap" style="margin-left:auto">${c.total} · ${c.available} avail</span></div>`).join("")}</div>
        </div>
      </div>`;
  }

  function pageData() {
    if (!user().data) return gated("Data Management is a System / Data Admin console.");
    return `
      <div class="page-h"><div><h1>Data Management</h1><p class="sub">Named commands — not a generic table editor.</p></div></div>
      <div class="sec-label">Data health</div>
      <div class="stat-strip">
        ${stat(3, "Critical", true)}${stat(12, "High priority", true)}${stat(44, "Incomplete")}${stat(8, "Duplicates")}${stat(1, "Failed jobs", true)}${stat(0, "Legal holds")}
      </div>
      <div class="cat-grid">
        ${[
          ["quality", "Data Quality", "Rules and issue queue"],
          ["import", "Imports & Bulk Jobs", "Dry-run required"],
          ["duplicates", "Duplicate Review", "Never auto-merge"],
          ["reference", "Reference Data", "Models, locations, projects"],
          ["corrections", "Corrections", "Old → new with approval"],
          ["lineage", "Data Lineage", "Why the system says this"],
          ["exports", "Exports", "Approved templates only"],
          ["retention", "Retention & Legal Hold", "No general delete"],
        ].map(([g, t, s]) => `<button class="report-card" data-go="${g}"><h3>${t}</h3><span class="t-cap">${s}</span></button>`).join("")}
      </div>`;
  }

  function gated(msg) {
    return `<div class="banner banner-info">${esc(msg)}</div><p class="t-cap">Switch role in the studio bar to open this surface.</p>`;
  }

  function pageQuality() {
    if (!user().data && !user().admin) return gated("Office-scoped quality is visible to admins.");
    return `
      <div class="page-h"><div><h1>Data quality issues</h1></div></div>
      <div class="chips" style="margin-bottom:10px">
        <span class="chip on">Severity</span><span class="chip">Domain</span><span class="chip">Office</span><span class="chip">Owner</span><span class="chip">Open</span>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Issue</th><th>Record</th><th>Rule</th><th>Severity</th><th>Office</th><th>Owner</th><th>Age</th><th>Status</th></tr></thead>
        <tbody>${db.issues.map((i) => `<tr data-go="asset" data-param="${esc(i.record)}">
          <td>${esc(i.issue)}</td><td class="t-id">${esc(i.record)}</td><td>${esc(i.rule)}</td>
          <td><span class="pill pill-${i.sev === "Critical" ? "critical" : "high"}">${esc(i.sev)}</span></td>
          <td>${esc(i.office)}</td><td>${esc(i.owner)}</td><td>${esc(i.age)}</td><td>${esc(i.status)}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
  }

  function pageImport() {
    if (!user().data) return gated("Imports are a Data Admin command.");
    const step = state.importStep;
    const steps = ["Upload", "Validate", "Dry-run", "Review", "Approval", "Apply", "Results"];
    return `
      <div class="page-h"><div><h1>Import / dry run</h1><p class="sub">JOB-089 · swo-slm.xlsx · never apply on upload.</p></div>
        <div class="cmd"><button class="btn">Download template</button><button class="btn">New import</button></div></div>
      <div class="stepper">${steps.map((s, i) => `<div class="step ${i < step ? "done" : ""} ${i === step ? "on" : ""}">${i + 1} ${s}</div>`).join("")}</div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Job</th><th>Type</th><th>File</th><th>By</th><th>Status</th><th>Valid</th><th>Warn</th><th>Err</th><th>Applied</th></tr></thead>
        <tbody>${db.jobs.map((j) => `<tr><td class="t-id">${j.id}</td><td>${j.type}</td><td>${esc(j.file)}</td><td>${esc(j.by)}</td><td>${esc(j.status)}</td><td>${j.valid}</td><td>${j.warn}</td><td>${j.err}</td><td>${j.applied}</td></tr>`).join("")}</tbody>
      </table></div>
      <div class="card" style="margin-top:12px">
        <div class="t-strong">Dry-run JOB-089</div>
        <p class="t-cap">18 valid · 5 warnings · 2 errors. Apply is disabled until errors are resolved and approval is recorded.</p>
        <div class="cmd">
          <button class="btn" data-act="imp-step" ${step <= 0 ? "disabled" : ""}>Back</button>
          <button class="btn btn-primary" data-act="imp-next">${step >= 6 ? "Done" : "Continue"}</button>
          <button class="btn" disabled>Apply</button>
        </div>
      </div>`;
  }

  function pageDuplicates() {
    if (!user().data) return gated("Duplicate review is a Data Admin command.");
    const a = find("DL-UM-16984");
    const b = find("GEO-V12-30220");
    const col = (x) => `
      <div class="card">
        <div class="sec-label">${x === a ? "Record A" : "Record B"}</div>
        <div class="t-id-lg">${esc(x.id)}</div>
        ${pill(x.status)}
        <dl class="kv" style="margin-top:10px">
          <dt>Serial</dt><dd class="mono">${esc(x.serial)}</dd>
          <dt>Model</dt><dd>${esc(x.mfr)} ${esc(x.model)}</dd>
          <dt>Office</dt><dd>${esc(x.office)}</dd>
          <dt>History</dt><dd>${(db.history[x.id] || []).length} events</dd>
          <dt>Calibration</dt><dd>${(db.cals[x.id] || []).length} records</dd>
          <dt>State</dt><dd>${esc(AMS.STATUS_LABEL[x.status])}</dd>
        </dl>
      </div>`;
    return `
      <div class="page-h"><div><h1>Duplicate review</h1><p class="sub">DUP-12 · shared serial is evidence of nothing by itself.</p></div></div>
      <div class="compare">${col(a)}${col(b)}</div>
      <div class="banner banner-warn" style="margin:12px 0">Merge would keep both UUIDs and histories. Survivor receives a redirect. Transaction lines are not rewritten.</div>
      <div class="cmd">
        <button class="btn" data-act="toast" data-msg="Marked not a duplicate.">Not duplicate</button>
        <button class="btn" data-act="toast" data-msg="Related physical assets — logger + geophone sharing a serial is plausible.">Related physical assets</button>
        <button class="btn" data-act="toast" data-msg="Queued for physical audit.">Needs physical audit</button>
        <button class="btn btn-primary" data-act="toast" data-msg="Merge requires survivor, impact preview, and a second approver.">Merge records</button>
        <button class="btn" data-act="toast" data-msg="Retire is a compensating event, not a delete.">Retire erroneous</button>
      </div>`;
  }

  function pageReference() {
    if (!user().admin) return gated("Reference data is maintained in the app by administrators.");
    return `
      <div class="page-h"><div><h1>Reference data</h1><p class="sub">Selected, not typed. Deactivate — never delete.</p></div>
        <button class="btn btn-primary" data-act="toast" data-msg="Add model is a named command.">Add equipment model</button></div>
      <div class="chips" style="margin-bottom:10px">
        <span class="chip on">Equipment models</span><span class="chip">Locations</span><span class="chip">Projects</span>
        <span class="chip">Categories</span><span class="chip">Calibration labs</span><span class="chip">Ownership types</span>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Manufacturer</th><th>Model</th><th>Type</th><th>Category</th><th>Status</th></tr></thead>
        <tbody>${db.models.map((m) => `<tr><td>${esc(m.mfr)}</td><td>${esc(m.model)}</td><td>${esc(m.type)}</td><td>${esc(m.group)}</td><td>${m.active ? "Active" : "Inactive"}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="t-cap" style="margin-top:8px">Edits open a structured panel. No CSV is the ongoing source.</p>`;
  }

  function pageCorrections() {
    if (!user().admin) return gated("Corrections are named, approved commands.");
    return `
      <div class="page-h"><div><h1>Data corrections</h1></div>
        <div class="chips"><span class="chip">Requested</span><span class="chip on">Awaiting approval</span><span class="chip">Completed</span><span class="chip">Rejected</span></div>
      </div>
      ${db.corrections.map((c) => `
        <div class="card" style="margin-bottom:10px">
          <div class="card-h"><span class="t-id">${esc(c.record)}</span><span class="pill pill-open">${esc(c.status)}</span></div>
          <div class="t-strong">${esc(c.field)}</div>
          <div class="kv" style="margin-top:8px">
            <dt>Old value</dt><dd>${esc(c.old)}</dd>
            <dt>New value</dt><dd>${esc(c.neu)}</dd>
            <dt>Reason</dt><dd>${esc(c.reason)}</dd>
            <dt>Requested by</dt><dd>${esc(c.by)}</dd>
            <dt>Approved by</dt><dd>${esc(c.appr)}</dd>
          </div>
          ${c.status === "Awaiting approval" && user().data ? `<div class="cmd" style="margin-top:10px"><button class="btn btn-primary" data-act="toast" data-msg="Approved. Compensating event will be written.">Approve</button><button class="btn" data-act="toast" data-msg="Rejected with reason.">Reject</button></div>` : ""}
        </div>`).join("")}`;
  }

  function pageLineage() {
    const a = find(state.param) || find("DL-UM-16984");
    const h = (db.history[a.id] || [])[0];
    return `
      <div class="page-h"><div><h1>Data lineage</h1><p class="sub">Why does the system say this?</p></div></div>
      <div class="t-id-lg">${esc(a.id)}</div>
      <div class="card now-card" style="margin-top:12px">
        <div class="lab">Current custodian</div>
        <div class="val" style="font-size:18px;margin:4px 0 12px">${esc(a.custName || "—")}</div>
        <dl class="kv">
          <dt>Derived from</dt><dd>${h ? esc(h.type) + " " + esc(h.txn || "") : "No accepted event in sample"}</dd>
          <dt>Recorded</dt><dd>${h ? esc(h.date) : "—"}</dd>
          <dt>Performed by</dt><dd>${h ? esc(h.by) : "—"}</dd>
          <dt>Previous state</dt><dd>${h ? esc(h.before) : "—"}</dd>
          <dt>New state</dt><dd>${h ? esc(h.after) : "—"}</dd>
        </dl>
        <p class="t-cap" style="margin-top:10px">Current state is derived through accepted events. This screen never offers a free-text edit.</p>
      </div>
      <button class="btn" style="margin-top:12px" data-go="asset" data-param="${esc(a.id)}">Open asset</button>`;
  }

  function pageExports() {
    if (!user().reports && !user().data) return gated("Exports are a governed product.");
    return `
      <div class="page-h"><div><h1>Exports</h1><p class="sub">Approved template · server-side scope · private short-lived artifact.</p></div>
        <button class="btn btn-primary" data-act="toast" data-msg="Request submitted. Artifact expires automatically.">Request export</button></div>
      <div class="chips" style="margin-bottom:10px">
        <span class="chip on">Office inventory</span><span class="chip">Calibration compliance</span>
        <span class="chip">Project assets</span><span class="chip">Asset timeline</span><span class="chip">Data quality issues</span>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>ID</th><th>Template</th><th>Requested by</th><th>Purpose</th><th>Rows</th><th>Classification</th><th>Created</th><th>Expires</th></tr></thead>
        <tbody>${db.exports.map((e) => `<tr><td class="t-id">${e.id}</td><td>${esc(e.template)}</td><td>${esc(e.by)}</td><td>${esc(e.purpose)}</td><td>${e.rows}</td><td>${esc(e.class)}</td><td>${esc(e.created)}</td><td>${esc(e.expires)}</td></tr>`).join("")}</tbody>
      </table></div>`;
  }

  function pageRetention() {
    if (!user().data) return gated("Retention is a System Admin policy surface.");
    return `
      <div class="page-h"><div><h1>Retention & legal hold</h1><p class="sub">No general-purpose delete path.</p></div></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Data class</th><th>Policy</th><th>Retention period</th><th>Legal hold</th><th>Next eligible</th></tr></thead>
        <tbody>${db.retention.map((r) => `<tr><td>${esc(r.class)}</td><td class="t-id">${esc(r.policy)}</td><td>${esc(r.period)}</td><td>${esc(r.hold)}</td><td>${esc(r.next)}</td></tr>`).join("")}</tbody>
      </table></div>
      <div class="banner banner-info" style="margin-top:12px">Purge is preview + approval + legal-hold check. There is no red “Delete records” control.</div>`;
  }

  function pagePeople() {
    if (!user().admin) return gated("People & roles is an administrator screen.");
    return `
      <div class="page-h"><div><h1>People & roles</h1></div></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Office</th><th>Office scope</th><th>Status</th><th>Last sign-in</th></tr></thead>
        <tbody>${AMS.PEOPLE.map((p) => `<tr>
          <td>${esc(p.name)}</td><td>${esc(p.upn)}</td><td>${esc(p.role)}</td>
          <td>${esc(p.office)}</td><td>${esc(p.office)}</td><td>${esc(p.status)}</td><td>${esc(p.last)}</td>
        </tr>`).join("")}</tbody>
      </table></div>
      <div class="card" style="margin-top:12px">
        <div class="t-strong">Permission summary — Field User</div>
        <p class="t-cap">Find, checkout, return, transfer, deploy/recover, report fault. Cannot register assets, manage reference data, export unrestricted fields, or see SIM/network values.</p>
      </div>`;
  }

  function pageAttention() {
    const pending = db.queue.filter((q) => q.state === "pending");
    const rejected = db.queue.filter((q) => q.state === "rejected");
    return `
      ${isDesk() ? `<div class="page-h"><div><h1>Needs attention</h1><p class="sub">Rejected offline work is never discarded.</p></div></div>` : ""}
      <div class="sec-label">Rejected</div>
      <div class="list-frame">${rejected.map((q) => `
        <div class="card" style="border:0;border-bottom:1px solid var(--stroke2);border-radius:0">
          <div class="t-strong">${esc(q.kind)} could not be completed</div>
          <div class="t-id">${esc(q.assets.join(", "))}</div>
          <p class="t-cap">${esc(q.reason)}</p>
          <div class="cmd">
            <button class="btn btn-sm" data-go="asset" data-param="${esc(q.assets[0])}">View asset</button>
            <button class="btn btn-sm" data-act="q-rm" data-id="${esc(q.id)}">Remove request</button>
            <button class="btn btn-sm btn-primary" data-act="q-retry" data-id="${esc(q.id)}">Try again</button>
          </div>
        </div>`).join("") || `<div class="state-box">No rejected submissions.</div>`}</div>
      <div class="sec-label" style="margin-top:14px">Pending sync</div>
      <div class="list-frame">${pending.map((q) => `
        <div class="act-row"><div><div class="t-strong">${esc(q.kind)}</div><div class="t-id">${esc(q.assets.join(", "))}</div><div class="t-cap">${esc(q.at)}</div></div><span class="pill pill-pending">Pending sync</span></div>`).join("") || `<div class="state-box">Queue is empty.</div>`}</div>`;
  }

  function pageMore() {
    const items = [
      ["attention", "Needs attention", true],
      ["sites", "Sites", true],
      ["calibration", "Calibration due", true],
      ["transfer", "Transfer", true],
      ["deploy", "Deploy", true],
      ["reports", "Reports", user().reports],
      ["assets", "All assets", user().admin || isDesk()],
      ["data", "Data Management", user().data],
      ["settings", "Settings", true],
    ].filter((x) => x[2]);
    return `<div class="list-frame more-list">${items.map(([g, l]) => `<button data-go="${g}">${esc(l)}${ico("chev", "ico-sm")}</button>`).join("")}</div>`;
  }

  function pageSettings() {
    return `
      ${isDesk() ? `<div class="page-h"><h1>Settings</h1></div>` : ""}
      <div class="card">
        <div class="kv">
          <dt>Signed in</dt><dd>${esc(user().name)}</dd>
          <dt>Role</dt><dd>${esc(user().roleLabel)}</dd>
          <dt>Home office</dt><dd>${esc(user().office)}</dd>
          <dt>Language</dt><dd>English (Phase 1)</dd>
          <dt>Offline cache</dt><dd>Synced ${esc(AMS.SYNCED)}</dd>
        </div>
      </div>
      <div class="cmd" style="margin-top:12px">
        <button class="btn" data-act="toast" data-msg="French is planned. Copy has 30% slack.">Language</button>
        <button class="btn" data-go="attention">Offline queue</button>
        <button class="btn" data-act="toast" data-msg="Englobe AMS · Field + Console · prototype">About</button>
        <button class="btn" data-act="signout">Sign out</button>
      </div>`;
  }

  function pageProjects() {
    return `
      <div class="page-h"><div><h1>Projects</h1></div></div>
      <div class="list-frame">${AMS.PROJECTS.map((p) => `
        <button class="asset-row" data-go="search" data-query='{"q":"${p.id}"}'>
          <div class="meta"><div class="t-id">${esc(p.id)}</div><div class="sub">${esc(p.name)} · ${esc(p.office)} · ${p.active ? "Active" : "Inactive"}</div></div>
        </button>`).join("")}</div>`;
  }

  function pageRepairs() {
    const rows = db.assets.filter((a) => a.status === "NeedsRepair" || a.status === "Missing");
    return `
      <div class="page-h"><div><h1>Repairs / missing</h1></div></div>
      ${isDesk() ? assetTable(rows) : `<div class="list-frame">${rows.map(assetRow).join("")}</div>`}`;
  }

  function pageAudits() {
    return `
      <div class="page-h"><div><h1>Inventory audits</h1><p class="sub">Office counts. No silent row deletes.</p></div>
        ${user().admin ? `<button class="btn btn-primary" data-act="toast" data-msg="Start audit is a named job with dry-run.">Start audit</button>` : ""}</div>
      <div class="list-frame">
        <div class="act-row"><div><div class="t-strong">Ottawa Q3 count</div><div class="t-cap">Scheduled · 412 expected</div></div><span class="pill pill-open">Planned</span></div>
        <div class="act-row"><div><div class="t-strong">Toronto yard sweep</div><div class="t-cap">Completed Aug 12 · 3 unresolved</div></div><span class="pill pill-ok">Closed</span></div>
      </div>`;
  }

  function pageHealth() {
    if (!user().data) return gated("System health is a System Admin screen.");
    return `
      <div class="page-h"><h1>System health</h1></div>
      <div class="stat-strip">${stat(0, "API errors")}${stat(1, "Failed jobs", true)}${stat(2, "Pending sync")}${stat(99, "Worker uptime %")}</div>
      <div class="banner banner-warn">JOB-090 failed: schema version mismatch. Nothing was applied.</div>`;
  }

  function pageAuditLog() {
    if (!user().data) return gated("Audit log is a System Admin screen.");
    return `
      <div class="page-h"><h1>Audit log</h1></div>
      <div class="list-frame">${db.adminActivity.map((a) => `<div class="act-row"><div><div class="t-strong">${esc(a.what)}</div><div class="t-cap">${esc(a.who)} · ${esc(a.at)}</div></div></div>`).join("")}</div>`;
  }

  function pageFoundations() {
    return `
      <div class="page-h"><div><h1>Design foundations</h1><p class="sub">Tokens, type, status, shells.</p></div></div>
      <div class="foundations card">
        <div class="sec-label">Brand</div>
        <div class="row"><span class="swatch" style="background:#14713a"></span>#14713a Englobe green — only accent</div>
        <div class="row"><span class="swatch" style="background:#242424"></span>Near-black text · warm white canvas</div>
        <div class="sec-label" style="margin-top:12px">Status</div>
        <div class="row">${Object.keys(AMS.STATUS_LABEL).map(pill).join(" ")}</div>
        <div class="sec-label" style="margin-top:12px">Type</div>
        <div class="t-id-lg">DL-UM-16984</div>
        <p class="t-body">Body 14/20 · captions 12/16 · Segoe UI · Asset IDs always monospace.</p>
      </div>`;
  }

  function titles() {
    return {
      home: state.role === "data" ? "AMS Administration" : "Englobe AMS",
      "admin-home": "AMS Administration",
      search: "Find asset",
      category: (AMS.CATEGORIES.find((c) => c.id === state.param) || {}).name || "Category",
      asset: state.param || "Asset",
      checkout: "Checkout equipment",
      return: "Return equipment",
      transfer: "Transfer",
      sites: "Sites",
      site: "Site",
      deploy: "Deploy to site",
      calibration: "Calibration",
      "record-cal": "Record calibration",
      assets: "Assets",
      reports: "Reports",
      fleet: "Fleet",
      data: "Data Management",
      quality: "Data quality",
      import: "Imports",
      duplicates: "Duplicate review",
      reference: "Reference data",
      corrections: "Corrections",
      lineage: "Data lineage",
      exports: "Exports",
      retention: "Retention",
      people: "People & roles",
      attention: "Needs attention",
      more: "More",
      settings: "Settings",
      projects: "Projects",
      repairs: "Repairs / missing",
      audits: "Audits",
      health: "System health",
      "audit-log": "Audit log",
      foundations: "Foundations",
    };
  }

  function renderScreen() {
    const map = {
      home: pageHome,
      "admin-home": pageAdminHome,
      search: pageSearch,
      category: pageCategory,
      asset: pageAsset,
      checkout: pageCheckout,
      return: pageReturn,
      transfer: pageTransfer,
      sites: pageSites,
      site: pageSite,
      deploy: pageDeploy,
      calibration: pageCalibration,
      "record-cal": pageRecordCal,
      assets: pageAssets,
      reports: pageReports,
      fleet: pageFleet,
      data: pageData,
      quality: pageQuality,
      import: pageImport,
      duplicates: pageDuplicates,
      reference: pageReference,
      corrections: pageCorrections,
      lineage: pageLineage,
      exports: pageExports,
      retention: pageRetention,
      people: pagePeople,
      attention: pageAttention,
      more: pageMore,
      settings: pageSettings,
      projects: pageProjects,
      repairs: pageRepairs,
      audits: pageAudits,
      health: pageHealth,
      "audit-log": pageAuditLog,
      foundations: pageFoundations,
    };
    const fn = map[state.route] || pageHome;
    return stateWrap(fn());
  }

  function render() {
    const root = $("#app-root");
    const body = renderScreen();
    const title = titles()[state.route] || "Englobe AMS";
    root.innerHTML = isDesk() ? shellDesktop(body, title) : shellMobile(body, title);
    bind();
    syncStudio();
  }

  function bind() {
    const root = $("#app-root");
    root.onclick = (e) => {
      const t = e.target.closest("[data-go],[data-act]");
      if (!t) return;
      if (t.dataset.go) {
        let query = state.query;
        if (t.dataset.query) {
          try { query = JSON.parse(t.dataset.query); } catch (err) { query = {}; }
        } else if (t.dataset.go !== state.route) {
          query = {};
        }
        if (t.dataset.go === "search" && query.filter) state.filter = query.filter;
        go(t.dataset.go, t.dataset.param, query);
        return;
      }
      handleAct(t.dataset.act, t);
    };
    const hq = $("#home-q");
    if (hq) {
      hq.onkeydown = (e) => {
        if (e.key === "Enter") {
          state.searchQ = hq.value;
          go("search", null, { q: hq.value });
        }
      };
    }
    const sq = $("#search-q");
    if (sq) {
      sq.oninput = () => {
        state.searchQ = sq.value;
        if (sq.value.length >= 2 || sq.value.length === 0) render();
        requestAnimationFrame(() => {
          const n = $("#search-q");
          if (n) { n.focus(); n.setSelectionRange(state.searchQ.length, state.searchQ.length); }
        });
      };
    }
    const cq = $("#cmd-q");
    if (cq) {
      cq.onkeydown = (e) => {
        if (e.key === "Enter") {
          state.searchQ = cq.value;
          state.q = cq.value;
          go("search", null, { q: cq.value });
        }
      };
    }
  }

  function handleAct(act, el) {
    if (act === "back") {
      history.back();
      return;
    }
    if (act === "identity") { state.identity = !state.identity; render(); return; }
    if (act === "close-id") { state.identity = false; render(); return; }
    if (act === "close-dlg") { state.dialog = null; render(); return; }
    if (act === "signout") { toast("Sign-out is stubbed in the prototype."); state.identity = false; render(); return; }
    if (act === "toast") { toast(el.dataset.msg || "Noted."); return; }
    if (act === "retry") { state.uiState = "default"; render(); return; }
    if (act === "clear-ui") { state.uiState = "default"; state.filter = "all"; render(); return; }
    if (act === "scan") {
      state.searchQ = "UM16984";
      go("search", null, { q: "UM16984" });
      return;
    }
    if (act === "sfilter") { state.filter = el.dataset.k; state.query = { ...state.query, filter: el.dataset.k }; render(); return; }
    if (act === "cfilter") { state.catFilter = el.dataset.k; render(); return; }
    if (act === "tab") { state.tab = el.dataset.k; render(); return; }
    if (act === "caltab") { state.calTab = el.dataset.k; state.query = { tab: el.dataset.k }; render(); return; }
    if (act === "sites-all") { state.query = {}; render(); return; }
    if (act === "sites-cur") { state.query = { current: "1" }; render(); return; }
    if (act === "sel") {
      const id = el.dataset.id;
      if (el.checked) state.selected.push(id);
      else state.selected = state.selected.filter((x) => x !== id);
      render();
      return;
    }
    if (act === "sel-clear") { state.selected = []; render(); return; }
    if (act === "cart-add") {
      const avail = db.assets.find((a) => a.status === "Available" && !state.cart.includes(a.id));
      if (avail) state.cart.push(avail.id);
      else toast("No more available sample assets.");
      render();
      return;
    }
    if (act === "cart-rm") { state.cart = state.cart.filter((id) => id !== el.dataset.id); render(); return; }
    if (act === "checkout-go") return submitCheckout();
    if (act === "ret-all") { state.returnSel = myAssets().map((a) => a.id); render(); return; }
    if (act === "ret-tog") {
      const id = el.dataset.id;
      if (el.checked) state.returnSel.push(id);
      else state.returnSel = state.returnSel.filter((x) => x !== id);
      render();
      return;
    }
    if (act === "cond") { state.conditions[el.dataset.id] = el.dataset.k; render(); return; }
    if (act === "return-go") return submitReturn();
    if (act === "xfer-go") return submitXfer();
    if (act === "deploy-go") return submitDeploy();
    if (act === "cal-go") {
      finishWrite("Calibration recorded", find(state.param || "SLM-S50-13595").id + " next due 2027-09-03", "calibration");
      return;
    }
    if (act === "recover") {
      finishWrite("Recovered to " + user().office, "Installation " + el.dataset.id, "sites");
      return;
    }
    if (act === "imp-next") { state.importStep = Math.min(6, state.importStep + 1); render(); return; }
    if (act === "imp-step") { state.importStep = Math.max(0, state.importStep - 1); render(); return; }
    if (act === "q-rm") { db.queue = db.queue.filter((q) => q.id !== el.dataset.id); toast("Request removed. It was not applied."); render(); return; }
    if (act === "q-retry") {
      const q = db.queue.find((x) => x.id === el.dataset.id);
      if (!q) return;
      if (state.offline) { toast("Still offline — stays in queue."); return; }
      q.state = "pending";
      q.reason = null;
      toast("Retry queued.");
      render();
      return;
    }
    if (act === "report") {
      state.dialog = { title: "Report issue", body: "Fault does not change custody or deployment.", ok: "Submit report", fields: `<div class="field"><label>What happened</label><select><option>Damaged</option><option>Missing</option><option>Needs service</option></select></div>` };
      render();
      return;
    }
    if (act === "dlg-ok") { state.dialog = null; toast("Issue recorded as an event. Custody unchanged."); render(); return; }
    if (act === "asset-act") return assetAct(el.dataset.k);
  }

  function assetAct(k) {
    const id = state.param;
    if (k === "checkout") { if (!state.cart.includes(id)) state.cart.push(id); go("checkout"); return; }
    if (k === "return") { state.returnSel = [id]; go("return"); return; }
    if (k === "transfer") { go("transfer", id); return; }
    if (k === "deploy") { go("deploy"); return; }
    if (k === "recover") {
      finishWrite("Recovered to " + user().office, id + " returned from site.", "asset");
      const a = find(id);
      if (a) { a.status = "Available"; a.loc = user().office; }
      return;
    }
    if (k === "fault") { handleAct("report", {}); return; }
    if (k === "sendCal") {
      const a = find(id);
      if (a) { a.status = "InCalibration"; a.loc = "Montreal Calibration"; }
      toast("Sent to calibration.");
      render();
      return;
    }
    if (k === "retire") {
      state.dialog = { title: "Retire " + id, body: "Retirement is permanent. History stays.", ok: "Retire" };
      render();
      return;
    }
  }

  function finishWrite(title, body, back) {
    const txn = nextTxn();
    if (state.offline) {
      db.queue.push({ id: "Q-" + txn, kind: title, assets: state.cart.slice(), at: "Just now", state: "pending", reason: null });
      state.result = { kind: "queued", title: "Queued — 3 changes pending sync", txn, body: body + " Submitted offline.", back, backLabel: "Done" };
    } else {
      state.result = { kind: "ok", title, txn, body, back, backLabel: "Done" };
    }
    render();
  }

  function submitCheckout() {
    const ok = state.cart.map(find).filter((a) => a && a.status === "Available");
    const bad = state.cart.map(find).filter((a) => a && a.status !== "Available");
    if (bad.length) { toast(bad[0].id + " is not available."); return; }
    if (!ok.length) { toast("Add at least one available asset."); return; }
    const who = AMS.PEOPLE.find((p) => p.upn === ($("#co-who") || {}).value) || user();
    ok.forEach((a) => {
      a.status = "CheckedOut";
      a.cust = who.upn;
      a.custName = who.name;
      a.proj = (($("#co-proj") || {}).value) || "02208928";
    });
    state.cart = [];
    finishWrite(ok.length + " assets checked out", "Assigned to " + who.name + " · project " + (ok[0].proj || ""), "home");
  }

  function submitReturn() {
    const ids = state.returnSel.length ? state.returnSel : myAssets().map((a) => a.id);
    ids.forEach((id) => {
      const a = find(id);
      if (!a) return;
      a.status = "Available";
      a.cust = null;
      a.custName = null;
      a.proj = null;
      a.loc = user().office;
    });
    finishWrite(ids.length + " assets returned", "Returned to " + user().office, "home");
    state.returnSel = [];
  }

  function submitXfer() {
    const why = ($("#xf-why") || {}).value;
    if (!why) { toast("Reason is required."); return; }
    const a = find(state.param) || find("DL-UM-16984");
    const who = AMS.PEOPLE.find((p) => p.upn === ($("#xf-who") || {}).value);
    a.cust = who.upn;
    a.custName = who.name;
    a.proj = ($("#xf-proj") || {}).value;
    a.office = ($("#xf-off") || {}).value;
    finishWrite("Transferred " + a.id, a.custName + " · " + a.proj + " · " + why, "asset");
    state.param = a.id;
  }

  function submitDeploy() {
    finishWrite("Kit deployed", "Site recorded. Components stay attached to the installation.", "sites");
  }

  function syncStudio() {
    $$("[data-role]").forEach((b) => b.classList.toggle("on", b.dataset.role === state.role));
    $$("[data-vp]").forEach((b) => b.classList.toggle("on", b.dataset.vp === state.viewport));
    $$("[data-ui]").forEach((b) => b.classList.toggle("on", b.dataset.ui === state.uiState));
    const off = $("#demo-offline");
    if (off) off.classList.toggle("on", state.offline);
  }

  function studioClicks() {
    document.body.addEventListener("click", (e) => {
      const r = e.target.closest("[data-role]");
      if (r) { state.role = r.dataset.role; render(); return; }
      const v = e.target.closest("[data-vp]");
      if (v) { state.viewport = v.dataset.vp; render(); return; }
      const u = e.target.closest("[data-ui]");
      if (u) { state.uiState = u.dataset.ui; render(); return; }
      if (e.target.id === "demo-offline") { state.offline = !state.offline; render(); return; }
      if (e.target.id === "demo-reset") {
        db = AMS.buildDb();
        state.cart = [];
        state.selected = [];
        state.result = null;
        state.txn = 123;
        toast("Demo data reset.");
        render();
      }
    });
  }

  window.addEventListener("hashchange", () => { parseHash(); render(); });
  window.addEventListener("resize", () => { if (state.viewport === "auto") render(); });

  try {
    const saved = JSON.parse(sessionStorage.getItem("ams-ui") || "{}");
    if (saved.role && AMS.ROLES[saved.role]) state.role = saved.role;
    if (saved.viewport) state.viewport = saved.viewport;
    if (typeof saved.offline === "boolean") state.offline = saved.offline;
  } catch (e) { /* ignore */ }

  const _render = render;
  render = function () {
    sessionStorage.setItem("ams-ui", JSON.stringify({ role: state.role, viewport: state.viewport, offline: state.offline }));
    _render();
  };

  parseHash();
  studioClicks();
  render();
})();
