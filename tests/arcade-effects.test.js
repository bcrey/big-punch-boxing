const test = require('node:test');
const assert = require('node:assert/strict');
const ArcadeEffects = require('../public/arcade-effects');

const fighters = () => [1, 2].map(playerNum => ({
  playerNum, x: playerNum === 1 ? 350 : 490, y: 440, facing: playerNum === 1 ? 1 : -1,
  bodyX: playerNum === 1 ? 350 : 490, bodyY: 440, state: 'idle', health: 100,
  headY: 0, headRot: 0, koY: 0, koRot: 0, bobTimer: 0
}));
function advance(fx, ms) { while (ms > 0) { const step = Math.min(50, ms); fx.update(step); ms -= step; } }

test('hit-stop holds a drawing pose briefly while the actual fighter keeps moving', () => {
  const fx = new ArcadeEffects(), boxers = fighters();
  fx.impact(boxers, boxers[1], false, false);
  boxers[0].x += 20;
  assert.equal(fx.poses(boxers)[0].x, 350);
  advance(fx, 65);
  assert.equal(fx.poses(boxers)[0].x, 370);
  fx.impact(boxers, boxers[1], true, false);
  advance(fx, 70);
  assert(fx.freeze, 'heavy punches have a longer visual hold');
  advance(fx, 35);
  assert.equal(fx.freeze, null);
  fx.impact(boxers, boxers[1], false, true);
  assert.equal(fx.bursts.at(-1).text, 'CLANG!');
  assert.equal(boxers[1].health, 100);
});

test('KO slows only the drawing, celebrates once, then returns the loser to the real pose', () => {
  const fx = new ArcadeEffects({ random: () => .5 }), boxers = fighters();
  boxers[1].state = 'ko';
  fx.observeKnockout('1:1', 2, boxers);
  boxers[1].koY = boxers[1].headY = 120;
  const original = JSON.stringify(boxers);
  advance(fx, 600);
  assert(fx.poses(boxers)[1].headY < 0);
  assert(fx.camera().zoom > 1);
  assert.equal(JSON.stringify(boxers), original, 'visual slow motion cannot mutate physics');
  advance(fx, 750);
  assert.equal(fx.confetti.length, 100);
  fx.observeKnockout('1:1', 2, boxers);
  advance(fx, 400);
  assert.equal(fx.poses(boxers)[1], boxers[1]);
  assert.equal(fx.confetti.length, 100, 'rollback observations must not celebrate again');
  advance(fx, 3000);
  assert.equal(fx.confetti.length, 0);
  assert.equal(fx.ko, null);
});

test('reduced motion retains static feedback without shaking, freezing, zooming, or confetti', () => {
  const fx = new ArcadeEffects({ reducedMotion: true }), boxers = fighters();
  fx.impact(boxers, boxers[1], true, false);
  fx.combo(1, 5);
  fx.observeKnockout('1:1', 2, boxers);
  assert.equal(fx.poses(boxers), boxers);
  assert.deepEqual(fx.camera(), { x: 0, y: 0, zoom: 1 });
  assert.equal(fx.freeze, null);
  assert.equal(fx.ribbons[0].count, 5);
  advance(fx, 1400);
  assert.equal(fx.confetti.length, 0);
  fx.configure(false, false);
  fx.impact(boxers, boxers[1], true, false);
  fx.combo(1, 10);
  fx.observeKnockout('2:1', 2, boxers);
  assert.equal(fx.bursts.length, 0);
  assert.equal(fx.ribbons.length, 0);
  assert.equal(fx.ko, null);
});

test('effect counts stay bounded and resetting a round clears all pending visuals', () => {
  const fx = new ArcadeEffects(), boxers = fighters();
  for (let i = 0; i < 50; i++) {
    fx.impact(boxers, boxers[1], true, false);
    fx.combo(1, i);
    fx.celebrate();
  }
  assert.equal(fx.bursts.length, 8);
  assert.equal(fx.ribbons.length, 1);
  assert.equal(fx.confetti.length, 140);
  fx.reset();
  assert.equal(fx.bursts.length + fx.ribbons.length + fx.confetti.length, 0);
  assert.equal(fx.koKey, null);
  assert.equal(fx.freeze, null);
});

test('each six-win cycle uses every celebration once without adjacent repeats', () => {
  const fx = new ArcadeEffects({ random: () => .5 }), boxers = fighters();
  boxers[1].state = 'ko'; boxers[1].health = 0;
  const styles = [];
  for (let i = 0; i < 18; i++) {
    fx.reset();
    fx.observeKnockout('round:' + i, 2, boxers);
    const victory = fx.victory;
    fx.observeKnockout('round:' + i, 2, boxers);
    assert.equal(fx.victory, victory, 'repeated KO observations must not restart or change the celebration');
    styles.push(victory.style);
    if (i) assert.notEqual(styles[i], styles[i - 1]);
  }
  for (let i = 0; i < styles.length; i += 6) assert.equal(new Set(styles.slice(i, i + 6)).size, 6);
});

test('celebrations animate only the winner, keep fighters inside the ring, and leave combat untouched', () => {
  for (const player of [1, 2]) {
    for (const style of ['salute', 'bounce', 'shuffle', 'pump', 'flex', 'bow']) {
      const fx = new ArcadeEffects(), boxers = fighters(), winner = boxers[player - 1], loser = boxers[2 - player];
      winner.bodyX = winner.x = player === 1 ? 80 : 820;
      loser.state = 'ko'; loser.health = 0;
      fx.observeKnockout('one', loser.playerNum, boxers);
      fx.victory.style = style;
      advance(fx, 1700);
      assert.equal(fx.poses(boxers)[player - 1].celebration, undefined, 'wait for the KO to land');
      const before = JSON.stringify(boxers);
      advance(fx, 800);
      const pose = fx.poses(boxers)[player - 1];
      assert.equal(pose.celebration.style, style);
      assert.equal(pose.state, 'celebrating');
      assert(pose.bodyX >= 115 && pose.bodyX <= 785);
      assert.equal(fx.poses(boxers)[2 - player], loser);
      advance(fx, 150);
      assert.notDeepEqual(fx.poses(boxers)[player - 1].celebration, pose.celebration, style + ' animates over time');
      assert.equal(JSON.stringify(boxers), before);
      fx.reset();
      assert.equal(fx.poses(boxers), boxers, 'new rounds return to combat poses');
    }
  }
});

test('motion preferences use a still victory pose without restarting the celebration', () => {
  const fx = new ArcadeEffects(), boxers = fighters();
  boxers[1].state = 'ko'; boxers[1].health = 0;
  fx.observeKnockout('one', 2, boxers);
  advance(fx, 2200);
  const victory = fx.victory;
  for (const [enabled, reduced] of [[true, true], [false, false]]) {
    fx.configure(enabled, reduced);
    fx.observeKnockout('one', 2, boxers);
    assert.equal(fx.victory, victory);
    const pose = fx.poses(boxers)[0];
    assert.equal(pose.celebration.style, 'salute');
    assert.equal(pose.celebration.jump, 0);
    assert.equal(pose.celebration.tilt, 0);
    advance(fx, 350);
    assert.deepEqual(fx.poses(boxers)[0], pose);
  }
  fx.cancelKnockout();
  assert.equal(fx.victory, null);
  assert.equal(fx.poses(boxers), boxers);
});
