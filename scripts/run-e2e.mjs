import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const [device = 'emulator-5554', ...requested] = process.argv.slice(2);
const cases = { happy: 'happy', lost: 'lost_ack', stale: 'stale_status', delete: 'delete_failure', invalid: 'happy', cancel: 'happy', large: 'happy' };
const platform = process.env.E2E_PLATFORM ?? 'android';
assert.ok(['ios', 'android'].includes(platform));
const names = requested.length ? requested : platform === 'ios' ? ['happy', 'invalid'] : Object.keys(cases);
const adb = process.env.ANDROID_HOME ? `${process.env.ANDROID_HOME}/platform-tools/adb` : 'adb';
const server = process.env.MOCK_URL ?? 'http://127.0.0.1:8787';
const executable = process.env.MAESTRO_BIN ?? 'maestro';

mkdirSync('evidence', { recursive: true });

async function request(path, body) {
  const response = await fetch(`${server}${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  assert.ok(response.ok);
  return response.json();
}

for (const name of names) {
  assert.ok(Object.hasOwn(cases, name), 'Unknown scenario');
  await request('/__test/reset', {});
  await request('/__test/scenario', { mode: cases[name] });
  console.log(`Running ${platform} ${name}`);
  const fixture = readFileSync(`mobile-engineer-kit/fixtures/statement.${platform === 'ios' && name === 'happy' ? 'pdf' : 'csv'}`);
  const digest = createHash('sha256').update(fixture).digest('hex');
  const previousFontScale = name === 'large' ? execFileSync(adb, ['-s', device, 'shell', 'settings', 'get', 'system', 'font_scale'], { encoding: 'utf8' }).trim() : '1.0';
  if (name === 'large') execFileSync(adb, ['-s', device, 'shell', 'settings', 'put', 'system', 'font_scale', '2.0']);
  let result;
  try {
    result = spawnSync(executable, ['--device', device, 'test', '--test-output-dir', `evidence/maestro-${platform}-${name}`, `e2e/${name}-${platform}.yaml`], {
      encoding: 'utf8',
      timeout: 600000,
      env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' },
    });
  } finally {
    if (name === 'large') execFileSync(adb, ['-s', device, 'shell', 'settings', 'put', 'system', 'font_scale', previousFontScale === 'null' ? '1.0' : previousFontScale]);
  }
  writeFileSync(`evidence/${platform}-${name}.txt`, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  assert.equal(result.status, 0, `${name}: ${result.error?.message ?? 'See evidence log'}`);
  const state = await request('/__test/state');
  writeFileSync(`evidence/${platform}-${name}-server.json`, `${JSON.stringify(state, null, 2)}\n`);
  const uploads = ['invalid', 'cancel'].includes(name) ? 0 : 1;
  assert.equal(state.stats.createRequests, uploads);
  assert.equal(state.stats.newJobs, uploads);
  assert.equal(state.stats.acceptedBytes, uploads * fixture.length);
  if (uploads) assert.equal(state.jobs[0].sha256, digest);
  if (name === 'delete') {
    assert.equal(state.stats.deleteRequests, 2);
    assert.equal(state.jobs[0].status, 'deleted');
  }
  if (['happy', 'large'].includes(name)) assert.equal(state.jobs[0].status, 'deleted');
  console.log(`Passed ${platform} ${name}: POST ${state.stats.createRequests}, jobs ${state.stats.newJobs}, DELETE ${state.stats.deleteRequests}`);
}
