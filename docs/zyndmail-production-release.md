# ZyndMail production migration

This build replaces the existing ZyndMail application under `io.zyndpay.mail` on iOS and Android. It uses the existing EAS project `e9054c93-18de-4d6a-bc34-38c020130b82`, production channel, and version `0.3.0`. The new runtime version keeps its JavaScript updates separate from the installed `0.2.0` application. A native install through TestFlight or the signed Android package is required before `0.3.0` OTA updates can apply.

The first-party client and this Bulwark Native-based client use different local account/cache formats. Users must sign in again. Server-saved Drafts and Sent mail remain on the mail server; a compose window left unsaved in the old client is not migrated. Ask users to save or send it before replacing the binary. The new client requires device verification before revealing cached mail after a cold launch or at least one minute in the background. Brief returns preserve an already verified unlock; inactive/system overlays do not relock the mailbox, and active reading/composing has no lock timer. A privacy cover immediately hides mail whenever the app is not active. Sign-out invalidates pending device verification.

Production EAS requires a separate Firebase Android app registered for `io.zyndpay.mail`, its `GOOGLE_SERVICES_JSON` file, and `ZYNDMAIL_FIREBASE_PROJECT_ID`. The build pre-install script rejects a Preview project's file or a different package. Expo's production Android FCM v1 sender credential and the production iOS APNs credential must match this EAS project. The mail-plane relay must be deployed and qualified before describing mail push as available. `EXPO_PUBLIC_MAIL_PUSH_RELAY_ORIGIN` points to the reviewed HTTPS route; its presence alone proves neither subscription nor delivery.

Release evidence to record before broad availability:

1. Current-head CI, TypeScript, tests, both Metro exports, iOS/Android native builds, and signed artifact identities.
2. Exact-build TestFlight processing for the existing App Store Connect app and installable Android production APK. The Play AAB remains unsubmitted unless separately authorized.
3. Physical-device company Keycloak login, account and shared-mailbox visibility, draft/send/recovery, attachment/keyboard/safe-area flows, Face ID/passcode lock, and no lock loop.
4. Matching `0.3.0` production OTA publication and automatic application on signed iOS and Android builds while idle; compose and active mail actions must defer reload.
5. Live Stalwart-to-relay-to-Expo subscription, provider receipt, and foreground/background/terminated device presentation for iOS and Android. Verify revocation, logout, account switching, relay outage, and opaque routing payloads. Draft `zyndpay` PR #2585 implements sender/subject/snippet previews and exact-message references; its compatibility patch must make health advertise `previewMode: "sender-subject-snippet-v1"` and resolve return `MESSAGE`. Deploy and qualify that relay before expecting visible previews or exact taps. A provider ticket is not device presentation. Follow the full matrix in `docs/notification-lifecycle-audit-2026-09-26.md`.
6. Staff scope: company accounts show mail and settings; Calendar, Contacts and Files apps stay hidden until each has approved scope and physical-device acceptance. Verify non-company accounts still see supported apps.
7. Staff help: confirm the deployed Keycloak recovery copy, name the incident owner and the existing support route in the rollout notice, then exercise a locked-out and an uncertain-send handoff without including message content or verification codes.

Android native files are checked in. Changes to `app.config.js` that affect the manifest, icons, permissions or config plugins require a matching Android native review before the next build; EAS will not regenerate those files. The iOS native project is generated during its build.

Before distributing a replacement build, send staff this notice through the established company channel and include its actual help contact:

> ZyndMail 0.3.0 replaces the previous mobile client. Save or send any unsaved draft in the old app before installing; local drafts and account sessions do not migrate. Sign in again after installation. Server-saved Drafts and Sent mail remain available. If sign-in fails or a send result is uncertain, contact [company support route] with your app version and the time of the problem. Do not share your password, verification code, or message content.

The repository retains the Bulwark Native attribution and AGPL-3.0-only license. The app's About screen does not contain source or license links. Paid public access needs its own entitlement/onboarding and licensing review; it is not part of company mailbox authorization.
