(function () {
  "use strict";

  var W = 360, H = 560;
  var ROAD_X = 40, ROAD_W = 280, LANES = 4, LANE_W = ROAD_W / LANES;
  var PLAYER_W = 34, PLAYER_H = 60, PLAYER_Y = H - 100;
  var BASE_SPEED = 260, MAX_SPEED = 700;
  var COLORS = {
    sand: "#d9b56d", sandDark: "#c79f55", asphalt: "#3b414a", asphaltLight: "#454c56",
    line: "#f6f1e4", accent: "#e4572e", kerbA: "#e4572e", kerbB: "#f6f1e4",
    leaf: "#4f8a4b", leafDark: "#3d6e3b", trunk: "#6b4a2b", rock: "#a89a85", gold: "#f2b82e"
  };
  var ENEMY_COLORS = ["#2a9d8f", "#f4c542", "#3d6fb6", "#eeeeee", "#8a5fb0", "#6aa84f"];

  var cv = document.getElementById("game");
  var ctx = cv.getContext("2d");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var elScore = document.getElementById("sScore");
  var elSpeed = document.getElementById("sSpeed");
  var elBest = document.getElementById("sBest");
  var elLives = document.getElementById("sLives");
  var btnL = document.getElementById("btnL");
  var btnR = document.getElementById("btnR");
  var btnPause = document.getElementById("btnPause");
  var btnSound = document.getElementById("btnSound");

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var scale = 1;

  var state = "ready"; // ready | running | paused | over
  var speed = 180, scroll = 0, dist = 0, level = 1, coins = 0;
  var lives = 3, invuln = 0, shake = 0, elapsed = 0;
  var px = W / 2, pvx = 0;
  var obstacles = [], coinList = [], scenery = [], particles = [];
  var spawnT = 600, sceneryT = 0;
  var left = false, right = false, padLeft = false, padRight = false, pointerDir = 0;
  var best = 0, newBest = false;
  var soundOn = true, audio = null;
  var lastT = 0;

  try { best = parseInt(localStorage.getItem("rodovia-zero-best") || "0", 10) || 0; } catch (e) { best = 0; }

  /* ---------- tamanho do canvas ---------- */
  function fit() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    scale = cv.width / W;
  }
  window.addEventListener("resize", fit);

  /* ---------- som ---------- */
  function ensureAudio() {
    if (audio || !soundOn) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audio = new AC();
    } catch (e) { audio = null; }
  }
  function beep(freq, dur, type, vol, slide) {
    if (!soundOn || !audio) return;
    try {
      var o = audio.createOscillator(), g = audio.createGain();
      o.type = type || "square";
      o.frequency.value = freq;
      if (slide) o.frequency.linearRampToValueAtTime(slide, audio.currentTime + dur);
      g.gain.value = vol || 0.05;
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
      o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + dur);
    } catch (e) { /* sem som */ }
  }

  /* ---------- placar ---------- */
  function score() { return Math.floor(dist) + coins * 50; }
  function renderLives() {
    var html = "";
    for (var i = 0; i < 3; i++) html += '<span class="pip' + (i < lives ? "" : " off") + '"></span>';
    elLives.innerHTML = html;
    elLives.setAttribute("aria-label", lives + " vidas");
  }
  function renderHud() {
    elScore.textContent = String(score());
    elSpeed.textContent = String(Math.round(speed * 0.32));
    elBest.textContent = String(Math.max(best, score()));
  }

  /* ---------- estados ---------- */
  function showOverlay(title, text, btn) {
    ovTitle.textContent = title;
    ovText.innerHTML = text;
    ovBtn.textContent = btn;
    overlay.hidden = false;
    ovBtn.focus({ preventScroll: true });
  }
  function resetRun() {
    speed = 180; dist = 0; level = 1; coins = 0; lives = 3; invuln = 0; shake = 0;
    px = W / 2; pvx = 0; obstacles = []; coinList = []; particles = []; spawnT = 700; newBest = false;
    renderLives(); renderHud();
  }
  function startRun() {
    ensureAudio();
    if (audio && audio.state === "suspended") { try { audio.resume(); } catch (e) {} }
    resetRun();
    state = "running";
    overlay.hidden = true;
    btnPause.textContent = "Pausar";
    beep(520, 0.12, "square", 0.04);
    beep(780, 0.18, "square", 0.04);
  }
  function pauseToggle() {
    if (state === "running") {
      state = "paused";
      btnPause.textContent = "Continuar";
      showOverlay("Pausa", "Respire. A estrada espera por você.", "Continuar");
    } else if (state === "paused") {
      state = "running";
      btnPause.textContent = "Pausar";
      overlay.hidden = true;
    }
  }
  function gameOver() {
    state = "over";
    var s = score();
    if (s > best) {
      best = s; newBest = true;
      try { localStorage.setItem("rodovia-zero-best", String(best)); } catch (e) {}
    }
    btnPause.textContent = "Pausar";
    beep(220, 0.5, "sawtooth", 0.06, 70);
    var txt = "Você fez <strong>" + s + "</strong> pontos em " + Math.floor(dist) + " m, com " + coins + " moedas.";
    if (newBest) txt += " Novo recorde!";
    showOverlay("Fim de corrida", txt, "Correr de novo");
    renderHud();
  }
  ovBtn.addEventListener("click", function () {
    if (state === "paused") pauseToggle(); else startRun();
  });
  btnPause.addEventListener("click", function () { if (state === "running" || state === "paused") pauseToggle(); });
  btnSound.addEventListener("click", function () {
    soundOn = !soundOn;
    btnSound.textContent = soundOn ? "Som: ligado" : "Som: desligado";
    if (soundOn) { ensureAudio(); beep(600, 0.08, "square", 0.04); }
  });
  document.addEventListener("visibilitychange", function () { if (document.hidden && state === "running") pauseToggle(); });

  /* ---------- controles ---------- */
  function setKey(e, down) {
    var k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") { left = down; e.preventDefault(); }
    else if (k === "ArrowRight" || k === "d" || k === "D") { right = down; e.preventDefault(); }
    else if (down && (k === " " || k === "p" || k === "P")) {
      e.preventDefault();
      if (e.repeat) return;
      if (state === "running" || state === "paused") pauseToggle();
      else if (document.activeElement !== ovBtn) startRun();
    }
  }
  window.addEventListener("keydown", function (e) { setKey(e, true); });
  window.addEventListener("keyup", function (e) { setKey(e, false); });

  function holdButton(btn, setter) {
    function on(e) { e.preventDefault(); setter(true); btn.classList.add("on"); try { btn.setPointerCapture(e.pointerId); } catch (x) {} }
    function off() { setter(false); btn.classList.remove("on"); }
    btn.addEventListener("pointerdown", on);
    btn.addEventListener("pointerup", off);
    btn.addEventListener("pointercancel", off);
    btn.addEventListener("lostpointercapture", off);
  }
  holdButton(btnL, function (v) { padLeft = v; });
  holdButton(btnR, function (v) { padRight = v; });

  function pointerFromEvent(e) {
    var r = cv.getBoundingClientRect();
    return (e.clientX - r.left) < r.width / 2 ? -1 : 1;
  }
  cv.addEventListener("pointerdown", function (e) { pointerDir = pointerFromEvent(e); try { cv.setPointerCapture(e.pointerId); } catch (x) {} });
  cv.addEventListener("pointermove", function (e) { if (pointerDir !== 0) pointerDir = pointerFromEvent(e); });
  function pointerOff() { pointerDir = 0; }
  cv.addEventListener("pointerup", pointerOff);
  cv.addEventListener("pointercancel", pointerOff);

  /* ---------- lógica ---------- */
  function laneX(l) { return ROAD_X + LANE_W * l + LANE_W / 2; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function spawnScenery(y) {
    var side = Math.random() < 0.5 ? 0 : 1;
    var x = side === 0 ? 4 + Math.random() * 26 : ROAD_X + ROAD_W + 10 + Math.random() * 26;
    var t = Math.random();
    scenery.push({ x: x, y: y, type: t < 0.5 ? "tree" : (t < 0.8 ? "rock" : "bush"), s: 0.8 + Math.random() * 0.6 });
  }
  for (var si = 0; si < 9; si++) spawnScenery(Math.random() * H);

  function spawnTraffic() {
    for (var i = 0; i < obstacles.length; i++) if (obstacles[i].y < 120) { spawnT = 140; return; }
    var lane = Math.floor(Math.random() * LANES);
    obstacles.push({
      x: laneX(lane) + (Math.random() * 16 - 8), y: -70, w: 34, h: 58,
      f: 0.32 + Math.random() * 0.3,
      color: ENEMY_COLORS[Math.floor(Math.random() * ENEMY_COLORS.length)]
    });
    if (Math.random() < 0.5) {
      var cl = (lane + 1 + Math.floor(Math.random() * (LANES - 1))) % LANES;
      coinList.push({ x: laneX(cl), y: -40 - Math.random() * 60 });
    }
    spawnT = clamp(950 - level * 55, 420, 950) * (0.8 + Math.random() * 0.5);
  }

  function burst(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 160;
      particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, t: 0, color: color });
    }
  }

  function update(dt) {
    elapsed += dt;
    var running = state === "running";
    var target = running ? Math.min(MAX_SPEED, BASE_SPEED + (level - 1) * 45) : (state === "ready" ? 180 : 0);
    if (state === "paused") target = speed;
    speed += (target - speed) * Math.min(1, dt * 1.5);
    if (state === "over" && speed < 4) speed = 0;
    scroll += speed * dt;

    for (var i = scenery.length - 1; i >= 0; i--) {
      scenery[i].y += speed * dt;
      if (scenery[i].y > H + 40) scenery.splice(i, 1);
    }
    sceneryT -= speed * dt;
    if (sceneryT <= 0) { spawnScenery(-30); sceneryT = 70 + Math.random() * 110; }

    for (var p = particles.length - 1; p >= 0; p--) {
      var pt = particles[p];
      pt.t += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      if (pt.t > pt.life) particles.splice(p, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - dt);
    if (invuln > 0) invuln = Math.max(0, invuln - dt);

    if (state === "over") {
      for (var o2 = 0; o2 < obstacles.length; o2++) obstacles[o2].y += speed * (1 - obstacles[o2].f) * dt;
      return;
    }
    if (!running) return;

    dist += speed * dt / 10;
    level = 1 + Math.floor(dist / 500);

    var dir = (right || padRight || pointerDir > 0 ? 1 : 0) - (left || padLeft || pointerDir < 0 ? 1 : 0);
    pvx += (dir * 320 - pvx) * Math.min(1, dt * 9);
    px = clamp(px + pvx * dt, ROAD_X + PLAYER_W / 2 + 2, ROAD_X + ROAD_W - PLAYER_W / 2 - 2);

    spawnT -= dt * 1000 * (speed / 400);
    if (spawnT <= 0) spawnTraffic();

    for (var k = obstacles.length - 1; k >= 0; k--) {
      var e = obstacles[k];
      e.y += speed * (1 - e.f) * dt;
      if (e.y > H + 90) { obstacles.splice(k, 1); continue; }
      if (invuln <= 0 &&
          Math.abs(e.x - px) < (e.w + PLAYER_W) / 2 - 5 &&
          Math.abs(e.y - PLAYER_Y) < (e.h + PLAYER_H) / 2 - 6) {
        obstacles.splice(k, 1);
        lives -= 1;
        invuln = 1.6; shake = reduceMotion ? 0 : 0.4;
        burst(px, PLAYER_Y, "#f2b82e", 18);
        burst(px, PLAYER_Y, "#e4572e", 12);
        beep(160, 0.3, "sawtooth", 0.06, 60);
        renderLives();
        if (lives <= 0) { gameOver(); return; }
      }
    }
    for (var c = coinList.length - 1; c >= 0; c--) {
      var co = coinList[c];
      co.y += speed * dt;
      if (co.y > H + 30) { coinList.splice(c, 1); continue; }
      var dx = co.x - px, dy = co.y - PLAYER_Y;
      if (dx * dx + dy * dy < 30 * 30) {
        coinList.splice(c, 1);
        coins += 1;
        burst(co.x, co.y, COLORS.gold, 8);
        beep(900, 0.07, "square", 0.04);
        beep(1250, 0.1, "square", 0.04);
      }
    }
  }

  /* ---------- desenho ---------- */
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCar(cx, cy, w, h, color) {
    var x = cx - w / 2, y = cy - h / 2;
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    rr(x + 3, y + 5, w, h, 8); ctx.fill();
    ctx.fillStyle = "#14110e";
    rr(x - 3, y + 8, 6, 14, 2); ctx.fill();
    rr(x + w - 3, y + 8, 6, 14, 2); ctx.fill();
    rr(x - 3, y + h - 22, 6, 14, 2); ctx.fill();
    rr(x + w - 3, y + h - 22, 6, 14, 2); ctx.fill();
    ctx.fillStyle = color;
    rr(x, y, w, h, 8); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    rr(x + w / 2 - 4, y + 3, 8, h * 0.26, 3); ctx.fill();
    ctx.fillStyle = "#1c2a33";
    rr(x + 5, y + h * 0.32, w - 10, h * 0.2, 3); ctx.fill();
    rr(x + 6, y + h * 0.62, w - 12, h * 0.14, 3); ctx.fill();
    ctx.fillStyle = "#fff6c8";
    rr(x + 3, y + 2, 8, 4, 2); ctx.fill();
    rr(x + w - 11, y + 2, 8, 4, 2); ctx.fill();
    ctx.fillStyle = "#ff3b30";
    rr(x + 3, y + h - 6, 8, 4, 2); ctx.fill();
    rr(x + w - 11, y + h - 6, 8, 4, 2); ctx.fill();
  }

  function drawScenery(s) {
    var z = s.s;
    if (s.type === "tree") {
      ctx.fillStyle = COLORS.trunk; ctx.fillRect(s.x - 2 * z, s.y + 4 * z, 4 * z, 10 * z);
      ctx.fillStyle = COLORS.leafDark; ctx.beginPath(); ctx.arc(s.x + 1, s.y + 2, 11 * z, 0, 7); ctx.fill();
      ctx.fillStyle = COLORS.leaf; ctx.beginPath(); ctx.arc(s.x - 1, s.y - 1, 9 * z, 0, 7); ctx.fill();
    } else if (s.type === "rock") {
      ctx.fillStyle = COLORS.rock; ctx.beginPath(); ctx.ellipse(s.x, s.y, 10 * z, 7 * z, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.beginPath(); ctx.ellipse(s.x + 2, s.y + 3, 7 * z, 3 * z, 0, 0, 7); ctx.fill();
    } else {
      ctx.fillStyle = COLORS.leaf; ctx.beginPath(); ctx.arc(s.x, s.y, 7 * z, 0, 7); ctx.fill();
      ctx.fillStyle = COLORS.leafDark; ctx.beginPath(); ctx.arc(s.x + 5 * z, s.y + 2, 5 * z, 0, 7); ctx.fill();
    }
  }

  function drawRoad() {
    ctx.fillStyle = COLORS.sand; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = COLORS.sandDark;
    for (var i = -1; i < 12; i++) {
      var yy = ((i * 52 + scroll * 0.9) % (H + 52)) - 52;
      ctx.fillRect(10, yy, 14, 2); ctx.fillRect(W - 28, yy + 20, 12, 2);
    }
    ctx.fillStyle = COLORS.asphalt; ctx.fillRect(ROAD_X, 0, ROAD_W, H);
    ctx.fillStyle = COLORS.asphaltLight;
    for (var j = 0; j < LANES; j += 2) ctx.fillRect(ROAD_X + j * LANE_W, 0, LANE_W, H);
    var kerb = 24, off = scroll % (kerb * 2);
    for (var k = -2; k < H / kerb + 2; k++) {
      var y = k * kerb + off;
      ctx.fillStyle = (k % 2 === 0) ? COLORS.kerbA : COLORS.kerbB;
      ctx.fillRect(ROAD_X - 6, y, 6, kerb);
      ctx.fillRect(ROAD_X + ROAD_W, y, 6, kerb);
    }
    ctx.fillStyle = COLORS.line;
    var dash = 30, gap = 30, o2 = scroll % (dash + gap);
    for (var l = 1; l < LANES; l++) {
      for (var d = -1; d < H / (dash + gap) + 1; d++) {
        ctx.fillRect(ROAD_X + l * LANE_W - 1.5, d * (dash + gap) + o2 - dash, 3, dash);
      }
    }
  }

  function draw() {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    var sx = 0, sy = 0;
    if (shake > 0) { sx = (Math.random() - 0.5) * 8 * (shake / 0.4); sy = (Math.random() - 0.5) * 8 * (shake / 0.4); }
    ctx.save();
    ctx.translate(sx, sy);
    drawRoad();
    for (var i = 0; i < scenery.length; i++) drawScenery(scenery[i]);

    for (var c = 0; c < coinList.length; c++) {
      var co = coinList[c];
      var sw = Math.abs(Math.cos(elapsed * 4 + c));
      ctx.fillStyle = COLORS.gold;
      ctx.beginPath(); ctx.ellipse(co.x, co.y, 10 * (0.35 + 0.65 * sw), 10, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = "#b3821a"; ctx.lineWidth = 2; ctx.stroke();
    }
    for (var k = 0; k < obstacles.length; k++) {
      var e = obstacles[k];
      drawCar(e.x, e.y, e.w, e.h, e.color);
    }

    var visible = !(invuln > 0 && Math.floor(invuln * 12) % 2 === 0);
    if (visible && !(state === "over")) {
      ctx.save();
      ctx.translate(px, PLAYER_Y);
      ctx.rotate(clamp(pvx / 1100, -0.3, 0.3));
      drawCar(0, 0, PLAYER_W, PLAYER_H, COLORS.accent);
      ctx.restore();
    }
    for (var p = 0; p < particles.length; p++) {
      var pt = particles[p];
      ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (state === "running" && level > 1 && dist % 500 < 14) {
      ctx.fillStyle = "rgba(34,29,23,0.75)";
      rr(W / 2 - 60, 24, 120, 30, 6); ctx.fill();
      ctx.fillStyle = "#f6f1e4";
      ctx.font = "700 16px 'Chakra Petch', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("NÍVEL " + level, W / 2, 45);
    }
  }

  function frame(t) {
    var dt = Math.min(0.033, (t - lastT) / 1000 || 0.016);
    lastT = t;
    if (state !== "paused") update(dt);
    draw();
    renderHud();
    requestAnimationFrame(frame);
  }

  fit();
  renderLives();
  renderHud();
  requestAnimationFrame(function (t) { lastT = t; requestAnimationFrame(frame); });
})();
