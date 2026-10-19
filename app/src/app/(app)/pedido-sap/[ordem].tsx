import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDados } from '@/db/hooks';
import { duplicarPedidoSap, marcarOrdemCancelada, statusCancelaveis } from '@/db/pedidos';
import { buscarOrdemNoSap } from '@/db/sync';
import { itensDoPedidoSap, obterPedidoSap, pedidoAppDaOrdem } from '@/db/queries';
import { api } from '@/lib/api';
import { dataBR, moeda, numero } from '@/lib/format';
import { useSync } from '@/lib/sync-context';
import { Botao, Card, Carregando, Linha, Secao, Selo, Vazio } from '@/ui/components';
import { seloDoPedido } from '@/ui/status';
import { cor, espaco } from '@/ui/theme';

/** Detalhe de uma ordem de venda que veio do SAP (itens, notas e boleto). */
export default function PedidoSapTela() {
  const { ordem } = useLocalSearchParams<{ ordem: string }>();
  const db = useSQLiteContext();
  const router = useRouter();

  const { sincronizar } = useSync();
  const [cancelando, setCancelando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const { dados: p, carregando } = useDados((d) => obterPedidoSap(d, ordem), [ordem, recarga]);
  const { dados: cancelaveis } = useDados(statusCancelaveis, []);
  const { dados: itens } = useDados((d) => itensDoPedidoSap(d, ordem), [ordem, recarga]);
  // ordem recem-criada pelo app: ainda nao veio do SAP no sync, mas o pedido local ja a conhece
  const { dados: idLocal } = useDados((d) => (p ? Promise.resolve(null) : pedidoAppDaOrdem(d, ordem)), [ordem, p, carregando]);

  // Nao redireciona para o pedido do app: a tela do pedido tem o botao "Ordens no SAP" que abre ESTA tela (virava um loop).
  // Em vez disso busca os dados no SAP (1 vez, sozinho) e, se ainda nao vieram, explica e deixa tentar de novo.
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const tentouSozinho = useRef(false);
  async function buscarNoSap() {
    setBuscando(true);
    setErroBusca(null);
    try {
      await buscarOrdemNoSap(db, ordem); // pergunta so por ESTA ordem ao SAP (segundos), sem sincronizar tudo
      setRecarga((r) => r + 1);
    } catch (e) {
      setErroBusca(e instanceof Error ? e.message : 'Não foi possível buscar agora.');
    } finally {
      setBuscando(false);
    }
  }
  useEffect(() => {
    if (!carregando && !p && idLocal && !tentouSozinho.current) {
      tentouSozinho.current = true;
      void buscarNoSap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando, p, idLocal]);

  if (carregando) return <Carregando />;
  if (!p && idLocal) {
    return (
      <ScrollView contentContainerStyle={estilos.conteudo}>
        <Stack.Screen options={{ title: `Pedido ${ordem}` }} />
        <Card style={{ gap: espaco.sm }}>
          <Text style={estilos.cliente}>Ordem {ordem}</Text>
          <View style={estilos.selos}>
            <Selo texto="Criada pelo app" tom="ok" />
          </View>
          <Text style={estilos.itemSuave}>
            {buscando
              ? 'Buscando os dados desta ordem no SAP…'
              : erroBusca
                ? `Não consegui buscar agora: ${erroBusca}`
                : 'Os dados desta ordem (status, itens finais, valores e notas fiscais) ainda não chegaram a este aparelho.'}
          </Text>
        </Card>
        <View style={{ marginTop: espaco.md, gap: espaco.sm }}>
          <Botao titulo="Buscar os dados no SAP agora" onPress={buscarNoSap} carregando={buscando} />
          <Botao titulo="Voltar ao pedido" onPress={() => router.back()} tom="neutro" />
        </View>
      </ScrollView>
    );
  }
  if (!p) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Vazio icone="document-outline" texto="Este pedido ainda não foi baixado neste aparelho. Pedidos novos aparecem após sincronizar; pedidos com mais de 90 dias não ficam no aparelho." />
      </View>
    );
  }

  const selo = seloDoPedido('sap', p.status);
  const abrir = (url: string | null) => url && Linking.openURL(url).catch(() => Alert.alert('Não foi possível abrir o link.'));

  // o painel decide em quais status o pedido pode ser cancelado; o SAP ainda recusa ordem ja faturada
  const podeCancelar = (cancelaveis ?? []).includes((p.status ?? '').trim().toLowerCase());

  function cancelar() {
    Alert.alert('Cancelar este pedido?', `O pedido ${p!.ordem} será cancelado no SAP. Isso não pode ser desfeito.`, [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Cancelar pedido',
        style: 'destructive',
        onPress: async () => {
          setCancelando(true);
          try {
            await api(`/pedidos/sap/${ordem}/cancelar`, { method: 'POST', body: {}, timeoutMs: 60_000 });
            await marcarOrdemCancelada(db, ordem);
            setRecarga((r) => r + 1);
            Alert.alert('Pedido cancelado', 'O cancelamento foi feito no SAP.');
            void sincronizar(); // traz o status confirmado
          } catch (e) {
            Alert.alert('Não foi possível cancelar', e instanceof Error ? e.message : 'Tente de novo.');
          } finally {
            setCancelando(false);
          }
        },
      },
    ]);
  }

  async function duplicar() {
    const novo = await duplicarPedidoSap(db, ordem);
    if (!novo) return Alert.alert('Não foi possível duplicar', 'Este pedido não tem itens disponíveis neste aparelho.');
    router.replace(`/pedido/${novo}`);
  }

  return (
    <ScrollView contentContainerStyle={estilos.conteudo}>
      <Stack.Screen options={{ title: `Pedido ${p.ordem}` }} />

      <Card>
        <Text style={estilos.cliente}>{p.nome_cliente || p.cod_cliente}</Text>
        <View style={estilos.selos}>{selo ? <Selo texto={selo.texto} tom={selo.tom} /> : null}</View>
        <View style={{ marginTop: espaco.sm }}>
          <Linha rotulo="Criado em" valor={dataBR(p.dt_criacao)} />
          <Linha rotulo="Entrega" valor={dataBR(p.dt_entrega)} />
          <Linha rotulo="Valor" valor={moeda(p.valor)} />
          {p.pedido_externo ? <Linha rotulo="Código do app" valor={p.pedido_externo} /> : null}
        </View>
      </Card>

      {p.notas.length ? (
        <>
          <Secao titulo="Notas fiscais" />
          {p.notas.map((n, i) => (
            <Card key={`${n.nota_fiscal}-${i}`} style={estilos.nota}>
              <View style={{ flex: 1 }}>
                <Text style={estilos.notaTitulo}>NF {n.nota_fiscal || '—'}{n.serie ? `-${n.serie}` : ''}</Text>
              </View>
              {n.danfe_url ? (
                <Pressable onPress={() => abrir(n.danfe_url)} style={estilos.link}>
                  <Ionicons name="document-text-outline" size={18} color={cor.primaria} />
                  <Text style={estilos.linkTexto}>DANFE</Text>
                </Pressable>
              ) : null}
              {n.boleto_url ? (
                <Pressable onPress={() => abrir(n.boleto_url)} style={estilos.link}>
                  <Ionicons name="barcode-outline" size={18} color={cor.primaria} />
                  <Text style={estilos.linkTexto}>Boleto</Text>
                </Pressable>
              ) : null}
              {!n.danfe_url && !n.boleto_url ? <Text style={estilos.itemSuave}>Documentos ainda não disponíveis</Text> : null}
            </Card>
          ))}
        </>
      ) : null}

      <Secao titulo="Itens" detalhe={itens?.length ? `${itens.length}` : undefined} />
      {itens && itens.length ? (
        itens.map((i) => (
          <Card key={i.item} style={estilos.item}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={estilos.itemNome} numberOfLines={2}>{i.denominacao || i.cod_produto}</Text>
              <Text style={estilos.itemSuave}>
                {numero(i.quantidade)} {i.unidade_venda ?? ''}
                {i.valor_unitario ? ` · ${moeda(i.valor_unitario)}/${i.unidade_venda ?? 'un'}` : ''}
              </Text>
              {i.recusa ? <Text style={estilos.recusa}>Item recusado: {i.recusa}</Text> : null}
            </View>
          </Card>
        ))
      ) : (
        <Vazio icone="cube-outline" texto="Os itens deste pedido ainda não foram baixados. Sincronize com a internet ligada." />
      )}

      <View style={{ marginTop: espaco.lg }}>
        <Botao titulo="Duplicar pedido" onPress={duplicar} tom="neutro" desabilitado={!itens?.length} />
        {podeCancelar ? (
          <View style={{ marginTop: espaco.sm }}>
            <Botao titulo="Cancelar pedido" onPress={cancelar} tom="perigo" carregando={cancelando} />
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  cliente: { fontSize: 18, fontWeight: '800', color: cor.texto },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: espaco.sm },
  nota: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  notaTitulo: { fontSize: 15, fontWeight: '700', color: cor.texto },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  linkTexto: { color: cor.primaria, fontWeight: '700', fontSize: 13 },
  item: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  itemNome: { fontSize: 15, fontWeight: '700', color: cor.texto },
  itemSuave: { fontSize: 13, color: cor.textoSuave },
  recusa: { fontSize: 12, color: cor.erro, fontWeight: '600' },
});
