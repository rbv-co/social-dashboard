package web

// Plano 01 do esforço REVISAO-TESTES-2026-10 (item A): a matriz ROTA × PERFIL, gerada de chi.Walk sobre
// as rotas reais de Rotas(). Complementa TestNenhumaRotaNovaFicaAberta (que só olha sem sessão, cliente e
// sem módulo) com o "entrar como", o controle positivo (superadmin/serviço passam) e a regra por classe.
//
// O ESPERADO vem da regra de cada classe abaixo (decidida pelo plano e pelo catálogo), NUNCA do que a API
// responde hoje: congelar o comportamento atual congelaria o defeito. Cada rota tem uma linha explícita em
// `matriz`; rota nova sem linha (ou linha de rota que não existe mais) reprova o teste.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// gate: quem barra a rota. rw: ela só lê (rwL) ou grava/dispara efeito (rwE).
type gate int
type rw int

const (
	gPublica gate = iota // sem sessão: a rota se defende sozinha (assinatura, segredo, limite por IP)
	gSessao              // qualquer sessão de painel/serviço; a regra fina está no handler (400 com frase, bucket, nome de RPC)
	gModulo              // ExigirModulo/ExigirPermissao no roteador, ou o portão da edge no handler: sem módulo = 403
	gDominio             // grupo de domínio: a regra de Ler/Criar/Editar/Apagar do catálogo (autz) decide
	gRobo                // só conta de serviço (auth.SoServico): sessão de painel = 403
)

const (
	rwL rw = iota
	rwE
)

type linha struct {
	g gate
	e rw
}

