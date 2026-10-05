import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense } from 'react';
import { migrar } from '@/db/schema';
import { SyncProvider } from '@/lib/sync-context';
import { Carregando } from '@/ui/components';
import { cor } from '@/ui/theme';

/**
 * Area logada. O banco local (SQLite) e a sincronizacao vivem AQUI, nao na raiz:
 * o navegador da raiz tem que montar na hora, e o SQLiteProvider so renderiza os
 * filhos depois que o banco abre (aqui isso e coberto pelo Suspense).
 */
export default function AppLayout() {
  return (
    <Suspense fallback={<Carregando />}>
      <SQLiteProvider databaseName="salespole.db" onInit={migrar} useSuspense>
        <SyncProvider>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: cor.primaria },
              headerTintColor: cor.textoSobrePrimaria,
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: cor.fundo },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="cliente/[cod]" options={{ title: 'Cliente' }} />
            <Stack.Screen name="pedido/[id]" options={{ title: 'Pedido' }} />
            <Stack.Screen name="pedido/produtos" options={{ title: 'Adicionar produtos' }} />
            <Stack.Screen name="pedido-sap/[ordem]" options={{ title: 'Pedido' }} />
            <Stack.Screen name="titulo" options={{ title: 'Título' }} />
          </Stack>
        </SyncProvider>
      </SQLiteProvider>
    </Suspense>
  );
}
