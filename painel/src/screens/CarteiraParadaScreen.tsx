import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { api } from '../api';
import { dataBR, exportarCsv, moeda0, NOME_DIA_CURTO, useVendedorAlvo } from './vendedor';

interface Parado {
  cod_cliente: string; nome: string | null; cidade: string | null; uf: string | null; bloqueado: boolean;
  ultima_compra: string | null; dias: number | null; vencido: number; dias_visita: number[];
}
interface Resposta { dias: number; faixas: number[]; total: number; nunca_compraram: number; itens: Parado[] }

/** Clientes da carteira que nao compram ha X dias: quem vale a pena procurar. */
export function CarteiraParadaScreen() {
  const alvo = useVendedorAlvo();
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!alvo.pronto) return;
    setDados(null);
    setErro(null);
    api<Resposta>(`/meu/carteira-parada?dias=${dias}${alvo.qs ? `&${alvo.qs}` : ''}`).then(setDados).catch((e) => setErro((e as Error).message));
  }, [dias, alvo.pronto, alvo.qs]);

  const exportar = () => dados && exportarCsv('carteira-parada', ['Código', 'Cliente', 'Cidade', 'UF', 'Última compra', 'Dias sem comprar', 'Vencido (R$)', 'Dias de visita', 'Bloqueado'],
    dados.itens.map((c) => [c.cod_cliente, c.nome, c.cidade, c.uf, dataBR(c.ultima_compra), c.dias ?? 'nunca comprou', c.vencido, c.dias_visita.map((d) => NOME_DIA_CURTO[d]).join('/'), c.bloqueado ? 'sim' : 'não']));

  return (
    <>
      <h1>Carteira parada</h1>
      <p className="sub">Clientes da sua carteira sem compra há mais de {dias} dias (pedidos recusados não contam). Quem nunca comprou aparece primeiro.</p>

      <div className="chips">
        {(dados?.faixas ?? [15, 30, 60, 90, 180]).map((d) => <button key={d} className={`chip${dias === d ? ' ativo' : ''}`} onClick={() => setDias(d)}>{d} dias</button>)}
        {!alvo.proprio && (
          <select className="entrada" style={{ minWidth: 220 }} value={alvo.vendedor} onChange={(e) => alvo.setVendedor(e.target.value)}>
            <option value="">Escolha o vendedor…</option>
            {alvo.opcoes.map((v) => <option key={v.cod_vendedor} value={v.cod_vendedor}>{v.nome ?? v.cod_vendedor}</option>)}
          </select>
        )}
        {dados && dados.itens.length > 0 && <button className="chip" onClick={exportar} title="Abrir no Excel"><Download size={13} style={{ verticalAlign: -2 }} /> Exportar</button>}
      </div>

      {erro && <p className="erro-msg">{erro}</p>}
      {!alvo.pronto && <div className="vazio">Escolha um vendedor para ver a carteira dele.</div>}
      {alvo.pronto && !dados && !erro && <div className="vazio">Carregando…</div>}
      {dados && dados.itens.length === 0 && <div className="vazio">Nenhum cliente parado há mais de {dias} dias. 🎉</div>}

      {dados && dados.itens.length > 0 && (
        <>
          <div className="cartoes">
            <div className="cartao"><div className="suave">Clientes parados</div><div className="numero">{dados.total}</div></div>
            <div className="cartao"><div className="suave">Nunca compraram</div><div className="numero">{dados.nunca_compraram}</div></div>
            <div className="cartao"><div className="suave">Com título vencido</div><div className="numero">{dados.itens.filter((c) => c.vencido > 0).length}</div></div>
          </div>
          <table>
            <thead><tr><th>Cliente</th><th>Cidade</th><th>Última compra</th><th style={{ textAlign: 'right' }}>Dias parado</th><th>Visita</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {dados.itens.map((c) => (
                <tr key={c.cod_cliente}>
                  <td><Link to={`/clientes/${c.cod_cliente}`}>{c.nome ?? c.cod_cliente}</Link><div className="suave">{c.cod_cliente}</div></td>
                  <td>{c.cidade ? `${c.cidade}${c.uf ? `/${c.uf}` : ''}` : '—'}</td>
                  <td>{c.ultima_compra ? dataBR(c.ultima_compra) : 'nunca comprou'}</td>
                  <td style={{ textAlign: 'right' }}>{c.dias ?? '—'}</td>
                  <td>{c.dias_visita.map((d) => NOME_DIA_CURTO[d]).join(' · ') || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {c.bloqueado && <span className="selo erro">Bloqueado</span>}
                      {c.vencido > 0 && <span className="selo erro">Vencido {moeda0(c.vencido)}</span>}
                      {!c.bloqueado && c.vencido === 0 && <span className="selo ok">Regular</span>}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {!c.bloqueado && <Link className="btn" to={`/novo-pedido?${alvo.proprio ? '' : `vendedor=${alvo.vendedor}&`}cliente=${c.cod_cliente}`}>Novo pedido</Link>}
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
