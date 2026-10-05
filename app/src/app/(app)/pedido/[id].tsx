import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ProdutoCatalogo } from '@/db/catalogo';
import { infoProdutos, rotulo } from '@/db/catalogo';
import { useDados, useTickAoFocar } from '@/db/hooks';
import {
  confirmarPedido, descartarPedido, duplicarPedidoApp, lerPedidoApp, salvarCampos, salvarItens,
} from '@/db/pedidos';
import { reenviarNoServidor } from '@/db/push';
import { obterCliente } from '@/db/queries';
import {
  aplicarDesconto, definirDesconto, definirQuantidade, estimarTotal, precoParaEnvio, precoUnitarioFinal, removerItem, validarDesconto,
  type ItemPedido,
} from '@/domain/pedido';
import { proximaEntrega } from '@/domain/entrega';
import { lerQuantidade, validarQuantidade } from '@/domain/quantidade';
import { dataComDia, hojeISO, moeda, numero } from '@/lib/format';
import { useSync } from '@/lib/sync-context';
import { Botao, Card, Carregando, Linha, Secao, Selo, Vazio } from '@/ui/components';
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

  const [oc, setOc] = useState('');
  const [obs, setObs] = useState('');
  const [editando, setEditando] = useState<ItemPedido | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (pedido) {
      setOc(pedido.ordem_compra_cliente ?? '');
      setObs(pedido.observacao ?? '');
    }
    // so ao abrir o pedido: depois o que o vendedor digita manda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido?.id]);

  const itens = useMemo(() => pedido?.itens ?? [], [pedido]);
  const rascunho = pedido?.status === 'rascunho';
  const infoPronta = info !== undefined;

  const problemas = useMemo(() => {
    const p: string[] = [];
    if (!itens.length) p.push('Adicione ao menos um produto.');
    if (cliente?.bloqueado) p.push('Cliente bloqueado: não é possível enviar pedido.');
    if (!infoPronta) return p;
    for (const i of itens) {
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
      const msgDesc = validarDesconto(i.desconto ?? 0, prod.preco?.descontoMax);
      if (msgDesc) p.push(`${nome}: ${msgDesc}`);
    }
    return p;
  }, [itens, info, infoPronta, cliente]);

  const total = useMemo(() => {
    const precos = Object.fromEntries(
      Object.entries(info ?? {}).map(([k, v]) => [k, v.preco ? { valor: v.preco.valor, unidade: v.preco.unidade, descontoMax: v.preco.descontoMax } : undefined]),
    );
    return estimarTotal(itens, precos);
  }, [itens, info]);

  if (carregando) return <Carregando />;
  if (!pedido) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Vazio icone="document-outline" texto="Pedido não encontrado neste aparelho." />
      </View>
    );
  }

  const entrega = pedido.dt_entrega ?? proximaEntrega(cliente?.dias_entrega ?? []);
  const selo = seloDoPedido('app', pedido.status);
  const nomeCliente = cliente?.nome_fantasia || cliente?.razao_social || pedido.cod_cliente;
  const recarregar = () => setRecarga((r) => r + 1);

  async function gravar(novos: ItemPedido[]) {
    await salvarItens(db, id, novos);
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
      `${itens.length} ${itens.length === 1 ? 'item' : 'itens'} para ${nomeCliente}.\nEntrega prevista: ${dataComDia(entrega)}.`,
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
      // o preco por caixa (ZPR2) e fixado AGORA, com a tabela que o aparelho tem neste momento
      const comPreco = itens.map((i) => ({ ...i, preco: precoParaEnvio(info?.[i.produto]?.preco ?? undefined, i.unidade, i.desconto) }));
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
          {selo ? <Selo texto={selo.texto} tom={selo.tom} /> : null}
          {cliente?.bloqueado ? <Selo texto="Cliente bloqueado" tom="erro" /> : null}
          {cliente?.limite_disponivel !== null && cliente?.limite_disponivel !== undefined ? <Selo texto={`Limite ${moeda(cliente.limite_disponivel)}`} /> : null}
        </View>
        <View style={{ marginTop: espaco.sm }}>
          <Linha rotulo={pedido.dt_entrega ? 'Entrega' : 'Entrega prevista'} valor={dataComDia(entrega)} />
          {pedido.codigo ? <Linha rotulo="Código do pedido" valor={pedido.codigo} /> : null}
        </View>
      </Card>

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
                  <Text style={estilos.ordemSuave}>{o.tipo_material === 'FERT' ? 'Produtos fabricados' : 'Produtos de revenda'}</Text>
                  <Ionicons name="chevron-forward" size={18} color={cor.textoSuave} />
                </Pressable>
              ))}
            </Card>
          ) : null}
        </View>
      ) : null}

      <Secao titulo="Itens" detalhe={`${itens.length}`} />
      {itens.length ? (
        itens.map((i) => (
          <ItemLinha
            key={`${i.produto}-${i.unidade}`}
            item={i}
            prod={info?.[i.produto]}
            editavel={!!rascunho}
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
        descontoInicial={editando?.desconto}
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
  const temDesc = !!item.desconto && item.desconto > 0 && !!prod?.preco && validarDesconto(item.desconto, prod.preco.descontoMax) === null;
  const precoFinal = prod?.preco && temDesc ? aplicarDesconto(prod.preco.valor, item.desconto) : null;
  const subtotal = prod?.preco && prod.preco.unidade === item.unidade ? moeda(precoUnitarioFinal(prod.preco, item) * q) : null;

  return (
    <Card style={estilos.item}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={estilos.itemNome} numberOfLines={2}>{prod?.descricao ?? item.produto}</Text>
        <Text style={estilos.itemSuave}>{preco}{temDesc ? ` −${item.desconto}% = ${moeda(precoFinal)}/${unid}` : ''}{subtotal ? ` · ${subtotal}` : ''}</Text>
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
