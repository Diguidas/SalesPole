import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useDados, useTickAoFocar } from '@/db/hooks';
import {
  contarFila, listarPedidos, listarTitulos,
  type FiltroPedidos, type FiltroTitulos, type PedidoGeral, type TituloGeral,
} from '@/db/queries';
import { dataBR, moeda } from '@/lib/format';
import { useSync } from '@/lib/sync-context';
import { Card, Chip, Segmentado, Selo, Vazio } from '@/ui/components';
import { seloDoPedido } from '@/ui/status';
import { cor, espaco } from '@/ui/theme';

type Secao = 'pedidos' | 'titulos';

export default function PedidosETitulos() {
  const [secao, setSecao] = useState<Secao>('pedidos');
  const [filtroP, setFiltroP] = useState<FiltroPedidos>('todos');
  const [filtroT, setFiltroT] = useState<FiltroTitulos>('todos');
  const router = useRouter();
  const tick = useTickAoFocar();
  const { sincronizar, sincronizando } = useSync();

  const { dados: fila } = useDados(contarFila, [tick]);
  const { dados: pedidos } = useDados((d) => listarPedidos(d, filtroP), [filtroP, tick]);
  const { dados: titulos } = useDados((d) => listarTitulos(d, filtroT), [filtroT, tick]);

  const aguardando = (fila?.aguardando ?? 0) + (fila?.erros ?? 0);

  const cabecalho = (
    <View style={{ gap: espaco.md, marginBottom: espaco.md }}>
      <Segmentado
        valor={secao}
        onChange={setSecao}
        opcoes={[{ valor: 'pedidos', texto: 'Pedidos' }, { valor: 'titulos', texto: 'Títulos' }]}
      />
      {secao === 'pedidos' && aguardando > 0 ? (
        <Card style={estilos.banner}>
          <Ionicons name="time-outline" size={20} color={cor.aviso} />
          <Text style={estilos.bannerTexto}>
            {fila?.aguardando ? `${fila.aguardando} aguardando envio` : ''}
            {fila?.aguardando && fila?.erros ? ' · ' : ''}
            {fila?.erros ? `${fila.erros} com erro` : ''}
          </Text>
        </Card>
      ) : null}
      <View style={estilos.chips}>
        {secao === 'pedidos' ? (
          <>
            <Chip texto="Todos" ativo={filtroP === 'todos'} onPress={() => setFiltroP('todos')} />
            <Chip texto="Pendentes de envio" ativo={filtroP === 'pendentes'} onPress={() => setFiltroP('pendentes')} />
            <Chip texto="Com erro" ativo={filtroP === 'erros'} onPress={() => setFiltroP('erros')} />
          </>
        ) : (
          <>
            <Chip texto="Todos" ativo={filtroT === 'todos'} onPress={() => setFiltroT('todos')} />
            <Chip texto="Em aberto" ativo={filtroT === 'abertos'} onPress={() => setFiltroT('abertos')} />
            <Chip texto="Atrasados" ativo={filtroT === 'atrasados'} onPress={() => setFiltroT('atrasados')} />
          </>
        )}
      </View>
    </View>
  );

  const refresh = <RefreshControl refreshing={sincronizando} onRefresh={sincronizar} tintColor={cor.primaria} colors={[cor.primaria]} />;

  if (secao === 'pedidos') {
    return (
      <FlatList<PedidoGeral>
        data={pedidos ?? []}
        keyExtractor={(p) => `${p.origem}-${p.chave}`}
        contentContainerStyle={{ padding: espaco.lg }}
        refreshControl={refresh}
        ListHeaderComponent={cabecalho}
        ListEmptyComponent={
          <Vazio
            icone="receipt-outline"
            texto={filtroP === 'todos' ? 'Nenhum pedido nos últimos 90 dias.' : filtroP === 'pendentes' ? 'Nenhum pedido aguardando envio.' : 'Nenhum pedido com erro.'}
          />
        }
        renderItem={({ item: p }) => {
          const selo = seloDoPedido(p.origem, p.status);
          const aberto = () => router.push(p.origem === 'sap' ? `/pedido-sap/${p.chave}` : `/pedido/${p.chave}`);
          return (
            <Card onPress={aberto} style={estilos.linha}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={estilos.titulo} numberOfLines={1}>{p.nome_cliente || p.cod_cliente}</Text>
                <Text style={estilos.suave}>
                  {p.origem === 'sap' ? `Pedido ${p.chave}` : p.codigo ? `Pedido ${p.codigo}` : 'Novo pedido'} · {dataBR(p.data)}
                  {p.valor !== null ? ` · ${moeda(p.valor)}` : ''}
                </Text>
                {p.erro ? <Text style={estilos.erro} numberOfLines={2}>{p.erro}</Text> : null}
              </View>
              {selo ? <Selo texto={selo.texto} tom={selo.tom} /> : null}
            </Card>
          );
        }}
      />
    );
  }

  return (
    <FlatList<TituloGeral>
      data={titulos ?? []}
      keyExtractor={(t) => `${t.cod_cliente}-${t.nfe}-${t.parcela}`}
      contentContainerStyle={{ padding: espaco.lg }}
      refreshControl={refresh}
      ListHeaderComponent={cabecalho}
      ListEmptyComponent={<Vazio icone="cash-outline" texto="Nenhum título para este filtro." />}
      renderItem={({ item: t }) => (
        <Card onPress={() => router.push({ pathname: '/titulo', params: { cod: t.cod_cliente, nfe: t.nfe, parcela: t.parcela } })} style={estilos.linha}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={estilos.titulo} numberOfLines={1}>{t.nome_cliente || t.cod_cliente}</Text>
            <Text style={estilos.suave}>
              NF {t.nfe || '—'}{t.parcela ? ` · parcela ${t.parcela}` : ''} · {moeda(t.valor)}
            </Text>
            <Text style={estilos.suave}>
              {t.status === 'Compensado' ? `Pago em ${dataBR(t.dt_compensacao)}` : `Vence em ${dataBR(t.vencimento)}`}
            </Text>
          </View>
          {t.status ? <Selo texto={t.status} tom={t.status === 'Atrasado' ? 'erro' : t.status === 'Compensado' ? 'ok' : 'aviso'} /> : null}
        </Card>
      )}
    />
  );
}

const estilos = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: cor.avisoFundo, borderColor: cor.amarelo, paddingVertical: 10 },
  bannerTexto: { color: cor.aviso, fontWeight: '700', fontSize: 14 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  titulo: { fontSize: 15, fontWeight: '700', color: cor.texto },
  suave: { fontSize: 13, color: cor.textoSuave },
  erro: { fontSize: 12, color: cor.erro },
});
