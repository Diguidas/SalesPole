import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '@/lib/api';
import { useEquipe, type VendedorEquipe } from '@/lib/equipe';
import { cor, espaco, raio, estilosTema } from './theme';

/** Pop-up do modo equipe: "qual vendedor voce quer ver?". Ao escolher, o app passa a ser o app desse vendedor. */
export function SeletorVendedor() {
  const { seletorAberto, fecharSeletor, entrarComo, vendedor } = useEquipe();
  const [lista, setLista] = useState<VendedorEquipe[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    if (!seletorAberto) return;
    let vivo = true;
    setErro(null);
    setBusca('');
    api<VendedorEquipe[]>('/equipe/vendedores', { semVendedor: true, timeoutMs: 30_000 })
      .then((l) => vivo && setLista(l))
      .catch((e) => vivo && (setErro(e instanceof Error ? e.message : 'Não foi possível carregar os vendedores.'), setLista([])));
    return () => {
      vivo = false;
    };
  }, [seletorAberto]);

  const filtrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (lista ?? []).filter((v) => !q || (v.nome ?? '').toLowerCase().includes(q) || v.cod_vendedor.includes(q));
  }, [lista, busca]);

  return (
    <Modal visible={seletorAberto} transparent animationType="fade" onRequestClose={fecharSeletor}>
      <View style={estilos.fundo}>
        <View style={estilos.caixa}>
          <View style={estilos.topo}>
            <Text style={estilos.titulo}>Qual vendedor você quer ver?</Text>
            <Pressable onPress={fecharSeletor} hitSlop={12}>
              <Ionicons name="close" size={24} color={cor.textoSuave} />
            </Pressable>
          </View>
          <TextInput style={estilos.busca} placeholder="Buscar por nome ou código" value={busca} onChangeText={setBusca} autoCorrect={false} />
          {lista === null ? (
            <ActivityIndicator color={cor.primaria} style={{ marginVertical: espaco.xl }} />
          ) : erro ? (
            <Text style={estilos.erro}>{erro}</Text>
          ) : (
            <FlatList
              data={filtrada}
              keyExtractor={(v) => v.cod_vendedor}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={estilos.vazio}>Nenhum vendedor encontrado.</Text>}
              renderItem={({ item }) => (
                <Pressable onPress={() => entrarComo(item)} style={({ pressed }) => [estilos.linha, pressed ? { opacity: 0.6 } : undefined]}>
                  <View style={{ flex: 1 }}>
                    <Text style={estilos.nome} numberOfLines={1}>{item.nome ?? item.cod_vendedor}</Text>
                    <Text style={estilos.detalhe}>Código {item.cod_vendedor}{item.escritorio ? ` · ${item.escritorio}/${item.equipe ?? ''}` : ''}</Text>
                  </View>
                  {vendedor?.cod === item.cod_vendedor ? <Ionicons name="checkmark-circle" size={20} color={cor.ok} /> : null}
                </Pressable>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const estilos = estilosTema(() => StyleSheet.create({
  fundo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: espaco.lg },
  caixa: { backgroundColor: cor.card, borderRadius: raio, padding: espaco.lg, maxHeight: '80%' },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: espaco.md },
  titulo: { fontSize: 17, fontWeight: '800', color: cor.texto, flex: 1 },
  busca: { borderWidth: 1, borderColor: cor.borda, borderRadius: 10, paddingHorizontal: espaco.md, paddingVertical: 8, fontSize: 15, marginBottom: espaco.sm },
  linha: { flexDirection: 'row', alignItems: 'center', paddingVertical: espaco.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: cor.borda },
  nome: { fontSize: 15, fontWeight: '700', color: cor.texto },
  detalhe: { fontSize: 12, color: cor.textoSuave, marginTop: 2 },
  vazio: { textAlign: 'center', color: cor.textoSuave, paddingVertical: espaco.xl },
  erro: { color: cor.erro, paddingVertical: espaco.lg },
}));
