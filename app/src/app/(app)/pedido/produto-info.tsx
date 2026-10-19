import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { infoProdutos, rotulo, type ProdutoCatalogo } from '@/db/catalogo';
import { colocarNoCarrinho } from '@/db/carrinho';
import { feriadosDoCliente } from '@/db/feriados';
import { useDados } from '@/db/hooks';
import { carregarIncentivos } from '@/db/incentivos';
import { lerPedidoApp } from '@/db/pedidos';
import { fichaDoProduto } from '@/db/produto';
import { obterCliente } from '@/db/queries';
import { HORA_CORTE, previsaoEntrega } from '@/domain/entrega';
import { faixasDoProduto, incentivoAplicavel, maxManual, type Classificacao, type Incentivo } from '@/domain/incentivo';
import { aplicarDesconto, lerDesconto } from '@/domain/pedido';
import { formatarQuantidade, lerQuantidade, validarQuantidade } from '@/domain/quantidade';
import { dataBR, dataComDia, hojeISO, moeda, numero } from '@/lib/format';
import { Botao, Card, Carregando, Linha, Secao, Segmentado, Vazio } from '@/ui/components';
import { FotoProduto } from '@/ui/FotoProduto';
import { cor, espaco, raio } from '@/ui/theme';

type Aba = 'preco' | 'incentivo';

/** A que produtos a regra se aplica (alem de quem compra). */
function alvoDaRegra(f: Incentivo, cls?: Classificacao): string {
  if (f.cod_produto) return 'só este produto';
  // a regra e por ID; o nome vem do proprio produto (a regra so aparece aqui quando o ID bate com ele)
  const c = [
    f.linha_id && `linha ${cls?.linha || f.linha_id}`,
    f.grupo_id && `grupo ${cls?.grupo || f.grupo_id}`,
    f.categoria_id && `categoria ${cls?.categoria || f.categoria_id}`,
    f.marca && `marca ${f.marca}`,
  ].filter(Boolean);
  return c.length ? c.join(' · ') : 'todos os produtos';
}

const ESCOPO: Record<string, string> = {
  geral: 'todos os clientes',
  produto: 'todos os clientes',
  cliente: 'este cliente',
  vendedor: 'você',
  canal: 'o canal deste cliente',
  escritorio: 'o escritório deste cliente',
};

