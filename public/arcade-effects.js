/* Presentation only: these timers and poses never enter combat or rollback state. */
class ArcadeEffects {
  constructor({ enabled = true, reducedMotion = false, random = Math.random } = {}) {
    this.enabled = enabled;
    this.reducedMotion = reducedMotion;
    this.random = random;
    this.victoryBag = [];
    this.lastVictoryStyle = null;
    this.reset();
  }

  reset() {
    this.bursts = [];
    this.ribbons = [];
    this.confetti = [];
    this.freeze = null;
    this.ko = null;
    this.koKey = null;
    this.victory = null;
    this.shake = 0;
    this.clock = 0;
    this.hitCount = 0;
  }

  configure(enabled, reducedMotion) {
    const victory = this.victory, koKey = this.koKey;
    this.enabled = enabled;
    this.reducedMotion = reducedMotion;
    this.reset();
    // Changing motion preferences must not restart a KO or pick another dance.
    this.victory = victory;
    this.koKey = koKey;
  }

  copyPose(boxer) {
    return { ...boxer, bodyX: boxer.bodyX, bodyY: boxer.bodyY };
  }

  impact(fighters, defender, heavy, blocked) {
    if (!this.enabled) return;
    const text = blocked ? 'CLANG!' : heavy ? 'KAPOW!' : ['POW!', 'BAM!', 'THWACK!'][this.hitCount++ % 3];
    this.bursts.push({
      text, x: Math.max(110, Math.min(790, defender.x - defender.facing * 52)),
      y: Math.max(170, defender.bodyY - (blocked ? 105 : 160)),
      age: 0, duration: heavy ? 620 : 440, heavy, blocked,
      angle: defender.facing * .12
    });
    this.bursts = this.bursts.slice(-8);
    if (!this.reducedMotion) {
      this.freeze = { poses: fighters.map(b => this.copyPose(b)), age: 0, duration: blocked ? 32 : heavy ? 100 : 60 };
      this.shake = Math.max(this.shake, blocked ? 2 : heavy ? 8 : 4);
    }
  }

  combo(player, count) {
    if (!this.enabled || count < 3) return;
    this.ribbons = this.ribbons.filter(r => r.player !== player);
    this.ribbons.push({ player, count, age: 0, duration: 1150 });
  }

  observeKnockout(key, loser, fighters) {
    if (key === this.koKey) return;
    this.koKey = key;
    const winner = fighters.find(b => b.playerNum !== loser && b.state !== 'ko' && b.health > 0);
    this.victory = winner ? { player: winner.playerNum, style: this.nextVictoryStyle(), age: 0 } : null;
    if (!this.enabled) return;
    this.ko = { loser, poses: fighters.map(b => this.copyPose(b)), age: 0, celebrated: false };
    if (!this.reducedMotion) this.shake = 10;
  }

  nextVictoryStyle() {
    if (!this.victoryBag.length) this.victoryBag = ['salute', 'bounce', 'shuffle', 'pump', 'flex', 'bow'];
    const choices = this.victoryBag.filter(style => style !== this.lastVictoryStyle);
    const style = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
    this.victoryBag.splice(this.victoryBag.indexOf(style), 1);
    this.lastVictoryStyle = style;
    return style;
  }

  cancelKnockout() {
    this.ko = null;
    this.koKey = null;
    this.victory = null;
    this.confetti = [];
  }

