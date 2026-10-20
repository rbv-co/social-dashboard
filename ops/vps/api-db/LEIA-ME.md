# Postgres 17 da API (`api-db`)

Contêiner `api-db` (Postgres 17, imagem `postgres:17-trixie`), rede `api_net`, **sem porta
publicada**. Quem fala com ele: a API e o worker (na rede `api_net`) e `docker exec` para
administração. Memória: teto de 1 GB, `shared_buffers=256MB`, `shm_size=256mb` (a VPS é compartilhada).

## Como o Mac chega ao banco

Não há porta publicada, então só por túnel SSH até o IP do contêiner na rede `api_net`:

```sh
IP=$(ssh op "docker inspect -f '{{(index .NetworkSettings.Networks \"api_net\").IPAddress}}' api-db")
ssh -N -L 55470:"$IP":5432 op     # em outro terminal: psql -h 127.0.0.1 -p 55470 -U api api
```

A senha vem de `/root/secrets/api-db.env`; nunca no chat.
Ao carregar dumps SQL em texto puro no `psql` (linhas `\restrict`), o `psql` do Mac precisa ser
**≥ 16.10 / 17.6**; senão use `sh ops/migracao/pg17.sh psql ...`.

## Primeira subida (só com ok do dono)

Um comando por linha (colar com quebra de linha quebra o `&&`). O `scp -r` é só da primeira vez;
nas próximas implantações copie os arquivos alterados um a um.

```sh
scp -r ops/vps/api-db op:/root/api-db
ssh op
mkdir -p /root/secrets && chmod 700 /root/secrets
[ -e /root/secrets/api-db.env ] || ( umask 077; printf 'POSTGRES_USER=api\nPOSTGRES_PASSWORD=%s\nPOSTGRES_DB=api\n' "$(openssl rand -hex 24)" > /root/secrets/api-db.env )
docker compose -f /root/api-db/docker-compose.yml up -d
docker inspect -f '{{.State.Health.Status}}' api-db
```

O teste do segredo (`[ -e ... ]`) importa: `POSTGRES_PASSWORD` só vale na primeira inicialização
do volume; regerar o arquivo depois desalinharia senha e banco. Esperar o health virar `healthy`.

## Depois que o esquema e os dados estiverem carregados (só com ok do dono)

Backup, teste de restauração e cron só entram **depois** da carga: o backup recusa banco vazio
(< 1 KB) e o teste de restauração exige tabelas e `public.usuarios` com linhas.

```sh
sh /root/api-db/backup-api-db.sh
sh /root/api-db/testar-restauracao.sh
```

Só com a restauração passando, agendar (`crontab -e` como root; as linhas completas estão em "Backup e restauração"):

```
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
40 3 * * * flock -n /run/backup-api-db.lock sh /root/api-db/rotina-backup.sh >> /var/log/backup-api-db.log 2>&1
```

## Backup e restauração

Passo a passo de restaurar (volume perdido, dado apagado, VPS perdida) e os números medidos: **`RESTAURAR.md`**.

- `rotina-backup.sh` (cron 03:40, é o que o cron chama): `backup-api-db.sh` + `backup-api-db-offsite.sh`, e **avisa**
  (monitor do host: e-mail; o WhatsApp está fora desde 13/09) se qualquer etapa falhar. `rotina-backup.sh --conferir`
  (cron 04:15) avisa se não existe dump de hoje (cron parado, flock preso, disco cheio).
- `backup-api-db.sh`: `pg_dump -Fc` para `/root/backups-api/api-db-AAAA-MM-DD-HHMM.dump` + `.sha256` + `.globals.sql`
  (os papéis do cluster com o hash das senhas, `pg_dumpall --globals-only`: o dump de um banco NÃO leva papéis e sem eles
  o `pg_restore` falha nos GRANTs). Modo 600, retenção de 14 dias. Lê o dump inteiro com `pg_restore -f /dev/null` (pega
  truncamento) e recusa arquivo ilegível, menor que 1 KB, sem `TABLE public` ou sem `CREATE ROLE` (apaga o parcial).
