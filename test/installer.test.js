import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  detectStartCommand,
  expandHome,
  installLauncher,
  normalizeConfig,
  shellQuote,
  stateHash,
  validateConfig,
} from '../lib/installer.js'

/** A real bundled whale PNG, usable as a custom iconFile on macOS (sips). */
const BUNDLED_PNG = fileURLToPath(new URL('../assets/icons/whale.png', import.meta.url))

const baseConfig = {
  launcherName: 'dsh',
  url: 'http://127.0.0.1:3080',
  startCommand: 'cd /tmp/fake-harness && pnpm dsh web',
  iconStyle: 'whale',
  installDir: '',
  desktopDir: '',
  autoOpenBrowser: true,
}

function tmpConfig() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-launcher-test-'))
  return {
    ...baseConfig,
    installDir: join(root, 'launcher'),
    desktopDir: join(root, 'desktop'),
    root,
  }
}

test('expandHome expands ~ and leaves absolute paths alone', () => {
  assert.equal(expandHome('~/x/y'), join(process.env.HOME, 'x/y'))
  assert.equal(expandHome('/abs/path'), '/abs/path')
})

test('shellQuote escapes single quotes', () => {
  assert.equal(shellQuote("it's a path"), `'it'\\''s a path'`)
  assert.equal(shellQuote('/plain/path'), "'/plain/path'")
})

test('stateHash is deterministic and sensitive to input', () => {
  const a = stateHash({ x: 1, y: [1, 2] })
  const b = stateHash({ x: 1, y: [1, 2] })
  const c = stateHash({ x: 1, y: [1, 3] })
  assert.equal(a, b)
  assert.notEqual(a, c)
})

test('detectStartCommand: explicit command wins', () => {
  const cmd = detectStartCommand({ startCommand: 'custom start', sourceDir: '/x' }, [])
  assert.equal(cmd, 'custom start')
})

test('detectStartCommand: sourceDir builds a pnpm command', () => {
  const cmd = detectStartCommand({ startCommand: '', sourceDir: '/src/dir' }, [])
  assert.equal(cmd, "cd '/src/dir' && pnpm dsh web")
})

test('validateConfig: rejects wrong types and bad values', () => {
  assert.throws(() => validateConfig({ launcherName: 42 }), /launcherName 必须是字符串/)
  assert.throws(() => validateConfig({ autoOpenBrowser: 'yes' }), /autoOpenBrowser 必须是布尔值/)
  assert.throws(() => validateConfig({ url: 'not-a-url' }), /url 必须是 http/)
  assert.throws(() => validateConfig({ startCommand: 'a\nb' }), /不能包含换行/)
  assert.deepEqual(validateConfig({ launcherName: 'dsh' }), { launcherName: 'dsh' })
  assert.deepEqual(validateConfig(undefined), {})
})

test('normalizeConfig fills every default (no schema in the bundle)', () => {
  const c = normalizeConfig({})
  assert.equal(c.launcherName, 'dsh')
  assert.equal(c.url, 'http://127.0.0.1:3080')
  assert.equal(c.startCommand, '')
  assert.equal(c.iconStyle, 'whale')
  assert.equal(c.autoOpenBrowser, true)
  assert.equal(c.installDir, join(process.env.HOME, '.dsh-launcher-desktop'))
  // user values win
  assert.equal(normalizeConfig({ launcherName: 'my-dsh', autoOpenBrowser: false }).launcherName, 'my-dsh')
  assert.equal(normalizeConfig({ launcherName: 'my-dsh', autoOpenBrowser: false }).autoOpenBrowser, false)
})

test('installLauncher: full macOS install, idempotent second run, reinstall on change', () => {
  const c = tmpConfig()
  const first = installLauncher(c)
  assert.equal(first.changed, true)
  assert.ok(first.log.some((l) => l.includes('✅ 已安装')))

  // launcher script is executable and contains the start command
  const launcher = join(c.installDir, 'dsh-start.command')
  assert.ok(existsSync(launcher))
  assert.ok(readFileSync(launcher, 'utf8').includes('cd /tmp/fake-harness && pnpm dsh web'))
  assert.ok(readFileSync(launcher, 'utf8').includes('managed by dsh-desktop-launcher'))

  // macOS .app bundle
  const app = join(c.desktopDir, 'dsh.app')
  assert.ok(existsSync(join(app, 'Contents', 'Info.plist')))
  assert.ok(existsSync(join(app, 'Contents', 'MacOS', 'launcher')))
  assert.ok(existsSync(join(app, 'Contents', 'Resources', 'dsh.icns')))
  assert.ok(existsSync(join(app, 'Contents', 'Resources', '.dsh-launcher-marker')))

  // state file
  const state = JSON.parse(readFileSync(join(c.installDir, 'state.json'), 'utf8'))
  assert.ok(typeof state.hash === 'string' && state.hash.length === 16)

  // second run: no-op
  const second = installLauncher(c)
  assert.equal(second.changed, false)
  assert.ok(second.log.some((l) => l.includes('跳过')))

  // changed config: reinstalls
  const third = installLauncher({ ...c, iconStyle: 'whale-dark' })
  assert.equal(third.changed, true)
})

test('installLauncher: backs up an unowned .app before replacing it', () => {
  const c = tmpConfig()
  const app = join(c.desktopDir, 'dsh.app')
  mkdirSync(join(app, 'Contents'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist>user made this</plist>')

  const result = installLauncher(c)
  assert.ok(existsSync(`${app}.bak`), 'unowned app should be backed up')
  assert.ok(result.log.some((l) => l.includes('备份')))
})

test('installLauncher: custom iconFile is honoured', () => {
  const c = tmpConfig()
  const custom = join(c.root, 'custom.png')
  copyFileSync(BUNDLED_PNG, custom)
  const result = installLauncher({ ...c, iconFile: custom })
  assert.ok(result.changed)
  assert.ok(result.log.some((l) => l.includes('自定义图标')))
  // a .icns was still produced inside the app bundle from the custom PNG
  assert.ok(existsSync(join(c.desktopDir, 'dsh.app', 'Contents', 'Resources', 'dsh.icns')))
})

test('installLauncher: invalid iconStyle fails loudly', () => {
  const c = tmpConfig()
  assert.throws(() => installLauncher({ ...c, iconStyle: 'rainbow' }), /iconStyle 无效/)
})

test('installLauncher: missing iconFile fails loudly', () => {
  const c = tmpConfig()
  assert.throws(() => installLauncher({ ...c, iconFile: '/nonexistent/icon.icns' }), /iconFile 不存在/)
})
