# Tricocamera CF680 iOS SDK - Install Handoff

## Stato

SDK CF680 importato e build firmata pronta.

## Path

- Zip originale: `/Users/cristiancardarello/Downloads/IOSSDK.zip`
- Workspace: `tmp/tricocamera-ios-sdk/IOSSDK`
- Progetto Xcode: `tmp/tricocamera-ios-sdk/IOSSDK/iosDemo/Test.xcodeproj`
- App firmata: `tmp/tricocamera-ios-sdk/DerivedData/Build/Products/Debug-iphoneos/Test.app`
- Report: `reports/ipad-analyzer/TRICOCAMERA_CF680_IOS_SDK_IMPORT_2026-07-07.md`

## Verifiche Chiuse

- SDK device `arm64`.
- SDK simulator solo `x86_64`, quindi non usare simulator Apple Silicon come target principale.
- Build no-sign device OK.
- Build firmata device OK.
- Xcode project aperto.

## Install Bloccato

iPad M4 visto ma `unavailable`:

```text
iPad (2) | 0183BC47-A31A-5F38-972B-F4C43D30B3DE | unavailable | iPad Pro 13-inch (M4)
```

Serve sbloccare iPad e accettare Trust/autorizzazione.

## Comandi Di Ripresa

```bash
xcrun devicectl list devices
xcrun devicectl device install app --device 0183BC47-A31A-5F38-972B-F4C43D30B3DE tmp/tricocamera-ios-sdk/DerivedData/Build/Products/Debug-iphoneos/Test.app
xcrun devicectl device process launch --device 0183BC47-A31A-5F38-972B-F4C43D30B3DE com.skinharmony.analyzerpro.ipad
```

## Nota Bundle

Per install immediato è stato usato `com.skinharmony.analyzerpro.ipad`, perché il Mac ha provisioning profile solo per quel bundle. Questo sovrascrive l'app installata precedente, mentre il sorgente Skin Analyzer resta in standby nel workspace.
