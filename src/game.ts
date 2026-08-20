export type GameMode = 'title' | 'playing' | 'waveClear' | 'gameOver' | 'exitConfirm';

export type Shot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Alien = {
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
};

export type Barrier = {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Uint8Array;
};

export type GameState = {
  mode: GameMode;
  modeBeforeExitConfirm: GameMode;
  score: number;
  lives: number;
  wave: number;
  playerX: number;
  playerShots: Shot[];
  alienShots: Shot[];
  aliens: Alien[];
  barriers: Barrier[];
  alienDirection: -1 | 1;
  alienMoveClock: number;
  waveClearClock: number;
  rngSeed: number;
};

export const GAME_WIDTH = 256;
export const GAME_HEIGHT = 224;
export const PLAYER_Y = 204;

const PLAYER_WIDTH = 15;
const PLAYER_STEP = 9;
const PLAYER_SHOT_SPEED = 4.5;
const ALIEN_SHOT_SPEED = 3;
const ALIEN_ROWS = 5;
const ALIEN_COLUMNS = 9;
const ALIEN_WIDTH = 11;
const ALIEN_HEIGHT = 8;
const ALIEN_X_GAP = 15;
const ALIEN_Y_GAP = 14;
const ALIEN_START_X = 38;
const ALIEN_START_Y = 38;
const BUNKER_Y = 178;
const BARRIER_Y = 181;
const BARRIER_WIDTH = 22;
const BARRIER_HEIGHT = 9;
const BARRIER_X_POSITIONS = [38, 92, 146, 200];
const MAX_PLAYER_SHOTS = 1;
const MAX_ALIEN_SHOTS = 3;

export function createGameState(): GameState {
  return {
    mode: 'title',
    modeBeforeExitConfirm: 'title',
    score: 0,
    lives: 3,
    wave: 1,
    playerX: Math.floor((GAME_WIDTH - PLAYER_WIDTH) / 2),
    playerShots: [],
    alienShots: [],
    aliens: [],
    barriers: [],
    alienDirection: 1,
    alienMoveClock: 0,
    waveClearClock: 0,
    rngSeed: 0x5eed,
  };
}

export function openExitConfirm(state: GameState): void {
  if (state.mode === 'exitConfirm') return;
  state.modeBeforeExitConfirm = state.mode;
  state.mode = 'exitConfirm';
}

export function cancelExitConfirm(state: GameState): void {
  if (state.mode !== 'exitConfirm') return;
  state.mode = state.modeBeforeExitConfirm;
}

export function handleTap(state: GameState): void {
  if (state.mode === 'exitConfirm') return;

  if (state.mode === 'title' || state.mode === 'gameOver') {
    startNewGame(state);
    return;
  }

  if (state.mode === 'waveClear') {
    startWave(state);
    return;
  }

  firePlayerShot(state);
}

export function movePlayer(state: GameState, direction: -1 | 1): void {
  if (state.mode !== 'playing') return;
  state.playerX = clamp(state.playerX + direction * PLAYER_STEP, 4, GAME_WIDTH - PLAYER_WIDTH - 4);
}

export function tickGame(state: GameState): void {
  if (state.mode === 'waveClear') {
    state.waveClearClock--;
    if (state.waveClearClock <= 0) startWave(state);
    return;
  }

  if (state.mode !== 'playing') return;

  updatePlayerShots(state);
  updateAlienShots(state);
  updateAliens(state);
  maybeFireAlienShot(state);
  checkPlayerHits(state);
  if (state.mode !== 'playing') return;

  checkAlienLanding(state);
  if (state.mode !== 'playing') return;

  if (state.aliens.length === 0) {
    state.wave++;
    state.waveClearClock = 14;
    state.playerShots = [];
    state.alienShots = [];
    state.mode = 'waveClear';
  }
}

function startNewGame(state: GameState): void {
  state.score = 0;
  state.lives = 3;
  state.wave = 1;
  state.playerX = Math.floor((GAME_WIDTH - PLAYER_WIDTH) / 2);
  state.rngSeed = 0x5eed;
  startWave(state);
}

function startWave(state: GameState): void {
  state.mode = 'playing';
  state.playerShots = [];
  state.alienShots = [];
  state.alienDirection = 1;
  state.alienMoveClock = 0;
  state.aliens = [];
  state.barriers = createBarriers();

  for (let row = 0; row < ALIEN_ROWS; row++) {
    for (let column = 0; column < ALIEN_COLUMNS; column++) {
      state.aliens.push({
        x: ALIEN_START_X + column * ALIEN_X_GAP,
        y: ALIEN_START_Y + row * ALIEN_Y_GAP,
        width: ALIEN_WIDTH,
        height: ALIEN_HEIGHT,
        row,
      });
    }
  }
}

function firePlayerShot(state: GameState): void {
  if (state.playerShots.length >= MAX_PLAYER_SHOTS) return;
  state.playerShots.push({
    x: state.playerX + Math.floor(PLAYER_WIDTH / 2),
    y: PLAYER_Y - 6,
    width: 1,
    height: 6,
  });
}

function updatePlayerShots(state: GameState): void {
  const survivingShots: Shot[] = [];

  for (const shot of state.playerShots) {
    shot.y -= PLAYER_SHOT_SPEED;
    if (shot.y + shot.height < 0) continue;

    if (damageBarrierAtShot(state.barriers, shot, -1)) continue;

    const hitIndex = state.aliens.findIndex((alien) => overlaps(shot, alien));
    if (hitIndex >= 0) {
      const [alien] = state.aliens.splice(hitIndex, 1);
      state.score += (ALIEN_ROWS - alien.row) * 10;
      continue;
    }

    survivingShots.push(shot);
  }

  state.playerShots = survivingShots;
}

