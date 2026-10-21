import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { api } from '@/lib/api';
import { tirarFoto } from '@/lib/camera';
import { obterPosicao } from '@/lib/localizacao';
import {
  apenasDigitos, consultarCep, consultarCnpj, DadosVendedor, enviarComprovante, mascaraCep, mascaraDocumento, mascaraTelefone,
  OpcoesFormulario, opcoesVendedor,
} from '@/lib/solicitacoes';
import { Botao, Carregando, Segmentado } from '@/ui/components';
import { Aviso, Bloco, Campo, CampoLista, SimNao, TextoRotulo } from '@/ui/Formulario';
import { espaco } from '@/ui/theme';

type V = Record<string, string>;
const DIAS = [
  { valor: '1', texto: 'Seg' }, { valor: '2', texto: 'Ter' }, { valor: '3', texto: 'Qua' }, { valor: '4', texto: 'Qui' }, { valor: '5', texto: 'Sex' },
];
/** Valor = descricao (e o que vai na solicitacao); sem repetir o mesmo texto. */
const paraDropdown = (l: Array<{ codigo: string; descricao: string }>) => [...new Map(l.map((o) => [o.descricao, { valor: o.descricao, texto: o.descricao }])).values()];

/** Solicitacao de cadastro de cliente (vendedor). Por enquanto so fica guardada; a integracao vem depois. */
export default function CadastroCliente() {
  const router = useRouter();
  const [opcoes, setOpcoes] = useState<OpcoesFormulario | null>(null);
  const [vendedor, setVendedor] = useState<DadosVendedor | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);

  const [pessoa, setPessoa] = useState<'J' | 'F'>('J');
  const [v, setV] = useState<V>({ dia_visita: '1' });
  const [sn, setSn] = useState<Record<string, boolean | null>>({ proprietario_compra: null, em_rede: null, e_filial: null, e_substituicao: null });
  const [comprovante, setComprovante] = useState<string | null>(null);
  const [consultando, setConsultando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    Promise.all([opcoesVendedor(), api<DadosVendedor>('/solicitacoes/vendedor')])
      .then(([o, d]) => {
        setOpcoes(o);
        setVendedor(d);
        setV((x) => ({ ...x, rota: d.rota ?? '' }));
      })
      .catch((e) => setErroCarga(e instanceof Error ? e.message : 'Não foi possível carregar o formulário.'));
  }, []);

  const set = (k: string) => (t: string) => setV((x) => ({ ...x, [k]: t }));
  const setSim = (k: string) => (b: boolean) => setSn((x) => ({ ...x, [k]: b }));

  async function buscarCep() {
    if (apenasDigitos(v.cep ?? '').length !== 8) return;
    setConsultando('Buscando o CEP…');
    const r = await consultarCep(v.cep);
    setConsultando(null);
    if (!r) return setAviso('CEP não encontrado: preencha o endereço manualmente.');
    setAviso(null);
    setV((x) => ({ ...x, endereco: r.endereco || x.endereco || '', bairro: r.bairro || x.bairro || '', municipio: r.municipio, uf: r.uf }));
  }

  async function buscarCnpj() {
    if (pessoa !== 'J' || apenasDigitos(v.documento ?? '').length !== 14) return;
    setConsultando('Consultando o CNPJ…');
    const r = await consultarCnpj(v.documento);
    setConsultando(null);
    if (!r) return setAviso('CNPJ não encontrado na consulta: preencha os dados manualmente.');
    setAviso('Dados preenchidos pela Receita Federal. A inscrição estadual precisa ser informada.');
    setV((x) => ({
      ...x,
      razao_social: r.razao_social, nome_fantasia: r.nome_fantasia || r.razao_social, cep: mascaraCep(r.cep), endereco: r.endereco, numero: r.numero,
      complemento: r.complemento, bairro: r.bairro, municipio: r.municipio, uf: r.uf,
    }));
  }

  async function usarLocalizacao() {
    try {
      setConsultando('Buscando o GPS…');
      const p = await obterPosicao();
      setV((x) => ({ ...x, latitude: p.lat.toFixed(6), longitude: p.lng.toFixed(6) }));
    } catch (e) {
      Alert.alert('Localização', e instanceof Error ? e.message : 'Não foi possível obter a localização.');
    } finally {
      setConsultando(null);
    }
  }

  async function fotografar() {
    try {
      const f = await tirarFoto();
      if (f) setComprovante(f.uri);
    } catch (e) {
      Alert.alert('Câmera', e instanceof Error ? e.message : 'Não foi possível abrir a câmera.');
    }
  }

  async function enviar() {
    const faltando = (Object.keys(sn) as string[]).filter((k) => sn[k] === null);
    if (faltando.length) return Alert.alert('Falta responder', 'Responda todas as perguntas de Sim ou Não.');
    setEnviando(true);
    try {
      const corpo = {
        ...v,
        tipo_pessoa: pessoa,
        ...sn,
        dia_visita: Number(v.dia_visita),
        ordem_visita: Number(v.ordem_visita),
        tem_comprovante: pessoa === 'F' && !!comprovante,
        vendedor_nome: undefined,
      };
      const r = await api<{ id: string; upload: { caminho: string; token: string } | null }>('/solicitacoes/cadastro-cliente', { method: 'POST', body: corpo });
      if (r.upload && comprovante) {
        try {
          await enviarComprovante(r.upload, comprovante);
        } catch (e) {
          Alert.alert('Solicitação enviada', `${e instanceof Error ? e.message : 'Falha no comprovante'}. Avise o escritório para reenviar o comprovante.`);
          return router.back();
        }
      }
      Alert.alert('Solicitação enviada', 'O cadastro do cliente foi registrado.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      Alert.alert('Não foi possível enviar', e instanceof Error ? e.message : 'Tente novamente.');
    } finally {
      setEnviando(false);
    }
  }

  // so os tipos de estabelecimento que ja existem no canal escolhido
  const canalCodigo = opcoes?.canais.find((c) => c.descricao === v.canal)?.codigo;
  const tiposDoCanal = (opcoes?.tipos_estabelecimento ?? []).filter((t) => !canalCodigo || t.canais.includes(canalCodigo));

  if (erroCarga) return <View style={{ padding: espaco.lg }}><Aviso tom="erro" texto={erroCarga} /></View>;
  if (!opcoes || !vendedor) return <Carregando />;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Cadastro de cliente' }} />
      <ScrollView contentContainerStyle={{ padding: espaco.lg, gap: espaco.lg, paddingBottom: espaco.xl * 3 }} keyboardShouldPersistTaps="handled">
        {consultando ? <Aviso tom="ok" texto={consultando} /> : null}
        {aviso ? <Aviso texto={aviso} /> : null}

        <Bloco titulo="Informações do negócio">
          <Segmentado<'J' | 'F'> opcoes={[{ valor: 'J', texto: 'Pessoa jurídica' }, { valor: 'F', texto: 'Pessoa física' }]} valor={pessoa} onChange={(p) => { setPessoa(p); setV((x) => ({ ...x, documento: '' })); }} />
          <Campo
            rotulo={pessoa === 'J' ? 'CNPJ' : 'CPF'} obrigatorio teclado="number-pad" valor={v.documento ?? ''}
            onChange={(t) => set('documento')(mascaraDocumento(t, pessoa))} onBlur={buscarCnpj}
          />
          {pessoa === 'J' ? (
            <>
              <Campo rotulo="Inscrição estadual" obrigatorio valor={v.inscricao_estadual ?? ''} onChange={set('inscricao_estadual')} maxLength={20} />
              <Campo rotulo="Razão social" obrigatorio valor={v.razao_social ?? ''} onChange={set('razao_social')} maxLength={120} />
              <Campo rotulo="Nome fantasia" obrigatorio valor={v.nome_fantasia ?? ''} onChange={set('nome_fantasia')} maxLength={120} />
            </>
          ) : (
            <>
              <Campo rotulo="Nome" obrigatorio valor={v.nome ?? ''} onChange={set('nome')} maxLength={60} />
              <Campo rotulo="Sobrenome" obrigatorio valor={v.sobrenome ?? ''} onChange={set('sobrenome')} maxLength={60} />
            </>
          )}
        </Bloco>

        <Bloco titulo="Informações de endereço">
          <Campo rotulo="CEP" obrigatorio teclado="number-pad" valor={v.cep ?? ''} onChange={(t) => set('cep')(mascaraCep(t))} onBlur={buscarCep} />
          <Campo rotulo="Endereço" obrigatorio valor={v.endereco ?? ''} onChange={set('endereco')} maxLength={120} />
          <Campo rotulo="Nº" obrigatorio valor={v.numero ?? ''} onChange={set('numero')} maxLength={10} />
          <Campo rotulo="Complemento" valor={v.complemento ?? ''} onChange={set('complemento')} maxLength={60} />
          <Campo rotulo="Bairro" obrigatorio valor={v.bairro ?? ''} onChange={set('bairro')} maxLength={60} />
          <Campo rotulo="Município" obrigatorio valor={v.municipio ?? ''} onChange={set('municipio')} maxLength={60} />
          <Campo rotulo="UF" obrigatorio valor={v.uf ?? ''} onChange={(t) => set('uf')(t.toUpperCase())} maxLength={2} />
          <Campo rotulo="Distrito" valor={v.distrito ?? ''} onChange={set('distrito')} maxLength={60} />
          <Campo rotulo="Ponto de referência" valor={v.ponto_referencia ?? ''} onChange={set('ponto_referencia')} maxLength={120} />
          <Campo rotulo="Latitude" teclado="numbers-and-punctuation" valor={v.latitude ?? ''} onChange={set('latitude')} />
          <Campo rotulo="Longitude" teclado="numbers-and-punctuation" valor={v.longitude ?? ''} onChange={set('longitude')} />
          <Botao titulo="Usar minha localização atual" tom="neutro" onPress={usarLocalizacao} />
          {pessoa === 'F' ? (
            <TextoRotulo rotulo="Comprovante de endereço *">
              <Botao titulo={comprovante ? 'Foto anexada · tirar outra' : 'Fotografar comprovante'} tom={comprovante ? 'neutro' : 'primario'} onPress={fotografar} />
            </TextoRotulo>
          ) : null}
        </Bloco>

        <Bloco titulo="Informações de contato">
          <Campo rotulo="E-mail prioritário (portal de compras, NF, XML)" obrigatorio teclado="email-address" valor={v.email ?? ''} onChange={set('email')} maxLength={120} />
          <Campo rotulo="Telefone fixo" teclado="phone-pad" valor={v.telefone_fixo ?? ''} onChange={(t) => set('telefone_fixo')(mascaraTelefone(t))} />
        </Bloco>

        <Bloco titulo="Informações do proprietário">
          <Campo rotulo="Nome do proprietário" obrigatorio valor={v.proprietario_nome ?? ''} onChange={set('proprietario_nome')} maxLength={80} />
          <Campo rotulo="Telefone celular" obrigatorio teclado="phone-pad" valor={v.proprietario_celular ?? ''} onChange={(t) => set('proprietario_celular')(mascaraTelefone(t))} />
          <Campo rotulo="E-mail" teclado="email-address" valor={v.proprietario_email ?? ''} onChange={set('proprietario_email')} maxLength={120} />
          <SimNao rotulo="O proprietário é responsável pelas compras?" valor={sn.proprietario_compra} onChange={setSim('proprietario_compra')} />
          {sn.proprietario_compra === false ? (
            <>
              <Campo rotulo="Nome do responsável pelas compras" obrigatorio valor={v.comprador_nome ?? ''} onChange={set('comprador_nome')} maxLength={80} />
              <Campo rotulo="Celular do responsável" obrigatorio teclado="phone-pad" valor={v.comprador_celular ?? ''} onChange={(t) => set('comprador_celular')(mascaraTelefone(t))} />
              <Campo rotulo="E-mail do responsável" obrigatorio teclado="email-address" valor={v.comprador_email ?? ''} onChange={set('comprador_email')} maxLength={120} />
            </>
          ) : null}
        </Bloco>

        <Bloco titulo="Informações extras">
          <SimNao rotulo="Participa de alguma rede cadastrada na Pole?" valor={sn.em_rede} onChange={setSim('em_rede')} />
          {sn.em_rede ? (
            <CampoLista rotulo="Qual rede?" obrigatorio valor={v.rede} opcoes={paraDropdown(opcoes.redes)} onChange={set('rede')} />
          ) : null}
          <SimNao rotulo="É filial de algum cliente já cadastrado?" valor={sn.e_filial} onChange={setSim('e_filial')} />
          {sn.e_filial ? <Campo rotulo="Código do cliente pai" obrigatorio teclado="number-pad" valor={v.cod_cliente_pai ?? ''} onChange={(t) => set('cod_cliente_pai')(apenasDigitos(t))} maxLength={10} /> : null}
          <SimNao rotulo="Será substituição de algum cliente já cadastrado?" valor={sn.e_substituicao} onChange={setSim('e_substituicao')} />
          {sn.e_substituicao ? <Campo rotulo="Código do cliente substituído" obrigatorio teclado="number-pad" valor={v.cod_cliente_substituido ?? ''} onChange={(t) => set('cod_cliente_substituido')(apenasDigitos(t))} maxLength={10} /> : null}

          <CampoLista rotulo="Organização de venda" obrigatorio valor={v.org_vendas} opcoes={opcoes.org_vendas.map((o) => ({ valor: o.codigo, texto: o.descricao }))} onChange={set('org_vendas')} />
          <Campo rotulo="Escritório" valor={vendedor.escritorio ?? '—'} onChange={() => undefined} editavel={false} />
          <Campo rotulo="Equipe" valor={vendedor.equipe ?? '—'} onChange={() => undefined} editavel={false} />
          <Campo rotulo="Rota" valor={vendedor.rota ?? '—'} onChange={() => undefined} editavel={false} />
          <TextoRotulo rotulo="Dia de visita *">
            <Segmentado opcoes={DIAS} valor={v.dia_visita} onChange={set('dia_visita')} />
          </TextoRotulo>
          <Campo rotulo="Ordem da visita" obrigatorio teclado="number-pad" valor={v.ordem_visita ?? ''} onChange={(t) => set('ordem_visita')(apenasDigitos(t))} maxLength={3} />
          <CampoLista rotulo="Prazo" obrigatorio valor={v.prazo} opcoes={paraDropdown(opcoes.prazos)} onChange={set('prazo')} dica={opcoes.prazos.length ? 'Selecione' : 'Nenhum prazo cadastrado no painel'} />
          <CampoLista rotulo="Canal de vendas" obrigatorio valor={v.canal} opcoes={paraDropdown(opcoes.canais)} onChange={(c) => setV((x) => ({ ...x, canal: c, tipo_estabelecimento: '' }))} />
          <CampoLista rotulo="Tipo de estabelecimento" obrigatorio valor={v.tipo_estabelecimento} opcoes={paraDropdown(tiposDoCanal)} onChange={set('tipo_estabelecimento')} desabilitado={!v.canal} dica={v.canal ? 'Selecione' : 'Escolha o canal primeiro'} />
          <Campo rotulo="Vendedor" valor={vendedor.nome ?? vendedor.cod_vendedor} onChange={() => undefined} editavel={false} />
          <Campo rotulo="Observação" multilinha valor={v.observacao ?? ''} onChange={set('observacao')} maxLength={500} />
        </Bloco>

        <Botao titulo="Enviar solicitação" onPress={enviar} carregando={enviando} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
