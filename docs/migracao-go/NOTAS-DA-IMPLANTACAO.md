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
- Prazos: o servidor Go usa `ReadHeaderTimeout 10s`, `ReadTimeout 30s`, `WriteTimeout 150s`, `IdleTimeout 120s`. Prazos por requisição: `meta-proxy` 25 s (45 s imagem, 75 s vídeo), `insights-ao-vivo` e `serie-novos-dia` 90 s, `contar-collabs` 120 s (N perfis x até 5 páginas em série); cada chamada à Meta dessas três rotas ainda tem teto de 60 s, que nunca estende o prazo da rota. `bling-proxy` 90 s (usuário limitado a lojas faz uma chamada ao core por loja, até 25 s cada). `custo-anthropic` e `custo-openai` 90 s (Plano 5.12). `proxy_read_timeout` do nginx deve ficar ACIMA do prazo: `130s` em `/api/contar-collabs`, `100s` em `/api/bling-proxy`, `/api/insights-ao-vivo`, `/api/serie-novos-dia`, `/api/meta-proxy` (80 s no mínimo para o vídeo), `/api/custo-anthropic` e `/api/custo-openai`; o padrão do nginx (60 s) derrubaria essas rotas antes do prazo da API. `proxy_send_timeout` padrão.

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
- Push de vendas duplicado: DESAGENDAR no Supabase os jobs do pg_cron `push-vendas-07h` e `push-vendas-22h` (`select cron.unschedule(...)`) NO PASSO 1 DA JANELA, ANTES do Supabase somente leitura e do dump final (ordem completa e o que se perde no intervalo: "Plano 4 — Dia da virada do worker" abaixo); senão a edge antiga e o worker mandam o mesmo push duas vezes.
- ENSAIO ENVIA PUSH DE VERDADE: o banco restaurado traz `push_subs` de produção; `api worker` com `VAPID_*` preenchidas manda notificações REAIS a pessoas reais no horário do cron. No ensaio, subir o worker SEM `VAPID_*` (o push falha alto, sem enviar) e/ou com `WORKER_TAREFAS_DESLIGADAS=enviar-push-vendas-07h,enviar-push-vendas-22h` (ou `*` para nenhuma tarefa; o worker loga as desligadas ao subir). Só tirar essa variável no dia da virada, no passo 3 da janela (depois do restore e do `api worker conferir`). Com as tarefas do Plano 4 isso vale para TODAS as que enviam algo: ver "Plano 4 — Ensaio" abaixo.
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
| `DATABASE_URL` | `api` e `worker` | obrigatória. Acrescentar `connect_timeout=5` (segundos) à URL: o banco fora do ar com a rede sem resposta (TCP pendurado) faria cada tarefa esperar o timeout do sistema, a cada minuto. A conexão da trava do worker já tem um teto de 10 s; o `connect_timeout` da URL, se menor, vale (o pgx o aplica por dentro). Estourado, a execução termina com erro de conexão (sem endereço) e a próxima tenta de novo |
| `CORE_URL` | `api` e `worker` | https (http só para localhost/127.0.0.1/::1); padrão `https://core.rbvcompany.com` |
| `CORE_API_TOKEN` | `api` e `worker` | RECOMENDADO um consumidor PRÓPRIO do worker no core: o core limita 120 chamadas da Meta por minuto POR CONSUMIDOR e o worker anda a 600 ms por chamada (~100/min); com o token da API, as telas ao vivo e o worker disputam o mesmo balde e levam 429. Sem token, as tarefas do core falham ("core: CORE_API_TOKEN ausente") |
| escopos do consumidor | no core | o core de produção passou a impor `CORE_API_ESCOPOS` por consumidor (sem entrada = 403 `escopo_negado`; hoje `social-dashboard` = `bling\|shopify\|meta\|espelho`). O consumidor do worker precisa de `meta` (coletas, saldo, espelho, auditoria) e de `bling` (push de vendas); conferir no core se as rotas da Meta também pedem `espelho` (o grupo de limite delas se chama "espelho") |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `api` E `worker` | OBRIGATÓRIAS nos dois (os mesmos valores de `segredos_de_cron`). `VAPID_SUBJECT` (ex.: `mailto:...`) NÃO tem mais padrão: a edge caía em `mailto:breno@rbvcompany.com`; sem o valor o push falha alto. A rota `POST /avisar-decisao-de-reserva` (no `api`) também manda push e exige as três. Toda tarefa de push confere a VAPID ANTES de ler o core ou reservar envio. Trocar a chave invalida todas as inscrições. O boot do worker só AVISA VAPID inválida; as tarefas de push é que falham |
| `ZAPI_INSTANCE_ID`, `ZAPI_INSTANCE_TOKEN`, `ZAPI_TOKEN` | `enviar-relatorio-hora` | os dois primeiros vão no caminho da URL da Z-API; `ZAPI_TOKEN` é o Client-Token (cabeçalho). Os três são tratados como segredo |
| `RD_STATION_TOKEN` | `vessel-rd-station` | vazio = a tarefa falha ALTO com `rd_sem_token` (para desligar: `WORKER_TAREFAS_DESLIGADAS=vessel-rd-station`) |
| `CHATWOOT_URL`, `CHATWOOT_CONTA_ID`, `CHATWOOT_CAIXA_ID` (a caixa de entrada), `CHATWOOT_API_TOKEN`, `CHATWOOT_BOT_SECRET` | `enviar-mensagem-abandono` | as MESMAS variáveis da edge, copiadas dos segredos dela por quem tem acesso |
| `ENVIO_MODO`, `ENVIO_MODO_INICIO`, `ENVIO_MODO_PEDIDO`, `ENVIO_MODO_FOLLOWUP` | idem | `desligado` \| `seco` \| `lista` \| `ligado`; VAZIO = `desligado` (nasce tudo desligado: sem elas o robô roda "ok" e NÃO manda nada, sem erro nenhum; conferir o modo de cada passada no dia da virada) |
| `ENVIO_LIMITE_POR_RODADA`, `ENVIO_SO_PARA`, `ENVIO_MAX_HORAS`/`INICIO_MAX_HORAS`/`PEDIDO_MAX_HORAS`/`FOLLOWUP_MAX_HORAS`, `TEMPLATE_NOME`/`_INICIO`/`_PEDIDO`/`_FOLLOWUP`, `TEMPLATE_TEXTO*`, `TEMPLATE_IDIOMA`, `LINK_BASE`, `ABANDONO_TRAVA_CRUZADA`, `RESERVAR_AVISO_CHATWOOT` | idem | como na edge |
| (validação do abandono) | idem | o boot do worker AVISA (`slog.Warn`, com o nome da passada em cada problema) tudo isto de uma vez (`mensagens.Config.Problemas`), em vez de esperar a primeira rodada falhar; por passada que NÃO esteja `desligado`: `ENVIO_LIMITE_POR_RODADA` inteiro de 1 a 100; `*_MAX_HORAS` inteiro a partir de 1; `LINK_BASE` vazio OU sem `/` no fim reprova (abandono, início e follow-up); fora do modo `seco` exigem-se `TEMPLATE_NOME`, `CHATWOOT_URL` com http(s), `CHATWOOT_CONTA_ID`, `CHATWOOT_CAIXA_ID` (inteiro) e `CHATWOOT_API_TOKEN`; no modo `lista`, `ENVIO_SO_PARA` não pode ser vazio; `RESERVAR_AVISO_CHATWOOT=true` exige `CHATWOOT_BOT_SECRET`. Ao reprovar a passada retorna `config_invalida` (nada é tocado) e a tarefa falha a cada rodada; o aviso do boot usa a MESMA lista (`Config.Problemas`), então também cobre `ENVIO_ATRASO_MINUTOS` e `FOLLOWUP_APOS_HORAS` (esta só quando o follow-up não está `desligado`); o boot só avisa, não impede a subida |
| `ENVIO_ATRASO_MINUTOS` | idem | validada: NaN, infinito, negativo ou fração REPROVAM a configuração (na edge virava `NaN` sem validação); `0` vale. O boot avisa (se a passada de abandono não está `desligado`) e a rodada reprova: a passada de abandono falha a cada minuto com `config_invalida` e não toca em nenhuma linha |
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
- Leitura do catálogo (`api worker conferir`, Plano 5.0): `dados.Consulta` lê pelo pool, fora de `ComUsuario` (a autorização é do `autz`). Com a RLS ligada nas tabelas restauradas e o papel da API nem dono (sem FORCE), nem BYPASSRLS, nem superusuário, TODA leitura de domínio devolve `[]` em silêncio: o conferir lista as tabelas do catálogo nessa situação (e as sem SELECT). Corrigir antes do corte: restaurar com o papel da API como dono, ou `alter role <api> bypassrls`. A auditoria do "entrar como" tem a própria conferência (INSERT).
- `AVISO:` do `api worker conferir` (não falha, saída segue 0): `profiles.permissions` com perfis fora do formato `{recurso: [ações]}` (array, texto, `null` ou chave cujo valor não é array). A API tolera (só lista de textos vira ação; o resto é ignorado, nunca 500: `auth.LerPermissoes`, a mesma regra do escopo de `autz`), mas a pessoa fica sem a permissão que o dono achava que ela tinha: olhar a contagem e corrigir os perfis antes do corte (`select id, permissions from profiles where permissions is not null and case jsonb_typeof(permissions) when 'object' then exists (select 1 from jsonb_each(permissions) e where jsonb_typeof(e.value) <> 'array') else true end`).
- ORDEM no ensaio: `api migrar` PRIMEIRO, depois `api worker conferir` (o `migrar` cria `envios_feitos`, `webhooks_recebidos`, `sessoes` e `usuarios`; antes dele o `conferir` lista `migrações:` como pendência).
- `robos_esperados` do banco restaurado: a migração goose `00004_robos_esperados_do_worker.sql` (roda no `api migrar`) cadastra as 6 fichas que faltavam, com `on conflict (robo) do nothing` (ficha que o dono já ajustou fica como está) e `horas_sem_sucesso_ate` folgado, todas NÃO críticas: `enviar-push-frota` 80 h (dias úteis 07h30; sexta→segunda são 72 h), `fabrica-purga` 30, `faxina-da-api` 30, `vessel-rd-station` 2, `abandono-de-checkout` 2, `conferir-robos` 1. Ela também APAGA a ficha `estoque-do-site` (o Core é o único escritor do estoque desde 2026-10-08; a ficha crítica ficaria vermelha para sempre). Sem a tabela (banco novo, testes) a migração não faz nada e não a cria; o Down apaga exatamente as 6 fichas (não restaura a do estoque). Depois do `api migrar` no banco restaurado, comparar `select robo from robos_esperados order by 1` com a lista que as migrations criam (`TestNomesCasamComRobosEsperados` lê `db/migrations/*.sql` e o trecho Up das migrações goose) e com os 20 nomes das tarefas: toda tarefa casa uma ficha pelo prefixo mais longo. Pode haver linhas que nunca passaram por migration.
- Tela de saúde: `TestNomesCasamComRobosEsperados` prova a regra do prefixo mais longo; no ensaio, conferir na tela uma execução real de cada nome (`api worker rodar <t> --forcar` deixa a linha).

### Plano 4 — Dia da virada do worker (ESCRITO, NÃO EXECUTADO)
ORDEM DA JANELA (spec §9, passos 1 a 3; substitui a versão anterior, que mandava desagendar "no mesmo momento em que o worker sobe"). Por que NÃO pode ser depois: o "Supabase somente leitura" (revogar escrita de `anon`/`authenticated`/service) NÃO para os jobs do pg_cron, que rodam como `postgres`: `vessel-rd-station` continua postando na RD via `pg_net`, `abandono-de-checkout` continua movendo linhas, e as edges só de leitura (`enviar-relatorio-hora`, `enviar-push-*`) continuam enviando para fora. Tudo que o Supabase processa DEPOIS do instante do dump continua pendente no banco novo, e o worker o envia DE NOVO (o livro `envios_feitos` só vê o que o próprio worker reservou; o que o pg_cron/edge mandou ele não enxerga).