export default function ProdutoInfo() {
  const { id, cod } = useLocalSearchParams<{ id: string; cod: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const hoje = hojeISO();

  const { dados: pedido } = useDados((d) => lerPedidoApp(d, id), [id]);
  const { dados: cliente } = useDados(async (d) => (pedido ? obterCliente(d, pedido.cod_cliente) : null), [pedido?.cod_cliente]);
  const { dados: ficha } = useDados((d) => fichaDoProduto(d, cod), [cod]);
  const { dados: incData } = useDados(
    async (d) => (cliente ? carregarIncentivos(d, cliente.cod_cliente, cliente.areas) : null),
    [cliente?.cod_cliente],
  );
  const codsCarrinho = (pedido?.itens ?? []).map((i) => i.produto);
  const { dados: infoTodos, carregando } = useDados(
    async (d): Promise<Record<string, ProdutoCatalogo>> =>
      cliente ? infoProdutos(d, cliente.areas, [...new Set([cod, ...codsCarrinho])], hoje) : {},
    [cliente?.cod_cliente, cod, codsCarrinho.join(',')],
  );
  const p = infoTodos?.[cod];

  const existente = pedido?.itens.find((i) => i.produto === cod && p && i.unidade === p.unidade);

  const [aba, setAba] = useState<Aba>('preco');
  const [qtdTxt, setQtdTxt] = useState('');
  const [descTxt, setDescTxt] = useState('');
  const [composicao, setComposicao] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [iniciou, setIniciou] = useState(false);

  // valores iniciais: o que ja esta no carrinho, ou o minimo do produto
  useEffect(() => {
    if (iniciou || !p || !pedido) return;
    const q = existente ? existente.quantidade : String(p.regra.minimo ?? p.regra.multiplo ?? 1);
    setQtdTxt(q);
    const manual = existente ? (existente.descontoManual ?? existente.desconto) : null;
    setDescTxt(manual ? String(manual).replace('.', ',') : '');
    setIniciou(true);
  }, [iniciou, p, pedido, existente]);

  const qtd = lerQuantidade(qtdTxt) ?? 0;
  const passo = p?.regra.multiplo ?? 1;
  const minimo = p?.regra.minimo ?? passo;

  const maxLista = p?.preco?.descontoMax ?? 0;
  const inc = p && incData ? incentivoAplicavel(incData.rows, cod, qtd, incData.ctx, p.classificacao) : null;
  const faixas = p && incData ? faixasDoProduto(incData.rows, cod, incData.ctx, p.classificacao) : [];
  const maxVendedor = maxManual(maxLista, inc);
  const auto = inc ? inc.desconto_pct : 0;
  const manualLido = lerDesconto(descTxt);
  const manual = manualLido ?? 0;
  const passouDoMax = manualLido !== null && manual > maxVendedor + 1e-9;
  const manualValido = Math.min(manual, maxVendedor);
  const totalDesc = auto + manualValido;

  const tabela = p?.preco && p.preco.unidade === p.unidade ? p.preco.valor : null; // preco na unidade do pedido (caixa)
  const precoFinal = tabela !== null ? aplicarDesconto(tabela, totalDesc) : null;
  const total = precoFinal !== null ? precoFinal * qtd : null;

  const { dados: feriados } = useDados((d) => feriadosDoCliente(d, cliente?.endereco), [cliente?.cod_cliente]);
  const prev = useMemo(
    () => (cliente && p ? previsaoEntrega(cliente.dias_entrega, new Date(), p.prazoDias, feriados?.datas ?? new Set<string>()) : null),
    [cliente, p, feriados],
  );
  const entrega = prev?.data ?? null;

  function ajustar(sinal: 1 | -1) {
    const novo = Math.round((qtd + sinal * passo) * 1000) / 1000;
    setQtdTxt(formatarQuantidade(Math.max(minimo, novo)));
  }

  async function adicionar() {
    if (!p || !pedido) return;
    const q = lerQuantidade(qtdTxt);
    if (q === null) return Alert.alert('Quantidade inválida', 'Informe uma quantidade válida (até 3 casas decimais).');
    const msg = validarQuantidade(q, p.regra);
    if (msg) return Alert.alert('Quantidade', msg);
    if (manualLido === null) return Alert.alert('Desconto inválido', 'Use um percentual com até 2 casas decimais.');
    if (passouDoMax) return Alert.alert('Desconto acima do máximo', `O máximo para esta quantidade é ${numero(maxVendedor)}%.`);
    setOcupado(true);
    try {
      await colocarNoCarrinho(db, id, pedido.itens, p, q, manualValido, 'definir', infoTodos ?? {}, incData ?? null);
      router.back();
    } finally {
      setOcupado(false);
    }
  }

  if (carregando && !p) return <Carregando />;
  if (!p || !pedido) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Vazio icone="cube-outline" texto="Produto não encontrado neste aparelho ou indisponível para este cliente." />
      </View>
    );
  }

  const un = p.unidadeTexto;
  const valorDesc = (pct: number) => (tabela !== null ? tabela * (pct / 100) : null);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Informações do produto' }} />
      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        <View style={estilos.fotoBox}>
          <FotoProduto cod={cod} tamanho={220} />
        </View>
        <Text style={estilos.titulo}>{p.descricao}</Text>
        <Text style={estilos.codigo}>Código {cod}</Text>

        <Card style={{ marginTop: espaco.md }}>
          <Linha rotulo="Unidade de medida" valor={un} />
          {ficha?.fatorVenda && ficha.unidadeBaseTexto && ficha.unidadeBase !== p.unidade ? (
            <Linha rotulo="Conversão" valor={`1 ${un} = ${numero(ficha.fatorVenda)} ${ficha.unidadeBaseTexto}`} />
          ) : null}
          <Linha rotulo="Quantidade mínima" valor={p.regra.minimo ? `${numero(p.regra.minimo)} ${un}` : 'Sem mínimo'} />
          {p.regra.multiplo && p.regra.multiplo !== 1 ? <Linha rotulo="Múltiplo" valor={`${numero(p.regra.multiplo)} ${un}`} /> : null}
        </Card>

        <View style={{ marginTop: espaco.lg }}>
          <Segmentado
            opcoes={faixas.length ? [{ valor: 'preco', texto: 'Preço e desconto' }, { valor: 'incentivo', texto: 'Desconto por incentivo' }] : [{ valor: 'preco', texto: 'Preço e desconto' }]}
            valor={aba}
            onChange={setAba}
          />
        </View>

        {aba === 'preco' ? (
          <Card style={{ marginTop: espaco.sm }}>
            {tabela !== null ? (
              <>
                <Linha rotulo="Preço de tabela" valor={`${moeda(tabela)} / ${un}`} />
                <Linha rotulo="Desconto máximo da lista" valor={maxLista > 0 ? `${numero(maxLista)}%` : 'sem desconto'} />
                {inc ? (
                  <Text style={estilos.incentivoTxt}>
                    Incentivo nesta quantidade: {numero(inc.desconto_pct)}% já aplicado + até {numero(inc.desconto_extra_max_pct)}% extra seu.
                  </Text>
                ) : null}

                {maxVendedor > 0 ? (
                  <View style={{ marginTop: espaco.sm, gap: 4 }}>
                    <Text style={estilos.rotulo}>Desconto que quero dar (máx. {numero(maxVendedor)}%)</Text>
                    <View style={estilos.linhaInput}>
                      <TextInput
                        style={[estilos.campo, passouDoMax ? { borderColor: cor.erro } : undefined]}
                        value={descTxt}
                        onChangeText={setDescTxt}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={cor.textoSuave}
                        selectTextOnFocus
                      />
                      <Text style={estilos.sufixo}>%</Text>
                    </View>
                    {passouDoMax ? <Text style={estilos.erro}>Acima do máximo para esta quantidade ({numero(maxVendedor)}%).</Text> : null}
                    {manualLido === null ? <Text style={estilos.erro}>Desconto inválido.</Text> : null}
                  </View>
                ) : (
                  <Text style={estilos.suave}>Esta lista de preço não permite desconto.</Text>
                )}

                <View style={estilos.finalBox}>
                  <Text style={estilos.suave}>Preço final</Text>
                  <Text style={estilos.final}>{moeda(precoFinal)} <Text style={estilos.finalUn}>/ {un}</Text></Text>
                  {total !== null && qtd > 0 ? <Text style={estilos.suave}>{numero(qtd)} {un} = {moeda(total)}</Text> : null}
                </View>

                <Pressable onPress={() => setComposicao((v) => !v)} style={estilos.verComposicao}>
                  <Ionicons name={composicao ? 'chevron-up' : 'chevron-down'} size={16} color={cor.primaria} />
                  <Text style={estilos.verComposicaoTxt}>{composicao ? 'Ocultar composição do preço' : 'Ver composição do preço'}</Text>
                </Pressable>
                {composicao ? (
                  <View style={estilos.composicao}>
                    <Linha rotulo="Preço de tabela" valor={moeda(tabela)} />
                    <Linha rotulo={`− Desconto do vendedor (${numero(manualValido)}%)`} valor={manualValido > 0 ? `− ${moeda(valorDesc(manualValido))}` : '—'} />
                    <Linha rotulo={`− Incentivo por quantidade (${numero(auto)}%)`} valor={auto > 0 ? `− ${moeda(valorDesc(auto))}` : '—'} />
                    <View style={estilos.sep} />
                    <Linha rotulo="= Preço final" valor={moeda(precoFinal)} />
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={estilos.suave}>
                {p.preco
                  ? `Preço de referência ${moeda(p.preco.valor)} / ${rotulo(p, p.preco.unidade)} (sem conversão para ${un}). O SAP aplica a lista no pedido.`
                  : 'Sem preço de tabela. O SAP aplica a lista no pedido.'}
              </Text>
            )}
          </Card>
        ) : (
          <Card style={{ marginTop: espaco.sm }}>
            {faixas.map((f) => {
              const ativa = inc?.id === f.id;
              return (
                <View key={f.id} style={[estilos.faixa, ativa ? estilos.faixaAtiva : undefined]}>
                  <View style={{ flex: 1 }}>
                    <Text style={estilos.faixaTitulo}>{f.qtd_minima > 0 ? `A partir de ${numero(f.qtd_minima)} ${un}` : 'Desconto fixo (sem quantidade mínima)'}</Text>
                    <Text style={estilos.suave}>vale para {ESCOPO[f.escopo] ?? f.escopo} · {alvoDaRegra(f, p.classificacao)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={estilos.faixaPct}>{numero(f.desconto_pct)}%</Text>
                    <Text style={estilos.suave}>+ até {numero(f.desconto_extra_max_pct)}% extra</Text>
                  </View>
                </View>
              );
            })}
            <Text style={[estilos.suave, { marginTop: espaco.sm }]}>
              O desconto do incentivo é aplicado sozinho quando a quantidade do carrinho atinge a faixa. O extra é opcional e fica a seu critério.
            </Text>
          </Card>
        )}

        <Secao titulo="Ficha técnica" />
        <Card>
          <Linha rotulo="Linha" valor={ficha?.linha} />
          <Linha rotulo="Grupo" valor={ficha?.grupo} />
          <Linha rotulo="Categoria" valor={ficha?.categoria} />
          <Linha rotulo="Marca" valor={ficha?.marca} />
          <Linha rotulo="NCM" valor={ficha?.ncm} />
          <Linha rotulo="EAN" valor={ficha?.ean} />
        </Card>

        <Secao titulo="Previsão de entrega" />
        <Card>
          <Linha rotulo="Prazo de produção" valor={`${p.prazoDias} ${p.prazoDias === 1 ? 'dia' : 'dias'}`} />
          <Linha rotulo="Entrega prevista (só este produto)" valor={entrega ? dataComDia(entrega) : '—'} />
          {prev?.aposCorte ? (
            <Text style={estilos.avisoEntrega}>Depois das {HORA_CORTE}h o pedido conta como de amanhã.</Text>
          ) : null}
          {prev?.feriadosPulados.length ? (
            <Text style={estilos.avisoEntrega}>
              Feriado sem entrega: {prev.feriadosPulados.slice(0, 3).map((d) => `${dataBR(d)}${feriados?.descricao.get(d) ? ` (${feriados.descricao.get(d)})` : ''}`).join(', ')}. Entrega ajustada.
            </Text>
          ) : null}
        </Card>
      </ScrollView>

      <View style={estilos.rodape}>
        <View style={estilos.contador}>
          <Pressable onPress={() => ajustar(-1)} hitSlop={8} style={estilos.passo}>
            <Ionicons name="remove" size={22} color={cor.texto} />
          </Pressable>
          <View style={estilos.qtdBox}>
            <TextInput
              style={estilos.qtdInput}
              value={qtdTxt}
              onChangeText={setQtdTxt}
              keyboardType="decimal-pad"
              selectTextOnFocus
            />
            <Text style={estilos.qtdUn}>{un}</Text>
          </View>
          <Pressable onPress={() => ajustar(1)} hitSlop={8} style={estilos.passo}>
            <Ionicons name="add" size={22} color={cor.texto} />
          </Pressable>
        </View>
        <View style={{ flex: 1 }}>
          <Botao
            titulo={`${existente ? 'Atualizar carrinho' : 'Adicionar ao carrinho'}${total !== null && qtd > 0 ? ` · ${moeda(total)}` : ''}`}
            onPress={adicionar}
            carregando={ocupado}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const estilos = StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: 120 },
  fotoBox: { alignItems: 'center', paddingVertical: espaco.md },
  titulo: { fontSize: 20, fontWeight: '800', color: cor.texto },
  codigo: { fontSize: 13, color: cor.textoSuave, marginTop: 2 },
  rotulo: { fontSize: 13, color: cor.textoSuave },
  suave: { fontSize: 13, color: cor.textoSuave },
  erro: { fontSize: 12, color: cor.erro },
  avisoEntrega: { fontSize: 12, color: cor.aviso, marginTop: 4 },
  incentivoTxt: { fontSize: 13, color: cor.ok, fontWeight: '600', marginTop: 4 },
  linhaInput: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  campo: {
    flex: 1, borderWidth: 1, borderColor: cor.borda, borderRadius: raio, paddingHorizontal: espaco.lg, paddingVertical: 10,
    fontSize: 18, fontWeight: '700', color: cor.texto,
  },
  sufixo: { fontSize: 16, fontWeight: '700', color: cor.textoSuave },
  finalBox: { marginTop: espaco.md, paddingTop: espaco.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: cor.borda },
  final: { fontSize: 28, fontWeight: '800', color: cor.primaria },
  finalUn: { fontSize: 14, fontWeight: '600', color: cor.textoSuave },
  verComposicao: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: espaco.md },
  verComposicaoTxt: { color: cor.primaria, fontWeight: '700', fontSize: 14 },
  composicao: { marginTop: espaco.sm, padding: espaco.md, backgroundColor: cor.fundo, borderRadius: raio },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: cor.borda, marginVertical: 4 },
  faixa: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, paddingVertical: espaco.sm, paddingHorizontal: espaco.sm, borderRadius: raio },
  faixaAtiva: { backgroundColor: cor.okFundo },
  faixaTitulo: { fontSize: 15, fontWeight: '700', color: cor.texto },
  faixaPct: { fontSize: 20, fontWeight: '800', color: cor.ok },
  rodape: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: espaco.md,
    padding: espaco.md, backgroundColor: cor.fundo, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: cor.borda,
  },
  contador: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  passo: { width: 40, height: 40, borderRadius: 20, backgroundColor: cor.neutroFundo, alignItems: 'center', justifyContent: 'center' },
  qtdBox: { alignItems: 'center', minWidth: 56 },
  qtdInput: { fontSize: 18, fontWeight: '800', color: cor.texto, textAlign: 'center', minWidth: 56, padding: 0 },
  qtdUn: { fontSize: 11, color: cor.textoSuave },
});
