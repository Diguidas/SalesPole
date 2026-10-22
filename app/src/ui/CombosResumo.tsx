import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import type { Combo, FaltaCombo, ItemCondicao, ResultadoCombos } from '@/domain/combo';
import { numero } from '@/lib/format';
import { cor, espaco, raio, estilosTema } from './theme';

const ROTULO_ALVO: Record<string, string> = { produto: 'do produto', marca: 'da marca', linha: 'da linha', grupo: 'do grupo', categoria: 'da categoria' };

const falta = (f: FaltaCombo['faltas'][number]) => `${numero(f.falta)} cx ${ROTULO_ALVO[f.item.alvo_tipo] ?? ''} ${f.item.alvo_valor}`.replace('  ', ' ');

/** O que o combo da (para o texto do aviso). */
function beneficioTexto(c: Combo, brindes: Record<string, { descricao: string }>): string {
  if (c.beneficio === 'produto_gratis') {
    const nome = brindes[c.brinde_cod_produto ?? '']?.descricao ?? c.brinde_cod_produto;
    return `ganha ${numero(c.brinde_qtd ?? 0)} cx de ${nome}`;
  }
  return `${numero(c.desconto_pct ?? 0)}% de desconto`;
}

export const condicaoTexto = (i: ItemCondicao) => `${numero(i.qtd_minima)} cx ${ROTULO_ALVO[i.alvo_tipo] ?? ''} ${i.alvo_valor}`.replace('  ', ' ');

/**
 * Combos do pedido: os que ja valem (e o que o cliente ganha) e os que estao perto de fechar ("falta 2 cx do produto X").
 * So mostra algo quando ha combo aplicado ou em andamento.
 */
export function CombosResumo({ resultado, brindes }: { resultado: ResultadoCombos | null; brindes: Record<string, { descricao: string }> }) {
  if (!resultado || (!resultado.aplicados.length && !resultado.incompletos.length)) return null;
  return (
    <View style={{ gap: espaco.sm }}>
      {resultado.aplicados.map((a) => (
        <View key={a.combo.id} style={[estilos.caixa, estilos.ok]}>
          <Ionicons name="gift" size={20} color={cor.ok} />
          <View style={{ flex: 1 }}>
            <Text style={[estilos.titulo, { color: cor.ok }]}>Combo aplicado: {a.combo.nome}</Text>
            <Text style={estilos.texto}>
              {a.vezes > 1 ? `${a.vezes}x · ` : ''}
              {a.combo.beneficio === 'produto_gratis'
                ? `ganha ${numero(Number(a.combo.brinde_qtd) * a.vezes)} cx de ${brindes[a.combo.brinde_cod_produto ?? '']?.descricao ?? a.combo.brinde_cod_produto}`
                : `${numero(a.combo.desconto_pct ?? 0)}% de desconto nos itens do combo`}
            </Text>
          </View>
        </View>
      ))}
      {resultado.incompletos.map((f) => (
        <View key={f.combo.id} style={[estilos.caixa, estilos.aviso]}>
          <Ionicons name="gift-outline" size={20} color={cor.aviso} />
          <View style={{ flex: 1 }}>
            <Text style={[estilos.titulo, { color: cor.aviso }]}>Quase lá: {f.combo.nome}</Text>
            <Text style={estilos.texto}>Falta {f.faltas.map(falta).join(' e ')} para o cliente {beneficioTexto(f.combo, brindes)}.</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const estilos = estilosTema(() => StyleSheet.create({
  caixa: { flexDirection: 'row', gap: espaco.md, alignItems: 'center', borderRadius: raio - 4, padding: espaco.md },
  ok: { backgroundColor: cor.okFundo },
  aviso: { backgroundColor: cor.avisoFundo },
  titulo: { fontSize: 14, fontWeight: '700' },
  texto: { fontSize: 13, color: cor.texto, marginTop: 2 },
}));
