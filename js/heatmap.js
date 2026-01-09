let phase = "opening";
let data = null;

function setPhase(p) {
  phase = p;
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
  try {
    const res = await fetch("heatmap.json?ts=" + Date.now());
    if (!res.ok) return;
    data = await res.json();
    render();
  } catch {
    return;
  }
}

function render() {
  const board = document.getElementById("board");
  if (!board || !data || !data[phase]) return;
  board.innerHTML = "";
  const values = data[phase];
  const max = Math.max(...values) || 1;
  values.forEach((v, i) => {
    const sq = document.createElement("div");
    sq.className = "square";
    const intensity = v / max;
    const t = Math.pow(intensity, 0.72);
    const alpha = 0.06 + 0.62 * t;
    sq.style.backgroundColor = `rgba(90, 185, 255, ${alpha})`;
    sq.title = `Square ${i}\nVisits: ${v}`;
    sq.onclick = () => {
      alert(`Square ${i}\nPhase: ${phase}\nVisits: ${v}`);
    };
    board.appendChild(sq);
  });
  document.querySelectorAll('.hm-btn').forEach(btn => {
    const p = (btn.dataset && btn.dataset.phase) ? btn.dataset.phase : btn.textContent.toLowerCase();
    const isActive = (p.includes('opening') && phase === 'opening') ||
                     (p.includes('midgame') && phase === 'midgame') ||
                     (p.includes('endgame') && phase === 'endgame');
    btn.classList.toggle('active', isActive);
  });
}

loadData();
setInterval(loadData, 2000);