0. ANTES da janela (só leitura): guardar a lista de jobs para poder reverter, `select jobid, jobname, schedule, command, active from cron.job order by jobname;` (os comandos originais também estão em `db/migrations/`). A cópia salva é um SEGREDO: `cron.job.command` de `fabrica-purga-diaria` leva um token em texto puro (ver o comentário da migração de 2026-07-31); gravar em arquivo com modo 600 (`umask 077`), fora do git e fora do chat/ticket, e apagar depois do corte. A lista dos `cron.unschedule` abaixo é POR `jobname` (não precisa da cópia). Anotar também o último sucesso de cada robô que envia, `select robo, max(disparado_em) filter (where ok) as ultimo_ok from robos_execucoes where robo ~ '^(enviar-|conteudo-hora-h|vessel-rd)' group by 1 order by 1;` (serve para o item 5).
1. PASSO 1 DA JANELA, ANTES de qualquer outra coisa (antes do somente leitura, antes do dump): os 19 `select cron.unschedule('<job>');` da lista abaixo e CONFIRMAR `select jobname from cron.job order by 1;` = exatamente os 5 que ficam para o Plano 6 (`enviar-pdf-checklist`, `vessel-espelhar-lista`, `vessel-lembretes`, `vessel-log-de-carocos`, `vessel-triagem-da-vaga`). Depois ESPERAR 10 minutos e confirmar que não sobrou execução em andamento (`select * from cron.job_run_details where status in ('connecting','sending','starting','running');` vazio, os 4 estados de execução em andamento; o maior prazo de uma edge é 180 s e a rodada do abandono, 4 min): unschedule não aborta chamada já disparada, e uma edge ainda no ar na hora do dump enviaria depois dele.
2. Supabase somente leitura; dump final; restore no Postgres próprio; `api migrar`; `api worker conferir` (saída 0); contagens e checksums.
3. SÓ ENTÃO o worker sobe com as tarefas LIGADAS (`WORKER_TAREFAS_DESLIGADAS` vazia), depois do restore E do `conferir` com saída 0. Até aqui ele ficou parado ou com `WORKER_TAREFAS_DESLIGADAS=*`.
4. O INTERVALO SEM AGENDA (do passo 1 ao passo 3: a janela inteira, de dezenas de minutos a algumas horas) é PERDA ACEITA: nada roda, nem no Supabase nem no worker, e execução perdida NÃO é recuperada sozinha (como no pg_cron). O que isso custa: pushes de vendas/saldo/frota e relatórios da hora que caíam na janela não saem (o dia seguinte sai normal); `coletar-dados-*`, `meta-hora*`, `conteudo-espelho` e `auditar-dados` ficam com buraco até a próxima rodada (a coleta é upsert por dia, cura sozinha); a fila do abandono para de ser alimentada e esvaziada (as linhas esperam e saem na primeira passada do worker, com o atraso que a janela impôs); conversões da RD e avisos de peça (`conteudo-hora-h`) esperam a primeira passada do worker; `fabrica-purga` e `faxina-da-api` simplesmente adiam.
5. RECUPERAR O INTERVALO, uma vez, com `docker compose exec worker api worker rodar <tarefa> --forcar`, depois do `conferir` e com o worker no ar:
   - PODEM rodar uma vez (leem e gravam só no banco, sem falar com pessoa; repetir é inofensivo): `abandono-de-checkout` (só chama `mover_abandonados_para_fila(10)` e move linhas para a fila; quem envia é `enviar-mensagem-abandono`, que continua desligada), `coletar-dados-12h` (ou a rodada mais recente que faltou; as outras três são cobertas por ela), `meta-hora`, `meta-hora-retentativa-00h` (só se a janela cobriu as 00h30 de São Paulo), `conteudo-espelho`, `fabrica-purga` e `faxina-da-api` (se a janela cobriu o horário diário), `conferir-robos`. `auditar-dados` também, com a ressalva de que, havendo falha, manda UM recado ao `ALERT_WEBHOOK_URL` (interno; se o Supabase já tinha mandado o do dia, chega um segundo).
   - NÃO RODAR NUNCA com `--forcar` nem à mão: `enviar-mensagem-abandono` (template de WhatsApp a CLIENTES), `vessel-rd-station` (conversão na RD, sem chave de idempotência) e `conteudo-hora-h`: as três já rodam sozinhas a cada minuto/5 minutos e tratam a fila pendente na primeira passada; forçar só antecipa o risco. Também NÃO as de push e relatório cuja janela o Supabase JÁ enviou antes do passo 1 (confirmar no `ultimo_ok` do item 0 e em `robos_execucoes` do banco restaurado): `enviar-push-vendas-07h`/`-22h`, `enviar-push-saldo-08h`, `enviar-push-frota`, `enviar-relatorio-hora`. O livro do worker começa vazio para essas janelas: `--forcar` de uma janela que o Supabase já mandou duplica o push/WhatsApp para TODOS.
   - `enviar-push-vendas-22h` (cron 01:00 UTC = 22h de São Paulo) só pode ser forçado ATÉ 23:59 de São Paulo do MESMO dia da janela perdida. Depois da meia-noite de SP (03:00 UTC) o `--forcar` calcula "hoje" = D+1, manda números parciais sob a chave `22h:D+1` e o livro suprime o push real das 22h de D+1, sem erro. Passou da meia-noite: não forçar, perder o aviso.
   - Uma tarefa de push/relatório SÓ pode ser forçada uma vez quando a janela perdida é demonstravelmente de ninguém (o último `ultimo_ok` do item 0 é anterior ao horário da janela, e o horário da janela caiu entre o passo 1 e o passo 3). Mesmo assim, é UM `--forcar` e nada mais: o livro (`enviar-push-*`: ver "Chaves do livro") impede que o cron do worker ou um segundo `rodar` repita a mesma janela. Na dúvida, não forçar: perder um aviso custa menos que mandar o mesmo a todo mundo.
6. REVERTER ANTES do passo 3 (janela cancelada, Supabase volta a escrever): recriar os 19 jobs a partir da cópia do item 0 (`select cron.schedule(jobname, schedule, command)`), com o worker PARADO ou `WORKER_TAREFAS_DESLIGADAS=*`. Reverter DEPOIS do passo 3: parar o worker ANTES de reabrir a escrita no Supabase e recriar os 19 jobs (senão os dois mandam tudo duas vezes).
7. Os 5 jobs do Plano 6 continuam no pg_cron do Supabase durante e depois da janela e processam o que quiserem depois do dump (Zoho, planilhas, PDF): o Plano 6 precisa decidir a ordem deles ANTES da virada; este roteiro não os cobre.

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
- Plano 8: compose do worker (esta seção), `cron.unschedule` dos 19 jobs (passo 1 da janela, ANTES do somente leitura e do dump), `WORKER_TAREFAS_DESLIGADAS` vazia (só depois do restore e do `conferir`), `SAIU_DO_SUPABASE`, apagar `.github/workflows/copia-do-banco.yml` e a função SQL `run_integrity_checks`.

## Plano 5.0 — autorização, contrato das rotas de domínio e conta

### Variáveis de ambiente (serviço `api`)
| Variável | Observação |
|---|---|
| `ZEPTOMAIL_TOKEN` | a MESMA chave que a edge `vessel-conta` usa (segredo da Supabase), copiada por quem tem acesso. Vazia = convite e "esqueci a senha" não mandam e-mail (o "esqueci" continua respondendo 202 e só loga; o convite responde "Não consegui enviar o e-mail"); a `api` sobe com um `WARN` no log. É segredo: entra em `Segredos()` (mascarado no log do worker) e nenhuma mensagem de erro de configuração ou de envio a traz |
| `ZEPTOMAIL_DE` | padrão `nao-responda@vesselbrasil.com.br` (domínio verificado no ZeptoMail desde 17/09/2026). Tem de ser SÓ um endereço (sem `Nome <...>` nem lista): senão a API não sobe |
| `ZEPTOMAIL_NOME` | nome do remetente; padrão "Central de Inteligência RBV" |
| `ENDERECOS_DO_APP` | lista por vírgula; padrão `https://socialdashboard.rbvcompany.com,https://central.rbvcompany.com` (a lista de `_shared/enderecos-do-app.js`). O link de senha leva à origem do pedido SÓ se ela estiver aqui (texto exato). Cada item tem de ser só a ORIGEM: `https://host[:porta]`, sem caminho, query, fragmento nem usuário (`http` só para localhost/127.0.0.1/::1); a barra final e a caixa são normalizadas. Item inválido: a API NÃO sobe (um valor que nunca casaria com o `Origin` mandaria o link, em silêncio, para o endereço padrão) |
| `ENDERECO_PADRAO` | padrão: o primeiro de `ENDERECOS_DO_APP`. Tem de ser UM dos itens da lista (o link só leva a endereço da lista), senão a API não sobe. Trocar para `https://central.rbvcompany.com` quando o endereço novo estiver provado |

Limites de taxa dos links de senha NÃO têm variável: são fixos no código (`auth.NovaConta`), 20 pedidos por IP a cada 15 min num balde ÚNICO (`Conta.PorIP`), que `esqueci-senha` e `definir-senha` DIVIDEM (um pedido de qualquer das duas gasta do mesmo saldo de 20), e mais 5 por e-mail a cada 15 min só em `esqueci-senha` (`Conta.PorEmail`); `conferir-senha`: 5 erros seguidos bloqueiam a pessoa por 10 min (em memória, uma instância só, Ruling 22). Mudar um deles é mudança de código, de propósito (valor que não varia por ambiente).

### Rotas novas
- Públicas (o `location /api/` genérico cobre; não carregam segredo na query): `POST /api/auth/esqueci-senha`, `POST /api/auth/definir-senha`. Resposta sem enumeração (202 `{"ok":true}` para qualquer e-mail). A lista de rotas públicas é exatamente esta + saúde, login e os 5 webhooks; qualquer rota nova fora do grupo autenticado derruba `TestNenhumaRotaNovaFicaAberta`.
- Com sessão de painel: `POST /api/auth/trocar-senha`, `GET /api/eu/perfil`, `POST /api/invite-user`, `POST /api/entrar-como-usuario`, `POST /api/conferir-senha`, `POST /api/rpc/{nome}` (só nomes registrados pelos sub-planos; vazio no 5.0: tudo 404). Os portões de `invite-user` (papel admin) e `entrar-como-usuario` (super-admin pela ficha) são os das edges e ficam DENTRO do handler (400 com a frase da edge).
- Todo o grupo de domínio (`/rpc/{nome}` e as rotas dos sub-planos) tem prazo de 30 s por requisição (`web.PrazoDominio`, do carregamento do escopo à resposta; o contexto cancelado cancela a consulta no banco; resposta `504 {"error":"prazo_esgotado"}`), abaixo dos 60 s do `proxy_read_timeout` padrão do nginx e do `WriteTimeout` de 150 s do servidor (`web.EscritaDoServidor` = `PrazoCollabs` + 30 s, usada por `main.go`; `TestPrazosPorRotaPelaMontagemReal` confere a constante e que cada prazo de rota termina 30 s antes dela).

### nginx
- `location /api/` genérico (já descrito no Plano 3) cobre as rotas novas, com `X-Real-IP $remote_addr` no nível `server {}`: o limite por IP de `esqueci-senha`/`definir-senha` usa SÓ esse cabeçalho (e só quando o par TCP é o nginx). Sem ele todo mundo divide UM balde (o IP do proxy) e 20 pedidos de um anônimo trancam o "esqueci a senha" de todos.
- Limite de inundação, ANTES do limite fino da API (esqueleto verificado com `nginx -t` em nginx:alpine; o resto do `server {}` é o do Plano 3):
  ```nginx
  # em http {}
  log_format semquery '$remote_addr [$time_local] "$request_method $uri" $status';
  limit_req_zone $binary_remote_addr zone=conta:10m rate=30r/m;
  limit_req_status 429;
  # dentro de server {}  (idem para /api/auth/definir-senha; cada location nomeia o destino)
  location = /api/auth/esqueci-senha {
    limit_req zone=conta burst=10 nodelay;
    client_max_body_size 4k;
    access_log /var/log/nginx/conta.log semquery;
    proxy_pass http://127.0.0.1:8080/auth/esqueci-senha;
  }
  ```
- Log: o link de senha agora vai no FRAGMENTO (`#`), que o navegador não manda ao servidor: nem a linha do pedido nem o `Referer` do nginx (`deploy/nginx/central.rbvcompany.com.conf` registra os dois) têm o token. Mesmo assim: o formato de log destas rotas não pode conter `$request_body`, `$http_authorization`, `$args`, `$query_string` nem `$request_uri`; as senhas viajam no CORPO (`definir-senha`, `trocar-senha`, `invite-user`, `conferir-senha`, login), e o nginx não registra corpo por padrão: não ligar. Corpo máximo: 4k em `esqueci-senha`/`definir-senha`, 64k no resto (a API também limita).

