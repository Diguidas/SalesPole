import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { useEquipe } from '@/lib/equipe';
import { apenasDigitos, ClienteSupervisor, OpcoesFormulario, opcoesSupervisor } from '@/lib/solicitacoes';
import { Botao, Carregando, Segmentado } from './components';
import { Aviso, Bloco, Campo, CampoLista } from './Formulario';
import { espaco } from './theme';

export type TipoAlteracao = 'aumento_limite' | 'alteracao_pagamento' | 'agrupamento';

const TIPOS_ALTERACAO: Array<{ valor: TipoAlteracao; texto: string }> = [
  { valor: 'aumento_limite', texto: 'Limite' },
  { valor: 'alteracao_pagamento', texto: 'Pagamento' },
  { valor: 'agrupamento', texto: 'Agrupar' },
];

/**
 * Formulario do supervisor para um cliente ja cadastrado: alteracao (aumento de limite, condicao de pagamento, agrupamento)
 * ou exclusao. O supervisor e o e-mail vem do login; o cliente e conferido na equipe pelo servidor.
 */
export function SolicitacaoSupervisor({ modo }: { modo: 'alteracao' | 'exclusao' }) {
  const router = useRouter();
  const { session } = useSession();
  const { eu } = useEquipe();
  const [opcoes, setOpcoes] = useState<OpcoesFormulario | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoAlteracao>('aumento_limite');
  const [codigo, setCodigo] = useState('');
  const [cliente, setCliente] = useState<ClienteSupervisor | null>(null);
  const [erroCliente, setErroCliente] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [v, setV] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    opcoesSupervisor().then(setOpcoes).catch((e) => setErroCarga(e instanceof Error ? e.message : 'Não foi possível carregar o formulário.'));
  }, []);

  const set = (k: string) => (t: string) => setV((x) => ({ ...x, [k]: t }));

  async function buscar() {
    const cod = apenasDigitos(codigo).replace(/^0+/, '');
    setCliente(null);
    setErroCliente(null);
    if (!cod) return;
    setBuscando(true);
    try {
      setCliente(await api<ClienteSupervisor>(`/equipe/solicitacoes/cliente/${cod}`, { semVendedor: true }));
    } catch (e) {
      setErroCliente(e instanceof Error ? e.message : 'Cliente não encontrado.');
    } finally {
      setBuscando(false);
    }
  }

  async function enviar() {
    if (!cliente) return Alert.alert('Cliente', 'Informe o código de um cliente da sua equipe.');
    setEnviando(true);
    try {
      const corpo = { ...v, cod_cliente: cliente.cod_cliente };
      await api(`/equipe/solicitacoes/${modo === 'exclusao' ? 'exclusao' : tipo}`, { method: 'POST', body: corpo, semVendedor: true });
      Alert.alert('Solicitação enviada', 'A solicitação foi registrada.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      Alert.alert('Não foi possível enviar', e instanceof Error ? e.message : 'Tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  if (erroCarga) return <View style={{ padding: espaco.lg }}><Aviso tom="erro" texto={erroCarga} /></View>;
  if (!opcoes) return <Carregando />;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: espaco.lg, gap: espaco.lg, paddingBottom: espaco.xl * 3 }} keyboardShouldPersistTaps="handled">
        <Bloco titulo="Supervisor">
          <Campo rotulo="Supervisor" valor={eu?.nome ?? '—'} onChange={() => undefined} editavel={false} />
          <Campo rotulo="E-mail do supervisor" valor={session?.user.email ?? '—'} onChange={() => undefined} editavel={false} />
        </Bloco>

        {modo === 'alteracao' ? (
          <Bloco titulo="Tipo de solicitação">
            <Segmentado opcoes={TIPOS_ALTERACAO} valor={tipo} onChange={(t) => { setTipo(t); setV({}); }} />
          </Bloco>
        ) : null}

        <Bloco titulo="Cliente">
          <Campo rotulo="Código do cliente" obrigatorio teclado="number-pad" valor={codigo} onChange={(t) => setCodigo(apenasDigitos(t))} onBlur={buscar} maxLength={10} />
          {buscando ? <Aviso tom="ok" texto="Buscando o cliente…" /> : null}
          {erroCliente ? <Aviso tom="erro" texto={erroCliente} /> : null}
          {cliente ? (
            <>
              <Campo rotulo="Razão social" valor={cliente.razao_social ?? '—'} onChange={() => undefined} editavel={false} />
              {modo === 'exclusao' ? (
                <>
                  <Campo rotulo="Nome fantasia" valor={cliente.nome_fantasia ?? '—'} onChange={() => undefined} editavel={false} />
                  <Campo rotulo="Rota" valor={cliente.rota ?? '—'} onChange={() => undefined} editavel={false} />
                  <Campo rotulo="Vendedor" valor={cliente.vendedor ?? '—'} onChange={() => undefined} editavel={false} />
                </>
              ) : null}
            </>
          ) : null}
        </Bloco>

        <Bloco titulo={modo === 'exclusao' ? 'Exclusão' : 'Dados da alteração'}>
          {modo === 'exclusao' ? (
            <CampoLista rotulo="Motivo de exclusão" obrigatorio valor={v.motivo} opcoes={opcoes.motivos_exclusao.map((m) => ({ valor: m, texto: m }))} onChange={set('motivo')} />
          ) : null}
          {modo === 'alteracao' && tipo === 'agrupamento' ? (
            <Campo rotulo="Conta de crédito (conta pai)" obrigatorio teclado="number-pad" valor={v.conta_credito ?? ''} onChange={(t) => set('conta_credito')(apenasDigitos(t))} maxLength={10} />
          ) : null}
          {modo === 'alteracao' && tipo === 'aumento_limite' ? (
            <Campo rotulo="Limite de crédito (R$)" obrigatorio teclado="decimal-pad" valor={v.limite_credito ?? ''} onChange={set('limite_credito')} maxLength={15} />
          ) : null}
          {modo === 'alteracao' && tipo === 'alteracao_pagamento' ? (
            <CampoLista rotulo="Condição de pagamento SAP" obrigatorio valor={v.condicao_pagamento} opcoes={opcoes.prazos.map((p) => ({ valor: p.descricao, texto: p.descricao }))} onChange={set('condicao_pagamento')} />
          ) : null}
          <Campo rotulo="Observação/resumo" obrigatorio={modo === 'alteracao'} multilinha valor={v.observacao ?? ''} onChange={set('observacao')} maxLength={500} />
        </Bloco>

        <Botao titulo="Enviar solicitação" tom={modo === 'exclusao' ? 'perigo' : 'primario'} onPress={enviar} carregando={enviando} desabilitado={!cliente} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
