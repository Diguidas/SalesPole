import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cor, espaco, raio } from './theme';

export interface OpcaoDropdown {
  valor: string;
  texto: string;
}

/**
 * Lista suspensa: o campo mostra a opcao escolhida e, ao tocar, abre uma folha na parte de baixo com todas as opcoes.
 * Tocar na opcao ja escolhida de novo nao desmarca (use `limpavel` para permitir).
 */
export function Dropdown({
  titulo, valor, opcoes, onChange, placeholder = 'Selecione', limpavel = false, desabilitado = false,
}: {
  titulo: string;
  valor: string | null | undefined;
  opcoes: OpcaoDropdown[];
  onChange: (v: string | null) => void;
  placeholder?: string;
  limpavel?: boolean;
  desabilitado?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const atual = opcoes.find((o) => o.valor === valor);

  function escolher(v: string) {
    setAberto(false);
    if (v !== valor) onChange(v);
    else if (limpavel) onChange(null);
  }

  return (
    <>
      <Pressable
        onPress={() => !desabilitado && setAberto(true)}
        style={({ pressed }) => [estilos.campo, desabilitado ? { opacity: 0.5 } : undefined, pressed ? { opacity: 0.75 } : undefined]}
        accessibilityRole="button"
        accessibilityLabel={titulo}
      >
        <Text style={[estilos.texto, !atual ? { color: cor.textoSuave } : undefined]} numberOfLines={1}>{atual ? atual.texto : placeholder}</Text>
        <Ionicons name="chevron-down" size={18} color={cor.textoSuave} />
      </Pressable>

      <Modal visible={aberto} transparent animationType="slide" onRequestClose={() => setAberto(false)}>
        <View style={estilos.fundo}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAberto(false)} />
          <View style={estilos.folha}>
            <View style={estilos.cabecalho}>
              <Text style={estilos.titulo}>{titulo}</Text>
              <Pressable onPress={() => setAberto(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color={cor.textoSuave} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 380 }}>
              {opcoes.length === 0 ? <Text style={estilos.vazio}>Nenhuma opção disponível.</Text> : null}
              {opcoes.map((o) => {
                const ativo = o.valor === valor;
                return (
                  <Pressable key={o.valor} onPress={() => escolher(o.valor)} style={({ pressed }) => [estilos.opcao, ativo ? estilos.opcaoAtiva : undefined, pressed ? { opacity: 0.7 } : undefined]}>
                    <Text style={[estilos.opcaoTexto, ativo ? { color: cor.primariaEscura, fontWeight: '700' } : undefined]}>{o.texto}</Text>
                    {ativo ? <Ionicons name="checkmark" size={20} color={cor.primaria} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const estilos = StyleSheet.create({
  campo: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: espaco.sm,
    borderWidth: 1, borderColor: cor.borda, borderRadius: raio, paddingHorizontal: espaco.md, paddingVertical: 12, backgroundColor: cor.card,
  },
  texto: { flex: 1, fontSize: 15, color: cor.texto },
  fundo: { flex: 1, backgroundColor: 'rgba(15,23,42,.45)', justifyContent: 'flex-end' },
  folha: { backgroundColor: cor.card, borderTopLeftRadius: raio + 6, borderTopRightRadius: raio + 6, paddingBottom: espaco.xl },
  cabecalho: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: espaco.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: cor.borda },
  titulo: { fontSize: 17, fontWeight: '700', color: cor.texto },
  opcao: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: espaco.md, paddingHorizontal: espaco.lg, paddingVertical: 14 },
  opcaoAtiva: { backgroundColor: '#FFF1E5' },
  opcaoTexto: { flex: 1, fontSize: 15, color: cor.texto },
  vazio: { padding: espaco.lg, color: cor.textoSuave, textAlign: 'center' },
});