var matriz = map[string]linha{
	// MCP da Central: o OAuth e o /mcp (token 'mcp' no handler) são públicos; a tela de consentimento é de qualquer conta
	// do painel (SoPainel): o que o ChatGPT alcança depois é o que a permissão dela alcança, rota a rota.
	"GET /.well-known/oauth-protected-resource":                      {gPublica, rwL},
	"GET /.well-known/oauth-protected-resource/mcp":                  {gPublica, rwL},
	"GET /.well-known/oauth-authorization-server":                    {gPublica, rwL},
	"POST /oauth/registrar":                                          {gPublica, rwE},
	"GET /oauth/autorizar":                                           {gPublica, rwL},
	"POST /oauth/token":                                              {gPublica, rwE},
	"POST /mcp":                                                      {gPublica, rwE},
	"GET /oauth/pedido":                                              {gSessao, rwL},
	"POST /oauth/decidir":                                            {gSessao, rwE},
	"DELETE /acessos/organizacoes/{id}":                              {gDominio, rwE},
	"DELETE /acessos/pessoas/{id}":                                   {gDominio, rwE},
	"GET /acessos/drive/marcas":                                      {gDominio, rwL},
	"POST /acessos/drive/marcas":                                     {gDominio, rwE},
	"DELETE /acessos/drive/marcas/{id}":                              {gDominio, rwE},
	"GET /acessos/drive/setores":                                     {gDominio, rwL},
	"POST /acessos/drive/setores":                                    {gDominio, rwE},
	"DELETE /acessos/drive/setores/{id}":                             {gDominio, rwE},
	"DELETE /acessos/drive/setores/{chave}/overrides":                {gDominio, rwE},
	"GET /acessos/drive/overrides":                                   {gDominio, rwL},
	"PUT /acessos/drive/overrides/{external_id}":                     {gDominio, rwE},
	"DELETE /acessos/setores/{id}":                                   {gDominio, rwE},
	"DELETE /acessos/termos/{id}":                                    {gDominio, rwE},
	"DELETE /arquivos/{bucket}":                                      {gSessao, rwE},
	"DELETE /conteudo/arquivos/{id}":                                 {gDominio, rwE},
	"DELETE /conteudo/pecas/{id}":                                    {gDominio, rwE},
	"DELETE /equipes/grupos-membros/{id}":                            {gDominio, rwE},
	"DELETE /equipes/grupos/{id}":                                    {gDominio, rwE},
	"DELETE /equipes/membros/{id}":                                   {gDominio, rwE},
	"DELETE /equipes/permissoes/{id}":                                {gDominio, rwE},
	"DELETE /frota/revisoes/{id}":                                    {gDominio, rwE},
	"DELETE /gestao-trafego/objetivos/{alvo_id}":                     {gDominio, rwE},
	"DELETE /gestao-trafego/rascunhos/{id}":                          {gDominio, rwE},
	"DELETE /patrimonio/bens/{id}":                                   {gDominio, rwE},
	"DELETE /patrimonio/categorias/{id}":                             {gDominio, rwE},
	"DELETE /patrimonio/comodos/{id}":                                {gDominio, rwE},
	"DELETE /patrimonio/empresas/{id}":                               {gDominio, rwE},
	"DELETE /patrimonio/locais/{id}":                                 {gDominio, rwE},
	"GET /acesso/pedidos":                                            {gDominio, rwL},
	"GET /acesso/perfis":                                             {gDominio, rwL},
	"GET /acesso/usuarios":                                           {gDominio, rwL},
	"GET /acessos/organizacoes":                                      {gDominio, rwL},
	"GET /acessos/pessoas":                                           {gDominio, rwL},
	"GET /acessos/recursos":                                          {gDominio, rwL},
	"GET /acessos/setores":                                           {gDominio, rwL},
	"GET /acessos/termos":                                            {gDominio, rwL},
	"GET /acessos/vinculos":                                          {gDominio, rwL},
	"GET /arquivos/{bucket}":                                         {gSessao, rwL},
	"GET /arquivos/{bucket}/*":                                       {gSessao, rwL},
	"GET /autenticidade/baixas":                                      {gDominio, rwL},
	"GET /autenticidade/cartao-pedidos":                              {gDominio, rwL},
	"GET /autenticidade/lembretes":                                   {gDominio, rwL},
	"GET /autenticidade/lotes":                                       {gDominio, rwL},
	"GET /autenticidade/pecas":                                       {gDominio, rwL},
	"GET /autenticidade/registros":                                   {gDominio, rwL},
	"GET /auth/eu":                                                   {gSessao, rwL},
	"GET /avisos/preferencias":                                       {gDominio, rwL},
	"GET /comercial/ajustes-de-valor":                                {gDominio, rwL},
	"GET /comercial/ajustes-de-vendedor":                             {gDominio, rwL},
	"GET /comercial/briefings":                                       {gDominio, rwL},
	"GET /comercial/depositos":                                       {gDominio, rwL},
	"GET /comercial/estoque":                                         {gDominio, rwL},
	"GET /comercial/formas-de-pagamento":                             {gDominio, rwL},
	"GET /comercial/lojas":                                           {gDominio, rwL},
	"GET /comercial/metas-lojas":                                     {gDominio, rwL},
	"GET /comercial/metas-vendedoras":                                {gDominio, rwL},
	"GET /comercial/notas":                                           {gDominio, rwL},
	"GET /comercial/pedidos-shopify":                                 {gDominio, rwL},
	"GET /comercial/pedidos-vendedor":                                {gDominio, rwL},
	"GET /comercial/vendas-por-item":                                 {gDominio, rwL},
	"GET /comercial/vendedoras":                                      {gDominio, rwL},
	"GET /conteudo/arquivos":                                         {gDominio, rwL},
	"GET /conteudo/blocos":                                           {gDominio, rwL},
	"GET /conteudo/concorrentes":                                     {gDominio, rwL},
	"GET /conteudo/eventos":                                          {gDominio, rwL},
	"GET /conteudo/ideias":                                           {gDominio, rwL},
	"GET /conteudo/jobs":                                             {gDominio, rwL},
	"GET /conteudo/pecas":                                            {gDominio, rwL},
	"GET /equipes/grupos":                                            {gDominio, rwL},
	"GET /equipes/grupos-membros":                                    {gDominio, rwL},
	"GET /equipes/membros":                                           {gDominio, rwL},
	"GET /equipes/permissoes":                                        {gDominio, rwL},
	"GET /equipes/times":                                             {gDominio, rwL},
	"GET /eu/canais":                                                 {gSessao, rwL},
	"GET /eu/perfil":                                                 {gSessao, rwL},
	"GET /fabrica/campanhas":                                         {gDominio, rwL},
	"GET /fabrica/criativos":                                         {gDominio, rwL},
	"GET /fabrica/jobs":                                              {gDominio, rwL},
	"GET /fabrica/lojas":                                             {gDominio, rwL},
	"GET /fabrica/looks":                                             {gDominio, rwL},
	"GET /fabrica/marcas":                                            {gDominio, rwL},
	"GET /fabrica/meta-jobs":                                         {gDominio, rwL},
	"GET /fabrica/objetivos":                                         {gDominio, rwL},
	"GET /fabrica/publicos":                                          {gDominio, rwL},
	"GET /fabrica/robo/material-do-sku":                              {gRobo, rwL},
	"GET /frota/abastecimentos":                                      {gDominio, rwL},
	"GET /frota/checklist-config":                                    {gDominio, rwL},
	"GET /frota/checklist-itens":                                     {gDominio, rwL},
	"GET /frota/checklists":                                          {gDominio, rwL},
	"GET /frota/checklists/copias":                                   {gDominio, rwL},
	"GET /frota/checklists/respostas":                                {gDominio, rwL},
	"GET /frota/plano-revisao":                                       {gDominio, rwL},
	"GET /frota/requisicoes":                                         {gDominio, rwL},
	"GET /frota/revisoes":                                            {gDominio, rwL},
	"GET /frota/usos":                                                {gDominio, rwL},
	"GET /frota/veiculos":                                            {gDominio, rwL},
	"GET /gestao-trafego/analises-de-anuncio":                        {gDominio, rwL},
	"GET /gestao-trafego/analises-de-orcamento":                      {gDominio, rwL},
	"GET /gestao-trafego/config-metricas":                            {gDominio, rwL},
	"GET /gestao-trafego/decisoes":                                   {gDominio, rwL},
	"GET /gestao-trafego/interesses-sugeridos":                       {gDominio, rwL},
	"GET /gestao-trafego/objetivos":                                  {gDominio, rwL},
	"GET /gestao-trafego/rascunhos":                                  {gDominio, rwL},
	"GET /gestao-trafego/regua":                                      {gDominio, rwL},
	"GET /noticias/concorrentes":                                     {gDominio, rwL},
	"GET /noticias/panorama":                                         {gDominio, rwL},
	"GET /noticias/rodadas":                                          {gDominio, rwL},
	"GET /patrimonio/bens":                                           {gDominio, rwL},
	"GET /patrimonio/categorias":                                     {gDominio, rwL},
	"GET /patrimonio/comodos":                                        {gDominio, rwL},
	"GET /patrimonio/config":                                         {gDominio, rwL},
	"GET /patrimonio/empresas":                                       {gDominio, rwL},
	"GET /patrimonio/locais":                                         {gDominio, rwL},
	"GET /patrimonio/posses":                                         {gDominio, rwL},
	"GET /patrimonio/tipos":                                          {gDominio, rwL},
	"GET /acessos-oauth/callback/microsoft":                          {gPublica, rwE},
	"GET /acessos-oauth/callback/zoho":                               {gPublica, rwE},
	"GET /pronto":                                                    {gPublica, rwL},
	"GET /redes/anuncios":                                            {gDominio, rwL},
	"GET /redes/anuncios-por-hora":                                   {gDominio, rwL},
	"GET /redes/campanhas":                                           {gDominio, rwL},
	"GET /redes/chatwoot-eventos":                                    {gDominio, rwL},
	"GET /redes/campanhas-por-hora":                                  {gDominio, rwL},
	"GET /redes/conjuntos":                                           {gDominio, rwL},
	"GET /redes/contas":                                              {gDominio, rwL},
	"GET /redes/conteudo":                                            {gDominio, rwL},
	"GET /redes/engajamento":                                         {gDominio, rwL},
	"GET /redes/filtros-de-campanha":                                 {gDominio, rwL},
	"GET /redes/insights-da-conta":                                   {gDominio, rwL},
	"GET /redes/insights-de-campanha":                                {gDominio, rwL},
	"GET /redes/leituras-de-seguidores":                              {gDominio, rwL},
	"GET /redes/metas":                                               {gDominio, rwL},
	"GET /redes/seguidores":                                          {gDominio, rwL},
	"GET /redes/visitas-por-hora":                                    {gDominio, rwL},
	"GET /saude":                                                     {gPublica, rwL},
	"GET /saude/conferencias":                                        {gDominio, rwL},
	"GET /status-ia/execucoes":                                       {gDominio, rwL},
	"GET /status-ia/saude-dos-robos":                                 {gDominio, rwL},
	"GET /storage/v1/object/public/{bucket}/*":                       {gPublica, rwL},
	"GET /storage/v1/object/sign/{bucket}/*":                         {gPublica, rwL},
	"GET /vessel/atendimentos":                                       {gDominio, rwL},
	"GET /vessel/carrinho-eventos":                                   {gDominio, rwL},
	"GET /vessel/checkout-abandono":                                  {gDominio, rwL},
	"GET /vessel/lista-espera":                                       {gDominio, rwL},
	"GET /vessel/origens":                                            {gDominio, rwL},
	"GET /vessel/pedidos":                                            {gDominio, rwL},
	"GET /vessel/pessoas":                                            {gDominio, rwL},
	"OPTIONS /functions/v1/{edge}":                                   {gPublica, rwL},
	"OPTIONS /rest/v1/rpc/{nome}":                                    {gPublica, rwL},
	"OPTIONS /storage/v1/object/vessel-curriculos/{pasta}/{arquivo}": {gPublica, rwL},
	"PATCH /acesso/pedidos/{id}":                                     {gDominio, rwE},
	"PATCH /acesso/perfis/{id}":                                      {gDominio, rwE},
	"PATCH /acesso/usuarios/{id}":                                    {gDominio, rwE},
	"PATCH /acessos/pessoas/{id}":                                    {gDominio, rwE},
	"PATCH /comercial/lojas/{id}":                                    {gDominio, rwE},
	"PATCH /conteudo/arquivos/{id}":                                  {gDominio, rwE},
	"PATCH /conteudo/blocos/{id}":                                    {gDominio, rwE},
	"PATCH /conteudo/concorrentes/{id}":                              {gDominio, rwE},
	"PATCH /conteudo/ideias/{id}":                                    {gDominio, rwE},
	"PATCH /conteudo/pecas/{id}":                                     {gDominio, rwE},
	"PATCH /equipes/grupos/{id}":                                     {gDominio, rwE},
	"PATCH /equipes/membros/{id}":                                    {gDominio, rwE},
	"PATCH /equipes/times/{id}":                                      {gDominio, rwE},
	"PATCH /fabrica/robo/campanhas/{id}":                             {gRobo, rwE},
	"PATCH /fabrica/robo/jobs/{id}":                                  {gRobo, rwE},
	"PATCH /fabrica/robo/looks/{chave}":                              {gRobo, rwE},
	"PATCH /frota/checklist-config":                                  {gDominio, rwE},
	"PATCH /frota/checklist-itens/{id}":                              {gDominio, rwE},
	"PATCH /frota/plano-revisao/{id}":                                {gDominio, rwE},
	"PATCH /frota/requisicoes/{id}":                                  {gDominio, rwE},
	"PATCH /frota/usos/{id}":                                         {gDominio, rwE},
	"PATCH /frota/veiculos/{id}":                                     {gDominio, rwE},
	"PATCH /gestao-trafego/rascunhos/{id}":                           {gDominio, rwE},
	"PATCH /patrimonio/bens/{id}":                                    {gDominio, rwE},
	"PATCH /patrimonio/categorias/{id}":                              {gDominio, rwE},
	"PATCH /patrimonio/comodos/{id}":                                 {gDominio, rwE},
	"PATCH /patrimonio/empresas/{id}":                                {gDominio, rwE},
	"PATCH /patrimonio/locais/{id}":                                  {gDominio, rwE},
	"PATCH /patrimonio/posses/{id}":                                  {gDominio, rwE},
	"PATCH /redes/contas/{id}":                                       {gDominio, rwE},
	"POST /acesso/perfis":                                            {gDominio, rwE},
	"POST /acessos/log":                                              {gDominio, rwE},
	"POST /acessos/organizacoes":                                     {gDominio, rwE},
	"POST /acessos/pessoas":                                          {gDominio, rwE},
	"POST /acessos/pessoas/{id}/ligar":                               {gDominio, rwE},
	"POST /acessos/setores":                                          {gDominio, rwE},
	"POST /acessos/termos":                                           {gDominio, rwE},
	"POST /acessos/vinculos":                                         {gDominio, rwE},
	"POST /arquivos/{bucket}/assinar":                                {gSessao, rwL},
	"POST /arquivos/{bucket}/copiar":                                 {gSessao, rwE},
	"POST /auth/definir-senha":                                       {gPublica, rwE},
	"POST /auth/entrar":                                              {gPublica, rwE},
	"POST /auth/esqueci-senha":                                       {gPublica, rwE},
	"POST /auth/sair":                                                {gSessao, rwL},
	"POST /auth/trocar-senha":                                        {gSessao, rwE},
	"POST /acessos-proxy":                                            {gModulo, rwE},
	"POST /avisar-decisao-de-reserva":                                {gModulo, rwE},
	"POST /avisos/preferencias":                                      {gSessao, rwE},
	"POST /bling-proxy":                                              {gModulo, rwL},
	"POST /buscar-lugar":                                             {gModulo, rwL},
	"POST /comercial/metas/salvar":                                   {gDominio, rwE},
	"POST /comercial/pedidos-vendedor/gravar":                        {gDominio, rwE},
	"POST /comercial/vendedoras/gravar":                              {gDominio, rwE},
	"POST /conferir-senha":                                           {gSessao, rwE},
	"POST /contar-collabs":                                           {gModulo, rwL},
	"POST /conteudo-trigger":                                         {gModulo, rwE},
	"POST /conteudo/arquivos":                                        {gDominio, rwE},
	"POST /conteudo/blocos":                                          {gDominio, rwE},
	"POST /conteudo/concorrentes":                                    {gDominio, rwE},
	"POST /conteudo/eventos":                                         {gDominio, rwE},
	"POST /conteudo/ideias":                                          {gDominio, rwE},
	"POST /conteudo/pecas":                                           {gDominio, rwE},
	"POST /custo-anthropic":                                          {gModulo, rwL},
	"POST /custo-openai":                                             {gModulo, rwL},
	"POST /entrar-como-usuario":                                      {gSessao, rwE},
	"POST /equipes/grupos":                                           {gDominio, rwE},
	"POST /equipes/grupos-membros":                                   {gDominio, rwE},
	"POST /equipes/membros":                                          {gDominio, rwE},
	"POST /equipes/permissoes":                                       {gDominio, rwE},
	"POST /equipes/times":                                            {gDominio, rwE},
	"POST /eu/push/desinscrever":                                     {gSessao, rwE},
	"POST /eu/push/inscrever":                                        {gSessao, rwE},
	"POST /fabrica-apagar":                                           {gModulo, rwE},
	"POST /fabrica-candidatos":                                       {gModulo, rwL},
	"POST /fabrica-looks":                                            {gModulo, rwE},
	"POST /fabrica-publicos":                                         {gModulo, rwE},
	"POST /fabrica-trigger":                                          {gModulo, rwE},
	"POST /fabrica/criativos/escolher":                               {gDominio, rwE},
	"POST /fabrica/robo/criativos":                                   {gRobo, rwE},
	"POST /fabrica/robo/execucoes":                                   {gRobo, rwE},
	"POST /fabrica/robo/jobs/{id}/proximo-lote":                      {gRobo, rwE},
	"POST /fabrica/robo/meta-jobs":                                   {gRobo, rwE},
	"POST /frota/abastecimentos":                                     {gDominio, rwE},
	"POST /frota/checklist-itens":                                    {gDominio, rwE},
	"POST /frota/checklists":                                         {gDominio, rwE},
	"POST /frota/manutencoes":                                        {gDominio, rwE},
	"POST /frota/plano-revisao":                                      {gDominio, rwE},
	"POST /frota/requisicoes":                                        {gDominio, rwE},
	"POST /frota/usos":                                               {gDominio, rwE},
	"POST /frota/usos/trocar":                                        {gDominio, rwE},
	"POST /frota/veiculos":                                           {gDominio, rwE},
	"POST /functions/v1/{edge}":                                      {gPublica, rwE},
	"POST /gestao-trafego/decisoes":                                  {gDominio, rwE},
	"POST /gestao-trafego/rascunhos":                                 {gDominio, rwE},
	"POST /insights-ao-vivo":                                         {gModulo, rwL},
	"POST /invite-user":                                              {gSessao, rwE},
	"POST /ler-documento":                                            {gModulo, rwL},
	"POST /meta-proxy":                                               {gModulo, rwL},
	"POST /patrimonio/bens":                                          {gDominio, rwE},
	"POST /patrimonio/bens/apagar-em-massa":                          {gDominio, rwE},
	"POST /patrimonio/bens/em-massa":                                 {gDominio, rwE},
	"POST /patrimonio/categorias":                                    {gDominio, rwE},
	"POST /patrimonio/comodos":                                       {gDominio, rwE},
	"POST /patrimonio/empresas":                                      {gDominio, rwE},
	"POST /patrimonio/locais":                                        {gDominio, rwE},
	"POST /patrimonio/log":                                           {gDominio, rwE},
	"POST /patrimonio/posses":                                        {gDominio, rwE},
	"POST /patrimonio/tipos":                                         {gDominio, rwE},
	"POST /pedir-acesso":                                             {gPublica, rwE},
	"POST /receber-opt-out-chatwoot":                                 {gPublica, rwE},
	"POST /receber-webhook-abandono":                                 {gPublica, rwE},
	"POST /receber-webhook-chatwoot":                                 {gPublica, rwE},
	"POST /receber-webhook-checkout":                                 {gPublica, rwE},
	"POST /receber-webhook-pedido-shopify":                           {gPublica, rwE},
	"POST /rest/v1/rpc/{nome}":                                       {gPublica, rwE},
	"POST /rpc/{nome}":                                               {gSessao, rwL},
	"POST /serie-novos-dia":                                          {gModulo, rwL},
	"POST /storage/v1/object/vessel-curriculos/{pasta}/{arquivo}":    {gPublica, rwE},
	"POST /sugerir-publico-ia":                                       {gModulo, rwL},
	"POST /vessel-baixar-cartao":                                     {gModulo, rwL},
	"PUT /arquivos/{bucket}/*":                                       {gSessao, rwE},
	"PUT /gestao-trafego/config-metricas/{balde}":                    {gDominio, rwE},
	"PUT /gestao-trafego/objetivos/{alvo_id}":                        {gDominio, rwE},
	"PUT /gestao-trafego/regua":                                      {gDominio, rwE},
	"PUT /patrimonio/config/{chave}":                                 {gDominio, rwE},
	"PUT /redes/filtros-de-campanha/{account_id}":                    {gDominio, rwE},
	"PUT /redes/metas":                                               {gDominio, rwE},
}

