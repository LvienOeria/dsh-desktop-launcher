import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANAGED_MARKER, PLUGIN_VERSION } from './constants.js'
import { appInfoPlist, appMacosExec, desktopEntry, launcherScript } from './templates.js'

/** Absolute path to this package's bundled icon assets (assets/icons). */
const ASSETS_ICONS = fileURLToPath(new URL('../assets/icons', import.meta.url))

/** Icon styles shipped with the plugin (all based on the official whale mark). */
export const ICON_STYLES = ['whale', 'whale-dark']

const VALID_ICON_STYLES = new Set(ICON_STYLES)

/** Expand a leading `~` to the home directory. */
export function expandHome(p) {
  if (typeof p !== 'string' || p === '') return p
  return p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}

/**
 * Fail loudly on malformed config before any file is touched. Zero
 * dependencies: plain type checks instead of a schema library (keeps the
 * bundle installable from any source — link:, git, or npm — with no fetch).
 * @param {unknown} raw config from cordis.yml (may be undefined)
 * @returns {object} the raw config object
 */
export function validateConfig(raw) {
  const config = raw && typeof raw === 'object' ? raw : {}
  const STRING_FIELDS = ['launcherName', 'url', 'startCommand', 'sourceDir', 'iconStyle', 'iconFile', 'installDir', 'desktopDir']
  const BOOLEAN_FIELDS = ['autoOpenBrowser']
  for (const key of STRING_FIELDS) {
    if (config[key] !== undefined && typeof config[key] !== 'string') {
      throw new Error(`config.${key} 必须是字符串，收到 ${typeof config[key]}`)
    }
  }
  for (const key of BOOLEAN_FIELDS) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') {
      throw new Error(`config.${key} 必须是布尔值，收到 ${typeof config[key]}`)
    }
  }
  if (config.url !== undefined && !/^https?:\/\//.test(config.url)) {
    throw new Error(`config.url 必须是 http(s) 地址: ${config.url}`)
  }
  if (typeof config.startCommand === 'string' && config.startCommand.includes('\n')) {
    throw new Error('config.startCommand 不能包含换行符')
  }
  return config
}

/** Fill every default (the bundle ships no schema, so defaults live here). */
export function normalizeConfig(raw) {
  const c = { ...(raw && typeof raw === 'object' ? raw : {}) }
  c.launcherName = c.launcherName || 'dsh'
  c.url = c.url || 'http://127.0.0.1:3080'
  c.startCommand = c.startCommand ?? ''
  c.sourceDir = c.sourceDir ? expandHome(c.sourceDir) : ''
  c.iconStyle = c.iconStyle || 'whale'
  c.iconFile = c.iconFile ? expandHome(c.iconFile) : ''
  c.installDir = expandHome(c.installDir || '~/.dsh-launcher-desktop')
  c.desktopDir = c.desktopDir
    ? expandHome(c.desktopDir)
    : process.platform === 'darwin'
      ? join(homedir(), 'Desktop')
      : ''
  c.autoOpenBrowser = c.autoOpenBrowser ?? true
  return c
}

/** The paths this installation owns, per platform. */
function artifactPaths(config, platform) {
  const p = {
    launcher: join(config.installDir, 'dsh-start.command'),
    state: join(config.installDir, 'state.json'),
  }
  if (platform === 'darwin') {
    p.app = join(config.desktopDir, `${config.launcherName}.app`)
  } else {
    p.appEntry = join(xdgDataHome(), 'applications', `${config.launcherName}.desktop`)
    p.icon = join(config.installDir, 'icons', `${config.iconStyle}.png`)
  }
  return p
}

