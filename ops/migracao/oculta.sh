# Máscara ÚNICA de segredos em texto de erro; carregue com: . "$AQUI/oculta.sh"
# Oculta a URL postgres:// e, no texto de erro do libpq, host/usuário/papel:
# server at "h" (ip), host "h", host name "h", user "u", role "r".
oculta() { sed -E -e 's#postgres(ql)?://[^ "]*#<URL>#g' -e 's#(server at|host name|host|user|role) "[^"]*"( \([^)]*\))?#\1 "<oculto>"#g'; }
