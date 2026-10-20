import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDados, useTickAoFocar } from '@/db/hooks';
import { obterCliente, pedidosDoCliente, titulosDoCliente } from '@/db/queries';
import { dataBR, moeda } from '@/lib/format';
import { Card, Secao, Selo, Vazio } from '@/ui/components';
import { seloDoPedido } from '@/ui/status';
import { cor, espaco } from '@/ui/theme';

export default function PedidosDoCliente() {
  const { cod } = useLocalSearchParams<{ cod: string }>();
  const router = useRouter();
  const tick = useTickAoFocar();
  const { dados: c } = useDados((db) => obterCliente(db, cod), [cod]);
  const { dados: pedidos } = useDados((db) => pedidosDoCliente(db, cod, 100), [cod, tick]);
  const { dados: titulos } = useDados((db) => titulosDoCliente(db, cod), [cod]);

  return (
    <ScrollView contentContainerStyle={estilos.conteudo}>
      <Stack.Screen options={{ title: c?.nome_fantasia || c?.razao_social || 'Pedidos' }} />

      <Secao titulo="Pedidos" detalhe={pedidos?.length ? `${pedidos.length} recentes` : undefined} />
      {pedidos && pedidos.length ? (
        pedidos.map((p) => {
          const selo = seloDoPedido(p.origem, p.status);
          return (
            <Card
              key={`${p.origem}-${p.chave}`}
              style={estilos.item}
              onPress={() => router.push(p.origem === 'sap' ? `/pedido-sap/${p.chave}` : `/pedido/${p.chave}`)}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={estilos.itemTitulo}>
                  {p.origem === 'sap' ? `Pedido ${p.chave}` : `Pedido ${p.codigo ?? 'novo'}`}
                  {p.origem === 'sap' && p.codigo ? <Text style={estilos.itemSuave}>  · app {p.codigo}</Text> : null}
                </Text>
                <Text style={estilos.itemSuave}>{dataBR(p.data)}{p.valor !== null ? ` · ${moeda(p.valor)}` : ''}</Text>
                {p.erro ? <Text style={estilos.erro} numberOfLines={3}>{p.erro}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
  {p.bonificacao ? <Selo texto="Bonificação" tom="neutro" /> : null}
  {selo ? <Selo texto={selo.texto} tom={selo.tom} /> : null}
</View>
            </Card>
          );
        })
      ) : (
        <Vazio icone="receipt-outline" texto="Nenhum pedido nos últimos 90 dias." />
      )}

      <Secao titulo="Títulos" detalhe={titulos?.length ? `${titulos.length}` : undefined} />
      {titulos && titulos.length ? (
        titulos.map((t) => (
          <Card key={`${t.nfe}-${t.parcela}`} style={estilos.item} onPress={() => router.push({ pathname: '/titulo', params: { cod, nfe: t.nfe, parcela: t.parcela } })}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={estilos.itemTitulo}>NF {t.nfe || '—'}{t.parcela ? ` · parcela ${t.parcela}` : ''}</Text>
              <Text style={estilos.itemSuave}>
                {t.status === 'Compensado' ? `Pago em ${dataBR(t.dt_compensacao)}` : `Vence em ${dataBR(t.vencimento)}`} · {moeda(t.valor)}
              </Text>
            </View>
            {t.status ? <Selo texto={t.status} tom={t.status === 'Atrasado' ? 'erro' : t.status === 'Compensado' ? 'ok' : 'aviso'} /> : null}
          </Card>
        ))
      ) : (
        <Vazio icone="cash-outline" texto="Nenhum título para este cliente." />
      )}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  itemTitulo: { fontSize: 15, fontWeight: '700', color: cor.texto },
  itemSuave: { fontSize: 13, color: cor.textoSuave, fontWeight: '400' },
  erro: { fontSize: 12, color: cor.erro },
});
