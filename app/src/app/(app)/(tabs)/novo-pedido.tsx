import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useDados, useTickAoFocar } from '@/db/hooks';
import { listarRascunhos, obterOuCriarRascunho } from '@/db/pedidos';
import { listarClientes, type ClienteResumo } from '@/db/queries';
import { haQuanto } from '@/lib/format';
import { Card, Secao, Vazio } from '@/ui/components';
import { CardCliente } from '@/ui/CardCliente';
import { cor, espaco, raio } from '@/ui/theme';

export default function NovoPedido() {
  const db = useSQLiteContext();
  const router = useRouter();
  const tick = useTickAoFocar();
  const [busca, setBusca] = useState('');

  const { dados: clientes } = useDados((d) => listarClientes(d, busca), [busca]);
  const { dados: rascunhos } = useDados(listarRascunhos, [tick]);

  async function escolher(c: ClienteResumo) {
    if (c.bloqueado) {
      Alert.alert('Cliente bloqueado', 'Não é possível lançar pedido para este cliente.');
      return;
    }
    // retoma o rascunho aberto deste cliente (se houver) ou cria um novo
    const id = await obterOuCriarRascunho(db, c.cod_cliente);
    router.push(`/pedido/${id}`);
  }

  const cabecalho = (
    <View>
      {rascunhos && rascunhos.length ? (
        <View>
          <Secao titulo="Rascunhos em aberto" detalhe={`${rascunhos.length}`} />
          {rascunhos.map((r) => (
            <Card key={r.id} onPress={() => router.push(`/pedido/${r.id}`)} style={estilos.rascunho}>
              <Ionicons name="create-outline" size={22} color={cor.primaria} />
              <View style={{ flex: 1 }}>
                <Text style={estilos.rascunhoNome} numberOfLines={1}>{r.nome_cliente || r.cod_cliente}</Text>
                <Text style={estilos.rascunhoDetalhe}>
                  {r.itens} {r.itens === 1 ? 'item' : 'itens'} · editado {haQuanto(r.atualizado_em)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={cor.textoSuave} />
            </Card>
          ))}
        </View>
      ) : null}

      <Secao titulo="Para qual cliente?" />
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
    </View>
  );

  return (
    <FlatList
      data={clientes ?? []}
      keyExtractor={(c) => c.cod_cliente}
      contentContainerStyle={{ padding: espaco.lg, paddingTop: 0 }}
      ListHeaderComponent={cabecalho}
      renderItem={({ item }) => <CardCliente c={item} onPress={() => escolher(item)} />}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={
        <Vazio icone="people-outline" texto={busca ? 'Nenhum cliente encontrado para essa busca.' : 'Nenhum cliente neste aparelho. Sincronize para baixar sua carteira.'} />
      }
    />
  );
}

const estilos = StyleSheet.create({
  rascunho: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  rascunhoNome: { fontSize: 15, fontWeight: '700', color: cor.texto },
  rascunhoDetalhe: { fontSize: 13, color: cor.textoSuave, marginTop: 2 },
  buscaBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: espaco.md, paddingHorizontal: espaco.md,
    backgroundColor: cor.card, borderRadius: raio, borderWidth: 1, borderColor: cor.borda,
  },
  busca: { flex: 1, paddingVertical: 12, fontSize: 16, color: cor.texto },
});
