import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const nativeSetup = fileURLToPath(new URL('../scripts/prepare-native.mjs', import.meta.url));
const deviceScript = fileURLToPath(new URL('../scripts/ios-device.sh', import.meta.url));

test('native Info.plist preparation is idempotent for repeated iOS builds', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiye-ios-'));
  try {
    const plistPath = path.join(root, 'ios', 'App', 'App', 'Info.plist');
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, '<?xml version="1.0"?><plist version="1.0">\n<dict>\n<key>UIRequiredDeviceCapabilities</key><array><string>armv7</string></array>\n</dict>\n</plist>\n');
    execFileSync(process.execPath, [nativeSetup], { cwd: root });
    const first = fs.readFileSync(plistPath, 'utf8');
    assert.doesNotMatch(first, /<string>armv7<\/string>/);
    for (const key of ['NSAppTransportSecurity', 'UIFileSharingEnabled', 'LSSupportsOpeningDocumentsInPlace']) {
      assert.equal(first.split('<key>' + key + '</key>').length - 1, 1);
    }
    assert.match(first, /NSExceptionAllowsInsecureHTTPLoads/);
    execFileSync(process.execPath, [nativeSetup], { cwd: root });
    assert.equal(fs.readFileSync(plistPath, 'utf8'), first);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('iOS device helper has valid Bash syntax', { skip: process.platform === 'win32' }, () => {
  execFileSync('bash', ['-n', deviceScript]);
});
