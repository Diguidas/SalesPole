import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { normCod, VendedorLogado } from '../auth/vendedores.service';
import { SUPABASE } from '../supabase/supabase.module';
import {
  BUCKET_FOTOS, diasDeFoto, distanciaM, MAX_FOTOS_POR_VISITA, raioVisitaM, validarFoto, validarVisita, type VisitaEntrada,
} from './visita.validacao';

interface VisitaRow {
  id: string;
  cod_vendedor: string;
  cod_cliente: string;
  data_visita: string;
  status: string;
  distancia_m: number | null;
  fora_do_raio: boolean;
  sem_referencia: boolean;
  validacao: string;
  validacao_obs: string | null;
}

export interface ResultadoVisita {
  id: string | null;
  /** ok | invalida | conflito */
  status: string;
  erros?: string[];
  visita_status?: string;
  distancia_m?: number | null;
  fora_do_raio?: boolean;
  sem_referencia?: boolean;
  validacao?: string;
  /** ja existe uma foto de fachada enviada (a fachada e obrigatoria para a visita valer) */
  fachada_enviada?: boolean;
}

export interface PreparoFoto {
  status: string;
  erros?: string[];
  /** caminho no bucket e dados para subir direto no Storage (uploadToSignedUrl) */
  caminho?: string;
  token?: string;
  signed_url?: string;
}

@Injectable()
export class VisitasService {
  private readonly logger = new Logger(VisitasService.name);

  constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) {}

  /** Cria o bucket privado das fotos se ainda nao existe (chamado na subida da API). */
  async garantirBucket(): Promise<void> {
    const { error } = await this.sb.storage.createBucket(BUCKET_FOTOS, {
      public: false,
      fileSizeLimit: 3_000_000,
      allowedMimeTypes: ['image/jpeg'],
    });
    if (error && !/already exists|duplicate/i.test(error.message)) {
      this.logger.warn(`Nao foi possivel criar o bucket ${BUCKET_FOTOS}: ${error.message}`);
    }
  }

  /**
   * Recebe UMA visita do app. Idempotente pelo id: o check-in (posicao, hora) nunca muda depois de gravado;
   * reenviar com o check-out preenchido conclui a visita. A distancia ao cliente e calculada AQUI.
   */
  async receber(v: VendedorLogado, raw: unknown): Promise<ResultadoVisita> {
    const val = validarVisita(raw);
    if (!val.ok) return { id: val.id, status: 'invalida', erros: val.erros };
    const p = val.visita;

    if (!v.rota) return { id: p.id, status: 'invalida', erros: ['Sincronize antes de registrar visitas'] };

    const codCliente = normCod(p.codCliente);
    const { data: naCarteira, error: eCart } = await this.sb
      .from('rota_clientes')
      .select('cod_cliente')
      .eq('rota', v.rota)
      .eq('cod_cliente', codCliente)
      .limit(1);
    if (eCart) throw eCart;
    if (!naCarteira?.length) return { id: p.id, status: 'invalida', erros: ['Cliente fora da carteira do vendedor'] };

    const existente = await this.buscar(p.id);
    if (existente && existente.cod_vendedor !== v.codVendedor) {
      return { id: p.id, status: 'conflito', erros: ['id ja usado por outro vendedor'] };
    }

    if (!existente) await this.inserir(v, p, codCliente);
    else if (existente.status !== 'concluida' && p.checkout) await this.concluir(p);
    // visita ja concluida: nada muda (o check-in e o resultado sao definitivos)

    const row = (await this.buscar(p.id))!;
    return this.visao(row);
  }

  /**
   * Registra a foto (metadados) e devolve o caminho + token para o app subir o arquivo DIRETO no Storage
   * (sem passar pela API e sem chave no celular).
   */
  async prepararFoto(v: VendedorLogado, raw: unknown): Promise<PreparoFoto> {
    const val = validarFoto(raw);
    if (!val.ok) return { status: 'invalida', erros: val.erros };
    const f = val.foto;

    const visita = await this.buscar(f.visitaId);
    if (!visita || visita.cod_vendedor !== v.codVendedor) return { status: 'invalida', erros: ['Visita nao encontrada'] };

    const { data: fotos, error: eF } = await this.sb.from('visita_fotos').select('id, caminho').eq('visita_id', f.visitaId);
    if (eF) throw eF;
    const jaExiste = (fotos ?? []).find((x) => (x as { id: string }).id === f.id) as { id: string; caminho: string } | undefined;
    if (!jaExiste && (fotos ?? []).length >= MAX_FOTOS_POR_VISITA) {
      return { status: 'invalida', erros: [`No maximo ${MAX_FOTOS_POR_VISITA} fotos por visita`] };
    }

    const caminho = jaExiste?.caminho ?? `${v.codVendedor}/${visita.data_visita}/${f.visitaId}/${f.id}.jpg`;
    if (!jaExiste) {
      const { error } = await this.sb.from('visita_fotos').insert({
        id: f.id,
        visita_id: f.visitaId,
        tipo: f.tipo,
        caminho,
        tirada_em: f.tiradaEm,
        lat: f.lat,
        lng: f.lng,
        tamanho_bytes: f.tamanhoBytes,
      });
      if (error) throw new Error(`registrar foto: ${error.message}`);
    }

    const { data, error } = await this.sb.storage.from(BUCKET_FOTOS).createSignedUploadUrl(caminho, { upsert: true });
    if (error || !data) throw new Error(`url de envio da foto: ${error?.message ?? 'sem resposta'}`);
    return { status: 'ok', caminho, token: data.token, signed_url: data.signedUrl };
  }

  /** O app terminou de subir o arquivo: marca a foto como enviada. */
  async confirmarFoto(v: VendedorLogado, fotoId: string): Promise<{ status: string }> {
    const { data, error } = await this.sb.from('visita_fotos').select('id, visita_id').eq('id', fotoId).maybeSingle();
    if (error) throw error;
    const foto = data as { id: string; visita_id: string } | null;
    if (!foto) return { status: 'invalida' };
    const visita = await this.buscar(foto.visita_id);
    if (!visita || visita.cod_vendedor !== v.codVendedor) return { status: 'invalida' };

    const { error: eU } = await this.sb.from('visita_fotos').update({ enviada_em: new Date().toISOString() }).eq('id', fotoId);
    if (eU) throw new Error(`confirmar foto: ${eU.message}`);
    return { status: 'ok' };
  }

  /**
   * Retencao: apaga do bucket as fotos enviadas ha mais de `dias`. O registro da visita e a validacao
   * ficam; so o arquivo some (removida_em). Devolve quantas apagou.
   */
  async limparFotosAntigas(dias = diasDeFoto()): Promise<number> {
    const corte = new Date(Date.now() - dias * 86_400_000).toISOString();
    let total = 0;
    for (let rodada = 0; rodada < 20; rodada++) {
      const { data, error } = await this.sb
        .from('visita_fotos')
        .select('id, caminho')
        .is('removida_em', null)
        .lt('enviada_em', corte)
        .limit(200);
      if (error) throw error;
      const lote = (data ?? []) as Array<{ id: string; caminho: string }>;
      if (!lote.length) break;

      const { error: eRem } = await this.sb.storage.from(BUCKET_FOTOS).remove(lote.map((f) => f.caminho));
      if (eRem) throw new Error(`apagar fotos antigas: ${eRem.message}`);
      const { error: eUpd } = await this.sb
        .from('visita_fotos')
        .update({ removida_em: new Date().toISOString() })
        .in('id', lote.map((f) => f.id));
      if (eUpd) throw new Error(`marcar fotos apagadas: ${eUpd.message}`);
      total += lote.length;
      if (lote.length < 200) break;
    }
    if (total) this.logger.log(`Retencao: ${total} foto(s) de visita com mais de ${dias} dias apagada(s)`);
    return total;
  }

  // ---------------------------------------------------------------------

  private async inserir(v: VendedorLogado, p: VisitaEntrada, codCliente: string) {
    // distancia do check-in ate o cliente (calculada no servidor: nao confia no aparelho)
    const { data: cli, error: eCli } = await this.sb.from('clientes').select('latitude, longitude').eq('cod_cliente', codCliente).maybeSingle();
    if (eCli) throw eCli;
    const c = cli as { latitude: number | string | null; longitude: number | string | null } | null;
    const cLat = c?.latitude === null || c?.latitude === undefined ? null : Number(c.latitude);
    const cLng = c?.longitude === null || c?.longitude === undefined ? null : Number(c.longitude);
    const semReferencia = cLat === null || cLng === null || !Number.isFinite(cLat) || !Number.isFinite(cLng);
    const distancia = semReferencia ? null : distanciaM(p.checkinLat, p.checkinLng, cLat as number, cLng as number);

    const { error } = await this.sb.from('visitas').insert({
      id: p.id,
      cod_vendedor: v.codVendedor,
      cod_cliente: codCliente,
      data_visita: p.dataVisita,
      status: p.checkout ? 'concluida' : 'em_andamento',
      checkin_em: p.checkinEm,
      checkin_lat: p.checkinLat,
      checkin_lng: p.checkinLng,
      checkin_precisao_m: p.checkinPrecisaoM,
      checkin_gps_falso: p.gpsFalso,
      distancia_m: distancia,
      fora_do_raio: distancia !== null && distancia > raioVisitaM(),
      sem_referencia: semReferencia,
      checkout_em: p.checkout?.em ?? null,
      resultado: p.checkout?.resultado ?? null,
      motivo_nao_venda: p.checkout?.motivo ?? null,
      pedido_id: p.checkout?.pedidoId ?? null,
      observacao: p.observacao,
      respostas: p.respostas,
    });
    if (error) throw new Error(`inserir visita: ${error.message}`);
  }

  private async concluir(p: VisitaEntrada) {
    if (!p.checkout) return;
    const { error } = await this.sb
      .from('visitas')
      .update({
        status: 'concluida',
        checkout_em: p.checkout.em,
        resultado: p.checkout.resultado,
        motivo_nao_venda: p.checkout.motivo,
        pedido_id: p.checkout.pedidoId,
        observacao: p.observacao,
        respostas: p.respostas,
      })
      .eq('id', p.id);
    if (error) throw new Error(`concluir visita: ${error.message}`);
  }

  private async buscar(id: string): Promise<VisitaRow | null> {
    const { data, error } = await this.sb.from('visitas').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`buscar visita: ${error.message}`);
    return (data as VisitaRow | null) ?? null;
  }

  private async visao(row: VisitaRow): Promise<ResultadoVisita> {
    const { data, error } = await this.sb.from('visita_fotos').select('id').eq('visita_id', row.id).eq('tipo', 'fachada').gte('enviada_em', '1970-01-01');
    if (error) throw error;
    return {
      id: row.id,
      status: 'ok',
      visita_status: row.status,
      distancia_m: row.distancia_m,
      fora_do_raio: row.fora_do_raio,
      sem_referencia: row.sem_referencia,
      validacao: row.validacao,
      fachada_enviada: (data ?? []).length > 0,
    };
  }
}
