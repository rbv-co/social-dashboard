# Notas da implantação da API em Go

Registro versionado do que o Plano 1 (levantamento e núcleo) deixou para os próximos planos.

## Requisitos de implantação

- O nginx DEVE definir `proxy_set_header X-Real-IP $remote_addr;`. Sem isso o limite por IP agrupa todo mundo pelo IP do proxy.
- A porta da API só pode ser alcançável pelo proxy. O auxiliar de IP do cliente só confia em `X-Real-IP` quando a conexão vem de loopback/rede privada; CGNAT/Tailscale (100.64/10) não conta como privado.
- O limite por IP também conta logins bem-sucedidos. NAT grande (escritório, operadora) pode precisar de teto maior.
- O limite por e-mail permite que um atacante trave o login de uma conta por 15 min. É inerente à spec §4.
- O limitador é em memória e vale para uma instância só (teto de 10 mil chaves, varredura total ao passar dele).

## Decisões para os próximos planos

- Worker: inserir `conferido_em = now()` ao gravar em `robos_execucoes`, ou portar `conferir_robos` com cuidado: ela varre a cada 6 h as linhas com `conferido_em` nulo e sobrescreveria `resposta`.
- Advisory lock: a chave única com `hashtext` divide o espaço de chaves com as RPCs existentes (`pg_advisory_xact_lock(hashtext(...))`). Usar a forma de duas chaves, com um namespace do worker.
- Migrações: rodar só no `api` (ou usar o Provider do goose com locker de sessão). `api` e `worker` subindo juntos disputam a migração.
- `usuarios` não tem coluna de tipo de conta e `Entrar` sempre cria sessão `painel`. Decidir no plano da Vessel como manter clientes fora do login do painel.
- `email_confirmado_em` é ignorado no login (o GoTrue bloqueia e-mail não confirmado quando a confirmação está ligada). Decidir após a consulta 18 do levantamento.
- `sessoes.origem` (IP/user-agent) da spec §4 ainda não existe.
- `sqlc` (spec §3.1) ainda não foi adotado; hoje é SQL cru via pgx. Decidir antes dos planos de domínio.
- Timeouts de leitura/escrita/ociosidade do servidor HTTP ficam para o plano de deploy.
- A leitura de `permissions` é estrita (`map[string][]string`): uma linha jsonb malformada dá 500 para aquele usuário. Considerar leitura tolerante, como o front faz com `Array.isArray`.
- `profiles.role` pode ser enum: usar `role::text`.
- Sessões impersonadas recebem o TTL cheio de 12 h e `ultimo_uso_em` fica congelado. Decidir no plano de admin.
- Sessões expiradas nunca são apagadas e não há teto absoluto de vida. Adicionar tarefa de expurgo no plano de crons.
- Desativação: vale `profiles.disabled` (e `usuarios.desativado_em`). O importador copia só `banned_until` do Auth, então `desativado_em` tende a ficar nulo; conferir com as consultas 14 e 17.

## Minors adiados

Tarefa 1 (catálogo de policies)
- Testes de nome entre aspas com "to"/"for" e de drop com aspas/`public.`.
- Regex de `to` deveria ancorar após `on <tabela>`.
- `storage.objects` fica qualificada (documentar).
- `gerar.mjs` deveria usar `fileURLToPath` em vez de `URL.pathname`.

Tarefa 2 (levantamento)
- Denylist do teste não cobre into/set_config/pg_terminate/advisory/nextval/lock.
- A URL fica visível no `ps`.
- Documentar que a saída da consulta 04 (`cron.job.command`) pode conter segredos.
- O `sub()` do awk é no-op.
- Rótulo da consulta 13 diz "sequências", mas só lista tabelas sem PK e usa `relkind 'r'` (ignora particionadas).

Tarefa 3 (esqueleto, testebanco, banco)
- `testebanco` vaza conexão admin/schema se `t.Fatal` ocorrer antes do Cleanup.
- Globals do goose (`SetBaseFS`) são racy apenas com `t.Parallel`.
- Subcomando é validado depois de conectar/migrar.
- Sem Idle/WriteTimeout.
- Workflow `api.yml` não inclui o próprio arquivo em `paths`.

Tarefa 4 (sessões)
- `Criar` devolve token mesmo com erro (deveria retornar `"", err`).
- Teste de renovação só checa a struct, não o banco; o throttle de 5 min não tem teste.
- Teste do token em claro ignora o erro do `Scan` e não prova `hash == hashDoToken`.
- Testes negativos sem controle positivo; `ImpersonadorID` nunca é comparado a `uid2`.
- Impersonada com TTL cheio de 12 h; `ultimo_uso_em` não atualiza em impersonada.
- Sem expurgo de sessões expiradas nem teto absoluto.

Tarefas 5 e 6 (auth, rotas, Pode)
- Corpo JSON com lixo depois do objeto é aceito.
- 429 sem `Retry-After`.
- Lacunas de teste: corpo 401 idêntico para e-mail inexistente × senha errada, "Bearer lixo", porta não numérica no teste do `ipDe`.
- Typo no nome do teste "ECountaNoLimite".

Tarefa 7 (importador de usuários)
- Erro de colisão de e-mail sem id/e-mail (envolver com `fmt.Errorf`).
- Reimport sobrescreve `desativado_em` (documentar: só antes do corte, a fonte manda) e restampa "agora" a cada rodada.
- Erro de conexão do pgx é logado cru (host/usuário, sem senha).
- `banned_until = infinity` quebra o scan.
- Sem teste de `FonteSupabase`, do exit sem `ORIGEM_DATABASE_URL` e do rollback por colisão.

Tarefa 8 (worker)
- Execução pulada por lock não deixa log nem linha.
- Shutdown não cancela tarefas em andamento (ctx Background) e `Iniciar` espera sem teto.
- `hashtext` de 32 bits (aceitável com 14 nomes).
- `<-preso` do teste pode travar se a primeira `Rodar` falhar (usar select com timeout).
