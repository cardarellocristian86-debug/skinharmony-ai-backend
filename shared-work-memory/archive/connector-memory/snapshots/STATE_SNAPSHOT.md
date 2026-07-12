# STATE_SNAPSHOT

## Stato iPad Scalp UI report/preview fix 2026-07-10
- Dopo feedback owner, corretto il modulo `Scalp` per evitare doppio report e routing sbagliato verso `Skin Analyzer`.
- Core 2.0 usato come giudice: input `tmp/ipad_scalp_report_topbar_fix_core_input_2026_07_10.json`, winner `A_hide_skin_report_controls_in_scalp_module`, report canonico `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`, non bloccato.
- In `ContentView.swift`, quando `currentModule == .scalp` la barra modalita mostra solo `Scalp`, `Anamnesi`, `Export`; il bottone globale `Genera report` Skin viene nascosto e resta solo `Genera report Scalp` dentro il pannello Scalp.
- Aggiunta sezione `Preview immagini Scalp` con 5 card zona e riquadri `Finale`, `Bianca`, `Polar.`, `UV`, usando tap per preview grande come nel report Skin.
- Apertura storico Scalp aggiornata: ricarica immagini salvate da `scalp_images/*_final.jpg` e `scalp_images/*_light2/3/4.jpg` nelle card preview quando disponibili.
- Verifiche chiuse: `plutil` OK, build iOS generic no-sign OK fuori sandbox, build firmata iOS OK con provisioning automatico, install iPad OK su `com.skinharmony.analyzerpro.ipad`. Launch remoto ancora KO per timeout `CoreDeviceService` Apple dopo install riuscita.
- Report operativo: `reports/ipad-analyzer/IPAD_SCALP_UI_REPORT_PREVIEW_FIX_2026-07-10.md`.

## Stato iPad Scalp AI report + Nyra library 2026-07-10
- Aggiunto sopra il modulo `Scalp Analyzer` dell'app iPad `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native` un report AI operativo dedicato al cuoio capelluto.
- Core 2.0 usato come giudice: input `tmp/ipad_scalp_ai_report_scoped_core_input_2026_07_10.json`, winner `B1_local_scalp_ai_report_pdf_history`, report canonico `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`, non bloccato.
- `AnalyzerAIClient.swift` ora distingue `analysisModule=skin/scalp`; il ramo Scalp genera anamnesi, baseline prima seduta, zona prioritaria, problema, causa possibile, soluzione e piano operativo con linguaggio non diagnostico.
- `AnalyzerSettings.swift` ora espone librerie/policy Scalp per setup: estetica `nyra_scalp_consulente_tricologico_estetico_v1`, farmacia `nyra_scalp_consulente_tricologico_dermocosmetico_v1`, medico `nyra_scalp_medico_tricologico_linguaggio_osservazionale_v1`.
- Il profilo medico Scalp resta osservazionale: vietate diagnosi automatiche, prescrizioni, prognosi e promesse di ricrescita.
- `ScalpReportFileSystem` salva snapshot, confronto, report testo, diagnostics, immagini `scalp_images`, PDF `SkinHarmony_Analyzer_Report.pdf` e `SkinHarmony_Scalp_Report.pdf`, piu manifest.
- `ClientHistoryStore` ora salva `reportKind=skin/scalp`; lo storico Skin filtra fuori le sedute Scalp e la riapertura di un report Scalp torna nel modulo Scalp.
- UI aggiornata con pulsante `Genera report Scalp` e pannello `Report AI Scalp`.
- Verifiche chiuse: build iOS generic OK, build firmata iPad OK, install iPad OK su `com.skinharmony.analyzerpro.ipad`. Launch remoto da terminale fallito per timeout `CoreDeviceService` Apple dopo installazione riuscita.
- Report operativo: `reports/ipad-analyzer/IPAD_SCALP_AI_REPORT_NYRA_LIBRARY_2026-07-10.md`.
- Limite residuo: librerie Nyra Scalp dichiarate e usate nel livello app/report/diagnostics; non ancora promosse come nuovo branch-learning runtime su Nyra/Core Render.

## Stato iPad MRK Scalp module capture 2026-07-10
- Inserito il modulo `Scalp Analyzer` nell'app iPad attiva `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native`, con accesso da modulo/tab e workflow scalp dedicato.
- Core 2.0 usato come giudice: winner `B_main_module_plus_dedicated_scalp_capture`, report canonico `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`, non bloccato.
- Implementate 5 zone scalp dedicate: frontale, vertex, tempia sinistra, tempia destra, occipitale.
- Ogni zona acquisisce stack luce CF680 bianca/polarizzata/UV; il pulsante hardware CF680 in modalita Scalp scatta la zona corrente.
- L'analisi scalp usa immagini `scalp_*` dedicate se presenti, evitando di riusare immagini skin quando esiste una sessione scalp.
- Output scalp esposti: densita, calibro fusto, miniaturizzazione, unita singole/doppie-triple, osti vuoti, spezzati, desquamazione, sebo/tappi, rossore, ostio visivo e confidenza.
- Verifiche chiuse: `plutil` OK, build iOS generic OK, build firmata iPad OK, install iPad OK, launch remoto OK, export screenshot UI copiato in `reports/ipad-analyzer/device-diagnostics/scalp_ui_screenshots_2026-07-10/`.
- Report operativo: `reports/ipad-analyzer/IPAD_MRK_SCALP_MODULE_CAPTURE_2026-07-10.md`.
- Limite residuo: calibro/spessore capello resta indice visivo pixel-based; per micron reali serve calibrazione con target fisico noto.

## Stato Nyra / Core multiuser Render test 2026-07-09
- Eseguito test live multi-software su Render con `50` scenari / `50` utenti logici e concorrenza `10`, usando davvero Nyra/Core live come path operativo.
- Runner: `tmp/nyra_multiuser_render_test_2026_07_09.mjs`
- Output JSON: `SHARED_MEMORY/reports/NYRA_MULTIUSER_50_RENDER_TEST_2026-07-09.json`
- Report canonico: `SHARED_MEMORY/reports/NYRA_RENDER_MULTIUSER_50_TEST_2026-07-09.md`
- Esito finale valido:
  - `pass_rate = 100%`
  - `avg_ms = 12260.32`
  - `p50 = 12365 ms`
  - `p95 = 16671 ms`
  - `branch_learning_coverage = 100%`
  - `cortex_coverage = 100%`
- Per software:
  - `translator_plugin = 100%`
  - `smartdesk = 100%`
  - `suite_wordpress = 100%`
  - `security_ops = 100%`
  - `skin_analyzer_pro = 100%`
  - `developer_runtime = 100%`
- Collo chiusi nel giro:
  - routing ibrido `developer + device/app/backend`
  - `analyzer/read-only` allineato con `branch_learning + cortex_graph`
  - persistenza `text-chat` hardenizzata contro parse crash JSON
  - `read-only` stabilizzato con timeout piu larghi e refresh `vector-memory` deduplicato
- Commit Render rilevanti:
  - `1f6d40a` `nyra: fix developer routing and analyzer cortex bridge`
  - `64057c4` `nyra: harden ultra store persistence`
  - `934893c` `nyra: widen read-only runtime timeouts`
  - `f6890e8` `nyra: dedupe read-only vector memory refresh`

## Stato Core / Nyra governed adaptive cognition 2026-07-09
- Estensione locale chiusa oltre il semplice `feedback_loop`: Nyra ora usa anche rinforzo sinaptico tra rami e un blocco esplicito `adaptive_cognition`.
- File chiave aggiornati:
  - `universal-core-2.0/tools/nyra-branch-overlay.ts`
  - `universal-core-2.0/tools/nyra-cortex-graph.ts`
  - `services/universal-core-service/branches/branch-taxonomy.js`
  - `universal-core-2.0/tools/nyra-branch-composer-shared.js`
  - `universal-core-2.0/tools/nyra-branch-composer-shared.cjs`
- Effetto reale:
  - overlay non piu solo lessicale;
  - secondari rafforzati dal grafo sinaptico;
  - `cortex_graph` ora espone `adaptive_cognition`;
  - note runtime ora includono anche `Adattamento`.
- Limiti stabili esplicitati nel runtime:
  - `no_weight_training`
  - `no_consciousness_claim`
  - `no_free_self_learning`
  - `no_policy_activation_without_verify`
  - `no_production_write_without_gate`
- Test locali:
  - translator -> primary `translator_marketing_governance`
  - security -> primary `codex_security_guard`
  - multi-domain -> primary `beauty_vertical_orchestration`
- Prestazioni warm misurate:
  - translator `5.976 ms`
  - security `4.397 ms`
  - multi-domain `92.088 ms`
- Report operativo: `SHARED_MEMORY/reports/CORE_NYRA_GOVERNED_ADAPTIVE_COGNITION_2026-07-09.md`

## Stato Core / Nyra omni-360 cortex Render promotion 2026-07-09
- Promozione chiusa sul repo Render reale `/Users/cristiancardarello/skinharmony-ai-backend` con commit `a37f50f` (`core: promote omni 360 cortex graph to nyra render runtime`).
- Gate legacy `127.0.0.1:3199` ancora `core_unreachable`; usato `Core 2.0 locale` come fallback giudice. Input: `tmp/core_nyra_cortex_extension_core2_input_2026_07_09.json`; report canonico `reports/universal-core/codex/codex_core_decision_latest.json`; winner: `full_registry_cortex_graph_with_nyra_learning_cycle`.
- Render repo taxonomy verificata localmente:
  - `branch_count = 57`
  - `max_depth = 20`
  - `node_count = 949`
  - `synapse_count = 346`
  - `group_count = 16`
- Benchmark locale sul runtime Render:
  - `cold_translator = 336.497 ms`
  - `warm_translator = 281.261 ms`
  - `cold_security = 200.003 ms`
  - `warm_security = 175.113 ms`
- Stato live verificato:
  - `https://skinharmony-universal-core.onrender.com/healthz` -> `200`
  - `https://skinharmony-nyra-core.onrender.com/healthz` -> `200`
- Nyra live `read-only` e `text-chat` ora espongono davvero:
  - `branch_overlay.overlay_model = omni_360_cortex`
  - `cortex_graph`
  - `learning_cycle`
  - summary `Cortex: profondita 20, rami 6/57, fase intent_router`
- Prompt translator live instradato correttamente su:
  - `primary_branch.id = translator_marketing_governance`
  - top branches: `translator_marketing_governance`, `translation_governance`, `marketing_copy`
- Confine stabile: questo e un `cortex graph governato` con memoria distillata e policy reweighting; non e training dei pesi e non va descritto come `cervello vero`.

## Stato Core / Nyra omni-360 cortex local extension 2026-07-09
- Direzione owner: estendere il modello `Core + Nyra 360` a tutti i rami reali, con struttura tipo cortex/neuroni/sinapsi, profondita minima `20` e autoapprendimento solo governato.
- Core 2.0 locale usato come giudice fallback perche il gate legacy `127.0.0.1:3199` resta `core_unreachable`. Input: `tmp/core_nyra_cortex_extension_core2_input_2026_07_09.json`; report canonico `reports/universal-core/codex/codex_core_decision_latest.json`; winner: `full_registry_cortex_graph_with_nyra_learning_cycle`.
- `services/universal-core-service/branches/branch-taxonomy.js` e stato riscritto come `branch_taxonomy_v2` generata dal registry completo `BRANCHES + BRANCH_GROUPS`, non piu da nodi manuali parziali.
- Taxonomy locale aggiornata:
  - `branch_count = 32`
  - `max_depth = 20`
  - `node_count = 551`
  - `synapse_count = 147`
  - learning cycle strutturale: `telemetry_capture -> memory_distillation -> feedback_loop -> policy_reweighting -> synaptic_consolidation`
- `services/universal-core-service/branches/index.js` ora espone `deterministicBranchTaxonomy()` costruita dal registry reale, quindi tutti i rami entrano nel cortex graph.
- `universal-core-2.0/tools/nyra-branch-overlay.ts` ora legge tutti i branch reali del Core locale, piu 4 branch meta Nyra (`nyra_voice`, `memory_learning`, `event_audit`, `render_boundary`), e produce overlay `omni_360_cortex`.
- Nuovo file `universal-core-2.0/tools/nyra-cortex-graph.ts`: costruisce `cortex_graph` dai path attivi e dalle sinapsi attive della taxonomy.
- `universal-core-2.0/tools/nyra-branch-learning.ts` ora ha fallback dinamico per tutti i rami non esplicitamente mappati, con fonti inferite per software/hardware/security/learning/beauty/translator-suite.
- Runtime Nyra locali allineati:
  - `read-only`
  - `local-governance`
  - `text-chat`
  espongono ora anche `cortex_graph`; `ui.notes` e summary line riportano `Cortex: profondita, rami, fase`.
- Smoke locali chiusi:
  - taxonomy `branch_taxonomy_v2` -> OK
  - `buildNyraReadOnlyCommunication(...)` -> primary `translator_marketing_governance`, depth `20`
  - `runNyraTextChatTurn(...)` -> primary `translator_marketing_governance`, depth `20`
  - `nyra-local-governance --json --no-event ...` -> overlay e cortex graph coerenti
- Report operativo: `SHARED_MEMORY/reports/CORE_NYRA_OMNI_360_CORTEX_LOCAL_EXTENSION_2026-07-09.md`

## Stato Core / Nyra / Codex 360 Render-first 2026-07-09
- Direzione owner: non usare piu `Core 2.0 locale` come default quotidiano di Codex; portare il default su `Render/Core`, usare una API key/preset `Nyra + Core 360` non limitata a pochi rami dedicati e approfondire la struttura rami come tassonomia/cervello con collegamenti profondi.
- Core 2.0 locale usato come giudice fallback perche il gate legacy `127.0.0.1:3199` resta `core_unreachable`. Winner selezionato: `A_render_first_compatible_bridge`; input `tmp/core2_render_branch_taxonomy_promotion_core2_input_2026_07_09.json`; report canonico `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Workspace chiuso: `packages/core-codex-connector/src/cli.mjs` e `README.md` ora impostano `Render/Core` come default (`https://skinharmony-universal-core.onrender.com`), con laboratorio `Core 2.0 locale` solo opt-in. Il profilo `core-first.env` nuovo non forza piu `SH_CORE_LAB_2_0=1` o `SH_CORE_REQUIRE_2_0=1`.
- Core service locale arricchito con nuovi rami:
  - `software_systems_intelligence`
  - `hardware_systems_intelligence`
  - `software_security_intelligence`
  - `network_security_intelligence`
  - `infrastructure_runtime_intelligence`
  - `learning_knowledge_intelligence`
  - `beauty_vertical_orchestration`
- Nuova tassonomia locale `branch_taxonomy_v1`: profondita reale verificata `20`, nodi `54`, sinapsi `11`; package `omni_360`; preset `nyra_core_360_connector`; gruppi `software_cortex`, `hardware_cortex`, `security_cortex`, `learning_cortex`, `beauty_cortex`, `translator_marketing_cortex`; endpoint locale `GET /v1/branches/taxonomy`.
- Promozione repo Render eseguita su `/Users/cristiancardarello/skinharmony-ai-backend` con commit `626b722702e5092baa168d45c33e300ecd7a8902` (`core: add 360 cortex taxonomy and render-first connector support`), fix route `f540a3e` (`core: fix taxonomy route registration`) e marker rollout `49af92d` (`core: bump version for taxonomy route rollout`). Smoke del servizio repo Render OK: versione test `0.3.18-branch-taxonomy-cortex`, preset `nyra_core_360_connector` presente, `resolveBranchesForKey` su quel preset -> `tier=omni_360`, `allowed_branches=57`.
- Stato live verificato: `https://skinharmony-universal-core.onrender.com/healthz` attivo; verify autenticato con key locale scoped chiuso su `GET /v1/branches=200`, `GET /v1/branches/taxonomy=200`, `GET /v1/tenant/status=200`, `GET /v1/branches/authorized?branches=software_cortex,beauty_cortex=200`. Taxonomy live: `max_depth=20`, `node_count=54`, `synapses=11`; package `omni_360` presente; gruppi live `software_cortex`, `hardware_cortex`, `security_cortex`, `learning_cortex`, `beauty_cortex`; autorizzazione live corretta con `selected_groups=[software_cortex, beauty_cortex]` e `selected_branches_count=19`.
- Report operativo: `SHARED_MEMORY/reports/CORE_RENDER_FIRST_CORTEX_TAXONOMY_2026-07-09.md`.

## Stato iPad CF680 router programming patch 2026-07-07
- Dopo richiesta owner di risolvere end-to-end la tricocamera WiFi, usato Core 2.0 locale come gate: winner `manual_router_programming_ui_private_sdk`; report canonico `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`; input `tmp/ipad-marker-work/cf680_router_programming_core_input_2026-07-07.json`.
- Ramo Nyra/subagent read-only ha confermato: demo MRK iOS usa solo hotspot diretto `192.168.1.1`; SDK pubblico non espone router; simboli privati `_getwifiinfo` e `_setwifiinfo` lavorano su porta `40006`, packet `60` byte, SSID `32` byte, password `20` byte, `wifi_mode` a offset `58`.
- Patch applicata in `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native`: bridge `SkinHarmonyCF680Bridge` espone `wifiInfoStatusForIP` e `programRouterWiFiStatusForIP:ssid:password`; UI CF680 in impostazioni aggiunge campi temporanei SSID/password e azioni `Leggi rete` / `Programma router`. La password non viene salvata e viene svuotata dopo il comando. Nessuna modifica a skin/scalp scoring.
- Build generic no-sign OK fuori sandbox, build firmata device OK, install iPad OK su `com.skinharmony.analyzerpro.ipad`, launch normale OK e processo vivo (`PID 20149`). App installata finale: `file:///private/var/containers/Bundle/Application/F4E2E78E-69B2-49D7-99E8-90E730F5A62C/SkinAnalyzerProiPad.app/`. App build circa `74M`.
- Diagnostica headless aggiornata con `wifi_info_status` copiata in `reports/ipad-analyzer/device-diagnostics/cf680_router_programming_smoke_2026-07-07/cf680_headless_smoke_latest.json`: `wifi_info_status=failed: CF680 WiFi non raggiunta su 192.168.1.1:40006`, `GetDeviceVersion=-1`, `StartVideo=-1`, `capture_image_present=false`.
- Verdetto reale: lato app ora esiste il path router controllato, ma nello stato rete corrente l'iPad non raggiunge la CF680. `192.168.1.1` non risponde come endpoint SDK CF680; va fatto test fisico con iPad collegato all'hotspot CF680, poi `Leggi rete` -> `Programma router` -> rientro su router/LAN -> `Verifica`/`Avvia video`.
- Report: `reports/ipad-analyzer/IPAD_CF680_ROUTER_PROGRAMMING_PATCH_2026-07-07.md`; handoff: `SHARED_MEMORY/handoffs/CF680_ROUTER_PROGRAMMING_HANDOFF_2026-07-07.md`.

## Stato iPad CF680 WiFi router/handshake fallback 2026-07-07
- Dopo test reale owner sulla nuova tricocamera WiFi, la app iPad e stata aggiornata per non trattare `GetDeviceVersion` come gate bloccante: se `http://192.168.1.1` o IP router risponde, l'app entra comunque in modalita CF680 e prova `StartVideo`, coerente con il demo MRK.
- Diagnostica reale prima del fix: `http_reachability ok=true`, HTTP `200`, server `nginx`, ma `GetDeviceVersion=-1`; AVFoundation resta `external_device_count=0`, atteso per camera WiFi non UVC.
- Aggiunti controlli in app: Hotspot/Router, IP camera, zoom normale/ingrandito, overlay sebo/idratazione, path catture, eventi SDK `.jpg/.mp4/key0/key1`, luci normale/polarizzata/UV.
- Non usate funzioni private `_setwifiinfo/_getwifiinfo`: il SDK pubblico non espone configurazione sicura SSID/password router.
- Sebo/sensori: SDK pubblico espone solo `DisplayOil(0/1)` per overlay oil/moisture sui dispositivi 3 spettri; nessuna API pubblica per raw sensor separato o misura diretta strisce sebo.
- Verifiche: `plutil` OK, build iOS generic no-sign OK, build firmata device OK, reinstall su iPad M4 `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK senza uninstall/reset. Dopo sblocco iPad, launch remoto OK e diagnostica post-fix copiata: `sdk_handshake_ok=true`, `connection_ready_for_startvideo=true`, `device_version_status=sent: CF680 online 192.168.1.1 - 20190923_V2.5`. AVFoundation resta `external_device_count=0`, atteso per WiFi.
- Report: `reports/ipad-analyzer/IPAD_CF680_ROUTER_CONTROLS_AND_HANDSHAKE_FALLBACK_2026-07-07.md`. Core input handshake: `reports/universal-core/codex/inputs/ipad_cf680_http_reachable_handshake_fallback_core2_input_2026_07_07.json`.
- Dopo feedback owner che Impostazioni non si aprivano e la camera non si vedeva, applicato fix `normal_calayer_host_plus_capture_quick_controls`: CF680 usa ora un host `UIView.layer` normale invece del root `AVCaptureVideoPreviewLayer`; aggiunti ingranaggio impostazioni in topbar/header e riga rapida CF680 in Acquisizione con verifica/start/impostazioni. Build generic OK, build firmata OK, reinstall iPad OK, launch OK. Diagnostico finale: `ok=true`, `network_ok=true`, HTTP `200 nginx`, `connection_ready_for_startvideo=true`; verifica visiva preview da fare fisicamente nella UI con pulsante video CF680.

## Stato iPad MRK/CF680 six-zone engine merge 2026-07-07
- Direzione owner: inserire il nuovo algoritmo MRK nel workspace iPad attivo, rifare Skin a 6 zone e mantenere la parte evoluta SkinHarmony gia costruita.
- Core 2.0 ha selezionato `merge_mrk_engine_cf680_six_zone_preserve_product`; report canonico `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`; non bloccato.
- Workspace attivo modificato: `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native`.
- Inseriti nel target iPad `SkinHarmonyCF680Bridge.h/.mm`, `CF680SDK/cf680SDK.h` e `CF680SDK/libcf680SDK.a`; aggiornati bridging header, Xcode project, header/library search path, `-lcf680SDK`, `Info.plist` local network/ATS e `TrichoCameraEngine.swift` per provare prima il trasporto CF680.
- Flusso Skin standard ora a 6 zone: `forehead_central`, `periocular`, `left_cheek`, `nose_wings`, `nasolabial_smile_line`, `nose_t_zone`. `chin` e `lateral_face` restano solo mapping legacy per archivi/import vecchi.
- Parte evoluta preservata: multi-zona SkinHarmony, marker/3D, report premium, Nyra/Core locale, prodotti, protocolli, lettura topografica. `FS` non viene sovrascritto se arriva gia score importato/MRK. Integrate aggiunte MRK fallback marker/signal in `YF` e `XW`.
- Pulizia wording eseguita: scan senza match per `HotImgProc`, `JNI`, `Ghidra`, `lettura originale Android`, `# Android-compatible`, `Fixture Android`, `OpenCV Mat Android` nei sorgenti controllati.
- Verifiche: `plutil` OK; build Xcode iOS generic no-sign fuori sandbox OK (`exit 0`), app generata `tmp/xcode-derived-mrk-cf680/Build/Products/Debug-iphoneos/SkinAnalyzerProiPad.app` circa `72M`. Warning residui non bloccanti: AVFoundation concurrency, OpenCV header, orientamenti/launch storyboard.
- Report: `reports/ipad-analyzer/IPAD_MRK_CF680_SIX_ZONE_ENGINE_MERGE_2026-07-07.md`. Non installato su iPad in questo blocco.

## Stato iPad MRK/CF680 install + verifica tricocamera 2026-07-07
- Dopo richiesta owner `installa su ipad e verifica che vede la tricocamera`, Core 2.0 ha selezionato `signed_build_install_same_bundle_then_camera_diagnostics`; input `reports/universal-core/codex/inputs/ipad_mrk_cf680_install_verify_core2_input_2026_07_07.json`; report canonico `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Build firmata device OK su iPad M4 `0183BC47-A31A-5F38-972B-F4C43D30B3DE`, derived data `/private/tmp/skinharmony-ipad-mrk-cf680-install`, app circa `72M`.
- Installazione OK sopra `com.skinharmony.analyzerpro.ipad`, senza uninstall e senza reset dati. Install URL: `file:///private/var/containers/Bundle/Application/C1668941-9EE6-4BD5-9E06-8F5EB818BCBF/SkinAnalyzerProiPad.app/`.
- Launch remoto OK con `--export-camera-diagnostics-on-launch`; diagnostica copiata in `reports/ipad-analyzer/device-diagnostics/camera_diagnostics_latest_2026-07-07.json`.
- Verdetto diagnostica: `device_count=2`, `external_device_count=0`; iPadOS/AVFoundation vede solo `Back Camera` e `Front Camera`. In questo momento la tricocamera non risulta esposta all'app come camera esterna/UVC. Se era collegata/alimentata, il collo e riconoscimento iPadOS/cavo/hub/adattatore o modalita camera; se non era collegata, va ricollegata e ripetuta diagnostica.
- Report: `reports/ipad-analyzer/IPAD_MRK_CF680_INSTALL_AND_TRICHOCAMERA_VERIFY_2026-07-07.md`.

## Stato CF680 WiFi discovery Mac/MRK 2026-07-07
- Dopo nota owner che la nuova tricocamera e WiFi, controllo Mac read-only: via USB/cavo non compare una CF680/UVC/camera; `ioreg` mostra hub VIA, `USB C Video Adaptor`, `iPad`, Realtek `USB 10_100_1000 LAN` e `Sabrent dock`.
- Via rete l'endpoint `http://192.168.1.1` risponde `HTTP/1.1 200 OK` con server `nginx`, quindi il device/servizio WiFi e raggiungibile dal Mac.
- SDK MRK conferma trasporto IP su `192.168.1.1`: `GetDeviceVersion`, `StartVideo`, `SetVideoRect`, `SetCaptureImageView`, `TakePhoto`, `SetLight`.
- Stato app attuale: `SkinHarmonyCF680Bridge.mm` usa solo `GetDeviceVersion` e `SetLight`; il percorso preview/scatto resta AVFoundation. Per vedere davvero la CF680 WiFi nella nostra app serve integrare il path SDK video/capture MRK con gate Core dedicato.
- Core 2.0 winner per questo blocco documentale: `write_report_memory_only`; input `reports/universal-core/codex/inputs/ipad_cf680_wifi_discovery_core2_input_2026_07_07.json`; report `reports/ipad-analyzer/IPAD_CF680_WIFI_DISCOVERY_2026-07-07.md`.

## Stato Site Suite 5.3.55 - manifest/package live allineati 2026-07-06
- Dopo comando owner `procedi`, Core 2.0 ha selezionato `Upload verified 5.3.55 package and align manifest`; input `tmp/suite_5_3_55_manifest_package_fix_core2_input_2026_07_06.json`; report canonico `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Prima del fix live: plugin WordPress `5.3.55` e Page Quality OK, ma manifest update-server con `stable_version/current_origin_version=5.3.55` puntava ancora allo zip `.54`, quindi `distribution_ready=false`.
- Eseguita scrittura live limitata: upload WordPress Media dello zip verificato `dist/skinharmony-site-suite-5.3.55.zip` e riallineamento manifest update-server. Nessun cambio a clienti, prezzi, tenant, checkout, contenuti pubblici, Product Inventory o Technology Inventory.
- Package live finale: `https://www.skinharmony.it/wp-content/uploads/2026/07/skinharmony-site-suite-5.3.55.zip`, HEAD HTTP `200`, `content-type=application/zip`, `content-length=892968`.
- Manifest finale: `stable_version=5.3.55`, `current_origin_version=5.3.55`, `package_url_matches_version=true`, `distribution_ready=true`, `automatic_install_enabled=false`, rollback `.48`.
- Verifica read-only finale: `status version=5.3.55`; `page-quality-audit ok=true failed=0 blocking_failed=0 advisory_items=1`; update governance `readiness_level=staging_required`, `live_update_allowed=false`, `automatic_install_enabled=false`.
- Fuori scope confermati: Product Inventory resta `total=0`; Technology Inventory resta `total=11`, `price_pending=7`, `factory_cost_review=7`.
- Report: `reports/wordpress/SITE_SUITE_5_3_55_MANIFEST_PACKAGE_ALIGNMENT_2026-07-06.md`; report JSON script `reports/wordpress/suite_5_3_55_package_upload_manifest_alignment_latest.json`.

## Stato Site Suite 5.3.55 - Page Quality Audit Contract locale 2026-07-03
- Direzione owner: partire dal punto 3 (`Page Quality Audit`) e lasciare fuori Product Inventory e prezzi delle 7 tecnologie pending; per ora serve chiudere codice/contratto.
- Core 2.0 ha selezionato `Patch Page Quality contract semantics in 5.3.55`; input `tmp/suite_5_3_55_page_quality_audit_core2_input_2026_07_03.json`; report canonico `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Causa live `5.3.54`: `page-quality-audit ok=false` su `10` item per falsi blocchi del contratto: metadata Suite richiesti anche su pagine manuali, meta description senza fallback, checkout trattato come landing lunga, bozza conteggiata come blocco pubblico.
- Fix locale `5.3.55`: Page Quality distingue blocchi pubblici reali da advisory; metadata Suite solo per pagine generate/gestite; pagine manuali hanno soglia bloccante `520` e target premium `750`; checkout ha soglie transazionali; bozze non bloccano readiness pubblica; meta description con fallback da excerpt/contenuto e source tracking.
- Payload aggiornato con `blocking_failed`, `advisory_items`, `blocks_public_release`, `page_contract`, `failed_checks`, `advisory_checks`.
- Verifiche: PHP lint completo OK, JS admin OK, functional stub Page Quality OK, Suite local test `1718/1718`, Program Registry READY, operational closure OK, release preflight `22/22`, zip scan mirato senza dati/prezzi/endpoint/chiavi.
- Package locale: `dist/skinharmony-site-suite-5.3.55.zip`, alias `dist/skinharmony-site-suite.zip` e `dist/skinharmony-site-suite-latest.zip`, SHA256 `f808bc88f3fa465927712eafbc06b5e46afcd6b29a1252142c19b984854e5049`; manifest locale `stable/current/version=5.3.55`, installazione automatica disattivata.
- Copia esterna completata dopo Core 2.0 input `tmp/suite_5_3_55_external_copy_core2_input_2026_07_03.json`: set completo in `/Volumes/Esterno/MEC/dist/`, zip versionato in `/Volumes/Esterno/MEC/priority_backup_2026-06-15/dist/`; alias priority backup preservati su `.48`.
- Nessun upload WordPress live in questo step: produzione resta `5.3.54` finche owner non installa manualmente `.55`. Dopo install serve verifica endpoint `status` e `page-quality-audit`.
- Report: `reports/wordpress/SITE_SUITE_5_3_55_PAGE_QUALITY_AUDIT_CONTRACT_2026-07-03.md`.

## Stato Site Suite 5.3.54 - post install manifest alignment live 2026-07-02
- Dopo installazione manuale owner della `.54`, verifica read-only live OK su plugin attivo `5.3.54`, `framework-health` e `compatibility-contract`.
- Gap trovato: il manifest update-server aveva `stable_version/current_origin_version=5.3.54` ma `package_url` puntava ancora a `skinharmony-site-suite-5.3.53.zip`; media WordPress `.54` assente.
- Core 2.0 ha selezionato `Upload verified 5.3.54 package and align manifest`; input `tmp/suite_5_3_54_manifest_package_fix_core2_input_2026_07_02.json`; report canonico `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Eseguita scrittura live limitata: upload WordPress Media dello zip verificato `dist/skinharmony-site-suite-5.3.54.zip` e riallineamento manifest update-server. Nessun cambio a dati clienti, prezzi, tenant, checkout, contenuti pubblici, Product Inventory o Technology Inventory.
- Package live finale: `https://www.skinharmony.it/wp-content/uploads/2026/07/skinharmony-site-suite-5.3.54.zip`, HEAD HTTP `200`, `content-type=application/zip`, `content-length=891722`.
- Manifest finale: `stable_version=5.3.54`, `current_origin_version=5.3.54`, `package_url_matches_version=true`, `distribution_ready=true`, `automatic_install_enabled=false`, rollback `.48`.
- Update governance finale: `readiness_level=canary_only`, `live_update_allowed=false`, `automatic_install_enabled=false`.
- Compatibility contract finale: `ok=true`, `checks_total=19`, `checks_failed=0`, `release_allowed_by_contract=true`, `source_scope=modular_source_bundle`, `source_files_scanned=55`.
- Gap residui live: Product Inventory `total=0`; Technology Inventory `total=11`, `missing_woocommerce=8`, `price_pending=7`, `factory_cost_review=7`; Page Quality Audit `ok=false`, `items=10`.
- Report: `reports/wordpress/SITE_SUITE_5_3_54_POST_INSTALL_MANIFEST_ALIGNMENT_2026-07-02.md`; report JSON script `reports/wordpress/suite_5_3_54_package_upload_manifest_alignment_latest.json`.

## Stato Site Suite 5.3.54 - compatibility contract hotfix locale 2026-07-02
- Chiuso localmente il primo gap tecnico post audit `5.3.53`: il falso negativo di `compatibility-contract` su `rest_framework-health`. Causa: il checker leggeva solo `skinharmony-site-suite.php`, mentre la route `framework-health` vive nel sidecar `core/class-shss-bootstrap.php`.
- Core 2.0 ha selezionato la variante `Hotfix 5.3.54 source-bundle compatibility scan`; input `tmp/suite_5_3_54_compatibility_contract_core2_input_2026_07_02.json`.
- `modules/compatibility-contract/class-module.php` ora legge un bundle controllato: monolite, sidecar core e `modules/*/class-module.php`; il payload resta read-only e dichiara `source_scope=modular_source_bundle` e `source_files_scanned`.
- Versione locale aggiornata a `5.3.54`; documentati README, Program Registry block 13 e `OPERATIONS.md`. Nessun dato SkinHarmony/listino/endpoint/chiave inserito nel plugin.
- Verifiche: PHP lint OK, JS admin OK, Program Registry READY, functional compatibility contract stub `ok=true failed=[] source_files_scanned=55`, Suite local test `1718/1718`, release preflight `22/22`, operational closure OK.
- Package locale: `dist/skinharmony-site-suite-5.3.54.zip`, alias `dist/skinharmony-site-suite.zip` e `dist/skinharmony-site-suite-latest.zip`, SHA256 `54fa974cc8beb4187d32ba666cb4cf1d31ac9244c4462eb70407850afec49759`; manifest locale `stable/current/version=5.3.54`, `automatic_deploy_enabled=false`, `wordpress_live_write_enabled=false`.
- Copia hard disk esterno completata dopo Core 2.0 input `tmp/suite_5_3_54_external_copy_core2_input_2026_07_02.json`: set completo in `/Volumes/Esterno/MEC/dist/`, zip versionato anche in `/Volumes/Esterno/MEC/priority_backup_2026-06-15/dist/`; alias storici del priority backup non sovrascritti.
- Report: `reports/wordpress/SITE_SUITE_5_3_54_COMPATIBILITY_CONTRACT_HOTFIX_2026-07-02.md`. Nessun upload WordPress live, nessuna modifica produzione, clienti, prezzi, Product Inventory, Technology Inventory o contenuti pubblici.

## Stato Site Suite 5.3.53 - deep flow audit 2026-07-01
- Audit dettagliato read-only completato su Site Suite `5.3.53`: codice locale, documenti programma, 50 moduli sidecar, 10 core engine, menu admin, route REST live e test locali. Nessuna modifica a plugin, WordPress, clienti, prezzi, contenuti, Smart Desk o produzione.
- Core 2.0 usato prima di scrivere il report locale: winner `write_readonly_deep_audit_report_and_memory_event_only`, report canonico `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`, input `tmp/site_suite_deep_audit_core2_input_2026_07_01.json`.
- Evidenza tecnica: plugin live/installato `5.3.53`, manifest/package gia allineati; suite local test `1715/1715`, PHP lint tutti i file OK, admin JS check OK, Program Registry `READY`.
- Evidenza live read-only: route SHSS live `162`; endpoint GET statici controllati `122`; HTTP `200` su `121`; `403` atteso su config bundle senza App Key; applicativi non OK `4` (`compatibility-contract` falso negativo probabile su `framework-health`, `page-quality-audit` non chiuso, `config-bundle` senza App Key, `templates/package` senza `template_id`).
- Verdetto: Suite `5.3.53` e release tecnica governata e sana per managed pilot/staging; non e ancora chiusa al 100% come ecosistema commerciale automatico/dogfood pieno. Gap principali: Product Inventory `0`, Technology Inventory 11 item con 7 pending review, dogfood score `80`, commercial readiness `blocked_governance` score `88`, sellability `lead_generation_ready` score `85`, template clone richiede evidenza responsive, update governance `canary_only`, endpoint governance pesanti/lenti.
- Report dettagliato: `reports/wordpress/SITE_SUITE_5_3_53_DEEP_FLOW_AUDIT_2026-07-01.md`.
- Dopo feedback owner che mancava la spiegazione completa, creato report v2 operativo: `reports/wordpress/SITE_SUITE_5_3_53_COMPLETE_OPERATING_MODEL_2026-07-01.md`. Spiega cosa fa la Suite, come funziona, come comunica, come ragiona, voci admin, moduli, route, storage, Core/Nyra, pricing, claim, Smart Desk Bridge, update governance e flussi end-to-end. Scrittura autorizzata da Core 2.0 con input `tmp/site_suite_operating_model_report_core2_input_2026_07_01.json`; memoria aggiornata con input `tmp/site_suite_operating_model_memory_core2_input_2026_07_01.json`.

## Stato Site Suite post-upload live 5.3.53 - verifica read-only 2026-07-01
- Owner ha caricato manualmente Site Suite `.53`. Verifica read-only live eseguita senza scritture WordPress: plugin `skinharmony-site-suite/skinharmony-site-suite` installato, attivo e versione `5.3.53`.
- Endpoint principali OK: `/wp-json/shss/v1/status` `ok=true version=5.3.53`; WaaS status `readiness_score=100` e `checks_passed=7/7`; onboarding `completion_pct=100` e `missing_fields=[]`; Smart Desk Bridge `manual_sync_ready`, `configured=true`, `last_test_code=200`; Product Inventory ancora `0`.
- Primo controllo aveva trovato manifest live con `stable_version=5.3.53` e `current_origin_version=5.3.53`, ma `package_url` ancora su `https://www.skinharmony.it/wp-content/uploads/2026/07/skinharmony-site-suite-5.3.50-1.zip`; quel package era davvero `.50` SHA256 `368e4bead1fe3e555b9d3d84814a1a4a99cb239a6febca69c8b6bbd896ab68d7`.
- Dopo conferma owner `procedi`, Core 2.0 ha selezionato `upload_verified_5_3_53_zip_then_update_manifest_url`. Eseguita scrittura live limitata: upload media WordPress dello zip agnostico verificato e update nativo del manifest update-server. Nessun tocco a plugin attivo, prezzi, clienti, contenuti, Product Inventory o impostazioni commerciali.
- Package live finale: media ID `2308`, `https://www.skinharmony.it/wp-content/uploads/2026/07/skinharmony-site-suite-5.3.53.zip`, SHA256 `9c36756d1846442bb21b1042bf3b120502ef8f6ec6457ae8383b39a0c91dae49`, header `Version: 5.3.53`, `SHSS_VERSION=5.3.53`.
- Manifest finale: `stable_version=5.3.53`, `current_origin_version=5.3.53`, `package_url_matches_version=true`, `distribution_ready=true`, `release_readiness_level=client_staging_ready`, `automatic_install_enabled=false`, `client_installation_policy=manual_wordpress_update_only`.
- Update governance finale: `readiness_level=canary_only`, `live_update_allowed=false`, recommended action `Usare canary manuale; produzione solo dopo controllo umano e rollback pronto.`
- Zip live finale: `zipgrep` mirato senza occorrenze per dominio reale, endpoint Smart Desk live, FC Love/legalmail/P.IVA, chiavi demo/interne, prezzi/SKU Smart Desk hardcoded e tag Google Ads reale.
- Report locali: `reports/wordpress/SITE_SUITE_5_3_53_POST_UPLOAD_READONLY_VERIFY_2026-07-01.md` e `reports/wordpress/SITE_SUITE_5_3_53_MANIFEST_PACKAGE_FIX_2026-07-01.md`.

## Stato Site Suite dogfood/live + hotfix locale 2026-07-01
- Direzione owner: ripartire dalla baseline corretta `.48`, non dalla vecchia `.53` errata; verificare se SkinHarmony usa Site Suite al 100%, ma prima dell'upload non inserire dati SkinHarmony/listini nel codice del plugin.
- Live WordPress al termine del giro: Site Suite installata `5.3.50`. Manifest live riallineato a `stable_version=5.3.50` e plugin `5.3.50`; zip `.50` e rollback `.48` caricati su media WordPress. Nessuna installazione live della `.51`.
- Fix live eseguiti: bozza `soluzione-waas-aziende` aggiornata con `[sh_waas_offer]`; pagina `AI Gold Smart Desk` aggiornata con form/trial Suite; claim O3 ripuliti; manifest update-server allineato.
- Verifica live read-only finale: dogfood `80`, stato `partial_dogfood`, verdict `quote_first_ready`, critical `0`, open actions `2`; sale readiness `88`; guard-scan `claim_issues=0`, `price_issues=9` per falsi positivi Price Guard sui prezzi ufficiali; Product Inventory ancora `0`.
- Audit diretto claim/prezzi: `reports/wordpress/skinharmony_claim_price_audit_latest.json` con `claim_issues=[]` e `price_issues=[]`.
- Build `5.3.51`: DO NOT UPLOAD. Conteneva allowlist prezzi hardcoded in `default_official_prices()` e viola la regola Suite agnostica.
- Build `5.3.52`: DO NOT UPLOAD se serve pacchetto agnostico. Rimuoveva il fallback prezzi solo dal monolite, ma lasciava prezzi/listini/prodotti hardcoded in moduli e documenti storici.
- Build locale corrente per upload controllato: `5.3.53`. Rimuove default distribuibili con prezzi, piani/SKU Smart Desk, endpoint Smart Desk live, PEC/domini/chiavi demo SkinHarmony e pricebook WaaS; prezzi/prodotti/endpoint/pricebook/preset devono arrivare da opzioni WordPress, import amministrato, filtro o runtime privato.
- Zip `.53` locale: `dist/skinharmony-site-suite-5.3.53.zip`, SHA256 `9c36756d1846442bb21b1042bf3b120502ef8f6ec6457ae8383b39a0c91dae49`. Alias locali `dist/skinharmony-site-suite.zip` e `dist/skinharmony-site-suite-latest.zip` puntano alla `.53` con stesso SHA256. Manifest locale `stable/current/version=5.3.53`, `automatic_install=false`.
- Copia esterna versionata `.53`: `/Volumes/Esterno/MEC/priority_backup_2026-06-15/dist/skinharmony-site-suite-5.3.53.zip`, stesso SHA256 `9c36756d1846442bb21b1042bf3b120502ef8f6ec6457ae8383b39a0c91dae49`. Alias esterni `skinharmony-site-suite.zip` e `skinharmony-site-suite-latest.zip` non sovrascritti e restano su `.48` SHA256 `513868dc7cb2a8da10ea2877446d7e111d146cc4bd90a0736a5c5f806a5da1a1`.
- Verifiche `.53`: PHP lint tutti i file OK, JS admin `node --check` OK, Program Registry READY, Suite local test `1715/1715`, release preflight `22/22`, zip estratto scan mirato senza occorrenze per dominio reale, PEC/legalmail, endpoint Smart Desk live, chiavi demo, prezzi Smart Desk, SKU hardcoded e AW reale.
- Residui per dichiarare SkinHarmony 100% live: preset template SkinHarmony da salvare in wp-admin o via endpoint futuro; Google Ads tag reale da configurare solo via impostazioni/runtime sicuro; Product Inventory da popolare solo con schede/listino ufficiali; install `.53` live solo con nuovo gate Core e conferma owner.
- Core 2.0: report canonico finale `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`; input principali `suite_skinharmony_dogfood_closure_live_core2_input_2026_07_01.json`, `suite_5_3_53_agnostic_release_core2_input_2026_07_01.json`, `suite_5_3_53_copy_to_external_dist_core2_input_2026_07_01.json`.

## Stato iPad active workspace pre-VLM source sync 2026-06-27
- Direzione owner: riprendere il lavoro Skin Analyzer Pro iPad dall'altro Codex dopo rollback urgente pre-VLM/server-side.
- Verifica trovata: iPad gia installato con build pre-VLM corretta, ma il path Xcode attivo `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native` conteneva ancora la linea VLM/Moondream/GGUF lenta. Rischio: nuovo build dal workspace avrebbe reinstallato il ramo messo in standby.
- Core classico non raggiungibile (`core_unreachable` su `127.0.0.1:3199`); fallback Core 2.0 locale usato come giudice, non bloccante, report `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Azione eseguita: progetto attivo precedente spostato in `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native_vlm_standby_20260627_2026`; sorgente rollback pre-VLM copiata da `/private/tmp/skinharmony-pre-vlm-rollback-20260627-1742/08-skinharmony-analyzer-pro-ipad-native` al path attivo `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native`.
- Verifiche: diff attivo vs rollback vuoto; nessuna occorrenza `Moondream/localVLM/Qwen/Ollama/EmbeddedMoondream/GGUF/VLM` nel progetto attivo; `plutil` OK; build Xcode no-sign fuori sandbox `BUILD SUCCEEDED`; bundle generato `70M`; nessun asset/stringa VLM nel bundle.
- Report operativo: `reports/ipad-analyzer/IPAD_ACTIVE_WORKSPACE_PRE_VLM_SOURCE_SYNC_2026-06-27.md`.

## Stato iPad rollback pre-VLM server AI 2026-06-27
- Direzione owner: la versione AI locale/VLM e troppo lenta e non vendibile per la demo del 2026-06-28; mettere in standby quella linea e reinstallare la versione salvata prima del VLM con Nyra/Core/OpenAI su server.
- Core 2.0 locale usato come giudice. Winner: `restore_zip_build_signed_install_preserve_data`; input `universal-core-2.0/reports/universal-core/codex/ipad_rollback_pre_vlm_server_ai_install_core2_input_2026_06_27.json`; report `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Rollback zip recuperato da hard disk esterno: `/Volumes/Esterno/SkinHarmony_Archive/reports-archive-2026-06-25/rollback/SkinAnalyzerProiPad_before_offline_vlm_20260624_174941.zip`.
- Zip estratto in `/private/tmp/skinharmony-pre-vlm-rollback-20260627-1742`; build firmata in `/private/tmp/skinharmony-pre-vlm-dd-20260627-1742/Build/Products/Debug-iphoneos/SkinAnalyzerProiPad.app`.
- Verifiche: nessuna occorrenza Moondream/localVLM/Qwen/Ollama nei sorgenti estratti; bundle installato circa `70M`; nessun asset VLM nel bundle; build `BUILD SUCCEEDED`.
- Install iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati. Installation URL `file:///private/var/containers/Bundle/Application/BA3F981E-B8B8-4A97-9C7D-672D10246F09/SkinAnalyzerProiPad.app/`.
- Launch remoto OK con `devicectl`. Versione locale/VLM resta parcheggiata nel workspace/build precedenti, non installata per la demo.
- Report operativo: `reports/ipad-analyzer/IPAD_ROLLBACK_PRE_VLM_SERVER_AI_INSTALL_2026-06-27.md`.

## Stato iPad metric floor score guard 2026-06-25
- Direzione owner: se su `MK` non ci sono pori/porfirine, il punteggio deve essere alto fino a `100/100`; non deve restare a `30`/floor o basso per default. Controllare anche gli altri minimi tecnici.
- Core 2.0 locale usato come giudice. Winner update: `A_metric_floor_guard_evidence_condition_score`; input `universal-core-2.0/reports/universal-core/codex/ipad_metric_floor_score_guard_core2_input_2026_06_25.json`.
- Core 2.0 winner install: `signed_build_install_same_bundle_preserve_data`; input `universal-core-2.0/reports/universal-core/codex/ipad_metric_floor_score_guard_install_core2_input_2026_06_25.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Causa verificata: nel port iPad `GetMaokongValue` ha `min30`; altri candidati hanno floor tecnici `YF min45`, `XW min51`, `YZ min50`, `SB min35`. Prima della patch lo score basso poteva entrare nella media se non scartato dalla quality guard.
- `ContentView.swift`: aggiunta normalizzazione anti-floor prima della media multi-zona. Ogni zona conserva `rawScore`; se lo score basso non e supportato dal burden marker specifico, viene riallineato a `100 - burden`; marker assenti/quasi assenti portano a `100/100`; quality troppo scarsa esclude la zona invece di rassicurarla.
- Breakdown aggiornato: `score zona`, `score sorgente` e flag tipo `marker assenti: condizione portata a 100/100`, `score basso riallineato ai marker`, oppure `score sorgente ... confermato dai marker`.
- Build generica no-sign OK, build firmata device OK, install iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati. Installation URL `file:///private/var/containers/Bundle/Application/FFBE0C36-5082-4B8E-84B8-110AA65532B5/SkinAnalyzerProiPad.app/`.
- Report operativo: `reports/ipad-analyzer/IPAD_METRIC_FLOOR_SCORE_GUARD_2026-06-25.md`.
- Prossimo test owner: nuova acquisizione completa; poi leggere `latest_capture/score_breakdown.txt` e verificare che `MK` su fronte/guancia non accetti floor basso senza pori/porfirine.

## Stato iPad score breakdown visibile 2026-06-25
- Direzione owner: vedere le metriche e i conti reali per capire se FS/YF/XW/YZ/SB/MK fanno la media corretta delle zone.
- Core 2.0 locale usato come giudice. Winner update: `persist_and_display_zone_breakdown`; input `universal-core-2.0/reports/universal-core/codex/ipad_zone_score_breakdown_core2_input_2026_06_25.json`.
- Core 2.0 winner install: `signed_build_install_same_bundle_preserve_data`; input `universal-core-2.0/reports/universal-core/codex/ipad_zone_score_breakdown_install_core2_input_2026_06_25.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- `AndroidReportFileSystem.swift`: `save(...)` e `saveLatestCaptureDraft(...)` ora accettano `markerEvidence` composita e scrivono `score_breakdown.json` + `score_breakdown.txt` insieme a `marker_evidence.json`.
- `ContentView.swift`: salvataggi latest/report passano `markerEvidenceCache`; la card marker mostra `Calcolo media zone` e score area quando la evidence contiene `score zona`.
- Nessun cambio scoring numerico: formula resta `round(somma score zone / numero zone disponibili)`. Confidence/fuoco/qualita restano evidence, non pesi.
- Build generica no-sign OK, build firmata device OK, install iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati. Installation URL `file:///private/var/containers/Bundle/Application/E4BEE610-8974-4C01-B863-3B815FE49810/SkinAnalyzerProiPad.app/`.
- Report operativo: `reports/ipad-analyzer/IPAD_ZONE_SCORE_BREAKDOWN_VISIBILITY_2026-06-25.md`.

## Stato iPad marker/3D background attach fix 2026-06-25
- Direzione owner: marker e mappe 3D non comparivano piu nel report e i punteggi risultavano bassi dopo detersione + siero DNA sodico 1% + acido ialuronico + crema.
- Valutazione visiva su foto owner: da foto normale non emerge quadro coerente con punteggio molto basso globale su sebo/ispessimento; possibile effetto film cosmetico/riflessi/illuminazione, ma la foto non sostituisce tricocamera/evidence.
- Core 2.0 locale usato come giudice. Winner update: `A_visual_only`; input `universal-core-2.0/reports/universal-core/codex/ipad_marker_3d_low_scores_core2_input_2026_06_25.json`.
- Core 2.0 install winner: `signed_build_install_same_bundle_preserve_data`; input `universal-core-2.0/reports/universal-core/codex/ipad_marker_3d_visual_fix_install_core2_input_2026_06_25.json`.
- `ContentView.swift`: il report veloce ora avvia subito `prepareReportVisualsInBackground(...)`; rimosso ritardo 850 ms; rimosso aggancio fragile solo su `importedAt`; aggiunti `skinHarmonyCanAttachReportVisuals` e `skinHarmonyAttachReportVisuals` per fondere marker/3D per metrica senza sostituire tutta la sessione.
- Nessun cambio scoring in questa build: Core ha selezionato fix visuale, non guardia punteggi. Se MK/FS restano bassi dopo nuovo test, prossimo passo e leggere evidence reali e aggiungere quality guard conservativo su riflessi/film, senza rialzare score manualmente.
- Build generica no-sign OK, build firmata device OK, install iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati. Installation URL `file:///private/var/containers/Bundle/Application/09CE784E-8B02-4A76-B29B-7675BE73CE90/SkinAnalyzerProiPad.app/`.
- Report operativo: `reports/ipad-analyzer/IPAD_MARKER_3D_BACKGROUND_ATTACH_FIX_2026-06-25.md`.

## Stato iPad Nyra topographic zone reading 2026-06-25
- Direzione owner: Nyra/Core devono cambiare modo di parlare perche lo scoring viso ora e multi-zona. L'algoritmo resta fonte dei punteggi; Nyra deve leggere score per zona, marker e quadro generale, non fissarsi sul punteggio medio o sul peggior valore.
- Core classico non usato; Core 2.0 locale usato come giudice. Winner update: `zone_score_topographic_nyra_core_branches`; input `universal-core-2.0/reports/universal-core/codex/ipad_nyra_topographic_zone_reading_core2_input_2026_06_25.json`.
- Core 2.0 winner install: `signed_build_install_same_bundle_preserve_data`; input `universal-core-2.0/reports/universal-core/codex/ipad_nyra_topographic_zone_reading_install_core2_input_2026_06_25.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- `AnalyzerAIClient.swift`: aggiunti `ZoneScoreReading` e `TopographicMetricInsight`; il branch locale Core v0 ora espone `topographic_zone_reading` con `zone_score_distribution`, `visible_line`, `action_line`, `relationship_line` e branch dedicati.
- Letture nuove: `MK` distingue T-zone/U-zone e pelle mista/localizzata vs sebo diffuso; `XW` distingue contorno occhi, fronte e lato sorriso; `YZ` distingue rossore nasale localizzato vs reattivita diffusa; `SB` distingue distribuzione pigmentaria; `YF/FS` confrontano guancia/fronte.
- Payload AI aggiornato: `marker_algorithm_reading` contiene `topographic_reading` e `zone_score_distribution`; provider envelope contiene `topographic_zone_reading` e `topographic_zone_reading_text`; Nyra/Core cloud opzionali ricevono gli stessi dati.
- Build generica iOS OK, build firmata device OK, install iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati. Installation URL `file:///private/var/containers/Bundle/Application/54BB3BF3-A534-45D5-A353-A657658A716E/SkinAnalyzerProiPad.app/`.
- Launch remoto fallito per timeout Apple `CoreDeviceService`, non per errore build/install. Report operativo: `reports/ipad-analyzer/IPAD_NYRA_TOPOGRAPHIC_ZONE_READING_2026-06-25.md`.

## Stato iPad Multi-Zone Skin Scoring 2026-06-25
- Direzione owner: correggere SkinHarmony Analyzer Pro iPad perche il punteggio non deve nascere da una sola zona quando la metrica richiede confronto; la lettura deve migliorare tipo pelle, cosa fare, vendita estetica/farmacia e anamnesi medicale descrittiva per medico.
- Core classico non usato; Core 2.0 locale usato come giudice. Winner update: `multi_roi_score_aggregator_preserve_native_bridge`; input `universal-core-2.0/reports/universal-core/codex/ipad_multi_zone_skin_scoring_core2_input_2026_06_25.json`.
- Core 2.0 winner install: `signed_build_install_same_bundle_preserve_data`; input `universal-core-2.0/reports/universal-core/codex/ipad_multi_zone_skin_scoring_install_core2_input_2026_06_25.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- `ContentView.swift`: aggiunto aggregatore multi-zona che usa il bridge nativo esistente per ogni coppia metrica/zona e poi aggrega score con pesi e qualita marker. Mapping: `YF=fronte+guancia`, `XW=fronte+contorno occhi+lato sorriso`, `FS=guancia+fronte`, `YZ=tutte le zone valide con peso naso limitato`, `SB=guancia+fronte+lato sorriso`, `MK=T-zone+fronte+guancia`.
- `ContentView.swift`: il report automatico ora usa `skinHarmonyPrepareReportSession(...)` completo, aggiorna `markerEvidenceCache` prima di chiamare Nyra/Core/OpenAI/local runtime e salva draft con sessione gia arricchita.
- `OriginalScoringEngine.swift`: `FS` non viene piu sovrascritto come media se esiste gia uno score importato da `score.properties`, preservando report Android ufficiali.
- Build generica iOS OK, build firmata device OK, install iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati. URL app `file:///private/var/containers/Bundle/Application/6C698A45-6EA0-4AA6-9544-2067D02B8789/SkinAnalyzerProiPad.app/`. Avvio app OK con `devicectl`.
- Report operativo: `reports/ipad-analyzer/IPAD_MULTI_ZONE_SKIN_SCORING_2026-06-25.md`.

## Stato iPad Local Nyra/Core Render Parity 2026-06-25
- Direzione owner: mettere dentro SkinAnalyzerPro iPad quello che usa ora Render per Nyra Analyzer con rami e Core v0 con rami, non gateway esterno e non fallback generico.
- Gate Core Codex classico non disponibile su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner update: `embed_render_parity_compact_runtime`; input `universal-core-2.0/reports/universal-core/codex/ipad_local_nyra_core_render_parity_core2_input_2026_06_24.json`.
- Core 2.0 winner install: `signed_build_install_same_bundle_preserve_data`; input `universal-core-2.0/reports/universal-core/codex/ipad_local_nyra_core_render_parity_install_core2_input_2026_06_24.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- `AnalyzerAIClient.swift`: aggiunto runtime locale `ios_local_render_parity` con `LocalRenderBranchOutput`, `LocalRenderVoiceContext`, `LocalRenderParityRuntime`; Core locale `universal_core_v0_local_render_parity`; Nyra locale `1.9.1-local`; voice library `nyra_skinharmony_analyzer_voice_library_v1` versione `1.91`.
- Pipeline AI aggiornata: score/marker -> Core v0 locale branch output -> Nyra 1.9.1 locale con `selected_style_mode`, `voice_variant_id`, firme secondarie/stabili -> Moondream integrato se attivo -> cloud Nyra/Core/OpenAI opzionali -> fallback locale basato sul runtime locale.
- Payload opzionale verso cloud ora include `local_render_parity_runtime`, `local_core_v0_branch_output`, `local_nyra_voice_context`.
- `AnalyzerSettings.swift`, `AISettingsView.swift`, `ContentView.swift`: UI mostra `Core locale` e `Nyra locale` sempre attivi; configurazione `Core/Nyra locali`; cloud/chiavi restano opzionali; nessuna stringa gateway/Qwen/Ollama visibile nelle schermate controllate.
- Build generica iOS fuori sandbox OK; build firmata device OK; install iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati. Installation URL `file:///private/var/containers/Bundle/Application/C1F333E3-9507-4580-9BFD-8F5F279083CE/SkinAnalyzerProiPad.app/`.
- App installata pesa circa `1.7G` per Moondream embedded. Launch remoto da Mac fallito solo per timeout Apple `CoreDeviceService`, non per crash app verificato.
- Report operativo: `reports/ipad-analyzer/IPAD_LOCAL_NYRA_CORE_RENDER_PARITY_2026-06-25.md`.

## Stato iPad Moondream Ollama Q4 gateway 2026-06-24
- Direzione owner: quantizzare/preparare Moondream per SkinAnalyzerPro e renderlo usabile dal software senza vincolare il report al cloud.
- Gate Core Codex classico non disponibile su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner: `ollama_moondream_gateway_first`; input `reports/universal-core/codex/ipad_moondream_quantization_core2_input_2026_06_24.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Modello locale disponibile in Ollama: `moondream:latest`, `1.7 GB`, architettura `phi2`, language model `1B`, projector vision `clip` `454.45M`, quantizzazione `Q4_0`, capacita `completion` + `vision`.
- Storage reale: il servizio Ollama attivo usa `~/.ollama`, non `models/ollama`; blob principali Moondream circa `790 MB` + `868 MB`.
- Smoke test: `/api/generate` completa ma restituisce testo vuoto; `/api/chat` restituisce risposta, quindi Moondream su Ollama va chiamato via chat endpoint.
- `AnalyzerAIClient.swift`: aggiunto supporto Ollama `/api/chat` con `messages + images`; endpoint base Ollama passa automaticamente a `/api/chat` per modelli vision/moondream.
- `AnalyzerSettings.swift`: default gateway locale aggiornato a `http://127.0.0.1:11434`, modello default `moondream`.
- `ContentView.swift`: nota UI aggiornata per endpoint LAN da iPad, esempio `http://192.168.1.20:11434`.
- Verifica: build generica iOS fuori sandbox OK con `BUILD SUCCEEDED`. Nessun install iPad in questo blocco.
- Limite reale: gateway Ollama quantizzato pronto; non ancora embedded Core ML dentro il bundle iPad. Per embedded serve ancora `Moondream2SkinAnalyzer.mlmodelc` o runtime iOS dedicato.
- Report operativo: `reports/ipad-analyzer/IPAD_MOONDREAM_OLLAMA_Q4_GATEWAY_2026-06-24.md`.

## Stato iPad Embedded Moondream runtime 2026-06-24
- Direzione owner: inserire Moondream2 dentro SkinAnalyzerPro come VLM piu forte ma piccolo, da testare quantizzato su iPad.
- Gate Core Codex classico non disponibile su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner: `embedded_moondream_bundle_ready_adapter`; input `reports/universal-core/codex/ipad_embedded_moondream_runtime_core2_input_2026_06_24.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Rollback pre-Moondream creato: `reports/rollback/SkinAnalyzerProiPad_before_embedded_moondream_20260624_224650.zip`.
- `EmbeddedMoondreamEngine.swift`: nuovo adapter Core ML per `Moondream2SkinAnalyzer.mlmodelc`, selezione prima immagine utile dal payload, conversione a pixel buffer, input generico immagine+prompt e output testuale.
- `AnalyzerSettings.swift`: aggiunto runtime locale `Moondream integrato` / `Gateway locale`; default `Moondream integrato`; `hasLocalVLM` e vero per embedded solo quando il modello compilato e presente nel bundle.
- `AnalyzerAIClient.swift`: pipeline aggiornata per provare Moondream embedded prima del gateway esterno; se manca il modello non inventa output e passa ai fallback configurati.
- `ContentView.swift` e `AISettingsView.swift`: UI Sistema/AI mostra scelta runtime e stato reale del pacchetto (`Moondream pronto`, `da completare`, `non caricato`).
- `project.pbxproj`: `EmbeddedMoondreamEngine.swift` aggiunto al target iPad.
- Verifica: build generica iOS `CODE_SIGNING_ALLOWED=NO` OK con `BUILD SUCCEEDED`. Nessun install iPad in questo blocco.
- Limite reale: Moondream non e ancora attivo come modello locale finche non viene convertito/quantizzato e inserito nel bundle come `Moondream2SkinAnalyzer.mlmodelc`.
- Report operativo: `reports/ipad-analyzer/IPAD_EMBEDDED_MOONDREAM_RUNTIME_2026-06-24.md`.

## Stato iPad Local VLM / Qwen gateway 2026-06-24
- Direzione owner: rendere SkinAnalyzerPro iPad non vincolato al cloud e ai testi precompilati; salvare prima lo stato attuale per rollback.
- Rollback creato: `reports/rollback/SkinAnalyzerProiPad_before_offline_vlm_20260624_174941.zip`.
- Gate Core Codex classico tentato ma `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner architettura: `local_vlm_gateway_primary_with_rollback`; input `reports/universal-core/codex/ipad_offline_vlm_core_nyra_architecture_core2_input_2026_06_24.json`.
- Core 2.0 winner Qwen gateway: `add_openai_compatible_local_vlm_request_body`; input `reports/universal-core/codex/ipad_local_vlm_qwen_openai_compatible_core2_input_2026_06_24.json`.
- `AnalyzerSettings.swift`: aggiunte impostazioni `localVLMEndpoint`, `localVLMModel`, `enableLocalVLM`, `allowCloudFallback`; default ora `http://127.0.0.1:8000/v1/chat/completions` e `Qwen/Qwen2-VL-2B-Instruct`.
- `AnalyzerAIClient.swift`: pipeline aggiornata `score/marker -> decisione locale Core/Nyra -> VLM locale -> cloud opzionale -> emergenza locale`; supporto sia Ollama `/api/generate` sia server locale OpenAI-compatible `/v1/chat/completions` con immagini `data:image/jpeg;base64`.
- `ContentView.swift`: payload AI include immagini reali ridotte in base64; UI Sistema mostra `AI locale offline` e nota che su iPad serve IP LAN del Mac/box AI, non `127.0.0.1` se il server gira fuori iPad.
- `AISettingsView.swift`: wording ripulito, cloud ed emergenza locale sono rete di sicurezza.
- Pull `llama3.2-vision` fermato: modello 11B da circa 7.8GB non sensato come embedding iPad M4 8GB. Nessun nuovo VLM installato; `ollama list` mostra solo `qwen2.5-coder:7b`, non VLM.
- Valutazione VLM: Qwen2-VL-2B-Instruct candidato forte per motore locale esterno; per embedding reale dentro iPad candidati separati `SmolVLM-256M-Instruct` o `Moondream2` quantizzati/benchmarkati.
- Verifica: build Xcode generica iOS `CODE_SIGNING_ALLOWED=NO` OK con `BUILD SUCCEEDED`. Nessun install iPad e nessun deploy Render in questo blocco.
- Report operativo: `reports/ipad-analyzer/IPAD_LOCAL_VLM_QWEN_GATEWAY_2026-06-24.md`.

## Stato iPad Visual Upgrade v0.2.0 2026-06-24
- Direzione owner: usare lo zip `SkinHarmonyVisualUpgrade_v0.2.0.zip` scaricato in Downloads per migliorare marker/3D iPad, in particolare `XW` piu leggibile e `SB` che non deve leggere peli come discromie.
- Gate Core Codex classico tentato ma `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner update: `replace_visual_package_v020_plus_adapter_guards`; input `reports/universal-core/codex/ipad_visual_upgrade_v020_core2_input_2026_06_24.json`.
- Core 2.0 winner install: `signed_build_install_same_bundle_preserve_data`; input `reports/universal-core/codex/ipad_visual_upgrade_v020_install_core2_input_2026_06_24.json`.
- Core 2.0 winner provisioning: `backup_profile_force_xcode_renew_rebuild_install`; input `reports/universal-core/codex/ipad_visual_upgrade_v020_provisioning_renew_core2_input_2026_06_24.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Sostituiti i sei file Visual Upgrade con v0.2.0: `SkinHarmonyVisualModels.swift`, `SkinHarmonyImageUtilities.swift`, `SkinHarmonyMarkerCandidateDetector.swift`, `SkinHarmonyMarkerRenderer.swift`, `SkinHarmonyPseudo3DRenderer.swift`, `SkinHarmonyVisualExportService.swift`.
- `SkinHarmonyVisualUpgradeAdapter.swift`: versione `skinharmony-visual-upgrade-ios-0.2.0`, supporto `FS/YF/XW/YZ/SB/MK`, fallback legacy, `XW` usa marker v0.2 ma relief/3D legacy quando disponibile per evitare resa poco leggibile; output conserva `markerCount` e `rawFeatures`.
- `SkinHarmonyMarkerCandidateDetector.swift`: aggiunto filtro anti-peli per `SB`, scarta candidati sottili/lineari con alta elongation e bassa circularity prima di considerarli irregolarita cromatiche.
- `SkinHarmonyImageUtilities.swift`: corretto clamp `CGFloat` con `Swift.min`/`Swift.max`.
- Non modificati scoring numerico, `score.properties`, Nyra/Core/OpenAI/Render, prodotti, chiavi, clienti o report storici. La v0.2 resta layer visuale; i `rawFeatures` non cambiano ancora i punteggi.
- Build generica iOS OK, build firmata device OK, install iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati. Installation URL finale `/private/var/containers/Bundle/Application/8E79096F-2BB3-4202-99EA-2E640B538E2C/SkinAnalyzerProiPad.app/`.
- Primo install usava profilo in scadenza `2026-06-24T15:13:26Z`; spostato in backup `/tmp/skinharmony-provisioning-backup-20260624/7f8fa63f-ecc1-4bf0-98e9-d67a9d0c8bf1.mobileprovision`; Xcode ha generato profilo nuovo UUID `49e7a126-7e01-47f9-ac71-5a548a6d52ee`, scadenza `2026-07-01T14:42:56Z`.
- Launch da Mac non completato per iPad lockato (`Unable to launch ... device locked`), non per crash app.
- Report operativo: `reports/ipad-analyzer/IPAD_VISUAL_UPGRADE_V020_2026-06-24.md`.

## Stato iPad Visual Upgrade XW/YZ/SB 2026-06-24
- Direzione owner: aggiungere il pacchetto `SkinHarmonyVisualUpgrade.zip` scaricato in Downloads come parte testabile mentre i marker mancanti vengono coperti separatamente.
- Gate Core Codex classico tentato ma `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner implementazione: `additive_visual_adapter_xw_yz_sb_with_fallback`; input `reports/universal-core/codex/ipad_visual_upgrade_xw_yz_sb_core2_input_2026_06_24.json`.
- Core 2.0 winner installazione: `signed_build_install_same_bundle_preserve_data`; input `reports/universal-core/codex/ipad_visual_upgrade_xw_yz_sb_install_core2_input_2026_06_24.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Aggiunti al target iPad i file `SkinHarmonyVisualModels.swift`, `SkinHarmonyImageUtilities.swift`, `SkinHarmonyMarkerCandidateDetector.swift`, `SkinHarmonyMarkerRenderer.swift`, `SkinHarmonyPseudo3DRenderer.swift`, `SkinHarmonyVisualExportService.swift`.
- Creato `SkinHarmonyVisualUpgradeAdapter.swift`: usa il nuovo export solo per `XW`, `YZ`, `SB`; disattiva footer/caption tecniche nelle immagini cliente; se qualita/filtro/export fallisce torna al renderer legacy.
- `OriginalScoringEngine.swift`: `AndroidProcessedImageRenderer.enrichedSession(...)` prova il visual upgrade per `processedImage` e `reliefImage` solo quando serve e solo per metriche supportate. Lo scoring numerico non e stato modificato.
- `project.pbxproj`: target membership aggiornata per i nuovi file Swift.
- Corretto nel pacchetto importato `SkinHarmonyImageUtilities.swift` per compatibilita Swift SDK attuale (`Swift.min`/`Swift.max` su `CGFloat`).
- Build generica reale fuori sandbox OK, build firmata device OK, install iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati; installation URL `/private/var/containers/Bundle/Application/428E14F5-4F45-4CBD-8068-06F539A3880C/SkinAnalyzerProiPad.app/`.
- Launch app OK con `devicectl`.
- Non modificati `FS/YF/MK`, scoring, AnalyzerAIClient/Nyra/Core/OpenAI, prodotti, chiavi API, backend Render o dati cliente/report.
- Report operativo: `reports/ipad-analyzer/IPAD_VISUAL_UPGRADE_XW_YZ_SB_2026-06-24.md`.

## Stato iPad capture area source dedup 2026-06-24
- Direzione owner: le foto su `Guancia sinistra` risultavano ripetute due volte; sospetto corretto che `Mento` e `Laterale` fossero stati solo nascosti nel testo e non sistemati nella sorgente.
- Gate Core Codex classico tentato ma `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner fix: `source_area_sequence_and_report_visibility_fix`; input `reports/universal-core/codex/ipad_capture_area_source_duplicate_fix_core2_input_2026_06_24.json`.
- Core 2.0 winner install: `signed_build_install_same_bundle_preserve_data`; input `reports/universal-core/codex/ipad_capture_area_source_duplicate_fix_install_core2_input_2026_06_24.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- `ContentView.swift`: aggiunto set sorgente `supplementalReportAreaKeys = ["chin", "lateral_face"]`; le aree extra reali sono ora solo `Mento` e `Laterale viso`; le 6 metriche non vengono piu duplicate dentro `session.areaCaptures`.
- `ContentView.swift`: le metriche principali restano nel payload AI come aree acquisite tramite `imageDataURLs`, senza creare una seconda galleria foto area duplicata; aggiunta sezione report `Zone aggiuntive acquisite` con foto cliccabili di `Mento` e `Laterale`.
- `ContentView.swift`: il completamento automatico non chiude piu su ultima metrica `Naso / T-zone`; chiude solo sull'ultima area della sequenza, quindi dopo `Naso` deve passare a `Laterale viso`.
- Build generica reale fuori sandbox OK, build firmata device OK, install iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati; installation URL `/private/var/containers/Bundle/Application/B8896CF1-0365-4645-8534-4F7F760C7902/SkinAnalyzerProiPad.app/`.
- Launch app OK con `devicectl`.
- Non modificati scoring, marker, renderer 3D, AnalyzerAIClient/Nyra/Core/OpenAI, prodotti, chiavi, backend Render o dati cliente/report.
- Report operativo: `reports/ipad-analyzer/IPAD_CAPTURE_AREA_SOURCE_DEDUP_FIX_2026-06-24.md`.

## Stato iPad Clienti azioni + auto report visibile 2026-06-24
- Direzione owner: in `Clienti` servivano azioni rapide come in `Prodotti` con modifica/elimina e campi separati `nome`, `cognome`, `eta`, `telefono`; dopo acquisizione completa il passaggio a `Report` doveva essere automatico e visibile, per non sembrare bloccato.
- Gate Core Codex classico tentato ma `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner: `narrow_ui_actions_plus_immediate_overlay`; input `reports/universal-core/codex/ipad_clients_actions_auto_report_overlay_core2_input_2026_06_24.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- `ContentView.swift`: `ClientRecord` esteso con `surname`; tabella Clienti aggiornata con colonne `Nome`, `Cognome`, `Eta`, `Telefono`, `Azioni`; riga cliente con apertura, modifica e cestino; form unico per nuovo/modifica; vecchi nomi completi vengono separati visivamente quando possibile.
- Eliminazione cliente soft: sparisce dalla lista e resta nascosto anche dopo merge dalle cartelle, ma cartelle/report salvati non vengono cancellati.
- `ContentView.swift`: overlay globale `Elaborazione SkinHarmony`; dopo ultima serie scatti prepara immagini, punteggi/marker/testo e apre automaticamente `Report`.
- Build firmata iPad OK e install iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati. Installation URL `/private/var/containers/Bundle/Application/ED5287B8-58BD-4AB3-B118-9C4A3AE25909/SkinAnalyzerProiPad.app/`.
- Screenshot precedenti disponibili in `/tmp/skinharmony-ipad-clients-auto-report-screens-20260624`; nuovo export post-install non completato per errore Apple `CoreDeviceService`/`devicectl`, non per errore build.
- Non modificati scoring, marker, immagini 3D, prodotti, chiavi API, backend Render o dati cliente/report.
- Report operativo: `reports/ipad-analyzer/IPAD_CLIENTS_ACTIONS_AUTO_REPORT_OVERLAY_2026-06-24.md`.

## Stato iPad acquisizione overflow/back button 2026-06-22
- Direzione owner: la scheda `Acquisizione` usciva fuori in basso e mancava un comando chiaro `Torna indietro`.
- Gate Core Codex classico tentato ma `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner: `height_constrained_capture_layout_plus_back_button`; input `reports/universal-core/codex/ipad_acquisition_overflow_back_button_core2_input_2026_06_22.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- `ContentView.swift`: aggiunto pulsante `Indietro` nella barra azioni Analisi; torna alla home/modulo principale e resta disabilitato durante acquisizione o batch.
- `ContentView.swift`: layout `Acquisizione` vincolato all'altezza display; rimosso il comportamento con altezza minima rigida che tagliava in basso; colonne laterali rese scrollabili internamente; preview centrale compattata.
- Build firmata Skin Analyzer OK e install iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati. Installation URL `/private/var/containers/Bundle/Application/BBB2F7EB-8586-42A6-A487-5B0DC70BCFF8/SkinAnalyzerProiPad.app/`.
- Screenshot export verificato in `/tmp/skinharmony-ipad-acquisition-ui-fix-screens-final-20260622`: `05_inizia_rilevamento.png` mostra `Indietro` visibile e pannello acquisizione contenuto nello schermo.
- Non modificati scoring, marker, report AI, prodotti, chiavi API, backend Render o dati cliente.
- Report operativo: `reports/ipad-analyzer/IPAD_ACQUISITION_OVERFLOW_BACK_BUTTON_FIX_2026-06-22.md`.

## Stato iPad Scalp separato da Skin Analyzer 2026-06-22
- Direzione owner aggiornata: il cuoio capelluto non deve usare il flusso foto pelle; Skin Analyzer deve restare app viso, Scalp Analyzer va trattato come software separato.
- Gate Core Codex classico tentato ma `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner: `hide_scalp_in_skin_app_create_separation_contract`; input `reports/universal-core/codex/ipad_scalp_split_from_skin_analyzer_core2_input_2026_06_22.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- `ContentView.swift`: `Scalp` resta solo case tecnico parcheggiato ma non e piu incluso in `AnalysisViewMode.allCases`; la UI Analisi mostra solo `Acquisizione`, `Anamnesi`, `Report`, `Export`; rimosso export debug `09_scalp`.
- Creato contratto app separata: `tmp/ipad-marker-work/09-scalp-analyzer-pro-ipad-native/SCALP_ANALYZER_SEPARATE_APP_CONTRACT.md`. Bundle target futuro: `com.skinharmony.scalpanalyzerpro.ipad`; zone scalp dedicate frontale, vertex, tempie, occipitale.
- Build firmata Skin Analyzer OK e install iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati. Installation URL `/private/var/containers/Bundle/Application/9E7B3D50-7466-4439-8E44-D10B260A9C17/SkinAnalyzerProiPad.app/`.
- Screenshot export verificato in `/tmp/skinharmony-ipad-skin-only-screens-20260622`: `09_scalp` assente; `04_anamnesi.png` mostra tab `Scalp` assente e nessun overflow evidente.
- Report operativo: `reports/ipad-analyzer/IPAD_SCALP_SPLIT_FROM_SKIN_ANALYZER_2026-06-22.md`.

## Stato iPad Scalp Analyzer visual indices prima/dopo 2026-06-22
- Direzione owner: procedere con ramo cuoio capelluto e aggiungere confronto prima/dopo; usare algoritmo/architettura Skin Analyzer come base, ma senza confondere il ramo scalp con il viso.
- Gate Core Codex classico tentato ma `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner implementazione: `scalp_mvp_visual_indices_before_after_local`; input `reports/universal-core/codex/ipad_scalp_analyzer_visual_indices_before_after_core2_input_2026_06_22.json`.
- Core 2.0 winner installazione: `signed_build_install_same_bundle_preserve_data`; input `reports/universal-core/codex/ipad_scalp_analyzer_install_core2_input_2026_06_22.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- `AnalyzerModels.swift`: aggiunti `ScalpZone`, `ScalpVisualMetrics`, `ScalpAnalysisSnapshot`, `ScalpBeforeAfterComparison`, `ScalpAnalysisStore`, `ScalpVisualAnalyzerEngine`. Indici visuali: densita, calibro fusto, miniaturizzazione, unita follicolari, follicoli vuoti, capelli spezzati, desquamazione, sebo/tappi, rossore, diametro ostio visivo/pixel e confidenza.
- `ContentView.swift`: aggiunto tab `Scalp` in Analisi con `Analizza immagini correnti`, `Salva come prima`, `Confronta prima/dopo`, griglia indici, card zona e tabella confronto.
- Salvataggio locale baseline/latest: `Documents/SkinHarmonyAnalyzerPro/scalp/<clientID>/scalp_baseline.json` e `scalp_latest.json`; per sessioni senza cliente usa `unlinked`.
- Build generica fuori sandbox OK, build firmata device OK, install finale iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati. Installation URL finale `/private/var/containers/Bundle/Application/4B84EDBF-B9FF-4737-961B-8BCB373AB381/SkinAnalyzerProiPad.app/`. Launch app OK.
- Limite intenzionale: diametro ostio e densita sono indici visuali/px, non micron o cap/cm2; per misure assolute serve calibrazione fisica nuova tricocamera. Non modificati scoring/marker/report viso, prodotti, chiavi API, backend Render.
- Report operativo: `reports/ipad-analyzer/IPAD_SCALP_ANALYZER_VISUAL_INDICES_BEFORE_AFTER_2026-06-22.md`.

## Stato iPad report slow open auto flow fix 2026-06-18
- Direzione owner: la build precedente non faceva partire l'auto-report nel test reale; cliccando manualmente `Report` sembrava bloccata/lenta.
- Causa: `Report` poteva processare score/immagini in modo sincrono sul thread UI tramite `prepareReportScreenIfNeeded()`; l'auto-report scattava solo sull'ultima area estesa e non sempre sull'ultima metrica principale; `runAnalysis()` aveva ancora un ramo sincrono residuo.
- Gate Core Codex classico tentato ma `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner fix: `route_report_click_to_async_batch_flow`; winner install: `signed_build_install_preserve_data`. Input: `reports/universal-core/codex/ipad_report_slow_open_auto_flow_fix_core2_input_2026_06_18.json`, `reports/universal-core/codex/ipad_report_slow_open_auto_flow_install_core2_input_2026_06_18.json`.
- `ContentView.swift`: `Report` e `Genera report` ora passano da funzioni dedicate che, se ci sono immagini correnti senza score, avviano il batch async con overlay invece di aprire/processare subito; auto-report parte sia dopo ultima metrica principale sia dopo ultima area estesa.
- `processCapturedSessionAndGenerateReport()` lavora su snapshot della sessione e sposta scoring/rendering fuori dalla chiusura `@MainActor`; `runAnalysis()` non processa piu immagini direttamente quando mancano score, ma delega al batch.
- Build generica OK, build firmata device OK, install finale iPad OK sopra `com.skinharmony.analyzerpro.ipad` senza uninstall/reset dati. Installation URL finale `/private/var/containers/Bundle/Application/6F79F352-0DD9-4977-828B-A97DBF4D14D1/SkinAnalyzerProiPad.app/`.
- Non modificati scoring, marker, immagini 3D, prodotti, chiavi API, backend o dati cliente.
- Report operativo: `reports/ipad-analyzer/IPAD_REPORT_SLOW_OPEN_AUTO_FLOW_FIX_2026-06-18.md`.

## Stato iPad auto report after capture overlay 2026-06-18
- Direzione owner: dopo aver acquisito tutte le immagini, l'app deve passare automaticamente a `Report`; l'elaborazione deve usare animazione stile Android adattata allo stile iPad.
- Gate Core Codex classico tentato ma `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner patch: `completion_driven_auto_report_with_ipad_overlay`; winner install: `signed_build_install_same_bundle_preserve_data`. Input: `reports/universal-core/codex/ipad_auto_report_after_capture_core2_input_2026_06_18.json`, `reports/universal-core/codex/ipad_auto_report_after_capture_install_core2_input_2026_06_18.json`.
- `ContentView.swift`: il batch finale resta in overlay fino alla fine reale di `AnalyzerAIClient.analyze(...)` o fallback locale; `runAnalysis(...)` ora supporta `openReportWhenReady` e apre `Report` solo dopo testo pronto. Se l'analisi parte da cliente, il salvataggio automatico resta attivo nello storico corretto.
- Overlay `SkinHarmonyProcessingOverlay` ridisegnato in stile iPad: vetro chiaro, anello scanner, step `Immagini / Analisi / Report`; messaggi visibili ripuliti da termini troppo tecnici.
- Build generica fuori sandbox OK, build firmata device OK, install su iPad sopra `com.skinharmony.analyzerpro.ipad` OK senza uninstall/reset dati. Installation URL finale `/private/var/containers/Bundle/Application/063E4F99-6220-4346-BAC4-A7D238DCAE13/SkinAnalyzerProiPad.app/`.
- Non modificati scoring, marker, immagini 3D, prodotti, chiavi API, backend o dati cliente.
- Report operativo: `reports/ipad-analyzer/IPAD_AUTO_REPORT_AFTER_CAPTURE_OVERLAY_2026-06-18.md`.

## Stato iPad cleanup regola post-routine baseline 2026-06-18
- Direzione owner: la frase che svaluta la lettura dopo siero/crema come `post-routine` o `baseline pulita` non va tenuta, perche il cambiamento visibile e utile per vendere prima/dopo.
- Gate Core Codex classico tentato ma `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner: `source_cleanup_only_preserve_avoid_removal`. Input: `reports/universal-core/codex/ipad_cleanup_post_routine_baseline_rule_core2_input_2026_06_18.json`.
- `AnalyzerAIClient.swift`: rimossa la regola prompt post-routine/baseline e rimossa la frase anamnestica visibile `baseline pulita`.
- Preservata la rimozione della voce visibile `EVITA`; nessun install eseguito in questa fase.
- Non modificati scoring, marker, 3D, prodotti, chiavi, backend o dati cliente.
- Report operativo: `reports/ipad-analyzer/IPAD_REPORT_TEXT_POST_ROUTINE_BASELINE_CLEANUP_2026-06-18.md`.

## Stato iPad report autogenerate from photos fix 2026-06-18
- Direzione owner: dopo aver fatto le foto, passando a `Report` il report non veniva creato. Serve generazione automatica dalla sessione fotografica corrente.
- Gate Core Codex classico tentato ma `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner fix: `ensure_process_current_capture_on_report`; winner install: `signed_build_install_same_bundle_preserve_data`. Input: `reports/universal-core/codex/ipad_report_autogenerate_from_photos_fix_core2_input_2026_06_18.json`, `reports/universal-core/codex/ipad_report_autogenerate_from_photos_install_core2_input_2026_06_18.json`.
- `ContentView.swift`: aggiunti `sessionHasMetricImagesForReport`, `ensureCurrentCaptureProcessedForReport(...)`, `prepareReportScreenIfNeeded()` e firma `lastAutoGeneratedReportSignature`.
- Entrando in `Report`, se la sessione ha foto/polarizzazioni ma non score, l'app calcola score/marker con il motore esistente e genera il testo. Solo se non ci sono foto nuove puo ripristinare un report storico.
- `runAnalysis()` non si ferma piu su `mancano score` quando puo ancora processare le foto presenti nella sessione corrente.
- Build iPad generica OK, build firmata OK, install sopra `com.skinharmony.analyzerpro.ipad` su `iPad (2)` OK senza uninstall/reset dati. Installation URL `/private/var/containers/Bundle/Application/E49D6E8D-0BB4-470F-958E-29D26DF88086/SkinAnalyzerProiPad.app/`.
- Non modificati scoring, marker, immagini 3D, prodotti, chiavi API, backend o dati cliente.
- Report operativo: `reports/ipad-analyzer/IPAD_REPORT_AUTOGENERATE_FROM_PHOTOS_FIX_2026-06-18.md`.

## Stato iPad client explicit flow + Nyra age fallback Render 2026-06-18
- Direzione owner: in `Acquisizione` l'app non deve piu riprendere l'ultimo cliente; il cliente va scelto ogni volta o ereditato solo se si parte dalla scheda cliente. Anamnesi possibile anche senza cliente. Cristian non deve piu finire nello storico Laura Brignola.
- Gate Core Codex classico tentato ma `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato. Core 2.0 locale usato come giudice operativo.
- Core 2.0 winner codice iPad: `required_full_narrow_patch`; winner install/deploy: `install_and_deploy_narrow`; winner reinstall finale post-fix: `rebuild_and_reinstall_preserve_container`. Input: `reports/universal-core/codex/ipad_acquisition_client_batch_ai_flow_core2_input_2026_06_18.json`, `reports/universal-core/codex/ipad_acquisition_required_full_narrow_core2_input_2026_06_18.json`, `reports/universal-core/codex/ipad_client_flow_install_nyra_age_deploy_core2_input_2026_06_18.json`, `reports/universal-core/codex/ipad_client_explicit_general_acquisition_reinstall_core2_input_2026_06_18.json`.
- `ContentView.swift`: all'avvio non seleziona piu automaticamente un cliente; nuova acquisizione globale parte `Analisi non collegata`; i punti di ingresso generici chiamano `beginNewAcquisition()` senza preservare l'ultimo cliente; barra cliente visibile in Analisi; auto-save nello storico solo se collegamento cliente esplicito; nuova analisi da scheda cliente crea sessione pulita collegata al cliente; batch processing finale con report automatico e overlay `Elaborazione SkinHarmony`.
- `TrichoCameraEngine.swift`: rimosso `Ricerco camera...`, sostituito con `Attendi l'immagine live`; `ContentView.swift` filtra eventuali messaggi di ricerca camera.
- `AnalyzerAIClient.swift`: fallback locale piu profondo per estetica, farmacia e medico; la lettura marker ora esiste anche per estetica con linguaggio da cabina.
- iPad installato sopra stesso bundle `com.skinharmony.analyzerpro.ipad` su `iPad (2)` / `0183BC47-A31A-5F38-972B-F4C43D30B3DE`, senza uninstall e senza reset dati. Build generica e build firmata finali OK; installation URL finale `/private/var/containers/Bundle/Application/E046FC63-D59E-4F25-996A-B9769F91AA4F/SkinAnalyzerProiPad.app/`.
- Backend Nyra Render: commit `5a59e9b Fix Nyra Analyzer client age fallback` pushato su `main`; `server.js` ora legge eta/profilo anche da `body.client`, `data.client`, `payload.client`, `context.client`.
- Smoke live Render OK: POST con eta solo in `client.age=52` restituisce `profile_summary=["eta 52","sesso M",...]` e `age_context.band=45_54`.
- File Smart Desk sporchi nel repo backend lasciati fuori commit: `smartdesk-live/data/users.json`, `smartdesk-live/public/assets/index-f22rzXR3.js`.
- Non modificati scoring, marker, immagini 3D, prodotti, chiavi API o dati cliente salvati.
- Report operativo: `reports/ipad-analyzer/IPAD_CLIENT_EXPLICIT_BATCH_AUTO_REPORT_NYRA_AGE_FIX_2026-06-18.md`.

## Stato Nyra Analyzer anti-clone voice variants Render 2026-06-18
- Direzione owner: Laura Brignola e ultimo Cristian hanno dominante simile (`redness_sensitivity_signals=50`) e testo troppo simile; Nyra deve differenziare il report quando cambiano score secondari, foto e pattern.
- Gate Core Codex classico tentato per deploy ma `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato.
- Core 2.0 locale usato come giudice operativo. Input: `reports/universal-core/codex/nyra_analyzer_anti_clone_voice_deploy_core2_input_2026_06_18.json` e `reports/universal-core/codex/nyra_analyzer_voice_variant_core2_input_2026_06_18.json`; audit latest `universal-core/reports/universal-core/codex/codex_core_decision_latest.json`.
- Backend Render `/Users/cristiancardarello/skinharmony-ai-backend`: commit `36c23ae Improve Nyra Analyzer voice variation` e commit finale `59475d4 Add Nyra Analyzer voice variants` pushati su `main`.
- `personal-control-center/server.js`: il voice selector calcola `secondary_signature`, `stable_signature`, `score_signature`, `voice_variant_id` e usa segnali secondari per generare una riga di lettura incrociata diversa anche se lo `selected_style_mode` collide.
- Live Render verificato su `https://skinharmony-nyra-core.onrender.com`: Laura HTTP 200, `voice_variant_id=8`, secondari con discromie -> uniformita cromatica/melanina visibile; Cristian HTTP 200, `voice_variant_id=6`, secondari con texture -> trama cutanea/compattezza/superficie.
- Non modificati scoring, marker, immagini 3D, app iPad, prodotti, dati cliente o chiavi. File Smart Desk sporchi nel repo backend lasciati fuori commit.
- Report operativo: `reports/nyra-analyzer/NYRA_ANALYZER_ANTI_CLONE_VOICE_VARIANTS_RENDER_DEPLOY_2026-06-18.md`.

## Stato Nyra Analyzer style modes Render 1.9.1 2026-06-18
- Direzione owner: 3 stili/profili visibili sono pochi; mantenere i 3 setup struttura ma aumentare i registri interni per far sembrare Nyra piu reale e meno ripetitiva.
- Core 2.0 locale usato come giudice operativo: input `reports/universal-core/codex/nyra_analyzer_style_modes_1_9_1_deploy_core2_input_2026_06_18.json`, winner `deploy_style_modes_narrow`, non bloccato, control level `suggest`.
- Gate Core Codex classico tentato prima del deploy ma non raggiungibile su `127.0.0.1:3199`; nessun allow inventato.
- Nyra Analyzer live su Render ora e `version=1.9.1`, `voice_library.version=1.91`, `voice_orchestrator.version=1.9.1`.
- I setup commerciali restano 3: `aesthetic_center`, `pharmacy_dermocosmetic`, `medical_dermatology`; i registri voce interni sono 18 totali, 6 per profilo.
- `server.js`: aggiunta selezione `selected_style_mode` via seed report/cliente/metrica; il `reply` visibile non mostra piu righe interne tipo `Setup struttura`, `Usare linguaggio`, `Regola Core`, `Libreria Nyra`, `Linguaggio cliente`.
- Deploy Render: commit `536c52e` ha portato style modes; commit correttivo `aeb0c2e` ha pulito il reply visibile. Deploy finale live `dep-d8puarojo6nc73f6tkog`.
- Smoke live `/api/nyra/analyzer/read-only` OK su estetica/farmacia/medico con seed diversi: registri diversi e `bad=false`.
- Non modificati scoring, marker, iPad, immagini 3D, prodotti o chiavi.
- Report operativo: `reports/nyra-analyzer/NYRA_ANALYZER_STYLE_MODES_1_9_1_RENDER_DEPLOY_2026-06-18.md`.

## Stato iPad medical report visible text fix 2026-06-18
- Direzione owner: dopo test solo `Studio Medico`, eliminare scorie visibili nel report tipo `- Prodotto: attivi/famiglia...` e `- Evita: intensita alta...`; risolvere residui di identita estetica come `prevenzione estetica` nel profilo medico.
- Core 2.0 locale usato come giudice operativo: winner `prompt_sanitizer_fallback_visible_text_patch`; input `reports/universal-core/codex/ipad_medical_report_visible_debug_identity_fix_core2_input_2026_06_18.json`; audit latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Gate Core classico tentato dopo verifica ma ancora `core_unreachable` su `127.0.0.1:3199`; nessun allow inventato.
- `AnalyzerAIClient.swift`: prompt OpenAI non chiede piu formato tecnico `Prodotto: usa X`; aggiunta regola anti righe interne `- Prodotto:`, `- Evita:`, `attivi/famiglia`, tag/preset; profilo medico forza studio medico/quadro dermatologico/percorso clinico al posto di centro estetico/cabina/prevenzione estetica/percorso estetico.
- `AnalyzerAIClient.swift`: aggiunta `visibleProductRecommendationLine(...)`, `operationalActionPlan(...)` ora produce frase cliente `Azione consigliata...` invece di mini-lista raw, sanitizer riscrive o blocca righe payload residue se tornano da Nyra/Core/OpenAI.
- `makePattern(...)` non genera piu `prevenzione estetica` come pattern locale.
- Verifica: build Xcode generica reale fuori sandbox OK con `BUILD SUCCEEDED`; la build sandbox falliva solo su `actool/CoreSimulator`, problema noto.
- Installazione iPad completata dopo Core 2.0 winner `install_same_bundle_preserve_data`; build firmata device OK con provisioning profile `7f8fa63f-ecc1-4bf0-98e9-d67a9d0c8bf1`; `devicectl install` OK sopra bundle `com.skinharmony.analyzerpro.ipad`, installation URL `/private/var/containers/Bundle/Application/F99D7107-2FB0-4DE9-9EAA-FD0387308924/SkinAnalyzerProiPad.app/`.
- Non modificati scoring, marker, immagini 3D, prodotti, chiavi, dati cliente o deploy Render. Nessun uninstall/reset container.
- Report operativo: `reports/ipad-analyzer/IPAD_MEDICAL_REPORT_VISIBLE_DEBUG_IDENTITY_FIX_2026-06-18.md`.

## Stato iPad sellable UI polish 2026-06-17
- Direzione owner: rendere SkinHarmony Analyzer Pro iPad piu vendibile e meno tecnico: archivio cliente scorrevole, prodotti con azioni rapide, eliminare termini interni, evitare duplicazione chiavi AI, verificare Core V2 e valutare V7.
- Gate Core classico tentato e bloccato con `CORE_2_0_REQUIRED`; usato Core 2.0 locale come giudice operativo.
- Core 2.0 winner `narrow_sellable_ui_polish_local`; input `reports/universal-core/codex/ipad_sellable_ui_polish_core2_input_2026_06_17.json`; audit `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- `ContentView.swift`: pagina dettaglio cliente resa scorrevole, archivio report e prodotti passati a `LazyVStack`, aggiunta colonna prodotti `Azioni`, comandi rapidi archivia/elimina, wording prodotti ripulito da `ERP/Pulisci`.
- `AISettingsView.swift`: chiavi report deduplicate; le impostazioni avanzate mostrano stato assistente/profilo/logo/qualita/catalogo e non duplicano endpoint/chiavi.
- `AnalyzerSettings.swift`, `OriginalScoringEngine.swift`, `AnalyzerAIClient.swift`: ripulite etichette visibili e prompt da termini interni come `Android-like`, `OEM`, `score.properties`, `Core Render`, `Rust Digest`, `scala Android`, `Marker evidence`.
- Core V2 Rust Digest verificato: build iOS linka `-luniversal_core_rust`; `strings` conferma simboli `sh_core_v2_digest_compute`, `sh_core_v2_digest_contract_version`, `sh_core_v2_digest_self_test`. `nm` Apple non legge tutti gli oggetti Rust per mismatch LLVM, ma build OK e simboli presenti.
- V7 non inserito in questo blocco: va trattato separatamente come layer di sovrapposizione segnali Nyra/Core, non come fix UI iPad.
- Verifica: build iOS generica fuori sandbox OK con `BUILD SUCCEEDED`.
- Richiesta owner successiva `ok e installato su ipad?`: usato Core 2.0 locale per installazione; winner `install_same_bundle_preserve_data`, input `reports/universal-core/codex/ipad_sellable_ui_polish_install_core2_input_2026_06_17.json`.
- Primo install della build generic non firmata fallito correttamente con `No code signature found`; eseguito rebuild firmato per iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` con profilo `7f8fa63f-ecc1-4bf0-98e9-d67a9d0c8bf1`, build OK.
- Installazione finale iPad OK sopra stesso bundle `com.skinharmony.analyzerpro.ipad`, senza uninstall e senza reset container; installation URL `/private/var/containers/Bundle/Application/550760D4-F2EE-45C5-BB82-6CA4709E6A2E/SkinAnalyzerProiPad.app/`.
- Non modificati scoring, marker, dati cliente, chiavi reali o deploy Render.
- Report operativo: `reports/ipad-analyzer/IPAD_SELLABLE_UI_POLISH_2026-06-17.md`.

## Stato Nyra Analyzer voice library Render + iPad install 2026-06-17
- Direzione owner: installare su iPad e deployare su Nyra Render, poi verificare che iPad usi la versione corretta di Nyra.
- Core 2.0 locale ha selezionato `narrow_build_install_sync_deploy_verify`; input `reports/universal-core/codex/nyra_voice_library_ipad_install_render_deploy_core2_input_2026_06_17.json`; audit `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Gate Core Codex classico tentato prima del deploy ma non raggiungibile su `127.0.0.1:3199`; nessun allow inventato.
- iPad: build fisica Xcode OK e install sopra bundle `com.skinharmony.analyzerpro.ipad` OK su device `0183BC47-A31A-5F38-972B-F4C43D30B3DE`, senza uninstall e senza reset container.
- App iPad installata contiene default Nyra endpoint `https://skinharmony-nyra-core.onrender.com/api/nyra/analyzer/read-only`, `voice_library_id=nyra_skinharmony_analyzer_voice_library_v1` e `voice_library_contract` nel payload Analyzer.
- Render Nyra: commit `e1cfe51 Deploy Nyra Analyzer voice library 1.7.0` pushato su `/Users/cristiancardarello/skinharmony-ai-backend`; inclusi solo `personal-control-center/server.js` e `personal-control-center/data/nyra-analyzer-learning-pack.json`.
- File Smart Desk sporchi nel repo Render esclusi: `smartdesk-live/data/users.json`, `smartdesk-live/public/assets/index-f22rzXR3.js`.
- Live `GET https://skinharmony-nyra-core.onrender.com/api/nyra/analyzer/learning-pack` risponde `version=1.7.0`, `voice_library.present=true`, id `nyra_skinharmony_analyzer_voice_library_v1`, 3 profili, 6 metriche, 270 esempi, 16 fonti.
- Smoke live `POST /api/nyra/analyzer/read-only` OK per `aesthetic_center`, `pharmacy_dermocosmetic`, `medical_dermatology`: stesso score SB ma tono cambia tra estetica, dermocosmesi e medico.
- Container iPad: durante il primo copy flag `devicectl` ha interpretato `Documents/SkinHarmonyAnalyzerPro` come file; ripristinato subito da backup completo `/private/tmp/skinharmony-ipad-voice-container-pull`. Verifica finale: `Documents/SkinHarmonyAnalyzerPro` e directory, `clients` presente, `latest_capture` presente, `run_ai_smoke.flag` presente.
- Blocco residuo: runtime smoke iPad non ancora consumato perche `devicectl process launch` fallisce con `Timed out waiting for CoreDeviceService to fully initialize`; `xcrun xcdevice list` vede comunque iPad via USB e `devicectl copy` funziona.
- Prossimo step: aprire manualmente SkinAnalyzerPro su iPad sbloccato, attendere il consumo di `run_ai_smoke.flag`, poi copiare `Documents/SkinHarmonyAnalyzerPro/ai_smoke_latest.json` e verificare redatto `configuration_summary`, `has_core`, `has_nyra`, `has_openai`, `source`.
- Report operativo: `reports/nyra-analyzer/NYRA_ANALYZER_VOICE_LIBRARY_RENDER_DEPLOY_IPAD_INSTALL_2026-06-17.md`.

## Stato SkinHarmony Analyzer Voice Library 2026-06-17
- Direzione owner: fare ricerca ampia su come siti medici, farmacie/dermocosmesi ed estetica parlano delle problematiche viso leggibili dai marker; salvare una libreria proprietaria per migliorare report Nyra/Core/OpenAI senza copiare testi e senza cambiare scoring/marker.
- Core 2.0 locale ha selezionato `source_based_voice_library_plus_selector`; input `reports/universal-core/codex/skinharmony_analyzer_voice_library_core2_input_2026_06_17.json`; audit `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Creato generatore `universal-core-2.0/tools/skinharmony-analyzer-voice-library.ts`, test `universal-core-2.0/tests/skinharmony-analyzer-voice-library-test.ts`, pack runtime `universal-core-2.0/runtime/nyra-learning/nyra_skinharmony_analyzer_voice_library_latest.json` e report `reports/nyra-analyzer/SKINHARMONY_ANALYZER_VOICE_LIBRARY_2026-06-17.md`.
- Pack attuale: 3 profili (`aesthetic_center`, `pharmacy_dermocosmetic`, `medical_dermatology`), 6 marker (`FS/YF/XW/YZ/SB/MK`), 270 esempi, 4320 varianti potenziali, 16 fonti.
- `AnalyzerAIClient.swift` ora passa `voice_library_id` e `voice_library_contract` a OpenAI/Nyra/Core. Forma obbligatoria del report: problema visibile -> causa possibile -> soluzione -> evita -> controllo; OpenAI resta rifinitore, non decide priorita o prodotti.
- Verifiche OK: `npm run skinharmony:analyzer-voice-library`, `npm run check:skinharmony:analyzer-voice-library`. Build iPad con signing off si e fermato su `Assets.xcassets` per CoreSimulator non disponibile nella sandbox, senza errori Swift emersi prima dello stop.
- Report implementativo: `reports/nyra-analyzer/SKINHARMONY_ANALYZER_VOICE_LIBRARY_IMPLEMENTATION_2026-06-17.md`.

## Stato iPad provisioning scaduto / app non disponibile 2026-06-17
- Direzione owner: la build vendibile di SkinHarmony Analyzer Pro non deve scadere; la scadenza e accettabile solo per test Xcode/TestFlight, non per clienti paganti.
- Causa verificata del messaggio iOS `SkinAnalyzer Pro non e piu disponibile`: provisioning profile sviluppo scaduto. Vecchia scadenza embedded profile `2026-06-17T14:12:33Z` (`2026-06-17 16:12:33` ora Italia).
- Core 2.0 locale ha scelto `rebuild_reinstall_same_bundle_preserve_data`; input `reports/universal-core/codex/ipad_app_not_available_provisioning_renew_core2_input_2026_06_17.json`; report `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`. Gate classico Core Codex tentato per update memoria ma non raggiungibile su `127.0.0.1:3199`; nessun allow inventato.
- Eseguito rebuild Xcode con `-allowProvisioningUpdates` e install sopra stesso bundle `com.skinharmony.analyzerpro.ipad`, senza disinstallare e senza cancellare dati.
- Nuovo profilo sviluppo generato: UUID `7f8fa63f-ecc1-4bf0-98e9-d67a9d0c8bf1`, scadenza `2026-06-24T15:13:26Z`. Questo risolve il test locale solo temporaneamente: resta una firma sviluppo da 7 giorni.
- Stato residuo iPad: install OK; launch da Mac bloccato finche il profilo Apple Development non viene autorizzato manualmente in `Impostazioni -> Generali -> VPN e gestione dispositivo`.
- Regola commerciale fissata: per vendere non usare install Xcode/debug. Serve distribuzione commerciale Apple: App Store pubblico/non in elenco o Custom App privata via Apple Business Manager per centri/farmacie/studi; TestFlight resta beta; Enterprise/In-house solo per uso interno aziendale, non vendita a clienti terzi.
- Report operativo: `reports/ipad-analyzer/IPAD_PROVISIONING_EXPIRED_RENEW_ATTEMPT_2026-06-17.md`.

## Stato iPad 3D visual refinement + linguaggio medico 2026-06-17
- Direzione owner: rifinire le mappe 3D a tassello zona per rossore, discromia, sebo e tono; in profilo medico sostituire termini estetici generici con linguaggio dermatologico/clinico prudente.
- Core 2.0 locale ha scelto `visual_renderer_plus_profile_language_sanitizer`; input `reports/universal-core/codex/ipad_3d_visual_refinement_medical_language_core2_input_2026_06_17.json`; report `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- `OriginalScoringEngine.swift` aggiornato senza toccare score/soglie: `YZ` ha superficie traslucida e glow rosso interno, `SB` usa base verde/azzurro quando lo score e alto e marrone solo su segnali pigmentari forti, `MK` aggiunge micro-cratere/poro sotto i punti neon e mantiene sfondo scuro, `FS` usa gradiente fumo/platino per opacita vs rifrazione buona, `YF` resta proporzionale.
- `AnalyzerAIClient.swift` aggiorna `sanitizePremiumReportLanguage` con filtro solo `medical_dermatology`: centro estetico -> studio medico, lavoro estetico -> protocollo clinico, percorso estetico/cosmetico -> percorso medico, lettura estetica -> lettura dermatologica, problema estetico -> quadro dermatologico osservabile.
- Verifiche: Xcode build OK, install su iPad senza disinstallare OK, launch bundle `com.skinharmony.analyzerpro.ipad` OK. Report: `reports/ipad-analyzer/IPAD_3D_VISUAL_REFINEMENT_AND_MEDICAL_LANGUAGE_2026-06-17.md`.
- Nota: i file `*_3d.jpg` gia salvati nei vecchi report restano storici finche non vengono rigenerati/risalvati; nuove analisi e nuovi salvataggi usano il renderer aggiornato.

## Stato iPad 3D tasselli zona + recupero storico Cristian 2026-06-17
- Direzione owner: le immagini 3D non sono volto intero, ma tasselli micro-topografici laterali/obliqui della singola zona tricocamera; ogni marker `FS/YF/XW/YZ/SB/MK` deve avere resa scenica diversa, senza cambiare scoring.
- Core 2.0 locale ha scelto `cached_metric_specific_micro_topography_tile`; input `reports/universal-core/codex/ipad_3d_zone_tile_marker_styles_core2_input_2026_06_17.json`.
- `OriginalScoringEngine.swift` aggiornato: `*_3d.jpg` resta artefatto cacheato; renderer con stili separati FS argilla/corneo, YF gel/acqua, XW topografico linee/solchi, YZ heatmap vascolare, SB seppia/x-ray pigmento, MK antracite/UV pori neon.
- Scoring numerico, soglie marker e AI non modificati dal blocco 3D.
- Durante il controllo owner sulle immagini vecchie, verificato che lo storico Cristian non era perso: cartella iPad `clients/F13C1889-7636-4197-86DE-3B87C569C0E7` contiene `14` sessioni storiche e `685` file verificati.
- Problema reale: UserDefaults puntava a un duplicato vuoto `Cristian` ID `500EEC2B-98A2-411A-8F90-F9708D4F5490` con `0` immagini e nessun `client_history.json`; la UI apriva quello, facendo sembrare sparite le immagini.
- Core 2.0 locale ha scelto `filesystem_client_discovery_merge`; input `reports/universal-core/codex/ipad_client_history_duplicate_restore_core2_input_2026_06_17.json`.
- `ClientHistoryStore.swift` ora scopre i clienti anche da `Documents/SkinHarmonyAnalyzerPro/clients/*/client_index.json` e da `client_history.json`/`sessions`.
- `ContentView.swift` fonde UserDefaults con filesystem e filtra duplicati stesso nome senza sessioni valide quando esiste un cliente storico con report validi; poi salva la lista corretta.
- Dopo build/install/launch su iPad, UserDefaults finale contiene `Cristian -> F13C1889-7636-4197-86DE-3B87C569C0E7`, ultimo report `20260616_144805_Cristian`; il duplicato vuoto `500EEC2B...` non compare piu.
- Verifiche: Xcode build OK, install iPad OK senza disinstallare, launch OK, preferenze finali copiate e decodificate. Nessuna cancellazione dati cliente eseguita. Report: `reports/ipad-analyzer/IPAD_3D_ZONE_TILE_AND_CLIENT_HISTORY_RECOVERY_2026-06-17.md`.
- Nota aperta: il reprocess automatico `latest_capture` per rigenerare subito tutti i `*_3d.jpg` storici ha consumato il flag ma non ha prodotto il JSON risultato nel test precedente; va verificato separatamente se serve reprocess massivo, mentre le nuove elaborazioni usano gia il nuovo renderer installato.

## Stato iPad marker visuali + testo medico 2026-06-16
- Direzione owner: verificare test reale iPad su tono, idratazione, texture, pori/sebo e debolezza del testo medico; usare Core 2.0 come giudice.
- Core 2.0 locale ha selezionato `visual_marker_only` per i marker e `prompt_only` per il testo medico; input `reports/universal-core/codex/ipad_marker_medical_report_quality_core2_input_2026_06_16.json` e `reports/universal-core/codex/ipad_medical_text_depth_core2_input_2026_06_16.json`; report latest `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Ispezionata sessione iPad reale `clients/500EEC2B-98A2-411A-8F90-F9708D4F5490/sessions/20260616_230909_Cristian`, score `fs=70`, `yf=95`, `xw=75`, `yz=53`, `sb=79`, `mk=51`.
- SkinHarmony Analyzer Pro iPad aggiornato e reinstallato senza disinstallare su device `0183BC47-A31A-5F38-972B-F4C43D30B3DE`, bundle `com.skinharmony.analyzerpro.ipad`; launch OK.
- File modificati: `OriginalScoringEngine.swift`, `ContentView.swift`, `AnalyzerAIClient.swift`.
- Scoring numerico e algoritmo punteggi non modificati.
- FS/tono: rimosso effetto mappa piena troppo rumorosa; ora il marker e piu selettivo, ma la qualita/focus della foto resta bassa e deve pesare poco nel report.
- YF/idratazione: confermato che non e marker puntuale; e mappa diffusa barriera/film idrolipidico. UI/report ora la etichettano come `Mappa barriera diffusa`.
- XW/texture: ridotti marker da circa `140` a `77` nel reprocess, ma resta il marker da rifinire per separare meglio micro-rilievo reale, riflesso lucido e peli.
- SB/discromia controllata su `sb.jpg` e `sb_0.jpg`: immagine con prevalenza rossore/vascolare, peli e micro-punti scuri; focus `0.8`, `comparison_quality_low`, `markerMaskPercent=7`, `markerObjectCount=0`. Core 2.0 ha scelto `observe_only` su input `reports/universal-core/codex/ipad_sb_discromia_marker_visual_refinement_core2_input_2026_06_16.json`; non modificare scoring/renderer SB finche non esiste uno scatto discromia piu pulito.
- MK/pori-sebo: aggiunta distinzione visuale tra cerchio rosso su fluorescenza arancio/rossa forte e cerchio giallo tratteggiato su candidati gialli piu deboli; non tutti i gialli sono segnale principale.
- Prompt Nyra/OpenAI rafforzato per profilo medico/farmacia: marker evidence concreta, qualita/focus, linguaggio medico-estetico/dermocosmetico; OpenAI resta solo rifinitore testo.
- Reprocess latest_capture su iPad OK con `--reprocess-latest-capture-on-launch`; output copiato in `reports/ipad-analyzer/reprocess-marker-medical-2026-06-16/reprocessed/20260616_233348_Cliente_iPad`.
- Report operativo: `reports/ipad-analyzer/IPAD_MARKER_VISUAL_AND_MEDICAL_TEXT_REFINEMENT_2026-06-16.md`.

## Stato iPad report foto + timing scatti 2026-06-16
- Direzione owner: migliorare visualizzazione foto report, ridurre attesa scatti a 3 secondi per luce e togliere il ritorno finale a luce 2 senza scatto.
- Core 2.0 locale ha selezionato `ui_report_image_frame_plus_three_second_light_capture`; input `reports/universal-core/codex/ipad_report_photo_capture_timing_core2_input_2026_06_16.json`; report `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- SkinHarmony Analyzer Pro iPad aggiornato e reinstallato senza disinstallare su device `0183BC47-A31A-5F38-972B-F4C43D30B3DE`, bundle `com.skinharmony.analyzerpro.ipad`.
- File modificato: `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native/SkinAnalyzerProiPad/ContentView.swift`.
- `ReportImageBox` ora usa card chiara SkinHarmony, bordo ciano/blu e immagine `scaledToFill` ritagliata, evitando la schermata nera pesante nella pagina report; anteprima grande cliccabile mantenuta.
- La sequenza acquisizione e ora solo `2 -> 3 -> 4`, con countdown fisso di 3 secondi per ogni luce.
- Rimossa la logica che dopo i tre scatti riportava a luce 2, ricontava e non scattava.
- Scoring, marker, AI, cartelle cliente, report storici e chiavi non modificati.
- Verifiche finali: Xcode build OK, install iPad OK, launch iPad OK dopo retry fuori sandbox per timeout intermittente CoreDeviceService.
- Report operativo: `reports/ipad-analyzer/IPAD_REPORT_PHOTO_UI_AND_CAPTURE_TIMING_2026-06-16.md`.

## Stato Nyra Analyzer Render 1.6.0 deploy 2026-06-16
- Direzione owner: fare deploy usando Core 2.0 come giudice operativo.
- Core 2.0 locale ha selezionato `narrow_analyzer_sync_commit_push_verify`; report `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`; input `reports/universal-core/codex/nyra_analyzer_render_1_6_deploy_core2_input_2026_06_16.json`.
- Repo Render reale: `/Users/cristiancardarello/skinharmony-ai-backend`; servizio live `skinharmony-nyra-core`.
- Commit deployato: `16d3806 Deploy Nyra Analyzer profile pack 1.6.0`.
- File inclusi: `personal-control-center/server.js` e `personal-control-center/data/nyra-analyzer-learning-pack.json`.
- File Smart Desk sporchi preesistenti nel repo Render non inclusi nel commit: `smartdesk-live/data/users.json`, `smartdesk-live/public/assets/index-f22rzXR3.js`.
- Live `GET /api/nyra/analyzer/learning-pack` ora risponde `version=1.6.0` e profili `aesthetic_center`, `pharmacy_dermocosmetic`, `medical_dermatology`.
- Smoke live medico OK: `practice_profile=medical_dermatology`, header `Nyra Analyzer - lettura professionale per contesto medico`, dominante test `texture_fine_lines`, `medical_professional_language=true`, `no_automatic_definitive_diagnosis=true`.
- Smoke live farmacia OK: `practice_profile=pharmacy_dermocosmetic`, header `Nyra Analyzer - lettura dermocosmetica`, dominante test `pores_texture`.
- Health live OK: `{"ok":true,"service":"skinharmony-nyra-core"}`.
- Report operativo: `reports/nyra-analyzer/NYRA_ANALYZER_RENDER_1_6_0_DEPLOY_2026-06-16.md`.
- Nessun segreto o dato cliente reale salvato; i payload live erano fittizi.

## Stato iPad report immagini cliccabili + Nyra medical text 2026-06-16
- Direzione owner: marker approvati; migliorare report immagini e testo, verificare Nyra; usare Core 2.0 sempre e solo quello.
- Core 2.0 locale ha scelto `ui_clickable_images_plus_nyra_contract_fix`, report `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- SkinHarmony Analyzer Pro iPad aggiornato e reinstallato su device `0183BC47-A31A-5F38-972B-F4C43D30B3DE`, bundle `com.skinharmony.analyzerpro.ipad`.
- Report immagini: `ReportImageBox` ora apre `ReportImagePreviewSheet` con immagine grande, sfondo nero, pulsante chiudi e pinch zoom; vale per originale, rielaborazione marker e luci 2/3/4.
- AnalyzerAIClient: se Nyra remota risponde e OpenAI non e disponibile/fallisce, l'app ora usa il testo Nyra invece di scartarlo e tornare al precompilato. Rafforzato anche prompt Nyra e fallback locale per profilo medico/farmacia.
- Scoring e marker non modificati.
- Verifica Nyra live: Render risponde `version=1.4.0`, `practice_profiles=[]`, e su payload medico fittizio resta `lettura estetica premium`; quindi il cloud non e ancora allineato al pack locale `personal-control-center/data/nyra-analyzer-learning-pack.json` `1.6.0` con profili e marker.
- Per tono medicale cloud reale serve fase separata di deploy Nyra Render del pack/runtime aggiornato.
- Verifiche finali: Xcode build OK, install iPad OK, launch OK, processo `SkinAnalyzerProiPad` presente, nessun nuovo crash log dopo questa build.
- Report operativo: `reports/ipad-analyzer/IPAD_REPORT_IMAGE_ZOOM_AND_NYRA_MEDICAL_TEXT_2026-06-16.md`.

## Stato iPad chiavi AI visibili in Sistema 2026-06-16
- Direzione owner aggiornata: usare Core 2.0 sempre e solo quello per questo blocco; non usare il gate classico come fonte decisionale.
- Core 2.0 locale ha scelto la variante `inline_system_ai_keys_panel`, report `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- SkinHarmony Analyzer Pro iPad aggiornato e reinstallato su device `0183BC47-A31A-5F38-972B-F4C43D30B3DE`, bundle `com.skinharmony.analyzerpro.ipad`.
- Aggiunta card `Chiavi AI report` direttamente nella schermata `Sistema`, visibile senza modalita sviluppatore: endpoint Core, chiave controllo report, endpoint Nyra, chiave lettura estetica, modello OpenAI, chiave testo premium, stati attivo/mancante e pulsanti salva/impostazioni complete/rimuovi.
- Il foglio `Impostazioni avanzate` resta disponibile, ma non e piu l'unico punto dove vedere o modificare endpoint e chiavi.
- Smoke redatto dopo rilancio: `ok=true`, `configuration_summary=Assistente avanzato attivo`, `has_core=true`, `has_nyra=true`, `has_openai=true`, `score_count=6`, `source=SkinHarmony AI Pro`.
- Nessun valore API key scritto in report, snapshot o log finale.
- Incidente corretto: la prima versione inline complessa ha prodotto crash iPad `SIGSEGV / EXC_BAD_ACCESS` con ultimo log `SkinAnalyzerProiPad-2026-06-16-220554.ips`; Core 2.0 ha poi selezionato `external_component_fix`.
- Fix finale: `ContentView` mantiene solo wrapper leggero e la card e stata isolata in componenti SwiftUI esterni `SystemAIKeysInlinePanel` / `SystemAIProviderFields` / `SystemAISecureField`, riducendo la complessita SwiftUI nel view principale.
- Verifiche finali: Xcode build OK, install iPad OK, launch iPad OK, processo `SkinAnalyzerProiPad` presente dopo il lancio, nessun nuovo crash log dopo le `22:12`.
- Report operativo: `reports/ipad-analyzer/IPAD_AI_KEYS_INLINE_SYSTEM_PANEL_2026-06-16.md`.

## Stato iPad face marker ontology FS/YF/XW/YZ/SB/MK 2026-06-16
- Correzione direzione owner: scalp analyzer rimandato; questa fase riguarda solo Skin Care viso.
- SkinHarmony Analyzer Pro iPad aggiornato e reinstallato su device `0183BC47-A31A-5F38-972B-F4C43D30B3DE`, bundle `com.skinharmony.analyzerpro.ipad`.
- Aggiornata mappa marker viso in `AnalyzerAIClient.swift`: FS luce bianca/corneo, YF UV/Wood idratazione/barriera, XW luce bianca micro-ombre/rughe, YZ polarizzata rossore/vascolare, SB polarizzata pigmento/discromie, MK UV/Wood sebo/porfirine.
- Aggiornato `personal-control-center/data/nyra-analyzer-learning-pack.json` a `1.6.0` con campi `spectrum`, `marker_model` e `rust_digest_logic` per le sei metriche viso.
- Scoring numerico e marker visual engine non modificati in questa fase.
- Fonti usate nel report: Canfield VISIA, DermNet Wood lamp, Perfect Corp AI Skin Analysis come riferimento competitivo.
- Core gate classico tentato ma non raggiungibile (`core_unreachable` su `127.0.0.1:3199`); nessun verdetto inventato.
- Verifiche: JSON Nyra pack OK, Xcode build OK, install iPad OK, launch iPad OK.
- Report operativo: `reports/ipad-analyzer/IPAD_FACE_MARKER_ONTOLOGY_FS_YF_XW_YZ_SB_MK_2026-06-16.md`.

## Stato iPad SkinHarmony Marker Engine V1 2026-06-16
- Direzione owner aggiornata: Android OEM cinese non e piu gold standard o modello da copiare; da ora SkinHarmony Analyzer Pro migliora i marker con standard proprietario SkinHarmony.
- SkinHarmony Analyzer Pro iPad aggiornato e reinstallato su device `0183BC47-A31A-5F38-972B-F4C43D30B3DE`, bundle `com.skinharmony.analyzerpro.ipad`.
- File modificato: `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native/SkinAnalyzerProiPad/OriginalScoringEngine.swift`.
- Creato standard marker V1 per `FS/YF/XW/YZ/SB/MK`: mask type proprietari `sh_v1_*` e flag `skinharmony_marker_engine_v1` nel payload evidence.
- Aggiunti helper visuali proprietari: `diagnosticBaseCopy`, `blobMarkers`, `markerImage`.
- Migliorati overlay: FS tono/corneo blu-ciano, YF barriera/acqua-sebo teal/blu, XW linee con halo, YZ rossore con blob marker, SB pigmento con blob marker tratteggiati, MK porfirine mantenuto nello standard V1.
- Scoring numerico, cartelle cliente, report storico, chiavi AI e Core V2 Rust Digest non modificati.
- Core gate classico tentato ma non raggiungibile (`core_unreachable` su `127.0.0.1:3199`); nessun verdetto inventato.
- Verifiche: Xcode build fuori sandbox OK, install iPad OK, launch iPad OK.
- Report operativo: `reports/ipad-analyzer/IPAD_SKINHARMONY_MARKER_ENGINE_V1_2026-06-16.md`.

## Stato iPad Core V2 Rust Digest prefilter 2026-06-16
- SkinHarmony Analyzer Pro iPad aggiornato e reinstallato su device `0183BC47-A31A-5F38-972B-F4C43D30B3DE`, bundle `com.skinharmony.analyzerpro.ipad`.
- Inserito nel software Analyzer il pre-filtro locale `Core V2 / Rust Digest` prima di Nyra/Core/OpenAI, nel file `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native/SkinAnalyzerProiPad/AnalyzerAIClient.swift`.
- Contratto corretto: `core_version=universal_core_v0`, `digest_version=universal_core_digest_v1`, `runtime_version=universal_core_digest_runtime_v2`, `runtime_contract=core_v2_rust_digest`.
- Il payload viene passato come `core_v2_digest` e `core_v2_digest_text` a provider envelope, OpenAI prompt, Nyra read-only e Universal Core Analyzer.
- Il digest ordina rischio, confidenza, priorita, fallback, segnali primari/secondari e modalita catalogo prima della generazione report.
- Aggiornamento finale: ora e linkata una staticlib Rust iOS arm64 `ThirdParty/CoreV2RustDigest/ios-arm64/libuniversal_core_rust.a`; Swift usa `implementation=rust_staticlib_ios_arm64` quando la chiamata Rust risponde e mantiene `swift_mirror_rust_staticlib_unavailable` solo come fallback.
- Funzioni Rust esportate e verificate nel binario finale: `_sh_core_v2_digest_compute`, `_sh_core_v2_digest_contract_version`, `_sh_core_v2_digest_self_test`.
- Core gate classico tentato ma non raggiungibile (`core_unreachable` su `127.0.0.1:3199`); nessun verdetto Core classico inventato.
- Verifiche: `rustup target add aarch64-apple-ios` OK, `cargo build --target aarch64-apple-ios --release --lib` OK, `cargo test --lib` OK, Xcode build OK, install iPad OK, launch iPad OK.
- Report operativo: `reports/ipad-analyzer/IPAD_CORE_V2_RUST_DIGEST_PREFILTER_2026-06-16.md`.

## Stato iPad Product Advisor / Gestione prodotti 2026-06-16
- SkinHarmony Analyzer Pro iPad aggiornato e reinstallato su device `0183BC47-A31A-5F38-972B-F4C43D30B3DE`, bundle `com.skinharmony.analyzerpro.ipad`.
- Aggiunto modulo home `Gestione prodotti` con sottotitolo `Catalogo, stock e Product Advisor`.
- `ProductRecord` esteso con `itemType`, `stockQuantity`, `thresholdQuantity`, `sku`, `supplier`, `costText`, `retailPriceText`, `packageContents`, `commercialRole`; la UI ora permette prodotto singolo, pacchetto/routine, tester/non vendibile, scorta, soglia, SKU, fornitore, costo/prezzo, campagna marketing, stock prioritario e stagionale.
- Aggiunto pannello `Campagna marketing intelligente` sopra la tabella prodotti: seleziona rapidamente i prodotti da spingere, solo tra quelli vendibili, salvando `commercialRole=campaign_focus`.
- Aggiunta estensione ERP locale leggera ispirata a Smart Desk/Suite: righe prodotto cliccabili/modificabili, selezione multipla, azioni massive `Tutti/Pulisci/Metti in campagna/Standard/Stock prioritario/Segna esauriti`, riepilogo valore retail e sottoscorta.
- Il testo del pannello prodotti cambia in base al setup struttura `Centro estetico/Farmacia/Medico`, mantenendo SkinHarmony come firma e adattando il perimetro commerciale.
- Il Product Advisor entra nel payload AI solo se il catalogo e attivo e solo con prodotti vendibili: tester/non vendibili e stock `0/esaurito/non disponibile` vengono esclusi.
- La campagna marketing non forza il report: viene usata solo come tie-break tra prodotti gia coerenti con punteggi, anamnesi e need tag.
- Se la campagna marketing non e attiva, il recommendation engine lavora in default su tutto il catalogo vendibile.
- Aggiornato `personal-control-center/data/nyra-analyzer-learning-pack.json` con ramo `commercial_recommendation_engine` / `nyra_analyzer_product_erp_commercial_recommendation_v1`: Nyra legge prodotto, stock, soglia, campagna, profilo struttura e decide solo prodotti reali coerenti; ERP/stock/campagna non devono comparire come spiegazione al cliente.
- Se non ci sono prodotti caricati/vendibili, il report non deve parlare di prodotti e non deve inventare nomi.
- Verifica aggancio: `products` e `catalog_decision` entrano nel provider envelope, in Universal Core Analyzer e in Nyra Analyzer read-only; OpenAI riceve il contesto dopo Nyra/Core con vincoli espliciti anti-invenzione.
- Build Xcode OK, install iPad OK, launch iPad OK.
- Report operativo: `reports/ipad-analyzer/IPAD_PRODUCT_ADVISOR_PHARMACY_ARCHITECTURE_2026-06-16.md`.
- Core 2.0 winner iniziale `local_product_advisor_visible_home_ai_catalog`; estensione campagna winner `campaign_panel_reuse_product_commercial_role`; estensione ERP locale winner `local_erp_lite_reuse_product_record`; report latest `reports/universal-core/codex/codex_core_decision_latest.json`.

## Stato iPad profile theme + logo personalizzato 2026-06-16
- SkinHarmony Analyzer Pro iPad aggiornato e reinstallato su device `0183BC47-A31A-5F38-972B-F4C43D30B3DE`, bundle `com.skinharmony.analyzerpro.ipad`.
- Aggiunto tema grafico dinamico in base a `Centro estetico`, `Farmacia`, `Medico` tramite `AnalyzerVisualTheme`.
- `Centro estetico` mantiene palette SkinHarmony; `Farmacia` usa palette verde dermocosmetica con croce; `Medico` usa palette fredda blu con simbolo medico.
- Aggiunta personalizzazione logo in `Impostazioni avanzate -> Brand e logo`; il logo viene salvato localmente in `Documents/SkinHarmonyAnalyzerPro/branding/custom_logo.png` e non viene committato.
- Aggiunta firma SkinHarmony fissa nella topbar prima del pulsante Home tramite `SkinHarmonyTopBarSignature`, separata dal logo personalizzabile. Il tentativo bottom-left e stato rimosso per feedback owner.
- Mappa colori e punti codice salvati in `reports/ipad-analyzer/IPAD_PROFILE_THEME_AND_BRAND_MAP_2026-06-16.md`.
- Build Xcode OK, install iPad OK, launch iPad OK.
- Core 2.0 winner `central_theme_tokens_profile_driven_with_logo_upload`; report `reports/universal-core/codex/codex_core_decision_latest.json`.

## Stato iPad marker ontology Farmacia/Medico 2026-06-16
- SkinHarmony Analyzer Pro iPad aggiornato e reinstallato su device `0183BC47-A31A-5F38-972B-F4C43D30B3DE`, bundle `com.skinharmony.analyzerpro.ipad`.
- File modificato: `tmp/ipad-marker-work/08-skinharmony-analyzer-pro-ipad-native/SkinAnalyzerProiPad/AnalyzerAIClient.swift`.
- Aggiunta ontologia nascosta per i sei marker `FS/YF/XW/YZ/SB/MK`: cosa leggono, limiti, aree migliori, cross-check e regole combinazione.
- La mappa viene passata a OpenAI, Nyra Analyzer, Nyra read-only generic e Universal Core Analyzer tramite `marker_dermatology_ontology`, `marker_dermatology_ontology_text`, `marker_combination_rules` e `score_reading.marker_ontology`.
- Profili `Farmacia` e `Medico` ora ricevono lettura piu profonda: farmacia in chiave dermocosmetica/routine/attivi/prodotto; medico in chiave clinica prudente con segni osservabili, compatibilita e correlazione con anamnesi.
- Nessun cambio a scoring, algoritmi marker, immagini rielaborate, cartelle cliente o chiavi.
- Build Xcode OK, install iPad OK, launch iPad OK.
- Report operativo: `reports/ipad-analyzer/IPAD_MARKER_MEDICAL_PHARMACY_NYRA_ONTOLOGY_2026-06-16.md`; Core 2.0 report latest `reports/universal-core/codex/codex_core_decision_latest.json`.

## Stato iPad Core key da WordPress generator 2026-06-16
- Generata dal WordPress live `Core Admin` una nuova API key Universal Core scoped per SkinHarmony Analyzer, senza stampare il segreto.
- Core Admin live verificato: plugin `1.0.3`, core url `https://skinharmony-universal-core.onrender.com`, admin key configurata, Core health OK.
- Key id generata: `key_151bce0f-dd6c-46a7-a463-7dfed1c0aa23`; tenant `analyzer-skinharmony`, brand `skinharmony`, tier `network`, active branch `skinharmony_analyzer`, scadenza `2027-06-16T23:59:59Z`.
- Smoke diretto Universal Core Render OK: `POST /v1/branches/skinharmony_analyzer/analyze` risponde `200 ok`, tenant status legge `active_branches=["skinharmony_analyzer"]`.
- Config Core+Nyra+OpenAI copiata nel container iPad `com.skinharmony.analyzerpro.ipad` come `Documents/SkinHarmonyAnalyzerPro/ai_config.json`; flag `run_ai_smoke.flag` copiato correttamente con nome file esplicito.
- Blocco residuo: `devicectl device process launch` fallisce sul Mac con timeout `CoreDeviceService`; `devicectl copy` funziona. Il flag risulta ancora presente, quindi l'app non ha ancora consumato la nuova config. Serve aprire manualmente `SkinHarmony Analyzer Pro` su iPad e poi ricopiare `ai_smoke_latest.json`.
- Smoke atteso dopo apertura manuale: `has_core=true`, `has_nyra=true`, `has_openai=true`.
- Plugin Core Admin locale aggiornato a `1.0.4` con preset `analyzer_connector`, branch `skinharmony_analyzer`, README aggiornato e zip verificato in `reports/wordpress/core-admin-analyzer-key-generator-2026-06-16/skinharmony-core-admin-1.0.4.zip`. Il live resta `1.0.3` finche lo zip non viene installato.
- Report operativo: `reports/ipad-analyzer/IPAD_CORE_WORDPRESS_KEY_GENERATOR_ACTIVATION_2026-06-16.md`; redacted JSON: `reports/ipad-analyzer/core-key-wordpress-generator-2026-06-16/wordpress_core_analyzer_key_activation_redacted.json`.

## Stato iPad diagnosis content fix 2026-06-16
- SkinHarmony Analyzer Pro iPad aggiornato e reinstallato su device `0183BC47-A31A-5F38-972B-F4C43D30B3DE`, bundle `com.skinharmony.analyzerpro.ipad`.
- Sorgente patchato su drive esterno offloaded: `08-skinharmony-analyzer-pro-ipad-native/SkinAnalyzerProiPad/AnalyzerAIClient.swift`.
- Il report AI non usa piu il contratto corto `LETTURA/AZIONE/CONTROLLO`: ora obbliga anamnesi, quadro SkinHarmony, problema, causa possibile, soluzione, prodotto/attivi, evita e controllo.
- Smoke finale iPad: `reports/ipad-analyzer/smoke-after-diagnosis-fix-verify/ai_smoke_latest_after_nyra_import.json`.
- Esito smoke: `ok=true`, `configuration_summary=Assistente avanzato attivo`, `has_nyra=true`, `has_openai=true`, `has_core=false`, `source=SkinHarmony AI Pro`, score_count `6`.
- Core Render non attivo sul device perche le key Core locali disponibili rispondono `branch_not_allowed` o `invalid_key` sul ramo `skinharmony_analyzer`; non forzare configurazioni Core false. Prossimo step: generare/ripristinare key scoped Analyzer valida e reimportarla su iPad.
- Durante il test e stato ripristinato il container dati da backup completo `reports/ipad-analyzer/latest-user-check-2026-06-16/SkinHarmonyAnalyzerPro`; `ai_config.json` e `run_ai_smoke.flag` risultano consumati/rimossi dal container dopo import/test.
- Report operativo: `reports/ipad-analyzer/IPAD_DIAGNOSIS_CONTENT_FIX_2026-06-16.md`.
- Core 2.0 usato per selezione fix, ripristino container e config Nyra/OpenAI; report latest `reports/universal-core/codex/codex_core_decision_latest.json`.

## Stato iPad capture/marker reliability fix 2026-06-08
- Aggiornata e reinstallata su iPad la build `com.skinharmony.analyzerpro.ipad` per rendere verificabile il flusso di acquisizione tricocamera.
- File modificati: `ContentView.swift`, `AnalyzerModels.swift`, `AndroidReportFileSystem.swift`.
- Aggiunto retry del frame preview prima del fallback `AVCapturePhotoOutput`, cosi il pulsante non dipende da un singolo frame disponibile.
- Aggiunto `capture_trace.json` in `latest_capture`/report per tracciare luce richiesta, stato comando, sorgente frame, dimensioni immagine e successo/fallimento scatto.
- UI report aggiornata: ogni metrica mostra `Luce 2`, `Luce 3`, `Luce 4` e `*_0 marker`, cosi le immagini rielaborate/marker sono visibili e controllabili.
- Build fisica Xcode OK, install iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK, launch OK.
- Limite confermato: il cambio luce hardware resta `unsupported` nel controller iPad finche non abbiamo SDK/protocollo OEM iOS per inviare il vendor control Android `setValue(0x80000200, 2/3/4)`. La build non finge cambio luce reale.
- Report operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_CAPTURE_MARKER_RELIABILITY_FIX_REPORT.md`.
- Core primario non raggiungibile su `127.0.0.1:3199`; fallback Core 2.0 ha selezionato variante `A`, non bloccata. Input: `reports/universal-core/codex/ipad_capture_marker_reliability_fix_request.json`.

## Stato verifica marker + Mac UVC/Frida 2026-06-08
- Copiata dall'iPad l'ultima `latest_capture` dopo test owner in `reports/ipad-tricocamera-captures/2026-06-08-latest-after-marker-fix/`.
- File presenti: `capture_trace.json`, `manifest.json`, `score.properties`, `yf.jpg`, `yf_0.jpg`, `yf_light2.jpg`, `yf_light3.jpg`, `yf_light4.jpg`.
- Rielaborazione confermata per `YF / Idratazione`: `yf_0.jpg` mostra immagine grigia con overlay verde; `score.properties` riporta `yf=98`; `manifest.json` riporta `completedMetrics=1`.
- Marker specifici `MK / Sebo` non verificabili da questo test perche e stato acquisito solo lo slot `YF`; serve acquisire lo slot `Naso / Sebo` o usare `Auto 6 scatti`.
- `capture_trace.json` conferma che l'app ha richiesto luci `2/3/4/2`, ma ogni comando e `non comandata` per assenza SDK/protocollo OEM iOS.
- Verifica Mac: `AVFoundation` vede solo `Fotocamera di MacBook Air` e `Fotocamera di iPhone`; `system_profiler SPUSBDataType` e `ioreg -p IOUSB` non mostrano la tricocamera; Frida vede `UVCAssistant` ma attach fallisce con `unable to access process with pid 523 from the current user account`.
- Report operativo: `reports/ipad-tricocamera-captures/2026-06-08-latest-after-marker-fix/CAPTURE_MARKER_AND_MAC_UVC_TRACE_REPORT.md`.

## Stato iPad preview-frame light sequence parity 2026-06-08
- Aggiornato SkinHarmony Analyzer Pro iPad per avvicinare la cattura al comportamento Android originale misurato con Frida.
- File modificati: `TrichoCameraEngine.swift` e `ContentView.swift`.
- Aggiunto `AVCaptureVideoDataOutput` con buffer ultimo frame preview: la cattura ora prova prima `capturePreviewFrame()` e usa `AVCapturePhotoOutput` solo come fallback.
- Sequenza iPad aggiornata: richiesta luce `2`, attesa `1500ms`, frame preview; luce `3`, `1500ms`, frame preview; luce `4`, `2000ms`, frame preview; ritorno luce `2`, `800ms`, frame finale.
- I tre frame `2/3/4` restano salvati come polarizzazioni; il frame finale luce `2` diventa `rawImage` quando disponibile.
- Limite esplicito: `TrichoLightController` chiama la sequenza ma resta `unsupported` finche non abbiamo SDK/protocollo OEM iOS per inviare davvero il vendor/UVC control Android `0x80000200`; quindi scatto e preview-frame sono attivi, cambio luce reale da verificare sul dispositivo.
- Build generica iOS OK, install su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK, launch OK su bundle `com.skinharmony.analyzerpro.ipad`.
- Report operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_PREVIEW_FRAME_LIGHT_SEQUENCE_PARITY_REPORT.md`.
- Core primario non raggiungibile su `127.0.0.1:3199`; fallback Core 2.0 ha selezionato variante `A`, non bloccata. Input: `reports/universal-core/codex/ipad_preview_frame_light_sequence_parity_request.json`.

## Stato Android original live capture trace 2026-06-08
- Tablet Android originale collegato e riconosciuto via ADB: seriale `1c000c8903c5c75269d`, model `c3`, product/device `zhbl_mipi101`, package originale `hot.com.smartbubble`.
- Eseguito trace Frida live sul processo originale `ZHBL Plus` mentre veniva usata la tricocamera nel programma Android originale.
- Log persistente salvato: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/11-android-runtime-trace-lab/logs/capture_light_sequence_live_2026-06-08_saved.log`, `248` eventi.
- Report operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/11-android-runtime-trace-lab/reports/ANDROID_ORIGINAL_CAPTURE_LIGHT_FRIDA_LIVE_REPORT_2026-06-08.md`.
- Confermate `4` sequenze `Takepicture`, di cui `3` complete. Pattern reale: `2:WT -> 1500ms -> SrcBmp.copy`, `3:PL -> 1500ms -> SrcBmp.copy`, `4:UV -> 2000ms -> SrcBmp.copy`, `2:WT -> 800ms -> final SrcBmp.copy`.
- Comando luce confermato runtime: `AbstractUVCCameraHandler.setValue(0x80000200, value)`, valori `2/3/4/2`, ogni valore scritto due volte con pausa interna `300ms` in `UVCCameraHelper$SetLightThread.run`.
- Frame confermato: copia preview `SrcBmp`, sorgente `1280x960`, `ARGB_8888`, mutable. Implicazione iPad: per parita non basta `AVCapturePhotoOutput`; serve cattura/freeze del preview frame stabilizzato dopo cambio luce.
- Stato finale: Frida server fermato, forward ADB `tcp:27042` rimosso, app originale ancora aperta; nessuna modifica ad APK, scoring o chiavi.
- Core primario non raggiungibile su `127.0.0.1:3199`; fallback Core 2.0 non bloccato, input `reports/universal-core/codex/android_original_capture_frida_live_trace_request.json`.

## Stato iPad Analyzer Pro etichette originali + Frida capture hook 2026-06-08
- Correzione owner recepita: le voci commerciali originali Android non sono `pori/grana`, ma `Sebo`, `Discromia`, `Sensibilita`, `Rughe`, `Idratazione`, `Ispessimento Corneo`.
- Fonti originali verificate: `device-extracts/zhbl-plus/apktool/res/values-it/strings.xml`, `PreviewActivity$13.smali`, `UVCCameraHelper.smali`, `UVCCameraHelper$SetLightThread.smali`.
- iPad aggiornato in `AnalyzerModels.swift`, `ContentView.swift`, `AnalyzerAIClient.swift`: etichette visibili e report allineati alle sei voci originali; chiavi tecniche Android/iPad mantenute per compatibilita (`pores_texture`, `texture_fine_lines`, ecc.); nessuna formula scoring modificata.
- Aggiunto filtro finale nel report per evitare vecchie voci visibili come `pori`, `grana`, `texture`, `discromie` e termini interni/bozza; le chiavi tecniche restano interne.
- Creata traccia Frida pronta in `11-android-runtime-trace-lab/hooks/capture_light_sequence_trace.js` per hookare `Takepicture`, `Setlight`, `UVCCameraHelper.setLight`, `SetLightThread`, `AbstractUVCCameraHandler.setValue`, `Bitmap.copy` e `Thread.sleep`.
- Sequenza Android originale ricostruita: `Setlight(2)` + `1500ms` + copia `SrcBmp`; `Setlight(3)` + `1500ms` + copia; `Setlight(4)` + `2000ms` + copia; poi ritorno luce dal ramo smali osservato e chiusura handler.
- Build iPad fisica OK, install sopra app esistente OK, processo terminato e rilanciato per smoke pulito.
- Smoke finale: `reports/ipad-tricocamera-captures/2026-06-08-original-labels-smoke/ai_smoke_latest_final_after_terminate.json`; `ok=true`, `configuration_summary=Core + Nyra + OpenAI`, `score_count=6`, controllo parole vecchie/interne `false`.
- `adb devices` non vede tablet Android collegati al Mac; trace Frida live rimandato a quando il tablet originale `hot.com.smartbubble` sara visibile.
- Report operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_ORIGINAL_LABELS_AND_CAPTURE_CLONE_REPORT.md`.
- Core primario non raggiungibile su `127.0.0.1:3199`; fallback Core 2.0 non bloccato, variante `A`. Input: `reports/universal-core/codex/ipad_original_metric_labels_and_capture_clone_request.json` e `reports/universal-core/codex/ipad_original_labels_build_install_request.json`.

## Stato iPad Analyzer Pro report precompilato + acquisizione Android-like 2026-06-08
- SkinHarmony Analyzer Pro iPad aggiornato dopo confronto con Android originale: report fallback locale precompilato, linguaggio visibile premium/autonomo e acquisizione piu vicina alla sequenza luce Android.
- Android originale verificato: `SingleReport.getlevelbyscore` usa soglie `<60`, `60-69`, `70-79`, `80-89`, `>=90`; i testi arrivano da `assets/<lingua>.xml` con `ResultDesc` e `Suggestion` per `SkinColor`, `WaterOil`, `FineLines`, `RedNess`, `DarkSpots`, `PoreBlockage`.
- iPad aggiornato in `AnalyzerAIClient.swift`: `makePrecompiledReport` genera quadro/priorita/parametri/relazione/percorso/attivi/prodotti-protocolli/messaggio cliente anche senza Core/Nyra/OpenAI o con provider vuoti.
- Testo visibile pulito: niente `diagnosi non medica`, disclaimer, `OpenAI`, `Nyra`, `Core`, `guardrail`, `policy`, `da valutare`, `da confermare`, `da validare`, `bozza`; smoke finale su `source/action/summary` restituisce `false` al controllo parole bloccate.
- iPad aggiornato in `TrichoCameraEngine.swift` e `ContentView.swift`: preparazione fuoco/esposizione/bilanciamento prima degli scatti e attese luce allineate ad Android `1500/1500/2000 ms`; scoring non modificato.
- Differenza ancora aperta: Android copia il frame UVC preview stabilizzato (`SrcBmp`), iPad usa ancora `AVCapturePhotoOutput`; per equivalenza piu stretta serve cattura da preview frame o SDK/protocollo OEM della tricocamera scelta.
- Build Xcode OK, install finale su iPad OK, launch smoke OK su bundle `com.skinharmony.analyzerpro.ipad`.
- Reinstall sopra app esistente non cancella dati: container prima `34` file, container finale `34` file; `latest_capture/score.properties` invariato (`35/92/91/93/35/30`).
- Report operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_PRECOMPILED_REPORT_AND_ANDROID_LIKE_CAPTURE_REPORT.md`.
- Smoke finale: `reports/ipad-tricocamera-captures/2026-06-08-final-language-smoke/ai_smoke_latest.json`; container finale: `reports/ipad-tricocamera-captures/2026-06-08-final-installed-container/SkinHarmonyAnalyzerPro`.
- Core primario non raggiungibile su `127.0.0.1:3199`; fallback Core 2.0 ha selezionato varianti non bloccate per testi precompilati, acquisizione Android-like, fallback provider vuoto e linguaggio autonomo. Nessuna API key committata o stampata.

## Stato iPad Analyzer Pro ruolo Nyra/Core/OpenAI 2026-06-08
- SkinHarmony Analyzer Pro iPad aggiornato per il report viso: Nyra interpreta i punteggi e costruisce priorita/percorso/attivi/catalogo, Core fa guardrail/coerenza/claim/rischio, OpenAI rifinisce il linguaggio premium finale.
- File principali modificati: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/SkinAnalyzerProiPad/AnalyzerAIClient.swift`, `ContentView.swift`, `AISettingsView.swift`.
- Aggiunto riconoscimento strutturato endpoint Nyra Analyzer `https://skinharmony-nyra-core.onrender.com/api/nyra/analyzer/read-only`; il payload include score, score_reading, cliente, note, prodotti e protocolli opzionali.
- Aggiunto filtro locale `sanitizePremiumReportLanguage` per impedire formule fuori tono/claim-risk nel report finale (`diagnosi`, garanzie, risultati duraturi/stabili, validazioni operatore/centro).
- Build fisica iPad OK, installazione OK, smoke finale OK su bundle `com.skinharmony.analyzerpro.ipad`.
- Smoke finale: `reports/ipad-tricocamera-captures/2026-06-08-analyzer-role-fix-smoke/ai_smoke_latest_final_role_split_language_guard.json`; `ok=true`, `configuration_summary=Core + Nyra + OpenAI`, `source=Core guardrail + Nyra + OpenAI`.
- Limite test: il `latest_capture` corrente e una sessione scalp/multipoint a 4 score (`water_oil_balance=69`, `texture_fine_lines=75`, `spots_pigmentation_signals=35`, `pores_texture=30`), non una sessione viso completa a 6 score.
- Report operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_ANALYZER_NYRA_CORE_OPENAI_ROLE_FIX_REPORT.md`.
- Core primario non raggiungibile; fallback Core 2.0 ha selezionato varianti non bloccate. Input: `reports/universal-core/codex/ipad_analyzer_nyra_core_openai_report_role_fix_request.json` e `reports/universal-core/codex/ipad_analyzer_language_sanitizer_request.json`.
- Nessuna API key committata o stampata.

## Stato iPad scalp multi-spettro/multi-punto visual read 2026-06-08
- Copiata dal container iPad `com.skinharmony.analyzerpro.ipad` l'ultima cartella `Documents/SkinHarmonyAnalyzerPro/latest_capture` in `reports/ipad-tricocamera-captures/2026-06-08-scalp-multispectrum-multipoint/latest_capture/`.
- Presenti `20` JPEG, `manifest.json` e `score.properties`; slot completati `yf`, `xw`, `sb`, `mk`; score tecnici pelle/iPad: `water_oil_balance=69`, `texture_fine_lines=75`, `spots_pigmentation_signals=35`, `pores_texture=30`.
- Confermati tre spettri per ogni slot: `light2`/base, `light3`/`_0`, `light4`; non risultano etichette zona frontale/laterale/vertex/occipitale, quindi la sessione scalp dedicata va ancora modellata.
- Lettura visiva: immagini leggibili, con fusti, osti follicolari, lucidita, materiale giallo/avorio perifollicolare, spot giallo/oro in blu/UV e alcuni punti rosso/arancio. Interpretazione solo non diagnostica: sebo/cheratina/desquamazione/residuo/riflesso sono possibilita visive, non diagnosi.
- Report: `reports/ipad-tricocamera-captures/2026-06-08-scalp-multispectrum-multipoint/SCALP_MULTISPECTRUM_VISUAL_READ_REPORT.md`.
- Core primario non raggiungibile; fallback Core 2.0 ha selezionato variante `A` in `reports/universal-core/codex/ipad_scalp_multispectrum_multipoint_inspection_request.json`.

## Stato Nyra Analyzer learning Render + iPad smoke 2026-06-08
- Creato e deployato su Render il ramo Nyra dedicato a SkinHarmony Analyzer: endpoint live `https://skinharmony-nyra-core.onrender.com/api/nyra/analyzer/read-only` e pack status `https://skinharmony-nyra-core.onrender.com/api/nyra/analyzer/learning-pack`.
- Commit Render: `f680e9a Add Nyra analyzer learning endpoint`; `skinharmony-nyra-core` live su commit `f680e9a` con deploy finito `2026-06-08T12:39:45.831662Z`.
- Il push ha triggerato anche rebuild `skinharmony-universal-core` per repo/branch condivisi; servizio live su commit `f680e9a`, health `/healthz` OK dopo rebuild.
- Pack Nyra Analyzer include lettura sei score, biologia cutanea in perimetro estetico, cosmetologia/chimica cosmetica, attivi principali, marketing servizi/prodotti, ranking prodotti/protocolli se caricati e guardrail no diagnosi/no terapia/no claim medici/no prodotti inventati.
- Fonti guardrail usate: FDA cosmetic claims + cosmetic/drug boundary, EU 1223/2009, EU 655/2013, AAD retinoid guidance, NCBI moisturizer/barrier review, NCBI niacinamide review.
- Test locali OK: `node --check`, JSON pack, smoke locale workspace e smoke repo Render source. Test live OK: `GET /api/nyra/analyzer/learning-pack`, `POST /api/nyra/analyzer/read-only`.
- iPad `com.skinharmony.analyzerpro.ipad` configurato con solo `nyraEndpoint` Render, nessuna nuova chiave. `ai_config.json` rimosso dal container dopo import; `run_ai_smoke.flag` consumato e rimosso.
- Smoke iPad finale: `ok=true`, `configuration_summary=Core + Nyra + OpenAI`, `has_core=true`, `has_nyra=true`, `has_openai=true`, `source=Core + Nyra + OpenAI`, score_count `6`, score `pores_texture=30`, `redness_sensitivity_signals=66`, `skin_tone_brightness=38`, `spots_pigmentation_signals=35`, `texture_fine_lines=78`, `water_oil_balance=88`.
- Report operativo: `reports/nyra-analyzer/NYRA_ANALYZER_LEARNING_RENDER_DEPLOY_REPORT_2026-06-08.md`. Smoke finale: `reports/ipad-tricocamera-captures/2026-06-08-nyra-render-config/smoke-pull/ai_smoke_latest_after_flag_consume.json`.
- Core primario `sh-core-codex` ancora non raggiungibile su `127.0.0.1:3199`; fallback Core 2.0 ha selezionato variante A per apprendimento, deploy e config iPad. Nessuna API key committata o stampata.

## Stato iPad aggancio Universal Core Render 2026-06-08
- Verificati agganci live: Smart Desk `skinharmony-smartdesk-live` usa `UNIVERSAL_CORE_URL=https://skinharmony-universal-core.onrender.com`, tenant `smartdesk-skinharmony`, brand `skinharmony`, mode `read_only_decision_bridge`; Suite Control Plane `skinharmony-suite-control` usa lo stesso Universal Core, tenant `codexai`.
- Universal Core Render `skinharmony-universal-core` e vivo su piano `starter`, `not_suspended`, `/healthz` OK; ramo `skinharmony_analyzer` live e testato.
- Creata key Universal Core dedicata Analyzer, non committata: key id `key_f533dccc-0c1f-4ce4-b05f-a211e3c3056c`, tenant `analyzer-skinharmony`, brand `skinharmony`, scope `read:decision`, tier `network`, active branch `skinharmony_analyzer`. Prima key base `key_db4c694f-52cb-4118-b745-f7b4cd6a3b3c` revocata/sostituita per `branch_not_allowed`.
- iPad aggiornato con adapter Universal Core Render in `AnalyzerAIClient.swift`: chiama `POST /v1/branches/skinharmony_analyzer/analyze`, formatta dominante/secondari/relazioni/segnali protettivi e passa il contesto a OpenAI.
- `AnalyzerSettings.swift` aggiornato: bootstrap `ai_config.json` puo anche svuotare endpoint/chiavi gia salvati, evitando residui locali sul device.
- Build/install iPad OK. Config importata via `ai_config.json` temporaneo nel Keychain iOS e file rimosso dal container; file temporanei locali con segreti eliminati da `/private/tmp`.
- Smoke iPad finale: `ok=true`, `configuration_summary=Core + OpenAI`, `has_core=true`, `has_nyra=false`, `has_openai=true`, `source=Core + Nyra locale + OpenAI`; score `skin_tone_brightness=38`, `water_oil_balance=88`, `texture_fine_lines=78`, `redness_sensitivity_signals=66`, `spots_pigmentation_signals=35`, `pores_texture=30`; OpenAI genera report corretto.
- Nyra Render `skinharmony-nyra-core` e vivo su piano `starter`, ma gli endpoint attuali `/api/nyra/read-only` e `/api/nyra/text-chat` sono generici e nel test hanno risposto fuori dominio Analyzer. Per questo non sono stati configurati sull iPad; serve endpoint dedicato `POST /api/nyra/analyzer/read-only` prima di dichiarare `Core Render + Nyra Render + OpenAI`.
- Report operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_RENDER_CORE_ATTACH_REPORT.md`. Core primario non raggiungibile; fallback Core 2.0 ha selezionato variante `A` in `reports/universal-core/codex/ipad_render_core_nyra_attach_request.json`, report `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.

## Stato iPad chiavi AI + smoke Core/Nyra/OpenAI 2026-06-08
- Inserita configurazione AI di test sull iPad senza committare segreti: file temporaneo `ai_config.json` copiato nel container app, importato in `UserDefaults`/Keychain iOS e poi rimosso dall app.
- File aggiornati: `AnalyzerSettings.swift` per import sicuro da `Documents/SkinHarmonyAnalyzerPro/ai_config.json`; `SkinAnalyzerProiPadApp.swift` per smoke test da flag `run_ai_smoke.flag`; `AnalyzerAIClient.swift` per fix estrazione testo Responses API; `shared/tools/analyzer_ai_local_server.js` per host LAN `--host`.
- Server locale Core/Nyra attivo su Mac: `http://192.168.1.168:4187`, endpoint `/core` e `/nyra`, Bearer auth configurata. Health OK da localhost e LAN.
- Smoke test iPad finale salvato in `reports/ipad-tricocamera-captures/2026-06-08-user-test-latest-capture/ai_smoke_latest_file_flag.json`.
- Esito smoke: `ok=true`, `configuration_summary=Core + Nyra + OpenAI`, `has_core=true`, `has_nyra=true`, `has_openai=true`, `source=Core + Nyra + OpenAI`, `score_count=6`.
- Score smoke: `skin_tone_brightness=35`, `water_oil_balance=96`, `texture_fine_lines=79`, `redness_sensitivity_signals=85`, `spots_pigmentation_signals=35`, `pores_texture=30`.
- OpenAI ha generato testo reale di report; corretto bug precedente in cui l estrattore prendeva `model=gpt-4.1-mini-2025-04-14` invece del contenuto.
- File temporanei locali rimossi; `ai_config.json` e `run_ai_smoke.flag` non risultano piu copiabili dal container device.
- Build/install iPad OK dopo le patch. Report operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_AI_KEYS_AND_SMOKE_TEST_REPORT.md`.
- Core primario ancora non raggiungibile; fallback Core 2.0 usato con input `reports/universal-core/codex/ios_ai_key_secure_import_and_test_request.json`, report `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.

## Stato iPad diagnosi Core/Nyra/OpenAI 2026-06-08
- Dopo test owner su tricocamera iPad, i punteggi risultano simili/allineati ad Android; esempio confermato: `mk/pori-grana=30` su Android e iOS.
- Copiata dal device la cartella `Documents/SkinHarmonyAnalyzerPro/latest_capture` in `reports/ipad-tricocamera-captures/2026-06-08-user-test-latest-capture/`: presenti `30` JPEG, `score.properties` e `manifest.json`.
- Score ultimo test iPad: `fs=35`, `yf=96`, `xw=79`, `yz=85`, `sb=35`, `mk=30`; `completedMetrics=6`.
- Core primario `sh-core-codex` non raggiungibile su `127.0.0.1:3199`; fallback Core 2.0 ha selezionato variante `A` per orchestrazione in app `Core -> Nyra -> OpenAI` con fallback locale. Input: `reports/universal-core/codex/ios_ai_diagnosis_orchestration_request.json`; report: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Aggiornato `SkinAnalyzerProiPad/AnalyzerAIClient.swift`: non usa piu OpenAI-first; costruisce decisione locale dai punteggi, chiama Core se configurato, poi Nyra, poi OpenAI per il report finale. Se un layer manca/non risponde, degrada in locale senza bloccare.
- Corretto fallback locale: ora legge valori bassi come priorita (`<50`), intermedi come da migliorare (`50-84`), alti come stabili (`>=85`); quindi con `fs35/sb35/mk30` la priorita corretta e luminosita, discromie, pori/grana, non acqua-sebo `96`.
- UI aggiornata: pannello report `Diagnosi estetica SkinHarmony`; Area AI esplicita `Core decide, Nyra interpreta, OpenAI genera`.
- Nessuna API key committata; chiavi restano in Keychain iOS/config locale. Nessun claim medico aggiunto.
- Verifica tecnica: `xcodebuild ... build` OK, installazione iPad fisico OK, lancio app OK su bundle `com.skinharmony.analyzerpro.ipad`.
- Report operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_AI_CORE_NYRA_OPENAI_ORCHESTRATION_REPORT.md`.

## Stato iPad SB/MK + autosalvataggio tricocamera 2026-06-08
- Core primario `sh-core-codex` non raggiungibile su `127.0.0.1:3199`; fallback Core 2.0 ha selezionato la variante `A` nel file `reports/universal-core/codex/ios_spots_pores_capture_and_branch_request.json`, report in `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Prima di reinstallare l'app iPad sono stati copiati `Documents/SkinHarmonyAnalyzerPro` e `Documents` dal container `com.skinharmony.analyzerpro.ipad` in `reports/ipad-tricocamera-captures/2026-06-08-ipad-documents/` e `reports/ipad-tricocamera-captures/2026-06-08-ipad-documents-root/`.
- Esito salvataggio pre-edit: `0` immagini trovate; sul device era presente solo `SkinHarmonyAnalyzerPro/golden_test_latest.json`. Quindi gli scatti tricocamera precedenti non erano stati persistiti su disco e non sono recuperabili via `devicectl`.
- Aggiunto autosalvataggio dopo ogni acquisizione slot in `AndroidReportFileSystem.saveLatestCaptureDraft`: nuova cartella app `Documents/SkinHarmonyAnalyzerPro/latest_capture` con `score.properties`, JPEG slot/polarizzazioni e `manifest.json`.
- Collegato autosalvataggio in `ContentView.setSelectedMetricImage` e `setSelectedMetricPolarizationImages`; al prossimo scatto reale la copia container deve includere i JPEG.
- In `OriginalScoringSDK/skinharmony_original_scoring_unavailable.mm` portati i rami mancanti: `GetSebanValue/SB/discromie` con `GammaArray` originale, `wallner` ricostruito dal disassembly, `dilate`, ROI e formula Ghidra; `GetMaokongValue/MK/grana` con canale invertito, `wallner`, `dilate`, filtro colore, `SimpleBlobDetector` da `CreateContrastMap(180)` e score loop keypoint 170/180/min30.
- Aggiunto hook diagnostico opzionale in `SkinAnalyzerProiPadApp.swift`: `--run-golden-fixture-on-launch` esegue `GoldenFixtureTest.runAndPersist()` solo se passato da `devicectl`.
- Build iOS generica OK, install iPad OK, launch diagnostico OK, pull `golden_test_latest.json` OK.
- Golden aggiornato in `reports/ipad-golden-test-latest.json` e `reports/ipad-tricocamera-captures/2026-06-08-golden-after-sb-mk/golden_test_latest.json`: `fixtureCount=6`, `imagesFound=66`, `nativeAttemptCount=36`, `nativeImageBridgeCount=36`, `candidateExactCount=20`, `alternateAttemptCount=30`, `alternateExactCount=4`.
- Risultato importante: passaggio precedente OpenCV era `13/36`; con SB/MK sale a `20/36`. `SB/discromie` e quasi chiuso sulle fixture (`94/94`, `94/93`, `93/93`, `94/94`, `94/94`, `94/94`); `MK/grana` e vicino ma non perfettamente pari (`62/60`, `60/56`, `70/70`, `30/30`, `57/56`, `62/61`).
- Stato prodotto corretto invariato: `SH_ORIGINAL_SCORING_ENGINE_UNAVAILABLE`; i rami sono candidati Ghidra/OpenCV non promossi a engine ufficiale. Nessuna taratura a mano, nessuna API key committata.
- Report operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_SB_MK_BRANCH_AND_CAPTURE_REPORT.md`.

## Stato Ghidra line-by-line reconstruction 2026-06-08
- Core primario ancora non raggiungibile; fallback Core 2.0 ha selezionato `action:codex:documentation_and_extractors_first`, report in `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Creato workspace `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/12-ghidra-line-reconstruction/`.
- Copiati export Ghidra originali da `09-original-scoring-engine-port-lab/reports/ghidra-hotimgproc/` e trace runtime Frida in `reference/`.
- Consultate fonti ufficiali: Ghidra `DecompInterface`, OpenCV imgproc C API, OpenCV Java `Mat.nativeObj`, Android NDK JNI.
- Creato `tools/ghidra_reconstruction_extract.py` per generare mappe riga-per-riga, index e JSON stato.
- Generati `reports/RECONSTRUCTION_INDEX.md`, `reports/reconstruction_status.json` e `reports/line-maps/*.md` per tutti i sei metodi HotImgProc.
- Creato C pulito derivato in `clean-c/hotimgproc_score_core_reconstructed_v1.c`.
- Stato ricostruzione: `GetWaterOilvalue`, `GetTextureValue`, `GetYanzhengValue`, `GetSebanValue` hanno score-core chiuso; `GetSkinBrightness` ha formula core chiusa ma colore/prototipo OpenCV da verificare; `GetMaokongValue` ha loop punteggio post-keypoint mappato ma detector/key_points ancora opaco.
- Syntax check C ricostruito OK: `clang -fsyntax-only -std=c11 clean-c/hotimgproc_score_core_reconstructed_v1.c`.
- Report operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/12-ghidra-line-reconstruction/reports/GHIDRA_LINE_BY_LINE_RECONSTRUCTION_REPORT.md`.
- Confine: nessuna patch iOS nuova in questa fase, nessuna taratura, nessuna promozione scoring ufficiale.

## Stato iPad Original Clone Scoring Pass 2026-06-08
- Core primario ancora non raggiungibile; fallback Core 2.0 ha selezionato `action:codex:scoring_pipeline_first`, report in `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Proseguito il clone iPad usando solo evidenze originali `hot.com.smartbubble` / `HotImgProc/libimageproc.so`; custom SkinHarmony non usata come sorgente algoritmo.
- Aggiunte fixture originali reali in `SkinAnalyzerProiPad/GoldenFixture/`: `android_2025_11_03_090606`, `android_2025_11_03_101006`, `android_2025_11_03_101215`, `android_mari_2025_11_03_090144`, oltre alla fixture `090111` e al direct trace `android_original_trace_2026_06_08`.
- Aggiornato `GoldenFixtureTest.swift`: test multi-fixture, lettura `score.properties` numerico e nominale, `candidateExactCount` e `candidateScores` nel JSON.
- Aggiornato `skinharmony_original_scoring_unavailable.c`: cast/troncamento stile C originale e correzione ramo `GetWaterOilvalue` sul canale blu CoreGraphics (`pixel[2]`), coerente con `cvSplit` originale sui report reali.
- Build generica iOS OK, build firmata su iPad fisico OK, installazione OK, launch OK, pull report OK.
- Report dispositivo aggiornato in `reports/ipad-golden-test-latest.json`: `fixtureCount=6`, `imagesFound=66`, `nativeAttemptCount=36`, `nativeImageBridgeCount=36`, `nativeCalculatedCount=0`, `candidateExactCount=16`.
- Risultato importante: `GetWaterOilvalue` ora allineato su 5/6 fixture, un caso a +1; `GetSebanValue` allineato; luminosita, texture, rossore e pori non ancora equivalenti.
- Stato corretto: candidati ancora `SH_ORIGINAL_SCORING_ENGINE_UNAVAILABLE`; nessuno score iPad promosso a ufficiale.
- Report operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_ORIGINAL_CLONE_SCORING_PASS_REPORT.md`.

## Stato HydraSkin Original Runtime Trace 2026-06-08
- Correzione owner recepita: per algoritmo/scoring e stato guardato l'originale `hot.com.smartbubble`, non la custom SkinHarmony.
- Creato workspace runtime trace in `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/11-android-runtime-trace-lab/`.
- Core primario non raggiungibile; fallback Core 2.0 ha selezionato `action:codex:frida_runtime_trace_lab_full`, report in `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Installato tooling Frida/JNI trace locale; Frida 17 e risultato instabile sul processo originale, Frida 16 ha permesso attach e tracing stabile.
- Creato runner tecnico separato `hot.com.smartbubble.originaltrace` da apktool originale `device-extracts/zhbl-plus/apktool`, solo per caricare `HotImgProc/libimageproc.so` originale e tracciarlo senza usare la custom.
- APK runner: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/11-android-runtime-trace-lab/dist/HydraSkin_Original_Trace_Runner.apk`.
- Output originale confermato in `reports/original-trace-output/score.properties`: luminosita `54`, acqua/olio `86`, texture `70`, rossore `58`, macchie `94`, pori `61`.
- Traccia Frida completa in `logs/original_trace_runner_dynamic_console.log`; sintesi in `reports/original_trace_runner_dynamic_summary.json`.
- Hook confermati: sei metodi JNI `Java_hot_com_smartbubble_imagepro_HotImgProc_*` e OpenCV C API (`cvCvtColor`, `cvSmooth`, `cvThreshold`, `cvCanny`, `cvSplit`, `cvMerge`, `cvEqualizeHist`, `cvDilate`, `cvErode`, `cvGetSize`, `cvCircle`, `cvCountNonZero`).
- Report operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/11-android-runtime-trace-lab/reports/HYDRASKIN_ORIGINAL_RUNTIME_TRACE_REPORT.md`.
- Confine stabile: nessuna taratura artificiale; iOS deve replicare pipeline OpenCV/originale e validare multi-report prima di promuovere punteggi ufficiali.

## Stato SkinHarmony Analyzer Pro iPad Premium UI Pass 2026-06-08
- Eseguito passaggio UI premium su tutta la app iPad nativa in `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/`.
- Core primario ancora non raggiungibile; fallback Core 2.0 ha selezionato `ui_full_pass_preserve_scoring_build_test`, report in `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Aggiornati `ContentView.swift` e `AISettingsView.swift`: topbar SkinHarmony, home premium, navigazione moduli con frecce, card/bordi/pulsanti SkinHarmony, slot acquisizione piu professionali, testi report piu credibili e configurazione AI in stile prodotto.
- Build Xcode su iPad fisico OK, installazione OK, avvio app OK su bundle `com.skinharmony.analyzerpro.ipad`.
- Golden test estratto dal container iPad in `reports/ipad-golden-test-latest.json`.
- Risultato golden invariato nel confine tecnico corretto: fixture `android_2025_11_03_090111`, expected Android `72/86/70/50/94/60`, candidato iPad `64/45/51/50/94/60`, `nativeImageBridgeCount=6`, `nativeCalculatedCount=0`.
- Stato scoring stabile: nessun candidato promosso a score ufficiale; serve ancora equivalenza OpenCV/pixel/canali e validazione multi-report prima di dichiarare l engine iPad originale.
- Report operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_PREMIUM_UI_PASS_REPORT.md`.

## Stato SkinHarmony Analyzer Android full software map 2026-06-08
- Creato workspace `10-full-android-software-map` per leggere tutto il software Android Skin Analyzer originale/custom come sorgente architetturale iOS.
- Core primario ancora non raggiungibile; fallback Core 2.0 ha selezionato `full_static_ghidra_apktool_mapping_report`, report in `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.
- Importati in Ghidra i tre DEX originali `classes.dex`, `classes2.dex`, `classes3.dex` in progetto `SkinHarmonyFullAndroidDex`; export summary riuscito in `reports/ghidra-dex-summary/`.
- Creato script Ghidra `ExportDexProgramSummary.java` per funzioni/simboli/riferimenti utili su `hot.com.smartbubble`, `UVCCamera`, `HotImgProc`, report e storage.
- Creato estrattore statico `tools/extract_android_software_map.py`, con output `ANDROID_FULL_SOFTWARE_MAP.md` e `android_full_software_map_latest.json`.
- Catena originale confermata: `MainActivity -> PreviewActivity -> UVCCameraHelper/UVCCameraHandler -> HotImgProc/libimageproc.so -> ReportActivity/Report/SingleReport`.
- Controllo luci confermato: `PreviewActivity.Setlight(I) -> UVCCameraHelper.setLight(I) -> SetLightThread -> UVCCameraHandler.setValue(MODE_GAIN, value)`, con `Light_OFF=1`, `Light_WT=2`, `Light_PL=3`, `Light_UV=4`, `MODE_GAIN=-0x7ffffe00`, sleep `300ms` e seconda scrittura.
- Report/cartella confermati: `/hotskin_report/`, immagini `fs/yf/xw/yz/sb/mk.jpg`, processate `*_0.jpg`, `score.properties`, sei `ReportData` globali in `HotApplication`.
- Specifica iOS operativa salvata in `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/10-full-android-software-map/reports/ANDROID_TO_IOS_REBUILD_SPEC_FROM_GHIDRA.md`.
- Confine stabile: iOS va rifatto come prodotto modulare equivalente; scoring resta originale/equivalente solo dopo port OpenCV + golden multi-report; luci/polarizzazione richiedono SDK/protocollo OEM della tricocamera.

## Stato SkinHarmony Analyzer Pro Ghidra to iOS porting 2026-06-08
- Installato e usato Ghidra `12.1.2` con OpenJDK `21.0.11` per analizzare `libimageproc.so` Android originale autorizzato.
- Esportate decompilazioni/call/ASM dei sei rami `HotImgProc`: `GetSkinBrightness`, `GetWaterOilvalue`, `GetTextureValue`, `GetYanzhengValue`, `GetSebanValue`, `GetMaokongValue`.
- Estratte formule originali chiave:
  - luminosita: mapping finale con `+35.0`, non taratura precedente `+43.0`;
  - acqua/olio: `cvThreshold 160/255`, count `>200`, `ratio*-1333+100`, min `45`;
  - texture: `cvCanny 20/60`, count `>=201`, `ratio*-80+95`, min `51`;
  - rossore: formula finale `ratio*-960+98`, min `50`, predicato conteggio ancora da isolare;
  - macchie: `wallner+dilate+ROI 0.1..0.9`, formula `ratio*-600+95`, min `35`;
  - pori: ramo blob/keypoint da portare come blocco, non formula lineare.
- Applicate su iPad solo le formule Ghidra verificabili per `SkinBrightness`, `WaterOil`, `Texture` nel file `OriginalScoringSDK/skinharmony_original_scoring_unavailable.c`.
- Build/install/launch iPad OK su bundle `com.skinharmony.analyzerpro.ipad`; golden test estratto in `reports/ipad-golden-test-latest.json`.
- Risultato fixture `android_2025_11_03_090111`: atteso Android `72/86/70/50/94/60`, candidato iPad post-Ghidra `64/45/51/50/94/60`. Interpretazione: niente taratura; manca equivalenza OpenCV/canali/pixel prima di promuovere lo scoring.
- Stato prodotto corretto: candidati ancora `SH_ORIGINAL_SCORING_ENGINE_UNAVAILABLE`; nessuno score iPad dichiarato ufficiale.
- Runbook operativo: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/09-original-scoring-engine-port-lab/reports/GHIDRA_TO_IOS_PORTING_RUNBOOK.md`.
- Core primario non raggiungibile; fallback Core 2.0 usato e report salvato in `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.

## Stato SkinHarmony Analyzer Pro iPad Original Function Reconstruction 2026-06-07
- Analizzati i sei rami Android originali `HotImgProc` da `libimageproc.so` ARM64: `GetSkinBrightness`, `GetWaterOilvalue`, `GetTextureValue`, `GetYanzhengValue`, `GetSebanValue`, `GetMaokongValue`.
- Decodificate pipeline osservate: luminosita con `cvCvtColor(1)`, `cvSmooth(3x3)`, `cvCvtColor(44)`, `cvSplit`, ROI `0.1..0.9`, istogramma e mapping; acqua/olio con split/soglie/maschera; texture con edge density tipo `cvCanny 20/60`; rossore con eccesso rosso/equalizzazione; macchie e pori con soglie locali tipo `wallner`, dilatazione e conteggi maschera/blob.
- Aggiunti in iPad sei candidati dentro `OriginalScoringSDK/skinharmony_original_scoring_unavailable.c`: `ios_get_skin_brightness_reconstruction_candidate_v1`, `ios_get_water_oil_reconstruction_candidate_v1`, `ios_get_texture_reconstruction_candidate_v1`, `ios_get_redness_reconstruction_candidate_v1`, `ios_get_spots_reconstruction_candidate_v1`, `ios_get_pores_reconstruction_candidate_v1`.
- I candidati restano marcati `SH_ORIGINAL_SCORING_ENGINE_UNAVAILABLE`, quindi non vengono promossi a score ufficiali equivalenti Android.
- Integrato il ramo candidato nel flusso reale iPad: `OriginalScoringEngine.swift` calcola score candidato da immagine quando una metrica non ha ancora score originale importato; gli score Android da `score.properties` restano fonte primaria e non vengono sovrascritti.
- Test reale su iPad con fixture Android `android_2025_11_03_090111`: atteso `72/86/70/50/94/60`, candidato iOS `72/86/74/50/94/60`; quindi `5/6` metriche combaciano e `texture` resta a `+4`.
- Report device aggiornato: `reports/ipad-golden-test-latest.json`.
- Report tecnico: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_ORIGINAL_FUNCTION_RECONSTRUCTION_REPORT.md`.
- Stato prodotto corretto: bridge immagine attivo, sei rami candidati collegati, duplicazione matematica Android -> iOS non ancora chiusa perche `texture` non combacia; nessun candidato marcato come engine ufficiale.
- Core primario non raggiungibile; fallback Core 2.0 usato: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.

## Stato SkinHarmony Analyzer Pro iPad Image Bridge 2026-06-07
- Aggiunto bridge immagine nativo iPad nel motore Original Scoring: JPEG/UIImage -> `CGImage` -> buffer RGBA -> statistiche pixel base (`mean_luma`, `contrast`) -> C engine.
- Esposta API `scoreMetric(_:imageFilePath:)` in `SkinHarmonyOriginalScoringBridge`.
- Aggiunta API C `sh_original_score_metric_with_image_buffer`.
- Aggiornato golden test per passare davvero i file `fs.jpg`, `yf.jpg`, `xw.jpg`, `yz.jpg`, `sb.jpg`, `mk.jpg` al motore iPad.
- Build Xcode OK, installazione iPad OK, avvio OK, report estratto da container app OK.
- Risultato device: `nativeImageBridgeCount=6`, `nativeAttemptCount=6`, `nativeCalculatedCount=0`. Quindi il bridge immagine funziona per tutte le metriche, ma lo scoring numerico resta bloccato finche non vengono portati gli step OpenCV/HotImgProc.
- Report: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_IMAGE_BRIDGE_TEST_REPORT.md`.
- Report device aggiornato: `reports/ipad-golden-test-latest.json`.

## Stato SkinHarmony Analyzer Pro iPad Golden Android Fixture Test 2026-06-07
- Copiata nel bundle iPad la fixture Android reale `01-original-reference/samples/Christian cardarello/2025-11-03 090111` come `SkinAnalyzerProiPad/GoldenFixture/android_2025_11_03_090111`.
- La fixture contiene `12` immagini Android (`6` raw + `6` processate) e `score.properties`.
- Aggiunto `GoldenFixtureTest.swift`, collegato al progetto Xcode e alla schermata Sistema con pulsante `Test golden Android`.
- L'app esegue anche il test automatico all'avvio e salva `Documents/SkinHarmonyAnalyzerPro/golden_test_latest.json`.
- Build Xcode OK, installazione iPad OK, avvio OK; report estratto dal container app in `reports/ipad-golden-test-latest.json`.
- Risultato reale su iPad: fixture trovata `true`, immagini trovate `12/12`, score Android letti `6/6`, tentativi nativi `6`, score calcolati nativamente `0/6`.
- Score Android attesi dalla fixture: `0=72`, `1=86`, `2=70`, `3=50`, `4=94`, `5=60`.
- Il motore iPad restituisce `native_status=2` e `native_score=-1` per tutte le metriche, con messaggio corretto: manca il bridge immagine nativo equivalente agli OpenCV Mat Android. Nessuno score inventato.
- Report: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_GOLDEN_FIXTURE_TEST_REPORT.md`.
- Core primario non raggiungibile; fallback Core 2.0 usato: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.

## Stato SkinHarmony Analyzer Pro iPad Original Engine Port 2026-06-07
- Portato dentro l'app iPad il blocco motore originale in formato sorgente/SDK iOS nativo.
- Aggiornati `skinharmony_original_scoring.h`, `skinharmony_original_scoring_unavailable.c`, `SkinHarmonyOriginalScoringBridge.h/.mm` e `OriginalScoringEngine.swift`.
- Il modulo iPad contiene ora mapping completo delle 6 metriche `HotImgProc`, build id Android `75864f0ef29145673069e270ec1ba6515936857d`, metodi JNI originali e golden score reali prodotti dal tablet Android.
- La schermata Sistema ora puo leggere: `Motore iPad caricato: 6/6 metriche mappate. In attesa di validazione scoring immagini.`
- Build Xcode fisica OK, installazione iPad OK, avvio app OK su bundle `com.skinharmony.analyzerpro.ipad`.
- Confine tecnico stabile: scoring numerico su nuove immagini iPad resta disabilitato finche il bridge pixel/OpenCV equivalente non passa confronto golden Android. Nessun punteggio inventato.
- Report: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_ORIGINAL_ENGINE_PORT_REPORT.md`.
- Core primario non raggiungibile; fallback Core 2.0 usato: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`. La variante `direct_fake_formula_port` e stata scartata esplicitamente per conflitto con la policy no-fake-score.

## Stato SkinHarmony Analyzer Pro iPad Original Scoring SDK 2026-06-07
- Creato e integrato nell'app iPad il primo SDK/source iOS per `SkinHarmony Original Scoring`, partendo dal contratto Android reale `HotImgProc/libimageproc.so`.
- File iOS integrati in `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/SkinAnalyzerProiPad/OriginalScoringSDK/`.
- Aggiunto bridging header Swift/Objective-C e collegamento in `OriginalScoringEngine.swift`.
- Build Xcode su iPad fisico riuscita, installazione riuscita e app avviata con bundle `com.skinharmony.analyzerpro.ipad`.
- Verifiche OK: `plutil` progetto/Info, `xcodebuild ... build`, `devicectl device install app`, `devicectl device process launch`.
- Confine tecnico stabile: su iPad il ponte SDK e pronto ma ritorna `original_engine_port_unavailable` finche non viene collegato un motore originale iOS/Mach-O o sorgente OEM compilabile. Nessun punteggio iOS inventato o euristico.
- Report: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IOS_ORIGINAL_SCORING_SDK_INTEGRATION_REPORT.md`.
- Core connector locale `127.0.0.1:3199` non disponibile; decisione usata da Core 2.0 locale: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.

## Stato SkinHarmony Analyzer Pro iPad PWA 2026-06-07
- Creata prima linea iPad installabile come PWA locale in `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/07-skinharmony-analyzer-pro-ipad-pwa/`.
- Motivo tecnico: l APK Android `SkinHarmony_Analyzer_Pro_full_machine_clone.apk` non puo essere installato su iPadOS; Core 2.0 ha selezionato `local_pwa_installable_first` rispetto ad app iOS nativa immediata o conversione APK.
- Server locale attivo su `http://192.168.1.168:4177/` dalla cartella PWA, pensato per apertura da Safari su iPad e `Aggiungi a Home`.
- UI iniziale: home SkinHarmony Analyzer Pro, logo locale, ingressi `Clienti`, `Nuova analisi`, `Prodotti`, `Sistema`, report demo non medico, manifest e service worker. Nessuna chiamata esterna, nessun deploy, nessuna automazione macchina.
- Verifiche: `manifest.webmanifest` JSON OK, `node --check app.js` OK, `curl -I http://127.0.0.1:4177/` 200, manifest servito 200.
- Core connector locale `127.0.0.1:3199` non disponibile; decisione usata da Core 2.0 locale: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.

## Stato SkinHarmony Analyzer Pro iPad nativo 2026-06-07
- Dopo correzione owner, la PWA non e il target finale: creata linea app iPad nativa in `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/`.
- Progetto Xcode: `SkinAnalyzerProiPad.xcodeproj`; bundle id `com.skinharmony.analyzerpro.ipad`; target iPad landscape.
- UI SwiftUI iniziale allineata alla home Analyzer Pro: logo, `Clienti`, `Nuova analisi`, `Prodotti`, `Sistema`, report demo non medico e guardrail.
- Aggiunto pannello `Configurazione AI` con salvataggio sicuro nel Keychain iOS per `Core API key`, `Nyra API key`, `OpenAI API key`; endpoint Core/Nyra e modello OpenAI restano in UserDefaults.
- `Output AI` usa OpenAI se configurato, poi Core, poi Nyra, poi fallback locale. Nessuna chiave reale e stata scritta nel repository.
- Verifiche locali OK: `plutil -lint Info.plist`, `plutil -lint project.pbxproj`, `swiftc -module-cache-path .tmp-swift-cache -typecheck .../*.swift`.
- Blocco installazione fisica: Mac ha solo Command Line Tools (`/Library/Developer/CommandLineTools`), `xcodebuild` richiede Xcode completo e `security find-identity -v -p codesigning` mostra `0 valid identities found`.
- Core connector locale `127.0.0.1:3199` non disponibile; decisioni usate da Core 2.0 locale: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.

## Stato SkinHarmony Analyzer Core/Nyra ensemble 2026-06-07
- Corretto il runtime AI locale SkinHarmony Analyzer: il ramo Core non decide piu sul singolo punteggio piu basso, ma usa `skinharmony_skin_ensemble_v1` con `dominant_pattern`, `secondary_patterns`, `relationship_rules` e `narrative_strategy`.
- File locali principali:
  - `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/shared/tools/analyzer_ensemble_core.js`
  - `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/shared/tools/skinharmony_analyzer_ai_adapter.js`
  - `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/shared/tools/analyzer_ai_local_server.js`
  - `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/shared/knowledge/nyra_skin_aesthetics_v1.json`
- Sul report reale Guest del tablet/tricocamera: Core 200, Nyra 200, OpenAI 200. Dominante: `pori, grana e texture` con attention score `77`; secondario: `reattivita e tolleranza cutanea` con score `51`; idratazione buona e discromie non prioritarie.
- Il report visibile non usa piu wording tipo bozza/conferma operatore; la review professionale resta solo guardrail interno.
- Repo Render reale `/Users/cristiancardarello/skinharmony-ai-backend` patchato con branch `skinharmony_analyzer` in `services/universal-core-service` e smoke test locale OK. Non e stato fatto push/deploy live: Core 2.0 ha selezionato `patch_backend_and_test_no_push`.
- Core connector locale `127.0.0.1:3199` non disponibile; decisioni usate da Core 2.0 locale: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.

## Stato SkinHarmony Analyzer emulator-camera test 2026-06-07
- Creata linea locale separata `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/05-skinharmony-emulator-camera-test/` copiando la baseline custom `04`, senza eliminare o sovrascrivere `04-skinharmony-custom-apk`.
- Obiettivo: testare SkinHarmony Analyzer su Mac tramite Android emulator, dove la tricocamera/webcam viene esposta come Android Camera API e non come USB/UVC device.
- Modifiche solo nella linea `05`:
  - `MainActivity.pressBtnStart()` punta a `hot.com.smartbubble.ui.EmulatorCameraActivity`;
  - `PreviewActivity` UVC originale resta presente e non cancellata;
  - manifest con `CAMERA` permission e feature USB non obbligatorie per il ramo emulatore;
  - nuova `EmulatorCameraActivity` programmatica in smali usa `android.hardware.Camera`.
- APK locale firmato: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/05-skinharmony-emulator-camera-test/dist/SkinHarmony_Analyzer_emulator_camera.apk`.
- Test emulatore: installazione OK, Start Detection apre `EmulatorCameraActivity`, CameraService apre camera `0`; preview visibile ma scura/rumorosa, con log emulatore `Unable to obtain video frame from the camera`. Interpretazione: bypass app-side riuscito, backend camera emulatore instabile.
- Report: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/05-skinharmony-emulator-camera-test/docs/EMULATOR_CAMERA_TEST_REPORT.md`.
- Core connector locale `127.0.0.1:3199` non disponibile; decisione usata da Core 2.0 locale: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`.

Aggiornato: 2026-06-06T19:05:00Z

## Stato Suite 5.3.52 CRM company 360 fatal hotfix candidate - SUPERSEDED ERRATA
- Nota `2026-07-01`: sezione storica non autoritativa dopo correzione owner e ripartenza dalla `.48`. Non usare questa `.52` per reinstall, manifest o prossimo passo finche non viene reintrodotta consapevolmente sulla baseline corretta.
- Release locale `5.3.52` preparata dopo il crash live della pagina `CRM B2B` osservato su `5.3.51`.
- Diagnosi chiusa:
  - gli endpoint live `status`, `b2b-crm`, `crm-order-ledger`, `control-plane` e `tenant-registry` rispondevano `200`, quindi il problema non era nel REST o nei dati base;
  - il punto piu plausibile era `get_b2b_crm_company_360_status()`, usato dal render admin del cockpit ma non dal reader REST `b2b-crm`;
  - il builder assumeva sempre presenti gli array `license_registry['licenses']`, `followups` e `customers` delle board secondarie, e su payload parziali/null poteva mandare `array_filter()` in `TypeError` su PHP 8.
- Perimetro patch chiuso senza cambiare la UX:
  - `license_registry['licenses']` viene validato prima del loop;
  - `customer_success_followup`, `customer_lifecycle_board`, `renewal_risk_board` e `customer_value_board` vengono letti con fallback array vuoto sulle chiavi usate dal cockpit;
  - il cockpit CRM continua a mostrare la stessa vista piena, ma non puo piu andare in fatal se una board secondaria torna vuota o incompleta.
- Nessuna scrittura live, nessuna mutazione dati, nessun cambiamento commerciale.
- Artefatti locali pronti:
  - `dist/skinharmony-site-suite-5.3.52.zip`
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_52_LOCAL_2026-05-19.json`
  - `reports/wordpress/skinharmony_site_suite_local_latest.json`
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
  - `node scripts/test_skinharmony_site_suite_plugin.js` -> `1717/1717`
  - `node scripts/program_registry_check.js --memory-dir SHARED_MEMORY --require-all-programs` -> `READY`
  - `bash scripts/build_skinharmony_site_suite_plugin.sh`
  - `node scripts/suite_operational_closure.js --version=5.3.52` -> preflight `22/22`, local test `1717/1717`
- Residuo reale:
  - la `5.3.52` non e ancora installata live;
  - dopo installazione va verificata subito l apertura reale di `CRM B2B` in browser;
  - solo dopo il fix del crash ha senso tornare al blocco performance governance della `5.3.51`.
- Gate locale `ALLOWED` usato per la patch: `reports/codex-core/codex_core_gate_latest.json`

## Stato Suite 5.3.51 governance performance candidate - SUPERSEDED ERRATA
- Nota `2026-07-01`: sezione storica non autoritativa. Non confondere questa candidata performance con la `5.3.51` reale attuale, che e l'hotfix Price Guard/readiness derivato dalla linea `.48 -> .50`.
- Release locale `5.3.51` preparata dopo audit performance severo read-only della Suite live `5.3.50`, che ha confermato colli persistenti soprattutto su `tenant-registry`, `go-live-checklist`, `activation-runbook`, `connection-command-center`, `update-governance`, con instabilita anche su `control-plane`.
- Perimetro patch chiuso senza cambiare la UX:
  - introdotti wrapper transient read-only brevi per `connection-command-center`, `activation-runbook`, `go-live-checklist`, `update-governance`, `tenant-registry`;
  - `refresh=1` resta amministratore-only sulle route REST interessate;
  - i pannelli Control Room, `completion-map`, `control-plane`, alcuni builder enterprise e lo snapshot remoto riusano i payload cacheati invece di richiamare a catena gli stessi status nello stesso flusso.
- Nessuna `light view`, nessun cambio di payload funzionale, nessuna scrittura live o mutazione dati.
- Artefatti locali pronti:
  - `dist/skinharmony-site-suite-5.3.51.zip`
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_51_LOCAL_2026-05-19.json`
  - `reports/wordpress/skinharmony_site_suite_local_latest.json`
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
  - `node scripts/test_skinharmony_site_suite_plugin.js` -> `1717/1717`
  - `node scripts/program_registry_check.js --memory-dir SHARED_MEMORY --require-all-programs` -> `READY`
  - `bash scripts/build_skinharmony_site_suite_plugin.sh`
  - `node scripts/suite_operational_closure.js --version=5.3.51` -> preflight `22/22`, local test `1717/1717`
- Residuo reale:
  - la candidata `5.3.51` non e ancora installata live;
  - manca il confronto live prima/dopo sui tempi warm dei 5 endpoint governance e sulla stabilita di `control-plane`;
  - se i tempi restano alti anche dopo questa cache layer, il prossimo blocco corretto e spostare parte del `control-plane` verso snapshot remoti/light readers e ridurre le chiamate remote concatenate.
- Gate locale `ALLOWED` usato per la patch: `reports/codex-core/codex_core_gate_latest.json`

## Stato Suite 5.3.50 CRM shared/pool scope candidate
- Release `5.3.50` preparata continuando dalla baseline comportamentale `5.3.44` e dai blocchi multiutente `5.3.48` + `5.3.49`, senza introdurre nessuna `light view`.
- Chiuse le eccezioni commerciali per account `condivisi` e `non assegnati`:
  - il master CRM usa ora `portfolio_scope` oltre a `assigned_user_id` e `assigned_agent`;
  - owner/admin possono scegliere `assigned_only`, `shared_agents`, `unassigned_pool` direttamente nel form contatto;
  - il ruolo `agent` vede i contatti secondo questa policy senza perdere la compatibilita col dato storico.
- Isolamento ordini assistiti chiuso sul perimetro portafoglio:
  - il filtro agente si applica anche alle righe del `CRM Order Ledger`;
  - le righe ordine assistito salvano `created_by_user_id`, `created_by_label`, metadati del portafoglio contatto e mostrano in UI chi ha creato la riga;
  - l archiviazione soft del ledger rifiuta righe fuori perimetro con `scope_locked`.
- Perimetro UI aggiornato:
  - tabella account e company cockpit mostrano la policy portafoglio in chiaro;
  - il form CRM mostra la nuova `Visibilita portafoglio` agli owner/admin;
  - il ledger principale e il cockpit ordini mostrano provenienza operativa e assegnazione del contatto senza cambiare il flusso CRM.
- Verifica live e cleanup chiusi il `2026-06-06`:
  - endpoint live confermati `200` con `version=5.3.50` su `status`, `CRM B2B` e `CRM Order Ledger`;
  - campi nuovi confermati live: `portfolio_scope`, `portfolio_scope_label`, `contact_portfolio_scope`, `created_by_user_id`, `created_by_label`;
  - eseguito cleanup controllato dei soli record `E2E` tramite endpoint `crm-erp-lite/e2e-cleanup` con `include_woocommerce=false`;
  - residui E2E rimossi dal live: `3` prodotti registry, `3` tecnologie registry, `3` contatti CRM, `3` documenti CRM, `6` righe CRM order ledger; `WooCommerce` non toccato.
- Stato live attuale dopo cleanup:
  - `crm_contacts=2`
  - `order_ledger_rows=1`
  - `e2e_contacts_remaining=0`
  - `e2e_rows_remaining=0`
- Residuo reale:
  - manca ancora il test di accettazione completo scenario `azienda con 15 agenti`;
  - resta aperta la rifinitura `support mode owner` se emergera da test browser reali;
  - va fatta la validazione browser reale dei casi `assigned_only`, `shared_agents`, `unassigned_pool` con utente `agent`.
- Artefatti locali pronti:
  - `dist/skinharmony-site-suite-5.3.50.zip`
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_50_LOCAL_2026-05-19.json`
  - `reports/wordpress/skinharmony_site_suite_local_latest.json`
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
  - `SHSS_EXPECTED_VERSION=5.3.50 node scripts/test_skinharmony_site_suite_plugin.js` -> `1717/1717`
  - `node scripts/program_registry_check.js --memory-dir SHARED_MEMORY --require-all-programs` -> `READY`
  - `node scripts/suite_operational_closure.js --version=5.3.50` -> preflight `22/22`, local test `1717/1717`
- Gate locale `ALLOWED` usato per la patch: `reports/codex-core/codex_core_gate_latest.json`
- Stato live: installata e verificata. Cleanup E2E completato senza toccare ordini o prodotti WooCommerce reali.

## Stato Suite 5.3.49 CRM finance/support scope candidate
- Release locale `5.3.49` preparata continuando dalla baseline comportamentale `5.3.44` e dal blocco multiutente `5.3.48`, senza introdurre nessuna `light view`.
- Chiusa la matrice UI/menu per `finance` e `support`:
  - `CRM B2B` riconosce tre profili CRM ristretti: `agent`, `finance`, `support`;
  - il menu Suite dei profili ristretti parte dal CRM e mostra solo le pagine coerenti col ruolo;
  - il CRM apre con desk dedicati `Finance Desk` e `Support Desk`, mantenendo la vista piena ma togliendo i blocchi commerciali o amministrativi non coerenti.
- Perimetro UI chiuso:
  - `finance` vede aziende, scheda azienda, ledger read-only, documenti con write/export coerenti, pagamenti, Value Chain e licenze;
  - `support` vede aziende, scheda azienda, licenze, customer success, rinnovi, timeline, documenti ed email in sola lettura;
  - form e pulsanti non coerenti col ruolo spariscono: `Modifica`, `Nuovo ordine`, archiviazioni email/documenti e form CRM non vengono mostrati se il ruolo non puo davvero salvare.
- Residuo reale:
  - restano da definire eccezioni `account non assegnati`, `account condivisi` e support mode owner;
  - va ancora chiuso l isolamento completo degli ordini assistiti sul perimetro portafoglio;
  - manca il test di accettazione scenario `azienda con 15 agenti`.
- Artefatti locali pronti:
  - `dist/skinharmony-site-suite-5.3.49.zip`
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_49_LOCAL_2026-05-19.json`
  - `reports/wordpress/skinharmony_site_suite_local_latest.json`
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
  - `SHSS_EXPECTED_VERSION=5.3.49 node scripts/test_skinharmony_site_suite_plugin.js` -> `1714/1714`
  - `node scripts/program_registry_check.js --memory-dir SHARED_MEMORY --require-all-programs` -> `READY`
  - `node scripts/suite_operational_closure.js --version=5.3.49` -> preflight `22/22`, local test `1714/1714`
- Stato live: non installata in questo giro.

## Stato Suite 5.3.48 CRM agent portfolio candidate
- Release locale `5.3.48` preparata partendo dalla baseline comportamentale `5.3.44` e continuando la linea anti-monolite `.46/.47` senza introdurre nessuna `light view`.
- Primo blocco multiutente commerciale chiuso per il ruolo `agent`:
  - `assigned_user_id` aggiunto come assegnazione strutturata, mantenendo compatibilita con il dato storico `assigned_agent`;
  - owner/admin possono assegnare il portafoglio da utente WordPress direttamente nel form CRM;
  - il ruolo `agent` salva sempre nel proprio portafoglio e non puo riassegnare account;
  - il filtro portafoglio si applica a contatti CRM, company cockpit, email thread, documenti ed export CSV;
  - il menu Suite dell agente parte da `CRM B2B` e resta nel perimetro commerciale utile, senza scorciatoie a registry, Core admin o pagamenti.
- Hardening write chiuso:
  - i form/handler CRM negano accesso se il contatto o la risorsa non sono visibili nel perimetro agente;
  - coperti anche `duplica`, `archivia`, `converti`, `bozza proposta`, salvataggio thread email e salvataggio/archiviazione documenti.
- Residuo reale:
  - la matrice completa `finance/support` non e ancora tradotta in visibilita dedicata;
  - restano da definire eccezioni `account non assegnati`, `account condivisi` e support mode owner;
  - manca il test di accettazione scenario `azienda con 15 agenti`.
- Artefatti locali pronti:
  - `dist/skinharmony-site-suite-5.3.48.zip`
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_48_LOCAL_2026-05-19.json`
  - `reports/wordpress/skinharmony_site_suite_local_latest.json`
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
  - `SHSS_EXPECTED_VERSION=5.3.48 node scripts/test_skinharmony_site_suite_plugin.js` -> `1710/1710`
  - `node scripts/program_registry_check.js --memory-dir SHARED_MEMORY --require-all-programs` -> `READY`
  - `node scripts/suite_operational_closure.js --version=5.3.48` -> preflight `22/22`, local test `1710/1710`
- Stato live: non installata. Nessun deploy o update live in questo giro.

## Stato checklist CRM multiutente commerciale
- Preparata checklist condivisa: `SHARED_MEMORY/checklists/suite_crm_multiuser_commercial_closure_checklist_2026-06-06.md`
- Valutazione reale fissata:
  - il `CRM B2B` ha gia ruoli e capability operative per agenti, finance, support e owner;
  - il primo blocco multiutente commerciale e ora chiuso per il ruolo `agent` con assegnazione strutturata + filtro portafoglio;
  - non e ancora chiuso come multiutente commerciale pieno perche restano aperti `finance/support`, eccezioni governate e test scenario `15 agenti`.
- Criterio di chiusura fissato:
  - non basta che l agente possa entrare nel CRM;
  - serve che veda solo il proprio perimetro e che il menu non gli apra aree amministrative non coerenti col ruolo.

## Stato Suite 5.3.47 anti-monolite CRM candidate
- Release locale `5.3.47` preparata continuando dalla baseline comportamentale `5.3.44` e dal primo taglio `.46`.
- Correzione strutturale confermata:
  - `5.3.45` resta scartata per la UX `vista leggera`;
  - i moduli operativi devono aprire direttamente nella vista piena;
  - la scomposizione del monolite deve restare interna e invisibile per chi lavora.
- Lavoro chiuso in `5.3.47`:
  - mantenuto il rollback del ramo `light view` da `render_dashboard()`, `render_waas_analytics_admin()` e `render_b2b_crm_admin()`;
  - completato il secondo taglio anti-monolite sul `CRM B2B` con metodi dedicati:
    - `get_b2b_crm_admin_context()`
    - `render_b2b_crm_admin_notices()`
    - `render_b2b_crm_account_form_panel()`
    - `render_b2b_crm_legacy_registry_panel()`
    - `render_b2b_crm_rules_panel()`
- Confine tecnico attuale:
  - il pannello ordini/ledger non e stato estratto;
  - un gate iniziale e stato bloccato dal connector locale con `local_hard_gate:ledger`;
  - il refactor `.47` e quindi proseguito solo sui pannelli CRM non protetti.
- Artefatti locali pronti:
  - `dist/skinharmony-site-suite-5.3.47.zip`
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_47_LOCAL_2026-05-19.json`
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
  - `SHSS_EXPECTED_VERSION=5.3.47 node scripts/test_skinharmony_site_suite_plugin.js` -> `1705/1705`
  - `node scripts/program_registry_check.js --memory-dir SHARED_MEMORY --require-all-programs` -> `READY`
  - `node scripts/suite_operational_closure.js --version=5.3.47` -> preflight `22/22`, local test `1705/1705`
- Stato live: non installata. Nessun deploy o update live in questo giro.

## Stato Suite 5.3.46 anti-monolite CRM candidate
- Release locale `5.3.46` preparata partendo dalla baseline comportamentale `5.3.44`.
- Correzione strutturale fissata:
  - `5.3.45` resta scartata per la UX `vista leggera`;
  - i moduli operativi devono aprire direttamente nella vista piena;
  - cache e snapshot si usano dietro le quinte, non come passaggio UI.
- Lavoro chiuso in `5.3.46`:
  - rollback del ramo `light view` da `render_dashboard()`, `render_waas_analytics_admin()` e `render_b2b_crm_admin()`;
  - primo taglio anti-monolite sul `CRM B2B` con metodi dedicati:
    - `get_b2b_crm_admin_context()`
    - `render_b2b_crm_admin_notices()`
    - `render_b2b_crm_account_form_panel()`
- Obiettivo del taglio:
  - mantenere identica la UX operativa;
  - ridurre il peso concettuale del metodo monolite;
  - preparare la separazione progressiva di altri blocchi CRM senza alterare il pannello.
- Artefatti locali pronti:
  - `dist/skinharmony-site-suite-5.3.46.zip`
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_46_LOCAL_2026-05-19.json`
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
  - `SHSS_EXPECTED_VERSION=5.3.46 node scripts/test_skinharmony_site_suite_plugin.js` -> `1705/1705`
  - `node scripts/program_registry_check.js --memory-dir SHARED_MEMORY --require-all-programs` -> `READY`
  - `node scripts/suite_operational_closure.js --version=5.3.46` -> preflight `22/22`, local test `1705/1705`
- Stato live: non installata. Nessun deploy o update live in questo giro.

## Stato Suite rollback operativo a 5.3.44
- Decisione owner registrata il `2026-06-06`: la release `5.3.45` va considerata `scartata` come baseline operativa.
- Motivo del rollback:
  - `CRM B2B` apre in `vista leggera`;
  - questo cambia il flusso operativo reale e aggiunge un passaggio che l owner non vuole;
  - il principio corretto resta: il CRM deve aprire direttamente nella vista piena e usare la cache come supporto invisibile, non come gateway UX.
- Stato operativo corretto da ora:
  - baseline Suite da usare = `5.3.44`;
  - `5.3.45` resta solo come artefatto locale/documentale e non come direzione approvata;
  - ogni ripartenza sul tema performance admin deve partire da `5.3.44` e ridisegnare il caching senza introdurre `light view` nei moduli operativi.

## Stato Suite 5.3.45 light shell / cached snapshot readiness
- Release locale `5.3.45` preparata per tagliare il first paint pesante dei tre builder/admin status P0:
  - `render_dashboard()`
  - `render_waas_analytics_admin()`
  - `render_b2b_crm_admin()`
- Regola introdotta:
  - la vista default apre in `light shell` da snapshot locale cacheato;
  - la vista completa e esplicita, con flag query dedicato e refresh manuale;
  - i builder profondi non devono piu partire nel ramo light;
  - il full view usa snapshot completo cacheato, cosi anche la diagnostica approfondita non rigenera tutto a ogni click.
- Impatto applicativo locale:
  - `Suite root` usa `get_suite_site_light_status()` e `get_suite_site_complete_snapshot_cached()`;
  - `Analytics WaaS` usa `get_waas_analytics_light_status()` e `get_waas_analytics_complete_snapshot_cached()`;
  - `CRM B2B` usa `get_b2b_crm_light_status()` e `get_b2b_crm_complete_snapshot_cached()`;
  - nuove query flag: `shss_full_suite_site`, `shss_full_waas_analytics`, `shss_full_b2b_crm`;
  - UI aggiornata con notice snapshot, `Aggiorna snapshot`, `Apri vista completa`, `Torna alla vista veloce`.
- Artefatti locali pronti:
  - `dist/skinharmony-site-suite-5.3.45.zip`;
  - `dist/skinharmony-site-suite.zip`;
  - `dist/skinharmony-site-suite-update-manifest.json`;
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_45_LOCAL_2026-05-19.json`.
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`;
  - `SHSS_EXPECTED_VERSION=5.3.45 node scripts/test_skinharmony_site_suite_plugin.js` -> `1705/1705`;
  - `node scripts/program_registry_check.js --memory-dir SHARED_MEMORY --require-all-programs` -> `READY`;
  - `node scripts/suite_operational_closure.js --version=5.3.45` -> preflight `22/22`, local test `1705/1705`.
- Stato decisionale aggiornato: `release scartata come baseline`. Anche se installata per prova, il riferimento operativo da ripristinare resta `5.3.44`.

## Stato Suite 5.3.44 CRM Order Ledger soft archive readiness
- Release locale `5.3.44` preparata per chiudere il gap operativo del `CRM Order Ledger` quando una riga e stata inserita per errore, e duplicata o la vendita si ferma.
- Regola introdotta:
  - il ledger non usa `delete hard`;
  - le righe `crm_manual` e `b2b_order_bridge` si archiviano in soft delete con motivo obbligatorio;
  - le righe `WooCommerce` non si archiviano dal CRM e mostrano il blocco `Gestisci dalla sorgente WooCommerce, non dal ledger CRM.`;
  - le righe archiviate escono da cockpit, riepiloghi e viste attive ma restano nello storico audit locale.
- Impatto applicativo locale:
  - nuovo storage raw `get_crm_order_ledger_storage_rows()` per non perdere le righe archiviate al primo update;
  - handler admin-post `shss_archive_b2b_crm_order` con motivi `errore_inserimento`, `vendita_saltata`, `duplicato`, `trattativa_fermata`;
  - tabella manager del `CRM Order Ledger` con azioni esplicite e form `Archivia`;
  - scheda azienda `Ordini e pagamenti` aggiornata con la stessa azione soft archive;
  - manuale/operazioni Suite allineati alla regola `no delete hard nel ledger`.
- Artefatti locali pronti:
  - `dist/skinharmony-site-suite-5.3.44.zip`;
  - `dist/skinharmony-site-suite.zip`;
  - `dist/skinharmony-site-suite-update-manifest.json`;
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_44_LOCAL_2026-05-19.json`.
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`;
  - `SHSS_EXPECTED_VERSION=5.3.44 node scripts/test_skinharmony_site_suite_plugin.js` -> `1705/1705`;
  - `node scripts/program_registry_check.js --file wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php --file wordpress/plugins/skinharmony-site-suite/assets/site-suite.css --file scripts/test_skinharmony_site_suite_plugin.js --file SHARED_MEMORY/programs/suite/OPERATIONS.md --file SHARED_MEMORY/programs/suite/USER_MANUAL.md` -> `READY`;
  - `node scripts/suite_operational_closure.js --version=5.3.44` -> preflight `22/22`, local test `1705/1705`.
- Stato live: non ancora installata. Il prossimo passo corretto, se si vuole il runtime live, e installazione manuale owner della `5.3.44` e verifica browser che `Archivia` funzioni sulle righe manuali/B2B e resti bloccato sulle righe WooCommerce.

## Stato Suite 5.3.43 payment settlements open links readiness
- Release locale `5.3.43` preparata per rendere operativo il pannello `Payment Settlements` senza cambiare la sua natura read-only.
- Regola introdotta:
  - dalla schermata `Payment Settlements` si devono poter aprire i pagamenti WooCommerce;
  - la tabella `Gateway WooCommerce` espone il pulsante `Apri gateway` per il singolo metodo;
  - la tabella settlement espone `Apri ordine` per arrivare subito all ordine WooCommerce sorgente;
  - il pannello continua a non modificare denaro, payout, refund o checkout: apre i moduli giusti, non esegue azioni finanziarie.
- Impatto applicativo locale:
  - helper URL WooCommerce per impostazioni pagamenti e ordine;
  - CTA globali `Apri pagamenti WooCommerce` e `Apri ordini WooCommerce` nel blocco uso pratico;
  - colonna `Azione` aggiunta nelle tabelle gateway e settlement.
- Artefatti locali pronti:
  - `dist/skinharmony-site-suite-5.3.43.zip`;
  - `dist/skinharmony-site-suite.zip`;
  - `dist/skinharmony-site-suite-update-manifest.json`;
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_43_LOCAL_2026-05-19.json`.
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`;
  - `SHSS_EXPECTED_VERSION=5.3.43 node scripts/test_skinharmony_site_suite_plugin.js` -> `1701/1701`;
  - `node scripts/program_registry_check.js --file wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php --file wordpress/plugins/skinharmony-site-suite/README.md --file SHARED_MEMORY/programs/suite/OPERATIONS.md --file SHARED_MEMORY/programs/suite/USER_MANUAL.md` -> `READY`;
  - `node scripts/suite_operational_closure.js --version=5.3.43` -> preflight `22/22`, local test `1701/1701`.
- Stato live: non ancora installata. Il prossimo passo corretto, se si vuole il runtime live, e installazione manuale owner della `5.3.43` e verifica browser che `Payment Settlements` apra davvero i pagamenti WooCommerce, il gateway scelto e l ordine sorgente.

## Stato Suite 5.3.42 explicit navigation readiness
- Release locale `5.3.42` preparata per rendere esplicita la navigazione CRM/Suite quando un bottone o una card promettono un'azione.
- Regola introdotta:
  - i deep-link interni devono aprire la sezione target, evidenziarla e portare il focus sul primo campo utile visibile;
  - il form `Modifica contatto commerciale` non deve piu fermarsi su input hidden o su una sezione aperta senza focus reale;
  - le card KPI dell`ERP Lite dashboard` ora aprono ledger, pagamenti, rinnovi, pipeline, Value Chain, follow-up o licenze invece di restare metriche mute;
  - i widget `Operazioni oggi`, `Source of truth` e `Controllo owner` ora mostrano link espliciti ai moduli sorgente, evitando navigazione a intuito.
- Impatto applicativo locale:
  - helper URL CRM dedicati per `edit_contact` e `account` con anchor corretti;
  - JS admin esteso per gestire deep-link iniziali da `hash`, `edit_contact` e `account`, aprendo i `details` corretti e focalizzando il primo controllo visibile;
  - banner inline quando un contatto e in modifica e CTA `Apri modifica anagrafica` nella scheda contatti.
- Artefatti locali pronti:
  - `dist/skinharmony-site-suite-5.3.42.zip`;
  - `dist/skinharmony-site-suite.zip`;
  - `dist/skinharmony-site-suite-update-manifest.json`;
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_42_LOCAL_2026-05-19.json`.
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`;
  - `node --check wordpress/plugins/skinharmony-site-suite/assets/site-suite-admin.js`;
  - `SHSS_EXPECTED_VERSION=5.3.42 node scripts/test_skinharmony_site_suite_plugin.js` -> `1699/1699`;
  - `node scripts/program_registry_check.js --file wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php --file wordpress/plugins/skinharmony-site-suite/assets/site-suite-admin.js --file wordpress/plugins/skinharmony-site-suite/README.md --file SHARED_MEMORY/programs/suite/OPERATIONS.md --file SHARED_MEMORY/programs/suite/USER_MANUAL.md` -> `READY`;
  - `node scripts/suite_operational_closure.js --version=5.3.42` -> preflight `22/22`, local test `1699/1699`.
- Stato live: non ancora installata. Il prossimo passo corretto, se si vuole il runtime live, e installazione manuale owner della `5.3.42` e verifica browser su `CRM B2B` per confermare deep-link, focus reale e card ERP Lite cliccabili.

## Stato Suite 5.3.41 product cards registry-first readiness
- Release locale `5.3.41` preparata per togliere la duplicazione manuale tra `Product Cards`, `Magazzino Tecnologie` e `Magazzino Prodotti`.
- Regola introdotta:
  - `Product Cards` e lo shortcode `[sh_technology_cards]` leggono automaticamente i dati dai registry master;
  - `Magazzino Tecnologie` alimenta le card tecnologia e preferisce il link della pagina tecnologia dedicata;
  - `Magazzino Prodotti` alimenta le card prodotto e preferisce il permalink WooCommerce collegato quando esiste;
  - il pannello `Product Cards` resta solo come layer di override leggero per `title/tag/text/link`, non come seconda anagrafica catalogo;
  - WooCommerce resta un canale opzionale e non e la fonte unica delle card pubbliche.
- Impatto applicativo locale:
  - nuove routine `get_catalog_card_entries()` e resolver collegati nel plugin monolite;
  - admin `Product Cards` resa `registry-first` con righe automatiche da registry e area legacy separata;
  - shortcode pubblico e payload traduzioni Core riallineati alle card risolte dai registry master.
- Artefatti locali pronti:
  - `dist/skinharmony-site-suite-5.3.41.zip`;
  - `dist/skinharmony-site-suite.zip`;
  - `dist/skinharmony-site-suite-update-manifest.json`;
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_41_LOCAL_2026-05-19.json`.
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`;
  - `SHSS_EXPECTED_VERSION=5.3.41 node scripts/test_skinharmony_site_suite_plugin.js` -> `1695/1695`;
  - `node scripts/program_registry_check.js --file wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php --file wordpress/plugins/skinharmony-site-suite/README.md --file SHARED_MEMORY/programs/suite/ARCHITECTURE.md --file SHARED_MEMORY/programs/suite/USER_MANUAL.md --file SHARED_MEMORY/programs/suite/OPERATIONS.md` -> `READY`;
  - `node scripts/suite_operational_closure.js --version=5.3.41` -> preflight `22/22`, local test `1695/1695`.
- Stato live: non ancora installata. Il prossimo passo corretto, se si vuole il runtime live, e installazione manuale owner della `5.3.41` e verifica browser su `Product Cards`, pagina Tecnologie e shortcode `[sh_technology_cards]`.

## Stato Suite 5.3.40 technology pricing autopilot readiness
- Release locale `5.3.40` preparata per automatizzare il pricing delle tecnologie dentro `Magazzino Tecnologie`, senza duplicare i dati nel `Product Registry`.
- Regola introdotta:
  - input master tecnologia: `prezzo acquisto` e `prezzo vendita netto all'esercente`;
  - la Suite deriva in automatico il profilo B2B tecnologia, mantenendo i prodotti separati per il B2C;
  - calcolo scenari distributore `40/50/60` con `50` default;
  - segnalazione `factory_cost_review` quando il margine brand non regge e serve rinegoziare il costo fabbrica o rivedere il prezzo esercente;
  - profilo advisory separato tra tecnologia estetica standard (`x3-x5`) e laser a ricarico ridotto.
- Impatto applicativo locale:
  - nuovo engine `src/core/pricing/TechnologyPricingEngine.php`;
  - `Technology Registry`, `CRM Order Ledger` e `Commerce Policy` ora espongono anche i campi derivati di pricing tecnologia;
  - `OPERATIONS` aggiornata con la policy pricing tecnologie `5.3.40`;
  - test Suite esteso per difendere engine, range distributore e campi autopilot.
- Artefatti locali pronti:
  - `dist/skinharmony-site-suite-5.3.40.zip`;
  - `dist/skinharmony-site-suite.zip`;
  - `dist/skinharmony-site-suite-update-manifest.json`;
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_40_LOCAL_2026-05-19.json`.
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`;
  - `php -l wordpress/plugins/skinharmony-site-suite/src/core/pricing/TechnologyPricingEngine.php`;
  - `SHSS_EXPECTED_VERSION=5.3.40 node scripts/test_skinharmony_site_suite_plugin.js` -> `1694/1694`;
  - `node scripts/program_registry_check.js ...` -> `READY`;
  - `node scripts/suite_operational_closure.js --version=5.3.40` -> preflight `22/22`, local test `1694/1694`.
- Stato live: non ancora installata. Il prossimo passo corretto, se richiesta la messa online, e installazione manuale owner della `5.3.40` e verifica browser di `Magazzino Tecnologie` con una tecnologia reale price-ready.

## Stato Suite 5.3.39 technology registry inline edit readiness
- Release locale `5.3.39` preparata per correggere la UX del `Magazzino Tecnologie` sulle righe `registry-only / price pending`.
- Correzione introdotta:
  - le righe senza prodotto WooCommerce non sono piu solo informative;
  - diventano editabili direttamente nella tabella con campi per nome, listino ufficiale, costo, modalita IVA acquisto, aliquota IVA, stock, ordine su richiesta e toggle WooCommerce/pubblicazione;
  - il submit `Salva Technology Registry` aggiorna il `Technology Registry` anche senza link Woo, mantenendo CRM allineato sullo stesso master.
- Artefatti locali pronti:
  - `dist/skinharmony-site-suite-5.3.39.zip`;
  - `dist/skinharmony-site-suite.zip`;
  - `dist/skinharmony-site-suite-update-manifest.json`;
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_39_LOCAL_2026-05-19.json`.
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`;
  - `SHSS_EXPECTED_VERSION=5.3.39 node scripts/test_skinharmony_site_suite_plugin.js` -> `1691/1691`;
  - `node scripts/program_registry_check.js ...` -> `READY`;
  - `node scripts/suite_operational_closure.js --version=5.3.39` -> preflight `22/22`, local test `1691/1691`.
- Stato live: il mother site e ancora su `5.3.38` finche l'owner non installa manualmente la `5.3.39`. Quindi lo screenshot con righe non cliccabili e coerente con il runtime attuale.

## Stato Suite 5.3.38 technology registry migration closed
- Site Suite `5.3.38` risulta installata e attiva sul mother site live.
- Verifica runtime live post installazione:
  - plugin version `5.3.38`;
  - endpoint `GET /wp-json/shss/v1/waas-manager/technology-inventory` = `200`;
  - endpoint `GET /wp-json/shss/v1/waas-manager/product-inventory` = `200`.
- Migrazione live completata con Core gate `ALLOWED`:
  - create `8` nuove anagrafiche tecnologia `registry-only/price_pending` nel `Technology Registry`;
  - archiviate `8` righe duplicate `reserved` nel `Product Registry`;
  - nessuna attivazione WooCommerce automatica per le nuove tecnologie.
- Stato live dopo migrazione:
  - `Product Registry summary.total = 0`;
  - `Technology Registry summary.total = 11`;
  - `Technology Registry registry_only = 8`;
  - `Technology Registry price_pending = 8`;
  - `Commerce Policy` continua a mostrare solo le `3` tecnologie con listino ufficiale (`Skin Pro`, `Termosauna`, `O3 System`).
- Report chiave:
  - `reports/wordpress/suite_technology_registry_duplicates_migration_latest.json`;
  - `reports/wordpress/suite_technology_registry_duplicates_audit_latest.json`;
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_38_LOCAL_2026-05-19.json`;
  - `reports/codex-core/codex_core_gate_latest.json`;
  - `reports/codex-core/program_registry_check_latest.json`.
- Residuo operativo corretto:
  - verificare in browser wp-admin la nuova UI `Magazzino Tecnologie`;
  - decidere, tecnologia per tecnologia, quando esiste un listino ufficiale reale e solo allora attivare WooCommerce dal master tecnologia.

## Stato Suite 5.3.37 technology registry alignment
- Checkpoint locale completato con Core gate `ALLOWED`, senza deploy o publish live della Suite.
- `Technology Registry` e ora il master unico anche per tecnologie senza listino ufficiale: prezzo `0` ammesso come `quote_only/price_pending`, CRM continua a leggere il catalogo tecnologie senza duplicazione nel `Product Registry`.
- Aggiunti endpoint REST locali:
  - `/wp-json/shss/v1/waas-manager/technology-inventory`;
  - `/wp-json/shss/v1/waas-manager/technology-inventory/upsert`.
- `Magazzino Tecnologie` riallineato alla UX di `Magazzino Prodotti`: hero governance, KPI, action center, registry panel e attivazione WooCommerce dal master tecnologia solo quando il listino ufficiale e presente.
- Gli script di pubblicazione pagine tecnologia ora usano `technology-inventory/upsert` invece di creare record duplicati in `product-inventory/upsert`.
- Verifiche locali OK:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`;
  - `php -l wordpress/plugins/skinharmony-site-suite/modules/technology-inventory/class-module.php`;
  - `node --check` sugli script pagina tecnologia toccati;
  - `node scripts/test_skinharmony_site_suite_plugin.js`;
  - `node scripts/program_registry_check.js ...`.
- Report chiave:
  - `reports/wordpress/skinharmony_site_suite_local_latest.json`;
  - `reports/codex-core/program_registry_check_latest.json`;
  - `reports/codex-core/codex_core_gate_latest.json`.

## Stato Suite 5.3.13 core admin read capability checkpoint 2
- Secondo checkpoint locale completato con Core gate `ALLOWED`, senza deploy, upload o sync Render. Lo script di closure ha rigenerato lo zip locale `dist/` come artifact di test.
- `can_read_core_admin_rest()` esteso a ulteriori endpoint GET informativi del control plane:
  - `/waas-manager/tenant-policy-surface`;
  - `/waas-manager/enterprise-mcp-gateway-map`;
  - `/waas-manager/ai-control-tower-score`;
  - `/waas-manager/agent-action-observability`;
  - `/waas-manager/context-freshness-monitor`;
  - `/waas-manager/ecosystem-tracks`;
  - `/waas-manager/connector-doctor`;
  - `/waas-manager/remote-runtime`;
  - `/waas-manager/remote-runtime/evidence-dashboard`;
  - `/waas-manager/connector-sdk`;
  - `/waas-manager/runbook-marketplace/preview`;
  - `/waas-manager/runbook-marketplace/artifacts`.
- Configurazioni, sync, execute, chiavi, import, pagamenti, ledger, settlement, stock mutation e automazioni restano protetti.
- Mappa permessi locale aggiornata:
  - `can_manage_rest=100`;
  - `can_access_suite_rest=6`;
  - `can_read_support_rest=7`;
  - `can_read_registry_rest=5`;
  - `can_read_core_admin_rest=19`;
  - `can_read_crm_rest=1`.
- Verifiche locali OK: PHP lint completo plugin, closure `22/22`, suite local `1688/1688`, audit bottoni/pagine `0` mancanti, program registry `READY`.
- Report:
  - `reports/wordpress/suite_rest_permission_map_latest.json`;
  - `reports/wordpress/skinharmony_site_suite_local_latest.json`;
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_13_LOCAL_2026-05-19.json`;
  - `reports/codex-core/program_registry_check_latest.json`;
  - `reports/codex-core/codex_core_gate_latest.json`.

## Stato Suite 5.3.13 core admin read capability checkpoint
- Checkpoint locale completato con Core gate `ALLOWED`, senza deploy, upload o sync Render. Lo script di closure ha rigenerato lo zip locale `dist/` come artifact di test.
- Nuovo helper REST `can_read_core_admin_rest()` per letture diagnostiche riservate a `manage_options` oppure `shss_core_admin`.
- Endpoint GET aperti al ruolo Core Admin:
  - `/enterprise-core/snapshot`;
  - `/waas-manager/control-plane`;
  - `/waas-manager/control-snapshot`;
  - `/waas-manager/suite-visibility-map`;
  - `/waas-manager/core-control-plane-bridge`;
  - `/waas-manager/live-connection-report`;
  - `/waas-manager/setup-runtime-map`.
- Configurazioni, sync, execute, chiavi, import, pagamenti, ledger, settlement, stock mutation e automazioni restano protetti.
- Mappa permessi locale in quel checkpoint:
  - `can_manage_rest=112`;
  - `can_access_suite_rest=6`;
  - `can_read_support_rest=7`;
  - `can_read_registry_rest=5`;
  - `can_read_core_admin_rest=7`;
  - `can_read_crm_rest=1`.
- Verifiche locali OK: PHP lint completo plugin, closure `22/22`, suite local `1688/1688`, audit bottoni/pagine `0` mancanti, program registry `READY`.
- Report:
  - `reports/wordpress/suite_rest_permission_map_latest.json`;
  - `reports/wordpress/skinharmony_site_suite_local_latest.json`;
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_13_LOCAL_2026-05-19.json`;
  - `reports/codex-core/program_registry_check_latest.json`;
  - `reports/codex-core/codex_core_gate_latest.json`.

## Stato Suite 5.3.13 registry read capability checkpoint
- Checkpoint locale completato senza deploy, upload o sync Render. Lo script di closure ha rigenerato lo zip locale `dist/` come artifact di test.
- Nuovo helper REST `can_read_registry_rest()` per letture registry/catalogo sicure.
- Endpoint GET aperti a lettura registry:
  - `/waas-manager/template-registry`;
  - `/waas-manager/template-registry/validate`;
  - `/waas-manager/product-inventory`;
  - `/waas-manager/manual-registry`;
  - `/waas-manager/runbook-marketplace/catalog-spec`.
- Endpoint di scrittura, import, configurazione, sync, chiavi, ledger, pagamenti e automazioni restano protetti.
- Mappa permessi locale aggiornata:
  - `can_manage_rest=119`;
  - `can_access_suite_rest=6`;
  - `can_read_support_rest=7`;
  - `can_read_registry_rest=5`;
  - `can_read_crm_rest=1`.
- Verifiche locali OK: PHP lint completo plugin, closure `22/22`, suite local `1688/1688`, audit bottoni/pagine `0` mancanti, program registry `READY`.
- Report:
  - `reports/wordpress/suite_rest_permission_map_latest.json`;
  - `reports/wordpress/skinharmony_site_suite_local_latest.json`;
  - `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_13_LOCAL_2026-05-19.json`;
  - `reports/codex-core/program_registry_check_latest.json`;
  - `reports/codex-core/codex_core_gate_latest.json`.

## Stato Audit Nyra/Core full code Suite + Render 5.3.13
- Audit read-only completato con Core gate `ALLOWED` su:
  - plugin WordPress `wordpress/plugins/skinharmony-site-suite`;
  - Suite Control Plane Render source `/Users/cristiancardarello/skinharmony-ai-backend/services/suite-control-plane`;
  - Smart Desk Render mirror `/Users/cristiancardarello/skinharmony-ai-backend/smartdesk-live`;
  - test Nyra/Core 2.0 e V7 selezionati.
- Suite plugin:
  - runtime live `5.3.13` OK;
  - PHP lint completo OK;
  - test locale Suite OK `1688/1688`;
  - operational closure OK `22/22` + `1688/1688`;
  - registry pagine admin crosscheck OK, `missing_count=0`.
- Suite Control Plane Render:
  - Nyra overlay: `5` file, `33` route, `60` chiamate API, `0` finding;
  - route duplicate: `0`;
  - smoke test OK fuori sandbox.
- Smart Desk Render mirror:
  - Nyra overlay: `105` file, `128` route, `2097` chiamate API, `82` azioni UI, `40` binding;
  - finding totali `95`;
  - high `1`: azione UI generica `Dettagli/Details` con toggle non abbastanza operativo nel bundle `public/assets/index-Bb4ZEGa9.js`.
- Core/Nyra:
  - Core v2 elastic OK;
  - V7 pure OK;
  - branch overlay OK;
  - Codex supervisor OK;
  - `nyra-operational-diagnosis` da riallineare: test attende `blocked`, runtime restituisce `dry_run_only`;
  - `check:nyra:v7-rust` da riallineare: test attende `rust_v7`, runtime restituisce `typescript_fast`.
- Nota audit legacy: `scripts/audit_site_suite_buttons.js` produce falso positivo su 38 pagine mancanti perché non riconosce il registry dinamico; crosscheck dedicato trova `0` pagine mancanti.
- Report principale:
  - `SHARED_MEMORY/reports/SUITE_NYRA_CORE_FULL_CODE_AUDIT_5_3_13_2026-05-31.md`
  - `SHARED_MEMORY/reports/SUITE_NYRA_CORE_FULL_CODE_AUDIT_5_3_13_2026-05-31.json`
- Prossimi fix consigliati:
  - risalire al sorgente React Smart Desk che genera `actionLabel: Dettagli` e renderlo azione/pannello esplicito;
  - decidere via Core se `nyra-operational-diagnosis` deve bloccare o restare `dry_run_only`;
  - verificare env/feature flag del bridge Rust V7;
  - aggiornare lo script legacy `audit_site_suite_buttons.js` per leggere il registry dinamico.

## Stato Suite 5.3.13 live / Render sync riallineato
- Site Suite `5.3.13` è installata e attiva su WordPress live.
- Verifica runtime live OK:
  - manifest `stable_version=5.3.13`;
  - manifest `current_origin_version=5.3.13`;
  - `distribution_ready=true`;
  - `automatic_install_enabled=false`;
  - commerce ready con 3 tecnologie reali (`Skin Pro`, `Termosauna`, `O3 System`);
  - settlements OK;
  - template count `16`.
- Sync remoto Suite Control Plane Render completato dopo Core gate `ALLOWED`:
  - nodo `wp_skinharmony_mother`;
  - tenant `skinharmony-suite`;
  - heartbeat `200`;
  - node snapshot `200`;
  - commerce snapshot `200`;
  - evidence push `5/5`;
  - dashboard remoto `200`.
- Conteggi remoti dopo sync:
  - `heartbeat_count=13`;
  - `snapshot_count=13`;
  - `evidence_count=46`;
  - latest heartbeat plugin version `5.3.13`;
  - control plane `control_plane_ready`;
  - Core remoto `remote_core_ready`;
  - privacy commerce snapshot: `aggregate_only=true`, `raw_customer_records_stored=false`, `personal_data_payload=false`.
- Nota: `marketing_journey_dispatch` resta `404/not_queued`, non bloccante per sync runtime/commerce e non invia campagne.
- Report:
  - `reports/wordpress/suite_runtime_data_check_latest.json`;
  - `reports/wordpress/suite_render_sync_5_3_13_compact_latest.json`;
  - `reports/wordpress/suite_render_sync_5_3_13_latest.json`;
  - `reports/codex-core/codex_core_gate_latest.json`.
- Prossimo passo: continuare la chiusura scala vera partendo da refactor sicuro non-ledger o redesign Order Ledger richiesto da Core prima di toccare il ledger.

## Stato Suite 5.3.13 staged / CRM role checkpoint
- Site Suite `5.3.13` è stata preparata, testata localmente, pacchettizzata e caricata sul server update WordPress, ma non è ancora installata live.
- Stato manifest autenticato/no-cache:
  - `stable_version=5.3.13`
  - `current_origin_version=5.3.12`
  - `package_url=https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.3.13.zip`
  - `automatic_install_enabled=false`
- Contenuto reale della `5.3.13`:
  - checkpoint ruoli CRM B2B: endpoint read CRM separato da `manage_options` tramite capability `shss_crm_read`;
  - matrice ruoli dichiarata nel modulo CRM B2B (`admin_owner`, `agent`, `finance`, `support`);
  - boundary dichiarato: agente può leggere/creare flussi CRM ma non modificare registry prodotti/tecnologie;
  - README e manifest changelog aggiornati.
- Verifiche locali OK:
  - `php -l` su monolite Suite e modulo CRM B2B;
  - `SHSS_EXPECTED_VERSION=5.3.13 node scripts/test_skinharmony_site_suite_plugin.js` -> `1688/1688`;
  - `SHSS_EXPECTED_VERSION=5.3.13 node scripts/suite_operational_closure.js --version=5.3.13` -> preflight `22/22`, local test `1688/1688`, zip generato.
- Core gate:
  - Render sync 5.3.12: `ALLOWED`;
  - release/stage 5.3.13: `ALLOWED`;
  - estrazione CRM Order Ledger dal monolite: `BLOCKED`, motivo `local_hard_gate:ledger`, quindi nessuna logica ledger è stata refactorizzata o riscritta.
- Report:
  - `reports/wordpress/suite_5_3_13_staged_manifest_verify_latest.json`
  - `SHARED_MEMORY/reports/SUITE_CRM_ERP_LITE_EXTRACTION_GATE_5_3_12_2026-05-31.md`
  - `reports/codex-core/codex_core_gate_latest.json`
- Prossimo passo operativo: owner installa manualmente la `5.3.13` su WordPress; dopo installazione verificare live runtime e solo dopo eventuale sync Render `5.3.13`.

## Stato Suite 5.3.12 live / Render sync riallineato
- Site Suite `5.3.12` risulta installata e attiva su WordPress live.
- Manifest update server allineato:
  - `stable_version=5.3.12`
  - `current_origin_version=5.3.12`
  - `package_url=https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.3.12.zip`
  - `distribution_ready=true`
  - `automatic_install_enabled=false`
- Sync remoto Suite Control Plane Render completato dopo Core gate `ALLOWED`:
  - nodo `wp_skinharmony_mother`
  - tenant `skinharmony-suite`
  - heartbeat `200`
  - node snapshot `200`
  - commerce snapshot `200`
  - evidence push `5/5`
  - dashboard remoto `200`
- Conteggi remoti dopo sync:
  - `heartbeat_count=12`
  - `snapshot_count=12`
  - `evidence_count=41`
  - handoff `observable`
- Verifica runtime live OK:
  - commerce ready con 3 tecnologie reali (`Skin Pro`, `Termosauna`, `O3 System`)
  - settlements OK
  - template count `16`
- Report:
  - `reports/wordpress/suite_render_sync_5_3_12_latest.json`
  - `reports/wordpress/suite_runtime_data_check_latest.json`
  - `reports/wordpress/suite_5_3_12_manifest_changelog_alignment_latest.json`
- Nota: `marketing_journey_dispatch` resta `404/not_queued`, non bloccante per sync runtime/commerce e non invia campagne.

Aggiornato: 2026-05-30T21:35:00Z

## Stato Smart Desk Render / AI Gold routing operativo live
- Corretto su Render il bug semantico delle card AI Gold/Core che portavano a Margini anche quando l'azione reale era completare costi servizi/operatori.
- Repo Render: `cardarellocristian86-debug/skinharmony-ai-backend`, root `smartdesk-live`, branch `main`.
- Commit GitHub pushato: `9d98cc3a7f3b6837c313ce5f6f12cc6efdaf6d6e` (`Route AI Gold actions to operative modules`).
- Deploy Render API completato: `dep-d8dl9s8p7ens73bi17i0`, status `live`.
- Fix frontend: `public/assets/gold-bridge.js` ora usa target esplicito e testo operativo della card; costi/prezzi/durata/servizi/operatori -> `/services`, non `/profitability`.
- Fix backend: `DesktopMirrorService.js` espone `target: services` e `targetFocus` per la priorita Gold `completa costi per sbloccare redditivita`.
- Verifica live superadmin/Privilege: `/api/ai-gold/decision-context` restituisce primary action `domain=profitability`, `target=services`, `targetFocus=service-costs`.
- Verifica live support mode `demo_gold_cockpit`: primary action `completa 1 costi servizio e 2 costi orari operatori`, `target=services`, `targetFocus=service-costs`.
- Route statiche live dopo deploy veloci: `/`, `/ai-gold`, `/profitability`, `/marketing` tutte `200` circa `0.23-0.27s`.
- Nyra scan post-fix: `104` file, `128` route, `2011` API calls, `82` UI actions, `40` bindings, high/critical `0`.
- Report: `reports/smartdesk/SMARTDESK_AI_GOLD_LIVE_FULL_AUDIT_ROUTING_FIX_2026-05-30.md`.
- Residui: AI Gold non e ancora pienamente prodotto premium chiuso; Decision Center deve produrre piu azioni confermabili, tenant poveri di dati devono ricevere checklist operativa, support mode deep endpoints da profilare.

Aggiornato: 2026-05-30T20:09:31Z

## Stato Smart Desk Render / wiring fix live
- Correzioni Nyra Smart Desk portate dal mirror locale al repo Render reale `cardarellocristian86-debug/skinharmony-ai-backend`, branch `main`, root `smartdesk-live`.
- Commit GitHub pushato: `0d302424c8f4c86bddb7963989ec3ae48ef7b955` (`Fix Smart Desk preview wiring`).
- Deploy Render triggerato via API e completato: deploy id `dep-d8dk7dek1jcs7393mthg`, status finale `live`, commit `0d302424c8f4c86bddb7963989ec3ae48ef7b955`.
- Verifica live: `/health` risponde `200`; `/web-preview/app.js?v=20260518-preview-shell` contiene il binding `open-settings-section`.
- Snapshot asset preview Render dopo deploy: `actionCount=40`, `bindingCount=40`, `unbound=[]`.
- Report: `reports/smartdesk/SMARTDESK_RENDER_WIRING_DEPLOY_2026-05-30.md`.

Aggiornato: 2026-05-30T19:50:45Z

## Stato Nyra / Smart Desk wiring fix completato
- Fase locale gated completata dopo il deep scan Nyra: Core gate `ALLOWED`, risk `low`, report `reports/codex-core/codex_core_gate_latest.json`.
- Target corretto: `/Users/cristiancardarello/skinharmony-ai-backend/smartdesk-live`; nessun deploy Render, nessuna scrittura produzione/tenant/chiavi/prezzi/clienti.
- Correzioni applicate:
  - adapter backend compatibili per `/api/assistant/brief`, `/api/assistant/query`, `/api/center`, `/api/runtime-meta`, `/api/sales`, `/api/history` e learning endpoints Marketing Autopilot;
  - import locali `scripts/corelia_nyra_dialog_test.js` riallineati a `../src/...`;
  - binding UI `open-settings-section` aggiunto nella preview shell per card/pulsanti che aprono moduli/impostazioni;
  - scanner Nyra esteso a `data-action` vs binding per intercettare card cliccabili non collegate.
- Verifiche OK: `node --check` mirati, `node --check` su tutti i JS mirror esclusi `node_modules/data/public/assets`, `npm --prefix universal-core-2.0 run check:nyra:smartdesk-code-overlay`, scan reale mirror.
- Scan dopo fix: `105` file, `128` route, `2097` chiamate API, `82` azioni UI dichiarate, `40` binding UI, `high_or_above=0`, `missing_route_calls=0`, `missing_imports=0`, `missing_script_refs=0`, `unbound_ui_actions=0`.
- Report: `reports/smartdesk/NYRA_SMARTDESK_WIRING_FIX_2026-05-30.md` e `universal-core-2.0/reports/smartdesk/nyra_smartdesk_code_overlay_after_wiring_fix_2026-05-30.md`.

Aggiornato: 2026-05-30T19:33:28Z

## Stato Nyra / Smart Desk Render error interception finalized
- Il lavoro `codex_nyra_smartdesk_deep_scan` e stato ripreso e chiuso correttamente.
- Core gate locale per finalizzazione: `ALLOWED`, risk `low`, report `reports/codex-core/codex_core_gate_latest.json`.
- Test rerun OK:
  - `npm --prefix universal-core-2.0 run check:nyra:smartdesk-code-overlay`
  - `npm --prefix universal-core-2.0 run check:nyra:codex-supervisor`
  - `npm --prefix universal-core-2.0 run check:nyra:branch-overlay`
  - `npm --prefix universal-core-2.0 run check:nyra:action-router`
  - `npm --prefix universal-core-2.0 run check:nyra:local-governance`
- Scan reale mirror Smart Desk Render rigenerato su `/Users/cristiancardarello/skinharmony-ai-backend/smartdesk-live`: `105` file, `120` route, `2097` chiamate API, `106` findings, `12` high, `render_write_touched=false`.
- `node --check` sui `.js` del mirror, esclusi `node_modules`, `data` e `public/assets`, completato senza errori.
- Checklist task chiusa a `done`; report finale aggiornato con addendum.
- Prossima fase separata gated: correggere gli endpoint frontend/backend mancanti o riallineare la preview shell Smart Desk. Nessuna correzione Smart Desk, deploy Render, chiave, cliente, tenant o prezzo e stata toccata in questa chiusura.

Aggiornato: 2026-05-30T19:01:21Z

## Stato Suite 5.3.7 / Sync Render completato
- Sync remoto Suite Control Plane Render completato dopo Core gate `ALLOWED`:
  - report Core: `reports/codex-core/codex_core_gate_latest.json`
  - report sync: `reports/wordpress/suite_render_sync_5_3_7_latest.json`
  - report verifica: `reports/wordpress/suite_render_sync_5_3_7_verify_latest.json`
- WordPress live ha inviato a Render heartbeat, node snapshot, commerce snapshot aggregato ed evidence push.
- Nodo remoto:
  - `node_id=wp_skinharmony_mother`
  - `tenant_id=skinharmony-suite`
  - `version=5.3.7`
  - stato dashboard remoto `online`
  - handoff remoto `observable`
- Conteggi remoti dopo verifica:
  - `heartbeat_count=11`
  - `snapshot_count=11`
  - `commerce_snapshot_count=4`
  - `evidence_count=36`
- Privacy/governance confermate:
  - `aggregate_only=true`
  - `raw_customer_records_stored=false`
  - `personal_data_payload=false`
  - `execution_allowed=false`
- Nota: `marketing_journey_dispatch` resta `404/not_queued`, già non bloccante per il sync commerce/runtime. Non esegue invii e non cambia campagne.

Aggiornato: 2026-05-30T19:26:00Z

## Stato Nyra / Smart Desk Render code overlay scan
- Aggiunto scanner locale `nyra:smartdesk-code-overlay` in `universal-core-2.0`.
- Perimetro: read-only su mirror Smart Desk/Render, niente chiamate Render live, niente `data/`, niente `node_modules`, niente scritture produzione.
- Scan reale su `/Users/cristiancardarello/skinharmony-ai-backend/smartdesk-live`:
  - file codice letti: `105`
  - byte letti: `17.253.516`
  - route backend definite: `120`
  - riferimenti/chiamate API trovati: `2097`
  - simboli trovati: `9328`
  - high findings dopo normalizzazione: `12`
- Intercettazioni principali: endpoint chiamati ma non definiti (`/api/assistant/query`, `/api/assistant/brief`, `/api/center`, `/api/history`, `/api/runtime-meta`, `/api/sales`, `/api/ai-gold/marketing/autopilot/learning`, `/api/ai-gold/marketing/autopilot/learning/reset`), import rotti in `scripts/corelia_nyra_dialog_test.js`, `23` asset JS pubblici non referenziati dagli HTML.
- Report: `reports/smartdesk/nyra_smartdesk_render_code_overlay_latest.json` e `reports/smartdesk/nyra_smartdesk_render_code_overlay_latest.md`.

## Stato Nyra / test intercettazione bug codice
- Probe locale completato: creato codice volutamente sbagliato in test (`total([1,2,3])` restituisce `3` invece di `6`).
- Il supervisore Nyra ora riconosce segnali di test fallito nei checkpoint/sommari (`FAILED`, `expected/got`, `AssertionError`, `exit code 1`, errori simili).
- Esito atteso validato: per codice difettoso Nyra restituisce `verdict=recover`, flag `test_failure_reported`, target file e `core_required_patch_proposal`; non scrive codice direttamente.
- Regressioni passate su branch overlay, action router, governance locale e supervisor.

## Stato Nyra / ramo programmatore locale
- In `universal-core-2.0` Nyra ora ha un ramo branch overlay esplicito `developer_code`.
- Il ramo si attiva su richieste di codice, debug, bug, patch, test, refactor, TypeScript/JavaScript, funzioni, errori, build/lint e termini da programmatore.
- Il router traduce richieste codice in lavoro locale `dry_run` con Core gate richiesto; Render/produzione/chiavi/clienti/prezzi restano bloccati o richiedono fase separata.
- La guidance Codex ora dice esplicitamente di ragionare da programmatore: leggere file mirati, proporre patch piccola, eseguire test locale prima del checkpoint.
- Nyra non applica codice autonomamente: propone e guida; Codex implementa solo dentro scope e flow Core.

## Stato Suite 5.3.7 live / Final Closure Board chiusa
- Site Suite `5.3.7` risulta installata e attiva su WordPress live.
- Manifest update server allineato:
  - `stable_version=5.3.7`
  - `current_origin_version=5.3.7`
  - `package_url=https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.3.7.zip`
  - `distribution_ready=true`
  - `automatic_install_enabled=false`
- Final Closure Board live verificata:
  - `version=5.3.7`
  - `readiness_score=100`
  - `summary.total=18`
  - `summary.closed=18`
  - `summary.open=0`
  - `managed_pilot_closed=true`
- Il falso warning precedente su snapshot ERP Lite/E2E era dovuto al controllo interno su un nome callback errato; la 5.3.7 usa `rest_crm_erp_lite_snapshot_status`.
- Runtime check autenticato OK: commerce ready con 3 tecnologie reali, settlements OK, template count `16`.
- Pacchetto pubblico verificato:
  - `https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.3.7.zip`
- Stato commerciale/operativo: Suite chiusa come managed pilot; nessuna installazione automatica abilitata.

Aggiornato: 2026-05-30T15:15:00Z

## Stato Suite 5.3.7 staged / Final Closure Board fix
- Preparata localmente Site Suite `5.3.7` come fix piccolo della Final Closure Board.
- Bug corretto: la board cercava `rest_crm_erp_lite_snapshot`, ma il callback reale dell endpoint snapshot e `rest_crm_erp_lite_snapshot_status`.
- Gli endpoint live ERP Lite erano gia funzionanti:
  - `GET /wp-json/shss/v1/waas-manager/crm-erp-lite/snapshot` -> `200`, `ok=true`, `version=5.3.6`
  - `POST /wp-json/shss/v1/waas-manager/crm-erp-lite/e2e-test` -> `200`, `ok=true`, `version=5.3.6`
- Test locali `5.3.7`:
  - PHP lint OK
  - suite plugin `1676/1676`
  - closure preflight `22/22`
- Pacchetto pubblico caricato:
  - `https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.3.7.zip`
  - HEAD `200`, `application/zip`, `837207` bytes.
- Manifest live staged:
  - `stable_version=5.3.7`
  - `current_origin_version=5.3.6`
  - `package_url` 5.3.7
  - `distribution_ready=false` finche owner non installa manualmente lo zip
  - `automatic_install_enabled=false`
- Changelog manifest `5.3.7` corretto: nessuna modifica a dati, endpoint, salvataggi, permessi o automazioni.

Aggiornato: 2026-05-30T14:10:00Z

## Stato Suite 5.3.6 live / manifest chiuso
- Site Suite `5.3.6` risulta installata e attiva su WordPress live.
- Dopo installazione owner, il pacchetto pubblico `5.3.6` mancava all'URL standard e il manifest puntava ancora allo zip `5.3.1`.
- Core gate release fuori sandbox: `ALLOWED`, risk `low`, owner confirmation non richiesta. Report: `reports/codex-core/codex_core_gate_latest.json`.
- Pacchetto caricato via WordPress media:
  - `https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.3.6.zip`
  - HEAD pubblico `200`, `content-type=application/zip`, `content-length=837120`.
- Manifest update server allineato:
  - `stable_version=5.3.6`
  - `current_origin_version=5.3.6`
  - `package_url=https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.3.6.zip`
  - `distribution_ready=true`
  - `automatic_install_enabled=false`
- Changelog manifest corretto per la Final Closure Board 5.3.6.
- Runtime check autenticato OK: commerce `ready` con 3 tecnologie reali (`Skin Pro`, `Termosauna`, `O3 System`), settlements OK, template count `16`.
- Report principali:
  - `reports/wordpress/suite_runtime_data_check_latest.json`
  - `reports/wordpress/suite_5_3_6_package_upload_manifest_alignment_latest.json` contiene un after cache vecchio, ma la verifica successiva nocache/runtime ha confermato manifest pulito.

Aggiornato: 2026-05-30T12:59:00Z

## Stato Nyra / Core 2.0 locale per Codex
- Lavoro locale chiuso in `universal-core-2.0`, senza toccare Core Render o produzione.
- Core 2.0 locale ha selezionato la variante `local_governance_overlay_events` per Nyra/Codex.
- Aggiunti Chat Rich, provider generativo opzionale validato, event emitter locale redatto, branch overlay, Codex guidance e comando `npm run nyra:governance`.
- Aggiornamento 2026-05-31: aggiunta pipeline esplicita `nyra_core2_v1_v2_v7_pipeline_v1` in `tools/nyra-core2-pipeline.ts`, integrata nella governance locale. Core 2.0/V2 resta giudice finale, V1 fa baseline, V7 decide verifica/protezione; Render/deploy/chiavi risultano bloccati in locale.
- Evento runtime locale scritto in `universal-core-2.0/runtime/nyra/events/NYRA_EVENTS.jsonl`.
- Vincolo attivo: Render/produzione restano fuori finche non esiste una fase separata con gate e conferma owner.

## Stato Nyra Needs Cycle locale
- Core 2.0 locale ha selezionato `action_router_private_memory_diagnosis`.
- Aggiunti action router, memoria owner privata locale redatta, diagnosi operativa e pack `nyra_codex_operational_learning_pack_v1.json`.
- La governance locale ora produce anche `action_route`, `owner_private_memory` e `operational_diagnosis`.
- La memoria owner privata vive in `universal-core-2.0/runtime/nyra-owner-private/`, non e sincronizzata e non scrive di default.
- Render/produzione ancora non toccati.

## Stato Suite E2E Visibility Guard 5.3.1
- Site Suite `5.3.1` preparata localmente dopo il blocco Core sulla cancellazione fisica dei record E2E ledger.
- Obiettivo della build: non cancellare i record test, ma escluderli dalle viste operative e dai conteggi commerciali che sporcavano Product Governance Hub, Technology Governance Hub e snapshot commerce.
- Modifiche:
  - `get_product_inventory_status()` ora usa una vista operativa filtrata e aggiunge `summary.e2e_hidden`.
  - `get_technology_inventory_products()` esclude definizioni E2E dalla vista tecnologia/commerciale.
  - `get_crm_erp_lite_snapshot_status()` continua a leggere i dati raw per calcolare `e2e_records_hidden`, ma riporta solo conteggi puliti.
- Nessuna cancellazione fisica, nessun cambio stock, prezzo, pagamento o cliente reale.
- Test locali passati:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
  - `SHSS_EXPECTED_VERSION=5.3.1 node scripts/test_skinharmony_site_suite_plugin.js` (`1633/1633`)
  - `SHSS_EXPECTED_VERSION=5.3.1 node scripts/suite_operational_closure.js --version=5.3.1` (`22/22`)
- Zip locale pronto:
  - `dist/skinharmony-site-suite-5.3.1.zip`
  - `dist/skinharmony-site-suite.zip`
- Core gate precedente per questa modifica: `ALLOWED`, risk `low`, owner confirmation non richiesta. Cleanup fisico resta non eseguito perché Core lo aveva bloccato con `local_hard_gate:ledger`.
- Verifica live dopo installazione owner:
  - plugin WordPress attivo `version=5.3.1`
  - manifest `stable_version=5.3.1`, `current_origin_version=5.3.1`
  - `commerce.summary.products=3`, con sole tecnologie reali `Skin Pro`, `Termosauna`, `O3 System`
  - snapshot CRM ERP Lite `version=5.3.1`, `technologies_master=3`, `products_master=0`, `e2e_records_hidden=10`
  - Product Inventory `summary.total=0`, `summary.e2e_hidden=2`, `items=[]`
  - guardrail invariati: nessuna cattura pagamento, nessuno stock scalato, nessun prezzo WooCommerce pubblicato, owner confirmation per azioni reali
  - residuo risolto: zip pubblico `https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.3.1.zip` caricato e manifest allineato.
  - verifica finale live: `stable_version=5.3.1`, `current_origin_version=5.3.1`, `package_url` 5.3.1, `distribution_ready=true`, `automatic_install_enabled=false`.
  - Core release gate per upload/manifest: `ALLOWED`, risk `low`, owner confirmation non richiesta, report `reports/codex-core/codex_core_gate_latest.json`.

## Stato Suite CRM ERP Lite / Render Snapshot 5.3.0
- Site Suite `5.3.0` preparata localmente e installata live su WordPress.
- Nuovo endpoint WordPress previsto:
  - `GET /wp-json/shss/v1/waas-manager/crm-erp-lite/snapshot`
  - `POST /wp-json/shss/v1/waas-manager/crm-erp-lite/e2e-cleanup`
- Nuovo receiver Suite Control Plane:
  - `POST /api/suite/commerce/snapshot`
- Il commerce snapshot remoto include `crm_erp_lite` aggregato/sanificato: ordini, ricavo netto, margine netto, owner confirmation, Payment Settlements, Value Chain attention, registry prodotti/tecnologie e licenze.
- WordPress resta source of truth per CRM, WooCommerce, Product Governance Hub, Technology Governance Hub, documenti e registri; Render conserva snapshot/readiness e non esegue modifiche.
- Test locali passati: `php -l`, `node --check services/suite-control-plane/src/app.js`, `SHSS_EXPECTED_VERSION=5.3.0 node scripts/test_skinharmony_site_suite_plugin.js`, `SHSS_EXPECTED_VERSION=5.3.0 node scripts/suite_operational_closure.js --version=5.3.0`, smoke storage `commerceSnapshot`.
- Zip locale: `dist/skinharmony-site-suite-5.3.0.zip`.
- Verifica live autenticata: `version=5.3.0`, `stable_version=5.3.0`, `current_origin_version=5.3.0`.
- Manifest live allineato dopo upload controllato: `package_url=https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.3.0.zip`, `distribution_ready=true`, automatic install off.
- Package pubblico verificato: `HTTP 200`, `content-type=application/zip`, `content-length=826454`.
- Remote runtime live configurato: `node_id=wp_skinharmony_mother`, `tenant_id=skinharmony-suite`, `selected_mode=shared_render`, `automatic_remote_execution_enabled=false`.
- Sync Render owner-confirmed completato il 2026-05-29T19:20:40Z:
  - heartbeat `200`
  - node snapshot `200`
  - commerce snapshot `200`
  - evidence push `5/5`
  - commerce snapshot id `commerce_snapshot_40e5bca3-06ba-46c0-ae51-0dd2ad46ccbd`
  - Render receiver version `0.4.5-commerce-snapshot-ready`
- Cleanup reale E2E non eseguito: Core ha bloccato la cancellazione dei record ledger con `local_hard_gate:ledger`. Gli snapshot 5.3.0 li nascondono comunque dalla lettura operativa.

Aggiornato: 2026-05-26T22:52:00+02:00

## Stato Site Suite 5.2.65 / pagina creazione siti
- WordPress live risulta aggiornato a `SkinHarmony Site Suite 5.2.65`.
- Check runtime più recente:
  - `stable_version = 5.2.65`
  - `current_origin_version = 5.2.65`
  - `package_url = https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.2.65-1.zip`
  - `distribution_ready = true`
  - `automatic_install_enabled = false`
- Pagina bozza WordPress creazione siti:
  - `id = 1953`
  - `slug = creazione-siti-skinharmony`
  - `status = draft`
  - link pubblico bozza: `https://www.skinharmony.it/?page_id=1953`
  - edit: `https://www.skinharmony.it/wp-admin/post.php?post=1953&action=edit`
- La pagina non è dentro lo zip/plugin: resta contenuto WordPress in database.
- Il plugin 5.2.65 contiene il renderer/shortcode nuovo:
  - `[sh_site_creation_packages]`
  - funzione `render_site_creation_packages_shortcode`
  - riusa la stessa shell grafica/classi della pagina WaaS reale (`shss-waas-packages`, `shss-waas-package-grid`, `shss-waas-package-card`).
- Bozza 1953 aggiornata a pagina commerciale full-width stile WAAS:
  - sorgente locale: `wordpress/site-creation-sales-page.html`
  - usa blocco `wp:html {"align":"full"}` e shell `.sh-waas-page` full-width
  - copy commerciale premium per vendita siti, con sezioni metodo/benefici/pacchetti/proposta
  - mantiene `[sh_site_creation_packages]` dentro la pagina, quindi prezzi e pacchetti restano dati WordPress/Suite esterni
  - verifica finale: raw contiene shortcode, rendered contiene `shss-waas-package-card`, rendered non mostra shortcode letterale, nessun placeholder `Hero title`/`skinharmony_waas_master`/`CTA principale`
  - stato WordPress: `draft`, modificata `2026-05-26T21:53:33`
  - approvazione owner: layout corretto dopo fix overflow orizzontale; per questa famiglia pagina non usare breakout `100vw/-50vw`, ma contenitore stabile da sinistra verso destra
- Fonte dati listino: WordPress option Suite `site_creation_pricebook`, caricata come dato esterno/persistente, non come default hardcoded del plugin.
- Evento memoria: `suite_site_creation_page_shortcode_clone_waas_verified`.

## Stato template home SkinHarmony approvato
- Home live WordPress `page_id = 32` salvata come master interno Suite.
- Sorgente locale sincronizzata: `wordpress/home-page.html`.
- Registry privato aggiornato: `runtime/private/skinharmony_suite_internal_template_registry_import.json`.
- Template ID: `skinharmony_home_master`.
- Snapshot approvato: `skinharmony_home_master_6c52777ba6b8`.
- Ordine commerciale approvato: `hero -> Smart Desk -> Creazione siti -> WAAS/Partner Network -> Tecnologie -> Filosofia -> SkinHarmony AI -> Perché scegliere -> A chi è dedicata -> Contatto`.
- Pattern WAAS/Partner approvato: `2 colonne larghe + terza card full-width`, non tre colonne strette.
- Report riferimento: `SHARED_MEMORY/reports/SKINHARMONY_HOME_TEMPLATE_APPROVED_SETTINGS_2026-05-27.md`.

## Stato Suite checkout, CRM e assistenza 5.2.52
- Site Suite 5.2.52 e pacchettizzata e caricata su WordPress come update manuale.
- Package pubblico corrente: `https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.2.52-1.zip`.
- Il pacchetto aggiunge:
  - dati fiscali facoltativi in checkout, senza bloccare il pagamento
  - creazione/aggiornamento lead Suite e anagrafica B2B CRM su ordine WooCommerce pagato
  - diagnostica visibile degli invii email Nyra/report/lead in `Automazioni SkinHarmony`
  - link WhatsApp post-pagamento per completare dati fatturazione
- Stato live WordPress: manifest `stable_version=5.2.52`, ma `current_origin_version=5.2.51` e `automatic_install_enabled=false`; serve update manuale per rendere live le funzioni Suite 5.2.52.
- Smart Desk Render live aggiornato con pulsante rapido `Assistenza WhatsApp` nel topbar.
- Commit Render: `b7a7823`; live `/login` serve `index-D6fJRFKI.js` e `index-9-uP_Dg3.css`.
- Report: `SHARED_MEMORY/reports/SUITE_BILLING_CRM_WHATSAPP_5_2_52_2026-05-25.md`.

## Stato Program Registry / memoria programmi
- Creato registro canonico in `SHARED_MEMORY/programs/`.
- Programmi iniziali mappati:
  - `suite`
  - `skinharmony-core`
  - `universal-core`
  - `smartdesk`
  - `core-codex-connector`
- Ogni programma ha:
  - `PROGRAM.md`
  - `ARCHITECTURE.md`
  - `USER_MANUAL.md`
  - `OPERATIONS.md`
- Creato validator `scripts/program_registry_check.js`.
- Il Core Codex Connector ora espone `program-map-check` e `finalize` blocca se vengono dichiarati file di un programma senza aggiornare la sua mappa.
- Regola attiva: non dichiarare completato un lavoro su Suite/Core/traduttore/Smart Desk/connector senza report e mappa programma aggiornata quando cambia comportamento o architettura.

## Stato Core unico template
- Chiuso il primo blocco reale `Single Core Authority` per i template.
- Fonte unica aggiunta:
  - `packages/shared-contracts/template_core_authority_v1.json`
- Sync ufficiale aggiunto:
  - `scripts/sync_template_core_authority.js`
- Copie runtime generate per:
  - `packages/core-codex-connector/config/template-core-authority.json`
  - `wordpress/plugins/skinharmony-site-suite/config/template-core-authority.json`
- Verita fissata:
  - `Suite` e `Codex connector` devono leggere gli stessi vincoli famiglia/template
  - i vincoli `editor-safe`, `block-native`, `full-width`, `sticky-sidebar`, `family-shell-match` non sono piu best-effort
- Report:
  - `SHARED_MEMORY/reports/CORE_SINGLE_AUTHORITY_TEMPLATE_CONSTRAINTS_2026-05-22.md`

## Stato template luxury product
- Salvato dentro `Suite` un nuovo template WaaS nativo:
  - `luxury_product_detail`
- Verita fissata:
  - non e un clone Elena
  - non e una landing
  - e una `product page luxury` con:
    - gallery a sinistra
    - scheda prodotto a destra
    - area acquisto/pagamento sopra i dettagli
- Slot immagini chiusi anche nel preset Suite:
  - `hero_asset_url`
  - `logo_asset_url`
  - `gallery_asset_url`
  - `detail_asset_url`
- Il template vive ora nel plugin, non in una pagina custom fragile.
- Report:
  - `SHARED_MEMORY/reports/SUITE_LUXURY_PRODUCT_TEMPLATE_2026-05-22.md`
  - `SHARED_MEMORY/reports/SUITE_LUXURY_TEMPLATE_IMAGE_SLOTS_AND_REPLICABILITY_2026-05-22.md`

## Stato family luxury site-first
- Avviata la family luxury completa partendo dal sito madre, non dalla singola pagina.
- Nuovo template aggiunto:
  - `luxury_home`
- Verita fissata:
  - prima `home/global shell`
  - poi `collection`
  - poi `product detail`
  - poi `cart`
- Report:
  - `SHARED_MEMORY/reports/SUITE_LUXURY_SITE_ARCHITECTURE_MAP_2026-05-22.md`

## Stato caso Elena 1571
- La bozza WordPress `1571` di Elena e stata riallineata con una shell visiva piu forte.
- Verita registrata:
  - il copy puo salire di livello senza perdere la firma visuale
  - quando il contenuto usa CSS inline non va trattato come `commercial_page_factory`
  - il percorso corretto e `manifest update` coerente, non forzatura del contratto sbagliato
- Esito verificato:
  - preflight governance `allow`
  - update WordPress `HTTP 200`
- File chiave:
  - `wordpress/elena-sartoria-nutriente-page.html`
  - `reports/wordpress/elena-page-1571-visual-refresh-manifest-2026-05-21.json`
  - `SHARED_MEMORY/reports/SUITE_ELENA_VISUAL_REFRESH_1571_2026-05-21.md`
- Ulteriore evoluzione chiusa:
  - la stessa bozza `1571` e stata rifatta ancora con riferimento `La Mer` come grammatica luxury skincare house
  - update WordPress riuscito con preflight `allow`
  - report:
    - `SHARED_MEMORY/reports/SUITE_ELENA_LAMER_REFERENCE_REBUILD_2026-05-21.md`
- Confronto chiuso anche tra `v0 / v1 / v2`:
  - `v0` troppo povera
  - `v1` fallisce sul clone ibrido
  - `v2` e la variante selezionata e pushata su `1571`
  - report:
    - `SHARED_MEMORY/reports/SUITE_ELENA_CORE_V0_V1_V2_COMPARISON_2026-05-21.md`

## Stato pagina focus Suite live
- Creato e pubblicato un nuovo test live non collegato per raccontare Suite con focus corretto:
  - `https://www.skinharmony.it/suite-governance-filiera-beauty/`
- Sorgente locale nuova:
  - `wordpress/suite-governance-filiera-page.html`
- Verita prodotto fissata nella pagina:
  - Suite come control plane della filiera beauty
  - creazione/clonazione nodi in giorni, non mesi
  - gestione siti, e-commerce, lead, CRM, ordini, rete e memoria filiera
  - Universal Core / Nyra / Codex / SkinHarmony Core separati e coerenti
- Pubblicazione verificata via WordPress API:
  - `id = 1544`
  - `status = publish`
  - `slug = suite-governance-filiera-beauty`
- Report dedicato creato:
  - `SHARED_MEMORY/reports/SITE_SUITE_FOCUS_PAGE_TEST_2026-05-20.md`

## Stato workflow INCI -> pagina governata
- Creato handoff operativo che fissa il flusso corretto per:
  - `INCI -> ramo formulazione -> angolo marketing -> copy premium -> claim guard -> clonazione pagina madre -> readiness -> publish`
- Documento creato:
  - `SHARED_MEMORY/handoffs/SUITE_INCI_TO_PAGE_GOVERNED_WORKFLOW_2026-05-20.md`
- Regola nuova fissata anche nel connector:
  - `prima architettura, poi mappa contenuti, poi copy, poi clonazione, poi publish, poi evidenza`
- Verita registrata:
  - Suite deve lavorare sia in manuale sia con CodexAI
  - il sistema non deve promettere `5 minuti` in ogni caso
  - quando mancano prove formulative o basi dati sufficienti, il flusso deve andare in `conservative_mode / review_required`
- Primo blocco reale chiuso nel plugin:
  - `STEP 0 - Intake governato`
  - nuovo intake salvabile dentro `Project Builder WaaS`
  - nuovi stati:
    - `core_ready`
    - `conservative_mode`
    - `review_required`
  - report:
    - `SHARED_MEMORY/reports/SUITE_INCI_PAGE_STEP0_INTAKE_2026-05-20.md`
- Chiusi anche i primi due MVP successivi:
  - `STEP 1 - Formulation Intelligence MVP`
  - `STEP 2 - Marketing Angle MVP`
- Verifica chiave:
  - trovato e corretto bug reale nel ranking attivo guida
  - prima `Niacinamide` vinceva ingiustamente su `Retinolo` solo per posizione INCI
  - ora il motore usa anche `commercial_priority`
- Report:
  - `SHARED_MEMORY/reports/SUITE_INCI_PAGE_STEP1_STEP2_MVP_TEST_2026-05-20.md`
- Chiusa anche l orchestrazione successiva:
  - `STEP 3 - Copy Premium MVP`
  - `STEP 4 - Claim / Localization orchestration`
  - `STEP 5 - Clone readiness`
  - `STEP 6 - Publish readiness`
  - `STEP 7 - Smart Desk signal plan`
- Report:
  - `SHARED_MEMORY/reports/SUITE_INCI_PAGE_STEP3_TO_STEP7_ORCHESTRATION_2026-05-20.md`
- Caso reale verificato:
  - prodotto Elena Sartoria Cosmetica da INCI fotografato
  - il sistema ora legge correttamente il caso come `nourishing_emollient`, non come hero attivo aggressivo
  - report:
    - `SHARED_MEMORY/reports/SUITE_REAL_CASE_ELENA_PRODUCT_2026-05-20.md`
- Caso reale Elena chiuso anche come bozza WordPress:
  - prima bozza rimossa e ricreata da zero
  - nuovo `id = 1547`
  - slug `elena-sartoria-crema-viso-nutriente-antiage-test`
  - report:
    - `SHARED_MEMORY/reports/SUITE_REAL_CASE_ELENA_DRAFT_PAGE_2026-05-20.md`

## Stato studio narrativa prodotto
- Creato studio dedicato su come deve nascere il copy prodotto quando esiste un sito madre:
  - `SHARED_MEMORY/reports/NYRA_CORE_PRODUCT_NARRATIVE_STUDY_2026-05-20.md`
- Creato anche branch spec dedicato per Core 2.0:
  - `SHARED_MEMORY/handoffs/CORE_2_0_PRODUCT_NARRATIVE_BRANCH_SPEC_2026-05-20.md`
- Regola fissata:
  - usare il sito madre come riferimento di tono/struttura
  - non copiare il testo
  - bloccare termini interni non cliente-facing
- Creato anche report dedicato su ripetizioni/anti-copia e distribuzione ruoli:
  - `SHARED_MEMORY/reports/NYRA_CORE_CONNECTOR_ANTI_REPETITION_ANTI_COPY_2026-05-20.md`

## Stato Suite lettura verita attuale
- Creato report madre aggiornato:
  - `SHARED_MEMORY/reports/SITE_SUITE_DETAILED_OPERATING_ARCHITECTURE_2026-05-19.md`
- Registrato anche il tentativo reale di decisione `freeze Suite` via Core 2.0:
  - `SHARED_MEMORY/reports/SITE_SUITE_FREEZE_CORE_2_0_ATTEMPT_2026-05-19.md`
- Aggiunta anche la chiusura iniziale della demo in Control Room:
  - `SHARED_MEMORY/reports/SITE_SUITE_DEMO_CLOSURE_CONTROL_ROOM_2026-05-19.md`
- Verdetto corretto:
  - Site Suite non e una raccolta plugin WordPress e non e ancora una riscrittura completa post-monolite
  - oggi e un `provider operating system` con `WordPress surface + modular framework + legacy monolith + Universal Core locale + control plane bridge`
- Verita sul tentativo Core 2.0:
  - il problema e stato passato bene con `10` varianti coerenti a livello `important`
  - il laboratorio non ha selezionato una variante: risposta reale `401 unauthorized`
  - il fallback `operational_freeze` e del connector, non del Core
  - quindi non va venduto o registrato come decisione ufficiale del Core
- Struttura reale verificata:
  - bootstrap con policy `read_only / no automation by default / owner confirmation`
  - registry moduli che distingue runtime `modular` da `legacy_monolith`
  - snapshot layer uniforme per stato/rischio/completeness/dependency/financial/technical
  - Universal Core locale che produce readiness, risk, confidence, stage, next step e automation level allowed
  - adapter enterprise che unisce pricing, claim, CRM graph e deployment runtime
- Famiglie funzionali verificate:
  - CRM B2B / business graph / node hierarchy
  - commerce policy / sales mode / quote-first
  - value chain pricing
  - claim guard
  - soft licenses / registry / governance
  - payment settlements read-only
  - Smart Desk bridge preview-controlled
  - core connector / suite control plane bridge
  - translation/localization governance con queue payload
  - lead intelligence
  - update server / release governance
  - remote runtime / evidence / journey / change impact
- Verita importante su automazioni:
  - esistono davvero reminder licenze, executive report, translation sync queue, marketing journey dispatch, heartbeat/snapshot/evidence runtime e change impact preparation
  - ma i blocchi sensibili restano per lo piu `preview`, `queue`, `draft`, `owner-confirmed`
  - niente payout/settlement completi automatici, niente sync Smart Desk aggressivo, niente publish incontrollato
- Collegamento corretto con Smart Desk:
  - Suite prepara profili governati, customer intelligence, readiness, warnings e journey approvati
  - Smart Desk non deve ricevere dump grezzi o scritture automatiche non governate
- Collegamento corretto con Render/runtime remoto:
  - Suite ha gia ganci veri per core connector mode, runtime URL, sync remoto, evidence dashboard, journey dispatch e runbook dispatch
  - quindi non e solo sito: e nodo federato del control plane SkinHarmony
- Chiusura reale fatta nel monolite Suite:
  - nuova board `Gestione completa sito SkinHarmony` dentro `Control Room`
  - la board compare sia in `light view` sia in `full view`
  - aggrega sei blocchi chiave per la demo:
    - `Page governance`
    - `Content / claim / translation`
    - `Lead -> CRM -> Journey`
    - `Offerta / preventivo / contratto`
    - `Partner / Fleet / Network`
    - `Smart Desk bridge`
  - aggiunge anche il blocco `Dogfood demo reale`
  - produce KPI alti, tabella stati/evidenze/prossima azione e `Percorso demo da seguire`
  - usa solo funzioni Suite gia esistenti; non inventa stato e non attiva automazioni nuove
  - non riapre route REST dedicate in questa fase: scelta prudente dopo incidente WordPress live
- Chiuso anche il primo blocco concreto della board:
  - `Page governance`
  - aggiunta lettura pagina-per-pagina in `Pagamenti e Contratti WaaS`
  - la lettura mostra:
    - esistenza pagina
    - stato WordPress
    - qualità minima Suite
    - evidenza reale
    - prossima azione
    - link diretto modifica/apertura
  - la stessa verita viene riusata anche nella board demo:
    - `ready_pages / total_pages`
    - `published_pages`
    - `review_pages`
    - `next_action` unificata
  - nessuna route nuova, nessuna automazione, nessuna scrittura su contenuti
- Chiuso anche il secondo blocco concreto della board:
  - `Lead -> CRM -> Journey`
  - aggiunta vista unificata dentro `CRM B2B`
  - la vista fonde:
    - lead già entrati nel CRM
    - readiness del CRM
    - follow-up governati
    - journey approvabili
  - mostra:
    - readiness %
    - lead aperti
    - follow-up
    - journey pronti
    - stato/evidenza/prossima azione per ogni sotto-blocco
  - la board `Gestione completa sito SkinHarmony` ora legge la stessa verità anche per `Lead -> CRM -> Journey`
  - corrette anche due deprecazioni PHP 8.5 sulle callback REST:
    - `can_use_codex_automation_rest(?WP_REST_Request $request = null)`
    - `can_manage_core_connector_rest(?WP_REST_Request $request = null)`
- Chiuso anche il terzo blocco concreto della board:
  - `Offerta / preventivo / contratto`
  - aggiunta vista unificata dentro `Pagamenti e Contratti WaaS`
  - la vista fonde:
    - card pubbliche / vendibilità
    - proposte salvate
    - pagine contratto/condizioni
    - passaggio proposta -> progetto -> attivazione
  - mostra:
    - readiness del percorso
    - card offerta governate
    - numero proposte
    - numero progetti e delivery ready
    - stato/evidenza/prossima azione per ogni sotto-blocco
  - la board `Gestione completa sito SkinHarmony` ora legge la stessa verità anche per `Offerta / preventivo / contratto`
- Chiuso anche il quarto blocco concreto della board:
  - `Content / claim / translation`
  - aggiunta vista unificata dentro `Translation Manager`
  - la vista fonde:
    - translation memory
    - coda brand governance
    - DAM / asset ufficiali
    - Claim Guard
    - Price Guard
  - mostra:
    - readiness del percorso contenuti
    - traduzioni approvate e bozze
    - bozze brand e approvate
    - asset DAM
    - issue claim/prezzi
    - stato/evidenza/prossima azione per ogni sotto-blocco
  - la board `Gestione completa sito SkinHarmony` ora legge la stessa verità anche per `Content / claim / translation`
- Verifica onesta di questa patch:
  - inserimento nel codice verificato
  - slug admin dei link verificati
  - `php` ora disponibile su macchina (`/opt/homebrew/bin/php`)
  - lint reale eseguito:
    - `No syntax errors detected in wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- Incidente WordPress live chiuso:
  - il `500` globale era dovuto a `.htaccess` corrotta sul server Aruba reale
  - il sito e tornato operativo dopo ripristino `.htaccess` minima WordPress
  - `Really Simple Security` e stato disattivato sul live come misura prudente
  - quindi la rottura non era causata dalla patch locale Suite ma da stato hosting-side live

## Stato Smart Desk Render verita attuale
- Per capire Smart Desk Gold oggi non basta leggere la web locale o la preview: la fonte di verita piu aggiornata e `skinharmony-ai-backend/smartdesk-live`.
- Creato report condiviso aggiornato:
  - `SHARED_MEMORY/reports/SMARTDESK_RENDER_GOLD_UNIFIED_ENGINE_ASSESSMENT_2026-05-19.md`
- Creato anche report di verita prodotto/narrativa:
  - `SHARED_MEMORY/reports/SMARTDESK_GOLD_WHY_IT_WORKS_2026-05-19.md`
- Verdetto corretto:
  - su Render esiste gia un asse unificato `business snapshot -> decision context -> Corelia bridge -> progressive intelligence -> oracle/prudential forecast`
  - quindi Gold non e solo insieme di moduli: legge centro, priorita, rischio, redditivita, marketing, customer intelligence e readiness previsionale.
- La previsione finanziaria esiste davvero ma in forma prudenziale e gated:
  - `L5 predictive / oracle-ready`
  - feature `forecast_scenarios`
  - `computeOracleStatus`
  - `computePrudentialForecast`
  - policy esplicita: `nessuna previsione puntuale rigida; solo scenari condizionati e prudenti`
- Quello che manca non e il motore base, ma:
  - report unico persistente nel tempo
  - esposizione piu chiara del forecast quando il centro e eleggibile
  - narrazione unificata UI della crescita centro

## Stato sito
- Pagina WaaS aggiornata con blocchi Core/AI governance, Traduttore e nodo commerciale.
- Fix applicato: il blocco flow sulla pagina WaaS usa griglia responsive e non deve uscire dal contenitore.
- Creata pagina `SkinHarmony Operating Ecosystem` come pagina separata.
- Dopo critica owner, pagina Operating Ecosystem e stata ricostruita clonando il template completo della pagina WaaS.

## Stato Core Traduttore
- Automation API key generata e salvata in path sicuro: `runtime/credentials/skinharmony_core_translator_automation_key.json`.
- Non stampare la chiave in chat o memoria condivisa.
- Claim Guard 3.2.10: correzioni puntuali, dedup claim, varianti italiane naturali.

## Stato Core/Codex
- Connector usa Universal Core gate.
- Owner-confirmed local patch supportata.
- Core va usato come giudice/selettore, non come worker pesante.
- Creata checklist condivisa ecosistema in `SHARED_MEMORY/handoffs/ECOSYSTEM_GAP_CHECKLIST.md` con punti da spuntare alla chiusura.
- Creati `failure read reports` condivisi per ridurre errori inventati e dare una linea unica a tutti i Codex:
  - `SHARED_MEMORY/reports/CORE_2_0_FAILURE_READ_REPORT.md`
  - `SHARED_MEMORY/reports/SMARTDESK_FAILURE_READ_REPORT.md`
  - `SHARED_MEMORY/reports/SITE_SUITE_FAILURE_READ_REPORT.md`
  - `SHARED_MEMORY/reports/WORDPRESS_PLUGIN_RELEASE_FAILURE_READ_REPORT.md`
- Aggiunta anche checklist condivisa di collaudo reale Smart Desk:
  - `SHARED_MEMORY/handoffs/SMARTDESK_FUNCTIONAL_VALIDATION_CHECKLIST.md`
- Aggiunto anche runner tecnico standard di validazione locale:
  - `scripts/run_smartdesk_local_validation.sh`
  - esegue syntax checks chiave, richiama `scripts/smartdesk_preflight_check.js` se sono presenti credenziali test e rimanda poi alla checklist manuale condivisa
- Clonazione locale Core creata per ridurre rigidita senza rischi: `universal-core-frozen` e baseline da non modificare, `universal-core-2.0` e laboratorio modificabile. Nome operativo: Core 2.0. Nessun deploy, nessuna chiave, nessun Render.
- Core 2.0 locale ha ora il contratto sperimentale `decision_contract_v2_elastic`: riduce il blocco eccessivo su modifiche locali/staging owner-confirmed e reversibili, passando da `observe/non eseguire` a `execute_allowed` con note `confirm_then_execute` e `sandbox_first`.
- Core 2.0 mantiene hard block su `cross_tenant`, produzione irreversibile senza rollback/owner, mutazioni admin/secret in produzione e finanza reale senza conferma owner. La finanza paper/sandbox e consentita come `paper_only_allowed`.
- Verifica Core 2.0 locale OK: `npm run check:core:v2-elastic`, `npm run check:core:v1-calibrated`, `npm run check`, `npm run check:nyra:risk-confidence`; API locale testata su porta `3199` in mode `decision_contract_v2_elastic` e poi chiusa.
- Core Codex Connector aggiornato a `0.2.15` per supportare `SH_CORE_LAB_2_0=1`: in lab usa `http://127.0.0.1:3199`, endpoint `/v1/decision`, legge `output` e traduce il payload Codex in contratto Core 2.0 con `metadata`, `constraints` e `signals`.
- Test connettore Core 2.0 OK: `test` raggiunge tenant `codexai`; `gate --owner-confirmed --action-type update` torna `control_level=execute_allowed`; `exec --owner-confirmed --dry-run -- node --check ...` torna `ALLOWED_DRY_RUN`; `cross_tenant` e `delete production` restano `BLOCKED`; `claim_validation` va in `REVIEW_REQUIRED`.
- Creato report condiviso per il prossimo blocco `plugin/connector di localizzazione governata`:
  - `SHARED_MEMORY/reports/CORE_2_0_GOVERNED_LOCALIZATION_MULTIVERSE_2026-05-19.md`
  - linea fissata: Core 2.0 non deve scrivere patch o tradurre direttamente; deve governare rami, scenari, review e audit. Codex orchestra. AI worker esegue patch/traduzione/build. Adapter dominio applica su WordPress, React o altri target.
- Creata anche spec condivisa del primo comando:
  - `SHARED_MEMORY/handoffs/CORE_2_0_LOCALIZE_UI_AUDIT_SPEC_2026-05-19.md`
  - separazione fissata:
    - `Core 2.0 locale` = governo del lavoro Codex/worker
    - `Core Render` = governo ufficiale di plugin, gestionale, Suite, tenant, chiavi e publish/runtime
- MVP reale implementato nel connector:
  - comando: `sh-core-codex localize-ui-audit`
  - file toccati:
    - `packages/core-codex-connector/src/cli.mjs`
    - `packages/core-codex-connector/package.json`
  - comportamento:
    - scan leggero delle stringhe UI/software
    - classificazione `english_residue / mixed_language / protected_term / non_translatable`
    - report JSON/Markdown in `reports/codex-core/`
    - supporto esplicito `SH_CORE_LAB_2_0=1`
    - fallback `OFFLINE_AUDIT` se il laboratorio Core 2.0 o il Core remoto non sono raggiungibili
  - primo run reale su `skin-harmony-web/src/renderer/pages`:
    - prima passata grezza: `finding_count = 1241`
    - seconda passata raffinata con preferenza `.tsx/.ts`, filtro chiavi i18n/classi/path e prime `suggested`:
      - `finding_count = 264`
      - `ui_visible_copy = 237`
      - `brand_protected_terms = 17`
      - `mixed_language_fallback = 10`
    - `winner_family = ui_visible_copy`
    - il report Markdown ora mostra anche suggerimenti italiani per le stringhe note piu ricorrenti
  - limite noto:
    - in questa sessione `127.0.0.1:3199` non era attivo e il Core remoto non era risolvibile, quindi il verdict Core reale non e entrato; il comando ha comunque prodotto audit locale con report utile invece di fallire.
- Secondo MVP implementato:
  - comando: `sh-core-codex localize-ui-fix --from-report ...`
  - modalita: `propose_patch_only`
  - nessuna scrittura sui file
  - output:
    - `reports/codex-core/localize_ui_fix_proposal_latest.json`
    - `reports/codex-core/localize_ui_fix_proposal_latest.md`
  - primo run reale:
    - `candidate_count = 30`
    - `file_count = 7`
    - `review_required = false`
- Terzo passo reale chiuso:
  - `localize-ui-fix --apply` implementato nel connector con modalita `apply_exact_line_replace`
  - genera:
    - `reports/codex-core/localize_ui_fix_apply_latest.json`
    - `reports/codex-core/localize_ui_fix_apply_latest.md`
  - regola:
    - sostituzione esatta sulla riga candidata
    - skip se file/riga/testo non coincidono
    - nessun deploy e nessun build implicito
- Correzione regressione audit chiusa:
  - il filtro finale usava ancora i vecchi `kind` e portava a `0 findings`
  - riallineato ai nuovi output `visible_ui_label / copy_fallback / brand_protected_term`
  - run utile ristabilito:
    - `finding_count = 446`
    - `ui_visible_copy = 237`
    - `brand_protected_terms = 199`
    - `mixed_language_fallback = 10`
- Scelta Core 2.0 locale registrata:
  - verdict laboratorio: `risk.band = low`, `control_level = suggest`, `execution_profile = safe_suggest`
- Connector Codex ora più distribuibile dal repo senza Homebrew:
  - aggiunto script `packages/core-codex-connector/scripts/install-from-repo.sh`
  - il workflow ora:
    - crea il `.tgz` dalla versione corrente del repo
    - installa il connector in una target directory
    - genera i binari locali `sh-core-codex`, `sh-core-run`, `sh-core-shell`, `sh-core-codexai`
  - aggiunti script npm:
    - root repo: `npm run connector:pack`, `npm run connector:install:client`, `npm run connector:test`
    - package connector: `npm --prefix packages/core-codex-connector run pack:local`, `npm --prefix packages/core-codex-connector run install:client`
  - corretto anche il caso cache/log npm in ambienti chiusi usando cache locale temporanea
  - verifica reale completata:
    - `npm --prefix packages/core-codex-connector run pack:local` -> ok
    - `bash packages/core-codex-connector/scripts/install-from-repo.sh /tmp/SkinHarmony_Core_Codex_Connector_Test` -> ok
  - lettura operativa: procedere con apply locale limitato e reversibile, non con deploy o review pesante
- Primo apply reale eseguito:
  - `applied_count = 13`
  - `skipped_count = 7`
  - `changed_file_count = 1`
  - file toccato:
    - `skin-harmony-web/src/renderer/pages/AiGoldPage.tsx`
  - build target:
    - `cd skin-harmony-web && npm run build` -> `ok`
- Report dedicato del run:
  - `SHARED_MEMORY/reports/CORE_2_0_LOCALIZE_UI_APPLY_RUN_2026-05-19.md`
- Pulizia architetturale chiusa:
  - la logica localization e stata estratta da `packages/core-codex-connector/src/cli.mjs` in:
    - `packages/core-codex-connector/src/localization-worker.mjs`
  - il connector passa a `0.2.16`
  - principio fissato: Core 2.0 giudica e seleziona; connector orchestra; worker localization esegue audit/proposal/apply
- Creato anche manuale condiviso del workflow:
  - `SHARED_MEMORY/handoffs/CORE_2_0_LOCALIZATION_WORKFLOW_MANUAL_2026-05-19.md`

## Stato Smart Desk spec
- Salvate in memoria condivisa:
  - `SHARED_MEMORY/handoffs/SMARTDESK_WEB_DESKTOP_ALIGNMENT_SPEC.md`
  - `SHARED_MEMORY/handoffs/SMARTDESK_GOLD_CORE_SPEC.md`
- Aggiunta anche roadmap esecutiva:
  - `SHARED_MEMORY/handoffs/SMARTDESK_WEB_ALIGNMENT_EXECUTION_ROADMAP.md`
- Aggiunta anche mappa architetturale finale della web:
  - `SHARED_MEMORY/handoffs/SMARTDESK_WEB_ARCHITECTURE_MAP_2026-05-18.md`
- Questi file fissano gap veri `desktop -> web` e ruolo corretto di `Gold + Universal Core`.
- Primo avanzamento reale sulla web agenda:
  - drawer con tab `Appuntamento / Cliente / Azioni`
  - feedback immediato su `arrivato / apri cassa / chiuso / non presentato / annullato / sposta / elimina`
  - `Apri cassa` registra ora un incasso minimo via `sales` locale e chiude l appuntamento
  - `Apri scheda` da agenda porta ora a una scheda cliente web minima invece di saltare solo alla lista
  - quick panel slot rafforzato con operatore, carico giornaliero, contesto rapido e scorciatoia `Nuovo cliente`
  - aggiunta `Nota tecnica` minima sull appuntamento tramite update note
  - aggiunta modalita `Full screen` agenda locale con topbar nascosta e focus su `agenda + drawer`
  - file toccati: `smartdesk/public/app.js`, `smartdesk/public/styles.css`
  - verifica minima: `node --check smartdesk/public/app.js`
- Il punto `Allineare davvero Smart Desk web alla desktop` resta aperto: mancano quick panel ricco, cash flow vero, technical sheet, full screen parity e altre viste maggiori.
- Primo avanzamento reale anche su `Client detail parity`:
  - storico appuntamenti cliente
  - ultimi incassi cliente
  - `prossima sessione`
  - `incasso totale`
  - `continuita cliente` da dati reali
  - riquadro `Gold / Core` come lettura di supporto, non come numero inventato
  - `dossier operativo` cliente con consensi, recall, protocollo consigliato, allergie, tier e photo status
  - `azione consigliata Gold` con messaggio copiabile e gating su consenso marketing
  - blocco `prossimo step`
  - scorciatoie `Apri agenda` e `Apri AI Gold`
  - file toccato: `smartdesk/public/app.js`
  - verifica minima: `node --check smartdesk/public/app.js`
- Primo avanzamento reale anche su `Cashdesk parity`:
  - nuova vista `Cassa` nel menu web
  - riepilogo incassi giorno
  - conteggio pagamenti
  - breakdown per metodo
  - verifica minima sedute aperte/chiuse
  - form rapido pagamento
  - storico pagamenti cliente / globale
  - collegamento minimo `pagamento <-> appuntamento` con selezione seduta aperta e chiusura al salvataggio
  - lettura per giorno selezionabile, non piu solo `oggi`
  - `verifica giornata` con stato sintetico, rischio e lista punti da verificare da dati reali
  - `storico pagamenti` con ambito cliente/globale, totale storico e ultimo pagamento
  - lista prudente `sedute chiuse da verificare` senza pagamento evidente nello stesso giorno per il cliente
  - `chiusura giornata` leggibile con stato pronto/non pronto, numero punti aperti e messaggio coerente
  - file toccati: `smartdesk/public/index.html`, `smartdesk/public/app.js`
  - verifica minima: `node --check smartdesk/public/app.js`
  - `Task 03 - Cashdesk parity` considerato chiuso in locale sul perimetro Base/web; la desktop resta piu ricca sul lato contabile avanzato
- Primo avanzamento reale anche su `AI Gold parity`:
  - nuova vista `AI Gold` nella navigazione web
  - stanza operativa separata dalla dashboard
  - priorita primaria e secondarie con apertura modulo coerente
  - `pressioni di oggi` su conferme, cassa e segnali centro
  - `coda marketing da approvare` da clienti con recall e consenso marketing
  - `policy di esecuzione` esplicita: Gold suggerisce e apre flussi, non esegue azioni sensibili
  - il blocco dashboard `Alert prioritari AI` ora apre la stanza Gold vera
  - file toccati: `smartdesk/public/index.html`, `smartdesk/public/app.js`
  - verifica minima: `node --check smartdesk/public/app.js`
  - `Task 04 - AI Gold parity` e `parziale chiuso`
- Primo avanzamento reale anche su `Marketing parity`:
  - nuova vista `Marketing` nella navigazione web
  - bucket recall `Da richiamare / A rischio / Perso / Storico`
  - messaggio suggerito copiabile per cliente
  - blocco su consenso marketing mancante
  - apertura diretta scheda cliente
  - ponte coerente tra marketing manuale e stanza `AI Gold`
  - file toccati: `smartdesk/public/index.html`, `smartdesk/public/app.js`
  - verifica minima: `node --check smartdesk/public/app.js`
  - `Task 05 - Marketing parity` e `parziale chiuso`
- Primo avanzamento reale anche su `Inventory parity`:
  - nuova vista `Magazzino` nella navigazione web
  - overview premium con articoli attivi, sottoscorta, valore costo e valore retail
  - lista `Sottoscorta e priorita`
  - lista `Articoli in stock` con stato reale
  - registrazione movimento stock reale e lettura movimenti recenti
  - dominio inventory del Core/Gold ora apre `Magazzino`
  - file toccati: `smartdesk/public/index.html`, `smartdesk/public/app.js`
  - verifica minima: `node --check smartdesk/public/app.js`
  - `Task 06 - Inventory parity` e `parziale chiuso`
- Primo avanzamento reale anche su `Profitability parity`:
  - nuova vista `Redditivita` nella navigazione web
  - gating coerente col modulo `profitabilityEnabled`
  - range data `da / a` e refresh analisi esplicito
  - overview reale backend con:
    - servizi letti
    - ricavi analizzati
    - costo totale
    - profitto totale
  - sezioni dedicate `Servizi / Prodotti / Tecnologie / Alert automatici`
  - fallback onesto quando l overview non e disponibile: nessun numero inventato
  - file toccati: `smartdesk/public/index.html`, `smartdesk/public/app.js`
  - verifica minima: `node --check smartdesk/public/app.js`
  - `Task 07 - Profitability parity` e `parziale chiuso`
- Primo avanzamento reale anche su `Protocols / Treatments parity`:
  - nuova vista `Protocolli` nella navigazione web
  - gating coerente sui moduli `protocols` e `treatments`
  - stanza locale unica con:
    - perimetro piano
    - stato moduli collegati
    - trattamenti recenti
    - scheda trattamento reale
    - passaggi operativi
  - registrazione trattamento reale via `/api/treatments`
  - aggancio minimo a clienti e `AI Gold`
  - file toccati: `smartdesk/public/index.html`, `smartdesk/public/app.js`
  - verifica minima: `node --check smartdesk/public/app.js`
  - `Task 08 - Protocols / Treatments parity` e `parziale chiuso`
- Primo avanzamento reale anche su `Gating parity`:
  - `runtimeMeta` locale espone ora `subscription.plan`
  - la web usa il criterio `modulo + piano`, non solo `modulo`
  - riallineati i gate minimi per:
    - `profitability`
    - `reports`
    - `treatments`
    - `AI Gold`
  - il piano `Base` non sblocca piu in web viste che in desktop richiedono almeno `Silver`
  - file toccati: `smartdesk/server.js`, `smartdesk/public/app.js`
  - verifica minima: `node --check smartdesk/public/app.js`, `node --check smartdesk/server.js`
  - `Task 09 - Gating parity` e `parziale chiuso`
- Smart Desk live Render aggiornato in modalita prudente:
  - nuova shell web pubblicata come preview isolata
  - route: `https://skinharmony-smartdesk-live.onrender.com/web-preview/`
  - root live attuale non sostituita
  - repo live: `skinharmony-ai-backend`
  - commit live preview: `1696b8a`
  - commit base per rollback semplice: `43ba252`
  - rollback consigliato: revert del solo commit preview se la route non convince
  - verifica minima fatta:
    - `/health` -> `{"ok":true,"service":"skinharmony-smartdesk-live"}`
    - `/web-preview/` -> `HTTP 200` con HTML servito
  - decisione architetturale fissata dopo confronto owner:
    - la grafica live corretta resta la web attuale su Render
    - la shell `preview` non va promossa come UI finale
    - la logica nuova va portata dentro la sorgente React reale della web
  - mappa sorgente fissata in:
    - `SHARED_MEMORY/handoffs/SMARTDESK_LIVE_WEB_SOURCE_MAP.md`
  - sorgente editabile corretta della web live:
    - `skin-harmony-web/src/renderer/*`
  - direzione sbagliata da evitare:
    - modificare `smartdesk-live/public/assets/*` che sono bundle compilati
- Primo innesto reale sulla web React vera `skin-harmony-web`:
  - `DashboardPage.tsx` ora legge anche:
    - `api.aiGold.capabilities()`
    - `api.aiGold.decisionContext()`
  - il blocco priorità/alert AI usa ora anche `primaryAction` e `secondaryActions` del Gold runtime, non solo dashboard stats e data quality
  - `AiGoldPage.tsx` ora carica anche:
    - `capabilities`
    - `decisionContext`
  - `AiGoldPage` usa il layer runtime Gold come fallback per la priorità primaria e mostra un guardrail esplicito sul fatto che Gold prepara il lavoro ma richiede conferma operatore
  - verifica reale eseguita:
    - `cd skin-harmony-web && npm run build` -> OK
- Secondo innesto reale sulla web React vera `skin-harmony-web`:
  - `MarketingPage.tsx` ora legge anche:
    - `api.aiGold.capabilities()`
    - `api.aiGold.decisionContext()`
  - la stanza Marketing Gold mostra:
    - priorità marketing del runtime Gold quando il dominio primario è `growth`
    - guardrail esplicito: prepara messaggi e azioni, ma conferma operatore obbligatoria
    - KPI più aderenti al lavoro reale (`to_approve`, `approved`, `high priority`)
  - verifica reale eseguita:
    - `cd skin-harmony-web && npm run build` -> OK
- Terzo innesto reale sulla web React vera `skin-harmony-web`:
  - `CashdeskPage.tsx` ora legge anche:
    - `api.aiGold.capabilities()`
    - `api.aiGold.decisionContext()`
  - la stanza Cassa mostra:
    - priorità cassa del runtime Gold quando il dominio primario è `cash`
    - guardrail esplicito: Gold suggerisce e legge, ma chiusure e collegamenti restano confermati dall’operatore
    - KPI operativo `Da collegare` più visibile nel piano Gold
  - verifica reale eseguita:
    - `cd skin-harmony-web && npm run build` -> OK
- Primo avanzamento reale anche su `Refactor web architecture`:
  - introdotto pattern di viste separate sotto `smartdesk/public/views/`
  - introdotto anche pattern di `view bindings` separati per i flussi operativi principali
  - introdotto anche un orchestrator dati separato per loader, refresh e fetch policy
  - introdotto anche un secondo modulo `view-bindings` per le viste secondarie
  - introdotto anche un modulo `bootstrap/global.js` per eventi globali e init
  - introdotto anche un modulo `runtime.js` per config e stato iniziale shell
  - introdotto anche un modulo `i18n.js` per dizionario lingua e helper traduzione
  - introdotto anche un modulo `ui-helpers.js` per feedback, format e fetch condivisi
  - introdotto anche un modulo `shell-helpers.js` per nav, gating e blocchi shell
  - introdotto anche un modulo `operations.js` per dialog, save e azioni operative condivise
  - introdotto anche un modulo `domain/smartdesk.js` per helper di dominio clienti/cassa
  - introdotto anche un modulo `domain/normalizers.js` per normalizzazione payload shell
  - trovato e corretto un bug reale del refactor:
    - testa corrotta in `smartdesk/public/app.js`
    - `supportedLanguages` non esportato in `smartdesk/public/i18n.js`
  - estratte dal monolite `app.js` le viste:
    - `Agenda`
    - `Clienti`
    - `Cassa`
    - `Redditivita`
    - `Protocolli`
    - `Marketing`
    - `Magazzino`
  - `app.js` resta orchestratore, ma non contiene piu tutta la resa di queste stanze
  - file nuovi:
    - `smartdesk/public/data-orchestration.js`
    - `smartdesk/public/views/agenda.js`
    - `smartdesk/public/views/clients.js`
    - `smartdesk/public/views/cashdesk.js`
    - `smartdesk/public/views/profitability.js`
    - `smartdesk/public/views/protocols.js`
    - `smartdesk/public/views/marketing.js`
    - `smartdesk/public/views/inventory.js`
    - `smartdesk/public/view-bindings/primary.js`
    - `smartdesk/public/view-bindings/secondary.js`
    - `smartdesk/public/bootstrap/global.js`
    - `smartdesk/public/runtime.js`
    - `smartdesk/public/i18n.js`
    - `smartdesk/public/ui-helpers.js`
    - `smartdesk/public/shell-helpers.js`
    - `smartdesk/public/operations.js`
    - `smartdesk/public/domain/smartdesk.js`
    - `smartdesk/public/domain/normalizers.js`
  - file toccato:
    - `smartdesk/public/app.js`
  - binding operativi spostati fuori da `app.js` per:
    - `Agenda`
    - `Clienti`
    - `Cassa`
    - `AI Gold`
    - `Marketing`
    - `Inventory`
    - `Profitability`
    - `Protocols`
    - `Services`
    - `Reports`
    - `Settings`
  - loader/refresher principali spostati fuori da `app.js`:
    - `loadProfitabilityOverview`
    - `loadTreatments`
    - `loadData`
    - `refreshForUserEvent`
    - `startLazyRefreshLoop`
  - eventi globali e bootstrap spostati fuori da `app.js`:
    - `bindGlobalEvents`
    - `initApp`
  - helper di dominio spostati fuori da `app.js`:
    - `filteredClients`
    - `clientAppointments`
    - `clientPayments`
    - `clientContinuityStatus`
    - `methodLabel`
    - `activeCashdeskPayments`
    - `cashdeskOpenAppointments`
    - `cashdeskClosedSessionsToVerify`
    - `cashdeskHistorySummary`
    - `cashdeskDailyCheck`
    - `clientGoldAction`
  - config e stato iniziale spostati fuori da `app.js`:
    - `resolveApiServerUrl`
    - `LAZY_REFRESH_MS`
    - `REFRESH_POLICY`
    - `createInitialState`
  - i18n spostato fuori da `app.js`:
    - `supportedLanguages`
    - `translations`
    - `createI18n`
  - helper UI condivisi spostati fuori da `app.js`:
    - `showFeedback`
    - `euro`
    - `euroFromCents`
    - `escapeHtml`
    - `safeJsonFetch`
  - shell logic spostata fuori da `app.js`:
    - `currentPlanId`
    - `activeNavClass`
    - `syncTopbar`
    - `moduleEnabled`
    - `canUseAiGold`
    - `renderEnterpriseBanner`
    - `renderModuleStateCard`
    - `renderLockedModule`
    - `renderPeriodFilters`
    - `kpiCards`
    - `riskBandLabel`
  - flow operativi condivisi spostati fuori da `app.js`:
    - `openClientDialog`
    - `openServiceDialog`
    - `openStaffDialog`
    - `openAppointmentDialog`
    - `openCenterDialog`
    - `submitEntity`
    - `deleteAppointment`
    - `saveCashdeskPayment`
    - `copyClientMessageToClipboard`
  - normalizer spostati fuori da `app.js`:
    - `normalizeClient`
    - `normalizeAppointment`
    - `normalizeService`
    - `normalizeStaff`
    - `normalizeInventoryItem`
    - `normalizeInventoryMovement`
    - `normalizeProfitabilityOverview`
    - `normalizeTreatment`
  - stato attuale del task:
    - `quasi chiuso strutturalmente`
    - resta aperta solo prova funzionale reale fuori sandbox e il residuo `state/helper shared` nel file principale
  - verifica minima:
    - `node --check smartdesk/public/app.js`
    - `node --check smartdesk/public/bootstrap/global.js`
    - `node --check smartdesk/public/data-orchestration.js`
    - `node --check smartdesk/public/runtime.js`
    - `node --check smartdesk/public/i18n.js`
    - `node --check smartdesk/public/ui-helpers.js`
    - `node --check smartdesk/public/shell-helpers.js`
    - `node --check smartdesk/public/operations.js`
    - `node --check smartdesk/public/domain/smartdesk.js`
    - `node --check smartdesk/public/domain/normalizers.js`
    - `node --check smartdesk/public/view-bindings/primary.js`
    - `node --check smartdesk/public/view-bindings/secondary.js`
    - `node --check smartdesk/public/views/agenda.js`
- Primo tentativo di smoke tecnico locale dopo il refactor:
  - server locale `smartdesk/server.js` avviato correttamente e banner loggato
  - connessione a `127.0.0.1:3010` bloccata dal sandbox di questa shell con errore:
    - `Immediate connect fail for 127.0.0.1: Operation not permitted`
  - quindi lo smoke HTTP locale non e validabile in questa sessione, ma il blocco e ambientale, non applicativo
    - `node --check smartdesk/public/views/clients.js`
    - `node --check smartdesk/public/views/cashdesk.js`
    - `node --check smartdesk/public/views/profitability.js`
    - `node --check smartdesk/public/views/protocols.js`
    - `node --check smartdesk/public/views/marketing.js`
    - `node --check smartdesk/public/views/inventory.js`
  - `Task 10 - Refactor web architecture` e `quasi chiuso strutturalmente`
  - `app.js` ridotto a `1479` righe dopo estrazione di runtime, i18n, helper UI, shell logic, operations e normalizer; restano stato globale, qualche helper residuo e la prova funzionale reale fuori sandbox

## Stato Site Suite
- Site Suite live attiva su `https://www.skinharmony.it` e `5.2.49`; REST plugin check 2026-05-25 mostra plugin attivo versione `5.2.49`.
- Site Suite `5.2.50` e pronta per installazione manuale: manifest update cache-busted mostra `stable_version=5.2.50`, `current_origin_version=5.2.49`, package `https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.2.50.zip`, `package_url_matches_version=true`, `automatic_install_enabled=false`, `distribution_ready=false` finche la versione attiva non viene aggiornata manualmente.
- Site Suite `5.2.50` corregge checkout dominio: il campo dominio resta obbligatorio solo per prodotti WaaS/sito/licenza dominio; per Smart Desk e facoltativo e non blocca piu il pagamento.
- Site Suite `5.2.49` aggiunge Web Analytics proprietaria privacy-safe: eventi aggregati `page_view`, `cta_click`, `form_submit`, `engaged_visit`, sessione anonima hashata per giorno, target CTA, engagement e payload `web_analytics_intelligence` con branch Core `web_analytics_intelligence_v1` e studio Nyra `nyra_web_behavior_reading_v1`.
- Site Suite `5.2.48` sposta `Google Funnel Intelligence` dentro `Analytics WaaS`: grafici funnel, campagne per costo, pagine sito, sorgenti traffico, diagnosi e prossime azioni. Il pannello Core Connector / Google Connector resta per configurazione OAuth, account Ads/GA4, stato provider e link `Apri Funnel Analytics`.
- Suite Control Plane Render espone live `GET /api/suite/integrations/google/funnel/overview`: legge Google Ads + GA4 in sola lettura per tenant `skinharmony-suite`, normalizza dati per grafici e restituisce diagnosi operativa senza modificare campagne, budget o keyword.
- Google tenant live collegato: Ads customer `7725619801`, GA4 property `properties/530089473`. Capability: `can_read_google_ads=true`, `can_read_ga4=true`, `can_change_campaigns=false`, `can_change_budget=false`.
- Lettura funnel reale ultimi 30 giorni verificata il 2026-05-25: Ads `3577` impressioni, `63` clic, `108.85` costo, `0` conversioni; GA4 `433` sessioni, `225` utenti, `889` page view, `1960` eventi. Diagnosi corrente: `needs_attention` per click presenti ma conversioni Ads assenti.
- `Template Clone Validation` ora espone controlli leggibili con messaggio, evidenza richiesta e prossima azione.
- `Shared Memory / Control Plane 5.1.71` e `Page Quality Audit 5.1.71` sono stati preservati e allineati nella release `5.1.73`.
- La validazione non deve considerare una pagina/nodo pronto per demo cliente finche manca prova visuale responsive: desktop 1440, tablet 768, mobile 390, niente overflow testo/card, CTA visibili e colori brand rispettati.
- Zip locali generati: `dist/skinharmony-site-suite.zip`, `dist/skinharmony-site-suite-5.1.72.zip` e `dist/skinharmony-site-suite-5.1.73.zip`.
- Test locale `scripts/test_skinharmony_site_suite_plugin.js` OK con expected version `5.1.73`.
- Upload live `5.1.72` verificato via REST: WordPress vede Site Suite `5.1.72`, plugin attivo, status OK, Smart Desk Bridge `manual_sync_ready`.
- Manifest update live riallineato a `skinharmony-site-suite-5.1.72.zip`; pagine pubbliche Home, Software SkinHarmony, AI Gold, Contatti e Vetrina digitale passano il test pubblico con blocchi Suite attesi.
- Release locale `5.1.73` corregge il calcolo onboarding del modulo `waas-engine`, che usava ancora campi legacy e poteva mostrare WaaS readiness 86 anche con onboarding reale 100.
- Le pagine admin WordPress richiedono sessione cookie browser: Application Password verifica REST/plugin, ma non apre wp-admin visuale.
- Durante il gate di questa patch Universal Core su Render non era risolvibile via DNS; quindi la modifica e locale, non validata da Core remoto.
- La Suite ora espone anche `Shared Memory / Handoff` read-only e rafforza il linguaggio `control plane` in Control Room/Core Connector.

## Stato Smart Desk live web source
- La sorgente corretta della web live resta `skin-harmony-web/src/renderer/*`; non lavorare sui bundle compilati di `smartdesk-live/public/assets/*`.
- Innesti Gold/Core gia fatti sulla web React vera:
  - `DashboardPage.tsx`: legge `api.aiGold.capabilities()` e `api.aiGold.decisionContext()` per priorita e segnali ufficiali.
  - `AiGoldPage.tsx`: legge `capabilities + decisionContext`, usa priorita runtime e mostra guardrail esplicito.
  - `MarketingPage.tsx`: legge il runtime Gold ufficiale per priorita marketing, KPI recall e guardrail.
  - `CashdeskPage.tsx`: legge il runtime Gold ufficiale per priorita cassa, guardrail e pagamenti da collegare.
  - `ClientDetailPage.tsx`: ora legge il runtime Gold ufficiale e aggiunge continuita cliente, blocco `Gold / Core`, recall guidato con gating sul consenso marketing e CTA operative coerenti.
  - `ClientDetailPage.tsx`: ora include anche `Profilazione Gold` con valore cliente, maturita profilo, recuperabilita e scenario operativo, tutti derivati da storico reale, continuita, spesa, consensi e priorita Gold correnti.
  - `ClientsPage.tsx`: aggiunta lettura compatta profilo in lista (`continuita` + `scenario`) senza inventare campi non presenti nel dataset summary.
  - `AppointmentsPage.tsx`: il drawer cliente in agenda ora include una card `Profilazione Gold` coerente con la scheda cliente, basata su storico reale, ticket medio, consensi e stato continuita.
  - `MarketingPage.tsx`: Gold ora ordina stabilmente le azioni per priorita/stato/valore, mostra segmenti principali attivi e rende piu leggibili scenario e valore operativo per ogni azione.
  - push live repo eseguito anche per il rafforzamento UI `Marketing Gold`: commit `987cc50` (`Deploy Smart Desk Marketing Gold UI`)
  - root Render conferma `HTTP 200`; `last-modified` aggiornato durante il check, segnale di propagazione bundle piu avanzata
  - push live repo eseguito anche per questa coerenza `lista + drawer agenda`: commit `928b953` (`Deploy Smart Desk Gold client profile consistency`)
  - root Render conferma `HTTP 200`; al check immediato l'header `last-modified` e ancora leggermente indietro, quindi possibile propagazione bundle ancora in corso
  - push live repo eseguito anche per questa card Profilazione Gold: commit `6d73dcf` (`Deploy Smart Desk client Gold profiling`)
  - root Render conferma `HTTP 200`; header `last-modified` ancora leggermente indietro al momento del check, quindi possibile propagazione ancora in corso
  - `ProfitabilityPage.tsx`: ora legge `api.aiGold.capabilities()` e `api.aiGold.decisionContext({ startDate, endDate })`, mostra priorita margini ufficiale, rischio/guardrail Gold e CTA coerenti verso il dominio giusto.
  - `ProtocolsPage.tsx`: ora legge `api.aiGold.capabilities()` e `api.aiGold.decisionContext()`, mostra priorita protocolli ufficiale, guardrail Gold e CTA coerenti senza cambiare il flusso UI esistente.
- Pulizia lingua italiana web React avviata e verificata:
  - prima passata completata su `ClientDetailPage.tsx`, `AppointmentsPage.tsx`, `FleetIntelligencePage.tsx`, `SettingsPage.tsx`, `InventoryPage.tsx`
  - seconda passata completata su `ShiftsPage.tsx`, `GoldOnboardingPage.tsx` e ulteriori etichette visibili di `FleetIntelligencePage.tsx`
  - build locale aggiornata dopo pulizia: `cd skin-harmony-web && npm run build` -> `ok`
  - warning residui non bloccanti: `gold-bridge.js` senza `type="module"` e chunk `index` oltre `500 kB`
  - deploy GitHub preparato e pushato nel repo live `skinharmony-ai-backend` con commit `d801221` (`Deploy Smart Desk web Italian cleanup and Gold wiring`)
  - root Render risponde `HTTP 200`; check HTML bundle non affidabile via curl in questa shell, ma `last-modified` del root online risulta aggiornato durante il deploy
- Verifica build locale web React:
  - `cd skin-harmony-web && npm run build` -> `ok`
  - warning non bloccanti: `gold-bridge.js` senza `type="module"` e chunk `index` oltre `500 kB`
- `2026-05-19` `www.skinharmony.it` ripristinato dopo `500` globale. Causa reale: `.htaccess` live corrotto su Aruba. Fix applicato via FTP con versione minima WordPress pulita. Verifica post-fix: `/`, `/wp-json/`, `/wp-login.php`, `/robots.txt` tutti `200`.
- `2026-05-19` Diagnosi live completata: plugin attivi rilevanti su rewrite/cache erano `Really Simple Security`, `LiteSpeed Cache`, `Aruba HiSpeed Cache`. `Really Simple Security` disattivato sul live come misura di stabilizzazione per evitare nuova corruzione `.htaccess`.
- `2026-05-20` In Site Suite e stato chiuso anche il blocco `Partner / Fleet / Network` della demo closure. Nuovo helper unico `get_suite_partner_fleet_network_status`, riuso nella vista `SkinHarmony Core Connector` e nella board `Gestione completa sito SkinHarmony`. Lint reale: `/opt/homebrew/bin/php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php` -> `No syntax errors detected`.
- `2026-05-20` In Site Suite e stato chiuso anche il blocco `Smart Desk bridge` della demo closure. Nuovo helper unico `get_suite_smartdesk_bridge_demo_status`, riuso nella pagina `Smart Desk Bridge WaaS` e nella board `Gestione completa sito SkinHarmony`. Lint reale: `/opt/homebrew/bin/php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php` -> `No syntax errors detected`.
- `2026-05-20` In Site Suite e stato aggiunto anche il `Percorso demo ufficiale` dentro la board `Gestione completa sito SkinHarmony`, tramite helper `get_suite_site_demo_path_status`. Lo scopo e rendere la demo ripetibile e vendibile senza creare nuova logica o nuove route. Lint reale: `/opt/homebrew/bin/php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php` -> `No syntax errors detected`.
- `2026-05-20` Chiusa prova end-to-end reale di Suite sul nodo WordPress live `www.skinharmony.it`: health rapido `ok`, Project Builder live `ok`, Trial Bridge live `ok` dopo fix minimo del blocco trial sulla pagina `841` (`ai-gold-smart-desk`). Evidenza salvata in `SHARED_MEMORY/reports/SITE_SUITE_DEMO_E2E_EVIDENCE_2026-05-20.md` e nei report `reports/wordpress/`.
- `2026-05-20` Rifinita la draft WordPress del caso reale Elena `1547` con copy piu vicino al brand madre, meno ripetizioni e nessun linguaggio interno cliente-facing. Update eseguito via manifest `reports/wordpress/elena-page-1547-copy-update-manifest-2026-05-20.json`; preflight governance `allow`; WordPress REST `200`.
- `2026-05-20` La draft WordPress temporanea del caso Elena `1547` e stata eliminata dal live (`HTTP 200`) per non lasciare una demo parziale o fuorviante. Salvata architettura corretta del clone engine in `SHARED_MEMORY/reports/SUITE_SITE_CLONE_ENGINE_ARCHITECTURE_2026-05-20.md`.
- `2026-05-20` In Site Suite e stata chiusa anche la fondazione locale del `Site Clone Engine` dentro `Project Builder WaaS`: nuovo intake governato, scenario clone, template suggerito, ruolo separato tra Suite/Core/Nyra/SkinHarmony Core/Codex e salvataggio dedicato `shss_site_clone_intakes`. Lint reale: `/opt/homebrew/bin/php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php` -> `No syntax errors detected`.
- `2026-05-20` Rafforzata la fondazione `Site Clone Engine` con `component registry` e `template adaptation plan` per ogni intake clone: Suite ora definisce componenti consentiti, preset design, blocchi fissi e slot editabili prima della build. Lint reale confermato pulito.
- `2026-05-20` Eseguita lettura reale del sito madre Elena con nuovo `generic site blueprint` invece del vecchio estrattore solo SkinHarmony. Esito: Elena parla come brand visuale/shop/catalogo con molte immagini e CTA `SHOP / Scopri di più / Entra nello shop`; la bozza precedente falliva soprattutto per grammatica visiva e logica retail, non solo per il copy.
- `2026-05-20` Eseguito anche test di sola creazione pagina locale Elena in modalita `retail/shop clone`: nuovo file `wordpress/elena-sartoria-retail-clone-page.html` costruito in `124 secondi`. Evidenza blueprint: immagini passate da `1` a `4` e CTA condivise col sito madre salite a `5`.
- `2026-05-20` Universal Core interrogato davvero sul modello orizzontale del `Site Clone Engine`. Esito `ALLOWED`, variante vincente `retail_balanced`: `retail_premium + science low + sales guided + premium_grammar_polish`. Il clone engine locale ora usa questa lane come default governato, lasciando comunque al tecnico la possibilita di cambiare pack in modo esplicito e auditabile.
- `2026-05-20` Ripetuto il test di sola creazione pagina locale Elena dopo cancellazione del file precedente e ricreazione da zero. Tempo reale del secondo passaggio: `113 secondi` (`1m 53s`). Copy meno tecnico, piu coerente con `retail_balanced`, con struttura shop/visual mantenuta.
- `2026-05-20` Trasformato il file locale Elena in una `draft WordPress` reale. Pagina creata: `1552`, stato `draft`, URL `https://www.skinharmony.it/?page_id=1552`. Tempo del solo passaggio `file pronto -> draft WordPress`: `1 secondo`.
- `2026-05-20` Il `Site Clone Engine` ora puo generare anche un `output preview` interno senza toccare il live. Aggiunti pulsante, option locale preview e rendering della preview nella tabella intake. Corretto anche il bug di persistenza dei campi `brand/science/sales/language guard`.
- `2026-05-20` Il `Site Clone Engine` arriva ora fino alla `draft WordPress` direttamente dentro Suite: dopo la preview compare il pulsante `Crea draft WordPress`, che crea o aggiorna solo una bozza e salva l ID nella preview del clone.
- `2026-05-20` Dentro il `Site Clone Engine` sono ora visibili anche i tempi del flusso: `tempo preview` e `tempo draft` vengono salvati nella preview del clone e mostrati in tabella.
- `2026-05-20` Preparato anche il pacchetto plugin per test reale nel pannello WordPress: `reports/wordpress/releases/skinharmony-site-suite-5.1.82-clone-engine-preview-draft.zip`.
- 2026-05-20: `SkinHarmony Site Suite` bumpata a `5.1.83` per forzare il caricamento certo del blocco admin `Site Clone Engine`; nuovo zip release creato e verificato.
- 2026-05-20: test reale completato nel backend `Site Clone Engine`: preview generata in `3 ms`, draft WordPress `#1555` creata in `97 ms`, link bozza visibile nel pannello.
- 2026-05-20: migliorato il generatore preview del `Site Clone Engine` con struttura retail/showroom meno generica e copy meno tecnico; release locale `5.1.84` pronta.
- 2026-05-21: corretto il naming generato del `Site Clone Engine`; preview e draft non devono più partire da titoli demo interni come `Clone demo 1`. Release `5.1.85` pronta.
- 2026-05-21: corretto il titolo clone anche sul fallback host: se `source_site_url` non basta, il `Site Clone Engine` usa ora anche `source_page_url`. Release `5.1.86` pronta.
- 2026-05-21: aggiunto guardrail visibile nel `Site Clone Engine`: intake con URL non valide mostrano `Sito/Pagina: check` e non possono generare preview. Release `5.1.87` pronta.
- 2026-05-21: il `Site Clone Engine` classifica ora i casi per `Famiglia prodotto`, `Tipo sorgente` e `Modalità operatore`, separando beauty formula, device, retail esterno e service/protocol.
- 2026-05-21: primo test reale `technology/device` completato con `Skin Pro`; nuova draft WordPress `#1561` creata da file locale con asset già presenti nel sito.
- 2026-05-21: la draft `Skin Pro` `#1561` è stata aggiornata con shell visiva `WaaS` come pagina madre. Push WordPress riuscito con `governance_preflight = allow`, mantenendo stato `draft`.
- 2026-05-21: il `Site Clone Engine` legge ora anche tier brand, positioning mode, competitor research mode, competitor cluster, mother-site imprint e scheda tecnica/ancora tecnica. Aggiunti i rami derivati `market_research_plan`, `mother_site_imprint_plan` e `technology_device_plan` senza toccare la logica madre del Core.
- 2026-05-21: preparata anche la release `SkinHarmony Site Suite 5.1.89` con i nuovi rami di market/positioning orchestration del `Site Clone Engine`. Zip corto e release descrittiva pronti e verificati.
- 2026-05-21: avviato anche il secondo test `technology/device` su tecnologia SkinHarmony `O3 System`, usando solo shell grafica approvata `WaaS`. Creata nuova draft WordPress separata `#1565`.
- 2026-05-21: creato anche il test `Termosauna` come nuova tecnologia SkinHarmony con shell grafica `WaaS` e nuova draft WordPress separata `#1566`.
- 2026-05-21: fissata come guardrail Core 2.0 la regola `WordPress Draft Verification`: una draft non è chiusa solo con `id/status/link`, ma richiede sempre anche verifica autenticata del `post_content` prima della review visiva.
- 2026-05-21: pubblicata la nuova `O3 System` sulla pagina live esistente `573` (`/o3-system/`) con shell `WaaS` aggiornata e logica vendita WooCommerce ufficiale reinserita. Verificati `add-to-cart=969` e `add-to-cart=982` con `HTTP 200`; publish eseguito con manifest governato dedicato e preflight `allow`.
- 2026-05-21: pubblicata la nuova `Termosauna` sulla pagina live esistente `1011` (`/termosauna/`) con shell `WaaS` aggiornata e logica vendita WooCommerce ufficiale reinserita. Verificati `add-to-cart=968` e `add-to-cart=981` con `HTTP 200`; publish eseguito con manifest governato dedicato e preflight `allow`.
- 2026-05-21: fissata anche la regola architetturale sul linguaggio cliente-facing: la policy deve vivere nel ramo marketing di Universal Core, il translator/language core deve riscrivere e correggere, il connector deve imporre blocklist e verdict finale, Suite deve mostrare stato e bloccare il publish quando il linguaggio pubblico non e pulito.
- 2026-05-21: implementata davvero la `Client Facing Language Policy`: nuovo comando connector `client-facing-check`, nuovo stato `Public language` nel `Site Clone Engine`, pulizia reale delle pagine `O3 System` e `Termosauna`, poi refresh live con preflight `allow`.
- 2026-05-21: chiusa anche la ricerca su humanizzazione dei testi AI e preparato un set di varianti per il Core. Il tentativo di decisione `important` via connector e fallito per `core_unreachable`, quindi resta come strada provvisoria consigliata la variante `G`: policy Core + semantic premium validator + translator rewrite + connector enforcement + Suite gate.
- 2026-05-21: implementato in locale anche il primo `semantic premium validator`. O3 System e Termosauna non vengono piu segnalate per lessico interno, ma risultano ancora `rewrite_required` per `high_repetition_pressure`. Il problema residuo e quindi stilistico, non piu solo lessicale.
- 2026-05-21: il connector Codex e stato riallineato a `Core 2.0 local-first`: setup, profilo e path decisionale non devono piu trattare Render/Core come default quotidiano. Per Codex il motore giornaliero e il Core 2.0 locale; Render/Core resta layer piattaforma/remoto esplicito.
- 2026-05-21: aggiunto nel connector anche il primo `boundary enforcer` automatico basato su scope di sessione + ownership matrix. Test reale passato: sessione `connector/core`, tentativo di toccare `Suite`, esito `OUT_OF_SCOPE` prima di qualsiasi write.
- 2026-05-21: il ramo `technology/device` del `Site Clone Engine` e stato reso piu maturo: aggiunti campi device-specific (nome, categoria, area, uso, prova, esperienza cliente, valore operatore) e un `technology_device_plan` piu concreto con guida diversa per institutional/center_conversion/distributor.
- 2026-05-21: chiusa anche la differenza nativa di posizionamento nel ramo tecnologia del `Site Clone Engine`: `institutional`, `center_conversion`, `distributor_sell_in` e `retail_conversion` ora cambiano davvero headline, CTA, blocchi e tono del preview.
- 2026-05-21: rifatto da zero anche il caso beauty `Elena Sartoria Cosmetica` con ramo formula piu maturo. Creata nuova pagina locale e nuova draft WordPress `1571`, senza riusare la bozza vecchia come base.
- 2026-05-21: recuperata anche la bozza Elena `1571` dopo il nuovo errore di shell mista/strozzata. Rimossa la shell custom `elv2-*` e riportata la pagina sulla struttura approvata `sh-waas-*`, con push WordPress riuscito e accenti italiani ripristinati.
- 2026-05-22: chiuso il primo `Visual Clone Build Contract` nel connector e riallineato anche il `Site Clone Engine` con campi layout/host/shell. Il caso Elena `1571` ora passa sia il controllo linguistico sia il nuovo controllo visuale, e solo dopo è stato ripushato su WordPress.
- 2026-05-22: chiusa anche la prima `luxury home family` del clone site-first. Il connector ora riconosce la shell approvata `lmh-home`, valida la `luxury_home_page` e la release Site Suite `5.1.90` e pronta per portare il template davvero nel backend live.
- 2026-05-22: collegata davvero la demo `luxury_home` alla `luxury_product_detail`. In Suite il design preset ora supporta anche URL di collegamento reali (`primary_cta_url`, `secondary_cta_url`, `collection_target_url`), cosi la famiglia template resta nativa del prodotto Suite e non solo della demo WordPress attuale.
- 2026-05-22: fissata anche la direzione architetturale `Suite beyond WordPress`. WordPress resta output/demo e canale di pubblicazione, ma la fonte prodotto futura deve essere una piattaforma proprietaria `Suite Platform / Commerce OS` con output multipli e controllo centrale fuori dal plugin.
- 2026-05-22: estesa la famiglia luxury nativa di Suite con `luxury_collection` e `luxury_cart`. I preset `Template WaaS` ora supportano anche `product_target_url` e `cart_target_url`, e il connector valida anche `luxury_collection_page` e `luxury_cart_page`.
- 2026-05-22: collegata anche la demo WordPress della famiglia luxury su quattro pagine reali: `1581 home`, `1585 collection`, `1580 product`, `1586 cart`. Il percorso demo ora e `home -> collection -> product -> cart`.
- 2026-05-22: `Template WaaS` non e piu solo una libreria statica. Le card template ora possono aprire direttamente la pagina WordPress modificabile; se la bozza non esiste, la creano e poi fanno redirect all editor.
- 2026-05-22: la bozza `1592` del `fluido di ricostruzione molecolare leave-in` e stata riallineata da variante `Elena` a variante `SkinHarmony`. Ora usa shell narrativa `sh-waas`, tono premium haircare piu coerente con l ecosistema SkinHarmony e push WordPress riuscito con nuovo manifest dedicato.
- 2026-05-22: la stessa bozza `1592` e stata poi rifatta usando `www.nika.it` come madre di riferimento. La pagina ora segue una grammatica product-page haircare piu e-commerce e meno SkinHarmony, con push WordPress riuscito e check linguistico pulito.
- 2026-05-22: creato anche il template nativo `nika_haircare_product` dentro `Template WaaS`. Nika non deve piu passare dalla famiglia `La Mer`: ha ora un manifest, un profilo design e un renderer separati in Suite.
- 2026-05-22: preparata anche la release `SkinHarmony Site Suite 5.1.91` con il template `Nika Haircare` incluso. Zip installabile, latest zip e release descrittiva sono stati rigenerati e verificati con preflight positivo.
- 2026-05-22: chiuso anche il bug strutturale `editor-safe templates`. I template WaaS non devono piu aprirsi in Gutenberg mostrando il gate shortcode. La release `5.1.92` salva contenuto editabile vero e reinserisce il gate solo nel render front-end.
- 2026-05-22: chiuso il primo template WaaS davvero `block-native`: `nika_haircare_product` non nasce piu come `wp:html`, ma come blocchi Gutenberg nativi. In piu la normalizzazione editor ora intercetta anche shortcode puri e si attiva su ogni apertura editor di pagine template.
- 2026-05-22: chiuso anche il bug di persistenza sulle bozze template stale. La release `5.1.94` non si limita a normalizzare il wrapper: se una pagina WaaS esistente e wrapper-only o ancora sporca, la ricostruisce dalla sorgente template aggiornata prima di aprirla in editor.
- 2026-05-22: aggiunta anche la regola `anti-strozzatura` per il template Nika. Il titolo prodotto non deve piu essere spezzato dal tema host: colonna copy piu larga, titolo adattivo e CSS pubblico che blocca hyphenation/word-break.
- `2026-05-25` Smart Desk checkout/payment guard: deploy Render completato con commit `3ff3db8`. Il live serve `index-CYAcigEG.js`; backend blocca sospensione generica di account paganti/attivi e UI superadmin mostra `Pagante: solo assistenza`. Site Suite `5.2.51` e stata caricata su WordPress come pacchetto e manifest `stable_version=5.2.51`, ma il plugin attivo resta `current_origin_version=5.2.50` perche `automatic_install_enabled=false`. Trial payment Render indica `card_nexi` ma `configured=false` e `paymentUrl` vuoto; webhook WooCommerce pagamento e raggiungibile e protetto con `401` senza firma.
- `2026-05-26` Site Suite `5.2.53` pronta: aggiunti pulsante pubblico WhatsApp assistenza configurabile e mappa email sito in Automazioni (`lead`, `contatto`, `supporto`, `fatturazione`, `executive`). Pacchetto caricato su WordPress a `https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.2.53.zip`; manifest cache-busted `stable_version=5.2.53`, `current_origin_version=5.2.52`, `automatic_install_enabled=false`, quindi serve update/install manuale per renderla attiva sul sito.
- `2026-05-26` Smart Desk Render aggiornato con commit `a15540b`: il flusso `Attiva WhatsApp Gold` salva numero Business, conferme e apre richiesta assistita WhatsApp a SkinHarmony. Live verificato: `/login` serve `index-M4ghCw63.js`; bundle contiene `Salva numero e richiedi assistenza`. Finche Twilio/Meta non sono configurati, Marketing resta in fallback copia/apertura manuale e non invia automaticamente.
- `2026-05-26` Smart Desk Render aggiornato con commit `7bd28da`: aggiunto collegamento Twilio proprio del centro per WhatsApp Business Marketing. UI live `index-DTMQutaa.js` mostra `Collega il Twilio del centro`, `Account SID`, `Auth Token`, `Sender`, `Test connessione`. Backend salva il token senza rimandarlo al frontend, invia con credenziali tenant se valide e resta in fallback manuale se Twilio non e configurato o rifiuta. Endpoint protetto `/api/ai-gold/whatsapp/test-twilio` risponde `401 session_invalid` senza login, come atteso.
- `2026-05-26` Smart Desk WhatsApp Gold corretto per self-service Twilio: commit Render repo `1d1c219` sostituisce il vecchio redirect `wa.me` verso owner nel setup WhatsApp Business con apertura Twilio Console e guida Twilio. Il flusso ora salva numero/consensi, apre Twilio per creare/verificare il WhatsApp Sender del centro, poi richiede Account SID/Auth Token/Sender e `Test connessione`. Live propagato: `/login` serve `index-B02VG3SA.js`; bundle live contiene `Apri Twilio Console` e `Guida Twilio WhatsApp` e non contiene piu i testi del vecchio setup assistito verso owner. Nessun segreto in memoria condivisa.
- `2026-05-26` Site Suite `5.2.54` pronta come pacchetto: `Analytics WaaS` aggiunge `Core Insight / Cosa devi fare adesso`, un action plan read-only che legge traffico, comportamento, funnel, lead, engagement e Google Ads/GA4 quando disponibili. Ogni azione indica priorita, problema, motivo, cosa fare, metrica da verificare e cosa evitare. Pacchetto caricato su `https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.2.54.zip`; manifest `stable_version=5.2.54`, `current_origin_version=5.2.53`, `automatic_install_enabled=false`, quindi serve update/install manuale per vederlo nel wp-admin live.
- `2026-05-26` Site Suite `5.2.55` pronta come pacchetto UI: `Analytics WaaS` separa chiaramente `Dati letti dalla Suite` e `Dati letti da Google Ads e GA4`; `Core Insight` usa card riassunto compatte e azioni operative numerate invece della tabella tecnica. Pacchetto caricato su `https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.2.55.zip`; manifest `stable_version=5.2.55`, `current_origin_version=5.2.54`, `automatic_install_enabled=false`. Serve update/install manuale per vedere la UI migliorata.
- `2026-05-26` Site Suite `5.2.56` pronta come pacchetto UI visual order: `Analytics WaaS` mantiene gli stessi dati ma riorganizza i pannelli. `Google Ads / GA4` e `Core Insight` sono a larghezza piena, il funnel non resta compresso in colonna, le griglie traffico/comportamento usano due colonne larghe su desktop e una su mobile. Pacchetto caricato su `https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.2.56.zip`; manifest cache-busted `stable_version=5.2.56`, `current_origin_version=5.2.55`, `automatic_install_enabled=false`. Serve update/install manuale per vedere l'ordine visivo live.
- `2026-05-26` Site Suite `5.2.58` pronta come pacchetto CRM B2B operativo: tab, card scheda azienda e metriche `Dettagli operativi` sono cliccabili e portano a contatti/aziende, pipeline, scheda azienda, rete, licenze, ordini, documenti, contratti, analytics e AI insights. Modifica read-only: nessun ordine, pagamento, email, licenza o automazione viene eseguito. Pacchetto caricato su `https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.2.58.zip`; manifest cache-busted `stable_version=5.2.58`, `current_origin_version=5.2.56`, `automatic_install_enabled=false`. Serve update/install manuale per vedere le card operative live.
- `2026-05-26` Site Suite `5.2.59` pronta come pacchetto Analytics Conversion Workbench: `Analytics WaaS` ora aggiunge un piano operativo conversione che dice cosa fare su tracking conversioni, landing Ads dedicata, CTA sopra la piega e form/checkout. Il blocco resta read-only e non modifica campagne, budget, pagine, checkout o dati cliente. Pacchetto caricato su `https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.2.59.zip`; manifest cache-busted `stable_version=5.2.59`, `current_origin_version=5.2.58`, `automatic_install_enabled=false`. Serve update/install manuale per vederlo live.
- `2026-05-26` Site Suite `5.2.60` pronta come pacchetto fix Analytics Workbench: corretto `Apri lead` verso `shss-leads` e reso il link landing/pagina piu specifico, aprendo direttamente la pagina piu vista quando WordPress riesce a risolverla. Diagnosi corrente: collo probabile su `clic Ads -> pagina -> CTA/form/checkout`, con attribution/UTM non ancora pulita (`none/direct` alto) e conversioni Ads a zero. Pacchetto caricato su `https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.2.60.zip`; manifest cache-busted `stable_version=5.2.60`, `current_origin_version=5.2.59`, `automatic_install_enabled=false`. Serve update/install manuale.
- `2026-05-26` Create tre bozze WordPress conversione, senza pubblicare o modificare pagine live: `1932` Bozza conversione Smart Desk Ads, `1933` Bozza checkout Smart Desk chiaro, `1934` Bozza conversione SkinHarmony WaaS Ads. Obiettivo: correggere collo `Ads -> pagina -> CTA/form/checkout`, separare Smart Desk da WaaS e chiarire checkout. Verifica API autenticata: tutte `status=draft` e contenuto salvato. Report: `SHARED_MEMORY/reports/SUITE_CONVERSION_DRAFT_PAGES_2026-05-26.md`.
- `2026-05-26` Site Suite sorgente `5.2.62` bonificata per separazione dati tenant: default WhatsApp/powered-by/social/project key/listino resi agnostici, dogfood SkinHarmony disabilitato di default, pricebook personale lasciato fuori zip in `runtime/private/skinharmony_site_creation_pricebook.json`. In `Automazioni` aggiunti campi WordPress per project key, nome progetto, powered-by e toggle dogfood, cosi i dati del nodo passano da Suite invece che dal codice. Non usato lo zip in quarantena `5.2.63-do-not-install`; `dist/skinharmony-site-suite.zip` resta pulito `5.2.62` e non e stato rigenerato in questo blocco. Test locali OK; nessun deploy.
- `2026-05-26` Template Suite separati dal codice come fonte primaria: `Template WaaS` ora importa/esporta un registry persistente in WordPress option `shss_suite_template_registry`; monolite e modulo `waas-templates` leggono prima quel registry e usano `templates/registry/suite-template-registry.json` solo come fallback software. Obiettivo: template creati/salvati da Suite restano dopo gli update del plugin; il codice serve per aggiornare/sistemare il software, non per conservare dati cliente.
- `2026-05-26` Site Suite `5.2.64` e ora il pacchetto pulito corrente dopo quarantena `5.2.63`: zip versionato, latest zip e manifest allineati. Sono stati rimossi dai fallback codice i master template SkinHarmony, numero/powered-by/social/project key default, listino default, tecnologie hardcoded (`Skin Pro`, `O3 System`, `Termosauna`) e card prodotto tenant-specific. Le tecnologie e i prodotti devono arrivare da opzione WordPress/Suite `shss_custom_technology_sales_definitions` o import runtime/private; nessun deploy automatico eseguito.
- `2026-05-26` Site Suite `5.2.65` preparata e caricata come pacchetto update server controllato: aggiunto endpoint admin `POST /wp-json/shss/v1/waas-manager/technology-catalog/import`, import runtime privato `runtime/private/skinharmony_suite_technology_catalog_import.json` e script `scripts/load_private_suite_technology_catalog_to_wp.js`. Live `www.skinharmony.it` resta attivo su plugin `5.2.64`; manifest no-cache vede `stable_version=5.2.65`, `package_url` su `skinharmony-site-suite-5.2.65-1.zip`, `automatic_install_enabled=false`. Catalogo commerciale live attualmente vuoto (`products=0`) finche owner aggiorna a `5.2.65` e viene eseguito import privato.
- `2026-05-26` Site Suite live aggiornata a `5.2.65` e import catalogo tecnologie completato da runtime privato. `commerce-policy` ora e `ready` con 3 prodotti tecnologia (`Skin Pro`, `Termosauna`, `O3 System`) e manifest `distribution_ready=true`, automatic install ancora spento. Diagnosi Core 2.0: il servizio locale era vivo su `3199`, ma il connector Node falliva nel sandbox; eseguito fuori sandbox funziona. Corretto anche `core-first.env` con `SH_CORE_TENANT_ID=codexai`; test finale Core OK.
- `2026-05-26` Site Suite `5.2.66` pronta come package Data Manager: aggiunta pagina admin `SkinHarmony Suite -> Data Manager` per export/import bundle JSON runtime (`template_registry`, `technology_sales_definitions`, `product_cards`) salvati in opzioni WordPress persistenti. Package caricato su `https://www.skinharmony.it/wp-content/uploads/2026/05/skinharmony-site-suite-5.2.66.zip`; manifest no-cache `stable_version=5.2.66`, `current_origin_version=5.2.65`, `automatic_install_enabled=false`, `contains_customer_data=false`. Serve installazione manuale owner per rendere visibile la pagina.
- `2026-05-27` Site Suite live aggiornata e verificata a `5.2.66`: manifest no-cache `stable_version=5.2.66`, `current_origin_version=5.2.66`, `distribution_ready=true`, `automatic_install_enabled=false`. Controllo runtime OK: commerce ready con 3 prodotti tecnologia (`Skin Pro`, `Termosauna`, `O3 System`), settlements OK, template count `16`. Prossimo controllo manuale: aprire `SkinHarmony Suite -> Data Manager` e provare export/import UI.
- `2026-05-29` Suite live `5.3.1`: sync Render finale completato dopo conferma owner. Control Plane Render `0.4.5-commerce-snapshot-ready` ha accettato heartbeat, node snapshot, commerce snapshot ed evidence push; remote dashboard OK. Manifest live `5.3.1` aggiornato con nota `E2E Visibility Guard` e sync commerce snapshot. Marketing journey dispatch non accettato ma non bloccante.
- `2026-05-29` Suite `5.3.2` preparata localmente per scala vera: soft archive/audit CRM al posto di hard delete, ruoli/capability multiutente, boundary modulare `Product Inventory`, mappa `Runtime Storage`, Price List Engine read-only contract e onboarding provisioning readiness. Test locali OK: PHP lint, suite plugin `1660/1660`, closure preflight `22/22`. Zip locale: `dist/skinharmony-site-suite-5.3.2.zip`. Nessun upload/deploy eseguito.
- `2026-05-30` Suite `5.3.3` hotfix locale pronta: dopo update manuale zip la Suite poteva sparire dal menu wp-admin perche `shss_suite_access` veniva assegnata solo in activation hook. Fix: capability riallineate anche nel bootstrap versione e fallback `manage_options` per administrator durante la registrazione menu. Test OK: PHP lint, suite plugin `1663/1663`, closure preflight `22/22`. Zip locale: `dist/skinharmony-site-suite-5.3.3.zip`. Nessun upload/deploy eseguito.
- `2026-05-30` Suite `5.3.4` locale pronta: CRM B2B trasformato in pagina progressiva senza rimuovere funzioni o cambiare logiche. KPI, cockpit sintetico, alert e azioni principali restano visibili; Lead/CRM/Journey, pipeline, ERP Lite dashboard, registro aziende, timeline, documenti, email thread, form lunghi, ruoli/moduli, analytics, AI insights e report sono in sezioni apribili. Anchor admin aprono automaticamente il pannello `<details>` padre. Core gate fuori sandbox `ALLOWED`, report `reports/codex-core/codex_core_gate_latest.json`. Test OK: PHP lint, suite plugin `1667/1667`, closure preflight `22/22`. Zip locale: `dist/skinharmony-site-suite-5.3.4.zip`. Nessun upload/deploy eseguito.
- `2026-05-30` Suite `5.3.5` locale pronta: la logica di progressive disclosure e stata estesa a tutta la Suite admin. Le pagine dense con molte sezioni `<details>` ricevono barra `Sezioni Suite`, ricerca, `Apri tutto` e `Chiudi tutto`; sezioni secondarie non immediate vengono chiuse in modo conservativo e i link interni continuano ad aprire il pannello padre. Non sono stati modificati dati, endpoint, form, nonce, salvataggi, permessi o logiche CRM/ERP. Core gate fuori sandbox `ALLOWED`, report `reports/codex-core/codex_core_gate_latest.json`. Test OK: PHP lint, suite plugin `1671/1671`, closure preflight `22/22`. Zip locale: `dist/skinharmony-site-suite-5.3.5.zip`. Nessun upload/deploy eseguito.
- `2026-05-30` Suite `5.3.6` locale pronta come Final Closure Board: la Readiness Board ora include la lista finale aggiornata per chiudere/vendere Suite in modalita managed pilot. Gate coperti: sync Render finale, monolite sotto controllo, ruoli multiutente, storage scalabile, ERP Lite E2E, soft delete/audit, manifest/changelog, trial/onboarding/provisioning e Price List Engine. Ogni voce dichiara se e `closed`, `owner_manual_after_install`, `controlled_roadmap` o `managed_service_ready`. Non sono stati cambiati dati, endpoint operativi, salvataggi, permessi o deploy. Core gate fuori sandbox `ALLOWED`, report `reports/codex-core/codex_core_gate_latest.json`. Test OK: PHP lint, suite plugin `1675/1675`, closure preflight `22/22`. Zip locale: `dist/skinharmony-site-suite-5.3.6.zip`. Nessun upload/deploy eseguito.
- `2026-05-30` Nyra locale / Core 2.0: attivato import memoria Codex da `SHARED_MEMORY` in forma distillata e redatta. File principale `universal-core-2.0/runtime/nyra-learning/nyra_codex_work_memory_latest.json`; ultimo smoke governance: `3265` eventi visti, `120` importati, `48` task contract, `40` report finali. `nyra:governance` aggiorna il pack mentre si lavora. Render, produzione, chiavi, clienti e prezzi restano fuori.
- `2026-05-30` Core Codex Connector / Nyra sidecar locale: i comandi esistenti `work-start`, `checkpoint` e `finalize` ora chiamano automaticamente il refresh memoria Nyra/Codex locale senza cambiare firma CLI. Report sidecar: `reports/codex-core/nyra_sidecar_latest.json`; memoria aggiornata: `universal-core-2.0/runtime/nyra-learning/nyra_codex_work_memory_latest.json`. Smoke reale: sidecar `refreshed`, CLI contract invariato, `render_touched=false`.
- `2026-05-30` Nyra router / gestione Codex: corretto falso positivo su negazioni/confini. `fai deploy su Render` resta `deploy_or_render` bloccato; `nessun deploy richiesto` ora diventa `run_local_tests`; `non toccare Render` diventa `guide_codex` con `render_protected=true`, non blocco cieco.
- `2026-05-30` Nyra Codex Work Supervisor: aggiunto supervisore locale che legge `task contract`, checklist, checkpoint, file e test per capire se Codex sta eseguendo davvero o lavora in superficie. Produce verdict `on_track/attention/recover/blocked`; se serve codice correttivo produce solo `core_required_patch_proposal`, applicabile da Codex solo dopo Core gate.
- `2026-05-30` Suite `5.3.8` locale pronta come primo passo reale di riduzione monolite: `Product Inventory` phase 1 estratto in `modules/product-inventory/class-module.php` con `SHSS_Product_Inventory_Service` per label, normalizer, calcoli base, status e guard E2E. Il monolite mantiene wrapper compatibili; UI, REST route, form action, nonce e salvataggi restano invariati. Core gate `release` fuori sandbox `ALLOWED`, report `reports/codex-core/codex_core_gate_latest.json`. Test OK: PHP lint, suite plugin `1678/1678`, closure preflight `22/22`. Zip locale: `dist/skinharmony-site-suite-5.3.8.zip`. Nessun upload/deploy eseguito.
- `2026-05-30` Suite `5.3.10` locale pronta come prosecuzione Product Inventory extraction: dopo `5.3.9` REST `status/upsert`, la `5.3.10` sposta nel servizio modulare anche la logica admin post `create/duplicate/save`. Il monolite mantiene wrapper per endpoint, permessi, nonce, redirect e compatibilità form. UI renderer Product Governance Hub resta ancora nel monolite. Core gate `release` fuori sandbox `ALLOWED`, report `reports/codex-core/codex_core_gate_latest.json`. Test OK: PHP lint, suite plugin `1682/1682`, closure preflight `22/22`. Zip locale: `dist/skinharmony-site-suite-5.3.10.zip`. Nessun upload/deploy eseguito.
- `2026-05-30` Suite `5.3.11` locale pronta: Product Inventory extraction completata. Anche il renderer UI `Product Governance Hub` vive ora in `modules/product-inventory/class-module.php` dentro `SHSS_Product_Inventory_Service::render_admin()`. Il monolite mantiene solo il wrapper `render_product_inventory_admin()` e i wrapper compatibili già presenti; markup, form action, nonce, copy, dati, WooCommerce, stock e comportamento restano invariati. Core gate `update` e `release` fuori sandbox `ALLOWED`, report `reports/codex-core/codex_core_gate_latest.json`. Test OK: PHP lint, suite plugin `1684/1684`, closure preflight `22/22`. Zip locale: `dist/skinharmony-site-suite-5.3.11.zip`. Nessun upload/deploy eseguito.
- `2026-05-30` Smart Desk Render Core AI/Gold Bridge: corrette card operative che apparivano cliccabili ma non aprivano moduli. `gold-bridge.js` ora assegna route esplicite, binding click+tastiera e accessibilita base alle card Gold/Core/Enterprise. Commit live GitHub `df022572bec5aae47b33f37bc742de0612a1e899`, deploy Render `dep-d8dkj0op7ens73bhl8dg` live, health `HTTP 200`, asset live verificato. Nyra scan esteso a `data-gold-route`, `data-enterprise-nav`, `data-enterprise-card-target`, `data-admin-action`; dopo fix high/critical `0`, unbound UI actions `0`, unbound UI action attributes `0`. Report: `reports/smartdesk/SMARTDESK_CORE_AI_CARD_WIRING_FIX_2026-05-30.md`.
- `2026-05-30` Smart Desk Render `demo_gold_cockpit`: corrette le card/CTA gialle `Dettagli` che non producevano un'azione chiara. Asset attivo live `/assets/index-Bb4ZEGa9.js`: `Dettagli` -> `Apri regole Core`, `Mostra dettagli` -> `Apri pannello operativo`, click con apertura dettagli e scroll al pannello operativo. Commit `866406fe44c26bd63f1b4de0a8a6b1541d29cfd0`, deploy Render `dep-d8dkprg32otc73bmfbt0` live, health `HTTP 200`, bundle live verificato. Nyra scanner aggiornato con `ambiguous_ui_action`; scan dopo fix high/critical `0`, ambiguous UI actions `0`. Report: `reports/smartdesk/SMARTDESK_DEMO_GOLD_COCKPIT_DETAILS_FIX_2026-05-30.md`.
- `2026-05-30` Smart Desk Render `demo_gold_cockpit`: aggiunto hardening contro caricamenti percepiti come blocco e chiarito il copy operativo. Asset attivo live `/assets/index-Bb4ZEGa9.js`: watchdog frontend sugli endpoint AI Gold primari e deep-dive, CTA `Vedi cosa confermare`, `Mostra cosa fare ora`, `Apri piano`, istruzione `Apri il piano e scegli la prima azione da confermare.`. Commit `42d5059f7cd1d8b9362a287bb324ab2cf55450b2`, deploy Render `dep-d8dl07dvmnac73bndsdg` live, health `HTTP 200`, bundle live verificato. Nyra scan dopo fix high/critical `0`, ambiguous UI actions `0`, unbound UI actions `0`. Report: `reports/smartdesk/SMARTDESK_DEMO_GOLD_COCKPIT_LOADING_CLARITY_FIX_2026-05-30.md`.
- `2026-05-31` Suite `5.3.13` audit gate locale sistemato: `scripts/audit_site_suite_buttons.js` ora riconosce anche il registry dinamico delle pagine Suite, non solo chiamate dirette `add_menu_page/add_submenu_page`. Il falso positivo `missing_pages=38` è chiuso: audit attuale `missing_admin_post=0`, `missing_pages=0`, `missing_anchors=0`, `registered_admin_pages=54`, `linked_admin_pages=38`. Nessun file runtime plugin, WordPress live, Render o dato cliente è stato modificato. Test OK: audit buttons, `node --check`, Suite local `1688/1688`.
- `2026-05-31` Suite `5.3.13` fast path locale pronto: dopo verifica live post-install, `enterprise-core/snapshot` risultava lento circa 31s e `waas-manager/control-plane` circa 10s. Aggiunta cache transient read-only da 120s sui due endpoint con `refresh=1` solo admin. Endpoint, permessi, logica dati e payload principale restano invariati. Core gate `ALLOWED`, report `reports/codex-core/codex_core_gate_latest.json`. Test OK: PHP lint completo, Suite local `1688/1688`, closure `22/22`, audit buttons `0` missing, program registry READY. Zip locale aggiornato: `dist/skinharmony-site-suite-5.3.13.zip`.
- `2026-05-31` Suite software closure punti 1-5 checkpoint locale: salvata checklist in `SHARED_MEMORY/reports/SUITE_SOFTWARE_CLOSURE_CHECKLIST_1_5_2026-05-31.md`. Aggiunto `SHSS_Crm_B2b_Service` modulare read-only per capability map, role matrix, source-of-truth, storage contract e soft-delete policy; il monolite ora riusa il service per capability/ruoli. Runtime Storage dichiara cutover phase, blocco write migration e store CRM/email/documenti. Product Inventory passa da eliminazione fisica ad archiviazione auditabile mantenendo gli archivi fuori dalle viste operative. Order Ledger write path non è stato spostato: Core gate aveva bloccato il ledger e resta protetto. Test OK: PHP lint completo, Suite local `1688/1688`, closure `22/22`, audit buttons `0` missing, program registry READY.
- `2026-05-31` Suite software closure continuation locale: `Technology Inventory` ora ha service contract modulare `SHSS_Technology_Inventory_Service`, storage contract e soft-delete policy. Le definizioni tecnologia archiviate restano in `shss_custom_technology_sales_definitions` con `status=archived`, `archived_at`, `archived_by`, vengono nascoste dalle viste operative e producono audit `technology_inventory_definitions_archived`. Nessun ordine, pagamento, ledger, deploy, zip o Render sync toccato. Core gate iniziale ha bloccato il dominio protetto, poi il scope senza order/payment/ledger è stato `ALLOWED`. Test OK: PHP lint completo, Suite local `1688/1688`, closure `22/22`, audit buttons `0` missing, program registry READY.
- `2026-05-31` Suite CRM snapshot extraction locale: `SHSS_Crm_B2b_Service` ora espone `company_cockpit_snapshot()` e `erp_lite_snapshot()` come contratti read-only per Company Cockpit 360 e CRM ERP Lite. Il monolite mantiene renderer/wrapper compatibili e legge il service quando disponibile. Nessun Order Ledger write path, pagamento, stock, settlement, zip, deploy o sync Render toccato. Core gate fuori sandbox `ALLOWED`; test OK: PHP lint completo, Suite local `1688/1688`, closure `22/22`, audit buttons `0` missing, program registry READY.
- `2026-05-31` Suite role capability checkpoint locale: aggiunto `can_access_suite_rest()` e applicato solo a 7 endpoint GET di lettura (`status`, `waas-manager/status`, `product-inventory`, `dashboard`, `customer-success-followup`, `customer-lifecycle-board`, `analytics`). Mutazioni, sync, chiavi, import, cleanup, automazioni e operazioni sensibili restano protette dai permessi precedenti. Mappa permessi salvata in `reports/wordpress/suite_rest_permission_map_latest.json`. Core gate fuori sandbox `ALLOWED`; test OK: PHP lint completo, Suite local `1688/1688`, closure `22/22`, audit buttons `0` missing, program registry READY.
- `2026-05-31` Salvata mappa strategica `Suite Decoupled Control Plane`: direzione consigliata `Decoupled SaaS graduale`. Suite resta completa dentro WordPress per chiudere e vendere; in seguito UI esterna/SaaS legge Render Control Plane e WordPress Connector, mentre WordPress/WooCommerce restano nodo sito-commerce. Report: `SHARED_MEMORY/reports/SUITE_DECOUPLED_CONTROL_PLANE_MAP_2026-05-31.md`. Nessun codice, deploy, zip o produzione toccati.
- `2026-05-31` Suite support read capability checkpoint locale: aggiunto `can_read_support_rest()` e applicato solo a 7 board GET di support/customer success (`renewal-risk-board`, `customer-value-board`, `support-sla-board`, `customer-proof-board`, `partner-channel-board`, `contract-readiness-board`, `post-install-validation`). Scritture, configurazioni e operazioni sensibili restano protette. Mappa permessi aggiornata: `can_manage_rest=123`, `can_access_suite_rest=7`, `can_read_support_rest=7`, `can_read_crm_rest=1`. Test OK: PHP lint completo, Suite local `1688/1688`, closure `22/22`, audit buttons `0` missing, program registry READY.
- `2026-06-07` SkinHarmony Analyzer Pro iPad nativo: progetto SwiftUI in `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/` con bundle `com.skinharmony.analyzerpro.ipad`. Firma Apple sbloccata con team `4SL9LFTHWD` / `Apple Development: cristiancardarello77@gmail.com`; app compilata, installata e avviata su iPad `00008132-001A195C3EB9001C`. Dopo feedback owner, la shell iniziale e stata sostituita con flusso collegato al report Android: sei slot `fs/yf/xw/yz/sb/mk`, mapping `skin_tone_brightness`, `water_oil_balance`, `texture_fine_lines`, `redness_sensitivity_signals`, `spots_pigmentation_signals`, `pores_texture`, acquisizione per slot da camera iPad o import foto, payload unico verso Core/Nyra/OpenAI, chiavi in Keychain e fallback locale non-medico. Limite hardware dichiarato: la tricocamera Android usa `UVCCameraHelper/USBMonitor/libimageproc.so`; su iPad serve camera UVC compatibile iOS o bridge/export immagini per avere cattura fisica identica.
- `2026-06-08` SkinHarmony Analyzer Pro iPad scoring: applicata passata rigorosa derivata da `12-ghidra-line-reconstruction/clean-c/hotimgproc_score_core_reconstructed_v1.c`. Nel file iOS `OriginalScoringSDK/skinharmony_original_scoring_unavailable.c` sono state rimosse le vecchie funzioni candidate ispirate per luminosita, texture, macchie e pori; restano numerici solo `GetWaterOilvalue` derivato da Ghidra e `GetYanzhengValue` con equalize/predicato Ghidra. Lo status resta `SH_ORIGINAL_SCORING_ENGINE_UNAVAILABLE`. Build firmata, installazione e launch su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK. Golden report aggiornato: `fixtureCount=6`, `imagesFound=66`, `nativeImageBridgeCount=36`, `candidateExactCount=6/36`; acqua/olio `5/6` match e un caso `+1`, rossore non ancora equivalente (`65,53,64,50,76,65` contro `50,50,50,50,68,58`). Report: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_GHIDRA_DERIVED_SCORING_PASS_REPORT.md`.
- `2026-06-08` SkinHarmony Analyzer Pro iPad OpenCV scoring: integrato OpenCV iOS ufficiale `3.4.16` da OpenCV/SourceForge in `ThirdParty/OpenCV/opencv2.framework`, con checksum e provenienza documentati in `ThirdParty/OpenCV/OPENCV_PROVENANCE.md`. Il file scoring e ora `OriginalScoringSDK/skinharmony_original_scoring_unavailable.mm` e usa OpenCV C API reali per `GetSkinBrightness`, `GetWaterOilvalue`, `GetTextureValue` e `GetYanzhengValue`, derivando le formule da `12-ghidra-line-reconstruction/clean-c/hotimgproc_score_core_reconstructed_v1.c`. Xcode build, install e launch su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK. Golden report: `candidateExactCount=13/36`; `Texture 6/6`, `Acqua/sebo 5/6`, `Luminosita 1/6`, `Rossore 1/6`, `Macchie/Pori -1`. Aggiunta diagnostica read-only sulle immagini `_0.jpg`: `alternateAttemptCount=30`, `alternateExactCount=0`, quindi non usare selezione best-of per gonfiare i test. Lo status resta `SH_ORIGINAL_SCORING_ENGINE_UNAVAILABLE`; non tarare numeri a mano e non promuovere a engine ufficiale. Report: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_OPENCV_SCORING_INTEGRATION_REPORT.md`; latest JSON: `reports/ipad-golden-test-latest.json`.
- `2026-06-08` Android originale Skin Analyzer image/report logic: completata mappa end-to-end di salvataggio immagini e processed output. Report: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/13-android-original-e2e-workflow-lab/reports/ANDROID_ORIGINAL_PROCESS_LOGIC_AND_IMAGE_OUTPUTS_2026-06-08.md`; contact sheet: `13-android-original-e2e-workflow-lab/reports/image-pairs-2026-06-08/android_original_report_image_pairs_contact_sheet.png`; JSON stats: `13-android-original-e2e-workflow-lab/reports/image-pairs-2026-06-08/android_original_report_image_pairs_analysis.json`. Confermato da Java/smali: ogni report salva `fs/yf/xw/yz/sb/mk` come coppie `*.jpg` sorgente + `*_0.jpg` elaborata; `yf_0` grigio+verde, `xw_0` colore+linee blu, `yz_0` overlay rosso, `sb_0` maschera bianco/nero, `mk_0` cerchi rossi/arancio/gialli, `fs_0` grigio. In full-face Android ogni scatto cattura tre spettri ma riempie un solo slot: `m_BitmapSrc[0]=light2`, `[1]=light2`, `[2]=light3`, `[3]=light3`, `[4]=light3`, `[5]=light4`; in single-face un solo scatto riempie tutti gli slot con mapping `[0,0,1,1,1,2]`. `score[0]` non e il ritorno native luminosita: viene ricalcolato come media intera di `score[1]+score[2]+score[4]+score[5]+score[3]`.
- `2026-06-08` SkinHarmony Analyzer Pro iPad processed outputs: portato su iPad il mapping luce/slot Android e la generazione locale delle immagini `*_0.jpg` quando mancano. `ContentView.swift` ora usa luci guida coerenti (`yf/xw=2`, `fs/yz/sb=3`, `mk=4`) e sceglie la sorgente corretta dalle tre polarizzazioni; `OriginalScoringEngine.swift` include `AndroidOriginalCaptureMapping` e `AndroidProcessedImageRenderer` per `fs` grigio, `yf` overlay verde, `xw` edge blu, `yz` overlay rosso, `sb` maschera binaria, `mk` cerchi marker; `AndroidReportFileSystem.swift` arricchisce le sessioni prima del salvataggio. Build generic iOS OK, build firmata/install/launch su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK. Report: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_ANDROID_PROCESSED_OUTPUTS_PORT_REPORT.md`. Limite: marker Android-like visuali, non ancora output 1:1 di `libimageproc.so`; scoring non tarato.
- `2026-06-08` SkinHarmony Analyzer Pro iPad Frida/Ghidra lab: creato `14-ipad-frida-ghidra-lab` per analisi iPad equivalente al metodo Android. Installato Frida locale in venv (`frida 17.11.0`, `frida-tools 14.9.0`); `frida-ls-devices` vede iPad `00008132-001A195C3EB9001C`, mentre `frida-ps -U` resta appeso su process enumeration, confermando che su iPad non jailbroken serve Frida Gadget test-only per runtime hook. Ghidra/PyGhidra `12.1.2` inizializzato; import headless di `SkinAnalyzerProiPad.debug.dylib` riuscito come Mach-O `AARCH64:LE:64:AppleSilicon:swift`, progetto `SkinAnalyzerProiPadGhidra.gpr` salvato; autoanalysis timeout a 180s ma database creato. Export statici `nm`, Swift demangle, otool, strings e script hook Frida preparati. Report: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/14-ipad-frida-ghidra-lab/reports/IPAD_FRIDA_GHIDRA_LAB_REPORT_2026-06-08.md`.
- `2026-06-08` SkinHarmony Analyzer Pro iPad stabilizzazione + UI Android-like: integrato scatto da preview stabilizzata in `TrichoCameraEngine` (`captureStablePreviewFrame`, firma luminanza/movimento/nitidezza, stato visibile in UI) e collegato `ContentView` a sorgente `stable_preview_frame` prima del fallback foto. Home iPad riallineata alla UI Android SkinHarmony custom con topbar chiara, logo, titolo `Skin Analyzer Pro`, contenitore bianco bordato SkinHarmony e quattro card operative grandi (`Gestione clienti`, `Inizia il rilevamento`, `Gestione dei prodotti`, `Impostazioni di sistema`). Build, install e launch su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK. Report: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_STABILIZED_CAPTURE_ANDROID_UI_PARITY_REPORT.md`. Limite aperto: cambio luce/polarizzazione OEM non risolto senza comando/SDK reale.
- `2026-06-08` SkinHarmony Analyzer Pro iPad UI refinement: corretta home troppo grande con carousel a singola card centrale, frecce destra/sinistra, testo dentro card, dimensioni responsive, bordo SkinHarmony piu marcato e topbar piu compatta. I menu interni ora usano card selettore con frecce e posizione modulo invece di tab lunghe; pulsanti larghi in Prodotti/Sistema resi adattivi per non uscire dai bordi. Build/install/launch su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK. Report: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_ANDROID_LIKE_UI_REFINEMENT_REPORT.md`. Nessuna modifica a scoring, luci OEM, chiavi o storage.
- `2026-06-08` SkinHarmony Analyzer Pro iPad internal Android parity pass: dopo feedback owner, rifatti i menu interni guidandosi dai layout Android originali. `Inizia rilevamento` ora replica la struttura `preview.xml` con 3 punti sinistra + preview centrale/shutter + 3 punti destra; `Clienti` replica `member_layout.xml` con toolbar `Mostra tutto`/ricerca/+ e tabella Nome/Eta/Sesso/Telefono; `Prodotti` replica `products_layout.xml` con toolbar e tabella Nome prodotto/Categoria/Prezzo/Funzione; `Sistema` replica la grammatica `setting_layout.xml` con home, tab dei sei parametri, organizzazione, Salva/Default. `ReportCopy` ora usa preset locali dai testi SkinHarmony gia nel clone Android (`str_suggestion1..6`) invece di frasi generiche. Build/install/launch su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK. Report: `device-extracts/zhbl-plus/skinharmony-skin-analyzer-lab/08-skinharmony-analyzer-pro-ipad-native/IPAD_INTERNAL_ANDROID_PARITY_PASS_REPORT.md`. Nessuna modifica a scoring, OpenCV bridge, chiavi, storage o luci OEM.
- `2026-06-17` SkinHarmony Analyzer Pro iPad report/marker/3D quality pass: dopo nuovo test owner, Core 2.0 ha scelto `operator_text_quality_gate_visual_normalization`. Aggiornati testo report come operatore artificiale SkinHarmony, quality gate marker, normalizzazione raw/marker/3D su sorgente coerente, 3D piu naturali e label YF `Idratazione e barriera`. Scoring e soglie non modificati. Build fisica OK e installazione su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK senza disinstallazione; launch remoto negato solo per iPad bloccato. Report: `reports/ipad-analyzer/IPAD_REPORT_TEXT_MARKER_3D_QUALITY_FIX_2026-06-17.md`.
- `2026-06-17` Nyra Analyzer voice library 1.8 pronta in locale: `universal-core-2.0/runtime/nyra-learning/nyra_skinharmony_analyzer_voice_library_latest.json` ora contiene 1080 esempi, 54 fonti, 108 query scout e 9 blueprint voce. `personal-control-center/data/nyra-analyzer-learning-pack.json` locale e aggiornato a `1.8.0` con `voice_library`; `personal-control-center/server.js` legge il contesto voce e non apre piu il parlato finale con sigle metrica/livello. Verifiche locali OK. Rilascio esterno non eseguito: classic Core gate irraggiungibile e Core/Nyra locale ha bloccato `deploy_or_render`.
- `2026-06-17` Nyra Analyzer voice library 1.8 deployata su Render dopo conferma owner: commit backend `22ea7dc` su `main`. Live `https://skinharmony-nyra-core.onrender.com/api/nyra/analyzer/learning-pack` espone `version=1.8.0`, `voice_library.version=1.8`, `examples=1080`, `sources=54`, `source_scout_queries=108`, `voice_blueprints=9`. Smoke live `POST /api/nyra/analyzer/read-only` OK in profilo medico con voice context attivo; report: `reports/nyra-analyzer/NYRA_ANALYZER_VOICE_LIBRARY_1_8_RENDER_DEPLOY_2026-06-17.md`.
- `2026-06-18` SkinHarmony Analyzer Pro iPad tricocamera: corretto blocco scollega/ricollega. `TrichoCameraEngine` ora osserva connect/disconnect/runtime interruption, resetta frame vecchi, ricerche camera e abilita lo scatto solo con preview live fresca (`canCapture`). `ContentView` blocca acquisizione guidata se manca immagine live e mostra overlay `Attendo immagine live`. Build generica e build firmata OK; install su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK senza reset container. Report: `reports/ipad-analyzer/IPAD_TRICHOCAMERA_AUTO_RECONNECT_AND_CAPTURE_GATE_2026-06-18.md`.
- `2026-06-18` SkinHarmony Analyzer Pro iPad report language: dopo test owner su anamnesi estetica/medica, rafforzato humanizer e profili lingua. `AnalyzerAIClient` ora vieta riferimenti visibili a web/fonti/scout query, preferisce `reply/report/output_text` dai provider JSON e filtra metadati interni `voice_library/source_scout_queries` dal testo cliente. Humanizer era gia nel flusso; ora e piu vincolante. Build generica OK, build firmata OK e install su iPad OK senza reset container. Nessun scoring, marker, chiave o deploy Render modificato. Report: `reports/ipad-analyzer/IPAD_REPORT_HUMANIZER_NO_WEB_PROFILE_LANGUAGE_2026-06-18.md`.
2026-06-18 - Nyra Analyzer Render 1.9 live: deployato `voice_orchestrator` su `skinharmony-nyra-core` senza cambiare score/marker/iPad. Live `GET /api/nyra/analyzer/learning-pack` risponde `version=1.9.0`, `voice_orchestrator.version=1.9.0`, `term_glossary_count=6`, `profile_style_count=3`, `examples=1080`, `sources=54`. Backend commit finale `1943785`, Render deploy `dep-d8prts4m0tmc73e108vg`. Il blocco e solo selettore linguistico Nyra: Core V2 resta motore decisionale, OpenAI solo rifinitura. Report: `reports/nyra-analyzer/NYRA_ANALYZER_VOICE_ORCHESTRATOR_1_9_RENDER_DEPLOY_2026-06-18.md`.
- `2026-06-24` SkinHarmony Analyzer Pro iPad report AI: installato su iPad fix per separare algoritmo e AI. L'algoritmo resta responsabile di punteggi/marker/qualita; AI legge punteggi, marker, quadro generale, anamnesi, eta, cliente e prodotti reali. Aggiunto `ai_reading_contract`, ranking segnali, area guard contro citazioni non acquisite (`mento`, `zona T`, `ali del naso`) e piu spazio a OpenAI per testo premium senza farle decidere dati o prodotti. Build firmata e install su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK senza reset dati. Classic Core gate non raggiungibile; usato audit Core 2.0 locale `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json` con winner `dynamic_local_narrative_ranking`, `blocked=false`. Report: `reports/ipad-analyzer/IPAD_AI_TRUE_READING_CONTRACT_AREA_GUARD_2026-06-24.md`.
- `2026-06-24` SkinHarmony Analyzer Pro iPad Moondream embedded: integrato runtime locale GGUF dentro app, non solo gateway Ollama. Asset `Moondream2Embedded` Q4_0 nel progetto (`model` SHA256 `e554c6b9de016673fd2c732e0342967727e9659ca5f853a4947cc96263fa602b`, `mmproj` SHA256 `4cc1cb3660d87ff56432ebeb7884ad35d67c48c7b9f6b2856f305e39c38eed8f`), librerie iOS statiche `llama.cpp/mtmd/ggml` in `ThirdParty/MoondreamGGUF/ios-arm64`, bridge ObjC++ `EmbeddedMoondreamGGUFBridge` collegato a `EmbeddedMoondreamEngine`. Build fisica, install e launch su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK; app circa `1.7G`. Il VLM embedded resta supporto visuale vincolato a payload/marker/punteggi, non motore di scoring o diagnosi. Classic Core `core_unreachable`; Core 2.0 winner `trace_local_report_with_caveats`, `blocked=false`. Report: `reports/ipad-analyzer/IPAD_MOONDREAM_GGUF_EMBEDDED_RUNTIME_INSTALL_2026-06-24.md`.
- `2026-06-24` SkinHarmony Analyzer Pro iPad Moondream embedded-only cleanup: dopo chiarimento owner, rimosso il percorso gateway esterno dalla UI/flusso vendibile. `AnalyzerSettings` forza `embeddedMoondream`, abilita Moondream di default quando il pacchetto e presente e `shouldUseExternalVLMGateway` restituisce sempre `false`; in Sistema non compaiono piu selettore gateway, endpoint VLM locale, modello VLM o testo Mac/box/server. Build generica OK, build firmata OK, install su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK senza reset dati. Launch remoto fallito solo per timeout `CoreDeviceService`. Core 2.0 winner `embedded_only_sellable_cleanup`, `blocked=false`. Report: `reports/ipad-analyzer/IPAD_MOONDREAM_EMBEDDED_ONLY_CLEANUP_2026-06-24.md`.
- `2026-06-25` SkinHarmony Analyzer Pro iPad AI origin + Visual 3.0: integrato lo zip owner `SkinHarmonyVisualUpgrade_v0.3.0.zip` da Download (`sha256=f2de478bff2e2c117207dc86bdfa78856fc28d98a670d476a3958ca71808dd59`) nel progetto iPad e installato su device `0183BC47-A31A-5F38-972B-F4C43D30B3DE` senza reset dati. Visual 3.0 migliora marker, feature, quality gate e pseudo-3D ma dichiara `writesScores=false`, quindi non modifica ancora i punteggi. Aggiunta card Report `AIEngineTraceCard`: mostra sorgente reale della lettura, OpenAI usato/non usato, Moondream usato/non usato e cloud permesso/spento. `allowCloudFallback` parte spento e viene forzato spento alla migrazione se non esiste scelta esplicita; le chiavi possono restare nel Keychain ma sono inattive finche `Cloud emergenza` resta spento. Build generica OK, build firmata OK, install iPad OK. Classic Core `core_unreachable`; Core 2.0 winner install `signed_build_install_same_bundle_preserve_data`. Report: `reports/ipad-analyzer/IPAD_AI_ORIGIN_TRACE_VISUAL_V030_2026-06-25.md`.
- `2026-06-25` SkinHarmony Analyzer Pro iPad acquisizione guidata fix 4->5: durante test owner l'app restava bloccata tra quarta e quinta immagine/area perche lo step richiedeva esattamente 3 frame validi. `ContentView.swift` ora considera completato lo step se almeno un frame valido e stato salvato, mantiene trace tecnico per luci mancanti e avanza alla zona successiva; le metriche primarie salvano anche `latest_capture` dopo ogni step riuscito. Scoring/marker/AI non modificati. Prima build fallita per disco pieno; rimosse sole DerivedData temporanee `/private/tmp/skinharmony-dd-*`, build firmata device OK e install su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK senza reset dati. Classic Core `core_unreachable`; Core 2.0 winner `advance_on_partial_valid_capture_with_trace`, `blocked=false`. Report: `reports/ipad-analyzer/IPAD_GUIDED_CAPTURE_STEP4_TO5_UNBLOCK_2026-06-25.md`.
- `2026-06-25` SkinHarmony Analyzer Pro iPad acquisizione gate relax: dopo feedback owner che il fix precedente peggiorava e bloccava subito, rimosso il blocco rigido su `canCapture`. `TrichoCameraEngine` ora espone `captureBestAvailablePreviewFrame(timeout:)` che prova stabilizzazione e poi usa frame preview recente/ultimo frame; `validateReadyForCapture()` non blocca piu per assenza momentanea del flag fresh frame; il pulsante scatto non viene piu disabilitato da `canCapture`. Build firmata device OK e install su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK senza reset dati. Classic Core `core_unreachable`; Core 2.0 winner `relax_ui_gate_try_stable_capture_when_camera_running`, `blocked=false`. Report: `reports/ipad-analyzer/IPAD_CAPTURE_GATE_RELAX_FIX_2026-06-25.md`.
- `2026-06-25` SkinHarmony Analyzer Pro iPad latenza report: installato fix sul ciclo multi-zona. Lo scoring resta multi-area e continua a usare `NativeOriginalScoringEngine`; la evidence marker leggera resta disponibile per Nyra/Core, ma `AndroidProcessedImageRenderer.enrichedSession` non viene piu eseguito per ogni sotto-zona. Marker e pseudo-3D finali vengono generati una sola volta sulle metriche composite finali del report. VLM/cloud risultano disattivati nel path report immediato. Build generica OK, build firmata device OK, install su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK senza reset dati. Classic Core `core_unreachable`; Core 2.0 winner `lightweight_zone_scoring_final_visuals_once`, `blocked=false`. Report: `reports/ipad-analyzer/IPAD_REPORT_LATENCY_RENDERING_LOOP_FIX_2026-06-25.md`.
- `2026-06-25` SkinHarmony Analyzer Pro iPad media zone semplice: dopo feedback owner sui punteggi peggiorati, il composito multi-zona ora calcola lo score finale come media aritmetica semplice delle zone disponibili, es. `(50+70+70)/3`. Confidence, fuoco, qualita comparabile e area valida restano solo evidence per Nyra/Core e non pesano piu sul punteggio. Tutte le regole zona sono `weight=1.0` e `skinHarmonyQualityMultiplier` e stata rimossa. Build generica OK, build firmata device OK, install su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK senza reset dati. Core 2.0 winner precedente `simple_arithmetic_zone_average`, report: `reports/ipad-analyzer/IPAD_SIMPLE_ZONE_AVERAGE_FAST_REPORT_2026-06-25.md`.
- `2026-06-25` SkinHarmony Analyzer Pro iPad profilo diagnostico cattura: dopo segnalazione owner di qualita immagini abbassata e score MK/FS troppo bassi, trovato che il flusso multi-zona `captureThreePolarizationsForArea` non applicava un profilo diagnostico protetto. Ora la cattura area forza `.androidLike` durante i tre scatti e poi ripristina il profilo precedente, cosi le impostazioni qualita non falsano lo scoring. Build generica OK, build firmata device OK, install su iPad `0183BC47-A31A-5F38-972B-F4C43D30B3DE` OK senza reset dati. Core 2.0 winner `lock_area_capture_to_android_like_diagnostic_profile`, report: `reports/ipad-analyzer/IPAD_DIAGNOSTIC_CAPTURE_PROFILE_LOCK_2026-06-25.md`.
- `2026-06-25` SkinHarmony Analyzer Pro iPad anti stale-frame: verificata sessione `latest_capture` 23:04 e trovato errore input, non formula. `MK 38` usciva da `round((Naso/T-zone 54 + Fronte 30 + Guancia 30)/3)`; il `30` non indica marker assenti, ma molti blob/falsi positivi fino al floor del candidato MK. Hash immagini hanno confermato duplicati byte-identici tra zone/metriche (`yf_light4 == yz_light4 == mk_light4`, `fs_light3 == sb_light3`). Modificato `TrichoCameraEngine.captureBestAvailablePreviewFrame` per non riusare piu ultimo frame preview/memorizzato se non arriva un nuovo frame live. Build no-sign OK, build firmata OK, install iPad OK al secondo tentativo. Report: `reports/ipad-analyzer/IPAD_STALE_FRAME_CAPTURE_GUARD_2026-06-25.md`. Prossimo test: nuova acquisizione e verifica hash `latest_capture`.
- `2026-06-27` SkinHarmony Analyzer Pro iPad Visual Upgrade v0.3.0 reinstallato sul ramo pre-VLM/server-side: dopo controllo visivo del `latest_capture` reale iPad (`2026-06-27T18:21:35Z`) sono stati integrati i sorgenti `SkinHarmonyVisualUpgrade_v0.3.0.zip`, aggiunti gli analyzer specifici FS/YF/XW/YZ/SB/MK al target Xcode, disattivati i badge marker standard, rimosso il fallback vecchio 3D per XW e spostata la fase pesante marker/3D/salvataggio draft fuori dal MainActor per evitare blocco animazione. Build no-sign OK, build firmata OK, install iPad OK su `0183BC47-A31A-5F38-972B-F4C43D30B3DE`. Nessun VLM/Moondream reintrodotto. Il reprocess diagnostico ha consumato il flag ma non ha scritto output recuperabile; serve nuovo test manuale da UI iPad. Report: `reports/ipad-analyzer/IPAD_VISUAL_UPGRADE_V030_INSTALL_2026-06-27.md`.
- `2026-07-09` Core/Nyra adaptive cognition locale espansa: le primitive `hypothesis_ranking`, `cross_branch_transfer`, `counterfactual_screening`, `verify_before_escalation`, `memory_consolidation` non sono piu solo dichiarate ma vengono emesse nel payload `cortex_graph.adaptive_cognition.runtime_reasoning`. Ripristinati anche i meta-branch `developer_code`, `core_decision`, `codex_guidance`, `branch_overlay` per non perdere il path locale Codex-guided sotto reinforcement. Smoke OK: `nyra-branch-overlay-test`, `nyra-local-governance-test`. Report: `SHARED_MEMORY/reports/CORE_NYRA_REASONING_PRIMITIVES_EXPANSION_2026-07-09.md`.
- `2026-07-09` Verify live Render chiusa per le primitive di ragionamento Nyra: `https://skinharmony-nyra-core.onrender.com/healthz` tornato `200`, `read-only` e `text-chat` espongono `cortex_graph.adaptive_cognition.runtime_reasoning` e nelle note/reply compaiono `Ipotesi`, `Verify gate`, `Consolidamento`. Prompt translator resta instradato su `translator_marketing_governance` con `verify gate=blocked`, trasferimenti verso `translation_governance`, `marketing_copy`, `ramo_testo` e consolidamento `playbook`. Report: `SHARED_MEMORY/reports/CORE_NYRA_REASONING_PRIMITIVES_RENDER_2026-07-09.md`.
- `2026-07-09` Nyra/Core usati davvero su Render come path di lavoro e benchmark multi-dominio chiuso. Quattro prompt live misurati: translator `3.315283s`, security `3.647254s`, developer `2.610629s`, beauty `2.575800s`. Branch-learning approfondito e promosso con seed piccoli pushabili. Esito live finale: translator stabile, beauty migliorato davvero (`voice library + analyzer seed + decision clarity`), security/developer ancora parziali perché il live espone soprattutto fallback `decision_clarity` nonostante repo e smoke runtime-faithful vedano i seed corretti. Report: `SHARED_MEMORY/reports/NYRA_RENDER_BRANCH_LEARNING_BENCHMARK_AND_WORK_REPORT_2026-07-09.md`.