- `backup-api-db-offsite.sh`: cifra (gpg AES256, mesma senha do `backup-offsite`) o dump, os papéis e os segredos
  (`api-db.env`, `api.env`, `worker.env`, `*.senha`) e sobe para `gdrive:backups-vps-op/AAAA-MM-DD/`; confere com
  `rclone check`; recusa dump de mais de 24 h. A retenção de 7 dias é a do `/usr/local/bin/backup-offsite`.
- `testar-restauracao.sh [arquivo]`: confere o `.sha256`, restaura o mais recente num contêiner
  temporário `api-db-teste` (sem rede, 1 GB, volume removido ao fim), aplicando antes o `.globals.sql`, e compara a lista de
  tabelas (`pg_class` r/p do `public`) com a do índice do dump e a contagem de `public.usuarios`. Nunca toca o banco de verdade.
- `provar-restauracao.sh [pasta] [N]` + `paridade-tabelas.sql`: tira, numa transação `REPEATABLE READ` somente leitura,
  a impressão digital do banco vivo (linhas + md5 por tabela, sequences, objetos, GRANTs) e o dump do MESMO instante;
  restaura N vezes e exige paridade de 100%. Mede o tempo.
- `rotina-backup.teste.sh`: prova a rotina (roda NA VPS, só lê o banco: `ssh op sh /root/api-db/rotina-backup.teste.sh`).
- Para ensaiar fora da VPS: `BACKUP_DIR`, `BACKUP_RETENCAO_DIAS`, `API_DB_CONTAINER`, e
  `TESTE_CONTAINER` (o nome deve terminar em `-teste`).

Cron (root; `crontab -l`):

```
40 3 * * * flock -n /run/backup-api-db.lock sh /root/api-db/rotina-backup.sh >> /var/log/backup-api-db.log 2>&1
15 4 * * * sh /root/api-db/rotina-backup.sh --conferir >> /var/log/backup-api-db.log 2>&1
30 5 * * 0 sh /root/api-db/testar-restauracao.sh >> /var/log/backup-api-db.log 2>&1 || python3 /root/monitor/verificar.py --avisar "[TESTE DE RESTAURAÇÃO FALHOU] api-db" "testar-restauracao.sh falhou: ver /var/log/backup-api-db.log"
```

## Cópia de segurança para o Zoho: papel `copia` (no corte, só com ok do dono)

Até o corte, a cópia diária para o Zoho WorkDrive (`coletor/vps/robos.cron` → `coletor/vps/copia-do-banco.sh` →
`coletor/guardar-copia-do-banco.mjs`, 06h12 UTC) lê o Supabase. No corte ela passa a ler ESTE banco com o papel
`copia`: SELECT em todas as tabelas do `public` (`sessoes` é negada pelo banco e pulada pelo robô) e INSERT só em
`robos_execucoes` (a linha da rodada, que o painel cobra como crítica). Nenhuma função do `public` é executável
por ele (o `papel-copia.sql` revoga o EXECUTE de PUBLIC: o dump do Supabase vem sem GRANT/REVOKE e muitas funções
são `SECURITY DEFINER` do superusuário, que ESCREVEM). Continua sem porta publicada: o `copia-do-banco.sh` lê o IP
do `api-db` na `api_net` a cada rodada e monta `COPIA_DATABASE_URL` (sem a senha, que vai no `PGPASSWORD`).

Duas variáveis em `/etc/robos.env`, e só NO CORTE: `COPIA_DB_SENHA` (a senha do papel) e `SAIU_DO_SUPABASE=sim`
(qualquer valor não vazio). Com a segunda ligada, faltar a primeira é ERRO (`exit 1`), nunca volta calada para o
Supabase velho. Para voltar ao Supabase de propósito: apagar AS DUAS linhas.

