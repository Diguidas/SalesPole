import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDados } from '@/db/hooks';
import { clientesDoDia, remessasDoDia } from '@/db/queries';
import { diaSemanaHoje, haQuanto, hojeISO, NOME_DIA } from '@/lib/format';
import { useSync } from '@/lib/sync-context';
import { Card, Secao, Vazio } from '@/ui/components';
import { CardCliente } from '@/ui/CardCliente';
import { cor, espaco } from '@/ui/theme';

export default function Inicio() {
  const router = useRouter();
  const { sincronizar, sincronizando, ultimoSync, erro } = useSync();
  const dia = diaSemanaHoje();
  const hoje = hojeISO();

  const { dados: clientes } = useDados((db) => clientesDoDia(db, dia), [dia]);
  const { dados: remessas } = useDados((db) => remessasDoDia(db, hoje), [hoje]);

  const doDia = new Set((clientes ?? []).map((c) => c.cod_cliente));
  const nuncaSincronizou = !ultimoSync;

  const abrir = (cod: string) => router.push(`/cliente/${cod}`);

  return (
    <ScrollView
      contentContainerStyle={estilos.conteudo}
      refreshControl={<RefreshControl refreshing={sincronizando} onRefresh={sincronizar} tintColor={cor.primaria} colors={[cor.primaria]} />}
    >
      <View style={estilos.status}>
        <Ionicons name={erro ? 'alert-circle' : 'checkmark-circle'} size={16} color={erro ? cor.aviso : cor.ok} />
        <Text style={[estilos.statusTexto, erro ? { color: cor.aviso } : undefined]} numberOfLines={2}>
          {erro ?? `Atualizado ${haQuanto(ultimoSync)}`}
        </Text>
      </View>

      <Secao titulo={NOME_DIA[dia]} detalhe={`${clientes?.length ?? 0} cliente${(clientes?.length ?? 0) === 1 ? '' : 's'}`} />
      {nuncaSincronizou ? (
        <Vazio icone="cloud-download-outline" texto="Ainda não há dados neste aparelho. Toque em sincronizar (ícone no topo) com a internet ligada." />
      ) : clientes && clientes.length ? (
        clientes.map((c, i) => <CardCliente key={c.cod_cliente} c={c} ordem={c.sequencia ?? i + 1} onPress={() => abrir(c.cod_cliente)} />)
      ) : (
        <Vazio icone="calendar-outline" texto="Nenhum cliente no roteiro de hoje." />
      )}

      <Secao titulo="Entregas de hoje" detalhe={remessas?.length ? `${remessas.length} cliente${remessas.length === 1 ? '' : 's'}` : undefined} />
      {remessas && remessas.length ? (
        remessas.map((r) => (
          <Card key={r.cod_cliente} onPress={() => abrir(r.cod_cliente)} style={estilos.remessa}>
            <Ionicons name="cube-outline" size={22} color={cor.primaria} />
            <View style={{ flex: 1 }}>
              <Text style={estilos.remessaNome} numberOfLines={1}>{r.nome_fantasia || r.cod_cliente}</Text>
              <Text style={estilos.remessaDetalhe}>
                {r.ordens} pedido{r.ordens === 1 ? '' : 's'} · {r.itens} iten{r.itens === 1 ? '' : 's'}
                {doDia.has(r.cod_cliente) ? '' : ' · fora do roteiro de hoje'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={cor.textoSuave} />
          </Card>
        ))
      ) : (
        <Vazio icone="cube-outline" texto="Nenhuma entrega prevista para hoje nos seus clientes." />
      )}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusTexto: { color: cor.textoSuave, fontSize: 13, flexShrink: 1 },
  remessa: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  remessaNome: { fontSize: 15, fontWeight: '700', color: cor.texto },
  remessaDetalhe: { fontSize: 13, color: cor.textoSuave, marginTop: 2 },
});
