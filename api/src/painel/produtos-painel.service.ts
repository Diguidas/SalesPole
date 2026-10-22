import { Escopo } from './escopo';
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase/supabase.module';

type Linha = Record<string, any>;

const POR_PAGINA_PRODUTOS = 48;
const POR_PAGINA_CLIENTES = 50;
const hojeSp = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const pagina = (p: unknown) => Math.max(1, Math.trunc(Number(p)) || 1);
const texto = (v: unknown, max = 80) => String(v ?? '').trim().replace(/[%_]/g, ' ').slice(0, max);
const exato = (v: unknown, max = 40) => String(v ?? '').trim().slice(0, max);
const num = (v: unknown) => (v == null ? null : Number(v));

/** Telas de Produtos e Listas de preco do painel (somente leitura). */
@Injectable()
export class ProdutosPainelService {
  constructor(@Inject(SUPABASE) private readonly sb: SupabaseClient) {}

  private cacheOpcoes: { em: number; dados: Record<string, Array<{ codigo: string; descricao: string; extra?: string | null }>> } | null = null;

  /**
   * Opcoes para escolher (nada digitado) nos descontos, avisos e perguntas: escritorio, canal, equipe, tipo de estabelecimento,
   * linha, grupo, categoria, marca e listas de preco (a lista sozinha, "L", ou a lista com o grupo de preco do cliente, "L.G").
   */
  async opcoesEscopo() {
    if (this.cacheOpcoes && Date.now() - this.cacheOpcoes.em < 10 * 60_000) return this.cacheOpcoes.dados;
    const { data, error } = await this.sb.rpc('fn_opcoes_painel');
    if (error) throw new Error(`fn_opcoes_painel: ${error.message}`);
    const linhas = (data ?? []) as Array<{ campo: string; codigo: string; descricao: string; extra: string | null }>;
    const de = (campo: string) =>
      linhas
        .filter((x) => x.campo === campo && x.codigo && !/^(n[aã]o usar|\[inativo\])/i.test((x.descricao ?? '').trim()))
        .map((x) => ({ codigo: x.codigo, descricao: x.descricao || x.codigo, extra: x.extra }))
        .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR', { numeric: true }));
    const nomeGrupo = new Map(de('grupo_preco').map((g) => [g.codigo, g.descricao]));
    const listas = await this.listasPreco();
    const lista_preco: Array<{ codigo: string; descricao: string }> = [];
    for (const l of listas) {
      lista_preco.push({ codigo: l.pltyp, descricao: l.descricao ? `${l.descricao} (todos os grupos)` : 'todos os grupos' });
      for (const x of l.grupos_lista) {
        const grupo = x.kdgrp;
        const nome = nomeGrupo.get(grupo);
        lista_preco.push({ codigo: `${l.pltyp}.${grupo}`, descricao: `${l.descricao ?? l.pltyp} · grupo ${grupo}${nome && nome !== grupo ? ` - ${nome}` : ''}` });
      }
    }
    const dados = {
      escritorio: de('escritorio'), canal: de('canal'), tipo_estabelecimento: de('tipo_estabelecimento'), equipe: de('equipe'),
      linha: de('linha'), grupo: de('grupo'), categoria: de('categoria'), marca: de('marca'), lista_preco,
    };
    this.cacheOpcoes = { em: Date.now(), dados };
    return dados;
  }

