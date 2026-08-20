import { GAME_HEIGHT, GAME_WIDTH, PLAYER_Y, type Barrier, type GameState, type Shot } from './game';

export const IMAGE_WIDTH = 256;
export const IMAGE_HEIGHT = 144;
export const HUD_IMAGE_HEIGHT = 24;
const GAMEPLAY_TOP = 19;
const GAMEPLAY_HEIGHT = GAME_HEIGHT - GAMEPLAY_TOP;
export const FRAMEBUFFER_SIZE = GAME_WIDTH * GAME_HEIGHT;
export const PACKED_FRAME_SIZE = (IMAGE_WIDTH * IMAGE_HEIGHT) / 2;
const HUD_FRAMEBUFFER_SIZE = IMAGE_WIDTH * HUD_IMAGE_HEIGHT;
const HUD_PACKED_FRAME_SIZE = HUD_FRAMEBUFFER_SIZE / 2;
const BMP_HEADER_SIZE = 62;

export type RenderBuffers = {
  logical: Uint8Array;
  packed: Uint8Array;
};

const PLAYER_SPRITE = ['0001000', '0011100', '0111110', '1111111', '1111111'];
const ALIEN_SPRITES = [
  ['001100', '011110', '110011', '111111', '101101', '010010'],
  ['010010', '111111', '101101', '111111', '011110', '100001'],
  ['001100', '011110', '111111', '101101', '111111', '010010'],
];
const SHIP_SPRITE = ['00111100', '01111110', '11011011', '11111111'];