### Links do e-mail
- `<endereço>/#type=recovery&token=<token>` (troca, 1 h) e `<endereço>/#type=invite&token=<token>` (convite, 24 h). O token vai no FRAGMENTO, não na query: o fragmento não chega ao servidor (log de acesso do nginx) nem ao `Referer`. O endereço é a origem do pedido SE estiver em `ENDERECOS_DO_APP`; senão `ENDERECO_PADRAO`.
- O front (Plano 7) lê `type` e `token` do hash (a função `detectarFluxoDeSenha` já lê `type` do hash, hoje junto do `#access_token` do Supabase), **limpa o hash com `history.replaceState(null, "", location.pathname + location.search)` assim que os lê** (antes de qualquer outra chamada, e antes de qualquer script de terceiros que leia `location`), e chama `POST /api/auth/definir-senha {token, senha}`, que devolve `{token}` de sessão. Link de uso único: usado, vencido, ou de quem foi desativado = `400 {"error":"token_invalido","mensagem":…}`.
- Formatos de recusa que o front vai ver nas rotas de conta, todos no formato do núcleo `{"error":<código>,"mensagem":<frase>}`: `403 sem_permissao` (sessão "entrar como" tentando trocar senha, convidar/excluir, entrar como terceira pessoa ou conferir senha; a frase vem em `mensagem`), `400 senha_invalida`, `400 token_invalido`, `429 muitas_tentativas`, `403 conta_desativada` (login). `invite-user` e `entrar-como-usuario` seguem o contrato das edges: `400 {"error": <frase>}` para as recusas de regra.

### Mudanças de contrato que o Plano 7 absorve
- `entrar-como-usuario` responde `{token, expira_em}` (não mais `access_token`/`refresh_token`); a sessão vale 1 h e NÃO renova.
- Sessão impersonada não convida/exclui, não entra como terceiros, não confere senha e não troca a senha do alvo: toda recusa de sessão impersonada em ação de conta é `403 {"error":"sem_permissao","mensagem":<frase>}` (o formato do núcleo; as 5 recusas têm um teste só: `TestRecusaDeSessaoImpersonadaTemUmFormatoSo`). Na edge não havia recusa: o JWT do alvo valia para tudo.
- `conferir-senha` sem sessão responde `401 {"error":"nao_autenticado"}` (a edge: `{ok:false, erro:"sem_sessao"}`); o resto do contrato é o da edge (`200 {ok}`, `429 bloqueado`, `400 sem_senha`).
- `invite-user`: respostas da edge (`{"success":true}` e `400 {"error": frase}`); o que muda é que quem entrou como outra pessoa recebe `403 sem_permissao` + `mensagem` (acima) e que erro interno é `500 {"error":"erro_interno"}`. Um gatilho do banco que recusa (RAISE nosso) sai como `400 {"error": <frase do gatilho>}`.
- Erro de função SQL (`POST /rpc/{nome}` e as rotas de dados): a frase de um `raise exception` escrito por nós (P0001, ou 42501/22023/P0002/23514 levantados por RAISE) vai em `mensagem`: `42501` = `403 sem_permissao`, `P0002` = `404 nao_encontrado`, os demais = `400 regra_de_negocio`. Erros nativos do Postgres (permissão em tabela, constraint, tipo) saem com texto FIXO e o status certo (23505/23503 = `409 conflito`, 57014 e prazo = `504 prazo_esgotado`), sem nome de tabela nem valor. O cliente `api.js` mostra a frase de `mensagem` (o `error` é só o código).
- Senha: mínimo de 6 CARACTERES e máximo de 72 BYTES (o limite do bcrypt; a mensagem diz "72 bytes"). `definir-senha` e `trocar-senha` derrubam também as sessões "entrar como" em que a pessoa é o impersonador, e `trocar-senha` apaga os links de senha ainda vivos; "esqueci" não manda outro e-mail se já houve link para a pessoa há menos de 60 s (resposta idêntica). `faxina-da-api` apaga `tokens_de_senha` vencidos ou usados há mais de 7 dias.
- Login de conta desativada com a senha certa: `403 {"error":"conta_desativada"}` (substitui a RPC `minha_conta_esta_desativada`). `POST /auth/trocar-senha` (204) já tira `precisa_trocar_senha` (substitui a RPC `marcar_senha_trocada`): o Plano 7 troca os dois sítios (`src/moldura-do-aplicativo.vue:247` e `src/compartilhado/controle-de-login-e-usuario.js:65`).
- Leituras de domínio: array no formato do PostgREST; sem permissão = `[]`; linha invisível = 404; erro `{"error","mensagem"}` (contrato completo no Plano 5, seção II.2).

### RPC: o que falta registrar
- `web.RPCPendentes` lista os 92 nomes que o painel chama por `.rpc` e que ainda não estão em `web.FuncoesRPC`, por sub-plano (5.2 = 5, 5.3 = 2, 5.7 = 1, 5.9 = 6, 5.10 = 16, 5.11 = 62); `web.RPCForaDoPainel` lista os 15 que nunca entram (Ruling 23, 3 de página pública, 5 internas com EXECUTE revogado, 5 sem chamada de rede). Registrar uma função = acrescentar em `FuncoesRPC` E tirar de `RPCPendentes` no mesmo commit: a montagem recusa (panic) o nome nos dois lugares, nome proibido, nome em `RPCForaDoPainel`, função sem portão e uma soma diferente de 92. **Critério de entrada do Plano 8: `RPCPendentes` vazia.**
- Reconferir a lista contra o front (2026-10-12: 94 nomes chamados, 92 registráveis): em `src/` (fora de testes e de `src/demonstracao/`) os nomes saem de `.rpc('x'`, `chamar('x'`, `gravar('x'` (as etapas e motivos do Stylist Circle) e `rest/v1/rpc/x`; `gravar('canais_grupos'` é tabela, não RPC.

### Antes do corte: `api worker conferir` no banco restaurado
O comando confere agora também (cada item quebrado vira uma linha e a saída 1):
- colunas `profiles.name/allowed_accounts/avatar_url/precisa_trocar_senha`, `equipes.local_id/deposito_id`, `equipes_permissoes` e `entradas_como_outro_usuario` (`admin_id`, `admin_email`, `alvo_id`, `alvo_email`, `criado_em`);
- PostgreSQL 15 ou mais e `standard_conforming_strings = on` (a gramática de SQL das rotas de domínio supõe os dois; o mesmo teste que a montagem de cada rota faz);
- o papel de conexão da API na auditoria do "entrar como": tem `INSERT` e, com a RLS ligada (produção: RLS ligada e só a policy de SELECT do super-admin), é dono da tabela (com a RLS não FORCE), superusuário ou BYPASSRLS. Senão TODO "entrar como" falharia fechado ("Não consegui registrar a auditoria."). A API grava como dono/BYPASSRLS de propósito: a auditoria não pode depender de policy de usuário. Num restore com `pg_restore --no-owner` o dono vira o papel que restaurou: restaurar COM o papel da API, ou `alter table entradas_como_outro_usuario owner to <papel da API>`;
- cada função registrada em `FuncoesRPC` (vazio no 5.0; cada sub-plano passa a ser conferido ao registrar): existe no schema (`public` em produção) e NÃO existe em `pg_catalog` (o nome sem schema resolve pelo `search_path` com `pg_catalog` na frente); `authenticated` tem `EXECUTE` (se a produção o fechou, a API não pode abrir); nomes e tipos dos parâmetros, quais têm DEFAULT (`pronargdefaults` × `Opcional`) e `proretset`/`void` × `Retorno` batem com o `pg_proc`; sobrecarga é acusada;
- a montagem das rotas de domínio contra as tabelas reais (`web.Rotas`): toda tabela real citada no SQL de uma rota tem de estar no catálogo de policies, senão a montagem falha (o mesmo panic que impede a API de subir).

Rodar também, no banco restaurado e à mão:
```sql
-- FKs que barram a exclusão de uma conta (confdeltype 'a' = NO ACTION barra; 'c' cascata; 'n' set null)
select conrelid::regclass, conname, confrelid::regclass, confdeltype from pg_constraint
 where contype = 'f' and confrelid in ('public.profiles'::regclass, 'public.usuarios'::regclass) order by 1, 2;
-- RLS e dono da auditoria do "entrar como"; policies
select relowner::regrole, relrowsecurity, relforcerowsecurity from pg_class where relname = 'entradas_como_outro_usuario';
select * from pg_policies where tablename = 'entradas_como_outro_usuario';
-- a visão robos_saude perdeu o security_invoker? (reloptions sem security_invoker=true = qualquer sessão lê)
select reloptions from pg_class where relname = 'robos_saude';
-- super-admins da ficha × lista fixa da função is_superadmin()
select email from profiles where is_superadmin order by 1;
```
Checklist do ensaio: `api migrar` aplicou `00005_tokens_de_senha.sql`; `conferir` sai 0; convite real para um e-mail do dono só na janela do corte (o ensaio roda SEM `ZEPTOMAIL_TOKEN`: nenhum e-mail sai); `nginx -t` com as `location` acima; o link do e-mail tem `#type=…&token=…` e o log de acesso não tem o token.

### Achados para o dono (decisão de produto, não corrigidos pela migração)
- **Caminho admin → super-admin (igual na edge e no Go).** (1) Um admin comum exclui um super-admin (`invite-user`, Ruling 21: o portão é só `role = 'admin'`); (2) cria uma conta com senha para o e-mail dele — a lista de `is_superadmin()` é FIXA por e-mail (erick, gabriel.gertrudes, breno); (3) a conta nova vira super-admin em toda policy e RPC que usa `is_superadmin()`. Só resiste conta com histórico preso por FK NO ACTION. Recomendação: decidir uma de duas restrições: não-super não exclui super, OU não cria/convida e-mail de `autz.SuperAdminsPorEmail`.
- **`invite-user` (Ruling 21):** qualquer admin exclui qualquer conta (inclusive a de um super-admin) e cria outro admin. Mantido por "mesmas permissões de hoje" (`TestInviteUserAdminExcluiSuperAdminComoNaEdge` documenta). Restringir é decisão do dono.
- **Auditoria do "entrar como" fraca:** `entradas_como_outro_usuario` não guarda IP, user-agent, hash da sessão nem `expira_em` (o IP só vai ao log da API); gravar exige migração (decisão de schema). E as FKs dela para `profiles` não têm `ON DELETE`: quem já entrou como outra pessoa, ou já foi alvo, NÃO pode ser excluído (edge: "Database error deleting user" e conta sem perfil; Go: `400 "ainda há registros ligados"` atômico, nada é apagado: testado). Decidir: manter o histórico (SET NULL ou sem FK) ou bloquear de propósito.
- **RLS da auditoria:** só a policy de SELECT do super-admin. A API grava como dono/BYPASSRLS (conferido por `conferir`); se um dia a API passar a conectar com um papel sem esses poderes, todo "entrar como" falha fechado.
- **FKs de produção para `auth.users`/`profiles` que barram a exclusão de uma conta** (21 FKs em 16 tabelas para `auth.users`): CASCADE: `profiles.id`, `push_subs.user_id`. SET NULL: `frota_requisicoes.{criada_por,decidida_por,encerrada_por}`, `frota_requisicoes_historico.quem`, `frota_revisoes.criada_por`, `frota_checklist.{criada_por,assinada_por}`, `frota_manutencoes.criada_por`, `frota_uso.aceite_por`. NO ACTION (barram a exclusão): `fabrica_campanhas.criado_por`, `fabrica_jobs.criado_por`, `conteudo_pecas.{criado_por,aprovado_por}`, `conteudo_jobs.criado_por`, `bling_pedido_ajuste_valor.criado_por`, `bling_pedido_ajuste_vendedor.criado_por`, `gt_campanhas_rascunho.criado_por`, `acessos_perfis.criado_por`, `frota_requisicoes.arquivada_por`. Para `profiles`: CASCADE `user_permissions.user_id`, `push_preferencias.user_id`, `equipes_membros.profile_id`, `equipes_permissoes.profile_id`, `canais_grupos_membros.profile_id`; SET NULL `conteudo_pecas.responsavel`; NO ACTION `entradas_como_outro_usuario.{admin_id,alvo_id}`, `user_permissions.granted_by`, `equipes_membros.criado_por`, `equipes_permissoes.concedido_por`, `canais_grupos_membros.concedido_por`; desconhecidas (precisam do dump): `audit_log.actor_id`, `acessos_pessoas.profile_id`. Consequência: quem criou conteúdo, fábrica, ajuste de venda etc. não pode ser excluído (a tela mostra "ainda há registros ligados"); desativar é o caminho.
- **Conta e senha (paridade com o Supabase, mantida):** `trocar-senha` não exige a senha atual (era o `updateUser`); `definir-senha` não limpa `precisa_trocar_senha`; os limites de taxa são em memória, de uma instância só; um super-admin que troca a PRÓPRIA senha perde a sessão em uso (a edge não derrubava); sessão de tipo `servico` de conta admin passaria no portão do `invite-user` (nada cria sessão de serviço hoje); `conferir-senha` não tem limite por IP (igual à edge).
- **Antes do corte:** o catálogo de policies e as funções do oráculo (`api/internal/autz/autzteste/ajudantes.sql`) são de 2026-10-09. Se alguém criar/alterar policy ou uma das 25 funções em produção antes do corte, refazer o levantamento, copiar o JSON novo para `api/internal/autz/`, regerar `ajudantes.sql` e rodar o teste de contrato: forma nova de policy faz a API NÃO subir. O Auth do Supabase deixa de mandar e-mail de convite/troca: conferir no ZeptoMail o domínio remetente e a cota.

