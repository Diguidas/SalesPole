import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { contarFila } from '@/db/queries';
import { useDados } from '@/db/hooks';
import { useSync } from '@/lib/sync-context';
import { cor } from './theme';

/** Botao do cabecalho: sincroniza agora e mostra quantos pedidos aguardam envio. */
export function BotaoSync() {
  const { sincronizando, sincronizar, erro } = useSync();
  const { dados: fila } = useDados(contarFila);
  const pendentes = (fila?.aguardando ?? 0) + (fila?.erros ?? 0);

  return (
    <Pressable onPress={sincronizar} disabled={sincronizando} hitSlop={10} style={estilos.botao}>
      {sincronizando ? (
        <ActivityIndicator color={cor.textoSobrePrimaria} />
      ) : (
        <Ionicons name={erro ? 'cloud-offline' : 'sync'} size={24} color={cor.textoSobrePrimaria} />
      )}
      {pendentes > 0 ? (
        <View style={[estilos.contador, fila?.erros ? { backgroundColor: cor.erro } : undefined]}>
          <Text style={estilos.contadorTexto}>{pendentes}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  botao: { marginRight: 14, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  contador: {
    position: 'absolute', top: -4, right: -6, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: cor.acento, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
    borderWidth: 1.5, borderColor: cor.primaria,
  },
  contadorTexto: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
