(() => {
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");

  const scoreL = document.getElementById("scoreL");
  const scoreR = document.getElementById("scoreR");
  const toast = document.getElementById("toast");

  // -------------------------
  // Helpers
  // -------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const now = () => performance.now();

  // Simple “screen shake”
  let shake = 0;
  function addShake(amount) { shake = Math.max(shake, amount); }

  function showToast(text, ms = 900) {
    toast.textContent = text;
    toast.classList.remove("hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.add("hidden"), ms);
  }

  // -------------------------
  // World & tuning
  // -------------------------
  const W = canvas.width;
  const H = canvas.height;

  const floorY = H - 90;
  const netX = W / 2;
  const netTop = floorY - 160;

  const gravity = 2200;          // px/s^2
  const airDrag = 0.999;         // mild
  const bounce = 0.70;           // ground bounce
  const wallBounce = 0.85;       // side walls
  const ballRadius = 18;

  const maxScore = 11;

  // “Feel” parameters
  const hitBoost = 820;          // how hard Space hits the ball
  const jumpVel = 880;
  const moveAccel = 3200;
  const moveFriction = 0.88;
  const maxMoveSpeed = 520;

  // -------------------------
  // Input
  // -------------------------
  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code)) e.preventDefault();
    if (e.code === "KeyR") resetMatch();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));

  // -------------------------
  // Particles for feedback
  // -------------------------
  const particles = [];
  function spawnBurst(x, y, n, speed, life, hueBias = 0) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(speed * 0.4, speed);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(life * 0.6, life),
        maxLife: life,
        r: rand(1.5, 3.6),
        hue: (190 + hueBias + rand(-20, 20)) % 360,
      });
    }
  }

  // -------------------------
  // Entities
  // -------------------------
  function makePlayer(side /* -1 left, +1 right */) {
    const isLeft = side < 0;
    return {
      side,
      x: isLeft ? W * 0.25 : W * 0.75,
      y: floorY,
      vx: 0,
      vy: 0,
      r: 34,
      onGround: true,
      colorA: isLeft ? "#66e3ff" : "#a78bfa",
      colorB: isLeft ? "rgba(102,227,255,.18)" : "rgba(167,139,250,.18)",
      canBoost: true,
      boostCD: 0,
    };
  }

  const you = makePlayer(-1);
  const ai  = makePlayer(+1);

  const ball = {
    x: W * 0.35,
    y: floorY - 220,
    vx: 380,
    vy: -300,
    r: ballRadius,
    spin: 0,
    lastTouch: null, // "you" / "ai"
  };

  // Net is a collision segment/rectangle
  const net = {
    x: netX,
    top: netTop,
    bottom: floorY,
    w: 10
  };

  // Scores
  let L = 0, R = 0;
  let gameOver = false;

  // Serve state
  let serving = true;
  let serveTo = "you"; // who receives next
  let serveTimer = 0;

  // -------------------------
  // Collision: circle vs circle (ball vs player)
  // Adds satisfying “hit” feel + particles + shake
  // -------------------------
  function collideBallWithPlayer(p, tag) {
    const dx = ball.x - p.x;
    const dy = ball.y - (p.y - p.r * 0.35);
    const dist = Math.hypot(dx, dy);
    const minDist = ball.r + p.r * 0.85;

    if (dist < minDist && dist > 0.0001) {
      // Push ball out
      const nx = dx / dist;
      const ny = dy / dist;

      const overlap = (minDist - dist);
      ball.x += nx * overlap;
      ball.y += ny * overlap;

      // Relative velocity
      const rvx = ball.vx - p.vx;
      const rvy = ball.vy - p.vy;

      // Impulse (simple)
      const sepVel = rvx * nx + rvy * ny;
      const desired = Math.max(520, -sepVel + 520);

      ball.vx += nx * desired;
      ball.vy += ny * desired;

      // A little “lift” so it feels like volleyball
      ball.vy -= 220;

      // Spin just for fun curve-ish effect
      ball.spin = clamp(ball.spin + nx * 0.8, -3, 3);

      // Record last touch
      ball.lastTouch = tag;

      // Feedback
      addShake(10);
      spawnBurst(ball.x, ball.y, 18, 240, 0.45, tag === "you" ? 0 : 70);
    }
  }

  // -------------------------
  // Player controls
  // -------------------------
  function updateYou(dt) {
    // Horizontal input
    let ax = 0;
    if (keys.has("KeyA")) ax -= moveAccel;
    if (keys.has("KeyD")) ax += moveAccel;

    you.vx += ax * dt;
    you.vx *= Math.pow(moveFriction, dt * 60);

    you.vx = clamp(you.vx, -maxMoveSpeed, maxMoveSpeed);

    you.x += you.vx * dt;

    // Keep on left side
    you.x = clamp(you.x, 50, netX - 60);

    // Jump
    if (keys.has("KeyW") && you.onGround) {
      you.vy = -jumpVel;
      you.onGround = false;
      addShake(4);
      spawnBurst(you.x, you.y - 8, 14, 200, 0.35, 0);
    }

    // Gravity
    you.vy += gravity * dt;
    you.y += you.vy * dt;

    // Floor
    if (you.y >= floorY) {
      you.y = floorY;
      you.vy = 0;
      you.onGround = true;
      you.canBoost = true;
    }

    // Boost/spike
    if (you.boostCD > 0) you.boostCD -= dt;
    const wantsBoost = keys.has("Space");
    if (wantsBoost && you.canBoost && you.boostCD <= 0) {
      // Only boost if you're close enough to the ball, to feel intentional.
      const d = Math.hypot(ball.x - you.x, ball.y - (you.y - 40));
      if (d < 150) {
        // Push ball away from you and slightly downward/upward depending on position
        const dx = ball.x - you.x;
        const dy = ball.y - (you.y - 40);
        const len = Math.max(1, Math.hypot(dx, dy));
        const nx = dx / len;
        const ny = dy / len;

        ball.vx += nx * hitBoost;
        ball.vy += ny * hitBoost;
        ball.vy -= 260; // extra “pop”
        ball.lastTouch = "you";

        addShake(14);
        spawnBurst(ball.x, ball.y, 26, 320, 0.55, 0);
        you.canBoost = false;
        you.boostCD = 0.18;
      } else {
        // small “whoosh” feedback anyway
        you.canBoost = false;
        you.boostCD = 0.18;
      }
    }
  }

  // -------------------------
  // Basic AI (good enough to feel alive)
  // It:
  // - predicts where the ball will land (rough)
  // - moves there with reaction delay
  // - jumps/returns when close
  // -------------------------
  const aiBrain = {
    targetX: ai.x,
    react: 0,
    lastPlan: 0,
  };

  function predictLandingX() {
    // Predict where ball will cross AI side near floor using a simple simulation.
    // We only do a few steps and stop when reaching floorY.
    let x = ball.x, y = ball.y, vx = ball.vx, vy = ball.vy;
    const steps = 120;
    const stepDt = 1 / 180;

    for (let i = 0; i < steps; i++) {
      vy += gravity * stepDt;
      x += vx * stepDt;
      y += vy * stepDt;

      // walls
      if (x < 20 + ball.r) { x = 20 + ball.r; vx = -vx * wallBounce; }
      if (x > W - 20 - ball.r) { x = W - 20 - ball.r; vx = -vx * wallBounce; }

      // net (approx)
      if (x > netX - net.w && x < netX + net.w && y > netTop - ball.r && y < floorY) {
        vx = -vx * 0.85;
        x += vx * stepDt;
      }

      if (y >= floorY - ball.r) return x;
    }
    return x;
  }

  function updateAI(dt) {
    // Plan occasionally (reaction time)
    aiBrain.react -= dt;
    if (aiBrain.react <= 0) {
      aiBrain.react = rand(0.08, 0.16); // reaction delay
      aiBrain.targetX = clamp(predictLandingX(), netX + 70, W - 70);
    }

    // Move toward target
    const dx = aiBrain.targetX - ai.x;
    const desired = clamp(dx * 4.2, -maxMoveSpeed * 0.92, maxMoveSpeed * 0.92);
    ai.vx = lerp(ai.vx, desired, 1 - Math.pow(0.0005, dt));
    ai.x += ai.vx * dt;
    ai.x = clamp(ai.x, netX + 60, W - 50);

    // Jump logic: if ball is on AI side and coming down near AI
    const ballOnAI = ball.x > netX + 10;
    const nearX = Math.abs(ball.x - ai.x) < 105;
    const comingDown = ball.vy > 120;
    const aboveNet = ball.y < netTop + 50;

    // Return logic: jump when needed
    if (ai.onGround && ballOnAI && nearX && (comingDown || aboveNet) && ball.y < floorY - 70) {
      ai.vy = -jumpVel * rand(0.85, 1.0);
      ai.onGround = false;
      ai.canBoost = true;
      spawnBurst(ai.x, ai.y - 8, 12, 190, 0.35, 70);
    }

    // Gravity
    ai.vy += gravity * dt;
    ai.y += ai.vy * dt;

    if (ai.y >= floorY) {
      ai.y = floorY;
      ai.vy = 0;
      ai.onGround = true;
      ai.canBoost = true;
    }

    // AI “hit”: if close enough, give ball a controlled upward/left push
    const d = Math.hypot(ball.x - ai.x, ball.y - (ai.y - 40));
    if (ballOnAI && d < 140 && ai.canBoost) {
      // Aim back to player side: set a target direction
      const aimX = rand(netX - 260, netX - 60);
      const aimY = rand(floorY - 280, floorY - 160);

      const ax = aimX - ball.x;
      const ay = aimY - ball.y;
      const len = Math.max(1, Math.hypot(ax, ay));
      const nx = ax / len;
      const ny = ay / len;

      const power = rand(780, 980);

      ball.vx += nx * power;
      ball.vy += ny * power;
      ball.vy -= 220;
      ball.lastTouch = "ai";

      addShake(9);
      spawnBurst(ball.x, ball.y, 22, 280, 0.50, 70);
      ai.canBoost = false;
    }
  }

  // -------------------------
  // Ball physics + net + boundaries
  // -------------------------
  function updateBall(dt) {
    // Spin creates a tiny sideways force (feels “alive”)
    ball.vx += ball.spin * 25;
    ball.spin *= 0.985;

    ball.vy += gravity * dt;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    ball.vx *= Math.pow(airDrag, dt * 60);

    // Side walls
    const leftWall = 20 + ball.r;
    const rightWall = W - 20 - ball.r;
    if (ball.x < leftWall) {
      ball.x = leftWall;
      ball.vx = -ball.vx * wallBounce;
      addShake(4);
      spawnBurst(ball.x, ball.y, 10, 170, 0.28, 10);
    }
    if (ball.x > rightWall) {
      ball.x = rightWall;
      ball.vx = -ball.vx * wallBounce;
      addShake(4);
      spawnBurst(ball.x, ball.y, 10, 170, 0.28, 10);
    }

    // Net collision (rectangle)
    const nx0 = net.x - net.w;
    const nx1 = net.x + net.w;
    if (ball.x > nx0 - ball.r && ball.x < nx1 + ball.r && ball.y > net.top - ball.r && ball.y < net.bottom) {
      // Determine which side we hit
      if (ball.x < net.x) {
        ball.x = nx0 - ball.r;
        ball.vx = -Math.abs(ball.vx) * 0.86;
      } else {
        ball.x = nx1 + ball.r;
        ball.vx = Math.abs(ball.vx) * 0.86;
      }
      ball.vy *= 0.92;
      addShake(8);
      spawnBurst(ball.x, ball.y, 16, 240, 0.40, 25);
    }

    // Floor
    if (ball.y > floorY - ball.r) {
      ball.y = floorY - ball.r;
      ball.vy = -ball.vy * bounce;

      // A little energy loss
      ball.vx *= 0.92;

      // If it’s barely bouncing, settle
      if (Math.abs(ball.vy) < 160) ball.vy = 0;

      spawnBurst(ball.x, floorY - ball.r, 14, 220, 0.45, 15);
      addShake(6);

      // Point scored if ball hits floor on a side
      if (!gameOver && !serving) {
        const leftSide = ball.x < netX;
        if (leftSide) {
          // ball landed on your side => AI scores
          R++;
          scoreR.textContent = R;
          showToast("AI scores!");
          startServe("you");
        } else {
          L++;
          scoreL.textContent = L;
          showToast("You score!");
          startServe("ai");
        }
        checkGameOver();
      }
    }
  }

  // -------------------------
  // Serving / reset points
  // -------------------------
  function startServe(receiver) {
    serving = true;
    serveTo = receiver;
    serveTimer = 0.8; // small delay

    // Place ball nicely
    if (receiver === "you") {
      ball.x = W * 0.32;
      ball.y = floorY - 240;
      ball.vx = 0;
      ball.vy = 0;
    } else {
      ball.x = W * 0.68;
      ball.y = floorY - 240;
      ball.vx = 0;
      ball.vy = 0;
    }

    you.x = W * 0.25; you.vx = 0; you.vy = 0; you.y = floorY; you.onGround = true; you.canBoost = true;
    ai.x = W * 0.75;  ai.vx = 0;  ai.vy = 0;  ai.y = floorY;  ai.onGround = true; ai.canBoost = true;

    ball.lastTouch = null;
    ball.spin = 0;
  }

  function doServeIfReady(dt) {
    if (!serving) return;

    serveTimer -= dt;
    if (serveTimer > 0) return;

    // Serve becomes active now
    serving = false;

    // Gentle serve toward receiver
    const dir = (serveTo === "you") ? -1 : +1;
    ball.vx = dir * rand(280, 380);
    ball.vy = rand(-620, -520);

    spawnBurst(ball.x, ball.y, 18, 220, 0.45, 30);
    showToast("Serve!");
  }

  function checkGameOver() {
    if (L >= maxScore || R >= maxScore) {
      gameOver = true;
      showToast(L > R ? "You win! Press R to restart" : "AI wins! Press R to restart", 2200);
    }
  }

  function resetMatch() {
    L = 0; R = 0;
    scoreL.textContent = "0";
    scoreR.textContent = "0";
    gameOver = false;
    startServe("you");
    showToast("New match!");
  }

  // Start
  startServe("you");

  // -------------------------
  // Rendering (pretty!)
  // -------------------------
  function drawBackground(t) {
    // Sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(255,255,255,0.04)");
    g.addColorStop(1, "rgba(255,255,255,0.01)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Soft glowing orbs
    function orb(x, y, r, a) {
      const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
      gg.addColorStop(0, `rgba(102,227,255,${a})`);
      gg.addColorStop(1, "rgba(102,227,255,0)");
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    orb(W * 0.18, H * 0.18, 160, 0.10);
    orb(W * 0.78, H * 0.22, 220, 0.08);

    // Court base glow
    const courtGlow = ctx.createLinearGradient(0, floorY - 40, 0, floorY + 140);
    courtGlow.addColorStop(0, "rgba(102,227,255,0.05)");
    courtGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = courtGlow;
    ctx.fillRect(0, floorY - 40, W, 220);

    // Distant stripes
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const y = 80 + i * 40 + Math.sin(t * 0.001 + i) * 6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawCourt() {
    // Floor
    const g = ctx.createLinearGradient(0, floorY, 0, H);
    g.addColorStop(0, "rgba(255,255,255,0.06)");
    g.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = g;
    ctx.fillRect(0, floorY, W, H - floorY);

    // Court lines
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(70, floorY);
    ctx.lineTo(W - 70, floorY);
    ctx.stroke();

    // Center line glow
    ctx.strokeStyle = "rgba(102,227,255,0.10)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(netX, floorY);
    ctx.lineTo(netX, floorY - 1);
    ctx.stroke();

    // Net
    // Posts
    ctx.fillStyle = "rgba(255,255,255,0.20)";
    ctx.fillRect(netX - 6, netTop - 6, 12, floorY - netTop + 12);

    // Net mesh
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(netX - net.w, netTop, net.w * 2, floorY - netTop);

    // Mesh lines
    ctx.strokeStyle = "rgba(255,255,255,0.11)";
    ctx.lineWidth = 1;
    for (let y = netTop; y <= floorY; y += 16) {
      ctx.beginPath();
      ctx.moveTo(netX - net.w, y);
      ctx.lineTo(netX + net.w, y);
      ctx.stroke();
    }
  }

  function drawPlayer(p, name) {
    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(p.x, floorY + 18, p.r * 0.95, p.r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body glow
    const gx = ctx.createRadialGradient(p.x - 12, p.y - 70, 5, p.x, p.y - 70, 95);
    gx.addColorStop(0, "rgba(255,255,255,0.22)");
    gx.addColorStop(1, p.colorB);
    ctx.fillStyle = gx;

    // Body circle
    ctx.beginPath();
    ctx.arc(p.x, p.y - 62, p.r, 0, Math.PI * 2);
    ctx.fill();

    // Outline
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Face / visor
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(p.x + p.side * 7, p.y - 70, 16, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Accent stripe
    ctx.strokeStyle = p.colorA;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y - 62, p.r - 10, -0.8, 0.6);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Name tag
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    const label = name;
    ctx.font = "700 12px ui-sans-serif, system-ui";
    const tw = ctx.measureText(label).width;
    const bx = p.x - tw / 2 - 10;
    const by = p.y - 128;
    ctx.beginPath();
    roundRect(bx, by, tw + 20, 22, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.90)";
    ctx.fillText(label, p.x - tw / 2, by + 15);
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
  }

  function drawBall() {
    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.24)";
    ctx.beginPath();
    ctx.ellipse(ball.x, floorY + 12, ball.r * 0.9, ball.r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ball gradient
    const g = ctx.createRadialGradient(ball.x - 6, ball.y - 8, 3, ball.x, ball.y, ball.r * 1.4);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.35, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(102,227,255,0.10)");

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();

    // Ball seams
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r - 3, -0.6, 1.6);
    ctx.stroke();

    ctx.strokeStyle = "rgba(167,139,250,0.30)";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r - 6, 1.9, 3.6);
    ctx.stroke();
  }

  function drawParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }

      p.vx *= 0.985;
      p.vy *= 0.985;
      p.vy += 900 * dt;

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const a = clamp(p.life / p.maxLife, 0, 1);

      ctx.globalAlpha = a;
      ctx.fillStyle = `hsla(${p.hue}, 95%, 70%, ${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // -------------------------
  // Main loop
  // -------------------------
  let last = now();
  function frame() {
    const t = now();
    const dt = Math.min(0.02, (t - last) / 1000);
    last = t;

    // Update
    if (!gameOver) {
      doServeIfReady(dt);
      updateYou(dt);
      updateAI(dt);

      // Player collisions
      collideBallWithPlayer(you, "you");
      collideBallWithPlayer(ai, "ai");

      updateBall(dt);
    }

    // Render (with screenshake)
    const s = shake;
    shake = Math.max(0, shake - dt * 30);
    const sx = (Math.random() - 0.5) * s;
    const sy = (Math.random() - 0.5) * s;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(sx, sy);

    drawBackground(t);
    drawCourt();
    drawParticles(dt);
    drawPlayer(you, "YOU");
    drawPlayer(ai, "AI");
    drawBall();

    // Mini hint text
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = "600 12px ui-sans-serif, system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    const hint = gameOver ? "Press R to restart" : "A/D move • W jump • Space hit";
    ctx.fillText(hint, 22, H - 16);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
