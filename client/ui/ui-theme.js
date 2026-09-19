// Runs in <head>, before styles are painted. The old CSS remains intact:
// ?ui=legacy disables only the new presentation layer, with no saved preference.
(() => {
  const theme = new URLSearchParams(window.location.search).get("ui") === "legacy" ? "legacy" : "club";
  document.documentElement.dataset.uiTheme = theme;
})();
