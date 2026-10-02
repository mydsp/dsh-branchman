import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
// A normal checkout is self-contained. An explicit shared tools directory
// remains supported for maintainers who keep SDKs outside their checkout.
const require = createRequire(join(root, 'package.json'));
const { build } = process.env.DSH_BUILD_TOOLS
  ? createRequire(join(resolve(process.env.DSH_BUILD_TOOLS), 'package.json'))('esbuild')
  : require('esbuild');
await build({ entryPoints: [join(root, 'src/host/runtime.ts')], outfile: join(root, 'index.js'), bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', sourcemap: false, legalComments: 'none' });
await build({ entryPoints: [join(root, 'src/client/entry.ts')], outfile: join(root, 'client.js'), bundle: true, platform: 'browser', format: 'iife', target: 'es2022', sourcemap: false, legalComments: 'none' });
console.log('Built actual host and browser plugin entries.');
