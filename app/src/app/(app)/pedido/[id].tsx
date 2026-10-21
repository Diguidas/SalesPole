import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ProdutoCatalogo } from '@/db/catalogo';
import { infoProdutos, rotulo } from '@/db/catalogo';
import { feriadosDoCliente } from '@/db/feriados';
import { useDados, useTickAoFocar } from '@/db/hooks';
import { aplicarRegras, carregarIncentivos, classificacaoPorProduto } from '@/db/incentivos';
import {
  confirmarPedido, descartarPedido, duplicarPedidoApp, lerPedidoApp, salvarCampos, salvarItens, salvarTipo,
} from '@/db/pedidos';
import { reenviarNoServidor } from '@/db/push';
import { obterCliente } from '@/db/queries';
import {
  aplicarDesconto, definirDesconto, definirQuantidade, estimarTotal, precoParaEnvio, precoUnitarioFinal, removerItem, validarDesconto,
  type ItemPedido,
} from '@/domain/pedido';
import { HORA_CORTE, previsaoEntrega } from '@/domain/entrega';
import { avaliarCombos } from '@/domain/combo';
import { incentivoAplicavel, maxManual } from '@/domain/incentivo';
import { lerQuantidade, validarQuantidade } from '@/domain/quantidade';
import { dataBR, dataComDia, hojeISO, moeda, numero, textoFormas, textoPrazo } from '@/lib/format';
import { useSync } from '@/lib/sync-context';
import { Botao, Card, Carregando, Linha, Secao, Segmentado, Selo, Vazio } from '@/ui/components';
import { Dropdown } from '@/ui/Dropdown';
import { compartilharPdfPedido } from '@/db/pedidoPdf';
import { CombosResumo } from '@/ui/CombosResumo';
import { FotoProduto } from '@/ui/FotoProduto';
import { ModalQuantidade } from '@/ui/ModalQuantidade';
import { seloDoPedido } from '@/ui/status';
import { cor, espaco, raio } from '@/ui/theme';

