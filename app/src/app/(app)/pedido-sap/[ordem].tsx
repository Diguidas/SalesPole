import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDados } from '@/db/hooks';
import { duplicarPedidoSap } from '@/db/pedidos';
import { itensDoPedidoSap, obterPedidoSap, pedidoAppDaOrdem } from '@/db/queries';
import { dataBR, moeda, numero } from '@/lib/format';
import { Botao, Card, Carregando, Linha, Secao, Selo, Vazio } from '@/ui/components';
import { seloDoPedido } from '@/ui/status';
import { cor, espaco } from '@/ui/theme';

/** Detalhe de uma ordem de venda que veio do SAP (itens, notas e boleto). */
export default function PedidoSapTela() {
  const { ordem } = useLocalSearchParams<{ ordem: string }>();
  const db = useSQLiteContext();
  const router = useRouter();

  const { dados: p, carregando } = useDados((d) => obterPedidoSap(d, ordem), [ordem]);
  const { dados: itens } = useDados((d) => itensDoPedidoSap(d, ordem), [ordem]);
  // ordem recem-criada pelo app: ainda nao veio do SAP no sync, mas o pedido local ja a conhece
  const { dados: idLocal } = useDados((d) => (p ? Promise.resolve(null) : pedidoAppDaOrdem(d, ordem)), [ordem, p, carregando]);
  useEffect(() => {
    if (!carregando && !p && idLocal) router.replace(`/pedido/${idLocal}`);
  }, [carregando, p, idLocal, router]);

  if (carregando) return <Carregando />;
  if (!p) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Vazio icone="document-outline" texto="Este pedido ainda não foi baixado neste aparelho. Pedidos novos aparecem após sincronizar; pedidos com mais de 90 dias não ficam no aparelho." />
      </View>
    );
  }

  const selo = seloDoPedido('sap', p.status);
  const abrir = (url: string | null) => url && Linking.openURL(url).catch(() => Alert.alert('Não foi possível abrir o link.'));

  async function duplicar() {
    const novo = await duplicarPedidoSap(db, ordem);
    if (!novo) return Alert.alert('Não foi possível duplicar', 'Este pedido não tem itens disponíveis neste aparelho.');
    router.replace(`/pedido/${novo}`);
  }

  return (
    <ScrollView contentContainerStyle={estilos.conteudo}>
      <Stack.Screen options={{ title: `Pedido ${p.ordem}` }} />

      <Card>
        <Text style={estilos.cliente}>{p.nome_cliente || p.cod_cliente}</Text>
        <View style={estilos.selos}>{selo ? <Selo texto={selo.texto} tom={selo.tom} /> : null}</View>
        <View style={{ marginTop: espaco.sm }}>
          <Linha rotulo="Criado em" valor={dataBR(p.dt_criacao)} />
          <Linha rotulo="Entrega" valor={dataBR(p.dt_entrega)} />
          <Linha rotulo="Valor" valor={moeda(p.valor)} />
          {p.pedido_externo ? <Linha rotulo="Código do app" valor={p.pedido_externo} /> : null}
        </View>
      </Card>

      {p.notas.length ? (
        <>
          <Secao titulo="Notas fiscais" />
          {p.notas.map((n, i) => (
            <Card key={`${n.nota_fiscal}-${i}`} style={estilos.nota}>
              <View style={{ flex: 1 }}>
                <Text style={estilos.notaTitulo}>NF {n.nota_fiscal || '—'}{n.serie ? `-${n.serie}` : ''}</Text>
              </View>
              {n.danfe_url ? (
                <Pressable onPress={() => abrir(n.danfe_url)} style={estilos.link}>
                  <Ionicons name="document-text-outline" size={18} color={cor.primaria} />
                  <Text style={estilos.linkTexto}>DANFE</Text>
                </Pressable>
              ) : null}
              {n.boleto_url ? (
                <Pressable onPress={() => abrir(n.boleto_url)} style={estilos.link}>
                  <Ionicons name="barcode-outline" size={18} color={cor.primaria} />
                  <Text style={estilos.linkTexto}>Boleto</Text>
                </Pressable>
              ) : null}
              {!n.danfe_url && !n.boleto_url ? <Text style={estilos.itemSuave}>Documentos ainda não disponíveis</Text> : null}
            </Card>
          ))}
        </>
      ) : null}

      <Secao titulo="Itens" detalhe={itens?.length ? `${itens.length}` : undefined} />
      {itens && itens.length ? (
        itens.map((i) => (
          <Card key={i.item} style={estilos.item}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={estilos.itemNome} numberOfLines={2}>{i.denominacao || i.cod_produto}</Text>
              <Text style={estilos.itemSuave}>
                {numero(i.quantidade)} {i.unidade_venda ?? ''}
                {i.valor_unitario ? ` · ${moeda(i.valor_unitario)}/${i.unidade_venda ?? 'un'}` : ''}
              </Text>
              {i.recusa ? <Text style={estilos.recusa}>Item recusado: {i.recusa}</Text> : null}
            </View>
          </Card>
        ))
      ) : (
        <Vazio icone="cube-outline" texto="Os itens deste pedido ainda não foram baixados. Sincronize com a internet ligada." />
      )}

      <View style={{ marginTop: espaco.lg }}>
        <Botao titulo="Duplicar pedido" onPress={duplicar} tom="neutro" desabilitado={!itens?.length} />
      </View>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  cliente: { fontSize: 18, fontWeight: '800', color: cor.texto },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: espaco.sm },
  nota: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  notaTitulo: { fontSize: 15, fontWeight: '700', color: cor.texto },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  linkTexto: { color: cor.primaria, fontWeight: '700', fontSize: 13 },
  item: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  itemNome: { fontSize: 15, fontWeight: '700', color: cor.texto },
  itemSuave: { fontSize: 13, color: cor.textoSuave },
  recusa: { fontSize: 12, color: cor.erro, fontWeight: '600' },
});
