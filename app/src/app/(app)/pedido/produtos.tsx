import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { buscarProdutos, infoProdutos, rotulo, type ProdutoCatalogo } from '@/db/catalogo';
import { colocarNoCarrinho } from '@/db/carrinho';
import { useDados, useTickAoFocar } from '@/db/hooks';
import { carregarIncentivos, classificacaoPorProduto, descontoMaxPorProduto } from '@/db/incentivos';
import { itensDaOrdemSap, lerPedidoApp, salvarItens } from '@/db/pedidos';
import { listarDestaques, ultimosPedidosDoCliente } from '@/db/produto';
import { obterCliente, produtosCompradosPeloCliente } from '@/db/queries';
import { ajustarDescontos, incentivoAplicavel, maxManual } from '@/domain/incentivo';
import { definirQuantidade, estimarTotal, removerItem, type ItemPedido } from '@/domain/pedido';
import { lerQuantidade } from '@/domain/quantidade';
import { dataBR, diasAtras, hojeISO, moeda, numero } from '@/lib/format';
import { Botao, Card, Secao, Segmentado, Selo, Vazio } from '@/ui/components';
import { FotoProduto } from '@/ui/FotoProduto';
import { ModalQuantidade } from '@/ui/ModalQuantidade';
import { cor, espaco, raio } from '@/ui/theme';

type Aba = 'produtos' | 'carrinho' | 'sugestao';

const DIAS_SEM_GIRO = 30;
const TOPO = 10; // itens por lista da aba Sugestao

