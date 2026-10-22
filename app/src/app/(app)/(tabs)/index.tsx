import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDados, useTickAoFocar } from '@/db/hooks';
import { clientesDoDia, remessasDoDia, vendasDoMes } from '@/db/queries';
import { visitasDoDia } from '@/db/visitas';
import { diaSemanaHoje, haQuanto, hojeISO, moeda, NOME_DIA } from '@/lib/format';
import { useEquipe } from '@/lib/equipe';
import { useSync } from '@/lib/sync-context';
import { EquipeHome } from '@/ui/EquipeHome';
import { Card, Secao, Vazio } from '@/ui/components';
import { CardCliente } from '@/ui/CardCliente';
import { cor, espaco, estilosTema } from '@/ui/theme';

const NOME_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Supervisor/gerente sem vendedor escolhido ve o resumo da equipe; com vendedor escolhido (ou vendedor comum) ve o inicio do vendedor. */
export default function Inicio() {
  const { semVendedor } = useEquipe();
  return semVendedor ? <EquipeHome /> : <InicioVendedor />;
}

function InicioVendedor() {
  const router = useRouter();
  const { sincronizar, sincronizando, ultimoSync, erro } = useSync();
  const dia = diaSemanaHoje();
  const hoje = hojeISO();

  const { dados: clientes } = useDados((db) => clientesDoDia(db, dia), [dia]);
  const { dados: remessas } = useDados((db) => remessasDoDia(db, hoje), [hoje]);

  const { dados: vendas } = useDados((db) => vendasDoMes(db, hoje), [hoje]);
  const tick = useTickAoFocar();
  const { dados: visitas } = useDados((db) => visitasDoDia(db, hoje), [hoje, tick]);
  const visitaDe = new Map((visitas ?? []).map((v) => [v.cod_cliente, v]));
  const visitadas = (clientes ?? []).filter((c) => visitaDe.get(c.cod_cliente)?.status === 'concluida').length;
  const comVenda = (clientes ?? []).filter((c) => visitaDe.get(c.cod_cliente)?.resultado === 'vendeu').length;

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

      <Card style={estilos.vendas}>
        <Text style={estilos.vendasRotulo}>Vendas de {NOME_MES[Number(hoje.slice(5, 7)) - 1]}</Text>
        <Text style={estilos.vendasValor}>{moeda(vendas?.total ?? 0)}</Text>
        <Text style={estilos.vendasDetalhe}>
          {vendas?.pedidos ?? 0} pedido{(vendas?.pedidos ?? 0) === 1 ? '' : 's'} no mês
        </Text>
      </Card>

      {clientes && clientes.length ? (
        <Card style={estilos.vendas}>
          <Text style={estilos.vendasRotulo}>Visitas de hoje</Text>
          <Text style={estilos.vendasValor}>{visitadas} de {clientes.length}</Text>
          <Text style={estilos.vendasDetalhe}>
            {comVenda} com venda · {clientes.length - visitadas} a visitar
          </Text>
        </Card>
      ) : null}

      <Secao titulo={NOME_DIA[dia]} detalhe={`${clientes?.length ?? 0} cliente${(clientes?.length ?? 0) === 1 ? '' : 's'}`} />
      {nuncaSincronizou ? (
        <Vazio icone="cloud-download-outline" texto="Ainda não há dados neste aparelho. Toque em sincronizar (ícone no topo) com a internet ligada." />
      ) : clientes && clientes.length ? (
        clientes.map((c, i) => <CardCliente key={c.cod_cliente} c={c} ordem={c.sequencia ?? i + 1} visita={visitaDe.get(c.cod_cliente)} onPress={() => abrir(c.cod_cliente)} />)
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

const estilos = estilosTema(() => StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusTexto: { color: cor.textoSuave, fontSize: 13, flexShrink: 1 },
  vendas: { marginTop: espaco.md },
  vendasRotulo: { fontSize: 13, color: cor.textoSuave, textTransform: 'capitalize' },
  vendasValor: { fontSize: 28, fontWeight: '800', color: cor.primaria, marginTop: 2 },
  vendasDetalhe: { fontSize: 13, color: cor.textoSuave, marginTop: 2 },
  remessa: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  remessaNome: { fontSize: 15, fontWeight: '700', color: cor.texto },
  remessaDetalhe: { fontSize: 13, color: cor.textoSuave, marginTop: 2 },
}));
