import { useState } from 'react';
import {
  Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { configuracaoOk } from '@/lib/config';
import { useSession } from '@/lib/auth';
import { Botao } from '@/ui/components';
import { cor, espaco, raio } from '@/ui/theme';

export default function Entrar() {
  const { entrar } = useSession();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (!email.trim() || !senha) {
      setErro('Informe e-mail e senha.');
      return;
    }
    setErro(null);
    setEnviando(true);
    const msg = await entrar(email, senha);
    setEnviando(false);
    if (msg) setErro(msg);
    // sucesso: o Stack.Protected leva para o app sozinho
  }

  return (
    <SafeAreaView style={estilos.tela}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
          <Image source={require('../../assets/logo.png')} style={estilos.logo} resizeMode="contain" />
          <Text style={estilos.titulo}>Sales Pole</Text>
          <Text style={estilos.subtitulo}>Pole Alimentos · Força de Vendas</Text>

          {!configuracaoOk ? (
            <Text style={estilos.aviso}>
              Configuração ausente: defina EXPO_PUBLIC_API_URL, EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no
              arquivo .env do app e reinicie com `npx expo start --clear`.
            </Text>
          ) : null}

          <View style={estilos.form}>
            <Text style={estilos.rotulo}>E-mail</Text>
            <TextInput
              style={estilos.campo}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="seu.email@exemplo.com"
              placeholderTextColor={cor.textoSuave}
              editable={!enviando}
            />
            <Text style={estilos.rotulo}>Senha</Text>
            <TextInput
              style={estilos.campo}
              value={senha}
              onChangeText={setSenha}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              placeholder="••••••••"
              placeholderTextColor={cor.textoSuave}
              editable={!enviando}
              onSubmitEditing={enviar}
            />
            {erro ? <Text style={estilos.erro}>{erro}</Text> : null}
            <View style={{ marginTop: espaco.lg }}>
              <Botao titulo="Entrar" onPress={enviar} carregando={enviando} desabilitado={!configuracaoOk} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.fundo },
  conteudo: { flexGrow: 1, justifyContent: 'center', padding: espaco.xl },
  logo: { width: 110, height: 110, alignSelf: 'center' },
  titulo: { fontSize: 28, fontWeight: '800', color: cor.texto, textAlign: 'center', marginTop: espaco.md },
  subtitulo: { fontSize: 14, color: cor.textoSuave, textAlign: 'center', marginBottom: espaco.xl },
  aviso: {
    backgroundColor: cor.avisoFundo, color: cor.aviso, padding: espaco.md, borderRadius: raio,
    fontSize: 13, marginBottom: espaco.lg,
  },
  form: { gap: 6 },
  rotulo: { fontSize: 13, fontWeight: '600', color: cor.textoSuave, marginTop: espaco.sm },
  campo: {
    backgroundColor: cor.card, borderRadius: raio, borderWidth: 1, borderColor: cor.borda,
    paddingHorizontal: espaco.lg, paddingVertical: 13, fontSize: 16, color: cor.texto,
  },
  erro: { color: cor.erro, fontSize: 14, marginTop: espaco.sm },
});
