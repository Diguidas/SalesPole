import { useSQLiteContext } from 'expo-sqlite';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { api } from '@/lib/api';
import { useDados } from '@/db/hooks';
import { contarFila } from '@/db/queries';
import { lerMeta } from '@/db/sync';
import { useSession } from '@/lib/auth';
import { haQuanto } from '@/lib/format';
import { useTema, type Preferencia } from '@/lib/tema';
import { useSync } from '@/lib/sync-context';
import { Botao, Card, Linha } from '@/ui/components';
import { espaco } from '@/ui/theme';

const ROTULO_TEMA: Record<Preferencia, string> = { auto: 'Automático', claro: 'Claro', escuro: 'Escuro' };

interface Vendedor {
  cod: string;
  nome: string | null;
  email: string;
}

export default function Perfil() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { session, sair } = useSession();
  const { preferencia, definir } = useTema();
  const [temBi, setTemBi] = useState(false);
  useEffect(() => {
    // so mostra o botao se o painel cadastrou algum BI para o app (sem internet, fica escondido)
    api<unknown[]>('/sync/bi', { semVendedor: true, timeoutMs: 15_000 }).then((r) => setTemBi(r.length > 0)).catch(() => setTemBi(false));
  }, []);
  const { ultimoSync, sincronizar, sincronizando } = useSync();

  const { dados: vendedor } = useDados(async (d) => {
    const v = await lerMeta(d, 'vendedor');
    return v ? (JSON.parse(v) as Vendedor) : null;
  });
  const { dados: rota } = useDados((d) => lerMeta(d, 'rota'));
  const { dados: fila } = useDados(contarFila);

  async function confirmarSaida() {
    const f = await contarFila(db);
    const pendentes = f.aguardando + f.erros;
    const aviso = pendentes
      ? `Há ${pendentes} pedido(s) ainda não enviado(s) ao SAP. Eles continuam salvos neste aparelho e seguem quando você entrar de novo. Se OUTRA pessoa entrar neste aparelho antes, eles serão apagados.`
      : 'Você precisará entrar de novo para usar o app.';
    Alert.alert('Sair da conta?', aviso, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => sair() },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: espaco.lg, gap: espaco.lg }}>
      <Card>
        <Linha rotulo="Vendedor" valor={vendedor?.nome ?? '—'} />
        <Linha rotulo="Código" valor={vendedor?.cod ?? '—'} />
        <Linha rotulo="Rota" valor={rota ?? '—'} />
        <Linha rotulo="Login" valor={session?.user.email ?? '—'} />
      </Card>

      <Card>
        <Linha rotulo="Última sincronização" valor={haQuanto(ultimoSync)} />
        <Linha rotulo="Pedidos aguardando envio" valor={String(fila?.aguardando ?? 0)} />
        <Linha rotulo="Pedidos com erro" valor={String(fila?.erros ?? 0)} />
        <Linha rotulo="Versão do app" valor={Constants.expoConfig?.version ?? '—'} />
      </Card>

      <Card>
        <Linha rotulo="Tema" valor={ROTULO_TEMA[preferencia]} />
        <View style={{ flexDirection: 'row', gap: espaco.sm, marginTop: espaco.sm }}>
          {(['auto', 'claro', 'escuro'] as Preferencia[]).map((p) => (
            <View key={p} style={{ flex: 1 }}>
              <Botao titulo={ROTULO_TEMA[p]} tom={p === preferencia ? undefined : 'neutro'} onPress={() => definir(p)} />
            </View>
          ))}
        </View>
      </Card>

      <View style={{ gap: espaco.sm }}>
        {temBi && <Botao titulo="BI" tom="neutro" onPress={() => router.push('/bi')} />}
        <Botao titulo="Solicitações de cliente" tom="neutro" onPress={() => router.push('/solicitacoes')} />
        <Botao titulo="Sincronizar agora" onPress={sincronizar} carregando={sincronizando} />
        <Botao titulo="Sair" onPress={confirmarSaida} tom="neutro" />
      </View>
    </ScrollView>
  );
}
