import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { dataBR, moeda } from '@/lib/format';
import { Botao, Card, Linha, Selo } from '@/ui/components';
import { cor, espaco, estilosTema } from '@/ui/theme';

/** Título visto pelo supervisor/gerente (modo equipe): valores, datas e atalhos para boleto, DANFE e pedido. Os dados vêm da ficha do cliente. */
export default function TituloEquipe() {
  const p = useLocalSearchParams<{ cliente: string; nfe: string; parcela: string; status: string; valor: string; vencimento: string; pago: string; ordem: string; danfe: string; boleto: string }>();
  const router = useRouter();
  const valor = p.valor ? Number(p.valor) : null;
  const tom = p.status === 'Atrasado' ? 'erro' : p.status === 'Compensado' ? 'ok' : 'aviso';
  const abrir = (url?: string) => url && Linking.openURL(url).catch(() => Alert.alert('Não foi possível abrir o link.'));

  return (
    <ScrollView contentContainerStyle={estilos.conteudo}>
      <Stack.Screen options={{ title: `NF ${p.nfe || '—'}${p.parcela ? ` · ${p.parcela}` : ''}` }} />

      <Card>
        <Text style={estilos.cliente}>{p.cliente}</Text>
        <View style={estilos.selos}>{p.status ? <Selo texto={p.status} tom={tom} /> : null}</View>
        <Text style={estilos.valor}>{moeda(valor)}</Text>
        <View style={{ marginTop: espaco.sm }}>
          <Linha rotulo="Nota fiscal" valor={p.nfe} />
          <Linha rotulo="Parcela" valor={p.parcela} />
          <Linha rotulo="Vencimento" valor={p.vencimento ? dataBR(p.vencimento) : null} />
          {p.pago ? <Linha rotulo="Pago em" valor={dataBR(p.pago)} /> : null}
          {p.ordem ? <Linha rotulo="Pedido" valor={p.ordem} /> : null}
        </View>
      </Card>

      <View style={estilos.acoes}>
        {p.boleto ? (
          <Botao titulo="Abrir boleto" onPress={() => abrir(p.boleto)} />
        ) : (
          <View style={estilos.semLink}>
            <Ionicons name="information-circle-outline" size={18} color={cor.textoSuave} />
            <Text style={estilos.semLinkTexto}>{p.status === 'Compensado' ? 'Título já pago.' : 'Boleto ainda não disponível para este título.'}</Text>
          </View>
        )}
        {p.danfe ? <Botao titulo="Abrir DANFE" onPress={() => abrir(p.danfe)} tom="neutro" /> : null}
        {p.ordem ? <Botao titulo="Ver pedido" onPress={() => router.push(`/pedido-equipe/${p.ordem}`)} tom="neutro" /> : null}
      </View>
    </ScrollView>
  );
}

const estilos = estilosTema(() => StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  cliente: { fontSize: 18, fontWeight: '800', color: cor.texto },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: espaco.sm },
  valor: { fontSize: 28, fontWeight: '800', color: cor.texto, marginTop: espaco.sm },
  acoes: { marginTop: espaco.lg, gap: espaco.sm },
  semLink: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  semLinkTexto: { color: cor.textoSuave, fontSize: 14 },
}));
