import {
  waitForEvenAppBridge,
  TextContainerProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  CreateStartUpPageContainer,
  ImuReportPace,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';

import {
  cancelExitConfirm,
  createGameState,
  handleTap,
  HEAD_TILT_PLAYER_STEP,
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
// The SDK reports swipe direction but not touch release. Directional events
// arrive repeatedly while scrolling, so a short quiet period is the closest
// available release signal and also tolerates an occasional missed sample.
const SWIPE_RELEASE_GRACE_MS = 300;
// The SDK awaits `flutter_inappwebview.callHandler` with no timeout of its own,
// so a host reply that never arrives would otherwise stall the frame pump for
// the rest of the session.
const HOST_CALL_TIMEOUT_MS = 2000;
const FAILURES_BEFORE_WARNING = 10;
const IMU_DEBUG = new URLSearchParams(window.location.search).has('imuDebug');
const IMU_LOG_WINDOW_MS = 2000;
const IMU_SMOOTHING = 0.35;
const HEAD_CALIBRATION_SETTLE_MS = 350;
const HEAD_CALIBRATION_DURATION_MS = 1200;
const HEAD_LEFT_ENTER = -0.15;
const HEAD_LEFT_EXIT = -0.09;
const HEAD_RIGHT_ENTER = 0.1;
const HEAD_RIGHT_EXIT = 0.06;
const HEAD_UP_ENTER = 0.1;
const HEAD_UP_EXIT = 0.055;
const HEAD_BASELINE_ADAPTATION = 0.015;
const IMU_INPUT_STALE_MS = 400;
const IMU_RESTART_AFTER_MS = 2000;
const IMU_RESTART_COOLDOWN_MS = 5000;

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
  void startImu();
}

type PendingFrame = {
  game: Uint8Array;
  hud: Uint8Array | null;
  hudSignature: string;
};

type ImuVector = {
  x: number;
  y: number;
  z: number;
};

let pendingFrame: PendingFrame | null = null;
let displayedHudSignature = '';
let isSendingFrame = false;
let hasExited = false;
let consecutiveSendFailures = 0;
let hasReportedStalledImagePath = false;
let lastTick = performance.now();
let swipeMoveDirection: -1 | 0 | 1 = 0;
let headMoveDirection: -1 | 0 | 1 = 0;
let swipeExpiresAt = 0;
let smoothedImu: ImuVector | null = null;
let headBaseline: ImuVector | null = null;
let headCalibrationStartedAt = 0;
let headCalibrationSampleCount = 0;
let headCalibrationSum: ImuVector = { x: 0, y: 0, z: 0 };
let headShotArmed = true;
let lastImuSampleAt = 0;
let imuStreamStartedAt = performance.now();
let lastImuRestartAttemptAt = 0;
let isRestartingImu = false;
const imuCaptureStartedAt = performance.now();
let imuLogWindowStartedAt = imuCaptureStartedAt;
let imuSamples: Array<{ t: number; x: number; y: number; z: number }> = [];

renderAndQueueFrame();
requestAnimationFrame(runGameLoop);

bridge.onEvenHubEvent((event) => {
  const imu = event.sysEvent?.imuData;
  if (event.sysEvent?.eventType === OsEventTypeList.IMU_DATA_REPORT && imu) {
    recordImuSample(imu.x ?? 0, imu.y ?? 0, imu.z ?? 0);
    return;
  }

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
      stopSwipeMovement();
      const modeBeforeTap = game.mode;
      handleTap(game);
      if (modeBeforeTap !== 'playing' && game.mode === 'playing') beginHeadCalibration();
      renderAndQueueFrame();
      break;

    case OsEventTypeList.SCROLL_TOP_EVENT:
      updatePlayerMovement(-1);
      break;

    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      updatePlayerMovement(1);
      break;

    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      stopPlayerMovement();
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
      stopPlayerMovement();
      hasExited = true;
      break;
  }
});

function updatePlayerMovement(direction: -1 | 1): void {
  swipeMoveDirection = direction;
  swipeExpiresAt = performance.now() + SWIPE_RELEASE_GRACE_MS;
  movePlayer(game, direction);
  renderAndQueueFrame();
}

