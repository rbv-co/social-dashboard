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
- `CORE_URL` (padrão `https://core.rbvcompany.com`) e `CORE_API_TOKEN` — api e worker. No core, o consumidor desta API precisa estar em `CORE_API_TOKENS` e ter entrada em `CORE_API_ESCOPOS` com `bling` e `meta` (`AutenticaConsumidor`). ATUALIZADO no Plano 4: o core de produção agora IMPÕE `CORE_API_ESCOPOS` por consumidor (sem entrada = 403 `escopo_negado`); o modelo vigente, com o consumidor próprio do worker, está em "Variáveis de ambiente do Plano 4" abaixo. O token é opcional na carga (a API sobe no ensaio sem core), mas sem ele as rotas do core respondem 503 e o push de vendas termina com erro (Ruling 28): esquecer só aparece na primeira chamada.
- `HOSTS_DE_MIDIA` (api): host(s) de onde o meta-proxy aceita imagem/vídeo, separados por vírgula; a config aplica minúsculas e `trim` uma vez. Vazio = nenhum upload. O mesmo host vai para `META_HOSTS_MIDIA` do core (quem baixa a imagem é o core).
- `SHOPIFY_WEBHOOK_SEGREDOS` (api, lista por vírgula): segredo do admin da loja, segredo do app e o `segredo` do destino desta API em `CORE_SHOPIFY_DESTINOS`. Vazio = 401 em tudo.
- `CHATWOOT_WEBHOOK_SEGREDO` (api). Vazio = 401 em tudo.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (worker E `api`, desde o Plano 4): OBRIGATÓRIAS, os MESMOS valores de `segredos_de_cron` (`vapid_public_key`, `vapid_private_key`, `vapid_subject`), copiados por quem tem acesso. Trocar a chave invalida todas as inscrições de push. `VAPID_SUBJECT` não tem padrão no código; a edge antiga caía em `mailto:breno@rbvcompany.com` quando faltava: sem ele o push falha alto. `CORE_URL` precisa ser https (http só para localhost/127.0.0.1/::1): a API recusa subir com outra coisa, pois o Bearer viajaria em claro. `WORKER_TAREFAS_DESLIGADAS` (opcional, lista de nomes ou `*`) tira tarefas do worker (ensaio); nome que não seja `*` nem de tarefa registrada faz o worker RECUSAR subir, listando os desconhecidos e os válidos (erro de digitação não mantém o push ligado).

### nginx (location `/api`)
- As rotas Go NÃO têm o prefixo `/api`. Só o `location /api/` genérico usa `proxy_pass http://127.0.0.1:8080/;` (barra final troca o prefixo `/api/` por `/`). Numa `location` PRÓPRIA (`location = /api/receber-webhook-chatwoot`) a barra final sozinha troca o caminho INTEIRO por `/` (o upstream recebe `POST /?token=…` e o chi responde 404, verificado): cada uma nomeia o caminho de destino, `proxy_pass http://127.0.0.1:8080/receber-webhook-chatwoot;` (a query é repassada). O `proxy_pass` não é herdado: toda `location` própria tem o seu.
- `proxy_set_header X-Real-IP $remote_addr;` no nível `server {}` (e `Host`): o nginx só herda os `proxy_set_header` do nível acima se a `location` NÃO declarar nenhum, e `location` irmã NÃO herda de `location /api/`. O limite de 600 req/min por IP dos 5 webhooks usa SÓ esse cabeçalho e só o aceita quando o par TCP é o nginx (loopback/rede privada); `X-Forwarded-For` e `True-Client-IP` do cliente nunca contam, e o nginx sobrescreve um `X-Real-IP` forjado pelo cliente. Sem o `X-Real-IP` num webhook, todos dividem UM balde (o IP do proxy): ~10 req/s de um anônimo bastam para devolver 429 ao fan-out do core e ao Chatwoot. Toda `location` que declare um `proxy_set_header` próprio precisa REPETIR o `X-Real-IP` (e o `Host`).
- Esqueleto verificado com `nginx -t` e requisições reais (nginx:alpine + upstream de teste que imprime método, caminho com query e `X-Real-IP`):

```nginx
http {
  log_format semquery '$remote_addr [$time_local] "$request_method $uri" $status';
  server {
    listen 80;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    client_max_body_size 64k;

    location /api/ { proxy_pass http://127.0.0.1:8080/; }          # catch-all: troca /api/ por /

    location = /api/receber-webhook-chatwoot {                       # idem /api/receber-opt-out-chatwoot
      client_max_body_size 1m;
      access_log /var/log/nginx/chatwoot.log semquery;
      error_log  /var/log/nginx/chatwoot-erro.log crit;
      proxy_pass http://127.0.0.1:8080/receber-webhook-chatwoot;
    }
    location = /api/receber-webhook-pedido-shopify {                 # idem -checkout e -abandono
      client_max_body_size 5m;
      proxy_pass http://127.0.0.1:8080/receber-webhook-pedido-shopify;
    }
    location = /api/contar-collabs {                                 # lenta: acima do prazo de 120 s da API
      proxy_read_timeout 130s;
      proxy_pass http://127.0.0.1:8080/contar-collabs;
    }
    location = /api/bling-proxy {                                    # prazo de 90 s da API; cabeçalho próprio = repetir o X-Real-IP
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_read_timeout 100s;
      proxy_pass http://127.0.0.1:8080/bling-proxy;
    }
  }
}
```
  Resultado (resumo; saída completa no relatório do Task 9): `POST /api/receber-webhook-chatwoot?token=…` com `X-Real-IP: 6.6.6.6` forjado chegou ao upstream como `POST /receber-webhook-chatwoot?token=… X-Real-IP=<IP real do cliente>`; `/api/contar-collabs?x=1` como `POST /contar-collabs?x=1`; `/api/bling-proxy` como `POST /bling-proxy`; `/api/auth/entrar?a=b` pelo catch-all como `POST /auth/entrar?a=b`. Variante errada 1 (`proxy_pass http://…:8080/;` na `location` própria): upstream recebeu `POST /?token=…`. Variante errada 2 (X-Real-IP só dentro de `location /api/`): o webhook chegou com `X-Real-IP=None`.
