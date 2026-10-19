import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDados, useTickAoFocar } from '@/db/hooks';
import { obterOuCriarRascunho } from '@/db/pedidos';
import { historicoMensalDoCliente, noRoteiroDoDia, obterCliente, titulosDoCliente, ultimaCompraDoCliente } from '@/db/queries';
import { visitaDoClienteNoDia } from '@/db/visitas';
import { dataBR, diaSemanaHoje, documento, hojeISO, linkMapa, moeda, NOME_DIA_CURTO, textoFormas, textoPrazo } from '@/lib/format';
import { Botao, Card, Carregando, Linha, Secao, Selo, Vazio } from '@/ui/components';
import { LineChart } from '@/ui/LineChart';
import { cor, espaco } from '@/ui/theme';

const NOME_MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const valorCurto = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(Math.round(v)));

export default function ClienteDetalhe() {
  const { cod } = useLocalSearchParams<{ cod: string }>();
  const dbLocal = useSQLiteContext();
  const router = useRouter();
  const tick = useTickAoFocar();
  const { dados: c, carregando } = useDados((db) => obterCliente(db, cod), [cod]);
  const hoje = hojeISO();
  const { dados: visita } = useDados((db) => visitaDoClienteNoDia(db, cod, hoje), [cod, hoje, tick]);
  const { dados: noRoteiro } = useDados((db) => noRoteiroDoDia(db, cod, diaSemanaHoje()), [cod]);
  const { dados: ultima } = useDados((db) => ultimaCompraDoCliente(db, cod), [cod, tick]);
  const { dados: historico } = useDados((db) => historicoMensalDoCliente(db, cod, hoje), [cod, hoje, tick]);
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
  const mapa = linkMapa(c.latitude, c.longitude);
  const atrasados = (titulos ?? []).filter((t) => t.status === 'Atrasado');
  const valorAtrasado = atrasados.reduce((s, t) => s + (t.valor ?? 0), 0);
  const abertos = (titulos ?? []).filter((t) => t.status !== 'Atrasado' && t.status !== 'Compensado');
  const valorAberto = abertos.reduce((s, t) => s + (t.valor ?? 0), 0);
  const proximoVenc = abertos.map((t) => t.vencimento).filter((v): v is string => !!v).sort()[0];

  return (
    <ScrollView contentContainerStyle={estilos.conteudo}>
      <Stack.Screen options={{ title: c.nome_fantasia || c.razao_social || 'Cliente' }} />

      <Card>
        <Text style={estilos.nome}>{c.nome_fantasia || c.razao_social}</Text>
        {c.nome_fantasia && c.razao_social ? <Text style={estilos.razao}>{c.razao_social}</Text> : null}
        <View style={estilos.selos}>
          {c.bloqueado ? <Selo texto="Bloqueado" tom="erro" /> : null}
          {c.pagamento_antecipado ? <Selo texto="Pagamento antecipado" tom="aviso" /> : null}
          {c.classe_risco?.descricao ? <Selo texto={`Risco: ${c.classe_risco.descricao}`} /> : null}
          {c.agrupado ? <Selo texto="Limite agrupado" /> : null}
        </View>
        <View style={{ marginTop: espaco.md }}>
          <Linha rotulo="Código" valor={c.cod_cliente} />
          <Linha rotulo="CNPJ/CPF" valor={documento(c.cnpjcpf)} />
          <Linha rotulo="Endereço" valor={endereco} />
          <Linha rotulo="Entregas" valor={c.dias_entrega.length ? c.dias_entrega.map((d) => NOME_DIA_CURTO[d]).join(', ') : null} />
          <Linha rotulo="Prazo de pagamento" valor={textoPrazo(c.areas)} />
          <Linha rotulo="Forma de pagamento" valor={textoFormas(c.formas_pagamento)} />
          <Linha rotulo="Pedido mínimo" valor={c.pedido_minimo !== null ? moeda(c.pedido_minimo) : null} />
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
        {mapa ? (
          <Pressable style={estilos.ligar} onPress={() => Linking.openURL(mapa).catch(() => Alert.alert('Não foi possível abrir o mapa.'))}>
            <Ionicons name="navigate" size={18} color={cor.primaria} />
            <Text style={estilos.ligarTexto}>Abrir no mapa</Text>
          </Pressable>
        ) : null}
      </Card>

      {noRoteiro || visita ? (
        <Card
          style={{ marginTop: espaco.md, flexDirection: 'row', alignItems: 'center', gap: espaco.md }}
          onPress={() => router.push(`/visita/${cod}`)}
        >
          <Ionicons name={visita?.status === 'concluida' ? 'checkmark-done-circle' : 'location'} size={26} color={visita?.status === 'concluida' ? cor.ok : cor.primaria} />
          <View style={{ flex: 1 }}>
            <Text style={estilos.itemTitulo}>
              {!visita ? 'Iniciar visita' : visita.status === 'em_andamento' ? 'Visita em andamento' : visita.resultado === 'vendeu' ? 'Visita concluída · vendeu' : 'Visita concluída · sem venda'}
            </Text>
            <Text style={estilos.itemSuave}>
              {!visita ? 'Check-in com GPS e foto da fachada' : visita.status === 'em_andamento' ? 'Toque para pedir, fotografar e concluir' : 'Toque para ver os detalhes'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={cor.textoSuave} />
        </Card>
      ) : null}

      <Card style={{ marginTop: espaco.md }}>
        <Linha rotulo="Limite total" valor={moeda(c.limite_total)} />
        <Linha rotulo="Limite disponível" valor={c.pagamento_antecipado ? 'Sem crédito (pagamento antecipado)' : moeda(c.limite_disponivel)} />
      </Card>

      <Card style={{ ...estilos.obs, backgroundColor: atrasados.length ? cor.erroFundo : abertos.length ? cor.avisoFundo : cor.okFundo }}>
        <Ionicons
          name={atrasados.length ? 'alert-circle' : abertos.length ? 'time' : 'checkmark-circle'}
          size={22}
          color={atrasados.length ? cor.erro : abertos.length ? cor.aviso : cor.ok}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={estilos.obsTitulo}>Observação</Text>
          {atrasados.length ? (
            <Text style={[estilos.obsTexto, { color: cor.erro }]}>
              {atrasados.length} fatura{atrasados.length === 1 ? '' : 's'} em atraso · {moeda(valorAtrasado)}
            </Text>
          ) : null}
          {abertos.length ? (
            <Text style={estilos.obsTexto}>
              {abertos.length} fatura{abertos.length === 1 ? '' : 's'} em aberto · {moeda(valorAberto)}
              {proximoVenc ? ` · próx. venc. ${dataBR(proximoVenc)}` : ''}
            </Text>
          ) : null}
          {!atrasados.length && !abertos.length ? <Text style={estilos.obsTexto}>Sem faturas em atraso ou em aberto.</Text> : null}
        </View>
      </Card>

      <View style={estilos.botoes}>
        <View style={{ flex: 1 }}>
          <Botao titulo="Pedidos" tom="neutro" onPress={() => router.push({ pathname: '/cliente-pedidos', params: { cod } })} />
        </View>
        <View style={{ flex: 1 }}>
          <Botao titulo="Produtos" tom="neutro" onPress={() => router.push({ pathname: '/cliente-produtos', params: { cod } })} />
        </View>
      </View>
      <View style={{ marginTop: espaco.sm }}>
        <Botao titulo="Novo pedido para este cliente" onPress={novoPedido} desabilitado={!!c.bloqueado} />
        {c.bloqueado ? <Text style={estilos.aviso}>Cliente bloqueado: não é possível lançar pedido.</Text> : null}
      </View>

      <Secao titulo="Última compra" />
      <Card>
        {ultima ? (
          <>
            {ultima.valor !== null ? <Text style={estilos.ultimaValor}>{moeda(ultima.valor)}</Text> : <Text style={estilos.ultimaValor}>{dataBR(ultima.data)}</Text>}
            <Text style={estilos.itemSuave}>{ultima.ordem ? `${dataBR(ultima.data)} · pedido ${ultima.ordem}` : 'compra mais antiga (só a data)'}</Text>
          </>
        ) : (
          <Text style={estilos.itemSuave}>Nenhuma compra encontrada neste aparelho.</Text>
        )}
      </Card>

      <Secao titulo="Valor comprado por mês" />
      <Card>
        <LineChart pontos={(historico ?? []).map((m) => ({ rotulo: NOME_MES_CURTO[Number(m.mes.slice(5)) - 1], valor: m.total }))} formato={valorCurto} />
      </Card>

      <Secao titulo="Pedidos por mês" />
      <Card>
        <LineChart pontos={(historico ?? []).map((m) => ({ rotulo: NOME_MES_CURTO[Number(m.mes.slice(5)) - 1], valor: m.pedidos }))} formato={(v) => String(v)} />
      </Card>
      <Text style={estilos.nota}>Vendas dos últimos 12 meses (pedidos recusados não entram). Se estiver tudo zerado, o histórico ainda não foi carregado para este vendedor.</Text>
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
  obs: { flexDirection: 'row', alignItems: 'flex-start', gap: espaco.md, marginTop: espaco.md },
  obsTitulo: { fontSize: 13, fontWeight: '700', color: cor.texto },
  obsTexto: { fontSize: 14, color: cor.texto },
  botoes: { flexDirection: 'row', gap: espaco.sm, marginTop: espaco.lg },
  ultimaValor: { fontSize: 24, fontWeight: '800', color: cor.texto },
  nota: { fontSize: 12, color: cor.textoSuave, textAlign: 'center', marginTop: espaco.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  itemTitulo: { fontSize: 15, fontWeight: '700', color: cor.texto },
  itemSuave: { fontSize: 13, color: cor.textoSuave, fontWeight: '400' },
  erro: { fontSize: 12, color: cor.erro },
});
