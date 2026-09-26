# ZyndMail lifecycle review and improvement roadmap

**Reviewed:** 2026-09-26 · **Source:** `b53f725` (`main`) · **Audience:** ZyndPay staff · **Priority:** trust and reliability

## Implementation update — 2026-09-26

The findings below describe the original source review. The following changes have since been made in this working tree:

| Finding | Current status | Evidence |
| --- | --- | --- |
| F1 | **Code fixed** | Company accounts no longer see or invoke the Trash/Junk empty-folder action. A policy regression test covers the company and non-company cases. |
| F2 | **Code gated; release qualification open** | Calendar, Contacts and Files top-level apps and their settings are hidden for company accounts; automatic contact/calendar fetch is skipped. They remain available for other accounts. Company exposure requires a separate scope and device acceptance decision. |
| F3 | **Open release gate** | Current source passes TypeScript, translation coverage, 1,099 tests (14 skipped), and iOS/Android Metro export. Expo SDK patch dependencies were aligned. The workspace still has no current signed artifacts or physical-device results. CI now runs translation coverage and both bundle exports. The notification lifecycle has a separate [audit and acceptance matrix](notification-lifecycle-audit-2026-09-26.md). |
| F4 | **Core mail improvement; device verification open** | The in-app text-size choice now affects inbox, thread, message body and compose styles. Its label describes that scope. Other screens continue to follow device text size; large-text and screen-reader layout still require device checks. |
| F5 | **Code fixed; device verification open** | Unsupported app destinations explain that the server/account lacks the capability and direct staff to their administrator. Capability-denied behavior still needs a live account witness. |
| F6 | **Documentation aligned** | The intentionally removed source/license links are no longer promised in README or release notes. Repository attribution and license remain. |
| F7 | **Guidance added; operational witness open** | Login and About & Data tell staff to use their established administrator/support channel and avoid sharing secrets or message content. The specific live escalation route, incident owner and deployed identity-provider help have not been verified. |

No physical iOS or Android acceptance, company mailbox, push, OTA, or support-response result is claimed by this update.

Expo Doctor now passes 20 of 21 checks. Its remaining warning is that the checked-in Android native project does not automatically receive `app.config.js` changes. The package, portrait orientation, URL schemes and backup setting are present in the Android manifest; any future native config edit still requires a manual Android review and build. `npm audit --omit=dev` reports a moderate transitive `uuid` advisory through Expo's `xcode` config tooling; its proposed automatic fix would downgrade Expo across SDK versions, so that change was not applied.

## Verdict and evidence boundary

The source is in good automated health: `npm test` passed 1,084 tests (14 skipped), `npm run typecheck` and `npm run i18n:check` passed, and Expo exported both iOS and Android bundles. These checks establish source and bundle health, not a usable or production-ready device experience.

**The live experience audit is incomplete.** This workspace has no installed build, Android SDK, physical device, authenticated EAS session, or test mailbox. GitHub has no ZyndMail release artifact. A companion operations record contains an older internal APK and iOS simulator build from commit `8c7a3a4`; those artifacts do not match this review's source and cannot qualify the current app. No current-flow screenshots or VoiceOver/TalkBack results were captured. The journey health below is a source-review status, not a claim that staff completed the task on a device.

Use three evidence labels throughout: **verified in source** means current code or a command run in this review; **recorded requirement** means a release or product document; **device unverified** means a real user path remains to be observed. The older parity checklist is a lead list, not proof that an item still fails; several entries have since been fixed.

## Journey map

