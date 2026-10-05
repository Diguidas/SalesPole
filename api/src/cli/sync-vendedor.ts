import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SyncService } from '../sync/sync.service';

/**
 * Teste do caminho SAP -> Supabase sem precisar de login:
 *   npm run sync:vendedor -- 100409
 * Roda TODOS os syncs do vendedor/rota (vendedor, clientes, produtos, precos,
 * pedidos+itens, titulos, remessas, estoque) e mostra o resultado de cada um.
 */
async function main() {
  const cod = process.argv[2];
  if (!cod) {
    console.error('Uso: npm run sync:vendedor -- <codvendedor>');
    process.exit(1);
  }

  // contexto sem HTTP: nao sobe servidor nem cron
  process.env.SYNC_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const sync = app.get(SyncService);

  try {
    console.log(`Sincronizando vendedor ${cod}...\n`);
    const resultados = await sync.sincronizarTudo(cod);

    for (const r of resultados) {
      const tempo = `${(r.ms / 1000).toFixed(1)}s`;
      if (r.ok) console.log(`  OK     ${r.recurso.padEnd(10)} ${String(r.linhas ?? '').padStart(6)} linhas  ${tempo}`);
      else console.log(`  FALHOU ${r.recurso.padEnd(10)} ${tempo}\n         ${r.erro}`);
    }

    const falhas = resultados.filter((r) => !r.ok).length;
    console.log(falhas ? `\n${falhas} recurso(s) com erro.` : '\nTudo certo. Confira as tabelas no Supabase.');
    if (falhas) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main();
