import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import type { ClienteResumo } from '@/db/queries';
import type { Visita } from '@/db/visitas';
import { moeda } from '@/lib/format';
import { Card, Selo } from './components';
import { cor, espaco } from './theme';

/** Cartao de cliente (tela do dia e lista de clientes). `ordem` mostra a sequencia de visita. */
export function CardCliente({
  c, ordem, visita, onPress,
}: { c: ClienteResumo; ordem?: number; /** visita de hoje deste cliente (so na tela do dia) */ visita?: Pick<Visita, 'status' | 'resultado'> | null; onPress: () => void }) {
  return (
    <Card onPress={onPress} style={estilos.card}>
      {ordem !== undefined ? (
        <View style={estilos.ordem}>
          <Text style={estilos.ordemTexto}>{ordem}</Text>
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={estilos.nome} numberOfLines={1}>{c.nome_fantasia || c.razao_social || c.cod_cliente}</Text>
        {c.nome_fantasia && c.razao_social ? <Text style={estilos.razao} numberOfLines={1}>{c.razao_social}</Text> : null}
        <View style={estilos.selos}>
          {visita?.status === 'em_andamento' ? <Selo texto="Em visita" tom="aviso" /> : null}
          {visita?.status === 'concluida' ? (
            <Selo texto={visita.resultado === 'vendeu' ? 'Visitado · vendeu' : 'Visitado · sem venda'} tom={visita.resultado === 'vendeu' ? 'ok' : 'neutro'} />
          ) : null}
          {c.bloqueado ? <Selo texto="Bloqueado" tom="erro" /> : null}
          {c.atrasados > 0 ? (
            <Selo texto={`${c.atrasados} atrasado${c.atrasados > 1 ? 's' : ''} · ${moeda(c.valor_atrasado)}`} tom="aviso" />
          ) : null}
          {c.pagamento_antecipado ? <Selo texto="Pagamento antecipado" tom="aviso" /> : null}
          {!c.pagamento_antecipado && c.limite_disponivel !== null ? <Selo texto={`Limite ${moeda(c.limite_disponivel)}`} /> : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={cor.textoSuave} />
    </Card>
  );
}

const estilos = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  ordem: { width: 30, height: 30, borderRadius: 15, backgroundColor: cor.primaria, alignItems: 'center', justifyContent: 'center' },
  ordemTexto: { color: '#fff', fontWeight: '800', fontSize: 14 },
  nome: { fontSize: 16, fontWeight: '700', color: cor.texto },
  razao: { fontSize: 13, color: cor.textoSuave },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
});
