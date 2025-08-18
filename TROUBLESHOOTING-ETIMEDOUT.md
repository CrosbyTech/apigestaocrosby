# 🔧 Troubleshooting - Erro ETIMEDOUT

## 🚨 Problema Identificado

### **Erro: `Error: read ETIMEDOUT`**
```
Error: read ETIMEDOUT
    at TLSWrap.onStreamRead (node:internal/stream_base_commons:216:20) {
  errno: -110,
  code: 'ETIMEDOUT',
  syscall: 'read',
  client: Client {
    // ... detalhes da conexão
  }
}
```

## 🔍 Análise do Erro

### **O que significa ETIMEDOUT?**
- **ETIMEDOUT** = "Connection timed out"
- Ocorre quando uma operação de leitura/escrita na conexão com o banco excede o tempo limite
- Indica problemas de conectividade de rede ou sobrecarga do servidor

### **Causas Comuns**
1. **Latência de rede alta** entre aplicação e banco
2. **Sobrecarga no servidor** de banco de dados
3. **Firewall** bloqueando conexões
4. **Configuração de SSL** inadequada
5. **Queries muito pesadas** sem timeout adequado
6. **Pool de conexões** mal configurado

## ✅ Soluções Implementadas

### **1. Configuração Otimizada do Pool**

```javascript
// ANTES (problemático)
max: 30, // Muitas conexões
min: 5,
idleTimeoutMillis: 60000, // 1 minuto
connectionTimeoutMillis: 120000, // 2 minutos
acquireTimeoutMillis: 120000, // 2 minutos

// DEPOIS (otimizado)
max: 20, // Menos conexões para evitar sobrecarga
min: 3,
idleTimeoutMillis: 30000, // 30 segundos - libera conexões mais rápido
connectionTimeoutMillis: 30000, // 30 segundos - timeout mais conservador
acquireTimeoutMillis: 30000, // 30 segundos - timeout mais conservador
```

### **2. Timeouts do PostgreSQL Ajustados**

```javascript
// Timeouts mais conservadores (30 minutos em vez de sem limite)
statement_timeout: 1800000, // 30 minutos
query_timeout: 1800000, // 30 minutos
idle_in_transaction_session_timeout: 1800000, // 30 minutos
```

### **3. Keep Alive Otimizado**

```javascript
keepAlive: true,
keepAliveInitialDelayMillis: 5000, // 5 segundos (mais frequente)
```

### **4. Sistema de Retry Automático**

```javascript
export const executeQueryWithRetry = async (query, params = [], maxRetries = 3) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await pool.query(query, params);
      return result;
    } catch (error) {
      lastError = error;
      
      // Se for timeout, tentar novamente
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.message.includes('timeout')) {
        console.warn(`⚠️  Tentativa ${attempt}/${maxRetries} falhou por timeout. Tentando novamente...`);
        
        if (attempt < maxRetries) {
          // Aguardar antes da próxima tentativa (backoff exponencial)
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      break;
    }
  }
  
  throw lastError;
};
```

### **5. Monitoramento de Erros**

```javascript
// Monitoramento e tratamento de erros de conexão
let connectionErrors = 0;
let lastErrorTime = 0;

pool.on('error', (err) => {
  const now = Date.now();
  connectionErrors++;
  
  console.error(`❌ Erro na conexão com o banco de dados (${connectionErrors}):`, err.message);
  
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.message.includes('timeout')) {
    console.error('⚠️  Timeout de conexão detectado. Possíveis causas:');
    console.error('   - Latência de rede alta');
    console.error('   - Sobrecarga no servidor de banco');
    console.error('   - Firewall bloqueando conexões');
    console.error('   - Configuração de SSL inadequada');
    
    // Alerta se muitos erros em pouco tempo
    if (connectionErrors > 5 && (now - lastErrorTime) < 60000) {
      console.error('🚨 ALERTA: Muitos timeouts em sequência. Verificar conectividade de rede.');
    }
  }
  
  lastErrorTime = now;
});
```

