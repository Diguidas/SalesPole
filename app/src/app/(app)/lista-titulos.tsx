import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useDados, useTickAoFocar } from '@/db/hooks';
import { listarTitulos, type FiltroTitulos, type TituloGeral } from '@/db/queries';
import { dataBR, moeda } from '@/lib/format';
import { useSync } from '@/lib/sync-context';
import { Card, Chip, Selo, Vazio } from '@/ui/components';
import { cor, espaco, estilosTema } from '@/ui/theme';

export default function ListaTitulos() {
  const [filtro, setFiltro] = useState<FiltroTitulos>('todos');
  const router = useRouter();
  const tick = useTickAoFocar();
  const { sincronizar, sincronizando } = useSync();

  const { dados: titulos } = useDados((d) => listarTitulos(d, filtro), [filtro, tick]);

  const cabecalho = (
    <View style={estilos.chips}>
      <Chip texto="Todos" ativo={filtro === 'todos'} onPress={() => setFiltro('todos')} />
      <Chip texto="Em aberto" ativo={filtro === 'abertos'} onPress={() => setFiltro('abertos')} />
      <Chip texto="Atrasados" ativo={filtro === 'atrasados'} onPress={() => setFiltro('atrasados')} />
    </View>
  );

  return (
    <FlatList<TituloGeral>
      data={titulos ?? []}
      keyExtractor={(t) => `${t.cod_cliente}-${t.nfe}-${t.parcela}`}
      contentContainerStyle={{ padding: espaco.lg }}
      refreshControl={<RefreshControl refreshing={sincronizando} onRefresh={sincronizar} tintColor={cor.primaria} colors={[cor.primaria]} />}
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

const estilos = estilosTema(() => StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: espaco.md },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  titulo: { fontSize: 15, fontWeight: '700', color: cor.texto },
  suave: { fontSize: 13, color: cor.textoSuave },
}));
