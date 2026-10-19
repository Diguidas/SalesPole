import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { buscarProdutos, rotulo } from '@/db/catalogo';
import { useDados } from '@/db/hooks';
import { historicoDoProduto, obterCliente, produtosCompradosPeloCliente } from '@/db/queries';
import { dataBR, hojeISO, moeda, numero } from '@/lib/format';
import { Card, Carregando, Segmentado, Selo, Vazio } from '@/ui/components';
import { FotoProduto } from '@/ui/FotoProduto';
import { cor, espaco } from '@/ui/theme';

type Aba = 'lista' | 'semgiro' | 'comprados';
const DIAS_SEM_GIRO = 30;

function dataAtras(hoje: string, dias: number): string {
  const d = new Date(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 1, Number(hoje.slice(8, 10)) - dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Historico de compras de um produto para o cliente (abre ao tocar no produto). */
function HistoricoProduto({ cod, produto }: { cod: string; produto: string }) {
  const { dados } = useDados((db) => historicoDoProduto(db, cod, produto), [cod, produto]);
  if (!dados) return <Text style={estilos.suave}>Carregando…</Text>;
  if (!dados.length) return <Text style={estilos.suave}>Sem compras detalhadas nos últimos 90 dias (o resumo de 12 meses está na lista).</Text>;
  return (
    <View style={{ gap: 4 }}>
      {dados.map((h) => (
        <View key={`${h.ordem}`} style={estilos.histLinha}>
          <Text style={estilos.suave}>{dataBR(h.data)} · pedido {h.ordem}</Text>
          <Text style={estilos.histValor}>
            {numero(h.quantidade)} {h.unidade ?? ''}{h.valor_unitario !== null ? ` · ${moeda(h.valor_unitario)}` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function ProdutosDoCliente() {
  const { cod } = useLocalSearchParams<{ cod: string }>();
  const hoje = hojeISO();
  const [aba, setAba] = useState<Aba>('semgiro');
  const [aberto, setAberto] = useState<string | null>(null);

  const { dados: c, carregando } = useDados((db) => obterCliente(db, cod), [cod]);
  const { dados: comprados } = useDados((db) => produtosCompradosPeloCliente(db, cod), [cod]);
  const { dados: lista } = useDados(
    (db) => (c ? buscarProdutos(db, c.areas, '', hoje, 200) : Promise.resolve([])),
    [c?.cod_cliente, hoje],
  );

  if (carregando) return <Carregando />;

  const corte = dataAtras(hoje, DIAS_SEM_GIRO);
  const semGiro = (comprados ?? []).filter((p) => p.ultima_compra < corte);
  const ultimaPorProduto = new Map((comprados ?? []).map((p) => [p.cod_produto, p.ultima_compra]));

  const alternar = (id: string) => setAberto((a) => (a === id ? null : id));

  return (
    <ScrollView contentContainerStyle={estilos.conteudo}>
      <Stack.Screen options={{ title: c?.nome_fantasia || c?.razao_social || 'Produtos' }} />

      <Segmentado
        opcoes={[
          { valor: 'semgiro', texto: `Sem giro (${semGiro.length})` },
          { valor: 'lista', texto: 'Lista de preço' },
          { valor: 'comprados', texto: `Comprados (${comprados?.length ?? 0})` },
        ]}
        valor={aba}
        onChange={(v) => {
          setAba(v);
          setAberto(null);
        }}
      />

      {aba === 'semgiro' ? (
        <>
          <Text style={estilos.explica}>Produtos que o cliente comprou e não pede há mais de {DIAS_SEM_GIRO} dias.</Text>
          {semGiro.length ? (
            semGiro.map((p) => (
              <Card key={p.cod_produto} style={estilos.item} onPress={() => alternar(p.cod_produto)}>
                <View style={estilos.linhaFoto}>
                  <FotoProduto cod={p.cod_produto} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={estilos.titulo}>{p.descricao}</Text>
                    <Text style={estilos.suave}>
                      Última compra {dataBR(p.ultima_compra)} · {p.pedidos} pedido{p.pedidos === 1 ? '' : 's'}
                    </Text>
                  </View>
                </View>
                {aberto === p.cod_produto ? <View style={estilos.hist}><HistoricoProduto cod={cod} produto={p.cod_produto} /></View> : null}
              </Card>
            ))
          ) : (
            <Vazio icone="checkmark-circle-outline" texto="Nenhum produto sem giro. O cliente comprou tudo o que costuma comprar nos últimos 30 dias." />
          )}
        </>
      ) : null}

      {aba === 'lista' ? (
        <>
          <Text style={estilos.explica}>Produtos que você pode vender a este cliente pela lista de preço dele.</Text>
          {lista && lista.length ? (
            lista.map((p) => {
              const ultima = ultimaPorProduto.get(p.cod_produto);
              return (
                <Card key={p.cod_produto} style={estilos.item} onPress={() => alternar(p.cod_produto)}>
                  <View style={estilos.linhaFoto}>
                    <FotoProduto cod={p.cod_produto} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={estilos.topo}>
                        <Text style={[estilos.titulo, { flex: 1 }]}>{p.descricao}</Text>
                        {ultima ? null : <Selo texto="Nunca comprou" />}
                      </View>
                      <Text style={estilos.suave}>
                        {p.preco ? `${moeda(p.preco.valor)} / ${rotulo(p, p.preco.unidade)}` : 'Sem preço'}
                        {ultima ? ` · última compra ${dataBR(ultima)}` : ''}
                      </Text>
                    </View>
                  </View>
                  {aberto === p.cod_produto ? <View style={estilos.hist}><HistoricoProduto cod={cod} produto={p.cod_produto} /></View> : null}
                </Card>
              );
            })
          ) : (
            <Vazio icone="pricetags-outline" texto="Nenhum produto disponível para este cliente (confira se o catálogo foi sincronizado)." />
          )}
        </>
      ) : null}

      {aba === 'comprados' ? (
        <>
          <Text style={estilos.explica}>Tudo o que este cliente comprou nos últimos 12 meses. Toque no produto para ver as compras dos últimos 90 dias.</Text>
          {comprados && comprados.length ? (
            comprados.map((p) => (
              <Card key={p.cod_produto} style={estilos.item} onPress={() => alternar(p.cod_produto)}>
                <View style={estilos.linhaFoto}>
                  <FotoProduto cod={p.cod_produto} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={estilos.titulo}>{p.descricao}</Text>
                    <Text style={estilos.suave}>
                      {numero(p.quantidade)} {p.unidade ?? ''} em {p.pedidos} pedido{p.pedidos === 1 ? '' : 's'} · última {dataBR(p.ultima_compra)}
                    </Text>
                  </View>
                </View>
                {aberto === p.cod_produto ? <View style={estilos.hist}><HistoricoProduto cod={cod} produto={p.cod_produto} /></View> : null}
              </Card>
            ))
          ) : (
            <Vazio icone="cube-outline" texto="Nenhuma compra com itens neste aparelho ainda. Sincronize para trazer os itens dos pedidos." />
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  explica: { color: cor.textoSuave, fontSize: 13, marginVertical: espaco.md },
  item: { marginBottom: espaco.sm, gap: 3 },
  linhaFoto: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  topo: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  titulo: { fontSize: 15, fontWeight: '700', color: cor.texto },
  suave: { fontSize: 13, color: cor.textoSuave },
  hist: { marginTop: espaco.sm, paddingTop: espaco.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: cor.borda },
  histLinha: { flexDirection: 'row', justifyContent: 'space-between', gap: espaco.md },
  histValor: { fontSize: 13, color: cor.texto, fontWeight: '600' },
});
