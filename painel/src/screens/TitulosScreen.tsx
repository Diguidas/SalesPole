import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { api } from '../api';
import { dataBR, exportarCsv, moeda, useVendedorAlvo } from './vendedor';

interface Titulo {
  cod_cliente: string; nome: string | null; nfe: string; parcela: string; status: string | null; valor: number;
  vencimento: string | null; dt_compensacao: string | null; danfe_url: string | null; boleto_url: string | null; dias_atraso: number;
}
interface Resposta { filtro: string; total: number; valor_atrasado: number; valor_em_aberto: number; clientes_atrasados: number; itens: Titulo[] }

const FILTROS = [{ v: 'abertos', r: 'Em aberto' }, { v: 'atrasados', r: 'Atrasados' }, { v: 'todos', r: 'Últimos 90 dias' }];

/** Titulos de todos os clientes da carteira, para cobrar quem esta atrasado e avisar quem esta para vencer. */
export function TitulosScreen() {
  const alvo = useVendedorAlvo();
  const [filtro, setFiltro] = useState('abertos');
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!alvo.pronto) return;
    setDados(null);
    setErro(null);
    api<Resposta>(`/meu/titulos?filtro=${filtro}${alvo.qs ? `&${alvo.qs}` : ''}`).then(setDados).catch((e) => setErro((e as Error).message));
  }, [filtro, alvo.pronto, alvo.qs]);

  const exportar = () => dados && exportarCsv('titulos', ['Código', 'Cliente', 'NF', 'Parcela', 'Vencimento', 'Valor', 'Status', 'Dias de atraso', 'Compensado em'],
    dados.itens.map((t) => [t.cod_cliente, t.nome, t.nfe, t.parcela, dataBR(t.vencimento), t.valor, t.status, t.dias_atraso || '', dataBR(t.dt_compensacao)]));

  return (
    <>
      <h1>Títulos da carteira</h1>
      <p className="sub">Boletos e notas dos seus clientes. Os atrasados vêm primeiro; o boleto e o DANFE abrem em uma nova aba.</p>

      <div className="chips">
        {FILTROS.map((f) => <button key={f.v} className={`chip${filtro === f.v ? ' ativo' : ''}`} onClick={() => setFiltro(f.v)}>{f.r}</button>)}
        {!alvo.proprio && (
          <select className="entrada" style={{ minWidth: 220 }} value={alvo.vendedor} onChange={(e) => alvo.setVendedor(e.target.value)}>
            <option value="">Escolha o vendedor…</option>
            {alvo.opcoes.map((v) => <option key={v.cod_vendedor} value={v.cod_vendedor}>{v.nome ?? v.cod_vendedor}</option>)}
          </select>
        )}
        {dados && dados.itens.length > 0 && <button className="chip" onClick={exportar} title="Abrir no Excel"><Download size={13} style={{ verticalAlign: -2 }} /> Exportar</button>}
      </div>

      {erro && <p className="erro-msg">{erro}</p>}
      {!alvo.pronto && <div className="vazio">Escolha um vendedor para ver os títulos da carteira dele.</div>}
      {alvo.pronto && !dados && !erro && <div className="vazio">Carregando…</div>}
      {dados && dados.itens.length === 0 && <div className="vazio">Nenhum título neste filtro.</div>}

      {dados && dados.itens.length > 0 && (
        <>
          <div className="cartoes">
            <div className="cartao"><div className="suave">Atrasado</div><div className="numero" style={{ color: dados.valor_atrasado > 0 ? 'var(--c-erro)' : undefined }}>{moeda(dados.valor_atrasado)}</div><div className="suave">{dados.clientes_atrasados} cliente{dados.clientes_atrasados === 1 ? '' : 's'}</div></div>
            <div className="cartao"><div className="suave">A vencer</div><div className="numero">{moeda(dados.valor_em_aberto)}</div></div>
            <div className="cartao"><div className="suave">Títulos na lista</div><div className="numero">{dados.total}</div></div>
          </div>
          <table>
            <thead><tr><th>Cliente</th><th>NF / parcela</th><th>Vencimento</th><th style={{ textAlign: 'right' }}>Valor</th><th>Situação</th><th>Documentos</th></tr></thead>
            <tbody>
              {dados.itens.map((t) => (
                <tr key={`${t.cod_cliente}-${t.nfe}-${t.parcela}`}>
                  <td><Link to={`/clientes/${t.cod_cliente}`}>{t.nome ?? t.cod_cliente}</Link><div className="suave">{t.cod_cliente}</div></td>
                  <td>{t.nfe || '—'}{t.parcela ? <span className="suave"> · {t.parcela}</span> : null}</td>
                  <td>{dataBR(t.vencimento)}</td>
                  <td style={{ textAlign: 'right' }}>{moeda(t.valor)}</td>
                  <td>
                    {t.status === 'Atrasado' ? <span className="selo erro">Atrasado {t.dias_atraso} dia{t.dias_atraso === 1 ? '' : 's'}</span>
                      : t.status === 'Compensado' ? <span className="selo ok">Pago {dataBR(t.dt_compensacao)}</span>
                      : <span className="selo aviso">{t.status ?? 'Em aberto'}</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {t.boleto_url && <a href={t.boleto_url} target="_blank" rel="noreferrer">Boleto</a>}
                      {t.danfe_url && <a href={t.danfe_url} target="_blank" rel="noreferrer">DANFE</a>}
                      {!t.boleto_url && !t.danfe_url && <span className="suave">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
