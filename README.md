# Schmace Invuders

An Even Hub app for the Even Realities G2 glasses.

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
