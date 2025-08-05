# API de Gestão Crosby - Versão Refatorada 2.0

## 📋 Sobre

API completamente refatorada para o sistema de gestão Crosby, com melhorias significativas em:

- **Segurança**: Autenticação JWT, hash de senhas, rate limiting, sanitização de entrada
- **Performance**: Otimização de queries, pool de conexões, cache de responses
- **Organização**: Código modular, middlewares especializados, tratamento de erros centralizado
- **Documentação**: Rotas documentadas, tipos de dados claros, exemplos de uso

## 🚀 Melhorias Implementadas

### ✅ Segurança
- **Autenticação JWT** com tokens seguros
- **Hash de senhas** com bcrypt
- **Rate limiting** para prevenir ataques DDoS
- **Sanitização de entrada** para prevenir SQL injection
- **CORS configurado** adequadamente
- **Helmet** para headers de segurança
- **Variáveis de ambiente** para credenciais sensíveis

### ✅ Performance
- **Pool de conexões** otimizado para PostgreSQL
- **Compressão** de respostas HTTP
- **Queries otimizadas** com menos JOINs desnecessários
- **Paginação** em todas as consultas grandes
- **Timeouts** configurados adequadamente

### ✅ Organização
- **Estrutura modular** separada por responsabilidades
- **Middlewares especializados** para validação e autenticação
- **Tratamento de erros** centralizado e consistente
- **Logging** estruturado com diferentes níveis
- **Documentação** das rotas integrada

### ✅ Remoções
- **Dependências desnecessárias** removidas (@phosphor-icons/react, phosphor-react)
- **Código duplicado** eliminado
- **Senhas em texto puro** removidas
- **Hardcoded values** movidos para configuração

## 📁 Estrutura do Projeto

```
├── config/
│   ├── database.js          # Configuração do banco de dados
│   └── auth.js              # Configurações de autenticação
├── middlewares/
│   ├── auth.middleware.js   # Middlewares de autenticação
│   └── validation.middleware.js # Middlewares de validação
├── routes/
│   ├── auth.routes.js       # Rotas de autenticação
│   ├── financial.routes.js  # Rotas financeiras
│   ├── sales.routes.js      # Rotas de vendas
│   ├── company.routes.js    # Rotas de empresas
│   ├── franchise.routes.js  # Rotas de franquias
│   └── utils.routes.js      # Rotas utilitárias
├── utils/
│   └── errorHandler.js      # Tratamento de erros
├── index.refatorado.js      # Arquivo principal refatorado
├── package.refatorado.json  # Dependências atualizadas
└── ecosystem.refatorado.config.js # Configuração PM2 otimizada
```

## 🛠️ Instalação e Configuração

### 1. Instalar dependências
```bash
# Instalar novas dependências
npm install express cors helmet express-rate-limit compression morgan dotenv pg bcrypt jsonwebtoken axios

# Dependências de desenvolvimento
npm install --save-dev nodemon eslint jest supertest
```

### 2. Configurar variáveis de ambiente
```bash
# Copiar exemplo de configuração
cp config.example.env .env

# Editar .env com suas configurações
# IMPORTANTE: Altere JWT_SECRET para uma chave forte em produção
```

### 3. Executar a aplicação
```bash
# Desenvolvimento
npm run dev

# Produção
npm start

# Com PM2
pm2 start ecosystem.refatorado.config.js
```

## 📖 Documentação das Rotas

### 🔐 Autenticação (`/api/auth`)

| Método | Rota | Descrição | Acesso |
|--------|------|-----------|--------|
| POST | `/api/auth/login` | Login do usuário | Público |
| GET | `/api/auth/profile` | Perfil do usuário logado | Privado |
| GET | `/api/auth/users` | Listar usuários | ADM |
| POST | `/api/auth/users` | Criar usuário | ADM |
| PUT | `/api/auth/users/:id` | Editar usuário | ADM |
| DELETE | `/api/auth/users/:id` | Excluir usuário | ADM |

### 💰 Financeiro (`/api/financial`)

| Método | Rota | Descrição | Acesso |
|--------|------|-----------|--------|
| GET | `/api/financial/extrato` | Extrato bancário | ADM, DIRETOR, FINANCEIRO |
| GET | `/api/financial/extrato-totvs` | Extrato TOTVS | ADM, DIRETOR, FINANCEIRO |
| GET | `/api/financial/contas-pagar` | Contas a pagar | ADM, DIRETOR, FINANCEIRO |
| GET | `/api/financial/contas-receber` | Contas a receber | ADM, DIRETOR, FINANCEIRO |

