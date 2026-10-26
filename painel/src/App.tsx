import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ehHierarquia, ehVendedor, tem, useAuth } from './auth';
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
import { DescontoScreen } from './screens/DescontoScreen';
import { NovaSolicitacaoScreen } from './screens/NovaSolicitacaoScreen';
import { SolicitacaoDetalheScreen, SolicitacoesScreen } from './screens/SolicitacoesScreen';
import { ClienteDetalheScreen } from './screens/ClienteDetalheScreen';
import { BiScreen } from './screens/BiScreen';
import { HojeScreen } from './screens/HojeScreen';
import { CarteiraParadaScreen } from './screens/CarteiraParadaScreen';
import { TitulosScreen } from './screens/TitulosScreen';

export function App() {
  const { carregando, sessao, usuario, erro } = useAuth();

  if (carregando) return <div className="vazio">Carregando…</div>;
  if (!sessao || !usuario) return <LoginScreen erro={erro} />;
  // supervisor/gerente nao entram em cadastros nem sistema (o menu ja esconde; aqui barra o endereco digitado)
  const semAdmin = ehHierarquia(usuario.papel) || ehVendedor(usuario.papel);
  // vendedor: so as telas de quem vende; gestao (bonificacoes, listas de preco, visitas, desconto) fica de fora
  const gestao = (tela: ReactElement) => (ehVendedor(usuario.papel) ? <Navigate to="/" replace /> : tela);

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={ehVendedor(usuario.papel) ? <HojeScreen /> : <InicioScreen />} />
        <Route path="hoje" element={<HojeScreen />} />
        <Route path="carteira-parada" element={<CarteiraParadaScreen />} />
        <Route path="titulos" element={<TitulosScreen />} />
        <Route path="novo-pedido" element={<NovoPedidoScreen />} />
        <Route path="pedidos" element={<PedidosScreen />} />
        <Route path="clientes" element={<ClientesScreen />} />
        <Route path="clientes/:cod" element={<ClienteDetalheScreen />} />
        <Route path="desconto" element={gestao(<DescontoScreen />)} />
        <Route path="cadastros/incentivos" element={<Navigate to="/desconto?aba=incentivo" replace />} />
        <Route path="solicitacoes" element={<SolicitacoesScreen />} />
        <Route path="solicitacoes/nova" element={<NovaSolicitacaoScreen />} />
        <Route path="solicitacoes/:id" element={<SolicitacaoDetalheScreen />} />
        <Route path="produtos" element={<ProdutosScreen />} />
        <Route path="listas-preco" element={gestao(<ListasPrecoScreen />)} />
        <Route path="bonificacoes" element={gestao(<BonificacoesScreen />)} />
        <Route path="pedidos-antecipados" element={gestao(<Navigate to="/pedidos?antecipado=1&pendentes=1" replace />)} />
        <Route path="cadastros/:nome" element={(semAdmin && !tem(usuario, 'comunicados')) || ehVendedor(usuario.papel) ? <Navigate to="/" replace /> : <CadastroScreen />} />
        <Route path="visitas" element={gestao(<VisitasScreen />)} />
        <Route path="bi" element={<BiScreen />} />
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