**O que a cópia deixa de levar:** as views (`carrinho_abandonados`, `robos_saude`...) não são tabelas e saem da
cópia (vêm do esquema, não são dado). Tabelas novas da API (`sessoes`, `goose_db_version`, `webhooks_recebidos`,
`envios_feitos`) ficam fora de propósito, `usuarios.senha_hash` sai sem o valor, e restaurar exige `api migrar`.
A lista de tabelas vem de `pg_tables`: uma tabela que o papel não consegue ler FALHA a cópia (e deixa a linha
`ok = false` no painel); nunca some calada.

Um comando por linha. A senha nunca vai para a linha de comando (o `ps` do host mostra argumentos): entra pelo
ambiente, e o `papel-copia.sql` a lê com `\getenv`.

```sh
scp ops/vps/api-db/papel-copia.sql op:/root/api-db/papel-copia.sql
ssh op
[ -e /root/secrets/copia.senha ] || ( umask 077; openssl rand -hex 24 > /root/secrets/copia.senha )
SENHA_COPIA="$(cat /root/secrets/copia.senha)" docker exec -i -e SENHA_COPIA api-db psql -U api -d api < /root/api-db/papel-copia.sql
COPIA_DB_SENHA="$(cat /root/secrets/copia.senha)" /opt/robos/social-dashboard/coletor/vps/rodar-robo.sh copia-do-banco 60 -- bash coletor/vps/copia-do-banco.sh --ensaio
tail -30 /var/log/robos/copia-do-banco.log
```

O ensaio lista as tabelas e as contagens sem enviar nada. A senha vai INLINE no ensaio: não grave `COPIA_DB_SENHA` no
`/etc/robos.env` antes do corte (com ela gravada, a rodada das 06h12 já leria o banco novo). A senha é hex de
propósito (sem caractere que precise de escape). Reaplicar o `papel-copia.sql` é seguro (troca a senha e refaz os
GRANTs/REVOKEs; tabela e função novas criadas pelo `api` seguem a mesma regra, por `ALTER DEFAULT PRIVILEGES`).

### No corte (só com ok do dono)

```sh
grep -q '^COPIA_DB_SENHA=' /etc/robos.env || echo "COPIA_DB_SENHA=$(cat /root/secrets/copia.senha)" >> /etc/robos.env
grep -q '^SAIU_DO_SUPABASE=' /etc/robos.env || echo "SAIU_DO_SUPABASE=sim" >> /etc/robos.env
```

E no GitHub (na máquina do dono, sem trocar de conta): `gh variable set SAIU_DO_SUPABASE --body sim` e remover (ou
renomear) o segredo `SUPABASE_SERVICE_KEY` do repositório (`gh secret delete SUPABASE_SERVICE_KEY`). A variável faz o
workflow `.github/workflows/copia-do-banco.yml` recusar com QUALQUER valor não vazio (copiaria o Supabase velho por
cima da cópia boa do dia). O segredo removido mata também os disparos manuais de branches antigas, que levam a
versão velha do workflow, sem a trava. Conferir que não sobrou chave do Supabase na VPS:
`grep -c '^SUPABASE_' /etc/robos.env` deve dar 0 depois do corte (ou só as que o dono decidir manter).

### Verificar na VPS (antes do corte e depois do primeiro dia)

Cada item com o resultado esperado. Um comando por linha; consultas rodam como `api`:

1. **RLS desligada no `api-db`**: `docker exec api-db psql -U api -d api -Atc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity"` → `0`.
   (CORRIGIDO: `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`, item "Banco: o restore NÃO traz RLS", já diz isto. O certo é `0`: `ops/migracao/limpar-dump.mjs` remove `enable row level security` do dump e
   `ops/migracao/ensaio.sh:162` exige `0` tabelas com RLS e `0` policies. Se der diferente de `0`, pare: o dump
   não passou pelo `limpar-dump.mjs`.)
2. **Donos e privilégios**: `docker exec api-db psql -U api -d api -c "select tablename, tableowner, has_table_privilege('copia', format('public.%I', tablename), 'select') as copia_le from pg_tables where schemaname='public' order by 1"`
   → todas com dono `api` e `copia_le = t`, exceto `sessoes` (`f`).
