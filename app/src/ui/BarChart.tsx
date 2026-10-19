import { StyleSheet, Text, View } from 'react-native';
import { cor, espaco } from './theme';

export interface BarraGrafico {
  rotulo: string;
  valor: number;
  /** barra do mes em andamento (destaque) */
  destaque?: boolean;
}

const ALTURA = 150;

/** Grafico de barras verticais simples (so Views): o valor em cima de cada barra, o rotulo embaixo. */
export function BarChart({ barras, formato }: { barras: BarraGrafico[]; formato: (v: number) => string }) {
  const max = Math.max(...barras.map((b) => b.valor), 0);
  return (
    <View style={estilos.linha}>
      {barras.map((b, i) => {
        const h = max > 0 ? Math.max((b.valor / max) * ALTURA, b.valor > 0 ? 4 : 0) : 0;
        return (
          <View key={i} style={estilos.coluna}>
            <Text style={estilos.valor} numberOfLines={1}>{b.valor > 0 ? formato(b.valor) : '–'}</Text>
            <View style={estilos.trilho}>
              <View style={[estilos.barra, { height: h }, b.destaque ? undefined : estilos.barraClara]} />
            </View>
            <Text style={estilos.rotulo}>{b.rotulo}</Text>
          </View>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  linha: { flexDirection: 'row', gap: espaco.lg, alignItems: 'flex-end' },
  coluna: { flex: 1, alignItems: 'center', gap: 4 },
  trilho: { height: ALTURA, width: '70%', justifyContent: 'flex-end', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: cor.borda },
  barra: { width: '100%', backgroundColor: cor.primaria, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  barraClara: { backgroundColor: cor.amarelo },
  valor: { fontSize: 12, fontWeight: '700', color: cor.texto },
  rotulo: { fontSize: 12, color: cor.textoSuave, textTransform: 'capitalize' },
});
