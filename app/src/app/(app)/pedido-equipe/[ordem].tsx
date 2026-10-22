import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { dataBR, moeda } from '@/lib/format';
import { Botao, Card, Carregando, Linha, Secao, Selo, Vazio } from '@/ui/components';
import { cor, espaco, estilosTema } from '@/ui/theme';

interface Nota { nota_fiscal?: string; serie?: string; danfe_url?: string; xml_url?: string; boleto_url?: string }
interface Item { item: string; cod_produto: string; denominacao: string | null; quantidade: number | null; unidade_venda: string | null; valor_unitario: number | null; recusa: string | null; cod_recusa: string | null; situacao: string | null; qtd_faturada: number | null; valor_faturado: number | null }
interface PedidoEquipe {
  ordem: string;
  cod_cliente: string;
  cliente: string | null;
  vendedores: Array<{ cod_vendedor: string; nome: string | null }>;
  dt_criacao: string;
  dt_entrega: string | null;
  valor: number | null;
  status: string | null;
  pedido_externo: string | null;
  notas: Nota[] | number;
  itens: Item[];
}

const tomStatus = (s: string | null) => {
  const t = (s ?? '').toLowerCase();
  return t.startsWith('faturado') ? 'ok' : t === 'recusado' ? 'erro' : t ? 'aviso' : 'neutro';
};

/** Pedido do SAP visto pelo supervisor/gerente (modo equipe): itens, notas fiscais e links de DANFE, XML e boleto. */
export default function PedidoEquipe() {
  const { ordem } = useLocalSearchParams<{ ordem: string }>();
  const [p, setP] = useState<PedidoEquipe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(async () => {
    setAtualizando(true);
    try {
      setP(await api<PedidoEquipe>(`/equipe/pedidos/${encodeURIComponent(String(ordem))}`, { semVendedor: true, timeoutMs: 60_000 }));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o pedido.');
    } finally {
      setAtualizando(false);
    }
  }, [ordem]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!p && !erro) return <Carregando />;
  if (!p) return <Vazio icone="alert-circle-outline" texto={erro ?? 'Pedido não encontrado.'} />;

  const notas = Array.isArray(p.notas) ? p.notas : [];
  const abrir = (url?: string) => url && Linking.openURL(url).catch(() => Alert.alert('Não foi possível abrir o link.'));

  return (
    <ScrollView
      contentContainerStyle={estilos.conteudo}
      refreshControl={<RefreshControl refreshing={atualizando} onRefresh={carregar} tintColor={cor.primaria} colors={[cor.primaria]} />}
    >
      <Stack.Screen options={{ title: `Pedido ${p.ordem}` }} />

      <Card>
        <Text style={estilos.cliente}>{p.cliente ?? p.cod_cliente}</Text>
        <View style={estilos.selos}>{p.status ? <Selo texto={p.status} tom={tomStatus(p.status)} /> : null}</View>
        <Text style={estilos.valor}>{moeda(p.valor)}</Text>
        <View style={{ marginTop: espaco.sm }}>
          <Linha rotulo="Ordem" valor={p.ordem} />
          <Linha rotulo="Criado em" valor={dataBR(p.dt_criacao)} />
          <Linha rotulo="Entrega" valor={p.dt_entrega ? dataBR(p.dt_entrega) : null} />
          <Linha rotulo="Vendedor" valor={p.vendedores.map((v) => v.nome ?? v.cod_vendedor).join(' / ')} />
          {p.pedido_externo ? <Linha rotulo="Pedido do cliente" valor={p.pedido_externo} /> : null}
        </View>
      </Card>

      <Secao titulo="Notas fiscais" />
      {notas.length ? (
        notas.map((n, k) => (
          <Card key={k} style={estilos.nota}>
            <Text style={estilos.notaTitulo}>NF {n.nota_fiscal ?? '—'}{n.serie ? `/${n.serie}` : ''}</Text>
            <View style={estilos.acoes}>
              {n.danfe_url ? <Botao titulo="DANFE" onPress={() => abrir(n.danfe_url)} /> : null}
              {n.xml_url ? <Botao titulo="XML" onPress={() => abrir(n.xml_url)} tom="neutro" /> : null}
              {n.boleto_url ? <Botao titulo="Boleto" onPress={() => abrir(n.boleto_url)} tom="neutro" /> : null}
            </View>
            {!n.danfe_url && !n.xml_url && !n.boleto_url ? <Text style={estilos.nota2}>Sem links disponíveis para esta nota.</Text> : null}
          </Card>
        ))
      ) : (
        <Vazio icone="document-text-outline" texto="Este pedido ainda não tem nota fiscal." />
      )}

      <Secao titulo="Itens" detalhe={`${p.itens.length}`} />
      {p.itens.map((i) => (
        <Card key={i.item} style={i.recusa || i.cod_recusa ? { ...estilos.item, ...estilos.itemRecusado } : estilos.item}>
          <View style={{ flex: 1 }}>
            <Text style={estilos.itemNome} numberOfLines={2}>{i.denominacao ?? i.cod_produto}</Text>
            <Text style={estilos.nota2}>
              {i.quantidade != null ? `${i.quantidade} ${i.unidade_venda ?? ''}`.trim() : '—'}{i.valor_unitario != null ? ` · ${moeda(i.valor_unitario)} cada` : ''}
            </Text>
            {i.recusa || i.cod_recusa ? (
              <Text style={estilos.recusa}>Item recusado: {i.recusa ?? 'sem descrição do SAP'}{i.cod_recusa ? ` (cód. ${i.cod_recusa})` : ''}</Text>
            ) : (
              <>
                {i.situacao ? <Text style={estilos.nota2}>{i.situacao}</Text> : null}
                {i.qtd_faturada != null && i.qtd_faturada !== i.quantidade ? (
                  <Text style={estilos.faturado}>Faturado: {i.qtd_faturada} {i.unidade_venda ?? ''}{i.valor_faturado != null ? ` · ${moeda(i.qtd_faturada * i.valor_faturado)}` : ''}</Text>
                ) : null}
              </>
            )}
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const estilos = estilosTema(() => StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  cliente: { fontSize: 18, fontWeight: '800', color: cor.texto },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: espaco.sm },
  valor: { fontSize: 28, fontWeight: '800', color: cor.texto, marginTop: espaco.sm },
  nota: { marginBottom: espaco.sm, gap: espaco.sm },
  notaTitulo: { fontSize: 15, fontWeight: '700', color: cor.texto },
  nota2: { fontSize: 13, color: cor.textoSuave, marginTop: 2 },
  acoes: { gap: espaco.sm },
  item: { flexDirection: 'row', alignItems: 'center', marginBottom: espaco.sm },
  itemNome: { fontSize: 14, fontWeight: '700', color: cor.texto },
  itemRecusado: { backgroundColor: cor.erroFundo },
  faturado: { fontSize: 12, color: cor.aviso, fontWeight: '600' },
  recusa: { fontSize: 13, color: cor.erro, fontWeight: '700', marginTop: 4 },
}));
