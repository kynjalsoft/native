import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// The ZyndPay mail-core file is authoritative. This native repo checks in an
// exact source snapshot so EAS can build without a sibling/private checkout.
const root = fileURLToPath(new URL('..', import.meta.url));
const source = process.env.ZYNDPAY_MAIL_CORE_SENDER_SOURCE
  || resolve(root, '../zyndpay/frontend/libs/shared/mail-core/src/sender-display.ts');
const target = resolve(root, 'src/vendor/mail-core/sender-display.ts');
const original = await readFile(source);
if (process.argv.includes('--check')) {
  const snapshot = await readFile(target);
  if (!snapshot.equals(original)) {
    throw new Error('Native sender display snapshot differs from ZyndPay mail-core. Run node scripts/sync-sender-display.mjs');
  }
} else {
  await writeFile(target, original);
}
