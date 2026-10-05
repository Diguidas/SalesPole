import { createClient } from '@supabase/supabase-js';
import { normCod } from '../auth/vendedores.service';

/**
 * Cria (ou atualiza a senha de) um usuario de login e vincula ao vendedor:
 *   npm run criar:usuario -- 100409@vendedor.polealimentos.com.br SenhaForte123 100409
 *
 * - O e-mail pode ser ficticio (nenhum e-mail e enviado; a conta ja nasce confirmada).
 * - O vinculo vai para usuarios_vendedor (e-mail -> cod_vendedor); o app so conhece
 *   o login, e a API descobre o vendedor por esse vinculo.
 */
async function main() {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* .env ausente: usa as variaveis do ambiente */
  }

  const [emailArg, senha, codArg] = process.argv.slice(2);
  if (!emailArg || !senha || !codArg) {
    console.error('Uso: npm run criar:usuario -- <email> <senha> <codvendedor>');
    process.exit(1);
  }
  if (senha.length < 6) {
    console.error('A senha precisa ter ao menos 6 caracteres.');
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const codVendedor = normCod(codArg);
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1) conta de login
  const criado = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true });
  if (criado.error) {
    const jaExiste = /already|registered|exists/i.test(criado.error.message);
    if (!jaExiste) throw criado.error;

    // ja existe: procura e atualiza a senha
    let id: string | undefined;
    for (let pagina = 1; !id && pagina <= 20; pagina++) {
      const lista = await sb.auth.admin.listUsers({ page: pagina, perPage: 200 });
      if (lista.error) throw lista.error;
      id = lista.data.users.find((u) => u.email?.toLowerCase() === email)?.id;
      if (lista.data.users.length < 200) break;
    }
    if (!id) throw new Error(`Usuario ${email} existe mas nao foi encontrado na listagem`);
    const atualizado = await sb.auth.admin.updateUserById(id, { password: senha, email_confirm: true });
    if (atualizado.error) throw atualizado.error;
    console.log(`Usuario ja existia: senha atualizada (${email}).`);
  } else {
    console.log(`Usuario criado (${email}).`);
  }

  // 2) vinculo e-mail -> vendedor
  const vinculo = await sb
    .from('usuarios_vendedor')
    .upsert({ email, cod_vendedor: codVendedor, ativo: true }, { onConflict: 'email' });
  if (vinculo.error) throw vinculo.error;
  console.log(`Vinculado ao vendedor ${codVendedor}.`);
}

main().catch((e) => {
  console.error('FALHOU:', e instanceof Error ? e.message : e);
  process.exit(1);
});
