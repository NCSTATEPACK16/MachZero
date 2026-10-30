/**
 * Build the web game and copy it into the iOS app (npx cap sync ios), then set the app's build number to the
 * git commit count so every TestFlight upload gets a higher one. Run: npm run ios:sync
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
run('npm run build');
run('npx cap sync ios');

const build = execSync('git rev-list --count HEAD').toString().trim();
const pbx = 'ios/App/App.xcodeproj/project.pbxproj';
const before = readFileSync(pbx, 'utf8');
const after = before.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
if (after !== before) writeFileSync(pbx, after);
console.log(`\niOS app synced: version ${/MARKETING_VERSION = ([^;]+);/.exec(after)?.[1]} (build ${build}). Next: npm run ios:open, then Product → Archive.`);
