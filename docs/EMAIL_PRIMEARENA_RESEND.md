# Ativar noreply@primearena1.com.br com Resend

O endereço será usado como remetente das confirmações de conta e da recuperação de senha. Este tutorial não significa que o envio já está ativo.

1. Crie sua conta em https://resend.com e entre no painel.
2. Em Domains, adicione primearena1.com.br. Para usar exatamente noreply@primearena1.com.br, valide esse domínio.
3. Copie os registros de envio que o painel apresentar para o provedor que gerencia o DNS do domínio. Use os nomes e valores exatos do Resend para SPF e DKIM; não invente valores nem altere os registros do site.
4. Volte ao Resend e peça a verificação. Aguarde o domínio ficar Verified.
5. Em API Keys, crie uma chave de envio, de preferência limitada a esse domínio, e guarde-a no armazenamento de segredos da hospedagem. Não cole a chave em chats nem no GitHub.
6. Configure o remetente como Prime Arena <noreply@primearena1.com.br> e teste a entrega para uma caixa sua.

Depois de verificar o domínio, o Resend permite enviar usando endereços dele sem cadastrar cada remetente separadamente. Isso é suficiente para o noreply enviar confirmações; não cria uma caixa de entrada tradicional.

Fontes oficiais:
- Domínios e remetentes: https://resend.com/docs/dashboard/domains/introduction
- SMTP: https://resend.com/docs/send-with-smtp

## Configuração para o código atual do GitHub

No .env privado da aplicação Node/Docker:

```dotenv
APP_URL="https://primearena1.com.br"
MAIL_FROM="Prime Arena <noreply@primearena1.com.br>"
SMTP_URL="smtps://resend:SUA_CHAVE_API@smtp.resend.com:465"
```

Substitua SUA_CHAVE_API somente no ambiente privado. Se houver caracteres reservados na credencial, codifique-os para URL. Recrie o container depois da mudança. A porta 465 usa TLS; usuário resend e senha igual à chave de API seguem a documentação SMTP oficial.

## Configuração para a hospedagem Sites escolhida

A aplicação publicada é diferente da aplicação Node/Docker do GitHub. A integração precisa ser adaptada ao backend do Sites e usar uma chave guardada como segredo. Não basta colar SMTP_URL no Sites para o código funcionar.

O domínio/remetente pode ser verificado agora no Resend. A ligação da chave ao aplicativo, o cadastro com confirmação e o teste ponta a ponta permanecem pendentes até a adaptação e publicação serem concluídas.

## Como conferir que funcionou

Crie uma conta com uma caixa sua, confira o remetente recebido, abra o link de confirmação e teste a recuperação de senha. Confira também o painel de e-mails do Resend. Uma resposta de envio aceito não garante que a mensagem chegou à caixa de entrada.
