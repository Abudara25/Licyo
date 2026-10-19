// Page « Erreur 403 » (functions/_shared/forbidden-page.js) : coup de sifflet sur le carton rouge, copie de l'e-mail du
// club et mini-jeu de jongles. Sons produits par le navigateur (Web Audio), aucune bibliothèque ni requête externe.
(function () {
  let audio = null;
  const ctxAudio = () => {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch {
      audio = null;
    }
    return audio;
  };
  const tone = (freq, start, duration, type = 'triangle', volume = 0.12) => {
    const a = ctxAudio();
    if (!a) return;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, a.currentTime + start);
    gain.gain.setValueAtTime(volume, a.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + duration);
    osc.connect(gain).connect(a.destination);
    osc.start(a.currentTime + start);
    osc.stop(a.currentTime + start + duration);
  };
  const whistle = () => {
    tone(2600, 0, 0.12);
    tone(2600, 0.16, 0.28);
  };
  const kick = () => tone(110, 0, 0.18, 'sine', 0.3);

  document.getElementById('err-card')?.addEventListener('click', whistle);

  document.querySelectorAll('.err-copy').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        const label = button.textContent;
        button.textContent = 'Copié';
        setTimeout(() => { button.textContent = label; }, 2000);
      } catch {
        // copie impossible : l'adresse reste affichée
      }
    });
  });

  const canvas = document.getElementById('err-canvas');
  if (!canvas) return;
  const g = canvas.getContext('2d');
  const scoreEl = document.getElementById('err-score');
  const bestEl = document.getElementById('err-best');
  const hint = document.getElementById('err-hint');
  const ball = { x: 0, y: 0, r: 20, vx: 0, vy: 0, rot: 0, spin: 0 };
  let width = 0;
  let height = 0;
  let playing = false;
  let score = 0;
  let best = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (!playing) rest();
  }
  function rest() {
    ball.x = width / 2;
    ball.y = height - ball.r - 8;
    ball.vx = ball.vy = ball.spin = 0;
  }
  function setScore(value) {
    score = value;
    scoreEl.textContent = String(score);
    if (score > best) {
      best = score;
      bestEl.textContent = String(best);
    }
  }
  function drawBall() {
    g.save();
    g.translate(ball.x, ball.y);
    g.rotate(ball.rot);
    g.beginPath();
    g.arc(0, 0, ball.r, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = '#4f1414';
    g.stroke();
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      const px = Math.cos(a) * ball.r * 0.42;
      const py = Math.sin(a) * ball.r * 0.42;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fillStyle = '#7a1f1f';
    g.fill();
    g.restore();
  }
  function frame() {
    g.clearRect(0, 0, width, height);
    g.strokeStyle = 'rgba(255,255,255,.45)';
    g.setLineDash([6, 6]);
    g.beginPath();
    g.moveTo(0, height - 6);
    g.lineTo(width, height - 6);
    g.stroke();
    g.setLineDash([]);
    if (playing) {
      ball.vy += 0.35;
      ball.x += ball.vx;
      ball.y += ball.vy;
      ball.rot += ball.spin;
      if (ball.x < ball.r || ball.x > width - ball.r) {
        ball.x = Math.min(Math.max(ball.x, ball.r), width - ball.r);
        ball.vx = -ball.vx * 0.7;
      }
      if (ball.y + ball.r >= height - 6) {
        playing = false;
        if (score > 1) whistle();
        setScore(0);
        rest();
        hint.style.opacity = '1';
      }
    }
    drawBall();
    requestAnimationFrame(frame);
  }
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const reach = ball.r + 28;
    if (!playing) {
      playing = true;
      hint.style.opacity = '0';
      ball.vy = -8.5;
      ball.vx = (Math.random() - 0.5) * 3;
      ball.spin = 0.08;
      setScore(1);
      kick();
    } else if (Math.hypot(x - ball.x, y - ball.y) <= reach) {
      const offset = (ball.x - x) / reach;
      ball.vy = -8.2 - Math.random() * 1.5;
      ball.vx = offset * 5;
      ball.spin = offset * 0.15;
      setScore(score + 1);
      kick();
    }
  });
  document.getElementById('err-reset')?.addEventListener('click', () => {
    playing = false;
    setScore(0);
    rest();
    hint.style.opacity = '1';
  });
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();
