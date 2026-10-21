import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';
import { useEquipe } from '@/lib/equipe';
import { LinhaToque } from '@/ui/Formulario';
import { espaco } from '@/ui/theme';

/** Menu das solicitacoes: vendedor cadastra cliente; supervisor/gerente alteram e excluem. */
export default function Solicitacoes() {
  const router = useRouter();
  const { usaEquipe, semVendedor } = useEquipe();
  return (
    <ScrollView contentContainerStyle={{ padding: espaco.lg, gap: espaco.md }}>
      {!semVendedor ? (
        <LinhaToque titulo="Cadastro de cliente" detalhe="Pedir o cadastro de um novo cliente" onPress={() => router.push('/solicitacao/cliente')} />
      ) : null}
      {usaEquipe ? (
        <>
          <LinhaToque titulo="Alteração de cliente" detalhe="Aumento de limite, condição de pagamento ou agrupamento" onPress={() => router.push('/solicitacao/alteracao')} />
          <LinhaToque titulo="Exclusão de cliente" detalhe="Pedir a exclusão de um cliente" onPress={() => router.push('/solicitacao/exclusao')} />
        </>
      ) : null}
    </ScrollView>
  );
}
