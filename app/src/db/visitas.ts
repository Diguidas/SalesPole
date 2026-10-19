import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { avaliarCheckin } from '@/domain/geo';

// Roteiro de visita (tudo local/offline; o envio ao servidor esta em visitasPush.ts).
// Regras: uma visita por cliente por dia; o check-in exige GPS e uma foto de FACHADA; para concluir,
// "vendeu" exige um pedido feito depois do check-in e "nao vendeu" exige o motivo digitado.

export interface Visita {
  id: string;
  cod_cliente: string;
  data_visita: string;
  /** em_andamento | concluida */
  status: string;
  checkin_em: string;
  checkin_lat: number | null;
  checkin_lng: number | null;
  checkin_precisao_m: number | null;
  gps_falso: number;
  distancia_m: number | null;
  fora_do_raio: number;
  sem_referencia: number;
  checkout_em: string | null;
  /** vendeu | nao_vendeu */
  resultado: string | null;
  motivo_nao_venda: string | null;
  observacao: string | null;
  pedido_id: string | null;
  /** pendente | validada | recusada (decidido no painel) */
  validacao: string | null;
  validacao_obs: string | null;
  /** 0 = precisa enviar | 1 = enviada | 2 = recusada pelo servidor (ver erro_envio) */
  sincronizada: number;
  erro_envio: string | null;
}

export interface VisitaFoto {
  id: string;
  visita_id: string;
  /** fachada | outra */
  tipo: string;
  uri: string;
  tirada_em: string;
  lat: number | null;
  lng: number | null;
  tamanho_bytes: number | null;
  enviada: number;
}

export const MAX_FOTOS_VISITA = 6;
export const MIN_MOTIVO = 3;

const agora = () => new Date().toISOString();

export function visitaDoClienteNoDia(db: SQLiteDatabase, cod: string, data: string) {
  return db.getFirstAsync<Visita>('SELECT * FROM visitas WHERE cod_cliente = ? AND data_visita = ? ORDER BY checkin_em DESC LIMIT 1', cod, data);
}

export function visitasDoDia(db: SQLiteDatabase, data: string) {
  return db.getAllAsync<Visita>('SELECT * FROM visitas WHERE data_visita = ? ORDER BY checkin_em', data);
}

export function fotosDaVisita(db: SQLiteDatabase, visitaId: string) {
  return db.getAllAsync<VisitaFoto>('SELECT * FROM visita_fotos WHERE visita_id = ? ORDER BY tirada_em', visitaId);
}

export interface FotoNova {
  uri: string;
  tamanhoBytes: number | null;
}

export interface InicioVisita {
  cod_cliente: string;
  /** AAAA-MM-DD, dia do roteiro (data local do aparelho) */
  data_visita: string;
  posicao: { lat: number; lng: number; precisaoM: number | null; falsa: boolean };
  /** coordenada do cliente no cadastro (null = sem referencia) */
  cliente: { lat: number | null; lng: number | null };
  fachada: FotoNova;
}

/**
 * Check-in: cria a visita com a posicao e a foto de fachada. Uma visita por cliente por dia: se ja existe,
 * devolve a existente (e NAO cria outra nem troca a foto).
 */
export async function iniciarVisita(db: SQLiteDatabase, n: InicioVisita): Promise<{ id: string; nova: boolean }> {
  const existente = await visitaDoClienteNoDia(db, n.cod_cliente, n.data_visita);
  if (existente) return { id: existente.id, nova: false };

  const id = Crypto.randomUUID();
  const av = avaliarCheckin(n.posicao, n.cliente);
  const tirada = agora();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO visitas (id, cod_cliente, data_visita, status, checkin_em, checkin_lat, checkin_lng, checkin_precisao_m, gps_falso,
                            distancia_m, fora_do_raio, sem_referencia, validacao, sincronizada)
       VALUES (?, ?, ?, 'em_andamento', ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', 0)`,
      id, n.cod_cliente, n.data_visita, tirada, n.posicao.lat, n.posicao.lng, n.posicao.precisaoM, n.posicao.falsa ? 1 : 0,
      av.distanciaM, av.foraDoRaio ? 1 : 0, av.semReferencia ? 1 : 0,
    );
    await db.runAsync(
      `INSERT INTO visita_fotos (id, visita_id, tipo, uri, tirada_em, lat, lng, tamanho_bytes, enviada) VALUES (?, ?, 'fachada', ?, ?, ?, ?, ?, 0)`,
      Crypto.randomUUID(), id, n.fachada.uri, tirada, n.posicao.lat, n.posicao.lng, n.fachada.tamanhoBytes,
    );
  });
  return { id, nova: true };
}

