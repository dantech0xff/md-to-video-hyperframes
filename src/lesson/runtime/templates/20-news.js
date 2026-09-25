/* news.*: tag slides in, headline rises word by word, the ticker crawls. */
(window.__LESSON_TEMPLATES__ = window.__LESSON_TEMPLATES__ || []).push(function (A) {
  var tl = A.tl, M = A.M, $ = A.$, $$ = A.$$;

  /** ticker: label drops in, items crawl left at a constant speed for the whole scene */
  A.ticker = function (el, s, t) {
    var bar = $(el, ".ticker");
    if (!bar) return;
    tl.fromTo(bar, { yPercent: A.PORTRAIT ? 0 : 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: M.base, ease: M.enter }, t + 0.1);
    var row = $(bar, ".ticker-row"), track = $(bar, ".ticker-track");
    var run = $(bar, ".ticker-run"), dup = $(bar, ".ticker-dup");
    if (!row || !run || !track) return;
    // crawl only when the items don't fit; a short ticker stays still
    if (run.offsetWidth <= track.clientWidth) { if (dup) dup.style.display = "none"; return; }
    var D = Math.max(s.until - t, 1);
    var cycle = dup ? dup.offsetLeft - run.offsetLeft : run.offsetWidth;
    tl.fromTo(row, { x: 0 }, { x: -Math.min(cycle, 70 * D), duration: D, ease: "none" }, t);
  };

  function tag(el, t) {
    var top = $(el, ".news-top");
    if (top) A.slideX(top, t, -40, M.base);
    var inline = $(el, ".content .news-tag");
    if (inline) A.slideX(inline, t + 0.1, -40, M.base);
  }

  A.enter["news.breaking"] = function (el, s, t) {
    tag(el, t);
    var img = $(el, ".news-image");
    if (img) {
      tl.fromTo(img, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: M.slow, ease: M.enter }, t + 0.1);
      var pic = $(img, "img");
      if (pic) tl.fromTo(pic, { scale: 1.02 }, { scale: 1.12, duration: Math.max(s.until - t, 1), ease: "none" }, t);
    }
    var d = A.textIn($(el, ".news-headline"), t + 0.15);
    A.fadeUp($(el, ".news-sub"), t + 0.3 + d * 0.6, 24);
    var cued = A.revealTargets(s);
    $$(el, ".news-fact").forEach(function (f, i) { if (!cued[i + 1]) A.pop(f, t + 0.6 + d * 0.6 + i * 0.1, 0.45); });
    A.ticker(el, s, t);
  };

  function topItem(it, t) {
    tl.fromTo(it, { opacity: 0, x: -60 }, { opacity: 1, x: 0, duration: M.base, ease: M.enter }, t);
    var num = $(it, ".topn-num");
    if (num) tl.fromTo(num, { scale: 1.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: M.emphasis }, t + 0.05);
  }

  A.enter["news.top-n"] = function (el, s, t) {
    tag(el, t);
    A.fadeUp($(el, ".topn-kicker"), t, 16, M.base);
    var d = A.textIn($(el, ".topn-heading"), t + 0.1);
    var cued = A.revealTargets(s);
    $$(el, ".topn-item").forEach(function (it, i) { if (!cued[i + 1]) topItem(it, t + 0.35 + d * 0.4 + i * 0.12); });
    A.ticker(el, s, t);
  };

  A.enter["news.quote"] = function (el, s, t) {
    tag(el, t);
    var mark = $(el, ".quote-mark");
    if (mark) tl.fromTo(mark, { opacity: 0, y: 40, scale: 0.7 }, { opacity: 1, y: 0, scale: 1, duration: M.slow, ease: M.emphasis }, t);
    var d = A.textIn($(el, ".quote-text"), t + 0.15);
    var person = $(el, ".quote-person");
    if (person) A.slideX(person, t + 0.35 + d * 0.6, -40, M.base);
    A.fadeUp($(el, ".quote-source"), t + 0.5 + d * 0.6, 16);
    A.ticker(el, s, t);
  };

  A.enter["news.lower-third"] = function (el, s, t) {
    var pic = $(el, ".lt-media img");
    if (pic) tl.fromTo(pic, { scale: 1.02 }, { scale: 1.12, duration: Math.max(s.until - s.start, 1), ease: "none" }, s.start);
    var tagEl = $(el, ".lt-tag"), box = $(el, ".lt-box");
    if (box) tl.fromTo(box, { opacity: 0, x: -80 }, { opacity: 1, x: 0, duration: M.base, ease: M.enter }, t + 0.35);
    if (tagEl) tl.fromTo(tagEl, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: M.base * 0.8, ease: M.enter }, t + 0.55);
  };

  A.beat["news.top-n"] = function (el, s, b, n) {
    if ((b.do === "reveal" || b.do === "show") && n != null) {
      var it = el.querySelector('.topn-item[data-item="' + n + '"]');
      if (it) topItem(it, b.t);
      return true;
    }
    return false;
  };
  A.beat["news.breaking"] = function (el, s, b, n) {
    if ((b.do === "reveal" || b.do === "show") && n != null) {
      var f = el.querySelector('.news-fact[data-item="' + n + '"]');
      if (f) A.pop(f, b.t, 0.45);
      return true;
    }
    return false;
  };
});
