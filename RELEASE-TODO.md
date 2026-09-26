# ZyndMail release reminder

**Next action:** Build signed ZyndMail `0.3.0` apps for **both iOS and Android** from the merged `main` branch. The notification fixes are in source control and the mail push relay is live, but the new native app has not been distributed.

- [ ] Sign in to the `kynjal-softwares` EAS account and confirm that the production EAS environment contains `EXPO_PUBLIC_MAIL_PUSH_RELAY_ORIGIN=https://mail.zyndpay.io`. The value in `eas.json` applies to builds, not OTA publication.
- [ ] Create and install the signed iOS and Android `0.3.0` builds. Record their EAS build IDs, native runtime versions, and `production` update channel. The Android notification changes require a new native build.
- [ ] Using an authorized test mailbox and physical devices, verify notification sender, subject and snippet; tapping the exact email; foreground, background and terminated delivery; and opt-out, logout and account-switch behavior.
- [ ] After those signed-build checks pass, publish and verify a matching `0.3.0` production OTA update for both platforms. An OTA cannot add the new native behavior to an older binary.
- [ ] Record the build and OTA update IDs in the [production release guide](docs/zyndmail-production-release.md), then mark this reminder complete.

The full acceptance matrix is in the [notification lifecycle audit](docs/notification-lifecycle-audit-2026-09-26.md).
