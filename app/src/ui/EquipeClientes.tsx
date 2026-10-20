import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '@/lib/api';
import { useEquipe } from '@/lib/equipe';
import { dataBR } from '@/lib/format';
import { Card, Vazio } from './components';
import { cor, espaco, raio } from './theme';

interface Carteira { cod_vendedor: string; nome: string | null; clientes: number }
interface ClienteEquipe {
  cod_cliente: string; nome: string | null; cidade: string | null; uf: string | null;
  ultima_compra: string | null; vencido: number; pagamento_antecipado: boolean;
}
interface Pagina { pagina: number; por_pagina: number; total: number; itens: ClienteEquipe[] }

/**
 * Clientes do supervisor/gerente (modo equipe, nenhum vendedor escolhido). Começa pelos vendedores, com o tamanho
 * da carteira de cada um; tocar abre só os clientes dele (carrega pouco de cada vez).
 */
export function EquipeClientes() {
  const [escolhido, setEscolhido] = useState<Carteira | null>(null);
  return escolhido ? <ClientesDoVendedor vendedor={escolhido} aoVoltar={() => setEscolhido(null)} /> : <ListaVendedores aoEscolher={setEscolhido} />;
}

function ListaVendedores({ aoEscolher }: { aoEscolher: (c: Carteira) => void }) {
  const [lista, setLista] = useState<Carteira[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    let vivo = true;
    api<Carteira[]>('/equipe/carteiras', { semVendedor: true, timeoutMs: 30_000 })
      .then((l) => vivo && setLista(l))
      .catch((e) => vivo && (setErro(e instanceof Error ? e.message : 'Não foi possível carregar os vendedores.'), setLista([])));
    return () => {
      vivo = false;
    };
  }, []);

  const q = busca.trim().toLowerCase();
  const filtrada = (lista ?? []).filter((v) => !q || (v.nome ?? '').toLowerCase().includes(q) || v.cod_vendedor.includes(q));

  return (
    <View style={{ flex: 1 }}>
      <View style={estilos.buscaBox}>
        <Ionicons name="search" size={18} color={cor.textoSuave} />
        <TextInput style={estilos.busca} value={busca} onChangeText={setBusca} placeholder="Buscar vendedor" placeholderTextColor={cor.textoSuave} autoCorrect={false} clearButtonMode="while-editing" />
      </View>
      {erro ? <Text style={estilos.erro}>{erro}</Text> : null}
      {lista === null ? <ActivityIndicator color={cor.primaria} style={{ marginTop: espaco.xl }} /> : null}
      <FlatList
        data={filtrada}
        keyExtractor={(v) => v.cod_vendedor}
        contentContainerStyle={{ padding: espaco.lg, paddingTop: 0 }}
        ListEmptyComponent={lista === null ? null : <Vazio icone="people-outline" texto="Nenhum vendedor encontrado." />}
        renderItem={({ item }) => (
          <Card style={estilos.card} onPress={() => aoEscolher(item)}>
            <View style={{ flex: 1 }}>
              <Text style={estilos.nome} numberOfLines={1}>{item.nome ?? item.cod_vendedor}</Text>
              <Text style={estilos.detalhe}>{item.clientes.toLocaleString('pt-BR')} cliente{item.clientes === 1 ? '' : 's'} na carteira</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={cor.textoSuave} />
          </Card>
        )}
      />
    </View>
  );
}

