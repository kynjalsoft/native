# ZyndMail

ZyndMail is the iOS and Android mail app for ZyndPay's company mail and, later, authorized customers using compatible JMAP servers. This repository is the mobile app's canonical source: [kynjalsoft/zyndmail](https://github.com/kynjalsoft/zyndmail). It is based on [Bulwark Native](https://github.com/bulwarkmail/native) and remains licensed under AGPL-3.0-only.

The app uses React Native and Expo SDK 57. Its production bundle and package ID are `io.zyndpay.mail`, its EAS project is `e9054c93-18de-4d6a-bc34-38c020130b82`, and production JavaScript updates use the `production` channel. Those identities are independent of the GitHub repository name.

## Develop and validate

```bash
npm ci
npm test
npm run typecheck
npm run i18n:check
npx expo start
```

Expo Go does not include every native capability used by signed ZyndMail builds. Use an appropriate development or signed build for device behavior, especially notifications, biometrics and native attachments.

## Release and acceptance

EAS Build produces the signed [iOS TestFlight and Android artifacts](docs/ios-release.md). EAS Update delivers compatible JavaScript and assets, but a new signed binary is required when the native runtime changes. See the [production migration and acceptance checklist](docs/zyndmail-production-release.md) before describing a feature as live on devices. The separate ZyndPay repository owns the mail server, webmail and push relay.

## License and upstream

ZyndMail is based on Bulwark Native. Source attribution is recorded here; see [LICENSE](LICENSE) for the AGPL-3.0-only terms.
