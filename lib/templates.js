import { MANAGED_MARKER } from './constants.js'

/**
 * The launcher command script. Runs the resolved start command in the
 * background, polls the web UI URL, and opens the browser when it is ready.
 *
 * @param {object} o
 * @param {string} o.url             web UI URL to poll and open
 * @param {string} o.startCommand    single-line shell snippet that starts dsh
 * @param {string} o.openCmd         'open' (macOS) or 'xdg-open' (Linux)
 * @param {boolean} o.autoOpenBrowser open the browser once the URL responds
 */
export function launcherScript({ url, startCommand, openCmd, autoOpenBrowser }) {
  const open = autoOpenBrowser
    ? `${openCmd} "$DSH_URL" >/dev/null 2>&1 &`
    : ':'
  return `#!/bin/bash
# ============================================================
${MANAGED_MARKER}
#  dsh 桌面启动器 — 由插件自动生成，请勿手改。
#  要修改：编辑 profile 的 cordis.patch.yml 中 dsh-desktop-launcher 的 config。
# ============================================================
set -u

DSH_URL=${url}

# 已在运行？直接打开浏览器。
if curl -sf "$DSH_URL" >/dev/null 2>&1; then
  echo "✅ dsh 已在运行 → 打开浏览器"
  ${open}
  exit 0
fi

echo "🚀 正在启动 dsh ..."
echo "   地址: $DSH_URL"
echo "------------------------------------------------------------"

# 后台启动（沿用生成时解析出的启动命令）
( ${startCommand} ) &
SERVER_PID=$!

# 等待服务就绪（最长 120 秒），然后自动打开浏览器
for i in $(seq 1 120); do
  if curl -sf "$DSH_URL" >/dev/null 2>&1; then
    echo "✅ 服务已就绪 → 打开浏览器"
    ${open}
    break
  fi
  sleep 1
done

echo ""
echo "ℹ️  关闭本窗口即可停止 dsh（Ctrl+C 亦可）"
echo "------------------------------------------------------------"

wait "$SERVER_PID"
`
}

/**
 * The macOS .app bundle's executable: opens Terminal.app running the
 * launcher script. Quoting is handled by AppleScript's `quoted form of`.
 *
 * @param {string} installDir expanded launcher install directory
 */
export function appMacosExec(installDir) {
  return `#!/bin/bash
${MANAGED_MARKER}
# 双击此应用 = 在终端里运行 dsh 启动器。
LAUNCHER="${installDir}/dsh-start.command"
if [ ! -f "$LAUNCHER" ]; then
  echo "dsh-desktop-launcher: 缺少启动器脚本（$LAUNCHER）"
  echo "请先启动一次 dsh（确保已安装 dsh-desktop-launcher 插件）以生成它。"
  exit 1
fi
exec /usr/bin/osascript \\
  -e 'on run argv' \\
  -e 'tell application "Terminal"' \\
  -e 'do script "bash " & quoted form of item 1 of argv' \\
  -e 'activate' \\
  -e 'end tell' \\
  -e 'end run' \\
  "$LAUNCHER"
`
}

/**
 * Info.plist for the generated macOS .app bundle.
 * @param {string} launcherName display name (e.g. "dsh")
 * @param {string} version      plugin version
 */
export function appInfoPlist(launcherName, version) {
  const bundleId = `dev.dsh-launcher.${launcherName.toLowerCase().replace(/[^a-z0-9.-]+/g, '-') || 'app'}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${launcherName}</string>
  <key>CFBundleDisplayName</key>
  <string>${launcherName}</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>launcher</string>
  <key>CFBundleIconFile</key>
  <string>dsh</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`
}

/**
 * Linux .desktop entry (shown in the application menu; Terminal=true opens a
 * terminal running the launcher).
 * @param {string} launcherName display name
 * @param {string} installDir   expanded launcher install directory
 * @param {string} iconPath     absolute path to the style PNG
 */
export function desktopEntry(launcherName, installDir, iconPath) {
  return `[Desktop Entry]
Type=Application
Version=1.0
Name=${launcherName}
Comment=Start DeepSeek Harness (dsh)
Exec=bash -lc 'exec "${installDir}/dsh-start.command"'
Icon=${iconPath}
Terminal=true
Categories=Development;Utility;
StartupNotify=false
`
}
