# Sistema de Atualização Automática de Views Materializadas

## 📋 Visão Geral

Este sistema atualiza automaticamente as views materializadas do banco de dados PostgreSQL a cada hora, sempre aos **5 minutos** de cada hora (00:05, 01:05, 02:05, ..., 23:05).

## 🎯 Views Materializadas Gerenciadas

O sistema atualiza as seguintes 10 views materializadas:

1. `public.fatbazar`
2. `public.fatvarejo`
3. `public.fatrevenda`
4. `public.fatfranquias`
5. `public.fatmtm`
6. `public.fatsellect`
7. `public.cmv_varejo`
8. `public.cmv_revenda`
9. `public.cmv_mtm`
10. `public.cmv_franquias`

## ⏰ Horários de Execução Automática

O sistema executa a atualização nos seguintes horários (timezone America/Sao_Paulo - Brasília):

```
00:05  |  06:05  |  12:05  |  18:05
01:05  |  07:05  |  13:05  |  19:05
02:05  |  08:05  |  14:05  |  20:05
03:05  |  09:05  |  15:05  |  21:05
04:05  |  10:05  |  16:05  |  22:05
05:05  |  11:05  |  17:05  |  23:05
```

## 🚀 Como Funciona

### Inicialização Automática

O scheduler é iniciado automaticamente quando a aplicação é iniciada, após a conexão bem-sucedida com o banco de dados. Você verá no console:

```
⏰ ========================================
⏰ Scheduler de views materializadas INICIADO
⏰ Agendamento: A cada hora aos 5 minutos
⏰ Timezone: America/Sao_Paulo (Brasília)
⏰ Próxima execução agendada para: [data/hora]
⏰ ========================================
```

### Execução Automática

A cada hora, aos 5 minutos, o sistema:

1. **Registra o início** da atualização com timestamp
2. **Atualiza cada view** sequencialmente
3. **Registra o tempo** de cada atualização
4. **Conta sucessos e falhas**
5. **Gera relatório** final com estatísticas

### Logs de Execução

Durante a execução, você verá logs detalhados:

```
⏰ ========================================
⏰ Trigger de atualização automática: 22/10/2025, 10:05:00
⏰ ========================================
🚀 Iniciando atualização de 10 views materializadas
🔄 Iniciando atualização da view: public.fatbazar
✅ View public.fatbazar atualizada com sucesso em 2.45s
...
📊 ========================================
📊 Atualização concluída em 25.32s
📊 Sucesso: 10/10
📊 Falhas: 0/10
📊 ========================================
```

## 🔧 API de Atualização Manual

### Endpoint

```
POST /api/utils/refresh-materialized-views
```

### Descrição

Permite atualizar manualmente todas as views materializadas sem esperar pelo agendamento automático.

### Exemplo de Requisição

```bash
curl -X POST http://localhost:4000/api/utils/refresh-materialized-views
```

### Exemplo de Resposta (Sucesso)

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
      {
        "name": "public.fatbazar",
        "success": true
      },
      {
        "name": "public.fatvarejo",
        "success": true
      },
      ...
    ]
  }
}
```

### Exemplo de Resposta (Com Falhas)

```json
{
  "success": true,
  "message": "Views materializadas atualizadas com sucesso em 28.45s",
  "data": {
    "total": 10,
    "success": 8,
    "failed": 2,
    "duration": "28.45s",
    "timestamp": "2025-10-22T13:45:30.123Z",
    "views": [
      {
        "name": "public.fatbazar",
        "success": true
      },
      {
        "name": "public.fatvarejo",
        "success": false
      },
      ...
    ]
  }
}
```

## 📁 Arquivos do Sistema

### `utils/refreshMaterializedViews.js`

Módulo principal que contém:

- **`refreshView(viewName)`**: Atualiza uma view específica
- **`refreshAllMaterializedViews()`**: Atualiza todas as views
- **`startMaterializedViewsScheduler()`**: Inicia o agendamento automático
- **`stopMaterializedViewsScheduler(task)`**: Para o agendamento

### `index.js`

Integração com o servidor:

- Importa o módulo de atualização
- Inicia o scheduler após conexão com banco
- Para o scheduler no graceful shutdown

### `routes/utils.routes.js`

Rota de API para atualização manual:

- **POST** `/api/utils/refresh-materialized-views`

## 🛠️ Configuração

### Dependências

O sistema utiliza o pacote `node-cron`:

```bash
npm install node-cron
```

### Timezone

O sistema está configurado para o timezone **America/Sao_Paulo (Brasília)**. Para alterar, modifique a opção `timezone` em `startMaterializedViewsScheduler()`:

```javascript
const task = cron.schedule(cronExpression, async () => {
  // ...
}, {
  scheduled: true,
  timezone: 'America/Sao_Paulo' // Altere aqui
});
```

### Horário de Execução

Para alterar o horário de execução, modifique a expressão cron em `refreshMaterializedViews.js`:

```javascript
// Atual: aos 5 minutos de cada hora
const cronExpression = '5 * * * *';

