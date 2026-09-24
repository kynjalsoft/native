# ZyndMail native preview mail alerts

The Bulwark-based ZyndMail preview is a separate signed app, `io.zyndpay.mail.preview`, in Expo project `654a0262-9785-4753-8f37-9b0947b537a2`. Its company OAuth client is `zyndmail-native-preview`, and both staff and generic sign-in callbacks use the preview-only `zyndmailpreview` URL scheme. It must not reuse Bulwark's callback scheme or the installed ZyndMail app's push credentials, application ID, or production update channel. Generic providers must accept this distinct callback before their sign-in paths can be qualified.

Company mail alerts use the authenticated ZyndPay mail-plane relay in `kynjalsoft/zyndpay` PR #2585. The app sends its Expo push token only to the configured `EXPO_PUBLIC_MAIL_PUSH_RELAY_ORIGIN` HTTPS origin. Without that value, company push is visibly unavailable and no device registration is attempted. Public Bulwark accounts retain their existing Android FCM relay, but the company account never registers with it. Android uses one native Firebase service to route Bulwark data messages to the existing headless task and other messages to Expo Notifications.

The relay subscribes to new-mail `EmailPush` events for the current staff user's authorized personal and shared mail accounts. The device notification has fixed text, `ZyndMail` / `New ZyndPay Mail activity`, and an opaque reference only. A tap rechecks the current authenticated account and opens All Inboxes. No message content, address, mailbox ID, or URL is sent to Expo. A provider ticket, receipt, app foreground handler, and physical OS presentation are separate evidence.

The preview cannot be called notification-ready until all of these are witnessed:

1. Configure the preview OAuth client and redirect URI in Keycloak, and confirm a signed preview build can authenticate and read the current JMAP session. Do not treat simulator or anonymous endpoint reachability as staff acceptance.
2. Create a Firebase Android app for `io.zyndpay.mail.preview` and a company-owned APNs identity for the iOS preview. Keep `google-services.json` out of Git and use the preview-only release secret. Verify the merged Android manifest has exactly one `com.google.firebase.MESSAGING_EVENT` service.
3. Qualify PR #2585 against live Stalwart's callback and subscription semantics, then deploy the relay and configure its optional preview OAuth-client/EAS-project/app-ID tuple. Keep the tuple unset until that qualification passes.
4. Configure the reviewed HTTPS relay origin in the preview build and prove registration, foreground/background/terminated alerts and taps on signed physical iOS and Android devices. Exercise shared-account mail, access revocation, logout, account switch, token rotation, relay outage, and lease renewal without sending mail to unrelated recipients.
5. Inspect relay/provider logs and payloads for zero mail content. Keep production company push disabled if any identity, permission, or callback gate fails.

The native preview currently has no EAS Update channel. `eas update:configure` could not configure its dynamic `app.config.js`, so installing `expo-updates` alone does not provide OTA updates. Configure and verify a distinct preview runtime/channel through the supported EAS workflow before promising automatic updates or publishing an OTA. No preview build or update has been released by this branch.
