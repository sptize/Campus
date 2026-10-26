// Compila a dist/: app.js + app.css + sw.js (con lista de precache) + archivos públicos.
import { build, context } from 'esbuild';
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const serve = process.argv.includes('--serve');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/assets', { recursive: true });
cpSync('public', 'dist', { recursive: true });
cpSync('index.html', 'dist/index.html');

const common = { bundle: true, target: 'es2020', logLevel: 'info', define: { __DEV__: String(serve) } };
const appOpts = { ...common, entryPoints: { app: 'src/main.ts' }, outdir: 'dist/assets', minify: !serve, sourcemap: serve, format: 'iife' };

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

if (serve) {
  const ctx = await context(appOpts);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'dist', port: 5173 });
  console.log(`Servidor de desarrollo: http://localhost:${port}`);
} else {
  await build(appOpts);
  const files = walk('dist').map((p) => relative('dist', p).replaceAll('\\', '/')).filter((f) => f !== 'sw.js');
  const hash = createHash('sha256');
  for (const f of files.sort()) hash.update(f).update(readFileSync(join('dist', f)));
  const id = hash.digest('hex').slice(0, 10);
  const precache = ['./', ...files.map((f) => './' + f)];
  await build({ ...common, entryPoints: { sw: 'src/sw.ts' }, outdir: 'dist', minify: true, format: 'iife',
    define: { ...common.define, __PRECACHE__: JSON.stringify(precache), __CACHE__: JSON.stringify(`campuspocket-${pkg.version}-${id}`) } });
  writeFileSync('dist/build-info.json', JSON.stringify({ version: pkg.version, build: id }));
  console.log(`dist listo · versión ${pkg.version} · build ${id} · ${precache.length} archivos en caché offline`);
}
