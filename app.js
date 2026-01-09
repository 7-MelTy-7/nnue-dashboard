(function() {
  const REFRESH_MS = 2000;
  const MAX_ELO_POINTS = 60;
  const MAX_LOG_LINES = 5000;
  const PERSIST_MAX_LOG_LINES = 2000;
  const TICK_TIMEOUT_MS = 5000;
  const STORAGE_KEY = "nnue_dashboard_state_v1";
  const API_VERSION = "1.0";

  let dataService = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function unwrapEnvelope(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { api_version: null, payload: raw };
    if (raw && (typeof raw.api_version === "string") && ("payload" in raw)) {
      const v = String(raw.api_version);
      return { api_version: v, payload: raw.payload };
    }
    if (raw && (typeof raw.apiVersion === "string") && ("payload" in raw)) {
      const v = String(raw.apiVersion);
      return { api_version: v, payload: raw.payload };
    }
    return { api_version: null, payload: raw };
  }

  function normalizeTrainingResponse(raw) {
    const env = unwrapEnvelope(raw);
    const p = env.payload;
    if (!p || typeof p !== "object") return p;

    const out = { ...p };

    if (typeof out.learning_rate === "number" && out.lr == null) out.lr = out.learning_rate;
    if (typeof out.learningRate === "number" && out.lr == null) out.lr = out.learningRate;
    if (typeof out.temperature === "number" && out.lr == null) out.lr = out.temperature;

    if (typeof out.progress === "number" && out.progress_percent == null) {
      out.progress_percent = out.progress > 1 ? out.progress / 100 : out.progress;
    }
    if (out.progress && typeof out.progress === "object") {
      if (typeof out.progress.percent === "number" && out.progress_percent == null) out.progress_percent = out.progress.percent;
      if (typeof out.progress.text === "string" && out.progress_text == null) out.progress_text = out.progress.text;
    }
    if (typeof out.progress_pct === "number" && out.progress_percent == null) out.progress_percent = out.progress_pct;
    if (typeof out.percent === "number" && out.progress_percent == null) out.progress_percent = out.percent;

    if (out.status && typeof out.status === "object") {
      if (typeof out.status.text === "string" && out.status_text == null) out.status_text = out.status.text;
      if (typeof out.status.state === "string" && out.status_state == null) out.status_state = out.status.state;
    }
    if (typeof out.status === "string" && out.status_text == null) out.status_text = out.status;

    if (typeof out.phase === "string" && out.current_phase == null) out.current_phase = out.phase;
    if (typeof out.currentPhase === "string" && out.current_phase == null) out.current_phase = out.currentPhase;

    if (typeof out.elapsed_ms === "number" && out.elapsedMs == null) out.elapsedMs = out.elapsed_ms;
    if (typeof out.elapsedMs === "number" && out.elapsed_ms == null) out.elapsed_ms = out.elapsedMs;
    return out;
  }

  function normalizeEloResponse(raw) {
    const env = unwrapEnvelope(raw);
    const p = env.payload;
    if (p && typeof p === "object" && Array.isArray(p.top5) && p.versions) return p;

    if (!p || typeof p !== "object") return p;
    const out = { ...p };

    const top = Array.isArray(p.top) ? p.top : (Array.isArray(p.top5) ? p.top5 : []);
    if (!Array.isArray(out.top5)) out.top5 = [];
    out.top5 = top.slice(0, 5).map((m, idx) => {
      const version = (m && (m.version || m.id || m.name)) ? String(m.version || m.id || m.name) : String(idx + 1);
      const elo = (m && typeof m.elo === "number") ? m.elo : (m && typeof m.rating === "number" ? m.rating : null);
      const games = (m && typeof m.games === "number") ? m.games : (m && typeof m.n_games === "number" ? m.n_games : null);
      const lo = (m && typeof m.ci_low === "number") ? m.ci_low : (m && m.confidence && m.confidence[0] != null ? m.confidence[0] : elo);
      const hi = (m && typeof m.ci_high === "number") ? m.ci_high : (m && m.confidence && m.confidence[1] != null ? m.confidence[1] : elo);
      return {
        version,
        elo: (typeof elo === "number" ? elo : 0),
        games: (typeof games === "number" ? games : 0),
        confidence: [lo, hi]
      };
    });

    if (!isPlainObject(out.versions)) out.versions = {};
    out.top5.forEach((m) => {
      if (!m || !m.version) return;
      if (!out.versions[m.version]) {
        out.versions[m.version] = {
          elo: m.elo,
          games: m.games,
          wins: null,
          loss: null,
          status: "unknown",
          sprt: "—",
          confidence: m.confidence
        };
      }
    });

    return out;
  }

  function normalizeLogsResponse(raw) {
    const env = unwrapEnvelope(raw);
    const p = env.payload;
    if (Array.isArray(p)) return p;
    if (p && typeof p === "object") {
      if (Array.isArray(p.entries)) return p.entries;
      if (Array.isArray(p.lines)) return p.lines;
    }
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") return [raw];
    return [];
  }

  function normalizeTournamentsResponse(raw) {
    const env = unwrapEnvelope(raw);
    const p = env.payload;
    if (Array.isArray(p)) return p;
    if (p && typeof p === "object") {
      if (Array.isArray(p.tournaments)) return p.tournaments;
      if (Array.isArray(p.items)) return p.items;
    }
    if (Array.isArray(raw)) return raw;
    return [];
  }

  function safeJsonParse(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  function safeJsonStringify(v) {
    try {
      return JSON.stringify(v);
    } catch {
      return "";
    }
  }

  function loadPersistedState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = safeJsonParse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function clampInt(x, lo, hi) {
    const n = Number(x);
    if (!isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  }

  function normalizeLogUi(ui) {
    const levelOk = ["all", "info", "warn", "error"];
    const subsystemOk = ["all", "train", "eval", "io", "tournament", "misc"];
    const windowOk = ["latest", "lastN", "all"];
    const out = {
      level: levelOk.includes(ui && ui.level) ? ui.level : "all",
      subsystem: subsystemOk.includes(ui && ui.subsystem) ? ui.subsystem : "all",
      window: windowOk.includes(ui && ui.window) ? ui.window : "latest",
      n: clampInt(ui && ui.n, 50, 2000),
      paused: !!(ui && ui.paused)
    };
    return out;
  }

  function logEntryKey(e) {
    if (typeof e === "string") return e;
    if (!e || typeof e !== "object") return "";
    if (typeof e.key === "string" && e.key) return e.key;
    const ts = (typeof e.ts === "string" && e.ts) ? e.ts : "";
    const lvl = (typeof e.level === "string" && e.level) ? e.level : "INFO";
    const sub = (typeof e.subsystem === "string" && e.subsystem) ? e.subsystem : "MISC";
    const msg = (typeof e.message === "string" && e.message) ? e.message : "";
    return `${ts}|${lvl}|${sub}|${msg}`;
  }

  function parseLogLineHeuristic(line) {
    const s = String(line || "");
    const up = s.toUpperCase();
    let level = "INFO";
    if (up.includes("ERROR") || up.includes("FATAL")) level = "ERROR";
    else if (up.includes("WARN")) level = "WARN";

    let subsystem = "MISC";
    if (up.includes("TOURNAMENT")) subsystem = "TOURNAMENT";
    else if (up.includes("TRAIN")) subsystem = "TRAIN";
    else if (up.includes("EVAL")) subsystem = "EVAL";
    else if (up.includes("IO")) subsystem = "IO";
    return { level, subsystem };
  }

  function normalizeLogEntry(x) {
    if (typeof x === "string") {
      const h = parseLogLineHeuristic(x);
      const e = {
        ts: "",
        level: h.level,
        subsystem: h.subsystem,
        message: x,
        meta: null
      };
      e.key = x;
      e.line = x;
      return e;
    }
    if (!x || typeof x !== "object") return null;

    const ts = (
      (typeof x.ts === "string" && x.ts) ? x.ts :
      (typeof x.timestamp === "string" && x.timestamp) ? x.timestamp :
      (typeof x.time === "string" && x.time) ? x.time :
      ""
    );

    let level = (
      (typeof x.level === "string" && x.level) ? x.level :
      (typeof x.sev === "string" && x.sev) ? x.sev :
      "INFO"
    );
    level = String(level).toUpperCase();
    if (!(["INFO", "WARN", "ERROR"]).includes(level)) level = "INFO";

    let subsystem = (
      (typeof x.subsystem === "string" && x.subsystem) ? x.subsystem :
      (typeof x.source === "string" && x.source) ? x.source :
      (typeof x.module === "string" && x.module) ? x.module :
      "MISC"
    );
    subsystem = String(subsystem).toUpperCase();

    const message = (
      (typeof x.message === "string") ? x.message :
      (typeof x.msg === "string") ? x.msg :
      (typeof x.text === "string") ? x.text :
      ""
    );

    const meta = isPlainObject(x.meta) ? x.meta : (isPlainObject(x.metadata) ? x.metadata : null);

    const e = { ts, level, subsystem, message, meta };
    e.key = logEntryKey(e);
    e.line = `[${ts}] [${level}] [${subsystem}] ${message}`;
    return e;
  }

  function normalizePersistedLogs(arr) {
    const raw = Array.isArray(arr) ? arr : [];
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const e = normalizeLogEntry(raw[i]);
      if (e) out.push(e);
    }
    return out;
  }

  function logsSnapshotDiff(prev, snap) {
    const a = Array.isArray(prev) ? prev : [];
    const b = Array.isArray(snap) ? snap : [];
    if (!b.length) return { mode: "replace", next: [] , appended: [] };
    if (!a.length) return { mode: "replace", next: b.slice(-MAX_LOG_LINES), appended: b.slice(-MAX_LOG_LINES) };

    // Fast path: previous is prefix of snapshot.
    if (b.length >= a.length) {
      let ok = true;
      const lim = a.length;
      for (let i = 0; i < lim; i++) {
        if (logEntryKey(a[i]) !== logEntryKey(b[i])) { ok = false; break; }
      }
      if (ok) {
        const appended = b.slice(lim);
        const next = a.concat(appended).slice(-MAX_LOG_LINES);
        return { mode: appended.length ? "append" : "noop", next, appended: appended.slice(-MAX_LOG_LINES) };
      }
    }

    // Overlap heuristic: find a short tail sequence of previous inside snapshot.
    const maxNeedle = Math.min(12, a.length, b.length);
    for (let k = maxNeedle; k >= 3; k--) {
      const needle = a.slice(-k);
      // Search only near the end (recent logs) to keep this cheap.
      const start = Math.max(0, b.length - 2000);
      for (let i = start; i <= b.length - k; i++) {
        let match = true;
        for (let j = 0; j < k; j++) {
          if (logEntryKey(b[i + j]) !== logEntryKey(needle[j])) { match = false; break; }
        }
        if (match) {
          const appended = b.slice(i + k);
          const base = b.slice(0, i + k);
          const next = base.concat(appended).slice(-MAX_LOG_LINES);
          return { mode: appended.length ? "append" : "noop", next, appended: appended.slice(-MAX_LOG_LINES) };
        }
      }
    }

    // Fallback: treat snapshot as authoritative replacement.
    return { mode: "replace", next: b.slice(-MAX_LOG_LINES), appended: [] };
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function shallowMerge(a, b) {
    const out = { ...a };
    Object.keys(b || {}).forEach(k => {
      const bv = b[k];
      const av = out[k];
      if (isPlainObject(av) && isPlainObject(bv)) out[k] = { ...av, ...bv };
      else out[k] = bv;
    });
    return out;
  }

  function createStore(initialState) {
    let state = initialState;
    const subs = new Set();
    function getState() {
      return state;
    }
    function setState(nextState, meta) {
      if (nextState === state) return;
      state = nextState;
      subs.forEach(fn => {
        try {
          fn(state, meta || {});
        } catch {
          return;
        }
      });
    }
    function update(updater, meta) {
      const next = updater(state);
      setState(next, meta);
    }
    function subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    }
    return { getState, setState, update, subscribe };
  }

  const initialState = {
    activeTab: "overview",
    activeHeatmapPhase: "opening",
    loading: {
      training: false,
      elo: false,
      heatmap: false,
      tournaments: false,
      logs: false
    },
    error: {
      training: null,
      elo: null,
      heatmap: null,
      tournaments: null,
      logs: null
    },
    data: {
      training: null,
      elo: null,
      eloLiveHistory: {},
      tournaments: [],
      logs: [],
      progress: {
        percent: null,
        text: null
      }
    },
    ui: {
      explain: {
        open: false,
        version: null
      },
      logs: {
        level: "all",
        subsystem: "all",
        window: "latest",
        n: 200,
        paused: false
      },
      opened: {
        elo: false,
        heatmap: false,
        tournaments: false,
        logs: false
      }
    },
    meta: {
      sessionStart: {
        training: null
      },
      lastUpdated: {
        training: null,
        elo: null,
        tournaments: null,
        logs: null
      }
    }
  };

  const persisted = loadPersistedState();
  const persistedActiveTab = persisted && persisted.activeTab ? persisted.activeTab : initialState.activeTab;
  const persistedOpened = shallowMerge(initialState.ui.opened, persisted && persisted.ui && persisted.ui.opened ? persisted.ui.opened : {});
  const openedWithActive = shallowMerge(persistedOpened, { [persistedActiveTab]: true });
  const hydrated = shallowMerge(initialState, {
    activeTab: persistedActiveTab,
    activeHeatmapPhase: persisted && persisted.activeHeatmapPhase ? persisted.activeHeatmapPhase : initialState.activeHeatmapPhase,
    data: {
      training: persisted && persisted.data && persisted.data.training ? persisted.data.training : null,
      progress: persisted && persisted.data && persisted.data.progress ? persisted.data.progress : initialState.data.progress,
      logs: normalizePersistedLogs(persisted && persisted.data && persisted.data.logs ? persisted.data.logs : []).slice(-PERSIST_MAX_LOG_LINES)
    },
    ui: {
      logs: normalizeLogUi(persisted && persisted.ui && persisted.ui.logs),
      opened: openedWithActive
    },
    meta: {
      sessionStart: {
        training: persisted && persisted.meta && persisted.meta.sessionStart ? persisted.meta.sessionStart.training : null
      }
    }
  });

  const store = createStore(hydrated);

  const actions = {
    setActiveTab(tab) {
      store.update(s => {
        if (s.activeTab === tab) return s;
        const opened = shallowMerge(s.ui && s.ui.opened ? s.ui.opened : {}, { [tab]: true });
        return shallowMerge(s, { activeTab: tab, ui: { opened } });
      }, { type: "state/activeTab" });
    },

    setHeatmapPhase(phase) {
      store.update(s => {
        if (s.activeHeatmapPhase === phase) return s;
        return { ...s, activeHeatmapPhase: phase };
      }, { type: "state/heatmapPhase" });
    },

    openExplain(version) {
      store.update(s => {
        return shallowMerge(s, {
          ui: {
            explain: {
              open: true,
              version: version
            }
          }
        });
      }, { type: "ui/explainOpen" });
    },

    closeExplain() {
      store.update(s => {
        return shallowMerge(s, {
          ui: {
            explain: {
              open: false,
              version: null
            }
          }
        });
      }, { type: "ui/explainClose" });
    },

    setLogsUi(patch) {
      store.update(s => {
        const prev = s.ui && s.ui.logs ? s.ui.logs : initialState.ui.logs;
        const next = normalizeLogUi(shallowMerge(prev, patch || {}));
        if (safeJsonStringify(prev) === safeJsonStringify(next)) return s;
        return shallowMerge(s, { ui: { logs: next } });
      }, { type: "ui/logs" });
    },

    _setLoading(key, value) {
      store.update(s => shallowMerge(s, { loading: { [key]: !!value } }), {
        type: "data/loading",
        key
      });
    },

    _setError(key, value) {
      store.update(s => shallowMerge(s, { error: { [key]: value || null } }), {
        type: "data/error",
        key
      });
    },

    receiveTraining(payload) {
      store.update(s => {
        const norm = normalizeTrainingResponse(payload);
        const sessionStart = (s.meta && s.meta.sessionStart && s.meta.sessionStart.training) ? s.meta.sessionStart.training : null;
        const nextSessionStart = sessionStart || Date.now();

        let progress = (s.data && s.data.progress) ? s.data.progress : { percent: null, text: null };
        if (norm && typeof norm.progress_percent === "number") {
          const p = norm.progress_percent;
          progress = { percent: Math.max(0, Math.min(1, p)), text: null };
          if (typeof norm.progress_text === "string" && norm.progress_text.trim()) progress.text = norm.progress_text;
        } else if (norm && typeof norm.games === "number") {
          const total = (
            (typeof norm.target_games === "number" && norm.target_games > 0) ? norm.target_games :
            (typeof norm.total_games === "number" && norm.total_games > 0) ? norm.total_games :
            (typeof norm.max_games === "number" && norm.max_games > 0) ? norm.max_games :
            (typeof norm.target === "number" && norm.target > 0) ? norm.target :
            null
          );
          if (total != null) progress = { percent: Math.max(0, Math.min(1, norm.games / total)), text: null };
        }

        return shallowMerge(s, {
          data: { training: norm, progress },
          meta: {
            sessionStart: { training: nextSessionStart },
            lastUpdated: { training: nowIso() }
          }
        });
      }, { type: "data/training" });
    },

    receiveElo(payload) {
      store.update(s => {
        const norm = normalizeEloResponse(payload);
        const live = { ...(s.data.eloLiveHistory || {}) };
        const top5 = Array.isArray(norm && norm.top5) ? norm.top5 : [];
        top5.forEach((r) => {
          const key = r && r.version;
          if (!key) return;
          const prev = Array.isArray(live[key]) ? live[key] : [];
          const point = {
            elo: r.elo,
            low: (r.confidence && r.confidence[0] != null) ? r.confidence[0] : r.elo,
            high: (r.confidence && r.confidence[1] != null) ? r.confidence[1] : r.elo,
            t: Date.now()
          };
          const next = prev.concat([point]).slice(-MAX_ELO_POINTS);
          live[key] = next;
        });
        return shallowMerge(s, {
          data: {
            elo: norm,
            eloLiveHistory: live
          },
          meta: { lastUpdated: { elo: nowIso() } }
        });
      }, { type: "data/elo" });
    },

    receiveOptional(key, payload) {
      store.update(s => {
        return shallowMerge(s, {
          data: { [key]: payload },
          meta: { lastUpdated: { [key]: nowIso() } }
        });
      }, { type: "data/optional", key });
    },

    receiveLogsSnapshot(lines) {
      const raw = Array.isArray(lines) ? lines : [];
      const snap = raw.map(normalizeLogEntry).filter(Boolean);
      store.update(s => {
        const prev = Array.isArray(s.data && s.data.logs) ? s.data.logs : [];
        const diff = logsSnapshotDiff(prev, snap);
        if (diff.mode === "noop") return s;
        return shallowMerge(s, {
          data: { logs: diff.next },
          meta: { lastUpdated: { logs: nowIso() } }
        });
      }, { type: "data/logsSnapshot" });
    },

    setProgress(progress) {
      store.update(s => {
        return shallowMerge(s, { data: { progress: progress } });
      }, { type: "data/progress" });
    }
  };

  // Persist selected viewer state with debounce (for long-running, reload-safe viewing).
  let persistTimer = 0;
  let lastPersistKey = "";

  function buildPersistPayload(s) {
    return {
      activeTab: s.activeTab,
      activeHeatmapPhase: s.activeHeatmapPhase,
      data: {
        training: s.data ? s.data.training : null,
        progress: s.data ? s.data.progress : null,
        logs: Array.isArray(s.data && s.data.logs) ? s.data.logs.slice(-PERSIST_MAX_LOG_LINES) : []
      },
      ui: {
        logs: s.ui && s.ui.logs ? s.ui.logs : initialState.ui.logs,
        opened: s.ui && s.ui.opened ? s.ui.opened : initialState.ui.opened
      },
      meta: {
        sessionStart: {
          training: s.meta && s.meta.sessionStart ? s.meta.sessionStart.training : null
        }
      }
    };
  }

  function persistNow() {
    const s = store.getState();
    const payload = buildPersistPayload(s);
    const nextKey = safeJsonStringify(payload);
    if (!nextKey || nextKey === lastPersistKey) return;
    lastPersistKey = nextKey;
    try {
      localStorage.setItem(STORAGE_KEY, nextKey);
    } catch {
      return;
    }
  }

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = window.setTimeout(() => {
      persistTimer = 0;
      persistNow();
    }, 500);
  }

  store.subscribe((s, meta) => {
    const t = meta && meta.type;
    if (
      t === "state/activeTab" ||
      t === "state/heatmapPhase" ||
      t === "data/training" ||
      t === "data/progress" ||
      t === "data/logsSnapshot" ||
      t === "ui/logs"
    ) {
      schedulePersist();
    }
  });

  window.addEventListener("pagehide", () => {
    try {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = 0;
      }
      persistNow();
    } catch {
      return;
    }
  });

  async function fetchJSON(path, opts) {
    const timeoutMs = (opts && opts.timeoutMs) ? opts.timeoutMs : TICK_TIMEOUT_MS;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(path + "?t=" + Date.now(), { signal: ctrl.signal });
      if (!res.ok) return { ok: false, status: res.status, data: null };
      const json = await res.json();
      return { ok: true, status: res.status, data: json };
    } catch {
      return { ok: false, status: 0, data: null };
    } finally {
      clearTimeout(t);
    }
  }

  function createDataService() {
    let timer = null;
    let inFlight = false;

    let missing = {
      tournaments: 0,
      logs: 0
    };

    async function refreshOnce() {
      if (inFlight) return;
      inFlight = true;
      try {
        const s0 = store.getState();
        actions._setLoading("training", !(s0.data && s0.data.training));
        actions._setLoading("elo", !(s0.data && s0.data.elo) && !!(s0.ui && s0.ui.opened && s0.ui.opened.elo));
        actions._setLoading("tournaments", !(s0.data && Array.isArray(s0.data.tournaments) && s0.data.tournaments.length) && !!(s0.ui && s0.ui.opened && s0.ui.opened.tournaments));
        actions._setLoading("logs", !(s0.data && Array.isArray(s0.data.logs) && s0.data.logs.length) && !!(s0.ui && s0.ui.opened && s0.ui.opened.logs));
        actions._setError("training", null);
        actions._setError("elo", null);
        actions._setError("tournaments", null);
        actions._setError("logs", null);

        const wantElo = !!(s0.ui && s0.ui.opened && s0.ui.opened.elo);
        const wantTournaments = !!(s0.ui && s0.ui.opened && s0.ui.opened.tournaments);
        const wantLogs = !!(s0.ui && s0.ui.opened && s0.ui.opened.logs);

        const reqs = [fetchJSON("data.json")];
        if (wantLogs) reqs.push(fetchJSON("logs.json"));
        if (wantElo) reqs.push(fetchJSON("elo.json"));
        if (wantTournaments) reqs.push(fetchJSON("tournaments.json"));

        const res = await Promise.all(reqs);
        const trainingRes = res[0];
        const logsRes = wantLogs ? res[1] : { ok: false, status: 0, data: null };
        const eloRes = wantElo ? res[wantLogs ? 2 : 1] : { ok: false, status: 0, data: null };
        const tournamentsRes = wantTournaments ? res[(wantLogs ? 1 : 0) + (wantElo ? 2 : 1)] : { ok: false, status: 0, data: null };

        if (trainingRes.ok) actions.receiveTraining(trainingRes.data);
        else if (trainingRes.status !== 404) actions._setError("training", "Training data unavailable.");

        if (wantElo) {
          if (eloRes.ok) actions.receiveElo(eloRes.data);
          else if (eloRes.status !== 404 && eloRes.status !== 0) actions._setError("elo", "ELO data unavailable.");
        }

        if (wantTournaments) {
          if (tournamentsRes.ok) {
            missing.tournaments = 0;
            actions.receiveOptional("tournaments", normalizeTournamentsResponse(tournamentsRes.data));
          } else if (tournamentsRes.status === 404) {
            missing.tournaments++;
          } else if (tournamentsRes.status !== 0) {
            actions._setError("tournaments", "Tournaments data unavailable.");
          }
        }

        if (wantLogs) {
          if (logsRes.ok) {
            missing.logs = 0;
            const lines = normalizeLogsResponse(logsRes.data);
            actions.receiveLogsSnapshot(lines.slice(-MAX_LOG_LINES));
          } else if (logsRes.status === 404) {
            missing.logs++;
          } else if (logsRes.status !== 0) {
            actions._setError("logs", "Logs unavailable.");
          }
        }
      } finally {
        actions._setLoading("training", false);
        actions._setLoading("elo", false);
        actions._setLoading("tournaments", false);
        actions._setLoading("logs", false);
        inFlight = false;
      }
    }

    function start() {
      if (timer) return;
      refreshOnce();
      timer = setInterval(refreshOnce, REFRESH_MS);
    }

    function stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    }

    return { start, stop, refreshOnce };
  }

  dataService = createDataService();

  const NNUE_APP = {
    store,
    actions,
    dataService,
    constants: {
      REFRESH_MS,
      API_VERSION
    }
  };

  window.NNUE_APP = NNUE_APP;

  // Backward-compatible globals used by existing HTML.
  window.closeExplain = () => actions.closeExplain();
  window.openExplain = (version) => actions.openExplain(version);

  // Boot.
  dataService.start();
})();