const FONT: Record<string, string[]> = {
  ' ': ['000', '000', '000', '000', '000'],
  ':': ['0', '1', '0', '1', '0'],
  '|': ['1', '1', '1', '1', '1'],
  '?': ['111', '001', '011', '000', '010'],
  '=': ['000', '111', '000', '111', '000'],
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['111', '100', '100', '100', '111'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['111', '100', '101', '101', '111'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '111'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['101', '111', '111', '111', '101'],
  O: ['111', '101', '101', '101', '111'],
  P: ['111', '101', '111', '100', '100'],
  Q: ['111', '101', '101', '111', '001'],
  R: ['110', '101', '110', '101', '101'],
  S: ['111', '100', '111', '001', '111'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
};

export function createRenderBuffers(): RenderBuffers {
  return {
    logical: new Uint8Array(FRAMEBUFFER_SIZE),
    packed: new Uint8Array(PACKED_FRAME_SIZE),
  };
}

export function createHudRenderBuffers(): RenderBuffers {
  return {
    logical: new Uint8Array(HUD_FRAMEBUFFER_SIZE),
    packed: new Uint8Array(HUD_PACKED_FRAME_SIZE),
  };
}

export function renderGame(state: GameState, buffers: RenderBuffers): Uint8Array {
  buffers.logical.fill(0);
  // drawStars(buffers.logical, state);

  // The exit prompt is an overlay, so the screen behind it keeps rendering
  // whatever the player was looking at when they asked to quit.
  const backdrop = state.mode === 'exitConfirm' ? state.modeBeforeExitConfirm : state.mode;

  if (backdrop === 'title') {
    drawCenteredText(buffers.logical, 'SCHMACE', 70, 3);
    drawCenteredText(buffers.logical, 'INVUDERS', 90, 3);
    if (shouldShowTapToStart(state)) {
      drawCenteredText(buffers.logical, 'TAP TO START', 126, 2);
    }
    drawCenteredText(buffers.logical, 'SCROLL MOVES', 160, 2);
    drawCenteredText(buffers.logical, 'TAP FIRES', 174, 2);
    drawBitmap(buffers.logical, SHIP_SPRITE, 122, 44, 2);
  } else {
    drawAliens(buffers.logical, state);
    drawPlayer(buffers.logical, state.playerX);
    drawShots(buffers.logical, state.playerShots);
    drawShots(buffers.logical, state.alienShots);
    drawBarriers(buffers.logical, state.barriers);

    if (backdrop === 'waveClear') {
      drawCenteredText(buffers.logical, 'WAVE CLEAR', 101, 2);
    } else if (backdrop === 'gameOver') {
      drawCenteredText(buffers.logical, 'GAME OVER', 94, 3);
      if (shouldShowTapToStart(state)) {
        drawCenteredText(buffers.logical, 'TAP TO START', 126, 2);
      }
    }
  }

  if (state.mode === 'exitConfirm') drawExitConfirm(buffers.logical);

  packToGray4(buffers.logical, buffers.packed, GAMEPLAY_HEIGHT, IMAGE_HEIGHT, GAMEPLAY_TOP);
  return buffers.packed;
}

function shouldShowTapToStart(state: GameState): boolean {
  // ~1s on / 1s off at the 10 Hz game tick.
  return Math.floor(state.frameClock / 10) % 2 === 0;
}

function drawExitConfirm(frame: Uint8Array): void {
  const left = 28;
  const top = 76;
  const width = 200;
  const height = 68;

  drawRect(frame, left, top, width, height, 0);
  drawRect(frame, left, top, width, 1);
  drawRect(frame, left, top + height - 1, width, 1);
  drawRect(frame, left, top, 1, height);
  drawRect(frame, left + width - 1, top, 1, height);

  drawCenteredText(frame, 'EXIT GAME?', top + 12, 2);
  drawCenteredText(frame, 'TAP = YES', top + 38, 1);
  drawCenteredText(frame, 'SCROLL = NO', top + 52, 1);
}

export function renderHud(state: GameState, buffers: RenderBuffers): Uint8Array {
  buffers.logical.fill(0);
  drawText(buffers.logical, `SCORE:${state.score}`, 4, 7, 2, IMAGE_WIDTH, HUD_IMAGE_HEIGHT);
  drawText(
    buffers.logical,
    `LIVES:${Math.max(0, state.lives)}`,
    96,
    7,
    2,
    IMAGE_WIDTH,
    HUD_IMAGE_HEIGHT,
  );
  drawText(buffers.logical, `LEVEL:${state.wave}`, 188, 7, 2, IMAGE_WIDTH, HUD_IMAGE_HEIGHT);
  packToGray4(buffers.logical, buffers.packed, HUD_IMAGE_HEIGHT, HUD_IMAGE_HEIGHT);
  return buffers.packed;
}

// The simulator currently decodes updateImageRawData as a conventional image
// file instead of accepting the raw gray4 format used by G2 hardware.
export function encodeMonochromeBmp(
  packedGray4: Uint8Array,
  width = IMAGE_WIDTH,
  height = IMAGE_HEIGHT,
): Uint8Array {
  const bmpRowSize = Math.ceil(width / 32) * 4;
  const pixelDataSize = bmpRowSize * height;
  const bmp = new Uint8Array(BMP_HEADER_SIZE + pixelDataSize);
  const view = new DataView(bmp.buffer);

  bmp[0] = 0x42;
  bmp[1] = 0x4d;
  view.setUint32(2, bmp.length, true);
  view.setUint32(10, BMP_HEADER_SIZE, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 1, true);
  view.setUint32(34, pixelDataSize, true);
  view.setUint32(46, 2, true);

  // BMP palette entries are BGRA. Index 0 is off; index 1 is fully lit.
  bmp.set([0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00], 54);

  for (let outputY = 0; outputY < height; outputY++) {
    const sourceY = height - 1 - outputY;
    const sourceRow = sourceY * (width / 2);
    const outputRow = BMP_HEADER_SIZE + outputY * bmpRowSize;

    for (let byteX = 0; byteX < Math.ceil(width / 8); byteX++) {
      let pixels = 0;
      for (let bit = 0; bit < 8; bit++) {
        const pixelX = byteX * 8 + bit;
        if (pixelX >= width) break;
        const gray4 = packedGray4[sourceRow + Math.floor(pixelX / 2)];
        const isLit = pixelX % 2 === 0 ? (gray4 & 0xf0) !== 0 : (gray4 & 0x0f) !== 0;
        if (isLit) pixels |= 0x80 >> bit;
      }
      bmp[outputRow + byteX] = pixels;
    }
  }

  return bmp;
}

function drawAliens(frame: Uint8Array, state: GameState): void {
  for (const alien of state.aliens) {
    drawBitmap(frame, ALIEN_SPRITES[alien.row % ALIEN_SPRITES.length], alien.x, alien.y, 1);
  }
}

function drawPlayer(frame: Uint8Array, playerX: number): void {
  const renderedX = Math.round(playerX);
  drawBitmap(frame, PLAYER_SPRITE, renderedX + 4, PLAYER_Y, 1);
  drawRect(frame, renderedX, PLAYER_Y + 5, 15, 3);
}

function drawShots(frame: Uint8Array, shots: Shot[]): void {
  for (const shot of shots) drawRect(frame, Math.round(shot.x), Math.round(shot.y), shot.width, shot.height);
}

function drawBarriers(frame: Uint8Array, barriers: Barrier[]): void {
  for (const barrier of barriers) {
    for (let y = 0; y < barrier.height; y++) {
      for (let x = 0; x < barrier.width; x++) {
        if (barrier.pixels[y * barrier.width + x]) setPixel(frame, barrier.x + x, barrier.y + y);
      }
    }
  }
}

function drawCenteredText(frame: Uint8Array, text: string, y: number, scale: number): void {
  const width = measureText(text, scale);
  drawText(frame, text, Math.floor((GAME_WIDTH - width) / 2), y, scale);
}

function drawText(
  frame: Uint8Array,
  text: string,
  x: number,
  y: number,
  scale: number,
  frameWidth = GAME_WIDTH,
  frameHeight = GAME_HEIGHT,
): void {
  let cursorX = x;
  for (const character of text.toUpperCase()) {
    const glyph = FONT[character] ?? FONT[' '];
    drawBitmap(frame, glyph, cursorX, y, scale, frameWidth, frameHeight);
    cursorX += (glyph[0].length + 1) * scale;
  }
}

function measureText(text: string, scale: number): number {
  let width = 0;
  for (const character of text.toUpperCase()) {
    const glyph = FONT[character] ?? FONT[' '];
    width += (glyph[0].length + 1) * scale;
  }
  return Math.max(0, width - scale);
}

function drawBitmap(
  frame: Uint8Array,
  bitmap: string[],
  x: number,
  y: number,
  scale: number,
  frameWidth = GAME_WIDTH,
  frameHeight = GAME_HEIGHT,
): void {
  for (let row = 0; row < bitmap.length; row++) {
    for (let column = 0; column < bitmap[row].length; column++) {
      if (bitmap[row][column] !== '1') continue;
      drawRect(frame, x + column * scale, y + row * scale, scale, scale, 1, frameWidth, frameHeight);
    }
  }
}

function drawRect(
  frame: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  value = 1,
  frameWidth = GAME_WIDTH,
  frameHeight = GAME_HEIGHT,
): void {
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      setPixel(frame, x + column, y + row, value, frameWidth, frameHeight);
    }
  }
}

function setPixel(
  frame: Uint8Array,
  x: number,
  y: number,
  value = 1,
  frameWidth = GAME_WIDTH,
  frameHeight = GAME_HEIGHT,
): void {
  if (x < 0 || y < 0 || x >= frameWidth || y >= frameHeight) return;
  frame[y * frameWidth + x] = value;
}

function packToGray4(
  logical: Uint8Array,
  packed: Uint8Array,
  sourceHeight = GAME_HEIGHT,
  outputHeight = IMAGE_HEIGHT,
  sourceTop = 0,
): void {
  let packedIndex = 0;

  for (let y = 0; y < outputHeight; y++) {
    const sourceY = sourceTop + Math.floor((y * sourceHeight) / outputHeight);
    const sourceRow = sourceY * GAME_WIDTH;

    for (let x = 0; x < IMAGE_WIDTH; x += 2) {
      const left = logical[sourceRow + x] ? 0xf0 : 0x00;
      const right = logical[sourceRow + x + 1] ? 0x0f : 0x00;
      packed[packedIndex++] = left | right;
    }
  }
}
