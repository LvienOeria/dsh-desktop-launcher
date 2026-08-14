import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/** Package name (dsh-desktop-launcher). */
export const PLUGIN_NAME = pkg.name
/** Package version, kept in sync with package.json automatically. */
export const PLUGIN_VERSION = pkg.version

/**
 * Marker line embedded in every file this plugin generates. Files that
 * contain it are owned by the plugin and regenerated freely; files that do
 * not are backed up before being replaced.
 */
export const MANAGED_MARKER = `# managed by dsh-desktop-launcher v${PLUGIN_VERSION}`
