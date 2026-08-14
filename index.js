import { installLauncher } from './lib/installer.js'

export const name = 'dsh-desktop-launcher'

/**
 * Runs once per harness boot (and again when the config hot-reloads).
 * Converges the desktop launcher state: regenerates the .command script and
 * the macOS .app / Linux .desktop entry whenever the resolved config
 * changed; otherwise it is a fast no-op. Failures are logged loudly but do
 * not take the harness down — dsh must still boot.
 *
 * `config` comes from the profile's cordis.patch.yml row (optional — every
 * field has a default; anything invalid fails loudly in validateConfig).
 */
export function apply(ctx, config) {
  try {
    const { log, changed, config: normalized } = installLauncher(config ?? {})
    for (const line of log) console.log(`[dsh-desktop-launcher] ${line}`)
    if (changed) {
      console.log(`[dsh-desktop-launcher] 启动器就绪 — 桌面「${normalized.launcherName}」可以双击启动了`)
    }
  } catch (error) {
    console.error('[dsh-desktop-launcher] ❌ 安装桌面启动器失败（请检查插件 config）：')
    console.error(error instanceof Error ? error.stack : String(error))
  }
}
