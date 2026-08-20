import { GAME_HEIGHT, GAME_WIDTH, PLAYER_Y, type GameState, type Shot } from './game';

export const IMAGE_WIDTH = 256;
export const IMAGE_HEIGHT = 144;
export const FRAMEBUFFER_SIZE = GAME_WIDTH * GAME_HEIGHT;
export const PACKED_FRAME_SIZE = (IMAGE_WIDTH * IMAGE_HEIGHT) / 2;
const BMP_HEADER_SIZE = 62;
const BMP_ROW_SIZE = IMAGE_WIDTH / 8;

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
  C: ['111', '100', '100', '100', '111'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['111', '100', '101', '101', '111'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['101', '111', '111', '111', '101'],
  O: ['111', '101', '101', '101', '111'],
  P: ['111', '101', '111', '100', '100'],
  R: ['110', '101', '110', '101', '101'],
  S: ['111', '100', '111', '001', '111'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
};

export function createRenderBuffers(): RenderBuffers {
  return {
    logical: new Uint8Array(FRAMEBUFFER_SIZE),
    packed: new Uint8Array(PACKED_FRAME_SIZE),
  };
}

export function renderGame(state: GameState, buffers: RenderBuffers): Uint8Array {
  buffers.logical.fill(0);
  drawStars(buffers.logical, state);
  drawHud(buffers.logical, state);

  if (state.mode === 'title') {
    drawCenteredText(buffers.logical, 'SCHMACE', 70, 3);
    drawCenteredText(buffers.logical, 'INVUDERS', 90, 3);
    drawCenteredText(buffers.logical, 'TAP TO START', 126, 2);
    drawCenteredText(buffers.logical, 'SCROLL MOVES', 146, 1);
    drawCenteredText(buffers.logical, 'TAP FIRES', 160, 1);
    drawBitmap(buffers.logical, SHIP_SPRITE, 122, 44, 2);
  } else {
    drawAliens(buffers.logical, state);
    drawPlayer(buffers.logical, state.playerX);
    drawShots(buffers.logical, state.playerShots);
    drawShots(buffers.logical, state.alienShots);
    drawBases(buffers.logical);

    if (state.mode === 'waveClear') {
      drawCenteredText(buffers.logical, 'WAVE CLEAR', 101, 2);
    } else if (state.mode === 'gameOver') {
      drawCenteredText(buffers.logical, 'GAME OVER', 94, 3);
      drawCenteredText(buffers.logical, 'TAP TO START', 126, 2);
    }
  }

  packToGray4(buffers.logical, buffers.packed);
  return buffers.packed;
}

// The simulator currently decodes updateImageRawData as a conventional image
// file instead of accepting the raw gray4 format used by G2 hardware.
export function encodeMonochromeBmp(packedGray4: Uint8Array): Uint8Array {
  const pixelDataSize = BMP_ROW_SIZE * IMAGE_HEIGHT;
  const bmp = new Uint8Array(BMP_HEADER_SIZE + pixelDataSize);
  const view = new DataView(bmp.buffer);

  bmp[0] = 0x42;
  bmp[1] = 0x4d;
  view.setUint32(2, bmp.length, true);
  view.setUint32(10, BMP_HEADER_SIZE, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, IMAGE_WIDTH, true);
  view.setInt32(22, IMAGE_HEIGHT, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 1, true);
  view.setUint32(34, pixelDataSize, true);
  view.setUint32(46, 2, true);

  // BMP palette entries are BGRA. Index 0 is off; index 1 is fully lit.
  bmp.set([0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00], 54);

  for (let outputY = 0; outputY < IMAGE_HEIGHT; outputY++) {
    const sourceY = IMAGE_HEIGHT - 1 - outputY;
    const sourceRow = sourceY * (IMAGE_WIDTH / 2);
    const outputRow = BMP_HEADER_SIZE + outputY * BMP_ROW_SIZE;

    for (let byteX = 0; byteX < BMP_ROW_SIZE; byteX++) {
      let pixels = 0;
      for (let bit = 0; bit < 8; bit++) {
        const pixelX = byteX * 8 + bit;
        const gray4 = packedGray4[sourceRow + Math.floor(pixelX / 2)];
        const isLit = pixelX % 2 === 0 ? (gray4 & 0xf0) !== 0 : (gray4 & 0x0f) !== 0;
        if (isLit) pixels |= 0x80 >> bit;
      }
      bmp[outputRow + byteX] = pixels;
    }
  }

  return bmp;
}

function drawHud(frame: Uint8Array, state: GameState): void {
  drawText(frame, `SCORE:${state.score}`, 4, 5, 1);
  drawText(frame, `LIVES:${state.lives}`, 100, 5, 1);
  drawText(frame, `WAVE:${state.wave}`, 184, 5, 1);
  drawLine(frame, 0, 18, GAME_WIDTH - 1, 18);
}

function drawAliens(frame: Uint8Array, state: GameState): void {
  for (const alien of state.aliens) {
    drawBitmap(frame, ALIEN_SPRITES[alien.row % ALIEN_SPRITES.length], alien.x, alien.y, 1);
  }
}

function drawPlayer(frame: Uint8Array, playerX: number): void {
  drawBitmap(frame, PLAYER_SPRITE, playerX + 4, PLAYER_Y, 1);
  drawRect(frame, playerX, PLAYER_Y + 5, 15, 3);
}

function drawShots(frame: Uint8Array, shots: Shot[]): void {
  for (const shot of shots) drawRect(frame, shot.x, shot.y, shot.width, shot.height);
}

function drawBases(frame: Uint8Array): void {
  for (const x of [38, 92, 146, 200]) {
    drawRect(frame, x, 184, 22, 3);
    drawRect(frame, x + 3, 181, 16, 3);
    drawRect(frame, x + 8, 187, 6, 3, 0);
  }
}

function drawStars(frame: Uint8Array, state: GameState): void {
  const offset = state.mode === 'playing' ? state.score + state.wave * 11 : state.wave * 17;
  for (let index = 0; index < 32; index++) {
    const x = (index * 47 + offset) % GAME_WIDTH;
    const y = 24 + ((index * 31 + offset * 3) % 150);
    setPixel(frame, x, y);
  }
}

function drawCenteredText(frame: Uint8Array, text: string, y: number, scale: number): void {
  const width = measureText(text, scale);
  drawText(frame, text, Math.floor((GAME_WIDTH - width) / 2), y, scale);
}

function drawText(frame: Uint8Array, text: string, x: number, y: number, scale: number): void {
  let cursorX = x;
  for (const character of text.toUpperCase()) {
    const glyph = FONT[character] ?? FONT[' '];
    drawBitmap(frame, glyph, cursorX, y, scale);
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

function drawBitmap(frame: Uint8Array, bitmap: string[], x: number, y: number, scale: number): void {
  for (let row = 0; row < bitmap.length; row++) {
    for (let column = 0; column < bitmap[row].length; column++) {
      if (bitmap[row][column] !== '1') continue;
      drawRect(frame, x + column * scale, y + row * scale, scale, scale);
    }
  }
}

function drawRect(frame: Uint8Array, x: number, y: number, width: number, height: number, value = 1): void {
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      setPixel(frame, x + column, y + row, value);
    }
  }
}

function drawLine(frame: Uint8Array, x1: number, y1: number, x2: number, y2: number): void {
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let error = width - height;
  let x = x1;
  let y = y1;

  while (true) {
    setPixel(frame, x, y);
    if (x === x2 && y === y2) break;
    const doubledError = error * 2;
    if (doubledError > -height) {
      error -= height;
      x += sx;
    }
    if (doubledError < width) {
      error += width;
      y += sy;
    }
  }
}

function setPixel(frame: Uint8Array, x: number, y: number, value = 1): void {
  if (x < 0 || y < 0 || x >= GAME_WIDTH || y >= GAME_HEIGHT) return;
  frame[y * GAME_WIDTH + x] = value;
}

function packToGray4(logical: Uint8Array, packed: Uint8Array): void {
  let packedIndex = 0;

  for (let y = 0; y < IMAGE_HEIGHT; y++) {
    const sourceY = Math.floor((y * GAME_HEIGHT) / IMAGE_HEIGHT);
    const sourceRow = sourceY * GAME_WIDTH;

    for (let x = 0; x < IMAGE_WIDTH; x += 2) {
      const left = logical[sourceRow + x] ? 0xf0 : 0x00;
      const right = logical[sourceRow + x + 1] ? 0x0f : 0x00;
      packed[packedIndex++] = left | right;
    }
  }
}
