import { ReactNode } from 'react';
import { KeyboardTypeOptions, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Segmentado } from './components';
import { Dropdown, OpcaoDropdown } from './Dropdown';
import { cor, espaco, raio } from './theme';

/** Bloco de formulario com titulo (ex.: "Informacoes de endereco"). */
export function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <View style={estilos.bloco}>
      <Text style={estilos.blocoTitulo}>{titulo}</Text>
      {children}
    </View>
  );
}

export function Campo({
  rotulo, valor, onChange, obrigatorio, teclado, maxLength, multilinha, editavel = true, dica, onBlur,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  obrigatorio?: boolean;
  teclado?: KeyboardTypeOptions;
  maxLength?: number;
  multilinha?: boolean;
  editavel?: boolean;
  dica?: string;
  onBlur?: () => void;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={estilos.rotulo}>{rotulo}{obrigatorio ? ' *' : ''}</Text>
      <TextInput
        style={[estilos.campo, multilinha ? { minHeight: 70, textAlignVertical: 'top' } : undefined, !editavel ? { opacity: 0.6 } : undefined]}
        value={valor}
        onChangeText={onChange}
        onBlur={onBlur}
        keyboardType={teclado}
        maxLength={maxLength}
        multiline={multilinha}
        editable={editavel}
        autoCapitalize={teclado === 'email-address' ? 'none' : 'sentences'}
        placeholder={dica}
        placeholderTextColor={cor.textoSuave}
      />
    </View>
  );
}

export function SimNao({ rotulo, valor, onChange }: { rotulo: string; valor: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={estilos.rotulo}>{rotulo} *</Text>
      <Segmentado<'sim' | 'nao' | ''>
        opcoes={[{ valor: 'sim', texto: 'Sim' }, { valor: 'nao', texto: 'Não' }]}
        valor={valor === null ? '' : valor ? 'sim' : 'nao'}
        onChange={(v) => v && onChange(v === 'sim')}
      />
    </View>
  );
}

/** Lista suspensa com o rotulo do campo acima (o Dropdown sozinho so mostra o valor escolhido). */
export function CampoLista({ rotulo, obrigatorio, valor, opcoes, onChange, dica = 'Selecione', desabilitado }: {
  rotulo: string; obrigatorio?: boolean; valor: string | undefined; opcoes: OpcaoDropdown[]; onChange: (v: string) => void; dica?: string; desabilitado?: boolean;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={estilos.rotulo}>{rotulo}{obrigatorio ? ' *' : ''}</Text>
      <Dropdown titulo={rotulo} valor={valor} opcoes={opcoes} onChange={(x) => onChange(x ?? '')} placeholder={dica} desabilitado={desabilitado} />
    </View>
  );
}

export function TextoRotulo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={estilos.rotulo}>{rotulo}</Text>
      {children}
    </View>
  );
}

export function Aviso({ texto, tom = 'aviso' }: { texto: string; tom?: 'aviso' | 'erro' | 'ok' }) {
  const cores = { aviso: [cor.avisoFundo, cor.aviso], erro: [cor.erroFundo, cor.erro], ok: [cor.okFundo, cor.ok] }[tom];
  return (
    <View style={{ backgroundColor: cores[0], borderRadius: raio - 4, padding: espaco.md }}>
      <Text style={{ color: cores[1], fontSize: 13 }}>{texto}</Text>
    </View>
  );
}

export function LinhaToque({ titulo, detalhe, onPress }: { titulo: string; detalhe?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [estilos.toque, pressed ? { opacity: 0.7 } : undefined]}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: cor.texto }}>{titulo}</Text>
      {detalhe ? <Text style={{ fontSize: 13, color: cor.textoSuave, marginTop: 2 }}>{detalhe}</Text> : null}
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  bloco: { backgroundColor: cor.card, borderRadius: raio, padding: espaco.lg, gap: espaco.md, borderWidth: StyleSheet.hairlineWidth, borderColor: cor.borda },
  blocoTitulo: { fontSize: 13, fontWeight: '800', color: cor.primaria, textTransform: 'uppercase', letterSpacing: 0.5 },
  rotulo: { fontSize: 13, color: cor.textoSuave, fontWeight: '600' },
  campo: {
    borderWidth: 1, borderColor: cor.borda, borderRadius: raio - 4, paddingHorizontal: espaco.md, paddingVertical: 10,
    fontSize: 15, color: cor.texto, backgroundColor: cor.card,
  },
  toque: { backgroundColor: cor.card, borderRadius: raio, padding: espaco.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: cor.borda },
});