  winnerPose(boxer) {
    const victory = this.victory;
    if (!victory || victory.age < 1750 || boxer.playerNum !== victory.player || boxer.state === 'ko' || boxer.health <= 0) return boxer;
    const still = !this.enabled || this.reducedMotion;
    const t = (victory.age - 1750) / 1000;
    const blend = still ? 1 : Math.min(1, t / .3);
    const ease = blend * blend * (3 - 2 * blend);
    const style = still ? 'salute' : victory.style;
    let lead = { x: 88, y: -140, elbowX: 58, elbowY: -95 };
    let rear = { x: -88, y: -140, elbowX: -58, elbowY: -95 };
    let jump = 0, sway = 0, step = 0, tilt = 0, nod = 0;
    switch (style) {
      case 'salute':
        if (!still) {
          lead.y += Math.sin(t * 5) * 5;
          rear.y -= Math.sin(t * 5) * 5;
          nod = Math.sin(t * 3) * 3;
        }
        break;
      case 'bounce':
        jump = Math.abs(Math.sin(t * Math.PI * 2)) * 23;
        lead.y = rear.y = -125 - jump * .3;
        nod = Math.sin(t * Math.PI * 2) * 4;
        break;
      case 'shuffle':
        sway = Math.sin(t * 7) * 16;
        step = Math.sin(t * 11) * 11;
        tilt = Math.sin(t * 7) * .035;
        lead = { x: 73, y: -77 + step, elbowX: 54, elbowY: -42 };
        rear = { x: -73, y: -77 - step, elbowX: -54, elbowY: -42 };
        nod = -Math.sin(t * 7) * 6;
        break;
      case 'pump': {
        const pump = (1 - Math.cos(t * 10)) / 2;
        lead = { x: 88, y: -105 - pump * 45, elbowX: 57, elbowY: -65 - pump * 20 };
        rear = { x: -43, y: -6, elbowX: -59, elbowY: -35 };
        nod = -pump * 5;
        break;
      }
      case 'flex': {
        const flex = Math.sin(t * 5) * 4;
        lead = { x: 83 + flex, y: -100, elbowX: 68, elbowY: -52 };
        rear = { x: -83 - flex, y: -100, elbowX: -68, elbowY: -52 };
        nod = -3;
        break;
      }
      case 'bow': {
        const bow = (1 - Math.cos(Math.min(t / 1.6, 1) * Math.PI * 2)) / 2;
        tilt = boxer.facing * bow * .2;
        lead = { x: 37, y: -37, elbowX: 57, elbowY: -19 };
        rear = { x: -47, y: -19, elbowX: -58, elbowY: -39 };
        nod = boxer.facing * bow * 12;
        break;
      }
    }
    const pose = this.copyPose(boxer);
    const mixArm = (target, start) => Object.fromEntries(Object.entries(target).map(([key, value]) => [key, start[key] + (value - start[key]) * ease]));
    pose.celebration = {
      style,
      lead: mixArm(lead, { x: 50, y: -78, elbowX: 35, elbowY: -60 }),
      rear: mixArm(rear, { x: 35, y: -35, elbowX: 20, elbowY: -33 }),
      rearShoulder: 10 + (-22 - 10) * ease,
      step: step * ease, tilt: tilt * ease,
      jump: jump * ease, groundY: boxer.y + 66
    };
    pose.state = 'celebrating';
    pose.vx = 0;
    pose.bodyX += (Math.max(115, Math.min(785, pose.bodyX + sway)) - pose.bodyX) * ease;
    pose.bodyY = boxer.y - jump * ease;
    pose.headY = 0;
    pose.headRot = nod * ease;
    pose.bodySquash = 1;
    pose.leadArmExtend = pose.rearArmExtend = 0;
    return pose;
  }

  celebrate() {
    if (!this.enabled || this.reducedMotion) return;
    const colors = ['#e7ad4d', '#f3e5c9', '#bb3d36', '#477694'];
    for (let i = 0; i < 100; i++) {
      const left = i % 2 === 0;
      this.confetti.push({
        x: left ? 75 : 825, y: 495,
        vx: (left ? 1 : -1) * (1 + this.random() * 5),
        vy: -7 - this.random() * 8,
        rotation: this.random() * Math.PI, spin: (this.random() - .5) * .3,
        width: 4 + this.random() * 7, age: 0, duration: 2100 + this.random() * 700,
        color: colors[i % colors.length]
      });
    }
    this.confetti = this.confetti.slice(-140);
  }

  update(milliseconds) {
    const ms = Math.max(0, Math.min(milliseconds, 50)), dt = ms / (1000 / 60);
    this.clock += ms;
    if (this.victory) this.victory.age += ms;
    this.shake *= Math.pow(.78, dt);
    for (const list of [this.bursts, this.ribbons]) {
      list.forEach(item => { item.age += ms; });
    }
    this.bursts = this.bursts.filter(b => b.age < b.duration);
    this.ribbons = this.ribbons.filter(r => r.age < r.duration);
    if (this.freeze) {
      this.freeze.age += ms;
      if (this.freeze.age >= this.freeze.duration) this.freeze = null;
    }
    if (this.ko) {
      this.ko.age += ms;
      if (this.ko.age >= 1350 && !this.ko.celebrated) {
        this.ko.celebrated = true;
        this.celebrate();
      }
      if (this.ko.age >= 1900) this.ko = null;
    }
    this.confetti.forEach(p => {
      p.age += ms; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += .19 * dt; p.rotation += p.spin * dt;
    });
    this.confetti = this.confetti.filter(p => p.age < p.duration && p.y < 620);
  }

  poses(fighters) {
    let poses = fighters;
    if (this.enabled && !this.reducedMotion && this.ko && this.ko.age < 1700) {
      // Slow the initial launch, then settle into the already-resolved KO pose.
      // Both peers keep simulating at 60 Hz; no input or health is rewound here.
      const age = Math.max(0, this.ko.age - 100);
      const frame = (Math.min(age, 800) * .35 + Math.max(0, age - 800) * 1.15) / (1000 / 60);
      poses = fighters.map((b, i) => {
        if (b.playerNum !== this.ko.loser) return this.ko.age < 150 ? this.ko.poses[i] : b;
        const pose = { ...this.ko.poses[i] };
        pose.koY = Math.max(-96, Math.min(120, -12 * frame + .25 * frame * (frame + 1)));
        pose.headY = pose.koY;
        pose.koRot = pose.headRot = pose.facing * -3 * frame;
        pose.bobTimer += frame;
        return pose;
      });
    } else if (this.enabled && !this.reducedMotion && this.freeze) poses = this.freeze.poses;
    if (this.victory && this.victory.age >= 1750) return poses.map(b => this.winnerPose(b));
    return poses;
  }

