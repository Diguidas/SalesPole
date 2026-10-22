import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useEquipe } from '@/lib/equipe';
import { moeda } from '@/lib/format';
import { BarChart } from './BarChart';
import { Card, Secao, Vazio } from './components';
import { cor, espaco, estilosTema } from './theme';

interface MesVenda { mes: string; valor: number; pedidos: number }
interface VendedorVenda { cod_vendedor: string; nome: string | null; valor: number; pedidos: number; clientes: number }
interface Vendas { meses: MesVenda[]; mes_atual: string; por_vendedor: VendedorVenda[] }

const NOME_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const valorCurto = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(Math.round(v)));

/** Análise do supervisor/gerente (modo equipe, nenhum vendedor escolhido): vendido nos últimos 3 meses e ranking do mês por vendedor. */
export function EquipeAnalise() {
  const { entrarComo } = useEquipe();
  const [dados, setDados] = useState<Vendas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(async () => {
    setAtualizando(true);
    try {
      setDados(await api<Vendas>('/equipe/vendas', { semVendedor: true, timeoutMs: 60_000 }));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar as vendas da equipe.');
    } finally {
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const total = (dados?.meses ?? []).reduce((s, m) => s + m.valor, 0);
  const nomeMes = dados ? NOME_MES[Number(dados.mes_atual.slice(5)) - 1] : '';
  const maior = Math.max(1, ...(dados?.por_vendedor ?? []).map((v) => v.valor));

  return (
    <ScrollView
      contentContainerStyle={estilos.conteudo}
      refreshControl={<RefreshControl refreshing={atualizando} onRefresh={carregar} tintColor={cor.primaria} colors={[cor.primaria]} />}
    >
      {erro ? <Text style={estilos.erro}>{erro}</Text> : null}
      <Secao titulo="Vendido nos últimos 3 meses" detalhe={dados ? moeda(total) : undefined} />
      <Card>
        {dados ? (
          <BarChart
            barras={dados.meses.map((m, i, todos) => ({ rotulo: NOME_MES[Number(m.mes.slice(5)) - 1].slice(0, 3), valor: m.valor, destaque: i === todos.length - 1 }))}
            formato={valorCurto}
          />
        ) : (
          <Text style={estilos.nota}>Carregando…</Text>
        )}
        <Text style={estilos.nota}>Valor dos pedidos das carteiras da sua equipe. O mês atual (laranja) está em andamento.</Text>
      </Card>

      <Secao titulo={`Por vendedor em ${nomeMes}`} detalhe={dados ? `${dados.por_vendedor.length}` : undefined} />
      {dados && !dados.por_vendedor.length ? <Vazio icone="people-outline" texto="Nenhum vendedor na sua equipe ainda." /> : null}
      {(dados?.por_vendedor ?? []).map((v) => (
        <Card key={v.cod_vendedor} style={estilos.linha} onPress={() => entrarComo({ cod_vendedor: v.cod_vendedor, nome: v.nome })}>
          <View style={{ flex: 1 }}>
            <Text style={estilos.nome} numberOfLines={1}>{v.nome ?? v.cod_vendedor}</Text>
            <Text style={estilos.nota2}>{v.pedidos} pedido{v.pedidos === 1 ? '' : 's'} · {v.clientes} cliente{v.clientes === 1 ? '' : 's'}</Text>
            <View style={estilos.barra}><View style={[estilos.preenchido, { width: `${Math.round((v.valor / maior) * 100)}%` }]} /></View>
          </View>
          <Text style={estilos.valor}>{moeda(v.valor)}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

const estilos = estilosTema(() => StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  nota: { fontSize: 12, color: cor.textoSuave, textAlign: 'center', marginTop: espaco.md },
  nota2: { fontSize: 13, color: cor.textoSuave, marginTop: 2 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  nome: { fontSize: 15, fontWeight: '700', color: cor.texto },
  valor: { fontSize: 15, fontWeight: '800', color: cor.primaria },
  barra: { height: 6, borderRadius: 3, backgroundColor: cor.neutroFundo, marginTop: 8, overflow: 'hidden' },
  preenchido: { height: 6, backgroundColor: cor.primaria },
  erro: { color: cor.erro, fontSize: 13, marginBottom: espaco.sm },
}));
