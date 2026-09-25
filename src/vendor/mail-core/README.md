`sender-display.ts` is an exact source snapshot of
`kynjalsoft/zyndpay/frontend/libs/shared/mail-core/src/sender-display.ts`.
It is copied, not maintained as a second role-name map, because EAS builds this
native repository without the ZyndPay monorepo. Run
`node scripts/sync-sender-display.mjs` after the authoritative rule changes,
then `node scripts/sync-sender-display.mjs --check` with both workspaces present.

The helper only changes the visible From name. It does not prove which person
submitted delegated mail or change the JMAP identity, address, grant, or
envelope sender.
