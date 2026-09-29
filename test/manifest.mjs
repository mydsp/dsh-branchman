// Offline pre-flight for the plugin manifest: runs the host's OWN validation
// rules against package.json and resolves every path/id it names, so a restart
// cannot fail on a manifest mistake (a failed client bundle used to make the
// app roll the whole plugin back).
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('..', import.meta.url))

// The host's own node_modules is needed only to prove that the package ids
// named by dsh.client.inject really exist. Point DSH_APP_MODULES at your DSH
// installation's resources/app/node_modules to run those checks; on a bare
// checkout (CI, a contributor without DSH) they report SKIP instead of FAIL.
const detectAppModules = () => {
  const candidates = [
    process.env.DSH_APP_MODULES,
    'C:/Program Files/DSH Desktop/resources/app/node_modules',
    '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules',
    process.env.LOCALAPPDATA === undefined
      ? undefined
      : join(process.env.LOCALAPPDATA, 'Programs', 'DSH Desktop', 'resources', 'app', 'node_modules'),
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '' && existsSync(candidate)) return candidate
  }
  return null
}
const APP_MODULES = detectAppModules()

let pass = 0
let fail = 0
let skip = 0
const skipped = (label, why) => { skip += 1; console.log(`  SKIP  ${label}${why ? ' — ' + why : ''}`) }
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`) }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`) }
}

const pkg = JSON.parse(await readFile(join(SRC, 'package.json'), 'utf8'))

// ── exports["./client"] (mirrors clientExportOf) ──────────────────────────
const exportsField = pkg.exports
const client = typeof exportsField === 'object' && exportsField !== null ? exportsField['./client'] : undefined
let clientPath
if (typeof client === 'string') clientPath = client
else if (typeof client === 'object' && client !== null && typeof client.default === 'string') clientPath = client.default
else if (client !== undefined) throw new Error(`exports["./client"] must be a string or an object with a string default`)

check('exports["./client"] 是字符串（宿主 clientExportOf 的要求）', typeof clientPath === 'string', JSON.stringify(client))
check('./client 指向的文件真实存在', clientPath !== undefined && existsSync(join(SRC, clientPath)), String(clientPath))
check('index.js 存在', existsSync(join(SRC, pkg.main ?? 'index.js')))
const clientStat = clientPath !== undefined ? await stat(join(SRC, clientPath)) : null
check('./client 不是空文件', (clientStat?.size ?? 0) > 500, `${clientStat?.size ?? 0} B`)

// ── dsh.client declaration (mirrors the host validator) ───────────────────
const decl = pkg.dsh?.client
check('dsh.client 已声明', decl !== undefined && decl !== null)
if (decl !== undefined) {
  check('platform 是字符串', typeof decl.platform === 'string', String(decl.platform))
  const injectOk = decl.inject === undefined || (Array.isArray(decl.inject) && decl.inject.every(i => typeof i === 'string'))
  check('inject（若存在）是字符串数组', injectOk, JSON.stringify(decl.inject))
  check('immediately（若存在）是布尔', decl.immediately === undefined || typeof decl.immediately === 'boolean', String(decl.immediately))
  for (const id of decl.inject ?? []) {
    if (APP_MODULES === null) {
      skipped(`inject 指向真实模块 ${id}`, '未找到 DSH 安装，设 DSH_APP_MODULES 可运行此项')
      continue
    }
    const known = existsSync(join(APP_MODULES, ...id.split('/')))
    check(`inject 指向真实模块 ${id}`, known)
  }
}

// ── the bundle id must match the package name the host keyed the entry by ──
const clientSrc = await readFile(join(SRC, clientPath), 'utf8')
const idMatch = clientSrc.match(/id:\s*'([^']+)'/)
check('client bundle 注册的 id 与包名一致', idMatch?.[1] === pkg.name, `${idMatch?.[1]} vs ${pkg.name}`)
check('client bundle 用 __ModuleLoader__.load 注册', clientSrc.includes('__ModuleLoader__.load('))

// ── bundle.patch resolves to the cordis patch ────────────────────────────
const patch = pkg.dsh?.bundle?.patch
check('dsh.bundle.patch 指向的文件存在', patch !== undefined && existsSync(join(SRC, patch)), String(patch))

console.log(`\n================  ${pass} passed, ${fail} failed${skip > 0 ? `, ${skip} skipped` : ''}  ================`)
process.exit(fail === 0 ? 0 : 1)