  camera() {
    if (!this.enabled || this.reducedMotion) return { x: 0, y: 0, zoom: 1 };
    const swell = this.ko ? Math.sin(Math.min(1, this.ko.age / 1700) * Math.PI) : 0;
    return {
      x: Math.sin(this.clock * .18) * this.shake,
      y: Math.cos(this.clock * .23) * this.shake * .55,
      zoom: 1 + swell * .035
    };
  }

  burstPath(c, x, y, radius, points = 12) {
    c.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = i * Math.PI / points, r = radius * (i % 2 ? .7 : 1);
      const px = x + Math.cos(angle) * r, py = y + Math.sin(angle) * r * .63;
      if (i) c.lineTo(px, py); else c.moveTo(px, py);
    }
    c.closePath();
  }

  drawBehind(c) {
    if (!this.enabled || this.reducedMotion || !this.ko || this.ko.age > 1250) return;
    const target = this.ko.poses.find(b => b.playerNum === this.ko.loser);
    c.save();
    c.globalAlpha = .28 * Math.min(1, this.ko.age / 100) * Math.min(1, (1250 - this.ko.age) / 350);
    c.strokeStyle = '#f3e5c9'; c.lineWidth = 3;
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12;
      const length = 250 + (i % 3) * 45;
      c.beginPath();
      c.moveTo(target.x + Math.cos(a) * length, 320 + Math.sin(a) * length * .65);
      c.lineTo(target.x + Math.cos(a) * (length + 85), 320 + Math.sin(a) * (length + 85) * .65);
      c.stroke();
    }
    c.restore();
  }

  drawForeground(c) {
    if (!this.enabled) return;
    for (const b of this.bursts) {
      const progress = b.age / b.duration;
      c.save(); c.translate(b.x, b.y - (this.reducedMotion ? 0 : progress * 20));
      c.rotate(this.reducedMotion ? 0 : b.angle);
      const pop = this.reducedMotion ? 1 : Math.min(1.12, .72 + progress * 4);
      c.scale(pop, pop); c.globalAlpha = Math.min(1, (1 - progress) * 3);
      this.burstPath(c, 0, 0, b.heavy ? 100 : 78);
      c.lineJoin = 'round'; c.lineWidth = 8; c.strokeStyle = '#f3e5c9'; c.stroke();
      c.fillStyle = b.blocked ? '#7aa0ad' : '#e7ad4d'; c.fill();
      c.lineWidth = 2; c.strokeStyle = '#142638'; c.stroke();
      c.font = `italic bold ${b.heavy ? 29 : 25}px Impact, Arial Black, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 4; c.strokeStyle = '#f3e5c9'; c.strokeText(b.text, 0, 2);
      c.fillStyle = '#142638'; c.fillText(b.text, 0, 2);
      c.restore();
    }
    for (const p of this.confetti) {
      c.save(); c.translate(p.x, p.y); c.rotate(p.rotation);
      c.globalAlpha = Math.min(1, (p.duration - p.age) / 500);
      c.fillStyle = p.color;
      c.fillRect(-p.width / 2, -2, p.width, 4 + Math.sin(p.rotation) * 2);
      c.restore();
    }
  }

  drawHud(c) {
    if (!this.enabled) return;
    for (const r of this.ribbons) {
      c.save(); c.translate(r.player === 1 ? 180 : 720, 142);
      c.rotate(this.reducedMotion ? 0 : r.player === 1 ? -.05 : .05);
      c.globalAlpha = Math.min(1, (r.duration - r.age) / 250);
      c.fillStyle = '#142638'; c.fillRect(-115, -23, 230, 48);
      c.strokeStyle = '#e7ad4d'; c.lineWidth = 2; c.strokeRect(-115, -23, 230, 48);
      c.font = 'bold 23px Impact, Arial Black, sans-serif'; c.textAlign = 'center';
      c.fillStyle = '#f3e5c9'; c.fillText(`${r.count} HIT COMBO`, 0, 0);
      c.font = 'bold 10px Courier New, monospace'; c.fillStyle = '#e7ad4d';
      c.fillText(r.count >= 5 ? 'ON FIRE!' : 'KEEP IT GOING!', 0, 16);
      c.restore();
    }
    if (this.ko && !this.reducedMotion && this.ko.age < 1100) {
      c.save(); c.globalAlpha = Math.min(1, (1100 - this.ko.age) / 250);
      c.fillStyle = '#142638'; c.fillRect(357, 510, 186, 26);
      c.fillStyle = '#e7ad4d'; c.textAlign = 'center';
      c.font = 'bold 12px Courier New, monospace'; c.fillText('THE KNOCKOUT MOMENT', 450, 528);
      c.restore();
    }
  }
}

if (typeof module !== 'undefined') module.exports = ArcadeEffects;
