import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { dataBR, moeda } from '@/lib/format';
import { BarChart } from '@/ui/BarChart';
import { Card, Carregando, Linha, Secao, Selo, Vazio } from '@/ui/components';
import { cor, espaco, estilosTema } from '@/ui/theme';

interface TituloResumo {
  nfe: string; parcela: string; status: string | null; valor: number | null; vencimento: string | null;
  dt_compensacao: string | null; ordem: string | null; danfe_url: string | null; boleto_url: string | null;
}

interface ClienteDetalhe {
  cod_cliente: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpjcpf: string | null;
  telefone: string | null;
  bloqueado: boolean;
  pagamento_antecipado?: boolean;
  endereco: { logradouro?: string; bairro?: string; cidade?: string; uf?: string; cep?: string } | null;
  limite_total: number | null;
  limite_disponivel: number | null;
  pedido_minimo: number | null;
  rota: string | null;
  vendedores: Array<{ cod_vendedor: string; nome: string | null }>;
  compras_por_mes: Array<{ mes: string; valor: number; pedidos: number }>;
  total_12m: number;
  ultimos_pedidos: Array<{ ordem: string; dt_criacao: string; valor: number; status: string | null; item_recusado: boolean }>;
  titulos: { em_aberto: number; vencido: number; recentes: TituloResumo[] };
  visitas: Array<{ id: string; data_visita: string; status: string; resultado: string | null }>;
  produtos_mais_comprados: Array<{ cod_produto: string; denominacao: string | null; quantidade: number; unidade: string | null; pedidos: number }>;
}

/** Cor do selo de status do pedido: faturado = verde, recusado = vermelho, o resto (em andamento) = amarelo. */
const tomPedido = (s: string | null) => {
  const t = (s ?? '').toLowerCase();
  return t.startsWith('faturado') ? 'ok' : t === 'recusado' ? 'erro' : t ? 'aviso' : 'neutro';
};

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const valorCurto = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(Math.round(v)));

