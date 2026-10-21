import { Stack } from 'expo-router';
import { SolicitacaoSupervisor } from '@/ui/SolicitacaoSupervisor';

export default function Exclusao() {
  return (
    <>
      <Stack.Screen options={{ title: 'Exclusão de cliente' }} />
      <SolicitacaoSupervisor modo="exclusao" />
    </>
  );
}
