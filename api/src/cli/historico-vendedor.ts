import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SyncService } from '../sync/sync.service';

/**
 * CARGA UNICA do historico de pedidos de um vendedor:
 *   npm run historico:vendedor -- 1400065          (12 meses)
 *   npm run historico:vendedor -- 1400065 540      (18 meses = 540 dias)
 *
 * Busca no SAP os pedidos e os itens dos ultimos N dias da carteira do vendedor e grava no Supabase
 * (janelas de 15 dias; leva alguns minutos). O app NAO baixa esses pedidos antigos: so recebe os totais
 * por cliente/mes e por cliente/produto, entao o sync do dia a dia continua leve. Pode rodar de novo
 * (e idempotente). Depois da carga, o proximo sincronizar do app ja traz os 12 meses.
 */
async function main() {
  const cod = process.argv[2];
  const dias = Number(process.argv[3] ?? 365);
  if (!cod || !Number.isInteger(dias) || dias < 30 || dias > 1100) {
    console.error('Uso: npm run historico:vendedor -- <codvendedor> [dias=365]   (dias entre 30 e 1100)');
    process.exit(1);
  }

  // contexto sem HTTP: nao sobe servidor nem cron
  process.env.SYNC_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const sync = app.get(SyncService);

  try {
    console.log(`Carga de historico do vendedor ${cod}: ${dias} dias (pode levar alguns minutos)...\n`);
    const rota = await sync.sincronizarVendedor(cod);
    const r = await sync.rodar('historico', rota, () => sync.sincronizarPedidos(cod, rota, dias));
    if (r.ok) console.log(`\nOK: ${r.linhas} pedidos em ${(r.ms / 1000).toFixed(0)}s. Rota ${rota}. Sincronize o app para trazer os totais.`);
    else {
      console.error(`\nFALHOU: ${r.erro}`);
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main();
