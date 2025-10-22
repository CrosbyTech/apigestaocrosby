# 🚀 Guia Rápido - Atualização de Views Materializadas

## ✅ O que foi implementado?

Um sistema completo de atualização automática das suas 10 views materializadas, executando sempre aos **5 minutos de cada hora**.

## 📋 Checklist de Verificação

### 1️⃣ Instalação (✅ Concluído)

```bash
npm install node-cron
```

### 2️⃣ Arquivos Criados

- ✅ `utils/refreshMaterializedViews.js` - Sistema principal
- ✅ `test-refresh-views.html` - Interface de teste
- ✅ `MATERIALIZED_VIEWS_REFRESH.md` - Documentação completa
- ✅ `GUIA_RAPIDO_VIEWS.md` - Este guia

### 3️⃣ Arquivos Modificados

- ✅ `index.js` - Integração com servidor
- ✅ `routes/utils.routes.js` - Nova rota de API
- ✅ `README.md` - Documentação atualizada

## 🎯 Como Usar

### Iniciar o Servidor

```bash
npm start
```

Você verá no console:

```
⏰ ========================================
⏰ Scheduler de views materializadas INICIADO
⏰ Agendamento: A cada hora aos 5 minutos
⏰ Próxima execução agendada para: [data/hora]
⏰ ========================================
```

### Atualização Automática

O sistema executará automaticamente nos horários:

```
00:05  06:05  12:05  18:05
01:05  07:05  13:05  19:05
02:05  08:05  14:05  20:05
03:05  09:05  15:05  21:05
04:05  10:05  16:05  22:05
05:05  11:05  17:05  23:05
```

### Atualização Manual

#### Opção 1: Via Interface HTML

1. Abra `test-refresh-views.html` no navegador
2. Verifique se a URL está correta
3. Clique em "🚀 Atualizar Views Materializadas"
4. Aguarde a resposta (pode levar alguns minutos)

#### Opção 2: Via cURL

```bash
curl -X POST http://localhost:4000/api/utils/refresh-materialized-views
```

#### Opção 3: Via PowerShell

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:4000/api/utils/refresh-materialized-views"
```

#### Opção 4: Via JavaScript/Fetch

```javascript
fetch('http://localhost:4000/api/utils/refresh-materialized-views', {
  method: 'POST'
})
  .then(response => response.json())
  .then(data => console.log(data));
```

## 📊 Exemplo de Resposta

```json
{
  "success": true,
  "message": "Views materializadas atualizadas com sucesso em 25.32s",
  "data": {
    "total": 10,
    "success": 10,
    "failed": 0,
    "duration": "25.32s",
    "timestamp": "2025-10-22T13:45:30.123Z",
    "views": [
      { "name": "public.fatbazar", "success": true },
      { "name": "public.fatvarejo", "success": true },
      { "name": "public.fatrevenda", "success": true },
      { "name": "public.fatfranquias", "success": true },
      { "name": "public.fatmtm", "success": true },
      { "name": "public.fatsellect", "success": true },
      { "name": "public.cmv_varejo", "success": true },
      { "name": "public.cmv_revenda", "success": true },
      { "name": "public.cmv_mtm", "success": true },
      { "name": "public.cmv_franquias", "success": true }
    ]
  }
}
```

## 🔍 Monitoramento

### Ver Logs em Tempo Real

Os logs aparecem automaticamente no console do servidor:

```
🔄 Iniciando atualização da view: public.fatbazar
✅ View public.fatbazar atualizada com sucesso em 2.45s
```

### Verificar Status da API

```bash
# Health check
curl http://localhost:4000/api/utils/health

# Documentação
curl http://localhost:4000/api/docs
```

## ⚙️ Configurações Avançadas

### Mudar Horário de Execução

Edite `utils/refreshMaterializedViews.js`:

```javascript
// Linha 76 - Expressão cron atual
const cronExpression = '5 * * * *'; // Aos 5 minutos de cada hora

// Exemplos de alteração:
const cronExpression = '0 * * * *';      // No início de cada hora
const cronExpression = '30 * * * *';     // Aos 30 minutos de cada hora
const cronExpression = '0 */2 * * *';    // A cada 2 horas
const cronExpression = '0 8,20 * * *';   // Às 8h e 20h apenas
```

### Executar Imediatamente ao Iniciar

Descomente no `index.js` (linhas 272-275):

```javascript
setTimeout(async () => {
  logger.info('🔄 Executando primeira atualização das views materializadas...');
  await refreshAllMaterializedViews();
}, 5000);
```

### Adicionar Novas Views

Edite `utils/refreshMaterializedViews.js` (linha 6):

```javascript
const MATERIALIZED_VIEWS = [
  'public.fatbazar',
  'public.fatvarejo',
  // ... views existentes ...
  'public.sua_nova_view', // Adicione aqui
];
```

## 🐛 Solução de Problemas

### Problema: Scheduler não inicia

**Solução:** Verifique se o banco de dados conectou corretamente. O scheduler só inicia após conexão bem-sucedida.

### Problema: Views não atualizam

**Solução:** 
1. Verifique se as views existem no banco: `SELECT * FROM pg_matviews;`
2. Verifique permissões do usuário do banco
3. Consulte os logs de erro no console

### Problema: Timeout nas atualizações

**Solução:**
- O sistema já está configurado sem timeouts
- Se persistir, otimize as queries das views
- Considere usar `REFRESH MATERIALIZED VIEW CONCURRENTLY`

### Problema: Erro de conexão na API manual

**Solução:**
1. Verifique se o servidor está rodando: `GET /api/utils/health`
2. Verifique a porta (padrão: 4000)
3. Verifique CORS se chamar de outro domínio

## 📞 Endpoints Disponíveis

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/utils/refresh-materialized-views` | Atualiza todas as views manualmente |
| GET | `/api/utils/health` | Verifica status da aplicação |
| GET | `/api/utils/stats` | Estatísticas do sistema |
| GET | `/api/docs` | Documentação completa da API |

## 🎓 Recursos Adicionais

- 📖 **Documentação Completa**: `MATERIALIZED_VIEWS_REFRESH.md`
- 🧪 **Arquivo de Teste**: `test-refresh-views.html`
- 📚 **Documentação PostgreSQL**: https://www.postgresql.org/docs/current/rules-materializedviews.html
- ⏰ **Gerador de Expressões Cron**: https://crontab.guru/

## ✨ Recursos Implementados

- ✅ Atualização automática a cada hora aos 5 minutos
- ✅ Logs detalhados com duração de cada view
- ✅ API REST para atualização manual
- ✅ Interface HTML para testes
- ✅ Relatório de sucesso/falhas
- ✅ Graceful shutdown
- ✅ Timezone configurável (Brasília)
- ✅ Retry automático em caso de falha de conexão
- ✅ Sem timeouts

## 🚀 Próximos Passos

1. ✅ Inicie o servidor: `npm start`
2. ✅ Aguarde o log de inicialização do scheduler
3. ✅ Teste a atualização manual com `test-refresh-views.html`
4. ✅ Monitore os logs nas próximas execuções automáticas
5. ✅ Configure alertas se necessário (opcional)

---

**Desenvolvido para**: API de Gestão Crosby  
**Versão**: 2.0.0  
**Data**: Outubro 2025  
**Status**: ✅ Pronto para Produção

