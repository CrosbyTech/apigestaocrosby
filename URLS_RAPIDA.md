# 🚀 URLs da API - Referência Rápida

## 🌐 Base URL
```
https://apigestaocrosby-bw2v.onrender.com
```

## 📋 Rotas Principais

### 💰 Financeiro
```
GET /api/financial/extrato
GET /api/financial/extrato-totvs  
GET /api/financial/contas-pagar
GET /api/financial/contas-receber
```

### 📈 Vendas
```
GET /api/sales/faturamento
GET /api/sales/faturamento-franquia
GET /api/sales/faturamento-mtm
GET /api/sales/faturamento-revenda
GET /api/sales/ranking-vendedores
```

### 🏢 Empresas
```
GET /api/company/empresas
GET /api/company/grupo-empresas
GET /api/company/faturamento-lojas
GET /api/company/expedicao
GET /api/company/pcp
```

### 🏪 Franquias
```
GET /api/franchise/consulta-fatura
GET /api/franchise/fundo-propaganda
GET /api/franchise/franquias-credev
```

### 🛠️ Utilitários
```
GET /api/utils/health
GET /api/utils/stats
GET /api/utils/autocomplete/nm_fantasia
GET /api/utils/autocomplete/nm_grupoempresa
```

## 📚 Documentação Completa
```
GET /api/docs
```

## 🔗 Exemplos de Uso

### Extrato com filtros:
```
https://apigestaocrosby-bw2v.onrender.com/api/financial/extrato?cd_empresa=850&dt_movim_ini=2025-01-01&dt_movim_fim=2025-01-31
```

### Faturamento geral:
```
https://apigestaocrosby-bw2v.onrender.com/api/sales/faturamento?cd_empresa=850&dt_inicio=2025-01-01&dt_fim=2025-01-31
```

### Lista de empresas:
```
https://apigestaocrosby-bw2v.onrender.com/api/company/empresas
```

### Health check:
```
https://apigestaocrosby-bw2v.onrender.com/api/utils/health
```