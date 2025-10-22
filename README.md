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

## ⏰ Sistema de Atualização Automática de Views Materializadas

Este projeto inclui um sistema automático que atualiza views materializadas do PostgreSQL a cada hora, sempre aos **5 minutos** (00:05, 01:05, 02:05, etc.).

### Views Gerenciadas

- `public.fatbazar`
- `public.fatvarejo`
- `public.fatrevenda`
- `public.fatfranquias`
- `public.fatmtm`
- `public.fatsellect`
- `public.cmv_varejo`
- `public.cmv_revenda`
- `public.cmv_mtm`
- `public.cmv_franquias`

### Recursos

✅ **Atualização automática** a cada hora  
✅ **Logs detalhados** de cada atualização  
✅ **API para atualização manual**: `POST /api/utils/refresh-materialized-views`  
✅ **Graceful shutdown** ao encerrar o servidor  
✅ **Timezone configurável** (padrão: America/Sao_Paulo)

### Documentação Completa

Consulte [MATERIALIZED_VIEWS_REFRESH.md](./MATERIALIZED_VIEWS_REFRESH.md) para detalhes completos sobre:
- Como funciona o sistema
- Horários de execução
- API de atualização manual
- Configuração e personalização
- Monitoramento e solução de problemas

### Teste Rápido

Abra o arquivo `test-refresh-views.html` no navegador para testar a atualização manual das views.

---

Se precisar de deploy automatizado, integração com banco de dados ou outras configurações, personalize conforme sua necessidade. # apigestaocrosby