function readState(installDir) {
  try {
    return JSON.parse(readFileSync(join(installDir, 'state.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Install (or refresh) the desktop launcher: the .command script and the
 * macOS .app bundle / Linux .desktop entry. Idempotent: when the resolved
 * state is unchanged and every owned artifact exists, it is a fast no-op.
 *
 * @param {object} rawConfig config from cordis.yml (may be undefined)
 * @returns {{ log: string[], changed: boolean, config: object }}
 */
export function installLauncher(rawConfig) {
  const log = []
  const platform = process.platform
  const openCmd = detectOpenCmd()
  if (!openCmd) {
    log.push(`⚠️  不支持的平台 ${platform} — 桌面启动器仅支持 macOS / Linux，本次未安装任何文件`)
    return { log, changed: false, config: {} }
  }

  // Fail loudly on malformed config before touching anything.
  validateConfig(rawConfig)
  const config = normalizeConfig(rawConfig)
  const paths = artifactPaths(config, platform)

  // Validate icon style / custom icon early and loudly (fail-before-write).
  const icon = resolveIconSource(config, platform, log)

  const startCommand = detectStartCommand(config, log)
  const state = { version: PLUGIN_VERSION, platform, startCommand, config }
  const hash = stateHash(state)

  const prev = readState(config.installDir)
  if (prev?.hash === hash && existsSync(paths.launcher)
    && (platform === 'darwin' ? existsSync(paths.app) : existsSync(paths.appEntry))) {
    log.push('已是最新（配置未变化），跳过')
    return { log, changed: false, config }
  }

  mkdirSync(config.installDir, { recursive: true })

  // 1) The launcher script.
  writeOwned(paths.launcher, launcherScript({
    url: shellQuote(config.url),
    startCommand,
    openCmd,
    autoOpenBrowser: config.autoOpenBrowser,
  }), log)
  chmodSync(paths.launcher, 0o755)

  // 2) The desktop artifact.
  if (platform === 'darwin') {
    buildAppBundle(paths.app, config, icon, log)
  } else {
    mkdirSync(dirname(paths.icon), { recursive: true })
    copyFileSync(icon.path, paths.icon)
    writeOwned(paths.appEntry, desktopEntry(config.launcherName, config.installDir, paths.icon), log)
  }

  // 3) Record state so the next boot is a no-op.
  writeFileSync(paths.state, JSON.stringify({ hash, ...state }, null, 2) + '\n')

  log.push(
    platform === 'darwin'
      ? `✅ 已安装：桌面应用「${config.launcherName}」(${paths.app})`
      : `✅ 已安装：桌面入口 ${paths.appEntry}`,
  )
  log.push('   启动命令: ' + startCommand)
  log.push('   URL: ' + config.url)
  return { log, changed: true, config }
}

/**
 * Resolve which shell command actually starts dsh, with a clear preference
 * order. Every branch returns a single-line snippet embedded in the launcher.
 *
 * 1. explicit config.startCommand
 * 2. config.sourceDir → `cd <dir> && pnpm dsh web`
 * 3. running from a source checkout (cwd has package.json with a `dsh` script)
 * 4. an installed `dsh` CLI on PATH outside our own binDir (recursion guard)
 * 5. fallback `dsh --profile web` with a warning
 *
 * @param {object} config normalized config
 * @param {string[]} log log lines accumulate here
 */
export function detectStartCommand(config, log = []) {
  if (config.startCommand) {
    return config.startCommand
  }
  if (config.sourceDir) {
    const dir = expandHome(config.sourceDir)
    if (!existsSync(dir)) log.push(`⚠️  sourceDir 不存在: ${dir} — 启动命令可能无法工作`)
    return `cd ${shellQuote(dir)} && pnpm dsh web`
  }
  // Running from a source checkout whose package.json has a `dsh` script.
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    if (typeof pkg?.scripts?.dsh === 'string' && pkg.scripts.dsh.length > 0) {
      log.push(`检测到源码目录 ${process.cwd()}（scripts.dsh），使用 pnpm dsh web 启动`)
      return `cd ${shellQuote(process.cwd())} && pnpm dsh web`
    }
  } catch {
    /* not a source checkout — keep looking */
  }
  // An installed dsh CLI outside our own binDir.
  const cli = findRealCli(config)
  if (cli) {
    log.push(`检测到已安装的 dsh CLI: ${cli}`)
    return `${shellQuote(cli)} --profile web`
  }
  log.push(
    '⚠️  未检测到源码目录或已安装的 dsh CLI — 使用回退命令 `dsh --profile web`；'
    + '可通过 config.startCommand / config.sourceDir 显式指定',
  )
  return 'dsh --profile web'
}

/** `command -v dsh` from a login shell, ignoring results inside our own binDir. */
function findRealCli(config) {
  const binDir = expandHome(config.binDir ?? '~/.local/bin')
  const res = spawnSync('bash', ['-lc', 'command -v dsh 2>/dev/null || true'], { encoding: 'utf8' })
  const out = String(res.stdout ?? '').trim().split('\n')[0]
  if (!out) return null
  const abs = resolve(out)
  if (abs === binDir || abs.startsWith(`${binDir}/`) || abs.startsWith(`${binDir}\\`)) {
    return null // recursion guard: that would be our own wrapper
  }
  return abs
}

/** Browser-open command per platform, or null when unsupported. */
export function detectOpenCmd() {
  if (process.platform === 'darwin') return 'open'
  if (process.platform === 'linux') return 'xdg-open'
  return null
}

/** XDG data home for Linux desktop entries (~/.local/share). */
function xdgDataHome() {
  return process.env.XDG_DATA_HOME ? expandHome(process.env.XDG_DATA_HOME) : join(homedir(), '.local', 'share')
}

/** Short deterministic hash of a state object. */
export function stateHash(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16)
}

/** Shell single-quote a string for safe embedding in generated scripts. */
export function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/**
 * Pick the icon source: a bundled whale style PNG, or a user-supplied custom
 * icon (config.iconFile). Returns `{ path, kind }` where kind is 'png' or
 * 'icns'. macOS needs a .icns inside the app bundle, so a PNG source is
 * converted on the fly with the built-in `sips` + `iconutil` (zero extra
 * dependencies, and only ~140 KB of PNGs ships in the package). Throws
 * loudly on anything unusable.
 */
function resolveIconSource(config, platform, log) {
  if (config.iconFile) {
    if (!existsSync(config.iconFile)) {
      throw new Error(`config.iconFile 不存在: ${config.iconFile}`)
    }
    const kind = config.iconFile.toLowerCase().endsWith('.icns') ? 'icns' : 'png'
    if (platform === 'linux' && kind === 'icns') {
      throw new Error(`Linux 需要 .png 图标，收到 .icns: ${config.iconFile}`)
    }
    log.push(`使用自定义图标: ${config.iconFile}`)
    return { path: config.iconFile, kind }
  }
  if (!VALID_ICON_STYLES.has(config.iconStyle)) {
    throw new Error(`config.iconStyle 无效: ${config.iconStyle}（可选: ${ICON_STYLES.join(', ')}）`)
  }
  const path = join(ASSETS_ICONS, `${config.iconStyle}.png`)
  if (!existsSync(path)) {
    throw new Error(`内置图标缺失: ${path}`)
  }
  return { path, kind: 'png' }
}

/**
 * Generate a .icns from a 1024px PNG using macOS built-ins: `sips` resizes
 * the iconset entries, `iconutil` packs them. Throws on failure.
 */
function generateIcnsFromPng(pngPath, icnsPath, log) {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-launcher-icns-'))
  try {
    const iconset = join(tmp, 'icon.iconset')
    mkdirSync(iconset, { recursive: true })
    for (const s of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const size = s * scale
        const name = scale === 1 ? `icon_${s}x${s}.png` : `icon_${s}x${s}@2x.png`
        const r = spawnSync('sips', ['-z', String(size), String(size), pngPath, '--out', join(iconset, name)], { encoding: 'utf8' })
        if (r.status !== 0) throw new Error(`sips 失败: ${r.stderr || r.error?.message}`)
      }
    }
    const r = spawnSync('iconutil', ['-c', 'icns', iconset, '-o', icnsPath], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`iconutil 失败: ${r.stderr || r.error?.message}`)
    log.push('已用系统工具 (sips + iconutil) 生成 .icns 图标')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * Write a file this plugin owns. If an existing file at the target lacks the
 * managed marker, back it up to `<path>.bak` first and warn.
 */
function writeOwned(path, content, log) {
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8')
    if (!existing.includes(MANAGED_MARKER)) {
      const bak = `${path}.bak`
      copyFileSync(path, bak)
      log.push(`⚠️  ${path} 已存在且不是本插件生成 — 已备份到 ${bak}`)
    }
  }
  writeFileSync(path, content)
}

/**
 * Build the macOS .app bundle (idempotent replace; marker-guarded). The icon
 * is a PNG source converted to .icns on the fly, or a ready-made custom
 * .icns copied verbatim.
 */
function buildAppBundle(appDir, config, icon, log) {
  const macosDir = join(appDir, 'Contents', 'MacOS')
  const resDir = join(appDir, 'Contents', 'Resources')
  const marker = join(resDir, '.dsh-launcher-marker')
  if (existsSync(appDir) && !existsSync(marker)) {
    const bak = `${appDir}.bak`
    rmSync(bak, { recursive: true, force: true })
    cpSync(appDir, bak, { recursive: true })
    log.push(`⚠️  桌面已存在同名应用 ${appDir} — 已备份到 ${bak}`)
  }
  rmSync(appDir, { recursive: true, force: true })
  mkdirSync(macosDir, { recursive: true })
  mkdirSync(resDir, { recursive: true })
  writeFileSync(join(appDir, 'Contents', 'Info.plist'), appInfoPlist(config.launcherName, PLUGIN_VERSION))
  const execPath = join(macosDir, 'launcher')
  writeFileSync(execPath, appMacosExec(config.installDir))
  chmodSync(execPath, 0o755)
  const icnsPath = join(resDir, 'dsh.icns')
  if (icon.kind === 'icns') {
    copyFileSync(icon.path, icnsPath)
  } else {
    generateIcnsFromPng(icon.path, icnsPath, log)
  }
  writeFileSync(marker, PLUGIN_VERSION + '\n')
}
