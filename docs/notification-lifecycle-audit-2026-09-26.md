# ZyndMail notification lifecycle audit — 2026-09-26

## Release status

**Client code verified locally; production delivery and display unqualified.** The live mail relay answered `GET https://mail.zyndpay.io/v1/push-health` with HTTP 200 and `{ "status": "ok" }` on 2026-09-26. It does not advertise `previewMode`. The sibling `zyndpay` draft PR #2585 implements encrypted sender/subject/snippet callbacks and exact-message references; its compatibility patch is in the isolated `zyndpay-mail-push-notifications` worktree. Those changes are not deployed. This workspace has no authenticated test mailbox, current signed iOS/Android build, or physical device. A health response proves route availability, not a registered subscription, provider receipt, or OS presentation.

| Stage | Client behavior after this audit | Evidence still needed |
| --- | --- | --- |
| Consent and registration | Staff alerts require the global email switch, staff OAuth identity, Expo permission, relay health, and a successful authenticated registration. A different staff subject's installation registration is revoked before re-enrollment. | Confirm production EAS environment, APNs/FCM credentials, exact signed app identity, and live registration/renewal. |
| Server event and relay | The company path accepts only an opaque `version`/`notificationRef` data payload; the independent non-company Android path uses JMAP delivery IDs and fetches mail locally. | Inspect Stalwart event, relay fanout, Expo handoff and provider receipt for the same canary. Qualify duplicate, delayed, missing and revoked events. |
| OS display | Generic staff alerts remain available when preview consent is off. Foreground staff previews require both opt-in and a successful registration with an explicitly preview-capable relay. Calendar reminders require the active non-company account and enabled setting. | Check iOS and Android foreground, background, terminated, lock screen, grouped tray, sound, badge, user-muted channel and Focus/Do Not Disturb. Background/terminated remote display is controlled by the OS and relay payload, not the JS handler. |
| Tap and navigation | Staff taps wait for auth, unlock and navigation, resolve an opaque reference on the relay, fetch the exact JMAP message and derive its current thread. Android non-company taps are queued across cold start/unlock, retain local and JMAP account identity, and reject old accountless taps. | Witness taps from every app state, shared mailbox, stale/deleted message, expired reference, offline retry, switch while locked, duplicate tap, and OS tray summary. |
| Preferences and removal | Global email off revokes staff registration; disabling previews dismisses presented staff alerts. Logout and account changes clear pending and presented calendar reminders. Non-company background alerts exclude current junk/trash/drafts/sent roles, scope duplicate IDs to local and JMAP accounts, and persist each successful native post. | Witness relay revocation and no subsequent delivery after opt-out, logout, two-device selective revoke, and lost-device operator revoke. |

## Changes made in the client

- Aligned staff push resolve parsing with the published `INBOX`/`ACCOUNT`/`MESSAGE` response shapes. The legacy `EMAIL` shape is accepted, but its thread hint is ignored; JMAP supplies the current thread. A missing message opens the inbox with explanation.
- Defaulted staff message previews to on for new installations, matching the requested experience. The preview switch remains unavailable while the live relay advertises only generic alerts. A preview-capable relay returns `previewMode: "sender-subject-snippet-v1"` from health and accepts `previews` on registration. Successful registration also gates foreground preview display in this process.
- Set the generic Android channel to default importance, private lock-screen visibility and no badge. A preview-capable relay uses the separate `mail-messages-v2` channel. Android retains user choices and much of a channel's original behavior once created, so upgrade devices require explicit observation.
- Synchronized the global email switch and company push UI; hid irrelevant calendar controls on company accounts; cleared already visible company alerts on revoke and preview opt-out.
- Scoped Android local push to one unambiguous account; separated native notification IDs and dedupe records by both local and JMAP account; excluded current junk/trash/drafts/sent roles; saved successful posts one by one. Propagated the JMAP account through the native tap intent for shared mailboxes. Account opt-out/removal clears delivered Android mail cards, and the headless task rechecks the setting before posting.
- Captured native Android taps before auth restoration and delayed navigation until unlock and navigator readiness. Accountless legacy taps are ignored because they cannot safely select a mailbox. Per-message taps verify the current JMAP message/thread; group-summary taps switch to the originating local account and open its inbox.
- Cleared future and already displayed calendar reminders on logout/account change, with a generation check so an in-flight schedule cannot recreate a canceled reminder.

## Relay rollout required for message previews and exact taps

The deployed relay still sends generic alerts and may resolve older references to the inbox. Draft PR #2585 has a new encrypted preview callback and a scoped message reference. The isolated compatibility patch makes its health endpoint advertise `previewMode: "sender-subject-snippet-v1"` and its resolve endpoint return the documented `MESSAGE` target. The app can then send `previews: true` on registration and fetch the exact message and current thread after a tap. Previously issued generic references without message identity cannot be retroactively mapped to an email.

The relay compatibility patch is saved as local commit `59151c3ae` on branch `codex/notification-preview-capability`, based on draft PR #2585. Its 18 relay tests pass. The relay must be reviewed, deployed, and exercised with actual incoming mail before these changes can be called live. Sender/subject/snippet text passes through Expo and APNs/FCM and may appear on the lock screen according to device settings. The JS foreground handler cannot prevent an already delivered background notification from appearing, so the relay enforces the preference. A preview opt-out replaces the rich subscription with an id-only one.

## Physical-device acceptance matrix

Run on a signed production-profile iOS build and Android build, with a non-sensitive company mailbox and a second authorized shared mailbox. Record build number, OS version, channel settings, event ID/time, relay registration/ref, provider receipt, device presentation and tap destination. Keep message content out of logs and screenshots used for incident reporting.

1. Fresh consent: deny, grant, later revoke in OS settings, token rotation, app reinstall; confirm status, renewal and no repeated permission prompt.
2. Delivery: personal and shared inbox; single and burst; unread/read elsewhere; junk filed at delivery; moved to trash before processing; duplicate or reordered events; offline arrival and reconnect.
3. Display: foreground, background and terminated; locked/unlocked; previews off; system preview hidden; Android generic and preview channel behavior; sound, vibration, badge, grouping and user-muted channel.
4. Tap: active account, other account, locked app, cold launch, shared account, deleted mail, expired ref, repeated tap, summary tap, and transient resolve/network failure.
5. Lifecycle: email switch off/on, preview off/on after a visible alert, staff-to-staff change, staff-to-personal change, logout, account removal, two devices with one revoked, lost-device server revoke.
6. Calendar: reminder fires when enabled; setting off; account change; logout; reminder already in tray; in-flight scheduling during change.

## Local verification

`npm run typecheck`, `npm test`, `npm run i18n:check`, and `npx expo export --platform ios --platform android` passed on 2026-09-26. The full suite includes focused staff registration/resolve, account routing, dedupe, mailbox role, foreground presentation and preference tests. Native Android compilation is a CI gate because this workspace has no Android SDK. Physical-device checks and live relay contract qualification remain open release gates.
