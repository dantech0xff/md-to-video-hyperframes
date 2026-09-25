/* 3D templates (three.js, window.THREE from vendor/three.js).
 *
 * Contract with HyperFrames: every frame is a pure function of timeline time.
 * Each 3D scene registers one tween spanning its visible range; its onUpdate
 * poses the models for that time, renders with a single shared WebGL renderer
 * and copies the frame into the scene's own canvas (so any number of 3D
 * scenes fit in the browser's WebGL context limit). No requestAnimationFrame,
 * no clocks, randomness is seeded. Models are built in code, low-poly.
 *
 * World units are frame pixels at z = 0 (the camera distance makes 1 unit =
 * 1 px there), so placements come straight from the design sheet.
 */
(window.__LESSON_TEMPLATES__ = window.__LESSON_TEMPLATES__ || []).push(function (A) {
  var THREE = window.THREE;
  var tl = A.tl, M = A.M, $ = A.$, $$ = A.$$;
  var W = A.P.width, H = A.P.height;
  var FOV = 30;
  var DIST = H / 2 / Math.tan((FOV * Math.PI) / 360);
  var BRAND = { blue: 0x0091ff, deep: 0x0060b8, soft: 0x54b3ff, ink: 0x171a20, surface: 0x101216, slate: 0x28303c, gold: 0xffd166 };
  var FONT = "'Be Vietnam Pro', sans-serif";

  // ── shared renderer ──────────────────────────────────────────────────────
  var shared = null, failed = false;
  function renderer() {
    if (shared || failed) return shared;
    try {
      if (!THREE) throw new Error("three.js not loaded");
      shared = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      shared.setPixelRatio(1);
      shared.setSize(W, H, false);
      shared.setClearColor(0x000000, 0);
    } catch (e) {
      failed = true;
      window.__LESSON_3D_FAILED__ = String((e && e.message) || e);
      if (window.console) console.warn("[lesson] 3D disabled: " + window.__LESSON_3D_FAILED__);
    }
    return shared;
  }

  /** scene + camera + brand lighting; px(x, y) maps a frame pixel to world at z = 0 */
  function stage() {
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(FOV, W / H, 10, DIST * 4);
    camera.position.set(0, 0, DIST);
    camera.updateMatrixWorld();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x10131a, 1.15));
    var key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(-DIST * 0.8, DIST * 1.1, DIST);
    scene.add(key);
    var rim = new THREE.DirectionalLight(BRAND.soft, 2.2);
    rim.position.set(DIST * 0.7, DIST * 0.4, -DIST);
    scene.add(rim);
    return {
      scene: scene,
      camera: camera,
      px: function (x, y) { return new THREE.Vector3(x - W / 2, H / 2 - y, 0); },
      /** world → frame pixels */
      project: function (v) {
        var p = v.clone().project(camera);
        return { x: (p.x + 1) * W / 2, y: (1 - p.y) * H / 2, front: p.z < 1 };
      },
    };
  }

  /** run update(now) for every rendered frame of the scene, then blit */
  function drive(el, s, update) {
    var canvas = $(el, ".three-canvas");
    if (!canvas) return;
    var ctx2d = canvas.getContext("2d");
    var o = { t: 0 };
    var D = Math.max(s.until - s.start, 0.1);
    tl.fromTo(o, { t: 0 }, {
      t: D, duration: D, ease: "none", immediateRender: false,
      onUpdate: function () {
        var r = renderer();
        if (!r) { el.classList.add("no-webgl"); return; }
        var st = update(s.start + o.t);
        if (!st) return;
        r.render(st.scene, st.camera);
        ctx2d.clearRect(0, 0, W, H);
        ctx2d.drawImage(r.domElement, 0, 0);
      },
    }, s.start);
  }

  // ── small helpers ───────────────────────────────────────────────────────
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function prog(now, at, dur) { return clamp((now - at) / dur, 0, 1); }
  var ease = {
    out: function (p) { return 1 - Math.pow(1 - p, 3); },
    expo: function (p) { return p >= 1 ? 1 : 1 - Math.pow(2, -10 * p); },
    inOut: function (p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; },
    back: function (p) { var c = 2.2; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
    in4: function (p) { return p * p * p * p; },
  };
  function roundedRect(w, h, r) {
    var s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function matte(color, extra) {
    var m = new THREE.MeshStandardMaterial({ color: color, roughness: 0.7, metalness: 0 });
    if (extra) for (var k in extra) m[k] = extra[k];
    return m;
  }
  /** slab lying flat (extruded up the Y axis) */
  function slab(w, d, h, r, mat) {
    var g = new THREE.ExtrudeGeometry(roundedRect(w, d, r), { depth: h, bevelEnabled: true, bevelThickness: h * 0.2, bevelSize: h * 0.2, bevelSegments: 3, curveSegments: 12 });
    g.rotateX(-Math.PI / 2);
    g.center();
    return new THREE.Mesh(g, mat);
  }
  /** texture drawn with a 2D canvas; redrawn once if web fonts finish loading later */
  function canvasTexture(w, h, draw) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    var drawnWithFonts = null;
    tex.refresh = function () {
      var ready = !document.fonts || document.fonts.status === "loaded";
      if (drawnWithFonts === ready || drawnWithFonts === true) return;
      var g = c.getContext("2d");
      g.clearRect(0, 0, w, h);
      draw(g, w, h);
      tex.needsUpdate = true;
      drawnWithFonts = ready;
    };
    return tex;
  }
  function glowTexture(rgba) {
    return canvasTexture(128, 128, function (g) {
      var grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, rgba);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    });
  }
  function discTexture(color) {
    return canvasTexture(64, 64, function (g) {
      g.fillStyle = color;
      g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
    });
  }
  /** a soft dark ellipse on the floor under an object */
  function contactShadow(w, d, opacity) {
    var tex = glowTexture("rgba(0,0,0," + (opacity || 0.7) + ")");
    tex.refresh();
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }
  /** place an HTML label at a projected point */
  function pin(label, pt, dx, dy, centre) {
    if (!label) return;
    label.style.transform = "translate(" + (pt.x + (dx || 0)).toFixed(1) + "px," + (pt.y + (dy || 0)).toFixed(1) + "px)" + (centre ? " translate(-50%,-50%)" : "");
  }

  // ── 3d.layers ───────────────────────────────────────────────────────────
  function layersModel(cfg, st) {
    var n = cfg.count, S = cfg.size, gap = S * 0.3, T = S * 0.036;
    var group = new THREE.Group();
    var plates = [];
    for (var i = 0; i < n; i++) {
      var color = i === cfg.core ? BRAND.blue : i === 0 ? BRAND.slate : BRAND.ink;
      var g = new THREE.Group();
      var base = slab(S, S, T * 0.6, S * 0.09, matte(0x06070a, { roughness: 0.9 }));
      base.position.y = -T * 0.55;
      var top = slab(S * 0.97, S * 0.97, T, S * 0.085, matte(color, { roughness: i === cfg.core ? 0.55 : 0.75 }));
      g.add(base, top);
      g.userData.y = ((n - 1) / 2 - i) * gap; // index 0 is the top layer
      g.position.y = g.userData.y;
      group.add(g);
      plates.push(g);
    }
    // data path: a column of dots through the stack and a glowing packet riding it
    var col = new THREE.Group();
    var colX = S * 0.28, colZ = -S * 0.18, span = gap * (n - 1);
    for (var k = 0; k < 9; k++) {
      var d = new THREE.Mesh(new THREE.SphereGeometry(S * 0.012, 12, 8), matte(BRAND.soft, { roughness: 0.4 }));
      d.position.set(colX, -span / 2 + (span * k) / 8, colZ);
      col.add(d);
    }
    group.add(col);
    var packet = new THREE.Mesh(new THREE.SphereGeometry(S * 0.04, 24, 16), new THREE.MeshStandardMaterial({ color: 0x9fd4ff, emissive: 0x3aa0ff, emissiveIntensity: 1.4, roughness: 0.3 }));
    var halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("rgba(0,145,255,0.75)"), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.material.map.refresh();
    halo.scale.set(S * 0.26, S * 0.26, 1);
    packet.add(halo);
    packet.position.set(colX, 0, colZ);
    group.add(packet);
    group.position.copy(st.px(cfg.at[0], cfg.at[1]));
    group.rotation.order = "XYZ";
    group.rotation.x = 0.56;
    group.rotation.y = -0.66;
    st.scene.add(group);
    return { group: group, plates: plates, packet: packet, col: col, span: span, S: S, T: T };
  }

  A.enter["3d.layers"] = function (el, s, t) {
    var cfg = s.meta.three;
    var d = A.textIn($(el, ".l3-title"), t);
    var cards = $$(el, ".l3-card");
    // plate i appears with card i: at its {n} cue, else bottom-up in sequence
    var appear = [];
    for (var i = 0; i < cfg.count; i++) appear[i] = null;
    s.beats.forEach(function (b) {
      if ((b.do === "reveal" || b.do === "show") && typeof b.target === "number" && b.target <= cfg.count && appear[b.target - 1] == null) appear[b.target - 1] = b.t;
    });
    for (var k = cfg.count - 1, j = 0; k >= 0; k--, j++) if (appear[k] == null) appear[k] = t + 0.3 + d * 0.3 + j * 0.3;
    cards.forEach(function (c, i) {
      tl.fromTo(c, { opacity: 0, x: A.PORTRAIT ? 0 : 40, y: A.PORTRAIT ? 30 : 0 }, { opacity: 1, x: 0, y: 0, duration: M.base, ease: M.enter }, appear[i] + 0.1);
    });
    A.fadeUp($(el, ".l3-rule"), Math.max.apply(null, appear) + 0.4, 12);
    var labels = $$(el, ".l3-plate-label");
    labels.forEach(function (l, i) { tl.fromTo(l, { opacity: 0 }, { opacity: 1, duration: 0.3 }, appear[i] + 0.35); });
    if (!THREE) return;
    var st = stage(), m = layersModel(cfg, st);
    var yaw0 = m.group.rotation.y, D = Math.max(s.until - t, 1);
    drive(el, s, function (now) {
      // camera drift: under 20° of yaw over the whole scene, plates part slightly
      var drift = ease.inOut(prog(now, t, D));
      m.group.rotation.y = yaw0 + 0.22 * drift;
      m.group.updateMatrixWorld(true);
      m.plates.forEach(function (p, i) {
        var a = ease.expo(prog(now, appear[i], 0.7));
        p.position.y = p.userData.y * (1 + 0.12 * drift) + (1 - a) * m.S * 0.7;
        p.visible = a > 0.001;
        p.scale.setScalar(0.9 + 0.1 * a);
        // the plate's front half (the part the plate above leaves visible)
        var pt = st.project(new THREE.Vector3(m.S * 0.14, p.position.y + m.T, m.S * 0.3).applyMatrix4(m.group.matrixWorld));
        pin(labels[i], pt, 0, 0, true);
      });
      var all = Math.max.apply(null, appear);
      var pk = prog(now, all + 0.4, 0.4);
      m.packet.visible = m.col.visible = pk > 0;
      var cyc = ((now - all) % 2.4 + 2.4) % 2.4 / 2.4;
      m.packet.position.y = m.span / 2 - m.span * ease.inOut(cyc < 0.5 ? cyc * 2 : 2 - cyc * 2);
      return st;
    });
  };
  A.beat["3d.layers"] = function (el, s, b, n) {
    if ((b.do === "reveal" || b.do === "show") && n != null) return true; // handled in enter
    if (b.do === "highlight" && n != null) {
      var c = el.querySelector('.l3-card[data-item="' + n + '"]');
      if (c) tl.fromTo(c, { scale: 1 }, { scale: 1.04, duration: 0.3, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, b.t);
      return true;
    }
    return false;
  };

  // ── 3d.hero-object (code cube) ──────────────────────────────────────────
  function cubeModel(cfg, st) {
    var S = cfg.size, b = S * 0.05;
    var geo = new THREE.ExtrudeGeometry(roundedRect(S - 2 * b, S - 2 * b, S * 0.08), { depth: S - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 5, curveSegments: 16 });
    geo.center();
    var cube = new THREE.Mesh(geo, matte(BRAND.blue, { roughness: 0.55 }));
    var tex = canvasTexture(512, 512, function (g, w, h) {
      g.fillStyle = "#ffffff";
      g.font = "800 " + Math.round(h * 0.36) + "px " + FONT;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(cfg.symbol || "{ }", w / 2, h / 2 + h * 0.02);
    });
    var face = new THREE.Mesh(new THREE.PlaneGeometry(S * 0.9, S * 0.9), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    face.position.z = S / 2 + 0.6;
    var dot = new THREE.Mesh(new THREE.SphereGeometry(S * 0.05, 20, 14), matte(BRAND.gold, { roughness: 0.55 }));
    dot.position.set(S / 2 - S * 0.14, S / 2 + S * 0.05, S / 2 - S * 0.14);
    var obj = new THREE.Group();
    obj.add(cube, face, dot);
    var shadow = contactShadow(S * 1.5, S * 0.55, 0.75);
    shadow.position.y = -S * 0.82;
    var group = new THREE.Group();
    group.add(obj, shadow);
    group.position.copy(st.px(cfg.at[0], cfg.at[1]));
    st.scene.add(group);
    return { group: group, obj: obj, shadow: shadow, tex: tex, S: S };
  }

  A.enter["3d.hero-object"] = function (el, s, t) {
    if (M.hook === "beat") A.hookBeat(el, s, t);
    else {
      var d = A.textIn($(el, ".title-text"), t + 0.1);
      A.fadeUp($(el, ".subtitle"), t + 0.3 + d * 0.6, 24);
    }
    var floor = $(el, ".hero-floor");
    if (floor) tl.fromTo(floor, { backgroundPositionY: "0px" }, { backgroundPositionY: Math.round((s.until - s.start) * 40) + "px", duration: Math.max(s.until - s.start, 0.1), ease: "none" }, s.start);
    if (!THREE) return;
    var st = stage(), m = cubeModel(s.meta.three, st);
    drive(el, s, function (now) {
      m.tex.refresh();
      var a = ease.back(prog(now, t + 0.1, 0.8));
      var local = now - t;
      m.obj.scale.setScalar(Math.max(0.001, 0.4 + 0.6 * a));
      m.obj.rotation.x = 0.42 + (1 - a) * 0.6;
      // slow turntable: ±12° around the rest pose, under 20° in total
      m.obj.rotation.y = -0.63 + (1 - a) * -1.4 + 0.2 * Math.sin(local * 0.6);
      m.obj.position.y = m.S * 0.04 * Math.sin(local * 1.3);
      m.shadow.material.opacity = clamp(a, 0, 1);
      m.shadow.scale.setScalar(1 - 0.06 * Math.sin(local * 1.3));
      return st;
    });
  };

  // ── 3d.phone ────────────────────────────────────────────────────────────
  function drawScreen(g, w, h, ui, img) {
    var k = w / 388;
    g.fillStyle = "#0e1116";
    g.fillRect(0, 0, w, h);
    if (img && img.complete && img.naturalWidth) {
      var r = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      var iw = img.naturalWidth * r, ih = img.naturalHeight * r;
      g.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
      return;
    }
    g.fillStyle = "#f2f4f7";
    g.font = "700 " + 22 * k + "px " + FONT;
    g.textBaseline = "alphabetic";
    g.fillText("9:41", 34 * k, 50 * k);
    g.textAlign = "right";
    g.fillText("5G", w - 34 * k, 50 * k);
    g.textAlign = "left";
    g.fillStyle = "#050505";
    roundRect(g, w / 2 - 55 * k, 26 * k, 110 * k, 32 * k, 16 * k); g.fill();
    g.fillStyle = "#ffffff";
    g.font = "800 " + 34 * k + "px " + FONT;
    g.fillText(ui.appBar || "", 28 * k, 122 * k);
    for (var i = 0; i < (ui.rows || 0); i++) {
      var y = 150 * k + i * 90 * k;
      g.fillStyle = "rgba(0,145,255,0.13)";
      g.beginPath(); g.arc(59 * k, y + 45 * k, 29 * k, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(255,255,255,0.1)";
      roundRect(g, 106 * k, y + 26 * k, w - 140 * k, 18 * k, 9 * k); g.fill();
      g.fillStyle = "rgba(255,255,255,0.06)";
      roundRect(g, 106 * k, y + 54 * k, (w - 140 * k) * 0.6, 18 * k, 9 * k); g.fill();
    }
    if (ui.button) {
      var bh = 74 * k, by = h - 30 * k - bh;
      g.fillStyle = "#0091ff";
      roundRect(g, 26 * k, by, w - 52 * k, bh, 22 * k); g.fill();
      g.fillStyle = "#ffffff";
      g.font = "800 " + 26 * k + "px " + FONT;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(ui.button, w / 2, by + bh / 2 + k);
    }
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function phoneModel(cfg, st, img) {
    var Hh = cfg.size, Ww = Hh * 420 / 860, T = Hh * 0.03, R = Ww * 0.15;
    var body = new THREE.ExtrudeGeometry(roundedRect(Ww, Hh, R), { depth: T, bevelEnabled: true, bevelThickness: T * 0.2, bevelSize: T * 0.2, bevelSegments: 4, curveSegments: 20 });
    body.center();
    var phone = new THREE.Group();
    phone.add(new THREE.Mesh(body, matte(0x1b1d22, { roughness: 0.5 })));
    var sw = Ww - Ww * 0.076, sh = Hh - Ww * 0.076;
    var shape = new THREE.ShapeGeometry(roundedRect(sw, sh, R * 0.8), 16);
    // UVs across the screen rectangle
    var pos = shape.attributes.position, uv = shape.attributes.uv;
    for (var i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / sw + 0.5, pos.getY(i) / sh + 0.5);
    var tex = canvasTexture(776, Math.round(776 * sh / sw), function (g, w, h) { drawScreen(g, w, h, cfg.ui, img); });
    var screen = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ map: tex }));
    screen.position.z = T / 2 + T * 0.2 + 0.8;
    phone.add(screen);
    var shadow = contactShadow(Ww * 1.3, Ww * 0.28, 0.8);
    shadow.position.y = -Hh / 2 - Hh * 0.06;
    var group = new THREE.Group();
    group.add(phone, shadow);
    group.position.copy(st.px(cfg.at[0], cfg.at[1]));
    st.scene.add(group);
    return { group: group, phone: phone, tex: tex, shadow: shadow };
  }

  A.enter["3d.phone"] = function (el, s, t) {
    var d = A.textIn($(el, ".p3-title"), t + 0.2);
    var cued = A.revealTargets(s);
    $$(el, ".p3-point").forEach(function (p, i) { if (!cued[i + 1]) A.slideX(p, t + 0.5 + d * 0.5 + i * 0.2, 40, M.base); });
    if (!THREE) return;
    var img = $(el, ".three-src");
    var st = stage(), m = phoneModel(s.meta.three, st, img);
    drive(el, s, function (now) {
      m.tex.refresh();
      // turns from a steep angle towards the design pose (≈28°), then drifts a few degrees
      var a = ease.expo(prog(now, t, 1.3));
      var local = Math.max(now - t - 1.3, 0);
      m.phone.rotation.set(0.14 + (1 - a) * 0.12, 0.49 + (1 - a) * 0.75 + 0.05 * Math.sin(local * 0.5), -0.07);
      m.group.position.y = st.px(0, s.meta.three.at[1]).y + (1 - a) * -140 + 8 * Math.sin(local * 1.1);
      m.shadow.material.opacity = a;
      return st;
    });
  };
  A.beat["3d.phone"] = function (el, s, b, n) {
    if ((b.do === "reveal" || b.do === "show") && n != null) {
      var p = el.querySelector('.p3-point[data-item="' + n + '"]');
      if (p) A.slideX(p, b.t, 40, M.base);
      return true;
    }
    return false;
  };

  // ── energy.punch-3d: layered extrusion of 1–3 words ─────────────────────
  function punchModel(cfg, st) {
    var fs = cfg.fontSize, lh = fs * cfg.lineHeight;
    var font = "800 " + fs + "px " + FONT;
    var probe = document.createElement("canvas").getContext("2d");
    probe.font = font;
    try { probe.letterSpacing = -0.05 * fs + "px"; } catch { /* older canvas */ }
    var tw = 0;
    cfg.lines.forEach(function (l) { tw = Math.max(tw, probe.measureText(l).width); });
    var pad = Math.round(fs * 0.4);
    var cw = Math.ceil(tw + pad * 2), ch = Math.ceil(lh * cfg.lines.length + pad * 2);
    function textTex(color, blur) {
      return canvasTexture(cw, ch, function (g) {
        g.font = font;
        try { g.letterSpacing = -0.05 * fs + "px"; } catch { /* older canvas */ }
        g.fillStyle = color;
        g.textBaseline = "middle";
        if (blur) g.filter = "blur(" + blur + "px)";
        cfg.lines.forEach(function (l, i) { g.fillText(l, pad, pad + lh * (i + 0.5)); });
      });
    }
    var extrude = cfg.tone === "red" ? "#b8283a" : "#0058ad";
    var front = textTex("#ffffff"), side = textTex(extrude), shade = textTex("rgba(0,0,0,0.35)", 35);
    var group = new THREE.Group();
    var geo = new THREE.PlaneGeometry(cw, ch);
    var sh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: shade, transparent: true, depthTest: false, depthWrite: false }));
    sh.position.set(34, -50, -60);
    sh.renderOrder = 0;
    group.add(sh);
    var layers = 22;
    for (var i = layers; i >= 1; i--) {
      var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: side, transparent: true, depthTest: false, depthWrite: false }));
      m.position.z = -i * 2;
      m.renderOrder = layers - i + 1;
      group.add(m);
    }
    var face = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: front, transparent: true, depthTest: false, depthWrite: false }));
    face.renderOrder = layers + 2;
    group.add(face);
    // the text block's top-left sits at cfg.at (as in the CSS mock); rotate about its centre
    var cx = cfg.at[0] - pad + cw / 2, cy = cfg.at[1] - pad + ch / 2;
    var home = st.px(cx, cy);
    group.position.copy(home);
    st.scene.add(group);
    return { group: group, home: home, textures: [front, side, shade] };
  }

  A.enter["energy.punch-3d"] = function (el, s, t) {
    var bg = $(el, ".punch-bg");
    if (bg) tl.fromTo(bg, { scale: 1.08 }, { scale: 1, duration: 0.4, ease: "power3.out" }, s.start);
    A.punchIn(el, s, t, null);
    if (!THREE) return;
    var st = stage(), m = punchModel(s.meta.three, st);
    var seed = 13;
    drive(el, s, function (now) {
      m.textures.forEach(function (x) { x.refresh(); });
      // flies in from near the camera, lands at 0.4 s, shakes, then drifts
      var a = ease.in4(prog(now, t + 0.1, 0.3));
      var shake = 0, sy = 0;
      var k = (now - t - 0.4) / 0.035;
      if (k >= 0 && k < 6) {
        var f = 1 - k / 6, i = Math.floor(k);
        shake = ((A.hash(seed * 31 + i * 7) % 200) / 100 - 1) * 22 * f;
        sy = ((A.hash(seed * 17 + i * 13) % 200) / 100 - 1) * 14 * f;
      }
      var drift = Math.max(now - t - 0.6, 0);
      m.group.visible = now >= t + 0.1;
      m.group.position.set(m.home.x + shake, m.home.y + sy, (1 - a) * DIST * 0.8);
      m.group.rotation.set(-0.21 + (1 - a) * 0.3 + 0.02 * Math.sin(drift * 0.8), 0.28 - (1 - a) * 0.4 + 0.03 * Math.sin(drift * 0.6), -0.052);
      return st;
    });
  };

  // ── news.globe: dot globe turning to the story ─────────────────────────
  function toVec(lat, lon, r) {
    var la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
    return new THREE.Vector3(r * Math.cos(la) * Math.sin(lo), r * Math.sin(la), r * Math.cos(la) * Math.cos(lo));
  }

  function globeModel(cfg, st) {
    var R = cfg.size / 2;
    var group = new THREE.Group();
    group.rotation.order = "XYZ";
    var body = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), matte(0x0f1116, { roughness: 0.9 }));
    group.add(body);
    // regular lat/lon dot grid, faded towards the rim by a tiny shader
    var pts = [];
    for (var lat = -84; lat <= 84; lat += 6) {
      var n = Math.max(1, Math.round((360 * Math.cos(lat * Math.PI / 180)) / 6));
      for (var i = 0; i < n; i++) {
        var v = toVec(lat, (360 * i) / n, R * 1.004);
        pts.push(v.x, v.y, v.z);
      }
    }
    var dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    var dots = new THREE.Points(dg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { size: { value: cfg.size / 84 }, color: { value: new THREE.Color(0xc9ced6) } },
      vertexShader:
        "uniform float size; varying float vFace;" +
        "void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0);" +
        " vFace = dot(normalize(normalMatrix * normalize(position)), normalize(-mv.xyz));" +
        " gl_PointSize = size; gl_Position = projectionMatrix * mv; }",
      fragmentShader:
        "uniform vec3 color; varying float vFace;" +
        "void main(){ if (vFace < 0.0) discard; vec2 c = gl_PointCoord - 0.5; if (dot(c,c) > 0.25) discard;" +
        " gl_FragColor = vec4(color, 0.08 + 0.66 * vFace); }",
    }));
    group.add(dots);
    var halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("rgba(0,145,255,0.3)"), transparent: true, depthWrite: false }));
    halo.material.map.refresh();
    halo.scale.set(cfg.size * 1.5, cfg.size * 1.5, 1);
    halo.position.z = -R * 1.2;
    var markers = cfg.markers.map(function (mk) {
      var color = mk.primary ? "#ff5d6c" : "#54b3ff";
      var core = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture(color), transparent: true, depthTest: false }));
      var ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture(color), transparent: true, opacity: 0.22, depthTest: false }));
      core.material.map.refresh(); ring.material.map.refresh();
      var s0 = mk.primary ? 28 : 18, s1 = mk.primary ? 112 : 72;
      core.scale.set(s0, s0, 1); ring.scale.set(s1, s1, 1);
      var holder = new THREE.Group();
      holder.add(ring, core);
      holder.position.copy(toVec(mk.lat, mk.lon, R * 1.01));
      group.add(holder);
      return { holder: holder, core: core, ring: ring, s0: s0, s1: s1, primary: mk.primary };
    });
    var root = new THREE.Group();
    root.add(halo, group);
    root.position.copy(st.px(cfg.at[0], cfg.at[1]));
    st.scene.add(root);
    return { root: root, group: group, markers: markers };
  }

  A.enter["news.globe"] = function (el, s, t) {
    var top = $(el, ".news-top");
    if (top) A.slideX(top, t, -40, M.base);
    var inlineTag = $(el, ".content .news-tag");
    if (inlineTag) A.slideX(inlineTag, t + 0.1, -40, M.base);
    var d = A.textIn($(el, ".news-headline"), t + 0.15);
    A.fadeUp($(el, ".news-sub"), t + 0.3 + d * 0.6, 24);
    A.fadeUp($(el, ".globe-source"), t + 0.45 + d * 0.6, 12);
    if (A.ticker) A.ticker(el, s, t);
    var labels = $$(el, ".globe-label");
    if (!THREE) return;
    var cfg = s.meta.three, st = stage(), m = globeModel(cfg, st);
    var focus = cfg.markers.filter(function (x) { return x.primary; })[0] || cfg.markers[0];
    var lat = focus.lat * Math.PI / 180, lon = focus.lon * Math.PI / 180;
    var land = t + 1.6;
    labels.forEach(function (l) { tl.fromTo(l, { opacity: 0 }, { opacity: 1, duration: 0.3 }, land + 0.2); });
    drive(el, s, function (now) {
      var a = ease.inOut(prog(now, t, 1.6));
      var drift = Math.max(now - land, 0) * 0.025;
      m.group.rotation.x = lat * a;
      m.group.rotation.y = -lon + (1 - a) * 1.1 - drift;
      m.root.scale.setScalar(0.92 + 0.08 * ease.out(prog(now, t, 0.8)));
      m.group.updateMatrixWorld(true);
      m.markers.forEach(function (mk, i) {
        var p = ease.back(prog(now, land - 0.2 + i * 0.06, 0.5));
        var world = mk.holder.getWorldPosition(new THREE.Vector3());
        var facing = world.clone().sub(m.root.position).normalize().z;
        var vis = facing > 0.15 && p > 0;
        mk.holder.visible = vis;
        mk.core.scale.set(mk.s0 * p, mk.s0 * p, 1);
        var pulse = 1 + 0.12 * Math.sin((now - land) * 3.2 + i);
        mk.ring.scale.set(mk.s1 * p * pulse, mk.s1 * p * pulse, 1);
      });
      labels.forEach(function (l) {
        var mk = m.markers[+l.getAttribute("data-marker")];
        if (!mk) return;
        var pt = st.project(mk.holder.getWorldPosition(new THREE.Vector3()));
        pin(l, pt, mk.primary ? 44 : 30, mk.primary ? -26 : -20);
        l.style.visibility = mk.holder.visible ? "visible" : "hidden";
      });
      return st;
    });
  };
});
