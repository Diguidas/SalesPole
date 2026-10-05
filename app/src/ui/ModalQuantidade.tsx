import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { lerDesconto, validarDesconto } from '@/domain/pedido';
import { lerQuantidade, validarQuantidade, type RegraQuantidade } from '@/domain/quantidade';
import { Botao } from './components';
import { cor, espaco, raio } from './theme';

interface Props {
  visivel: boolean;
  titulo: string;
  unidade: string;
  inicial: string;
  regra: RegraQuantidade;
  confirmarTexto?: string;
  /** desconto maximo (%) da lista de preco; 0/ausente = o campo de desconto nem aparece */
  descontoMax?: number;
  descontoInicial?: number | null;
  onConfirmar: (quantidade: number, desconto: number) => void;
  onCancelar: () => void;
}

/** Digitar quantidade com validacao na hora (minimo e multiplo do produto). */
export function ModalQuantidade({ visivel, titulo, unidade, inicial, regra, confirmarTexto = 'Confirmar', descontoMax = 0, descontoInicial, onConfirmar, onCancelar }: Props) {
  const [texto, setTexto] = useState(inicial);
  const [descTexto, setDescTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (visivel) {
      setTexto(inicial);
      setDescTexto(descontoInicial ? String(descontoInicial).replace('.', ',') : '');
      setErro(null);
    }
  }, [visivel, inicial, descontoInicial]);

  function confirmar() {
    const q = lerQuantidade(texto);
    if (q === null) return setErro('Informe uma quantidade válida (até 3 casas decimais).');
    const problema = validarQuantidade(q, regra);
    if (problema) return setErro(problema);
    const d = descontoMax > 0 ? lerDesconto(descTexto) : 0;
    if (d === null) return setErro('Desconto inválido (use um percentual, até 2 casas decimais).');
    const msgDesc = validarDesconto(d, descontoMax);
    if (msgDesc) return setErro(msgDesc);
    onConfirmar(q, d);
  }

  return (
    <Modal visible={visivel} transparent animationType="fade" onRequestClose={onCancelar}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={estilos.fundo}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancelar} />
        <View style={estilos.caixa}>
          <Text style={estilos.titulo} numberOfLines={2}>{titulo}</Text>
          <View style={estilos.linha}>
            <TextInput
              style={estilos.campo}
              value={texto}
              onChangeText={(t) => {
                setTexto(t);
                setErro(null);
              }}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
              onSubmitEditing={confirmar}
            />
            <Text style={estilos.unidade}>{unidade || 'un'}</Text>
          </View>
          {descontoMax > 0 ? (
            <View style={estilos.linha}>
              <TextInput
                style={[estilos.campo, { fontSize: 18 }]}
                value={descTexto}
                onChangeText={(t) => {
                  setDescTexto(t);
                  setErro(null);
                }}
                keyboardType="decimal-pad"
                placeholder="Desconto"
                placeholderTextColor={cor.textoSuave}
                selectTextOnFocus
              />
              <Text style={estilos.unidade}>%</Text>
            </View>
          ) : null}
          {descontoMax > 0 ? <Text style={estilos.dica}>desconto máximo {Math.round(descontoMax * 100) / 100}%</Text> : null}
          {regra.minimo || (regra.multiplo && regra.multiplo !== 1) ? (
            <Text style={estilos.dica}>
              {[regra.minimo ? `mínimo ${regra.minimo}` : null, regra.multiplo && regra.multiplo !== 1 ? `múltiplo de ${regra.multiplo}` : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ) : null}
          {erro ? <Text style={estilos.erro}>{erro}</Text> : null}
          <View style={estilos.botoes}>
            <View style={{ flex: 1 }}>
              <Botao titulo="Cancelar" onPress={onCancelar} tom="neutro" />
            </View>
            <View style={{ flex: 1 }}>
              <Botao titulo={confirmarTexto} onPress={confirmar} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: espaco.xl },
  caixa: { backgroundColor: cor.card, borderRadius: raio, padding: espaco.lg, gap: espaco.sm },
  titulo: { fontSize: 16, fontWeight: '700', color: cor.texto },
  linha: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm, marginTop: espaco.sm },
  campo: {
    flex: 1, borderWidth: 1, borderColor: cor.borda, borderRadius: raio, paddingHorizontal: espaco.lg,
    paddingVertical: 12, fontSize: 22, fontWeight: '700', color: cor.texto,
  },
  unidade: { fontSize: 16, fontWeight: '700', color: cor.textoSuave, minWidth: 34 },
  dica: { fontSize: 13, color: cor.textoSuave },
  erro: { fontSize: 13, color: cor.erro },
  botoes: { flexDirection: 'row', gap: espaco.sm, marginTop: espaco.sm },
});
