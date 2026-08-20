import {
  waitForEvenAppBridge,
  TextContainerProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';

import { createGameState, handleTap, movePlayer, tickGame } from './game';
import {
  createHudRenderBuffers,
  createRenderBuffers,
  encodeMonochromeBmp,
  HUD_IMAGE_HEIGHT,
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  renderGame,
  renderHud,
} from './render';

const TEXT_CONTAINER_ID = 1;
const TEXT_CONTAINER_NAME = 'input';
const IMAGE_CONTAINER_ID = 2;
const IMAGE_CONTAINER_NAME = 'game';
const HUD_CONTAINER_ID = 3;
const HUD_CONTAINER_NAME = 'hud';
const TARGET_FRAME_MS = 100;
const IS_MOBILE_WEBVIEW = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const USE_SIMULATOR_IMAGE_FORMAT = !IS_MOBILE_WEBVIEW;

const bridge = await waitForEvenAppBridge();
const game = createGameState();
const buffers = createRenderBuffers();
const hudBuffers = createHudRenderBuffers();

const inputLayer = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  paddingLength: 0,
  containerID: TEXT_CONTAINER_ID,
  containerName: TEXT_CONTAINER_NAME,
  content: ' ',
  isEventCapture: 1,
});

const contentHeight = HUD_IMAGE_HEIGHT + IMAGE_HEIGHT;
const contentTop = Math.floor((288 - contentHeight) / 2);
const imageLeft = Math.floor((576 - IMAGE_WIDTH) / 2);

const hudImage = new ImageContainerProperty({
  xPosition: imageLeft,
  yPosition: contentTop,
  width: IMAGE_WIDTH,
  height: HUD_IMAGE_HEIGHT,
  containerID: HUD_CONTAINER_ID,
  containerName: HUD_CONTAINER_NAME,
});

const gameImage = new ImageContainerProperty({
  xPosition: imageLeft,
  yPosition: contentTop + HUD_IMAGE_HEIGHT,
  width: IMAGE_WIDTH,
  height: IMAGE_HEIGHT,
  containerID: IMAGE_CONTAINER_ID,
  containerName: IMAGE_CONTAINER_NAME,
});

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 3,
    textObject: [inputLayer],
    imageObject: [hudImage, gameImage],
  }),
);

if (result !== 0) {
  console.error('createStartUpPageContainer failed:', result);
} else {
  console.log(`[Schmace] ready (${USE_SIMULATOR_IMAGE_FORMAT ? 'simulator BMP' : 'hardware gray4'})`);
}

type PendingFrame = {
  game: Uint8Array;
  hud: Uint8Array | null;
  hudSignature: string;
};

let pendingFrame: PendingFrame | null = null;
let displayedHudSignature = '';
let isSendingFrame = false;
let isPaused = false;
let lastTick = performance.now();

renderAndQueueFrame();
requestAnimationFrame(runGameLoop);

bridge.onEvenHubEvent((event) => {
  const source = event.textEvent ?? event.sysEvent;
  if (!source) return;

  if (event.textEvent && event.textEvent.containerID !== TEXT_CONTAINER_ID) return;

  const eventType = source.eventType ?? OsEventTypeList.CLICK_EVENT;

  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT:
      handleTap(game);
      renderAndQueueFrame();
      break;

    case OsEventTypeList.SCROLL_TOP_EVENT:
      movePlayer(game, -1);
      renderAndQueueFrame();
      break;

    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      movePlayer(game, 1);
      renderAndQueueFrame();
      break;

    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      bridge.shutDownPageContainer(1);
      break;

    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      isPaused = true;
      break;

    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      isPaused = false;
      lastTick = performance.now();
      renderAndQueueFrame();
      break;
  }
});

function runGameLoop(timestamp: number): void {
  if (!isPaused && timestamp - lastTick >= TARGET_FRAME_MS) {
    lastTick = timestamp;
    tickGame(game);
    renderAndQueueFrame();
  }

  requestAnimationFrame(runGameLoop);
}

function renderAndQueueFrame(): void {
  const hudSignature = `${game.score}:${game.lives}:${game.wave}`;
  pendingFrame = {
    game: renderGame(game, buffers).slice(),
    hud: hudSignature === displayedHudSignature ? null : renderHud(game, hudBuffers).slice(),
    hudSignature,
  };
  void drainFrameQueue();
}

async function drainFrameQueue(): Promise<void> {
  if (isSendingFrame || !pendingFrame) return;

  const frame = pendingFrame;
  pendingFrame = null;
  isSendingFrame = true;

  try {
    if (frame.hud && frame.hudSignature !== displayedHudSignature) {
      const hudWasSent = await sendImage(HUD_CONTAINER_ID, HUD_CONTAINER_NAME, frame.hud, HUD_IMAGE_HEIGHT);
      if (hudWasSent) displayedHudSignature = frame.hudSignature;
    }
    await sendImage(IMAGE_CONTAINER_ID, IMAGE_CONTAINER_NAME, frame.game, IMAGE_HEIGHT);
  } finally {
    isSendingFrame = false;
    if (pendingFrame) void drainFrameQueue();
  }
}

async function sendImage(
  containerID: number,
  containerName: string,
  frame: Uint8Array,
  height: number,
): Promise<boolean> {
  const imageData = USE_SIMULATOR_IMAGE_FORMAT
    ? encodeMonochromeBmp(frame, IMAGE_WIDTH, height)
    : frame;
  const imageResult = await bridge.updateImageRawData(
    new ImageRawDataUpdate({
      containerID,
      containerName,
      // number[] is the SDK's preferred host-facing representation. Passing
      // it explicitly also works with simulator/host versions that do not
      // normalize typed arrays consistently.
      imageData: Array.from(imageData),
    }),
  );

  if (imageResult !== ImageRawDataUpdateResult.success) {
    console.warn(`${containerName} image update failed:`, imageResult);
    return false;
  }

  return true;
}