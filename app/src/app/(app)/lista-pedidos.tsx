import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useDados, useTickAoFocar } from '@/db/hooks';
import { contarFila, listarPedidos, type FiltroPedidos, type PedidoGeral } from '@/db/queries';
import { dataBR, moeda } from '@/lib/format';
import { useSync } from '@/lib/sync-context';
import { Card, Chip, Selo, Vazio } from '@/ui/components';
import { seloDoPedido } from '@/ui/status';
import { cor, espaco, estilosTema } from '@/ui/theme';

export default function ListaPedidos() {
  const [filtro, setFiltro] = useState<FiltroPedidos>('todos');
  const router = useRouter();
  const tick = useTickAoFocar();
  const { sincronizar, sincronizando } = useSync();

  const { dados: fila } = useDados(contarFila, [tick]);
  const { dados: pedidos } = useDados((d) => listarPedidos(d, filtro), [filtro, tick]);

  const aguardando = (fila?.aguardando ?? 0) + (fila?.erros ?? 0) + (fila?.aprovacao ?? 0);

  const cabecalho = (
    <View style={{ gap: espaco.md, marginBottom: espaco.md }}>
      {aguardando > 0 ? (
        <Card style={estilos.banner}>
          <Ionicons name="time-outline" size={20} color={cor.aviso} />
          <Text style={estilos.bannerTexto}>
            {[
              fila?.aprovacao ? `${fila.aprovacao} aguardando aprovação` : '',
              fila?.aguardando ? `${fila.aguardando} aguardando envio` : '',
              fila?.erros ? `${fila.erros} com erro` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </Card>
      ) : null}
      <View style={estilos.chips}>
        <Chip texto="Todos" ativo={filtro === 'todos'} onPress={() => setFiltro('todos')} />
        <Chip texto="Em aprovação" ativo={filtro === 'aprovacao'} onPress={() => setFiltro('aprovacao')} />
        <Chip texto="Pendentes de envio" ativo={filtro === 'pendentes'} onPress={() => setFiltro('pendentes')} />
        <Chip texto="Com erro" ativo={filtro === 'erros'} onPress={() => setFiltro('erros')} />
      </View>
    </View>
  );

  return (
    <FlatList<PedidoGeral>
      data={pedidos ?? []}
      keyExtractor={(p) => `${p.origem}-${p.chave}`}
      contentContainerStyle={{ padding: espaco.lg }}
      refreshControl={<RefreshControl refreshing={sincronizando} onRefresh={sincronizar} tintColor={cor.primaria} colors={[cor.primaria]} />}
      ListHeaderComponent={cabecalho}
      ListEmptyComponent={
        <Vazio
          icone="receipt-outline"
          texto={
            filtro === 'todos' ? 'Nenhum pedido nos últimos 90 dias.'
            : filtro === 'aprovacao' ? 'Nenhuma bonificação aguardando aprovação.'
            : filtro === 'pendentes' ? 'Nenhum pedido aguardando envio.'
            : 'Nenhum pedido com erro ou rejeitado.'
          }
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
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
  {p.bonificacao ? <Selo texto="Bonificação" tom="neutro" /> : null}
  {selo ? <Selo texto={selo.texto} tom={selo.tom} /> : null}
</View>
          </Card>
        );
      }}
    />
  );
}

const estilos = estilosTema(() => StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: cor.avisoFundo, borderColor: cor.amarelo, paddingVertical: 10 },
  bannerTexto: { color: cor.aviso, fontWeight: '700', fontSize: 14 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  titulo: { fontSize: 15, fontWeight: '700', color: cor.texto },
  suave: { fontSize: 13, color: cor.textoSuave },
  erro: { fontSize: 12, color: cor.erro },
}));
