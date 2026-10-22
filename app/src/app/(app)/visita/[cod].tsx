import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useDados, useTickAoFocar } from '@/db/hooks';
import { obterOuCriarRascunho } from '@/db/pedidos';
import { noRoteiroDoDia, obterCliente } from '@/db/queries';
import {
  adicionarFoto, concluirVisita, fotosDaVisita, iniciarVisita, listaOpcoes, MAX_FOTOS_VISITA, pedidoDaVisita, perguntasDaVisita, respostasDaVisita, visitaDoClienteNoDia,
} from '@/db/visitas';
import { enviarVisitas } from '@/db/visitasPush';
import { avaliarCheckin, RAIO_VISITA_M, textoDistancia } from '@/domain/geo';
import { tirarFoto } from '@/lib/camera';
import { diaSemanaHoje, hojeISO } from '@/lib/format';
import { obterPosicao } from '@/lib/localizacao';
import { Botao, Card, Carregando, Chip, Linha, Secao, Segmentado, Selo, Vazio } from '@/ui/components';
import { cor, espaco, raio, estilosTema } from '@/ui/theme';

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * Visita ao cliente do roteiro de hoje: check-in (GPS + foto da FACHADA), pedido, check-out
 * (vendeu / nao vendeu + motivo). Tudo funciona offline; o envio ao servidor acontece quando houver rede.
 */
