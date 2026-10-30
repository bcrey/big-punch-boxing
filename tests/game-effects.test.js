const test = require('node:test');
const assert = require('node:assert/strict');
const { gameFixture } = require('./game-fixture');

test('the full game renders both outfits and effects without changing online combat results', async t => {
  const f = await gameFixture(); t.after(() => f.dom.window.close());
  function fight(enabled) {
    f.eval(`p1.reset(); p2.reset(); p1.x = 360; p2.x = 470; p1.bobTimer = 0; p2.bobTimer = 0;
      netCountdown = 0; koWinner = 0; koTimer = 0; gameTime = 0;
      gameRunning = true; rng = new SeededRNG(42); Math.random = () => .5;
      arcade.configure(${enabled}, false); particles = [];`);
    for (let i = 0; i < 85; i++) f.eval(`simulateOneFrame(${i % 18 === 0 ? 16 : 0}, 0)`);
    return f.eval('JSON.stringify(saveGameState())');
  }
  const withEffects = fight(true);
  assert(f.eval('arcade.bursts.length') > 0);
  assert(f.eval('p2.health') < 100);
  f.eval('gameLoop(0); gameLoop(16.67);');
  assert(f.canvas('gameCanvas').toBuffer('image/png').length > 10000);
  assert.equal(fight(false), withEffects);
  f.eval('arcade.configure(true, false); suppressEffects = true; p1.punchLanded = false; p1.state = "jab"; p1.stateTimer = 3; p1.leadArmExtend = 1; checkHitsOnline(); suppressEffects = false;');
  assert.equal(f.eval('arcade.bursts.length'), 0, 'rollback resimulation must not duplicate impact effects');
});

test('local frame pacing stays consistent at 60 and 120 Hz and the FX toggle persists', async t => {
  const f = await gameFixture(); t.after(() => f.dom.window.close());
  function walk(frameCount, interval) {
    f.eval('gameRunning = true; countdownActive = false; netMode = "local"; koWinner = 0; p1.reset(); p2.reset(); p1.x = 100; p2.x = 800; keys.KeyD = true; lastTime = null; localAccumulator = 0;');
    for (let i = 0; i <= frameCount; i++) f.eval(`gameLoop(${i * interval});`);
    return f.eval('p1.x');
  }
  assert.equal(walk(30, 16.67), walk(60, 16.67 / 2));
  const button = f.window.document.getElementById('effectsToggle');
  button.click();
  assert.equal(f.window.localStorage.getItem('bamBamArcadeEffects'), 'false');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  button.click();
  f.media.matches = true; f.media.onchange();
  assert.equal(f.eval('arcade.reducedMotion'), true);
  assert.match(button.textContent, /Low motion/);
});

test('shirted rendering covers the torso in standing, punching, and knocked-out poses', async t => {
  const f = await gameFixture(); t.after(() => f.dom.window.close());
  f.eval('const outfitCanvas = document.createElement("canvas"); outfitCanvas.id = "outfitTest"; outfitCanvas.width = 220; outfitCanvas.height = 330; document.body.appendChild(outfitCanvas); const outfitContext = outfitCanvas.getContext("2d");');
  for (const state of ['idle', 'jab', 'ko']) {
    const render = style => {
      f.eval(`p1.x = 110; p1.y = 260; p1.bobTimer = 0; p1.state = '${state}'; p1.koY = ${state === 'ko' ? 120 : 0};
        outfitContext.clearRect(0, 0, 220, 330); PaperPunch.drawBoxer(outfitContext, p1, null, null, '${style}');`);
      return f.canvas('outfitTest').toBuffer('image/png');
    };
    assert.notDeepEqual(render('shirt'), render('classic'), state + ' must retain the outfit');
  }
});

test('online selections send the chosen outfit and accept legacy peers without one', async t => {
  const f = await gameFixture(); t.after(() => f.dom.window.close());
  const sent = [], handlers = {};
  f.window.testConnection = { open: true, send: data => sent.push(data), on: (event, fn) => { handlers[event] = fn; } };
  f.eval('dataConnection = testConnection; isHost = true; setupDataConnection();');
  handlers.open();
  assert.equal(sent.find(message => message.type === 'fighter-select').bodyStyle, 'shirt');
  handlers.data({ type: 'fighter-select', name: 'Opponent', imageData: null, bodyStyle: 'shirt' });
  assert.equal(f.eval('bodyStyles[2]'), 'shirt');
  handlers.data({ type: 'fighter-select', name: 'Legacy opponent', imageData: null });
  assert.equal(f.eval('bodyStyles[2]'), 'classic');
  await f.eval('selectFighter(1, "two")');
  assert.equal(sent.at(-1).bodyStyle, 'classic');
});

test('local and online KOs trigger winner celebrations and rollback cancellation clears them', async t => {
  const f = await gameFixture(); t.after(() => f.dom.window.close());
  for (const mode of ['local', 'online']) {
    f.eval(`p1.reset(); p2.reset(); p1.bobTimer = 0; p2.bobTimer = 0;
      p2.state = 'ko'; p2.health = 0; p2.koY = 120;
      netMode = '${mode}'; rollbackEngine = null; gameRunning = true;
      countdownActive = false; koWinner = 1; koTimer = 0;
      lastTime = null; localAccumulator = 0; arcade.reset();`);
    for (let i = 0; i < 150; i++) f.eval(`gameLoop(${i * 16.67});`);
    assert.equal(f.eval('arcade.poses([p1, p2])[0].state'), 'celebrating');
    assert.equal(f.eval('arcade.poses([p1, p2])[1].state'), 'ko');
    assert.equal(f.eval('p1.state'), 'idle', 'the drawing must not alter combat state');
    assert(f.canvas('gameCanvas').toBuffer('image/png').length > 10000);
    f.eval('koWinner = 0; p2.state = "idle"; p2.health = 100; gameLoop(2600);');
    assert.equal(f.eval('arcade.victory'), null, 'a corrected KO must not leave the winner dancing during the fight');
  }
});