| Step | Staff task | Source-review health | Current evidence and next witness |
| --- | --- | --- | --- |
| 1 | Install or replace the old client | **Conditional** | Migration requires a new binary, re-sign-in and saving unsaved old drafts first ([release notes](zyndmail-production-release.md)). Verify the actual staff notice and install path on both platforms. |
| 2 | Sign in and recover access | **Implemented; device unverified** | Login offers QR pairing, email discovery, manual server entry and browser handoff (`src/screens/LoginScreen.tsx`, `src/screens/login/ChooseStep.tsx`). Witness company Keycloak passkey/TOTP, cancellation, failed discovery and recovery guidance. |
| 3 | First sync and notification choice | **Implemented; device unverified** | The inbox can show cached mail while session restoration completes (`App.tsx`); push invitation is per account (`src/components/PushOnboardingPrompt.tsx`). Witness consent, denial, first-sync status and account scoping. |
| 4 | Find, triage and organize mail | **Implemented; one confirmed UX conflict** | Mail list and unified inbox exist. Company deletion is blocked by policy, but the Trash/Junk “Empty folder” banner remains visible (F1). Witness search, shared mailbox context, swipe and undo. |
| 5 | Read a thread and attachments | **Implemented; device unverified** | Thread and attachment views exist (`src/screens/EmailThreadScreen.tsx`). Witness long HTML, remote content, attachment open/share, older messages and notification routing against the exact server message. |
| 6 | Draft, send and recover uncertain outcomes | **Implemented; device unverified** | Compose, drafts, send undo and a persistent outbox exist. Witness process death, offline queue, ambiguous submission, identity choice and recipient observation before claiming safe sending. |
| 7 | Use calendar, contacts and files | **Present; scope decision needed** | All three are top-level tabs when the server advertises them (`App.tsx`). The company-first mobile specification excludes them from its *first* production release; qualify each for staff or gate it (F2). |
| 8 | Work offline and return to service | **Implemented; device unverified** | Offline cache, queued changes and refresh controls exist (`src/components/settings/AboutDataSettings.tsx`). Witness airplane mode, long outage, reconnect, stale data, low storage and failed-operation recovery. |
| 9 | Protect, switch and revoke accounts | **Implemented; device unverified** | Privacy cover, optional device lock and account management exist (`App.tsx`, `src/components/settings/AccountSettings.tsx`). Witness lock, biometric failure, token expiry, role revocation, switch and sign-out on device. |
| 10 | Update, get help and leave | **Partially evidenced** | EAS Update is configured, but physical OTA acceptance is open; support and migration communication require an operational witness (F3). Settings still has an empty source/license area while release docs say links are visible (F6). |

## Findings and recommended changes

Severity describes the effect **if the current source ships to company staff**. No finding below is presented as a reproduced device failure.

| ID | Priority | Evidence | Staff impact | Action and acceptance |
| --- | --- | --- | --- | --- |
| **F1 · Empty folder conflicts with company policy** | **P1** | **Verified in source:** `EmailListScreen.tsx:913–927` shows and invokes “Empty folder” without checking `companyNoDelete`; `jmap-client.ts:862` rejects its `Email/set #destroy` request. Other delete controls already hide for company accounts. | Staff are invited to confirm an action that must fail. | Hide the banner and block its handler for company accounts; keep non-company behavior. Add a company-policy regression test for the banner and direct action. |
| **F2 · First-release feature boundary is unclear** | **P1 decision gate** | **Verified in source:** `App.tsx:219–268` exposes Calendar, Contacts and Files when capabilities exist. **Recorded requirement:** the company mobile specification lists those flows outside its first production release. | Staff may use capabilities that have not passed the mail-focused acceptance matrix. | Use the current approved product scope as the release gate. If these apps are approved, add device and operational acceptance for each; otherwise hide them for company accounts until qualified. |
| **F3 · Current-device release evidence is missing** | **P0 release gate** | **Verified in this review:** no local device/build or EAS login; only an older preview artifact is recorded elsewhere. **Recorded requirement:** `docs/zyndmail-production-release.md:9–15` requires signed builds, physical login/send/lock, OTA and push delivery evidence. CI runs unit/type checks and Android compilation only (`.github/workflows/ci.yml`). | A green CI run cannot establish correct content, push, privacy or send behavior on current iOS and Android binaries. | Obtain current-source signed/internal builds and a synthetic company mailbox. Execute the matrix below on physical phones, record build IDs and redacted results, and keep broad release closed until it passes. |
| **F4 · Font-size preference has narrow reach** | **P2** | **Verified in source:** Appearance offers Small/Medium/Large (`AppearanceSettings.tsx:120–129`), but `useTypography()` is consumed by the mail list only; most screens use static typography tokens. | The setting may appear to work in the inbox but not in compose, reading, calendar, files or settings. OS text scaling may still help; its actual behavior needs device testing. | Apply the preference consistently to shared text primitives and major screens, then test largest OS text and the app's Large setting on both platforms with VoiceOver/TalkBack. |
| **F5 · Unavailable destinations lack a useful next step** | **P2** | **Verified in source:** `App.tsx:219–268` leaves unsupported app tabs visible but disabled; `SettingsScreen.tsx:288–326` marks unsupported sections “Unavailable.” | A staff member cannot tell whether access is missing, the server lacks a feature, or setup is incomplete. | Show an explanation and appropriate next step when a capability is unavailable, or remove its destination for company accounts where the feature is intentionally out of scope. Test with capability-denied accounts. |
| **F6 · About and release documentation disagree** | **P2 documentation/product decision** | **Verified in source:** `AboutDataSettings.tsx:27–28` defines source/license URLs, but `:212–215` renders an empty notice. **Recorded requirement:** README and release notes say attribution and license links appear in About. Commit `23c4966` deliberately removed those links. | Staff and release reviewers receive conflicting information about what the app discloses. | Confirm the approved About content, then align the UI and release documentation. Review the distribution/license obligation separately; this finding makes no legal conclusion. |
| **F7 · Help and incident handoff are not yet demonstrated** | **P1 operational gate** | **Recorded requirement:** the company mobile specification requires an incident owner and support path. The companion 2026-09-22 system audit reports that updated Keycloak sign-in help was not deployed. This review found troubleshooting controls in About & Data but no dedicated staff help route. | A locked-out user or someone facing a failed send may have no clear recovery route. | Confirm deployed sign-in help and provide one company support destination from login and authenticated settings, including safe diagnostic guidance. Test locked-out, revoked and offline cases without exposing mailbox content. |

