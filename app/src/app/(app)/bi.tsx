import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { api } from '@/lib/api';
import { Carregando } from '@/ui/components';
import { cor, espaco, estilosTema } from '@/ui/theme';

interface PainelBi { id: string; nome: string; url: string }

/** Power BI dentro do app (os links vem do painel: Cadastros → Painéis de BI, "Só no app" ou "Painel e app"). */
export default function Bi() {
  const [lista, setLista] = useState<PainelBi[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atual, setAtual] = useState<string | null>(null);
  const [carregandoPagina, setCarregandoPagina] = useState(true);

  useEffect(() => {
    api<PainelBi[]>('/sync/bi', { semVendedor: true })
      .then((r) => { setLista(r); setAtual(r[0]?.id ?? null); })
      .catch((e) => { setErro((e as Error).message); setLista([]); });
  }, []);

  if (lista === null) return <Carregando />;
  const painel = lista.find((p) => p.id === atual);

  return (
    <View style={{ flex: 1 }}>
      {erro ? <Text style={estilos.aviso}>{erro}</Text> : null}
      {!painel && !erro ? <Text style={estilos.aviso}>Nenhum painel de BI disponível.</Text> : null}
      {lista.length > 1 && (
        <ScrollView horizontal style={estilos.abas} contentContainerStyle={{ gap: espaco.sm, padding: espaco.sm }}>
          {lista.map((p) => (
            <Pressable key={p.id} onPress={() => { setCarregandoPagina(true); setAtual(p.id); }} style={[estilos.chip, p.id === atual && estilos.chipAtivo]}>
              <Text style={[estilos.chipTexto, p.id === atual && { color: cor.textoSobrePrimaria }]}>{p.nome}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {painel && (
        <>
          <Pressable onPress={() => void Linking.openURL(painel.url)} style={estilos.abrir}>
            <Ionicons name="open-outline" size={14} color={cor.primaria} />
            <Text style={estilos.abrirTexto}>Abrir no navegador</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <WebView
              key={painel.id}
              source={{ uri: painel.url }}
              onLoadEnd={() => setCarregandoPagina(false)}
              javaScriptEnabled
              domStorageEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              startInLoadingState={false}
              allowsFullscreenVideo
              style={{ flex: 1, backgroundColor: cor.fundo }}
            />
            {carregandoPagina && <View style={estilos.carregando}><ActivityIndicator color={cor.primaria} /></View>}
          </View>
        </>
      )}
    </View>
  );
}

const estilos = estilosTema(() => StyleSheet.create({
  aviso: { padding: espaco.lg, color: cor.textoSuave, textAlign: 'center' },
  abas: { flexGrow: 0, backgroundColor: cor.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: cor.borda },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: cor.neutroFundo },
  chipAtivo: { backgroundColor: cor.primaria },
  chipTexto: { color: cor.texto, fontWeight: '600' },
  abrir: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-end', paddingHorizontal: espaco.md, paddingVertical: 6, backgroundColor: cor.card },
  abrirTexto: { color: cor.primaria, fontWeight: '600', fontSize: 13 },
  carregando: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
}));
