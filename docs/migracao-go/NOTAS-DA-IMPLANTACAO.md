# Notas da implantação da API em Go

Registro versionado do que o Plano 1 (levantamento e núcleo) deixou para os próximos planos.

## Requisitos de implantação

- O nginx DEVE definir `proxy_set_header X-Real-IP $remote_addr;`. Sem isso o limite por IP agrupa todo mundo pelo IP do proxy.
- A porta da API só pode ser alcançável pelo proxy. O auxiliar de IP do cliente só confia em `X-Real-IP` quando a conexão vem de loopback/rede privada; CGNAT/Tailscale (100.64/10) não conta como privado.
- O limite por IP também conta logins bem-sucedidos. NAT grande (escritório, operadora) pode precisar de teto maior.
- O limite por e-mail permite que um atacante trave o login de uma conta por 15 min. É inerente à spec §4.
- O limitador é em memória e vale para uma instância só (teto de 10 mil chaves; acima dele, varredura total no máximo uma vez por Janela/4).

## Decisões para os próximos planos

- Worker: inserir `conferido_em = now()` ao gravar em `robos_execucoes`, ou portar `conferir_robos` com cuidado: ela varre a cada 6 h as linhas com `conferido_em` nulo e sobrescreveria `resposta`.
- Advisory lock: a chave única com `hashtext` divide o espaço de chaves com as RPCs existentes (`pg_advisory_xact_lock(hashtext(...))`). Usar a forma de duas chaves, com um namespace do worker.
- Migrações: rodar só no `api` (ou usar o Provider do goose com locker de sessão). `api` e `worker` subindo juntos disputam a migração.
- `usuarios` não tem coluna de tipo de conta e `Entrar` sempre cria sessão `painel`. Decidir no plano da Vessel como manter clientes fora do login do painel.
- `email_confirmado_em` é ignorado no login (o GoTrue bloqueia e-mail não confirmado quando a confirmação está ligada). Decidir após a consulta 18 do levantamento.
- `sessoes.origem` (IP/user-agent) da spec §4 ainda não existe.
- `sqlc` (spec §3.1) ainda não foi adotado; hoje é SQL cru via pgx. Decidir antes dos planos de domínio.
- Timeouts do servidor HTTP: resolvidos no Plano 3 (ver a seção abaixo).
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
- Idle/WriteTimeout: resolvidos no Plano 3.
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

## Plano 3 — edges do core (Bling, Meta, push de vendas, webhooks)

### Variáveis de ambiente novas
- `CORE_URL` (padrão `https://core.rbvcompany.com`) e `CORE_API_TOKEN` — api e worker. No core, o consumidor desta API precisa estar em `CORE_API_TOKENS` com os escopos `bling` e `meta` (`AutenticaConsumidor`). O token é opcional na carga (a API sobe no ensaio sem core), mas sem ele as rotas do core respondem 503 e o push de vendas termina com erro (Ruling 28): esquecer só aparece na primeira chamada.
- `HOSTS_DE_MIDIA` (api): host(s) de onde o meta-proxy aceita imagem/vídeo, separados por vírgula; a config aplica minúsculas e `trim` uma vez. Vazio = nenhum upload. O mesmo host vai para `META_HOSTS_MIDIA` do core (quem baixa a imagem é o core).
- `SHOPIFY_WEBHOOK_SEGREDOS` (api, lista por vírgula): segredo do admin da loja, segredo do app e o `segredo` do destino desta API em `CORE_SHOPIFY_DESTINOS`. Vazio = 401 em tudo.
- `CHATWOOT_WEBHOOK_SEGREDO` (api). Vazio = 401 em tudo.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (worker): OBRIGATÓRIAS, os MESMOS valores de `segredos_de_cron` (`vapid_public_key`, `vapid_private_key`, `vapid_subject`), copiados por quem tem acesso. Trocar a chave invalida todas as inscrições de push. `VAPID_SUBJECT` não tem padrão no código; a edge antiga caía em `mailto:breno@rbvcompany.com` quando faltava: sem ele o push falha alto.

