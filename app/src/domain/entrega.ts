// Data de entrega: proxima data de entrega do cliente ESTRITAMENTE depois de hoje.
// Mesma regra do SAP (SALESPOLE_CRIAR_PEDIDO); o SAP e quem decide de verdade e devolve a data usada.

const dois = (n: number) => String(n).padStart(2, '0');
export const isoLocal = (d: Date) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;

/**
 * @param diasEntrega dias da semana de entrega do cliente (1=seg ... 7=dom). Vazio = segunda a sabado.
 * @param base data da compra (padrao: agora). A entrega e sempre depois dela.
 */
export function proximaEntrega(diasEntrega: number[], base: Date = new Date()): string | null {
  const dias = new Set(diasEntrega.length ? diasEntrega : [1, 2, 3, 4, 5, 6]);
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  for (let i = 0; i < 14; i++) {
    d.setDate(d.getDate() + 1);
    const semana = d.getDay() === 0 ? 7 : d.getDay();
    if (dias.has(semana)) return isoLocal(d);
  }
  return null;
}