export default function PedidoTela() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const { enviarPedidos } = useSync();

  const tick = useTickAoFocar();
  const [recarga, setRecarga] = useState(0);
  const dep = tick + recarga;
  const hoje = hojeISO();

  const { dados: pedido, carregando } = useDados((d) => lerPedidoApp(d, id), [id, dep]);
  const { dados: cliente } = useDados(async (d) => (pedido ? obterCliente(d, pedido.cod_cliente) : null), [pedido?.cod_cliente, dep]);
  const codigos = (pedido?.itens ?? []).map((i) => i.produto);
  const { dados: info } = useDados(
    async (d): Promise<Record<string, ProdutoCatalogo>> => (cliente && codigos.length ? infoProdutos(d, cliente.areas, codigos, hoje) : {}),
    [cliente?.cod_cliente, codigos.join(','), dep],
  );

  const { dados: incData } = useDados(
    async (d) => (cliente ? carregarIncentivos(d, cliente.cod_cliente, cliente.areas) : null),
    [cliente?.cod_cliente],
  );
  const { dados: tiposBon } = useDados((d) => d.getAllAsync<{ codigo: string; descricao: string | null }>('SELECT codigo, descricao FROM bonificacao_tipos ORDER BY codigo'), []);
  const { dados: centros } = useDados((d) => d.getAllAsync<{ codigo: string; descricao: string | null }>('SELECT codigo, descricao FROM centros_custo ORDER BY codigo'), []);

  const { dados: feriados } = useDados((d) => feriadosDoCliente(d, cliente?.endereco), [cliente?.cod_cliente]);

  const [oc, setOc] = useState('');
  const [obs, setObs] = useState('');
  const [just, setJust] = useState('');
  const [editando, setEditando] = useState<ItemPedido | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);

  useEffect(() => {
    if (pedido) {
      setOc(pedido.ordem_compra_cliente ?? '');
      setObs(pedido.observacao ?? '');
      setJust(pedido.justificativa ?? '');
    }
    // so ao abrir o pedido: depois o que o vendedor digita manda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido?.id]);

  const itens = useMemo(() => pedido?.itens ?? [], [pedido]);
  const rascunho = pedido?.status === 'rascunho';
  const infoPronta = info !== undefined;
  // combos: o que ja vale no carrinho e o que falta para fechar (so o rascunho; depois de enviado vale o que foi gravado)
  const combosAgora = useMemo(
    () => (rascunho && incData && pedido?.tipo !== 'bonificacao' ? avaliarCombos(incData.combos, itens, incData.ctx, classificacaoPorProduto(info ?? {})) : null),
    [rascunho, incData, itens, info, pedido?.tipo],
  );

  const problemas = useMemo(() => {
    const p: string[] = [];
    if (!itens.length) p.push('Adicione ao menos um produto.');
    if (cliente?.bloqueado) p.push('Cliente bloqueado: não é possível enviar pedido.');
    if (pedido?.tipo === 'bonificacao') {
      if (!pedido.tipo_bonificacao) p.push('Bonificação: escolha o tipo de bonificação.');
      if (!pedido.centro_custo) p.push('Bonificação: escolha o centro de custo.');
      if (just.trim().length < 5) p.push('Bonificação: informe a justificativa (para quem vai aprovar).');
    }
    if (!infoPronta) return p;
    for (const i of itens) {
      if (i.brinde) continue; // brinde de combo: gerado pelo app, sem regra de quantidade nem de desconto
      const prod = info?.[i.produto];
      const nome = prod?.descricao ?? i.produto;
      if (!prod) {
        p.push(`${nome}: produto fora do catálogo deste aparelho. Remova ou sincronize.`);
        continue;
      }
      if (!prod.disponivel) {
        p.push(`${nome}: o cliente não tem área de vendas para este tipo de produto.`);
        continue;
      }
      const q = lerQuantidade(i.quantidade);
      const msg = q === null ? 'quantidade inválida.' : validarQuantidade(q, prod.regra);
      if (msg) p.push(`${nome}: ${msg}`);
      // teto do item: o da lista, ou o maior liberado por incentivo por quantidade
      const msgDesc = validarDesconto(i.desconto ?? 0, Math.max(prod.preco?.descontoMax ?? 0, i.descontoLiberado ?? 0));
      if (msgDesc) p.push(`${nome}: ${msgDesc}`);
    }
    return [...new Set(p)]; // o mesmo aviso nao se repete (a lista usa o texto como chave)
  }, [itens, info, infoPronta, cliente, pedido, just]);

  const total = useMemo(() => {
    const precos = Object.fromEntries(
      Object.entries(info ?? {}).map(([k, v]) => [k, v.preco ? { valor: v.preco.valor, unidade: v.preco.unidade, descontoMax: v.preco.descontoMax } : undefined]),
    );
    return estimarTotal(itens, precos);
  }, [itens, info]);

  // bonificacao nao tem pedido minimo
  const bonificacao = pedido?.tipo === 'bonificacao';
  const minimo = bonificacao ? null : (cliente?.pedido_minimo ?? null);
  const abaixoDoMinimo = minimo !== null && minimo > 0 && itens.length > 0 && total.total < minimo;
  const faltaMinimo = abaixoDoMinimo && minimo !== null ? minimo - total.total : 0;

  if (carregando) return <Carregando />;
  if (!pedido) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Vazio icone="document-outline" texto="Pedido não encontrado neste aparelho." />
      </View>
    );
  }

  // prazo minimo de producao do pedido = o maior prazo entre os itens (1 ou 2 dias)
  const prazoDias = Math.max(1, ...itens.map((i) => info?.[i.produto]?.prazoDias ?? 1));
  // previsao: corte das 17h + prazo de producao + feriados. Pedido ja confirmado usa a hora em que foi feito;
  // depois de enviado, a data real vem do SAP (pedido.dt_entrega)
  const quando = rascunho ? new Date() : new Date(pedido.criado_em);
  const prev = pedido.dt_entrega
    ? null
    : previsaoEntrega(cliente?.dias_entrega ?? [], quando, prazoDias, feriados?.datas ?? new Set<string>());
  const entrega = pedido.dt_entrega ?? prev?.data ?? null;
  const itemMaisLento = prazoDias > 1 ? itens.find((i) => (info?.[i.produto]?.prazoDias ?? 1) === prazoDias) : undefined;
  const selo = seloDoPedido('app', pedido.status);
  const nomeCliente = cliente?.nome_fantasia || cliente?.razao_social || pedido.cod_cliente;
  const recarregar = () => setRecarga((r) => r + 1);

  /** Recalcula o desconto por incentivo para as quantidades atuais (antes de gravar e de enviar). */
  function ajustar(lista: ItemPedido[]): ItemPedido[] {
    return incData && info ? aplicarRegras(lista, info, incData, pedido?.tipo !== 'bonificacao').itens : lista;
  }

  async function gravar(novos: ItemPedido[]) {
    await salvarItens(db, id, ajustar(novos));
    recarregar();
  }

  /** Venda/bonificacao e os campos da bonificacao (gravados na hora). */
  async function mudarTipo(t: { tipo?: 'venda' | 'bonificacao'; tipo_bonificacao?: string | null; centro_custo?: string | null; justificativa?: string | null }) {
    if (!pedido) return;
    await salvarTipo(db, id, {
      tipo: t.tipo ?? pedido.tipo,
      tipo_bonificacao: t.tipo_bonificacao !== undefined ? t.tipo_bonificacao : pedido.tipo_bonificacao,
      centro_custo: t.centro_custo !== undefined ? t.centro_custo : pedido.centro_custo,
      justificativa: t.justificativa !== undefined ? t.justificativa : just,
    });
    recarregar();
  }

  const passo = (i: ItemPedido) => info?.[i.produto]?.regra.multiplo ?? 1;
  async function mudar(i: ItemPedido, sinal: 1 | -1) {
    const novo = Math.round(((lerQuantidade(i.quantidade) ?? 0) + sinal * passo(i)) * 1000) / 1000;
    if (novo <= 0) return gravar(removerItem(itens, i.produto, i.unidade));
    return gravar(definirQuantidade(itens, i.produto, i.unidade, novo));
  }

  async function salvarRascunhoCampos() {
    await salvarCampos(db, id, { ordem_compra_cliente: oc, observacao: obs });
  }

  function confirmarEnvio() {
    Alert.alert(
      'Enviar pedido?',
      (bonificacao ? 'BONIFICAÇÃO\n' : '') +
        `${itens.length} ${itens.length === 1 ? 'item' : 'itens'} para ${nomeCliente}.\nEntrega prevista: ${dataComDia(entrega)}.` +
        (bonificacao ? '\n\nEla fica aguardando aprovação e só vai ao SAP depois de aprovada.' : '') +
        (abaixoDoMinimo && minimo !== null ? `\n\nAtenção: abaixo do pedido mínimo do cliente (${moeda(minimo)}).` : ''),
      [
        { text: 'Revisar', style: 'cancel' },
        { text: 'Enviar', onPress: enviar },
      ],
    );
  }

  async function enviar() {
    setOcupado(true);
    try {
      await salvarRascunhoCampos();
      await salvarTipo(db, id, {
        tipo: pedido?.tipo ?? 'venda', tipo_bonificacao: pedido?.tipo_bonificacao ?? null,
        centro_custo: pedido?.centro_custo ?? null, justificativa: just,
      });
      // o preco por caixa (ZPR2) e fixado AGORA, com a tabela que o aparelho tem neste momento
      // (descontos recalculados para as quantidades finais: incentivo por quantidade + parte do vendedor)
      const comPreco = ajustar(itens).map((i) => {
        // brinde de combo vai sem preco e sem tabela: o servidor/SAP gravam o item com valor zero
        // (a tabela fica guardada so para o PDF mostrar o desconto total do combo)
        if (i.brinde) {
          const pb = info?.[i.produto]?.preco;
          return { ...i, preco: null, precoTabela: pb && pb.unidade === i.unidade && pb.valor > 0 ? pb.valor.toFixed(2) : null, desconto: 100 };
        }
        const pr = info?.[i.produto]?.preco ?? undefined;
        const prRef = pr ? { ...pr, descontoMax: Math.max(pr.descontoMax ?? 0, i.descontoLiberado ?? 0) } : undefined;
        return {
          ...i,
          preco: precoParaEnvio(prRef, i.unidade, i.desconto),
          // preco de tabela por caixa: o PDF de confirmacao mostra tabela, desconto e preco final
          precoTabela: pr && pr.unidade === i.unidade && pr.valor > 0 ? pr.valor.toFixed(2) : null,
        };
      });
      await salvarItens(db, id, comPreco);
      await confirmarPedido(db, id);
      recarregar();
      const msg = await enviarPedidos();
      recarregar();
      if (msg) Alert.alert('Pedido salvo', msg);
    } finally {
      setOcupado(false);
    }
  }

  async function enviarAgora() {
    setOcupado(true);
    const msg = await enviarPedidos();
    setOcupado(false);
    recarregar();
    if (msg) Alert.alert('Não foi possível enviar agora', msg);
  }

  async function reenviar() {
    setOcupado(true);
    try {
      await reenviarNoServidor(db, id);
    } catch (e) {
      Alert.alert('Não foi possível reenviar', e instanceof Error ? e.message : 'Tente de novo.');
    } finally {
      setOcupado(false);
      recarregar();
    }
  }

  async function compartilharPdf() {
    setGerandoPdf(true);
    try {
      await compartilharPdfPedido(db, id);
    } catch (e) {
      Alert.alert('Não foi possível gerar o PDF', e instanceof Error ? e.message : 'Tente de novo.');
    } finally {
      setGerandoPdf(false);
    }
  }

  async function duplicar() {
    const novo = await duplicarPedidoApp(db, id);
    if (novo) router.replace(`/pedido/${novo}`);
  }

  function descartar() {
    Alert.alert('Descartar pedido?', 'Os itens deste pedido serão apagados deste aparelho.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: async () => {
          await descartarPedido(db, id);
          router.back();
        },
      },
    ]);
  }

  const semCodigo = !pedido.codigo; // o servidor ainda nao conhece este pedido

  return (
    <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: rascunho ? 'Novo pedido' : pedido.codigo ? `Pedido ${pedido.codigo}` : 'Pedido' }} />

      <Card>
        <Text style={estilos.cliente}>{nomeCliente}</Text>
        <View style={estilos.selos}>
          {pedido.tipo === 'bonificacao' ? <Selo texto="Bonificação" tom="neutro" /> : null}
          {selo ? <Selo texto={selo.texto} tom={selo.tom} /> : null}
          {cliente?.bloqueado ? <Selo texto="Cliente bloqueado" tom="erro" /> : null}
          {cliente?.pagamento_antecipado ? <Selo texto="Pagamento antecipado" tom="aviso" /> : null}
          {!cliente?.pagamento_antecipado && cliente?.limite_disponivel !== null && cliente?.limite_disponivel !== undefined ? <Selo texto={`Limite ${moeda(cliente.limite_disponivel)}`} /> : null}
        </View>
        <View style={{ marginTop: espaco.sm }}>
          <Linha rotulo={pedido.dt_entrega ? 'Entrega' : 'Entrega prevista'} valor={dataComDia(entrega)} />
          <Linha rotulo="Prazo de pagamento" valor={cliente ? textoPrazo(cliente.areas) : null} />
          <Linha rotulo="Forma de pagamento" valor={cliente ? textoFormas(cliente.formas_pagamento) : null} />
          {minimo ? <Linha rotulo="Pedido mínimo" valor={moeda(minimo)} /> : null}
          {pedido.codigo ? <Linha rotulo="Código do pedido" valor={pedido.codigo} /> : null}
        </View>
        {rascunho && prev?.aposCorte ? (
          <Text style={estilos.prazoAviso}>
            Pedido feito depois das {HORA_CORTE}h conta como pedido de amanhã: a entrega considera a partir do dia seguinte.
          </Text>
        ) : null}
        {rascunho && prev?.feriadosPulados.length ? (
          <Text style={estilos.prazoAviso}>
            {prev.feriadosPulados.length > 1 ? 'Feriados sem entrega' : 'Feriado sem entrega'}:{' '}
            {prev.feriadosPulados
              .slice(0, 3)
              .map((d) => `${dataBR(d)}${feriados?.descricao.get(d) ? ` (${feriados.descricao.get(d)})` : ''}`)
              .join(', ')}
            . A entrega foi ajustada.
          </Text>
        ) : null}
        {rascunho && itemMaisLento ? (
          <Text style={estilos.prazoAviso}>
            Prazo de produção de {prazoDias} dias ({info?.[itemMaisLento.produto]?.descricao ?? itemMaisLento.produto}): a entrega é no primeiro dia de entrega do cliente a partir de {prazoDias} dias após a compra.
          </Text>
        ) : null}
      </Card>

      {rascunho ? (
        <Card style={{ marginTop: espaco.md, gap: espaco.sm }}>
          <Text style={estilos.rotulo}>Tipo do pedido</Text>
          <Segmentado
            opcoes={[{ valor: 'venda', texto: 'Venda' }, { valor: 'bonificacao', texto: 'Bonificação' }]}
            valor={pedido.tipo}
            onChange={(v) => mudarTipo({ tipo: v })}
          />
          {bonificacao ? (
            <>
              <Text style={[estilos.rotulo, { marginTop: espaco.sm }]}>Tipo de bonificação</Text>
              <Dropdown
                titulo="Tipo de bonificação"
                valor={pedido.tipo_bonificacao}
                opcoes={(tiposBon ?? []).map((t) => ({ valor: t.codigo, texto: `${t.codigo} · ${t.descricao ?? ''}` }))}
                onChange={(v) => mudarTipo({ tipo_bonificacao: v })}
                placeholder="Selecione o tipo"
              />
              {tiposBon && !tiposBon.length ? <Text style={estilos.dica}>Nenhum tipo cadastrado. Peça para cadastrar no painel e sincronize.</Text> : null}
              <Text style={[estilos.rotulo, { marginTop: espaco.sm }]}>Centro de custo</Text>
              <Dropdown
                titulo="Centro de custo"
                valor={pedido.centro_custo}
                opcoes={(centros ?? []).map((c) => ({ valor: c.codigo, texto: `${c.codigo} · ${c.descricao ?? ''}` }))}
                onChange={(v) => mudarTipo({ centro_custo: v })}
                placeholder="Selecione o centro de custo"
              />
              {centros && !centros.length ? <Text style={estilos.dica}>Nenhum centro de custo cadastrado. Peça para cadastrar no painel e sincronize.</Text> : null}
              <Text style={[estilos.rotulo, { marginTop: espaco.sm }]}>Justificativa (só para quem aprova)</Text>
              <TextInput
                style={[estilos.campo, { minHeight: 70, textAlignVertical: 'top' }]}
                value={just}
                onChangeText={setJust}
                onBlur={() => mudarTipo({ justificativa: just })}
                multiline
                maxLength={500}
              />
              <Text style={estilos.dica}>A bonificação fica aguardando aprovação no painel e só vai ao SAP depois de aprovada.</Text>
            </>
          ) : null}
        </Card>
      ) : pedido.tipo === 'bonificacao' ? (
        <Card style={{ marginTop: espaco.md, ...(pedido.status === 'rejeitado' ? estilos.cardErro : estilos.cardAviso) }}>
          <Text style={estilos.subtitulo}>Bonificação</Text>
          <Linha rotulo="Tipo" valor={(tiposBon ?? []).find((t) => t.codigo === pedido.tipo_bonificacao)?.descricao ?? pedido.tipo_bonificacao} />
          <Linha rotulo="Centro de custo" valor={(centros ?? []).find((c) => c.codigo === pedido.centro_custo)?.descricao ?? pedido.centro_custo} />
          {pedido.justificativa ? <Linha rotulo="Justificativa" valor={pedido.justificativa} /> : null}
          <Text style={pedido.status === 'rejeitado' ? estilos.erroTexto : estilos.avisoTexto}>
            {pedido.status === 'aguardando_aprovacao'
              ? 'Aguardando aprovação. Só vai ao SAP depois de aprovada.'
              : pedido.status === 'rejeitado'
                ? `Rejeitada${pedido.motivo_rejeicao ? `: ${pedido.motivo_rejeicao}` : '.'} Duplique o pedido para corrigir e enviar de novo.`
                : pedido.status === 'aprovado'
                  ? 'Aprovada. Enviando ao SAP.'
                  : 'Bonificação aprovada.'}
          </Text>
        </Card>
      ) : null}

      {!rascunho ? (
        <View style={{ marginTop: espaco.md, gap: espaco.sm }}>
          {pedido.erro ? (
            <Card style={estilos.cardErro}>
              <Text style={estilos.erroTitulo}>{pedido.status === 'erro' ? 'O pedido não foi enviado' : 'Aviso'}</Text>
              <Text style={estilos.erroTexto}>{pedido.erro}</Text>
            </Card>
          ) : null}
          {pedido.status === 'pendente' ? (
            <Card style={estilos.cardAviso}>
              <Text style={estilos.avisoTexto}>Salvo neste aparelho. Será enviado ao SAP assim que houver conexão.</Text>
            </Card>
          ) : null}
          {pedido.ordens_sap.length ? (
            <Card>
              <Text style={estilos.subtitulo}>Ordens no SAP</Text>
              {pedido.ordens_sap.map((o) => (
                <Pressable key={o.ordem} onPress={() => router.push(`/pedido-sap/${o.ordem}`)} style={estilos.ordem}>
                  <Text style={estilos.ordemTexto}>Ordem {o.ordem}</Text>
                  <Text style={estilos.ordemSuave}>{o.bonificacao ? 'Bonificação do combo (brinde)' : o.tipo_material === 'FERT' ? 'Produtos fabricados' : 'Produtos de revenda'}</Text>
                  <Ionicons name="chevron-forward" size={18} color={cor.textoSuave} />
                </Pressable>
              ))}
            </Card>
          ) : null}
        </View>
      ) : null}

      <Secao titulo="Itens" detalhe={`${itens.length}`} />
      <CombosResumo resultado={combosAgora} brindes={incData?.brindes ?? {}} />
      {itens.length ? (
        itens.map((i) => (
          <ItemLinha
            key={`${i.produto}-${i.unidade}${i.brinde ? '-brinde' : ''}`}
            item={i}
            prod={info?.[i.produto]}
            editavel={!!rascunho && !i.brinde}
            onMais={() => mudar(i, 1)}
            onMenos={() => mudar(i, -1)}
            onEditar={() => setEditando(i)}
          />
        ))
      ) : (
        <Vazio icone="cart-outline" texto="Nenhum produto neste pedido ainda." />
      )}

      {rascunho ? (
        <View style={{ marginTop: espaco.sm }}>
          <Botao titulo="Adicionar produtos" onPress={() => router.push(`/pedido/produtos?id=${id}`)} tom="neutro" />
        </View>
      ) : null}

      {itens.length ? (
        <Card style={{ marginTop: espaco.lg }}>
          <Linha rotulo="Total estimado" valor={moeda(total.total)} />
          {minimo ? (
            <Text style={abaixoDoMinimo ? estilos.minimoAviso : estilos.minimoOk}>
              {abaixoDoMinimo
                ? `Abaixo do pedido mínimo de ${moeda(minimo)}: faltam ${moeda(faltaMinimo)}${total.semEstimativa ? ' (estimativa incompleta)' : ''}.`
                : `Pedido mínimo de ${moeda(minimo)} atingido.`}
            </Text>
          ) : null}
          {total.semEstimativa ? (
            <Text style={estilos.dica}>
              {total.semEstimativa} {total.semEstimativa === 1 ? 'item fica' : 'itens ficam'} fora da estimativa (sem preço de tabela ou em outra unidade): o SAP aplica a lista. O valor líquido final (sem impostos) é calculado pelo SAP.
            </Text>
          ) : (
            <Text style={estilos.dica}>Preço de tabela por caixa. O valor líquido final (sem impostos) é calculado pelo SAP.</Text>
          )}
        </Card>
      ) : null}

      {rascunho ? (
        <View style={{ marginTop: espaco.lg, gap: 6 }}>
          <Text style={estilos.rotulo}>Ordem de compra do cliente (opcional)</Text>
          <TextInput style={estilos.campo} value={oc} onChangeText={setOc} onBlur={salvarRascunhoCampos} maxLength={35} autoCapitalize="characters" />
          <Text style={estilos.rotulo}>Observação (opcional)</Text>
          <TextInput style={[estilos.campo, { minHeight: 70, textAlignVertical: 'top' }]} value={obs} onChangeText={setObs} onBlur={salvarRascunhoCampos} multiline maxLength={250} />
        </View>
      ) : (
        <View style={{ marginTop: espaco.lg }}>
          {pedido.ordem_compra_cliente ? <Linha rotulo="Ordem de compra" valor={pedido.ordem_compra_cliente} /> : null}
          {pedido.observacao ? <Linha rotulo="Observação" valor={pedido.observacao} /> : null}
        </View>
      )}

      {rascunho && problemas.length ? (
        <Card style={{ ...estilos.cardAviso, marginTop: espaco.lg }}>
          {problemas.map((p) => (
            <Text key={p} style={estilos.avisoTexto}>• {p}</Text>
          ))}
        </Card>
      ) : null}

      <View style={{ marginTop: espaco.lg, gap: espaco.sm }}>
        {rascunho ? (
          <>
            <Botao titulo="Enviar pedido" onPress={confirmarEnvio} carregando={ocupado} desabilitado={problemas.length > 0 || !infoPronta} />
            <Botao titulo="Descartar rascunho" onPress={descartar} tom="neutro" />
          </>
        ) : (
          <>
            {pedido.status === 'pendente' ? <Botao titulo="Enviar agora" onPress={enviarAgora} carregando={ocupado} /> : null}
            {pedido.status === 'erro' && !semCodigo ? <Botao titulo="Reenviar" onPress={reenviar} carregando={ocupado} /> : null}
            {pedido.status === 'erro' && semCodigo ? (
              <Text style={estilos.dica}>Este pedido foi recusado antes de chegar ao SAP. Duplique para corrigir e enviar de novo.</Text>
            ) : null}
            <Botao titulo={gerandoPdf ? 'Gerando PDF…' : 'Compartilhar PDF do pedido'} onPress={compartilharPdf} carregando={gerandoPdf} />
            <Text style={estilos.dica}>O PDF confirma o pedido mesmo sem internet. Se o SAP ainda não devolveu o número da ordem, gere de novo depois para atualizar.</Text>
            <Botao titulo="Duplicar pedido" onPress={duplicar} tom="neutro" />
            {semCodigo && (pedido.status === 'pendente' || pedido.status === 'erro') ? <Botao titulo="Descartar" onPress={descartar} tom="neutro" /> : null}
          </>
        )}
      </View>

      <ModalQuantidade
        visivel={editando !== null}
        titulo={editando ? (info?.[editando.produto]?.descricao ?? editando.produto) : ''}
        unidade={editando ? (info?.[editando.produto] ? rotulo(info[editando.produto], editando.unidade) : editando.unidade) : ''}
        inicial={editando?.quantidade ?? ''}
        regra={editando ? (info?.[editando.produto]?.regra ?? { minimo: null, multiplo: null }) : { minimo: null, multiplo: null }}
        confirmarTexto="Salvar"
        descontoMax={editando ? (info?.[editando.produto]?.preco?.descontoMax ?? 0) : 0}
        descontoInicial={editando ? (editando.descontoManual ?? editando.desconto) : undefined}
        maxPorQuantidade={
          editando
            ? (q) => maxManual(info?.[editando.produto]?.preco?.descontoMax ?? 0, incData ? incentivoAplicavel(incData.rows, editando.produto, q, incData.ctx, info?.[editando.produto]?.classificacao) : null)
            : undefined
        }
        dicaDesconto={
          editando && incData
            ? (q) => {
                const inc = incentivoAplicavel(incData.rows, editando.produto, q, incData.ctx, info?.[editando.produto]?.classificacao);
                return inc ? `Incentivo por quantidade: ${inc.desconto_pct}% automático + até ${inc.desconto_extra_max_pct}% extra seu.` : null;
              }
            : undefined
        }
        onCancelar={() => setEditando(null)}
        onConfirmar={async (q, d) => {
          if (editando) {
            await gravar(definirDesconto(definirQuantidade(itens, editando.produto, editando.unidade, q), editando.produto, editando.unidade, d));
          }
          setEditando(null);
        }}
      />
    </ScrollView>
  );
}