3. **Nomes de tabela no padrão** (`^[a-z_][a-z0-9_]*$`, o que o robô aceita): `docker exec api-db psql -U api -d api -Atc "select tablename from pg_tables where schemaname='public' and tablename !~ '^[a-z_][a-z0-9_]*$'"` → nenhuma linha.
4. **Nenhuma função `SECURITY DEFINER` executável pelo `copia`**: `docker exec api-db psql -U api -d api -Atc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('copia', p.oid, 'execute')"` → `0`.
5. **Fuso do servidor**: `docker exec api-db psql -U api -d api -Atc "show timezone"` → `Etc/UTC` (as datas da cópia saem no fuso do servidor, como saíam do PostgREST).
6. **Tempo e memória no banco real (197 MB)**: `COPIA_DB_SENHA="$(cat /root/secrets/copia.senha)" /usr/bin/time -v /opt/robos/social-dashboard/coletor/vps/rodar-robo.sh copia-do-banco 60 -- bash coletor/vps/copia-do-banco.sh --ensaio --semanal 2>&1 | tail -30`
   → "Elapsed" bem abaixo do limite de 60 min do `rodar-robo.sh` e "Maximum resident set size" compatível com a VPS
   compartilhada (a cópia monta todos os arquivos na memória antes de enviar).
7. **`docker` no PATH do cron**: `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin command -v docker` (é o PATH do
   `/etc/cron.d/robos-social-dashboard`) → imprime um caminho.
8. **`/etc/robos.env`**: `stat -c '%a %U' /etc/robos.env` → `600 root`; e `grep -c "$(cat /root/secrets/copia.senha)" /var/log/robos/copia-do-banco.log` → `0` (a senha nunca no log).
9. **Primeira rodada real depois do corte** (a das 06h12 UTC): (a) linha nova em `robos_execucoes` com `robo = 'guardar-copia-do-banco'`, `ok = t` e `conferido_em` preenchido; (b) a pasta do dia no Zoho tem `manifesto.json` e um `.jsonl` por tabela copiada; (c) a conferência da cópia termina sem divergência: no dia 1º ela roda sozinha depois da cópia (está no log); para adiantar, a partir de `/opt/robos/social-dashboard`: `IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "api_net").IPAddress}}' api-db); PATH=/opt/cartoes-ean/node/bin:$PATH COPIA_DATABASE_URL="postgres://copia@$IP:5432/api" PGPASSWORD="$(cat /root/secrets/copia.senha)" node coletor/restaurar-copia.mjs --conferir <dia>` (a senha entra pelo ambiente, não por argumento).
10. **Janela do contêiner**: não recriar o `api-db` (`docker compose up --force-recreate`, mudança de imagem) entre 06h12 e 07h UTC: o IP muda e a rodada em andamento perde a conexão (ela falha limpo e registra, mas o dia fica sem cópia).
11. **O `copia` não executa NENHUMA função do `public`** (o item 4 só olha as `SECURITY DEFINER`; esta olha TODAS): `docker exec api-db psql -U api -d api -Atc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('copia', p.oid, 'execute')"` → `0`.
    Função nova criada depois do `papel-copia.sql` nasce sem EXECUTE para o `copia` (`ALTER DEFAULT PRIVILEGES`); se der diferente de `0`, reaplique o `papel-copia.sql` e confira de novo.
12. **`robos_execucoes` não chama função do `public` por dentro**: o `copia` faz INSERT nela, e um gatilho ou um `DEFAULT` que chame função do `public` esbarraria no item 11 (ou, pior, alguém "consertaria" dando EXECUTE ao papel). Os dois comandos têm de dar `0`:
    `docker exec api-db psql -U api -d api -Atc "select count(*) from pg_trigger t where t.tgrelid='public.robos_execucoes'::regclass and not t.tgisinternal"` → `0`;
    `docker exec api-db psql -U api -d api -Atc "select count(*) from pg_attrdef d join pg_depend dep on dep.classid='pg_attrdef'::regclass and dep.objid=d.oid and dep.refclassid='pg_proc'::regclass join pg_proc p on p.oid=dep.refobjid join pg_namespace n on n.oid=p.pronamespace where d.adrelid='public.robos_execucoes'::regclass and n.nspname='public'"` → `0`.
