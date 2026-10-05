import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDados, useTickAoFocar } from '@/db/hooks';
import { obterOuCriarRascunho } from '@/db/pedidos';
import { obterCliente, pedidosDoCliente, titulosDoCliente } from '@/db/queries';
import { dataBR, documento, moeda, NOME_DIA_CURTO } from '@/lib/format';
import { Botao, Card, Carregando, Linha, Secao, Selo, Vazio } from '@/ui/components';
import { seloDoPedido } from '@/ui/status';
import { cor, espaco } from '@/ui/theme';

export default function ClienteDetalhe() {
  const { cod } = useLocalSearchParams<{ cod: string }>();
  const dbLocal = useSQLiteContext();
  const router = useRouter();
  const tick = useTickAoFocar();
  const { dados: c, carregando } = useDados((db) => obterCliente(db, cod), [cod]);
  const { dados: pedidos } = useDados((db) => pedidosDoCliente(db, cod), [cod, tick]);
  const { dados: titulos } = useDados((db) => titulosDoCliente(db, cod), [cod]);

  async function novoPedido() {
    // retoma o rascunho aberto deste cliente ou cria um novo
    const id = await obterOuCriarRascunho(dbLocal, cod);
    router.push(`/pedido/${id}`);
  }

  if (carregando) return <Carregando />;
  if (!c) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Vazio icone="person-remove-outline" texto="Cliente não encontrado neste aparelho (pode ter saído da sua carteira)." />
      </View>
    );
  }

  const e = c.endereco;
  const endereco = e ? [e.logradouro, e.bairro, [e.cidade, e.uf].filter(Boolean).join('/'), e.cep].filter(Boolean).join(' · ') : null;
  const atrasados = (titulos ?? []).filter((t) => t.status === 'Atrasado');
  const valorAtrasado = atrasados.reduce((s, t) => s + (t.valor ?? 0), 0);

  return (
    <ScrollView contentContainerStyle={estilos.conteudo}>
      <Stack.Screen options={{ title: c.nome_fantasia || c.razao_social || 'Cliente' }} />

      <Card>
        <Text style={estilos.nome}>{c.nome_fantasia || c.razao_social}</Text>
        {c.nome_fantasia && c.razao_social ? <Text style={estilos.razao}>{c.razao_social}</Text> : null}
        <View style={estilos.selos}>
          {c.bloqueado ? <Selo texto="Bloqueado" tom="erro" /> : null}
          {c.classe_risco?.descricao ? <Selo texto={`Risco: ${c.classe_risco.descricao}`} /> : null}
          {c.agrupado ? <Selo texto="Limite agrupado" /> : null}
        </View>
        <View style={{ marginTop: espaco.md }}>
          <Linha rotulo="Código" valor={c.cod_cliente} />
          <Linha rotulo="CNPJ/CPF" valor={documento(c.cnpjcpf)} />
          <Linha rotulo="Endereço" valor={endereco} />
          <Linha rotulo="Entregas" valor={c.dias_entrega.length ? c.dias_entrega.map((d) => NOME_DIA_CURTO[d]).join(', ') : null} />
        </View>
        {c.telefone ? (
          <Pressable
            style={estilos.ligar}
            onPress={() => Linking.openURL(`tel:${c.telefone!.replace(/[^\d+]/g, '')}`).catch(() => Alert.alert('Não foi possível abrir o discador.'))}
          >
            <Ionicons name="call" size={18} color={cor.primaria} />
            <Text style={estilos.ligarTexto}>{c.telefone}</Text>
          </Pressable>
        ) : null}
      </Card>

      <Card style={{ marginTop: espaco.md }}>
        <Linha rotulo="Limite total" valor={moeda(c.limite_total)} />
        <Linha rotulo="Limite disponível" valor={moeda(c.limite_disponivel)} />
        <Linha rotulo="Títulos atrasados" valor={atrasados.length ? `${atrasados.length} · ${moeda(valorAtrasado)}` : 'Nenhum'} />
      </Card>

      <View style={{ marginTop: espaco.lg }}>
        <Botao
          titulo="Novo pedido para este cliente"
          onPress={novoPedido}
          desabilitado={!!c.bloqueado}
        />
        {c.bloqueado ? <Text style={estilos.aviso}>Cliente bloqueado: não é possível lançar pedido.</Text> : null}
      </View>

      <Secao titulo="Pedidos" detalhe={pedidos?.length ? `${pedidos.length} recentes` : undefined} />
      {pedidos && pedidos.length ? (
        pedidos.map((p) => {
          const selo = seloDoPedido(p.origem, p.status);
          return (
            <Card
              key={`${p.origem}-${p.chave}`}
              style={estilos.item}
              onPress={() => router.push(p.origem === 'sap' ? `/pedido-sap/${p.chave}` : `/pedido/${p.chave}`)}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={estilos.itemTitulo}>
                  {p.origem === 'sap' ? `Pedido ${p.chave}` : `Pedido ${p.codigo ?? 'novo'}`}
                  {p.origem === 'sap' && p.codigo ? <Text style={estilos.itemSuave}>  · app {p.codigo}</Text> : null}
                </Text>
                <Text style={estilos.itemSuave}>{dataBR(p.data)}{p.valor !== null ? ` · ${moeda(p.valor)}` : ''}</Text>
                {p.erro ? <Text style={estilos.erro} numberOfLines={3}>{p.erro}</Text> : null}
              </View>
              {selo ? <Selo texto={selo.texto} tom={selo.tom} /> : null}
            </Card>
          );
        })
      ) : (
        <Vazio icone="receipt-outline" texto="Nenhum pedido nos últimos 90 dias." />
      )}

      <Secao titulo="Títulos" detalhe={titulos?.length ? `${titulos.length}` : undefined} />
      {titulos && titulos.length ? (
        titulos.map((t) => (
          <Card key={`${t.nfe}-${t.parcela}`} style={estilos.item} onPress={() => router.push({ pathname: '/titulo', params: { cod, nfe: t.nfe, parcela: t.parcela } })}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={estilos.itemTitulo}>NF {t.nfe || '—'}{t.parcela ? ` · parcela ${t.parcela}` : ''}</Text>
              <Text style={estilos.itemSuave}>
                {t.status === 'Compensado' ? `Pago em ${dataBR(t.dt_compensacao)}` : `Vence em ${dataBR(t.vencimento)}`} · {moeda(t.valor)}
              </Text>
            </View>
            {t.status ? <Selo texto={t.status} tom={t.status === 'Atrasado' ? 'erro' : t.status === 'Compensado' ? 'ok' : 'aviso'} /> : null}
          </Card>
        ))
      ) : (
        <Vazio icone="cash-outline" texto="Nenhum título para este cliente." />
      )}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  nome: { fontSize: 20, fontWeight: '800', color: cor.texto },
  razao: { fontSize: 14, color: cor.textoSuave, marginTop: 2 },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: espaco.sm },
  ligar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: espaco.md, paddingVertical: 8 },
  ligarTexto: { color: cor.primaria, fontSize: 16, fontWeight: '700' },
  aviso: { color: cor.erro, fontSize: 13, textAlign: 'center', marginTop: espaco.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  itemTitulo: { fontSize: 15, fontWeight: '700', color: cor.texto },
  itemSuave: { fontSize: 13, color: cor.textoSuave, fontWeight: '400' },
  erro: { fontSize: 12, color: cor.erro },
});
