// Roda test/db.test.ts contra um SQLite REAL (node:sqlite, embutido no Node 24), sem celular.
// O codigo do app e empacotado com esbuild; so as dependencias de React Native / Expo sao trocadas por
// substitutos minimos (expo-crypto -> node:crypto; @/lib/api -> stub controlado pelo teste).
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.join(raiz, '.test-out', 'db.test.mjs');

const substitutos = {
  'expo-crypto': `import { randomUUID } from 'node:crypto'; export { randomUUID };`,
  '@/lib/api': `
    export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
    export const api = (caminho, opcoes) => globalThis.__apiStub(caminho, opcoes);`,
};

await build({
  entryPoints: [path.join(raiz, 'test', 'db.test.ts')],
  outfile: saida,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  logLevel: 'warning',
  external: ['node:*'],
  plugins: [
    {
      name: 'substitutos-e-alias',
      setup(b) {
        b.onResolve({ filter: /^(expo-crypto|@\/lib\/api)$/ }, (a) => ({ path: a.path, namespace: 'sub' }));
        b.onLoad({ filter: /.*/, namespace: 'sub' }, (a) => ({ contents: substitutos[a.path], loader: 'js' }));
        // alias @/ -> src/
        b.onResolve({ filter: /^@\// }, async (a) => b.resolve('./' + a.path.slice(2), { resolveDir: path.join(raiz, 'src'), kind: a.kind }));
      },
    },
  ],
});

const r = spawnSync(process.execPath, ['--no-warnings', '--test', saida], { stdio: 'inherit' });
process.exit(r.status ?? 1);
