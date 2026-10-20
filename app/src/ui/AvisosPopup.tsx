import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { avisosNaoLidos, marcarAvisoLido, type Aviso } from '@/db/avisos';
import { useDados } from '@/db/hooks';
import { hojeISO } from '@/lib/format';
import { Botao } from './components';
import { cor, espaco, raio } from './theme';

const NIVEIS: Record<string, { icone: keyof typeof Ionicons.glyphMap; cor: string; fundo: string; rotulo: string }> = {
  info: { icone: 'megaphone', cor: cor.primaria, fundo: '#FFF1E5', rotulo: 'Aviso' },
  importante: { icone: 'alert-circle', cor: cor.aviso, fundo: cor.avisoFundo, rotulo: 'Importante' },
  urgente: { icone: 'warning', cor: cor.erro, fundo: cor.erroFundo, rotulo: 'Urgente' },
};

/**
 * Pop-up dos avisos que o painel mandou para o vendedor. Mostra um de cada vez, do mais urgente ao menos;
 * "Entendi" marca como lido neste aparelho. Novos avisos aparecem depois da sincronizacao.
 */
export function AvisosPopup() {
  const db = useSQLiteContext();
  const [tick, setTick] = useState(0);
  const { dados } = useDados((d) => avisosNaoLidos(d, hojeISO()), [tick]);
  const [fila, setFila] = useState<Aviso[]>([]);
  const [total, setTotal] = useState(0);

  // a fila so cresce com avisos novos: marcar um como lido nao embaralha os que faltam
  useEffect(() => {
    if (!dados) return;
    setFila((atual) => {
      const ids = new Set(atual.map((a) => a.id));
      const novos = dados.filter((a) => !ids.has(a.id));
      const vivos = atual.filter((a) => dados.some((d) => d.id === a.id));
      if (!atual.length) setTotal(novos.length);
      else if (novos.length) setTotal((t) => t + novos.length);
      return [...vivos, ...novos];
    });
  }, [dados]);

  const aviso = fila[0];
  if (!aviso) return null;
  const n = NIVEIS[aviso.nivel] ?? NIVEIS.info;
  const posicao = total - fila.length + 1;

  async function entendi() {
    await marcarAvisoLido(db, aviso);
    setFila((f) => f.slice(1));
    setTick((t) => t + 1);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined} statusBarTranslucent>
      <View style={estilos.fundo}>
        <View style={estilos.cartao}>
          <View style={[estilos.topo, { backgroundColor: n.fundo }]}>
            <View style={[estilos.icone, { backgroundColor: n.cor }]}>
              <Ionicons name={n.icone} size={30} color="#fff" />
            </View>
            <Text style={[estilos.rotulo, { color: n.cor }]}>{n.rotulo}{total > 1 ? ` · ${posicao} de ${total}` : ''}</Text>
          </View>
          <View style={estilos.corpo}>
            <Text style={estilos.titulo}>{aviso.titulo}</Text>
            <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
              <Text style={estilos.mensagem}>{aviso.mensagem}</Text>
            </ScrollView>
            <Botao titulo={fila.length > 1 ? 'Entendi · próximo' : 'Entendi'} onPress={entendi} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: 'rgba(15,23,42,.55)', justifyContent: 'center', padding: espaco.xl },
  cartao: { backgroundColor: cor.card, borderRadius: raio + 6, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  topo: { alignItems: 'center', paddingTop: espaco.xl, paddingBottom: espaco.lg, gap: espaco.sm },
  icone: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  rotulo: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  corpo: { padding: espaco.xl, gap: espaco.lg },
  titulo: { fontSize: 20, fontWeight: '800', color: cor.texto, textAlign: 'center' },
  mensagem: { fontSize: 15, lineHeight: 22, color: cor.texto, textAlign: 'center' },
});
