(function() {
  const app = window.NNUE_APP;
  if (!app || !app.store || !app.actions) return;

  const { store, actions } = app;

  const MAX_LOG_DOM_NODES = 1200;

  function normalizeTab(t) {
    const ok = ["overview", "elo", "heatmap", "tournaments", "logs"];
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

  function byId(id) {
    return document.getElementById(id);
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
    iframe.src = "heatmap.html";
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
      el.textContent = "loading…";
      return;
    }
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
      el.textContent = "loading…";
      return;
    }
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
    raf: 0,
    pendingState: null,
    els: null
  };

  function cacheEls() {
    ui.els = {
      navButtons: Array.from(document.querySelectorAll(".top-nav button")),
      tabs: Array.from(document.querySelectorAll(".tab")),
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
      games: byId("games"),
      loss: byId("loss"),
      lr: byId("lr"),
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
      logPause: byId("logPause")
    };
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
    if (ui.els.games) ui.els.games.textContent = (d && typeof d.games === "number") ? String(d.games) : "—";
    if (ui.els.loss) ui.els.loss.textContent = (d && typeof d.loss === "number") ? fmtNumber(d.loss, 6) : "—";
    if (ui.els.lr) ui.els.lr.textContent = (d && typeof d.lr === "number") ? fmtNumber(d.lr, 6) : "—";
    if (ui.els.time) {
      const start = state.meta && state.meta.sessionStart && state.meta.sessionStart.training;
      ui.els.time.textContent = start ? formatDuration(Date.now() - start) : "—";
    }

    if (ui.els.statusText) {
      if (state.error && state.error.training) ui.els.statusText.textContent = state.error.training;
      else if (d && typeof d.status_text === "string") ui.els.statusText.textContent = d.status_text;
      else if (d && typeof d.status === "string") ui.els.statusText.textContent = d.status;
      else if (state.loading && state.loading.training) ui.els.statusText.textContent = "loading…";
      else ui.els.statusText.textContent = "—";
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
    renderOverview(state);
    renderProgress(state);
    renderLogsControls(state);
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

      function drawSnow() {
        if (reduceMotion) {
          ctx.clearRect(0, 0, W, H);
          return;
        }
        ctx.clearRect(0, 0, W, H);
        const t = Date.now();
        for (const f of snowflakes) {
          ctx.globalAlpha = f.o;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, 2 * Math.PI);
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.shadowColor = "rgba(160, 215, 255, 0.18)";
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