### nginx (location `/api`)
- As rotas Go NÃO têm o prefixo `/api`: o `proxy_pass` precisa remover o prefixo (`location /api/ { proxy_pass http://127.0.0.1:8080/; }`, com a barra final). Cada `location` própria (webhooks do Chatwoot, limites de corpo, prazos) precisa do SEU `proxy_pass` com a barra final: ele não é herdado do `location /api/`.
- `proxy_set_header X-Real-IP $remote_addr;`: o limite de 600 req/min por IP dos 5 webhooks usa SÓ esse cabeçalho e só o aceita quando o par TCP é o nginx (loopback/rede privada); `X-Forwarded-For` e `True-Client-IP` do cliente nunca contam. ATENÇÃO: o nginx só herda os `proxy_set_header` do nível acima se a `location` NÃO declarar nenhum; acrescentar qualquer `proxy_set_header` numa `location` própria derruba o `X-Real-IP` ali em silêncio, e todos os webhooks passam a dividir UM balde (o IP do proxy): ~10 req/s de um anônimo bastam para devolver 429 ao fan-out do core e ao Chatwoot. Repita o `proxy_set_header X-Real-IP $remote_addr;` em cada `location` que tenha cabeçalho próprio.
- Com CDN/Cloudflare na frente, `$remote_addr` seria o IP da CDN: restaurar o IP do cliente ANTES (`set_real_ip_from <faixas da CDN>; real_ip_header CF-Connecting-IP;` ou `X-Forwarded-For` com `real_ip_recursive on`), só com as faixas da própria CDN em `set_real_ip_from`.
- Rotas novas: `/api/bling-proxy`, `/api/meta-proxy`, `/api/insights-ao-vivo`, `/api/serie-novos-dia`, `/api/contar-collabs`, `/api/eu/canais` (sessão) e `/api/receber-webhook-pedido-shopify`, `-checkout`, `-abandono`, `/api/receber-webhook-chatwoot`, `/api/receber-opt-out-chatwoot` (públicas, só POST; outro método = 405).
- Limites de corpo (a API também limita; o nginx corta antes): `client_max_body_size 5m;` em `/api/receber-webhook-pedido-shopify`, `-checkout` e `-abandono`; `1m` em `/api/receber-webhook-chatwoot` e `/api/receber-opt-out-chatwoot`; `64k` em `/api/bling-proxy`, `/api/meta-proxy`, `/api/insights-ao-vivo`, `/api/serie-novos-dia` e `/api/contar-collabs`.
- SEGREDO DO CHATWOOT NO LOG DO NGINX (`?token=`), em DOIS lugares:
  1. Log de acesso: `log_format` só pode ser declarado em `http {}` (em `location` o `nginx -t` falha); defina lá, por exemplo, `log_format semquery '$remote_addr [$time_local] "$request_method $uri" $status';` e, nas duas `location` (`/api/receber-webhook-chatwoot` e `/api/receber-opt-out-chatwoot`), `access_log /var/log/nginx/chatwoot.log semquery;` (ou `access_log off;`). Esse formato NÃO pode conter `$args`, `$query_string`, `$arg_token`, `$request_uri` nem `$request` (este traz a query).
  2. Log de erro: o nginx acrescenta `request: "POST /…?token=…"` e `upstream: "http://…?token=…"` a TODA linha de `error_log` de nível error (API fora do ar, timeout do upstream, 413 etc.), e nenhum `log_format` controla isso. Prescrição: dentro dessas duas `location`, `error_log /var/log/nginx/chatwoot-erro.log crit;` (só falhas gravíssimas) ou tratar o `error.log` como dado sensível (acesso restrito, rotação curta). Sem uma das duas, o segredo vai parar em `error.log`.
- Prazos: o servidor Go usa `ReadHeaderTimeout 10s`, `ReadTimeout 30s`, `WriteTimeout 150s`, `IdleTimeout 120s`. Prazos por requisição: `meta-proxy` 25 s (45 s imagem, 75 s vídeo), `insights-ao-vivo` e `serie-novos-dia` 90 s, `contar-collabs` 120 s (N perfis x até 5 páginas em série); cada chamada à Meta dessas três rotas ainda tem teto de 60 s, que nunca estende o prazo da rota. `proxy_read_timeout` do nginx deve ficar ACIMA do prazo: `130s` em `/api/contar-collabs`, `100s` nas demais rotas da Meta (80 s no mínimo para o vídeo); `proxy_send_timeout` padrão.

