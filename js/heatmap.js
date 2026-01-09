let phase = "opening";
let data = null;

function setPhase(p) {
  phase = p;
  render();
}

async function loadData() {
  const res = await fetch("heatmap.json?ts=" + Date.now());
  data = await res.json();
  render();
}

function render() {
  const board = document.getElementById("board");
  board.innerHTML = "";

  const values = data[phase];
  const max = Math.max(...values) || 1;

  values.forEach((v, i) => {
    const sq = document.createElement("div");
    sq.className = "square";
    const intensity = v / max;

    sq.style.backgroundColor = `rgba(255,80,0,${intensity})`;
    sq.title = `Square ${i}\nVisits: ${v}`;

    sq.onclick = () => {
      alert(`Square ${i}\nPhase: ${phase}\nVisits: ${v}`);
    };

    board.appendChild(sq);
  });
}

loadData();
setInterval(loadData, 2000);
