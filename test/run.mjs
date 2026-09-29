// Cross-platform test runner: `npm test`.
//
// Runs every suite in its own node process (so a suite that exits non-zero
// cannot hide the others), prints a combined result, and cleans the scratch
// directory the suites create under test/.tmp.
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, '.tmp')

const SUITES = [
  ['host tools — worktree/tree/status/merge/drop + guards', 'tools.mjs'],
  ['seeded fork — inherited history + agent preset + boundary', 'seeded.mjs'],
  ['client half — slots, buttons, dialogs, overview graph', 'client.mjs'],
  ['manifest pre-flight — host validation rules', 'manifest.mjs'],
]

const cleanup = () => { rmSync(TMP, { recursive: true, force: true }) }
cleanup()

let failed = 0
for (const [title, file] of SUITES) {
  console.log(`\n================ ${title} ================`)
  const result = spawnSync(process.execPath, [join(HERE, file)], { stdio: 'inherit' })
  if (result.status !== 0) failed += 1
}

cleanup()
if (failed > 0) {
  console.error(`\n${failed} suite(s) failed`)
  process.exit(1)
}
console.log('\nall suites passed')
