# Schmace Invuders

An Even Hub Space Invaders clone for the Even Realities G2 glasses.

## Gameplay

- Single tap starts or restarts the game.
- Swipe up moves left continuously while swiping.
- Swipe down moves right continuously while swiping.
- Single tap fires while playing.
- Tilting the left or right ear toward the shoulder moves the ship after a
  short straight-ahead calibration at game start.
- Looking up fires once; return to the straight-ahead pose to re-arm.
- Double tap opens the system exit confirmation.
- In the exit confirmation, single tap exits; swipe or double tap cancels and
  returns to the game.

## IMU data capture

The G2 SDK exposes three-axis accelerometer samples, but it does not document
the axis orientation or units. The head controls use empirically measured
gravity-vector changes with smoothing and hysteresis. The neutral baseline
slowly follows ordinary posture drift, and a watchdog stops stale movement and
restarts the IMU if its event stream stalls. To log IMU data, start the Vite
server with network access and add `?imuDebug=1` to the prototype URL:

```bash
npm run dev -- --host 0.0.0.0
evenhub qr --url "http://192.168.x.x:5173/?imuDebug=1"
```

The app sends timestamped samples to the development server in two-second
batches. They appear in the Vite terminal as
`[Schmace IMU capture] [{"t":...,"x":...,"y":...,"z":...}]`. This endpoint is
only installed by the local Vite development server; production builds do not
receive or store the samples.

On physical glasses, hold each pose for about three seconds in this order:

1. Look straight ahead.
2. Look left, then return to center.
3. Look right, then return to center.
4. Look up, then return to center.
5. Tilt the left ear toward the left shoulder, then return to center.
6. Tilt the right ear toward the right shoulder, then return to center.

Copy every terminal line beginning with `[Schmace IMU capture]`, preserving the
JSON arrays. A stationary accelerometer cannot measure held yaw, so movement
uses gravity-relative head tilt rather than left/right gaze.

## Rendering

Schmace Invuders runs entirely inside the local WebView. There is no WebSocket
or remote render server, so input latency is bounded by local JavaScript work,
BLE display transfer, and the glasses firmware.

The game simulation uses a 256 x 224 logical framebuffer represented by a
one-dimensional `Uint8Array`. Every entry is either off (`0`) or on (`1`), so
the game stays two-color for better LZ4 compression in transit. Each frame is
nearest-neighbor scaled into the SDK-supported 256 x 144 game image container.
The score, lives, and level are rendered at 2x scale in a separate 256 x 24
image directly above it. The original HUD occupied logical rows 0–18, so the
game image now scales only rows 19–223 into all 144 output rows. This enlarges
the displayed playfield without changing its dimensions or simulation
coordinates. For G2 hardware, both images are packed into raw 4-bit grayscale
bytes for `updateImageRawData`:

```text
logical pixel array: 256 * 224 bytes, values 0 or 1
game payload:        256 * 144 / 2 bytes
HUD payload:         256 * 24 / 2 bytes
packed byte:         high nibble = left pixel, low nibble = right pixel
colors:              0x0 off, 0xF on
```

Frames are built as `Uint8Array` values and converted to the SDK's preferred
`number[]` representation at the host bridge. This conversion does not change
the bytes sent or their compressibility. Although the game uses only two
colors, the G2 raw image API expects Gray4 data; packing the framebuffer at one
bit per pixel would only reduce hardware transfer size if the SDK and firmware
exposed a corresponding 1-bit format. The simulator does accept a 1-bit image,
so simulator frames are encoded as monochrome BMP files instead of raw Gray4.

The loop is driven by `requestAnimationFrame` and throttled to a 10 FPS target.
Image updates are sent sequentially because the Even Hub SDK does not allow
concurrent image transfers. If BLE delivery falls behind the game loop, only
the newest pending frame is retained.

## Setup

Prerequisites:

- Node.js 20.19 or newer, or Node.js 22.12 or newer
- Even app 2.0.0 or newer
- Even Hub CLI and simulator

Install the project dependencies:

```bash
npm install
```

Install the Even Hub CLI and simulator by following the
[Even Hub tooling instructions](https://hub.evenrealities.com/docs/get-started/quickstart/install-tools).

## Test in the simulator

Start the Vite development server:

```bash
npm run dev
```

Keep that terminal running. In a second terminal, launch the simulator:

```bash
evenhub-simulator http://localhost:5173
```

Edits are applied automatically through Vite's hot reload.

## Production build

Type-check the project and create a production build in `dist`:

```bash
npm run build
```

Serve the production build locally for a final browser check:

```bash
npm run preview
```

## Test on G2 glasses

The glasses load the app through the phone, so the development server must be
accessible on the local network. Start Vite with network access enabled:

```bash
npm run dev -- --host 0.0.0.0
```

Keep that terminal running. Vite should print both a local and a network URL:

```text
Local:   http://localhost:5173/
Network: http://192.168.x.x:5173/
```

Alternatively, find the Mac's Wi-Fi IP address with:

```bash
ipconfig getifaddr en0
```

In a second terminal, generate a QR code using that network IP:

```bash
evenhub qr --url "http://192.168.x.x:5173"
```

Replace `192.168.x.x` with the actual address, then scan the QR code from the
Even Hub developer hub's **Prototype Mode** page. The phone and development
computer must be connected to the same Wi-Fi network.

### Troubleshooting

- Confirm the network URL opens in the phone's browser before scanning the QR.
- If the connection is refused, ensure Vite was started with
  `--host 0.0.0.0`.
- Allow incoming connections for Node.js if prompted by the macOS firewall.
- Guest or corporate Wi-Fi may use client/AP isolation, which prevents devices
  on the same network from communicating. Use another network or a personal
  hotspot in that case.
