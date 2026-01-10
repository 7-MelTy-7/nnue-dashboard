(() => {
  function normalizeTheme(t) {
    const v = (t || "").trim().toLowerCase();
    if (v === "winter") return "winter";
    if (v === "cyber-frost" || v === "cyber_frost" || v === "cyber") return "cyber-frost";
    return "";
  }
  const STORAGE_KEY = "nnue_dashboard_theme";

  function getStoredTheme() {
    try {
      return (localStorage.getItem(STORAGE_KEY) || "").trim();
    } catch {
      return "";
    }
  }

  function setStoredTheme(theme) {
    try {
      if (!theme) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, theme);
    } catch {
    }
  }

  function nextTheme(theme) {
    const t = normalizeTheme(theme);
    if (!t) return "winter";
    if (t === "winter") return "cyber-frost";
    return "";
  }

  function renderToggle(theme) {
    const btn = document.getElementById("themeToggle");
    if (!btn) return;
    const t = normalizeTheme(theme);
    const label = t ? (t === "winter" ? "Winter" : "Cyber-Frost") : "Default";
    const mobile = (() => {
      try {
        return window.matchMedia && window.matchMedia("(max-width: 720px)").matches;
      } catch {
        return true;
      }
    })();
    if (mobile) btn.textContent = t === "winter" ? "❄️" : (t === "cyber-frost" ? "🌌" : "UI");
    else btn.textContent = `UI: ${label}`;
    btn.title = `UI Theme: ${label}`;
    btn.setAttribute("aria-label", `UI Theme: ${label}`);
    btn.dataset.theme = t || "default";
  }

  function init() {
    const cur = normalizeTheme(getStoredTheme());
    renderToggle(cur);

    const btn = document.getElementById("themeToggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const now = normalizeTheme(getStoredTheme());
      const nxt = nextTheme(now);
      setStoredTheme(nxt);
      window.location.reload();
    }, { passive: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