13. **Ensaio da guarda no GitHub** (na máquina do dono, sem trocar de conta; só DEPOIS de ligar `SAIU_DO_SUPABASE`): `gh workflow run copia-do-banco.yml -f ensaio=sim` e `gh run watch` → a execução tem de FALHAR já na 1ª etapa ("Recusar depois do corte"), sem rodar o `guardar-copia-do-banco.mjs`. Se passar da 1ª etapa, a trava não está ligada: pare. Depois confirme que o segredo `SUPABASE_SERVICE_KEY` sumiu: `gh secret list | grep -c SUPABASE_SERVICE_KEY` → `0`.
14. **Ensaio da chave do corte na VPS**: com `SAIU_DO_SUPABASE=sim` e SEM `COPIA_DB_SENHA` a cópia tem de sair com código `1`, sem chamar o `node`, e o `rodar-robo.sh` tem de AVISAR. O `rodar-robo.sh` lê o arquivo de segredos como texto e ele vence o ambiente do comando; por isso o ensaio usa um arquivo temporário (via `ENV_ROBOS`), sem tocar no `/etc/robos.env`:
    `( umask 077; grep -v -e '^COPIA_DB_SENHA=' -e '^SAIU_DO_SUPABASE=' /etc/robos.env > /root/secrets/robos-ensaio.env; echo SAIU_DO_SUPABASE=sim >> /root/secrets/robos-ensaio.env )`
    `ENV_ROBOS=/root/secrets/robos-ensaio.env /opt/robos/social-dashboard/coletor/vps/rodar-robo.sh copia-do-banco 60 -- bash coletor/vps/copia-do-banco.sh --ensaio; echo "saída=$?"`
    → a mensagem "SAIU_DO_SUPABASE está ligada mas falta COPIA_DB_SENHA", `saída=1` e o aviso chegando no grupo/webhook ("Robô copia-do-banco falhou na VPS"); `tail -3 /var/log/robos/copia-do-banco.log` tem a linha `FALHOU`. Nenhuma linha nova em `robos_execucoes` é esperada (a recusa vem ANTES do `node`: o aviso é o do `rodar-robo.sh`). Depois: `rm /root/secrets/robos-ensaio.env`. A próxima rodada boa manda "voltou ao normal" (a marca `.falhou` do ensaio): é esperado. Para voltar ao Supabase de propósito apagam-se AS DUAS linhas do `/etc/robos.env`, nunca só uma.
15. **Todo papel novo que NÃO seja o `api` precisa de `GRANT EXECUTE` explícito** nas funções do `api` de que for depender (a regra do `papel-copia.sql` revoga EXECUTE de PUBLIC e o `ALTER DEFAULT PRIVILEGES` só vale para o papel que o declarou): sem o GRANT a chamada falha com `permission denied for function`, que é o comportamento desejado. Papel novo = rodar os itens 2, 4 e 11 para ele (trocando `copia` pelo nome dele) e conferir que só tem o que deve.

## PDV: papel `pdv_leitura` (no corte, só com ok do dono)

O PDV lê o número de série de `vessel_pecas`/`vessel_lotes` (`pdv-backend`, `pecas-origem.service.ts`). Mínimo privilégio: só as colunas da consulta, nenhuma função (`papel-pdv.sql`, prova em `papel-pdv.teste.sh`). Na virada:

