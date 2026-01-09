let eloCache = null;
function openExplain(version) {
  if (!eloCache || !eloCache.versions[version]) return;
  const v = eloCache.versions[version];
  document.getElementById("explainTitle").textContent = version;
  document.getElementById("explainElo").textContent = v.elo;
  document.getElementById("explainGames").textContent = v.games;
  document.getElementById("explainStatus").textContent = v.status;
  document.getElementById("explainSprt").textContent = v.sprt;
  document.getElementById("explainConf").textContent =
    v.confidence[0] + " — " + v.confidence[1];
  let note = "Stable version.";
  if (v.status === "accepted") note = "✔ Statistically better than baseline.";
  if (v.status === "rejected") note = "✖ Failed SPRT or marked bad.";
  if (v.status === "regressed") note = "⚠ Performance regression detected.";
  document.getElementById("explainNote").textContent = note;
  document.getElementById("explainOverlay").classList.add("active");
}
function closeExplain() {
  document.getElementById("explainOverlay").classList.remove("active");
}
const oldUpdateTop5 = updateTop5;
updateTop5 = function(container, ratings) {
  container.innerHTML = "";
  ratings.slice(0, 5).forEach(r => {
    const div = document.createElement("div");
    div.className = "elo-card";
    div.innerHTML = `
      <b>${r.version}</b>
      <span>ELO: ${r.elo}</span>
      <span>Games: ${r.games}</span>
    `;
    div.onclick = () => openExplain(r.version);
    container.appendChild(div);
  });
};
async function updateTournaments() {
  const d = await fetchJSON("tournaments.json");
  if (!d) return;
  const box = document.getElementById("tournamentList");
  box.innerHTML = "";
  d.forEach(t => {
    const div = document.createElement("div");
    div.className = "elo-card";
    div.innerHTML = `
      <b>${t.name}</b>
      <span>Games: ${t.games}</span>
      <span>Winner: ${t.winner}</span>
    `;
    box.appendChild(div);
  });
}
const oldTick = tick;
tick = async function() {
  const elo = await loadJSON("elo.json");
  const data = await loadJSON("data.json");
  if (elo) {
    eloCache = elo;
    drawEloChart(
      document.getElementById("eloChart"),
      elo.top5 || []
    );
    updateTop5(document.getElementById("top5"), elo.top5 || []);
  }
  if (data) updateStatus(data.status);
};