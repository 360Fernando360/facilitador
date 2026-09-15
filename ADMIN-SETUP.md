# Configuração da administração de usuários

## 1. Atualizar o banco

Abra o SQL Editor do Supabase e execute todo o arquivo `supabase-schema.sql`.

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
