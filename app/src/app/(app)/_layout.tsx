import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense } from 'react';
import { migrar } from '@/db/schema';
import { useEquipe } from '@/lib/equipe';
import { SyncProvider } from '@/lib/sync-context';
import { AvisosPopup } from '@/ui/AvisosPopup';
import { ChipEquipe } from '@/ui/ChipEquipe';
import { Carregando } from '@/ui/components';
import { SeletorVendedor } from '@/ui/SeletorVendedor';
import { cor } from '@/ui/theme';

/**
 * Area logada. O banco local (SQLite) e a sincronizacao vivem AQUI, nao na raiz:
 * o navegador da raiz tem que montar na hora, e o SQLiteProvider so renderiza os
 * filhos depois que o banco abre (aqui isso e coberto pelo Suspense).
 */
export default function AppLayout() {
  const { carregando, vendedor, semVendedor } = useEquipe();
  // Modo equipe: cada vendedor visto tem o proprio banco local (nada se mistura com o de outro vendedor)
  const banco = vendedor ? `salespole_eq_${vendedor.cod}.db` : 'salespole.db';
  if (carregando) return <Carregando />;
  return (
    <Suspense fallback={<Carregando />}>
      <SQLiteProvider key={banco} databaseName={banco} onInit={migrar} useSuspense>
        <SyncProvider ativo={!semVendedor}>
          <AvisosPopup />
          <SeletorVendedor />
          <Stack
            screenOptions={{
              headerRight: () => <ChipEquipe />,
              headerStyle: { backgroundColor: cor.primaria },
              headerTintColor: cor.textoSobrePrimaria,
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: cor.fundo },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="cliente/[cod]" options={{ title: 'Cliente' }} />
            <Stack.Screen name="cliente-equipe/[cod]" options={{ title: 'Cliente' }} />
            <Stack.Screen name="pedido-equipe/[ordem]" options={{ title: 'Pedido' }} />
            <Stack.Screen name="titulo-equipe" options={{ title: 'Título' }} />
            <Stack.Screen name="visita/[cod]" options={{ title: 'Visita' }} />
            <Stack.Screen name="carteira-parada" options={{ title: 'Carteira parada' }} />
            <Stack.Screen name="lista-pedidos" options={{ title: 'Pedidos' }} />
            <Stack.Screen name="lista-titulos" options={{ title: 'Títulos' }} />
            <Stack.Screen name="cliente-pedidos" options={{ title: 'Pedidos' }} />
            <Stack.Screen name="cliente-produtos" options={{ title: 'Produtos' }} />
            <Stack.Screen name="pedido/[id]" options={{ title: 'Pedido' }} />
            <Stack.Screen name="pedido/produtos" options={{ title: 'Adicionar produtos' }} />
            <Stack.Screen name="pedido/produto-info" options={{ title: 'Informações do produto' }} />
            <Stack.Screen name="pedido-sap/[ordem]" options={{ title: 'Pedido' }} />
            <Stack.Screen name="titulo" options={{ title: 'Título' }} />
            <Stack.Screen name="solicitacoes" options={{ title: 'Solicitações' }} />
            <Stack.Screen name="bi" options={{ title: 'BI' }} />
            <Stack.Screen name="solicitacao/cliente" options={{ title: 'Cadastro de cliente' }} />
            <Stack.Screen name="solicitacao/alteracao" options={{ title: 'Alteração de cliente' }} />
            <Stack.Screen name="solicitacao/exclusao" options={{ title: 'Exclusão de cliente' }} />
          </Stack>
        </SyncProvider>
      </SQLiteProvider>
    </Suspense>
  );
}
