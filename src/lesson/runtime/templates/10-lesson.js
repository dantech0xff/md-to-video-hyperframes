/* lesson.compare: cards rise, rows follow ({n} reveals row n on both sides). */
(window.__LESSON_TEMPLATES__ = window.__LESSON_TEMPLATES__ || []).push(function (A) {
  var tl = A.tl, M = A.M, $ = A.$, $$ = A.$$;

  function revealRow(el, n, t) {
    $$(el, '.vs-row[data-item="' + n + '"]').forEach(function (r, k) {
      tl.fromTo(r, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: M.base, ease: M.enter }, t + k * 0.06);
    });
  }

  A.enter["lesson.compare"] = function (el, s, t) {
    var d = A.textIn($(el, ".scene-title"), t);
    var cards = $$(el, ".vs-card");
    tl.fromTo(cards, { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: M.slow, ease: M.enter, stagger: 0.12 }, t + 0.15 + d * 0.3);
    var badge = $(el, ".vs-badge");
    if (badge) A.pop(badge, t + 0.6 + d * 0.3, 0.5);
    var cued = A.revealTargets(s);
    var rows = s.meta.rows || 0;
    for (var n = 1; n <= rows; n++) if (!cued[n]) revealRow(el, n, t + 0.45 + d * 0.3 + (n - 1) * 0.12);
  };

  A.beat["lesson.compare"] = function (el, s, b, n) {
    if ((b.do === "reveal" || b.do === "show") && n != null) { revealRow(el, n, b.t); return true; }
    if (b.do === "highlight") {
      var pick = $(el, ".vs-card.is-pick");
      if (pick) tl.fromTo(pick, { scale: 1 }, { scale: 1.03, duration: 0.3, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, b.t);
      return true;
    }
    return false;
  };
});
