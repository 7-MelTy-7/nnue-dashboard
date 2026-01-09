let phase = "opening";
let data = null;

const PHASES = ["opening", "midgame", "endgame"];
let loadInFlight = false;
let pendingRerenderTimer = 0;
let zeroSizeRetries = 0;

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

  const values = (data && data[phase] && Array.isArray(data[phase])) ? data[phase] : null;
  const fallbackValues = values && values.length ? values : new Array(64).fill(0);

  board.innerHTML = "";
  const max = Math.max(...fallbackValues) || 1;

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  function colorFor(t) {
    const x = Math.max(0, Math.min(1, t));
    const stops = [
      { t: 0.0, c: [10, 16, 32] },
      { t: 0.25, c: [20, 52, 120] },
      { t: 0.55, c: [40, 160, 255] },
      { t: 0.78, c: [120, 235, 255] },
      { t: 1.0, c: [255, 220, 120] }
    ];
    let s0 = stops[0];
    let s1 = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (x >= stops[i].t && x <= stops[i + 1].t) {
        s0 = stops[i];
        s1 = stops[i + 1];
        break;
      }
    }
    const tt = (x - s0.t) / Math.max(1e-9, (s1.t - s0.t));
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
    try {
      window.parent.postMessage({ type: 'heatmap:ready' }, '*');
    } catch {
      return;
    }
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
  if (t === 'heatmap:show' || t === 'heatmap:rerender') {
    if (pendingRerenderTimer) clearTimeout(pendingRerenderTimer);
    pendingRerenderTimer = setTimeout(render, 80);
  }
});

setInterval(loadData, 2000);