function updateAlienShots(state: GameState): void {
  const survivingShots: Shot[] = [];

  for (const shot of state.alienShots) {
    shot.y += ALIEN_SHOT_SPEED;
    if (shot.y >= GAME_HEIGHT) continue;
    if (damageBarrierAtShot(state.barriers, shot, 1)) continue;
    survivingShots.push(shot);
  }

  state.alienShots = survivingShots;
}

function updateAliens(state: GameState): void {
  const interval =
    Math.max(2, 8 - state.wave - Math.floor((ALIEN_ROWS * ALIEN_COLUMNS - state.aliens.length) / 8)) * 2;
  state.alienMoveClock++;
  if (state.alienMoveClock < interval) return;
  state.alienMoveClock = 0;

  const shouldDrop = state.aliens.some((alien) => {
    const nextX = alien.x + state.alienDirection * 4;
    return nextX < 8 || nextX + alien.width > GAME_WIDTH - 8;
  });

  if (shouldDrop) {
    state.alienDirection *= -1;
    for (const alien of state.aliens) alien.y += 8;
    return;
  }

  for (const alien of state.aliens) alien.x += state.alienDirection * 4;
}

function maybeFireAlienShot(state: GameState): void {
  if (state.alienShots.length >= MAX_ALIEN_SHOTS || state.aliens.length === 0) return;

  const oldTickFireChance = Math.min(62, 22 + state.wave * 5) / 100;
  const fireChance = 1 - Math.sqrt(1 - oldTickFireChance);
  if ((nextRandom(state) % 10_000) / 10_000 >= fireChance) return;

  const shooters = state.aliens.filter((alien) => {
    return !state.aliens.some((other) => other.x === alien.x && other.y > alien.y);
  });
  const shooter = shooters[nextRandom(state) % shooters.length];
  state.alienShots.push({
    x: shooter.x + Math.floor(shooter.width / 2),
    y: shooter.y + shooter.height,
    width: 1,
    height: 5,
  });
}

function checkPlayerHits(state: GameState): void {
  const playerBox = {
    x: state.playerX,
    y: PLAYER_Y,
    width: PLAYER_WIDTH,
    height: 8,
  };

  const hit = state.alienShots.some((shot) => overlaps(shot, playerBox));
  if (!hit) return;

  state.lives--;
  state.playerShots = [];
  state.alienShots = [];
  state.playerX = Math.floor((GAME_WIDTH - PLAYER_WIDTH) / 2);

  if (state.lives <= 0) {
    state.mode = 'gameOver';
    state.aliens = [];
  }
}

function checkAlienLanding(state: GameState): void {
  if (state.aliens.some((alien) => alien.y + alien.height >= BUNKER_Y)) {
    state.lives = 0;
    state.mode = 'gameOver';
    state.playerShots = [];
    state.alienShots = [];
    state.aliens = [];
  }
}

function createBarriers(): Barrier[] {
  return BARRIER_X_POSITIONS.map((x) => {
    const pixels = new Uint8Array(BARRIER_WIDTH * BARRIER_HEIGHT);

    for (let y = 0; y < BARRIER_HEIGHT; y++) {
      for (let x = 0; x < BARRIER_WIDTH; x++) {
        const hasRoundedTop = y >= 3 || (x >= 3 && x < BARRIER_WIDTH - 3);
        const isBottomNotch = y >= 6 && x >= 8 && x < 14;
        if (hasRoundedTop && !isBottomNotch) pixels[y * BARRIER_WIDTH + x] = 1;
      }
    }

    return { x, y: BARRIER_Y, width: BARRIER_WIDTH, height: BARRIER_HEIGHT, pixels };
  });
}

function damageBarrierAtShot(barriers: Barrier[], shot: Shot, direction: -1 | 1): boolean {
  for (const barrier of barriers) {
    if (!overlaps(shot, barrier)) continue;

    const minX = Math.max(shot.x, barrier.x);
    const maxX = Math.min(shot.x + shot.width - 1, barrier.x + barrier.width - 1);
    const minY = Math.max(shot.y, barrier.y);
    const maxY = Math.min(shot.y + shot.height - 1, barrier.y + barrier.height - 1);
    const startY = direction < 0 ? maxY : minY;
    const endY = direction < 0 ? minY : maxY;

    for (let y = startY; direction < 0 ? y >= endY : y <= endY; y += direction) {
      for (let x = minX; x <= maxX; x++) {
        const localX = x - barrier.x;
        const localY = y - barrier.y;
        if (barrier.pixels[localY * barrier.width + localX] === 0) continue;

        carveBarrierCrater(barrier, localX, localY, direction);
        return true;
      }
    }
  }

  return false;
}

function carveBarrierCrater(barrier: Barrier, impactX: number, impactY: number, direction: -1 | 1): void {
  // Arcade-style impacts make a narrow entry hole that fans out in the
  // projectile's direction, allowing later shots through the same opening.
  const rows = [
    { offset: -1, radius: 1 },
    { offset: 0, radius: 2 },
    { offset: 1, radius: 3 },
    { offset: 2, radius: 2 },
  ];

  for (const row of rows) {
    const y = impactY + row.offset * direction;
    if (y < 0 || y >= barrier.height) continue;

    for (let x = impactX - row.radius; x <= impactX + row.radius; x++) {
      if (x >= 0 && x < barrier.width) barrier.pixels[y * barrier.width + x] = 0;
    }
  }
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nextRandom(state: GameState): number {
  state.rngSeed = (state.rngSeed * 1664525 + 1013904223) >>> 0;
  return state.rngSeed;
}
