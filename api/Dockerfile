# API em Go da Central: um binário, vários subcomandos (`api`, `worker`, `migrar`, `servico`, ...).
# Quem usa: ops/vps/api/docker-compose.yml (serviços `api` e `worker`). Compila na plataforma de quem faz o build
# (sem emulação): no Mac, `docker buildx build --platform linux/amd64` gera a imagem da VPS sem gastar a CPU dela.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags='-s -w' -o /api ./cmd/api

FROM alpine:3.22
# ca-certificates: Meta, Zoho, ZeptoMail, Web Push e core por https; tzdata: o dia de São Paulo dos avisos.
# Usuário fixo 10001: o volume de arquivos no host (ARQUIVOS_DIR) é dele (install -o 10001).
RUN apk add --no-cache ca-certificates tzdata \
 && adduser -D -H -u 10001 api \
 && install -d -o 10001 -g 10001 -m 750 /var/lib/api/arquivos
COPY --from=build /api /usr/local/bin/api
USER 10001
ENTRYPOINT ["api"]
CMD ["api"]