function ItemLinha({
  item, prod, editavel, onMais, onMenos, onEditar,
}: { item: ItemPedido; prod?: ProdutoCatalogo; editavel: boolean; onMais: () => void; onMenos: () => void; onEditar: () => void }) {
  const q = lerQuantidade(item.quantidade) ?? 0;
  const unid = prod ? rotulo(prod, item.unidade) : item.unidade; // texto que o vendedor le (CX), nao o codigo (KI)
  const preco = prod?.preco ? `${moeda(prod.preco.valor)}/${rotulo(prod, prod.preco.unidade)}` : 'sem preço de tabela';
  const teto = Math.max(prod?.preco?.descontoMax ?? 0, item.descontoLiberado ?? 0);
  const temDesc = !!item.desconto && item.desconto > 0 && !!prod?.preco && validarDesconto(item.desconto, teto) === null;
  const precoFinal = prod?.preco && temDesc ? aplicarDesconto(prod.preco.valor, item.desconto) : null;
  const subtotal = !item.brinde && prod?.preco && prod.preco.unidade === item.unidade ? moeda(precoUnitarioFinal(prod.preco, item) * q) : null;

  return (
    <Card style={item.brinde ? { ...estilos.item, ...estilos.brinde } : estilos.item}>
      <FotoProduto cod={item.produto} tamanho={48} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={estilos.itemNome} numberOfLines={2}>{prod?.descricao ?? item.produto}</Text>
        {item.brinde ? <Selo texto="🎁 GRÁTIS · brinde do combo" tom="ok" /> : null}
        <Text style={estilos.itemSuave}>{item.brinde ? 'sem custo para o cliente' : preco}{temDesc ? ` −${item.desconto}% = ${moeda(precoFinal)}/${unid}` : ''}{subtotal ? ` · ${subtotal}` : ''}</Text>
      </View>
      {editavel ? (
        <View style={estilos.controle}>
          <Pressable onPress={onMenos} hitSlop={8} style={estilos.passo}>
            <Ionicons name={q <= (prod?.regra.multiplo ?? 1) ? 'trash-outline' : 'remove'} size={20} color={cor.texto} />
          </Pressable>
          <Pressable onPress={onEditar} style={estilos.qtd}>
            <Text style={estilos.qtdTexto}>{numero(q)}</Text>
            <Text style={estilos.qtdUnidade}>{unid}</Text>
          </Pressable>
          <Pressable onPress={onMais} hitSlop={8} style={estilos.passo}>
            <Ionicons name="add" size={20} color={cor.texto} />
          </Pressable>
        </View>
      ) : (
        <View style={estilos.qtd}>
          <Text style={estilos.qtdTexto}>{numero(q)}</Text>
          <Text style={estilos.qtdUnidade}>{unid}</Text>
        </View>
      )}
    </Card>
  );
}

