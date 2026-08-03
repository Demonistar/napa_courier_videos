/**
 * afterSign hook — conditionally notarizes the macOS app bundle.
 *
 * Notarization submits the signed .app to Apple's servers so that Gatekeeper
 * trusts it on any Mac, eliminating the "developer cannot be verified" warning.
 *
 * This hook runs automatically when electron-builder finishes code-signing on
 * macOS. It is a no-op unless all three Apple credentials are present in the
 * environment, so unsigned/local builds are unaffected.
 *
 * Required environment variables (all optional — build succeeds without them):
 *   APPLE_ID                   — Apple ID email used to log into developer.apple.com
 *   APPLE_APP_SPECIFIC_PASSWORD — app-specific password from appleid.apple.com
 *                                 (Account → Sign-In and Security → App-Specific Passwords)
 *   APPLE_TEAM_ID              — 10-character Team ID from
 *                                 developer.apple.com/account → Membership Details
 */

const path = require('path');

exports.default = async function notarizing(context) {
  // Only notarize on macOS
  if (context.electronPlatformName !== 'darwin') return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;

  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log(
      'Notarization skipped: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID ' +
      'must all be set to notarize. The app will work but Gatekeeper may warn on first launch.'
    );
    return;
  }

  const { notarize } = require('@electron/notarize');

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appName} (${appPath}) …`);

  await notarize({
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
    appPath,
  });

  console.log('Notarization complete.');
};
