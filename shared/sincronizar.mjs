// Copia shared/ (fonte unica) para dentro de cada projeto, que continua compilando e publicando sozinho.
//   node ../shared/sincronizar.mjs          copia (use depois de editar algo em shared/)
//   node ../shared/sincronizar.mjs --check  so confere; falha (exit 1) se alguma copia divergir da fonte
// As copias levam um cabecalho "GERADO" e NAO devem ser editadas a mao: a proxima copia sobrescreve.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** fonte (dentro de shared/) -> destinos (relativos a raiz do repositorio) */
const DESTINOS = {
  'regras/incentivo.ts': ['app/src/domain/regras/incentivo.ts', 'api/src/pedidos/regras/incentivo.ts'],
  'regras/combo.ts': ['app/src/domain/regras/combo.ts', 'api/src/pedidos/regras/combo.ts'],
  'regras/preco.ts': ['app/src/domain/regras/preco.ts', 'api/src/pedidos/regras/preco.ts'],
  'pdf/pedidoPdf.ts': ['app/src/domain/pedidoPdf.ts', 'painel/src/pedidoPdf.ts'],
  'pdf/pdfLogos.ts': ['app/src/domain/pdfLogos.ts', 'painel/src/pdfLogos.ts'],
};

const cabecalho = (fonte) =>
  `// GERADO a partir de shared/${fonte}. NAO EDITE AQUI: altere a fonte e rode "npm run shared" (app ou api).\n`;
const normalizar = (s) => s.replace(/\r\n/g, '\n');

const checar = process.argv.includes('--check');
const divergentes = [];

for (const [fonte, destinos] of Object.entries(DESTINOS)) {
  const esperado = cabecalho(fonte) + normalizar(fs.readFileSync(path.join(raiz, 'shared', fonte), 'utf8'));
  for (const rel of destinos) {
    const alvo = path.join(raiz, rel);
    const atual = fs.existsSync(alvo) ? normalizar(fs.readFileSync(alvo, 'utf8')) : null;
    if (atual === esperado) continue;
    if (checar) {
      divergentes.push(rel);
    } else {
      fs.mkdirSync(path.dirname(alvo), { recursive: true });
      fs.writeFileSync(alvo, esperado);
      console.log(`copiado: ${rel}`);
    }
  }
}

if (checar) {
  if (divergentes.length) {
    console.error(`Copias fora de sincronia com shared/ (rode "npm run shared"):\n  ${divergentes.join('\n  ')}`);
    process.exit(1);
  }
  console.log('shared/: todas as copias estao em sincronia.');
}
