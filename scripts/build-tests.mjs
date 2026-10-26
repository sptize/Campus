// Compila las pruebas (TypeScript) a tests/dist para ejecutarlas con `node --test`.
import { build } from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';
rmSync('tests/dist', { recursive: true, force: true });
const entries = readdirSync('tests').filter((f) => f.endsWith('.test.ts')).map((f) => 'tests/' + f);
await build({ entryPoints: entries, outdir: 'tests/dist', bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.test.mjs' }, logLevel: 'warning' });
