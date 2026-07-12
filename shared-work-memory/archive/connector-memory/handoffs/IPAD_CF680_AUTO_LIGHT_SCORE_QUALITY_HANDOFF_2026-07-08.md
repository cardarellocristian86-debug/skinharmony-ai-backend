# Handoff - iPad CF680 auto light / score / quality - 2026-07-08

## Current owner-visible state
- The app started on iPad.
- The installed build from about 17:07 includes:
  - no visible countdown in guided capture;
  - named CF680 light labels;
  - CF680 bridge mapping from app semantic modes `2/3/4` to SDK `who 10/11/12`;
  - new/native scoring path still included.
- The owner can test this installed build now.

## Code state
- Latest source also includes an extra report naming fix in `AndroidReportFileSystem.swift`:
  - single-image metric captures no longer default to `light2` by array index;
  - they use metric/area default light mode.
- No-sign build artifact exists:
  - `/private/tmp/skinharmony-cf680-light-nocount2-nodt/Build/Products/Debug-iphoneos/SkinAnalyzerProiPad.app`

## Blocker
- Final signed reinstall after the report naming fix is blocked by Apple `CoreDeviceService`.
- Symptoms:
  - `xcrun devicectl list devices` returns timeout waiting for `CoreDeviceService`;
  - signed `xcodebuild` cannot find physical iPad destination `00008132-001A195C3EB9001C`;
  - `killall CoreDeviceService` and `killall -9 CoreDeviceService` did not restore service.

## Next actions
1. Ask owner to unlock/reconnect iPad and, if still needed, quit/reopen Xcode or reboot Mac.
2. Retry:
   - `xcrun devicectl list devices`
   - signed build with destination `00008132-001A195C3EB9001C`
   - install app on device `0183BC47-A31A-5F38-972B-F4C43D30B3DE`
   - launch bundle `com.skinharmony.analyzerpro.ipad`
3. After a fresh owner capture, copy app container and verify:
   - `capture_trace.json` has `cf680_who` `10/11/12`;
   - no countdown;
   - image dimensions;
   - `score_breakdown.json/txt`;
   - report image filenames.

## Reports
- `reports/ipad-analyzer/IPAD_CF680_AUTO_LIGHT_SCORE_QUALITY_2026-07-08.md`
- Core report: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`
