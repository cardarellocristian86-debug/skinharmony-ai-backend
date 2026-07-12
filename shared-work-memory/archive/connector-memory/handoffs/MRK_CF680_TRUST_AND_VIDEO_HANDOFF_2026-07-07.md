# Handoff - MRK CF680 iPad

## Stato

MRK/SkinAnalyzerProiPad e stata customizzata con bridge CF680 per controllo luci.

Build e install su iPad riuscite.

## Blocco immediato

L'avvio e bloccato dal trust del profilo sviluppatore sull'iPad:

`Unable to launch com.skinharmony.analyzerpro.ipad because it has an invalid code signature, inadequate entitlements or its profile has not been explicitly trusted by the user`

Cristian deve autorizzare su iPad:

`Impostazioni -> Generali -> VPN e gestione dispositivi -> Apple Development / Cristian Cardarello -> Autorizza`

Poi rilanciare:

```bash
xcrun devicectl device process launch --device 0183BC47-A31A-5F38-972B-F4C43D30B3DE com.skinharmony.analyzerpro.ipad
```

## File principali

- Progetto: `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native_vlm_standby_20260627_2026/SkinAnalyzerProiPad.xcodeproj`
- App build installata: `.tmp-xcode-derived-mrk-cf680-device/Build/Products/Debug-iphoneos/SkinAnalyzerProiPad.app`
- Report: `reports/ipad-analyzer/MRK_CF680_CUSTOMIZATION_2026-07-07.md`

## Prossimo passo tecnico

Testare in app i pulsanti luce con iPad collegato alla Wi-Fi della CF680.

Se le luci rispondono, step 2: integrare preview/capture CF680 completa (`StartVideo`, `TakePhoto`, notification/path capture) dentro MRK mantenendo il motore analisi SkinHarmony.

## Core

Core 2.0 ha selezionato `minimal_cf680_light_transport_first`.

Audit: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`
