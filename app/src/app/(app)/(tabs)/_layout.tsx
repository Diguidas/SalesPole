import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useEquipe } from '@/lib/equipe';
import { BotaoSync } from '@/ui/BotaoSync';
import { ChipEquipe } from '@/ui/ChipEquipe';
import { cor } from '@/ui/theme';

type Icone = keyof typeof Ionicons.glyphMap;

const aba = (titulo: string, ativo: Icone, inativo: Icone) => ({
  title: titulo,
  tabBarIcon: ({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) => (
    <Ionicons name={focused ? ativo : inativo} size={size} color={color} />
  ),
});

export default function TabsLayout() {
  const { usaEquipe, semVendedor, abrirSeletor } = useEquipe();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: cor.primaria },
        headerTintColor: cor.textoSobrePrimaria,
        headerTitleStyle: { fontWeight: '700' },
        headerRight: () => (semVendedor ? null : (<><ChipEquipe /><BotaoSync /></>)),
        tabBarActiveTintColor: cor.primaria,
        tabBarInactiveTintColor: cor.textoSuave,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: cor.fundo },
      }}
    >
      <Tabs.Screen name="index" options={{ ...aba('Início', 'home', 'home-outline'), headerTitle: 'Hoje' }} />
      {/* supervisor/gerente sem vendedor escolhido: Inicio, Clientes e Analise mostram a equipe; Novo pedido vira o botao Vendedor */}
      <Tabs.Screen name="clientes" options={aba('Clientes', 'people', 'people-outline')} />
      <Tabs.Screen name="novo-pedido" options={{ ...aba('Novo pedido', 'add-circle', 'add-circle-outline'), href: semVendedor ? null : undefined }} />
      <Tabs.Screen
        name="vendedor"
        options={{ ...aba('Vendedor', 'swap-horizontal', 'swap-horizontal-outline'), href: usaEquipe && semVendedor ? undefined : null }}
        listeners={{ tabPress: (e) => { e.preventDefault(); abrirSeletor(); } }}
      />
      <Tabs.Screen name="pedidos" options={{ ...aba('Análise', 'bar-chart', 'bar-chart-outline'), headerTitle: 'Análise' }} />
      <Tabs.Screen name="perfil" options={aba('Perfil', 'person', 'person-outline')} />
    </Tabs>
  );
}