// corposValidos: rotas que olham o corpo ANTES do portão fino (400 com `{}`) ou que só decidem o portão pelo corpo
// (bling-proxy: o portão é por caminho). Com o corpo certo, a regra da classe tem de valer.
var corposValidos = map[string][]string{
	"POST /bling-proxy":              {`{"endpoint":"pedidos/vendas"}`},
	"DELETE /arquivos/{bucket}":      {`{"caminhos":["a.txt"]}`},
	"POST /arquivos/{bucket}/copiar": {`{"de":"a.txt","para":"b.txt"}`},
}

type perfil string

const (
	pAnon  perfil = "anon"
	pCli   perfil = "cliente"
	pSem   perfil = "sem-permissao"
	pImp   perfil = "impersonado"
	pSuper perfil = "superadmin"
	pServ  perfil = "servico"
)

// esperado diz se o status `st` é aceitável para a linha `l` no perfil `p`; o texto descreve a regra
// quando não é.
func esperado(l linha, p perfil, st int) (bool, string) {
	passou := st != http.StatusUnauthorized && st != http.StatusForbidden
	switch {
	case l.g == gPublica:
		// sem sessão a rota NÃO é barrada por 401 de sessão (o webhook responde 401 pela assinatura: ver a lista
		// TestNenhumaRotaNovaFicaAberta, em rotas_test.go); nunca 5xx com corpo vazio/hostil
		return st < 500, "pública: nunca 5xx"
	case p == pAnon:
		return st == http.StatusUnauthorized, "sem sessão = 401"
	case p == pCli:
		return st == http.StatusForbidden, "sessão de cliente = 403"
	case l.g == gRobo:
		if p == pServ {
			return passou && st < 500, "robô com módulo passa o portão"
		}
		return st == http.StatusForbidden, "rota de robô: só conta de serviço"
	case p == pServ: // fora das rotas de robô o serviço vale como qualquer sessão (perfil do robô): não é controle desta matriz
		return true, ""
	case p == pImp && l.e == rwE:
		return st == http.StatusForbidden, `"entrar como" não grava: 403`
	case (p == pSuper || p == pImp) && l.g == gDominio && l.e == rwL:
		return st == http.StatusOK, "leitura de domínio do superadmin: 200 (controle positivo: o portão deixa passar)"
	case p == pSuper || p == pImp:
		return passou, "superadmin passa o portão (qualquer coisa menos 401/403)"
	}
	// p == pSem: viewer sem módulo e sem permissão nenhuma
	switch l.g {
	case gSessao:
		return st != http.StatusUnauthorized && st < 500, "só-sessão: passa o roteador, regra no handler"
	case gModulo:
		return st == http.StatusForbidden, "sem módulo = 403"
	default: // gDominio
		if l.e == rwL {
			return st == http.StatusForbidden || st == http.StatusOK, "leitura de domínio: 403 ou 200 filtrado pelo catálogo"
		}
		return st == http.StatusForbidden || st == http.StatusBadRequest || st == http.StatusNotFound, "escrita de domínio sem permissão: 403 (ou 400/404), nunca 2xx"
	}
}