/** Foto extra durante a visita (a de fachada ja foi tirada no check-in). */
export async function adicionarFoto(
  db: SQLiteDatabase,
  visitaId: string,
  foto: FotoNova,
  posicao: { lat: number; lng: number } | null = null,
  tipo: 'fachada' | 'outra' = 'outra',
): Promise<void> {
  const n = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM visita_fotos WHERE visita_id = ?', visitaId))?.n ?? 0;
  if (n >= MAX_FOTOS_VISITA) throw new Error(`No máximo ${MAX_FOTOS_VISITA} fotos por visita.`);
  await db.runAsync(
    `INSERT INTO visita_fotos (id, visita_id, tipo, uri, tirada_em, lat, lng, tamanho_bytes, enviada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    Crypto.randomUUID(), visitaId, tipo, foto.uri, agora(), posicao?.lat ?? null, posicao?.lng ?? null, foto.tamanhoBytes,
  );
}

/** Pedido de VENDA do cliente feito depois do check-in (bonificacao nao conta como venda). */
export function pedidoDaVisita(db: SQLiteDatabase, v: Pick<Visita, 'cod_cliente' | 'checkin_em'>) {
  return db.getFirstAsync<{ id: string; codigo: string | null; status: string }>(
    `SELECT id, codigo, status FROM pedidos_app
      WHERE cod_cliente = ? AND status <> 'rascunho' AND tipo = 'venda' AND criado_em >= ?
      ORDER BY criado_em DESC LIMIT 1`,
    v.cod_cliente, v.checkin_em,
  );
}

export interface Conclusao {
  resultado: 'vendeu' | 'nao_vendeu';
  /** obrigatorio quando nao vendeu (digitado pelo vendedor) */
  motivo?: string;
  observacao?: string;
}

/** Check-out. Lanca Error com a mensagem para o vendedor se faltar algo. */
export async function concluirVisita(db: SQLiteDatabase, id: string, c: Conclusao): Promise<void> {
  const v = await db.getFirstAsync<Visita>('SELECT * FROM visitas WHERE id = ?', id);
  if (!v) throw new Error('Visita não encontrada.');
  if (v.status === 'concluida') throw new Error('Esta visita já foi concluída.');

  const fachada = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM visita_fotos WHERE visita_id = ? AND tipo = 'fachada'", id);
  if (!fachada?.n) throw new Error('Falta a foto da fachada.');

  let motivo: string | null = null;
  let pedidoId: string | null = null;
  if (c.resultado === 'nao_vendeu') {
    motivo = (c.motivo ?? '').trim();
    if (motivo.length < MIN_MOTIVO) throw new Error('Informe o motivo de não ter vendido.');
  } else {
    const p = await pedidoDaVisita(db, v);
    if (!p) throw new Error('Para concluir como "Vendeu", faça o pedido do cliente antes. Se não vendeu, escolha "Não vendeu" e informe o motivo.');
    pedidoId = p.id;
  }

  await db.runAsync(
    `UPDATE visitas SET status = 'concluida', checkout_em = ?, resultado = ?, motivo_nao_venda = ?, pedido_id = ?, observacao = ?,
                        sincronizada = 0, erro_envio = NULL
      WHERE id = ?`,
    agora(), c.resultado, motivo, pedidoId, c.observacao?.trim() || null, id,
  );
}

export interface ResumoVisitasDia {
  total: number;
  iniciadas: number;
  concluidas: number;
  vendeu: number;
}

/** "5 de 8 visitados, 3 com venda" para o resumo do dia (so conta clientes do roteiro de hoje). */
export async function resumoDoDia(db: SQLiteDatabase, data: string, clientesDoRoteiro: string[]): Promise<ResumoVisitasDia> {
  const visitas = (await visitasDoDia(db, data)).filter((v) => clientesDoRoteiro.includes(v.cod_cliente));
  return {
    total: clientesDoRoteiro.length,
    iniciadas: visitas.length,
    concluidas: visitas.filter((v) => v.status === 'concluida').length,
    vendeu: visitas.filter((v) => v.resultado === 'vendeu').length,
  };
}
