# Handoff - iPad Settings / Anamnesi CF680 Trust Block Resolved

Data: 2026-07-07
Area: iPad Analyzer
Bundle: `com.skinharmony.analyzerpro.ipad`
Device: `0183BC47-A31A-5F38-972B-F4C43D30B3DE`

## Fatto
- Analizzato crash reale da iPad: `SkinAnalyzerProiPad-2026-07-07-145155.ips`.
- Il crash punta a `ContentView.systemCF680Panel.getter` con `EXC_BAD_ACCESS/SIGSEGV` stack guard nel runtime Swift.
- Implementato fix:
  - trace persistente `AnalyzerRuntimeTrace`;
  - `AnamnesisEditorSheet`;
  - `systemAIKeysSummaryPanel`;
  - `CF680SettingsPanel` separato e piu piatto;
  - CF680 resta programmabile in `Impostazioni`.
- Build no-sign OK.
- Build firmata OK.
- Installazione iPad OK.

## Blocco risolto
- Il launch remoto inizialmente falliva prima del codice app:
  `profile has not been explicitly trusted by the user`.
- Dopo trust manuale su iPadOS, il launch remoto e riuscito.
- Fuori sandbox il certificato Mac e valido:
  `Apple Development: cristiancardarello77@gmail.com (J2P33C59LB)`.
- Il profilo include il device `00008132-001A195C3EB9001C` e scade `2026-07-14T08:54:34Z`.

## Verifica completata
- Launch diagnostico con `DEBUG_EXPORT_UI_SCREENSHOTS`: OK.
- Trace copiato: `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native/build/ui_route_trace_verified_after_trust.jsonl`.
- Screenshot copiati:
  - `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native/build/ui_screenshots_verified_after_trust/04_anamnesi.png`.
  - `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native/build/ui_screenshots_verified_after_trust/08_sistema.png`.
- Trace conferma:
  - `anamnesis_screen_appeared`
  - `system_screen_appeared`
  - `tap_cf680_verify`
  - `tap_cf680_open_video`
- Processo app vivo dopo verifica: PID `19785`.

## Audit
- Core input: `reports/universal-core/codex/inputs/ipad_cf680_swiftui_metadata_crash_core2_input_2026_07_07.json`
- Core report: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`
- Report: `reports/ipad-analyzer/IPAD_SETTINGS_ANAMNESIS_CF680_CRASH_FIX_2026-07-07.md`