0. **Antes**: `papel-copia.sql` já aplicado (ele tira o EXECUTE de PUBLIC; o `papel-pdv.sql` recusa se ainda houver).
1. `ssh op 'umask 077; openssl rand -hex 24 > /root/secrets/pdv.senha'`; aplicar: `SENHA_PDV="$(cat /root/secrets/pdv.senha)" docker exec -i -e SENHA_PDV api-db psql -U api -d api < /root/api-db/papel-pdv.sql`.
2. Contêiner do PDV na rede `api_net` (o `api-db` não publica porta; o compose a declara `external`: ela tem de existir, o plano 09 recria o `api-db` sem derrubá-la): branch `feat/rev06-origem-sem-tls` do `pdv-backend` (compose + `sslmode=disable`), deploy pelo `deploy-com-reversao.sh`.
(Os passos 2 e 3 estão no `ops/virada/janela/t17-pdv.sh`: `ensaio` contra o `api_corte` sem tocar o PDV, `aplicar` com backup do `.env`, prova do papel antes, conferência dentro do contêiner e reversão sozinha; `reverter` devolve o `.env`.)
3. `/root/pdv-backend/.env`: `SUPABASE_DATABASE_URL="postgres://pdv_leitura:<senha>@api-db:5432/api?sslmode=disable"`. Conferir no log do PDV que NÃO aparece "Sem SUPABASE_DATABASE_URL" e que a busca por número de série acha uma peça (`ABXCKN5PZA`).

## Robôs da VPS: um papel por robô (plano 02 da virada, só com ok do dono)

Hoje os robôs `pg` entram no Supabase como `postgres` (dono: o congelar não os barra) e os só-REST usam a chave de serviço.
No `api-db` cada robô tem papel PRÓPRIO, com GRANT só nas tabelas/colunas que o código dele toca (`papel-robo-*.sql`,
prova em `papel-robos.teste.sh`). Sem RLS aqui, o GRANT é a única tranca. Coluna sensível fica fora (`accounts.access_token`,
`bling_tokens.client_secret`, `vessel_lista_espera.senha_hash`...): quem precisar pede GRANT novo, o robô falha alto com
`permission denied`. `papel-copia.sql` vem ANTES (tira o EXECUTE de PUBLIC; os `papel-robo-*.sql` recusam sem isso).

| Robô (nome no `rodar-robo.sh`) | Papel | Variável de URL em `/etc/robos.env` | Senha (`/root/secrets/…`, env do psql) |
|---|---|---|---|
| (todos: grava a rodada) | `robo_reporte` | `REPORTAR_DATABASE_URL` | `robo-reporte.senha` (`SENHA_ROBO_REPORTE`) |
| fotos-do-selo | `robo_selo` | `ROBO_FOTOS_DO_SELO_DATABASE_URL` | `robo-selo.senha` |
| pedidos-da-vessel | `robo_pedidos_vessel` | `ROBO_PEDIDOS_DA_VESSEL_DATABASE_URL` | `robo-pedidos-vessel.senha` |
| pedidos-da-shopify | `robo_shopify` | `ROBO_PEDIDOS_DA_SHOPIFY_DATABASE_URL` | `robo-shopify.senha` |
| meta-ads-no-zoho | `robo_metaads_zoho` | `ROBO_META_ADS_NO_ZOHO_DATABASE_URL` | `robo-metaads-zoho.senha` |
| vigia-problemas-meta | `robo_vigia_meta` | `VIGIA_DATABASE_URL` (só este robô a recebe) | `robo-vigia-meta.senha` |
| notas-dos-pedidos | `robo_notas` | `ROBO_NOTAS_DOS_PEDIDOS_DATABASE_URL` | `robo-notas.senha` |
| relatorios-comerciais | `robo_relatorios` | `ROBO_RELATORIOS_COMERCIAIS_DATABASE_URL` | `robo-relatorios.senha` |
| cards-comercial-diario | `robo_cards` | `ROBO_CARDS_COMERCIAL_DIARIO_DATABASE_URL` | `robo-cards.senha` |
| gestor-comercial | `robo_gestor` | `ROBO_GESTOR_COMERCIAL_DATABASE_URL` | `robo-gestor.senha` |
| sugerir-interesses | `robo_interesses` | `ROBO_SUGERIR_INTERESSES_DATABASE_URL` | `robo-interesses.senha` |
| opr-diario | `robo_opr` | `ROBO_OPR_DIARIO_DATABASE_URL` | `robo-opr.senha` |
| budget-ia | `robo_budget` | `ROBO_BUDGET_IA_DATABASE_URL` | `robo-budget.senha` |
| coletor-noticias | `robo_noticias` | `ROBO_COLETOR_NOTICIAS_DATABASE_URL` | `robo-noticias.senha` |
| faxina-storage | `robo_faxina` | `ROBO_FAXINA_STORAGE_DATABASE_URL` | `robo-faxina.senha` |
| copia-do-banco | `copia` | `COPIA_DB_SENHA` (seção acima) | `copia.senha` |
| conteudo-vigia | `conteudo_robo` | `CONTEUDO_DB_SENHA` (`papel-conteudo.sql`) | `conteudo.senha` |
| cartoes-ean (serviço `systemd`, não passa pelo `rodar-robo.sh`) | `robo_cartoes` | `CARTOES_DB_SENHA` no `/etc/cartoes-ean.env` (o vigia monta a URL) | `robo-cartoes.senha` |

