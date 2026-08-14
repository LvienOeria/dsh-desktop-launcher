# dsh-desktop-launcher

[![npm version](https://img.shields.io/npm/v/dsh-desktop-launcher)](https://www.npmjs.com/package/dsh-desktop-launcher) [![npm downloads](https://img.shields.io/npm/dm/dsh-desktop-launcher)](https://www.npmjs.com/package/dsh-desktop-launcher) [![license](https://img.shields.io/npm/l/dsh-desktop-launcher)](https://github.com/LvienOeria/dsh-desktop-launcher/blob/main/LICENSE) [![GitHub stars](https://img.shields.io/github/stars/LvienOeria/dsh-desktop-launcher)](https://github.com/LvienOeria/dsh-desktop-launcher)

[English](https://github.com/LvienOeria/dsh-desktop-launcher/blob/main/README.en.md) | **中文**


一个轻量的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：安装一个**桌面双击启动器** —— macOS 上是带官方黑色鲸鱼图标的 `dsh.app`，Linux 上是 `dsh.desktop` 入口。双击它，Web UI 启动并自动打开浏览器。Everything is a plugin，这个插件本身就是一个 bundle。

**轻量：** 零依赖，包体积约 147 KB（主要是两张 1024px 图标 PNG；macOS 的 `.icns` 用系统内置 `sips` + `iconutil` 现生成）。只碰桌面侧 —— 不装终端命令、不动 PATH。终端版是独立的 [dsh-launcher](https://github.com/LvienOeria/dsh-launcher) 包，想要什么装什么，绝不捆绑。

## 它能做什么

以 bundle 方式加载后，插件的 `apply` 会在每次 harness 启动时**收敛**以下产物（幂等：配置没变就是快速空操作）：

| 产物 | 位置 | 说明 |
|---|---|---|
| 启动脚本 | `~/.dsh-launcher-desktop/dsh-start.command` | 启动 dsh → 轮询 Web UI 地址 → 就绪后自动打开浏览器 |
| macOS 应用 | `~/Desktop/dsh.app` | 双击即用，官方鲸鱼图标，在终端里运行启动器 |
| Linux 入口 | `~/.local/share/applications/dsh.desktop` | 应用菜单启动器（Terminal=true） |
| 图标 | 内置 `whale` / `whale-dark`（1024px PNG） | deepseek-harness 官方黑色鲸鱼 mark，白卡/深卡两种 |

## 安装

前置条件：`dsh` CLI + **pnpm ≥ 9**（harness 固定 pnpm 11 —— 版本旧的话执行 `corepack enable`）。

从 npm 安装：

```sh
dsh plugin --profile web add dsh-desktop-launcher
```

从 GitHub 安装 —— 纯 JS、**无构建步骤**，无需任何 allowlist：

```sh
dsh plugin --profile web add github:LvienOeria/dsh-desktop-launcher
```

本地路径安装也可以（零依赖）：

```sh
dsh plugin --profile web add ./dsh-desktop-launcher
```

然后启动一次 dsh，插件会自动生成启动器：

```sh
dsh --profile web      # 已安装 CLI
# 或
pnpm dsh web           # 源码目录（自动检测）
```

搞定。双击桌面的 **dsh**；关闭它打开的终端窗口即停止 harness。

## 自定义

编辑 profile 的 patch 层（`~/.dsh/profiles/<profile>/cordis.patch.yml`）—— 后层覆盖前层，patch 会整体替换某行的 `config`：

```yaml
- id: dsh-desktop-launcher
  config:
    launcherName: dsh                      # 桌面应用/入口名称
    iconStyle: whale-dark                  # whale | whale-dark
    iconFile: ''                           # 自定义图标文件绝对路径（.icns/.png）
    url: http://127.0.0.1:3080             # Web UI 地址（轮询 + 打开）
    sourceDir: /path/to/deepseek-harness   # 从源码目录执行 `pnpm dsh web`
    startCommand: ''                       # 完全自定义启动命令（单行）
    autoOpenBrowser: true
```

### 自定义图标

把任意 `.icns`（macOS）或 `.png`（Linux）放到任意位置，用 `iconFile` 指向它；macOS 上给 `.png` 会自动转成 `.icns`。内置的 `whale` / `whale-dark` 是官方 mark 的白卡/深卡版本；用 `python3 scripts/build-icons.py /path/to/deepseek-harness/apps/web/public/favicon.svg` 可从官方 favicon 重新生成（需要 Pillow + macOS 的 `sips`）。

### 启动命令的解析顺序

1. `startCommand`（显式指定）
2. `sourceDir` → `cd <目录> && pnpm dsh web`
3. 当前目录是带 `dsh` script 的源码检出
4. PATH 上已安装的 `dsh` CLI（防递归：绝不解析到我们自己的 wrapper）
5. 回退 `dsh --profile web`（带警告）

## 安全性设计

- 每个生成文件都带 `# managed by dsh-desktop-launcher vX` 标记；**没有**该标记的已有文件或应用会被先备份为 `<path>.bak` 再替换（绝不静默覆盖）。
- 配置未变 → 不重写任何文件（状态哈希存在 `~/.dsh-launcher-desktop/state.json`）。
- 非法配置（未知 `iconStyle`、`iconFile` 不存在、`url` 非 http(s)、`startCommand` 含换行）会响亮失败并给出清晰报错。
- 安装失败只打日志，绝不会拖垮 harness —— dsh 照常启动。

## 卸载

```sh
dsh plugin --profile web remove dsh-desktop-launcher
rm -rf ~/.dsh-launcher-desktop ~/Desktop/dsh.app
# Linux 上还有: ~/.local/share/applications/dsh.desktop
```

## 说明

- macOS 首次启动可能询问是否打开生成的应用 —— 那是 Gatekeeper，点「打开」即可。
- 鲸鱼 mark 来自 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（`apps/web/public/favicon.svg`），此处仅用作启动器图标。
- 想要终端命令而不是 / 或者同时要桌面应用？安装 [dsh-launcher](https://github.com/LvienOeria/dsh-launcher)。
- 不支持 Windows（不会安装任何文件，只打一条警告）。

## License

MIT —— 见 [LICENSE](LICENSE)。