### 📈 Vendas (`/api/sales`)

| Método | Rota | Descrição | Acesso |
|--------|------|-----------|--------|
| GET | `/api/sales/faturamento` | Faturamento geral | ADM, DIRETOR, FINANCEIRO |
| GET | `/api/sales/faturamento-franquia` | Faturamento de franquias | ADM, DIRETOR, FINANCEIRO, FRANQUIA |
| GET | `/api/sales/faturamento-mtm` | Faturamento MTM | ADM, DIRETOR, FINANCEIRO |
| GET | `/api/sales/faturamento-revenda` | Faturamento de revenda | ADM, DIRETOR, FINANCEIRO |
| GET | `/api/sales/ranking-vendedores` | Ranking de vendedores | ADM, DIRETOR |

### 🏢 Empresas (`/api/company`)

| Método | Rota | Descrição | Acesso |
|--------|------|-----------|--------|
| GET | `/api/company/empresas` | Lista de empresas | Todos autenticados |
| GET | `/api/company/grupo-empresas` | Grupos de empresas | Todos autenticados |
| GET | `/api/company/faturamento-lojas` | Faturamento por lojas | ADM, DIRETOR, FINANCEIRO |
| GET | `/api/company/expedicao` | Dados de expedição | ADM, DIRETOR |
| GET | `/api/company/pcp` | Dados de PCP | ADM, DIRETOR |

### 🏪 Franquias (`/api/franchise`)

| Método | Rota | Descrição | Acesso |
|--------|------|-----------|--------|
| GET | `/api/franchise/consulta-fatura` | Consultar faturas de franquias | ADM, DIRETOR, FINANCEIRO, FRANQUIA |
| GET | `/api/franchise/fundo-propaganda` | Fundo de propaganda | ADM, DIRETOR, FINANCEIRO, FRANQUIA |
| GET | `/api/franchise/franquias-credev` | Franquias crédito/débito | ADM, DIRETOR, FINANCEIRO |

### 🛠️ Utilitários (`/api/utils`)

| Método | Rota | Descrição | Acesso |
|--------|------|-----------|--------|
| GET | `/api/utils/health` | Health check | Público |
| GET | `/api/utils/stats` | Estatísticas do sistema | ADM |
| GET | `/api/utils/autocomplete/nm_fantasia` | Autocomplete nomes fantasia | Privado |
| GET | `/api/utils/autocomplete/nm_grupoempresa` | Autocomplete grupos empresa | Privado |

## 🔧 Uso

### Exemplo de Login
```javascript
const response = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'admin',
    password: 'admin123'
  })
});

const data = await response.json();
const token = data.data.token;
```

### Exemplo de Requisição Autenticada
```javascript
const response = await fetch('/api/financial/extrato?limit=10', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

## 🔄 Migração da Versão Anterior

### Rotas de Compatibilidade Temporária

Algumas rotas antigas foram mantidas temporariamente com redirects:
- `POST /login` → `POST /api/auth/login`
- `GET /extrato` → `GET /api/financial/extrato`

### Alterações Necessárias no Frontend

1. **URLs**: Todas as rotas agora estão sob `/api/`
2. **Autenticação**: Usar cabeçalho `Authorization: Bearer <token>`
3. **Respostas**: Novo formato padronizado com `success`, `message`, `data`

## 📊 Monitoramento

### Health Check
```bash
curl http://localhost:4000/api/utils/health
```

### Logs com PM2
```bash
pm2 logs api-gestao-crosby
pm2 monit
```

## 🚧 Próximos Passos

1. **Testes automatizados** com Jest
2. **Cache Redis** para consultas frequentes
3. **WebSockets** para atualizações em tempo real
4. **Swagger/OpenAPI** para documentação interativa
5. **Docker** para containerização
6. **CI/CD** para deploy automatizado

## 🐛 Problemas Corrigidos

- ✅ Senhas em texto puro
- ✅ Credenciais expostas no código
- ✅ CORS inadequado
- ✅ Falta de autenticação
- ✅ SQL injection vulnerável
- ✅ Queries não otimizadas
- ✅ Código não organizado
- ✅ Dependências desnecessárias
- ✅ Falta de tratamento de erro
- ✅ Configuração PM2 inadequada

---

**Versão**: 2.0.0  
**Última atualização**: 2025-01-04  
**Desenvolvido por**: Sistema Crosby