const estilos = StyleSheet.create({
  brinde: { backgroundColor: cor.okFundo, borderColor: cor.ok, borderWidth: 1 },
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  cliente: { fontSize: 18, fontWeight: '800', color: cor.texto },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: espaco.sm },
  subtitulo: { fontSize: 14, fontWeight: '700', color: cor.texto, marginBottom: 4 },
  ordem: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm, paddingVertical: 8 },
  ordemTexto: { fontSize: 15, fontWeight: '700', color: cor.primariaEscura },
  ordemSuave: { flex: 1, fontSize: 13, color: cor.textoSuave },
  cardErro: { backgroundColor: cor.erroFundo, borderColor: cor.erro },
  erroTitulo: { fontSize: 14, fontWeight: '700', color: cor.erro },
  erroTexto: { fontSize: 13, color: cor.erro, marginTop: 2 },
  cardAviso: { backgroundColor: cor.avisoFundo, borderColor: cor.amarelo, gap: 4 },
  avisoTexto: { fontSize: 13, color: cor.aviso },
  dica: { fontSize: 12, color: cor.textoSuave, marginTop: 4 },
  prazoAviso: { color: cor.aviso, fontSize: 12, marginTop: espaco.sm },
  minimoAviso: { color: cor.aviso, fontWeight: '700', fontSize: 13, marginTop: 4 },
  minimoOk: { color: cor.ok, fontWeight: '600', fontSize: 13, marginTop: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  itemNome: { fontSize: 15, fontWeight: '700', color: cor.texto },
  itemSuave: { fontSize: 12, color: cor.textoSuave },
  controle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  passo: { width: 34, height: 34, borderRadius: 17, backgroundColor: cor.neutroFundo, alignItems: 'center', justifyContent: 'center' },
  qtd: { minWidth: 54, alignItems: 'center' },
  qtdTexto: { fontSize: 17, fontWeight: '800', color: cor.texto },
  qtdUnidade: { fontSize: 11, color: cor.textoSuave },
  rotulo: { fontSize: 13, fontWeight: '600', color: cor.textoSuave },
  campo: {
    backgroundColor: cor.card, borderRadius: raio, borderWidth: 1, borderColor: cor.borda,
    paddingHorizontal: espaco.lg, paddingVertical: 12, fontSize: 15, color: cor.texto,
  },
});
