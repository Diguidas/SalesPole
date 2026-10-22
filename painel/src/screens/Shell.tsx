import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Settings, UsersRound, ListOrdered, House, PlusCircle, Activity, Users, MapPinCheck, SlidersHorizontal, CalendarDays, ChevronDown, Gift, LogOut, ChartColumnBig, Moon, Sun, Package, Percent, Star, Tag, Landmark, Boxes, ScrollText, Megaphone, FilePlus2, Clock, UserX } from 'lucide-react';
import { ehHierarquia, tem, useAuth } from '../auth';
import { GavetasProvider } from '../gavetas';
import { useTema } from '../tema';
import logo from '../assets/salespole.png';
import poletech from '../assets/poletech.png';

interface Tela { tipo: 'tela'; para: string; rotulo: string; icone: ReactNode; soAdmin?: boolean }
interface Modulo { tipo: 'modulo'; rotulo: string; icone: ReactNode; itens: Array<{ para: string; rotulo: string; icone: ReactNode; soAdmin?: boolean; soAprovador?: boolean }> }

/**
 * Menu do topo. "tela" vai direto para a pagina; "modulo" abre uma lista suspensa com as telas dele.
 * Para uma tela nova, acrescente o item aqui e a rota em App.tsx.
 */
const MENU: Array<Tela | Modulo> = [
  { tipo: 'tela', para: '/', rotulo: 'Início', icone: <House size={16} strokeWidth={2} /> },
  {
    tipo: 'modulo',
    rotulo: 'Comercial',
    icone: <Package size={16} strokeWidth={2} />,
    itens: [
      { para: '/pedidos', rotulo: 'Pedidos', icone: <ListOrdered size={16} strokeWidth={2} /> },
      { para: '/bonificacoes', rotulo: 'Bonificações (aprovação)', icone: <Gift size={16} strokeWidth={2} /> },
      { para: '/clientes', rotulo: 'Clientes', icone: <UsersRound size={16} strokeWidth={2} /> },
      { para: '/solicitacoes', rotulo: 'Solicitações de cliente', icone: <FilePlus2 size={16} strokeWidth={2} /> },
      { para: '/produtos', rotulo: 'Produtos', icone: <Boxes size={16} strokeWidth={2} /> },
      { para: '/listas-preco', rotulo: 'Listas de preço', icone: <ScrollText size={16} strokeWidth={2} /> },
      { para: '/visitas', rotulo: 'Visitas', icone: <MapPinCheck size={16} strokeWidth={2} /> },
      { para: '/bi', rotulo: 'BI', icone: <ChartColumnBig size={16} strokeWidth={2} /> },
    ],
  },
  {
    tipo: 'modulo',
    rotulo: 'Cadastros',
    icone: <Tag size={16} strokeWidth={2} />,
    itens: [
      { para: '/cadastros/tipos-bonificacao', rotulo: 'Tipos de bonificação', icone: <Gift size={16} strokeWidth={2} /> },
      { para: '/cadastros/centros-custo', rotulo: 'Centros de custo', icone: <Landmark size={16} strokeWidth={2} /> },
      { para: '/cadastros/destaques', rotulo: 'Destaques e lançamentos', icone: <Star size={16} strokeWidth={2} /> },
      { para: '/desconto', rotulo: 'Desconto', icone: <Percent size={16} strokeWidth={2} /> },
      { para: '/cadastros/avisos', rotulo: 'Avisos para vendedores', icone: <Megaphone size={16} strokeWidth={2} /> },
      { para: '/cadastros/perguntas-visita', rotulo: 'Perguntas da visita', icone: <MapPinCheck size={16} strokeWidth={2} /> },
      { para: '/cadastros/prazos', rotulo: 'Prazos de pagamento', icone: <Clock size={16} strokeWidth={2} /> },
      { para: '/cadastros/motivos-exclusao', rotulo: 'Motivos de exclusão', icone: <UserX size={16} strokeWidth={2} /> },
      { para: '/cadastros/bi', rotulo: 'Painéis de BI', icone: <ChartColumnBig size={16} strokeWidth={2} /> },
      { para: '/cadastros/feriados', rotulo: 'Feriados', icone: <CalendarDays size={16} strokeWidth={2} /> },
    ],
  },
  {
    tipo: 'modulo',
    rotulo: 'Sistema',
    icone: <Settings size={16} strokeWidth={2} />,
    itens: [
      { para: '/monitor', rotulo: 'Monitor', icone: <Activity size={16} strokeWidth={2} /> },
      { para: '/usuarios', rotulo: 'Usuários e vendedores', icone: <Users size={16} strokeWidth={2} />, soAdmin: true },
      { para: '/parametros', rotulo: 'Parâmetros', icone: <SlidersHorizontal size={16} strokeWidth={2} /> },
    ],
  },
];

/** Unico item do cadastro que supervisor/gerente podem ter (permissao "comunicados"). */
const ITEM_COMUNICADOS = '/cadastros/avisos';