## Plano 5.1 — admin, equipes e acesso

### Rotas novas
- Pública: `POST /api/pedir-acesso` (só `name`, `email`, `message`; `status` sempre `pending`). Três defesas, todas na API (Ruling 5.1-17): (1) exige `Content-Type: application/json`, senão 415 `tipo_de_conteudo` (o front, Plano 7, tem de mandar o cabeçalho; a checagem é um middleware ANTES dos dois limitadores, então um pedido `text/plain`, como o de um `<form>` de outro site, não grava nada e não gasta nem a cota por IP nem o teto global; `TestPedirAcessoTipoErradoNaoGastaCota`); (2) 10 por IP por hora; (3) teto GLOBAL de 100 por hora por instância, chave constante, somando todos os IPs. Nos limites 2 e 3 contam os pedidos aceitos e os recusados por validação; o estouro dos dois é o mesmo 429 `muitas_requisicoes` com `Retry-After: 3600`. O por IP vem antes: quem estoura o seu IP não gasta o teto dos outros. Os dois limites são em memória, de uma instância só.
- Com sessão (regra = catálogo de produção; escrita de sessão "entrar como" = 403): `/acesso/usuarios`, `/acesso/perfis`, `/acesso/pedidos`, `/equipes/times`, `/equipes/membros`, `/equipes/permissoes`, `/equipes/grupos`, `/equipes/grupos-membros`, `/avisos/preferencias`, `/eu/push/inscrever`, `/eu/push/desinscrever`, `/saude/conferencias`.
- `/saude/ia-execucoes` NÃO existe no 5.1 (Ruling 5.1-16): a tela de status do Claude lê `ia_execucoes` por `/status-ia/execucoes`, do 5.12.
- Tabelas sem rota (Ruling 5.1-5): `user_permissions`, `audit_log`, `entradas_como_outro_usuario`, `platform_settings`, `robos_esperados`, `robos_execucoes`, `coletor_log`, `projetos_status`, `gestor_log` (nenhum sítio no front; quem escreve é gatilho, worker ou robô).

### nginx
- `location /api/` genérico cobre as rotas com sessão. `POST /api/pedir-acesso` é pública e anônima; a contenção do spam é da API (as três defesas acima, inclusive o teto global, que é o que segura muitos IPs: um /48 de IPv6 tem ~650 mil endereços). O `limit_req` do nginx, se ficar, é só EXTRA (a zona abaixo é por IP, não contém spam de muitos IPs nem o `text/plain` de outro site, cada visitante tem o seu IP). `client_max_body_size 16k` é o que importa: a API aceita até 32 KiB de corpo e a mensagem tem até 2000 caracteres (acento/emoji passa de 4 KiB em UTF-8, e o campo da tela de login não tem `maxlength`: com 4k, mensagem longa viraria 413 e "Erro ao enviar"). Location própria no molde da de `esqueci-senha` (`proxy_pass http://127.0.0.1:8080/pedir-acesso;` e o `X-Real-IP`):
  ```nginx
  limit_req_zone $binary_remote_addr zone=pedido:10m rate=6r/m;   # em http {}; opcional (extra)
  location = /api/pedir-acesso { limit_req zone=pedido burst=3 nodelay; client_max_body_size 16k; proxy_pass http://127.0.0.1:8080/pedir-acesso; }
  ```
- Runbook: um escritório atrás de 1 IP tem 10 tentativas por hora, e as recusadas por validação contam. Num ataque, o teto global de 100 por hora faz pedidos legítimos também receberem 429 até a janela passar (custo aceito do Ruling 5.1-17; a hora é deslizante por instância e zera ao reiniciar a API).

### Mudanças de contrato que o Plano 7 absorve
- Escrita negada responde 403/404 (o PostgREST respondia 2xx com zero linhas); a linha devolvida é a da leitura, ou `{"id"}` quando quem gravou não a lê.
- `criado_por`, `alterado_por` e `concedido_por` saem do corpo (a sessão preenche; mandar = 400).
- Liberação de estoque é apagada por id (`DELETE /equipes/permissoes/{id}`): `tela-de-admin.vue:1239` passa a ler o `id` e `:1497` a usá-lo.
- Preferências de aviso vão em lote (`POST /avisos/preferencias`, array); push por `inscrever`/`desinscrever`.
- `permissions`/`permissions_excecao` têm de ser objeto JSON (400 senão).
- Sessão "entrar como" só lê no 5.1: as 19 escritas respondem 403 (`TestEscritasRecusamImpersonado`).
- Forma da resposta das escritas: `POST`/`PATCH` devolvem OBJETO (não array) e `DELETE` devolve 204 sem corpo; todo `Array.isArray(linhas)` de escrita muda. Estes sítios de `tela-de-admin.vue` dariam falso erro DEPOIS de gravar se só a URL fosse trocada (ex.: criar grupo grava e a tela diz "você não tem permissão"; o segundo clique dá 409): `:1049-1052` (`gravar`, usado nos grupos `:1109`/`:1152`/`:1180`), `:1667-1669` (POST de supervisora), `:1691-1693` (DELETE de supervisora com `return=representation`), `:2365-2366`, `:2557-2558` e `:2809-2810` (PATCH de `profiles`).
- `tela-de-admin.vue`: `:2293` manda `criado_por` (agora 400); `:2310` e `:2509` esperam array e recebem objeto; `:2507-2511` não-super recebe 403 (antes 200 `[]`): mapear o 403 para o aviso "seu login não está na lista de super-admins"; `:2823-2826` manda `alterado_em`/`alterado_por` (agora 400) e `:2828` não confere o status do `adFetch` (um 400 viraria toast "Permissões atualizadas").
- `src/compartilhado/notificacoes-push.js`: `:133` manda `user_id` no corpo do `upsert` de `push_subs`; `POST /api/eu/push/inscrever` aceita só `{endpoint, p256dh, auth}` e responde `400 corpo_invalido` a campo desconhecido (o dono é sempre quem está logado). Tirar o `user_id` ao trocar o sítio (`:129`); sem isso a inscrição de push falha com `nao-salvou`.

### O que o dono precisa saber/decidir (paridade com produção mantida; nada disto foi corrigido)
- **D1 (reproduzido):** admin comum marca `is_superadmin` numa segunda conta (200; pode ser conta dele criada por `invite-user`). Essa ficha é o portão do "entrar como", que aceita qualquer alvo: a conta entra como `breno@` (super por e-mail) e lê tudo como ele. Correção: exigir super por e-mail quando `is_superadmin` muda e/ou "entrar como" recusar alvo super por e-mail.
- **D2 (reproduzido):** admin comum desativa `breno@` e `gabriel.gertrudes@` (`guard_profiles` só protege `erick@`); `disabled` não vai ao `audit_log`.
- **D3 (presumido em produção; a API fecha com 400):** `impedir_autopromocao` não lista `email`; gravar um e-mail da lista de `is_superadmin()` torna a conta super. Conferir em produção quem já trocou e-mail.
- **D4 (reproduzido):** a trava de loja e as contas do admin não limitam o que ele concede (`adminRestrito` dá contas que não vê e tira a trava de outra pessoa).
- **T1:** gestor de um time liga o time a qualquer canal livre do Bling e o time passa a ver o faturamento dele (`tela-de-admin.vue:1363,1401`; policy `equipes_editar`). Decidir: fica com o gestor ou só super-admin.
- **T2:** gestor de qualquer time cria time novo ligado a canal livre e fica sem dono (só super-admin administra).
- **T3:** supervisora/gestor libera estoque para quem não é do time (201); sem efeito hoje, passa a valer se a pessoa entrar no time depois.
- **G2:** apagar grupo com lojas solta as lojas e apaga as supervisoras dele (só o front barra). Decidir 409 ou paridade.
- **G3 e Ruling 5.1-9:** `concedido_por` (supervisoras de grupo, antes nulo; liberações de estoque) agora é preenchido pela sessão, e a FK é NO ACTION: o super que concedeu não pode ter o perfil excluído enquanto a concessão existir (23503, "ainda há registros ligados"); desativar é o caminho. Mesmo efeito de `equipes_permissoes.concedido_por` e `acessos_perfis.criado_por`.
- **P1:** duas definições de super-admin: a tela mostra "Salvar como perfil" pela ficha (`:2267`), mas só grava quem está na lista de e-mails.
- **P2:** apagar perfil de acesso: produção permite ao super; a API não tem rota (nenhuma tela usa; `on delete set null` preserva o acesso).
- **P3:** nome de perfil vazio, só espaços ou de até 1 MiB é aceito como em produção (3 pessoas escrevem). Sugestão: `check (btrim(nome) <> '' and length(nome) <= 120)`.
- **A3:** o esquema de `access_requests` é PRESUMIDO (`01-tabelas-5-01.sql`), fora do levantamento: conferir colunas e CHECK antes do corte (`conferir` cobra as colunas).
- **A4:** nada registra quem aprovou ou negou um pedido (igual produção). **A5:** a lista do admin mostra no máximo 1000 pedidos, sem paginação.
- **W1:** endpoint de push aceita porta livre e não há teto de inscrições por pessoa; o worker envia em série com até 30 s por envio, então N endpoints num host lento atrasam os avisos de todos. Sugestão: só hosts dos serviços de push (FCM, Mozilla, WNS, Apple) na 443 e/ou ~10 inscrições por pessoa.
- **W2:** inscrições com `user_id` nulo (opt-in de 24/07) não recebem nada e ninguém as reivindica: conferir quantas existem em produção.
- **Admin sem ser super:** a tela de Admin só abre para super-admin, mas editar perfis e ler pedidos de acesso exigem `role = 'admin'`: super-admin com papel viewer vê a tela e não grava.
- **Sem perfil:** `/auth/entrar` dá sessão a qualquer usuário com senha, tenha perfil ou não, e quem não tem perfil lê a lista da equipe (igual a produção: `auth_read_profiles` = conta ativa). Se clientes da Vessel vierem a ter senha, leem a lista da equipe.

### Antes do corte
- `api worker conferir` no banco restaurado confere colunas, tipos, únicos, as 4 funções de gatilho que o 5.1 presume (`guard_profiles`, `impedir_autopromocao`, `espelhar_rename_do_grupo`, `equipes_toca_atualizado`) e os 5 gatilhos por nome e tabela em `pg_trigger`, ligados (`tgenabled <> 'D'`): `equipes_atualizado` (`equipes`), `trg_espelhar_grupo_do_canal` (`bling_lojas`), `trg_espelhar_rename_do_grupo` (`canais_grupos`), `trg_guard_profiles` e `trg_impedir_autopromocao` (`profiles`). `ia_execucoes` é cobrada pelo 5.12.
- A fatia `api/internal/testebanco/esquema/` é RECONSTRUÍDA (D0 sem dump): quando o ensaio rodar, troque `01-tabelas-*.sql` pelo `pg_dump --schema-only` limpo e rode os testes; divergência de default ou constraint só aparece aí.
- `access_requests` é presumido (A3): se o `conferir` acusar coluna, ajuste a tabela da fatia e a rota antes de ligar a tela de login.

## Plano 5.12 — painéis pequenos (notícias, status da IA, fatura das contas de IA)

### Variáveis de ambiente (serviço `api`)
| Variável | Observação |
|---|---|
| `ANTHROPIC_ADMIN_KEY` | chave ADMIN da organização Anthropic (Cost/Usage Report). Segredo (`Segredos()`). Vazia = `POST /custo-anthropic` responde 500 `chave_admin_nao_configurada` |
| `OPENAI_ADMIN_KEY` | chave ADMIN da organização OpenAI (Costs API, projetos, chaves). Idem para `POST /custo-openai` |

Hoje as duas estão em `segredos_de_cron` (`anthropic_admin_key`, `openai_admin_key`). Spec §6: o conteúdo é ROTACIONADO, não copiado — gerar chaves admin novas nos consoles, pôr nas variáveis e, depois da virada, revogar as antigas.

### Rotas novas (com sessão)
- `GET /api/noticias/rodadas`, `GET /api/noticias/concorrentes?rodada=…`, `GET /api/noticias/panorama`, `GET /api/status-ia/execucoes`, `GET /api/status-ia/saude-dos-robos` (grupo de domínio; regra do catálogo).
- `POST /api/custo-anthropic`, `POST /api/custo-openai` (papel admin; prazo de 90 s). **NGINX: criar `location = /api/custo-anthropic` e `location = /api/custo-openai` com `proxy_read_timeout 100s;` (e `client_max_body_size 1k;`)**: o `proxy_read_timeout` do nginx tem de ficar acima dos 90 s da API (100 s, como nas demais rotas lentas da seção acima), e o do `/api/` genérico é 60 s; sem isso essas rotas caem no `/api/` genérico (60 s) e uma fatura lenta vira 504 do nginx. A VPS precisa de saída HTTPS para `api.anthropic.com` e `api.openai.com`. Bloco pronto (cada `location` própria nomeia o caminho de destino: o `proxy_pass …:8080/;` do catch-all mandaria `POST /` e a fatura inteira daria 404; mesmo molde de `bling-proxy`, e o cabeçalho próprio exige repetir o `X-Real-IP` e o `Host`):

