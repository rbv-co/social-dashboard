# Postgres 17 da API (`api-db`)

Contêiner `api-db` (Postgres 17), rede `api_net`, **sem porta publicada**. Quem fala com ele: a
API e o worker (na rede `api_net`) e `docker exec` para administração.
Memória: teto de 1 GB, `shared_buffers=256MB`, `shm_size=256mb` (a VPS é compartilhada).

## Como o Mac chega ao banco

Não há porta publicada, então só por túnel SSH até o IP do contêiner na rede `api_net`:

```sh
IP=$(ssh op "docker inspect -f '{{(index .NetworkSettings.Networks \"api_net\").IPAddress}}' api-db")
ssh -N -L 55470:"$IP":5432 op     # em outro terminal: psql -h 127.0.0.1 -p 55470 -U api api
```

O `psql` do Mac precisa ser **≥ 16.10 / 17.6** (os dumps trazem `\restrict`). Sem isso, use
`sh ops/migracao/pg17.sh psql ...`. A senha vem de `/root/secrets/api-db.env`; nunca no chat.

## Primeira subida (só com ok do dono)

Um comando por linha (colar com quebra de linha quebra o `&&`):

```sh
scp -r ops/vps/api-db op:/root/api-db
ssh op
mkdir -p /root/secrets && chmod 700 /root/secrets
definir-segredo /root/secrets/api-db.env     # digitação oculta: POSTGRES_USER=api, POSTGRES_PASSWORD, POSTGRES_DB=api
chmod 600 /root/secrets/api-db.env
docker compose -f /root/api-db/docker-compose.yml up -d
sh /root/api-db/backup-api-db.sh
sh /root/api-db/testar-restauracao.sh
```

Só depois da restauração passar, agendar o backup (`crontab -e` como root):

```
40 3 * * * /root/api-db/backup-api-db.sh >> /var/log/backup-api-db.log 2>&1
```

## Backup e restauração

- `backup-api-db.sh`: `pg_dump -Fc` para `/root/backups-api/api-db-AAAA-MM-DD-HHMM.dump` + `.sha256`
  (modo 600), retenção de 14 dias. Confere o dump com `pg_restore -l` e recusa arquivo ilegível
  ou menor que 1 KB (apaga o parcial).
- `testar-restauracao.sh [arquivo]`: confere o `.sha256`, restaura o mais recente num contêiner
  temporário `api-db-teste` e compara as tabelas com o índice do dump. Nunca toca o banco de verdade.
- Para ensaiar fora da VPS, os caminhos/contêineres são sobrescrevíveis por `BACKUP_DIR`,
  `BACKUP_RETENCAO_DIAS`, `API_DB_CONTAINER` e `TESTE_CONTAINER`.

## Regra do projeto

**Nunca recriar o contêiner com operação em andamento** (migração, restauração, backup rodando).
Para aplicar mudança no compose: `docker compose -f /root/api-db/docker-compose.yml up -d --no-deps api-db`.
