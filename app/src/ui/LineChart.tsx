import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { cor, espaco, estilosTema } from './theme';

export interface PontoGrafico {
  rotulo: string;
  valor: number;
}

const ALTURA = 120;
const MARGEM = 14;

/** Grafico de linha simples (so Views, sem biblioteca): um ponto por rotulo, ligados por segmentos. */
export function LineChart({ pontos, formato }: { pontos: PontoGrafico[]; formato: (v: number) => string }) {
  const [largura, setLargura] = useState(0);
  const max = Math.max(...pontos.map((p) => p.valor), 0);
  // com muitos pontos (12 meses) os valores se sobrepoem: mostra todos so ate 8; senao so o maior e o ultimo
  const iMax = pontos.findIndex((p) => p.valor === max);
  const mostrar = (i: number) => pontos.length <= 8 || i === iMax || i === pontos.length - 1;
  const util = largura - MARGEM * 2;
  const x = (i: number) => MARGEM + (pontos.length > 1 ? (i / (pontos.length - 1)) * util : util / 2);
  const y = (v: number) => MARGEM + (max > 0 ? (1 - v / max) * (ALTURA - MARGEM * 2) : (ALTURA - MARGEM * 2) / 2);

  return (
    <View>
      <View style={estilos.area} onLayout={(e) => setLargura(e.nativeEvent.layout.width)}>
        <View style={[estilos.base, { top: y(0) }]} />
        {largura > 0
          ? pontos.map((p, i) => {
              if (i === 0) return null;
              const a = { x: x(i - 1), y: y(pontos[i - 1].valor) };
              const b = { x: x(i), y: y(p.valor) };
              const comp = Math.hypot(b.x - a.x, b.y - a.y);
              const ang = Math.atan2(b.y - a.y, b.x - a.x);
              return (
                <View
                  key={`l${i}`}
                  style={[
                    estilos.segmento,
                    {
                      width: comp,
                      left: (a.x + b.x) / 2 - comp / 2,
                      top: (a.y + b.y) / 2 - 1,
                      transform: [{ rotate: `${ang}rad` }],
                    },
                  ]}
                />
              );
            })
          : null}
        {largura > 0
          ? pontos.map((p, i) => (
              <View key={`p${i}`} style={[estilos.ponto, { left: x(i) - 4, top: y(p.valor) - 4 }]} />
            ))
          : null}
      </View>
      <View style={estilos.eixo}>
        {pontos.map((p, i) => (
          <View key={i} style={estilos.coluna}>
            <Text style={estilos.valor} numberOfLines={1}>{mostrar(i) ? (p.valor > 0 ? formato(p.valor) : '–') : ' '}</Text>
            <Text style={estilos.rotulo}>{p.rotulo}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const estilos = estilosTema(() => StyleSheet.create({
  area: { height: ALTURA, marginBottom: espaco.xs },
  base: { position: 'absolute', left: MARGEM, right: MARGEM, height: StyleSheet.hairlineWidth, backgroundColor: cor.borda },
  segmento: { position: 'absolute', height: 2, backgroundColor: cor.primaria, borderRadius: 1 },
  ponto: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: cor.primaria, borderWidth: 1.5, borderColor: cor.card },
  eixo: { flexDirection: 'row' },
  coluna: { flex: 1, alignItems: 'center' },
  valor: { fontSize: 10, color: cor.texto, fontWeight: '600' },
  rotulo: { fontSize: 11, color: cor.textoSuave, textTransform: 'capitalize' },
}));
