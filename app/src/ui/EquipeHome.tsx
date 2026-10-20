import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useEquipe } from '@/lib/equipe';
import { moeda } from '@/lib/format';
import { Card, Secao, Vazio } from './components';
import { cor, espaco, raio } from './theme';

interface Contagem { planejadas: number; realizadas: number; em_andamento: number; com_venda: number }
interface LinhaVendedor extends Contagem { cod_vendedor: string; nome: string | null; escritorio: string | null; equipe: string | null }
interface Resumo { data: string; vendedores: LinhaVendedor[]; total: Contagem }
interface VendasEquipe { meses: Array<{ mes: string; valor: number; pedidos: number }>; mes_atual: string }

const NOME_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * Inicio do supervisor/gerente (modo equipe, nenhum vendedor escolhido): por vendedor, quantas visitas o roteiro
 * de hoje tem e quantas ja foram feitas. Sem listar loja a loja. Tocar no vendedor abre o app dele.
 */
export function EquipeHome() {
  const { entrarComo, abrirSeletor } = useEquipe();
  const [dados, setDados] = useState<Resumo | null>(null);
  const [vendas, setVendas] = useState<VendasEquipe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(async () => {
    setAtualizando(true);
    try {
      // as vendas do mes nao seguram o resumo de hoje: se falharem, o resto da tela aparece mesmo assim
      api<VendasEquipe>('/equipe/vendas', { semVendedor: true, timeoutMs: 60_000 }).then(setVendas).catch(() => undefined);
      setDados(await api<Resumo>('/equipe/hoje', { semVendedor: true, timeoutMs: 45_000 }));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o resumo da equipe.');
    } finally {
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const t = dados?.total;
  const comRoteiro = (dados?.vendedores ?? []).filter((v) => v.planejadas > 0);
  const semRoteiro = (dados?.vendedores ?? []).filter((v) => v.planejadas === 0);

  return (
    <ScrollView
      contentContainerStyle={estilos.conteudo}
      refreshControl={<RefreshControl refreshing={atualizando} onRefresh={carregar} tintColor={cor.primaria} colors={[cor.primaria]} />}
    >
      {erro ? <Text style={estilos.erro}>{erro}</Text> : null}

      <Card>
        <Text style={[estilos.rotulo, { textTransform: 'capitalize' }]}>Vendas de {vendas ? NOME_MES[Number(vendas.mes_atual.slice(5)) - 1] : 'este mês'} da equipe</Text>
        <Text style={estilos.grande}>{moeda(vendas?.meses[vendas.meses.length - 1]?.valor ?? 0)}</Text>
        <Text style={estilos.detalhe}>
          {vendas?.meses[vendas.meses.length - 1]?.pedidos ?? 0} pedido{(vendas?.meses[vendas.meses.length - 1]?.pedidos ?? 0) === 1 ? '' : 's'} no mês
        </Text>
      </Card>

      <Card>
        <Text style={estilos.rotulo}>Visitas de hoje da equipe</Text>
        <Text style={estilos.grande}>{t?.realizadas ?? 0} de {t?.planejadas ?? 0}</Text>
        <Text style={estilos.detalhe}>
          {t?.com_venda ?? 0} com venda · {t?.em_andamento ?? 0} em andamento · {Math.max((t?.planejadas ?? 0) - (t?.realizadas ?? 0), 0)} a visitar
        </Text>
      </Card>

      <Secao titulo="Vendedores" detalhe={dados ? `${comRoteiro.length} com roteiro hoje` : undefined} />
      {dados === null && !erro ? <Vazio icone="time-outline" texto="Carregando o resumo da equipe…" /> : null}
      {dados && !dados.vendedores.length ? <Vazio icone="people-outline" texto="Nenhum vendedor na sua equipe ainda." /> : null}

      {comRoteiro.map((v) => (
        <Card key={v.cod_vendedor} onPress={() => entrarComo(v)} style={estilos.linha}>
          <View style={{ flex: 1 }}>
            <Text style={estilos.nome} numberOfLines={1}>{v.nome ?? v.cod_vendedor}</Text>
            <Text style={estilos.detalhe}>
              {v.planejadas} visita{v.planejadas === 1 ? '' : 's'} hoje · {v.realizadas} realizada{v.realizadas === 1 ? '' : 's'}
              {v.com_venda ? ` · ${v.com_venda} com venda` : ''}
            </Text>
            <View style={estilos.barra}>
              <View style={[estilos.preenchido, { width: `${Math.min(100, Math.round((v.realizadas / v.planejadas) * 100))}%` }]} />
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={cor.textoSuave} />
        </Card>
      ))}

      {semRoteiro.length ? (
        <Text style={estilos.semRoteiro}>Sem roteiro hoje: {semRoteiro.map((v) => v.nome ?? v.cod_vendedor).join(', ')}.</Text>
      ) : null}

      <Text style={estilos.dica} onPress={abrirSeletor}>Toque em um vendedor (ou em “Vendedor” abaixo) para abrir o app dele.</Text>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2, gap: espaco.sm },
  rotulo: { fontSize: 13, color: cor.textoSuave },
  grande: { fontSize: 28, fontWeight: '800', color: cor.primaria, marginTop: 2 },
  detalhe: { fontSize: 13, color: cor.textoSuave, marginTop: 2 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  nome: { fontSize: 15, fontWeight: '700', color: cor.texto },
  barra: { height: 6, borderRadius: raio, backgroundColor: cor.neutroFundo, marginTop: 8, overflow: 'hidden' },
  preenchido: { height: 6, backgroundColor: cor.ok },
  semRoteiro: { fontSize: 13, color: cor.textoSuave, marginTop: espaco.sm },
  dica: { fontSize: 13, color: cor.textoSuave, textAlign: 'center', marginTop: espaco.lg },
  erro: { color: cor.erro, fontSize: 13 },
});