- Com CDN/Cloudflare na frente, `$remote_addr` seria o IP da CDN: restaurar o IP do cliente ANTES (`set_real_ip_from <faixas da CDN>; real_ip_header CF-Connecting-IP;` ou `X-Forwarded-For` com `real_ip_recursive on`), só com as faixas da própria CDN em `set_real_ip_from`.
- Rotas novas: `/api/bling-proxy`, `/api/meta-proxy`, `/api/insights-ao-vivo`, `/api/serie-novos-dia`, `/api/contar-collabs`, `/api/eu/canais` (sessão) e `/api/receber-webhook-pedido-shopify`, `-checkout`, `-abandono`, `/api/receber-webhook-chatwoot`, `/api/receber-opt-out-chatwoot` (públicas, só POST; outro método = 405).
- Limites de corpo (a API também limita; o nginx corta antes): `client_max_body_size 5m;` em `/api/receber-webhook-pedido-shopify`, `-checkout` e `-abandono`; `1m` em `/api/receber-webhook-chatwoot` e `/api/receber-opt-out-chatwoot`; `64k` em `/api/bling-proxy`, `/api/meta-proxy`, `/api/insights-ao-vivo`, `/api/serie-novos-dia` e `/api/contar-collabs`.
- SEGREDO DO CHATWOOT NO LOG DO NGINX (`?token=`), em DOIS lugares:
  1. Log de acesso: `log_format` só pode ser declarado em `http {}` (em `location` o `nginx -t` falha); defina lá, por exemplo, `log_format semquery '$remote_addr [$time_local] "$request_method $uri" $status';` e, nas duas `location` (`/api/receber-webhook-chatwoot` e `/api/receber-opt-out-chatwoot`), `access_log /var/log/nginx/chatwoot.log semquery;` (ou `access_log off;`). Esse formato NÃO pode conter `$args`, `$query_string`, `$arg_token`, `$request_uri` nem `$request` (este traz a query).
  2. Log de erro: o nginx acrescenta `request: "POST /…?token=…"` e `upstream: "http://…?token=…"` a TODA linha de `error_log` de nível error (API fora do ar, timeout do upstream, 413 etc.), e nenhum `log_format` controla isso. Prescrição: dentro dessas duas `location`, `error_log /var/log/nginx/chatwoot-erro.log crit;` (só falhas gravíssimas) ou tratar o `error.log` como dado sensível (acesso restrito, rotação curta). Sem uma das duas, o segredo vai parar em `error.log` (verificado: com o upstream fora do ar a linha `[error] … request: "POST /api/receber-webhook-chatwoot?token=…", upstream: "http://…?token=…"` aparece; com `error_log … crit;` na `location` ela não aparece).
- Prazos: o servidor Go usa `ReadHeaderTimeout 10s`, `ReadTimeout 30s`, `WriteTimeout 150s`, `IdleTimeout 120s`. Prazos por requisição: `meta-proxy` 25 s (45 s imagem, 75 s vídeo), `insights-ao-vivo` e `serie-novos-dia` 90 s, `contar-collabs` 120 s (N perfis x até 5 páginas em série); cada chamada à Meta dessas três rotas ainda tem teto de 60 s, que nunca estende o prazo da rota. `bling-proxy` 90 s (usuário limitado a lojas faz uma chamada ao core por loja, até 25 s cada). `proxy_read_timeout` do nginx deve ficar ACIMA do prazo: `130s` em `/api/contar-collabs`, `100s` em `/api/bling-proxy`, `/api/insights-ao-vivo`, `/api/serie-novos-dia` e `/api/meta-proxy` (80 s no mínimo para o vídeo); o padrão do nginx (60 s) derrubaria essas rotas antes do prazo da API. `proxy_send_timeout` padrão.

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
- Ordem de subida e parada: SUBSTITUÍDAS no Plano 4 (o worker não migra mais e a parada dele leva 45 s): ver "Plano 4 — Subida e parada" abaixo. Para o `api` sozinho, o `Shutdown` espera até 15 s: `stop_grace_period` de pelo menos 20 s.
- Push de vendas duplicado: ao subir o worker, DESAGENDAR no Supabase os jobs do pg_cron `push-vendas-07h` e `push-vendas-22h` (`select cron.unschedule(...)`); senão a edge antiga e o worker mandam o mesmo push duas vezes.
- ENSAIO ENVIA PUSH DE VERDADE: o banco restaurado traz `push_subs` de produção; `api worker` com `VAPID_*` preenchidas manda notificações REAIS a pessoas reais no horário do cron. No ensaio, subir o worker SEM `VAPID_*` (o push falha alto, sem enviar) e/ou com `WORKER_TAREFAS_DESLIGADAS=enviar-push-vendas-07h,enviar-push-vendas-22h` (ou `*` para nenhuma tarefa; o worker loga as desligadas ao subir). Só tirar essa variável no dia da virada. Com as tarefas do Plano 4 isso vale para TODAS as que enviam algo: ver "Plano 4 — Ensaio" abaixo.
- Core: três destinos em `CORE_SHOPIFY_DESTINOS`, todos com o mesmo `segredo` (que entra em `SHOPIFY_WEBHOOK_SEGREDOS`): `/api/receber-webhook-pedido-shopify` (`orders/create`, `orders/paid`, `orders/updated`), `/api/receber-webhook-checkout` (`checkouts/create`) e `/api/receber-webhook-abandono` (`checkouts/create`, `checkouts/update`, `orders/create`, `orders/paid`, `orders/cancelled`); remover os webhooks antigos (que apontam para as edges) na Shopify no MESMO momento e ligar `CORE_SHOPIFY_FANOUT=true` (`vessel-core-go/docs/migracao-core/SHOPIFY.md`, "Ordem de virada", passo 7).
- Chatwoot: `CRM_EVENT_WEBHOOK_URL` e o webhook padrão "Message created" para as URLs novas, com o mesmo `?token=` (ou a assinatura, se a versão suportar).
- `estoque-do-site` NÃO foi portado: desligado em produção em 2026-10-08, o core assumiu o estoque; nada a trocar.