const chaveDoCore = "core-segredo-de-teste-nao-sai"

const origemPermitida = "https://app.permitido.example"

const hashCanario = "CanarioDeSenhaNaoPodeSair000000000000000000000000000000000"

// logsCapturados: buffer seguro para goroutines (a de EsqueciSenha loga depois da resposta).
type logsCapturados struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *logsCapturados) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}
func (l *logsCapturados) String() string { l.mu.Lock(); defer l.mu.Unlock(); return l.b.String() }
func (l *logsCapturados) Len() int       { l.mu.Lock(); defer l.mu.Unlock(); return l.b.Len() }

// capturaLogs: tudo que a API loga (slog e log padrão, inclusive Debug) durante o teste.
func capturaLogs(t *testing.T) *logsCapturados {
	t.Helper()
	b := &logsCapturados{}
	anterior := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(b, &slog.HandlerOptions{Level: slog.LevelDebug})))
	log.SetOutput(b)
	t.Cleanup(func() { slog.SetDefault(anterior); log.SetOutput(os.Stderr) })
	return b
}

// semConfiguracao: as rotas que respondem 5xx POR DESENHO quando a chave ou a URL do fornecedor não está no config do teste
// (config.go: "Vazia = a rota responde 500 chave_admin_nao_configurada" / 503 do Core). Toda outra rota não pode dar 5xx.
var semConfiguracao = map[string]bool{"POST /bling-proxy": true, "POST /custo-anthropic": true, "POST /custo-openai": true}