### **6. Health Check Endpoint**

```javascript
/**
 * @route GET /financial/health
 * @desc Verificar saúde da conexão com o banco
 */
router.get('/health',
  asyncHandler(async (req, res) => {
    const health = await checkConnectionHealth();
    
    if (health.healthy) {
      successResponse(res, health, 'Conexão com banco de dados saudável');
    } else {
      errorResponse(res, 'Problemas na conexão com banco de dados', 503, 'DB_CONNECTION_ERROR', health);
    }
  })
);
```

### **7. Rota Contas-Pagar Otimizada**

```javascript
// Usar retry automático para queries que podem ter timeout
const [resultado, totalResult] = await Promise.all([
  executeQueryWithRetry(baseQuery, params),
  executeQueryWithRetry(countQuery, countParams)
]);
```

## 🛠️ Como Usar

### **1. Verificar Saúde da Conexão**
```bash
GET /api/financial/health
```

**Resposta de Sucesso:**
```json
{
  "success": true,
  "data": {
    "healthy": true,
    "responseTime": 45,
    "connectionCount": 5,
    "idleCount": 3,
    "waitingCount": 0
  },
  "message": "Conexão com banco de dados saudável"
}
```

**Resposta de Erro:**
```json
{
  "success": false,
  "error": "Problemas na conexão com banco de dados",
  "statusCode": 503,
  "errorCode": "DB_CONNECTION_ERROR",
  "details": {
    "healthy": false,
    "error": "read ETIMEDOUT",
    "connectionCount": 0,
    "idleCount": 0,
    "waitingCount": 0
  }
}
```

### **2. Queries com Retry Automático**
```javascript
// A rota contas-pagar agora usa automaticamente
const result = await executeQueryWithRetry(query, params);
```

## 📊 Benefícios das Soluções

| Aspecto | Antes | Depois | Melhoria |
|---------|-------|--------|----------|
| **Timeout de Conexão** | 2 minutos | 30 segundos | ✅ Mais responsivo |
| **Pool de Conexões** | 30 max | 20 max | ✅ Menos sobrecarga |
| **Retry Automático** | Não | Sim | ✅ Resiliência |
| **Monitoramento** | Básico | Avançado | ✅ Visibilidade |
| **Health Check** | Não | Sim | ✅ Diagnóstico |
| **Keep Alive** | 10s | 5s | ✅ Conexões mais ativas |

## 🔍 Diagnóstico de Problemas

### **1. Verificar Logs**
```bash
# Procurar por padrões de erro
grep "ETIMEDOUT" logs/app.log
grep "Timeout de conexão detectado" logs/app.log
grep "ALERTA: Muitos timeouts" logs/app.log
```

### **2. Testar Conectividade**
```bash
# Testar conexão direta com o banco
psql -h dbexp.vcenter.com.br -p 20187 -U crosby_ro -d crosby
```

### **3. Verificar Latência de Rede**
```bash
# Testar latência para o servidor
ping dbexp.vcenter.com.br
traceroute dbexp.vcenter.com.br
```

### **4. Monitorar Pool de Conexões**
```bash
# Verificar status via health check
curl http://localhost:3000/api/financial/health
```

## 🚀 Próximos Passos

### **Se o problema persistir:**

1. **Verificar infraestrutura de rede**
   - Latência entre aplicação e banco
   - Configuração de firewall
   - Qualidade da conexão

2. **Otimizar queries**
   - Adicionar índices no banco
   - Revisar queries complexas
   - Implementar cache

3. **Configuração de SSL**
   - Verificar certificados
   - Ajustar configuração SSL
   - Testar sem SSL (se possível)

4. **Monitoramento contínuo**
   - Implementar alertas
   - Dashboard de métricas
   - Logs estruturados

---

**🎯 Resultado**: Sistema agora é mais resiliente a timeouts com retry automático, monitoramento avançado e configurações otimizadas! 