// 插件宿主最小回归：node tests/plugins.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const plugins = require('../features/plugins');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nailong-plugins-'));
const src = path.join(root, 'src');
const installDir = path.join(root, 'installed');
const stateFile = path.join(root, 'state.json');

function manifest(version) {
  return {
    id: 'demo-plugin',
    name: '演示插件',
    version,
    minAppVersion: '2.0.0',
    description: '演示',
    intro: { what: '它是干什么的', how: '点哪里', whatHappens: '会发生什么', ifFails: '失败了怎么办' },
    permissions: ['chat', 'kb'],
  };
}

function writeSrc(version) {
  fs.rmSync(src, { recursive: true, force: true });
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify(manifest(version)), 'utf8');
}

plugins.init(installDir, stateFile);

// 1. 合法 manifest
assert.deepStrictEqual(plugins.validateManifest(manifest('1.0.0')), []);

// 2. 简介四字段必填
const bad = manifest('1.0.0');
bad.intro.how = '';
assert.ok(plugins.validateManifest(bad).some((e) => e.includes('intro.how')));

// 3. 未知权限
const badPerm = manifest('1.0.0');
badPerm.permissions = ['root'];
assert.ok(plugins.validateManifest(badPerm).some((e) => e.includes('未知权限')));

// 4. 版本比较与兼容
assert.strictEqual(plugins.compareVersions('2.0.0', '1.9.9'), 1);
assert.strictEqual(plugins.compareVersions('1.0.0', '1.0.0'), 0);
assert.ok(plugins.isCompatible(manifest('1.0.0'), '2.0.0'));
assert.ok(!plugins.isCompatible(manifest('1.0.0'), '1.9.0'));

// 5. 安装 / 列出 / 启停 / 更新 / 卸载
writeSrc('1.0.0');
plugins.installFromDir(src);
let list = plugins.list('2.0.0');
assert.strictEqual(list.length, 1);
assert.strictEqual(list[0].version, '1.0.0');
assert.ok(list[0].enabled);
assert.ok(list[0].compatible);

plugins.setEnabled('demo-plugin', false);
assert.deepStrictEqual(plugins.enabledIds(), []);
plugins.setEnabled('demo-plugin', true);
assert.deepStrictEqual(plugins.enabledIds(), ['demo-plugin']);

writeSrc('1.1.0');
plugins.installFromDir(src);
list = plugins.list('2.0.0');
assert.strictEqual(list[0].version, '1.1.0');
assert.ok(fs.existsSync(path.join(installDir, '.bak-demo-plugin')), '更新应保留上一版备份');

plugins.remove('demo-plugin');
assert.strictEqual(plugins.list('2.0.0').length, 0);

fs.rmSync(root, { recursive: true, force: true });
console.log('plugins test OK');