### Chatwoot
- O Chatwoot registra a URL com `?token=` no PRÓPRIO log em qualquer resposta não-2xx (inclusive o 500 por falha de banco): o segredo está nos logs dele. Tratar esses logs como sensíveis.
- Versões novas do Chatwoot suportam webhook assinado (`secret:`). Conferir a versão implantada antes da virada: o Ruling 18 (segredo na query) pode estar desatualizado e a assinatura seria melhor que o `?token=`.
- O Ruling 15 (500 em erro de banco) NÃO recupera eventos do Chatwoot: não há retry de webhook de conta no upstream. Não contar com isso; o evento perdido fica perdido.

### Shopify (fan-out do core)
- O core re-assina o corpo com o segredo do destino e preserva os cabeçalhos `X-Shopify-*` (o `X-Shopify-Event-Id` é a chave de replay). `CORE_SHOPIFY_FANOUT` está dormente hoje: nada chega até ser ligado no dia da virada.

### Push de vendas (worker)
- Tarefas `enviar-push-vendas-07h` (cron `0 10 * * *` UTC) e `enviar-push-vendas-22h` (`0 1 * * *` UTC): os nomes de produção; a tela de saúde as casa por `robos_esperados` (`enviar-push-vendas%`).
- A VPS precisa de saída IPv4 para o Web Push. Com DNS64 os endpoints resolvem para `64:ff9b::/96`, o discador seguro recusa (SSRF) e a tarefa falha ALTO com `nenhum_push_entregue`.
- O cliente HTTP do push herda o discador seguro (`Dialer.Control`); nunca configurar `InsecureSkipVerify` nem trocar o cliente.

### Dia da virada (Plano 8)
- Core: três destinos em `CORE_SHOPIFY_DESTINOS`, todos com o mesmo `segredo` (que entra em `SHOPIFY_WEBHOOK_SEGREDOS`): `/api/receber-webhook-pedido-shopify` (`orders/create`, `orders/paid`, `orders/updated`), `/api/receber-webhook-checkout` (`checkouts/create`) e `/api/receber-webhook-abandono` (`checkouts/create`, `checkouts/update`, `orders/create`, `orders/paid`, `orders/cancelled`); remover os webhooks antigos (que apontam para as edges) na Shopify no MESMO momento e ligar `CORE_SHOPIFY_FANOUT=true` (`vessel-core-go/docs/migracao-core/SHOPIFY.md`, "Ordem de virada", passo 7).
- Chatwoot: `CRM_EVENT_WEBHOOK_URL` e o webhook padrão "Message created" para as URLs novas, com o mesmo `?token=` (ou a assinatura, se a versão suportar).
- `estoque-do-site` NÃO foi portado: desligado em produção em 2026-10-08, o core assumiu o estoque; nada a trocar.

### Premissas a conferir antes do corte
- O contrato do core foi lido de `vessel-core-go` no commit `168882e29` (Ruling 34). O core em produção pode estar em outra versão: reconferir `X-Core-Origem` (`bling`/`proxy`) e os códigos de erro (401/403/429) antes da virada; se mudarem, bling-proxy e meta-proxy classificam errado.
- `bling_pedido_vendedor.pedido_id`: o tipo não foi confirmado; conferir no banco restaurado (o push de vendas junta por ele).
- Ids e campos assumidos nas tabelas do banco restaurado: `accounts.id`/`instagram_id`/`ad_account_id`, `profiles.features`/`escopo_por_equipe`, `bling_lojas.loja_id`, `bling_pedido_nota.nota_situacao`, `webhooks_recebidos`, `checkout_*` (funções SQL do abandono): conferir no ensaio do Plano 2.

### Pendências para os próximos planos
- Purga de `webhooks_recebidos` com mais de 30 dias (plano de crons).
- Unificar `Ator.PodeModulo` (`profiles.features`) com `Ator.Pode` (`permissions`) no plano de domínios.
- Os 3 coletores Meta de cron (`coletar-dados`, `coletar-dados-hora`, `conteudo-espelho`) são do Plano 4, junto com o disparo imediato do abandono.
