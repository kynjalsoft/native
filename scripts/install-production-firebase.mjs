import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.EAS_BUILD_PLATFORM === 'android') {
  const source = process.env.GOOGLE_SERVICES_JSON;
  if (!source || !fs.existsSync(source)) {
    throw new Error('The production Android Firebase config is missing from this EAS build.');
  }

  const config = JSON.parse(fs.readFileSync(source, 'utf8'));
  const expectedProject = process.env.ZYNDMAIL_FIREBASE_PROJECT_ID;
  if (!expectedProject || !/^[a-z][a-z0-9-]+$/.test(expectedProject)) {
    throw new Error('The production Firebase project ID has not been configured.');
  }
  const packages = Array.isArray(config.client) ? config.client.map(
    (client) => client.client_info?.android_client_info?.package_name,
  ) : [];
  if (
    config.project_info?.project_id !== expectedProject ||
    packages.filter((name) => name === 'io.zyndpay.mail').length !== 1
  ) {
    throw new Error('The Firebase config does not belong to the production ZyndMail app.');
  }

  const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'google-services.json');
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o600);
  console.log('Installed verified production Android Firebase config for EAS Build.');
}
