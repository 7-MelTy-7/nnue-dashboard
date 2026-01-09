let phase = "opening";
let data = null;

const PHASES = ["opening", "midgame", "endgame"];
let loadInFlight = false;
let pendingRerenderTimer = 0;
let zeroSizeRetries = 0;

let pollTimer = 0;
let isVisible = true;

function unwrapEnvelope(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { api_version: null, payload: raw };
  if (typeof raw.api_version === "string" && ("payload" in raw)) return { api_version: raw.api_version, payload: raw.payload };
  if (typeof raw.apiVersion === "string" && ("payload" in raw)) return { api_version: raw.apiVersion, payload: raw.payload };
  return { api_version: null, payload: raw };
}

function normalizeHeatmapPayload(raw) {
  const env = unwrapEnvelope(raw);
  const p = env.payload;
  if (!p || typeof p !== "object") return { phases: null, colorScale: null };

  if (p && (p.opening || p.midgame || p.endgame)) {
    return {
      phases: {
        opening: Array.isArray(p.opening) ? p.opening : null,
        midgame: Array.isArray(p.midgame) ? p.midgame : null,
        endgame: Array.isArray(p.endgame) ? p.endgame : null
      },
      colorScale: null
    };
  }

  const phases = p.phases || p.phase_data || null;
  const scale = p.color_scale || p.colorScale || null;
  return { phases, colorScale: scale };
}

function getPhaseValues(norm, phaseName) {
  if (!norm) return { rows: 8, cols: 8, values: null };
  const phases = norm.phases;
  if (!phases) return { rows: 8, cols: 8, values: null };

  const p = phases[phaseName];
  if (Array.isArray(p)) {
    return { rows: 8, cols: 8, values: p };
  }
  if (p && typeof p === "object") {
    const rows = (typeof p.rows === "number" && isFinite(p.rows) && p.rows > 0) ? p.rows : 8;
    const cols = (typeof p.cols === "number" && isFinite(p.cols) && p.cols > 0) ? p.cols : 8;
    const values = Array.isArray(p.values) ? p.values : (Array.isArray(p.intensity) ? p.intensity : null);
    return { rows, cols, values };
  }
  return { rows: 8, cols: 8, values: null };
}

function getScaleStops(norm) {
  const s = norm && norm.colorScale;
  const stops = (s && Array.isArray(s.stops)) ? s.stops : null;
  if (stops && stops.length) {
    const out = [];
    for (let i = 0; i < stops.length; i++) {
      const t = stops[i] && typeof stops[i].t === "number" ? stops[i].t : null;
      const c = stops[i] && (stops[i].color || stops[i].c);
      if (t == null) continue;
      if (Array.isArray(c) && c.length >= 3) out.push({ t, c: [c[0], c[1], c[2]] });
      else if (typeof c === "string") out.push({ t, c });
    }
    if (out.length >= 2) return out;
  }
  return [
    { t: 0.0, c: [10, 16, 32] },
    { t: 0.25, c: [20, 52, 120] },
    { t: 0.55, c: [40, 160, 255] },
    { t: 0.78, c: [120, 235, 255] },
    { t: 1.0, c: [255, 220, 120] }
  ];
}

function hasParent() {
  try {
    return window.parent && window.parent !== window;
  } catch {
    return false;
  }
}

function normalizePhase(p) {
  return PHASES.includes(p) ? p : "opening";
}

function setStatus(msg) {
  const el = document.getElementById("hmStatus");
  if (!el) return;
  el.textContent = msg || "";
}

function setActiveButtons() {
  document.querySelectorAll('.hm-btn').forEach(btn => {
    const p = normalizePhase(btn.dataset && btn.dataset.phase ? btn.dataset.phase : "opening");
    btn.classList.toggle('active', p === phase);
  });
}

function setPhase(p) {
  phase = normalizePhase(p);
  setActiveButtons();
  const board = document.getElementById("board");
  if (board) {
    board.classList.add("phase-switch");
    setTimeout(() => {
      render();
      board.classList.remove("phase-switch");
    }, 160);
    return;
  }
  render();
}

function requestPhase(p) {
  const next = normalizePhase(p);
  if (hasParent()) {
    try {
      window.parent.postMessage({ type: 'heatmap:requestPhase', phase: next }, '*');
    } catch {
      return;
    }
    return;
  }
  setPhase(next);
}

