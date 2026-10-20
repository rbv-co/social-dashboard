# Restaurar o `api-db` (passo a passo, medido em 20/10/2026)

O `api-db` é a única fonte da verdade da Central. Backup e prova: `LEIA-ME.md` → "Backup e restauração".
**Nunca recrie banco ou volume em produção sem ok do dono.** O ensaio abaixo roda em contêiner descartável (sem rede,
volume anônimo removido com `-v`), longe do projeto compose `api`.

## O que existe e onde

| Cópia | Onde | Idade máxima (RPO) | Cobre |
|---|---|---|---|
| Dump diário 03:40 | `/root/backups-api/api-db-AAAA-MM-DD-HHMM.dump` (+ `.sha256`, `.globals.sql`) | até 24 h (as escritas desde as 03:40 se perdem) | dados e esquema; papéis em `.globals.sql` |
| Cópia cifrada | `gdrive:backups-vps-op/AAAA-MM-DD/api-db-*.gpg` (7 dias) | idem | dump, papéis e segredos (`api-db.env`, `api.env`, `worker.env`, `*.senha`) |
| Senha do gpg | `/root/.backup-gpg-pass` (cópia fora da VPS com o dono) | — | sem ela a cópia do Drive é lixo |

Dumps feitos antes de 20/10 11:19 UTC **não têm** `.globals.sql` (o `pg_dump -Fc` de um banco não leva papéis). Para eles:
`pg_restore --no-owner --no-acl` e depois reaplicar os `papel-*.sql` (ver "Papéis" abaixo).

## A. Provar que o backup restaura (rotina, sem risco: 30 s)

```sh
sh /root/api-db/testar-restauracao.sh                      # o dump mais novo; domingo 05:30 roda sozinho e avisa se falhar
sh /root/api-db/provar-restauracao.sh /root/restore-prova 2 # paridade 100% contra o vivo (snapshot), 2 vezes; apague a pasta depois
```

`provar-restauracao.sh` tira, numa transação `REPEATABLE READ` somente leitura, a impressão digital do banco vivo
(`paridade-tabelas.sql`: linhas e md5 por tabela, sequences, objetos, GRANTs de tabelas e de funções) e o dump do MESMO
instante; restaura no contêiner descartável e compara. Esperado: `PARIDADE 100%`. Medido: 194 tabelas, **8–9 s** do
contêiner ao banco pronto (RTO do banco), paridade igual 2×.

## B. Restaurar de verdade (volume perdido ou banco corrompido) — só com ok do dono

Tempo medido do Drive ao banco restaurado: **16 s** (baixar 3 s, decifrar 1 s, restaurar 12 s). Some a isso o tempo humano.

1. Parar quem escreve: `cd /root/api && docker compose stop api worker`; avisar os robôs da VPS (`systemctl stop vessel-espelho conteudo-vigia cartoes-ean`).
2. Escolher o backup: o dump mais novo de `/root/backups-api/` ou, se a VPS foi perdida, baixar do Drive:
   ```sh
   rclone copy gdrive:backups-vps-op/AAAA-MM-DD/ /root/dr --include 'api-db-*'
   for f in /root/dr/*.gpg; do gpg --batch --pinentry-mode loopback --passphrase-file /root/.backup-gpg-pass -o "${f%.gpg}" -d "$f"; done
   tar -xzf /root/dr/api-db-segredos-AAAA-MM-DD.tar.gz -C /root/secrets   # senhas dos papéis, api.env, worker.env
   # terminado o restore: apagar /root/dr (dump, papéis e segredos em claro)
   ```
3. Subir um `api-db` limpo (se o volume sumiu): `docker compose -f /root/api-db/docker-compose.yml up -d` (rede `api_net`, `/root/secrets/api-db.env`); esperar `healthy`.
4. Papéis, ANTES do dump (o dump traz GRANT para `api_app`, `robo_*`...): `docker exec -i api-db psql -U api -d api -f - < api-db-...globals.sql`
   (rode SEM `ON_ERROR_STOP`: o `CREATE ROLE api` acusa "já existe", é esperado, e os `ALTER ROLE` seguem; leia a saída em busca de qualquer OUTRO erro).
5. Dados: `docker exec -i api-db pg_restore -U api -d api --exit-on-error < api-db-AAAA-MM-DD-HHMM.dump`.
   Banco que NÃO está vazio: restaurar antes num banco novo (`createdb -O api api_novo`) e trocar os nomes com a API parada; nunca `--clean` em produção.
6. Conferir: `docker exec -i api-db psql -U api -d api -At -f - < paridade-tabelas.sql` (compare com o `restaurado-*.txt` da última prova: mesmas 194 tabelas),
   `select count(*) from usuarios`, `select max(disparado_em) from robos_execucoes` (= até onde foi o backup).
7. Depois de QUALQUER restore, reaplicar `ops/vps/api-db/revogar-execute-public.sql` se o dump for anterior a ele (funções `SECURITY DEFINER` voltam com `EXECUTE` de PUBLIC) e conferir a linha `O grants_funcoes` da impressão digital.
8. Subir: `docker compose -f /root/api/docker-compose.yml up -d --no-deps api worker`; `curl -s localhost:8080/saude`; `systemctl start` dos robôs.
9. A janela de perda é tudo o que foi escrito depois das 03:40 do dia do dump: `robos_execucoes` reexecuta sozinho; pedidos, webhooks e mensagens dessa janela se reconstroem das fontes (Shopify, Bling, Chatwoot) — avise o dono do tamanho da janela.

## Papéis

Os `papel-*.sql` recriam cada papel (senha vem de `/root/secrets/<papel>.senha`, `\getenv`); servem para dumps sem `.globals.sql` ou
para trocar uma senha. Ordem: `papel-copia.sql` primeiro (revoga EXECUTE de PUBLIC), depois os demais. Prova: `papel-robos.teste.sh`.

## Números medidos (20/10/2026, VPS op, banco de 115 MB, dump de 9 MB)

| O que | Resultado |
|---|---|
| RTO do banco (contêiner → restaurado) | 8–9 s (2 rodadas); do Drive: 16 s |
| RPO | até 24 h (backup diário às 03:40); 53 de 194 tabelas já tinham mudado 4,5 h depois |
| Paridade restaurado × vivo | 100% (194 tabelas, sequences, objetos, GRANTs), 2× |
| Cópia fora da VPS | desde 20/10 11:19 UTC (antes só local) |
