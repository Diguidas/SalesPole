import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { BotaoSync } from '@/ui/BotaoSync';
import { cor } from '@/ui/theme';

type Icone = keyof typeof Ionicons.glyphMap;

const aba = (titulo: string, ativo: Icone, inativo: Icone) => ({
  title: titulo,
  tabBarIcon: ({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) => (
    <Ionicons name={focused ? ativo : inativo} size={size} color={color} />
  ),
});

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: cor.primaria },
        headerTintColor: cor.textoSobrePrimaria,
        headerTitleStyle: { fontWeight: '700' },
        headerRight: () => <BotaoSync />,
        tabBarActiveTintColor: cor.primaria,
        tabBarInactiveTintColor: cor.textoSuave,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: cor.fundo },
      }}
    >
      <Tabs.Screen name="index" options={{ ...aba('Início', 'home', 'home-outline'), headerTitle: 'Hoje' }} />
      <Tabs.Screen name="clientes" options={aba('Clientes', 'people', 'people-outline')} />
      <Tabs.Screen name="novo-pedido" options={aba('Novo pedido', 'add-circle', 'add-circle-outline')} />
      <Tabs.Screen name="pedidos" options={{ ...aba('Pedidos', 'receipt', 'receipt-outline'), headerTitle: 'Pedidos e títulos' }} />
      <Tabs.Screen name="perfil" options={aba('Perfil', 'person', 'person-outline')} />
    </Tabs>
  );
}
