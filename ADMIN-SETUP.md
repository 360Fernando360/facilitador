# Configuração da administração de usuários

## 1. Atualizar o banco

Abra o SQL Editor do Supabase e execute todo o arquivo `supabase-schema.sql`.

Esse mesmo arquivo cria a medição de uso exibida na área administrativa. O painel registra presença, área geral acessada, quantidade de acessos e tempo aproximado de atividade; ele não armazena o conteúdo digitado pelos usuários.

Depois, preencha nome e e-mail do administrador que já existe:

```sql
update public.organization_members
set full_name = 'Nome do administrador',
    email = 'email@empresa.com',
    role = 'admin'
where user_id = 'ID_DO_USUARIO';
```

## 2. Publicar a Edge Function

Com a CLI do Supabase instalada e autenticada, execute na raiz do projeto:

```powershell
supabase link --project-ref vayypajjcmutxzohuwbm
supabase functions deploy hyper-function
```

Não coloque a chave `service_role` ou uma chave secreta no `index.html`. A função usa a variável segura `SUPABASE_SERVICE_ROLE_KEY` disponibilizada pelo ambiente do Supabase.

Na configuração da função, deixe `Verify JWT with legacy secret` desligado. A própria função exige o token da sessão e valida o usuário com `auth.getUser()` antes de verificar o perfil de administrador.

## 3. Conferir a URL de autenticação

No Dashboard, abra `Authentication > URL Configuration` e confirme:

- Site URL: `https://360fernando360.github.io/facilitador/`
- Redirect URL: `https://360fernando360.github.io/facilitador/**`

## 4. E-mail de produção

O provedor padrão do Supabase tem limite baixo. Configure um SMTP próprio em `Authentication > Emails > SMTP Settings` antes de usar convites em produção.

## 5. Cotações PTAX

O arquivo `supabase-schema.sql` cria o histórico central `exchange_rates` e a função de leitura `get_latest_exchange_rates()`. Execute novamente o arquivo completo no SQL Editor antes de publicar o quadro de câmbio.

Crie um segredo forte e configure-o somente no ambiente da Edge Function:

```powershell
supabase secrets set PTAX_UPDATE_SECRET="COLOQUE_UM_SEGREDO_FORTE_AQUI"
supabase functions deploy update-ptax
```

A função consulta exclusivamente a API PTAX oficial do Banco Central, aceita somente o boletim `Fechamento` e armazena a `cotacaoVenda`. A chave única formada por moeda e data de referência torna novas execuções idempotentes.

### Agendamento

No Dashboard do Supabase, habilite `Cron` e `pg_net`. Guarde no Vault a URL do projeto e o mesmo segredo configurado na função:

```sql
select vault.create_secret(
  'https://vayypajjcmutxzohuwbm.supabase.co',
  'ptax_project_url'
);

select vault.create_secret(
  'COLOQUE_O_MESMO_SEGREDO_FORTE_AQUI',
  'ptax_update_secret'
);
```

Depois, crie o trabalho principal para 18h15 no horário de Brasília, de segunda a sexta-feira. O cron do Supabase usa UTC; por isso, o horário abaixo é 21h15 UTC:

```sql
select cron.schedule(
  'update-ptax-weekdays',
  '15 21 * * 1-5',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ptax_project_url') || '/functions/v1/update-ptax',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-ptax-update-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'ptax_update_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

É recomendável criar uma segunda tentativa às 19h15 de Brasília usando outro nome e a expressão `15 22 * * 1-5`. Repetir a chamada não duplica o histórico.

Em caso de indisponibilidade do Banco Central, a função registra a falha nos logs e não remove nem substitui as últimas cotações válidas.

### Testes locais

Com Deno instalado:

```powershell
deno test --allow-net supabase/functions/_shared/ptax_test.ts
```

Para executar a função localmente, é necessário ter a CLI do Supabase e Docker:

```powershell
supabase start
supabase functions serve update-ptax --env-file supabase/.env.local
```

O arquivo local de variáveis deve conter `PTAX_UPDATE_SECRET`, mas nunca deve ser enviado ao GitHub.