/** Cliente visto pelo supervisor/gerente (modo equipe): cadastro, compras, financeiro e visitas, so leitura, direto do servidor. */
export default function ClienteEquipe() {
  const { cod } = useLocalSearchParams<{ cod: string }>();
  const router = useRouter();
  const [c, setC] = useState<ClienteDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(async () => {
    setAtualizando(true);
    try {
      setC(await api<ClienteDetalhe>(`/equipe/clientes/${encodeURIComponent(String(cod))}`, { semVendedor: true, timeoutMs: 60_000 }));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o cliente.');
    } finally {
      setAtualizando(false);
    }
  }, [cod]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!c && !erro) return <Carregando />;
  if (!c) return <Vazio icone="alert-circle-outline" texto={erro ?? 'Cliente não encontrado.'} />;

  const e = c.endereco;
  const enderecoTxt = [e?.logradouro, e?.bairro, [e?.cidade, e?.uf].filter(Boolean).join('/'), e?.cep].filter(Boolean).join(' · ');

  return (
    <ScrollView
      contentContainerStyle={estilos.conteudo}
      refreshControl={<RefreshControl refreshing={atualizando} onRefresh={carregar} tintColor={cor.primaria} colors={[cor.primaria]} />}
    >
      <Stack.Screen options={{ title: c.nome_fantasia || c.razao_social || 'Cliente' }} />

      <Card>
        <Text style={estilos.nome}>{c.nome_fantasia || c.razao_social}</Text>
        {c.nome_fantasia && c.razao_social ? <Text style={estilos.razao}>{c.razao_social}</Text> : null}
        <View style={estilos.selos}>
          {c.bloqueado ? <Selo texto="Bloqueado" tom="erro" /> : null}
          {c.pagamento_antecipado ? <Selo texto="Pagamento antecipado" tom="aviso" /> : null}
          {c.titulos.vencido > 0 ? <Selo texto={`Vencido ${moeda(c.titulos.vencido)}`} tom="erro" /> : null}
        </View>
        <Linha rotulo="Código" valor={c.cod_cliente} />
        <Linha rotulo="CNPJ/CPF" valor={c.cnpjcpf} />
        <Linha rotulo="Telefone" valor={c.telefone} />
        <Linha rotulo="Endereço" valor={enderecoTxt} />
        <Linha rotulo="Vendedor" valor={c.vendedores.map((v) => v.nome ?? v.cod_vendedor).join(' / ')} />
      </Card>

      <Secao titulo="Compras nos últimos 12 meses" detalhe={moeda(c.total_12m)} />
      <Card>
        <BarChart
          barras={c.compras_por_mes.slice(-6).map((m, i, todos) => ({ rotulo: MES[Number(m.mes.slice(5)) - 1], valor: m.valor, destaque: i === todos.length - 1 }))}
          formato={valorCurto}
        />
        <Text style={estilos.nota}>Últimos 6 meses. O mês atual (laranja) está em andamento.</Text>
      </Card>

      <Secao titulo="Financeiro" />
      <Card>
        <Linha rotulo="Limite de crédito" valor={c.limite_total != null ? moeda(c.limite_total) : null} />
        <Linha rotulo="Limite disponível" valor={c.limite_disponivel != null ? moeda(c.limite_disponivel) : null} />
        <Linha rotulo="Títulos em aberto" valor={moeda(c.titulos.em_aberto)} />
        <Linha rotulo="Títulos vencidos" valor={moeda(c.titulos.vencido)} />
        <Linha rotulo="Pedido mínimo" valor={c.pedido_minimo != null ? moeda(c.pedido_minimo) : null} />
      </Card>

      <Secao titulo="Últimos pedidos" />
      {c.ultimos_pedidos.length ? (
        c.ultimos_pedidos.map((p) => (
          <Card key={p.ordem} style={estilos.linhaPedido} onPress={() => router.push(`/pedido-equipe/${p.ordem}`)}>
            <View style={{ flex: 1 }}>
              <Text style={estilos.pedido}>Pedido {p.ordem}</Text>
              <Text style={estilos.nota2}>{dataBR(p.dt_criacao)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={estilos.valor}>{moeda(p.valor)}</Text>
              <View style={estilos.selosLinha}>
                {p.item_recusado ? <Selo texto="Item recusado" tom="erro" /> : null}
                {p.status ? <Selo texto={p.status} tom={tomPedido(p.status)} /> : null}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={cor.textoSuave} />
          </Card>
        ))
      ) : (
        <Vazio icone="receipt-outline" texto="Sem pedidos nos últimos 12 meses." />
      )}

      <Secao titulo="Últimos títulos" />
      {c.titulos.recentes.length ? (
        c.titulos.recentes.map((t) => (
          <Card
            key={`${t.nfe}-${t.parcela}`}
            style={estilos.linhaPedido}
            onPress={() =>
              router.push({
                pathname: '/titulo-equipe',
                params: {
                  cliente: c.nome_fantasia || c.razao_social || c.cod_cliente, nfe: t.nfe, parcela: t.parcela, status: t.status ?? '', valor: String(t.valor ?? ''),
                  vencimento: t.vencimento ?? '', pago: t.dt_compensacao ?? '', ordem: t.ordem ?? '', danfe: t.danfe_url ?? '', boleto: t.boleto_url ?? '',
                },
              })
            }
          >
            <View style={{ flex: 1 }}>
              <Text style={estilos.pedido}>NF {t.nfe}{t.parcela ? ` · ${t.parcela}` : ''}</Text>
              <Text style={estilos.nota2}>Vence {dataBR(t.vencimento)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={estilos.valor}>{moeda(t.valor)}</Text>
              {t.status ? <Selo texto={t.status} tom={t.status === 'Atrasado' ? 'erro' : t.status === 'Compensado' ? 'ok' : 'aviso'} /> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={cor.textoSuave} />
          </Card>
        ))
      ) : (
        <Vazio icone="cash-outline" texto="Nenhum título para este cliente." />
      )}

      {c.produtos_mais_comprados.length ? (
        <>
          <Secao titulo="Produtos que mais compra" />
          <Card>
            {c.produtos_mais_comprados.slice(0, 8).map((p) => (
              <Linha key={p.cod_produto} rotulo={p.denominacao ?? p.cod_produto} valor={`${Math.round(p.quantidade)} ${p.unidade ?? ''}`.trim()} />
            ))}
          </Card>
        </>
      ) : null}

      {c.visitas.length ? (
        <>
          <Secao titulo="Visitas recentes" />
          <Card>
            {c.visitas.map((v) => (
              <Linha key={v.id} rotulo={dataBR(v.data_visita)} valor={v.status === 'concluida' ? (v.resultado === 'vendeu' ? 'Vendeu' : 'Não vendeu') : 'Em andamento'} />
            ))}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const estilos = estilosTema(() => StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  nome: { fontSize: 18, fontWeight: '800', color: cor.texto },
  razao: { fontSize: 13, color: cor.textoSuave, marginTop: 2 },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: espaco.sm },
  selosLinha: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4 },
  nota: { fontSize: 12, color: cor.textoSuave, textAlign: 'center', marginTop: espaco.md },
  nota2: { fontSize: 13, color: cor.textoSuave, marginTop: 2 },
  linhaPedido: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  pedido: { fontSize: 15, fontWeight: '700', color: cor.texto },
  valor: { fontSize: 15, fontWeight: '800', color: cor.primaria },
}));
