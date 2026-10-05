# Sales Pole

Força de vendas da Pole Alimentos: app mobile (Expo) + API (NestJS) + Supabase + SAP.

```
salespole/
├─ abap/       classe ZCL_INTEGRACAO_POLE_TECH (colar no SE24; ver ZCL_INTEGRACAO_POLE_TECH.abap)
├─ supabase/   migrations SQL (rodar em ordem no SQL Editor)
├─ api/        NestJS: sincroniza SAP -> Supabase, serve o app, envia pedidos ao SAP
└─ app/        Expo (React Native): app do vendedor, offline-first (SQLite)
```

Fluxo: **SAP → (API, jobs) → Supabase → (API, /sync/pull) → SQLite do celular**, e
**celular → (API, /pedidos/push) → SAP**. O app só fala com a API.

## Subir tudo (desenvolvimento)

### 1. Supabase
Rode, em ordem, os arquivos de `supabase/migrations/` no SQL Editor.

### 2. API (`api/`)
```bash
cd api
cp .env.example .env        # preencha SAP_* e SUPABASE_* (service role)
npm install
npm run start:dev           # http://localhost:3000
```
- No Windows, libere a porta 3000 no firewall para a rede privada (o celular precisa alcançar o PC).
- Teste só a leitura do SAP: `npm run sync:vendedor -- <codvendedor>`
- Testes do envio de pedidos (sem SAP/Supabase reais): `npm run test:push`

### 3. Usuário de login (e-mail pode ser fictício)
```bash
npm run criar:usuario -- 100409@vendedor.polealimentos.com.br SenhaForte123 100409
```
Cria a conta no Supabase Auth (já confirmada) e vincula e-mail → código do vendedor.

### 4. App (`app/`) no celular com Expo Go
```bash
cd app
cp .env.example .env
```
Preencha o `.env`:
- `EXPO_PUBLIC_API_URL` = `http://<IP do seu PC>:3000` (descubra com `ipconfig`; `localhost` **não** funciona no celular)
- `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY` (Supabase → Settings → API; **chave anon/publishable, nunca a service role**)

```bash
npm install
npx expo start --clear
```
Abra o **Expo Go** no Android e leia o QR code. Celular e PC na **mesma rede Wi-Fi**.
Depois de mudar o `.env`, reinicie com `--clear`.

### 4b. Alternativa: emulador do Android Studio (funciona com rede cabeada)
No emulador, o PC é visto como **`10.0.2.2`** (não `localhost`, não o IP da rede):
`EXPO_PUBLIC_API_URL=http://10.0.2.2:3000`. O Supabase é acessado pela internet normalmente.

```powershell
# 1) abra o emulador (Device Manager do Android Studio, ou:)
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Pixel_7

# 2) deixe o adb visivel para o Expo (nesta janela do PowerShell)
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path += ";$env:ANDROID_HOME\platform-tools"
adb devices            # deve listar "emulator-5554  device"

# 3) suba o app e aperte "a" no terminal: o Expo instala o Expo Go no emulador sozinho
cd app
npx expo start --clear
```
Teste de rede: no Chrome do emulador abra `http://10.0.2.2:3000/sync/pull`; deve responder
`{"message":"Token ausente",...}` (401). Se responder, o app alcança a API.

## Build para a loja
Com EAS (`npx eas-cli@latest build --platform android`). O `app.json` já tem o pacote
`br.com.polealimentos.salespole`. Antes da loja: apontar `EXPO_PUBLIC_API_URL` para a API em produção (HTTPS).

## Testes (rodam sem celular, sem SAP e sem Supabase reais)
```bash
cd api && npm run test:push        # envio de pedidos: idempotencia, fila, falhas do SAP (Postgres real em memoria)
cd app && npm run test:dominio     # regras: preco, entrega, quantidade minima/multiplo
cd app && npm run test:db          # SQLite real: pull, consultas, catalogo, rascunhos, fila de envio
```

## Como o pedido funciona (app)
- **Novo pedido**: cliente → produtos (preço de tabela e estoque do centro do cliente) → revisão → enviar.
  O pedido vira *rascunho* no SQLite (sobrevive se o app for fechado) e, ao enviar, entra na fila (*pendente*).
- **Envio**: o app gera um UUID (chave de idempotência); o servidor atribui o código sequencial e entrega ao SAP.
  Sem internet, o pedido fica salvo e segue no próximo sincronismo. Reenviar é seguro.
- **O pedido é feito em CAIXA (CX)**. O SAP manda, por produto, a unidade base e as conversões da `MARM`;
  o app converte o preço de tabela (R$/KG, R$/UN...) para **R$ por caixa** e guarda o preço original ao lado.
- **Produto sem preço de tabela não aparece** na busca (nem sem estoque, nem sem área de vendas do cliente). Itens que já
  estão num pedido continuam com suas informações.
- **Estoque não é exibido**: produto com menos de 1 caixa no centro do cliente simplesmente não aparece na busca
  (se o centro ainda não tem estoque baixado, nada é escondido).
- **O preço por caixa vai como `ZPR2`**, igual ao app oficial (confirmado na `KONV`: `ZPRL` = lista, só referência;
  `ZPR2` = preço fechado, é o que vale). O app fixa o preço (tabela por caixa) na hora de enviar; sem preço conhecido
  vai vazio e o SAP aplica a lista. É aqui que entra o desconto no futuro: `preço = tabela × (1 − desconto)`.
  O valor **líquido** do item no SAP é menor que o preço porque desconta ICMS, CBS, IBS (e PIS/COFINS conforme o cliente).
- **Desconto por item (%)**: o SAP manda `desconto_max` por preço = `(KBETR − MXWRT) / KBETR`, e só vale se a `ZSDT138` liberar
  a chave (`LISTA` ou `LISTA.GRUPO.LISTA`, `DESCONTO = 'X'`); `MXWRT` vazio = 0. O vendedor digita o % ao adicionar/editar o item
  (campo só aparece se a lista permite); o app limita ao máximo e envia `tabela × (1 − desc%)` como ZPR2. Rodar a migration
  `20261003000000_desconto_max.sql` no Supabase.
- **Unidade**: o pedido leva o **código** da caixa (`KI`), a tela mostra o **texto** (`CX`). Mínimo/múltiplo do cadastro
  estão em KG (peso da caixa) e o app converte para caixas.
- **FERT e HAWA/ZVAR** viram até duas ordens no SAP; o app mostra as duas dentro do mesmo pedido.

## Pendências conhecidas
- Login Microsoft (Azure) congelado; hoje é e-mail + senha.
- ABAP: `remessas` ainda devolve 0 (sem diagnóstico); `pedidos`/`titulos` levam ~1 min por rota.
