import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const file of ['index.html', 'style.css', 'app.js', 'lib', 'assets']) await cp(join(root, file), join(output, file), { recursive: true });
console.log('Built dist/ — static assets only, no runtime dependencies.');
