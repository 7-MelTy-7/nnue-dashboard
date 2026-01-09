const $ = id => document.getElementById(id);

document.querySelectorAll("nav button").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    $(btn.dataset.tab).classList.add("active");
  };
});

async function fetchJSON(path) {
  try {
    const r = await fetch(path);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/* ===== STATUS & STATS ===== */
async function updateStatus() {
  const r = await fetch("../train_status.txt");
  if (!r.ok) return;
  const t = await r.text();
  $("status").textContent = t;
  $("status").className = "status " + (t.includes("ACTIVE") ? "active" : "");
}

async function updateStats() {
  const s = await fetchJSON("../train_state.json");
  if (!s) return;
  $("games").textContent = s.games;
  $("loss").textContent = s.loss.toFixed(6);
  $("lr").textContent = s.lr;
  $("time").textContent = Math.round(s.time_min) + " min";
}

/* ===== LOSS GRAPH ===== */
function drawLine(canvas, data, color) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = color;
  ctx.beginPath();
  data.forEach((v,i)=>{
    const x = i/(data.length-1)*canvas.width;
    const y = canvas.height*(1-v);
    if(i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });
  ctx.stroke();
}

async function updateLoss() {
  const d = await fetchJSON("data/loss.json");
  if (!d) return;
  drawLine($("lossChart"), d.map(x=>x.loss), "#2f81f7");
}

/* ===== ELO GRAPH ===== */
async function updateElo() {
  const d = await fetchJSON("data/elo.json");
  if (!d) return;
  drawLine($("eloChart"), d.map(x=>x.elo/400+0.5), "#3fb950");
}

/* ===== HEATMAP ===== */
async function updateHeatmap() {
  const d = await fetchJSON("data/heatmap.json");
  if (!d) return;
  const c = $("heatmapCanvas");
  const ctx = c.getContext("2d");
  const n = d.length;
  const s = c.width / n;
  d.forEach((row,y)=>{
    row.forEach((v,x)=>{
      ctx.fillStyle = `rgba(47,129,247,${Math.abs(v)})`;
      ctx.fillRect(x*s,y*s,s,s);
    });
  });
}

/* ===== TOURNAMENTS ===== */
async function updateTournaments() {
  const d = await fetchJSON("data/tournaments.json");
  if (!d) return;
  $("tournamentList").innerText = JSON.stringify(d,null,2);
}

/* ===== CONTROLS ===== */
$("pause").onclick = () => fetch("../pause.flag",{method:"PUT"});
$("resume").onclick = () => fetch("../pause.flag",{method:"DELETE"});

setInterval(()=>{
  updateStatus();
  updateStats();
  updateLoss();
  updateElo();
  updateHeatmap();
  updateTournaments();
},2000);
