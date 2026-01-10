(function() {
  const app = window.NNUE_APP;
  if (!app || !app.store || !app.actions) return;

  const { store, actions } = app;
  const BUILD_ID = app.constants && app.constants.BUILD_ID ? String(app.constants.BUILD_ID) : "";

  function getMetaContent(name) {
    try {
      const el = document.querySelector(`meta[name="${name}"]`);
      return el && typeof el.content === "string" ? el.content : "";
    } catch {
      return "";
    }
  }

  function isAdminAllowed() {
    try {
      if (window.NNUE_CONFIG && window.NNUE_CONFIG.allowAdmin === true) return true;
    } catch {
      return false;
    }
    const m = (getMetaContent("nnue-allow-admin") || "").trim();
    return m === "1" || m.toLowerCase() === "true";
  }

  const ADMIN_ALLOWED = isAdminAllowed();

  const MAX_LOG_DOM_NODES = 1200;

  function normalizeTab(t) {
    const ok = ["overview", "quality", "stability", "elo", "heatmap", "tournaments", "logs"];
    return ok.includes(t) ? t : "overview";
  }

  function normalizePhase(p) {
    const ok = ["opening", "midgame", "endgame"];
    return ok.includes(p) ? p : "opening";
  }

  function fmtNumber(x, digits) {
    if (typeof x !== "number" || !isFinite(x)) return "—";
    const d = (typeof digits === "number") ? digits : 2;
    return x.toFixed(d);
  }

  function formatDuration(ms) {
    if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return "—";
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h <= 0) return `${m}m`;
    return `${h}h ${m}m`;
  }

  function formatLastUpdate(iso) {
    if (typeof iso !== "string" || !iso) return "—";
    const d = new Date(iso);
    if (!isFinite(d.getTime())) return "—";
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(x) {
    if (x == null) return "—";
    if (typeof x === "string") return x.trim() ? x : "—";
    if (typeof x === "number" && isFinite(x)) return String(x);
    if (typeof x === "boolean") return x ? "true" : "false";
    return "—";
  }

  function setPill(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove("pill-ok", "pill-warn", "pill-bad");
    if (kind === "ok") el.classList.add("pill-ok");
    else if (kind === "warn") el.classList.add("pill-warn");
    else if (kind === "bad") el.classList.add("pill-bad");
  }

  function fmtPct01(x) {
    if (typeof x !== "number" || !isFinite(x)) return "—";
    return `${Math.round(x * 100)}%`;
  }

  function pctWidth01(x) {
    if (typeof x !== "number" || !isFinite(x)) return "0%";
    const v = Math.max(0, Math.min(1, x));
    return `${(v * 100).toFixed(1)}%`;
  }

  function postToHeatmap(msg) {
    const frame = document.querySelector("iframe.embed-heatmap-iframe");
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage(msg, "*");
    } catch {
      return;
    }
  }

  function ensureHeatmapMounted() {
    const mount = ui.els.heatmapMount;
    if (!mount) return;
    if (mount.querySelector("iframe")) return;
    const iframe = document.createElement("iframe");
    const base = "heatmap.html";
    const v = BUILD_ID ? `v=${encodeURIComponent(BUILD_ID)}` : "";
    let src = v ? `${base}?${v}` : base;
    try {
      let backend = "";
      try {
        const u = new URL(window.location.href);
        backend = (u.searchParams.get("backend") || u.searchParams.get("backend_base") || "").trim();
      } catch {
        backend = "";
      }
      if (!backend) {
        const cfg = window.NNUE_CONFIG && typeof window.NNUE_CONFIG.backendBase === "string" ? window.NNUE_CONFIG.backendBase : "";
        backend = (cfg || "").trim();
      }
      if (backend) src += (src.includes("?") ? "&" : "?") + `backend=${encodeURIComponent(backend)}`;
      try {
        const t = (localStorage.getItem("nnue_dashboard_theme") || "").trim();
        if (t) src += (src.includes("?") ? "&" : "?") + `theme=${encodeURIComponent(t)}`;
      } catch {
      }
    } catch {
    }
    iframe.src = src;
    iframe.className = "embed-heatmap-iframe";
    iframe.title = "NNUE Activity Heatmap";
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("loading", "lazy");
    mount.appendChild(iframe);
  }

  function renderProgress(state) {
    const p = state.data && state.data.progress;
    if (!ui.els.progressFill || !ui.els.progressValue || !ui.els.progressText) return;
    const percent = (p && typeof p.percent === "number" && isFinite(p.percent)) ? Math.max(0, Math.min(1, p.percent)) : null;
    const pctText = (percent == null) ? "0%" : `${Math.round(percent * 100)}%`;
    ui.els.progressValue.textContent = pctText;
    if (p && typeof p.text === "string" && p.text.trim()) ui.els.progressText.textContent = p.text;
    else ui.els.progressText.textContent = "Idle";
    ui.els.progressFill.style.width = (percent == null) ? "0%" : `${(percent * 100).toFixed(1)}%`;
  }

  function renderTournaments(state) {
    const el = ui.els.tournamentList;
    if (!el) return;
    if (state.loading && state.loading.tournaments) {
      el.setAttribute("aria-busy", "true");
      el.textContent = "loading…";
      return;
    }
    el.removeAttribute("aria-busy");
    if (state.error && state.error.tournaments) {
      el.textContent = state.error.tournaments;
      return;
    }
    const t = state.data && state.data.tournaments;
    const list = Array.isArray(t) ? t : [];
    if (!list.length) {
      el.textContent = "No tournaments.";
      return;
    }
    el.textContent = "";
    const frag = document.createDocumentFragment();
    list.slice(0, 120).forEach((x) => {
      const name = x && x.name ? x.name : "—";
      const games = x && x.games != null ? x.games : "—";
      const winner = x && x.winner ? x.winner : "—";

      const item = document.createElement("div");
      item.className = "tournament-item";
      item.innerHTML = `
        <div class="tournament-name">${name}</div>
        <div class="tournament-meta">
          <span>Games = <b>${games}</b></span>
          <span>Winner = <b>${winner}</b></span>
        </div>
      `;
      frag.appendChild(item);
    });
    el.appendChild(frag);
  }

  function classifyLogLine(line) {
    if (line && typeof line === "object") {
      const level = String(line.level || "INFO").toUpperCase();
      const subsystem = String(line.subsystem || "MISC").toUpperCase();
      const sev = (level === "ERROR") ? "error" : (level === "WARN") ? "warn" : "info";
      const cat = (subsystem === "TOURNAMENT") ? "tournament" :
        (subsystem === "TRAIN") ? "train" :
        (subsystem === "EVAL") ? "eval" :
        (subsystem === "IO") ? "io" : "misc";
      return { sev, cat };
    }
    const s = String(line || "");
    const up = s.toUpperCase();
    let sev = "info";
    if (up.includes("ERROR") || up.includes("FATAL")) sev = "error";
    else if (up.includes("WARN")) sev = "warn";

    let cat = "misc";
    if (up.includes("TOURNAMENT")) cat = "tournament";
    else if (up.includes("TRAIN")) cat = "train";
    else if (up.includes("EVAL")) cat = "eval";
    else if (up.includes("IO")) cat = "io";

    return { sev, cat };
  }

  function logsPassFilter(line, filters) {
    const { sev, cat } = classifyLogLine(line);
    if (filters.level !== "all" && sev !== filters.level) return false;
    if (filters.subsystem !== "all" && cat !== filters.subsystem) return false;
    return true;
  }

  function getLogLineText(x) {
    if (x && typeof x === "object") {
      if (typeof x.line === "string" && x.line) return x.line;
      const ts = (typeof x.ts === "string" && x.ts) ? x.ts : "";
      const level = (typeof x.level === "string" && x.level) ? x.level : "INFO";
      const subsystem = (typeof x.subsystem === "string" && x.subsystem) ? x.subsystem : "MISC";
      const msg = (typeof x.message === "string" && x.message) ? x.message : "";
      if (!ts) return `[${level}] [${subsystem}] ${msg}`;
      return `[${ts}] [${level}] [${subsystem}] ${msg}`;
    }
    return String(x);
  }

  function getLogStableKey(x) {
    if (x && typeof x === "object") {
      if (typeof x.key === "string" && x.key) return x.key;
      if (typeof x.line === "string" && x.line) return x.line;
      return getLogLineText(x);
    }
    return String(x);
  }

  function computeLogSlice(lines, filters) {
    const n = (filters.window === "lastN") ? Number(filters.n || 200) : null;
    if (filters.window === "latest") {
      const start = Math.max(0, lines.length - 300);
      return { start, end: lines.length };
    }
    if (filters.window === "lastN") {
      const start = Math.max(0, lines.length - Math.max(1, n || 200));
      return { start, end: lines.length };
    }
    return { start: 0, end: lines.length };
  }

  function renderLogs(state) {
    const el = ui.els.logOutput;
    if (!el) return;

    const uiLogs = state.ui && state.ui.logs ? state.ui.logs : { level: "all", subsystem: "all", window: "latest", n: 200, paused: false };
    const filterKey = `${uiLogs.level}|${uiLogs.subsystem}|${uiLogs.window}|${uiLogs.n}`;

    if (state.loading && state.loading.logs) {
      ui.logsRender.key = null;
      ui.logsRender.filterKey = null;
      el.setAttribute("aria-busy", "true");
      el.textContent = "loading…";
      return;
    }
    el.removeAttribute("aria-busy");
    if (state.error && state.error.logs) {
      ui.logsRender.key = null;
      ui.logsRender.filterKey = null;
      el.textContent = state.error.logs;
      return;
    }

    const logs = state.data && state.data.logs;
    const lines = Array.isArray(logs) ? logs : [];
    if (!lines.length) {
      ui.logsRender.key = null;
      ui.logsRender.filterKey = null;
      el.textContent = "No logs.";
      return;
    }

    if (uiLogs.paused) return;

    const last0 = getLogStableKey(lines[lines.length - 1] || "");
    const last1 = getLogStableKey(lines[lines.length - 2] || "");
    const last2 = getLogStableKey(lines[lines.length - 3] || "");
    const key = `${lines.length}|${last2}|${last1}|${last0}`;
    const slice = computeLogSlice(lines, uiLogs);

    const needsFull = (ui.logsRender.key == null) || (ui.logsRender.filterKey !== filterKey) || (ui.logsRender.sliceStart !== slice.start);

    const atBottom = Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 12;

    if (needsFull) {
      ui.logsRender.key = key;
      ui.logsRender.filterKey = filterKey;
      ui.logsRender.sliceStart = slice.start;
      ui.logsRender.renderedIndex = slice.start;
      ui.logsRender.prevLen = lines.length;

      el.textContent = "";
      const frag = document.createDocumentFragment();
      for (let i = slice.start; i < slice.end; i++) {
        const line = lines[i];
        if (!logsPassFilter(line, uiLogs)) continue;
        const { sev, cat } = classifyLogLine(line);
        const row = document.createElement("div");
        row.className = `log-line log-sev-${sev} log-cat-${cat}`;
        row.textContent = getLogLineText(line);
        frag.appendChild(row);
      }
      el.appendChild(frag);

      while (el.childNodes.length > MAX_LOG_DOM_NODES) el.removeChild(el.firstChild);
      if (atBottom) el.scrollTop = el.scrollHeight;
      return;
    }

    if (ui.logsRender.key === key) return;

    // Incremental append: render only new lines.
    const prevLen = ui.logsRender.prevLen || 0;
    const startIdx = Math.max(slice.start, prevLen);

    ui.logsRender.key = key;
    ui.logsRender.prevLen = lines.length;

    const frag = document.createDocumentFragment();
    for (let i = startIdx; i < slice.end; i++) {
      const line = lines[i];
      if (!logsPassFilter(line, uiLogs)) continue;
      const { sev, cat } = classifyLogLine(line);
      const row = document.createElement("div");
      row.className = `log-line log-sev-${sev} log-cat-${cat}`;
      row.textContent = getLogLineText(line);
      frag.appendChild(row);
    }
    if (frag.childNodes.length) el.appendChild(frag);

    while (el.childNodes.length > MAX_LOG_DOM_NODES) el.removeChild(el.firstChild);
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  function getChartTargetHeightPx() {
    const w = window.innerWidth || 9999;
    if (w <= 520) return 220;
    if (w <= 750) return 280;
    return 360;
  }

  function ensureCanvasSize(canvas) {
    if (!canvas) return null;
    const parent = canvas.parentElement;
    const widthCss = Math.max(260, Math.floor((parent ? parent.clientWidth : canvas.clientWidth) || 0));
    const heightCss = getChartTargetHeightPx();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    const targetW = Math.floor(widthCss * dpr);
    const targetH = Math.floor(heightCss * dpr);
    if (canvas.width !== targetW) canvas.width = targetW;
    if (canvas.height !== targetH) canvas.height = targetH;
    canvas.style.width = widthCss + "px";
    canvas.style.height = heightCss + "px";

    return { widthCss, heightCss, dpr };
  }

  const ui = {
    tabTransition: {
      inProgress: false,
      timer: 0,
      renderedTab: null
    },
    logsRender: {
      key: null,
      filterKey: null,
      sliceStart: 0,
      prevLen: 0
    },
    signalsKey: null,
    qualityKey: null,
    stabilityKey: null,
    raf: 0,
    pendingState: null,
    els: null
  };

  function cacheEls() {
    ui.els = {
      navButtons: Array.from(document.querySelectorAll(".top-nav button")),
      tabs: Array.from(document.querySelectorAll(".tab")),
      healthPill: byId("healthPill"),
      healthConn: byId("healthConn"),
      healthLast: byId("healthLast"),
      healthWarn: byId("healthWarn"),
      offlineBanner: byId("offlineBanner"),
      offlineText: byId("offlineText"),
      offlineRetry: byId("offlineRetry"),
      adminToggle: byId("adminToggle"),
      adminBadge: byId("adminBadge"),
      adminPanel: byId("adminPanel"),
      shutdownBtn: byId("shutdownBtn"),
      exportBtn: byId("exportBtn"),
      adminStatus: byId("adminStatus"),
      heatmapMount: byId("heatmapMount"),
      overlay: byId("explainOverlay"),
      explainTitle: byId("explainTitle"),
      explainElo: byId("explainElo"),
      explainGames: byId("explainGames"),
      explainWins: byId("explainWins"),
      explainLoss: byId("explainLoss"),
      explainStatus: byId("explainStatus"),
      explainSprt: byId("explainSprt"),
      explainConf: byId("explainConf"),
      explainNote: byId("explainNote"),
      top5: byId("top5"),
      eloChart: byId("eloChart"),
      regressions: byId("regressions"),
      statusText: byId("statusText"),
      sigSprtGate: byId("sigSprtGate"),
      sigRegression: byId("sigRegression"),
      sigDrift: byId("sigDrift"),
      sigCurriculum: byId("sigCurriculum"),
      sigLrReason: byId("sigLrReason"),
      sigNote: byId("sigNote"),
      games: byId("games"),
      loss: byId("loss"),
      lr: byId("lr"),
      eloValue: byId("eloValue"),
      time: byId("time"),
      progressText: byId("progressText"),
      progressValue: byId("progressValue"),
      progressFill: byId("progressFill"),
      tournamentList: byId("tournamentList"),
      logOutput: byId("logOutput"),
      logLevel: byId("logLevel"),
      logSubsystem: byId("logSubsystem"),
      logWindow: byId("logWindow"),
      logN: byId("logN"),
      logNWrap: byId("logNWrap"),
      logPause: byId("logPause"),
      qualitySummary: byId("qualitySummary"),
      qualityDist: byId("qualityDist"),
      stabilitySummary: byId("stabilitySummary"),
      evalSignals: byId("evalSignals")
    };
  }

  function attachPulseCleaner(el) {
    if (!el) return;
    if (el.dataset && el.dataset.pulseBound === "1") return;
    try {
      el.addEventListener("animationend", (e) => {
        if (!e || !e.animationName) return;
        if (e.animationName !== "pulseUp" && e.animationName !== "pulseDown") return;
        el.classList.remove("pulse-up", "pulse-down");
      }, { passive: true });
      el.dataset.pulseBound = "1";
    } catch {
      return;
    }
  }

  function toNumber(x) {
    if (typeof x === "number" && isFinite(x)) return x;
    if (typeof x === "string" && x.trim()) {
      const v = Number(x);
      if (isFinite(v)) return v;
    }
    return null;
  }

  function applyPulse(el, prev, next, opts) {
    if (!el) return;
    const p = toNumber(prev);
    const n = toNumber(next);
    if (p == null || n == null) return;
    if (p === n) return;
    const isUp = !!(opts && opts.invert ? (n < p) : (n > p));
    attachPulseCleaner(el);

    el.classList.remove("pulse-up", "pulse-down");
    void el.offsetWidth;
    el.classList.add(isUp ? "pulse-up" : "pulse-down");
  }

  function renderHealth(state) {
    const conn = state.meta && state.meta.connection ? state.meta.connection : null;
    const warn = state.meta && state.meta.warnings ? state.meta.warnings : null;
    const lastAny = state.meta && state.meta.lastSeen ? state.meta.lastSeen.any : null;

    if (!ui.els.healthPill) return;

    const status = conn && conn.state ? conn.state : "disconnected";
    const transport = conn && conn.transport ? conn.transport : "poll";

    ui.els.healthPill.classList.toggle("health-connected", status === "connected");
    ui.els.healthPill.classList.toggle("health-reconnecting", status === "reconnecting");
    ui.els.healthPill.classList.toggle("health-disconnected", status === "disconnected");
    ui.els.healthPill.setAttribute("data-transport", transport);

    if (ui.els.healthConn) {
      const t = transport === "ws" ? "WS" : transport === "sse" ? "SSE" : "POLL";
      ui.els.healthConn.textContent = status === "connected" ? `connected · ${t}` : status === "reconnecting" ? `reconnecting · ${t}` : `disconnected · ${t}`;
    }
    if (ui.els.healthLast) ui.els.healthLast.textContent = `last: ${formatLastUpdate(lastAny)}`;

    if (ui.els.healthWarn) {
      const bits = [];
      if (warn && warn.stale) bits.push("stale");
      if (warn && warn.dropped) bits.push("delayed");
      if (warn && warn.stall) bits.push("stall");
      if (warn && warn.schema) bits.push("schema");
      ui.els.healthWarn.textContent = bits.length ? bits.join(" · ") : "";
      ui.els.healthWarn.style.display = bits.length ? "" : "none";
    }
  }

  function renderOffline(state) {
    if (!ui.els.offlineBanner) return;
    const off = state.meta && state.meta.offline ? state.meta.offline : null;
    const active = !!(off && off.active);
    ui.els.offlineBanner.style.display = active ? "" : "none";
    if (!active) return;

    const lastOk = off && off.lastOk ? off.lastOk : (state.meta && state.meta.lastSeen ? state.meta.lastSeen.any : null);
    const t = formatLastUpdate(lastOk);
    if (ui.els.offlineText) {
      ui.els.offlineText.textContent = `Backend offline. last: ${t}`;
    }
  }

  function renderAdmin(state) {
    const enabled = ADMIN_ALLOWED && !!(state.ui && state.ui.admin && state.ui.admin.enabled);
    document.body.classList.toggle("admin-mode", enabled);
    if (ui.els.adminBadge) ui.els.adminBadge.style.display = enabled ? "" : "none";
    if (ui.els.adminPanel) ui.els.adminPanel.style.display = enabled ? "" : "none";
    if (ui.els.adminToggle) {
      ui.els.adminToggle.textContent = ADMIN_ALLOWED ? (enabled ? "Disable Admin" : "Enable Admin") : "Read-only";
      ui.els.adminToggle.disabled = !ADMIN_ALLOWED;
    }

    const off = !!(state.meta && state.meta.offline && state.meta.offline.active);
    if (ui.els.shutdownBtn) ui.els.shutdownBtn.disabled = !enabled || off;
    if (ui.els.exportBtn) ui.els.exportBtn.disabled = !enabled;
  }

  function setAdminStatus(msg) {
    if (!ui.els.adminStatus) return;
    ui.els.adminStatus.textContent = msg || "";
  }

  function downloadJson(filename, obj) {
    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bindUIEvents() {
    ui.els.navButtons.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const tab = normalizeTab(btn.getAttribute("data-tab"));
        actions.setActiveTab(tab);
      });
    });

    if (ui.els.overlay) {
      ui.els.overlay.addEventListener("click", (e) => {
        if (e.target === ui.els.overlay) actions.closeExplain();
      });
    }

    window.addEventListener("resize", () => {
      const s = store.getState();
      if (s.activeTab === "heatmap") postToHeatmap({ type: "heatmap:rerender" });
      scheduleRender(s, { type: "ui/resize" });
    });

    window.addEventListener("message", (e) => {
      const t = e && e.data && e.data.type;
      if (t === "heatmap:ready") {
        const s = store.getState();
        postToHeatmap({ type: "heatmap:setPhase", phase: s.activeHeatmapPhase });
        if (s.activeTab === "heatmap") postToHeatmap({ type: "heatmap:show" });
      }
      if (t === "heatmap:requestPhase") {
        const p = normalizePhase(e.data && e.data.phase);
        actions.setHeatmapPhase(p);
      }
    });

    const bind = (el, type, fn) => {
      if (!el) return;
      el.addEventListener(type, fn);
    };

    bind(ui.els.logLevel, "change", () => actions.setLogsUi({ level: ui.els.logLevel.value }));
    bind(ui.els.logSubsystem, "change", () => actions.setLogsUi({ subsystem: ui.els.logSubsystem.value }));
    bind(ui.els.logWindow, "change", () => actions.setLogsUi({ window: ui.els.logWindow.value }));
    bind(ui.els.logN, "change", () => actions.setLogsUi({ n: Number(ui.els.logN.value) }));
    bind(ui.els.logPause, "click", (e) => {
      e.preventDefault();
      const s = store.getState();
      const paused = !!(s.ui && s.ui.logs && s.ui.logs.paused);
      actions.setLogsUi({ paused: !paused });
      // Force a rebuild when resuming.
      ui.logsRender.key = null;
      ui.logsRender.filterKey = null;
    });

    bind(ui.els.offlineRetry, "click", (e) => {
      e.preventDefault();
      try {
        if (app.dataService && typeof app.dataService.refreshOnce === "function") app.dataService.refreshOnce();
      } catch {
        return;
      }
    });

    bind(ui.els.adminToggle, "click", (e) => {
      e.preventDefault();
      if (!ADMIN_ALLOWED) return;
      const s = store.getState();
      const enabled = !!(s.ui && s.ui.admin && s.ui.admin.enabled);
      if (!enabled) {
        const ok = window.confirm("Enable admin mode on this browser?\n\nAdmin can request shutdown and export snapshots.");
        if (!ok) return;
      }
      setAdminStatus("");
      actions.setAdminEnabled(!enabled);
    });

    bind(ui.els.shutdownBtn, "click", async (e) => {
      e.preventDefault();
      const ok = window.confirm("Request safe shutdown?\n\nThis only sends intent; backend decides.");
      if (!ok) return;
      setAdminStatus("Requesting shutdown…");
      if (ui.els.shutdownBtn) ui.els.shutdownBtn.disabled = true;
      try {
        const res = await actions.requestSafeShutdown();
        if (!res || !res.ok) {
          setAdminStatus(res && res.error ? res.error : "Shutdown request failed.");
        } else {
          setAdminStatus("Shutdown requested.");
        }
      } finally {
        const s = store.getState();
        renderAdmin(s);
      }
    });

    bind(ui.els.exportBtn, "click", async (e) => {
      e.preventDefault();
      setAdminStatus("Exporting snapshot…");
      if (ui.els.exportBtn) ui.els.exportBtn.disabled = true;
      try {
        const res = await actions.exportSnapshot();
        if (!res || !res.ok) {
          setAdminStatus(res && res.error ? res.error : "Export failed.");
          return;
        }
        const now = new Date();
        const y = String(now.getFullYear());
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        const ss = String(now.getSeconds()).padStart(2, "0");
        const src = res.source ? String(res.source) : "snapshot";
        const file = `nnue_${src}_${y}${m}${d}_${hh}${mm}${ss}.json`;
        downloadJson(file, res.data);
        setAdminStatus("Snapshot downloaded.");
      } finally {
        const s = store.getState();
        renderAdmin(s);
      }
    });
  }

  function renderLogsControls(state) {
    const uiLogs = state.ui && state.ui.logs ? state.ui.logs : null;
    if (!uiLogs) return;
    if (ui.els.logLevel) ui.els.logLevel.value = uiLogs.level;
    if (ui.els.logSubsystem) ui.els.logSubsystem.value = uiLogs.subsystem;
    if (ui.els.logWindow) ui.els.logWindow.value = uiLogs.window;
    if (ui.els.logN) ui.els.logN.value = String(uiLogs.n);
    if (ui.els.logNWrap) ui.els.logNWrap.style.display = (uiLogs.window === "lastN") ? "" : "none";
    if (ui.els.logPause) ui.els.logPause.textContent = uiLogs.paused ? "Resume" : "Pause";
    if (ui.els.logOutput) ui.els.logOutput.setAttribute("aria-live", uiLogs.paused ? "off" : "polite");
  }

  function setNavActive(activeTab) {
    ui.els.navButtons.forEach(btn => {
      btn.classList.toggle("active", normalizeTab(btn.getAttribute("data-tab")) === activeTab);
    });
  }

  function disableNav(disabled) {
    ui.els.navButtons.forEach(btn => (btn.disabled = !!disabled));
  }

  function startTabTransition(targetTab) {
    const target = normalizeTab(targetTab);
    if (ui.tabTransition.timer) clearTimeout(ui.tabTransition.timer);

    const current = ui.tabTransition.renderedTab;
    if (!current) {
      ui.els.tabs.forEach(tab => tab.classList.toggle("active", tab.id === target));
      ui.tabTransition.renderedTab = target;
      if (target === "heatmap") {
        ensureHeatmapMounted();
        postToHeatmap({ type: "heatmap:show" });
        postToHeatmap({ type: "heatmap:setPhase", phase: store.getState().activeHeatmapPhase });
        postToHeatmap({ type: "heatmap:visibility", visible: true });
      }
      return;
    }

    if (current === target) return;

    ui.tabTransition.inProgress = true;
    disableNav(true);

    const currentEl = byId(current);
    if (currentEl) currentEl.classList.add("leaving");

    ui.tabTransition.timer = setTimeout(() => {
      if (currentEl) {
        currentEl.classList.remove("active");
        currentEl.classList.remove("leaving");
      }
      ui.els.tabs.forEach(tab => {
        tab.classList.toggle("active", tab.id === target);
        if (tab.id !== target) tab.classList.remove("leaving");
      });
      ui.tabTransition.renderedTab = target;
      ui.tabTransition.inProgress = false;
      disableNav(false);

      const s = store.getState();
      if (target === "heatmap") {
        ensureHeatmapMounted();
        setTimeout(() => {
          postToHeatmap({ type: "heatmap:show" });
          postToHeatmap({ type: "heatmap:setPhase", phase: s.activeHeatmapPhase });
          postToHeatmap({ type: "heatmap:visibility", visible: true });
        }, 60);
      } else {
        postToHeatmap({ type: "heatmap:visibility", visible: false });
      }
      if (s.activeTab !== target) startTabTransition(s.activeTab);
    }, 360);
  }

  function renderOverview(state) {
    const d = state.data && state.data.training;

    const prevGames = ui.els.games ? ui.els.games.textContent : null;
    const prevLoss = ui.els.loss ? ui.els.loss.textContent : null;
    const prevLr = ui.els.lr ? ui.els.lr.textContent : null;
    const prevElo = ui.els.eloValue ? ui.els.eloValue.textContent : null;

    const nextGames = (d && typeof d.games === "number") ? String(d.games) : "—";
    const nextLoss = (d && typeof d.loss === "number") ? fmtNumber(d.loss, 6) : "—";
    const nextLr = (d && typeof d.lr === "number") ? fmtNumber(d.lr, 6) : "—";

    let nextElo = "—";
    try {
      const elo = state.data && state.data.elo;
      const top5 = (elo && Array.isArray(elo.top5)) ? elo.top5 : [];
      const best = top5.length ? top5[0] : null;
      if (best && best.elo != null) nextElo = String(best.elo);
    } catch {
      nextElo = "—";
    }

    if (ui.els.games) ui.els.games.textContent = nextGames;
    if (ui.els.loss) ui.els.loss.textContent = nextLoss;
    if (ui.els.lr) ui.els.lr.textContent = nextLr;
    if (ui.els.eloValue) ui.els.eloValue.textContent = nextElo;

    applyPulse(ui.els.games, prevGames, nextGames);
    applyPulse(ui.els.loss, prevLoss, nextLoss, { invert: true });
    applyPulse(ui.els.lr, prevLr, nextLr);
    applyPulse(ui.els.eloValue, prevElo, nextElo);

    if (ui.els.time) {
      const ms = (d && typeof d.elapsed_ms === "number") ? d.elapsed_ms : (d && typeof d.elapsedMs === "number" ? d.elapsedMs : null);
      ui.els.time.textContent = (ms != null) ? formatDuration(ms) : "—";
    }

    if (ui.els.statusText) {
      if (state.error && state.error.training) ui.els.statusText.textContent = state.error.training;
      else if (d && typeof d.status_text === "string") ui.els.statusText.textContent = d.status_text;
      else if (d && typeof d.status === "string") ui.els.statusText.textContent = d.status;
      else if (state.loading && state.loading.training) ui.els.statusText.textContent = "loading…";
      else ui.els.statusText.textContent = "—";

      if (state.loading && state.loading.training) ui.els.statusText.setAttribute("aria-busy", "true");
      else ui.els.statusText.removeAttribute("aria-busy");
    }

    renderSignals(state);
  }

  function renderSignals(state) {
    const tm = state.data && state.data.trainingMetrics ? state.data.trainingMetrics : null;
    const dm = state.data && state.data.dataMetrics ? state.data.dataMetrics : null;
    const es = state.data && state.data.evalSignals ? state.data.evalSignals : null;

    const tmIso = tm && typeof tm.generated_at === "string" ? tm.generated_at : "";
    const dmIso = dm && typeof dm.generated_at === "string" ? dm.generated_at : "";
    const esIso = es && typeof es.generated_at === "string" ? es.generated_at : "";
    const key = `${tmIso}|${dmIso}|${esIso}|${state.activeTab}`;
    if (ui.signalsKey === key) return;
    ui.signalsKey = key;

    const stable = tm && typeof tm.stable_for_sprt === "boolean" ? tm.stable_for_sprt : null;
    if (stable == null) setPill(ui.els.sigSprtGate, "—", null);
    else setPill(ui.els.sigSprtGate, stable ? "OPEN" : "CLOSED", stable ? "ok" : "warn");

    const regFlag = (
      !!(es && es.regression && es.regression.flag) ||
      !!(tm && tm.eval_regression)
    );
    setPill(ui.els.sigRegression, regFlag ? "FLAG" : "OK", regFlag ? "bad" : "ok");

    let driftKind = null;
    let driftText = "—";
    try {
      const warn = dm && dm.distribution ? dm.distribution.warning : null;
      const drift = dm && dm.distribution ? dm.distribution.drift : null;
      const l1 = drift ? Math.max(Number(drift.eval_l1 || 0), Number(drift.material_l1 || 0), Number(drift.phase_l1 || 0)) : null;
      if (warn) {
        driftKind = "warn";
        driftText = "DRIFT";
        if (l1 != null && isFinite(l1)) driftText = `DRIFT (${fmtNumber(l1, 2)})`;
      } else if (l1 != null && isFinite(l1)) {
        driftKind = l1 >= 0.30 ? "warn" : "ok";
        driftText = `OK (${fmtNumber(l1, 2)})`;
      } else {
        driftKind = null;
        driftText = "—";
      }
    } catch {
      driftKind = null;
      driftText = "—";
    }
    setPill(ui.els.sigDrift, driftText, driftKind);

    const stage = tm && typeof tm.curriculum_stage === "number" ? tm.curriculum_stage : null;
    setPill(ui.els.sigCurriculum, stage == null ? "—" : `S${stage}`, stage == null ? null : "ok");

    const lrReason = tm && typeof tm.lr_reason === "string" ? tm.lr_reason : null;
    setPill(ui.els.sigLrReason, lrReason ? lrReason : "—", lrReason ? "ok" : null);

    if (ui.els.sigNote) {
      const bits = [];
      const rs = tm && Array.isArray(tm.stable_reasons) ? tm.stable_reasons : [];
      if (stable === false && rs.length) bits.push(`gate: ${rs.slice(0, 4).join(", ")}`);
      const er = tm && tm.eval_reason ? String(tm.eval_reason) : (es && es.regression && es.regression.reason ? String(es.regression.reason) : "");
      if (regFlag && er) bits.push(er);
      const warn = dm && dm.distribution && dm.distribution.warning ? dm.distribution.warning : null;
      if (warn && warn.type) bits.push(`drift: ${warn.type}`);
      ui.els.sigNote.textContent = bits.length ? bits.join(" · ") : "—";
    }
  }

  function renderQuality(state) {
    const dm = state.data && state.data.dataMetrics ? state.data.dataMetrics : null;
    const iso = dm && typeof dm.generated_at === "string" ? dm.generated_at : "";
    const key = `${iso}|${state.loading && state.loading.quality}|${state.error && state.error.quality}`;
    if (ui.qualityKey === key) return;
    ui.qualityKey = key;

    if (ui.els.qualitySummary) {
      if (state.loading && state.loading.quality) ui.els.qualitySummary.setAttribute("aria-busy", "true");
      else ui.els.qualitySummary.removeAttribute("aria-busy");
    }
    if (ui.els.qualityDist) {
      if (state.loading && state.loading.quality) ui.els.qualityDist.setAttribute("aria-busy", "true");
      else ui.els.qualityDist.removeAttribute("aria-busy");
    }

    if (ui.els.qualitySummary) {
      if (state.loading && state.loading.quality) {
        ui.els.qualitySummary.innerHTML = "<div class=\"panel-note\">loading…</div>";
      } else if (state.error && state.error.quality) {
        ui.els.qualitySummary.innerHTML = `<div class=\"panel-note\">${state.error.quality}</div>`;
      } else if (!dm) {
        ui.els.qualitySummary.innerHTML = "<div class=\"panel-note\">No data.</div>";
      } else {
        const f = dm.filter || {};
        const pb = dm.phase_balance || {};
        const dist = dm.distribution || {};
        const drift = dist.drift || null;
        const warn = dist.warning || dist.last_warning || null;
        const maxL1 = drift ? Math.max(Number(drift.eval_l1 || 0), Number(drift.material_l1 || 0), Number(drift.phase_l1 || 0)) : null;

        const parts = [];
        const seen = Number(f.seen);
        const kept = Number(f.kept);
        const dropped = (isFinite(seen) && isFinite(kept)) ? Math.max(0, seen - kept) : null;

        parts.push(`<div class=\"kv-item\"><b>Generated</b><span>${safeText(iso)}</span></div>`);
        parts.push(`<div class=\"kv-item\"><b>Seen</b><span>${safeText(isFinite(seen) ? seen : f.seen)}</span></div>`);
        parts.push(`<div class=\"kv-item\"><b>Kept</b><span>${safeText(isFinite(kept) ? kept : f.kept)}</span></div>`);
        parts.push(`<div class=\"kv-item\"><b>Dropped</b><span>${safeText(dropped)}</span></div>`);

        const driftKind = warn ? "pill-warn" : (maxL1 != null && isFinite(maxL1) && maxL1 >= 0.30) ? "pill-warn" : "pill-ok";
        const driftText = warn ? "DRIFT" : "OK";
        const driftSuffix = (maxL1 != null && isFinite(maxL1)) ? ` (${fmtNumber(maxL1, 2)})` : "";
        parts.push(`<div class=\"kv-item\"><b>Drift</b><span class=\"pill ${driftKind}\">${driftText}${driftSuffix}</span></div>`);
        parts.push(`<div class=\"kv-item\"><b>Phase window</b><span>${safeText(pb.window)}</span></div>`);

        ui.els.qualitySummary.innerHTML = parts.join("");
      }
    }

    if (ui.els.qualityDist) {
      if (state.loading && state.loading.quality) {
        ui.els.qualityDist.textContent = "loading…";
        return;
      }
      if (state.error && state.error.quality) {
        ui.els.qualityDist.textContent = state.error.quality;
        return;
      }
      if (!dm || !dm.distribution) {
        ui.els.qualityDist.textContent = "No data.";
        return;
      }

      const dist = dm.distribution;
      const pb = dm.phase_balance || {};
      const ratios = pb.ratios || {};
      const target = pb.target || {};
      const evalHist = dist.eval_hist || {};
      const matHist = dist.material_hist || {};
      const phHist = dist.phase_hist || {};

      const warn = dist.warning || dist.last_warning || null;
      const warnTxt = warn && warn.type ? safeText(warn.type) : "—";

      ui.els.qualityDist.innerHTML = `
        <div class=\"panel-note\">warning: <b>${warnTxt}</b></div>
        <div class=\"bar-group\">
          <div class=\"panel-note\">Phase balance</div>
          <div class=\"bar-rows\">
            <div class=\"bar-row\"><div class=\"bar-label\">opening</div><div class=\"bar-track\"><div class=\"bar-fill\" style=\"width:${pctWidth01(ratios.opening)}\"></div></div><div class=\"bar-meta\">${fmtPct01(ratios.opening)} (tgt ${fmtPct01(target.opening)})</div></div>
            <div class=\"bar-row\"><div class=\"bar-label\">midgame</div><div class=\"bar-track\"><div class=\"bar-fill\" style=\"width:${pctWidth01(ratios.midgame)}\"></div></div><div class=\"bar-meta\">${fmtPct01(ratios.midgame)} (tgt ${fmtPct01(target.midgame)})</div></div>
            <div class=\"bar-row\"><div class=\"bar-label\">endgame</div><div class=\"bar-track\"><div class=\"bar-fill\" style=\"width:${pctWidth01(ratios.endgame)}\"></div></div><div class=\"bar-meta\">${fmtPct01(ratios.endgame)} (tgt ${fmtPct01(target.endgame)})</div></div>
          </div>
        </div>
        <div class=\"panel-note\">Eval distribution (bins)</div>
        ${renderMiniHist(evalHist)}
        <div class=\"panel-note\">Material distribution (pieces)</div>
        ${renderMiniHist(matHist)}
        <div class=\"panel-note\">Phase histogram</div>
        <div class=\"kv-grid\">
          <div class=\"kv-item\"><b>opening</b><span>${safeText(phHist.opening)}</span></div>
          <div class=\"kv-item\"><b>midgame</b><span>${safeText(phHist.midgame)}</span></div>
          <div class=\"kv-item\"><b>endgame</b><span>${safeText(phHist.endgame)}</span></div>
        </div>
      `;
    }
  }

  function renderMiniHist(hist) {
    const h = (hist && typeof hist === "object") ? hist : {};
    const keys = Object.keys(h);
    if (!keys.length) return "<div class=\"panel-note\">—</div>";
    const sorted = keys.sort((a, b) => Number(a) - Number(b));
    const maxBars = 42;
    const step = Math.max(1, Math.ceil(sorted.length / maxBars));
    const pick = sorted.filter((_, i) => i % step === 0);
    let maxV = 1;
    pick.forEach(k => { maxV = Math.max(maxV, Number(h[k] || 0)); });
    const bars = pick.map(k => {
      const v = Number(h[k] || 0);
      const pct = maxV > 0 ? Math.round((v / maxV) * 100) : 0;
      return `<div class=\"mini-bar\" title=\"${k}: ${v}\"><div class=\"mini-bar-fill\" style=\"height:${pct}%\"></div></div>`;
    }).join("");
    return `<div class=\"mini-hist\">${bars}</div>`;
  }

  function renderStability(state) {
    const tm = state.data && state.data.trainingMetrics ? state.data.trainingMetrics : null;
    const es = state.data && state.data.evalSignals ? state.data.evalSignals : null;
    const isoTm = tm && typeof tm.generated_at === "string" ? tm.generated_at : "";
    const isoEs = es && typeof es.generated_at === "string" ? es.generated_at : "";
    const key = `${isoTm}|${isoEs}|${state.loading && state.loading.stability}|${state.error && state.error.stability}`;
    if (ui.stabilityKey === key) return;
    ui.stabilityKey = key;

    if (ui.els.stabilitySummary) {
      if (state.loading && state.loading.stability) ui.els.stabilitySummary.setAttribute("aria-busy", "true");
      else ui.els.stabilitySummary.removeAttribute("aria-busy");
    }
    if (ui.els.evalSignals) {
      if (state.loading && state.loading.stability) ui.els.evalSignals.setAttribute("aria-busy", "true");
      else ui.els.evalSignals.removeAttribute("aria-busy");
    }

    if (ui.els.stabilitySummary) {
      if (state.loading && state.loading.stability) {
        ui.els.stabilitySummary.innerHTML = "<div class=\"panel-note\">loading…</div>";
      } else if (state.error && state.error.stability) {
        ui.els.stabilitySummary.innerHTML = `<div class=\"panel-note\">${state.error.stability}</div>`;
      } else if (!tm && !es) {
        ui.els.stabilitySummary.innerHTML = "<div class=\"panel-note\">No data.</div>";
      } else {
        const stable = tm && typeof tm.stable_for_sprt === "boolean" ? tm.stable_for_sprt : null;
        const stableKind = stable == null ? "" : (stable ? "pill-ok" : "pill-warn");
        const stableTxt = stable == null ? "—" : (stable ? "OPEN" : "CLOSED");
        const reasons = tm && Array.isArray(tm.stable_reasons) ? tm.stable_reasons : [];
        const evalReg = !!(tm && tm.eval_regression) || !!(es && es.regression && es.regression.flag);
        const evalReason = tm && tm.eval_reason ? String(tm.eval_reason) : (es && es.regression && es.regression.reason ? String(es.regression.reason) : "");

        const parts = [];
        parts.push(`<div class=\"kv-item\"><b>Generated</b><span>${safeText(isoTm || isoEs)}</span></div>`);
        if (tm && typeof tm.games === "number") parts.push(`<div class=\"kv-item\"><b>Games</b><span>${safeText(tm.games)}</span></div>`);
        if (tm && typeof tm.loss === "number") parts.push(`<div class=\"kv-item\"><b>Loss</b><span>${fmtNumber(tm.loss, 6)}</span></div>`);
        if (tm && typeof tm.ema_loss === "number") parts.push(`<div class=\"kv-item\"><b>EMA loss</b><span>${fmtNumber(tm.ema_loss, 6)}</span></div>`);
        if (tm && typeof tm.loss_std === "number") parts.push(`<div class=\"kv-item\"><b>Loss std</b><span>${fmtNumber(tm.loss_std, 4)}</span></div>`);
        if (tm && typeof tm.lr === "number") parts.push(`<div class=\"kv-item\"><b>LR</b><span>${fmtNumber(tm.lr, 6)}</span></div>`);
        if (tm && tm.lr_reason) parts.push(`<div class=\"kv-item\"><b>LR reason</b><span>${safeText(tm.lr_reason)}</span></div>`);
        if (tm && typeof tm.curriculum_stage === "number") parts.push(`<div class=\"kv-item\"><b>Curriculum</b><span>${safeText(tm.curriculum_stage)}</span></div>`);
        parts.push(`<div class=\"kv-item\"><b>SPRT gate</b><span class=\"pill ${stableKind}\">${stableTxt}</span></div>`);
        parts.push(`<div class=\"kv-item\"><b>Gate reasons</b><span>${reasons && reasons.length ? reasons.slice(0, 6).join(", ") : "—"}</span></div>`);
        parts.push(`<div class=\"kv-item\"><b>Eval regression</b><span class=\"pill ${evalReg ? "pill-bad" : "pill-ok"}\">${evalReg ? "FLAG" : "OK"}</span></div>`);
        parts.push(`<div class=\"kv-item\"><b>Eval reason</b><span>${evalReg ? (evalReason || "—") : "—"}</span></div>`);
        ui.els.stabilitySummary.innerHTML = parts.join("");
      }
    }

    if (ui.els.evalSignals) {
      if (state.loading && state.loading.stability) {
        ui.els.evalSignals.textContent = "loading…";
        return;
      }
      if (state.error && state.error.stability) {
        ui.els.evalSignals.textContent = state.error.stability;
        return;
      }
      if (!es) {
        ui.els.evalSignals.textContent = "No data.";
        return;
      }

      const reg = es.regression || {};
      const comps = es.comparisons && typeof es.comparisons === "object" ? es.comparisons : {};
      const rows = Object.entries(comps).map(([k, v]) => {
        const wins = v && v.wins != null ? v.wins : "—";
        const losses = v && v.losses != null ? v.losses : "—";
        const draws = v && v.draws != null ? v.draws : "—";
        const elo = (v && typeof v.elo === "number") ? fmtNumber(v.elo, 2) : safeText(v && v.elo);
        return `<div class=\"eval-row\"><b>${k}</b><span>W ${wins} · L ${losses} · D ${draws}</span><span>ELO ${elo}</span></div>`;
      }).join("");

      const pill = reg.flag ? "pill-bad" : "pill-ok";
      const head = `<div class=\"panel-note\">regression: <span class=\"pill ${pill}\">${reg.flag ? "FLAG" : "OK"}</span> ${reg.reason ? `· ${safeText(reg.reason)}` : ""}</div>`;
      ui.els.evalSignals.innerHTML = head + (rows || "<div class=\"panel-note\">No comparisons.</div>");
    }
  }

  function renderRegressions(state) {
    const box = ui.els.regressions;
    if (!box) return;
    box.innerHTML = "";
    const elo = state.data && state.data.elo;
    const versions = (elo && elo.versions) ? elo.versions : {};
    Object.entries(versions).forEach(([v, d]) => {
      if (!d) return;
      if (d.status === "regressed" || d.status === "rejected") {
        const div = document.createElement("div");
        div.className = "regression-item";
        div.innerHTML = `
          <b>${v}</b>
          <span>ELO: ${d.elo}</span>
          <span>Status: ${d.status}</span>
        `;
        box.appendChild(div);
      }
    });
  }

  function renderTop5(state) {
    const box = ui.els.top5;
    if (!box) return;
    box.innerHTML = "";
    const elo = state.data && state.data.elo;
    const top5 = (elo && Array.isArray(elo.top5)) ? elo.top5 : [];
    top5.slice(0, 5).forEach((r) => {
      if (!r) return;
      const div = document.createElement("div");
      div.className = "elo-card";
      div.innerHTML = `
        <b>${r.version}</b>
        <span>ELO: ${r.elo}</span>
        <span>Games: ${r.games}</span>
      `;
      div.onclick = () => actions.openExplain(r.version);
      box.appendChild(div);
    });
  }

  function drawEloChart(state) {
    const canvas = ui.els.eloChart;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = ensureCanvasSize(canvas);
    if (!size) return;

    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, size.widthCss, size.heightCss);

    const elo = state.data && state.data.elo;
    const top5 = (elo && Array.isArray(elo.top5)) ? elo.top5 : [];
    const hist = (state.data && state.data.eloLiveHistory) ? state.data.eloLiveHistory : {};
    if (!top5.length) return;

    const pad = (window.innerWidth <= 520) ? 36 : 50;
    const w = size.widthCss - pad * 2;
    const h = size.heightCss - pad * 2;

    let maxElo = -Infinity;
    let minElo = Infinity;

    top5.forEach(r => {
      const key = r && r.version;
      const series = key ? (hist[key] || []) : [];
      series.forEach(p => {
        maxElo = Math.max(maxElo, p.high);
        minElo = Math.min(minElo, p.low);
      });
      if (typeof r.elo === "number") {
        maxElo = Math.max(maxElo, r.elo);
        minElo = Math.min(minElo, r.elo);
      }
    });
    if (!isFinite(maxElo) || !isFinite(minElo)) return;
    maxElo += 20;
    minElo -= 20;

    if (w < 10 || h < 10) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }

    ctx.save();
    const fontPx = (window.innerWidth <= 520) ? 11 : 12;
    ctx.font = `${fontPx}px Montserrat, sans-serif`;
    ctx.fillStyle = "rgba(190, 210, 230, 0.68)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;

    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const tt = i / ticks;
      const val = Math.round(maxElo - tt * (maxElo - minElo));
      const y = pad + tt * h;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + w, y);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(val), 10, y);
    }
    ctx.restore();

    top5.forEach((r, idx) => {
      const key = r && r.version;
      const series = key ? (hist[key] || []) : [];
      if (!series.length) return;

      const denom = Math.max(1, series.length - 1);

      ctx.beginPath();
      series.forEach((p, i) => {
        const x = pad + (i / denom) * w;
        const y = pad + h - ((p.high - minElo) / (maxElo - minElo)) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      for (let i = series.length - 1; i >= 0; i--) {
        const p = series[i];
        const x = pad + (i / denom) * w;
        const y = pad + h - ((p.low - minElo) / (maxElo - minElo)) * h;
        ctx.lineTo(x, y);
      }
      ctx.fillStyle = "rgba(100,180,255,0.15)";
      ctx.fill();

      ctx.beginPath();
      series.forEach((p, i) => {
        const x = pad + (i / denom) * w;
        const y = pad + h - ((p.elo - minElo) / (maxElo - minElo)) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = `hsl(${idx * 60},70%,70%)`;
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function renderExplain(state) {
    const overlay = ui.els.overlay;
    if (!overlay) return;
    const open = !!(state.ui && state.ui.explain && state.ui.explain.open);
    overlay.classList.toggle("active", open);
    if (!open) return;

    const version = state.ui && state.ui.explain && state.ui.explain.version;
    const elo = state.data && state.data.elo;
    const versions = (elo && elo.versions) ? elo.versions : {};
    const v = version ? versions[version] : null;
    if (!version || !v) return;

    if (ui.els.explainTitle) ui.els.explainTitle.textContent = version;
    if (ui.els.explainElo) ui.els.explainElo.textContent = `= ${v.elo}`;
    if (ui.els.explainGames) ui.els.explainGames.textContent = `= ${v.games}`;
    if (ui.els.explainWins) ui.els.explainWins.textContent = `= ${(v.wins != null) ? v.wins : "—"}`;
    if (ui.els.explainLoss) ui.els.explainLoss.textContent = `= ${(v.loss != null) ? v.loss : "—"}`;
    if (ui.els.explainStatus) ui.els.explainStatus.textContent = `= ${v.status}`;
    if (ui.els.explainSprt) ui.els.explainSprt.textContent = `= ${v.sprt}`;
    if (ui.els.explainConf) {
      const lo = (v.confidence && v.confidence[0] != null) ? v.confidence[0] : v.elo;
      const hi = (v.confidence && v.confidence[1] != null) ? v.confidence[1] : v.elo;
      ui.els.explainConf.textContent = `= ${lo} — ${hi}`;
    }

    let note = "Stable version.";
    if (v.status === "accepted") note = "✔ Statistically better than baseline.";
    if (v.status === "rejected") note = "✖ Failed SPRT or marked bad.";
    if (v.status === "regressed") note = "⚠ Performance regression detected.";
    if (ui.els.explainNote) ui.els.explainNote.textContent = note;
  }

  function renderHeatmapSync(state, meta) {
    if (meta && meta.type === "state/heatmapPhase") {
      postToHeatmap({ type: "heatmap:setPhase", phase: state.activeHeatmapPhase });
      if (state.activeTab === "heatmap") postToHeatmap({ type: "heatmap:rerender" });
    }
  }

  function renderAll(state, meta) {
    setNavActive(state.activeTab);
    if (!ui.tabTransition.inProgress) startTabTransition(state.activeTab);
    renderHealth(state);
    renderOffline(state);
    renderAdmin(state);
    renderOverview(state);
    renderProgress(state);
    renderLogsControls(state);
    if (state.activeTab === "quality") renderQuality(state);
    if (state.activeTab === "stability") renderStability(state);
    if (state.activeTab === "elo") {
      renderTop5(state);
      renderRegressions(state);
      drawEloChart(state);
    }
    renderExplain(state);
    renderHeatmapSync(state, meta);
    if (state.activeTab === "tournaments") renderTournaments(state);
    if (state.activeTab === "logs") renderLogs(state);
  }

  function scheduleRender(state, meta) {
    ui.pendingState = { state, meta };
    if (ui.raf) return;
    ui.raf = requestAnimationFrame(() => {
      ui.raf = 0;
      const p = ui.pendingState;
      ui.pendingState = null;
      if (!p) return;
      renderAll(p.state, p.meta);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    cacheEls();
    bindUIEvents();

    ui.tabTransition.renderedTab = null;
    scheduleRender(store.getState(), { type: "init" });
    store.subscribe((s, meta) => scheduleRender(s, meta));

    // Create garland bulbs dynamically
    function createGarlandBulbs(container) {
      if (container.querySelector('.garland-bulb')) return;
      const rect = container.getBoundingClientRect();
      const width = Math.max(320, rect.width || 0);
      const bulbCount = Math.max(18, Math.min(44, Math.round(width / 26)));

      const palette = [
        '#ff4d4d',
        '#2ee59d',
        '#3b9dff',
        '#ffd166',
        '#fff2cc'
      ];

      const key = (container.className || '').split(/\s+/).sort().join('|');
      let seed = 2166136261;
      for (let i = 0; i < key.length; i++) {
        seed ^= key.charCodeAt(i);
        seed = Math.imul(seed, 16777619);
      }
      function rand() {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return ((seed >>> 0) % 10000) / 10000;
      }

      const offset = Math.floor(rand() * palette.length);

      let delayMode = 'rand';
      let delayStep = 0.12;
      let delayScale = 1.0;
      if (container.classList.contains('garland-overview')) {
        delayMode = 'index';
        delayStep = 0.12;
      } else if (container.classList.contains('garland-heatmap')) {
        delayMode = 'index';
        delayStep = 0.18;
      } else if (container.classList.contains('garland-elo')) {
        delayMode = 'rand';
        delayScale = 1.0;
      } else if (container.classList.contains('garland-tournaments')) {
        delayMode = 'rand';
        delayScale = 0.9;
      } else if (container.classList.contains('garland-logs')) {
        delayMode = 'rand';
        delayScale = 0.8;
      } else if (container.classList.contains('garland-modal')) {
        delayMode = 'rand';
        delayScale = 0.7;
      }

      for (let i = 0; i < bulbCount; i++) {
        const bulb = document.createElement('div');
        bulb.className = 'garland-bulb';

        const p = (i + offset) % palette.length;
        bulb.style.color = palette[p];

        const r = rand();
        bulb.style.setProperty('--i', String(i));
        bulb.style.setProperty('--rand', String(r));

        const delay = delayMode === 'index' ? -(i * delayStep) : -(r * delayScale);
        bulb.style.setProperty('--d', `${delay.toFixed(3)}s`);

        container.appendChild(bulb);
      }
    }

    document
      .querySelectorAll('.tab > .garland-decoration, .explain-card > .garland-decoration')
      .forEach(createGarlandBulbs);

    // SNOW ANIMATION
    const canvas = document.getElementById('snow');
    if (canvas) {
      const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const isCyber = !!(document.documentElement && document.documentElement.classList && document.documentElement.classList.contains('theme-cyber-frost'));
      const ctx = canvas.getContext('2d');
      let W = window.innerWidth, H = window.innerHeight;
      canvas.width = W;
      canvas.height = H;

      window.addEventListener('resize', () => {
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = W;
        canvas.height = H;
      });

      let snowflakes = [];
      function spawnSnow() {
        if (reduceMotion) return;
        while (snowflakes.length < 60) {
          snowflakes.push({
            x: Math.random() * W,
            y: Math.random() * H,
            r: 0.8 + Math.random() * 1.6,
            s: 0.4 + Math.random() * 0.9,
            a: Math.random() * 2 * Math.PI,
            o: 0.22 + Math.random() * 0.28,
            w: 0.15 + Math.random() * 0.35
          });
        }
      }

      function drawLinks(t) {
        if (!isCyber) return;
        const maxDist = Math.min(140, Math.max(90, Math.floor(Math.min(W, H) * 0.18)));
        const maxDist2 = maxDist * maxDist;
        ctx.save();
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
        for (let i = 0; i < snowflakes.length; i++) {
          const a = snowflakes[i];
          for (let j = i + 1; j < snowflakes.length; j++) {
            const b = snowflakes[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > maxDist2) continue;
            const d = Math.sqrt(d2);
            const x = 1 - (d / maxDist);
            const pulse = 0.65 + 0.35 * Math.sin((t / 1400) + a.a + b.a);
            const alpha = Math.max(0, Math.min(0.22, x * 0.22 * pulse));
            if (alpha < 0.02) continue;
            ctx.strokeStyle = `rgba(120, 230, 255, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      function drawSnow() {
        if (reduceMotion) {
          ctx.clearRect(0, 0, W, H);
          return;
        }
        ctx.clearRect(0, 0, W, H);
        const t = Date.now();

        drawLinks(t);

        for (const f of snowflakes) {
          ctx.globalAlpha = f.o;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, 2 * Math.PI);
          ctx.fillStyle = isCyber ? "rgba(235, 252, 255, 0.92)" : "rgba(255,255,255,0.9)";
          ctx.shadowColor = isCyber ? "rgba(90, 235, 255, 0.28)" : "rgba(160, 215, 255, 0.18)";
          ctx.shadowBlur = 1 + 2 * f.r;
          ctx.fill();
          f.y += f.s;
          f.x += Math.sin(t / 5200 + f.a) * f.w;
          if (f.y > H + 4) {
            f.y = -6;
            f.x = Math.random() * W;
          }
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        requestAnimationFrame(drawSnow);
      }

      spawnSnow();
      drawSnow();
    }
  });
})();