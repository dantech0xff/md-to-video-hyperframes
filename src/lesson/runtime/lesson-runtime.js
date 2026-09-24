/* Lesson runtime — builds the GSAP timeline for a lesson composition from
 * window.__LESSON_PLAN__ (written by src/lesson/compose.ts).
 *
 * Contract with HyperFrames: one paused timeline, registered synchronously in
 * window.__timelines, finite repeats only, no Math.random (seeded PRNG),
 * no exit animations except through scene transitions.
 */
(function () {
  "use strict";
  var P = window.__LESSON_PLAN__;
  var M = P.motion;
  var PORTRAIT = P.format === "portrait";
  var root = document.getElementById("root");
  gsap.registerPlugin(SplitText, DrawSVGPlugin, MotionPathPlugin);
  // optional parts (chips, boolean cells, dots…) are often absent — not an error
  gsap.config({ nullTargetWarn: false });
  var tl = gsap.timeline({ paused: true });

  var css = getComputedStyle(root);
  function cssVar(name) { return css.getPropertyValue(name).trim(); }
  var C = {
    ink: cssVar("--ink"), accent: cssVar("--accent"), positive: cssVar("--positive"), positiveBg: cssVar("--positive-bg"),
    negative: cssVar("--negative"), negativeBg: cssVar("--negative-bg"), capInk: cssVar("--cap-ink"), capActive: cssVar("--cap-active"),
    line: cssVar("--line-strong"),
  };

  function $(el, sel) { return el.querySelector(sel); }
  function $$(el, sel) { return Array.prototype.slice.call(el.querySelectorAll(sel)); }
  function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; }
  function repeats(total, cycle) { return Math.max(0, Math.ceil(total / cycle) - 1); }
  function offsetWithin(el, ancestor) {
    var x = 0, y = 0, e = el;
    while (e && e !== ancestor) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    return { x: x, y: y };
  }

  // ── text entrances ────────────────────────────────────────────────────
  var SCRAMBLE = "01<>/{}[]#$%&*+=?ABCDEFXYZ";
  function scrambleIn(el, t, dur) {
    var finalText = el.textContent;
    var o = { p: 0 };
    tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.05 }, t);
    tl.fromTo(o, { p: 0 }, {
      p: 1, duration: dur, ease: "none",
      onUpdate: function () {
        var n = Math.floor(o.p * finalText.length);
        var tick = Math.floor(o.p * 24);
        var out = finalText.slice(0, n);
        for (var i = n; i < finalText.length; i++) {
          var ch = finalText[i];
          out += ch === " " ? " " : SCRAMBLE[hash(i * 131 + tick * 7) % SCRAMBLE.length];
        }
        el.textContent = o.p >= 1 ? finalText : out;
      },
    }, t);
  }

  function textIn(el, t, opts) {
    if (!el) return 0;
    opts = opts || {};
    var mode = opts.mode || M.text;
    if (mode === "scramble" && el.children.length === 0) { scrambleIn(el, t, 0.9); return 0.9; }
    if (mode === "write") {
      var len = el.textContent.length;
      var d = Math.min(1.4, 0.45 + len * 0.018);
      tl.fromTo(el, { clipPath: "inset(-12% 100% -12% 0%)", opacity: 1 }, { clipPath: "inset(-12% 0% -12% 0%)", duration: d, ease: "power1.inOut" }, t);
      return d;
    }
    if (mode === "fade") {
      tl.fromTo(el, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: M.base, ease: M.enter }, t);
      return M.base;
    }
    var split = new SplitText(el, { type: "words", wordsClass: "sw" });
    var n = split.words.length;
    var st = Math.min(M.stagger, 0.9 / Math.max(n, 1));
    tl.fromTo(split.words, { opacity: 0, y: M.distance * 0.7, rotationX: -35, transformPerspective: 700 },
      { opacity: 1, y: 0, rotationX: 0, duration: M.slow, ease: M.enter, stagger: st }, t);
    return st * n + M.slow * 0.6;
  }

  function fadeUp(el, t, dist, dur, ease) {
    if (!el) return;
    tl.fromTo(el, { opacity: 0, y: dist == null ? M.distance * 0.5 : dist }, { opacity: 1, y: 0, duration: dur || M.base, ease: ease || M.enter }, t);
  }
  function pop(el, t, dur) {
    if (!el) return;
    tl.fromTo(el, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: dur || M.base, ease: M.emphasis }, t);
  }
  function slideX(el, t, dx, dur) {
    if (!el) return;
    tl.fromTo(el, { opacity: 0, x: dx }, { opacity: 1, x: 0, duration: dur || M.base, ease: M.enter }, t);
  }
  function highlightMarks(scope, t) {
    $$(scope, ".hl-bar").forEach(function (bar, i) {
      tl.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: 0.55, ease: "power2.out" }, t + i * 0.25);
    });
  }

  // ── background ambient motion ──────────────────────────────────────────
  (function ambient() {
    var D = P.duration;
    var g1 = document.querySelector(".bg-glow.g1");
    var g2 = document.querySelector(".bg-glow.g2");
    if (g1) tl.fromTo(g1, { x: 0, y: 0, scale: 1 }, { x: 110, y: 70, scale: 1.14, duration: 11, ease: "sine.inOut", yoyo: true, repeat: repeats(D, 11) }, 0);
    if (g2) tl.fromTo(g2, { x: 0, y: 0, scale: 1 }, { x: -90, y: -60, scale: 1.1, duration: 14, ease: "sine.inOut", yoyo: true, repeat: repeats(D, 14) }, 0);
    var grid = document.querySelector(".bg-grid");
    if (grid) tl.fromTo(grid, { y: 0 }, { y: -Math.min(D * 4, 400), duration: D, ease: "none" }, 0);
  })();

  // ── transitions ────────────────────────────────────────────────────────
  var panel = document.querySelector(".tx-panel");
  var blinds = $$(document, ".tx-blinds i");
  var flash = document.querySelector(".tx-flash");

  function transition(prev, el, tr, t) {
    var d = tr.dur;
    var mid = t + d / 2;
    switch (tr.type) {
      case "none":
        break;
      case "fade":
        tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: d, ease: "power1.inOut" }, t);
        tl.fromTo(prev, { opacity: 1 }, { opacity: 0, duration: d, ease: "power1.inOut", immediateRender: false }, t);
        break;
      case "push": {
        var ax = PORTRAIT ? "yPercent" : "xPercent";
        var a = {}; a[ax] = 100; var b = {}; b[ax] = 0; b.duration = d; b.ease = M.move;
        tl.fromTo(el, a, b, t);
        var c = {}; c[ax] = 0; c.opacity = 1; var e = {}; e[ax] = -35; e.opacity = 0; e.duration = d; e.ease = M.move; e.immediateRender = false;
        tl.fromTo(prev, c, e, t);
        break;
      }
      case "slide-up":
        tl.fromTo(el, { yPercent: 100 }, { yPercent: 0, duration: d, ease: "power4.inOut" }, t);
        tl.fromTo(prev, { yPercent: 0, scale: 1, opacity: 1 }, { yPercent: -18, scale: 0.94, opacity: 0, duration: d, ease: "power4.inOut", immediateRender: false }, t);
        break;
      case "zoom":
        tl.fromTo(prev, { scale: 1, opacity: 1 }, { scale: 1.28, opacity: 0, duration: d * 0.7, ease: "power2.in", immediateRender: false }, t);
        tl.fromTo(el, { scale: 0.86, opacity: 0 }, { scale: 1, opacity: 1, duration: d * 0.75, ease: M.enter }, t + d * 0.25);
        break;
      case "iris":
        tl.fromTo(el, { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(78% at 50% 50%)", duration: d, ease: "power3.inOut" }, t);
        tl.fromTo(prev, { opacity: 1 }, { opacity: 0, duration: d * 0.6, ease: "power1.in", immediateRender: false }, t);
        break;
      case "blur":
        tl.fromTo(prev, { filter: "blur(0px)", opacity: 1 }, { filter: "blur(26px)", opacity: 0, duration: d, ease: "power2.in", immediateRender: false }, t);
        tl.fromTo(el, { filter: "blur(26px)", opacity: 0 }, { filter: "blur(0px)", opacity: 1, duration: d, ease: "power2.out" }, t);
        break;
      case "wipe":
        tl.set(el, { opacity: 0 }, t);
        tl.fromTo(panel, { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: d / 2, ease: "power3.in", immediateRender: false }, t);
        tl.set(prev, { opacity: 0 }, mid);
        tl.set(el, { opacity: 1 }, mid);
        tl.fromTo(panel, { scaleX: 1, transformOrigin: "100% 50%" }, { scaleX: 0, duration: d / 2, ease: "power3.out", immediateRender: false }, mid);
        break;
      case "blinds": {
        var prop = PORTRAIT ? "scaleX" : "scaleY";
        var f0 = {}; f0[prop] = 0; f0.transformOrigin = PORTRAIT ? "0% 50%" : "50% 0%";
        var f1 = {}; f1[prop] = 1; f1.duration = d / 2; f1.ease = "power2.in"; f1.stagger = 0.03; f1.immediateRender = false;
        tl.set(el, { opacity: 0 }, t);
        tl.fromTo(blinds, f0, f1, t);
        tl.set(prev, { opacity: 0 }, mid + 0.1);
        tl.set(el, { opacity: 1 }, mid + 0.1);
        var g0 = {}; g0[prop] = 1; g0.transformOrigin = PORTRAIT ? "100% 50%" : "50% 100%";
        var g1b = {}; g1b[prop] = 0; g1b.duration = d / 2; g1b.ease = "power2.out"; g1b.stagger = 0.03; g1b.immediateRender = false;
        tl.fromTo(blinds, g0, g1b, mid + 0.1);
        break;
      }
      case "glitch": {
        tl.set(el, { opacity: 0 }, t);
        var steps = 6;
        for (var k = 0; k < steps; k++) {
          var tt = t + (k * d) / steps;
          var off = (hash(k * 97 + Math.round(t * 100)) % 60) - 30;
          var target = k < steps / 2 ? prev : el;
          tl.set(target, { x: off, skewX: off / 6, clipPath: "inset(" + (hash(k + 11) % 40) + "% 0% " + (hash(k + 29) % 40) + "% 0%)" }, tt);
          tl.set(flash, { opacity: k % 2 ? 0 : 0.22 }, tt);
        }
        tl.set(prev, { opacity: 0 }, mid);
        tl.set(el, { opacity: 1 }, mid);
        tl.set(el, { x: 0, skewX: 0, clipPath: "inset(0% 0% 0% 0%)" }, t + d);
        tl.set(flash, { opacity: 0 }, t + d);
        break;
      }
    }
  }

  // ── scene entrances (layout is the end state; animate INTO it) ────────
  var enter = {};

  enter.title = function (el, s, t) {
    var kb = $(el, ".kicker-bar");
    if (kb) tl.fromTo(kb, { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: M.base, ease: M.enter }, t);
    fadeUp($(el, ".kicker-text"), t + 0.1, 20, M.base);
    var d = textIn($(el, ".title-text"), t + 0.2);
    fadeUp($(el, ".subtitle"), t + 0.35 + d * 0.6, 30);
    $$(el, ".chip-icon").forEach(function (c, i) { pop(c, t + 0.5 + d * 0.5 + i * 0.1, 0.6); });
    var ghost = $(el, ".ghost-text");
    if (ghost) {
      tl.fromTo(ghost, { opacity: 0, x: 120 }, { opacity: 1, x: 0, duration: 1.4, ease: M.soft }, t);
      tl.to(ghost, { x: -60, duration: Math.max(s.end - t, 1), ease: "none" }, t + 1.4);
    }
    highlightMarks(el, t + d + 0.3);
  };

  enter.statement = function (el, s, t) {
    var ico = $(el, ".statement-icon");
    if (ico) {
      tl.fromTo(ico, { opacity: 0, scale: 0.7, rotation: -12 }, { opacity: 0.14, scale: 1, rotation: 0, duration: 1.1, ease: M.enter }, t);
      tl.to(ico, { y: -24, duration: 3, ease: "sine.inOut", yoyo: true, repeat: repeats(s.end - t, 3) }, t + 1.1);
    }
    if ($(el, ".tag")) slideX($(el, ".tag"), t, -40, M.fast * 1.4);
    var d = textIn($(el, ".statement-text"), t + 0.15);
    fadeUp($(el, ".statement-sub"), t + 0.25 + d * 0.7, 26);
    if (!s.beats.some(function (b) { return b.do === "highlight"; })) highlightMarks(el, t + d + 0.25);
  };

  function checklist(el, s, t) {
    var head = $(el, ".checklist-head");
    fadeUp(head, t, 24, M.base);
    var items = $$(el, ".check-item");
    var cued = revealTargets(s);
    items.forEach(function (it, i) {
      if (cued[i + 1]) return;
      revealCheck(it, t + 0.35 + i * 0.16);
    });
  }
  function revealCheck(it, t) {
    tl.fromTo(it, { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: M.base, ease: M.enter }, t);
    var box = $(it, ".check-box");
    if (box) tl.fromTo(box, { scale: 0.4 }, { scale: 1, duration: 0.5, ease: M.emphasis }, t + 0.08);
    var path = $(it, ".check-path");
    if (path) tl.fromTo(path, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.45, ease: "power2.out" }, t + 0.28);
  }
  enter.objectives = checklist;
  enter.recap = checklist;

  enter.concept = function (el, s, t) {
    var rings = $$(el, ".concept-rings i");
    rings.forEach(function (r, i) { tl.fromTo(r, { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.9, ease: M.enter }, t + i * 0.1); });
    var icon = $(el, ".concept-icon");
    pop(icon, t + 0.3, 0.8);
    if (icon) tl.to(icon, { y: -14, duration: 2.4, ease: "sine.inOut", yoyo: true, repeat: repeats(s.end - t, 2.4) }, t + 1.1);
    if (rings[0]) tl.to(rings[0], { rotation: 90, duration: Math.max(s.end - t, 1), ease: "none" }, t + 0.9);
    slideX($(el, ".tag"), t + 0.2, -30, M.fast * 1.4);
    var d = textIn($(el, ".concept-term"), t + 0.3);
    var rule = $(el, ".concept-rule");
    if (rule) tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: M.move }, t + 0.35 + d * 0.5);
    fadeUp($(el, ".concept-def"), t + 0.5 + d * 0.6, 24);
    var ex = $(el, ".concept-example");
    if (ex) slideX(ex, t + 0.9 + d * 0.6, 50, M.base);
  };

  enter.bullets = function (el, s, t) {
    fadeUp($(el, ".scene-title"), t, 30, M.base);
    var cued = revealTargets(s);
    var grid = el.querySelector('[data-layout="grid"]');
    $$(el, ".item").forEach(function (it, i) {
      if (cued[i + 1]) return;
      revealListItem(it, t + 0.3 + i * Math.max(0.12, M.stagger * 1.6), grid);
    });
  };
  function revealListItem(it, t, grid) {
    if (grid) tl.fromTo(it, { opacity: 0, y: 40, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: M.base, ease: M.enter }, t);
    else tl.fromTo(it, { opacity: 0, x: -M.distance }, { opacity: 1, x: 0, duration: M.base, ease: M.enter }, t);
    var badge = $(it, ".item-badge");
    if (badge) tl.fromTo(badge, { scale: 0.3, rotation: -20 }, { scale: 1, rotation: 0, duration: 0.55, ease: M.emphasis }, t + 0.06);
  }

  function codeGeometry(el) {
    var body = $(el, ".editor-body");
    var lines = $$(el, ".code-line");
    return {
      body: body,
      stage: $(el, ".code-stage"),
      lines: lines,
      top: lines.map(function (l) { return offsetWithin(l, body).y; }),
      h: lines.length ? lines[0].offsetHeight : 40,
    };
  }

  enter.code = function (el, s, t) {
    fadeUp($(el, ".scene-title"), t, 26, M.base);
    var ed = $(el, ".editor");
    tl.fromTo(ed, { opacity: 0, y: 60, rotationX: 8 }, { opacity: 1, y: 0, rotationX: 0, duration: M.slow, ease: M.enter }, t + 0.1);
    var g = codeGeometry(el);
    el.__code = g;
    if (s.meta.typing && s.type === "code") {
      var budget = Math.min(Math.max((s.voiceEnd - s.voiceStart) * 0.55, 1.2), 4.2);
      var chars = g.lines.map(function (l) { return Math.max(l.textContent.length - 3, 1); });
      var total = chars.reduce(function (a, b) { return a + b; }, 0);
      var cursor = t + 0.45;
      g.lines.forEach(function (l, i) {
        var d = Math.max(0.08, (chars[i] / total) * budget);
        tl.fromTo($(l, ".lc"), { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: d, ease: "steps(" + Math.max(2, Math.round(chars[i] / 1.5)) + ")" }, cursor);
        tl.fromTo($(l, ".ln"), { opacity: 0 }, { opacity: 1, duration: 0.1 }, cursor);
        cursor += d;
      });
    } else {
      var plainLines = g.lines.filter(function (l) { return !l.classList.contains("diff-add"); });
      tl.fromTo(plainLines, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.4, ease: M.enter, stagger: 0.035 }, t + 0.3);
    }
    if (s.type === "diff") {
      var at = firstBeat(s, ["reveal", "focus", "show"]);
      var when = at != null ? at : s.voiceStart + (s.voiceEnd - s.voiceStart) * 0.4;
      $$(el, ".diff-del").forEach(function (l, i) {
        tl.fromTo($(l, ".strike"), { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: "power2.out" }, when + i * 0.08);
        tl.to(l, { opacity: 0.55, duration: 0.3, immediateRender: false }, when + i * 0.08 + 0.2);
      });
      $$(el, ".diff-add").forEach(function (l, i) {
        tl.fromTo(l, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.45, ease: M.enter, immediateRender: true }, when + 0.35 + i * 0.1);
      });
    }
    if (s.meta.focus) focusLines(el, s, parseLines(s.meta.focus), t + 1.2, null);
  };
  enter.diff = enter.code;

  function parseLines(spec) {
    var out = [];
    String(spec).split(",").forEach(function (part) {
      var m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return;
      var a = +m[1], b = m[2] ? +m[2] : a;
      for (var i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
    });
    return out;
  }

  function focusLines(el, s, lines, t, noteId) {
    var g = el.__code || codeGeometry(el);
    if (!lines || !lines.length) return;
    var set = {};
    lines.forEach(function (n) { set[n] = true; });
    g.lines.forEach(function (l, i) {
      tl.to(l, { opacity: set[i + 1] ? 1 : 0.28, duration: 0.35, ease: "power2.out", immediateRender: false }, t);
    });
    var first = Math.min.apply(null, lines) - 1, last = Math.max.apply(null, lines) - 1;
    first = Math.max(0, Math.min(first, g.lines.length - 1));
    last = Math.max(0, Math.min(last, g.lines.length - 1));
    var bar = $(el, ".focus-bar");
    var top = g.top[first] - 4, h = g.top[last] + g.h - g.top[first] + 8;
    if (bar) {
      if (!bar.__shown) {
        tl.fromTo(bar, { opacity: 0, top: top, height: h }, { opacity: 1, duration: 0.3, immediateRender: false }, t);
        bar.__shown = true;
      } else {
        tl.to(bar, { top: top, height: h, duration: 0.45, ease: M.move, immediateRender: false }, t);
      }
    }
    if (noteId != null) {
      var note = el.querySelector('.note[data-note="' + noteId + '"]');
      if (note) {
        var stage = $(el, ".code-stage");
        var y = PORTRAIT ? 0 : Math.max(0, offsetWithin(g.lines[first], stage).y - 10);
        note.style.top = y + "px";
        $$(el, ".note").forEach(function (n) {
          if (n !== note && n.__visible) { tl.to(n, { opacity: 0, x: 20, duration: 0.25, immediateRender: false }, t); n.__visible = false; }
        });
        tl.fromTo(note, { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.45, ease: M.enter, immediateRender: false }, t + 0.1);
        note.__visible = true;
      }
    }
  }

  enter.terminal = function (el, s, t) {
    fadeUp($(el, ".scene-title"), t, 26, M.base);
    tl.fromTo($(el, ".terminal"), { opacity: 0, y: 50, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: M.slow, ease: M.enter }, t + 0.1);
    var blocks = $$(el, ".term-block");
    var cued = revealTargets(s);
    var span = Math.max(s.voiceEnd - s.voiceStart, 1.5);
    blocks.forEach(function (b, i) {
      if (cued[i + 1]) return;
      typeCommand(b, i === 0 ? t + 0.6 : s.voiceStart + (span * i) / blocks.length);
    });
  };
  function typeCommand(block, t) {
    var cmd = $(block, ".cmd-text");
    var chars = cmd ? cmd.textContent.length : 10;
    var d = Math.min(1.6, 0.25 + chars * 0.035);
    tl.fromTo(block, { opacity: 0 }, { opacity: 1, duration: 0.15 }, t);
    if (cmd) tl.fromTo(cmd, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: d, ease: "steps(" + Math.max(chars, 2) + ")" }, t + 0.1);
    var caret = $(block, ".caret");
    if (caret) {
      tl.fromTo(caret, { opacity: 0 }, { opacity: 1, duration: 0.01 }, t + 0.1);
      tl.to(caret, { opacity: 0, duration: 0.01, immediateRender: false }, t + 0.25 + d + 0.25);
    }
    var out = $(block, ".term-out");
    if (out) tl.fromTo(out, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }, t + d + 0.3);
  }

  enter.diagram = function (el, s, t) {
    fadeUp($(el, ".scene-title"), t, 26, M.base);
    var nodes = {};
    $$(el, ".node").forEach(function (n) { nodes[n.getAttribute("data-node")] = n; });
    var shown = {};
    var cuedNodes = {};
    var order = s.meta.order || [];
    s.beats.forEach(function (b) {
      if (b.do !== "show" && b.do !== "reveal") return;
      var id = typeof b.target === "number" ? order[b.target - 1] : b.target;
      if (typeof id === "string" && nodes[id] && cuedNodes[id] == null) cuedNodes[id] = b.t;
    });
    var progressive = s.meta.progressive && !Object.keys(cuedNodes).length;
    var span = Math.max(s.voiceEnd - s.voiceStart, 2) * 0.65;
    order.forEach(function (id, i) {
      var at = cuedNodes[id] != null ? cuedNodes[id]
        : progressive ? s.voiceStart + (span * i) / Math.max(order.length, 1)
        : t + 0.3 + i * 0.12;
      shown[id] = at;
      var n = nodes[id];
      tl.fromTo(n, { opacity: 0, scale: 0.8, y: 20 }, { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: M.emphasis }, at);
      tl.fromTo($(n, ".node-icon"), { scale: 0, rotation: -30 }, { scale: 1, rotation: 0, duration: 0.5, ease: M.emphasis }, at + 0.12);
    });
    var edges = $$(el, ".edge");
    (s.meta.edges || []).forEach(function (pair, i) {
      var e = edges[i];
      if (!e) return;
      var at = Math.max(shown[pair[0]] || t, shown[pair[1]] || t) + 0.35;
      tl.fromTo(e, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.7, ease: "power2.inOut" }, at);
      var head = el.querySelector('.arrow-head[data-edge="' + i + '"]');
      if (head) tl.fromTo(head, { opacity: 0, scale: 0.2, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.3, ease: M.emphasis }, at + 0.6);
      var label = el.querySelector('.edge-label[data-edge="' + i + '"]');
      if (label) tl.fromTo(label, { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.4, ease: M.emphasis }, at + 0.45);
    });
  };

  function flowPacket(el, s, b) {
    if (b.flowId == null) return;
    var packet = el.querySelector('.packet[data-packet="' + b.flowId + '"]');
    var path = el.querySelector('#flow-' + s.key + '-' + b.flowId);
    if (!packet || !path) return;
    var len = path.getTotalLength ? path.getTotalLength() : 800;
    var d = Math.min(2.4, Math.max(0.9, len / 700));
    tl.set(packet, { opacity: 1 }, b.t);
    tl.fromTo(packet, { motionPath: { path: path, align: path, alignOrigin: [0.5, 0.5], start: 0, end: 0 } },
      { motionPath: { path: path, align: path, alignOrigin: [0.5, 0.5], start: 0, end: 1 }, duration: d, ease: "power1.inOut", immediateRender: false }, b.t);
    tl.to(packet, { opacity: 0, scale: 1.8, duration: 0.3, immediateRender: false }, b.t + d);
    // light up the nodes the packet passes
    (b.path || []).forEach(function (id, i) {
      var n = el.querySelector('.node[data-node="' + id + '"]');
      if (n) pulseNode(n, b.t + (d * i) / Math.max(b.path.length - 1, 1));
    });
  }
  function pulseNode(n, t) {
    var ring = $(n, ".ring-pulse");
    if (ring) tl.fromTo(ring, { opacity: 1, scale: 0.94 }, { opacity: 0, scale: 1.14, duration: 0.7, ease: "power2.out", immediateRender: false }, t);
  }

  enter.layers = function (el, s, t) {
    fadeUp($(el, ".scene-title"), t, 26, M.base);
    var cued = revealTargets(s);
    if (s.meta.mode === "onion") {
      var rings = $$(el, ".ring");
      rings.forEach(function (r, i) {
        if (cued[i + 1]) return;
        revealRing(el, r, i, t + 0.25 + i * 0.25);
      });
      fadeUp($(el, ".onion-arrow"), t + 0.4 + rings.length * 0.25, 12);
    } else {
      var layers = $$(el, ".layer");
      var core = layers.findIndex(function (l) { return l.classList.contains("is-core"); });
      var orderIdx = layers.map(function (_, i) { return i; });
      if (core >= 0) orderIdx.sort(function (a, b) { return Math.abs(a - core) - Math.abs(b - core); });
      orderIdx.forEach(function (i, k) {
        if (cued[i + 1]) return;
        revealLayer(el, layers[i], i, t + 0.25 + k * 0.28);
      });
      fadeUp($(el, ".layers-rule"), t + 0.5 + layers.length * 0.28, 16);
    }
  };
  function revealLayer(el, layer, i, t) {
    tl.fromTo(layer, { opacity: 0, scaleX: 0.86, y: 20 }, { opacity: 1, scaleX: 1, y: 0, duration: M.base, ease: M.enter }, t);
    tl.fromTo($$(layer, ".chip"), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out", stagger: 0.06 }, t + 0.25);
    var arrows = [el.querySelector('.layer-arrow[data-arrow="' + i + '"]'), el.querySelector('.layer-arrow[data-arrow="' + (i + 1) + '"]')];
    arrows.forEach(function (a) {
      if (a && !a.__shown) {
        a.__shown = true;
        var up = a.getAttribute("data-dir") === "up";
        tl.fromTo(a, { opacity: 0, y: up ? 18 : -18 }, { opacity: 1, y: 0, duration: 0.45, ease: M.enter }, t + 0.35);
      }
    });
  }
  function revealRing(el, r, i, t) {
    tl.fromTo(r, { opacity: 0, scale: 0.75 }, { opacity: 1, scale: 1, duration: 0.7, ease: M.enter }, t);
    var row = el.querySelector('.legend-row[data-item="' + (i + 1) + '"]');
    if (row) slideX(row, t + 0.15, 40, M.base);
  }

  enter.phone = function (el, s, t) {
    var phone = $(el, ".phone");
    tl.fromTo(phone, { opacity: 0, y: 140, rotation: -5 }, { opacity: 1, y: 0, rotation: 0, duration: M.slow, ease: M.enter }, t);
    fadeUp($(el, ".app-bar"), t + 0.45, 14, 0.4);
    tl.fromTo($$(el, ".app-row"), { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.4, ease: M.enter, stagger: 0.07 }, t + 0.55);
    fadeUp($(el, ".app-button"), t + 0.9, 20, 0.45);
    var toast = $(el, ".app-toast");
    if (toast) fadeUp(toast, s.voiceStart + (s.voiceEnd - s.voiceStart) * 0.5, 40, 0.45);
    fadeUp($(el, ".scene-title"), t + 0.1, 26, M.base);
    var cued = revealTargets(s);
    $$(el, ".callout").forEach(function (c, i) {
      if (!cued[i + 1]) revealCallout(el, i + 1, t + 0.9 + i * 0.25);
    });
    $$(el, ".point").forEach(function (p, i) { slideX(p, t + 0.8 + i * 0.18, 40, M.base); });
    tl.to(phone, { y: -10, duration: 2.6, ease: "sine.inOut", yoyo: true, repeat: repeats(s.end - t, 2.6) }, t + M.slow);
  };
  function revealCallout(el, n, t) {
    var marker = el.querySelector('.callout-marker[data-item="' + n + '"]');
    var line = el.querySelector('.callout-line[data-item="' + n + '"]');
    var label = el.querySelector('.callout[data-item="' + n + '"]');
    if (marker) tl.fromTo(marker, { opacity: 0, scale: 0.2 }, { opacity: 1, scale: 1, duration: 0.45, ease: M.emphasis }, t);
    if (line) tl.fromTo(line, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.5, ease: "power2.out" }, t + 0.15);
    if (label) tl.fromTo(label, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.45, ease: M.enter }, t + 0.4);
  }
  function tap(el, n, t) {
    var dots = $$(el, '.tap[data-tap="' + n + '"] i');
    if (!dots.length) return;
    tl.fromTo(dots[0], { opacity: 0.9, scale: 0.35 }, { opacity: 0, scale: 1.6, duration: 0.7, ease: "power2.out", immediateRender: false }, t);
    tl.fromTo(dots[1], { opacity: 1, scale: 0.5 }, { opacity: 0, scale: 2.2, duration: 0.8, ease: "power2.out", immediateRender: false }, t + 0.05);
    var row = el.querySelector('.app-row[data-row="' + n + '"]');
    if (row) tl.fromTo(row, { backgroundColor: "rgba(0,0,0,0)" }, { backgroundColor: C.positiveBg || "rgba(127,127,127,0.2)", duration: 0.2, yoyo: true, repeat: 1, immediateRender: false }, t);
  }

  enter.compare = function (el, s, t) {
    fadeUp($(el, ".scene-title"), t, 26, M.base);
    tl.fromTo($$(el, ".cmp-head"), { opacity: 0, y: -24 }, { opacity: 1, y: 0, duration: M.base, ease: M.enter, stagger: 0.1 }, t + 0.2);
    var cued = revealTargets(s);
    $$(el, ".cmp-row").forEach(function (r, i) {
      if (!cued[i + 1]) revealRow(r, t + 0.55 + i * 0.2);
    });
    var crown = $(el, ".cmp-crown");
    if (crown) {
      var col = +crown.getAttribute("data-col");
      var head = el.querySelector('.cmp-head[data-col="' + col + '"]');
      var cmp = $(el, ".cmp");
      if (head && cmp) crown.style.left = offsetWithin(head, cmp).x + head.offsetWidth / 2 + "px";
      var at = Math.max(s.voiceEnd - 1.2, t + 1.2);
      tl.fromTo(crown, { opacity: 0, y: -40, scale: 0.4, xPercent: -50 }, { opacity: 1, y: 0, scale: 1, xPercent: -50, duration: 0.7, ease: M.emphasis }, at);
      $$(el, '.cmp-cell[data-col="' + col + '"], .cmp-head[data-col="' + col + '"]').forEach(function (c) {
        tl.to(c, { borderColor: C.accent, duration: 0.4, immediateRender: false }, at + 0.1);
      });
    }
  };
  function revealRow(r, t) {
    tl.fromTo(r, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: M.base, ease: M.enter }, t);
    tl.fromTo($$(r, ".cmp-bool"), { scale: 0 }, { scale: 1, duration: 0.45, ease: M.emphasis, stagger: 0.08 }, t + 0.2);
  }

  enter.quiz = function (el, s, t) {
    slideX($(el, ".tag"), t, -30, M.fast * 1.4);
    var d = textIn($(el, ".quiz-q"), t + 0.15, { mode: M.text === "scramble" ? "rise" : M.text });
    var opts = $$(el, ".quiz-opt");
    opts.forEach(function (o, i) {
      tl.fromTo(o, { opacity: 0, y: 36, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: M.base, ease: M.enter }, t + 0.3 + d * 0.5 + i * 0.12);
    });
    var cd = s.meta.countdown;
    var wrap = $(el, ".countdown");
    if (cd && wrap) {
      tl.fromTo(wrap, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.4, ease: M.emphasis }, cd.start - 0.2);
      tl.fromTo($(el, ".cd-ring"), { drawSVG: "0% 100%" }, { drawSVG: "100% 100%", duration: cd.end - cd.start, ease: "none" }, cd.start);
      $$(el, ".cd-n").forEach(function (n) {
        var k = +n.getAttribute("data-n");
        var at = cd.start + (cd.secs - k);
        tl.fromTo(n, { opacity: 0, scale: 1.5 }, { opacity: 1, scale: 1, duration: 0.25, ease: "power2.out" }, at);
        tl.to(n, { opacity: 0, duration: 0.15, immediateRender: false }, at + 0.85);
      });
      tl.to(wrap, { opacity: 0, scale: 0.8, duration: 0.3, immediateRender: false }, cd.end);
    }
    var ansAt = quizAnswerAt(s, t);
    revealAnswer(el, ansAt);
    var ex = $(el, ".quiz-explain");
    if (ex) fadeUp(ex, ansAt + 0.6, 20);
  };
  function quizAnswerAt(s, t) {
    var a = firstBeat(s, ["answer"]);
    var cd = s.meta.countdown;
    if (a == null) a = cd ? cd.end : Math.max(s.voiceEnd - 1.0, t + 1.5);
    return a;
  }
  function revealAnswer(el, t) {
    var ans = $(el, ".quiz-opt.is-answer");
    $$(el, ".quiz-opt").forEach(function (o) {
      if (o === ans) return;
      tl.to(o, { opacity: 0.4, duration: 0.35, immediateRender: false }, t);
    });
    if (!ans) return;
    tl.to(ans, { backgroundColor: C.positiveBg, borderColor: C.positive, scale: 1.04, duration: 0.35, ease: M.emphasis, immediateRender: false }, t);
    tl.to(ans, { scale: 1, duration: 0.4, ease: "power2.out", immediateRender: false }, t + 0.4);
    tl.fromTo($(ans, ".opt-mark"), { opacity: 0, scale: 0.3 }, { opacity: 1, scale: 1, duration: 0.45, ease: M.emphasis }, t + 0.1);
    var conf = $$(el, ".confetti i");
    var box = $(el, ".confetti");
    var opts = $(el, ".quiz-opts");
    if (box && opts) {
      var p = offsetWithin(ans, opts);
      box.style.left = p.x + ans.offsetWidth / 2 + "px";
      box.style.top = p.y + ans.offsetHeight / 2 + "px";
    }
    conf.forEach(function (c, i) {
      var st = getComputedStyle(c);
      var dx = parseFloat(st.getPropertyValue("--dx")) || 0, dy = parseFloat(st.getPropertyValue("--dy")) || 0;
      tl.fromTo(c, { opacity: 1, x: 0, y: 0, rotation: 0, scale: 1 },
        { opacity: 0, x: dx, y: dy + 140, rotation: parseFloat(st.getPropertyValue("--r")) || 180, scale: 0.8, duration: 1.3, ease: "power2.out", immediateRender: false }, t + 0.05 + (i % 5) * 0.015);
    });
  }

  enter.image = function (el, s, t) {
    var img = $(el, ".image-frame img");
    var motion = s.meta.motion || "zoom-in";
    var D = Math.max(s.until - s.start, 1);
    var from = { scale: 1.02, xPercent: 0 }, to = { scale: 1.14, xPercent: 0 };
    if (motion === "zoom-out") { from = { scale: 1.16, xPercent: 0 }; to = { scale: 1.02, xPercent: 0 }; }
    if (motion === "pan-left") { from = { scale: 1.14, xPercent: 3 }; to = { scale: 1.14, xPercent: -3 }; }
    if (motion === "pan-right") { from = { scale: 1.14, xPercent: -3 }; to = { scale: 1.14, xPercent: 3 }; }
    if (img && motion !== "none") { to.duration = D; to.ease = "none"; tl.fromTo(img, from, to, s.start); }
    fadeUp($(el, ".image-caption"), t + 0.3, 40, M.base);
  };

  enter.intro = function (el, s, t) {
    var lines = $$(el, ".intro-lines i");
    lines.forEach(function (l, i) {
      var rot = i * (360 / lines.length) + 11;
      tl.fromTo(l, { rotation: rot, scaleX: 0, opacity: 0.9 }, { rotation: rot, scaleX: 1, opacity: 0, duration: 1.3, ease: "expo.out" }, t + i * 0.02);
    });
    var logo = $(el, ".intro-logo");
    tl.fromTo(logo, { opacity: 0, scale: 0.72, filter: "blur(12px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 1.0, ease: "expo.out" }, t + 0.1);
    tl.to(logo, { scale: 1.05, duration: Math.max(s.end - t - 1.1, 0.5), ease: "none" }, t + 1.1);
    fadeUp($(el, ".intro-tagline"), t + 0.6, 24, 0.6);
    fadeUp($(el, ".intro-meta"), t + 0.8, 16, 0.5);
  };

  enter.chapter = function (el, s, t) {
    var ghost = $(el, ".chapter-ghost");
    if (ghost) {
      tl.fromTo(ghost, { opacity: 0, x: 160 }, { opacity: 1, x: 0, duration: 1.2, ease: M.enter }, t);
      tl.to(ghost, { x: -40, duration: Math.max(s.end - t - 1.2, 0.5), ease: "none" }, t + 1.2);
    }
    fadeUp($(el, ".chapter-num"), t + 0.1, 20, M.base);
    textIn($(el, ".chapter-title"), t + 0.25);
    tl.fromTo($$(el, ".chapter-dots i"), { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.5, ease: M.enter, stagger: 0.07 }, t + 0.5);
  };

  enter.outro = function (el, s, t) {
    tl.fromTo($(el, ".outro-logo"), { opacity: 0, y: -40, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: M.slow, ease: M.enter }, t);
    var d = textIn($(el, ".outro-title"), t + 0.25);
    fadeUp($(el, ".outro-sub"), t + 0.4 + d * 0.5, 20);
    var next = $(el, ".outro-next");
    if (next) tl.fromTo(next, { opacity: 0, y: 40, scale: 0.95 }, { opacity: 1, y: 0, scale: 1, duration: M.base, ease: M.enter }, t + 0.7 + d * 0.5);
    tl.fromTo($$(el, ".btn"), { opacity: 0, y: 30, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: M.emphasis, stagger: 0.12 }, t + 0.9 + d * 0.5);
    var primary = $(el, ".btn-primary");
    if (primary) tl.to(primary, { scale: 1.05, duration: 0.8, ease: "sine.inOut", yoyo: true, repeat: repeats(Math.max(s.until - t - 2, 0.8), 0.8) }, t + 1.8);
  };

  // ── beats (synced to narration) ────────────────────────────────────────
  function revealTargets(s) {
    var m = {};
    s.beats.forEach(function (b) {
      if ((b.do === "reveal" || b.do === "type" || b.do === "show") && typeof b.target === "number") m[b.target] = true;
    });
    return m;
  }
  function firstBeat(s, kinds) {
    for (var i = 0; i < s.beats.length; i++) if (kinds.indexOf(s.beats[i].do) >= 0) return s.beats[i].t;
    return null;
  }

  function applyBeat(el, s, b) {
    var type = s.type;
    var n = typeof b.target === "number" ? b.target : null;
    switch (b.do) {
      case "reveal":
      case "show":
      case "type":
        if (type === "diagram") return; // handled in enter.diagram (node ids)
        if (n == null) { if (type === "statement") highlightMarks(el, b.t); return; }
        if (type === "bullets") revealListItem(el.querySelector('.item[data-item="' + n + '"]'), b.t, el.querySelector('[data-layout="grid"]'));
        else if (type === "objectives" || type === "recap") { var it = el.querySelector('.check-item[data-item="' + n + '"]'); if (it) revealCheck(it, b.t); }
        else if (type === "terminal") { var blk = el.querySelector('.term-block[data-item="' + n + '"]'); if (blk) typeCommand(blk, b.t); }
        else if (type === "compare") { var r = el.querySelector('.cmp-row[data-item="' + n + '"]'); if (r) revealRow(r, b.t); }
        else if (type === "layers") {
          if (s.meta.mode === "onion") { var ring = el.querySelector('.ring[data-item="' + n + '"]'); if (ring) revealRing(el, ring, n - 1, b.t); }
          else { var lay = el.querySelector('.layer[data-item="' + n + '"]'); if (lay) revealLayer(el, lay, n - 1, b.t); }
        }
        else if (type === "phone") revealCallout(el, n, b.t);
        return;
      case "focus":
        if (b.lines) focusLines(el, s, b.lines, b.t, b.noteId);
        return;
      case "highlight":
        if (type === "diagram" && typeof b.target === "string") {
          var node = el.querySelector('.node[data-node="' + b.target + '"]');
          if (node) { pulseNode(node, b.t); tl.fromTo(node, { scale: 1 }, { scale: 1.07, duration: 0.3, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, b.t); }
        } else if (type === "layers" && n != null) {
          var l2 = el.querySelector('[data-item="' + n + '"].layer, [data-item="' + n + '"].ring');
          if (l2) tl.fromTo(l2, { borderColor: C.line }, { borderColor: C.accent, duration: 0.35, immediateRender: false }, b.t);
        } else if (type === "bullets" && n != null) {
          var bi = el.querySelector('.item[data-item="' + n + '"]');
          if (bi) tl.fromTo(bi, { scale: 1 }, { scale: 1.035, duration: 0.3, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, b.t);
        } else {
          highlightMarks(el, b.t);
        }
        return;
      case "flow":
        flowPacket(el, s, b);
        return;
      case "tap":
        if (n != null) tap(el, n, b.t);
        return;
      case "check": {
        var ci = el.querySelector('.check-item[data-item="' + n + '"] .check-path');
        if (ci) tl.fromTo(ci, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.4, ease: "power2.out", immediateRender: false }, b.t);
        return;
      }
      case "answer":
        return; // enter.quiz reads it
      case "zoom": {
        // camera push-in on a node / item / row ({zoom:repo}, {zoom:2}); {zoom:out} resets
        var content = $(el, ".content");
        if (!content) return;
        if (b.target === "out") {
          tl.to(content, { scale: 1, duration: 0.8, ease: M.move, immediateRender: false }, b.t);
          return;
        }
        var tgt = typeof b.target === "string"
          ? el.querySelector('[data-node="' + b.target + '"], [data-lid="' + b.target + '"]')
          : n != null ? el.querySelector('[data-item="' + n + '"], [data-row="' + n + '"]') : null;
        var origin = "50% 50%";
        if (tgt) {
          var p = offsetWithin(tgt, content);
          origin = Math.round(p.x + tgt.offsetWidth / 2) + "px " + Math.round(p.y + tgt.offsetHeight / 2) + "px";
        }
        tl.to(content, { scale: 1.16, transformOrigin: origin, duration: 0.9, ease: M.move, immediateRender: false }, b.t);
        return;
      }
    }
  }

  // ── mascot (brand avatar: pop-in, float, blink, pose, lip-sync) ─────────
  var ARM_L = "26 108", ARM_R = "174 108";
  function armTo(a, origin, rot, t, d, ease) {
    if (!a) return;
    tl.to(a, { rotation: rot, svgOrigin: origin, duration: d || 0.45, ease: ease || "back.out(1.8)", immediateRender: false }, t);
  }
  function showPose(box, pose, t) {
    var imgs = $$(box, ".m-img");
    if (!imgs.length) return;
    var has = imgs.some(function (i) { return i.getAttribute("data-pose") === pose; });
    var want = has ? pose : "idle";
    imgs.forEach(function (i) { tl.set(i, { opacity: i.getAttribute("data-pose") === want ? 1 : 0 }, t); });
  }
  function mascotCelebrate(box, t, end) {
    var L = $(box, ".m-arm-l"), R = $(box, ".m-arm-r");
    showPose(box, "celebrate", t);
    armTo(L, ARM_L, 160, t, 0.4);
    armTo(R, ARM_R, -160, t, 0.4);
    var eyes = $(box, ".m-eyes"), happy = $(box, ".m-eyes-happy"), dots = $$(box, ".m-think circle");
    if (eyes) tl.to(eyes, { opacity: 0, duration: 0.1, immediateRender: false }, t);
    if (happy) tl.to(happy, { opacity: 1, duration: 0.1, immediateRender: false }, t);
    if (dots.length) tl.to(dots, { opacity: 0, scale: 0.4, duration: 0.2, immediateRender: false }, t);
    var jumper = $(box, ".m-svg") || $(box, ".m-float");
    tl.to(jumper, { y: -34, duration: 0.26, ease: "power2.out", immediateRender: false }, t);
    tl.to(jumper, { y: 0, duration: 0.55, ease: "bounce.out", immediateRender: false }, t + 0.26);
    $$(box, ".m-sparkles path").forEach(function (p, i) {
      tl.fromTo(p, { opacity: 0, scale: 0, rotation: -45, transformOrigin: "50% 50%" },
        { opacity: 1, scale: 1.2, rotation: 45, duration: 0.35, ease: "back.out(2)", immediateRender: false }, t + 0.1 + i * 0.08);
      tl.to(p, { opacity: 0, scale: 0.4, duration: 0.4, immediateRender: false }, t + 0.95 + i * 0.08);
    });
    var pumps = Math.max(0, Math.min(3, Math.floor((end - t - 1) / 0.6)));
    if (pumps > 0 && L && R) {
      tl.to(L, { rotation: 140, svgOrigin: ARM_L, duration: 0.3, yoyo: true, repeat: pumps * 2 - 1, ease: "sine.inOut", immediateRender: false }, t + 0.6);
      tl.to(R, { rotation: -140, svgOrigin: ARM_R, duration: 0.3, yoyo: true, repeat: pumps * 2 - 1, ease: "sine.inOut", immediateRender: false }, t + 0.6);
    }
  }
  var POSE = {
    idle: function (box, m, t, end) {
      var L = $(box, ".m-arm-l"), R = $(box, ".m-arm-r"), D = Math.max(end - t, 0.5);
      if (L) tl.fromTo(L, { rotation: 0, svgOrigin: ARM_L }, { rotation: 6, svgOrigin: ARM_L, duration: 1.4, ease: "sine.inOut", yoyo: true, repeat: repeats(D, 1.4) }, t);
      if (R) tl.fromTo(R, { rotation: 0, svgOrigin: ARM_R }, { rotation: -6, svgOrigin: ARM_R, duration: 1.4, ease: "sine.inOut", yoyo: true, repeat: repeats(D, 1.4) }, t + 0.3);
    },
    wave: function (box, m, t, end) {
      var outerLeft = m.side === "left";
      var A = $(box, outerLeft ? ".m-arm-l" : ".m-arm-r"), O = outerLeft ? ARM_L : ARM_R, sg = outerLeft ? 1 : -1;
      if (!A) {
        var fig = $(box, ".m-float");
        if (fig) tl.to(fig, { rotation: 4 * sg, duration: 0.3, yoyo: true, repeat: 5, ease: "sine.inOut", transformOrigin: "50% 100%", immediateRender: false }, t + 0.4);
        return;
      }
      tl.fromTo(A, { rotation: 0, svgOrigin: O }, { rotation: 145 * sg, svgOrigin: O, duration: 0.45, ease: "back.out(1.8)", immediateRender: false }, t + 0.15);
      var waveFor = Math.min(3.2, Math.max(end - t - 0.9, 0.6));
      var k = Math.max(1, Math.floor(waveFor / 0.52));
      tl.to(A, { rotation: 115 * sg, svgOrigin: O, duration: 0.26, ease: "sine.inOut", yoyo: true, repeat: k * 2 - 1, immediateRender: false }, t + 0.6);
      var down = t + 0.6 + k * 0.52 + 0.05;
      if (end - down > 1.2) armTo(A, O, 0, down, 0.55, "power2.inOut");
    },
    point: function (box, m, t) {
      var right = m.side === "right";
      var A = $(box, right ? ".m-arm-l" : ".m-arm-r"), O = right ? ARM_L : ARM_R, sg = right ? 1 : -1;
      if (!A) return;
      tl.fromTo(A, { rotation: 0, svgOrigin: O }, { rotation: 100 * sg, svgOrigin: O, duration: 0.5, ease: "back.out(2)", immediateRender: false }, t + 0.25);
      tl.to(A, { rotation: 90 * sg, svgOrigin: O, duration: 0.22, yoyo: true, repeat: 3, ease: "sine.inOut", immediateRender: false }, t + 0.8);
    },
    think: function (box, m, t) {
      var A = $(box, ".m-arm-r");
      if (A) {
        tl.fromTo(A, { rotation: 0, svgOrigin: ARM_R }, { rotation: -168, svgOrigin: ARM_R, duration: 0.55, ease: "back.out(1.6)", immediateRender: false }, t + 0.2);
        tl.to(A, { rotation: -158, svgOrigin: ARM_R, duration: 0.18, yoyo: true, repeat: 5, ease: "sine.inOut", immediateRender: false }, t + 0.85);
      }
      var eyes = $(box, ".m-eyes");
      if (eyes) tl.to(eyes, { x: 3, y: -5, duration: 0.3, ease: "power2.out", immediateRender: false }, t + 0.3);
      $$(box, ".m-think circle").forEach(function (c, i) {
        tl.fromTo(c, { opacity: 0, scale: 0.3, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)", immediateRender: false }, t + 0.5 + i * 0.22);
      });
    },
    celebrate: function (box, m, t, end) { mascotCelebrate(box, t + 0.3, end); },
  };
  function mascotTalk(box, words, from, until) {
    var mouth = $(box, ".m-mouth");
    var img = mouth ? null : $(box, ".m-talk");
    if (!mouth && !img) return;
    if (mouth) tl.set(mouth, { scaleY: 0.42, transformOrigin: "50% 50%" }, 0);
    words.forEach(function (w, i) {
      if (w[0] < from || w[0] > until) return;
      var close = Math.max(w[0] + 0.07, w[1] - 0.07);
      if (mouth) {
        tl.to(mouth, { scaleY: 0.95 + (hash(i * 7 + 3) % 5) * 0.12, duration: 0.06, ease: "power1.out", immediateRender: false }, w[0]);
        tl.to(mouth, { scaleY: 0.42, duration: 0.08, ease: "power1.in", immediateRender: false }, close);
      } else {
        tl.to(img, { scaleY: 1.025, scaleX: 0.99, duration: 0.07, transformOrigin: "50% 100%", immediateRender: false }, w[0]);
        tl.to(img, { scaleY: 1, scaleX: 1, duration: 0.09, immediateRender: false }, close + 0.02);
      }
    });
  }
  function mascot(el, s, idx) {
    var m = s.meta.mascot, box = $(el, ".mascot");
    if (!m || !box) return;
    var t = s.kind === "intro" ? s.enterAt + 0.45 : s.enterAt + 0.25;
    var end = s.until;
    showPose(box, m.pose, 0);
    tl.fromTo(box, { opacity: 0, y: 90, scale: 0.6, transformOrigin: "50% 100%" }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(1.5)" }, t);
    var fl = $(box, ".m-float"), sh = $(box, ".m-shadow") || $(box, ".m-shadow-html");
    var D = Math.max(end - t - 0.7, 0.5);
    if (fl) tl.fromTo(fl, { y: 0 }, { y: -9, duration: 1.25, ease: "sine.inOut", yoyo: true, repeat: repeats(D, 1.25) }, t + 0.7);
    if (sh) tl.fromTo(sh, { scale: 1, opacity: 1, transformOrigin: "50% 50%" }, { scale: 0.84, opacity: 0.7, duration: 1.25, ease: "sine.inOut", yoyo: true, repeat: repeats(D, 1.25) }, t + 0.7);
    var face = $(box, ".m-face");
    if (face && m.pose !== "think") tl.to(face, { x: m.side === "right" ? -4 : 4, duration: 0.4, ease: "power2.out", immediateRender: false }, t + 0.6);
    var eyes = $(box, ".m-eyes");
    if (eyes) {
      var bt = t + 1.1 + (hash(idx + 5) % 9) * 0.1;
      for (var k = 0; bt < end - 0.3 && k < 40; k++) {
        tl.fromTo(eyes, { scaleY: 1 }, { scaleY: 0.1, duration: 0.07, ease: "power1.in", yoyo: true, repeat: 1, transformOrigin: "50% 50%", immediateRender: false }, bt);
        bt += 2.4 + (hash(idx * 31 + k * 13 + 7) % 18) * 0.1;
      }
    }
    (POSE[m.pose] || POSE.idle)(box, m, t, end, s);
    if (s.type === "quiz" && m.pose !== "celebrate") {
      var at = quizAnswerAt(s, s.enterAt);
      if (at > t + 0.5 && at < end - 0.3) {
        mascotCelebrate(box, at, end);
      }
    }
    if (m.talk && s.meta.talk && s.meta.talk.length) mascotTalk(box, s.meta.talk, t, end);
    var bub = $(box, ".m-bubble");
    if (bub) tl.fromTo(bub, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(2)" }, t + 0.55);
  }

  // ── build scenes ───────────────────────────────────────────────────────
  var prevEl = null;
  P.scenes.forEach(function (s, i) {
    var el = document.getElementById("sc-" + s.key);
    if (!el) return;
    tl.set(el, { visibility: "visible" }, s.start);
    tl.set(el, { visibility: "hidden" }, s.until);
    if (prevEl) transition(prevEl, el, s.transition, s.start);
    var t0 = i === 0 ? 0.15 : s.enterAt - Math.min(0.22, s.transition.dur * 0.4);
    var fn = enter[s.type];
    if (fn) fn(el, s, t0);
    s.beats.forEach(function (b) { applyBeat(el, s, b); });
    mascot(el, s, i);
    prevEl = el;
  });

  // ── shell ──────────────────────────────────────────────────────────────
  (function shell() {
    var D = P.duration;
    var fill = document.querySelector(".progress-fill");
    if (fill) tl.fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: D, ease: "none" }, 0);
    var logo = document.querySelector(".shell-logo");
    var ep = document.querySelector(".shell-episode");
    var pills = $$(document, ".chapter-pill");
    P.scenes.forEach(function (s) {
      if (s.kind === "intro" || s.kind === "outro") {
        [logo, ep].concat(pills.length ? [document.querySelector(".chapter-pills")] : []).forEach(function (x) {
          if (!x) return;
          tl.to(x, { opacity: 0, duration: 0.3, immediateRender: false }, s.start);
          if (s.kind === "intro") tl.to(x, { opacity: 1, duration: 0.4, immediateRender: false }, s.until);
        });
      }
    });
    var first = P.scenes[0];
    var shellIn = first && first.kind === "intro" ? first.until : 0.2;
    if (logo) tl.fromTo(logo, { opacity: 0 }, { opacity: 0.9, duration: 0.6 }, shellIn);
    if (ep) tl.fromTo(ep, { opacity: 0 }, { opacity: 1, duration: 0.6 }, shellIn + 0.1);
    P.chapters.forEach(function (c, i) {
      var pill = document.querySelector('.chapter-pill[data-chapter="' + c.index + '"]');
      if (!pill) return;
      tl.fromTo(pill, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }, c.start + 0.3);
      var next = P.chapters[i + 1];
      if (next) tl.to(pill, { opacity: 0, y: -12, duration: 0.3, immediateRender: false }, next.start + 0.1);
    });
  })();

  // ── captions (karaoke: active word highlighted) ───────────────────────
  (function captions() {
    var groups = $$(document, ".cap-group");
    P.captions.forEach(function (g, gi) {
      var el = groups[gi];
      if (!el) return;
      tl.fromTo(el, { opacity: 0, y: 18, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.14, ease: "power2.out" }, g.start);
      tl.to(el, { opacity: 0, duration: 0.1, immediateRender: false }, Math.max(g.end - 0.1, g.start + 0.15));
      var words = $$(el, ".cap-w");
      g.words.forEach(function (ws, wi) {
        var w = words[wi];
        if (!w) return;
        tl.set(w, { color: C.capActive }, ws);
        var nextStart = wi + 1 < g.words.length ? g.words[wi + 1] : g.end;
        tl.set(w, { color: C.capInk }, Math.max(nextStart, ws + 0.05));
      });
    });
  })();

  window.__timelines = window.__timelines || {};
  window.__timelines[P.compId] = tl;
})();
