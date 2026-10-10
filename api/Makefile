PG_PORTA ?= 55432
PG_IMAGEM ?= postgres:17
teste:
	-docker rm -fv pg-api-teste >/dev/null 2>&1
	docker run -d --rm --name pg-api-teste -e POSTGRES_PASSWORD=x -p 127.0.0.1:$(PG_PORTA):5432 $(PG_IMAGEM) >/dev/null
	pronto=; for i in $$(seq 60); do docker exec pg-api-teste pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && pronto=1 && break; sleep 1; done; \
	if [ -z "$$pronto" ]; then echo "postgres não ficou pronto em 60s" >&2; docker stop pg-api-teste >/dev/null 2>&1; exit 1; fi
	TEST_DATABASE_URL=postgres://postgres:x@localhost:$(PG_PORTA)/postgres?sslmode=disable go test ./... ; s=$$?; docker stop pg-api-teste >/dev/null; exit $$s