```nginx
location = /api/custo-anthropic {
  client_max_body_size 1k;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_read_timeout 100s;
  proxy_pass http://127.0.0.1:8080/custo-anthropic;
}
location = /api/custo-openai {
  client_max_body_size 1k;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_read_timeout 100s;
  proxy_pass http://127.0.0.1:8080/custo-openai;
}
```

### Antes do corte
- `api worker conferir` cobra também `noticias_concorrentes` (`id,rodada,destaque,created_at`; `rodada` como `date`), `noticias_panorama` (`rodada,conteudo_md,modelo,created_at`; `rodada` como `date`), `ia_execucoes` (`id,run_at`) e a visão `robos_saude` (`robo,critico`).

### O que o dono precisa saber/decidir (produção; o plano não mexe)
- **`robos_saude` provavelmente está SEM `security_invoker`** desde `db/migrations/2026-09-22-vigia-dos-robos-cada-um-no-seu-teto.sql`: `create or replace view` zera a opção (conferido em Postgres 17) e a migração não a reaplicou. Sem ela a visão roda como o dono e ignora a RLS de `robos_esperados`/`robos_execucoes`: qualquer sessão — e a chave anon — lê a saúde dos robôs. Conferir no banco restaurado do ensaio com a consulta de `reloptions` do bloco SQL acima (vazio = sem a opção). A API já aplica a regra das duas tabelas; corrigir produção (`alter view public.robos_saude set (security_invoker = true)`) é decisão de quem cuida dela.
- **Efeito para quem tem `claude.status` só em `permissions`:** abre a tela (a guarda de rota do front lê `profile.permissions`: `hasPermission` em `src/compartilhado/controle-de-login-e-usuario.js:170`, chamada em `src/mapa-de-enderecos.js:93`), mas `GET /api/status-ia/saude-dos-robos` devolve `[]` (a regra é a das duas tabelas de baixo: conta ativa e papel admin, super-admin pela ficha ou `claude.status` em `features`). Se produção perdeu o `security_invoker`, essa pessoa vê a saúde por acidente hoje; com a API passa a não ver. Mudança intencional (Ruling 1 do plano 5.12); o dono confirma, ou ajusta `features` das pessoas que devem ver.
- **Cache da Anthropic na fatura (decisão do dono; muda o número na tela):** a API real manda `cache_creation: {ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`, não `cache_creation_input_tokens`; por isso a escrita de cache fica FORA do rateio por chave (a edge e o Go fazem igual). E a leitura de cache pesa 1 token no rateio embora custe ~0,1× a entrada. O total da fatura (Cost Report) não muda; muda a divisão entre chaves. Corrigir mudaria o rateio mostrado na tela em relação a hoje, então a API reproduz a edge e a correção fica para decisão do dono.

### Mudanças de contrato que o Plano 7 absorve
- 6 sítios (plano 5.12, seção I.1): 3 leituras de notícias, 2 do status da IA e a chamada das duas edges de custo. A saúde vem `[]` para quem não tem admin, super-admin pela ficha ou `claude.status` em `features`. Não-2xx de `custo-*` agora traz corpo: `403 {"error":"sem_permissao"}`, `500 {"error":"falha","detalhe":…}`. Corpo com `dias` que não é número (`{"dias":"30"}`) dá `400 {"error":"pedido_invalido"}` (a edge coagia o texto em número; Ruling 14 do 5.12 recusa). A rota é só `POST`: `GET` (a edge aceitava `?dias=`) e os demais verbos dão `405` com `Allow: POST`. Todo 500 da rota agora deixa um `slog.Warn` (`custo: devolvendo 500`, com o detalhe sem a chave), como a edge custo-openai registrava.
- Os logos de concorrentes (`tela-de-noticias.vue:99`, Storage `ig-cache`) são do Plano 6.

## Plano 5.13 — contas de serviço (tokens dos robôs)

Os robôs do `coletor/` (Fábrica no Actions, os híbridos da VPS, os validadores da Meta) deixam de usar a chave `service_role` e passam a chamar a API com um token de longa duração. O robô é um usuário SEM senha com perfil `viewer` e `features` mínimas (Ruling 38): o token só o identifica e o que ele pode é o perfil dele, como para gente (catálogo, módulo, conta). Não há escopo por token e não há rota HTTP de criação ou revogação: é CLI na VPS. A migração `00006_tokens_de_servico.sql` roda sozinha no `api`/`api migrar`; só o hash sha256 do token é guardado.

### Criar o robô e o token (na VPS, no contêiner da API, como o `api worker`)
```
api servico criar <nome> <nome>@robos.invalid --modulos meta,banco
```
O `api servico` NÃO migra o banco (como o `api worker`): a migração `00006` já veio com a API no ar; num banco sem ela o comando falha com "relation ... does not exist" e a saída é `api migrar`.
- `<nome>`: `[a-z0-9][a-z0-9-]{1,62}`, único (inclusive entre os revogados), ex.: `fabrica`, `meta-validador`.
- `--modulos` só aceita módulo conhecido pelo código (`auth.ModulosConhecidos`: `meta`, `social`, `sales`, `gestor`, `autenticidade`, `banco`, ...); módulo digitado errado é recusado, não vira robô com 403 calado.
- E-mail recomendado: `<nome>@robos.invalid` (domínio reservado, RFC 2606: nunca recebe correio). O e-mail só identifica o usuário; o comando usa o que foi informado, então NÃO use caixa de gente.
- E-mail novo: cria o usuário (sem senha) e o perfil `viewer` com `features` = `--modulos`, `escopo_por_equipe = false` (em produção o default da coluna é `true`, o que deixaria o robô "restrito por equipe sem vínculo") e `allowed_accounts` nulo (= todas as contas). E-mail que já existe: usa o usuário, mas recusa se ele tiver senha (conta de gente não vira robô), se for super-admin ou se não tiver perfil; nesse caso `--modulos` é recusado (o perfil existente não é mexido por aqui).
- O token (`srv_...`) sai UMA vez, sozinho no stdout (o aviso vai ao stderr); não fica em log nem no banco. Guarde direto no segredo do robô (secret do Actions ou `.env` da VPS).
- O robô não tem senha e não recupera senha: `/auth/esqueci-senha` para o e-mail dele não gera link (resposta igual à de e-mail inexistente), `/auth/definir-senha` recusa o usuário dele (link inválido) e `/auth/trocar-senha` com o token dá `403`. `/auth/sair` com o token também dá `403` e não revoga nada: revogar é só `api servico revogar`.
- O robô manda `Authorization: Bearer <token>` em toda chamada. O que mais ele precisa (módulos, permissões) se ajusta no perfil do usuário, na tela de acesso, não no token.

### Rotação e revogação
- Rotação = criar um token NOVO para o mesmo robô (`api servico criar fabrica-2 <mesmo-email>`, sem `--modulos`), trocar o segredo do robô, conferir que `api servico listar` mostra o novo com último uso, e só então `api servico revogar fabrica`. Os dois valem durante a troca.
- `api servico revogar <nome>` derruba o token na próxima chamada (401). Desativar o usuário (`desativado_em`) ou o perfil (`disabled`) também derruba todos os tokens dele.
- `api servico listar`: nome, e-mail, criado, último uso (gravado no máximo a cada 5 min), revogado. Nunca mostra o token (ele não existe no banco).

### O robô `status-projetos` é aposentado (Ruling 39)
`projetos_status` não ganha rota de escrita: o quadro de projetos saiu da tela em 19/08/2026 e ninguém lê a tabela. Não crie token para ele; se o quadro voltar, uma rota de upsert só para serviço resolve.

### Antes do corte
- O 5.8 (rotas de robô da Fábrica) protege as rotas com `auth.SoServico` (sessão de painel ou de "entrar como" leva 403; o banco também recusa sessão de serviço com impersonador: CHECK `sessoes_servico_sem_impersonador`, migração 00006); os robôs do coletor só trocam a `service_role` pelo token depois que as rotas deles existirem.

## Plano 5.6 — Meta e redes (métricas)

### Rotas novas (com sessão; regra = catálogo de produção; escrita de sessão "entrar como" = 403)
- Leituras: `/redes/contas`, `/redes/seguidores`, `/redes/leituras-de-seguidores`, `/redes/engajamento`, `/redes/conteudo`, `/redes/campanhas`, `/redes/conjuntos`, `/redes/anuncios`, `/redes/insights-de-campanha`, `/redes/insights-da-conta`, `/redes/campanhas-por-hora`, `/redes/anuncios-por-hora`, `/redes/visitas-por-hora`, `/redes/metas`, `/redes/filtros-de-campanha`.
- Escritas: `PATCH /redes/contas/{id}` (papel admin), `PUT /redes/metas`, `PUT /redes/filtros-de-campanha/{account_id}`.
- `meta-proxy`, `insights-ao-vivo`, `serie-novos-dia`, `contar-collabs` (Plano 3) passam por `autz.ComEscopo` e recusam conta fora de `allowed_accounts` (Ruling 34).

### Mudanças de contrato que o Plano 7 absorve
- `limite` vai até 1000: `limit=5000` (tela-de-redes-sociais.vue:2121, 2122, 2280, 2456-2459) vira `limite=1000&contar=1`, e a tela avisa quando `X-Total-Count` passa do que veio (substitui `length >= _tetoAds`, que nunca disparava). Contagens do Admin (`select=id` + `.length`, tela-de-admin.vue:4029-4031) viram `contar=1&limite=1` + `X-Total-Count`.
- Filtros com nome: `account_id`, `period_days`, `period_days_ate`, `captured_at`, `captured_at_de`, `captured_at_ate`, `campaign_id` (lista por vírgula), `lido_em_de` (instante RFC 3339: o Gestor, tela-de-gestao-trafego.vue:746, manda `<data>T00:00:00Z` em vez da data pura), `dia_de`; ordens `captured_at`, `lido_em`, `period_days`, `name`.
- Metas: `PUT /redes/metas {"metas":[…]}` (o lote é atômico; recusa = 403 e a tela mostra, em vez do `console.warn`). Filtros: `PUT /redes/filtros-de-campanha/{account_id} {"selected_ids": …}` (sem `updated_at`).
- Conta: `PATCH /redes/contas/{id}` (Admin 4004, Gestor 1331, Conteúdo 499); quem não tem papel admin recebe 403 (o Portal de Notícias da Central de Conteúdo hoje "salvava" sem gravar).
- `ads_snapshots`: sem rota; o cartão "Ads" da aba Dados do Admin (tela-de-admin.vue:4032) sai.
- `meta-proxy`: conta fora da lista = `400 conta nao encontrada`; caminho fora da conta (para quem tem lista) = `403 caminho fora da conta`; `POST`/`DELETE`/mídia de sessão "entrar como" = `403 sem_permissao`. Rotas ao vivo: conta fora da lista = 404.
- `meta-proxy`, detalhes decididos na execução: qualquer chave de `params` que, normalizada para `method` (espaços à esquerda removidos, corte no primeiro caractere fora de `[A-Za-z0-9_]`, sem diferenciar maiúsculas), seja `method` conta como escrita (sessão impersonada = `403 sem_permissao`); quem não vê todas as contas não pode mandar os params `ids`/`batch` (`403 caminho fora da conta`); `?campaign_id=` vazio devolve `200 []` (não `400`).
- `meta-proxy`, expansão aninhada: para quem tem lista, valores de `params` que nomeiem arestas que alcançam outras contas (`business`, `owner`, `owner_business`, `agencies`, `adaccounts`, `*_accounts`...) = `403 caminho fora da conta` (a Graph expandia `fields=business{owned_ad_accounts{...}}` com o token único do core). `access_token` em `params` = `400 parametro nao permitido` (todos).

