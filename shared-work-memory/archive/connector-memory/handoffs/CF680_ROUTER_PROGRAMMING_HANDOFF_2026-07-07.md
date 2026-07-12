# CF680 Router Programming Handoff - 2026-07-07

## Current State
- SkinAnalyzerPro iPad has been patched, built, signed and installed on the iPad.
- Manual CF680 router controls are now present in CF680 settings:
  - `Leggi rete`
  - `Programma router`
  - temporary SSID/password fields
- Password is intentionally not persisted.
- Algorithms and scoring were not changed.

## Evidence
- Build signed OK.
- Install OK:
  - bundle `com.skinharmony.analyzerpro.ipad`
  - installed URL `file:///private/var/containers/Bundle/Application/F4E2E78E-69B2-49D7-99E8-90E730F5A62C/SkinAnalyzerProiPad.app/`
- Normal launch OK and process alive.
- Headless smoke report:
  - `reports/ipad-analyzer/device-diagnostics/cf680_router_programming_smoke_2026-07-07/cf680_headless_smoke_latest.json`

## Blocking Condition
Current network does not expose CF680 SDK endpoints:
- `wifi_info_status`: failed on `192.168.1.1:40006`
- `GetDeviceVersion`: `-1`
- `StartVideo`: `-1`
- no capture image

This means the iPad is not currently talking to the camera SDK endpoint. It is likely on the internet/router network, where `192.168.1.1` is the router/nginx, not the CF680.

## Next Physical Test
1. Connect iPad to the CF680 hotspot/direct WiFi.
2. Open app settings CF680.
3. Press `Leggi rete`.
4. Enter router SSID/password.
5. Press `Programma router`.
6. Reconnect iPad to the same router/LAN.
7. Press `Verifica`, then `Avvia video`.

## Safety
- Do not call `setwifiinfo` automatically.
- Do not store the WiFi password.
- If password is longer than `20` bytes, the SDK wrapper will block it because the CF680 packet field is only `20` bytes.
