/**
 * withViroMainApplicationFix — repair the MainApplication.kt that the
 * `@reactvision/react-viro` config plugin corrupts on Expo SDK 52 / RN 0.76.
 *
 * The Viro plugin (dist/plugins/withViroAndroid.js) tries to register its
 * ReactViroPackage inside getPackages(), but its anchor only matches the OLD
 * template (`override fun getPackages(): List<ReactPackage> = PackageList(this).packages.apply { … }`).
 * The SDK 52 template uses the `val packages = …; return packages` form, so:
 *   1. its `data.replace(...)` rewrite finds nothing, and
 *   2. `insertLinesHelper(target, "// add(MyReactNativePackage())", data)` can't
 *      find that anchor either → findIndex() returns -1 → the slice math PREPENDS
 *      the `add(ReactViroPackage(...))` lines to the TOP of the file, above the
 *      `package` declaration → invalid Kotlin (the build fails in prebuild on EAS
 *      and at compileReleaseKotlin locally). It also injects BOTH AR + GVR because
 *      it reads `xRMode` (capital R/M) while app.config.js passes `xrMode`.
 *
 * This plugin runs LAST (declare it after "@reactvision/react-viro" in
 * app.config.js) and rewrites MainApplication.kt into a valid form:
 *   - package declaration first, imports next (keeps the Viro import),
 *   - the misplaced top-of-file `add(ReactViroPackage(...))` lines removed,
 *   - a single correct `packages.add(ReactViroPackage(ReactViroPackage.ViroPlatform.<P>))`
 *     per requested platform, inside getPackages() before `return packages`.
 * It is idempotent, so a re-run / re-prebuild keeps the file correct.
 *
 * NOTE: the Viro plugin's withDangerousMod does its fs read/write asynchronously
 * WITHOUT awaiting, so we let that settle before reading the file back.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const VALID_PLATFORMS = ['AR', 'GVR', 'OVR_MOBILE'];

/** Pure, idempotent repair of MainApplication.kt contents. */
function repairMainApplication(data, platforms) {
  const eol = data.includes('\r\n') ? '\r\n' : '\n';
  let lines = data.split(/\r?\n/);

  // 1. Drop the misplaced bare `add(ReactViroPackage(...))` lines the Viro plugin
  //    dumped at the top of the file (they have no `packages.` receiver prefix).
  lines = lines.filter((l) => !/^\s*add\(ReactViroPackage\(/.test(l));

  // 2. Drop any pre-existing (possibly duplicated/misplaced) packages.add(ReactViroPackage…)
  //    lines so we can re-insert exactly one canonical registration per platform.
  lines = lines.filter((l) => !/^\s*packages\.add\(ReactViroPackage\(/.test(l));

  // 3. Strip leading blank lines so the `package` declaration is the first line.
  while (lines.length && lines[0].trim() === '') lines.shift();

  let out = lines.join(eol);

  // 4. Ensure the Viro import is present (the Viro plugin normally adds it right
  //    after the package line; be defensive in case our strip ever removes it).
  if (!out.includes('import com.viromedia.bridge.ReactViroPackage')) {
    out = out.replace(
      /^(package [^\r\n]*)$/m,
      `$1${eol}${eol}import com.viromedia.bridge.ReactViroPackage`,
    );
  }

  // 5. Register the Viro package(s) correctly inside getPackages(), immediately
  //    before `return packages`, matching the surrounding indentation.
  const m = out.match(/^([ \t]*)return packages\b/m);
  if (m) {
    const indent = m[1];
    const adds = platforms
      .map((p) => `${indent}packages.add(ReactViroPackage(ReactViroPackage.ViroPlatform.${p}))`)
      .join(eol);
    out = out.replace(/^([ \t]*)return packages\b/m, `${adds}${eol}${indent}return packages`);
  }

  return out;
}

const withViroMainApplicationFix = (config, props = {}) => {
  // Resolve requested ViroPlatform(s); default to AR (this app's xrMode).
  let platforms = props.platforms || (props.platform ? [props.platform] : ['AR']);
  platforms = platforms.filter((p) => VALID_PLATFORMS.includes(p));
  if (!platforms.length) platforms = ['AR'];

  return withDangerousMod(config, [
    'android',
    async (config) => {
      const pkg = config.android && config.android.package;
      if (!pkg) return config;
      const dir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        ...pkg.split('.'),
      );
      const ktPath = path.join(dir, 'MainApplication.kt');

      // Let ViroReact's un-awaited async fs writes settle before we read. This mod
      // is ordered to run last in the dangerous chain (declared first in app.config.js),
      // so after this delay nothing else rewrites MainApplication.kt.
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (!fs.existsSync(ktPath)) return config; // (Java template — not used here)
      const before = fs.readFileSync(ktPath, 'utf8');
      const after = repairMainApplication(before, platforms);
      if (after !== before) fs.writeFileSync(ktPath, after, 'utf8');
      return config;
    },
  ]);
};

module.exports = withViroMainApplicationFix;
module.exports.repairMainApplication = repairMainApplication;
