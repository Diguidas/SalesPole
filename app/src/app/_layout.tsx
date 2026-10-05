import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SessionProvider, useSession } from '@/lib/auth';
import { Carregando } from '@/ui/components';

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Navegador />
    </SessionProvider>
  );
}

/**
 * O navegador da raiz PRECISA estar montado desde o primeiro render (exigencia do
 * expo-router); trocar por uma tela de loading aqui causa
 * "Can't perform a React state update on a component that hasn't mounted yet".
 * Por isso o loading e uma camada POR CIMA do Stack, que continua montado por baixo.
 */
function Navegador() {
  const { session, carregando } = useSession();

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="entrar" />
        </Stack.Protected>
      </Stack>
      {carregando ? (
        <View style={StyleSheet.absoluteFill}>
          <Carregando />
        </View>
      ) : null}
    </View>
  );
}
