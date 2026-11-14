import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [platform, device = platform === 'ios' ? 'booted' : 'emulator-5554'] = process.argv.slice(2);
const fixtureDir = resolve('mobile-engineer-kit/fixtures');
if (platform === 'android') {
  const adb = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools/adb') : 'adb';
  execFileSync(adb, ['-s', device, 'reverse', 'tcp:8787', 'tcp:8787'], { stdio: 'inherit' });
  execFileSync(adb, ['-s', device, 'push', `${fixtureDir}/.`, '/sdcard/Download/'], { stdio: 'inherit' });
} else if (platform === 'ios') {
  const container = execFileSync('xcrun', ['simctl', 'get_app_container', device, 'com.nikitasokolov.statementimport', 'data'], { encoding: 'utf8' }).trim();
  const target = join(container, 'Documents');
  mkdirSync(target, { recursive: true });
  for (const file of readdirSync(fixtureDir)) copyFileSync(join(fixtureDir, file), join(target, file));
  const groups = resolve(container, '../../../Shared/AppGroup');
  for (const group of readdirSync(groups)) {
    const metadata = join(groups, group, '.com.apple.mobile_container_manager.metadata.plist');
    if (!existsSync(metadata)) continue;
    const id = execFileSync('plutil', ['-extract', 'MCMMetadataIdentifier', 'raw', '-o', '-', metadata], { encoding: 'utf8' }).trim();
    if (id !== 'group.com.apple.FileProvider.LocalStorage') continue;
    const localFiles = join(groups, group, 'File Provider Storage');
    mkdirSync(localFiles, { recursive: true });
    for (const file of readdirSync(fixtureDir)) {
      const source = join(fixtureDir, file);
      const destination = join(localFiles, file);
      if (existsSync(destination) && !readFileSync(destination).equals(readFileSync(source))) throw new Error('An existing Files document differs from the fixture');
      copyFileSync(source, destination);
    }
  }
  console.log('Synthetic fixtures copied to Files / On My iPhone and Statement');
} else {
  throw new Error('Usage: node scripts/seed-fixtures.mjs android|ios [device]');
}
