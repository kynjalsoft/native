const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const VERSION = fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim();

let COMMIT = process.env.GITHUB_SHA || '';
if (!COMMIT) {
  try {
    COMMIT = execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    COMMIT = 'dev';
  }
}
COMMIT = COMMIT.slice(0, 7);

// App Store Connect rejects a build whose CFBundleVersion it has already seen
// for this CFBundleShortVersionString, so this has to advance on every upload
// even when VERSION does not. CI passes the workflow run number; local builds
// fall back to 1 (never uploaded).
const IOS_BUILD_NUMBER = process.env.IOS_BUILD_NUMBER || '1';

module.exports = {
  expo: {
    name: 'ZyndMail Preview',
    slug: 'zyndmail-native-preview',
    owner: 'kynjal-softwares',
    // mailto: lets Android/iOS offer the app for mail links in other apps.
    scheme: ['zyndmailpreview', 'mailto'],
    version: VERSION,
    updates: {
      url: 'https://u.expo.dev/654a0262-9785-4753-8f37-9b0947b537a2',
      requestHeaders: { 'expo-channel-name': 'preview' },
    },
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
      dark: {
        image: './assets/splash-icon.png',
        backgroundColor: '#09090b',
      },
    },
    ios: {
      runtimeVersion: { policy: 'appVersion' },
      supportsTablet: true,
      bundleIdentifier: 'io.zyndpay.mail.preview',
      buildNumber: IOS_BUILD_NUMBER,
      config: {
        // The app only speaks HTTPS/TLS and uses platform crypto, which is
        // exempt. Declaring it here skips the manual export-compliance
        // questionnaire that otherwise blocks every TestFlight build.
        usesNonExemptEncryption: false,
      },
    },
    android: {
      runtimeVersion: '1.0.0',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#FFFFFF',
      },
      predictiveBackGestureEnabled: false,
      package: 'io.zyndpay.mail.preview',
      // The AsyncStorage database holds cached message bodies, the outbox and
      // the account registry; the platform backup would ship all of it to the
      // user's Google account. Credentials live in SecureStore (excluded by
      // its own rules) but the mail cache must not leave the device either.
      allowBackup: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      ['expo-build-properties', { ios: { deploymentTarget: '16.4', enableSceneSupport: true } }],
      'expo-secure-store',
      '@react-native-community/datetimepicker',
      'expo-localization',
      ['expo-notifications', { defaultChannel: 'mail-activity', color: '#C49A54' }],
      [
        'expo-camera',
        {
          cameraPermission:
            'ZyndMail uses the camera to scan sign-in QR codes shown in webmail.',
          // QR scanning never records audio; leaving the mic entry in would be
          // an unexplained permission in App Review.
          microphonePermission: false,
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission:
            'ZyndMail needs access to your photos so you can attach them to emails and set contact photos.',
          // Only launchImageLibraryAsync is used - no in-app capture.
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
    ],
    extra: {
      commit: COMMIT,
      eas: { projectId: '654a0262-9785-4753-8f37-9b0947b537a2' },
    },
  },
};
