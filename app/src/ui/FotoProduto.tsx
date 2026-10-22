import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { FOTOS_URL } from '@/lib/config';
import { cor, estilosTema } from './theme';

/**
 * Foto do produto, do bucket publico do Supabase (<cod_produto>.jpg).
 * Produto sem foto (ou sem internet) mostra um icone no lugar: nunca quebra a tela.
 */
export function FotoProduto({ cod, tamanho = 56 }: { cod: string; tamanho?: number }) {
  const [falhou, setFalhou] = useState(false);
  const caixa = { width: tamanho, height: tamanho };
  return (
    <View style={[estilos.caixa, caixa]}>
      {falhou || !FOTOS_URL ? (
        <Ionicons name="image-outline" size={tamanho * 0.45} color={cor.textoSuave} />
      ) : (
        <Image
          source={{ uri: `${FOTOS_URL}/${encodeURIComponent(cod.trim())}.jpg`, cache: 'force-cache' }}
          style={caixa}
          resizeMode="contain"
          onError={() => setFalhou(true)}
        />
      )}
    </View>
  );
}

const estilos = estilosTema(() => StyleSheet.create({
  caixa: { borderRadius: 10, backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: cor.borda, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
}));