function ClientesDoVendedor({ vendedor, aoVoltar }: { vendedor: Carteira; aoVoltar: () => void }) {
  const router = useRouter();
  const { entrarComo } = useEquipe();
  const [busca, setBusca] = useState('');
  const [itens, setItens] = useState<ClienteEquipe[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const pedido = useRef(0);

  const carregar = useCallback(
    async (termo: string, pg: number) => {
      const meu = ++pedido.current;
      setCarregando(true);
      try {
        const r = await api<Pagina>(`/equipe/clientes?vendedor=${encodeURIComponent(vendedor.cod_vendedor)}&busca=${encodeURIComponent(termo)}&pagina=${pg}`, { semVendedor: true, timeoutMs: 45_000 });
        if (meu !== pedido.current) return; // chegou a resposta de uma busca mais antiga
        // sem repetir cliente que já está na lista
        setItens((antes) => {
          if (pg === 1) return r.itens;
          const ja = new Set(antes.map((c) => c.cod_cliente));
          return [...antes, ...r.itens.filter((c) => !ja.has(c.cod_cliente))];
        });
        setTotal(r.total);
        setPagina(pg);
        setErro(null);
      } catch (e) {
        if (meu === pedido.current) setErro(e instanceof Error ? e.message : 'Não foi possível carregar os clientes.');
      } finally {
        if (meu === pedido.current) setCarregando(false);
      }
    },
    [vendedor.cod_vendedor],
  );

  // busca com um respiro de 400 ms para não chamar o servidor a cada letra
  useEffect(() => {
    const t = setTimeout(() => void carregar(busca, 1), busca ? 400 : 0);
    return () => clearTimeout(t);
  }, [busca, carregar]);

  return (
    <View style={{ flex: 1 }}>
      <Pressable onPress={aoVoltar} style={estilos.voltar} hitSlop={8}>
        <Ionicons name="chevron-back" size={20} color={cor.primaria} />
        <Text style={estilos.voltarTexto} numberOfLines={1}>{vendedor.nome ?? vendedor.cod_vendedor}</Text>
        <Text style={estilos.voltarDetalhe}>{total ? `${total.toLocaleString('pt-BR')} clientes` : ''}</Text>
      </Pressable>
      <View style={estilos.buscaBox}>
        <Ionicons name="search" size={18} color={cor.textoSuave} />
        <TextInput style={estilos.busca} value={busca} onChangeText={setBusca} placeholder="Buscar por nome, código ou CNPJ" placeholderTextColor={cor.textoSuave} autoCorrect={false} clearButtonMode="while-editing" />
      </View>
      {erro ? <Text style={estilos.erro}>{erro}</Text> : null}
      <FlatList
        data={itens}
        keyExtractor={(c, i) => `${c.cod_cliente}-${i}`}
        contentContainerStyle={{ padding: espaco.lg, paddingTop: 0 }}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (!carregando && itens.length < total) void carregar(busca, pagina + 1);
        }}
        ListHeaderComponent={
          <Text style={estilos.dica} onPress={() => entrarComo({ cod_vendedor: vendedor.cod_vendedor, nome: vendedor.nome })}>
            Abrir o app de {vendedor.nome ?? vendedor.cod_vendedor}
          </Text>
        }
        ListFooterComponent={carregando ? <ActivityIndicator color={cor.primaria} style={{ marginVertical: espaco.lg }} /> : null}
        ListEmptyComponent={carregando ? null : <Vazio icone="people-outline" texto={busca ? 'Nenhum cliente encontrado para essa busca.' : 'Este vendedor não tem clientes na carteira.'} />}
        renderItem={({ item }) => (
          <Card style={estilos.card} onPress={() => router.push(`/cliente-equipe/${item.cod_cliente}`)}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={estilos.nome} numberOfLines={1}>{item.nome ?? item.cod_cliente}</Text>
              <Text style={estilos.detalhe} numberOfLines={1}>
                {item.cidade ? `${item.cidade}${item.uf ? `/${item.uf}` : ''} · ` : ''}{item.ultima_compra ? `comprou em ${dataBR(item.ultima_compra)}` : 'sem compras'}
              </Text>
            </View>
            {item.vencido > 0 ? <Ionicons name="alert-circle" size={20} color={cor.erro} /> : null}
            <Ionicons name="chevron-forward" size={20} color={cor.textoSuave} />
          </Card>
        )}
      />
    </View>
  );
}

const estilos = StyleSheet.create({
  buscaBox: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: espaco.lg, marginTop: espaco.sm, paddingHorizontal: espaco.md, backgroundColor: cor.card, borderRadius: raio, borderWidth: 1, borderColor: cor.borda },
  busca: { flex: 1, paddingVertical: 12, fontSize: 16, color: cor.texto },
  card: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, marginBottom: espaco.sm },
  nome: { fontSize: 15, fontWeight: '700', color: cor.texto },
  detalhe: { fontSize: 13, color: cor.textoSuave },
  erro: { color: cor.erro, fontSize: 13, marginHorizontal: espaco.lg, marginBottom: espaco.sm },
  voltar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: espaco.lg, paddingTop: espaco.md },
  voltarTexto: { fontSize: 16, fontWeight: '800', color: cor.primaria, flexShrink: 1 },
  voltarDetalhe: { fontSize: 13, color: cor.textoSuave, marginLeft: 6 },
  dica: { fontSize: 13, color: cor.primaria, fontWeight: '700', marginBottom: espaco.sm },
});
