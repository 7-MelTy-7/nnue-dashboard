// plots/app.js

const REFRESH_MS = 2000;

let eloHistory = {};

// ================== UTILS ==================
async function loadJSON(path) {
  try {
    const r = await fetch(path + "?t=" + Date.now());
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.warn("Failed to load", path, e);
    return null;
  }
}

// ================== ELO CHART ==================
function drawEloChart(canvas, ratings) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const padding = 30;
  const w = canvas.width - padding * 2;
  const h = canvas.height - padding * 2;

  const elos = ratings.map(r => r.elo);
  const maxElo = Math.max(...elos) + 10;
  const minElo = Math.min(...elos) - 10;

  ratings.forEach((r, idx) => {
    if (!eloHistory[r.version]) eloHistory[r.version] = [];
    eloHistory[r.version].push(r.elo);
    eloHistory[r.version] = eloHistory[r.version].slice(-50);

    ctx.strokeStyle = `hsl(${idx * 55},70%,60%)`;
    ctx.lineWidth = 2;
    ctx.beginPath();

    eloHistory[r.version].forEach((elo, i) => {
      const x = padding + (i / 49) * w;
      const y = padding + h - ((elo - minElo) / (maxElo - minElo)) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
  });

  // axis
  ctx.strokeStyle = "#333";
  ctx.strokeRect(padding, padding, w, h);
}

// ================== TOP 5 ==================
function updateTop5(container, ratings) {
  container.innerHTML = "";
  ratings.slice(0, 5).forEach(r => {
    const div = document.createElement("div");
    div.className = "elo-card";
    div.innerHTML = `
      <b>${r.version}</b>
      <span>ELO: ${r.elo.toFixed(1)}</span>
      <span>Games: ${r.games ?? "-"}</span>
      <span class="decision">${r.decision ?? ""}</span>
    `;
    div.onclick = () =>
      alert(
        `Version: ${r.version}\n` +
        `ELO: ${r.elo}\n` +
        `Games: ${r.games}\n` +
        `Decision: ${r.decision ?? "N/A"}`
      );
    container.appendChild(div);
  });
}

// ================== TRAIN STATUS ==================
function updateTrainingStatus(data) {
  if (!data) return;

  const el = document.getElementById("trainStatus");
  if (!el) return;

  el.textContent = data.status ?? "UNKNOWN";
  el.className = "status";

  if (data.status?.includes("ACTIVE")) el.classList.add("active");
  if (data.status?.includes("PAUSED")) el.classList.add("paused");
  if (data.status?.includes("SAVING")) el.classList.add("saving");
}

// ================== PHASE ==================
function trainingPhase(games) {
  if (games < 0.3) return "OPENING";
  if (games < 0.7) return "MIDGAME";
  return "ENDGAME";
}

// ================== MAIN TICK ==================
async function tick() {
  const elo = await loadJSON("elo.json");
  const data = await loadJSON("data.json");

  console.log("[TICK]", { elo, data });

  if (elo?.ratings) {
    const canvas = document.getElementById("eloChart");
    drawEloChart(canvas, elo.ratings);
    updateTop5(document.getElementById("top5"), elo.ratings);
  }

  if (data) {
    updateTrainingStatus(data);

    const phaseEl = document.getElementById("phase");
    if (phaseEl) {
      phaseEl.textContent = trainingPhase(
        (data.games ?? 0) / (data.max_games ?? 1)
      );
    }
  }
}

// ================== LOOP ==================
setInterval(tick, REFRESH_MS);
tick();

console.log("NNUE dashboard loaded");
