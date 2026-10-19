import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDados, useTickAoFocar } from '@/db/hooks';
import { carteiraParada, contarFila, listarPedidos, vendasPorMes } from '@/db/queries';
import { dataBR, diasAtras, hojeISO, moeda } from '@/lib/format';
import { useSync } from '@/lib/sync-context';
import { BarChart } from '@/ui/BarChart';
import { Card, Secao, Selo, Vazio } from '@/ui/components';
import { seloDoPedido } from '@/ui/status';
import { cor, espaco, raio } from '@/ui/theme';

const NOME_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const valorCurto = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(Math.round(v)));

/** Aba Analise: vendido nos ultimos 3 meses + atalhos para as listas de pedidos e titulos. */
export default function Analise() {
  const router = useRouter();
  const tick = useTickAoFocar();
  const { sincronizar, sincronizando } = useSync();
  const hoje = hojeISO();

  const { dados: meses } = useDados((d) => vendasPorMes(d, hoje, 3), [hoje, tick]);
  const { dados: fila } = useDados(contarFila, [tick]);
  // clientes da carteira sem comprar ha mais de 30 dias (o numero aparece no botao)
  const { dados: parados } = useDados((d) => carteiraParada(d, diasAtras(hoje, 30)), [hoje, tick]);
  const { dados: fila2 } = useDados((d) => listarPedidos(d, 'fila', 50), [tick]);
  // bolinha do botao Pedidos: o que ainda nao chegou ao SAP (fila, erros, rejeitados e aguardando aprovacao)
  const aguardando = (fila?.aguardando ?? 0) + (fila?.erros ?? 0) + (fila?.aprovacao ?? 0);
  const total = (meses ?? []).reduce((s, m) => s + m.total, 0);

  return (
    <ScrollView
      contentContainerStyle={estilos.conteudo}
      refreshControl={<RefreshControl refreshing={sincronizando} onRefresh={sincronizar} tintColor={cor.primaria} colors={[cor.primaria]} />}
    >
      <Secao titulo="Vendido nos últimos 3 meses" detalhe={moeda(total)} />
      <Card>
        <BarChart
          barras={(meses ?? []).map((m, i, todos) => ({
            rotulo: NOME_MES[Number(m.mes.slice(5)) - 1].slice(0, 3),
            valor: m.total,
            destaque: i === todos.length - 1,
          }))}
          formato={valorCurto}
        />
        <Text style={estilos.nota}>Valor dos pedidos da sua carteira. O mês atual (laranja) está em andamento.</Text>
      </Card>

      <View style={estilos.botoes}>
        <Atalho icone="receipt-outline" titulo="Pedidos" badge={aguardando} onPress={() => router.push('/lista-pedidos')} />
        <Atalho icone="cash-outline" titulo="Títulos" onPress={() => router.push('/lista-titulos')} />
        <Atalho icone="moon-outline" titulo="Parados" badge={parados?.length || undefined} neutro onPress={() => router.push('/carteira-parada')} />
      </View>

      <Secao titulo="Pedidos não integrados" detalhe={fila2?.length ? `${fila2.length}` : undefined} />
      {fila2 && fila2.length ? (
        <>
          {fila2.map((p) => {
            const selo = seloDoPedido(p.origem, p.status);
            return (
              <Card key={p.chave} style={estilos.pendente} onPress={() => router.push(`/pedido/${p.chave}`)}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={estilos.pendenteNome} numberOfLines={1}>{p.nome_cliente || p.cod_cliente}</Text>
                  <Text style={estilos.nota2}>
                    {p.codigo ? `Pedido ${p.codigo}` : 'Novo pedido'} · {dataBR(p.data)}
                  </Text>
                  {p.erro ? <Text style={estilos.pendenteErro} numberOfLines={3}>{p.erro}</Text> : null}
                </View>
                {selo ? <Selo texto={selo.texto} tom={selo.tom} /> : null}
              </Card>
            );
          })}
        </>
      ) : (
        <Vazio icone="checkmark-circle-outline" texto="Nenhum pedido aguardando aprovação, envio ou com erro." />
      )}
    </ScrollView>
  );
}

function Atalho({ icone, titulo, badge, neutro, onPress }: { icone: keyof typeof Ionicons.glyphMap; titulo: string; badge?: number; neutro?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [estilos.atalho, pressed ? { opacity: 0.7 } : undefined]}>
      <Ionicons name={icone} size={28} color={cor.primaria} />
      <Text style={estilos.atalhoTexto}>{titulo}</Text>
      {badge ? (
        <View style={[estilos.badge, neutro ? { backgroundColor: cor.amarelo } : undefined]}>
          <Text style={[estilos.badgeTexto, neutro ? { color: cor.texto } : undefined]}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  nota: { fontSize: 12, color: cor.textoSuave, textAlign: 'center', marginTop: espaco.md },
  pendente: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  pendenteNome: { fontSize: 15, fontWeight: '700', color: cor.texto },
  nota2: { fontSize: 13, color: cor.textoSuave },
  pendenteErro: { fontSize: 12, color: cor.erro },
  botoes: { flexDirection: 'row', gap: espaco.md, marginTop: espaco.xl },
  atalho: {
    flex: 1, alignItems: 'center', gap: espaco.sm, paddingVertical: espaco.xl, backgroundColor: cor.card,
    borderRadius: raio, borderWidth: StyleSheet.hairlineWidth, borderColor: cor.borda,
  },
  atalhoTexto: { fontSize: 16, fontWeight: '700', color: cor.texto },
  badge: { position: 'absolute', top: 8, right: 8, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: cor.erro, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeTexto: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
