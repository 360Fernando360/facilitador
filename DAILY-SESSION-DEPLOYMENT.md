# Expiracao diaria de sessao: implantacao e reversao

Esta entrega nao exige alterar a configuracao global de JWT do Supabase. O limite e aplicado pela sessao assinada do Auth (`session_id`), pelas politicas/RPCs no banco e pelas tres Edge Functions protegidas.

## Ordem de implantacao

1. Registrar o commit anterior a esta entrega (`8453d2482b21aa13612ac2fcfafa67705455f87a`) como referencia de reversao.
2. Publicar primeiro o frontend. Ele aceita temporariamente a ausencia exclusiva da RPC `get_daily_session_deadline`; qualquer outro erro continua falhando fechado.
3. Confirmar que login e navegacao atuais continuam funcionando.
4. Aplicar somente `20261014120000_daily_session_expiry.sql`.
5. Confirmar que a RPC devolve um prazo para uma sessao temporaria criada no mesmo dia de Brasilia.
6. Publicar, nesta ordem, `credential-vault`, `hyper-function` e `update-ptax`, mantendo as configuracoes atuais de JWT e secrets.
7. Executar os testes temporarios descritos abaixo e remover apenas os dados temporarios.

Usuarios com uma sessao iniciada antes da meia-noite atual de Brasilia serao desconectados quando a migration entrar em vigor. Isso e parte da regra solicitada. Para reduzir impacto, a etapa 4 deve ocorrer em uma janela comunicada e as etapas 5 e 6 devem ser executadas sem intervalo desnecessario.

## Teste pos-prazo sem afetar sessoes reais

1. Criar duas contas temporarias e organizacoes/vinculos exclusivos para o teste.
2. Fazer login em ambas e registrar os respectivos `user_id` e `session_id` temporarios.
3. Alterar exclusivamente `auth.sessions.created_at` da primeira sessao temporaria para um instante anterior a meia-noite anterior de Brasilia. Nunca selecionar ou atualizar sessoes sem filtrar simultaneamente os IDs temporarios registrados.
4. Confirmar recusa por RLS e pelas tres Edge Functions usando apenas o token temporario expirado.
5. Confirmar que a segunda conta temporaria nao enxerga dados da primeira.
6. Fazer novo login na primeira conta, confirmar um novo `session_id` e o acesso normal.
7. Excluir as contas e dados temporarios. A exclusao da conta temporaria remove suas sessoes; nenhuma sessao real e modificada e nao e necessario aguardar meia-noite.

## Reversao sem perda de dados

1. Manter o frontend novo publicado: sua compatibilidade com RPC ausente permite concluir a reversao sem bloquear o login.
2. A partir de um checkout/worktree limpo do commit `8453d2482b21aa13612ac2fcfafa67705455f87a`, publicar somente as versoes anteriores de `credential-vault`, `hyper-function` e `update-ptax`. Isso elimina a dependencia delas na RPC nova antes de removê-la.
3. Executar manualmente `supabase/rollback/20261014120000_daily_session_expiry_rollback.sql` no projeto de destino.
4. Validar login, isolamento de organizacao, credential-vault e a chamada agendada da PTAX.
5. Se for desejada reversao completa da interface, publicar o frontend do mesmo commit somente depois das etapas anteriores.

O SQL de reversao restaura exatamente os predicados e permissoes anteriores dos helpers e das duas politicas alteradas, depois remove apenas as quatro funcoes de expiracao. Ele nao apaga tabelas, credenciais, organizacoes, vinculos, historico ou taxas de cambio.