function stopSwipeMovement(): void {
  swipeMoveDirection = 0;
  swipeExpiresAt = 0;
}

function stopPlayerMovement(): void {
  stopSwipeMovement();
  headMoveDirection = 0;
}

function isInputEvent(eventType: OsEventTypeList): boolean {
  return (
    eventType === OsEventTypeList.CLICK_EVENT ||
    eventType === OsEventTypeList.SCROLL_TOP_EVENT ||
    eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT ||
    eventType === OsEventTypeList.DOUBLE_CLICK_EVENT
  );
}

async function startImu(): Promise<void> {
  imuStreamStartedAt = performance.now();
  const result = await callHost('imuControl(true)', false, async () => {
    await bridge.imuControl(true, ImuReportPace.P100);
    return true;
  });

  if (result) {
    console.log(`[Schmace IMU] streaming${IMU_DEBUG ? ' with debug capture enabled' : ''}`);
  } else {
    console.warn('[Schmace IMU] failed to start');
  }
}

function recordImuSample(x: number, y: number, z: number): void {
  lastImuSampleAt = performance.now();
  processHeadControls(x, y, z);
  if (!IMU_DEBUG) return;

  const now = performance.now();
  imuSamples.push({
    t: Math.round(now - imuCaptureStartedAt),
    x: roundImuValue(x),
    y: roundImuValue(y),
    z: roundImuValue(z),
  });

  if (now - imuLogWindowStartedAt < IMU_LOG_WINDOW_MS) return;

  // One JSON array per window is easy to copy intact from WebView/Console Ninja
  // logs and preserves the transient acceleration produced while turning.
  console.log(`[Schmace IMU samples] ${JSON.stringify(imuSamples)}`);
  void uploadImuSamples(imuSamples);
  imuSamples = [];
  imuLogWindowStartedAt = now;
}

function beginHeadCalibration(): void {
  headMoveDirection = 0;
  headShotArmed = true;
  headBaseline = null;
  smoothedImu = null;
  headCalibrationStartedAt = performance.now();
  headCalibrationSampleCount = 0;
  headCalibrationSum = { x: 0, y: 0, z: 0 };
  console.log('[Schmace IMU] hold your head straight');
}

function processHeadControls(x: number, y: number, z: number): void {
  const magnitude = Math.hypot(x, y, z);
  if (magnitude < 0.01) return;

  const sample = { x: x / magnitude, y: y / magnitude, z: z / magnitude };
  smoothedImu = smoothedImu
    ? {
        x: smoothImuAxis(smoothedImu.x, sample.x),
        y: smoothImuAxis(smoothedImu.y, sample.y),
        z: smoothImuAxis(smoothedImu.z, sample.z),
      }
    : sample;

  if (headCalibrationStartedAt !== 0) {
    updateHeadCalibration(smoothedImu);
    return;
  }

  if (game.mode !== 'playing' || !headBaseline) {
    headMoveDirection = 0;
    return;
  }

  // Use the initial calibration as the seed for a slow-moving neutral pose.
  // Adapting continuously prevents a gradual glasses/posture shift from being
  // latched forever as a gesture. The slow rate preserves deliberate tilts.
  headBaseline.x = adaptBaselineAxis(headBaseline.x, smoothedImu.x);
  headBaseline.y = adaptBaselineAxis(headBaseline.y, smoothedImu.y);
  headBaseline.z = adaptBaselineAxis(headBaseline.z, smoothedImu.z);

  const pitchDelta = smoothedImu.x - headBaseline.x;
  const tiltDelta = smoothedImu.y - headBaseline.y;

  if (pitchDelta < HEAD_UP_EXIT) headShotArmed = true;
  if (pitchDelta > HEAD_UP_ENTER) {
    headMoveDirection = 0;
    if (headShotArmed) {
      headShotArmed = false;
      handleTap(game);
      renderAndQueueFrame();
    }
    return;
  }

  if (
    (headMoveDirection === -1 && tiltDelta < HEAD_LEFT_EXIT) ||
    (headMoveDirection === 1 && tiltDelta > HEAD_RIGHT_EXIT)
  ) {
    return;
  }

  if (tiltDelta < HEAD_LEFT_ENTER) {
    headMoveDirection = -1;
  } else if (tiltDelta > HEAD_RIGHT_ENTER) {
    headMoveDirection = 1;
  } else {
    headMoveDirection = 0;
  }
}

