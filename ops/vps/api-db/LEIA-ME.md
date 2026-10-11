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

Só com a restauração passando, agendar (`crontab -e` como root):

```
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
40 3 * * * flock -n /run/backup-api-db.lock sh /root/api-db/backup-api-db.sh >> /var/log/backup-api-db.log 2>&1
```

## Backup e restauração

- `backup-api-db.sh`: `pg_dump -Fc` para `/root/backups-api/api-db-AAAA-MM-DD-HHMM.dump` + `.sha256`
  (modo 600), retenção de 14 dias. Lê o dump inteiro com `pg_restore -f /dev/null` (pega truncamento)
  e recusa arquivo ilegível, menor que 1 KB ou cujo índice não liste nenhuma `TABLE public` (apaga o parcial).
- `testar-restauracao.sh [arquivo]`: confere o `.sha256`, restaura o mais recente num contêiner
  temporário `api-db-teste` (sem rede, 1 GB, volume removido ao fim) e compara a lista de tabelas (`pg_class` r/p do `public`) com a do
  índice do dump e a contagem de `public.usuarios`. Nunca toca o banco de verdade.
- Para ensaiar fora da VPS: `BACKUP_DIR`, `BACKUP_RETENCAO_DIAS`, `API_DB_CONTAINER`, e
  `TESTE_CONTAINER` (o nome deve terminar em `-teste`).

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
   (`docs/migracao-go/NOTAS-DA-IMPLANTACAO.md:157` diz que as tabelas restauradas mantêm RLS ligada: está
   DESATUALIZADO. O certo é `0`: `ops/migracao/limpar-dump.mjs` remove `enable row level security` do dump e
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

## Regras do projeto

- **Nunca recriar o contêiner com operação em andamento** (migração, restauração, backup rodando).
  Para aplicar mudança no compose: `docker compose -f /root/api-db/docker-compose.yml up -d --no-deps api-db`.
- **Nunca `docker compose down -v`**: apaga o volume com os dados.
- A futura composição da API deve declarar `api_net` como `external: true`, e o `api-db` precisa
  estar de pé antes (é ele quem cria a rede).
- Atualização de versão menor (17.x): `docker compose -f /root/api-db/docker-compose.yml pull && docker compose -f /root/api-db/docker-compose.yml up -d --no-deps api-db`,
  em janela sem operação em andamento.
