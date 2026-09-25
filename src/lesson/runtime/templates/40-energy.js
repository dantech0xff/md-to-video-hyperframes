/* energy.*: short, hard motion. punch slams in and shakes; myth gets struck, fact stamped;
 * before/after counts up and the badge spins in; the giant rank number rises from below. */
(window.__LESSON_TEMPLATES__ = window.__LESSON_TEMPLATES__ || []).push(function (A) {
  var tl = A.tl, M = A.M, $ = A.$, $$ = A.$$;

  /** a few decaying offsets (seeded, so every render is identical) */
  A.shake = function (target, t, amp, key) {
    var n = 6;
    for (var k = 0; k < n; k++) {
      var f = 1 - k / n;
      var dx = ((A.hash(key * 31 + k * 7) % 200) / 100 - 1) * amp * f;
      var dy = ((A.hash(key * 17 + k * 13) % 200) / 100 - 1) * amp * f * 0.6;
      tl.to(target, { x: dx, y: dy, duration: 0.035, ease: "none", immediateRender: false }, t + k * 0.035);
    }
    tl.to(target, { x: 0, y: 0, duration: 0.05, ease: "power1.out", immediateRender: false }, t + n * 0.035);
  };

  A.punchIn = function (el, s, t, word) {
    A.fadeUp($(el, ".punch-context"), t, 20, M.fast * 1.5);
    if (word) {
      tl.fromTo(word, { opacity: 0, scale: 2.4, rotation: -9 }, { opacity: 1, scale: 1, rotation: -3, duration: 0.28, ease: "power4.in" }, t + 0.1);
      A.shake(word, t + 0.38, 26, A.hash(s.start * 1000 | 0) % 997);
    }
    var cta = $(el, ".punch-cta");
    if (cta) tl.fromTo(cta, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: M.fast * 1.5, ease: M.emphasis }, t + 0.55);
  };

  A.enter["energy.punch"] = function (el, s, t) {
    var bg = $(el, ".punch-bg");
    if (bg) tl.fromTo(bg, { scale: 1.08 }, { scale: 1, duration: 0.4, ease: "power3.out" }, s.start);
    A.punchIn(el, s, t, $(el, ".punch-word"));
  };

  A.enter["energy.myth-fact"] = function (el, s, t) {
    var tags = $$(el, ".mf-tag");
    A.slideX(tags[0], t, -30, M.fast * 1.4);
    A.fadeUp($(el, ".mf-myth-text"), t + 0.12, 24, M.base);
    // the fact lands at the {fact} cue, else 45% into the narration
    var at = s.meta.factAt != null ? s.meta.factAt : s.voiceStart + (s.voiceEnd - s.voiceStart) * 0.45;
    at = Math.max(at, t + 0.8);
    var strike = $(el, ".mf-strike");
    if (strike) tl.fromTo(strike, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power3.out" }, at - 0.35);
    var myth = $(el, ".mf-myth");
    if (myth) A.shake(myth, at - 0.05, 10, 41);
    A.slideX(tags[1], at, -30, M.fast * 1.4);
    var d = A.textIn($(el, ".mf-fact"), at + 0.08);
    var kw = $(el, ".mf-kw");
    // the keyword's block stays hidden until it is stamped in
    if (kw) tl.fromTo(kw, { opacity: 0, scale: 1.35, rotation: -8 }, { opacity: 1, scale: 1, rotation: -1.5, duration: 0.35, ease: "back.out(2.2)" }, at + 0.1 + d * 0.6);
  };

  A.enter["energy.before-after"] = function (el, s, t) {
    var halves = $$(el, ".ba-half");
    if (halves[0]) tl.fromTo(halves[0], A.PORTRAIT ? { yPercent: -100 } : { xPercent: -100 }, A.PORTRAIT ? { yPercent: 0, duration: 0.45, ease: M.move } : { xPercent: 0, duration: 0.45, ease: M.move }, s.start);
    if (halves[1]) tl.fromTo(halves[1], A.PORTRAIT ? { yPercent: 100 } : { xPercent: 100 }, A.PORTRAIT ? { yPercent: 0, duration: 0.45, ease: M.move } : { xPercent: 0, duration: 0.45, ease: M.move }, s.start);
    A.fadeUp($(el, ".ba-title"), t, 16, M.base);
    var before = $(el, ".ba-before"), after = $(el, ".ba-after");
    if (before) { A.fadeUp(before, t + 0.15, 40, M.base); A.countUp($(before, ".ba-value"), t + 0.2, 0.6); }
    var at = s.meta.afterAt != null ? s.meta.afterAt : s.voiceStart + (s.voiceEnd - s.voiceStart) * 0.45;
    at = Math.max(at, t + 0.9);
    if (after) { A.fadeUp(after, at, 40, M.base); A.countUp($(after, ".ba-value"), at + 0.05, 0.6); }
    var badge = $(el, ".ba-badge");
    if (badge) {
      tl.fromTo(badge, { opacity: 0, scale: 0.2, rotation: -120 }, { opacity: 1, scale: 1, rotation: -8, duration: 0.5, ease: "back.out(1.8)" }, at + 0.55);
      tl.to(badge, { scale: 1.06, duration: 0.7, ease: "sine.inOut", yoyo: true, repeat: A.repeats(Math.max(s.until - at - 1.1, 0.7), 0.7) }, at + 1.1);
    }
  };

  A.enter["energy.big-rank"] = function (el, s, t) {
    var num = $(el, ".rank-num");
    if (num) {
      tl.fromTo(num, { opacity: 0, yPercent: 30, scale: 1.1 }, { opacity: 1, yPercent: 0, scale: 1, duration: 0.45, ease: "power4.out" }, t);
      A.shake(num, t + 0.4, 14, 7);
      tl.to(num, { x: -30, duration: Math.max(s.until - t - 0.6, 0.5), ease: "none", immediateRender: false }, t + 0.7);
    }
    A.slideX($(el, ".rank-of"), t + 0.25, -30, M.base);
    var d = A.textIn($(el, ".rank-title"), t + 0.3);
    A.fadeUp($(el, ".rank-detail"), t + 0.45 + d * 0.6, 20);
    var fix = $(el, ".rank-fix");
    if (fix) A.pop(fix, t + 0.7 + d * 0.6, 0.45);
  };
});