### Verificar no ensaio e com o core real antes da virada
- Schema: com o banco restaurado, rodar `api worker conferir` (Plano 4): lista cada coluna, índice único (alvo de `ON CONFLICT`) e função SQL que as tarefas do worker presumem e o banco restaurado não tem; saída 0 = confere. Cobre a maior parte do item de tipos/migrações abaixo; o que ele não cobre (tipos, `pedido_id` etc.) segue manual.
- Banco: o restore NÃO traz RLS nem policies (CORRIGIDO: esta nota dizia que as tabelas restauradas mantinham RLS ligado). `ops/migracao/limpar-dump.mjs` remove `enable/force row level security`, as policies e os GRANTs dos papéis do Supabase, e `ops/migracao/ensaio.sh` (linha 162, etapa 5c) FALHA se o alvo tiver tabela com RLS ligada (ou policy). Então o papel da API não precisa de `BYPASSRLS`; basta ser dono das tabelas (ou ter os privilégios), como no `api-db`. Conferir na VPS: `ops/vps/api-db/LEIA-ME.md`, "Verificar na VPS", item 1 (`relrowsecurity` = 0).
- Tipos de coluna: `profiles.features text[]`, `accounts.id` (uuid ou text; o código compara por `id::text`), `bling_pedido_nota.nota_situacao smallint`, `bling_pedido_vendedor.pedido_id` (não confirmado), `bling_pedido_ajuste_valor.pedido_id bigint`, `push_subs`, `push_preferencias`, `equipes.canal_loja_id`, `bling_lojas`, `canais_grupos_membros`.
- Migrações que já precisam estar aplicadas em produção: `cart_token` anulável (2026-09-18), índice único parcial de `evento_shopify_id` (2026-10-08), `chatwoot_eventos` aceitando `qualified_lead` (2026-10-05), `contatos_sem_mensagem` com `telefone` único, `shopify_pedidos` com conflito em `id`.
- Funções SQL do abandono: nomes dos parâmetros `p_*` conferem com as chamadas (argumentos nomeados) e as sobrecargas `marcar_checkout_comprou(text)` e `(text,text,text)` coexistem (a chamada precisa resolver para a certa).
- `robos_execucoes` e a tela de saúde: o nome `enviar-push-vendas-*` casa com o `LIKE enviar-push-vendas%` dos robôs esperados; conferir uma execução real aparecendo na tela.
- Core real: escopos `bling` e `meta` no consumidor; valores de `X-Core-Origem` (`bling`/`proxy`); formato da query do Bling; campo `erro` das respostas da Meta, `Retry-After` do 429, `access_token` mascarado em `paging.next`, caminho com `/` inicial; `META_HOSTS_MIDIA` do core = `HOSTS_DE_MIDIA` da API; o fan-out re-assina e preserva `X-Shopify-Event-Id` e `X-Shopify-Topic`; o core em produção é o porte Go (PR #223) ou o PHP.
- IPs de origem: ver o IP do core e o do Chatwoot COMO O NGINX OS VÊ (`$remote_addr`): cada um tem o seu balde de 600/min; se vierem de um IP só (ex.: rede Docker), ficam num balde compartilhado.
- Limite da Meta: 120 req/min por consumidor no core contra as 11 chamadas paralelas de cada `insights-ao-vivo`: algumas telas abertas ao mesmo tempo estouram e recebem 429 (a API repete até 3 vezes).
- Saída IPv4 na VPS para o Web Push (DNS64 derruba o push; ver acima).

### Premissas a conferir antes do corte
- O contrato do core foi lido de `vessel-core-go` no commit `168882e29` (Ruling 34); o Plano 4 releu em `e8a06e8c3` e a produção já anda em `core-go` mais novo: ver "Plano 4 — Contrato do core" abaixo. O core em produção pode estar em outra versão: reconferir `X-Core-Origem` (`bling`/`proxy`) e os códigos de erro (401/403/429) antes da virada; se mudarem, bling-proxy e meta-proxy classificam errado.
- `bling_pedido_vendedor.pedido_id`: o tipo não foi confirmado; conferir no banco restaurado (o push de vendas junta por ele).
- Ids e campos assumidos nas tabelas do banco restaurado: `accounts.id`/`instagram_id`/`ad_account_id`, `profiles.features`/`escopo_por_equipe`, `bling_lojas.loja_id`, `bling_pedido_nota.nota_situacao`, `webhooks_recebidos`, `checkout_*` (funções SQL do abandono): conferir no ensaio do Plano 2.

### Pendências para os próximos planos
- Purga de `webhooks_recebidos` com mais de 30 dias: feita no Plano 4 (`faxina-da-api`).
- Unificar `Ator.PodeModulo` (`profiles.features`) com `Ator.Pode` (`permissions`) no plano de domínios.
- Os 3 coletores Meta de cron (`coletar-dados`, `coletar-dados-hora`, `conteudo-espelho`): portados no Plano 4 (o disparo imediato do abandono continua NÃO portado; ver a seção do Plano 4).

## Plano 4 — worker e tarefas agendadas

### O que o worker roda
- 20 tarefas, com o nome de PRODUÇÃO em `robos_execucoes` (a tela de saúde casa `robos_esperados` pelo prefixo mais longo): `abandono-de-checkout`, `auditar-dados`, `coletar-dados-07h`/`-12h`/`-18h`/`-2359` (uma linha POR CONTA: `coletar-dados-07h · <conta>`), `conferir-robos`, `conteudo-espelho`, `conteudo-hora-h`, `enviar-mensagem-abandono`, `enviar-push-frota`, `enviar-push-saldo-08h`, `enviar-push-vendas-07h`/`-22h`, `enviar-relatorio-hora`, `fabrica-purga`, `faxina-da-api` (nova), `meta-hora`, `meta-hora-retentativa-00h`, `vessel-rd-station`. `api worker listar` mostra nome, agenda (UTC), prazo e se está DESLIGADA.
- Agenda em UTC, igual à de `cron.job`; execução perdida com o worker fora do ar NÃO é recuperada (como no pg_cron). Cada execução roda sob `pg_try_advisory_lock(0x57524B52, hashtext(<trava>))` numa conexão própria: dois workers ao mesmo tempo (deploy sobreposto) nunca executam a mesma tarefa juntos; o segundo pula e só loga (a execução pulada NÃO grava linha em `robos_execucoes`; aparece em `/metricas`, campo `puladas`).
- Envio para fora (push, WhatsApp, template do Chatwoot) passa pelo livro `envios_feitos` (migração 00003) ou por reserva na própria linha (`vessel_rd_envios`, `conteudo_reivindicar_hora_h`, fila do abandono): repetir a tarefa na mesma janela não reenvia. Envio ambíguo (caiu depois de mandar) fica reservado: a mensagem pode ter saído, então não sai de novo (exceção: a conversão da RD, ver "Comportamentos").

### Plano 4 — Subida e parada (worker)
- SERVIÇO PRÓPRIO: o worker é um serviço/contêiner `worker` do compose, separado do `api`, com o MESMO binário `api` (`command: ["api", "worker"]`; o Dockerfile e o compose ainda não existem: são do Plano 8), na rede `api_net` (fala com o `api-db`). Não publica porta no host.
- ORDEM: `api migrar` ANTES de subir `api` e `worker` (um comando só, uma vez por versão). O worker NÃO migra (substitui a nota do Plano 3 "os dois executam goose.Up"): ele confere `envios_feitos` e `robos_execucoes` e RECUSA subir (saída 1, log "rode `api migrar`") se faltarem; `api` e `worker` subindo juntos disputariam o goose, que não tem trava.
- PARADA: `stop_grace_period: 60s` no serviço do worker. No SIGTERM ele para de agendar, espera 30 s as tarefas em andamento, cancela o contexto delas e espera mais 15 s (45 s no pior caso); o padrão de 10 s do Docker mataria no meio de um envio. O `api` segue com o `Shutdown` de 15 s.
- `WORKER_TAREFAS_DESLIGADAS`: lista por vírgula de nomes de tarefa, ou `*` (todas). Desliga SEM desregistrar: a tarefa não é agendada, mas `api worker rodar <t> --forcar` ainda a roda. Nome desconhecido (erro de digitação) faz TODO subcomando de `api worker` recusar (saída 1), listando os desconhecidos e os válidos: erro de digitação nunca mantém ligado o que se quis desligar. A desligada também é conferida na hora de disparar.
- Linha de comando (dentro do contêiner: `docker compose exec worker api worker ...`):
  - `api worker` (sem argumento): agenda tudo e fica no ar.
  - `api worker listar`: saída 0.
  - `api worker rodar <tarefa> [--forcar]`: executa UMA vez, com trava, prazo e linha em `robos_execucoes`. Saída 0 = ok; 1 = a tarefa falhou, OU (no `coletar-dados-*`) alguma conta falhou; 2 = uso errado (sem nome, tarefa desconhecida, ou desligada sem `--forcar`); 3 = pulada (outra execução segura a trava).
  - `api worker conferir`: confere o schema restaurado (ver "Ensaio"); 0 = confere; 1 = lista o que falta (ou erro de banco).
  - `api worker saude`: healthcheck do compose; faz `GET http://$WORKER_ADDR/saude` SEM abrir o banco; 0 = agendando; 1 = fora do ar, parado ou `WORKER_ADDR` vazio.
  - Subcomando desconhecido: saída 2.
- `WORKER_ADDR` (ex.: `0.0.0.0:8081` DENTRO da rede do compose; nunca publicar): serve `GET /saude` (200 agendando, 503 parado) e `GET /metricas` (JSON por tarefa: agenda, desligada, execuções, falhas, puladas, último erro). São SÓ LEITURA. NÃO existe rota HTTP que dispare tarefa (execução manual só por `docker compose exec`).
- Healthcheck do compose: `test: ["CMD", "api", "worker", "saude"]` (precisa de `WORKER_ADDR` no ambiente do contêiner).
- VOLUME: o worker monta o MESMO volume de arquivos da API em `ARQUIVOS_DIR` e a pasta `$ARQUIVOS_DIR/fabrica-criativos` PRECISA EXISTIR: sem ela `fabrica-purga` (diária, 04h17 UTC) FALHA TODO DIA com "pasta-base ausente: volume montado?" (de propósito: não marca nada como purgado sem apagar do disco). Criar/montar o volume e a pasta antes da virada.

### Variáveis de ambiente do Plano 4, por tarefa
Valem para o serviço `worker`, salvo onde diz `api`. Todas vêm de variáveis de ambiente do serviço (arquivo `.env` com modo 600), nunca no repositório. `DATABASE_URL` é de todos (sem ela nada sobe). Segredo com MENOS de 8 caracteres NÃO é mascarado nos erros e no log (`worker.Limpar` só troca valores com 8+): o worker avisa no boot a QUANTIDADE (nunca o valor); use segredos mais longos.

| Variável | Quem usa | Observação |
|---|---|---|
| `DATABASE_URL` | `api` e `worker` | obrigatória |
| `CORE_URL` | `api` e `worker` | https (http só para localhost/127.0.0.1/::1); padrão `https://core.rbvcompany.com` |
| `CORE_API_TOKEN` | `api` e `worker` | RECOMENDADO um consumidor PRÓPRIO do worker no core: o core limita 120 chamadas da Meta por minuto POR CONSUMIDOR e o worker anda a 600 ms por chamada (~100/min); com o token da API, as telas ao vivo e o worker disputam o mesmo balde e levam 429. Sem token, as tarefas do core falham ("core: CORE_API_TOKEN ausente") |
| escopos do consumidor | no core | o core de produção passou a impor `CORE_API_ESCOPOS` por consumidor (sem entrada = 403 `escopo_negado`; hoje `social-dashboard` = `bling\|shopify\|meta\|espelho`). O consumidor do worker precisa de `meta` (coletas, saldo, espelho, auditoria) e de `bling` (push de vendas); conferir no core se as rotas da Meta também pedem `espelho` (o grupo de limite delas se chama "espelho") |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `api` E `worker` | OBRIGATÓRIAS nos dois (os mesmos valores de `segredos_de_cron`). `VAPID_SUBJECT` (ex.: `mailto:...`) NÃO tem mais padrão: a edge caía em `mailto:breno@rbvcompany.com`; sem o valor o push falha alto. A rota `POST /avisar-decisao-de-reserva` (no `api`) também manda push e exige as três. Toda tarefa de push confere a VAPID ANTES de ler o core ou reservar envio. Trocar a chave invalida todas as inscrições. O boot do worker só AVISA VAPID inválida; as tarefas de push é que falham |
| `ZAPI_INSTANCE_ID`, `ZAPI_INSTANCE_TOKEN`, `ZAPI_TOKEN` | `enviar-relatorio-hora` | os dois primeiros vão no caminho da URL da Z-API; `ZAPI_TOKEN` é o Client-Token (cabeçalho). Os três são tratados como segredo |
| `RD_STATION_TOKEN` | `vessel-rd-station` | vazio = a tarefa falha ALTO com `rd_sem_token` (para desligar: `WORKER_TAREFAS_DESLIGADAS=vessel-rd-station`) |
| `CHATWOOT_URL`, `CHATWOOT_CONTA_ID`, `CHATWOOT_CAIXA_ID` (a caixa de entrada), `CHATWOOT_API_TOKEN`, `CHATWOOT_BOT_SECRET` | `enviar-mensagem-abandono` | as MESMAS variáveis da edge, copiadas dos segredos dela por quem tem acesso |
| `ENVIO_MODO`, `ENVIO_MODO_INICIO`, `ENVIO_MODO_PEDIDO`, `ENVIO_MODO_FOLLOWUP` | idem | `desligado` \| `seco` \| `lista` \| `ligado`; VAZIO = `desligado` (nasce tudo desligado: sem elas o robô roda "ok" e NÃO manda nada, sem erro nenhum; conferir o modo de cada passada no dia da virada) |
| `ENVIO_LIMITE_POR_RODADA`, `ENVIO_SO_PARA`, `ENVIO_MAX_HORAS`/`INICIO_MAX_HORAS`/`PEDIDO_MAX_HORAS`/`FOLLOWUP_MAX_HORAS`, `TEMPLATE_NOME`/`_INICIO`/`_PEDIDO`/`_FOLLOWUP`, `TEMPLATE_TEXTO*`, `TEMPLATE_IDIOMA`, `LINK_BASE`, `ABANDONO_TRAVA_CRUZADA`, `RESERVAR_AVISO_CHATWOOT` | idem | como na edge |
| (validação do abandono) | idem | por passada que NÃO esteja `desligado`: `ENVIO_LIMITE_POR_RODADA` inteiro de 1 a 100; `*_MAX_HORAS` inteiro a partir de 1; `LINK_BASE` vazio OU sem `/` no fim reprova (abandono, início e follow-up); fora do modo `seco` exigem-se `TEMPLATE_NOME`, `CHATWOOT_URL` com http(s), `CHATWOOT_CONTA_ID`, `CHATWOOT_CAIXA_ID` (inteiro) e `CHATWOOT_API_TOKEN`; no modo `lista`, `ENVIO_SO_PARA` não pode ser vazio; `RESERVAR_AVISO_CHATWOOT=true` exige `CHATWOOT_BOT_SECRET`. Ao reprovar a passada retorna `config_invalida` (nada é tocado) e a tarefa falha a cada rodada; o boot do worker só avisa o que `mensagens.Config` expõe hoje (`FOLLOWUP_APOS_HORAS`) |
| `ENVIO_ATRASO_MINUTOS` | idem | validada: NaN, infinito, negativo ou fração REPROVAM a configuração (na edge virava `NaN` sem validação); `0` vale. A validação roda na rodada (não no boot): a passada de abandono falha a cada minuto com `config_invalida` e não toca em nenhuma linha |
| `FOLLOWUP_APOS_HORAS` | idem | mesma regra: inteiro a partir de 0 (padrão 48); inválida = a passada de follow-up falha com `config_invalida`, sem agendar nada |
| `ALERT_WEBHOOK_URL` | `coletar-dados`, `auditar-dados` | OPCIONAL; vazio = só a linha em `data_integrity_checks`, que a tela já mostra. É segredo (mascarada) |
| `ARQUIVOS_DIR` | `fabrica-purga` | padrão `/var/lib/api/arquivos`; ver "VOLUME" acima |
| `WORKER_ADDR`, `WORKER_TAREFAS_DESLIGADAS` | `worker` | ver "Subida e parada" |

### Plano 4 — Ensaio: nada de envio de verdade
- O banco do ensaio é restaurado da PRODUÇÃO: contém `push_subs`, telefones de clientes, fila de abandono, `vessel_rd_envios` pendentes. Subir `api worker` com credenciais preenchidas manda push, WhatsApp e conversões REAIS a pessoas reais (o ensaio já mandaria push de vendas no Plano 3).
- Regra: o ensaio sobe com `WORKER_TAREFAS_DESLIGADAS=*` (nenhuma tarefa agendada) e SEM `VAPID_*`, `ZAPI_*`, `CHATWOOT_*`, `ENVIO_MODO*`, `RD_STATION_TOKEN` e `ALERT_WEBHOOK_URL` no ambiente; roda-se UMA tarefa por vez com `api worker rodar <tarefa> --forcar`, só as seguras abaixo. A rota `POST /avisar-decisao-de-reserva` do `api` também manda push real: sem `VAPID_*` ela responde 500 `vapid_nao_configurado` em vez de enviar; não suba o `api` do ensaio com `VAPID_*` preenchidas.
- Seguras (não falam com pessoas; escrevem só no banco do ensaio): `conferir-robos`, `faxina-da-api` (apaga linhas velhas do banco do ensaio), `abandono-de-checkout` (move linhas para a fila: muda dados do ensaio), `auditar-dados` (lê a Meta pelo core; sem `ALERT_WEBHOOK_URL`), `coletar-dados-07h`/`-12h`/`-18h`/`-2359`, `meta-hora`, `meta-hora-retentativa-00h`, `conteudo-espelho` (leem a Meta pelo core, só leitura, e gravam no banco do ensaio; gastam o limite de 120/min do consumidor: use o token do worker), `fabrica-purga` (APAGA arquivos do disco: só com `ARQUIVOS_DIR` apontando para uma cópia descartável).
- NUNCA no ensaio com credenciais: `enviar-push-vendas-07h`/`-22h`, `enviar-push-saldo-08h`, `enviar-push-frota`, `conteudo-hora-h` (push), `enviar-relatorio-hora` (WhatsApp no grupo), `enviar-mensagem-abandono` (template de WhatsApp a CLIENTES), `vessel-rd-station` (conversão na RD). Sem as credenciais, as de push, RD e relatório FALHAM ALTO sem enviar (`rd_sem_token`, VAPID inválida, `zapi_nao_configurada`): serve para provar que a falha é visível. O `enviar-mensagem-abandono` é diferente: com `ENVIO_MODO*` VAZIO todas as passadas ficam `desligado` e a tarefa roda `ok` e não manda nada, SEM erro (parece saudável); com um modo ligado e `CHATWOOT_*` incompleto a passada falha com `config_invalida`. Não use o resultado `ok` dele como prova de que a configuração está certa.
- Depois do restore: `api worker conferir` lista cada coluna, índice único (alvo de `ON CONFLICT`; índice parcial ou de expressão NÃO conta) ou função SQL que as tarefas presumem e o banco restaurado não tem. Várias dessas tabelas são anteriores às migrations e só têm DDL no banco real; os testes do Plano 4 usaram DDL reescrita do levantamento, então só este comando fecha a lacuna. Saída 0 = pode seguir. Além de coluna/índice/função, confere o TIPO das colunas de que o código depende (`tipo accounts.id: esperado uuid, achado text`; todo `*.account_id` uuid, `profiles.features` text[], `bling_pedido_*.pedido_id` bigint, `nota_situacao` smallint, `carrinho_eventos.cart_token` aceitando nulo...), o índice único de cada `ON CONFLICT` (chave exata; parcial, de expressão, inválido ou DEFERRABLE não vale; colunas de INCLUDE não contam), os parâmetros NOMEADOS e as colunas de retorno das funções da fila do abandono (`p_limite`, `p_max_horas`... e `token`, `iniciado_em`...) e as chamadas dos webhooks. Só lê (transação somente leitura), olha só o schema atual e NÃO faz mais nada do boot do worker (sem aviso de VAPID, sem validar `WORKER_TAREFAS_DESLIGADAS`, sem recusar por falta de tabela); se `api migrar` ainda não rodou, diz isso numa linha (`migrações: ...`) e continua conferindo o resto. Erro de conexão sai só com a classe, nunca com endereço. As listas estão em `api/cmd/api/conferir.go` (`colunasDoWorker`, `tiposDoWorker`, `unicosDoWorker`, `funcoesDoWorker`...) e foram derivadas das consultas SQL de todos os pacotes de `api/internal`: quem acrescentar consulta com tabela, coluna ou função nova acrescenta lá.
- ORDEM no ensaio: `api migrar` PRIMEIRO, depois `api worker conferir` (o `migrar` cria `envios_feitos`, `webhooks_recebidos`, `sessoes` e `usuarios`; antes dele o `conferir` lista `migrações:` como pendência).
- `robos_esperados` do banco restaurado: a migração goose `00004_robos_esperados_do_worker.sql` (roda no `api migrar`) cadastra as 6 fichas que faltavam, com `on conflict (robo) do nothing` (ficha que o dono já ajustou fica como está) e `horas_sem_sucesso_ate` folgado, todas NÃO críticas: `enviar-push-frota` 80 h (dias úteis 07h30; sexta→segunda são 72 h), `fabrica-purga` 30, `faxina-da-api` 30, `vessel-rd-station` 2, `abandono-de-checkout` 2, `conferir-robos` 1. Ela também APAGA a ficha `estoque-do-site` (o Core é o único escritor do estoque desde 2026-10-08; a ficha crítica ficaria vermelha para sempre). Sem a tabela (banco novo, testes) a migração não faz nada e não a cria; o Down apaga exatamente as 6 fichas (não restaura a do estoque). Depois do `api migrar` no banco restaurado, comparar `select robo from robos_esperados order by 1` com a lista que as migrations criam (`TestNomesCasamComRobosEsperados` lê `db/migrations/*.sql` e o trecho Up das migrações goose) e com os 20 nomes das tarefas: toda tarefa casa uma ficha pelo prefixo mais longo. Pode haver linhas que nunca passaram por migration.
- Tela de saúde: `TestNomesCasamComRobosEsperados` prova a regra do prefixo mais longo; no ensaio, conferir na tela uma execução real de cada nome (`api worker rodar <t> --forcar` deixa a linha).

### Plano 4 — Dia da virada do worker (ESCRITO, NÃO EXECUTADO)
No MESMO momento em que o worker sobe com as tarefas LIGADAS (`WORKER_TAREFAS_DESLIGADAS` vazia), desagendar no Supabase (`select cron.unschedule('<job>');`) CADA job que o worker substitui. Sem isso, o job antigo e o worker mandam push de vendas/saldo/frota, WhatsApp de abandono, conversões da RD e o relatório da Z-API DUAS vezes (o livro `envios_feitos` não enxerga o que o pg_cron/edge mandou).

| # | Job (`cron.job`) | Cron UTC | Nome em `robos_execucoes` | Destino |
|---|---|---|---|---|
| 1 | `abandono-de-checkout` | `* * * * *` | `abandono-de-checkout` | Plano 4 (desagendar) |
| 2 | `coletar-dados-07h` | `0 10 * * *` | `coletar-dados-07h · <conta>` | Plano 4 (desagendar) |
| 3 | `coletar-dados-12h` | `0 15 * * *` | `coletar-dados-12h · <conta>` | Plano 4 (desagendar) |
| 4 | `coletar-dados-18h` | `0 21 * * *` | `coletar-dados-18h · <conta>` | Plano 4 (desagendar) |
| 5 | `coletar-dados-2359` | `59 2 * * *` | `coletar-dados-2359 · <conta>` | Plano 4 (desagendar) |
| 6 | `coletar-dados-hora` | `5 * * * *` | `meta-hora` | Plano 4 (desagendar) |
| 7 | `coletar-dados-hora-retentativa-00h` | `30 3 * * *` | `meta-hora-retentativa-00h` | Plano 4 (desagendar) |
| 8 | `conferir-robos` | `2-59/5 * * * *` | `conferir-robos` | Plano 4 (desagendar) |
| 9 | `conteudo-espelho` | `*/30 * * * *` | `conteudo-espelho` | Plano 4 (desagendar) |
| 10 | `conteudo-hora-h` | `*/5 * * * *` | `conteudo-hora-h` | Plano 4 (desagendar) |
| 11 | `enviar-mensagem-abandono` | `* * * * *` | `enviar-mensagem-abandono` | Plano 4 (desagendar) |
| 12 | `enviar-pdf-checklist` | `*/10 * * * *` | (nenhum) | Plano 6: FICA no pg_cron |
| 13 | `enviar-push-frota` | `30 10 * * 1-5` | `enviar-push-frota` | Plano 4 (desagendar) |
| 14 | `enviar-relatorio-hora` | `10 * * * *` | `enviar-relatorio-hora` | Plano 4 (desagendar) |
| 15 | `fabrica-purga-diaria` | `17 4 * * *` | `fabrica-purga` | Plano 4 (desagendar) |
| 16 | `integridade-diaria` | `30 2 * * *` | `auditar-dados` | Plano 4 (desagendar) |
| 17 | `push-saldo-08h` | `0 11 * * *` | `enviar-push-saldo-08h` | Plano 4 (desagendar) |
| 18 | `push-vendas-07h` | `0 10 * * *` | `enviar-push-vendas-07h` | Plano 3 (desagendar) |
| 19 | `push-vendas-22h` | `0 1 * * *` | `enviar-push-vendas-22h` | Plano 3 (desagendar) |
| 20 | `vessel-espelhar-lista` | `*/3 * * * *` | (nenhum) | Plano 6: FICA |
| 21 | `vessel-lembretes` | `0 12 * * *` | (nenhum) | Plano 6: FICA |
| 22 | `vessel-log-de-carocos` | `4,14,24,34,44,54 * * * *` | (nenhum) | Plano 6: FICA |
| 23 | `vessel-rd-station` | `* * * * *` | `vessel-rd-station` | Plano 4 (desagendar) |
| 24 | `vessel-triagem-da-vaga` | `* * * * *` | (nenhum) | Plano 6: FICA |

- São 19 `cron.unschedule` (17 do Plano 4 + os 2 `push-vendas` do Plano 3): `abandono-de-checkout`, `coletar-dados-07h`, `coletar-dados-12h`, `coletar-dados-18h`, `coletar-dados-2359`, `coletar-dados-hora`, `coletar-dados-hora-retentativa-00h`, `conferir-robos`, `conteudo-espelho`, `conteudo-hora-h`, `enviar-mensagem-abandono`, `enviar-push-frota`, `enviar-relatorio-hora`, `fabrica-purga-diaria`, `integridade-diaria`, `push-saldo-08h`, `push-vendas-07h`, `push-vendas-22h`, `vessel-rd-station`.
- Ficam no pg_cron até o Plano 6 (Zoho/Storage): `enviar-pdf-checklist`, `vessel-espelhar-lista`, `vessel-lembretes`, `vessel-log-de-carocos`, `vessel-triagem-da-vaga`. O Plano 6 precisa entrar ANTES da virada, senão esses 5 param no corte.
- NÃO portados: `estoque-do-site` (o core é o único escritor do estoque; desligado em 2026-10-08, não volta) e `teste-auditar-agora` (resíduo de teste, não existe em produção). `guardar-copia-do-banco` NÃO é do pg_cron: é o robô da VPS (`coletor/vps/robos.cron`, 06h12 UTC); a mudança de alvo (papel `copia`, `COPIA_DB_SENHA`, `SAIU_DO_SUPABASE`, retaguarda do GitHub) está em `ops/vps/api-db/LEIA-ME.md`, seção "Cópia de segurança para o Zoho", e NÃO é repetida aqui.
- Os 3 robôs que eram SQL puro (`abandono-de-checkout`, `conferir-robos`, `vessel-rd-station`) passam a GRAVAR linha em `robos_execucoes` (a tela casa o nome por prefixo; um nome sem linha apareceria como "sem execução"): cerca de 3.200 linhas a mais por dia (1.440 + 1.440 + 288), purgadas aos 60 dias pelo `conferir-robos` (e `envios_feitos` aos 45, `webhooks_recebidos` aos 30 e sessões vencidas pela `faxina-da-api`).
- O alerta de `conferir-robos` MUDOU DE LUGAR: as linhas já nascem com `conferido_em`, então a tarefa só fecha as antigas sem conferência (texto de produção, sem acento) e apaga as de mais de 60 dias; quem alerta "robô que não roda" continua sendo a view `robos_saude`, que casa cada execução com `robos_esperados` pelo PREFIXO MAIS LONGO (`coletar-dados-07h · Mantova Móveis` cai em `coletar-dados`; `meta-hora-retentativa-00h` tem ficha própria e não cai em `meta-hora`; `conferir-robos`, `faxina-da-api`, `abandono-de-checkout`, `vessel-rd-station`, `fabrica-purga` e `enviar-push-frota` têm ficha própria desde a migração 00004, então a tela os cobra: um deles parar vira ATRASADO).
- Falha de uma CONTA em `coletar-dados-*`: vira a linha `ok = false` DA PRÓPRIA CONTA (`coletar-dados-07h · <conta>`), mais `slog.Error`, mais `Falhas`/`ultimo_erro` em `/metricas`, mais saída != 0 em `api worker rodar`. NÃO existe linha agregada vermelha `coletar-dados-07h`: a view `robos_saude` julga cada VARIANTE pelo ÚLTIMO SUCESSO dela (`max(disparado_em) filter (where ok)`) e o robô pelo pior (`min`) das variantes VIVAS (com disparo nas últimas 72 h), então uma linha agregada criaria uma variante sem nenhum sucesso ("nunca deu certo" por 72 h = vermelho crítico por causa de uma conta ruim). Consequência: o worker em si aparece verde no `docker ps` mesmo com uma conta vermelha; quem enxerga é a tela de saúde e a métrica.
- Z-API: conferir a instância CONECTADA (QR lido) antes da virada; instância desconectada é a causa provável dos 47% de falha do `enviar-relatorio-hora` hoje, e no worker aparece como falha com `Z-API send-text: <status>` na tela de saúde.
- Front (Plano 7): `functions.invoke('avisar-decisao-de-reserva')` vira `POST /api/avisar-decisao-de-reserva` (mesmo corpo `{requisicaoId}`, mesmo portão `frota.aprovar`/`ver`; o `location /api/` genérico do nginx já cobre). Até lá a edge segue.
- `gh variable set SAIU_DO_SUPABASE --body sim`, papel `copia` e `COPIA_DB_SENHA`: ver `ops/vps/api-db/LEIA-ME.md`.

### Plano 4 — Comportamentos que o operador precisa conhecer
- Chaves do livro (todas terminam em `:<8 bytes do sha256 do endpoint>`, o endpoint é um token e não entra inteiro): COM o dia de São Paulo, `enviar-push-vendas-22h:<dia de referência>` e `enviar-push-vendas-07h:<dia de referência>` (o 22h do dia D e o 07h de D+1 têm o MESMO dia de referência D; por isso a chave leva o nome da tarefa e os dois saem), `enviar-push-saldo:<dia>` e `enviar-push-frota:<dia>:<carro>`; SEM data: `avisar-decisao-de-reserva:<requisição>:<situação>` e (o aviso da peça) `conteudo-hora-h:<peça>:<avisado_em>`. Rodar de novo (manual depois do cron, nova tentativa depois de queda, segundo worker) não reenvia push de vendas a quem já recebeu naquela janela. A `faxina-da-api` apaga o livro após 45 dias; um reenvio depois disso seria, no pior caso, UM aviso a mais (aceito). O mesmo par requisição+situação só volta por novo clique do front; o livro serve para o clique duplo.
- "Reavisar" (`conteudo_reavisar`, ou reaprovação, que limpa `avisado_em`) REENVIA: a chave do `conteudo-hora-h` carrega o `avisado_em`, então um novo aviso é uma chave nova. Se a peça foi reivindicada e NENHUM aparelho recebeu, a trilha da peça diz "Tentei avisar, mas nenhum aparelho recebeu (N falha(s)). Use "Reavisar" para tentar de novo." e a tarefa dá erro; a reivindicação NÃO é desfeita (desfazê-la repetiria a cada 5 min).
- Falha PARCIAL de push, por tarefa (cada aparelho que recusa não derruba os outros):
  - `enviar-push-vendas-*` e `enviar-push-saldo-08h`: erro só se NENHUM aparelho recebeu e houve falha (`nenhum_push_entregue`); um aparelho morto entre vários só vai para o log. No push de vendas, aparelho já servido na janela (Repetido) conta como entregue, então a reexecução manual não fica vermelha. O saldo também dá erro se alguma conta ficou sem leitura.
  - `enviar-push-frota`: cada carro vai a UMA pessoa; erro se algum carro terminou com falha e nenhum envio (`nenhum_push_entregue: N carro(s) sem aviso entregue`); um aparelho morto entre vários DA MESMA pessoa é tolerado.
  - `conteudo-hora-h`: qualquer falha, mesmo parcial, vira erro da tarefa (`push_nao_entregue`).
  - `POST /avisar-decisao-de-reserva`: responde `enviados`, `podados` e `falhas`; não grava linha de robô.
  - O livro de push libera a reserva em qualquer resposta não-2xx (o aparelho junta notificações pela `tag`): um reenvio manual pode repetir um push que na verdade chegou.
- Payload de frota e de reserva: além de `titulo`/`corpo`/`url` (iguais aos da edge) o Go manda `title`, `body` e `tag` (estável por tipo e dia). O service worker lê `title`/`body`/`tag`; os pushes de frota de HOJE chegam com o corpo vazio e, sem tag, substituem o card de vendas. É defeito de produção corrigido de passagem, só por acréscimo de campos.
- Conversão da RD (`vessel-rd-station`) PODE DUPLICAR num envio ambíguo (caiu depois de enviar; um `enviado` parado há mais de 10 min é reenviado, até 5 tentativas, como o `pg_net`): é a exceção explícita à regra "nada sai duas vezes" (Ruling 4 do plano), porque a RD não tem chave de idempotência e deixar preso perderia leads. A 5ª falha torna a rodada um ERRO visível (token revogado não fica silencioso).
- Template do Chatwoot (`enviar-mensagem-abandono`): 500, 502, 503 e 504 (qualquer 5xx exceto 501) no passo `enviar_template`, e rede/prazo, são AMBÍGUOS: o item fica `falhou` e NUNCA é reenviado (a mensagem a cliente pode ter saído). DIVERGE DA EDGE, que repetia 5xx; 429 continua tentando de novo (recusa antes de processar), e nos passos que não enviam (contato, conversa) 5xx ainda repete. 401/403 param a rodada (credencial) devolvendo o resto à fila sem gastar tentativa. O cliente do Chatwoot nunca segue redirect. Prazo de 4 min por rodada: o item pendurado vira `falhou` e o resto volta à fila. O disparo imediato (`DISPARO_IMEDIATO`) NÃO foi portado (a rodada de cada minuto cobre; atraso de até ~1 min).
- Relatório da hora (`enviar-relatorio-hora`): sem resposta HTTP (conexão recusada, prazo) e 502/504 são AMBÍGUOS (reserva mantida: a hora não é reenviada num rerun manual); outro não-2xx libera a reserva (um 5xx depois do aceite pode duplicar só num rerun manual na mesma hora). Falha de leitura do banco, que a edge devolvia como 200, vira aviso no grupo E erro da tarefa. Textos, constantes (conta Vessel, "Grupo de teste z-api") e centavos seguem a edge.
- `meta-hora`: "nada coletado" é erro, inclusive às 00h05 de São Paulo (ainda sem gasto); a retentativa das 00h30 cobre; uma linha vermelha por dia às 00h05 continua aparecendo, como hoje. Conta ou campo que falhou também vira erro da tarefa.
- RENOVAÇÃO DO TOKEN DA META: a edge `coletar-dados` renovava o token (`renovarToken`, `fb_exchange_token`, grava `accounts.access_token`; o token dura 60 dias e `robos_esperados` diz que ela era o ÚNICO lugar que renova) a menos que `CORE_META=true`; o `coletar-dados` em Go NÃO renova nada (a Graph vai pelo core, que é o dono do token; `accounts.access_token` só serve para escolher as contas). ANTES do corte, confirmar que `CORE_META` já está `true` nos segredos da edge hoje (senão o token da tabela deixa de ser renovado no corte e vence) e que o core renova o token dele sozinho.
- A foto do perfil que `coletar-dados` sobe ao Storage NÃO foi portada (Plano 6): até lá a foto da conta não se atualiza sozinha. A seleção de contas é a do `disparar_coletor` (`instagram_id` e `access_token` preenchidos); contas em série, 6 min por conta e 50 min por rodada.
- `auditar-dados` agora é Go (`run_integrity_checks` reescrita): apaga só as linhas de `data_integrity_checks` dos PRÓPRIOS checks do dia (a função SQL antiga, que fica no banco até o Plano 8, apagava também as do `coletar-dados`).
- Web Push: a VPS precisa de saída IPv4. Com DNS64 os endpoints resolvem para `64:ff9b::/96`, o discador seguro recusa (anti-SSRF) e a tarefa falha ALTO.
- Erros do core nunca trazem o endereço: só a classe (`core: conexão recusada`, `core: prazo vencido`, `core: DNS`, `core: TLS`, `core: cancelado`, `core: rede`); a causa detalhada fica só no log de nível debug, sem host. Erros de Z-API, RD e Chatwoot também saem sem URL nem token.
- `*` em `WORKER_TAREFAS_DESLIGADAS` é a chave do ensaio; esquecê-la no ar em produção é o erro inverso (nada roda e NADA avisa, só o log de boot e a tela de saúde depois de horas): o `listar` mostra `DESLIGADA` por tarefa.

### Plano 4 — Contrato do core: reconferir ANTES do corte
As tarefas do Plano 4 foram escritas contra o contrato lido de `vessel-core-go` no commit `e8a06e8c3` (rota `POST /api/interno/meta/graph`, `services/core/cmd/core/meta.go:40-42`; allow-list de GET `internal/meta/http.go:109`; `parametros` até 64 KB `http.go:116,196`; 401/403/429 `internal/auth/consumidor.go:123,135,139,144`; 120/min por consumidor `internal/config/config.go:172`). A produção, porém, já roda o `core-go` mais novo (`22addfbb6` no último registro de `REVISAO-CORE/COORDENACAO.md`), com mudanças depois daquele commit. Reconferir no commit que estiver no ar:
- Escopos por consumidor (`CORE_API_ESCOPOS`, sem entrada = 403 `escopo_negado`): o consumidor do worker tem `meta` e `bling`? A rota da Meta pede também `espelho`? Tabela `acessos_core` (resultado = negado) mostra o que faltou.
- `idempotency_key`: o core passou a contar escrita no proxy do Bling sem chave (`bling-escrita-sem-chave`) e vai passar a exigir (422). O worker só LÊ do Bling (push de vendas); confirmar que não há escrita sem chave.
- 503 `core_indisponivel` (com `X-Core-Origem: proxy`) e 500/502/504 "incertos": o `core.Cliente` e o `bling-proxy` classificam por `X-Core-Origem` (`bling`/`proxy`/vazio); conferir que os valores e os códigos de erro não mudaram.
- Endpoint da Meta: a rota `POST /api/interno/meta/graph`, o corpo `{caminho, metodo, parametros}`, a allow-list (todo caminho que o worker pede casa a regex; `permitidoNoCore` em `coleta_test.go`) e o formato do erro.
- Limite de 120 chamadas por minuto por consumidor e o `Retry-After` do 429 (o cliente repete até 3 vezes só no 429).

### Plano 4 — Pendências que ficam
- Plano 6: `enviar-pdf-checklist`, `vessel-espelhar-lista`, `vessel-lembretes`, `vessel-log-de-carocos`, `vessel-triagem-da-vaga` e a foto do perfil do `coletar-dados`.
- Plano 7: o front troca `functions.invoke('avisar-decisao-de-reserva')` por `POST /api/avisar-decisao-de-reserva`.
- Plano 8: compose do worker (esta seção), `cron.unschedule` dos 19 jobs, `WORKER_TAREFAS_DESLIGADAS` vazia, `SAIU_DO_SUPABASE`, apagar `.github/workflows/copia-do-banco.yml` e a função SQL `run_integrity_checks`.
