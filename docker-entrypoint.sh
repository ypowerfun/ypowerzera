#!/bin/sh
# Sobe o site em produção: antes, cria/atualiza as tabelas do banco SEM apagar dados
# (se uma atualização exigir apagar dados, o Prisma recusa e o erro aparece nos logs).
set -e
echo "Atualizando o banco de dados (sem apagar nada)..."
npx prisma db push --skip-generate
echo "Iniciando o site..."
# exec + o binário direto (e não npx): o site recebe o sinal de desligamento do Docker e encerra direito
exec ./node_modules/.bin/next start -H 0.0.0.0 -p 3000
