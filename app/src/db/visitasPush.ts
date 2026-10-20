import type { SQLiteDatabase } from 'expo-sqlite';
import { api } from '@/lib/api';
import { apagarFoto, lerFoto } from '@/lib/camera';
import { supabase } from '@/lib/supabase';
import { respostasDaVisita, type Visita, type VisitaFoto } from './visitas';

const BUCKET_FOTOS = 'visitas-fotos';

interface ResultadoVisita {
  id: string | null;
  /** ok | invalida | conflito */
  status: string;
  erros?: string[];
  distancia_m?: number | null;
  fora_do_raio?: boolean;
  sem_referencia?: boolean;
  validacao?: string;
}

interface PreparoFoto {
  status: string;
  erros?: string[];
  caminho?: string;
  token?: string;
}

/** Corpo que a API espera (snake_case; check-out so quando a visita ja foi concluida). */
function paraApi(v: Visita) {
  return {
    id: v.id,
    cod_cliente: v.cod_cliente,
    data_visita: v.data_visita,
    checkin_em: v.checkin_em,
    checkin_lat: v.checkin_lat,
    checkin_lng: v.checkin_lng,
    checkin_precisao_m: v.checkin_precisao_m,
    gps_falso: !!v.gps_falso,
    ...(v.status === 'concluida'
      ? { checkout_em: v.checkout_em, resultado: v.resultado, motivo_nao_venda: v.motivo_nao_venda, pedido_id: v.pedido_id, respostas: respostasDaVisita(v) }
      : {}),
    observacao: v.observacao,
  };
}

export interface ResumoEnvioVisitas {
  visitas: number;
  fotos: number;
  /** fotos que ficaram para a proxima rodada (sem rede, por exemplo) */
  fotosPendentes: number;
}

/**
 * Envia as visitas pendentes e depois as fotos (cada foto sobe DIRETO no Storage com um token que a API
 * gera). Reenviar e seguro (UUIDs). Falha de rede LANCA: o que nao foi enviado continua pendente.
 */
export async function enviarVisitas(db: SQLiteDatabase): Promise<ResumoEnvioVisitas> {
  const resumo: ResumoEnvioVisitas = { visitas: 0, fotos: 0, fotosPendentes: 0 };

  // 1) visitas (check-in e check-out)
  const pendentes = await db.getAllAsync<Visita>('SELECT * FROM visitas WHERE sincronizada = 0 ORDER BY checkin_em');
  if (pendentes.length) {
    const resp = await api<{ resultados: ResultadoVisita[] }>('/visitas/push', {
      method: 'POST',
      body: { visitas: pendentes.map(paraApi) },
      timeoutMs: 60_000,
    });
    for (const r of resp.resultados) {
      if (!r.id) continue;
      if (r.status === 'ok') {
        await db.runAsync(
          `UPDATE visitas SET sincronizada = 1, erro_envio = NULL,
                  distancia_m = COALESCE(?, distancia_m), fora_do_raio = COALESCE(?, fora_do_raio),
                  sem_referencia = COALESCE(?, sem_referencia), validacao = COALESCE(?, validacao)
            WHERE id = ?`,
          r.distancia_m ?? null, r.fora_do_raio === undefined ? null : r.fora_do_raio ? 1 : 0,
          r.sem_referencia === undefined ? null : r.sem_referencia ? 1 : 0, r.validacao ?? null, r.id,
        );
        resumo.visitas++;
      } else {
        // o servidor recusou (dados invalidos / conflito): nao adianta reenviar o mesmo; guarda o motivo
        await db.runAsync('UPDATE visitas SET sincronizada = 2, erro_envio = ? WHERE id = ?', (r.erros ?? []).join(' ') || 'Recusada pelo servidor.', r.id);
      }
    }
  }

  // 2) fotos das visitas que o servidor ja conhece
  const fotos = await db.getAllAsync<VisitaFoto>(
    `SELECT f.* FROM visita_fotos f JOIN visitas v ON v.id = f.visita_id
      WHERE f.enviada = 0 AND v.sincronizada = 1 ORDER BY f.tirada_em`,
  );
  for (const f of fotos) {
    const prep = await api<PreparoFoto>('/visitas/fotos/preparar', {
      method: 'POST',
      body: { id: f.id, visita_id: f.visita_id, tipo: f.tipo, tirada_em: f.tirada_em, lat: f.lat, lng: f.lng, tamanho_bytes: f.tamanho_bytes },
    });
    if (prep.status !== 'ok' || !prep.caminho || !prep.token) {
      resumo.fotosPendentes++;
      continue;
    }
    const conteudo = await lerFoto(f.uri);
    const { error } = await supabase.storage.from(BUCKET_FOTOS).uploadToSignedUrl(prep.caminho, prep.token, conteudo, { contentType: 'image/jpeg' });
    if (error) throw new Error(`Falha ao enviar a foto da visita: ${error.message}`);
    await api(`/visitas/fotos/${f.id}/confirmar`, { method: 'POST' });
    await db.runAsync('UPDATE visita_fotos SET enviada = 1 WHERE id = ?', f.id);
    apagarFoto(f.uri); // liberou o espaco do aparelho
    resumo.fotos++;
  }

  resumo.fotosPendentes = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM visita_fotos WHERE enviada = 0'))?.n ?? 0;
  return resumo;
}
