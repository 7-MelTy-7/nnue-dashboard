(function() {
  const REFRESH_MS = 2000;
  const MAX_ELO_POINTS = 60;
  const MAX_LOG_LINES = 1000;
  const TICK_TIMEOUT_MS = 5000;

  // Demo mode is OFF by default and not persisted.
  // This prevents any fake "training/logging" behavior from starting implicitly on page load/reload.
  let dataService = null;

  function nowIso() {
    return new Date().toISOString();
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
      demo: {
        enabled: false
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

  const store = createStore(initialState);

  const actions = {
    setActiveTab(tab) {
      store.update(s => {
        if (s.activeTab === tab) return s;
        return { ...s, activeTab: tab };
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

    setDemoMode(enabled) {
      const on = !!enabled;
      store.update(s => {
        const prev = !!(s.ui && s.ui.demo && s.ui.demo.enabled);
        if (prev === on) return s;
        return shallowMerge(s, { ui: { demo: { enabled: on } } });
      }, { type: "ui/demoMode" });
      if (dataService && typeof dataService.setDemoMode === "function") dataService.setDemoMode(on);
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
        const sessionStart = (s.meta && s.meta.sessionStart && s.meta.sessionStart.training) ? s.meta.sessionStart.training : null;
        const nextSessionStart = sessionStart || Date.now();

        let progress = (s.data && s.data.progress) ? s.data.progress : { percent: null, text: null };
        if (payload && typeof payload.progress === "number") {
          const p = payload.progress > 1 ? payload.progress / 100 : payload.progress;
          progress = { percent: Math.max(0, Math.min(1, p)), text: null };
        } else if (payload && typeof payload.games === "number") {
          const total = (
            (typeof payload.target_games === "number" && payload.target_games > 0) ? payload.target_games :
            (typeof payload.total_games === "number" && payload.total_games > 0) ? payload.total_games :
            (typeof payload.max_games === "number" && payload.max_games > 0) ? payload.max_games :
            (typeof payload.target === "number" && payload.target > 0) ? payload.target :
            null
          );
          if (total != null) progress = { percent: Math.max(0, Math.min(1, payload.games / total)), text: null };
        }

        return shallowMerge(s, {
          data: { training: payload, progress },
          meta: {
            sessionStart: { training: nextSessionStart },
            lastUpdated: { training: nowIso() }
          }
        });
      }, { type: "data/training" });
    },

    receiveElo(payload) {
      store.update(s => {
        const live = { ...(s.data.eloLiveHistory || {}) };
        const top5 = Array.isArray(payload && payload.top5) ? payload.top5 : [];
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
            elo: payload,
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

    appendLogLines(lines) {
      const list = Array.isArray(lines) ? lines : [];
      if (!list.length) return;
      store.update(s => {
        const prev = Array.isArray(s.data && s.data.logs) ? s.data.logs : [];
        const next = prev.concat(list).slice(-MAX_LOG_LINES);
        return shallowMerge(s, {
          data: { logs: next },
          meta: { lastUpdated: { logs: nowIso() } }
        });
      }, { type: "data/logsAppend" });
    },

    setProgress(progress) {
      store.update(s => {
        return shallowMerge(s, { data: { progress: progress } });
      }, { type: "data/progress" });
    }
  };

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
    let mockTimer = null;

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
        actions._setLoading("elo", !(s0.data && s0.data.elo));
        actions._setLoading("tournaments", !(s0.data && Array.isArray(s0.data.tournaments) && s0.data.tournaments.length));
        actions._setLoading("logs", !(s0.data && Array.isArray(s0.data.logs) && s0.data.logs.length));
        actions._setError("training", null);
        actions._setError("elo", null);
        actions._setError("tournaments", null);
        actions._setError("logs", null);

        const [trainingRes, eloRes, tournamentsRes, logsRes] = await Promise.all([
          fetchJSON("data.json"),
          fetchJSON("elo.json"),
          fetchJSON("tournaments.json"),
          fetchJSON("logs.json")
        ]);

        if (trainingRes.ok) actions.receiveTraining(trainingRes.data);
        else if (trainingRes.status !== 404) actions._setError("training", "Training data unavailable.");

        if (eloRes.ok) actions.receiveElo(eloRes.data);
        else if (eloRes.status !== 404) actions._setError("elo", "ELO data unavailable.");

        if (tournamentsRes.ok) {
          missing.tournaments = 0;
          actions.receiveOptional("tournaments", Array.isArray(tournamentsRes.data) ? tournamentsRes.data : []);
        } else if (tournamentsRes.status === 404) {
          missing.tournaments++;
        } else {
          actions._setError("tournaments", "Tournaments data unavailable.");
        }

        if (logsRes.ok) {
          missing.logs = 0;
          const lines = Array.isArray(logsRes.data) ? logsRes.data : (typeof logsRes.data === "string" ? [logsRes.data] : []);
          actions.receiveOptional("logs", lines.slice(-MAX_LOG_LINES));
        } else if (logsRes.status === 404) {
          missing.logs++;
        } else {
          actions._setError("logs", "Logs unavailable.");
        }
      } finally {
        actions._setLoading("training", false);
        actions._setLoading("elo", false);
        actions._setLoading("tournaments", false);
        actions._setLoading("logs", false);
        inFlight = false;
      }
    }

    function startMockStreams() {
      if (mockTimer) return;
      let pct = 0;
      mockTimer = setInterval(() => {
        const s = store.getState();

        const demo = !!(s.ui && s.ui.demo && s.ui.demo.enabled);
        if (!demo) return;

        if (missing.logs > 2) {
          const ts = new Date().toLocaleTimeString();
          actions.appendLogLines([`[DEMO ${ts}] TRAIN step=${Math.floor(Math.random() * 50000)} loss=${(0.3 + Math.random() * 0.08).toFixed(4)}`]);
        }

        if (missing.tournaments > 2) {
          const t = Array.isArray(s.data && s.data.tournaments) ? s.data.tournaments : [];
          if (t.length === 0) {
            actions.receiveOptional("tournaments", [
              { name: "Mock Cup A", games: 120, winner: "nnue_v1" },
              { name: "Mock Cup B", games: 80, winner: "nnue_v2" }
            ]);
          }
        }

        if (!s.data || !s.data.progress || s.data.progress.percent == null) {
          pct = Math.min(1, pct + 0.004);
          actions.setProgress({ percent: pct, text: "DEMO" });
        }
      }, 900);
    }

    function stopMockStreams() {
      if (!mockTimer) return;
      clearInterval(mockTimer);
      mockTimer = null;
    }

    function setDemoMode(enabled) {
      if (enabled) startMockStreams();
      else stopMockStreams();
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
      stopMockStreams();
    }

    return { start, stop, refreshOnce, setDemoMode };
  }

  dataService = createDataService();

  const NNUE_APP = {
    store,
    actions,
    dataService,
    constants: {
      REFRESH_MS
    }
  };

  window.NNUE_APP = NNUE_APP;

  // Backward-compatible globals used by existing HTML.
  window.closeExplain = () => actions.closeExplain();
  window.openExplain = (version) => actions.openExplain(version);

  // Boot.
  dataService.start();
})();