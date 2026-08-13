// Phase 2C/2D: single self-hosted, self-contained progressive-enhancement
// script (no build step, no framework), loaded site-wide via Layout. Every
// feature here degrades gracefully — every page must already be fully
// usable with this file absent.
//
// Copy-to-clipboard: any `<button data-copy-target="some-id">` copies the
// `textContent` of the element with that id. The citation `<pre>`/`<p>`
// blocks it targets are always server-rendered in full, so this script only
// adds a convenience action on top of text that's already visible and
// selectable without JS.
//
// Shortlist (Phase 2D): any `<button data-shortlist-id="some-entry-id">`
// toggles that id in a localStorage array — no accounts, no cookies, no
// server round-trip. The array only ever feeds a plain
// "/psychotherapy/list?ids=..." URL, the same shape a reader could type or
// share by hand, so building a list is JS-only but *reading* one never is.
(function () {
  "use strict";

  var SHORTLIST_KEY = "allodium:shortlist";

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

  function readShortlist() {
    try {
      var raw = window.localStorage.getItem(SHORTLIST_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (id) {
        return typeof id === "string" && id.length > 0;
      });
    } catch (err) {
      // Storage unavailable or corrupted (private mode, quota, disabled,
      // hand-edited value) — treat exactly like an empty shortlist.
      return [];
    }
  }

  function writeShortlist(ids) {
    try {
      window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify(ids));
    } catch (err) {
      // Storage unavailable — the buttons simply stop persisting; nothing
      // else on the page depends on this succeeding.
    }
  }

  function buildListHref(ids) {
    if (ids.length === 0) return "/psychotherapy/list";
    return "/psychotherapy/list?ids=" + ids.map(encodeURIComponent).join(",");
  }

  function renderShortlistNav() {
    var link = document.getElementById("shortlist-nav-link");
    if (!link) return;
    var ids = readShortlist();
    link.setAttribute("href", buildListHref(ids));
    link.textContent = ids.length > 0 ? "Shortlist (" + ids.length + ")" : "Shortlist";
  }

  function updateShortlistButton(button, ids) {
    var id = button.getAttribute("data-shortlist-id");
    var inList = ids.indexOf(id) !== -1;
    button.textContent = inList ? "Remove from shortlist" : "Add to shortlist";
    button.setAttribute("aria-pressed", inList ? "true" : "false");
  }

  function refreshShortlistButtons() {
    var ids = readShortlist();
    var buttons = document.querySelectorAll("[data-shortlist-id]");
    for (var i = 0; i < buttons.length; i++) {
      updateShortlistButton(buttons[i], ids);
    }
  }

  function toggleShortlist(button) {
    var id = button.getAttribute("data-shortlist-id");
    if (!id) return;
    var ids = readShortlist();
    var index = ids.indexOf(id);
    if (index === -1) {
      ids.push(id);
    } else {
      ids.splice(index, 1);
    }
    writeShortlist(ids);
    refreshShortlistButtons();
    renderShortlistNav();
  }

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target : null;
    if (!target) return;

    var copyButton = target.closest("[data-copy-target]");
    if (copyButton) {
      copyFromTarget(copyButton);
      return;
    }

    var shortlistButton = target.closest("[data-shortlist-id]");
    if (shortlistButton) {
      toggleShortlist(shortlistButton);
    }
  });

  // Progressive enhancement for sort / similar controls: changing a
  // `[data-auto-submit]` control submits its enclosing form. Without JS the
  // form still works via the regular Search submit button.
  document.addEventListener("change", function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    if (!target.hasAttribute("data-auto-submit")) return;
    var form = target.form || (target.closest ? target.closest("form") : null);
    if (form) form.submit();
  });

  // This script is loaded with `defer`, so the DOM is already fully parsed
  // by the time it runs — the nav link and any shortlist buttons on the
  // current page are ready to read/update immediately, no load-event wait
  // needed.
  renderShortlistNav();
  refreshShortlistButtons();
})();
