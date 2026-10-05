import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { buscarProdutos, rotulo, type ProdutoCatalogo } from '@/db/catalogo';
import { useDados } from '@/db/hooks';
import { lerPedidoApp, salvarItens } from '@/db/pedidos';
import { obterCliente } from '@/db/queries';
import { adicionarItem } from '@/domain/pedido';
import { formatarQuantidade } from '@/domain/quantidade';
import { hojeISO, moeda } from '@/lib/format';
import { Botao, Selo, Vazio } from '@/ui/components';
import { ModalQuantidade } from '@/ui/ModalQuantidade';
import { cor, espaco, raio } from '@/ui/theme';

export default function ProdutosDoPedido() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const hoje = hojeISO();

  const [busca, setBusca] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [escolhido, setEscolhido] = useState<ProdutoCatalogo | null>(null);

  const { dados: pedido } = useDados((d) => lerPedidoApp(d, id), [id, recarga]);
  const { dados: cliente } = useDados(async (d) => (pedido ? obterCliente(d, pedido.cod_cliente) : null), [pedido?.cod_cliente]);
  const { dados: produtos } = useDados(
    async (d) => (cliente ? buscarProdutos(d, cliente.areas, busca, hoje) : []),
    [cliente?.cod_cliente, busca],
  );

  const noPedido = useMemo(() => new Map((pedido?.itens ?? []).map((i) => [`${i.produto}|${i.unidade}`, i.quantidade])), [pedido]);

  async function adicionar(q: number, desconto: number) {
    if (!escolhido || !pedido) return;
    const novos = adicionarItem(pedido.itens, {
      produto: escolhido.cod_produto,
      unidade: escolhido.unidade,
      quantidade: formatarQuantidade(q),
      desconto: desconto > 0 ? desconto : null,
    });
    await salvarItens(db, id, novos);
    setAviso(`Adicionado: ${escolhido.descricao}`);
    setEscolhido(null);
    setRecarga((r) => r + 1);
  }

  const totalItens = pedido?.itens.length ?? 0;
  const quantidadeInicial = escolhido ? String(escolhido.regra.minimo ?? escolhido.regra.multiplo ?? 1) : '1';

  return (
    <View style={{ flex: 1 }}>
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

      {aviso ? (
        <View style={estilos.aviso}>
          <Ionicons name="checkmark-circle" size={16} color={cor.ok} />
          <Text style={estilos.avisoTexto} numberOfLines={1}>{aviso}</Text>
        </View>
      ) : null}

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
        renderItem={({ item: p }) => {
          const jaTem = noPedido.get(`${p.cod_produto}|${p.unidade}`);
          return (
            <Pressable
              onPress={() => p.disponivel && setEscolhido(p)}
              disabled={!p.disponivel}
              style={({ pressed }) => [estilos.card, !p.disponivel ? { opacity: 0.45 } : undefined, pressed ? { opacity: 0.7 } : undefined]}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={estilos.nome} numberOfLines={2}>{p.descricao}</Text>
                <Text style={estilos.suave}>
                  Cód. {p.cod_produto} · vendido em {p.unidadeTexto}
                  {p.regra.multiplo && p.regra.multiplo !== 1 ? ` · múltiplo ${p.regra.multiplo}` : ''}
                  {p.regra.minimo ? ` · mín. ${p.regra.minimo}` : ''}
                </Text>
                {p.preco?.tabela ? (
                  <Text style={estilos.suave}>Tabela: {moeda(p.preco.tabela.valor)}/{rotulo(p, p.preco.tabela.unidade)}</Text>
                ) : null}
                <View style={estilos.selos}>
                  <Selo texto={p.preco ? `${moeda(p.preco.valor)}/${rotulo(p, p.preco.unidade)}` : 'sem preço'} tom={p.preco ? 'neutro' : 'aviso'} />
                  {!p.disponivel ? <Selo texto="Indisponível para este cliente" tom="erro" /> : null}
                  {jaTem ? <Selo texto={`No pedido: ${jaTem}`} tom="aviso" /> : null}
                </View>
              </View>
              {p.disponivel ? <Ionicons name="add-circle" size={30} color={cor.primaria} /> : null}
            </Pressable>
          );
        }}
      />

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
  aviso: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: espaco.lg, marginBottom: 4 },
  avisoTexto: { color: cor.ok, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: espaco.md, backgroundColor: cor.card, borderRadius: raio,
    padding: espaco.md, marginBottom: espaco.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: cor.borda,
  },
  nome: { fontSize: 15, fontWeight: '700', color: cor.texto },
  suave: { fontSize: 12, color: cor.textoSuave },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  rodape: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: espaco.lg, backgroundColor: cor.fundo,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: cor.borda,
  },
});