// mundoDaMatriz monta o banco de produção (D0), as pessoas e a API real; `sessoes` entrega tokens NOVOS por perfil.
func mundoDaMatriz(t *testing.T) (p *pgxpool.Pool, h http.Handler, sessoes func() map[perfil]string, arquivos string, nova func() http.Handler) {
	t.Helper()
	p = testebanco.ComEsquemaDeProducao(t)
	ctx := context.Background()
	st := auth.NovoStore(p)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := p.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	const (
		idSem, idSuper, idSuper2, idCli = "21111111-1111-4111-a111-111111111111", "22222222-2222-4222-a222-222222222222",
			"23333333-3333-4333-a333-333333333333", "24444444-4444-4444-a444-444444444444"
	)
	for _, u := range []struct {
		id, role string
		super    bool
	}{{idSem, "viewer", false}, {idSuper, "admin", true}, {idSuper2, "admin", true}} {
		exec(`insert into usuarios (id, email) values ($1::uuid, $2::text)`, u.id, u.id+"@x.com")
		exec(`insert into profiles (id, email, name, role, is_superadmin, escopo_por_equipe, features) values ($1::uuid, $2::text, $2::text, $3::text, $4::boolean, false, '{}')`,
			u.id, u.id+"@x.com", u.role, u.super)
	}
	exec(`insert into usuarios (id, email) values ($1::uuid, 'cliente-matriz@x.com')`, idCli)
	por := idSuper2
	servico, err := st.CriarContaDeServico(ctx, "robo-matriz", "robo-matriz@x.com", auth.ModulosConhecidos)
	if err != nil {
		t.Fatal(err)
	}
	// Sessões novas a cada rota: POST /auth/sair e a troca de senha revogam sessões, e o resto da varredura ficaria em 401.
	sessoes = func() map[perfil]string {
		tok := map[perfil]string{pServ: servico}
		for pf, c := range map[perfil]struct {
			id, tipo string
			por      *string
		}{pSem: {idSem, "painel", nil}, pSuper: {idSuper, "painel", nil}, pImp: {idSuper, "painel", &por}, pCli: {idCli, "cliente", nil}} {
			tk, err := st.Criar(ctx, c.id, c.tipo, c.por)
			if err != nil {
				t.Fatal(err)
			}
			tok[pf] = tk
		}
		return tok
	}
	// hash de senha de mentira em todo usuário: se alguma leitura devolvê-lo, a varredura vê o prefixo bcrypt
	exec(`update usuarios set senha_hash = '$2a$10$` + hashCanario + `'`)
	// o robô só passa o soFabricante com a chave meta.fabrica (ou papel admin) no perfil
	exec(`update profiles set permissions = '{"meta.fabrica":["ver"]}'::jsonb where email = 'robo-matriz@x.com'`)
	// o esquema de produção (D0) não traz as tabelas do 5.12 que as leituras de /noticias e /status-ia consultam
	exec(`create table noticias_concorrentes (
		id uuid primary key default gen_random_uuid(), marca text not null, titulo text not null, resumo text,
		categoria text, url text, fonte text, data_publicacao date, rodada date not null default current_date,
		destaque boolean not null default false, created_at timestamptz not null default now(), produtos jsonb);
		create table noticias_panorama (rodada date primary key, conteudo_md text not null, modelo text, uso text,
		created_at timestamptz not null default now());
		create view robos_saude as select 'x'::text as robo, true as critico where false`)
	arquivos = filepath.Join(t.TempDir(), "arq")
	cfg := config.Config{VesselInterno: chaveDoCore, VesselSoCore: true, Origens: []string{origemPermitida}, ArquivosSegredo: "segredo-de-teste", ShopifySegredos: []string{"s"}, ChatwootSegredo: "c", CoreURL: coreFalso(t), ArquivosDir: arquivos,
		EnderecosDoApp: []string{"https://app.exemplo.com"}, EnderecoPadrao: "https://app.exemplo.com"}
	nova = func() http.Handler { return Rotas(p, st, auth.NovoLimitador(), cfg) } // cada chamada = limitadores zerados
	return p, nova(), sessoes, arquivos, nova
}

