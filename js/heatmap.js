let phase = "opening";
let data = null;

const PHASES = ["opening", "midgame", "endgame"];
let loadInFlight = false;
let pendingRerenderTimer = 0;
let zeroSizeRetries = 0;

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
  fallbackValues.forEach((v, i) => {
    const sq = document.createElement("div");
    sq.className = "square";
    const intensity = v / max;
    const t = Math.pow(intensity, 0.72);
    const alpha = 0.06 + 0.62 * t;
    sq.style.backgroundColor = `rgba(90, 185, 255, ${alpha})`;
    if (values) {
      sq.title = `Square ${i}\nVisits: ${v}`;
      sq.onclick = () => {
        alert(`Square ${i}\nPhase: ${phase}\nVisits: ${v}`);
      };
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
      setPhase(btn.dataset && btn.dataset.phase ? btn.dataset.phase : "opening");
    });
  });
  setActiveButtons();
  setStatus("Loading…");
  render();
  loadData();
});

window.addEventListener('resize', () => {
  if (pendingRerenderTimer) clearTimeout(pendingRerenderTimer);
  pendingRerenderTimer = setTimeout(render, 120);
});

window.addEventListener('message', (e) => {
  const t = e && e.data && e.data.type;
  if (t === 'heatmap:show' || t === 'heatmap:rerender') {
    if (pendingRerenderTimer) clearTimeout(pendingRerenderTimer);
    pendingRerenderTimer = setTimeout(render, 80);
  }
});

setInterval(loadData, 2000);