**Contrato (o que o `rodar-robo.sh` faz):**

- URL de cada robô: `postgres://<papel>:<senha>@api-db:5432/api?sslmode=disable`. O `api-db` não publica porta e o cron roda no
  host: o `rodar-robo.sh` troca `@api-db:` pelo IP atual do contêiner na `api_net` a cada rodada (sem IP: a URL fica e o robô falha
  alto na conexão).
- `ROBO_<NOME>_DATABASE_URL` (nome do robô em maiúsculas, `-` vira `_`) vira o `DATABASE_URL` SÓ daquele robô. As `ROBO_*_DATABASE_URL`
  dos outros somem do ambiente dele. Sem a variável, nada muda (cron atual intacto).
- `REPORTAR_DATABASE_URL`: a rodada vai para `robos_execucoes` por `pg` (`coletor/vps/reportar-rodada.mjs`); banco fora só deixa
  uma linha no log, nunca derruba nem muda o código de saída do robô. Não chega ao comando do robô. Sem ela, o `reportar` segue por
  REST no Supabase.
- Robô do Meta exige `CORE_META=true` no env (nenhum papel lê `accounts.access_token`: o token vem do Core).
- As flags (`SAIU_DO_SUPABASE`, as URLs, `REPORTAR_DATABASE_URL`) e as senhas vivem SÓ em `/etc/robos.env` (o rollback A4/B5
  restaura esse arquivo). Senha nunca em linha de comando, em log, em chat.
- **Fase 2 (sem papel de Storage):** `opr-diario`, `faxina-fabrica`/`faxina-storage`, `vigia-armazenamento` e `ig-coletor`/`passo-faxina`
  usam `/storage/v1/...` do Supabase, que a API Go não expõe (há `PUT/GET/DELETE /arquivos/{bucket}/*`, disco `/var/lib/api/arquivos`).
  Até a fase 2 esses passos seguem no Supabase; o papel dá só a leitura.
- **Chave de Storage (`STORAGE_SUPABASE_SERVICE_KEY`):** o `robos-troca-env.sh aplicar` renomeia a `SUPABASE_SERVICE_KEY` do `/etc/robos.env`
  para `STORAGE_SUPABASE_SERVICE_KEY` (guardada para a fase 2; o `rodar-robo.sh` não a entrega a robô nenhum).
  **`opr-diario` e `faxina-storage` ficam RECUSADOS (exit 78 + aviso) com `SAIU_DO_SUPABASE`:** leem tabelas por REST do Supabase velho
  (a faxina apagaria do bucket arquivo de campanha criada depois do corte). Dependência do plano 03: portar essas leituras para o `pg`
  e dar Storage à API; depois se remove a linha `fase2` do `rodar-robo.sh`. Até lá, o relatório OPR diário e a faxina de arquivos
  ficam parados (aviso no WhatsApp a cada 6 h).
- **Sem papel e sem `DATABASE_URL` global:** `copia-do-banco` (usa o papel `copia` por `COPIA_DB_SENHA`) e `publicar-o-site` (não toca em banco).
  Com a flag, o `rodar-robo.sh` descarta o `DATABASE_URL` global deles, e eles não são recusados pela trava.
- **`VIGIA_DATABASE_URL`** só chega ao `vigia-problemas-meta`; o `rodar-robo.sh` a remove do ambiente de todos os outros robôs.

