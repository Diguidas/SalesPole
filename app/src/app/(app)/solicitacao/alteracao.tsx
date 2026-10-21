import { Stack } from 'expo-router';
import { SolicitacaoSupervisor } from '@/ui/SolicitacaoSupervisor';

export default function Alteracao() {
  return (
    <>
      <Stack.Screen options={{ title: 'Alteração de cliente' }} />
      <SolicitacaoSupervisor modo="alteracao" />
    </>
  );
}