  async listarProdutos(f: { busca?: string; tipo?: string; situacao?: string; pagina?: string }) {
    const situacao = exato(f.situacao, 10);
    if (situacao && !['ativos', 'inativos'].includes(situacao)) throw new UnprocessableEntityException('situacao invalida');
    const tipo = exato(f.tipo, 10);
    if (tipo && !['FERT', 'HAWA', 'ZVAR'].includes(tipo)) throw new UnprocessableEntityException('tipo invalido');
    const pg = pagina(f.pagina);
    const { data, error } = await this.sb.rpc('fn_produtos_painel', {
      p_busca: texto(f.busca), p_tipo: tipo, p_situacao: situacao, p_limite: POR_PAGINA_PRODUTOS, p_offset: (pg - 1) * POR_PAGINA_PRODUTOS,
    });
    if (error) throw new Error(`fn_produtos_painel: ${error.message}`);
    const linhas = (data ?? []) as Linha[];
    return {
      pagina: pg,
      por_pagina: POR_PAGINA_PRODUTOS,
      total: linhas.length ? Number(linhas[0].total) : 0,
      itens: linhas.map((l) => ({ ...l, total: undefined })),
    };
  }

  /** Cadastro do produto + em quais listas ele tem preco (vigentes e vencidas). */
  async produto(codRaw: string) {
    const cod = exato(codRaw, 20);
    if (!cod) throw new UnprocessableEntityException('Codigo invalido');
    const { data: p, error } = await this.sb.from('produtos').select('*').eq('cod_produto', cod).maybeSingle();
    if (error) throw error;
    if (!p) throw new NotFoundException('Produto nao encontrado');
    const [l, g, listas] = await Promise.all([
      this.sb.from('precos_lista').select('pltyp,datab,datbi,kbetr,kpein,kmein,konwa,preco_kg,desconto_max').eq('cod_produto', cod),
      this.sb.from('precos_grupo').select('pltyp,kdgrp,datab,datbi,kbetr,kpein,kmein,konwa,preco_kg,desconto_max').eq('cod_produto', cod),
      this.listasPreco(),
    ]);
    for (const r of [l, g]) if (r.error) throw r.error;
    const nomes = new Map(listas.map((x) => [x.pltyp as string, x.descricao as string | null]));
    const hoje = hojeSp();
    const mapa = (x: Linha, origem: 'lista' | 'grupo') => ({
      pltyp: x.pltyp, lista: nomes.get(x.pltyp) ?? null, origem, grupo_cliente: x.kdgrp ?? null,
      preco: num(x.kbetr), por: num(x.kpein), unidade_preco: x.kmein ?? null, moeda: x.konwa ?? 'BRL', preco_kg: num(x.preco_kg),
      desconto_max: Number(x.desconto_max ?? 0), de: x.datab, ate: x.datbi, vigente: x.datab <= hoje && hoje <= x.datbi,
    });
    const precos = [...((l.data ?? []) as Linha[]).map((x) => mapa(x, 'lista')), ...((g.data ?? []) as Linha[]).map((x) => mapa(x, 'grupo'))]
      .sort((a, b) => Number(b.vigente) - Number(a.vigente) || String(a.pltyp).localeCompare(String(b.pltyp)) || String(a.grupo_cliente ?? '').localeCompare(String(b.grupo_cliente ?? '')));
    return { ...(p as Linha), ativo: precos.some((x) => x.vigente), precos };
  }

  async listasPreco() {
    const { data, error } = await this.sb.rpc('fn_listas_preco_painel');
    if (error) throw new Error(`fn_listas_preco_painel: ${error.message}`);
    const { data: gr, error: eg } = await this.sb.rpc('fn_listas_grupos_painel');
    if (eg) throw new Error(`fn_listas_grupos_painel: ${eg.message}`);
    const grupos = (gr ?? []) as Linha[];
    return ((data ?? []) as Linha[])
      // "00" sem nome e sem preco e so o cliente sem lista no SAP
      .filter((l) => !(l.pltyp === '00' && !l.descricao && Number(l.produtos) === 0))
      .map((l) => ({ pltyp: l.pltyp as string, descricao: (l.descricao as string) ?? null, clientes: Number(l.clientes), produtos: Number(l.produtos), grupos: Number(l.grupos),
        grupos_lista: grupos
          // so grupo com preco proprio vigente (sem ele o cliente paga o preco da lista)
          .filter((g) => g.pltyp === l.pltyp && Number(g.produtos) > 0)
          .map((g) => ({ kdgrp: g.kdgrp as string, descricao: (g.descricao as string) ?? null, produtos: Number(g.produtos), clientes: Number(g.clientes) }))
          .sort((x, y) => x.kdgrp.localeCompare(y.kdgrp, 'pt-BR', { numeric: true })),
      }));
  }

