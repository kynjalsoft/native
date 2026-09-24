// Single source of truth for "this feature only exists on some platforms", so
// the UI, the stores and the native bridges all agree on what is reachable.

/**
 * Production updates use EAS Update for compatible JS/assets and the signed
 * app distribution channel for native binaries. The GitHub-release APK
 * installer is not configured for this product and must not be offered.
 */
export const supportsSideloadUpdates = false;
