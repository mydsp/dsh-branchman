// Cross-platform test runner: `npm test`.
//
// Runs every suite in its own node process (so a suite that exits non-zero
// cannot hide the others), prints a combined result, and cleans the scratch
// directory the suites create under test/.tmp.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
for (const [name, args] of [
  ['Compile tests', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.test.json']],
  ['Build production entries', ['scripts/build.mjs']],
]) {
  console.log(name)
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const suites = ['domain', 'contract', 'operations'].flatMap(kind =>
  readdirSync(join(ROOT, 'dist-test/test', kind)).filter(f => f.endsWith('.test.js')).map(f => join(ROOT, 'dist-test/test', kind, f)))
const result = spawnSync(process.execPath, ['--test', ...suites, join(HERE, 'runtime.mjs'),join(HERE,'browser-contract.mjs')], { cwd: ROOT, stdio: 'inherit' })
process.exit(result.status ?? 1)