// Exemplos de outras configurações:
// A cada 2 horas aos 10 minutos: '10 */2 * * *'
// A cada 30 minutos: '*/30 * * * *'
// Às 8h e 20h: '0 8,20 * * *'
```

### Formato da Expressão Cron

```
┌────────────── minuto (0 - 59)
│ ┌──────────── hora (0 - 23)
│ │ ┌────────── dia do mês (1 - 31)
│ │ │ ┌──────── mês (1 - 12)
│ │ │ │ ┌────── dia da semana (0 - 7, onde 0 e 7 = domingo)
│ │ │ │ │
* * * * *
```

## 🔍 Monitoramento

### Verificar Status

1. **Logs do Servidor**: Acompanhe os logs do console
2. **Health Check**: Use `GET /api/utils/health` para verificar status da aplicação
3. **Atualização Manual**: Use `POST /api/utils/refresh-materialized-views` para testar

### Solução de Problemas

#### View não está sendo atualizada

1. Verifique se a view existe no banco de dados
2. Verifique as permissões do usuário do banco
3. Verifique os logs de erro no console

#### Timeout nas atualizações

- O sistema está configurado sem timeouts
- Se houver problemas de performance, considere:
  - Otimizar as queries das views materializadas
  - Aumentar recursos do servidor de banco de dados
  - Atualizar views em horários de menor carga

#### Scheduler não está executando

1. Verifique se o servidor foi iniciado corretamente
2. Verifique se houve conexão com o banco de dados
3. Verifique os logs de inicialização

## 📊 Performance

### Tempo de Execução Esperado

O tempo total depende da complexidade e volume de dados de cada view. Típicamente:

- Views simples: 1-5 segundos
- Views complexas: 10-30 segundos
- Total (10 views): 20-60 segundos

### Impacto no Banco de Dados

Durante a atualização:

- ✅ Leituras não são bloqueadas (CONCURRENTLY não usado por padrão)
- ⚠️ A view pode ficar temporariamente indisponível durante refresh
- 📝 Considere usar `REFRESH MATERIALIZED VIEW CONCURRENTLY` se necessário

Para usar atualização concorrente (requer índice único):

```javascript
await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`);
```

## 🚦 Inicialização Opcional Imediata

Se quiser executar a primeira atualização logo após iniciar o servidor, descomente no `index.js`:

```javascript
// Executar a primeira atualização imediatamente (opcional)
setTimeout(async () => {
  logger.info('🔄 Executando primeira atualização das views materializadas...');
  await refreshAllMaterializedViews();
}, 5000); // Aguarda 5 segundos após inicialização
```

## 📝 Notas Importantes

1. **Graceful Shutdown**: O scheduler é parado automaticamente quando a aplicação é encerrada
2. **Timezone**: Certifique-se de que o timezone está correto para sua localização
3. **Permissões**: O usuário do banco precisa ter permissão para `REFRESH MATERIALIZED VIEW`
4. **Logs**: Todos os logs são registrados via `logger` do sistema

## 🔗 Referências

- [PostgreSQL Materialized Views](https://www.postgresql.org/docs/current/rules-materializedviews.html)
- [node-cron Documentation](https://github.com/node-cron/node-cron)
- [Cron Expression Generator](https://crontab.guru/)

---

**Desenvolvido para**: API de Gestão Crosby  
**Versão**: 2.0.0  
**Data**: Outubro 2025

