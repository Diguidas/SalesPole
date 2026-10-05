import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDados } from '@/db/hooks';
import { obterTitulo } from '@/db/queries';
import { dataBR, moeda } from '@/lib/format';
import { Botao, Card, Carregando, Linha, Selo, Vazio } from '@/ui/components';
import { cor, espaco } from '@/ui/theme';

/** Detalhe de um titulo (parcela): valores, datas, ordem de origem, DANFE e boleto. */
export default function TituloTela() {
  const { cod, nfe, parcela } = useLocalSearchParams<{ cod: string; nfe: string; parcela: string }>();
  const router = useRouter();
  const { dados: t, carregando } = useDados((d) => obterTitulo(d, cod, nfe ?? '', parcela ?? ''), [cod, nfe, parcela]);

  if (carregando) return <Carregando />;
  if (!t) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Vazio icone="cash-outline" texto="Título não encontrado neste aparelho." />
      </View>
    );
  }

  const tom = t.status === 'Atrasado' ? 'erro' : t.status === 'Compensado' ? 'ok' : 'aviso';
  const abrir = (url: string | null) => url && Linking.openURL(url).catch(() => Alert.alert('Não foi possível abrir o link.'));

  return (
    <ScrollView contentContainerStyle={estilos.conteudo}>
      <Stack.Screen options={{ title: `NF ${t.nfe || '—'}${t.parcela ? ` · ${t.parcela}` : ''}` }} />

      <Card>
        <Text style={estilos.cliente}>{t.nome_cliente || t.cod_cliente}</Text>
        <View style={estilos.selos}>{t.status ? <Selo texto={t.status} tom={tom} /> : null}</View>
        <Text style={estilos.valor}>{moeda(t.valor)}</Text>
        <View style={{ marginTop: espaco.sm }}>
          <Linha rotulo="Nota fiscal" valor={t.nfe || '—'} />
          <Linha rotulo="Parcela" valor={t.parcela || '—'} />
          <Linha rotulo="Vencimento" valor={dataBR(t.vencimento)} />
          {t.dt_compensacao ? <Linha rotulo="Pago em" valor={dataBR(t.dt_compensacao)} /> : null}
          {t.ordem ? <Linha rotulo="Pedido" valor={t.ordem} /> : null}
        </View>
      </Card>

      <View style={estilos.acoes}>
        {t.boleto_url ? (
          <Botao titulo="Abrir boleto" onPress={() => abrir(t.boleto_url)} />
        ) : (
          <View style={estilos.semLink}>
            <Ionicons name="information-circle-outline" size={18} color={cor.textoSuave} />
            <Text style={estilos.semLinkTexto}>
              {t.status === 'Compensado' ? 'Título já pago.' : 'Boleto ainda não disponível para este título.'}
            </Text>
          </View>
        )}
        {t.danfe_url ? <Botao titulo="Abrir DANFE" onPress={() => abrir(t.danfe_url)} tom="neutro" /> : null}
        {t.ordem && t.ordem_no_aparelho ? <Botao titulo="Ver pedido" onPress={() => router.push(`/pedido-sap/${t.ordem}`)} tom="neutro" /> : null}
      </View>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  cliente: { fontSize: 18, fontWeight: '800', color: cor.texto },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: espaco.sm },
  valor: { fontSize: 28, fontWeight: '800', color: cor.texto, marginTop: espaco.sm },
  acoes: { marginTop: espaco.lg, gap: espaco.sm },
  semLink: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  semLinkTexto: { color: cor.textoSuave, fontSize: 14 },
});