const iniciais = (nome: string) => {
  const p = nome.trim().split(/[\s@.]+/).filter(Boolean);
  return ((p[0]?.[0] ?? '?') + (p.length > 1 ? p[1][0] : '')).toUpperCase();
};

export function Shell() {
  const { usuario, sair } = useAuth();
  const [tema, alternarTema] = useTema();
  const { pathname } = useLocation();
  const [aberto, setAberto] = useState<string | null>(null); // modulo com a lista aberta (ou 'usuario')
  const barra = useRef<HTMLElement>(null);

  // fecha a lista ao trocar de tela, ao clicar fora e com Esc
  useEffect(() => setAberto(null), [pathname]);
  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (barra.current && !barra.current.contains(e.target as Node)) setAberto(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(null);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, []);

  const hierarquia = ehHierarquia(usuario?.papel);
  const visivel = (i: { para: string; soAdmin?: boolean }) => (!i.soAdmin || usuario?.papel === 'admin') && (!hierarquia || i.para !== ITEM_COMUNICADOS || tem(usuario, 'comunicados'));
  // supervisor/gerente: so o comercial; do cadastro, apenas os comunicados (se o admin liberar). Sistema fica escondido.
  const itensDoModulo = (m: Modulo) => (hierarquia && m.rotulo === 'Cadastros' ? m.itens.filter((i) => i.para === ITEM_COMUNICADOS && tem(usuario, 'comunicados')) : m.itens).filter(visivel);
  const moduloVisivel = (m: Tela | Modulo) => m.tipo === 'tela' ? !m.soAdmin || usuario?.papel === 'admin' : !(hierarquia && m.rotulo === 'Sistema') && itensDoModulo(m).length > 0;
  const nome = usuario?.nome || usuario?.email || '';
  const rotuloPapel = { admin: 'Administrador', aprovador: 'Aprovador', consulta: 'Consulta', supervisor: 'Supervisor', gerente: 'Gerente', gerente_geral: 'Gerente geral' }[usuario?.papel ?? 'consulta'];

  return (
    <GavetasProvider>
    <div className="shell">
      <header className="topbar" ref={barra}>
        <img className="topbar-logo" src={logo} alt="SalesPole" />
        <span className="topbar-nome">Painel</span>
        <nav className="topnav">
          {MENU.filter(moduloVisivel).map((m) =>
            m.tipo === 'tela' ? (
              <NavLink key={m.para} to={m.para} end={m.para === '/'} className={({ isActive }) => `tab${isActive ? ' ativo' : ''}`}>
                {m.icone}
                {m.rotulo}
              </NavLink>
            ) : (
              <div className="modulo" key={m.rotulo}>
                <button
                  className={`tab${m.itens.some((i) => pathname.startsWith(i.para)) ? ' ativo' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={aberto === m.rotulo}
                  onClick={() => setAberto(aberto === m.rotulo ? null : m.rotulo)}
                >
                  {m.icone}
                  {m.rotulo}
                  <ChevronDown size={14} strokeWidth={2} className={aberto === m.rotulo ? 'gira' : ''} />
                </button>
                {aberto === m.rotulo && (
                  <div className="lista" role="menu">
                    {itensDoModulo(m).map((i) => (
                      <NavLink key={i.para} to={i.para} role="menuitem" className={({ isActive }) => `opcao${isActive ? ' ativo' : ''}`}>
                        {i.icone}
                        {i.rotulo}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
        </nav>
        {tem(usuario, 'criar_pedido') && (
          <Link to="/novo-pedido" className="btn-destaque" title="Criar um pedido em nome de um vendedor">
            <PlusCircle size={16} strokeWidth={2.2} />
            <span>Novo pedido</span>
          </Link>
        )}
        <div className="usuario">
          <button className="avatar-btn" onClick={() => setAberto(aberto === 'usuario' ? null : 'usuario')} aria-haspopup="menu" aria-expanded={aberto === 'usuario'}>
            <span className="avatar">{iniciais(nome)}</span>
            <span className="usuario-txt">
              <strong>{nome}</strong>
              <small>{rotuloPapel}</small>
            </span>
            <ChevronDown size={14} strokeWidth={2} />
          </button>
          {aberto === 'usuario' && (
            <div className="lista direita" role="menu">
              <div className="opcao-info" title={usuario?.email}>{usuario?.email}</div>
              <button className="opcao" role="menuitem" onClick={alternarTema}>
                {tema === 'escuro' ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
                {tema === 'escuro' ? 'Tema claro' : 'Tema escuro'}
              </button>
              <button className="opcao perigo" role="menuitem" onClick={sair}>
                <LogOut size={14} strokeWidth={2} />
                Sair
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="rodape">
        <small>desenvolvido por</small>
        <img src={poletech} alt="Pole Tech" />
      </footer>
    </div>
    </GavetasProvider>
  );
}
