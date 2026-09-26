// Applies the saved theme before the app renders, so there is no flash of the
// wrong theme. External (not inline) because the CSP forbids inline scripts.
// Keep the key in sync with THEME_KEY in src/lib/theme.tsx.
(function () {
  try {
    var t = localStorage.getItem("werejugo.theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {
    /* storage unavailable: follow the system theme */
  }
})();
