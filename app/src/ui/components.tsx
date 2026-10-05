import { Ionicons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { cor, espaco, raio } from './theme';

export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: ViewStyle }) {
  const conteudo = <View style={[estilos.card, style]}>{children}</View>;
  if (!onPress) return conteudo;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}>
      {conteudo}
    </Pressable>
  );
}

type Tom = 'ok' | 'aviso' | 'erro' | 'neutro';
const TONS: Record<Tom, { fundo: string; texto: string }> = {
  ok: { fundo: cor.okFundo, texto: cor.ok },
  aviso: { fundo: cor.avisoFundo, texto: cor.aviso },
  erro: { fundo: cor.erroFundo, texto: cor.erro },
  neutro: { fundo: cor.neutroFundo, texto: cor.textoSuave },
};

export function Selo({ texto, tom = 'neutro' }: { texto: string; tom?: Tom }) {
  return (
    <View style={[estilos.selo, { backgroundColor: TONS[tom].fundo }]}>
      <Text style={[estilos.seloTexto, { color: TONS[tom].texto }]}>{texto}</Text>
    </View>
  );
}

export function Secao({ titulo, detalhe }: { titulo: string; detalhe?: string }) {
  return (
    <View style={estilos.secao}>
      <Text style={estilos.secaoTitulo}>{titulo}</Text>
      {detalhe ? <Text style={estilos.secaoDetalhe}>{detalhe}</Text> : null}
    </View>
  );
}

export function Vazio({ icone = 'file-tray-outline', texto }: { icone?: keyof typeof Ionicons.glyphMap; texto: string }) {
  return (
    <View style={estilos.vazio}>
      <Ionicons name={icone} size={34} color={cor.textoSuave} />
      <Text style={estilos.vazioTexto}>{texto}</Text>
    </View>
  );
}

export function Botao({
  titulo, onPress, carregando, desabilitado, tom = 'primario',
}: { titulo: string; onPress: () => void; carregando?: boolean; desabilitado?: boolean; tom?: 'primario' | 'neutro' | 'perigo' }) {
  const inativo = desabilitado || carregando;
  const fundo = tom === 'primario' ? cor.primaria : tom === 'perigo' ? cor.erro : cor.neutroFundo;
  const texto = tom === 'neutro' ? cor.texto : cor.textoSobrePrimaria;
  return (
    <Pressable
      onPress={onPress}
      disabled={inativo}
      style={({ pressed }) => [estilos.botao, { backgroundColor: fundo, opacity: inativo ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      {carregando ? <ActivityIndicator color={texto} /> : <Text style={[estilos.botaoTexto, { color: texto }]}>{titulo}</Text>}
    </Pressable>
  );
}

export function Linha({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  return (
    <View style={estilos.linha}>
      <Text style={estilos.linhaRotulo}>{rotulo}</Text>
      <Text style={estilos.linhaValor}>{valor || '—'}</Text>
    </View>
  );
}

/** Filtro em forma de pilula (ex.: Todos | Pendentes | Com erro). */
export function Chip({ texto, ativo, onPress }: { texto: string; ativo: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[estilos.chip, ativo ? estilos.chipAtivo : undefined]}>
      <Text style={[estilos.chipTexto, ativo ? estilos.chipTextoAtivo : undefined]}>{texto}</Text>
    </Pressable>
  );
}

/** Alternador de secoes (ex.: Pedidos | Titulos). */
export function Segmentado<T extends string>({
  opcoes, valor, onChange,
}: { opcoes: Array<{ valor: T; texto: string }>; valor: T; onChange: (v: T) => void }) {
  return (
    <View style={estilos.segmentado}>
      {opcoes.map((o) => (
        <Pressable key={o.valor} onPress={() => onChange(o.valor)} style={[estilos.segmento, o.valor === valor ? estilos.segmentoAtivo : undefined]}>
          <Text style={[estilos.segmentoTexto, o.valor === valor ? estilos.segmentoTextoAtivo : undefined]}>{o.texto}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Carregando() {
  return (
    <View style={estilos.centro}>
      <ActivityIndicator size="large" color={cor.primaria} />
    </View>
  );
}

const estilos = StyleSheet.create({
  card: {
    backgroundColor: cor.card, borderRadius: raio, padding: espaco.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: cor.borda,
  },
  selo: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  seloTexto: { fontSize: 12, fontWeight: '600' },
  secao: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: espaco.xl, marginBottom: espaco.sm },
  secaoTitulo: { fontSize: 17, fontWeight: '700', color: cor.texto },
  secaoDetalhe: { fontSize: 13, color: cor.textoSuave },
  vazio: { alignItems: 'center', gap: espaco.sm, paddingVertical: espaco.xl },
  vazioTexto: { color: cor.textoSuave, textAlign: 'center', fontSize: 14, maxWidth: 280 },
  botao: { borderRadius: raio, paddingVertical: 14, paddingHorizontal: espaco.lg, alignItems: 'center', justifyContent: 'center' },
  botaoTexto: { fontSize: 16, fontWeight: '700' },
  linha: { flexDirection: 'row', justifyContent: 'space-between', gap: espaco.lg, paddingVertical: 6 },
  linhaRotulo: { color: cor.textoSuave, fontSize: 14 },
  linhaValor: { color: cor.texto, fontSize: 14, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: cor.neutroFundo },
  chipAtivo: { backgroundColor: cor.primaria },
  chipTexto: { fontSize: 13, fontWeight: '600', color: cor.textoSuave },
  chipTextoAtivo: { color: cor.textoSobrePrimaria },
  segmentado: { flexDirection: 'row', backgroundColor: cor.neutroFundo, borderRadius: raio, padding: 4 },
  segmento: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: raio - 4 },
  segmentoAtivo: { backgroundColor: cor.card },
  segmentoTexto: { fontSize: 14, fontWeight: '600', color: cor.textoSuave },
  segmentoTextoAtivo: { color: cor.texto },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: cor.fundo },
});
