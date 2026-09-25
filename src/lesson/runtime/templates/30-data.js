/* data.*: numbers count up from 0 over 0.6 s; bars, links and lines draw in from the left. */
(window.__LESSON_TEMPLATES__ = window.__LESSON_TEMPLATES__ || []).push(function (A) {
  var tl = A.tl, M = A.M, $ = A.$, $$ = A.$$;
  var NUM_DUR = 0.6;

  function title(el, t) {
    var h = $(el, ".data-title");
    return h ? A.textIn(h, t) : 0;
  }
  function source(el, t) {
    $$(el, ".data-source").forEach(function (x) { A.fadeUp(x, t, 12, M.base); });
  }
  function grow(bar, t, dur) {
    if (bar) tl.fromTo(bar, { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: dur || NUM_DUR, ease: "power2.out" }, t);
  }

  A.enter["data.big-number"] = function (el, s, t) {
    var fig = $(el, ".bn-figure");
    if (fig) tl.fromTo(fig, { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: M.base, ease: M.enter }, t);
    A.countUp($(el, ".bn-value"), t + 0.05, NUM_DUR);
    var unit = $(el, ".bn-unit");
    if (unit) A.pop(unit, t + 0.45, 0.5);
    A.fadeUp($(el, ".bn-label"), t + 0.35, 24);
    var delta = $(el, ".bn-delta");
    if (delta) { A.fadeUp(delta, t + 0.6, 24); A.countUp($(el, ".bn-delta-v"), t + 0.6, NUM_DUR); }
    $$(el, ".bn-row").forEach(function (r, i) {
      var at = t + 0.8 + i * 0.12;
      A.fadeUp(r, at, 12, 0.3);
      grow($(r, ".bn-bar"), at, 0.5);
    });
    source(el, t + 1.2);
  };

  A.enter["data.dumbbell"] = function (el, s, t) {
    var d = title(el, t);
    A.fadeUp($(el, ".db-legend"), t + 0.2 + d * 0.4, 16);
    $$(el, ".db-row").forEach(function (r, i) {
      var at = t + 0.45 + d * 0.4 + i * 0.14;
      A.fadeUp(r, at, 16, 0.35);
      tl.fromTo($(r, ".db-rail"), { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.5, ease: "power2.out" }, at);
      A.pop($(r, ".db-a"), at + 0.2, 0.35);
      grow($(r, ".db-link"), at + 0.3, 0.45);
      A.pop($(r, ".db-b"), at + 0.6, 0.4);
      A.countUp($(r, ".db-value"), at + 0.3, NUM_DUR);
      A.fadeUp($(r, ".db-delta"), at + 0.7, 10, 0.3);
    });
    A.fadeUp($(el, ".db-axis"), t + 0.6 + d * 0.4, 10);
    source(el, t + 1.4);
  };

  A.enter["data.line"] = function (el, s, t) {
    var d = title(el, t);
    A.fadeUp($(el, ".data-sub"), t + 0.2 + d * 0.4, 14);
    var at = t + 0.35 + d * 0.4;
    tl.fromTo($$(el, ".ln-grid, .ln-tick"), { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.04 }, at);
    grow($(el, ".ln-base"), at, 0.5);
    var draw = Math.min(1.6, 0.5 + (s.meta.points || 6) * 0.1);
    var path = $(el, ".ln-path");
    if (path) tl.fromTo(path, { drawSVG: "0%" }, { drawSVG: "100%", duration: draw, ease: "power1.inOut" }, at + 0.2);
    var area = $(el, ".ln-area");
    if (area) tl.fromTo(area, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: draw, ease: "power1.inOut" }, at + 0.2);
    tl.fromTo($(el, ".ln-labels"), { opacity: 0 }, { opacity: 1, duration: 0.4 }, at + 0.2);
    var anno = $$(el, ".ln-anno-line, .ln-anno-dot, .ln-anno");
    if (anno.length) tl.fromTo(anno, { opacity: 0 }, { opacity: 1, duration: 0.35, stagger: 0.08 }, at + 0.2 + draw * 0.6);
    A.pop($(el, ".ln-end"), at + 0.2 + draw, 0.4);
    var last = $(el, ".ln-last");
    if (last) { A.fadeUp(last, at + draw, 20); A.countUp($(el, ".ln-last-v"), at + draw, NUM_DUR); }
    source(el, at + draw + 0.3);
  };

  A.enter["data.waffle"] = function (el, s, t) {
    var cells = $$(el, ".wf-grid i");
    var on = cells.filter(function (c) { return c.classList.contains("on"); });
    tl.fromTo(cells, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.3, ease: "power2.out", stagger: { each: 0.004, from: "start" } }, t);
    // filled cells light up in reading order after the grid is in
    tl.fromTo(on, { backgroundColor: getComputedStyle(A.root).getPropertyValue("--data-track").trim() || "#2a2723" },
      { backgroundColor: getComputedStyle(A.root).getPropertyValue("--data-accent").trim() || "#f6623d", duration: 0.2, stagger: 0.006, immediateRender: false }, t + 0.45);
    A.fadeUp($(el, ".wf-pct"), t + 0.1, 30);
    A.countUp($(el, ".wf-pct"), t + 0.45, NUM_DUR);
    A.fadeUp($(el, ".wf-label"), t + 0.3, 20);
    A.fadeUp($(el, ".wf-sub"), t + 0.5, 14);
    source(el, t + 0.9);
  };

  function revealEvent(ev, t) {
    var stem = $(ev, ".tl-stem"), branch = $(ev, ".tl-branch"), dot = $(ev, ".tl-dot"), label = $(ev, ".tl-label");
    if (stem) tl.fromTo(stem, { scaleY: 0, transformOrigin: "50% 100%" }, { scaleY: 1, duration: 0.4, ease: "power2.out" }, t);
    if (branch) tl.fromTo(branch, { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.3, ease: "power2.out" }, t);
    if (dot) A.pop(dot, t + 0.1, 0.45);
    if (label) tl.fromTo(label, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: M.base, ease: M.enter }, t + 0.2);
  }

  A.enter["data.timeline"] = function (el, s, t) {
    var d = title(el, t);
    var axis = $(el, ".tl-axis");
    if (axis) {
      var vertical = A.PORTRAIT;
      tl.fromTo(axis, vertical ? { scaleY: 0, transformOrigin: "50% 0%" } : { scaleX: 0, transformOrigin: "0% 50%" },
        vertical ? { scaleY: 1, duration: 0.9, ease: "power2.inOut" } : { scaleX: 1, duration: 0.9, ease: "power2.inOut" }, t + 0.2);
    }
    tl.fromTo($$(el, ".tl-tick, .tl-year"), { opacity: 0 }, { opacity: 1, duration: 0.3, stagger: 0.02 }, t + 0.4);
    var cued = A.revealTargets(s);
    var evs = $$(el, ".tl-ev");
    var span = Math.max(s.voiceEnd - s.voiceStart, 1.5);
    evs.forEach(function (ev, i) {
      if (cued[i + 1]) return;
      revealEvent(ev, Math.max(t + 0.8 + d * 0.3 + i * 0.25, s.voiceStart + (span * 0.8 * i) / evs.length));
    });
  };

  A.beat["data.timeline"] = function (el, s, b, n) {
    if ((b.do === "reveal" || b.do === "show") && n != null) {
      var ev = el.querySelector('.tl-ev[data-item="' + n + '"]');
      if (ev) revealEvent(ev, b.t);
      return true;
    }
    return false;
  };
});
