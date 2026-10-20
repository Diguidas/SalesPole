import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
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
        <Route path="cadastros/:nome" element={<CadastroScreen />} />
        <Route path="visitas" element={<VisitasScreen />} />
        <Route path="indicadores" element={<Navigate to="/" replace />} />
        <Route path="vendedores" element={<Navigate to="/usuarios" replace />} />
        <Route path="monitor" element={<MonitorScreen />} />
        <Route path="usuarios" element={<UsuariosScreen />} />
        <Route path="parametros" element={<ParametrosScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
