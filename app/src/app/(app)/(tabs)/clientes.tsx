import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { useDados } from '@/db/hooks';
import { listarClientes } from '@/db/queries';
import { Vazio } from '@/ui/components';
import { CardCliente } from '@/ui/CardCliente';
import { cor, espaco, raio } from '@/ui/theme';

export default function Clientes() {
  const router = useRouter();
  const [busca, setBusca] = useState('');
  const { dados: clientes } = useDados((db) => listarClientes(db, busca), [busca]);

  return (
    <View style={{ flex: 1 }}>
      <View style={estilos.buscaBox}>
        <Ionicons name="search" size={18} color={cor.textoSuave} />
        <TextInput
          style={estilos.busca}
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar por nome, código ou CNPJ"
          placeholderTextColor={cor.textoSuave}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>
      <FlatList
        data={clientes ?? []}
        keyExtractor={(c) => c.cod_cliente}
        contentContainerStyle={{ padding: espaco.lg, paddingTop: 0 }}
        renderItem={({ item }) => <CardCliente c={item} onPress={() => router.push(`/cliente/${item.cod_cliente}`)} />}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Vazio icone="people-outline" texto={busca ? 'Nenhum cliente encontrado para essa busca.' : 'Nenhum cliente neste aparelho. Sincronize para baixar sua carteira.'} />
        }
      />
    </View>
  );
}

const estilos = StyleSheet.create({
  buscaBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, margin: espaco.lg, paddingHorizontal: espaco.md,
    backgroundColor: cor.card, borderRadius: raio, borderWidth: 1, borderColor: cor.borda,
  },
  busca: { flex: 1, paddingVertical: 12, fontSize: 16, color: cor.texto },
});
