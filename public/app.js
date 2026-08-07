// Phase 2C: single self-hosted, self-contained progressive-enhancement
// script (no build step, no framework). Loaded only on pages that need it
// via Layout's `bodyExtra` slot. Every feature here degrades gracefully —
// the page must already be fully usable with this file absent.
//
// Copy-to-clipboard: any `<button data-copy-target="some-id">` copies the
// `textContent` of the element with that id. The citation `<pre>`/`<p>`
// blocks it targets are always server-rendered in full, so this script only
// adds a convenience action on top of text that's already visible and
// selectable without JS.
(function () {
  "use strict";

  function flashButton(button, message, revertMs) {
    var original = button.textContent;
    button.textContent = message;
    button.disabled = true;
    setTimeout(function () {
      button.textContent = original;
      button.disabled = false;
    }, revertMs);
  }

  function copyFromTarget(button) {
    var targetId = button.getAttribute("data-copy-target");
    var target = targetId ? document.getElementById(targetId) : null;
    if (!target) return;
    var text = target.textContent || "";

    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      flashButton(button, "Copy unsupported", 1500);
      return;
    }

    navigator.clipboard.writeText(text).then(
      function () {
        flashButton(button, "Copied!", 1500);
      },
      function () {
        flashButton(button, "Copy failed", 1500);
      },
    );
  }

  document.addEventListener("click", function (event) {
    var button = event.target && event.target.closest
      ? event.target.closest("[data-copy-target]")
      : null;
    if (button) copyFromTarget(button);
  });
})();