### Achados para o dono
1. `accounts` e `visitas_perfil_dia` não têm a restritiva por conta em produção (o plano-mestre dizia que todas as 17 tinham): qualquer sessão lista todas as marcas e, pelo PostgREST de hoje, lê as visitas por dia de qualquer conta. A API mantém a lista de contas (paridade, colunas fechadas) e não abre rota para `visitas_perfil_dia`; correção = duas policies `so_contas_permitidas` em produção.
2. O Ruling 34 literal não fechava nada: o token do core é único, então quem tem lista lia qualquer conta pondo outro `path` no `meta-proxy`. A API ancora o caminho na conta do pedido; custo: pessoa com lista perde `/me/*` e edição por id de objeto no Gestor e na Análise de campanhas (31/07: 0 de 15 perfis tinham lista; conferir antes do corte).
3. "Entrar como" criava campanha e subia mídia na Meta pela edge (o JWT do alvo valia). A API recusa `POST`/`DELETE`/mídia de sessão impersonada.
4. O push de saldo (Plano 4) avisa todo inscrito sobre o saldo de TODAS as contas de anúncio, tenha ou não lista (como o push de vendas, Ruling 24): decisão de produto.
5. Corte silencioso de linhas (se o `max_rows` é 1000): o intervalo personalizado de Redes pede 5000 e só avisa ao chegar a 5000; a fila do Gestor soma 3 dias de todas as contas numa leitura; os contadores do Admin param em 1000. A API devolve `X-Total-Count` e o Plano 7 passa a avisar.
6. Métricas sem módulo: qualquer sessão lê as métricas das contas que vê, com ou sem `social`/`meta` (as policies não olham módulo). Mantido; fechar = policy por módulo.
7. Tabelas sem dono: ninguém grava `ads_snapshots` (o cartão "Ads" do Admin conta uma tabela morta); `account_insights` só é gravada pelo coletor Python do Mac (o Plano 4 não o portou): com o Mac parado, o alcance deduplicado de Redes some sem aviso.
8. Edição de marca: o Portal de Notícias (Central de Conteúdo) "salva" sem gravar para quem não tem papel admin (update de 0 linhas sem erro); super-admin com papel viewer também não edita marca. A API responde 403 (a tela passa a dizer).
9. `contar-collabs` lê `/media` dos outros perfis pelo token único do core e devolve só totais: decisão de produto se isso conta como ler outra conta.
10. `access_token` em `params`: o Core passou a recusar `access_token[]` e `ACCESS_TOKEN` (vessel PR #293, core-go 2e9d7b852), mas `access_token[0]` (e outras grafias) ainda passaria pelo Core. A API Go recusa qualquer grafia de `access_token` em `params` (chave normalizada) antes de chamar o core: `400 {"error":"parametro nao permitido"}`, para todos.

### Antes do corte
- `api worker conferir` no banco restaurado: colunas, tipos, únicos e `pode_ver_conta(text)` do 5.6 (em especial os presumidos: `social_metas`, `campaign_filters`, `account_insights`, `engagement_snapshots.created_at`).
- Grant por coluna de `accounts`: `select has_column_privilege('authenticated','public.accounts','access_token','SELECT')` = `false` e o mesmo para `publicacao_automatica` (a lista fechada das rotas replica isso; coluna nova que a tela precise ler entra na lista com Ruling).
- Nenhum gatilho nas 17 tabelas: `select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname in ('accounts','account_insights','daily_snapshots','engagement_snapshots','content_snapshots','campaigns','campaign_insights','campaign_insights_hora','campaign_adsets','campaign_filters','ads','ads_snapshots','ad_insights_hora','perfil_visitas_hora','followers_leituras','social_metas','visitas_perfil_dia')` = 0.
- Quem tem lista de contas: `select count(*) filter (where allowed_accounts is not null) as com_lista, count(*) filter (where allowed_accounts is not null and features && '{meta}') as com_lista_e_meta from profiles` — se `com_lista_e_meta` > 0, avisar que o Gestor/Análise de campanhas perdem `/me/*` e objetos soltos para essas pessoas (Ruling 5.6-5).
- Conta de serviço que chamar o `meta-proxy` (robôs do `coletor/`, Plano 7) precisa de perfil ativo com `allowed_accounts` nulo (ou papel admin): sem perfil, toda conta é recusada.

## Plano 5.7 — Gestão de tráfego

### Variáveis de ambiente (serviço `api`)
| Variável | Observação |
|---|---|
| `ANTHROPIC_API_KEY_TRAFEGO` | a chave da Anthropic dos proxies `sugerir-publico-ia` e `ler-documento`. Hoje ela mora na tabela `segredos_de_cron` (nome `anthropic_api_key_trafego`), lida pela edge com a chave de serviço: quem tem acesso **copia o valor para a variável ANTES do corte**. Vazia = `503 chave_nao_configurada` (nada é chamado). É segredo (`Segredos()`). Depois do corte, a linha da tabela pode sair (decisão do dono). Hoje o valor vem do segredo do GitHub de mesmo nome (`ANTHROPIC_API_KEY_TRAFEGO`), copiado para `segredos_de_cron` pelo `.github/workflows/guardar-chave-ia.yml`; depois do corte, trocar a chave = mudar a variável do serviço `api` (o workflow deixa de valer) |

### Rotas novas
- Com sessão, regra = catálogo de produção, escrita de sessão "entrar como" = 403: `GET /gestao-trafego/analises-de-orcamento`, `/analises-de-anuncio`, `/decisoes`, `/rascunhos`, `/config-metricas`, `/objetivos`, `/regua`, `/interesses-sugeridos`; `POST /gestao-trafego/decisoes`, `POST /gestao-trafego/rascunhos`, `PATCH`/`DELETE /gestao-trafego/rascunhos/{id}`, `PUT /gestao-trafego/config-metricas/{balde}`, `PUT`/`DELETE /gestao-trafego/objetivos/{alvo_id}`, `PUT /gestao-trafego/regua`; `POST /rpc/gt_registrar_problemas`.
- Proxies (grupo de sessão, cada um com o prazo próprio; o de 30 s do grupo de domínio cortaria a IA): `POST /sugerir-publico-ia` e `POST /ler-documento` (módulo `meta.gestor`, prazo 120 s, 30 e 10 por hora por pessoa), `POST /buscar-lugar` (módulo `meta`, prazo 20 s, 60 por minuto por pessoa, uma ligação por segundo ao Nominatim).
- Leituras sem a restritiva por conta em produção, por decisão (Ruling 5.7-3, achado 3): `/config-metricas`, `/objetivos` e `/regua` mostram as metas e os objetivos de TODAS as contas a toda sessão, como hoje. As outras cinco (análises, decisões, rascunhos, interesses) são varridas contra vazamento em `TestNadaVazaEntreContas`.

### Hook `Conferir` das RPCs e a regra "mover problema de conta = 403"
- `rpc.Funcao` ganhou o campo `Conferir` (função chamada na MESMA transação, depois do portão e de `ParamConta`, antes de a função SQL rodar; erro `autz.ErrNegado` vira 403). Quem registrar RPC nova com regra que o portão e a conta do parâmetro não cobrem usa este gancho, não um middleware.
- `gt_registrar_problemas` o usa: o upsert da função é por `(ad_id, codigo)` e REESCREVE o `account_id` da linha existente. Item que já pertence a OUTRA conta (ou a nenhuma) moveria o problema de dono: a API responde **403** sem rodar a função. O robô grava por fora da API (ver "Decisão adiada" abaixo), não por esta rota, e não é afetado; há uma janela de corrida entre a conferência e a função (aceitável, comentário `ponytail:` em `itensSoDaConta`).

### `silenciar_ate` da fila (Ruling 5.7-17)
- `POST /gestao-trafego/decisoes`: o servidor calcula `silenciar_ate` (agora + 7 dias ao recusar; nulo ao aprovar) e RECUSA o campo no corpo (400). A tela sempre mandava `agora + 7 dias`, então o prazo vindo do navegador só servia para calar uma campanha por anos. Mudar o prazo vira deploy da API (`diasDeSilencio` em `internal/trafego/fila.go`); a tela deixa de mandar o campo no Plano 7.

### Conta da decisão (achado I-1 da revisão final)
- `POST /gestao-trafego/decisoes`: a conta vem da campanha quando ela está em `campaigns`; divergente = 403. Se a campanha existe com conta e o corpo traz `account_id` diferente, `403 sem_permissao` e nada é gravado; se o corpo traz nulo ou omite, o servidor grava a conta da campanha. Campanha fora de `campaigns` (ou sem conta): vale o corpo, como antes. Sem isso, quem tem lista de contas calaria a campanha de outra conta mandando conta nula (a tela junta as decisões por `campaign_id`).

### Decisão adiada: robô `vigia-problemas-meta`
- O robô da VPS `vigia-problemas-meta` (`coletor/vigia-problemas-meta.mjs`) HOJE chama `POST ${SUPABASE_URL}/rest/v1/rpc/gt_registrar_problemas` com `SUPABASE_SERVICE_KEY` (`coletor/vigia-problemas-meta.mjs`) e PARA no corte. Decidido em COORDENACAO 12/10 23:10 (a): no Plano 7 (trilha C) ele passa a chamar a função por `pg` com `set_config('request.jwt.claims','{"role":"service_role"}', true)` e o papel de banco do robô com `EXECUTE` na função. Em nenhum dos dois casos passa pela API (sem `ParamConta` e sem a regra de mover conta): a regra "problema não muda de conta" só vale para a tela. Migrá-lo para sessão de serviço (perfil `meta.gestor` ou admin e `allowed_accounts` nulo) fica fora de escopo.

### nginx
- `location = /api/ler-documento { client_max_body_size 5m; proxy_read_timeout 130s; proxy_pass http://127.0.0.1:8080/ler-documento; }` e `location = /api/sugerir-publico-ia { proxy_read_timeout 130s; proxy_pass http://127.0.0.1:8080/sugerir-publico-ia; }` (o padrão de 60 s cortaria a IA; o `64k` do `server {}` recusaria o PDF). O `location = /api/sugerir-publico-ia` também precisa de `client_max_body_size 1m;` (a API aceita 1 MiB; o `server {}` tem 64k, e a persona viaja no corpo). `/api/buscar-lugar` fica no padrão (prazo 20 s). Formato de log sem corpo (o PDF e a persona viajam no corpo).

### Mudanças de contrato que o Plano 7 absorve
- Leituras por `GET /gestao-trafego/<recurso>` com filtros nomeados (`account_id`, `veredito`, `escopo`, `campaign_id`, `status`, `alvo_id`, `conta_id`, `nivel`, `marca_id`, `objetivo`) e `ordem=decidido_em|updated_at[.desc]`; a régua é `GET /gestao-trafego/regua` (lista de uma linha). Interesses: `?account_id=` (substitui o `fabrica_marcas!inner(account_id)`); a conta vem em `account_id`, não em `fabrica_marcas.account_id`.
- Decisão: `POST /gestao-trafego/decisoes` SEM `decidido_por` (vem da sessão; mandar = 400) e SEM `silenciar_ate` (o servidor calcula); conta que não se vê = 403; a conta vem da campanha quando ela está em `campaigns` (divergente = 403). A tela casa decisões pelo par (`account_id`, `campaign_id`) e pode filtrar por `?account_id=`.
- Rascunhos: `POST` sem `criado_por`; `PATCH`/`DELETE` de rascunho de outra pessoa = 403 (antes: 0 linhas calado).
- Config de métricas: `PUT /gestao-trafego/config-metricas/{balde} {"metricas":[…]}` (sem `updated_at`). Objetivos: `PUT /gestao-trafego/objetivos/{alvo_id} {"nivel","interacao","conta_id"}`; `DELETE` é 204 também sem linha (a releitura de gt:802 sai).
- Régua: UM `PUT /gestao-trafego/regua {"pesos","limiares","limiares_resultado","conta_id","metas"}` (só as metas DA conta; o servidor funde em `metas_por_conta` e grava o histórico junto) substitui o `update` de gt:1615 + o `insert` no log de gt:1624; `conta_id` que a pessoa não vê = 403.
- RPC: `POST /rpc/gt_registrar_problemas` com o mesmo corpo; conta que não se vê = 403 e item que mudaria de conta = 403 (a tela já engole a falha: o `console.warn` de gt:941).
- `sugerir-publico-ia` passa a exigir `contaId` (a conta aberta, `_gtCurAcc.id`); conta fora da lista = 404 `conta_nao_encontrada`; erros novos `sem_conta` (400) e `muitas_leituras` (429). `ler-documento`: `nao_e_pdf` (400) e `muitos_documentos` (429). `buscar-lugar`: `termo longo demais` (400) e 429 `muitas buscas seguidas; espere um minuto`. As três trocam `functions.invoke`/`fetch(SUPABASE_URL+…)` pelo `POST /api/<nome>` do cliente `api`.

### Antes do corte
- `api worker conferir` no banco restaurado: colunas, tipos (`account_id` das `gt_*` e de `fabrica_marcas` como `text`), únicos e `gt_registrar_problemas(text,jsonb)` do 5.7 — em especial os presumidos: `gt_budget_analises.impactos` e `gt_ponderada_config.limiares_resultado` (ambos `jsonb`).
- Gatilho: `select tgname from pg_trigger where tgrelid = 'public.gt_campanhas_rascunho'::regclass and not tgisinternal` = `gt_rascunho_updated_at` e nenhum outro nas 10 tabelas.
- A chave: `ANTHROPIC_API_KEY_TRAFEGO` preenchida (um `POST /sugerir-publico-ia` de teste no ensaio, com uma conta da lista, volta 200).
- Robôs do `coletor/` que usam estas tabelas com a chave de serviço (Plano 7): `budget-ia.mjs` (grava `gt_budget_analises`/`gt_ad_analises`, lê a régua e os objetivos), `vigia-problemas-meta.mjs` (HOJE chama `/rest/v1/rpc/gt_registrar_problemas` com `SUPABASE_SERVICE_KEY` e PARA no corte; no Plano 7, trilha C, passa a chamar a função por `pg` com `set_config('request.jwt.claims','{"role":"service_role"}', true)` e o papel de banco do robô com `EXECUTE` na função — ver "Decisão adiada"), `sugerir-interesses.mjs` (grava `interesses_sugeridos`), `conferir-a-madrugada.mjs` (lê `gt_problemas_meta`, que não tem rota).
- `select account_id, count(*) from gt_budget_analises group by 1` (achado 4: linhas antigas com o id do token no lugar da conta).

### Achados para o dono
(ver a seção "Achados para o dono" do plano 5.7)

## Plano 5.9 — Central de Conteúdo

### Rotas novas
- Com sessão, regra = catálogo de produção (conteudista = papel `admin`, `is_superadmin` ou o módulo `conteudo` em `features`; a restritiva `pode_ver_conta` em peças, ideias, blocos e jobs), escrita de sessão "entrar como" = 403: `GET /conteudo/pecas` (com `capa`, `metrica` e `sugestao` embutidas), `/arquivos`, `/eventos`, `/ideias`, `/blocos`, `/concorrentes`, `/jobs`; `POST`/`PATCH`/`DELETE /conteudo/pecas[/{id}]`, `POST`/`PATCH`/`DELETE /conteudo/arquivos[/{id}]`, `POST /conteudo/eventos`, `POST`/`PATCH /conteudo/ideias[/{id}]`, `POST`/`PATCH /conteudo/blocos[/{id}]`, `POST`/`PATCH /conteudo/concorrentes[/{id}]`.
- As filhas da peça (arquivos, eventos, a métrica e a sugestão embutidas) só aparecem com a peça VISÍVEL (em produção não tinham a restritiva). `concorrentes` continua sem a restritiva (paridade, Ruling 5.9-5).
- RPC: `POST /rpc/conteudo_aprovar_e_agendar`, `conteudo_casar_na_mao`, `conteudo_decidir`, `conteudo_decidir_casamento`, `conteudo_ideia_virar_peca`, `conteudo_reavisar` — portão = a checagem de dentro de cada função; a peça/sugestão/ideia/conta do parâmetro tem de ser de conta que a pessoa vê (403 sem a função rodar).
- `POST /conteudo-trigger` (portão da edge: papel `admin`, super pela ficha, a chave `conteudo` em `permissions` ou o módulo `conteudo`; conta visível; sessão de "entrar como" = 403 com a frase, sem gravar): grava o pedido em `conteudo_jobs` (`enfileirado`) e NÃO chama o GitHub. Quem roda é o vigia da VPS (abaixo).

### Robô de Conteúdo na VPS (trilha C, Plano 7)
- O `conteudo-ideias.yml` (GitHub Actions) deixa de existir: `coletor/vps/conteudo-vigia.sh` + `conteudo-vigia.service` pegam o job da fila por `pg` (passo a passo na seção "Robô de Conteúdo na VPS" do plano 5.9). Até o vigia estar no ar, o botão "Gerar ideias com IA" grava o pedido e a tela gira a ampulheta; o vigia expira (`erro`) o pedido com mais de 30 min na fila em vez de gastar IA com clique velho.
- **O vigia roda só o job `enfileirado` MAIS NOVO de cada conta e marca os mais velhos da mesma conta como `erro`** ("Substituído por um pedido mais novo"), em vez de pegar por `order by created_at`. A API só barra um segundo job da mesma conta por 3 min (trava consultiva, `ja_rodando`); com o vigia parado por mais de 3 min, cada novo clique entra na fila, e sem esta regra ele os rodaria todos em sequência quando voltasse: IA paga (Opus) por clique repetido da MESMA conta. Na SQL do passo 3 do plano 5.9: antes do `update ... returning`, `update conteudo_jobs j set status = 'erro', updated_at = now(), erro = 'Substituído por um pedido mais novo.' where j.status = 'enfileirado' and exists (select 1 from conteudo_jobs n where n.account_id = j.account_id and n.tipo = j.tipo and n.status = 'enfileirado' and n.created_at > j.created_at)`; o `order by created_at` do pegar fica. (A mesma regra vale para `ideias` e `semana` separados: o `tipo` entra na comparação.) Prova antes do corte: três cliques com o vigia parado → ao ligar, UM `concluido` e dois `erro`.
- Papel de banco `conteudo_robo` (senha em `/etc/robos.env` como `CONTEUDO_DB_SENHA`), com SELECT/INSERT/UPDATE só no que os dois scripts usam (seção da trilha C) — regras 2, 4, 11 e 15 de `ops/vps/api-db/LEIA-ME.md` para ele.

### Antes do corte
- `api worker conferir` no banco restaurado: as colunas e os tipos das 9 `conteudo_*`, a função `conteudo_guarda_aprovacao()` e o gatilho `conteudo_pecas_guarda` LIGADO em `conteudo_pecas`; as 6 RPCs pelo `conferirRPC` (DEFAULT de `p_motivo` e `p_publicar_em`, EXECUTE de `authenticated`).
- Nenhum outro gatilho nas `conteudo_*`: `select c.relname, g.tgname from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname like 'conteudo\_%'` = só `conteudo_pecas | conteudo_pecas_guarda`.
- As frases das funções (sem acento) e os corpos verbatim: `select md5(prosrc) from pg_proc where proname like 'conteudo\_%' order by proname` no banco restaurado = o mesmo `select` num Postgres de teste com as fatias carregadas (`testebanco.ComEsquemaDeProducao`, que inclui o `03-funcoes-5-09.sql`); diferente = alguém mudou a função em produção depois do levantamento — refaça o `TestPortoesIguaisAsFuncoes` com a nova antes do corte.
- Pedidos órfãos: `select status, count(*) from conteudo_jobs where status in ('enfileirado','rodando') group by 1` — os que ficaram do Actions viram `erro` antes de ligar o vigia (senão ele os roda na primeira volta): `update conteudo_jobs set status = 'erro', erro = 'pedido de antes da mudança para a VPS', updated_at = now() where status in ('enfileirado','rodando')`.
- Objetos do bucket `conteudo` copiados para o disco (Plano 6) antes de a tela apagar arquivo pela API (hoje `excluirPeca`/`removerArquivo` apagam do Storage primeiro).

### Mudanças de contrato que o Plano 7 absorve
- Peças: `GET /conteudo/pecas?account_id=` (ou `?id=`; `status` lista por vírgula; `ordem=publicar_em|created_at[.desc]`) com `capa {caminho,tipo}`, `metrica {…}` e `sugestao {…}` em cada peça — somem `miniaturasDasPecas`, `metricasDasPecas` e `sugestoesDeCasamento` (a lista de ids na URL). `POST /conteudo/pecas` SEM `status`, `publicado_em`, `criado_por` (vem da sessão), campos de aprovação ou do Instagram — `criarPeca` deixa de mandar `criado_por` (400 se mandar); `avisado_em` só `null`. `PATCH` com `status`: sem `conteudo.aprovar`, levar de `em_aprovacao` a `aprovada|reprovada|agendada` = `400 regra_de_negocio` com a frase da função (o PostgREST respondia o mesmo P0001). `DELETE` é 204.
- Arquivos: `POST /conteudo/arquivos` com `caminho` = `<conta>/<peça>/<nome>` da PRÓPRIA peça (403 fora), `bucket` só `conteudo`; `PATCH` só `ordem` (-1 a 1000, a troca em três passos continua); peça que não se vê = 403 na criação e 404 no resto.
- Eventos: `POST /conteudo/eventos` sem `quem` (vem da sessão); `acao` só `criou|mudou_status|remarcou|duplicou`.
- Ideias: `GET /conteudo/ideias?da_marca=<conta>&descartada=false` (substitui o `.or(account_id.eq.X,account_id.is.null)`); `POST` sem `origem`, `modelo`, `job_id`, `situacao`, `peca_id`, `criado_por`; `PATCH` com `situacao`/`peca_id` (peça que não se vê = 403).
- Blocos: `GET /conteudo/blocos?da_marca=<conta>&ativo=true`; `POST` exige `nome` (o apelido: hoje a tela manda `null` e o banco recusa, achado 7) e não aceita `criado_por`; `PATCH` só `{"ativo": false}`.
- Concorrentes: `GET /conteudo/concorrentes?account_id=&ativo=true`; `POST` (409 se o @ já existe na marca); `PATCH` só `ativo`.
- Job: `GET /conteudo/jobs?id=` (sem `criado_por` nem `github_run_id`).
- RPCs: `POST /api/rpc/<nome>` com o mesmo corpo de `sbClient.rpc`; o erro de negócio chega como `400 {"error":"regra_de_negocio","mensagem":<frase da função>}`; peça de conta que não se vê = 403.
- `conteudo-trigger`: mesma URL sob `/api`, mesmo corpo e mesma resposta; erros: `400 conta_invalida` (também conta inexistente), `400 corpo_invalido` (campo a mais), `403 sem_permissao` (também conta que não se vê), `409 ja_rodando` com `job_id`, `500 insert_falhou` (sem `detail`). Some o `502 dispatch_falhou`.
- Conta e pessoas: `listarContas`/`mudarUsoDoPortal` → `/redes/contas` (5.6; o Portal de Notícias só para papel `admin`, como a policy de hoje: Ruling 5.9-13); `listarPessoas` → `GET /acesso/usuarios` (5.1). Storage (`urlAssinada`, `subirArquivo`, `duplicarPeca`, `removerArquivo`, `excluirPeca`): Plano 6.

### Dívida conhecida: `conteudo_casar_na_mao` e o `ig_media_id` de outra conta
- A RPC grava o `ig_media_id` (extraído do link) na peça, e esse id é ÚNICO no banco inteiro (índice global em `conteudo_pecas.ig_media_id`; não existe tabela de mídia com a conta). A API confere que a PEÇA é de conta que a pessoa vê, mas não de quem é a mídia: quem vê só a Vessel pode colar o link de uma publicação da Mantova numa peça da Vessel. Dois efeitos: (1) ocupa o `ig_media_id` e a peça que de fato for da Mantova recebe 409 ao casar a dela; (2) a resposta (409 ou sucesso) revela se aquele id já está em uso, mesmo em outra conta. Não dá para fechar na API sem uma fonte da conta da mídia (o Instagram só diz o dono pelo token, e o robô do espelho é quem sabe). Mantido (paridade com a função de hoje, que é SECURITY DEFINER e ignora a conta); fechar = o espelho preencher uma tabela `conteudo_midias (ig_media_id, account_id)` e a função/Conferir cruzar. Decisão do dono; registrada, sem mudar o escopo do 5.9.

### Achado de produção: o atalho do não-aprovador (a API fecha, a produção ainda não)
- O gatilho `conteudo_guarda_aprovacao` só dispara quando a peça está em `em_aprovacao`. Em produção, quem tem o módulo `conteudo` mas NÃO `conteudo.aprovar` leva uma peça de `rascunho` ou `reprovada` direto a `aprovada`, `agendada` ou `publicada` pelo PATCH do PostgREST, sem passar pela aprovação. A rota `PATCH /conteudo/pecas/{id}` fecha isso (`Conferir` em `tabelaPecas`: sem `conteudo.aprovar`, só vai a `aprovada`/`agendada` a peça que já está em uma delas, e a `publicada` a que já está aprovada, agendada ou publicada; commits `ff0b9c92` e `296328bf`). **Produção continua permitindo até o corte**: achado para o dono (a mesma guarda, ampliada para qualquer origem, é um `create or replace` no gatilho em produção; decisão sua).

### Robô de Conteúdo na VPS: passo a passo da trilha C (resumo; o completo está na seção "Robô de Conteúdo na VPS" do plano 5.9)
1. **Contrato da fila** (o que a API garante): linha em `conteudo_jobs` com `status = 'enfileirado'`, `tipo` `ideias` ou `semana`, `account_id` de conta que existe, `criado_por` de quem pediu, `github_run_id` nulo, `params` `{"quantas": 1..20}` ou `{"segunda": "AAAA-MM-DD"|null}`. A API NÃO chama o GitHub nem o robô: só enfileira.
2. **Scripts em `pg`** (`coletor/conteudo-ideias.mjs`, `conteudo-semana.mjs`): trocam `sb()` (REST + `SUPABASE_SERVICE_KEY`) por `pg` com `CONTEUDO_DATABASE_URL`, nas mesmas leituras e escritas; `--job <id>` lê `quantas` de `params` (`Math.min(20, ...)`) e não marca `rodando` (o vigia já marcou); `registrar-execucao.mjs` ganha o caminho `pg`.
3. **Vigia** (`coletor/vps/conteudo-vigia.sh` + `conteudo-vigia.service`, molde do `cartoes-ean`): volta de 10 s, UM job por vez na VPS; expira `enfileirado` com mais de 30 min e `rodando` sem sinal há 20 min; **pega só o mais novo `enfileirado` por conta e marca os velhos `erro`** (acima); pega com `for update skip locked`; `tipo` por lista fechada (`ideias` → `conteudo-ideias.mjs`, `semana` → `conteudo-semana.mjs`; nunca o valor vira nome de arquivo sem a lista); `timeout 15m node coletor/$s --job "$id"`; saída diferente de 0 com o job ainda `rodando` → `erro`. `git pull --ff-only` só com nenhum robô rodando; log em `/var/log/robos/conteudo-vigia.log`, sem segredo.
4. **Unidade systemd**: `EnvironmentFile=/etc/robos.env`, `Restart=always`, `Nice=10`, `CPUWeight=20`, `MemoryHigh=384M`, `MemoryMax=512M`; senha do papel em `/root/secrets/conteudo.senha` e `CONTEUDO_DB_SENHA` no `/etc/robos.env` (`600 root`), por ambiente, nunca por argumento; a chave da Anthropic é a mesma do `budget-ia`.
5. **Papel `conteudo_robo`** (`ops/vps/api-db/papel-conteudo.sql`, só com ok do dono): `login nosuperuser nocreatedb nocreaterole noinherit connection limit 2`; `select (id, name, username, conteudo_usa_portal)` em `accounts` (por coluna: a tabela guarda `access_token`); `select` em `conteudo_blocos`, `conteudo_pecas`, `conteudo_concorrentes`, `conteudo_metricas`, `noticias_concorrentes`; `select, insert` em `conteudo_ideias`; `select (id, tipo, account_id, params, status, created_at, updated_at)` e `update (status, resultado, erro, updated_at)` em `conteudo_jobs`; `insert` em `ia_execucoes`; nenhum `execute`. RLS ligado nessas tabelas = o papel lê vazio: `select relname from pg_class where relname like 'conteudo\_%' and relrowsecurity` tem de ser vazio.
6. **Provas** (no `api-db` de ensaio): `POST /conteudo-trigger` → `rodando` em até 10 s e `concluido` com `resultado.gravadas`; `semana` → plano; job de 31 min atrás → `erro` sem chamar a IA; `kill -9` do `node` → `erro` em até 20 min; vigia parado com 3 cliques → ao ligar, UM `concluido` e dois `erro`; `grep -c "$(cat /root/secrets/conteudo.senha)"` no log = 0.
7. **No corte**: os `enfileirado|rodando` que vierem do Supabase viram `erro` ANTES de ligar o vigia; `systemctl enable --now conteudo-vigia`; `conteudo-ideias.yml` e a edge `conteudo-trigger` saem no Plano 7. Reverter: `systemctl disable --now conteudo-vigia` (o pedido fica `enfileirado`; ao religar, o que tiver mais de 30 min expira).

### Achados para o dono
(ver a seção "Achados para o dono" do plano 5.9)
## Plano 5.8 — Fábrica de anúncios

**Fica de fora, esperando o 5.5:** `POST /fabrica-candidatos` (Task 7) lê `gc_vendas_item`, `gc_estoque_item` e `gestao_comercial_briefings`, que são do 5.5. Quando o 5.5 entrar, a Task 7 acrescenta a rota (portão `soFabricante`, sem `soSessaoPropria`: só lê, "entrar como" passa; `soPainel` também vale), as 3 tabelas no `conferir` e `gc_estoque_item.deposito_id = bigint` em `tiposDoWorker`. Até lá a Fábrica não consegue gerar por candidatos: o front não troca `use-candidatos.js:7`.

### Variáveis de ambiente (serviço `api`)
| Variável | Observação |
|---|---|
| `GITHUB_PAT` | token do GitHub (fine-grained, SÓ o repositório `rbv-co/social-dashboard`, SÓ "Actions: Read and write", com validade anotada) para `POST /fabrica-trigger` (acordar o `fabrica.yml`) e para cancelar a execução no `fabrica-apagar`; o 5.10 e o Plano 6 usam o mesmo. **Criar um token NOVO.** Não copie o `GITHUB_PAT_FABRICA` dos segredos do Supabase: ele devolve 403 desde ~29/07 (achado 1); o `GITHUB_PAT_FOTOS` também não serve de origem. Vazio = `503 github_nao_configurado` sem gravar nada. É segredo (`Segredos()`). |

### Rotas novas
- Com sessão, regra = catálogo (leitura aberta; marcas por conta): `GET /fabrica/lojas`, `/objetivos`, `/marcas`, `/looks`, `/publicos`, `/campanhas`, `/criativos`, `/jobs`, `/meta-jobs`; `POST /fabrica/criativos/escolher`.
- Edges portadas (portão: papel admin, super pela ficha ou a chave `meta.fabrica` de `permissions`; "entrar como" NÃO escreve; **conta de serviço também não**: `soPainel` dá 403 a quem tem token `srv_`, para que o token do robô, mesmo com `meta.fabrica`, não dispare nem apague): `POST /fabrica-trigger` (30 por hora por pessoa), `/fabrica-apagar`, `/fabrica-looks`, `/fabrica-publicos`. As leituras e as de robô seguem as regras próprias.
- Robô (só sessão de serviço do 5.13 + perfil do robô; painel = 403): `PATCH /fabrica/robo/jobs/{id}`, `POST /fabrica/robo/jobs/{id}/proximo-lote`, `PATCH /fabrica/robo/campanhas/{id}`, `POST /fabrica/robo/criativos`, `PATCH /fabrica/robo/looks/{chave}`, `POST /fabrica/robo/meta-jobs`, `POST /fabrica/robo/execucoes`.
- `POST /bling-proxy`: `produtos` e `produtos/{id}` também para quem tem `meta.fabrica` em `permissions` (Ruling 5.8-17), para o robô da Fábrica não precisar do módulo `sales`; pedidos e os demais caminhos seguem exigindo `sales` ou `gestor`.

### Conta de serviço do robô da Fábrica (depois do 5.13)
- `usuarios` + `profiles` `robo-fabrica@rbvcompany.com`: papel `viewer`, `features {meta}` (`meta` para o `meta-proxy`; SEM `sales`: o `bling-proxy` libera `produtos` e `produtos/{id}` a quem tem `meta.fabrica` em `permissions`, Ruling 5.8-17), `permissions {"meta.fabrica": ["ver","editar"]}`, `allowed_accounts` nulo, `escopo_por_equipe false`, sem senha. O `api servico criar` cria o perfil com as `features`; a `permissions` entra por `update profiles set permissions = '{"meta.fabrica": ["ver","editar"]}' where email = 'robo-fabrica@rbvcompany.com'` (ou pela tela de acesso, antes de o robô trocar).
- Token: `api servico criar robo-fabrica robo-fabrica@rbvcompany.com --modulos meta` (imprime UMA vez) → segredo `API_TOKEN_FABRICA` no GitHub (Settings → Secrets) e no `fabrica.yml` no lugar de `SUPABASE_SERVICE_KEY`/`GESTOR_USER_*` (Plano 7). Revogar: `api servico revogar robo-fabrica`.

### Despacho ao GitHub: o que esperar
- O `fabrica-trigger` grava o job (e a rodada, no `gerar`) numa transação e SÓ DEPOIS acorda o robô. O despacho ignora o cancelamento da requisição (`context.WithoutCancel`; o cliente do GitHub tem prazo próprio de 15 s): fechar a aba no meio não transforma um despacho bom em `Incerto`.
- Estado "Incerto, mas o GitHub aceitou" (a resposta se perdeu): job e rodada ficam `erro` ("confira em Actions") até o robô, que roda mesmo assim, regravar o status; disparar de novo é decisão da pessoa (um segundo despacho acorda o robô duas vezes).
- Janela entre o commit do job e o despacho, sem outbox: se o processo cair aí, o job fica `enfileirado` sem robô. Upgrade, se acontecer: varrer jobs `enfileirado` com mais de N minutos e redisparar.
- A Fábrica NÃO roda desde 29/07 (token de despacho vencido: achado 1, Ruling 5.8-18): o primeiro disparo real depois do corte é o teste de verdade.
- `tipo: "excluir"` continua recusado (`400 tipo_invalido`, Ruling 5.8-7; decisão do dono, achado 2).

### Antes do corte
- `api worker conferir` no banco restaurado: colunas e tipos do 5.8 (em especial `fabrica_lojas.deposito_id` texto; `gc_estoque_item.deposito_id` bigint entra com a Task 7). Tipos e nulabilidade só se confirmam aí: a fatia da Fábrica é reconstruída das migrations.
- `select chave from fabrica_looks where chave !~ '^[a-z0-9][a-z0-9_-]{0,79}$'` = vazio: o `fabrica-looks` e a rota de robô recusam chave fora desse formato, e uma chave antiga fora dele ficaria sem edição.
- Nenhum gatilho nas `fabrica_*`: `select tgname from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname like 'fabrica\_%'` = vazio.
- Arquivos: os criativos do bucket `fabrica-criativos` copiados para `<ARQUIVOS_DIR>/fabrica-criativos/<storage_path>` (Plano 6) ANTES de ligar o `fabrica-apagar` da API (antes disso ele apaga o banco e não acha arquivo: sobra no Storage antigo, que some com o Supabase).
- `HOSTS_DE_MIDIA` com o host público do Storage novo (Plano 6): o `meta-proxy` só aceita `imageFromUrl` desses hosts, e o `subir` da Fábrica manda a URL do criativo (INVENTARIO item 6). Sem isso a subida de anúncios falha.
- `GITHUB_PAT` preenchido e testado no ensaio: um `POST /fabrica-trigger {"tipo":"preview","params":{}}` acorda o `fabrica.yml` (o job aparece em Actions) — com o robô ainda falando com o Supabase, o preview roda contra o banco antigo; faça isso só depois do Plano 7 trocar o robô, ou cancele a execução.
- Confirmar a edge NO AR (`npx supabase functions download fabrica-trigger …`, CLAUDE.md): se ela já aceita `excluir`, o Ruling 5.8-7 muda para aceitar também (achado 2).

### Mudanças de contrato que o Plano 7 absorve
- Leituras por `GET /fabrica/<recurso>` com filtros nomeados (`ativo`, `chave`, `account_id`, `id`, `status` (lista por vírgula), `aberta`, `purgada`, `campanha_id`, `escolhido`, `arquetipo`, `purgado`, `tipo`, `com_campanha_meta`) e `ordem=created_at|fechada_em[.desc]`. A Home troca o laço de contagem (home:35) por `qtd_criativos` de `GET /fabrica/campanhas`, e a contagem total (home:42) por `GET /fabrica/criativos?limite=1&contar=1` (`X-Total-Count`). `jobs` não traz `criado_por`.
- `POST /fabrica/criativos/escolher {"ids":[…],"escolhido":bool}` substitui os dois `update` de `fabrica_criativos` (curar:33, :48).
- As 4 edges portadas: mesma URL sob `/api` e mesmos corpos; erros novos: `fabrica-trigger` → `503 github_nao_configurado`, `429 muitas_tentativas`, `504 dispatch_incerto`, `400 pedido_invalido` (params); `fabrica-apagar` → `400 campanhaId_invalido`; `fabrica-looks` → `sync` = `400 acao_invalida`; `fabrica-publicos` → `404` no `salvar` com `id` inexistente. `detail` do `dispatch_falhou` é uma frase da API, não o texto do GitHub. `fabrica-candidatos` fica para a Task 7 (5.5).
- Robô (`coletor/fabrica-job-runner.mjs` e módulos, tabela da Task 9): `loginServico` → token de serviço; cada `sbGet/sbPost/sbPatch` → a rota da tabela; `registrar-execucao.mjs` → `POST /fabrica/robo/execucoes` (só para os robôs da Fábrica; os outros robôs desse módulo são da VPS e usam `pg`); a pílula de garantia espera o `GET /fabrica/robo/material-do-sku` do 5.10.

- `POST /fabrica/robo/jobs/{id}/proximo-lote` é idempotente por (`campanhaId`, `continuacao`), não pelo job de origem: hoje basta, porque o painel sempre cria rodada nova no `gerar`; se um dia houver duas cadeias na mesma rodada, gravar `origem: <id>` nos `params` do job novo e buscar por ele.

### Achados para o dono
(ver a seção "Achados para o dono" do plano 5.8)
