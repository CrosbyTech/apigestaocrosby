# Backend - Instruções de Deploy na DigitalOcean

## Pré-requisitos
- Conta na DigitalOcean
- Droplet (servidor) com Node.js instalado
- Git instalado no servidor

## Passos para Deploy

1. **Acesse seu servidor via SSH:**
   ```sh
   ssh usuario@ip_do_servidor
   ```

2. **Clone o repositório:**
   ```sh
   git clone <url-do-seu-repositorio>
   cd backend
   ```

3. **Instale as dependências:**
   ```sh
   npm install
   ```

4. **Configure as variáveis de ambiente:**
   - Copie o arquivo `.env.example` para `.env` e preencha com seus dados.

5. **(Opcional) Instale o PM2 para gerenciar o processo:**
   ```sh
   npm install -g pm2
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

6. **Acesse sua aplicação:**
   - Certifique-se de liberar a porta no firewall do servidor.
   - Acesse via http://ip_do_servidor:3000

---

Se precisar de deploy automatizado, integração com banco de dados ou outras configurações, personalize conforme sua necessidade. # apigestaocrosby
