# ZyndMail production migration

This build replaces the existing ZyndMail application under `io.zyndpay.mail` on iOS and Android. It uses the existing EAS project `e9054c93-18de-4d6a-bc34-38c020130b82`, production channel, and version `0.3.0`. The new runtime version keeps its JavaScript updates separate from the installed `0.2.0` application. A native install through TestFlight or the signed Android package is required before `0.3.0` OTA updates can apply.

The first-party client and this Bulwark Native-based client use different local account/cache formats. Users must sign in again. Server-saved Drafts and Sent mail remain on the mail server; a compose window left unsaved in the old client is not migrated. Ask users to save or send it before replacing the binary. The new client requires device verification before revealing cached mail after launch or backgrounding.

Production EAS requires a separate Firebase Android app registered for `io.zyndpay.mail`, its `GOOGLE_SERVICES_JSON` file, and `ZYNDMAIL_FIREBASE_PROJECT_ID`. The build pre-install script rejects a Preview project's file or a different package. Expo's production Android FCM v1 sender credential and the production iOS APNs credential must match this EAS project. The mail-plane relay must be deployed and qualified before describing mail push as available. `EXPO_PUBLIC_MAIL_PUSH_RELAY_ORIGIN` points to the reviewed HTTPS route; its presence alone proves neither subscription nor delivery.

Release evidence to record before broad availability:

1. Current-head CI, TypeScript, tests, both Metro exports, iOS/Android native builds, and signed artifact identities.
2. Exact-build TestFlight processing for the existing App Store Connect app and installable Android production APK. The Play AAB remains unsubmitted unless separately authorized.
3. Physical-device company Keycloak login, account and shared-mailbox visibility, draft/send/recovery, attachment/keyboard/safe-area flows, Face ID/passcode lock, and no lock loop.
4. Matching `0.3.0` production OTA publication and automatic application on signed iOS and Android builds while idle; compose and active mail actions must defer reload.
5. Live Stalwart-to-relay-to-Expo subscription, provider receipt, and foreground/background/terminated device presentation for iOS and Android. Verify revocation, logout, account switching, relay outage, and content-free payloads. A provider ticket is not device presentation.

The fork retains the Bulwark Native attribution and AGPL-3.0-only source link in Settings. Paid public access needs its own entitlement/onboarding and licensing review; it is not part of company mailbox authorization.
