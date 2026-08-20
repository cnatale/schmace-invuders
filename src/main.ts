import {
  waitForEvenAppBridge,
  TextContainerProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';

import {
  cancelExitConfirm,
  createGameState,
  handleTap,
  movePlayer,
  openExitConfirm,
  tickGame,
} from './game';
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
// The SDK awaits `flutter_inappwebview.callHandler` with no timeout of its own,
// so a host reply that never arrives would otherwise stall the frame pump for
// the rest of the session.
const HOST_CALL_TIMEOUT_MS = 2000;
const FAILURES_BEFORE_WARNING = 10;

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
let hasExited = false;
let consecutiveSendFailures = 0;
let hasReportedStalledImagePath = false;
let lastTick = performance.now();

renderAndQueueFrame();
requestAnimationFrame(runGameLoop);

bridge.onEvenHubEvent((event) => {
  const source = event.textEvent ?? event.sysEvent;
  if (!source) return;

  if (event.textEvent && event.textEvent.containerID !== TEXT_CONTAINER_ID) return;

  const eventType = source.eventType ?? OsEventTypeList.CLICK_EVENT;

  if (game.mode === 'exitConfirm' && isInputEvent(eventType)) {
    if (eventType === OsEventTypeList.CLICK_EVENT) {
      void exitApp();
    } else {
      cancelExitConfirm(game);
      renderAndQueueFrame();
    }
    return;
  }

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
      openExitConfirm(game);
      renderAndQueueFrame();
      break;

    // Events 4 and 5 are named FOREGROUND_ENTER/EXIT, but the G2 exit dialog
    // reports 4 when it opens and 5 when it closes, so neither name can be
    // trusted to mean "an overlay is up". Both are treated as "the native
    // foreground changed": resync, and never gate the frame pump on them.
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      lastTick = performance.now();
      forceFullRedraw();
      break;

    case OsEventTypeList.SYSTEM_EXIT_EVENT:
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
      hasExited = true;
      break;
  }
});

function isInputEvent(eventType: OsEventTypeList): boolean {
  return (
    eventType === OsEventTypeList.CLICK_EVENT ||
    eventType === OsEventTypeList.SCROLL_TOP_EVENT ||
    eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT ||
    eventType === OsEventTypeList.DOUBLE_CLICK_EVENT
  );
}

// exitMode 0 quits immediately. exitMode 1 hands the foreground to the native
// confirmation overlay, which permanently kills updateImageRawData on G2 even
// when the user cancels (even-realities/everything-evenhub#18), so the game
// draws its own prompt instead.
async function exitApp(): Promise<void> {
  hasExited = true;
  await callHost('shutDownPageContainer', false, () => bridge.shutDownPageContainer(0));
}

function runGameLoop(timestamp: number): void {
  if (hasExited) return;

  if (timestamp - lastTick >= TARGET_FRAME_MS) {
    lastTick = timestamp;
    // Frames stop landing while a native overlay owns the display. Holding the
    // simulation until sends recover keeps the player from dying behind the
    // dialog without having to guess which lifecycle event means "overlay up".
    if (consecutiveSendFailures === 0) tickGame(game);
    renderAndQueueFrame();
  }

  requestAnimationFrame(runGameLoop);
}

// The HUD only redraws when its values change, so a resync has to invalidate
// the cached signature or the glasses keep showing the pre-overlay frame.
function forceFullRedraw(): void {
  displayedHudSignature = '';
  consecutiveSendFailures = 0;
  renderAndQueueFrame();
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
  if (isSendingFrame || hasExited || !pendingFrame) return;

  const frame = pendingFrame;
  pendingFrame = null;
  isSendingFrame = true;

  let frameWasSent = true;

  try {
    if (frame.hud && frame.hudSignature !== displayedHudSignature) {
      if (await sendImage(HUD_CONTAINER_ID, HUD_CONTAINER_NAME, frame.hud, HUD_IMAGE_HEIGHT)) {
        displayedHudSignature = frame.hudSignature;
      } else {
        frameWasSent = false;
      }
    }

    if (!(await sendImage(IMAGE_CONTAINER_ID, IMAGE_CONTAINER_NAME, frame.game, IMAGE_HEIGHT))) {
      frameWasSent = false;
    }
  } finally {
    isSendingFrame = false;
  }

  if (frameWasSent) {
    consecutiveSendFailures = 0;
    hasReportedStalledImagePath = false;
  } else {
    consecutiveSendFailures++;

    // Re-registering the containers blanks them until a send lands, so when the
    // host's image path is the thing that is broken a rebuild trades the last
    // good frame for an empty display without restoring anything.
    if (consecutiveSendFailures >= FAILURES_BEFORE_WARNING && !hasReportedStalledImagePath) {
      hasReportedStalledImagePath = true;
      console.warn(
        `[Schmace] ${consecutiveSendFailures} image sends failed in a row; holding the last frame`,
      );
    }
  }

  if (pendingFrame) void drainFrameQueue();
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

  const imageResult = await callHost(
    `updateImageRawData(${containerName})`,
    ImageRawDataUpdateResult.sendFailed,
    () =>
      bridge.updateImageRawData(
        new ImageRawDataUpdate({
          containerID,
          containerName,
          // number[] is the SDK's preferred host-facing representation. Passing
          // it explicitly also works with simulator/host versions that do not
          // normalize typed arrays consistently.
          imageData: Array.from(imageData),
        }),
      ),
  );

  if (imageResult !== ImageRawDataUpdateResult.success) {
    console.warn(`${containerName} image update failed:`, imageResult);
    return false;
  }

  return true;
}

async function callHost<T>(label: string, fallback: T, call: () => Promise<T>): Promise<T> {
  let pending: Promise<T>;

  try {
    pending = call();
  } catch (error) {
    console.warn(`[Schmace] ${label} threw synchronously:`, error);
    return fallback;
  }

  // A late rejection must stay handled even when the timeout wins the race.
  pending.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[Schmace] ${label} did not answer within ${HOST_CALL_TIMEOUT_MS}ms`);
      resolve(fallback);
    }, HOST_CALL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([pending, timeout]);
  } catch (error) {
    console.warn(`[Schmace] ${label} rejected:`, error);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}