  /** Uma lista: produtos com preco (vigentes e vencidos) e a primeira pagina de clientes. */
  async listaPreco(pltyp: string, escopo: Escopo | null = null) {
    const cod = exato(pltyp, 5);
    if (!cod) throw new UnprocessableEntityException('Lista invalida');
    const lista = (await this.listasPreco()).find((l) => l.pltyp === cod);
    if (!lista) throw new NotFoundException('Lista de preco nao encontrada');
    const [l, g] = await Promise.all([
      this.sb.from('precos_lista').select('cod_produto,datab,datbi,kbetr,kpein,kmein,preco_kg,desconto_max').eq('pltyp', cod).limit(2000),
      this.sb.from('precos_grupo').select('kdgrp,cod_produto,datab,datbi,kbetr,kpein,kmein,preco_kg,desconto_max').eq('pltyp', cod).limit(2000),
    ]);
    for (const r of [l, g]) if (r.error) throw r.error;
    const linhas = [...((l.data ?? []) as Linha[]), ...((g.data ?? []) as Linha[])];
    const codigos = [...new Set(linhas.map((x) => x.cod_produto as string))];
    const prods = new Map<string, Linha>();
    for (let i = 0; i < codigos.length; i += 200) {
      const { data, error } = await this.sb.from('produtos').select('cod_produto,descricao,tipo_material,unidade,imagem_url').in('cod_produto', codigos.slice(i, i + 200));
      if (error) throw error;
      for (const p of (data ?? []) as Linha[]) prods.set(p.cod_produto, p);
    }
    const hoje = hojeSp();
    const produtos = linhas
      .map((x) => ({
        cod_produto: x.cod_produto as string, descricao: (prods.get(x.cod_produto)?.descricao as string) ?? null, tipo_material: prods.get(x.cod_produto)?.tipo_material ?? null,
        imagem_url: prods.get(x.cod_produto)?.imagem_url ?? null, origem: x.kdgrp != null ? 'grupo' : 'lista', grupo_cliente: x.kdgrp ?? null,
        preco: num(x.kbetr), por: num(x.kpein), unidade_preco: x.kmein ?? null, preco_kg: num(x.preco_kg), desconto_max: Number(x.desconto_max ?? 0),
        de: x.datab, ate: x.datbi, vigente: x.datab <= hoje && hoje <= x.datbi,
      }))
      .sort((a, b) => Number(b.vigente) - Number(a.vigente) || String(a.descricao ?? a.cod_produto).localeCompare(String(b.descricao ?? b.cod_produto), 'pt-BR'));
    return { ...lista, produtos_lista: produtos, clientes_lista: await this.clientesDaLista(cod, {}, escopo) };
  }

  async clientesDaLista(pltyp: string, f: { busca?: string; pagina?: string }, escopo: Escopo | null = null) {
    const cod = exato(pltyp, 5);
    const pg = pagina(f.pagina);
    const { data, error } = await this.sb.rpc('fn_clientes_da_lista', {
      p_pltyp: cod, p_busca: texto(f.busca), p_limite: POR_PAGINA_CLIENTES, p_offset: (pg - 1) * POR_PAGINA_CLIENTES, p_rotas: escopo?.rotas ?? null,
    });
    if (error) throw new Error(`fn_clientes_da_lista: ${error.message}`);
    const linhas = (data ?? []) as Linha[];
    return { pagina: pg, por_pagina: POR_PAGINA_CLIENTES, total: linhas.length ? Number(linhas[0].total) : 0, itens: linhas.map((x) => ({ ...x, total: undefined })) };
  }
}
