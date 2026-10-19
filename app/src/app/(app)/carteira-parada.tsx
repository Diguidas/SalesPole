import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useDados } from '@/db/hooks';
import { carteiraParada, type ClienteParado } from '@/db/queries';
import { dataBR, diasAtras, hojeISO, NOME_DIA_CURTO } from '@/lib/format';
import { useSync } from '@/lib/sync-context';
import { Card, Chip, Selo, Vazio } from '@/ui/components';
import { cor, espaco } from '@/ui/theme';

const FAIXAS = [15, 30, 60, 90, 180] as const;

/** Quantos dias entre duas datas AAAA-MM-DD (a - b). */
function diasEntre(a: string, b: string): number {
  const d = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((d(a) - d(b)) / 86_400_000);
}

/** Clientes da carteira que nao compram ha X dias: ajuda a decidir quem visitar. */
export default function CarteiraParada() {
  const router = useRouter();
  const { sincronizar, sincronizando } = useSync();
  const hoje = hojeISO();
  const [dias, setDias] = useState<(typeof FAIXAS)[number]>(30);

  const { dados: clientes } = useDados((d) => carteiraParada(d, diasAtras(hoje, dias)), [dias, hoje]);

  const cabecalho = (
    <View style={{ gap: espaco.md, marginBottom: espaco.md }}>
      <View style={estilos.chips}>
        {FAIXAS.map((f) => (
          <Chip key={f} texto={`+${f} dias`} ativo={dias === f} onPress={() => setDias(f)} />
        ))}
      </View>
      <Text style={estilos.suave}>
        {clientes
          ? `${clientes.length} cliente${clientes.length === 1 ? '' : 's'} sem comprar há mais de ${dias} dias.`
          : 'Carregando…'}
      </Text>
    </View>
  );

  return (
    <FlatList<ClienteParado>
      data={clientes ?? []}
      keyExtractor={(c) => c.cod_cliente}
      contentContainerStyle={{ padding: espaco.lg }}
      refreshControl={<RefreshControl refreshing={sincronizando} onRefresh={sincronizar} tintColor={cor.primaria} colors={[cor.primaria]} />}
      ListHeaderComponent={cabecalho}
      ListEmptyComponent={<Vazio icone="happy-outline" texto={`Todos os clientes da carteira compraram nos últimos ${dias} dias.`} />}
      renderItem={({ item: c }) => {
        const sem = c.ultima_compra ? diasEntre(hoje, c.ultima_compra) : null;
        return (
          <Card onPress={() => router.push(`/cliente/${c.cod_cliente}`)} style={estilos.linha}>
            <Ionicons name="storefront-outline" size={22} color={cor.primaria} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={estilos.nome} numberOfLines={1}>{c.nome_fantasia || c.razao_social || c.cod_cliente}</Text>
              <Text style={estilos.suave}>
                {c.ultima_compra ? `Sem comprar há ${sem} dias · última compra ${dataBR(c.ultima_compra)}` : 'Sem compras no período que o aparelho conhece (12 meses)'}
              </Text>
              {c.dias_visita.length ? (
                <Text style={estilos.suave}>Visita: {c.dias_visita.map((d) => NOME_DIA_CURTO[d]).join(', ')}</Text>
              ) : null}
            </View>
            {c.bloqueado ? <Selo texto="Bloqueado" tom="erro" /> : null}
          </Card>
        );
      }}
    />
  );
}

const estilos = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  nome: { fontSize: 15, fontWeight: '700', color: cor.texto },
  suave: { fontSize: 13, color: cor.textoSuave },
});