export default function VisitaTela() {
  const { cod } = useLocalSearchParams<{ cod: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const tick = useTickAoFocar();
  const hoje = hojeISO();

  const [ocupado, setOcupado] = useState<string | null>(null); // texto do que esta fazendo (GPS, camera, enviando...)
  const [resultado, setResultado] = useState<'vendeu' | 'nao_vendeu'>('nao_vendeu');
  const [motivo, setMotivo] = useState('');
  const [obs, setObs] = useState('');
  const [respPerg, setRespPerg] = useState<Record<string, string>>({});
  const [recarga, setRecarga] = useState(0);
  const dep = tick + recarga;

  const { dados: cliente, carregando } = useDados((d) => obterCliente(d, cod), [cod]);
  const { dados: visita } = useDados((d) => visitaDoClienteNoDia(d, cod, hoje), [cod, hoje, dep]);
  const { dados: noRoteiro } = useDados((d) => noRoteiroDoDia(d, cod, diaSemanaHoje()), [cod]);
  const { dados: perguntas } = useDados(async (d) => (cliente ? perguntasDaVisita(d, cliente) : []), [cliente?.cod_cliente, tick]);
  const { dados: fotos } = useDados(async (d) => (visita ? fotosDaVisita(d, visita.id) : []), [visita?.id, dep]);
  const { dados: pedido } = useDados(async (d) => (visita ? pedidoDaVisita(d, visita) : null), [visita?.id, visita?.checkin_em, dep]);

  const recarregar = () => setRecarga((r) => r + 1);
  /** Tenta subir o que esta pendente; sem rede nao e erro: fica para o proximo sincronismo. */
  const tentarEnviar = () => enviarVisitas(db).catch(() => undefined).finally(recarregar);

  async function iniciar() {
    if (!cliente) return;
    try {
      setOcupado('Buscando o GPS…');
      const pos = await obterPosicao();
      const av = avaliarCheckin(pos, { lat: cliente.latitude, lng: cliente.longitude });
      setOcupado(null);

      // fora do raio: so avisa (a visita e gravada marcada como "fora do local")
      if (av.foraDoRaio) {
        const seguir = await new Promise<boolean>((resolve) =>
          Alert.alert(
            'Você não está no cliente',
            `O GPS indica ${textoDistancia(av.distanciaM)} do cliente (o limite é ${RAIO_VISITA_M} m). Se iniciar assim, a visita ficará marcada como "fora do local".`,
            [
              { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Iniciar mesmo assim', onPress: () => resolve(true) },
            ],
          ),
        );
        if (!seguir) return;
      }

      setOcupado('Abrindo a câmera…');
      const foto = await tirarFoto();
      setOcupado(null);
      if (!foto) return; // cancelou: sem foto de fachada nao ha check-in

      await iniciarVisita(db, {
        cod_cliente: cod,
        data_visita: hoje,
        posicao: pos,
        cliente: { lat: cliente.latitude, lng: cliente.longitude },
        fachada: foto,
      });
      recarregar();
      void tentarEnviar();
    } catch (e) {
      Alert.alert('Não foi possível iniciar a visita', e instanceof Error ? e.message : 'Tente de novo.');
    } finally {
      setOcupado(null);
    }
  }

  async function fotografar() {
    if (!visita) return;
    try {
      const foto = await tirarFoto();
      if (!foto) return;
      await adicionarFoto(db, visita.id, foto, visita.checkin_lat !== null && visita.checkin_lng !== null ? { lat: visita.checkin_lat, lng: visita.checkin_lng } : null);
      recarregar();
      void tentarEnviar();
    } catch (e) {
      Alert.alert('Foto', e instanceof Error ? e.message : 'Não foi possível salvar a foto.');
    }
  }

  async function fazerPedido() {
    const id = await obterOuCriarRascunho(db, cod);
    router.push(`/pedido/${id}`);
  }

  async function concluir() {
    if (!visita) return;
    try {
      await concluirVisita(db, visita.id, { resultado, motivo, observacao: obs, respostas: respPerg });
      recarregar();
      void tentarEnviar();
      router.back();
    } catch (e) {
      Alert.alert('Não foi possível concluir', e instanceof Error ? e.message : 'Tente de novo.');
    }
  }

  if (carregando) return <Carregando />;
  if (!cliente) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Vazio icone="person-remove-outline" texto="Cliente não encontrado neste aparelho." />
      </View>
    );
  }

  const nome = cliente.nome_fantasia || cliente.razao_social || cliente.cod_cliente;
  const pendentesFoto = (fotos ?? []).filter((f) => !f.enviada).length;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Visita' }} />
      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={estilos.nome}>{nome}</Text>
          <Text style={estilos.suave}>Código {cliente.cod_cliente}</Text>
        </Card>

        {/* ---------------- ainda nao iniciada ---------------- */}
        {!visita ? (
          noRoteiro ? (
            <>
              <Card style={{ marginTop: espaco.md, gap: espaco.sm }}>
                <Text style={estilos.titulo}>Iniciar visita</Text>
                <Text style={estilos.texto}>
                  Para começar é preciso estar no cliente. O app confere o GPS e você tira a <Text style={estilos.forte}>foto da fachada</Text>. Sem a foto, a visita não começa.
                </Text>
                {cliente.latitude === null ? (
                  <Text style={estilos.aviso}>Este cliente não tem localização cadastrada no SAP: a visita será gravada sem comparação de distância.</Text>
                ) : null}
              </Card>
              <View style={{ marginTop: espaco.md }}>
                <Botao titulo="Fotografar a fachada e iniciar" onPress={iniciar} carregando={ocupado !== null} />
                {ocupado ? <Text style={[estilos.suave, { textAlign: 'center', marginTop: espaco.sm }]}>{ocupado}</Text> : null}
              </View>
            </>
          ) : (
            <Vazio icone="calendar-outline" texto="Este cliente não está no seu roteiro de hoje. A visita só pode ser feita no dia do roteiro." />
          )
        ) : null}

        {/* ---------------- em andamento ---------------- */}
        {visita && visita.status === 'em_andamento' ? (
          <>
            <Card style={{ marginTop: espaco.md }}>
              <View style={estilos.selos}>
                <Selo texto="Visita em andamento" tom="aviso" />
                {visita.fora_do_raio ? <Selo texto="Check-in fora do local" tom="erro" /> : null}
              </View>
              <View style={{ marginTop: espaco.sm }}>
                <Linha rotulo="Check-in" valor={hora(visita.checkin_em)} />
                <Linha
                  rotulo="Distância do cliente"
                  valor={visita.sem_referencia ? 'sem localização cadastrada' : textoDistancia(visita.distancia_m)}
                />
              </View>
              {visita.fora_do_raio ? (
                <Text style={estilos.aviso}>O check-in foi a {textoDistancia(visita.distancia_m)} do cliente (limite {RAIO_VISITA_M} m). Isso aparece para quem valida a visita.</Text>
              ) : null}
            </Card>

            <Secao titulo="Fotos" detalhe={`${(fotos ?? []).length} de ${MAX_FOTOS_VISITA}`} />
            <Card>
              <View style={estilos.fotos}>
                {(fotos ?? []).map((f) => (
                  <View key={f.id} style={estilos.fotoBox}>
                    {f.enviada ? (
                      <Ionicons name="checkmark-circle" size={30} color={cor.ok} />
                    ) : (
                      <Image source={{ uri: f.uri }} style={estilos.foto} resizeMode="cover" />
                    )}
                    <Text style={estilos.fotoLegenda}>{f.tipo === 'fachada' ? 'Fachada' : 'Foto'}</Text>
                  </View>
                ))}
              </View>
              {pendentesFoto ? <Text style={estilos.suave}>{pendentesFoto} aguardando envio (sobe quando houver internet).</Text> : null}
              <View style={{ marginTop: espaco.sm }}>
                <Botao titulo="Adicionar foto" tom="neutro" onPress={fotografar} desabilitado={(fotos ?? []).length >= MAX_FOTOS_VISITA} />
              </View>
            </Card>

            <View style={{ marginTop: espaco.lg }}>
              <Botao titulo="Fazer pedido para este cliente" tom="neutro" onPress={fazerPedido} desabilitado={!!cliente.bloqueado} />
            </View>

            {perguntas && perguntas.length > 0 ? (
              <>
                <Secao titulo="Perguntas da visita" detalhe={`${perguntas.filter((p) => respPerg[p.id]?.trim()).length} de ${perguntas.length}`} />
                <Card style={{ gap: espaco.lg }}>
                  {perguntas.map((p) => (
                    <View key={p.id} style={{ gap: 6 }}>
                      <Text style={estilos.titulo}>{p.texto}{p.obrigatoria ? <Text style={{ color: cor.erro }}> *</Text> : null}</Text>
                      {p.tipo === 'sim_nao' || p.tipo === 'opcoes' ? (
                        <View style={estilos.selos}>
                          {(p.tipo === 'sim_nao' ? ['Sim', 'Não'] : listaOpcoes(p)).map((o) => (
                            <Chip key={o} texto={o} ativo={respPerg[p.id] === o} onPress={() => setRespPerg({ ...respPerg, [p.id]: respPerg[p.id] === o ? '' : o })} />
                          ))}
                        </View>
                      ) : (
                        <TextInput
                          style={[estilos.campo, p.tipo === 'texto' ? { minHeight: 48, textAlignVertical: 'top' } : undefined]}
                          value={respPerg[p.id] ?? ''}
                          onChangeText={(t) => setRespPerg({ ...respPerg, [p.id]: t })}
                          keyboardType={p.tipo === 'numero' ? 'decimal-pad' : 'default'}
                          placeholder={p.obrigatoria ? 'Obrigatória' : 'Opcional'}
                          placeholderTextColor={cor.textoSuave}
                          multiline={p.tipo === 'texto'}
                          maxLength={500}
                        />
                      )}
                    </View>
                  ))}
                  {perguntas.some((p) => p.obrigatoria) ? <Text style={estilos.suave}>* obrigatória para concluir a visita.</Text> : null}
                </Card>
              </>
            ) : null}

            <Secao titulo="Concluir a visita" />
            <Card style={{ gap: espaco.md }}>
              <Segmentado
                opcoes={[{ valor: 'nao_vendeu', texto: 'Não vendeu' }, { valor: 'vendeu', texto: 'Vendeu' }]}
                valor={resultado}
                onChange={setResultado}
              />
              {resultado === 'vendeu' ? (
                pedido ? (
                  <View style={estilos.ok}>
                    <Ionicons name="checkmark-circle" size={18} color={cor.ok} />
                    <Text style={estilos.okTexto}>Pedido {pedido.codigo ?? 'salvo'} feito nesta visita.</Text>
                  </View>
                ) : (
                  <Text style={estilos.aviso}>Ainda não há pedido de venda feito depois do check-in. Faça o pedido primeiro.</Text>
                )
              ) : (
                <View style={{ gap: 4 }}>
                  <Text style={estilos.rotulo}>Por que não vendeu? (obrigatório)</Text>
                  <TextInput
                    style={[estilos.campo, { minHeight: 70, textAlignVertical: 'top' }]}
                    value={motivo}
                    onChangeText={setMotivo}
                    placeholder="Ex.: estoque cheio, loja fechada, preço..."
                    placeholderTextColor={cor.textoSuave}
                    multiline
                    maxLength={500}
                  />
                </View>
              )}
              <View style={{ gap: 4 }}>
                <Text style={estilos.rotulo}>Observação (opcional)</Text>
                <TextInput style={estilos.campo} value={obs} onChangeText={setObs} maxLength={500} multiline />
              </View>
              <Botao titulo="Concluir visita" onPress={concluir} />
            </Card>
          </>
        ) : null}

        {/* ---------------- concluida ---------------- */}
        {visita && visita.status === 'concluida' ? (
          <Card style={{ marginTop: espaco.md, gap: espaco.sm }}>
            <View style={estilos.selos}>
              <Selo texto="Visita concluída" tom="ok" />
              <Selo texto={visita.resultado === 'vendeu' ? 'Vendeu' : 'Não vendeu'} tom={visita.resultado === 'vendeu' ? 'ok' : 'neutro'} />
              {visita.fora_do_raio ? <Selo texto="Fora do local" tom="erro" /> : null}
            </View>
            <Linha rotulo="Check-in" valor={hora(visita.checkin_em)} />
            <Linha rotulo="Check-out" valor={hora(visita.checkout_em)} />
            {visita.resultado === 'nao_vendeu' ? <Linha rotulo="Motivo" valor={visita.motivo_nao_venda} /> : null}
            {visita.observacao ? <Linha rotulo="Observação" valor={visita.observacao} /> : null}
            {respostasDaVisita(visita).map((r) => <Linha key={r.pergunta_id} rotulo={r.pergunta} valor={r.resposta} />)}
            <Linha
              rotulo="Validação"
              valor={visita.validacao === 'validada' ? 'Validada' : visita.validacao === 'recusada' ? `Recusada${visita.validacao_obs ? `: ${visita.validacao_obs}` : ''}` : 'Aguardando validação'}
            />
            <Text style={visita.sincronizada === 2 ? estilos.aviso : estilos.suave}>
              {visita.sincronizada === 1
                ? pendentesFoto
                  ? `Visita enviada. ${pendentesFoto} foto(s) aguardando envio.`
                  : 'Visita enviada.'
                : visita.sincronizada === 2
                  ? `O servidor recusou esta visita: ${visita.erro_envio ?? 'dados inválidos'}.`
                  : 'Aguardando envio ao servidor (sobe quando houver internet).'}
            </Text>
          </Card>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const estilos = estilosTema(() => StyleSheet.create({
  conteudo: { padding: espaco.lg, paddingBottom: espaco.xl * 2 },
  nome: { fontSize: 20, fontWeight: '800', color: cor.texto },
  titulo: { fontSize: 16, fontWeight: '700', color: cor.texto },
  texto: { fontSize: 14, color: cor.texto },
  forte: { fontWeight: '800' },
  suave: { fontSize: 13, color: cor.textoSuave },
  aviso: { fontSize: 13, color: cor.aviso, marginTop: 4 },
  rotulo: { fontSize: 13, color: cor.textoSuave },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fotos: { flexDirection: 'row', flexWrap: 'wrap', gap: espaco.sm, marginBottom: espaco.sm },
  fotoBox: { alignItems: 'center', gap: 2 },
  foto: { width: 64, height: 64, borderRadius: 10, backgroundColor: cor.neutroFundo },
  fotoLegenda: { fontSize: 11, color: cor.textoSuave },
  ok: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  okTexto: { fontSize: 14, color: cor.ok, fontWeight: '600' },
  campo: {
    borderWidth: 1, borderColor: cor.borda, borderRadius: raio, paddingHorizontal: espaco.md, paddingVertical: 10,
    fontSize: 15, color: cor.texto, backgroundColor: cor.card,
  },
}));
