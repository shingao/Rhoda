// Applies the last palette before the stylesheet loads (no flash at startup).
// Written by src/app/theme.ts; kept tiny and dependency-free on purpose.
(function () {
  try {
    var a = JSON.parse(localStorage.getItem("ursa-theme") || "null");
    if (!a) return;
    var dark = a.mode === "dark" || (a.mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? a.dark : a.light);
  } catch (e) {
    /* default palette */
  }
})();
