const REFRESH_MS = 2000;
let eloHistory = {};

async function loadJSON(path) {
  try {
    const r = await fetch(path + "?t=" + Date.now());
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function drawEloChart(canvas, ratings) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!ratings || !ratings.length) return;
  const pad = 50;
  const w = canvas.width - pad * 2;
  const h = canvas.height - pad * 2;
  const elos = ratings.map(r => r.elo);
  const maxElo = Math.max(...elos) + 20;
  const minElo = Math.min(...elos) - 20;
  ratings.forEach((r, idx) => {
    if (!eloHistory[r.version]) eloHistory[r.version] = [];
    eloHistory[r.version].push({
      elo: r.elo,
      low: r.confidence?.[0] ?? r.elo,
      high: r.confidence?.[1] ?? r.elo
    });
    eloHistory[r.version] = eloHistory[r.version].slice(-60);
    ctx.beginPath();
    eloHistory[r.version].forEach((p,i)=>{
      const x = pad + (i/59)*w;
      const y = pad + h - ((p.high-minElo)/(maxElo-minElo))*h;
      if(i===0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    });
    for(let i=eloHistory[r.version].length-1;i>=0;i--){
      const p = eloHistory[r.version][i];
      const x = pad + (i/59)*w;
      const y = pad + h - ((p.low-minElo)/(maxElo-minElo))*h;
      ctx.lineTo(x,y);
    }
    ctx.fillStyle = "rgba(100,180,255,0.15)";
    ctx.fill();
    ctx.beginPath();
    eloHistory[r.version].forEach((p,i)=>{
      const x = pad + (i/59)*w;
      const y = pad + h - ((p.elo-minElo)/(maxElo-minElo))*h;
      if(i===0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    });
    ctx.strokeStyle = `hsl(${idx*60},70%,70%)`;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function updateRegressions(elo) {
  const box = document.getElementById("regressions");
  if (!box) return;
  box.innerHTML = "";
  Object.entries(elo.versions || {}).forEach(([v,d])=>{
    if (d.status === "regressed" || d.status === "rejected") {
      const div = document.createElement("div");
      div.className = "regression-item";
      div.innerHTML = `
        <b>${v}</b>
        <span>ELO: ${d.elo}</span>
        <span>Status: ${d.status}</span>
      `;
      box.appendChild(div);
    }
  });
}

async function tick() {
  const elo = await loadJSON("elo.json");
  const data = await loadJSON("data.json");
  if (elo) {
    drawEloChart(document.getElementById("eloChart"), elo.top5 || []);
    if (typeof updateTop5 === "function") updateTop5(document.getElementById("top5"), elo.top5 || []);
    updateRegressions(elo);
  }
  if (data && typeof updateStatus === "function") updateStatus(data.status);
}
setInterval(tick, REFRESH_MS);
tick();

document.addEventListener('DOMContentLoaded', () => {
  if (window._newyearDecorLoaded) return;
  window._newyearDecorLoaded = true;

  function notifyHeatmap(type) {
    const frame = document.querySelector('iframe.embed-heatmap');
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ type: type || 'heatmap:rerender' }, '*');
    } catch {
      return;
    }
  }
  
  document.querySelectorAll('.top-nav button').forEach(btn => {
    btn.style.pointerEvents = 'auto';
    btn.tabIndex = 0;
  });
  
  const tabButtons = document.querySelectorAll('.top-nav button');
  const tabs = document.querySelectorAll('.tab');
  
  tabButtons.forEach(btn => {
    btn.removeEventListener?.('click', tabClick);
    btn.addEventListener('click', tabClick, { once: false });
  });
  
  function tabClick(e) {
    e.preventDefault();
    const target = this.getAttribute('data-tab');
    const currentTab = document.querySelector('.tab.active');
    if (currentTab && currentTab.id === target) return;

    tabButtons.forEach(btn => (btn.disabled = true));

    if (currentTab) {
      currentTab.classList.add('leaving');
      setTimeout(() => {
        currentTab.classList.remove('active');
        currentTab.classList.remove('leaving');

        tabButtons.forEach(b => b.classList.remove('active'));
        this.classList.add('active');

        tabs.forEach(tab => {
          if (tab.id === target) tab.classList.add('active');
          else tab.classList.remove('active');
        });

        if (target === 'heatmap') {
          setTimeout(() => notifyHeatmap('heatmap:show'), 60);
        }

        setTimeout(() => {
          tabButtons.forEach(btn => (btn.disabled = false));
        }, 30);
      }, 360);
      return;
    }

    tabButtons.forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    tabs.forEach(tab => {
      if (tab.id === target) tab.classList.add('active');
      else tab.classList.remove('active');
    });

    if (target === 'heatmap') {
      setTimeout(() => notifyHeatmap('heatmap:show'), 60);
    }
    setTimeout(() => {
      tabButtons.forEach(btn => (btn.disabled = false));
    }, 30);
  }
  
  // Create garland bulbs dynamically
  function createGarlandBulbs(container) {
    if (container.querySelector('.garland-bulb')) return;
    const rect = container.getBoundingClientRect();
    const width = Math.max(320, rect.width || 0);
    const bulbCount = Math.max(18, Math.min(44, Math.round(width / 26)));

    const palette = [
      '#ff4d4d',
      '#2ee59d',
      '#3b9dff',
      '#ffd166',
      '#fff2cc'
    ];

    const key = (container.className || '').split(/\s+/).sort().join('|');
    let seed = 2166136261;
    for (let i = 0; i < key.length; i++) {
      seed ^= key.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }
    function rand() {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) % 10000) / 10000;
    }

    const offset = Math.floor(rand() * palette.length);

    let delayMode = 'rand';
    let delayStep = 0.12;
    let delayScale = 1.0;
    if (container.classList.contains('garland-overview')) {
      delayMode = 'index';
      delayStep = 0.12;
    } else if (container.classList.contains('garland-heatmap')) {
      delayMode = 'index';
      delayStep = 0.18;
    } else if (container.classList.contains('garland-elo')) {
      delayMode = 'rand';
      delayScale = 1.0;
    } else if (container.classList.contains('garland-tournaments')) {
      delayMode = 'rand';
      delayScale = 0.9;
    } else if (container.classList.contains('garland-logs')) {
      delayMode = 'rand';
      delayScale = 0.8;
    } else if (container.classList.contains('garland-modal')) {
      delayMode = 'rand';
      delayScale = 0.7;
    }

    for (let i = 0; i < bulbCount; i++) {
      const bulb = document.createElement('div');
      bulb.className = 'garland-bulb';

      const p = (i + offset) % palette.length;
      bulb.style.color = palette[p];

      const r = rand();
      bulb.style.setProperty('--i', String(i));
      bulb.style.setProperty('--rand', String(r));

      const delay = delayMode === 'index' ? -(i * delayStep) : -(r * delayScale);
      bulb.style.setProperty('--d', `${delay.toFixed(3)}s`);

      container.appendChild(bulb);
    }
  }
  
  document
    .querySelectorAll('.tab > .garland-decoration, .explain-card > .garland-decoration')
    .forEach(createGarlandBulbs);

  window.addEventListener('resize', () => {
    const activeTab = document.querySelector('.tab.active');
    if (activeTab && activeTab.id === 'heatmap') notifyHeatmap('heatmap:rerender');
  });
  
  // SNOW ANIMATION
  const canvas = document.getElementById('snow');
  if (canvas) {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx = canvas.getContext('2d');
    let W = window.innerWidth, H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;
    
    window.addEventListener('resize', () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W;
      canvas.height = H;
    });
    
    let snowflakes = [];
    function spawnSnow() {
      if (reduceMotion) return;
      while (snowflakes.length < 60) {
        snowflakes.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: 0.8 + Math.random() * 1.6,
          s: 0.4 + Math.random() * 0.9,
          a: Math.random() * 2 * Math.PI,
          o: 0.22 + Math.random() * 0.28,
          w: 0.15 + Math.random() * 0.35
        });
      }
    }
    
    function drawSnow() {
      if (reduceMotion) {
        ctx.clearRect(0, 0, W, H);
        return;
      }
      ctx.clearRect(0, 0, W, H);
      const t = Date.now();
      for (const f of snowflakes) {
        ctx.globalAlpha = f.o;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.shadowColor = "rgba(160, 215, 255, 0.18)";
        ctx.shadowBlur = 1 + 2 * f.r;
        ctx.fill();
        f.y += f.s;
        f.x += Math.sin(t / 5200 + f.a) * f.w;
        if (f.y > H + 4) {
          f.y = -6;
          f.x = Math.random() * W;
        }
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      requestAnimationFrame(drawSnow);
    }
    
    spawnSnow();
    drawSnow();
  }
});