function updateHeadCalibration(sample: ImuVector): void {
  const elapsed = performance.now() - headCalibrationStartedAt;
  if (elapsed < HEAD_CALIBRATION_SETTLE_MS) return;

  headCalibrationSum.x += sample.x;
  headCalibrationSum.y += sample.y;
  headCalibrationSum.z += sample.z;
  headCalibrationSampleCount++;

  if (elapsed < HEAD_CALIBRATION_DURATION_MS || headCalibrationSampleCount === 0) return;

  headBaseline = {
    x: headCalibrationSum.x / headCalibrationSampleCount,
    y: headCalibrationSum.y / headCalibrationSampleCount,
    z: headCalibrationSum.z / headCalibrationSampleCount,
  };
  headCalibrationStartedAt = 0;
  console.log(
    `[Schmace IMU] calibrated straight baseline ${JSON.stringify({
      x: roundImuValue(headBaseline.x),
      y: roundImuValue(headBaseline.y),
      z: roundImuValue(headBaseline.z),
    })}`,
  );
}

function smoothImuAxis(previous: number, next: number): number {
  return previous + (next - previous) * IMU_SMOOTHING;
}

function adaptBaselineAxis(previous: number, next: number): number {
  return previous + (next - previous) * HEAD_BASELINE_ADAPTATION;
}

function checkImuWatchdog(timestamp: number): void {
  if (game.mode !== 'playing') return;

  const latestActivity = Math.max(lastImuSampleAt, imuStreamStartedAt);
  const silenceMs = timestamp - latestActivity;

  if (silenceMs > IMU_INPUT_STALE_MS) {
    // Never keep applying a stale directional command when BLE delivery stops.
    headMoveDirection = 0;
    smoothedImu = null;
  }

  if (
    silenceMs > IMU_RESTART_AFTER_MS &&
    !isRestartingImu &&
    timestamp - lastImuRestartAttemptAt > IMU_RESTART_COOLDOWN_MS
  ) {
    void restartImu();
  }
}

async function restartImu(): Promise<void> {
  isRestartingImu = true;
  lastImuRestartAttemptAt = performance.now();
  console.warn('[Schmace IMU] stream stalled; restarting');

  try {
    await callHost('imuControl(false)', false, async () => {
      await bridge.imuControl(false);
      return true;
    });
    await startImu();
  } finally {
    isRestartingImu = false;
  }
}

async function uploadImuSamples(samples: typeof imuSamples): Promise<void> {
  try {
    await fetch('/__imu_capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(samples),
    });
  } catch {
    // The capture endpoint only exists on the local Vite development server.
  }
}

function roundImuValue(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

// exitMode 0 quits immediately. exitMode 1 hands the foreground to the native
// confirmation overlay, which permanently kills updateImageRawData on G2 even
// when the user cancels (even-realities/everything-evenhub#18), so the game
// draws its own prompt instead.
async function exitApp(): Promise<void> {
  hasExited = true;
  await callHost('imuControl(false)', false, async () => {
    await bridge.imuControl(false);
    return true;
  });
  await callHost('shutDownPageContainer', false, () => bridge.shutDownPageContainer(0));
}

function runGameLoop(timestamp: number): void {
  if (hasExited) return;

  if (timestamp - lastTick >= TARGET_FRAME_MS) {
    lastTick = timestamp;
    if (swipeMoveDirection !== 0 && timestamp > swipeExpiresAt) stopSwipeMovement();
    checkImuWatchdog(timestamp);

    // Frames stop landing while a native overlay owns the display. Holding the
    // simulation until sends recover keeps the player from dying behind the
    // dialog without having to guess which lifecycle event means "overlay up".
    if (consecutiveSendFailures === 0) {
      if (headMoveDirection !== 0) {
        movePlayer(game, headMoveDirection, HEAD_TILT_PLAYER_STEP);
      } else if (swipeMoveDirection !== 0) {
        movePlayer(game, swipeMoveDirection);
      }
      tickGame(game);
    }
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