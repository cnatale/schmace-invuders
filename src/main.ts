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
  createRenderBuffers,
  encodeMonochromeBmp,
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  renderGame,
} from './render';

const TEXT_CONTAINER_ID = 1;
const TEXT_CONTAINER_NAME = 'input';
const IMAGE_CONTAINER_ID = 2;
const IMAGE_CONTAINER_NAME = 'game';
const TARGET_FRAME_MS = 100;
const IS_MOBILE_WEBVIEW = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const USE_SIMULATOR_IMAGE_FORMAT = !IS_MOBILE_WEBVIEW;

const bridge = await waitForEvenAppBridge();
const game = createGameState();
const buffers = createRenderBuffers();

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

const gameImage = new ImageContainerProperty({
  xPosition: Math.floor((576 - IMAGE_WIDTH) / 2),
  yPosition: Math.floor((288 - IMAGE_HEIGHT) / 2),
  width: IMAGE_WIDTH,
  height: IMAGE_HEIGHT,
  containerID: IMAGE_CONTAINER_ID,
  containerName: IMAGE_CONTAINER_NAME,
});

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 2,
    textObject: [inputLayer],
    imageObject: [gameImage],
  }),
);

if (result !== 0) {
  console.error('createStartUpPageContainer failed:', result);
} else {
  console.log(`[Schmace] ready (${USE_SIMULATOR_IMAGE_FORMAT ? 'simulator BMP' : 'hardware gray4'})`);
}

let pendingFrame: Uint8Array | null = null;
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
  const frame = renderGame(game, buffers);
  pendingFrame = frame.slice();
  void drainFrameQueue();
}

async function drainFrameQueue(): Promise<void> {
  if (isSendingFrame || !pendingFrame) return;

  const frame = pendingFrame;
  pendingFrame = null;
  isSendingFrame = true;

  try {
    const imageData = USE_SIMULATOR_IMAGE_FORMAT ? encodeMonochromeBmp(frame) : frame;
    const imageResult = await bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID: IMAGE_CONTAINER_ID,
        containerName: IMAGE_CONTAINER_NAME,
        // number[] is the SDK's preferred host-facing representation. Passing
        // it explicitly also works with simulator/host versions that do not
        // normalize typed arrays consistently.
        imageData: Array.from(imageData),
      }),
    );

    if (imageResult !== ImageRawDataUpdateResult.success) {
      console.warn('Image update failed:', imageResult);
    }
  } finally {
    isSendingFrame = false;
    if (pendingFrame) void drainFrameQueue();
  }
}