func TestMatrizRotaPorPerfil(t *testing.T) {
	_, h, sessoes, arquivos, _ := mundoDaMatriz(t)
	logs := capturaLogs(t)
	var usados []string // todo token que a varredura mandou: nenhum pode aparecer nos logs
	var vistas []string
	err := chi.Walk(h.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		chave := metodo + " " + rota
		vistas = append(vistas, chave)
		l, ok := matriz[chave]
		if !ok {
			t.Errorf("%s: rota sem linha na matriz de segurança (classifique-a em matriz: gate e leitura/escrita)", chave)
			return nil
		}
		perfis := []perfil{pAnon, pCli, pSem, pImp, pSuper, pServ}
		if l.g == gPublica {
			perfis = []perfil{pAnon}
		}
		for _, pf := range perfis {
			corpos := []string{`{}`, ``}
			if c, ok := corposValidos[chave]; ok {
				corpos = c
			}
			for _, corpo := range corpos {
				tok := sessoes()
				for _, v := range tok {
					usados = append(usados, v)
				}
				r := httptest.NewRequest(metodo, strings.NewReplacer("{nome}", "nome-inexistente", "{bucket}", "arquivos", "*", "x").Replace(rota), strings.NewReader(corpo))
				r.Header.Set("Content-Type", "application/json")
				if pf != pAnon {
					r.Header.Set("Authorization", "Bearer "+tok[pf])
				}
				r.Header.Set("Origin", "https://evil.example")
				w := httptest.NewRecorder()
				h.ServeHTTP(w, r)
				if o := w.Header().Get("Access-Control-Allow-Origin"); o == "*" || strings.Contains(o, "evil") {
					t.Errorf("%s como %s: Access-Control-Allow-Origin = %q para origem hostil", chave, pf, o)
				}
				if w.Code >= 500 && !semConfiguracao[chave] { // 5xx só onde falta chave/URL no cfg do teste, por desenho (503/500 dos config.Config)
					t.Errorf("%s como %s (corpo %q) = %d %.100s: 5xx com portão aberto e corpo vazio", chave, pf, corpo, w.Code, w.Body)
				}
				semVazamento(t, chave+" como "+string(pf), arquivos, w.Body.String())
				if strings.Contains(w.Body.String(), "$2a$") {
					t.Errorf("%s como %s devolveu hash de senha", chave, pf)
				}
				if ok, regra := esperado(l, pf, w.Code); !ok {
					t.Errorf("%s como %s (corpo %q) = %d, esperava: %s", chave, pf, corpo, w.Code, regra)
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for chave := range matriz {
		if !slices.Contains(vistas, chave) {
			t.Errorf("a matriz tem a linha %q, mas a rota não está montada (rota removida? tire a linha)", chave)
		}
	}
	if len(vistas) != len(matriz) {
		t.Errorf("rotas montadas = %d, linhas da matriz = %d", len(vistas), len(matriz))
	}
	if logs.Len() == 0 {
		t.Error("controle: a captura de logs não pegou nada (a varredura de segredo nos logs não provaria nada)")
	}
	for _, tk := range usados {
		h := sha256.Sum256([]byte(tk))
		for _, parte := range []string{tk, hex.EncodeToString(h[:]), tk[:min(16, len(tk))]} { // inteiro, o hash que vai ao banco e um prefixo
			if strings.Contains(logs.String(), parte) {
				t.Errorf("um token de sessão (ou o hash/prefixo dele) apareceu nos logs da API")
				break
			}
		}
	}
	for _, seg := range []string{hashCanario, "segredo-de-teste", chaveDoCore} {
		if strings.Contains(logs.String(), seg) {
			t.Errorf("segredo %q apareceu nos logs da API", seg)
		}
	}
	t.Log(fmt.Sprintf("matriz cobre %d/%d rotas", len(matriz), len(vistas)))
}

// rpcsAbertasAQualquerPainel: as funções que o portão deixa passar a um viewer SEM módulo e SEM permissão
// (lista de leitura de cadastro para os seletores das telas, da conta de quem pede). Revisada pessoa a pessoa: toda
// outra função de POST /rpc/{nome} tem de dar 403 a esse viewer. Entrada nova aqui é decisão de quem revisa.
var rpcsAbertasAQualquerPainel = map[string]bool{}

// rpcsQueDevolvemVazio: o portão do Go é "conta ativa" e a função SQL devolve `[]` a quem não tem a permissão da tela
// (decisão da migration 2026-09-25: bloco dentro de ficha já aberta; a matriz pessoa a pessoa é de internal/atendimentos).
// Com o parâmetro certo, o viewer sem nada tem de levar 200 e `[]`.
var rpcsQueDevolvemVazio = map[string]bool{"vessel_convidadas_do_encontro": true, "vessel_stylist_contatos": true, "vessel_stylist_qualificacoes": true}

// reGrava: a função muda dados (o corpo SQL tem DML). Serve de oráculo independente do campo SoSessaoPropria.
var reGrava = regexp.MustCompile(`(?i)\b(insert\s+into|update\s+[\w."]+(\s+(as\s+)?\w+)?\s+set|merge\s+into|perform\s+(public\.)?\w*(grav|salv|criar|editar|apagar|decidir|registrar|marcar)|delete\s+from|truncate|nextval|set_config)\b`)

// POST /rpc/{nome} é UMA rota na matriz, mas são 92 funções. Para cada uma: sem sessão 401, cliente 403, viewer sem
// nada 403 (salvo a lista revisada acima), e quem entrou como outra pessoa: 403 se a função GRAVA (o corpo SQL tem
// DML ou a função é volátil e escreve), aberta se só lê. O esperado de "grava" vem do banco, não do campo
// SoSessaoPropria que o registro declara: função que grava sem o campo reprova.
func TestRPCsPorPerfil(t *testing.T) {
	p, h, sessoes, _, _ := mundoDaMatriz(t)
	for _, f := range FuncoesRPC {
		var vol, src string
		if err := p.QueryRow(context.Background(), `select provolatile::text, prosrc from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, f.Nome).Scan(&vol, &src); err != nil {
			t.Errorf("rpc %s: função não existe no banco: %v", f.Nome, err)
			continue
		}
		grava := vol == "v" && reGrava.MatchString(src)
		if grava != f.SoSessaoPropria {
			t.Errorf("rpc %s: grava (pelo banco) = %v, mas SoSessaoPropria = %v", f.Nome, grava, f.SoSessaoPropria)
		}
		pedir := func(pf perfil, tok string) int {
			r := httptest.NewRequest("POST", "/rpc/"+f.Nome, strings.NewReader(`{}`))
			r.Header.Set("Content-Type", "application/json")
			if tok != "" {
				r.Header.Set("Authorization", "Bearer "+tok)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			return w.Code
		}
		tok := sessoes()
		if st := pedir(pAnon, ""); st != http.StatusUnauthorized {
			t.Errorf("rpc %s sem sessão = %d, esperava 401", f.Nome, st)
		}
		if st := pedir(pCli, tok[pCli]); st != http.StatusForbidden {
			t.Errorf("rpc %s como cliente = %d, esperava 403", f.Nome, st)
		}
		if rpcsQueDevolvemVazio[f.Nome] {
			r := httptest.NewRequest("POST", "/rpc/"+f.Nome, strings.NewReader(`{"p_codigo":"CODIGO-QUALQUER"}`))
			r.Header.Set("Authorization", "Bearer "+tok[pSem])
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != "[]" {
				t.Errorf("rpc %s: viewer sem a permissão da tela = %d %s, esperava 200 []", f.Nome, w.Code, w.Body)
			}
		} else {
			switch st := pedir(pSem, tok[pSem]); {
			case rpcsAbertasAQualquerPainel[f.Nome] && st == http.StatusForbidden:
				t.Errorf("rpc %s consta como aberta a qualquer painel, mas o viewer sem nada levou 403 (tire da lista)", f.Nome)
			case !rpcsAbertasAQualquerPainel[f.Nome] && st != http.StatusForbidden:
				t.Errorf("rpc %s: viewer sem módulo nem permissão = %d, esperava 403 (ou entre na lista revisada)", f.Nome, st)
			}
		}
		st := pedir(pImp, tok[pImp])
		if grava && st != http.StatusForbidden {
			t.Errorf("rpc %s grava e quem entrou como outra pessoa levou %d, esperava 403", f.Nome, st)
		}
		if !grava && st == http.StatusForbidden {
			t.Errorf("rpc %s só lê e quem entrou como levou 403 (o superadmin impersonado vê o que a pessoa vê)", f.Nome)
		}
		if st := pedir(pSuper, tok[pSuper]); st == http.StatusForbidden || st == http.StatusUnauthorized {
			t.Errorf("rpc %s: superadmin levou %d (controle positivo)", f.Nome, st)
		}
	}
}

// As três rotas em que o portão fino está DENTRO do handler e depende do corpo (a matriz com `{}` só vê o 400 da edge):
// entrar-como (só superadmin de painel), invite-user (só papel admin) e meta-proxy (escrita na Meta: não para quem entrou
// como). Corpo válido, esperado pela regra e conferência de que nada foi criado.
func TestPortoesDeContaEMetaProxyComCorpoValido(t *testing.T) {
	p, h, sessoes, _, _ := mundoDaMatriz(t)
	const idAdmin = "25555555-5555-4555-a555-555555555555"
	for _, q := range []string{`insert into usuarios (id, email) values ($1::uuid, 'admin-simples@x.com')`,
		`insert into profiles (id, email, name, role, is_superadmin, escopo_por_equipe, features) values ($1::uuid, 'admin-simples@x.com', 'a', 'admin', false, false, '{}')`} {
		if _, err := p.Exec(context.Background(), q, idAdmin); err != nil {
			t.Fatal(err)
		}
	}
	var tokAdmin string
	{
		s := auth.NovoStore(p)
		var err error
		if tokAdmin, err = s.Criar(context.Background(), idAdmin, "painel", nil); err != nil {
			t.Fatal(err)
		}
	}
	contar := func(sql string) int {
		var n int
		if err := p.QueryRow(context.Background(), sql).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	usuariosAntes, sessoesAntes := contar(`select count(*) from usuarios`), contar(`select count(*) from sessoes`)
	pedir := func(tok, caminho, corpo string) (int, string) {
		r := httptest.NewRequest("POST", caminho, strings.NewReader(corpo))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", "Bearer "+tok)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, w.Body.String()
	}
	tk := sessoes()
	alvo := `{"alvoId":"22222222-2222-4222-a222-222222222222"}` // o superadmin da fixture
	for nome, c := range map[string]struct {
		tok, caminho, corpo string
		quer                int
	}{
		"entrar-como sem permissão":         {tk[pSem], "/entrar-como-usuario", alvo, 400},
		"entrar-como admin que não é super": {tokAdmin, "/entrar-como-usuario", alvo, 400},
		"entrar-como já impersonado":        {tk[pImp], "/entrar-como-usuario", alvo, 403},
		"entrar-como cliente":               {tk[pCli], "/entrar-como-usuario", alvo, 403},
		"invite-user sem papel admin":       {tk[pSem], "/invite-user", `{"email":"novo@x.com","name":"Novo","role":"admin"}`, 400},
		"invite-user impersonado":           {tk[pImp], "/invite-user", `{"email":"novo@x.com","name":"Novo","role":"admin"}`, 403},
		"meta-proxy POST impersonado":       {tk[pImp], "/meta-proxy", `{"accountId":"1","path":"x","method":"POST"}`, 403},
		"meta-proxy DELETE impersonado":     {tk[pImp], "/meta-proxy", `{"accountId":"1","path":"x","method":"DELETE"}`, 403},
		"meta-proxy mídia impersonado":      {tk[pImp], "/meta-proxy", `{"accountId":"1","path":"x","imageFromURL":"https://x/y.png"}`, 403},
		"meta-proxy sem módulo":             {tk[pSem], "/meta-proxy", `{"accountId":"1","path":"x","method":"POST"}`, 403},
		"avisar-decisão impersonado":        {tk[pImp], "/avisar-decisao-de-reserva", `{"requisicaoId":"22222222-2222-4222-a222-222222222222"}`, 403},
	} {
		st, corpo := pedir(c.tok, c.caminho, c.corpo)
		if st != c.quer {
			t.Errorf("%s = %d %.120s, esperava %d", nome, st, corpo, c.quer)
		}
		if strings.Contains(corpo, `"token"`) {
			t.Errorf("%s devolveu token de sessão: %.80s", nome, corpo)
		}
	}
	if n := contar(`select count(*) from usuarios`); n != usuariosAntes {
		t.Errorf("usuários: %d -> %d (um pedido recusado criou conta)", usuariosAntes, n)
	}
	if n := contar(`select count(*) from sessoes`); n != sessoesAntes+0 && n < sessoesAntes {
		t.Errorf("sessões encolheram: %d -> %d", sessoesAntes, n)
	}
}
