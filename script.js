(function () {
  "use strict";

  var W = 360, H = 560, LINE_Y = H - 46, MAX_ARMOR = 5;
  var C = {
    ground: "#6f7447", groundDark: "#62673e", mud: "#5a4a36", mudDark: "#473a2b",
    bag: "#c9b68a", bagDark: "#a8946a", trench: "#3d3326",
    playerBody: "#4f7f4a", playerTurret: "#3f6a3c",
    enemyBody: "#8d3f32", enemyTurret: "#6e2f26", tread: "#2b2a24",
    fire: "#f2a23a", fireHot: "#ffe28a", smoke: "#4a4a44"
  };
  var FONT = "'Saira Stencil One', Impact, 'Arial Black', sans-serif";

  var cv = document.getElementById("game");
  var ctx = cv.getContext("2d");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var elScore = document.getElementById("sScore");
  var elWave = document.getElementById("sWave");
  var elBest = document.getElementById("sBest");
  var elArmor = document.getElementById("sArmor");
  var btnL = document.getElementById("btnL");
  var btnR = document.getElementById("btnR");
  var btnPause = document.getElementById("btnPause");
  var btnSound = document.getElementById("btnSound");

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var scale = 1;

  var state = "ready"; // ready | running | paused | over
  var player = { x: W / 2, y: H - 74, w: 36, h: 46, vx: 0, cool: 0 };
  var bullets = [], enemies = [], shells = [], powerups = [], rings = [], particles = [];
  var score = 0, wave = 1, armor = MAX_ARMOR, invuln = 0, shake = 0, elapsed = 0;
  var toSpawn = 0, spawnT = 0, waveBreak = 0, banner = null;
  var dblT = 0, rapidT = 0, kills = 0;
  var left = false, right = false, padLeft = false, padRight = false, pointerX = null;
  var best = 0, newBest = false;
  var soundOn = true, audio = null, lastT = 0;

  try { best = parseInt(localStorage.getItem("linha-de-frente-best") || "0", 10) || 0; } catch (e) { best = 0; }

  /* terreno fixo: crateras sorteadas uma vez */
  var craters = [];
  for (var ci = 0; ci < 16; ci++) {
    craters.push({ x: 20 + Math.random() * (W - 40), y: 30 + Math.random() * (LINE_Y - 60), r: 7 + Math.random() * 12 });
  }

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
      g.gain.value = vol || 0.04;
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
      o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + dur);
    } catch (e) { /* sem som */ }
  }

  /* ---------- placar ---------- */
  function renderArmor() {
    var html = "";
    for (var i = 0; i < MAX_ARMOR; i++) html += '<span class="pip' + (i < armor ? "" : " off") + '"></span>';
    elArmor.innerHTML = html;
    elArmor.setAttribute("aria-label", "Casco " + Math.max(0, armor) + " de " + MAX_ARMOR);
  }
  function renderHud() {
    elScore.textContent = String(score);
    elWave.textContent = String(wave);
    elBest.textContent = String(Math.max(best, score));
  }

  /* ---------- estados ---------- */
  function showOverlay(title, text, btn) {
    ovTitle.textContent = title;
    ovText.innerHTML = text;
    ovBtn.textContent = btn;
    overlay.hidden = false;
    ovBtn.focus({ preventScroll: true });
  }
  function startWave() {
    toSpawn = 7 + wave * 4;
    spawnT = 0.7;
    banner = { text: "ONDA " + wave, t: 2.2 };
  }
  function resetRun() {
    bullets = []; enemies = []; shells = []; powerups = []; rings = []; particles = [];
    score = 0; wave = 1; armor = MAX_ARMOR; invuln = 0; shake = 0;
    dblT = 0; rapidT = 0; kills = 0; waveBreak = 0; newBest = false;
    player.x = W / 2; player.vx = 0; player.cool = 0.3;
    startWave();
    renderArmor(); renderHud();
  }
  function startRun() {
    ensureAudio();
    if (audio && audio.state === "suspended") { try { audio.resume(); } catch (e) {} }
    resetRun();
    state = "running";
    overlay.hidden = true;
    btnPause.textContent = "Pausar";
    beep(330, 0.12, "square", 0.04);
    beep(495, 0.18, "square", 0.04);
  }
  function pauseToggle() {
    if (state === "running") {
      state = "paused";
      btnPause.textContent = "Continuar";
      showOverlay("Pausa", "O inimigo também espera. Quando estiver pronto, volte ao combate.", "Continuar");
    } else if (state === "paused") {
      state = "running";
      btnPause.textContent = "Pausar";
      overlay.hidden = true;
    }
  }
  function gameOver() {
    state = "over";
    if (score > best) {
      best = score; newBest = true;
      try { localStorage.setItem("linha-de-frente-best", String(best)); } catch (e) {}
    }
    btnPause.textContent = "Pausar";
    beep(200, 0.6, "sawtooth", 0.06, 50);
    var txt = "A posição caiu na onda <strong>" + wave + "</strong>. Você fez <strong>" + score + "</strong> pontos e destruiu <strong>" + kills + "</strong> alvos.";
    if (newBest) txt += " Novo recorde!";
    showOverlay("Posição perdida", txt, "Tentar de novo");
    renderHud();
  }
  ovBtn.addEventListener("click", function () {
    if (state === "paused") pauseToggle(); else startRun();
  });
  btnPause.addEventListener("click", function () { if (state === "running" || state === "paused") pauseToggle(); });
  btnSound.addEventListener("click", function () {
    soundOn = !soundOn;
    btnSound.textContent = soundOn ? "Som: ligado" : "Som: desligado";
    if (soundOn) { ensureAudio(); beep(500, 0.08, "square", 0.04); }
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

  function pointerLogicalX(e) {
    var r = cv.getBoundingClientRect();
    return (e.clientX - r.left) / r.width * W;
  }
  cv.addEventListener("pointerdown", function (e) { pointerX = pointerLogicalX(e); try { cv.setPointerCapture(e.pointerId); } catch (x) {} });
  cv.addEventListener("pointermove", function (e) { if (pointerX !== null) pointerX = pointerLogicalX(e); });
  function pointerOff() { pointerX = null; }
  cv.addEventListener("pointerup", pointerOff);
  cv.addEventListener("pointercancel", pointerOff);

  /* ---------- efeitos ---------- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function burst(x, y, color, n, speedMax) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, v = 30 + Math.random() * (speedMax || 150);
      particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + Math.random() * 0.5, t: 0, color: color, s: 2 + Math.random() * 2 });
    }
  }
  function explode(x, y, size) {
    rings.push({ x: x, y: y, max: size, t: 0, dur: 0.38 });
    burst(x, y, C.fire, Math.round(size / 2), 170);
    burst(x, y, C.fireHot, Math.round(size / 4), 120);
    burst(x, y, C.smoke, Math.round(size / 3), 60);
  }

  /* ---------- dano ---------- */
  function damagePlayer(n, force) {
    if (!force && invuln > 0) return;
    armor -= n;
    invuln = 1.2;
    shake = reduceMotion ? 0 : 0.35;
    explode(player.x, player.y - 6, 34);
    beep(150, 0.3, "sawtooth", 0.06, 60);
    renderArmor();
    if (armor <= 0) gameOver();
  }

  /* ---------- inimigos ---------- */
  function spawnEnemy() {
    var heliP = wave >= 2 ? Math.min(0.2, 0.08 + wave * 0.02) : 0;
    var tankP = Math.min(0.32, 0.08 + wave * 0.04);
    var r = Math.random();
    if (r < heliP) {
      var side = Math.random() < 0.5 ? -1 : 1;
      enemies.push({
        type: "heli", x: side < 0 ? -30 : W + 30, y: 60 + Math.random() * 80,
        vx: (side < 0 ? 1 : -1) * (70 + Math.random() * 40 + wave * 3),
        w: 40, h: 22, hp: 3, maxHp: 3, flash: 0, fireT: 0.8 + Math.random() * 0.8
      });
    } else if (r < heliP + tankP) {
      var hp = 3 + Math.floor(wave / 3);
      enemies.push({
        type: "tank", x: 40 + Math.random() * (W - 80), y: -30,
        vy: 26 + Math.min(wave * 2, 20), holdY: 120 + Math.random() * 90,
        w: 34, h: 44, hp: hp, maxHp: hp, flash: 0, fireT: 1 + Math.random(), off: 0
      });
    } else {
      enemies.push({
        type: "soldier", x: 20 + Math.random() * (W - 40), y: -14,
        vy: 45 + Math.min(wave * 5, 50) + Math.random() * 20, ph: Math.random() * 6,
        w: 16, h: 18, hp: 1, maxHp: 1, flash: 0
      });
    }
    spawnT = clamp(1.1 - wave * 0.06, 0.45, 1.1) * (0.7 + Math.random() * 0.6);
  }

  function killEnemy(e, idx) {
    enemies.splice(idx, 1);
    kills += 1;
    var pts = e.type === "heli" ? 60 : (e.type === "tank" ? 40 : 10);
    score += pts;
    explode(e.x, e.y, e.type === "soldier" ? 16 : 36);
    beep(e.type === "soldier" ? 260 : 140, 0.22, "sawtooth", 0.05, 60);
    var chance = e.type === "soldier" ? 0.06 : 0.22;
    if (Math.random() < chance) {
      var r = Math.random();
      powerups.push({ x: e.x, y: e.y, type: r < 0.4 ? "rep" : (r < 0.7 ? "dbl" : "rapid") });
    }
  }

  function fire() {
    if (dblT > 0) {
      bullets.push({ x: player.x - 8, y: player.y - 28, vy: -540 });
      bullets.push({ x: player.x + 8, y: player.y - 28, vy: -540 });
    } else {
      bullets.push({ x: player.x, y: player.y - 30, vy: -540 });
    }
    beep(240, 0.06, "square", 0.015, 120);
  }

  /* ---------- atualização ---------- */
  function update(dt) {
    elapsed += dt;
    if (shake > 0) shake = Math.max(0, shake - dt);

    var i, p;
    for (i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t > rings[i].dur) rings.splice(i, 1); }
    for (i = particles.length - 1; i >= 0; i--) {
      p = particles[i];
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96;
      if (p.t > p.life) particles.splice(i, 1);
    }
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    if (state !== "running") return;

    if (invuln > 0) invuln = Math.max(0, invuln - dt);
    if (dblT > 0) dblT = Math.max(0, dblT - dt);
    if (rapidT > 0) rapidT = Math.max(0, rapidT - dt);

    /* jogador */
    var dir = (right || padRight ? 1 : 0) - (left || padLeft ? 1 : 0);
    var tv = dir * 230;
    if (!dir && pointerX !== null) tv = clamp((pointerX - player.x) * 6, -230, 230);
    player.vx += (tv - player.vx) * Math.min(1, dt * 12);
    player.x = clamp(player.x + player.vx * dt, 24, W - 24);
    player.cool -= dt;
    if (player.cool <= 0) { fire(); player.cool = rapidT > 0 ? 0.15 : 0.3; }

    /* ondas */
    if (waveBreak > 0) {
      waveBreak -= dt;
      if (waveBreak <= 0) startWave();
    } else {
      spawnT -= dt;
      if (toSpawn > 0 && spawnT <= 0) { spawnEnemy(); toSpawn -= 1; }
      else if (toSpawn === 0 && enemies.length === 0) {
        score += 100 * wave;
        wave += 1;
        waveBreak = 2.6;
        banner = { text: "ONDA CUMPRIDA", t: 2.4 };
        if (armor < MAX_ARMOR && wave % 3 === 0) { armor += 1; renderArmor(); }
        beep(520, 0.12, "square", 0.04);
        beep(780, 0.2, "square", 0.04);
      }
    }

    /* tiros do jogador */
    for (i = bullets.length - 1; i >= 0; i--) {
      var b = bullets[i];
      b.y += b.vy * dt;
      if (b.y < -20) { bullets.splice(i, 1); continue; }
      for (var j = enemies.length - 1; j >= 0; j--) {
        var e = enemies[j];
        if (Math.abs(b.x - e.x) < e.w / 2 + 2 && Math.abs(b.y - e.y) < e.h / 2 + 2) {
          e.hp -= 1; e.flash = 0.08;
          burst(b.x, b.y, C.fireHot, 4, 80);
          bullets.splice(i, 1);
          if (e.hp <= 0) killEnemy(e, j);
          break;
        }
      }
    }

    /* inimigos */
    for (i = enemies.length - 1; i >= 0; i--) {
      var en = enemies[i];
      if (en.flash > 0) en.flash -= dt;
      if (en.type === "soldier") {
        en.y += en.vy * dt;
        en.x = clamp(en.x + Math.sin(elapsed * 2 + en.ph) * 18 * dt, 10, W - 10);
        if (en.y > LINE_Y) {
          enemies.splice(i, 1);
          explode(en.x, LINE_Y, 22);
          damagePlayer(1, true);
          if (state !== "running") return;
        }
      } else if (en.type === "tank") {
        if (en.y < en.holdY) { en.y += en.vy * dt; en.off += en.vy * dt; }
        en.fireT -= dt;
        if (en.fireT <= 0 && en.y > 20) {
          var dx = player.x - en.x, dy = player.y - en.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
          shells.push({ x: en.x, y: en.y + 24, vx: dx / d * 210, vy: dy / d * 210, kind: "shell" });
          burst(en.x, en.y + 26, C.fireHot, 4, 60);
          beep(120, 0.1, "square", 0.02, 80);
          en.fireT = clamp(2.3 - wave * 0.08, 1.3, 2.3) + Math.random() * 0.6;
        }
      } else {
        en.x += en.vx * dt;
        en.fireT -= dt;
        if (en.fireT <= 0 && en.x > 10 && en.x < W - 10) {
          shells.push({ x: en.x, y: en.y + 8, vx: 0, vy: 160, kind: "bomb" });
          en.fireT = 1.1 + Math.random() * 0.7;
        }
        if (en.x < -70 || en.x > W + 70) enemies.splice(i, 1);
      }
    }

    /* projéteis inimigos */
    for (i = shells.length - 1; i >= 0; i--) {
      var s = shells[i];
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.y > H + 10 || s.x < -10 || s.x > W + 10) { shells.splice(i, 1); continue; }
      if (Math.abs(s.x - player.x) < player.w / 2 + 2 && Math.abs(s.y - player.y) < player.h / 2) {
        shells.splice(i, 1);
        damagePlayer(1, false);
        if (state !== "running") return;
        continue;
      }
      if (s.kind === "bomb" && s.y > H - 34) {
        shells.splice(i, 1);
        explode(s.x, s.y, 20);
        beep(110, 0.12, "sawtooth", 0.03, 60);
      }
    }

    /* caixas de apoio */
    for (i = powerups.length - 1; i >= 0; i--) {
      var pu = powerups[i];
      pu.y += 55 * dt;
      if (pu.y > H + 20) { powerups.splice(i, 1); continue; }
      if (Math.abs(pu.x - player.x) < 26 && Math.abs(pu.y - player.y) < 30) {
        powerups.splice(i, 1);
        if (pu.type === "rep") { armor = Math.min(MAX_ARMOR, armor + 1); renderArmor(); }
        else if (pu.type === "dbl") dblT = 10;
        else rapidT = 10;
        score += 20;
        beep(700, 0.08, "square", 0.04);
        beep(1050, 0.12, "square", 0.04);
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

  function drawField() {
    ctx.fillStyle = C.ground; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.groundDark;
    for (var i = 0; i < 9; i++) ctx.fillRect(((i * 97) % (W - 60)) + 10, (i * 61) % (LINE_Y - 20) + 8, 46, 5);
    for (var c = 0; c < craters.length; c++) {
      var cr = craters[c];
      ctx.fillStyle = C.mud;
      ctx.beginPath(); ctx.ellipse(cr.x, cr.y, cr.r, cr.r * 0.7, 0, 0, 7); ctx.fill();
      ctx.fillStyle = C.mudDark;
      ctx.beginPath(); ctx.ellipse(cr.x, cr.y + 1, cr.r * 0.6, cr.r * 0.4, 0, 0, 7); ctx.fill();
    }
    /* trincheira e sacos de areia */
    ctx.fillStyle = C.trench; ctx.fillRect(0, LINE_Y, W, H - LINE_Y);
    for (var x = 0; x < W; x += 22) {
      ctx.fillStyle = (x / 22) % 2 === 0 ? C.bag : C.bagDark;
      rr(x + 1, LINE_Y - 10, 20, 12, 5); ctx.fill();
    }
  }

  function tankShape(w, h, body, turret, off) {
    ctx.fillStyle = C.tread;
    rr(-w / 2, -h / 2, 9, h, 3); ctx.fill();
    rr(w / 2 - 9, -h / 2, 9, h, 3); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 1;
    var o = off % 8;
    for (var y = -h / 2 + 2 + o; y < h / 2 - 1; y += 8) {
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 1, y); ctx.lineTo(-w / 2 + 8, y);
      ctx.moveTo(w / 2 - 8, y); ctx.lineTo(w / 2 - 1, y);
      ctx.stroke();
    }
    ctx.fillStyle = body;
    rr(-w / 2 + 7, -h / 2 + 3, w - 14, h - 6, 5); ctx.fill();
    ctx.fillStyle = "#1c1d17";
    rr(-2.5, -h / 2 - 8, 5, h / 2 + 8, 1.5); ctx.fill();
    ctx.fillStyle = turret;
    ctx.beginPath(); ctx.arc(0, 3, w * 0.27, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath(); ctx.arc(-3, 0, 3, 0, 7); ctx.fill();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.type === "tank") {
      ctx.scale(1, -1);
      tankShape(e.w, e.h, C.enemyBody, C.enemyTurret, e.off || 0);
    } else if (e.type === "soldier") {
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath(); ctx.ellipse(1, 3, 7, 4, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = "#222"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(5, -1); ctx.lineTo(5, 9); ctx.stroke();
      ctx.fillStyle = "#7c3a2e";
      ctx.beginPath(); ctx.ellipse(0, 0, 7, 4.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#c9a37a";
      ctx.beginPath(); ctx.arc(0, 1, 3.4, 0, 7); ctx.fill();
      ctx.fillStyle = "#3b3f2e";
      ctx.beginPath(); ctx.arc(0, 0, 3.6, Math.PI, 0); ctx.fill();
    }
    if (e.flash > 0 && e.type !== "soldier") {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      rr(-e.w / 2, -e.h / 2, e.w, e.h, 5); ctx.fill();
    } else if (e.flash > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  function drawHeli(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath(); ctx.ellipse(8, 18, 18, 7, 0, 0, 7); ctx.fill();
    if (e.vx < 0) ctx.scale(-1, 1);
    ctx.fillStyle = "#3f464d";
    rr(-32, -2, 18, 4, 2); ctx.fill();
    ctx.fillRect(-33, -7, 3, 10);
    ctx.fillStyle = "#59626b";
    ctx.beginPath(); ctx.ellipse(0, 0, 16, 8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#9cc0d2";
    ctx.beginPath(); ctx.ellipse(9, 0, 6, 5, 0, 0, 7); ctx.fill();
    ctx.save();
    ctx.rotate(elapsed * 28);
    ctx.strokeStyle = "rgba(20,20,20,0.6)"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(26, 0); ctx.moveTo(0, -26); ctx.lineTo(0, 26); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(0, 0, 3, 0, 7); ctx.fill();
    if (e.flash > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath(); ctx.ellipse(0, 0, 16, 8, 0, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  function drawPowerup(pu) {
    var bob = Math.sin(elapsed * 5 + pu.x) * 2;
    var col = pu.type === "rep" ? "#3aa06a" : (pu.type === "dbl" ? "#d9822b" : "#3d6fb6");
    var lab = pu.type === "rep" ? "R" : (pu.type === "dbl" ? "2" : "F");
    ctx.fillStyle = "rgba(0,0,0,0.2)"; rr(pu.x - 9, pu.y - 7 + bob, 20, 20, 3); ctx.fill();
    ctx.fillStyle = col; rr(pu.x - 10, pu.y - 10 + bob, 20, 20, 3); ctx.fill();
    ctx.strokeStyle = "#f1ebd3"; ctx.lineWidth = 1.5; rr(pu.x - 10, pu.y - 10 + bob, 20, 20, 3); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "700 13px Inter, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(lab, pu.x, pu.y + 4 + bob);
  }

  function draw() {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    var sx = 0, sy = 0;
    if (shake > 0) { var m = 8 * (shake / 0.35); sx = (Math.random() - 0.5) * m; sy = (Math.random() - 0.5) * m; }
    ctx.save();
    ctx.translate(sx, sy);
    drawField();

    var i;
    for (i = 0; i < powerups.length; i++) drawPowerup(powerups[i]);
    for (i = 0; i < enemies.length; i++) if (enemies[i].type !== "heli") drawEnemy(enemies[i]);

    if (state !== "over" && !(invuln > 0 && Math.floor(invuln * 12) % 2 === 0)) {
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(clamp(player.vx / 1800, -0.15, 0.15));
      tankShape(player.w, player.h, C.playerBody, C.playerTurret, elapsed * Math.abs(player.vx) * 0.2);
      ctx.restore();
    }

    ctx.fillStyle = C.fireHot;
    for (i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      rr(b.x - 2, b.y - 7, 4, 14, 2); ctx.fill();
    }
    for (i = 0; i < shells.length; i++) {
      var s = shells[i];
      if (s.kind === "bomb") {
        ctx.fillStyle = "#2b2a24"; ctx.beginPath(); ctx.ellipse(s.x, s.y, 4, 7, 0, 0, 7); ctx.fill();
        ctx.fillStyle = "#c4572a"; ctx.fillRect(s.x - 3, s.y - 9, 6, 3);
      } else {
        ctx.fillStyle = "#2b2a24"; ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, 7); ctx.fill();
        ctx.fillStyle = C.fire; ctx.beginPath(); ctx.arc(s.x - s.vx * 0.02, s.y - s.vy * 0.02, 3, 0, 7); ctx.fill();
      }
    }

    for (i = 0; i < enemies.length; i++) if (enemies[i].type === "heli") drawHeli(enemies[i]);

    for (i = 0; i < rings.length; i++) {
      var r = rings[i], k = r.t / r.dur;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = C.fire;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.max * (0.3 + 0.7 * k) * 0.8, 0, 7); ctx.fill();
      ctx.strokeStyle = C.fireHot; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.max * (0.3 + 0.7 * k), 0, 7); ctx.stroke();
    }
    for (i = 0; i < particles.length; i++) {
      var pt = particles[i];
      ctx.globalAlpha = Math.max(0, 1 - pt.t / pt.life);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.s / 2, pt.y - pt.s / 2, pt.s, pt.s);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    /* avisos sobre o campo */
    ctx.textAlign = "center";
    if (banner) {
      ctx.globalAlpha = Math.min(1, banner.t);
      ctx.fillStyle = "rgba(39,45,30,0.78)";
      rr(W / 2 - 112, 92, 224, 44, 6); ctx.fill();
      ctx.fillStyle = "#f1ebd3";
      ctx.font = "26px " + FONT;
      ctx.fillText(banner.text, W / 2, 124);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left";
    ctx.font = "700 12px Inter, sans-serif";
    var ty = 22;
    if (dblT > 0) { ctx.fillStyle = "#fff4d6"; ctx.fillText("TIRO DUPLO " + Math.ceil(dblT) + "s", 12, ty); ty += 16; }
    if (rapidT > 0) { ctx.fillStyle = "#d6e6ff"; ctx.fillText("CADÊNCIA " + Math.ceil(rapidT) + "s", 12, ty); }
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
  renderArmor();
  renderHud();
  requestAnimationFrame(function (t) { lastT = t; requestAnimationFrame(frame); });
})();
