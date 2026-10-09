PG_PORTA ?= 55432
teste:
	-docker rm -f pg-api-teste >/dev/null 2>&1
	docker run -d --rm --name pg-api-teste -e POSTGRES_PASSWORD=x -p $(PG_PORTA):5432 postgres:17 >/dev/null
	until docker exec pg-api-teste pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
	TEST_DATABASE_URL=postgres://postgres:x@localhost:$(PG_PORTA)/postgres?sslmode=disable go test ./... ; s=$$?; docker stop pg-api-teste >/dev/null; exit $$s
