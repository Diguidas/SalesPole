import { BadRequestException, Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/auth.guard';
import { VendedorLogado } from '../auth/vendedor.decorator';
import { VendedorLogado as Logado } from '../auth/vendedores.service';
import { PedidosService } from './pedidos.service';

const MAX_PEDIDOS_POR_PUSH = 50;
/** Tempo maximo chamando o SAP dentro de uma requisicao; o resto fica para o job de retentativa. */
const PRAZO_PUSH_MS = 25_000;

@Controller('pedidos')
@UseGuards(SupabaseAuthGuard)
export class PedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  /**
   * Envia pedidos criados no app (em ordem de criacao). Cada pedido e tratado
   * isoladamente: um invalido nao derruba os outros. Resposta: um resultado por
   * pedido, na mesma ordem. Reenviar o mesmo id e seguro (idempotente).
   *
   * Corpo: { "pedidos": [ { id, criado_no_app_em, cod_cliente, dt_entrega?,
   *   cond_pagamento?, ordem_compra_cliente?, endereco_entrega?, observacao?,
   *   duplicado_de?, itens: [ { produto, unidade, quantidade, preco? } ] } ] }
   */
  @Post('push')
  async push(@VendedorLogado() v: Logado, @Body() body: { pedidos?: unknown[] }) {
    const lista = body?.pedidos;
    if (!Array.isArray(lista) || lista.length === 0) {
      throw new BadRequestException('Envie { "pedidos": [ ... ] } com ao menos um pedido');
    }
    if (lista.length > MAX_PEDIDOS_POR_PUSH) {
      throw new BadRequestException(`No maximo ${MAX_PEDIDOS_POR_PUSH} pedidos por envio`);
    }

    const prazoAte = Date.now() + PRAZO_PUSH_MS;
    const resultados = [];
    for (const p of lista) {
      // sequencial de proposito: o original de um "duplicar" precisa chegar antes
      resultados.push(await this.pedidos.receber(v, p, prazoAte));
    }
    return { resultados };
  }

  /** Reenvia um pedido em 'erro' depois que o vendedor corrigiu o problema. */
  @Post(':id/reenviar')
  reenviar(@VendedorLogado() v: Logado, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.pedidos.reenviar(v, id);
  }
}
