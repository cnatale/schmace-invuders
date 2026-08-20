# Schmace Invuders

An Even Hub Space Invaders clone for the Even Realities G2 glasses.

## Gameplay

- Single tap starts or restarts the game.
- Swipe up moves left continuously while swiping.
- Swipe down moves right continuously while swiping.
- Single tap fires while playing.
- Double tap opens the system exit confirmation.

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
coordinates. Both images are packed into raw 4-bit grayscale bytes for
`updateImageRawData`:

```text
logical pixel array: 256 * 224 bytes, values 0 or 1
game payload:        256 * 144 / 2 bytes
HUD payload:         256 * 24 / 2 bytes
packed byte:         high nibble = left pixel, low nibble = right pixel
colors:              0x0 off, 0xF on
```

The loop is driven by `requestAnimationFrame` and throttled to a 10 FPS target.
Image updates are sent sequentially because the Even Hub SDK does not allow
concurrent image transfers. If BLE delivery falls behind the game loop, only
the newest pending frame is retained.

## Setup

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
