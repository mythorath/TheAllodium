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
//
// Federated papers on browse hubs: any `[data-load-works]` button fetches
// `/partials/works` and injects the server-rendered fragment. Buttons start
// `hidden` and are revealed here. With JS, IntersectionObserver fires that
// fetch once when `.works-loader` nears the viewport; the button stays as
// a click-to-retry control. Without this file the plain Search papers link
// remains the working path, so crawlers never trigger federation.
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

  function revealWorksButtons() {
    var buttons = document.querySelectorAll("[data-load-works]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].hidden = false;
    }
  }

  function worksLoaderRoot(button) {
    return button.closest(".works-loader") || button.parentNode;
  }

  function observeWorksLoaders() {
    var buttons = document.querySelectorAll("[data-load-works]");
    if (buttons.length === 0) return;
    if (typeof IntersectionObserver !== "function") return;

    var observer = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (!entry.isIntersecting) continue;
          var root = entry.target;
          observer.unobserve(root);
          if (root.getAttribute("data-works-attempted") === "1") continue;
          var button = root.querySelector
            ? root.querySelector("[data-load-works]")
            : null;
          if (!button) continue;
          loadWorks(button);
        }
      },
      // Fire when the loader is on screen or just below the fold — not while
      // it is still far down a long hub page.
      { rootMargin: "0px 0px 80px 0px", threshold: 0 },
    );

    for (var j = 0; j < buttons.length; j++) {
      observer.observe(worksLoaderRoot(buttons[j]));
    }
  }

  function loadWorks(button) {
    var url = button.getAttribute("data-load-works");
    if (!url) return;
    var root = worksLoaderRoot(button);
    var target = root && root.querySelector ? root.querySelector("[data-works-target]") : null;
    if (!target) return;
    if (button.getAttribute("data-loading") === "1") return;
    button.setAttribute("data-loading", "1");
    if (root && root.setAttribute) root.setAttribute("data-works-attempted", "1");
    button.disabled = true;
    target.replaceChildren();
    var pending = document.createElement("p");
    pending.className = "meta";
    pending.textContent = "Loading papers…";
    target.appendChild(pending);

    fetch(url, { headers: { Accept: "text/html" } })
      .then(function (response) {
        if (!response.ok) throw new Error("partial failed");
        return response.text();
      })
      .then(function (html) {
        target.innerHTML = html;
      })
      .catch(function () {
        target.replaceChildren();
        var fail = document.createElement("p");
        fail.className = "status-prompt";
        fail.textContent = "Could not load papers here. Use Search papers instead.";
        target.appendChild(fail);
      })
      .then(function () {
        button.removeAttribute("data-loading");
        button.disabled = false;
      });
  }

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target : null;
    if (!target) return;

    var copyButton = target.closest("[data-copy-target]");
    if (copyButton) {
      copyFromTarget(copyButton);
      return;
    }

    var worksButton = target.closest("[data-load-works]");
    if (worksButton) {
      loadWorks(worksButton);
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
  revealWorksButtons();
  observeWorksLoaders();
})();
