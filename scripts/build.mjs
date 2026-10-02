import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
// Development tooling follows the user's E:\tools convention.
const tooling = process.env.DSH_BUILD_TOOLS ?? 'E:/tools/dsh-build-tools';
const { build } = createRequire(join(resolve(tooling), 'package.json'))('esbuild');
await build({ entryPoints: [join(root, 'src/host/runtime.ts')], outfile: join(root, 'index.js'), bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', sourcemap: false, legalComments: 'none' });
await build({ entryPoints: [join(root, 'src/client/entry.ts')], outfile: join(root, 'client.js'), bundle: true, platform: 'browser', format: 'iife', target: 'es2022', sourcemap: false, legalComments: 'none' });
console.log('Built actual host and browser plugin entries.');
