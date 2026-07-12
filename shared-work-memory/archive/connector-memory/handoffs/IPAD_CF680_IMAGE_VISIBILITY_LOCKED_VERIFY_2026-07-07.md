# Handoff - iPad CF680 image visibility verify locked

## Stato
Fix immagini CF680 applicato, build firmata, installata e lanciata su iPad.

## File modificato
- `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native/SkinAnalyzerProiPad/TrichoCameraEngine.swift`

## Report
- `reports/ipad-analyzer/IPAD_CF680_IMAGE_VISIBILITY_FIX_2026-07-07.md`

## Core
- Input: `tmp/ipad-marker-work/cf680_images_core_input_2026-07-07.json`
- Report: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`
- Winner: `visible_capture_image_and_layout_safe_attach`

## Verifiche fatte
- Build no-sign OK.
- Build firmata OK con `DEVELOPMENT_TEAM=4SL9LFTHWD`.
- Firma: `Apple Development: cristiancardarello77@gmail.com (J2P33C59LB)`.
- Provisioning profile: `iOS Team Provisioning Profile: com.skinharmony.analyzerpro.ipad`.
- Installazione device OK.
- Bundle installato verificato con `devicectl device info apps`.
- Launch OK dopo sblocco iPad.
- Processo vivo: `SkinAnalyzerProiPad` PID `19980`.
- Diagnostica container copiata: `reports/ipad-analyzer/device-diagnostics/camera_diagnostics_latest_cf680_image_fix_2026-07-07.json`.
- Diagnostica camera: `ok=true`, `device_count=2`, `external_device_count=0`, generata `2026-07-07T15:15:31Z`.

## Blocco risolto
Primo launch da terminale bloccato per iPad locked:

`Unable to launch com.skinharmony.analyzerpro.ipad because the device was not, or could not be, unlocked`

Dopo sblocco fisico, il launch e riuscito.

## Prossimo passo
Con iPad connesso alla WiFi CF680:

1. Aprire `Inizia rilevamento`.
2. Avviare preview e fare uno scatto.
3. Atteso: live non parte con frame zero, immagine CF680 visibile dopo scatto, nessuna modifica a scoring/algoritmi.

Nota: `external_device_count=0` e atteso per CF680 WiFi/IP; non e una camera UVC per AVFoundation.
