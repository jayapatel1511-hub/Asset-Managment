/* Englobe AMS mobile prototype — hash SPA. No backend; mutating demo state is local. */
(function () {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const ROOT_SCREENS = new Set(["S01", "S04", "S05", "S07", "S08", "S13"]);

  const state = {
    screen: "S01",
    param: null,
    back: [],
    role: "field",
    offline: false,
    query: "",
    filter: null,
    disambiguate: false,
    tab: "history",
    cart: [],
    returnLines: [],
    transferLines: [],
    formError: "",
    addError: "",
    actionError: "",
    result: null, // { kind: 'ok'|'queued', title, message, backLabel, backTo }
    dialog: null, // { type, ... }
    horizon: 30,
    currentOnly: false,
    identityOpen: false,
    toast: null,
    txn: 140,
  };

  let db = AMS.buildDb();

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmt(s, v) {
    return s.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? "{" + k + "}" : v[k]));
  }

  function user() {
    return AMS.USERS[state.role];
  }

  function isAdmin() {
    return user().admin;
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

  function isIncomplete(id) {
    return /^TMP-/.test(id);
  }

  function nextTxn() {
    state.txn += 1;
    return "TXN-" + state.txn;
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

  function pill(status) {
    const label = AMS.STATUS_LABEL[status] || status;
    return `<span class="pill pill-${esc(status)}">${esc(label)}</span>`;
  }

  function assetRow(a, opts = {}) {
    const od = isOverdue(a);
    const overdueDays = od ? daysBetween(a.nextcal, AMS.TODAY) : 0;
    return `
      <button type="button" class="asset-row" data-go="S03" data-param="${esc(a.id)}">
        <div class="id-line">
          <span class="asset-id">${esc(a.id)}${isIncomplete(a.id) ? ' <span class="badge-temp">Temp</span>' : ""}</span>
          <span class="row" style="gap:6px">
            ${a.pending ? '<span class="badge-pending">Pending sync</span>' : ""}
            ${pill(a.status)}
          </span>
        </div>
        <div class="asset-model">${esc(a.mfr + " " + a.model)}</div>
        <div class="asset-meta">
          <span>${esc(a.loc || a.office || "—")}</span>
          <span>${esc(a.cust || "")}</span>
        </div>
        ${od ? `<div class="asset-overdue">${esc(fmt("{days} days overdue", { days: overdueDays }))}</div>` : ""}
        ${opts.extra || ""}
      </button>`;
  }

  function msg(kind, text) {
    return `<div class="msg msg-${kind}">${esc(text)}</div>`;
  }

  function allowedActions(status) {
    return AMS.ACTION_MATRIX[status] || [];
  }

  function actionEnabled(key, asset) {
    const allowed = allowedActions(asset.status);
    if (!allowed.includes(key)) return false;
    if ((key === "sendCal" || key === "recordCal" || key === "retire") && !isAdmin()) return false;
    return true;
  }

  /* ---------- routing ---------- */
  function hashFor(screen, param) {
    const p = param ? encodeURIComponent(param) : "";
    const map = {
      S01: "#/",
      S03: "#/asset/" + p,
      S04: "#/checkout",
      S05: "#/return",
      S06: "#/transfer",
      S07: "#/calibration",
      S08: "#/sites",
      S09: "#/site/" + p,
      S10: "#/deploy",
      S11: "#/recover/" + p,
      S13: "#/admin",
      S14: "#/admin/new-asset",
      S15: "#/admin/office-admins",
      S16: "#/needs-attention",
      S17: "#/reports",
      S18: "#/reports/compliance",
      S19: "#/reports/timeline/" + p,
      S20: "#/reports/utilisation",
      S21: "#/settings",
      S22: "#/more",
    };
    return map[screen] || "#/";
  }

  function parseHash() {
    const h = (location.hash || "#/").replace(/^#/, "") || "/";
    const map = [
      [/^\/$/, "S01"],
      [/^\/asset\/(.+)$/, "S03"],
      [/^\/checkout$/, "S04"],
      [/^\/return$/, "S05"],
      [/^\/transfer$/, "S06"],
      [/^\/calibration$/, "S07"],
      [/^\/sites$/, "S08"],
      [/^\/site\/(.+)$/, "S09"],
      [/^\/deploy$/, "S10"],
      [/^\/recover\/(.+)$/, "S11"],
      [/^\/admin$/, "S13"],
      [/^\/admin\/new-asset$/, "S14"],
      [/^\/admin\/office-admins$/, "S15"],
      [/^\/needs-attention$/, "S16"],
      [/^\/reports$/, "S17"],
      [/^\/reports\/compliance$/, "S18"],
      [/^\/reports\/timeline\/(.+)$/, "S19"],
      [/^\/reports\/utilisation$/, "S20"],
      [/^\/settings$/, "S21"],
      [/^\/more$/, "S22"],
    ];
    for (const [re, screen] of map) {
      const m = re.exec(h);
      if (m) return { screen, param: m[1] ? decodeURIComponent(m[1]) : null };
    }
    return { screen: "S01", param: null };
  }

  function go(screen, param, extra) {
    if (state.screen !== screen || state.param !== (param || null)) {
      state.back = [...state.back, { screen: state.screen, param: state.param }].slice(-10);
    }
    Object.assign(state, {
      screen,
      param: param || null,
      dialog: null,
      result: null,
      formError: "",
      addError: "",
      actionError: "",
      identityOpen: false,
    }, extra || {});
    if (screen === "S04" && param) ensureCart(param);
    if (screen === "S05") seedReturn(param);
    if (screen === "S06" && param) state.transferLines = [{ id: param }];
    location.hash = hashFor(screen, param);
    render();
  }

  function goBack() {
    const prev = state.back.pop() || { screen: "S01", param: null };
    state.screen = prev.screen;
    state.param = prev.param;
    state.dialog = null;
    state.result = null;
    state.identityOpen = false;
    location.hash = hashFor(prev.screen, prev.param);
    render();
  }

  function applyHashFromBar() {
    const parsed = parseHash();
    state.screen = parsed.screen;
    state.param = parsed.param;
    state.dialog = null;
    state.result = null;
    render();
  }

  function ensureCart(assetId) {
    if (!state.cart.some((c) => c.id === assetId)) {
      state.cart = [{ id: assetId, primary: true }, ...state.cart.map((c) => ({ ...c, primary: false }))];
    }
  }

  function seedReturn(assetId) {
    const me = user().upn;
    let lines = db.assets
      .filter((a) => a.cust === me && (a.status === "CheckedOut" || a.status === "Deployed"))
      .map((a) => ({ id: a.id, condition: "Good" }));
    if (assetId && !lines.some((l) => l.id === assetId)) {
      lines = [{ id: assetId, condition: "Good" }, ...lines];
    }
    state.returnLines = lines;
  }

  function showResult(kind, message, backLabel, backTo) {
    state.result = { kind, message, backLabel: backLabel || "Back", backTo: backTo || null };
    state.dialog = null;
    render();
  }

  function submitWrite(okMessage, mutateFn) {
    const meta = { backLabel: "Back", backTo: null, queueAssets: [] };
    if (state.offline) {
      mutateFn && mutateFn(true, meta);
      const ids = meta.queueAssets.length
        ? meta.queueAssets
        : (state.cart.length ? state.cart : state.returnLines).map((x) => x.id).filter(Boolean);
      ids.forEach((id) => {
        const a = find(id);
        if (a) a.pending = true;
      });
      db.queue.unshift({
        id: "Q-" + Date.now().toString().slice(-4),
        kind: state.screen === "S04" ? "Checkout" : state.screen === "S05" ? "Return" : state.screen === "S06" ? "Transfer" : state.screen === "S10" ? "Deploy" : state.screen === "S11" ? "Recover" : "Write",
        assets: ids.length ? ids : ["—"],
        at: "Just now",
        state: "pending",
        reason: null,
      });
      showResult("queued", "No connection — queued. It will send automatically when you're back online.", meta.backLabel, meta.backTo);
      return;
    }
    mutateFn && mutateFn(false, meta);
    showResult("ok", okMessage, meta.backLabel, meta.backTo);
  }

  /* ---------- screen titles ---------- */
  function pageTitle() {
    const titles = {
      S03: state.param || "Asset",
      S04: "Checkout",
      S05: "Return",
      S06: "Transfer",
      S07: "Calibration due",
      S08: "Sites",
      S09: state.param || "Site",
      S10: "Deploy",
      S11: "Recover",
      S13: "Admin",
      S14: "New asset",
      S15: "Office administrators",
      S16: "Needs attention",
      S17: "Reports",
      S18: "Calibration compliance",
      S19: "Asset timeline",
      S20: "Utilisation",
      S21: "Settings",
      S22: "More",
    };
    return titles[state.screen] || "";
  }

  function showPageHeader() {
    return !ROOT_SCREENS.has(state.screen) || state.screen === "S13";
  }

  /* ---------- screens ---------- */
  function renderS01() {
    const q = state.query.trim();
    let body = "";

    if (state.offline) {
      body += msg("warn", "Showing cached data from 2:14 PM.");
    }

    body += `
      <div class="row" style="gap:8px">
        <input class="input grow" id="search-input" type="search" placeholder="Search Asset ID, serial, or model…" value="${esc(state.query)}" autocomplete="off">
        <button type="button" class="btn" data-action="open-scan">Scan</button>
      </div>
      <div class="chips">
        ${chip("my", "My equipment")}
        ${chip("avail", "Available here")}
        ${chip("cal", "Cal due ≤ 30d")}
      </div>`;

    function chip(key, label) {
      return `<button type="button" class="chip ${state.filter === key ? "active" : ""}" data-action="filter" data-filter="${key}">${label}</button>`;
    }

    let results = [];
    if (state.disambiguate && q.toUpperCase() === "UM16984") {
      body += msg("info", "That serial matches more than one asset — pick one.");
      results = db.assets.filter((a) => a.serial === "UM16984");
    } else if (state.filter === "my") {
      results = db.assets.filter((a) => a.cust === user().upn);
    } else if (state.filter === "avail") {
      results = db.assets.filter((a) => a.status === "Available" && a.office === user().office);
    } else if (state.filter === "cal") {
      results = db.assets.filter((a) => a.nextcal && daysBetween(AMS.TODAY, a.nextcal) <= 30 && a.nextcal >= AMS.TODAY || isOverdue(a));
    } else if (q.length > 0 && q.length < 3) {
      body += `<div class="idle-hint">Type at least 3 characters to search.</div>`;
    } else if (q.length >= 3) {
      const qq = q.toLowerCase();
      results = db.assets.filter(
        (a) =>
          a.id.toLowerCase().includes(qq) ||
          (a.serial && a.serial.toLowerCase().includes(qq)) ||
          (a.model && a.model.toLowerCase().includes(qq)) ||
          (a.mfr && a.mfr.toLowerCase().includes(qq))
      );
    }

    if (!state.filter && q.length < 3 && !state.disambiguate) {
      body += `<div class="idle-hint">Search an Asset ID, serial or model, or use a quick filter.<br><br>Try <strong>DL-UM</strong>, <strong>UM16984</strong>, or <strong>Instantel</strong>.</div>`;
    } else if (results.length === 0 && (state.filter || q.length >= 3)) {
      body += `<div class="empty">Nothing matched "${esc(q || state.filter)}".
        ${q ? `<div style="margin-top:12px"><button type="button" class="btn-secondary btn" data-action="search-model">Search by model instead</button></div>` : ""}
      </div>`;
    } else if (results.length) {
      const groups = {};
      results.forEach((a) => {
        const g = AMS.TYPE_LABEL[a.type] || a.type;
        (groups[g] = groups[g] || []).push(a);
      });
      Object.keys(groups)
        .sort()
        .forEach((g) => {
          body += `<div class="group-head"><span>${esc(g)}</span><span class="count">${groups[g].length}</span></div>`;
          groups[g].forEach((a) => {
            body += assetRow(a);
          });
        });
    }

    return `<div class="main-pad">${body}</div>`;
  }

  function renderS03() {
    const a = find(state.param);
    if (!a) return `<div class="main-pad"><div class="empty">No asset found for "${esc(state.param)}".</div></div>`;

    const od = isOverdue(a);
    let body = `
      <div class="row wrap" style="justify-content:space-between;margin-bottom:4px">
        <span class="asset-id" style="font-size:18px">${esc(a.id)}</span>
        <span class="row" style="gap:6px">
          ${a.pending ? '<span class="badge-pending">Pending sync</span>' : ""}
          ${od ? '<span class="badge-overdue">OVERDUE</span>' : ""}
          ${isIncomplete(a.id) ? '<span class="badge-temp">Temporary tag</span>' : ""}
          ${pill(a.status)}
        </span>
      </div>
      <div style="font-size:14px;margin-bottom:12px">${esc(a.mfr + " " + a.model)} · ${esc(AMS.TYPE_LABEL[a.type] || a.type)}</div>
      ${state.actionError ? msg("error", state.actionError) : ""}
      <div class="section-label">Now</div>
      <div class="now-grid">
        ${nowCell("Location", a.loc || "—")}
        ${nowCell("Home office", a.office)}
        ${nowCell("Custodian", a.cust || (a.status === "CheckedOut" ? "Unknown — not yet returned in the pilot sweep" : "—"))}
        ${nowCell("Project", a.proj || "—")}
        ${nowCell("Parent asset", a.parent || "—", true)}
        ${nowCell("Next calibration due", a.nextcal || "—")}
        ${nowCell("Last calibrated", a.lastcal || "—")}
        ${nowCell("Attached items", (a.children && a.children.length ? a.children.join(", ") : "—"), true)}
      </div>`;

    function nowCell(label, value, mono) {
      return `<div class="now-cell"><span class="now-label">${esc(label)}</span><span class="now-value ${mono ? "mono" : ""}">${esc(value)}</span></div>`;
    }

    const installs = db.installations.filter((i) => !i.end && i.components.some((c) => c.asset === a.id));
    if (installs.length) {
      body += `<div class="section-label">Current installation</div>`;
      installs.forEach((i) => {
        body += `<button type="button" class="link-row" data-go="S09" data-param="${esc(i.site)}">
          <span>${esc(i.sitename)}</span><span class="meta">${esc(i.project)}</span><span class="chev">›</span>
        </button>`;
      });
    }

    const keys = [
      ["checkout", "Checkout", "S04"],
      ["return", "Return", "S05"],
      ["transfer", "Transfer", "S06"],
      ["fault", "Report fault", "dialog:fault"],
      ["missing", "Mark missing", "dialog:missing"],
      ["found", "Mark found", "immediate:found"],
      ["repair", "Repair complete", "immediate:repair"],
      ["sendCal", "Send to calibration", "dialog:sendCal"],
      ["recordCal", "Record calibration", "dialog:recordCal"],
      ["retire", "Retire", "dialog:retire"],
    ];

    body += `<div class="actions">`;
    keys.forEach(([key, label, act]) => {
      const enabled = actionEnabled(key, a);
      const danger = key === "retire" ? " btn-danger-outline" : key === "checkout" || key === "return" ? "" : " btn-secondary";
      const title = enabled ? "" : ` title="Not available from ${AMS.STATUS_LABEL[a.status] || a.status}"`;
      body += `<button type="button" class="btn${danger}" data-action="asset-act" data-act="${act}" data-key="${key}" ${enabled ? "" : "disabled"}${title}>${label}</button>`;
    });
    body += `</div>`;

    if (isAdmin() && a.sim) {
      body += `
        <div class="card">
          <div class="card-title">SIM <span class="badge-temp" style="margin-left:6px">Office Admin and System Owner only</span></div>
          <div class="now-grid" style="margin-top:8px">
            ${nowCell("ICCID", a.sim.iccid, true)}
            ${nowCell("Phone number", a.sim.phone)}
            ${nowCell("Static IP", a.sim.ip, true)}
            ${nowCell("Carrier", a.sim.carrier)}
          </div>
        </div>`;
    }

    body += `
      <div class="tabs">
        <button type="button" class="tab ${state.tab === "history" ? "active" : ""}" data-action="tab" data-tab="history">History</button>
        <button type="button" class="tab ${state.tab === "calibration" ? "active" : ""}" data-action="tab" data-tab="calibration">Calibration</button>
      </div>`;

    if (state.tab === "history") {
      const hist = db.history[a.id] || [];
      if (!hist.length) body += `<div class="empty">No history yet.</div>`;
      else
        hist.forEach((h) => {
          body += `<div class="hist-line">
            <div class="when">${esc(h.date)}</div>
            <div><span class="type">${esc(h.type)}</span> · ${esc(AMS.STATUS_LABEL[h.before] || h.before)} → ${esc(AMS.STATUS_LABEL[h.after] || h.after)}${esc(h.extra || "")}</div>
            <div class="when">by ${esc(h.by)}</div>
          </div>`;
        });
    } else {
      const cals = db.cals[a.id] || [];
      if (!cals.length) body += `<div class="empty">No calibration records.</div>`;
      else
        cals.forEach((c) => {
          body += `<div class="hist-line">
            <div><strong>${esc(c.date)}</strong> → due ${esc(c.due)} · ${esc(c.lab)}</div>
            ${c.cert ? `<button type="button" class="btn-ghost btn" data-action="toast" data-msg="Certificate download is stubbed in this prototype.">Open certificate</button>` : ""}
          </div>`;
        });
    }

    return `<div class="main-pad">${body}</div>`;
  }

  function renderCartForm(kind) {
    if (state.result) return renderResult();

    let body = "";
    if (kind === "return") {
      body += `<p class="hint" style="font-size:13px;color:var(--fg3);margin:0 0 12px">Prefilled with everything you're holding.</p>`;
      body += `<p style="font-size:13px;margin:0 0 12px"><strong>Return location</strong> · ${esc(user().office)}</p>`;
    }

    if (kind === "checkout" || kind === "transfer") {
      body += `
        <div class="row" style="margin-bottom:12px">
          <input class="input grow" id="add-asset" placeholder="Asset ID…" autocomplete="off">
          <button type="button" class="btn-icon" data-action="open-scan" aria-label="Scan" title="Scan">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2.6 5.6V3.4a.8.8 0 0 1 .8-.8h2.2M13.4 5.6V3.4a.8.8 0 0 0-.8-.8h-2.2M2.6 10.4v2.2a.8.8 0 0 0 .8.8h2.2M13.4 10.4v2.2a.8.8 0 0 1-.8.8h-2.2M4 8h8" fill="none" stroke="currentColor" stroke-width="1.35"/></svg>
          </button>
          <button type="button" class="btn" data-action="add-to-cart">Add</button>
        </div>
        ${state.addError ? msg("error", state.addError) : ""}`;
    }

    if (state.formError) body += msg("error", state.formError);

    const lines = kind === "return" ? state.returnLines : kind === "transfer" ? state.transferLines : state.cart;
    if (!lines.length) {
      body += `<div class="empty">Add assets by scanning or searching.</div>`;
    } else {
      body += `<div class="section-label">Cart</div>`;
      lines.forEach((line, idx) => {
        const a = find(line.id);
        body += `<div class="cart-line">
          <div class="cart-line-top">
            <span class="asset-id">${esc(line.id)}</span>
            ${kind === "checkout" && line.primary ? '<span class="primary-badge">Primary</span>' : ""}
            ${a ? pill(a.status) : ""}
            <button type="button" class="btn-ghost btn" style="margin-left:auto" data-action="remove-line" data-kind="${kind}" data-idx="${idx}">Remove</button>
          </div>
          ${a ? `<div style="font-size:12px;color:var(--fg3)">${esc(a.mfr + " " + a.model)}</div>` : ""}
          ${kind === "return" ? `
            <div class="field" style="margin:0">
              <label>Condition</label>
              <select class="select" data-action="set-condition" data-idx="${idx}">
                <option ${line.condition === "Good" ? "selected" : ""}>Good</option>
                <option ${line.condition === "Damaged" ? "selected" : ""}>Damaged</option>
                <option ${line.condition === "Needs service" ? "selected" : ""}>Needs service</option>
              </select>
            </div>` : ""}
        </div>`;
      });
    }

    if (kind === "checkout") {
      body += `
        <div class="field"><label>Project *</label>
          <select class="select" id="f-project">
            <option value="">Select project…</option>
            ${AMS.PROJECTS.filter((p) => p.active).map((p) => `<option value="${esc(p.id)}">${esc(p.id)} — ${esc(p.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Assigned to</label>
          <div class="row"><span class="grow" style="font-size:13px">${esc(user().name)} — ${esc(user().upn)}</span>
          <button type="button" class="btn-ghost btn" data-action="toast" data-msg="People picker is stubbed — stays assigned to you.">Change</button></div>
        </div>
        <div class="field"><label>Expected return (optional)</label>
          <input class="input" type="date" id="f-expected" value="2026-09-17">
        </div>
        <div class="field"><label>Notes</label><textarea class="textarea" id="f-notes" rows="3"></textarea></div>`;
    }

    if (kind === "transfer") {
      body += `
        <div class="field"><label>New custodian</label>
          <select class="select" id="f-custodian">
            <option value="">Leave unchanged</option>
            ${AMS.PEOPLE.map((p) => `<option value="${esc(p.upn)}">${esc(p.name)} — ${esc(p.upn)}</option>`).join("")}
          </select>
          <span class="hint">Picked from the directory — leave blank to leave unchanged.</span>
        </div>
        <div class="field"><label>New location</label>
          <select class="select" id="f-location">
            <option value="">Leave unchanged</option>
            ${AMS.OFFICES.map((o) => `<option>${esc(o)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>New project</label>
          <select class="select" id="f-project">
            <option value="">Leave unchanged</option>
            ${AMS.PROJECTS.filter((p) => p.active).map((p) => `<option value="${esc(p.id)}">${esc(p.id)} — ${esc(p.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Reason *</label>
          <input class="input" id="f-reason" placeholder="Reason for transfer">
        </div>`;
    }

    body += `<button type="button" class="btn btn-block" style="margin-top:16px" data-action="submit-${kind}" ${lines.length ? "" : "disabled"}>Submit</button>`;
    return `<div class="main-pad">${body}</div>`;
  }

  function renderResult() {
    const r = state.result;
    const kind = r.kind === "queued" ? "warn" : "ok";
    return `<div class="result-block">
      ${msg(kind, r.message)}
      <button type="button" class="btn btn-block" data-action="result-back">${esc(r.backLabel)}</button>
    </div>`;
  }

  function renderS07() {
    const horizon = state.horizon;
    const due = db.assets.filter((a) => a.nextcal).filter((a) => {
      if (isOverdue(a)) return true;
      return daysBetween(AMS.TODAY, a.nextcal) <= horizon;
    });
    const overdue = due.filter(isOverdue);
    const soon = due.filter((a) => !isOverdue(a));

    let body = `
      <div class="chips">
        ${[30, 60, 90].map((d) => `<button type="button" class="chip ${horizon === d ? "active" : ""}" data-action="horizon" data-days="${d}">${d} days</button>`).join("")}
      </div>`;

    if (!due.length) {
      body += `<div class="empty">${esc(fmt("Nothing is due within {days} days.", { days: horizon }))}</div>`;
    } else {
      if (overdue.length) {
        body += `<div class="group-head"><span>Overdue</span><span class="count">${overdue.length}</span></div>`;
        overdue.forEach((a) => {
          body += assetRow(a, { extra: `<div class="asset-overdue">${esc(fmt("{days} days overdue", { days: daysBetween(a.nextcal, AMS.TODAY) }))}</div>` });
        });
      }
      if (soon.length) {
        body += `<div class="group-head"><span>Due within ${horizon} days</span><span class="count">${soon.length}</span></div>`;
        soon.forEach((a) => {
          body += assetRow(a, { extra: `<div style="font-size:12px;color:var(--fg3)">Due ${esc(a.nextcal)}</div>` });
        });
      }
    }
    return `<div class="main-pad">${body}</div>`;
  }

  function renderS08() {
    const sites = {};
    db.installations.forEach((i) => {
      if (!sites[i.site]) sites[i.site] = { key: i.site, name: i.sitename, current: 0, past: 0 };
      if (i.end) sites[i.site].past += 1;
      else sites[i.site].current += 1;
    });
    let list = Object.values(sites);
    if (state.currentOnly) list = list.filter((s) => s.current > 0);

    let body = `
      <button type="button" class="btn btn-block" style="margin-bottom:12px" data-go="S10">Deploy</button>
      <label class="row" style="gap:8px;margin-bottom:12px;font-size:13px">
        <input type="checkbox" ${state.currentOnly ? "checked" : ""} data-action="toggle-current"> Currently installed only
      </label>`;

    if (!list.length) body += `<div class="empty">No sites yet.</div>`;
    else {
      body += `<div class="link-list">`;
      list.forEach((s) => {
        body += `<button type="button" class="link-row" data-go="S09" data-param="${esc(s.key)}">
          <span>${esc(s.name)}</span>
          <span class="meta">${s.current} current · ${s.past} past</span>
          <span class="chev">›</span>
        </button>`;
      });
      body += `</div>`;
    }
    return `<div class="main-pad">${body}</div>`;
  }

  function renderS09() {
    const siteKey = state.param;
    const installs = db.installations.filter((i) => i.site === siteKey);
    if (!installs.length) return `<div class="main-pad"><div class="empty">Unknown site.</div></div>`;
    const name = installs[0].sitename;
    const current = installs.filter((i) => !i.end);
    const past = installs.filter((i) => i.end);

    let body = `
      <div style="font-size:18px;font-weight:600;margin-bottom:4px">${esc(name)}</div>
      <div style="font-size:12px;color:var(--fg3);font-family:var(--mono);margin-bottom:12px">${esc(siteKey)}</div>
      <div class="row" style="gap:8px;margin-bottom:16px">
        <button type="button" class="btn grow" data-go="S10" data-param="${esc(siteKey)}">Deploy here</button>
      </div>`;

    body += `<div class="section-label">Current installation</div>`;
    if (!current.length) body += `<div class="empty" style="padding:16px">None currently installed.</div>`;
    current.forEach((i) => {
      body += `<div class="card">
        <div class="card-title">${esc(i.project)} · since ${esc(i.start)}</div>
        <div class="card-caption">${esc(i.position)} · ${esc(i.power)} · ${esc(i.lat)}, ${esc(i.lon)}</div>
        ${i.components
          .map((c) => {
            const a = find(c.asset);
            return `<button type="button" class="asset-row" data-go="S03" data-param="${esc(c.asset)}" style="padding-left:0;padding-right:0">
              <div class="id-line"><span class="asset-id">${esc(c.asset)}</span>${a ? pill(a.status) : ""}</div>
              <div class="asset-meta"><span>${esc(c.role)}${c.orientation ? " · " + esc(c.orientation) : ""}</span></div>
            </button>`;
          })
          .join("")}
        <button type="button" class="btn btn-block" style="margin-top:8px" data-go="S11" data-param="${esc(i.id)}">Recover</button>
      </div>`;
    });

    if (past.length) {
      body += `<div class="section-label">Past installations</div>`;
      past.forEach((i) => {
        body += `<div class="hist-line"><strong>${esc(i.start)} → ${esc(i.end)}</strong> · ${esc(i.project)} <span class="badge-temp">closed</span></div>`;
      });
    }
    return `<div class="main-pad">${body}</div>`;
  }

  function renderS10() {
    if (state.result) return renderResult();
    const prefillSite = state.param && state.param !== "new" ? state.param : "";
    let body = `
      ${state.formError ? msg("error", state.formError) : ""}
      <div class="field"><label>Project *</label>
        <select class="select" id="f-project">
          <option value="">Select…</option>
          ${AMS.PROJECTS.filter((p) => p.active).map((p) => `<option value="${esc(p.id)}">${esc(p.id)} — ${esc(p.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>Primary data logger *</label>
        <div class="row">
          <input class="input grow" id="f-primary" placeholder="DL-…">
          <button type="button" class="btn" data-action="toast" data-msg="Pick logger: type an Available logger you hold, e.g. DL-UM-16984 after checkout.">Pick logger</button>
        </div>
      </div>
      <div class="field"><label>Add component</label>
        <div class="row">
          <input class="input grow" id="f-comp" placeholder="GEO-… / MOD-…">
          <button type="button" class="btn-secondary btn" data-action="toast" data-msg="Component lines are illustrative in this prototype.">Add</button>
        </div>
      </div>
      <div class="field"><label>Site</label>
        <select class="select" id="f-site">
          <option value="new">New site</option>
          ${[...new Set(db.installations.map((i) => i.site))]
            .map((s) => `<option value="${esc(s)}" ${prefillSite === s ? "selected" : ""}>${esc(s)}</option>`)
            .join("")}
        </select>
      </div>
      <div class="field"><label>Site name</label><input class="input" id="f-sitename" value="${esc(prefillSite ? (db.installations.find((i) => i.site === prefillSite) || {}).sitename || "" : "")}"></div>
      <div class="field"><label>Position</label><input class="input" id="f-position" placeholder="e.g. POR-403"></div>
      <div class="row" style="gap:8px">
        <div class="field grow"><label>Latitude</label><input class="input" id="f-lat" placeholder="45.42"></div>
        <div class="field grow"><label>Longitude</label><input class="input" id="f-lon" placeholder="-75.69"></div>
      </div>
      <button type="button" class="btn-ghost btn" style="margin-bottom:12px" data-action="use-location">Use device location</button>
      <div class="field"><label>Power source</label>
        <select class="select" id="f-power"><option>Battery</option><option>Solar</option><option>AC</option><option>External</option></select>
      </div>
      <div class="field"><label>Deployment date</label><input class="input" type="date" id="f-date" value="${AMS.TODAY}"></div>
      <div class="field"><label>Notes</label><textarea class="textarea" id="f-notes" rows="2"></textarea></div>
      <button type="button" class="btn btn-block" data-action="submit-deploy">Submit</button>`;
    return `<div class="main-pad">${body}</div>`;
  }

  function renderS11() {
    if (state.result) return renderResult();
    const inst = db.installations.find((i) => i.id === state.param);
    if (!inst) return `<div class="main-pad"><div class="empty">Installation not found.</div></div>`;

    let body = `
      ${state.formError ? msg("error", state.formError) : ""}
      <div class="card">
        <div class="card-title">${esc(inst.sitename)}</div>
        <div class="card-caption">${esc(inst.project)} · since ${esc(inst.start)}</div>
        ${inst.components.map((c) => `<div class="hist-line"><span class="asset-id">${esc(c.asset)}</span> · ${esc(c.role)}</div>`).join("")}
      </div>
      <div class="field"><label>Disposition</label>
        <select class="select" id="f-disp"><option>Recovered</option><option>Missing</option></select>
      </div>
      <div class="field"><label>Condition</label>
        <select class="select" id="f-cond"><option>Good</option><option>Damaged</option><option>Needs service</option></select>
      </div>
      <div class="field"><label>Recovery date</label><input class="input" type="date" id="f-date" value="${AMS.TODAY}"></div>
      <button type="button" class="btn btn-block" data-action="submit-recover">Submit</button>`;
    return `<div class="main-pad">${body}</div>`;
  }

  function renderS13() {
    const temps = db.assets.filter((a) => isIncomplete(a.id));
    const sweep = db.assets.filter((a) => a.status === "CheckedOut" && !a.cust);
    const attn = db.queue.filter((q) => q.state === "rejected" || q.state === "pending").length;

    return `<div class="main-pad">
      <div class="card">
        <div class="card-title">New asset</div>
        <div class="card-caption">Register equipment from the model catalogue. The Asset ID is minted for you.</div>
        <button type="button" class="btn" data-go="S14">New asset</button>
      </div>
      <div class="link-list">
        <button type="button" class="link-row" data-go="S17"><span>Reports</span><span class="chev">›</span></button>
        <button type="button" class="link-row" data-go="S15"><span>Office administrators</span><span class="chev">›</span></button>
        <button type="button" class="link-row" data-go="S16"><span>Needs attention</span><span class="meta">${attn || ""}</span><span class="chev">›</span></button>
        <button type="button" class="link-row" data-go="S21"><span>Settings</span><span class="chev">›</span></button>
      </div>
      <div class="card">
        <div class="card-title">Tags to finish</div>
        <div class="card-caption">Assets tagged in the field with a temporary ID, or with no home office yet.</div>
        ${temps.length ? temps.map((a) => assetRow(a)).join("") : '<div class="empty" style="padding:8px">None.</div>'}
      </div>
      <div class="card">
        <div class="card-title">Return sweep</div>
        <div class="card-caption">Assets that came across as checked out with nobody named.</div>
        ${sweep.length ? sweep.map((a) => assetRow(a)).join("") : '<div class="empty" style="padding:8px">None.</div>'}
      </div>
    </div>`;
  }

  function renderS14() {
    if (state.result) return renderResult();
    return `<div class="main-pad">
      ${state.formError ? msg("error", state.formError) : ""}
      <p style="font-size:13px;color:var(--fg3);margin:0 0 12px">Register a piece of equipment from the model catalogue. The Asset ID is minted for you.</p>
      <div class="field"><label>Model *</label>
        <select class="select" id="f-model">
          <option value="">Pick a model…</option>
          <option value="UM">Instantel Minimate Plus</option>
          <option value="MP">Instantel Minimate Pro</option>
          <option value="V12">Instantel Geophone V12</option>
          <option value="S50">Norsonic Nor140 / S50</option>
        </select>
        <span class="hint">Pick a model from the catalogue — there is no free-text option.</span>
      </div>
      <div class="field"><label>Serial number</label><input class="input" id="f-serial"></div>
      <div class="field"><label>Home office *</label>
        <select class="select" id="f-office">
          <option value="">Pick…</option>
          ${AMS.OFFICES.map((o) => `<option>${esc(o)}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>Notes</label><textarea class="textarea" id="f-notes" rows="2"></textarea></div>
      <button type="button" class="btn btn-block" data-action="submit-new-asset">Save</button>
    </div>`;
  }

  function renderS15() {
    let body = "";
    AMS.OFFICES.forEach((o) => {
      const list = db.admins[o] || [];
      body += `<div class="card">
        <div class="card-title">${esc(o)}</div>
        ${list.length ? list.map((u) => `<div class="hist-line">${esc(u)}</div>`).join("") : '<div class="msg msg-warn" style="margin:8px 0">No administrator assigned</div>'}
        <div class="row" style="margin-top:8px">
          <select class="select grow" id="add-${esc(o)}">
            <option value="">Pick a person…</option>
            ${AMS.PEOPLE.map((p) => `<option value="${esc(p.upn)}">${esc(p.name)} — ${esc(p.upn)}</option>`).join("")}
          </select>
          <button type="button" class="btn" data-action="add-admin" data-office="${esc(o)}">Add</button>
        </div>
      </div>`;
    });
    return `<div class="main-pad">${body}</div>`;
  }

  function renderS16() {
    const pending = db.queue.filter((q) => q.state === "pending");
    const rejected = db.queue.filter((q) => q.state === "rejected");
    let body = "";
    if (!pending.length && !rejected.length) {
      body = `<div class="empty">Nothing needs attention.</div>`;
    } else {
      if (pending.length) {
        body += `<div class="section-label">Pending sync</div>`;
        pending.forEach((q) => {
          body += `<div class="card">
            <div class="card-title">${esc(q.kind)}</div>
            <div class="card-caption">Queued ${esc(q.at)} · ${esc(q.assets.join(", "))}</div>
            <span class="badge-pending">Pending sync</span>
          </div>`;
        });
      }
      if (rejected.length) {
        body += `<div class="section-label">Needs attention</div>`;
        body += msg("info", "Rejected submissions are never discarded — resolve or retry.");
        rejected.forEach((q) => {
          body += `<div class="card">
            <div class="card-title">${esc(q.kind)}</div>
            <div class="card-caption">Queued ${esc(q.at)} · ${esc(q.assets.join(", "))}</div>
            <div class="msg msg-error">${esc(q.reason)}</div>
            <button type="button" class="btn" data-action="retry-queue" data-id="${esc(q.id)}">Retry</button>
          </div>`;
        });
      }
    }
    return `<div class="main-pad">${body}</div>`;
  }

  function renderS17() {
    return `<div class="main-pad">
      <p style="font-size:12px;color:var(--fg3);margin:0 0 12px">Data as of 2:14 PM</p>
      <div class="link-list">
        <button type="button" class="link-row" data-go="S18"><span>Calibration compliance</span><span class="chev">›</span></button>
        <button type="button" class="link-row" data-go="S19" data-param="DL-UM-16984"><span>Asset timeline</span><span class="chev">›</span></button>
        <button type="button" class="link-row" data-go="S20"><span>Utilisation</span><span class="chev">›</span></button>
      </div>
      <p style="font-size:12px;color:var(--fg3);margin-top:16px">This is the in-app interim — governed export paths are stubbed.</p>
    </div>`;
  }

  function renderS18() {
    const overdue = db.assets.filter(isOverdue);
    const due = db.assets.filter((a) => a.nextcal && !isOverdue(a) && daysBetween(AMS.TODAY, a.nextcal) <= 30);
    const incal = db.assets.filter((a) => a.status === "InCalibration");
    return `<div class="main-pad">
      <div class="card"><div class="card-title">Calibration compliance</div>
        <div class="hist-line">Overdue: <strong>${overdue.length}</strong></div>
        <div class="hist-line">Due within 30 days: <strong>${due.length}</strong></div>
        <div class="hist-line">In calibration: <strong>${incal.length}</strong></div>
      </div>
      ${overdue.map((a) => assetRow(a)).join("")}
      <button type="button" class="btn btn-secondary" style="margin-top:12px" data-action="toast" data-msg="Governed export is stubbed — would create a private short-lived artifact.">Export</button>
    </div>`;
  }

  function renderS19() {
    const id = state.param || "DL-UM-16984";
    const a = find(id);
    const hist = db.history[id] || [];
    return `<div class="main-pad">
      <div class="row" style="margin-bottom:12px;gap:8px">
        <span class="asset-id grow">${esc(id)}</span>
        ${a ? pill(a.status) : ""}
      </div>
      ${hist.length ? hist.map((h) => `<div class="hist-line"><div class="when">${esc(h.date)}</div><div><strong>${esc(h.type)}</strong> ${esc(h.before)} → ${esc(h.after)}${esc(h.extra || "")}</div></div>`).join("") : '<div class="empty">No timeline events.</div>'}
      <button type="button" class="btn btn-secondary" style="margin-top:12px" data-action="toast" data-msg="Timeline export is stubbed.">Export</button>
    </div>`;
  }

  function renderS20() {
    return `<div class="main-pad">
      <div class="chips">
        <button type="button" class="chip active">30 days</button>
        <button type="button" class="chip" data-action="toast" data-msg="Horizon switch is visual-only here.">90 days</button>
        <button type="button" class="chip" data-action="toast" data-msg="Horizon switch is visual-only here.">365 days</button>
      </div>
      <div class="card">
        <div class="card-title">Fleet availability</div>
        <div style="font-size:28px;font-weight:600;color:var(--brandFg)">72 %</div>
        <div class="card-caption">Illustrative figure for product thinking — not live analytics.</div>
      </div>
      <div class="empty">Lowest availability and idle lists are stubbed.</div>
    </div>`;
  }

  function renderS21() {
    return `<div class="main-pad">
      <div class="link-list">
        <button type="button" class="link-row" data-action="toast" data-msg="Language: English (stub). i18n keys exist in en.json."><span>Language</span><span class="meta">English</span><span class="chev">›</span></button>
        <button type="button" class="link-row" data-action="toggle-offline"><span>Offline / sync</span><span class="meta">${state.offline ? "Offline" : "Online"}</span><span class="chev">›</span></button>
        <button type="button" class="link-row" data-go="S16"><span>Needs attention</span><span class="chev">›</span></button>
        <button type="button" class="link-row" data-action="toast" data-msg="About: Englobe AMS mobile prototype · Field slice · not production."><span>About</span><span class="chev">›</span></button>
        <button type="button" class="link-row" data-action="toast" data-msg="Sign out is stubbed — no real session in this prototype."><span>Sign out</span><span class="chev">›</span></button>
      </div>
      <p style="font-size:12px;color:var(--fg3);margin-top:16px">Browser owns no business authority. Invalid transitions are refused by the API; this prototype only simulates feedback.</p>
    </div>`;
  }

  function renderS22() {
    const attn = db.queue.length;
    return `<div class="main-pad">
      <div class="link-list">
        <button type="button" class="link-row" data-go="S16"><span>Needs attention</span><span class="meta">${attn}</span><span class="chev">›</span></button>
        <button type="button" class="link-row" data-go="S17"><span>Reports</span><span class="chev">›</span></button>
        <button type="button" class="link-row" data-go="S21"><span>Settings</span><span class="chev">›</span></button>
      </div>
      <p style="font-size:12px;color:var(--fg3);margin-top:12px">Field Users reach these via More (mockup G-06 proposal).</p>
    </div>`;
  }

  function renderMain() {
    if (state.result && ["S04", "S05", "S06", "S10", "S11", "S14"].includes(state.screen)) {
      return renderResult();
    }
    switch (state.screen) {
      case "S01": return renderS01();
      case "S03": return renderS03();
      case "S04": return renderCartForm("checkout");
      case "S05": return renderCartForm("return");
      case "S06": return renderCartForm("transfer");
      case "S07": return renderS07();
      case "S08": return renderS08();
      case "S09": return renderS09();
      case "S10": return renderS10();
      case "S11": return renderS11();
      case "S13": return renderS13();
      case "S14": return renderS14();
      case "S15": return renderS15();
      case "S16": return renderS16();
      case "S17": return renderS17();
      case "S18": return renderS18();
      case "S19": return renderS19();
      case "S20": return renderS20();
      case "S21": return renderS21();
      case "S22": return renderS22();
      default: return renderS01();
    }
  }

  /* ---------- shell overlays ---------- */
  function renderDialog() {
    const d = state.dialog;
    if (!d) return "";
    if (d.type === "scan") {
      return `<div class="scan-overlay" id="dialog-root">
        <div style="padding:16px;display:flex;justify-content:space-between;align-items:center">
          <strong>Scan a tag</strong>
          <button type="button" class="btn-ghost btn" style="color:#fff" data-action="close-dialog">Cancel</button>
        </div>
        <div class="scan-viewfinder"><span style="font-size:13px;opacity:.8;text-align:center">Point the camera at the tag on the instrument.<br>(Camera stub — type below)</span></div>
        <div class="scan-footer">
          <div class="field"><label style="color:#ccc">Asset ID or serial</label>
            <div class="row">
              <input class="input grow" id="scan-value" placeholder="DL-UM-16984" autofocus>
              <button type="button" class="btn" data-action="resolve-scan">Resolve</button>
            </div>
          </div>
        </div>
      </div>`;
    }

    if (d.type === "identity") {
      const u = user();
      return `<div class="overlay sheet" id="dialog-root">
        <div class="dialog" style="width:100%">
          <span class="sheet-handle"></span>
          <div class="row" style="gap:12px;margin-bottom:16px">
            <span class="avatar" style="width:40px;height:40px;font-size:14px">${esc(u.initials)}</span>
            <div>
              <div style="font-weight:600">${esc(u.name)}</div>
              <div style="font-size:12px;color:var(--fg3)">${esc(u.upn)}</div>
              <div style="font-size:12px;color:var(--fg3)">${esc(u.office)} · ${esc(u.roleLabel)}</div>
            </div>
          </div>
          <div class="link-list">
            <button type="button" class="link-row" data-go="S21" data-action="close-dialog"><span>Settings</span><span class="chev">›</span></button>
            ${isAdmin() ? '<button type="button" class="link-row" data-go="S13" data-action="close-dialog"><span>Admin</span><span class="chev">›</span></button>' : ""}
            <button type="button" class="link-row" data-go="S16" data-action="close-dialog"><span>Needs attention</span><span class="chev">›</span></button>
          </div>
          <div class="dialog-actions">
            <button type="button" class="btn" data-action="close-dialog">Close</button>
          </div>
        </div>
      </div>`;
    }

    if (d.type === "fault" || d.type === "missing") {
      const title = d.type === "fault" ? "Report fault" : "Mark missing";
      return `<div class="overlay" id="dialog-root"><div class="dialog">
        <div class="dialog-title">${title}</div>
        <div class="field"><label>Notes</label><textarea class="textarea" id="d-notes" rows="3"></textarea></div>
        <div class="dialog-actions">
          <button type="button" class="btn-secondary btn" data-action="close-dialog">Cancel</button>
          <button type="button" class="btn" data-action="confirm-fault">${title === "Report fault" ? "Confirm" : "Confirm"}</button>
        </div>
      </div></div>`;
    }

    if (d.type === "sendCal") {
      return `<div class="overlay" id="dialog-root"><div class="dialog">
        <div class="dialog-title">Send to calibration</div>
        <div class="field"><label>Lab *</label>
          <select class="select" id="d-lab"><option value="">Pick a calibration lab.</option>${AMS.LABS.map((l) => `<option>${esc(l)}</option>`).join("")}</select>
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn-secondary btn" data-action="close-dialog">Cancel</button>
          <button type="button" class="btn" data-action="confirm-send-cal">Confirm</button>
        </div>
      </div></div>`;
    }

    if (d.type === "recordCal") {
      const a = find(state.param);
      return `<div class="overlay" id="dialog-root"><div class="dialog">
        <div class="dialog-title">Record calibration</div>
        <div class="field"><label>Calibration date *</label><input class="input" type="date" id="d-date" value="${AMS.TODAY}" max="${AMS.TODAY}"></div>
        <div class="field"><label>Next due</label><input class="input" type="date" id="d-due"></div>
        <div class="field"><label>Lab</label><input class="input" id="d-lab" value="Montreal Calibration"></div>
        <div class="field"><label>Certificate number</label><input class="input" id="d-cert"></div>
        <div class="field"><label>Result</label>
          <select class="select" id="d-result"><option>—</option><option>Pass</option><option>Fail</option><option>Adjusted</option></select>
        </div>
        <div class="field"><label>Certificate (PDF)</label>
          <div style="border:1px dashed var(--stroke1);border-radius:4px;padding:12px;text-align:center">
            <button type="button" class="btn-secondary btn" data-action="toast" data-msg="File picker stubbed — private blob upload in production.">Choose file</button>
            <div style="font-size:12px;color:var(--fg3);margin-top:6px">Saved to AMS Documents/${esc(a ? a.id : "…")}/</div>
          </div>
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn-secondary btn" data-action="close-dialog">Cancel</button>
          <button type="button" class="btn" data-action="confirm-record-cal">Save</button>
        </div>
      </div></div>`;
    }

    if (d.type === "retire") {
      if (d.step === 2) {
        return `<div class="overlay" id="dialog-root"><div class="dialog">
          <div class="dialog-title">Retire asset</div>
          <p style="font-size:14px">${esc(fmt("Retire {assetId}? This cannot be undone from the app.", { assetId: state.param }))}</p>
          <div class="dialog-actions">
            <button type="button" class="btn-secondary btn" data-action="close-dialog">Cancel</button>
            <button type="button" class="btn btn-danger-outline" data-action="confirm-retire">Retire</button>
          </div>
        </div></div>`;
      }
      return `<div class="overlay" id="dialog-root"><div class="dialog">
        <div class="dialog-title">Retire asset</div>
        <div class="field"><label>Reason *</label>
          <select class="select" id="d-reason">
            <option value="">Select…</option>
            <option>Sold</option><option>Lost</option><option>Damaged</option><option>Obsolete</option>
          </select>
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn-secondary btn" data-action="close-dialog">Cancel</button>
          <button type="button" class="btn" data-action="retire-continue">Continue</button>
        </div>
      </div></div>`;
    }

    return "";
  }

  function renderNav() {
    const attn = db.queue.filter((q) => q.state === "rejected").length;
    const sixth = isAdmin()
      ? { screen: "S13", label: "Admin", icon: "admin" }
      : { screen: "S22", label: "More", icon: "more", badge: attn };

    const items = [
      { screen: "S01", label: "Search", icon: "search" },
      { screen: "S07", label: "Cal Due", icon: "cal" },
      { screen: "S04", label: "Checkout", icon: "out" },
      { screen: "S05", label: "Return", icon: "in" },
      { screen: "S08", label: "Sites", icon: "site" },
      sixth,
    ];

    const activeMap = {
      S01: "S01", S03: "S01",
      S07: "S07",
      S04: "S04", S06: "S04",
      S05: "S05",
      S08: "S08", S09: "S08", S10: "S08", S11: "S08",
      S13: "S13", S14: "S13", S15: "S13", S16: isAdmin() ? "S13" : "S22",
      S17: isAdmin() ? "S13" : "S22", S18: isAdmin() ? "S13" : "S22",
      S19: isAdmin() ? "S13" : "S22", S20: isAdmin() ? "S13" : "S22",
      S21: isAdmin() ? "S13" : "S22", S22: "S22",
    };
    const active = activeMap[state.screen] || "S01";

    const icons = {
      search: '<path d="M7 2.8a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4zM10.2 10.2 13.2 13.2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
      cal: '<path d="M3 4.2h10v9.2H3zM3 7h10M5.5 2.5v2.4M10.5 2.5v2.4" fill="none" stroke="currentColor" stroke-width="1.3"/>',
      out: '<path d="M2.5 6.2h9.2L9.3 3.6M13.5 9.8H4.3l2.4 2.6" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>',
      in: '<path d="M13.5 9.8H4.3l2.4-2.6M2.5 6.2h9.2L9.3 8.8" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>',
      site: '<path d="M8 1.8a4.6 4.6 0 0 1 4.6 4.6c0 3.4-4.6 7.8-4.6 7.8S3.4 9.8 3.4 6.4A4.6 4.6 0 0 1 8 1.8z" fill="none" stroke="currentColor" stroke-width="1.3"/>',
      admin: '<path d="M8 2.2 13 5v6L8 13.8 3 11V5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
      more: '<circle cx="3.4" cy="8" r="1.15" fill="currentColor"/><circle cx="8" cy="8" r="1.15" fill="currentColor"/><circle cx="12.6" cy="8" r="1.15" fill="currentColor"/>',
    };

    return items
      .map((it) => {
        const isActive = active === it.screen || (it.screen === "S13" && active === "S13");
        return `<button type="button" class="nav-item ${isActive ? "active" : ""}" data-go="${it.screen}">
          <svg viewBox="0 0 16 16" aria-hidden="true">${icons[it.icon]}</svg>
          ${esc(it.label)}
          ${it.badge ? `<span class="nav-badge">${it.badge}</span>` : ""}
        </button>`;
      })
      .join("");
  }

  /* ---------- render ---------- */
  function render() {
    const phone = $("#phone-app");
    if (!phone) return;

    const u = user();
    const attn = db.queue.filter((q) => q.state === "rejected").length;
    const showBack = showPageHeader() && state.screen !== "S01";

    $("#app-header-office").textContent = u.office;
    $("#app-avatar").textContent = u.initials;
    const badge = $("#app-avatar-badge");
    if (attn) {
      badge.hidden = false;
      badge.textContent = String(attn);
    } else badge.hidden = true;

    const ph = $("#page-header");
    if (showBack) {
      ph.classList.remove("hidden");
      $("#page-title").textContent = pageTitle();
    } else {
      ph.classList.add("hidden");
    }

    $("#main").innerHTML = renderMain();
    $("#bottom-nav").innerHTML = renderNav();

    const overlayHost = $("#overlay-host");
    overlayHost.innerHTML = renderDialog();

    const toastEl = $("#toast");
    if (state.toast) {
      toastEl.textContent = state.toast;
      toastEl.classList.add("show");
    } else {
      toastEl.classList.remove("show");
    }

    // Demo bar sync
    $$(".demo-role").forEach((b) => b.classList.toggle("on", b.dataset.role === state.role));
    $("#demo-offline") && $("#demo-offline").classList.toggle("on", state.offline);

    // Restore search focus caret roughly
    const si = $("#search-input");
    if (si && document.activeElement === si) {
      /* keep */
    }
  }

  /* ---------- events ---------- */
  function onClick(e) {
    const t = e.target.closest("[data-go],[data-action]");
    if (!t) return;

    if (t.hasAttribute("data-action") && t.dataset.action === "close-dialog") {
      /* fall through after close if also data-go */
    }

    const action = t.dataset.action;
    if (action) {
      handleAction(action, t, e);
      if (!t.hasAttribute("data-go") || action === "close-dialog") {
        if (action !== "close-dialog" || !t.hasAttribute("data-go")) return;
      }
    }

    if (t.hasAttribute("data-go")) {
      e.preventDefault();
      state.dialog = null;
      go(t.dataset.go, t.dataset.param || null);
    }
  }

  function handleAction(action, el, e) {
    e.preventDefault();
    switch (action) {
      case "open-scan":
        state.dialog = { type: "scan" };
        render();
        setTimeout(() => $("#scan-value") && $("#scan-value").focus(), 50);
        break;
      case "close-dialog":
        state.dialog = null;
        render();
        break;
      case "resolve-scan": {
        const v = ($("#scan-value") && $("#scan-value").value.trim()) || "";
        resolveCode(v);
        break;
      }
      case "filter": {
        const f = el.dataset.filter;
        state.filter = state.filter === f ? null : f;
        state.disambiguate = false;
        render();
        break;
      }
      case "search-model": {
        const first = state.query.trim().split(/\s+/)[0];
        state.query = first;
        state.filter = null;
        render();
        break;
      }
      case "tab":
        state.tab = el.dataset.tab;
        render();
        break;
      case "toast":
        toast(el.dataset.msg || "Not in this prototype.");
        break;
      case "open-identity":
        state.dialog = { type: "identity" };
        render();
        break;
      case "asset-act": {
        const act = el.dataset.act;
        const a = find(state.param);
        if (!a) break;
        if (act.startsWith("S")) {
          go(act, state.param);
        } else if (act.startsWith("dialog:")) {
          const type = act.split(":")[1];
          state.dialog = { type, step: 1 };
          render();
        } else if (act === "immediate:found") {
          a.status = "Available";
          a.loc = a.office;
          state.actionError = "";
          toast("Marked found (prototype — server would confirm).");
          render();
        } else if (act === "immediate:repair") {
          a.status = "Available";
          toast("Repair complete (prototype).");
          render();
        }
        break;
      }
      case "confirm-fault": {
        const a = find(state.param);
        if (a) {
          a.status = state.dialog.type === "missing" ? "Missing" : "NeedsRepair";
        }
        state.dialog = null;
        toast("Recorded (prototype). Server is authority in production.");
        render();
        break;
      }
      case "confirm-send-cal": {
        const lab = $("#d-lab") && $("#d-lab").value;
        if (!lab) {
          toast("Pick a calibration lab.");
          break;
        }
        const a = find(state.param);
        if (a) {
          a.status = "InCalibration";
          a.loc = lab;
        }
        state.dialog = null;
        render();
        break;
      }
      case "confirm-record-cal": {
        const a = find(state.param);
        const date = $("#d-date") && $("#d-date").value;
        if (!date) break;
        if (date > AMS.TODAY) {
          toast("Calibration date can't be in the future.");
          break;
        }
        if (a) {
          a.lastcal = date;
          a.nextcal = ($("#d-due") && $("#d-due").value) || a.nextcal;
          if (a.status === "InCalibration") {
            a.status = "Available";
            a.loc = a.office;
          }
          db.cals[a.id] = db.cals[a.id] || [];
          db.cals[a.id].unshift({ date, due: a.nextcal, lab: ($("#d-lab") && $("#d-lab").value) || "—", cert: false });
        }
        state.dialog = null;
        render();
        break;
      }
      case "retire-continue": {
        const reason = $("#d-reason") && $("#d-reason").value;
        if (!reason) {
          toast("A retirement reason is required.");
          break;
        }
        state.dialog = { type: "retire", step: 2, reason };
        render();
        break;
      }
      case "confirm-retire": {
        const a = find(state.param);
        if (a) a.status = "Retired";
        state.dialog = null;
        render();
        break;
      }
      case "add-to-cart": {
        const id = ($("#add-asset") && $("#add-asset").value.trim()) || "";
        addToCart(id);
        break;
      }
      case "remove-line": {
        const kind = el.dataset.kind;
        const idx = Number(el.dataset.idx);
        if (kind === "checkout") state.cart.splice(idx, 1);
        if (kind === "return") state.returnLines.splice(idx, 1);
        if (kind === "transfer") state.transferLines.splice(idx, 1);
        render();
        break;
      }
      case "set-condition":
        state.returnLines[Number(el.dataset.idx)].condition = el.value;
        break;
      case "submit-checkout":
        submitCheckout();
        break;
      case "submit-return":
        submitReturn();
        break;
      case "submit-transfer":
        submitTransfer();
        break;
      case "submit-deploy":
        submitDeploy();
        break;
      case "submit-recover":
        submitRecover();
        break;
      case "submit-new-asset":
        submitNewAsset();
        break;
      case "horizon":
        state.horizon = Number(el.dataset.days);
        render();
        break;
      case "toggle-current":
        state.currentOnly = !state.currentOnly;
        render();
        break;
      case "use-location":
        $("#f-lat") && ($("#f-lat").value = "45.4215");
        $("#f-lon") && ($("#f-lon").value = "-75.6972");
        toast("Captured from device (stub).");
        break;
      case "result-back": {
        const dest = state.result && state.result.backTo;
        state.result = null;
        state.cart = [];
        state.formError = "";
        if (dest) go(dest.screen, dest.param);
        else if (state.screen === "S10") go("S08");
        else if (state.screen === "S11") {
          const inst = db.installations.find((i) => i.id === state.param);
          go("S09", inst ? inst.site : null);
        } else if (state.screen === "S14") go("S13");
        else render();
        break;
      }
      case "retry-queue": {
        const q = db.queue.find((x) => x.id === el.dataset.id);
        if (q) {
          if (state.offline) {
            toast("Still offline — retry later.");
            break;
          }
          q.state = "pending";
          q.reason = null;
          // Simulate success
          db.queue = db.queue.filter((x) => x.id !== q.id);
          toast("Retried under same identity — accepted (prototype).");
          render();
        }
        break;
      }
      case "add-admin": {
        const office = el.dataset.office;
        const sel = $("#add-" + office);
        const upn = sel && sel.value;
        if (!upn) {
          toast("Pick a person…");
          break;
        }
        db.admins[office] = db.admins[office] || [];
        if (!db.admins[office].includes(upn)) db.admins[office].push(upn);
        toast("Saved.");
        render();
        break;
      }
      case "toggle-offline":
        state.offline = !state.offline;
        toast(state.offline ? "Prototype is offline — submits queue." : "Back online.");
        render();
        break;
      default:
        break;
    }
  }

  function resolveCode(v) {
    state.dialog = null;
    if (!v) {
      render();
      return;
    }
    const byId = find(v.toUpperCase()) || find(v);
    if (byId) {
      go("S03", byId.id);
      return;
    }
    const bySerial = db.assets.filter((a) => a.serial && a.serial.toLowerCase() === v.toLowerCase());
    if (bySerial.length === 1) {
      go("S03", bySerial[0].id);
      return;
    }
    if (bySerial.length > 1) {
      state.query = v;
      state.disambiguate = true;
      state.filter = null;
      go("S01");
      return;
    }
    state.query = v;
    state.disambiguate = false;
    go("S01");
    toast(fmt('No asset found for "{query}".', { query: v }));
  }

  function addToCart(id) {
    state.addError = "";
    if (!id) return;
    const a = find(id.toUpperCase()) || find(id);
    if (!a) {
      state.addError = fmt('No asset found for "{query}".', { query: id });
      render();
      return;
    }
    if (state.screen === "S04") {
      if (a.status !== "Available") {
        state.addError = fmt("{assetId} is {status}, held by {custodian} — can't add it.", {
          assetId: a.id,
          status: AMS.STATUS_LABEL[a.status],
          custodian: a.cust || "—",
        });
        render();
        return;
      }
      if (state.cart.some((c) => c.id === a.id)) {
        state.addError = fmt("{assetId} is already in the cart.", { assetId: a.id });
        render();
        return;
      }
      state.cart.push({ id: a.id, primary: state.cart.length === 0 });
    } else if (state.screen === "S06") {
      if (state.transferLines.some((c) => c.id === a.id)) {
        state.addError = fmt("{assetId} is already in the cart.", { assetId: a.id });
        render();
        return;
      }
      state.transferLines.push({ id: a.id });
    }
    render();
  }

  function submitCheckout() {
    state.formError = "";
    const project = $("#f-project") && $("#f-project").value;
    if (!project) {
      state.formError = "A project is required.";
      render();
      return;
    }
    if (!state.cart.length) return;
    const txn = nextTxn();
    submitWrite(fmt("Checkout {txn} recorded. State updates within ~1 min.", { txn }), () => {
      state.cart.forEach((c) => {
        const a = find(c.id);
        if (a) {
          a.status = "CheckedOut";
          a.cust = user().upn;
          a.proj = project;
          a.loc = user().office;
        }
      });
      state.cart = [];
    });
  }

  function submitReturn() {
    if (!state.returnLines.length) return;
    const txn = nextTxn();
    submitWrite(fmt("Return {txn} recorded.", { txn }), () => {
      state.returnLines.forEach((l) => {
        const a = find(l.id);
        if (a) {
          a.status = l.condition === "Needs service" ? "NeedsRepair" : "Available";
          a.cust = null;
          a.proj = null;
          a.loc = user().office;
        }
      });
      state.returnLines = [];
    });
  }

  function submitTransfer() {
    state.formError = "";
    const reason = $("#f-reason") && $("#f-reason").value.trim();
    if (!reason) {
      state.formError = "A reason is required.";
      render();
      return;
    }
    if (!state.transferLines.length) return;
    const txn = nextTxn();
    const cust = $("#f-custodian") && $("#f-custodian").value;
    const loc = $("#f-location") && $("#f-location").value;
    const proj = $("#f-project") && $("#f-project").value;
    submitWrite(fmt("Transfer {txn} recorded.", { txn }), () => {
      state.transferLines.forEach((l) => {
        const a = find(l.id);
        if (a) {
          if (cust) a.cust = cust;
          if (loc) a.loc = loc;
          if (proj) a.proj = proj;
        }
      });
      state.transferLines = [];
    });
  }

  function submitDeploy() {
    state.formError = "";
    const project = $("#f-project") && $("#f-project").value;
    const primary = $("#f-primary") && $("#f-primary").value.trim();
    if (!project) {
      state.formError = "A project is required.";
      render();
      return;
    }
    if (!primary) {
      state.formError = "A primary data logger is required.";
      render();
      return;
    }
    const a = find(primary.toUpperCase()) || find(primary);
    if (a && a.type !== "DataLogger") {
      state.formError = fmt("{assetId} is not a data logger and cannot be the primary.", { assetId: a.id });
      render();
      return;
    }
    const inactive = AMS.PROJECTS.find((p) => p.id === project && !p.active);
    if (inactive) {
      state.formError = fmt("Project {project} is not Active.", { project });
      render();
      return;
    }
    const siteSel = $("#f-site") && $("#f-site").value;
    const sitename = ($("#f-sitename") && $("#f-sitename").value) || siteSel;
    const siteKey = siteSel === "new" ? (sitename || "NEW-SITE").toUpperCase().replace(/\s+/g, "-") : siteSel;
    const txn = nextTxn();
    submitWrite(fmt("Deployment {txn} recorded at {site}.", { txn, site: siteKey }), (queued, meta) => {
      meta.backLabel = "Sites";
      meta.backTo = { screen: "S08", param: null };
      meta.queueAssets = [a ? a.id : primary];
      if (queued) return;
      if (a) {
        a.status = "Deployed";
        a.loc = siteKey;
        a.proj = project;
        a.cust = user().upn;
      }
      db.installations.unshift({
        id: "INST-" + Date.now().toString().slice(-3),
        site: siteKey,
        sitename: sitename || siteKey,
        project,
        start: ($("#f-date") && $("#f-date").value) || AMS.TODAY,
        end: null,
        power: ($("#f-power") && $("#f-power").value) || "Battery",
        position: ($("#f-position") && $("#f-position").value) || "—",
        lat: ($("#f-lat") && $("#f-lat").value) || "",
        lon: ($("#f-lon") && $("#f-lon").value) || "",
        components: [{ asset: a ? a.id : primary, role: "Primary", orientation: null }],
      });
    });
  }

  function submitRecover() {
    const inst = db.installations.find((i) => i.id === state.param);
    if (!inst) return;
    const txn = nextTxn();
    submitWrite(fmt("Recovery {txn} recorded.", { txn }), (queued, meta) => {
      meta.backLabel = "Site";
      meta.backTo = { screen: "S09", param: inst.site };
      meta.queueAssets = inst.components.map((c) => c.asset);
      if (queued) return;
      inst.end = ($("#f-date") && $("#f-date").value) || AMS.TODAY;
      const disp = $("#f-disp") && $("#f-disp").value;
      const cond = $("#f-cond") && $("#f-cond").value;
      inst.components.forEach((c) => {
        const a = find(c.asset);
        if (!a) return;
        if (disp === "Missing") a.status = "Missing";
        else if (cond === "Needs service") a.status = "NeedsRepair";
        else a.status = "Available";
        a.loc = user().office;
        a.cust = null;
      });
    });
  }

  function submitNewAsset() {
    state.formError = "";
    const model = $("#f-model") && $("#f-model").value;
    const office = $("#f-office") && $("#f-office").value;
    if (!model) {
      state.formError = "Pick a model from the catalogue — there is no free-text option.";
      render();
      return;
    }
    if (!office) {
      state.formError = "Pick a home office.";
      render();
      return;
    }
    const m = AMS.MODELS[model];
    const id = (model === "UM" || model === "MP" ? "DL-" : model === "V12" ? "GEO-" : model === "S50" ? "SLM-" : "AST-") + model + "-" + Math.floor(10000 + Math.random() * 89999);
    const serial = ($("#f-serial") && $("#f-serial").value) || null;
    submitWrite(fmt("{id} registered and set Available at {office}.", { id, office }), (queued, meta) => {
      meta.backLabel = "Admin";
      meta.backTo = { screen: "S13", param: null };
      meta.queueAssets = [id];
      if (queued) return;
      db.assets.unshift({
        id,
        modelKey: model,
        mfr: m.mfr,
        model: m.model,
        type: m.type,
        status: "Available",
        office,
        loc: office,
        cust: null,
        proj: null,
        serial,
        nextcal: null,
        lastcal: null,
        parent: null,
        children: [],
        pending: false,
        notes: ($("#f-notes") && $("#f-notes").value) || "",
        sim: null,
        permanent: false,
      });
    });
  }

  function onInput(e) {
    if (e.target.id === "search-input") {
      state.query = e.target.value;
      state.disambiguate = false;
      // Debounce-ish: render after short delay
      clearTimeout(onInput._t);
      onInput._t = setTimeout(() => render(), 200);
    }
  }

  function onKey(e) {
    if (e.key === "Enter" && e.target.id === "add-asset") {
      addToCart(e.target.value.trim());
    }
    if (e.key === "Enter" && e.target.id === "scan-value") {
      resolveCode(e.target.value.trim());
    }
  }

  /* ---------- boot ---------- */
  function boot() {
    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
    document.addEventListener("change", (e) => {
      if (e.target.matches("[data-action=set-condition]")) {
        handleAction("set-condition", e.target, e);
      }
      if (e.target.matches("[data-action=toggle-current]")) {
        handleAction("toggle-current", e.target, e);
      }
    });
    document.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", applyHashFromBar);

    $("#btn-back").addEventListener("click", (e) => {
      e.preventDefault();
      goBack();
    });
    $("#btn-identity").addEventListener("click", (e) => {
      e.preventDefault();
      state.dialog = { type: "identity" };
      render();
    });

    $$(".demo-role").forEach((b) =>
      b.addEventListener("click", () => {
        state.role = b.dataset.role;
        render();
      })
    );
    $("#demo-offline") &&
      $("#demo-offline").addEventListener("click", () => {
        state.offline = !state.offline;
        render();
      });
    $("#demo-reset") &&
      $("#demo-reset").addEventListener("click", () => {
        db = AMS.buildDb();
        state.cart = [];
        state.returnLines = [];
        state.transferLines = [];
        state.result = null;
        state.dialog = null;
        toast("Demo data reset.");
        render();
      });

    if (!location.hash || location.hash === "#") location.hash = "#/";
    applyHashFromBar();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