async function loadData() {
  if (loadInFlight) return;
  loadInFlight = true;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch("heatmap.json?ts=" + Date.now(), { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      data = null;
      setStatus("Heatmap data unavailable.");
      render();
      return;
    }
    data = await res.json();
    setStatus("");
    render();
  } catch {
    data = null;
    setStatus("Heatmap data unavailable.");
    render();
    return;
  } finally {
    loadInFlight = false;
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(loadData, 2000);
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = 0;
}

function setVisible(v) {
  isVisible = !!v;
  if (isVisible) {
    startPolling();
    loadData();
  } else {
    stopPolling();
  }
}

function render() {
  const board = document.getElementById("board");
  if (!board) return;

  setActiveButtons();

  const rect = board.getBoundingClientRect();
  const tooSmall = rect.width < 10;
  if (tooSmall && zeroSizeRetries < 12) {
    zeroSizeRetries++;
    if (pendingRerenderTimer) clearTimeout(pendingRerenderTimer);
    pendingRerenderTimer = setTimeout(render, 160);
    return;
  }
  zeroSizeRetries = 0;

  const norm = normalizeHeatmapPayload(data);
  const pv = getPhaseValues(norm, phase);
  const rows = pv.rows;
  const cols = pv.cols;
  const values = pv.values;
  const count = Math.max(1, rows * cols);
  const fallbackValues = values && values.length ? values : new Array(count).fill(0);

  board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  board.innerHTML = "";
  const max = Math.max(...fallbackValues) || 1;

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  const scaleStops = getScaleStops(norm);

  function colorFor(t) {
    const x = Math.max(0, Math.min(1, t));
    let s0 = scaleStops[0];
    let s1 = scaleStops[scaleStops.length - 1];
    for (let i = 0; i < scaleStops.length - 1; i++) {
      if (x >= scaleStops[i].t && x <= scaleStops[i + 1].t) {
        s0 = scaleStops[i];
        s1 = scaleStops[i + 1];
        break;
      }
    }
    const tt = (x - s0.t) / Math.max(1e-9, (s1.t - s0.t));
    if (typeof s0.c === "string" || typeof s1.c === "string") {
      return (tt < 0.5) ? String(s0.c) : String(s1.c);
    }
    const r = Math.round(mix(s0.c[0], s1.c[0], tt));
    const g = Math.round(mix(s0.c[1], s1.c[1], tt));
    const b = Math.round(mix(s0.c[2], s1.c[2], tt));
    return `rgb(${r}, ${g}, ${b})`;
  }

  fallbackValues.forEach((v, i) => {
    const sq = document.createElement("div");
    sq.className = "square";
    const intensity = v / max;
    const t = Math.pow(intensity, 0.58);
    sq.style.backgroundColor = colorFor(t);
    if (values) {
      sq.title = `Square ${i}\nVisits: ${v}`;
    } else {
      sq.title = `Square ${i}`;
    }
    board.appendChild(sq);
  });

  if (!values) {
    setStatus("No heatmap data.");
  } else {
    setStatus("");
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.hm-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      requestPhase(btn.dataset && btn.dataset.phase ? btn.dataset.phase : "opening");
    });
  });
  setActiveButtons();
  setStatus("Loading…");
  render();
  loadData();

  if (hasParent()) {
    isVisible = false;
    stopPolling();
    try {
      window.parent.postMessage({ type: 'heatmap:ready' }, '*');
    } catch {
      return;
    }
  } else {
    isVisible = true;
    startPolling();
  }
});

window.addEventListener('resize', () => {
  if (pendingRerenderTimer) clearTimeout(pendingRerenderTimer);
  pendingRerenderTimer = setTimeout(render, 120);
});

window.addEventListener('message', (e) => {
  const t = e && e.data && e.data.type;
  if (t === 'heatmap:setPhase') {
    setPhase(e.data && e.data.phase);
    return;
  }
  if (t === 'heatmap:visibility') {
    setVisible(!!(e.data && e.data.visible));
    return;
  }
  if (t === 'heatmap:show' || t === 'heatmap:rerender') {
    if (pendingRerenderTimer) clearTimeout(pendingRerenderTimer);
    pendingRerenderTimer = setTimeout(render, 80);
  }
});