**Aplicar (um comando por linha; roda de novo sem estrago):**

```sh
scp ops/vps/api-db/papel-robo-*.sql op:/root/api-db/
ssh op
for r in reporte selo pedidos-vessel shopify metaads-zoho vigia-meta notas relatorios cards gestor interesses opr budget noticias faxina cartoes; do
  [ -e /root/secrets/robo-$r.senha ] || ( umask 077; openssl rand -hex 24 > /root/secrets/robo-$r.senha )
  V=SENHA_ROBO_$(echo $r | tr 'a-z-' 'A-Z_')
  # export é builtin: a senha não aparece no argv (ps) de nenhum processo; `-e VAR` sem valor repassa do ambiente
  ( export "$V=$(cat /root/secrets/robo-$r.senha)"; docker exec -i -e "$V" api-db psql -U api -d api < /root/api-db/papel-robo-$r.sql ) || break
done
```

**Cartões EAN (serviço, não cron).** Roda como root em `/opt/cartoes-ean` e lê só `/etc/cartoes-ean.env`. Depois do passo acima:
```sh
( umask 077; echo "CARTOES_DB_SENHA=$(cat /root/secrets/robo-cartoes.senha)" >> /etc/cartoes-ean.env )
cd /opt/cartoes-ean/social-dashboard && git pull --ff-only   # o vigia só puxa quando há fila: o 1º deploy do vigia novo é manual
systemctl restart cartoes-ean && journalctl -u cartoes-ean -n 20 --no-pager
```
Com `CARTOES_DB_SENHA` o vigia exporta `PGPASSWORD`, monta `CARTOES_DATABASE_URL` com o IP do `api-db` e **descarta** `SUPABASE_*`.
**Rollback:** apagar a linha `CARTOES_DB_SENHA` do `/etc/cartoes-ean.env` e `systemctl restart cartoes-ean` (volta ao REST do Supabase, que precisa das `SUPABASE_*` no mesmo arquivo).
Pedido em andamento no restart volta à fila por `vessel_cartao_recolocar_travados`.

Os papéis morrem num `docker compose down -v` (volume novo): refazer depois do restore, no mesmo passo do `papel-copia.sql`.
Quem grava `ROBO_*_DATABASE_URL` no `/etc/robos.env` é o `ops/virada/robos-troca-env.sh` (backup e reversão; só no corte).

## Regras do projeto

- **Nunca recriar o contêiner com operação em andamento** (migração, restauração, backup rodando).
  Para aplicar mudança no compose: `docker compose -f /root/api-db/docker-compose.yml up -d --no-deps api-db`.
- **Nunca `docker compose down -v`**: apaga o volume com os dados.
- A futura composição da API deve declarar `api_net` como `external: true`, e o `api-db` precisa
  estar de pé antes (é ele quem cria a rede).
- Atualização de versão menor (17.x): `docker compose -f /root/api-db/docker-compose.yml pull && docker compose -f /root/api-db/docker-compose.yml up -d --no-deps api-db`,
  em janela sem operação em andamento.

## Resiliência e carga (provas do plano 07, 20/10/2026)

- `queda-worker.sh <crash|gracioso> <epoch> <saida>`: espera o instante (o minuto 5 da hora, quando a `meta-hora` está rodando, 24 s),
  derruba o `api-worker-1` no meio dela (`docker kill`, ou `compose up -d --no-deps --force-recreate worker`) e mede a retomada:
  trava de advisory solta, fila (`checkout_abandono`) sem linha em `enviando`, nenhuma execução duplicada no mesmo minuto,
  intervalo entre os ticks de 1 min, 5xx da API. Uma linha `enviando` presa vira `falhou/travada_sem_confirmacao` em 10 min
  (`liberar_mensagens_travadas`): nunca reenvia (no pior caso uma mensagem se perde, nunca duplica).
- `monitora-carga.sh <segundos>`: amostra a cada 5 s load, CPU/RAM de `api-api-1` e `api-db`, conexões do Postgres e steal.
