import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import { useEquipe } from '@/lib/equipe';
import { cor, estilosTema } from './theme';

/**
 * Lembrete fixo no cabecalho enquanto o supervisor/gerente opera como um vendedor: tudo que ele fizer
 * (pedido, visita) fica no nome desse vendedor. Tocar abre trocar de vendedor ou voltar ao resumo da equipe.
 */
export function ChipEquipe() {
  const { vendedor, abrirSeletor, sairDoVendedor } = useEquipe();
  if (!vendedor) return null;
  const nome = (vendedor.nome ?? vendedor.cod).split(' ').slice(0, 2).join(' ');

  return (
    <Pressable
      hitSlop={8}
      style={estilos.chip}
      onPress={() =>
        Alert.alert(`Você está como ${vendedor.nome ?? vendedor.cod}`, 'O que você quer fazer?', [
          { text: 'Trocar de vendedor', onPress: abrirSeletor },
          { text: 'Voltar ao resumo da equipe', onPress: sairDoVendedor },
          { text: 'Continuar aqui', style: 'cancel' },
        ])
      }
    >
      <Ionicons name="swap-horizontal" size={14} color={cor.primariaEscura} />
      <Text style={estilos.texto} numberOfLines={1}>{nome}</Text>
    </Pressable>
  );
}

const estilos = estilosTema(() => StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: cor.amarelo, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, marginRight: 8, maxWidth: 130 },
  texto: { fontSize: 12, fontWeight: '800', color: cor.primariaEscura, flexShrink: 1 },
}));
