(function () {
  "use strict";

  /**
   * Offline report enhancement script.
   *
   * Enhancement-only: toggles classList on pre-rendered, collapsed peek containers
   * on click. If any DOM node needs to be created dynamically, ONLY
   * document.createElement / .textContent are used.
   *
   * HARD BAN: innerHTML and insertAdjacentHTML are forbidden in this file.
   * A unit test greps the source and fails if either appears.
   * Reason: this script runs adjacent to attacker-controlled embedded data
   * (graph node payloads), so any HTML sink is an XSS vector.
   */

  /**
   * Toggle a collapsed peek container open/closed.
   * The container must have data-peek-container="true" and the toggle trigger
   * must have data-peek-toggle="true".
   */
  function initPeekToggles() {
    document.addEventListener("click", function (event) {
      var target = event.target;
      // Walk up to find the nearest peek-toggle trigger.
      while (target && target !== document) {
        if (
          target.nodeType === 1 &&
          target.getAttribute("data-peek-toggle") === "true"
        ) {
          var container = target.closest("[data-peek-container]");
          if (container) {
            container.classList.toggle("peek-open");
          }
          break;
        }
        target = target.parentNode;
      }
    });
  }

  /**
   * Mark all external-looking anchors (href starting with http/https)
   * as disabled in the offline context, so users aren't misled.
   *
   * The live report replaces server-dependent links with static labels
   * at SSR time; this script additionally disables any that weren't caught.
   */
  function disableExternalLinks() {
    var anchors = document.querySelectorAll("a[href]");
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var href = a.getAttribute("href") || "";
      if (href.indexOf("http://") === 0 || href.indexOf("https://") === 0) {
        // Replace with a static span that looks like the link but isn't.
        var span = document.createElement("span");
        span.className = a.className + " offline-link-disabled";
        span.setAttribute("title", "This link is only available in the online report.");
        // Copy child text nodes only — no innerHTML.
        var childNodes = a.childNodes;
        for (var j = 0; j < childNodes.length; j++) {
          span.appendChild(childNodes[j].cloneNode(true));
        }
        if (a.parentNode) {
          a.parentNode.replaceChild(span, a);
        }
      }
    }
  }

  /**
   * Wire up "available online" chips: mark them as non-interactive.
   */
  function initAvailableOnlineChips() {
    var chips = document.querySelectorAll("[data-offline-chip]");
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.add("offline-chip-rendered");
    }
  }

  // Run after DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initPeekToggles();
      disableExternalLinks();
      initAvailableOnlineChips();
    });
  } else {
    initPeekToggles();
    disableExternalLinks();
    initAvailableOnlineChips();
  }
})();
