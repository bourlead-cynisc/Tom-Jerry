(() => {
  "use strict";

  const VIEW_W = 1200;
  const VIEW_H = 700;
  const ROOM_W = 1200;
  const ROOM_COUNT = 5;
  const CHEESE_GOAL = 5;
  const WORLD_W = ROOM_W * ROOM_COUNT;
  const FLOOR_Y = [616, 340];
  const ROOM_NAMES = [
    ["Гостиная", "Кухня", "Столовая", "Прихожая", "Кладовая"],
    ["Спальня", "Библиотека", "Детская", "Ванная", "Чердак"]
  ];
  const STAIR_WIDTH = 176;
  const STAIR_GAP = 86;
  const STAIRS = Array.from({ length: ROOM_COUNT }, (_, room) => ({
    room,
    lowerX: room * ROOM_W + 500,
    upperX: room * ROOM_W + 500 + STAIR_GAP
  }));
  const ITEM_TYPES = [
    { id: "broom", name: "Швабра", icon: "🧹", uses: 3, help: "широкий взмах, оглушение рядом" },
    { id: "pillow", name: "Подушка", icon: "🛏️", uses: 2, help: "бросок далеко, подберите снова" },
    { id: "pan", name: "Сковородка", icon: "🍳", uses: 2, help: "короткий сильный удар" }
  ];
  const SPRITE_CELL_W = 384;
  const SPRITE_CELL_H = 1024 / 6;

  const canvas = document.getElementById("world");
  let ctx = canvas.getContext("2d");
  const scene = document.createElement("canvas");
  scene.width = WORLD_W;
  scene.height = VIEW_H;
  const sceneCtx = scene.getContext("2d");
  const $ = (id) => document.getElementById(id);
  const els = {
    menu: $("menu"), pause: $("pauseOverlay"), end: $("endOverlay"), hud: $("hud"),
    toast: $("toast"), role: $("roleText"), goal: $("objective"), cheese: $("cheeseText"),
    item: $("itemText"), floor: $("floorText"), room: $("roomText")
  };
  const state = {
    mode: "menu", role: "jerry", elapsed: 0, toastTimer: 0, last: 0,
    musicOn: true, musicTimer: null, musicStep: 0, audio: null
  };
  const keys = new Set();
  const touch = { left: false, right: false };
  const sprites = { tom: null, jerry: null };
  const furniture = [];
  let items = [];
  let cheeses = [];
  let projectiles = [];
  let holeX = 0;
  let tom = null;
  let jerry = null;
  let player = null;
  let enemy = null;
  let cameraX = 0;
  let lastRoomToast = "";

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function floorY(f) { return FLOOR_Y[f]; }
  function roomAt(x) { return clamp(Math.floor(x / ROOM_W), 0, ROOM_COUNT - 1); }
  function nearestStair(x) { return STAIRS.reduce((best, s) => Math.abs(s.lowerX - x) < Math.abs(best.lowerX - x) ? s : best, STAIRS[0]); }
  function character(role, x, f) {
    return {
      role, x, f, facing: 1, jump: 0, vy: 0, stun: 0, swing: 0, cooldown: 0,
      weapon: null, cheese: 0, walking: false, walkT: 0, idleSince: 0,
      idleMode: -1, idleT: 0, lastIdle: -1, aiClock: 0, aiDir: 0,
      climb: null, climbAnim: 0, spawnX: x
    };
  }

  function buildFurniture() {
    furniture.length = 0;
    const add = (room, floor, offset, width, height, type, color) => furniture.push({
      room, f: floor, x: room * ROOM_W + offset, w: width, h: height, type, color
    });
    add(0, 0, 128, 210, 72, "sofa", "#d56f55"); add(0, 0, 440, 125, 52, "table", "#c98e52"); add(0, 1, 155, 190, 72, "bed", "#668cb4"); add(0, 1, 880, 130, 125, "bookcase", "#916249");
    add(1, 0, 165, 150, 128, "cabinet", "#8d644f"); add(1, 0, 770, 165, 55, "table", "#d89a58"); add(1, 1, 165, 120, 130, "bookcase", "#916249"); add(1, 1, 855, 165, 66, "desk", "#c98e52");
    add(2, 0, 130, 160, 55, "table", "#d89a58"); add(2, 0, 735, 145, 70, "sofa", "#b96d56"); add(2, 1, 170, 160, 68, "bed", "#668cb4"); add(2, 1, 805, 125, 122, "cabinet", "#8d644f");
    add(3, 0, 155, 95, 112, "cabinet", "#8d644f"); add(3, 0, 820, 130, 72, "chair", "#6a91ae"); add(3, 1, 150, 160, 58, "desk", "#c98e52"); add(3, 1, 810, 145, 105, "cabinet", "#8d644f");
    add(4, 0, 145, 160, 92, "cabinet", "#8d644f"); add(4, 0, 830, 150, 52, "table", "#d89a58"); add(4, 1, 150, 170, 115, "bookcase", "#916249"); add(4, 1, 840, 145, 65, "desk", "#c98e52");
  }

  function loadAtlas(role, src) {
    const img = new Image();
    img.onload = () => {
      const trimCanvas = document.createElement("canvas");
      trimCanvas.width = img.width; trimCanvas.height = img.height;
      const trimCtx = trimCanvas.getContext("2d", { willReadFrequently: true });
      trimCtx.drawImage(img, 0, 0);
      const data = trimCtx.getImageData(0, 0, img.width, img.height).data;
      const bounds = [];
      for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 4; col++) {
          const x0 = Math.round(col * SPRITE_CELL_W), y0 = Math.round(row * SPRITE_CELL_H);
          const x1 = Math.min(img.width, Math.round((col + 1) * SPRITE_CELL_W));
          const y1 = Math.min(img.height, Math.round((row + 1) * SPRITE_CELL_H));
          const width = x1 - x0, height = y1 - y0, length = width * height, threshold = 160;
          const labels = new Uint16Array(length), stack = new Int32Array(length), seen = 0xffff;
          let best = null, componentId = 0;
          for (let seed = 0; seed < length; seed += 1) {
            if (labels[seed] !== 0) continue;
            const seedX = seed % width, seedY = Math.floor(seed / width);
            const seedAlpha = data[((y0 + seedY) * img.width + x0 + seedX) * 4 + 3];
            if (seedAlpha <= threshold) { labels[seed] = seen; continue; }
            let head = 0, tail = 0, count = 0;
            componentId += 1;
            let minX = seedX, maxX = seedX, minY = seedY, maxY = seedY;
            labels[seed] = componentId; stack[tail++] = seed;
            while (head < tail) {
              const index = stack[head++], px = index % width, py = Math.floor(index / width);
              count += 1; minX = Math.min(minX, px); maxX = Math.max(maxX, px);
              minY = Math.min(minY, py); maxY = Math.max(maxY, py);
              let next = px > 0 ? index - 1 : -1;
              if (next >= 0 && labels[next] === 0) {
                if (data[((y0 + py) * img.width + x0 + px - 1) * 4 + 3] > threshold) { labels[next] = componentId; stack[tail++] = next; }
                else labels[next] = seen;
              }
              next = px + 1 < width ? index + 1 : -1;
              if (next >= 0 && labels[next] === 0) {
                if (data[((y0 + py) * img.width + x0 + px + 1) * 4 + 3] > threshold) { labels[next] = componentId; stack[tail++] = next; }
                else labels[next] = seen;
              }
              next = py > 0 ? index - width : -1;
              if (next >= 0 && labels[next] === 0) {
                if (data[((y0 + py - 1) * img.width + x0 + px) * 4 + 3] > threshold) { labels[next] = componentId; stack[tail++] = next; }
                else labels[next] = seen;
              }
              next = py + 1 < height ? index + width : -1;
              if (next >= 0 && labels[next] === 0) {
                if (data[((y0 + py + 1) * img.width + x0 + px) * 4 + 3] > threshold) { labels[next] = componentId; stack[tail++] = next; }
                else labels[next] = seen;
              }
            }
            if (!best || count > best.count) best = { id: componentId, count, minX, minY, maxX, maxY };
          }
          if (best) {
            const frameData = trimCtx.getImageData(x0, y0, width, height), pixels = frameData.data;
            for (let i = 0; i < length; i += 1) {
              if (labels[i] === best.id) continue;
              const alphaIndex = i * 4 + 3;
              if (pixels[alphaIndex] > 0 && pixels[alphaIndex] <= threshold) {
                const px = i % width, py = Math.floor(i / width);
                let nearMain = false;
                for (let oy = -1; oy <= 1 && !nearMain; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
                  const nx = px + ox, ny = py + oy;
                  if (nx >= 0 && nx < width && ny >= 0 && ny < height && labels[ny * width + nx] === best.id) { nearMain = true; break; }
                }
                if (nearMain) continue;
              }
              pixels[alphaIndex] = 0;
            }
            trimCtx.putImageData(frameData, x0, y0);
            const pad = 1;
            const bx = Math.max(0, best.minX - pad), by = Math.max(0, best.minY - pad);
            const ex = Math.min(width, best.maxX + pad + 1), ey = Math.min(height, best.maxY + pad + 1);
            bounds.push({ x: x0 + bx, y: y0 + by, w: ex - bx, h: ey - by });
          } else bounds.push(null);
        }
      }
      sprites[role] = { img: trimCanvas, bounds };
    };
    img.onerror = () => { sprites[role] = null; };
    img.src = src;
  }

  function findOpenSpot(f, used, minDistance = 90) {
    for (let attempt = 0; attempt < 500; attempt++) {
      const room = Math.floor(Math.random() * ROOM_COUNT);
      const x = room * ROOM_W + 72 + Math.random() * (ROOM_W - 144);
      if (isBlockedSpot(x, f, 24)) continue;
      if (STAIRS.some(s => Math.abs(x - (f === 0 ? s.lowerX : s.upperX)) < 72)) continue;
      if (used.some(p => p.f === f && Math.abs(p.x - x) < minDistance)) continue;
      return { x, f };
    }
    const room = Math.floor(Math.random() * ROOM_COUNT);
    return { x: room * ROOM_W + ROOM_W / 2, f };
  }
  function isBlockedSpot(x, f, margin) {
    return furniture.some(o => o.f === f && x > o.x - margin && x < o.x + o.w + margin);
  }

  function resetWorld(role) {
    state.role = role; state.elapsed = 0; projectiles = []; items = []; cheeses = [];
    let tomSpawn = findOpenSpot(Math.floor(Math.random() * 2), [], 0);
    let jerrySpawn = null;
    for (let i = 0; i < 500; i++) {
      const candidate = findOpenSpot(Math.floor(Math.random() * 2), [tomSpawn], 700);
      const horizontalGap = Math.abs(candidate.x - tomSpawn.x);
      const minimumGap = candidate.f === tomSpawn.f ? 1800 : 1400;
      if (horizontalGap > minimumGap) { jerrySpawn = candidate; break; }
    }
    if (!jerrySpawn) jerrySpawn = findOpenSpot(1 - tomSpawn.f, [tomSpawn], 700);
    tom = character("tom", tomSpawn.x, tomSpawn.f); jerry = character("jerry", jerrySpawn.x, jerrySpawn.f);
    tom.facing = tom.x < jerry.x ? 1 : -1; jerry.facing = jerry.x < tom.x ? 1 : -1;
    player = role === "tom" ? tom : jerry; enemy = role === "tom" ? jerry : tom;
    holeX = findOpenSpot(0, [{ x: tom.x, f: tom.f }, { x: jerry.x, f: jerry.f }], 320).x;

    const occupied = [{ x: tom.x, f: tom.f }, { x: jerry.x, f: jerry.f }, { x: holeX, f: 0 }];
    ITEM_TYPES.forEach(type => {
      const spot = findOpenSpot(Math.floor(Math.random() * 2), occupied, 230);
      const item = { ...type, x: spot.x, f: spot.f, owner: null, inFlight: false };
      items.push(item); occupied.push(spot);
    });
    for (let i = 0; i < CHEESE_GOAL; i++) {
      const spot = findOpenSpot(Math.floor(Math.random() * 2), occupied, 180);
      cheeses.push({ x: spot.x, f: spot.f, taken: false }); occupied.push(spot);
    }
    cameraX = clamp(player.x - VIEW_W * 0.39, 0, WORLD_W - VIEW_W);
    lastRoomToast = "";
    els.role.textContent = role === "tom" ? "Том" : "Джерри";
    els.goal.textContent = role === "tom" ? "Поймай Джерри" : `Собери ${CHEESE_GOAL} сыров и вернись в норку`;
    els.hud.hidden = false; $("menuBtn").hidden = false;
    updateHud();
  }

  function showToast(text) {
    els.toast.textContent = text; els.toast.classList.add("show"); state.toastTimer = 2.15;
  }
  function updateHud() {
    els.cheese.textContent = jerry ? `${jerry.cheese} / ${CHEESE_GOAL}` : `0 / ${CHEESE_GOAL}`;
    els.item.textContent = player && player.weapon ? `${player.weapon.name} ×${player.weapon.uses}` : "нет";
    els.floor.textContent = player ? (player.f === 1 ? "2" : "1") : "1";
    els.room.textContent = player ? ROOM_NAMES[player.f][roomAt(player.x)] : "Гостиная";
    $("pauseBtn").setAttribute("aria-label", state.mode === "paused" ? "Продолжить" : "Пауза");
  }
  function startGame() {
    resetWorld(state.role); state.mode = "playing"; els.menu.hidden = true; els.pause.hidden = true; els.end.hidden = true;
    $("touch").style.display = ""; startAudio();
    showToast(state.role === "tom" ? "Найди лестницу и поймай Джерри!" : "Собери сыр по всему дому и найди норку!");
  }
  function backToMenu() {
    state.mode = "menu"; els.end.hidden = true; els.pause.hidden = true; els.hud.hidden = true;
    $("menuBtn").hidden = true; els.menu.hidden = false; $("touch").style.display = "none";
    tom = null; jerry = null; player = null; enemy = null; draw();
  }
  function togglePause() {
    if (state.mode === "playing") { state.mode = "paused"; els.pause.hidden = false; }
    else if (state.mode === "paused") { state.mode = "playing"; els.pause.hidden = true; }
    updateHud();
  }
  function finish(won, reason) {
    state.mode = "ended"; els.end.hidden = false;
    $("endTitle").textContent = won ? "Победа!" : "Погоня окончена";
    $("endKicker").textContent = won ? "Вот это ловкость!" : "Упс, соперник оказался быстрее";
    $("endText").textContent = reason; $("touch").style.display = "none"; playJingle(won); updateHud();
  }
  function playAgain() { els.end.hidden = true; startGame(); }

  function initAudio() {
    if (!state.audio) { const A = window.AudioContext || window.webkitAudioContext; if (A) state.audio = new A(); }
    if (state.audio && state.audio.state === "suspended") state.audio.resume();
  }
  function tone(freq, duration, type, volume, when, slide) {
    if (!state.musicOn || !state.audio) return;
    const ac = state.audio, osc = ac.createOscillator(), gain = ac.createGain(), t = when ?? ac.currentTime;
    osc.type = type || "triangle"; osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + duration);
    gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(volume || 0.055, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain); gain.connect(ac.destination); osc.start(t); osc.stop(t + duration + 0.035);
  }
  function noiseBurst(duration, volume, filterFreq) {
    if (!state.musicOn || !state.audio) return;
    const ac = state.audio, length = Math.max(1, Math.floor(ac.sampleRate * duration));
    const buffer = ac.createBuffer(1, length, ac.sampleRate), channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) channel[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = ac.createBufferSource(), filter = ac.createBiquadFilter(), gain = ac.createGain();
    src.buffer = buffer; filter.type = "lowpass"; filter.frequency.value = filterFreq;
    gain.gain.value = volume; src.connect(filter); filter.connect(gain); gain.connect(ac.destination); src.start();
  }
  function startAudio() { initAudio(); if (state.musicOn && state.audio && !state.musicTimer) musicTick(); }
  function musicTick() {
    if (!state.musicOn || !state.audio || state.mode === "menu" || state.mode === "ended") { state.musicTimer = null; return; }
    const melody = [659, 784, 988, 784, 698, 880, 1047, 880, 587, 740, 880, 740, 523, 659, 784, 659];
    const bass = [165, 165, 196, 147], ac = state.audio, t = ac.currentTime, n = state.musicStep++;
    tone(melody[n % melody.length], .19, "triangle", .032, t, .94);
    if (n % 4 === 0) tone(bass[Math.floor(n / 4) % bass.length], .42, "sine", .04, t, .92);
    if (n % 2 === 0) tone(melody[(n + 4) % melody.length] / 2, .13, "sine", .016, t + .16, .96);
    state.musicTimer = window.setTimeout(musicTick, 245);
  }
  function sfx(kind) {
    if (!state.musicOn) return; initAudio(); if (!state.audio) return;
    const t = state.audio.currentTime;
    if (kind === "pick") { tone(740, .1, "triangle", .075, t, 1.3); tone(1040, .15, "sine", .055, t + .08, 1.1); }
    else if (kind === "broom") { noiseBurst(.22, .16, 1250); tone(250, .16, "sawtooth", .034, t, .45); }
    else if (kind === "pillow") { noiseBurst(.24, .22, 700); tone(150, .2, "sine", .08, t, .48); }
    else if (kind === "pan") { tone(720, .3, "square", .075, t, .21); tone(1160, .33, "triangle", .035, t + .015, .38); }
    else if (kind === "hit") { tone(190, .17, "square", .05, t, .5); tone(620, .2, "triangle", .045, t + .04, .48); }
    else if (kind === "cheese") { tone(880, .1, "triangle", .07, t, 1.2); tone(1175, .18, "triangle", .055, t + .1, 1.1); }
    else if (kind === "jump") { tone(280, .16, "sine", .04, t, 1.8); }
    else if (kind === "stairs") { tone(300, .12, "triangle", .035, t, 1.22); tone(390, .12, "triangle", .028, t + .13, 1.14); }
    else if (kind === "delivery") { tone(523, .12, "triangle", .07, t, 1.1); tone(659, .12, "triangle", .07, t + .12, 1.1); tone(784, .23, "triangle", .08, t + .24, 1.1); }
  }
  function playJingle(win) {
    if (!state.musicOn) return; initAudio(); if (!state.audio) return;
    const seq = win ? [784, 988, 1175, 1568] : [494, 440, 392, 330], base = state.audio.currentTime;
    seq.forEach((n, i) => tone(n, .26, "triangle", .07, base + i * .14, .96));
  }
  $("soundBtn").addEventListener("click", () => {
    state.musicOn = !state.musicOn; $("soundBtn").textContent = state.musicOn ? "♫ Звук: вкл." : "♫ Звук: выкл.";
    $("soundBtn").setAttribute("aria-pressed", String(state.musicOn));
    if (!state.musicOn && state.musicTimer) { clearTimeout(state.musicTimer); state.musicTimer = null; }
    if (state.musicOn && state.mode === "playing") startAudio();
  });

  function startClimb(c, direction, quiet = false) {
    if (!c || c.climb || c.stun > 0) return false;
    const stair = nearestStair(c.x);
    const fromX = c.f === 0 ? stair.lowerX : stair.upperX;
    if (Math.abs(c.x - fromX) > 78) {
      if (!quiet && c === player) showToast(`Лестница в комнате «${ROOM_NAMES[c.f][stair.room]}»`);
      return false;
    }
    const up = direction > 0;
    if ((up && c.f !== 0) || (!up && c.f !== 1)) return false;
    const toX = up ? stair.upperX : stair.lowerX;
    c.climb = { fromX: c.x, toX, fromFloor: c.f, toFloor: up ? 1 : 0, t: 0, duration: .9, stair };
    c.climbAnim = 0; c.jump = 0; c.vy = 0; c.walking = false;
    c.facing = toX >= c.x ? 1 : -1; sfx("stairs");
    if (!quiet && c === player) showToast(up ? "Поднимаешься по лестнице…" : "Спускаешься по лестнице…");
    return true;
  }
  function updateClimb(c, dt) {
    if (!c.climb) return false;
    const cl = c.climb; cl.t = Math.min(cl.duration, cl.t + dt); c.climbAnim += dt * 8;
    const p = cl.t / cl.duration;
    c.x = cl.fromX + (cl.toX - cl.fromX) * p;
    c.f = p >= 1 ? cl.toFloor : cl.fromFloor;
    if (p >= 1) {
      c.f = cl.toFloor; c.x = cl.toX; c.climb = null; c.idleSince = 0;
      if (c === player) showToast(c.f ? "Ты на втором этаже" : "Ты на первом этаже");
    }
    return true;
  }
  function blockedMove(x, f, jumping, fromX) {
    if (jumping > 34) return false;
    return furniture.some(o => o.f === f && x > o.x - 30 && x < o.x + o.w + 30 && (fromX < o.x - 30 || fromX > o.x + o.w + 30));
  }
  function stepChar(c, dir, dt) {
    if (c.climb) { updateClimb(c, dt); updateIdle(c, dt, true); return; }
    c.walking = Boolean(dir) && c.stun <= 0;
    if (c.stun > 0) { c.stun = Math.max(0, c.stun - dt); c.walking = false; }
    if (c.cooldown > 0) c.cooldown = Math.max(0, c.cooldown - dt);
    if (c.swing > 0) c.swing = Math.max(0, c.swing - dt);
    if (c.walking) {
      c.facing = dir; c.walkT += dt * 12;
      const speed = c === player ? 300 : 224;
      const nx = clamp(c.x + dir * speed * dt, 30, WORLD_W - 30);
      if (!blockedMove(nx, c.f, c.jump, c.x)) c.x = nx;
    }
    if (c.vy !== 0 || c.jump > 0) {
      c.vy -= 1350 * dt; c.jump += c.vy * dt;
      if (c.jump < 0) { c.jump = 0; c.vy = 0; }
    }
    updateIdle(c, dt, c.walking || c.jump > 0);
  }
  function updateIdle(c, dt, moving) {
    if (moving || c.stun > 0 || c.climb) { c.idleSince = 0; c.idleMode = -1; c.idleT = 0; return; }
    c.idleSince += dt;
    if (c.idleSince < 5) return;
    if (c.idleMode < 0) {
      let n = Math.floor(Math.random() * 3); if (n === c.lastIdle) n = (n + 1 + Math.floor(Math.random() * 2)) % 3;
      c.idleMode = n; c.lastIdle = n; c.idleT = 0;
    }
    c.idleT += dt;
    if (c.idleT > 2.1) { c.idleMode = -1; c.idleSince = 0; c.idleT = 0; }
  }
  function playerMove(dt) {
    if (player.stun > 0 || player.climb) { stepChar(player, 0, dt); return; }
    const dir = (keys.has("ArrowRight") || keys.has("KeyD") || touch.right ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") || touch.left ? 1 : 0);
    stepChar(player, dir, dt);
  }
  function tapMove(dir) {
    if (state.mode !== "playing" || !player || player.stun > 0 || player.climb) return;
    player.facing = dir;
    player.walkT += .7;
    const nx = clamp(player.x + dir * 38, 30, WORLD_W - 30);
    if (!blockedMove(nx, player.f, player.jump, player.x)) player.x = nx;
    updateIdle(player, .01, true);
  }
  function routeCost(c, x, f) {
    if (c.f === f) return Math.abs(x - c.x);
    return STAIRS.reduce((best, stair) => {
      const here = c.f === 0 ? stair.lowerX : stair.upperX;
      const there = f === 0 ? stair.lowerX : stair.upperX;
      return Math.min(best, Math.abs(c.x - here) + 340 + Math.abs(x - there));
    }, Infinity);
  }
  function nearestItem(c) {
    return items.filter(i => !i.owner && !i.inFlight).reduce((best, item) => {
      const d = routeCost(c, item.x, item.f);
      return !best || d < best.d ? { item, d } : best;
    }, null)?.item || null;
  }
  function routeTo(c, x, f, dt) {
    if (c.f !== f) {
      const stair = STAIRS.reduce((best, candidate) => {
        const from = c.f === 0 ? candidate.lowerX : candidate.upperX;
        const to = f === 0 ? candidate.lowerX : candidate.upperX;
        const cost = Math.abs(c.x - from) + 340 + Math.abs(x - to);
        return !best || cost < best.cost ? { stair: candidate, cost } : best;
      }, null).stair;
      const endpoint = c.f === 0 ? stair.lowerX : stair.upperX;
      if (Math.abs(c.x - endpoint) < 44) { startClimb(c, f > c.f ? 1 : -1, true); return 0; }
      return c.x < endpoint ? 1 : -1;
    }
    if (Math.abs(c.x - x) < 25) return 0;
    return c.x < x ? 1 : -1;
  }
  function stepEnemy(c, dir, dt) {
    if (c.climb) { stepChar(c, 0, dt); return; }
    if (dir && c.stun <= 0 && c.jump === 0 && c.vy === 0 && blockedMove(c.x + dir * 31, c.f, 0, c.x)) c.vy = 500;
    stepChar(c, dir, dt);
  }
  function aiTick(dt) {
    if (enemy.climb) { stepEnemy(enemy, 0, dt); return; }
    enemy.aiClock -= dt;
    if (enemy.aiClock > 0) { stepEnemy(enemy, enemy.aiDir || 0, dt); return; }
    enemy.aiClock = .085;
    const distance = Math.abs(tom.x - jerry.x), same = tom.f === jerry.f;
    if (enemy.role === "tom") {
      const targetRange = tom.weapon?.id === "broom" ? 195 : tom.weapon?.id === "pillow" ? 500 : tom.weapon?.id === "pan" ? 112 : 84;
      const inAttackRange = same && distance < targetRange && (tom.weapon?.id !== "pillow" || distance > 80);
      const facing = Math.sign(jerry.x - tom.x) || tom.facing;
      const item = nearestItem(tom);
      const interceptHole = jerry.cheese >= CHEESE_GOAL - 1;
      let targetX = interceptHole ? holeX : clamp(jerry.x + (jerry.walking ? jerry.facing * 100 : 0), 42, WORLD_W - 42);
      let targetF = interceptHole ? 0 : jerry.f;
      if (!tom.weapon && item && item.f === tom.f && Math.abs(item.x - tom.x) < 50 && (!same || distance > 135)) takeItem(tom, item);
      if (inAttackRange && tom.stun <= 0 && tom.cooldown <= 0) {
        tom.facing = facing;
        if (tom.weapon) attack(tom, jerry);
        else {
          tom.cooldown = .92; tom.swing = .44; sfx("broom");
          if (jerry.stun <= 0 && !jerry.climb && jerry.jump < 36) {
            jerry.stun = 1.05; sfx("hit");
            if (jerry === player) showToast("Том обездвижил тебя!");
          }
        }
      }
      if (!tom.weapon && item && (!same || distance > 330) && routeCost(tom, item.x, item.f) < Math.min(780, routeCost(tom, targetX, targetF) * .82 + 170)) {
        targetX = item.x; targetF = item.f;
      }
      enemy.aiDir = inAttackRange ? 0 : routeTo(tom, targetX, targetF, dt);
    } else {
      const cheese = cheeses.filter(ch => !ch.taken).reduce((best, ch) => {
        const d = routeCost(jerry, ch.x, ch.f);
        return !best || d < best.d ? { x: ch.x, f: ch.f, d } : best;
      }, null);
      let target = jerry.cheese >= CHEESE_GOAL ? { x: holeX, f: 0 } : cheese;
      const threatCost = routeCost(jerry, tom.x, tom.f);
      const threatened = same && distance < 340;
      const weaponRange = jerry.weapon?.id === "broom" ? 195 : jerry.weapon?.id === "pillow" ? 500 : 112;
      const canFight = same && jerry.weapon && distance < weaponRange && (jerry.weapon.id === "pillow" ? distance > 80 : distance < weaponRange - 12);
      const incoming = !jerry.climb && projectiles.find(p => p.owner === tom && p.f === jerry.f &&
        ((p.dir > 0 && p.x < jerry.x && jerry.x - p.x < 230) || (p.dir < 0 && p.x > jerry.x && p.x - jerry.x < 230)));
      if (canFight && jerry.cooldown <= 0) {
        jerry.facing = Math.sign(tom.x - jerry.x) || jerry.facing;
        aiAttack(jerry, tom);
      }
      const item = nearestItem(jerry);
      if (!jerry.weapon && item && item.f === jerry.f && Math.abs(item.x - jerry.x) < 50 && (!threatened || jerry.cheese === 0)) takeItem(jerry, item);
      if (threatened && !canFight) {
        const escapeDir = jerry.x <= tom.x ? -1 : 1;
        const preferredX = clamp(jerry.x + escapeDir * 310, 42, WORLD_W - 42);
        const alternateX = clamp(jerry.x - escapeDir * 260, 42, WORLD_W - 42);
        const blockedPreferred = blockedMove(preferredX, jerry.f, jerry.jump, jerry.x);
        target = { x: blockedPreferred && !blockedMove(alternateX, jerry.f, jerry.jump, jerry.x) ? alternateX : preferredX, f: jerry.f };
      } else if (!jerry.weapon && item && target && item.f === jerry.f && routeCost(jerry, item.x, item.f) + 90 < routeCost(jerry, target.x, target.f) && routeCost(jerry, item.x, item.f) < 620 && (!threatened || distance > 240) && (same || threatCost > 650)) {
        target = { x: item.x, f: item.f };
      }
      enemy.aiDir = incoming ? -incoming.dir : threatened && !canFight && same ? (jerry.x <= tom.x ? -1 : 1) : target ? routeTo(jerry, target.x, target.f, dt) : 0;
    }
    stepEnemy(enemy, enemy.aiDir || 0, dt);
  }

  function takeItem(c, item) {
    if (!item || item.owner || item.inFlight) return;
    item.owner = c; c.weapon = item; sfx("pick");
    if (c === player) showToast(`${item.name} взята — пробел для применения`);
    updateHud();
  }
  function interact() {
    if (state.mode !== "playing" || !player || player.stun > 0 || player.climb) return;
    if (player.weapon) {
      const item = player.weapon; item.owner = null; item.x = clamp(player.x + player.facing * 42, 30, WORLD_W - 30); item.f = player.f;
      player.weapon = null; sfx("pick"); showToast("Предмет оставлен на полу"); updateHud(); return;
    }
    const item = items.filter(i => !i.owner && !i.inFlight && i.f === player.f && Math.abs(i.x - player.x) < 66)
      .sort((a, b) => Math.abs(a.x - player.x) - Math.abs(b.x - player.x))[0];
    if (item) takeItem(player, item); else showToast("Подойди к предмету и нажми E");
  }
  function strike(c, target, item) {
    if (target.f !== c.f || target.climb || target.stun > 0) return false;
    const dx = target.x - c.x, facingCorrect = Math.sign(dx || c.facing) === c.facing;
    const range = item.id === "broom" ? 195 : 112;
    if (Math.abs(dx) > range || !facingCorrect) return false;
    target.stun = item.id === "pan" ? 2.45 : item.id === "broom" ? 1.55 : 1.9;
    sfx("hit"); return true;
  }
  function throwPillow(c, item) {
    item.uses -= 1; item.owner = null; item.inFlight = true; c.weapon = null;
    if (item.uses <= 0) items = items.filter(i => i !== item);
    projectiles.push({ x: c.x + c.facing * 45, y: floorY(c.f) - 86, f: c.f, dir: c.facing, speed: 720, owner: c, item, life: 1.1 });
    sfx("pillow"); c.swing = .33; c.cooldown = .56;
    if (c === player) showToast("Подушка летит — соперник оглушён при попадании");
  }
  function attack(c, target) {
    if (state.mode !== "playing" || c.stun > 0 || c.cooldown > 0 || c.climb) return;
    if (!c.weapon) { c.vy = 500; c.cooldown = .42; sfx("jump"); if (c === player) showToast("Прыжок! E — подобрать предмет"); return; }
    const item = c.weapon;
    if (item.id === "pillow") { throwPillow(c, item); updateHud(); return; }
    c.cooldown = item.id === "pan" ? .95 : .68; c.swing = item.id === "broom" ? .46 : .38;
    sfx(item.id);
    if (strike(c, target, item)) {
      showToast(c === player ? `${item.name}: попадание!` : "Ой! Тебя оглушили"); item.uses -= 1;
    } else if (c === player) showToast("Мимо — направься к сопернику");
    if (item.uses <= 0) {
      items = items.filter(i => i !== item); c.weapon = null;
      if (c === player) showToast(`${item.name} износилась — найди новый предмет`);
    }
    updateHud();
  }
  function aiAttack(c, target) {
    if (!c.weapon) return;
    attack(c, target);
  }
  function updateProjectiles(dt) {
    const remaining = [];
    for (const p of projectiles) {
      p.life -= dt; p.x += p.dir * p.speed * dt;
      const target = p.owner === tom ? jerry : tom;
      const hits = target.f === p.f && !target.climb && Math.abs(target.x - p.x) < 44 && Math.abs(target.x - p.owner.x) < 520;
      if (hits) {
        target.stun = 1.8; sfx("hit");
        if (target === player) showToast("Подушка попала — ты оглушён!");
        else if (p.owner === player) showToast("Подушка попала в соперника!");
        p.item.inFlight = false; p.item.x = p.x; p.item.f = p.f;
        if (p.item.uses <= 0) items = items.filter(i => i !== p.item);
      } else if (p.life <= 0 || p.x < 20 || p.x > WORLD_W - 20) {
        p.item.inFlight = false; p.item.x = clamp(p.x, 30, WORLD_W - 30); p.item.f = p.f;
        if (p.item.uses <= 0) items = items.filter(i => i !== p.item);
      } else { remaining.push(p); continue; }
    }
    projectiles = remaining;
  }
  function collectCheese() {
    cheeses.forEach(ch => {
      if (!ch.taken && jerry.f === ch.f && !jerry.climb && Math.abs(jerry.x - ch.x) < 38 && jerry.jump < 52) {
        ch.taken = true; jerry.cheese += 1; sfx("cheese");
        showToast(jerry === player ? `Сыр найден! ${jerry.cheese} из ${CHEESE_GOAL}` : `Джерри нашёл сыр: ${jerry.cheese} из ${CHEESE_GOAL}`); updateHud();
      }
    });
  }
  function update(dt) {
    if (state.mode !== "playing") return;
    state.elapsed += dt; playerMove(dt); aiTick(dt); updateProjectiles(dt); collectCheese();
    if (jerry.cheese >= CHEESE_GOAL && jerry.f === 0 && Math.abs(jerry.x - holeX) < 54 && jerry.jump < 35) {
      sfx("delivery"); finish(jerry === player, jerry === player ? "Пять сыров спрятаны в норке! Джерри снова всех перехитрил." : "Джерри унёс пять сыров в свою норку.");
    }
    if (state.mode === "playing" && !tom.climb && !jerry.climb && tom.f === jerry.f && Math.abs(tom.x - jerry.x) < 43 && tom.stun <= 0 && jerry.stun <= 0) {
      finish(tom === player, tom === player ? "Том поймал Джерри! Погоня выиграна." : "Том поймал Джерри — сыры пока подождут.");
    }
    const room = player ? ROOM_NAMES[player.f][roomAt(player.x)] : "";
    if (player && room !== lastRoomToast) { lastRoomToast = room; updateHud(); }
    if (state.toastTimer > 0) { state.toastTimer -= dt; if (state.toastTimer <= 0) els.toast.classList.remove("show"); }
    updateHud();
  }

  function rr(x, y, w, h, r, fill, stroke, lineWidth = 3) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
  }
  function ellipse(x, y, rx, ry, color) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
  function line(x1, y1, x2, y2, color, width) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.stroke(); }
  function drawWindow(x, y, hue) {
    rr(x, y, 162, 102, 12, "#bfe6ec", "#744f4a", 5); ctx.fillStyle = hue || "#9bd4e1"; ctx.fillRect(x + 9, y + 9, 144, 84);
    ctx.fillStyle = "#ffdb8c"; ctx.beginPath(); ctx.arc(x + 118, y + 28, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#9abf9e"; ctx.beginPath(); ctx.moveTo(x + 10, y + 83); ctx.lineTo(x + 48, y + 44); ctx.lineTo(x + 76, y + 80); ctx.lineTo(x + 112, y + 51); ctx.lineTo(x + 150, y + 86); ctx.closePath(); ctx.fill();
    line(x + 81, y + 8, x + 81, y + 94, "#744f4a", 5); line(x + 8, y + 52, x + 154, y + 52, "#744f4a", 5);
  }
  function drawWallArt(x, y, room, floor) {
    const colors = ["#e59a73", "#e5c273", "#83a6c0", "#8db99e", "#ba8db6"];
    rr(x, y, 82, 63, 6, "#ead6b5", "#765444", 4); rr(x + 8, y + 8, 66, 47, 3, colors[(room + floor) % colors.length], null);
    line(x + 41, y + 9, x + 41, y + 54, "#f2dbad", 3);
  }
  function drawRoom(room) {
    const x = room * ROOM_W;
    const upper = ["#f0dfc4", "#f1d7b5", "#e6d6c0", "#ead8bb", "#e8d8c3"][room];
    const lower = ["#e6c794", "#e7c48f", "#e3c18f", "#e9c995", "#e1bd87"][room];
    ctx.fillStyle = upper; ctx.fillRect(x, 0, ROOM_W, 337);
    ctx.fillStyle = lower; ctx.fillRect(x, 347, ROOM_W, 263);
    for (let xx = x; xx < x + ROOM_W; xx += 96) {
      ctx.fillStyle = (Math.floor(xx / 96) % 2) ? "#fff5df13" : "#9d734d0d";
      ctx.fillRect(xx, 0, 7, 337); ctx.fillRect(xx, 347, 7, 263);
    }
    for (let yy = 38; yy < 330; yy += 54) for (let xx = x + 35; xx < x + ROOM_W; xx += 115) ellipse(xx, yy, 2, 2, "#a27e5c44");
    ctx.fillStyle = "#bd8d5c"; ctx.fillRect(x, 326, ROOM_W, 18); ctx.fillStyle = "#8a6349"; ctx.fillRect(x, 340, ROOM_W, 8);
    ctx.fillStyle = "#bd8d5c"; ctx.fillRect(x, 601, ROOM_W, 24); ctx.fillStyle = "#8a6046"; ctx.fillRect(x, 616, ROOM_W, 84);
    for (let xx = x; xx < x + ROOM_W; xx += 120) { line(xx, 626, xx, 700, "#936849", 3); line(xx + 8, 653, xx + 64, 653, "#a57853", 2); }
    for (let xx = x + 8; xx < x + ROOM_W; xx += 95) { line(xx, 348, xx, 596, "#d1a36f", 2); }
    for (let yy = 365; yy < 598; yy += 47) line(x, yy, x + ROOM_W, yy, "#cc9e68", 2);
    drawWindow(x + 90, 382, "#98d3dc"); drawWindow(x + 90, 54, "#a7cad9");
    drawWallArt(x + 386, 374, room, 0); drawWallArt(x + 386, 42, room, 1);
    ctx.fillStyle = "#704f3e"; ctx.font = "900 14px system-ui"; ctx.textAlign = "center";
    ctx.fillText(ROOM_NAMES[1][room].toUpperCase(), x + 600, 25);
    ctx.fillText(ROOM_NAMES[0][room].toUpperCase(), x + 600, 369);
    if (room > 0) {
      ctx.fillStyle = "#a67954"; ctx.fillRect(x, 328, 8, 282);
      ctx.fillStyle = "#fff1d1"; ctx.fillRect(x + 10, 328, 4, 282);
    }
  }
  function drawStairs() {
    STAIRS.forEach(s => {
      const low = s.lowerX, high = s.upperX;
      ctx.fillStyle = "#a46c47"; ctx.beginPath(); ctx.moveTo(low - 48, 602); ctx.lineTo(high - 44, 342); ctx.lineTo(high + 46, 342); ctx.lineTo(low + 45, 602); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#704835"; ctx.lineWidth = 5; ctx.stroke();
      for (let i = 0; i < 11; i++) {
        const x = low - 30 + i * ((high - low + 48) / 10), y = 586 - i * 23;
        line(x, y, x + 70, y, "#e4b579", 8); line(x, y + 5, x + 70, y + 5, "#80543d", 2);
      }
      line(low - 52, 604, low + 30, 604, "#d7ac75", 9); line(high - 25, 343, high + 58, 343, "#d7ac75", 9);
      ctx.fillStyle = "#75513d"; ctx.font = "900 12px system-ui"; ctx.textAlign = "center";
      ctx.fillText("↑ НАВЕРХ", low - 2, 512); ctx.fillText("↓ ВНИЗ", high + 8, 300);
    });
  }
  function drawHole(x) {
    ellipse(x, 608, 43, 17, "#8e674a"); ellipse(x, 612, 33, 13, "#493b3d"); ellipse(x, 615, 26, 9, "#171b29");
    ctx.fillStyle = "#fff1d1"; ctx.font = "900 12px system-ui"; ctx.textAlign = "center"; ctx.fillText("НОРКА", x, 579);
  }
  function drawFurniture() {
    furniture.forEach(o => {
      const y = FLOOR_Y[o.f], x = o.x;
      ellipse(x + o.w / 2, y + 2, o.w * .48, 6, "#3b354126");
      if (o.type === "sofa") {
        rr(x, y - 65, o.w, 56, 18, o.color, "#754c4b", 4); rr(x - 6, y - 42, o.w + 12, 36, 12, "#e48b69", "#754c4b", 4);
        rr(x + 12, y - 69, 64, 36, 11, "#efaa7b", null); rr(x + o.w - 76, y - 69, 64, 36, 11, "#efaa7b", null);
        line(x + 18, y - 10, x + 10, y + 1, "#684849", 9); line(x + o.w - 18, y - 10, x + o.w - 10, y + 1, "#684849", 9);
      } else if (o.type === "table") {
        rr(x, y - 48, o.w, 16, 7, o.color, "#704b3d", 4); line(x + 16, y - 31, x + 12, y + 1, "#704b3d", 9); line(x + o.w - 16, y - 31, x + o.w - 12, y + 1, "#704b3d", 9);
      } else if (o.type === "cabinet") {
        rr(x, y - o.h, o.w, o.h - 8, 10, o.color, "#654739", 4); line(x + o.w / 2, y - o.h + 9, x + o.w / 2, y - 13, "#d6ad77", 4);
        ellipse(x + o.w / 2 - 13, y - 68, 3, 3, "#ffdb8c"); ellipse(x + o.w / 2 + 13, y - 68, 3, 3, "#ffdb8c");
      } else if (o.type === "chair") {
        rr(x + 12, y - 76, o.w - 24, 47, 15, "#6a91ae", "#465c76", 4); rr(x, y - 36, o.w, 30, 13, "#7ca9c1", "#465c76", 4);
        line(x + 18, y - 6, x + 12, y + 2, "#465c76", 8); line(x + o.w - 18, y - 6, x + o.w - 12, y + 2, "#465c76", 8);
      } else if (o.type === "bed") {
        rr(x, y - 57, o.w, 52, 12, "#668cb4", "#465c76", 4); rr(x + 9, y - 76, o.w - 18, 27, 10, "#fbefd2", "#a4a09b", 3);
        rr(x + 12, y - 89, 56, 22, 8, "#efb5a4", null); line(x + 13, y - 4, x + 8, y + 2, "#465c76", 9);
      } else if (o.type === "bookcase") {
        rr(x, y - o.h, o.w, o.h, 8, o.color, "#654739", 4);
        for (let k = 0; k < 3; k++) { line(x + 8, y - o.h + 42 + k * 38, x + o.w - 8, y - o.h + 42 + k * 38, "#e5b67c", 4);
          for (let j = 0; j < 4; j++) rr(x + 10 + j * ((o.w - 38) / 4), y - o.h + 8 + k * 38, 16, 28, 2, ["#e38a69", "#87a6cf", "#e2c366", "#83b99b"][(j + k) % 4], null);
        }
      } else if (o.type === "desk") {
        rr(x, y - 50, o.w, 14, 6, o.color, "#704b3d", 4); rr(x + 8, y - 91, o.w - 16, 40, 6, "#d4b184", "#704b3d", 3);
        line(x + 12, y - 34, x + 10, y + 2, "#704b3d", 8); line(x + o.w - 12, y - 34, x + o.w - 10, y + 2, "#704b3d", 8);
      }
    });
  }
  function cacheScene() {
    const previous = ctx;
    // Reuse the drawing helpers on a wide offscreen canvas.
    sceneCtx.clearRect(0, 0, WORLD_W, VIEW_H);
    for (let room = 0; room < ROOM_COUNT; room++) drawRoomWith(sceneCtx, room);
    drawStairsWith(sceneCtx);
    drawFurnitureWith(sceneCtx);
    ctx = previous;
  }
  function drawRoomWith(target, room) {
    const previous = ctx; ctx = target; drawRoom(room); ctx = previous;
  }
  function drawStairsWith(target) { const previous = ctx; ctx = target; drawStairs(); ctx = previous; }
  function drawFurnitureWith(target) { const previous = ctx; ctx = target; drawFurniture(); ctx = previous; }

  function drawCheese(ch) {
    const y = floorY(ch.f) - 8; ctx.save(); ctx.translate(ch.x, y);
    ctx.fillStyle = "#ffd166"; ctx.strokeStyle = "#a86a38"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(19, -3); ctx.lineTo(-4, -28); ctx.closePath(); ctx.fill(); ctx.stroke();
    ellipse(-3, -12, 3.5, 3.5, "#d89539"); ellipse(6, -5, 2.5, 2.5, "#d89539"); ellipse(-9, -3, 2, 2, "#d89539"); ctx.restore();
  }
  function drawItem(item) {
    if (item.owner || item.inFlight) return;
    const y = floorY(item.f) - 13; ctx.save(); ctx.translate(item.x, y);
    if (item.id === "broom") { line(-19, 11, 10, -22, "#a67049", 7); line(-19, 10, -29, 18, "#6baa8b", 9); line(-19, 10, -6, 20, "#83c7a4", 5); }
    if (item.id === "pillow") { ctx.rotate(-.12); rr(-22, -13, 44, 27, 10, "#e293aa", "#8b5266", 3); line(-10, -9, 10, 9, "#ffd9df", 2); }
    if (item.id === "pan") { line(-5, -2, 16, 9, "#6b7184", 8); ellipse(-11, -8, 19, 14, "#56627d"); ellipse(-11, -10, 13, 9, "#bac8d0"); }
    ctx.fillStyle = "#fff1d1"; ctx.font = "bold 13px system-ui"; ctx.textAlign = "center"; ctx.fillText(item.name, 0, 35); ctx.restore();
  }
  function drawFallbackCharacter(c, y, t, frame) {
    const blink = frame === 2;
    if (c.role === "tom") {
      ellipse(-12, -10, 10, 10, "#8c95a9"); ellipse(13, -10, 10, 10, "#8c95a9"); ellipse(0, -66, 32, 34, "#68748a");
      ctx.fillStyle = "#68748a"; ctx.beginPath(); ctx.moveTo(-27, -79); ctx.lineTo(-31, -118); ctx.lineTo(-7, -93); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(7, -93); ctx.lineTo(31, -118); ctx.lineTo(27, -79); ctx.closePath(); ctx.fill();
      ellipse(-11, -68, 8, 11, "#fff1d5"); ellipse(11, -68, 8, 11, "#fff1d5");
      if (!blink) { ellipse(-10, -68, 3, 5, "#242b39"); ellipse(12, -68, 3, 5, "#242b39"); }
      ellipse(0, -52, 18, 12, "#eee0ca"); ellipse(0, -58, 6, 4, "#ef8e98");
    } else {
      ellipse(0, -28, 15, 22, "#b87948"); ellipse(0, -53, 22, 22, "#c88750");
      ellipse(-20, -72, 13, 16, "#bb7a48"); ellipse(20, -72, 13, 16, "#bb7a48"); ellipse(-20, -72, 7, 9, "#f0ac9d"); ellipse(20, -72, 7, 9, "#f0ac9d");
      ellipse(-8, -55, 6, 8, "#fff0d2"); ellipse(8, -55, 6, 8, "#fff0d2");
      if (!blink) { ellipse(-7, -54, 2.5, 4, "#2e3440"); ellipse(9, -54, 2.5, 4, "#2e3440"); }
      ellipse(0, -40, 14, 9, "#edc49b"); ellipse(0, -45, 4, 3, "#594342");
    }
    line(0, -20, 0, -2, c.role === "tom" ? "#68748a" : "#b87948", 7);
    line(-8, -4, -14, 0, "#eee0ca", 8); line(8, -4, 14, 0, "#eee0ca", 8);
    ctx.strokeStyle = c.role === "tom" ? "#68748a" : "#b87948"; ctx.lineWidth = c.role === "tom" ? 8 : 5; ctx.beginPath(); ctx.moveTo(-12, -25); ctx.quadraticCurveTo(-43, -32 + Math.sin(t * 5) * 8, -32, -5); ctx.stroke();
  }
  function drawCharacter(c) {
    if (!c) return;
    const t = state.elapsed, airborne = c.jump > 0 ? c.jump : 0;
    let baseY = floorY(c.f) - airborne;
    if (c.climb) {
      const cl = c.climb, p = cl.t / cl.duration;
      baseY = floorY(cl.fromFloor) + (floorY(cl.toFloor) - floorY(cl.fromFloor)) * p - Math.sin(p * Math.PI) * 8;
    }
    const atlas = sprites[c.role];
    let row = c.walking ? 3 : 0;
    if (c.climb) row = c.climb.toFloor > c.climb.fromFloor ? 4 : 5;
    else if (!c.walking && c.idleMode >= 0) row = c.idleMode;
    const frame = c.climb ? Math.floor(c.climbAnim * 1.4) % 4 : c.walking ? Math.floor(c.walkT * .65) % 4 : c.idleMode >= 0 ? Math.floor(c.idleT * 5) % 4 : Math.floor(t * 2.2) % 4;
    ctx.save(); ctx.translate(c.x, baseY); ellipse(0, 2, c.role === "tom" ? 38 : 26, 7, "#3b35414a");
    if (atlas?.bounds[row * 4 + frame]) {
      const b = atlas.bounds[row * 4 + frame], sh = shHeight(c);
      const sw = sh * b.w / b.h;
      ctx.save(); ctx.scale(c.facing || 1, 1);
      ctx.drawImage(atlas.img, b.x, b.y, b.w, b.h, -sw / 2, -sh, sw, sh);
      ctx.restore();
    } else {
      ctx.save(); ctx.scale(c.facing || 1, 1); drawFallbackCharacter(c, baseY, t, frame); ctx.restore();
    }
    if (c.weapon && c.swing > 0) {
      const angle = (1 - c.swing / .46) * 1.4 - .4; ctx.save(); ctx.rotate(angle * (c.facing || 1));
      if (c.weapon.id === "broom") { line(16, -47, 62, -82, "#a67049", 7); line(57, -87, 73, -77, "#6baa8b", 10); }
      else if (c.weapon.id === "pan") { line(17, -42, 45, -50, "#6b7184", 7); ellipse(54, -53, 15, 11, "#9ca7bf"); }
      else rr(29, -62, 37, 26, 9, "#e293aa", "#8b5266", 3);
      ctx.restore();
    }
    if (c.stun > 0) { ctx.fillStyle = "#ffd166"; ctx.font = "bold 22px system-ui"; ctx.textAlign = "center"; ctx.fillText("✦  ✦", 0, -shHeight(c) - 16 + Math.sin(t * 12) * 3); }
    ctx.restore();
  }
  function shHeight(c) { return c.role === "tom" ? 146 : 86; }
  function drawProjectiles() {
    projectiles.forEach(p => {
      ctx.save(); ctx.translate(p.x, floorY(p.f) - 87 - Math.sin(state.elapsed * 20) * 4); ctx.rotate(p.dir * .15);
      rr(-22, -14, 44, 28, 10, "#e293aa", "#8b5266", 3); line(-10, -10, 10, 10, "#ffd9df", 2); ctx.restore();
    });
  }
  function draw() {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    if (player && state.mode !== "menu") cameraX = clamp(player.x - VIEW_W * .39, 0, WORLD_W - VIEW_W);
    ctx.drawImage(scene, -cameraX, 0);
    ctx.save(); ctx.translate(-cameraX, 0);
    if (tom && jerry) drawHole(holeX);
    if (tom && jerry) {
      cheeses.forEach(ch => { if (!ch.taken) drawCheese(ch); }); items.forEach(drawItem); drawProjectiles();
      for (let i = 0; i < 8; i++) { const x = cameraX + (i * 167 + state.elapsed * 5) % VIEW_W, y = 75 + (i * 71) % 520 + Math.sin(state.elapsed + i) * 4; ellipse(x, y, 1.5, 1.5, "#fff7d966"); }
      if (player === tom) { drawCharacter(enemy); drawCharacter(player); } else { drawCharacter(enemy); drawCharacter(player); }
    }
    ctx.restore();
  }
  function loop(now) {
    const dt = Math.min(.034, (now - (state.last || now)) / 1000); state.last = now;
    update(dt); draw(); requestAnimationFrame(loop);
  }

  document.querySelectorAll(".role-card").forEach(btn => btn.addEventListener("click", () => {
    state.role = btn.dataset.role;
    document.querySelectorAll(".role-card").forEach(b => { const selected = b === btn; b.classList.toggle("selected", selected); b.setAttribute("aria-pressed", String(selected)); });
    $("startBtn").innerHTML = `Начать за ${state.role === "tom" ? "Тома" : "Джерри"} <span aria-hidden="true">→</span>`;
  }));
  $("startBtn").addEventListener("click", startGame);
  $("pauseBtn").addEventListener("click", togglePause);
  $("resumeBtn").addEventListener("click", togglePause);
  $("restartBtn").addEventListener("click", startGame);
  $("againBtn").addEventListener("click", playAgain);
  $("endMenuBtn").addEventListener("click", backToMenu);
  $("menuBtn").addEventListener("click", backToMenu);
  window.addEventListener("keydown", event => {
    const code = event.code;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(code)) event.preventDefault();
    if (event.repeat) return;
    if (code === "KeyP") { if (state.mode === "playing" || state.mode === "paused") togglePause(); return; }
    if (state.mode !== "playing") return;
    if (code === "KeyE" || code === "KeyF") { interact(); return; }
    if (code === "Space") { attack(player, enemy); return; }
    if (code === "ArrowUp" || code === "KeyW") { startClimb(player, 1); return; }
    if (code === "ArrowDown" || code === "KeyS") { startClimb(player, -1); return; }
    if (["ArrowLeft", "ArrowRight", "KeyA", "KeyD"].includes(code)) keys.add(code);
  });
  window.addEventListener("keyup", event => keys.delete(event.code));
  window.addEventListener("blur", () => { keys.clear(); touch.left = false; touch.right = false; });
  document.querySelectorAll("[data-hold]").forEach(button => {
    const key = button.dataset.hold; let pointerHandled = false;
    const down = event => {
      event.preventDefault(); pointerHandled = true;
      if (key === "left" || key === "right") {
        touch[key] = true;
        tapMove(key === "right" ? 1 : -1);
      }
      else if (state.mode === "playing") startClimb(player, key === "up" ? 1 : -1);
    };
    const up = event => { event.preventDefault(); if (key === "left" || key === "right") touch[key] = false; window.setTimeout(() => { pointerHandled = false; }, 0); };
    button.addEventListener("pointerdown", down); button.addEventListener("pointerup", up); button.addEventListener("pointercancel", up); button.addEventListener("pointerleave", up);
    button.addEventListener("click", () => {
      if (pointerHandled || state.mode !== "playing") return;
      if (key === "left" || key === "right") tapMove(key === "right" ? 1 : -1);
      else startClimb(player, key === "up" ? 1 : -1);
    });
  });
  document.querySelectorAll("[data-action]").forEach(button => {
    let pointerHandled = false;
    const act = () => { if (button.dataset.action === "interact") interact(); else attack(player, enemy); };
    button.addEventListener("pointerdown", event => { event.preventDefault(); pointerHandled = true; act(); });
    button.addEventListener("pointerup", () => window.setTimeout(() => { pointerHandled = false; }, 0));
    button.addEventListener("pointercancel", () => window.setTimeout(() => { pointerHandled = false; }, 0));
    button.addEventListener("click", () => { if (!pointerHandled) act(); });
  });

  buildFurniture();
  loadAtlas("tom", "./assets/tom-sheet.webp");
  loadAtlas("jerry", "./assets/jerry-sheet.webp");
  cacheScene();
  draw();
  requestAnimationFrame(loop);
})();