**Strengths seen in source:** the company delete policy is enforced again at the request layer; account settings support selecting, switching and removing specific accounts; drafts/outbox and update deferral have dedicated logic and tests. These reduce risk but still need current-device and server witnesses.

## Prioritized work

### Phase 0 — qualify the current binary and service journey

1. Resolve **F3**: capture current commit, iOS/Android build IDs, app IDs, update runtime/channel and a synthetic staff account with a delegated mailbox. Use a physical phone per platform; old preview binaries do not count.
2. Capture numbered screenshots and notes for each journey step above, including empty, loading, error and denied-permission states. Compare selected message/account IDs to server truth without storing content in the evidence bundle. Run VoiceOver and TalkBack on sign-in, mail list, thread, compose, error and sign-out.
3. Witness the production path for Keycloak, mail submission, relay push, EAS Update, remote revocation, recovery and staff help. Record failures as a ranked register; do not infer delivery from a provider receipt or a green build.

### Phase 1 — remove trust and release blockers

1. Fix **F1** and verify company accounts never display or invoke destructive controls, including Trash/Junk emptying. Preserve allowed non-company behavior.
2. Resolve **F2** against the approved staff release scope. Gate unqualified modules or extend their test, support and operational coverage before exposure.
3. Resolve **F7** and the Step 1 migration communication. A staff member must know how to save old work, sign in again, recover access and report an uncertain send.
4. Close each current-device P0/P1 finding with a regression test plus a repeat physical-device witness. Keep broad availability blocked while any content-isolation, data-loss, duplicate-send, privacy or revocation failure remains.

### Phase 2 — improve daily usability and accessibility

1. Fix **F4** and **F5**; test large text, screen readers, touch targets, focus order, contrast and localization across the main staff journeys.
2. Use short staff task sessions to rank any remaining friction in inbox triage, search, reading, compose and account switching. Add only high-value feature gaps to the next increment; do not port webmail parity items by default.
3. Resolve **F6** and keep the release/runbook wording synchronized with what the app actually shows.

## Device acceptance matrix

Run each row on **physical iOS and Android** with the exact candidate build. Save step screenshots with a redacted note, build ID, OS version, account type and result. Re-run failed rows after changes.

| Scenario | Required result |
| --- | --- |
| New install and upgrade | Sign-in and migration advice are clear; unsaved old work is handled before replacement; no wrong cached account content appears. |
| Named and delegated login | Passkey/TOTP, cancellation, expiry and role changes lead to the correct account and visible recovery instructions. |
| Mail list, search and thread | Selected message and account match server truth; long HTML, older thread items and attachments remain usable. |
| Draft, send and offline recovery | Draft survives interruption; an ambiguous send is reconciled without an automatic duplicate; queued actions are visible and recoverable. |
| Push and notification tap | Foreground, background and terminated delivery reach the exact authorized message; denial, previews-off, account switch and revocation behave correctly. |
| Privacy and exit | Lock, privacy cover, biometric failure, sign-out and remote revocation hide or clear reachable local content as specified. |
| Accessibility and updates | Critical tasks complete with VoiceOver/TalkBack and large text; compatible OTA applies only while idle; native changes use a new binary. |

**Release bar:** no open P0/P1 trust finding; every critical row passes both platforms; company policy controls are consistent with server enforcement; support and rollback are rehearsed. Any unavailable witness stays marked **unverified**, never “passed.”