/** Linha de produto: tocar abre a tela de info; o "+" adiciona direto ao carrinho. */
function LinhaProduto({
  p, detalhe, selos, jaTem, onAbrir, onAdicionar,
}: { p: ProdutoCatalogo; detalhe?: string; selos?: ReactNode; jaTem?: string; onAbrir: () => void; onAdicionar: () => void }) {
  return (
    <Pressable
      onPress={onAbrir}
      disabled={!p.disponivel}
      style={({ pressed }) => [
        estilos.card,
        jaTem ? estilos.cardNoCarrinho : undefined,
        !p.disponivel ? { opacity: 0.45 } : undefined,
        pressed ? { opacity: 0.7 } : undefined,
      ]}
    >
      <FotoProduto cod={p.cod_produto} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={estilos.nome} numberOfLines={2}>{p.descricao}</Text>
        <Text style={estilos.suave}>
          Cód. {p.cod_produto} · {p.preco ? `${moeda(p.preco.valor)}/${rotulo(p, p.preco.unidade)}` : 'sem preço'}
          {p.regra.minimo ? ` · mín. ${p.regra.minimo}` : ''}
        </Text>
        {detalhe ? <Text style={estilos.suave}>{detalhe}</Text> : null}
        <View style={estilos.selos}>
          {selos}
          {!p.disponivel ? <Selo texto="Indisponível para este cliente" tom="erro" /> : null}
          {p.prazoDias > 1 ? <Selo texto={`Produção: ${p.prazoDias} dias`} tom="aviso" /> : null}
        </View>
      </View>
      {p.disponivel ? (
        // "+" laranja = ainda nao esta no carrinho; "+" VERDE com a quantidade no canto = ja esta (tocar soma mais)
        <Pressable onPress={onAdicionar} hitSlop={8} style={estilos.botaoMais}>
          <Ionicons name="add-circle" size={36} color={jaTem ? cor.ok : cor.primaria} />
          {jaTem ? (
            <View style={estilos.badgeQtd}>
              <Text style={estilos.badgeQtdTexto} numberOfLines={1}>{numero(lerQuantidade(jaTem) ?? 0)}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export default function ProdutosDoPedido() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const hoje = hojeISO();

  const [aba, setAba] = useState<Aba>('produtos');
  const [busca, setBusca] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  // ao VOLTAR para esta tela (ex.: depois de adicionar pela tela de informacoes do produto) o carrinho e lido de novo
  const tick = useTickAoFocar();
  const dep = tick + recarga;
  const [escolhido, setEscolhido] = useState<ProdutoCatalogo | null>(null);

  const { dados: pedido } = useDados((d) => lerPedidoApp(d, id), [id, dep]);
  const { dados: cliente } = useDados(async (d) => (pedido ? obterCliente(d, pedido.cod_cliente) : null), [pedido?.cod_cliente]);
  const { dados: incData } = useDados(
    async (d) => (cliente ? carregarIncentivos(d, cliente.cod_cliente, cliente.areas) : null),
    [cliente?.cod_cliente],
  );

  // ---- aba Produtos: busca no catalogo do cliente
  const { dados: produtos } = useDados(
    async (d) => (cliente && aba === 'produtos' ? buscarProdutos(d, cliente.areas, busca, hoje) : []),
    [cliente?.cod_cliente, busca, aba],
  );

  // ---- carrinho
  const itens = useMemo(() => pedido?.itens ?? [], [pedido]);
  const codCarrinho = itens.map((i) => i.produto).join(',');
  const { dados: infoCarrinho } = useDados(
    async (d): Promise<Record<string, ProdutoCatalogo>> => (cliente && itens.length ? infoProdutos(d, cliente.areas, itens.map((i) => i.produto), hoje) : {}),
    [cliente?.cod_cliente, codCarrinho, dep],
  );
  const noCarrinho = useMemo(() => new Map(itens.map((i) => [`${i.produto}|${i.unidade}`, i.quantidade])), [itens]);

  // ---- aba Sugestao
  const { dados: comprados } = useDados((d) => (pedido ? produtosCompradosPeloCliente(d, pedido.cod_cliente) : Promise.resolve([])), [pedido?.cod_cliente]);
  const { dados: destaques } = useDados(listarDestaques, []);
  const { dados: ultimosPedidos } = useDados((d) => (pedido ? ultimosPedidosDoCliente(d, pedido.cod_cliente, 5) : Promise.resolve([])), [pedido?.cod_cliente]);

  const corte = diasAtras(hoje, DIAS_SEM_GIRO);
  const sugestoes = useMemo(() => {
    const c = comprados ?? [];
    return {
      semGiro: c.filter((p) => p.ultima_compra < corte).slice(0, TOPO),
      mix: [...c].sort((a, b) => b.pedidos - a.pedidos || b.quantidade - a.quantidade).slice(0, TOPO),
      ultimos: [...c].sort((a, b) => b.ultima_compra.localeCompare(a.ultima_compra)).slice(0, TOPO),
    };
  }, [comprados, corte]);

  const codsSugestao = useMemo(
    () => [...new Set([...sugestoes.semGiro, ...sugestoes.mix, ...sugestoes.ultimos].map((p) => p.cod_produto).concat((destaques ?? []).map((x) => x.cod_produto)))],
    [sugestoes, destaques],
  );
  const { dados: infoSug } = useDados(
    async (d): Promise<Record<string, ProdutoCatalogo>> => (cliente && aba === 'sugestao' && codsSugestao.length ? infoProdutos(d, cliente.areas, codsSugestao, hoje) : {}),
    [cliente?.cod_cliente, aba, codsSugestao.join(',')],
  );

  const abrirInfo = (cod: string) => router.push({ pathname: '/pedido/produto-info', params: { id, cod } });

  /** Quantidade que o produto ja tem no carrinho (para saber o incentivo da quantidade FINAL). */
  const qtdAtual = (p: ProdutoCatalogo) => lerQuantidade(noCarrinho.get(`${p.cod_produto}|${p.unidade}`) ?? '') ?? 0;

  async function adicionar(q: number, desconto: number) {
    if (!escolhido || !pedido) return;
    await colocarNoCarrinho(db, id, pedido.itens, escolhido, q, desconto, 'somar', infoCarrinho ?? {}, incData ?? null);
    setAviso(`Adicionado: ${escolhido.descricao}`);
    setEscolhido(null);
    setRecarga((r) => r + 1);
  }

  /** Repete um pedido anterior: adiciona os itens que o cliente ainda pode comprar. */
  async function repetir(ordem: string) {
    if (!pedido || !cliente) return;
    const antigos = await itensDaOrdemSap(db, ordem);
    const info = await infoProdutos(db, cliente.areas, antigos.map((i) => i.produto), hoje);
    let atual: ItemPedido[] = pedido.itens;
    let ok = 0;
    let fora = 0;
    for (const i of antigos) {
      const p = info[i.produto];
      if (!p || !p.disponivel || !p.preco || i.unidade !== p.unidade) {
        fora++;
        continue;
      }
      atual = await colocarNoCarrinho(db, id, atual, p, lerQuantidade(i.quantidade) ?? 0, 0, 'somar', { ...(infoCarrinho ?? {}), ...info }, incData ?? null);
      ok++;
    }
    setAviso(`${ok} ${ok === 1 ? 'item adicionado' : 'itens adicionados'}${fora ? ` · ${fora} indisponíve${fora === 1 ? 'l' : 'is'}` : ''}`);
    setRecarga((r) => r + 1);
  }

  // ---- carrinho: +/- e remover
  async function mudar(i: ItemPedido, sinal: 1 | -1) {
    const passo = infoCarrinho?.[i.produto]?.regra.multiplo ?? 1;
    const novo = Math.round(((lerQuantidade(i.quantidade) ?? 0) + sinal * passo) * 1000) / 1000;
    const lista = novo <= 0 ? removerItem(itens, i.produto, i.unidade) : definirQuantidade(itens, i.produto, i.unidade, novo);
    await salvarAjustado(lista);
  }
  async function remover(i: ItemPedido) {
    await salvarAjustado(removerItem(itens, i.produto, i.unidade));
  }
  async function salvarAjustado(lista: ItemPedido[]) {
    // recalcula os descontos (incentivo por quantidade) para as quantidades novas
    await salvarItens(db, id, incData ? ajustarDescontos(lista, descontoMaxPorProduto(infoCarrinho ?? {}), incData.rows, incData.ctx, classificacaoPorProduto(infoCarrinho ?? {})) : lista);
    setRecarga((r) => r + 1);
  }

  const totalCarrinho = useMemo(() => {
    const precos = Object.fromEntries(
      Object.entries(infoCarrinho ?? {}).map(([k, v]) => [k, v.preco ? { valor: v.preco.valor, unidade: v.preco.unidade, descontoMax: v.preco.descontoMax } : undefined]),
    );
    return estimarTotal(itens, precos);
  }, [itens, infoCarrinho]);

  const totalItens = itens.length;
  const quantidadeInicial = escolhido ? String(escolhido.regra.minimo ?? escolhido.regra.multiplo ?? 1) : '1';

  const linha = (p: ProdutoCatalogo, detalhe?: string, selos?: ReactNode) => (
    <LinhaProduto
      key={p.cod_produto}
      p={p}
      detalhe={detalhe}
      selos={selos}
      jaTem={noCarrinho.get(`${p.cod_produto}|${p.unidade}`)}
      onAbrir={() => abrirInfo(p.cod_produto)}
      onAdicionar={() => setEscolhido(p)}
    />
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: espaco.lg, paddingTop: espaco.lg }}>
        <Segmentado
          opcoes={[
            { valor: 'produtos', texto: 'Produtos' },
            { valor: 'carrinho', texto: `Carrinho${totalItens ? ` (${totalItens})` : ''}` },
            { valor: 'sugestao', texto: 'Sugestão' },
          ]}
          valor={aba}
          onChange={setAba}
        />
      </View>

      {aviso ? (
        <View style={estilos.aviso}>
          <Ionicons name="checkmark-circle" size={16} color={cor.ok} />
          <Text style={estilos.avisoTexto} numberOfLines={1}>{aviso}</Text>
        </View>
      ) : null}

      {aba === 'produtos' ? (
        <>
          <View style={estilos.buscaBox}>
            <Ionicons name="search" size={18} color={cor.textoSuave} />
            <TextInput
              style={estilos.busca}
              value={busca}
              onChangeText={setBusca}
              placeholder="Buscar produto por nome, código ou EAN"
              placeholderTextColor={cor.textoSuave}
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
          </View>
          <FlatList
            data={produtos ?? []}
            keyExtractor={(p) => p.cod_produto}
            contentContainerStyle={{ padding: espaco.lg, paddingTop: espaco.sm, paddingBottom: 100 }}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Vazio
                icone="cube-outline"
                texto={busca ? 'Nenhum produto encontrado. Só aparecem produtos com preço de tabela e estoque para este cliente.' : 'Nenhum produto com preço para este cliente. Sincronize para baixar o catálogo e os preços.'}
              />
            }
            renderItem={({ item: p }) => linha(p, p.regra.multiplo && p.regra.multiplo !== 1 ? `vendido em ${p.unidadeTexto} · múltiplo ${p.regra.multiplo}` : `vendido em ${p.unidadeTexto}`)}
          />
        </>
      ) : null}

      {aba === 'carrinho' ? (
        <ScrollView contentContainerStyle={{ padding: espaco.lg, paddingBottom: 100 }}>
          {itens.length ? (
            <>
              {itens.map((i) => {
                const p = infoCarrinho?.[i.produto];
                const q = lerQuantidade(i.quantidade) ?? 0;
                const unid = p ? rotulo(p, i.unidade) : i.unidade;
                const passo = p?.regra.multiplo ?? 1;
                return (
                  <Card key={`${i.produto}|${i.unidade}`} style={estilos.itemCarrinho} onPress={() => abrirInfo(i.produto)}>
                    <FotoProduto cod={i.produto} tamanho={48} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={estilos.nome} numberOfLines={2}>{p?.descricao ?? i.produto}</Text>
                      <Text style={estilos.suave}>
                        {p?.preco ? `${moeda(p.preco.valor)}/${rotulo(p, p.preco.unidade)}` : 'sem preço de tabela'}
                        {i.desconto ? ` · desconto ${i.desconto}%` : ''}
                      </Text>
                    </View>
                    <View style={estilos.controle}>
                      <Pressable onPress={() => (q <= passo ? remover(i) : mudar(i, -1))} hitSlop={8} style={estilos.passo}>
                        <Ionicons name={q <= passo ? 'trash-outline' : 'remove'} size={20} color={cor.texto} />
                      </Pressable>
                      <View style={estilos.qtd}>
                        <Text style={estilos.qtdTexto}>{numero(q)}</Text>
                        <Text style={estilos.qtdUnidade}>{unid}</Text>
                      </View>
                      <Pressable onPress={() => mudar(i, 1)} hitSlop={8} style={estilos.passo}>
                        <Ionicons name="add" size={20} color={cor.texto} />
                      </Pressable>
                    </View>
                  </Card>
                );
              })}
              <Card style={{ marginTop: espaco.sm }}>
                <View style={estilos.totalLinha}>
                  <Text style={estilos.suave}>Total estimado</Text>
                  <Text style={estilos.total}>{moeda(totalCarrinho.total)}</Text>
                </View>
                {pedido?.tipo !== 'bonificacao' && cliente?.pedido_minimo ? (
                  <Text style={totalCarrinho.total < cliente.pedido_minimo ? estilos.minimoAviso : estilos.minimoOk}>
                    {totalCarrinho.total < cliente.pedido_minimo
                      ? `Abaixo do pedido mínimo de ${moeda(cliente.pedido_minimo)}: faltam ${moeda(cliente.pedido_minimo - totalCarrinho.total)}.`
                      : `Pedido mínimo de ${moeda(cliente.pedido_minimo)} atingido.`}
                  </Text>
                ) : null}
              </Card>
            </>
          ) : (
            <Vazio icone="cart-outline" texto="O carrinho está vazio. Adicione produtos pela lista ou pelas sugestões." />
          )}
        </ScrollView>
      ) : null}

      {aba === 'sugestao' ? (
        <ScrollView contentContainerStyle={{ padding: espaco.lg, paddingTop: 0, paddingBottom: 100 }}>
          {(() => {
            const rows = (cods: string[], detalhe: (cod: string) => string | undefined, selos?: (cod: string) => ReactNode) =>
              cods.map((cod) => (infoSug?.[cod] ? linha(infoSug[cod], detalhe(cod), selos?.(cod)) : null));
            const dest = (destaques ?? []).filter((x) => infoSug?.[x.cod_produto]?.disponivel);
            const porCod = new Map((comprados ?? []).map((c) => [c.cod_produto, c]));
            return (
              <>
                <Secao titulo="Destaques e lançamentos" detalhe={dest.length ? `${dest.length}` : undefined} />
                {dest.length ? (
                  rows(
                    dest.map((x) => x.cod_produto),
                    (cod) => (porCod.get(cod) ? `última compra ${dataBR(porCod.get(cod)!.ultima_compra)}` : 'cliente ainda não comprou'),
                    (cod) => {
                      const d = dest.find((x) => x.cod_produto === cod);
                      return (
                        <>
                          {d?.lancamento ? <Selo texto="Lançamento" tom="ok" /> : null}
                          {d?.destaque ? <Selo texto="Destaque" tom="aviso" /> : null}
                        </>
                      );
                    },
                  )
                ) : (
                  <Vazio icone="star-outline" texto="Nenhum destaque ou lançamento cadastrado no momento." />
                )}

                <Secao titulo="Mix ideal" detalhe="o que mais compra" />
                {sugestoes.mix.length ? (
                  rows(sugestoes.mix.map((p) => p.cod_produto), (cod) => {
                    const c = porCod.get(cod)!;
                    return `${c.pedidos} pedido${c.pedidos === 1 ? '' : 's'} · ${numero(c.quantidade)} ${c.unidade ?? ''} · última ${dataBR(c.ultima_compra)}`;
                  })
                ) : (
                  <Vazio icone="stats-chart-outline" texto="Ainda não há compras deste cliente neste aparelho (sincronize)." />
                )}

                <Secao titulo="Sem giro" detalhe={`há mais de ${DIAS_SEM_GIRO} dias`} />
                {sugestoes.semGiro.length ? (
                  rows(sugestoes.semGiro.map((p) => p.cod_produto), (cod) => `última compra ${dataBR(porCod.get(cod)!.ultima_compra)}`)
                ) : (
                  <Vazio icone="checkmark-circle-outline" texto="Nenhum produto parado: o cliente comprou o que costuma comprar." />
                )}

                <Secao titulo="Últimos comprados" />
                {sugestoes.ultimos.length ? (
                  rows(sugestoes.ultimos.map((p) => p.cod_produto), (cod) => `em ${dataBR(porCod.get(cod)!.ultima_compra)}`)
                ) : (
                  <Vazio icone="time-outline" texto="Sem compras recentes deste cliente." />
                )}

                <Secao titulo="Últimos pedidos" />
                {ultimosPedidos && ultimosPedidos.length ? (
                  ultimosPedidos.map((o) => (
                    <Card key={o.ordem} style={estilos.pedidoAntigo} onPress={() => router.push(`/pedido-sap/${o.ordem}`)}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={estilos.nome}>Pedido {o.ordem}</Text>
                        <Text style={estilos.suave}>
                          {dataBR(o.dt_criacao)} · {moeda(o.valor)} · {o.itens} {o.itens === 1 ? 'item' : 'itens'}
                        </Text>
                      </View>
                      {o.itens > 0 ? (
                        <Pressable style={estilos.repetir} onPress={() => repetir(o.ordem)} hitSlop={6}>
                          <Ionicons name="repeat" size={18} color={cor.primaria} />
                          <Text style={estilos.repetirTexto}>Repetir</Text>
                        </Pressable>
                      ) : null}
                    </Card>
                  ))
                ) : (
                  <Vazio icone="receipt-outline" texto="Nenhum pedido anterior deste cliente neste aparelho." />
                )}
              </>
            );
          })()}
        </ScrollView>
      ) : null}

      <View style={estilos.rodape}>
        <Botao titulo={totalItens ? `Concluir (${totalItens} ${totalItens === 1 ? 'item' : 'itens'})` : 'Voltar'} onPress={() => router.back()} />
      </View>

      <ModalQuantidade
        visivel={escolhido !== null}
        titulo={escolhido?.descricao ?? ''}
        unidade={escolhido?.unidadeTexto ?? ''}
        inicial={quantidadeInicial}
        regra={escolhido?.regra ?? { minimo: null, multiplo: null }}
        confirmarTexto="Adicionar"
        descontoMax={escolhido?.preco?.descontoMax ?? 0}
        // o incentivo depende da quantidade FINAL no carrinho (o que ja tem + o que esta sendo adicionado)
        maxPorQuantidade={
          escolhido
            ? (q) => maxManual(escolhido.preco?.descontoMax ?? 0, incData ? incentivoAplicavel(incData.rows, escolhido.cod_produto, q + qtdAtual(escolhido), incData.ctx, escolhido.classificacao) : null)
            : undefined
        }
        dicaDesconto={
          escolhido && incData
            ? (q) => {
                const inc = incentivoAplicavel(incData.rows, escolhido.cod_produto, q + qtdAtual(escolhido), incData.ctx, escolhido.classificacao);
                return inc ? `Incentivo por quantidade: ${inc.desconto_pct}% automático + até ${inc.desconto_extra_max_pct}% extra seu.` : null;
              }
            : undefined
        }
        onCancelar={() => setEscolhido(null)}
        onConfirmar={adicionar}
      />
    </View>
  );
}

const estilos = StyleSheet.create({
  buscaBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, margin: espaco.lg, marginBottom: espaco.sm, paddingHorizontal: espaco.md,
    backgroundColor: cor.card, borderRadius: raio, borderWidth: 1, borderColor: cor.borda,
  },
  busca: { flex: 1, paddingVertical: 12, fontSize: 16, color: cor.texto },
  aviso: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: espaco.lg, marginTop: espaco.sm },
  avisoTexto: { color: cor.ok, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: espaco.md, backgroundColor: cor.card, borderRadius: raio,
    padding: espaco.md, marginBottom: espaco.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: cor.borda,
  },
  cardNoCarrinho: { borderColor: cor.ok, borderWidth: 1.5, backgroundColor: cor.okFundo },
  botaoMais: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badgeQtd: {
    position: 'absolute', top: -2, right: -4, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5,
    backgroundColor: cor.ok, borderWidth: 2, borderColor: cor.card, alignItems: 'center', justifyContent: 'center',
  },
  badgeQtdTexto: { color: '#fff', fontSize: 11, fontWeight: '800' },
  nome: { fontSize: 15, fontWeight: '700', color: cor.texto },
  suave: { fontSize: 12, color: cor.textoSuave },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  itemCarrinho: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  controle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  passo: { width: 34, height: 34, borderRadius: 17, backgroundColor: cor.neutroFundo, alignItems: 'center', justifyContent: 'center' },
  qtd: { minWidth: 48, alignItems: 'center' },
  qtdTexto: { fontSize: 16, fontWeight: '800', color: cor.texto },
  qtdUnidade: { fontSize: 11, color: cor.textoSuave },
  totalLinha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  total: { fontSize: 22, fontWeight: '800', color: cor.texto },
  minimoAviso: { color: cor.aviso, fontWeight: '700', fontSize: 13, marginTop: 4 },
  minimoOk: { color: cor.ok, fontWeight: '600', fontSize: 13, marginTop: 4 },
  pedidoAntigo: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  repetir: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: cor.neutroFundo },
  repetirTexto: { color: cor.primaria, fontWeight: '700', fontSize: 13 },
  rodape: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: espaco.lg, backgroundColor: cor.fundo,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: cor.borda,
  },
});
