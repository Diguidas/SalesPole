import { Navigate, Route, Routes } from 'react-router-dom';
import { ehHierarquia, tem, useAuth } from './auth';
import { Shell } from './screens/Shell';
import { LoginScreen } from './screens/LoginScreen';
import { ProdutosScreen } from './screens/ProdutosScreen';
import { ListasPrecoScreen } from './screens/ListasPrecoScreen';
import { BonificacoesScreen } from './screens/BonificacoesScreen';
import { CadastroScreen } from './screens/CadastroScreen';
import { ParametrosScreen } from './screens/ParametrosScreen';
import { VisitasScreen } from './screens/VisitasScreen';
import { UsuariosScreen } from './screens/UsuariosScreen';
import { MonitorScreen } from './screens/MonitorScreen';
import { InicioScreen } from './screens/InicioScreen';
import { NovoPedidoScreen } from './screens/NovoPedidoScreen';
import { PedidosScreen } from './screens/PedidosScreen';
import { ClientesScreen } from './screens/ClientesScreen';
import { ClienteDetalheScreen } from './screens/ClienteDetalheScreen';

export function App() {
  const { carregando, sessao, usuario, erro } = useAuth();

  if (carregando) return <div className="vazio">Carregando…</div>;
  if (!sessao || !usuario) return <LoginScreen erro={erro} />;
  // supervisor/gerente nao entram em cadastros nem sistema (o menu ja esconde; aqui barra o endereco digitado)
  const semAdmin = ehHierarquia(usuario.papel);

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<InicioScreen />} />
        <Route path="novo-pedido" element={<NovoPedidoScreen />} />
        <Route path="pedidos" element={<PedidosScreen />} />
        <Route path="clientes" element={<ClientesScreen />} />
        <Route path="clientes/:cod" element={<ClienteDetalheScreen />} />
        <Route path="produtos" element={<ProdutosScreen />} />
        <Route path="listas-preco" element={<ListasPrecoScreen />} />
        <Route path="bonificacoes" element={<BonificacoesScreen />} />
        <Route path="pedidos-antecipados" element={<Navigate to="/pedidos?antecipado=1&pendentes=1" replace />} />
        <Route path="cadastros/:nome" element={semAdmin && !tem(usuario, 'comunicados') ? <Navigate to="/" replace /> : <CadastroScreen />} />
        <Route path="visitas" element={<VisitasScreen />} />
        <Route path="indicadores" element={<Navigate to="/" replace />} />
        <Route path="vendedores" element={<Navigate to="/usuarios" replace />} />
        <Route path="monitor" element={semAdmin ? <Navigate to="/" replace /> : <MonitorScreen />} />
        <Route path="usuarios" element={semAdmin ? <Navigate to="/" replace /> : <UsuariosScreen />} />
        <Route path="parametros" element={semAdmin ? <Navigate to="/" replace /> : <ParametrosScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
