# 🌐 Guia de URLs para Frontend - API Gestão Crosby

## 📍 URL Base da API
```
https://apigestaocrosby-bw2v.onrender.com
```

## 📚 Documentação e Health Check

### 📖 Documentação Completa
```javascript
GET https://apigestaocrosby-bw2v.onrender.com/api/docs
```

### 🏥 Health Check
```javascript
GET https://apigestaocrosby-bw2v.onrender.com/api/utils/health
```

---

## 💰 ROTAS FINANCEIRAS

### 📊 Extrato Bancário
```javascript
// Básico
GET https://apigestaocrosby-bw2v.onrender.com/api/financial/extrato

// Com filtros
GET https://apigestaocrosby-bw2v.onrender.com/api/financial/extrato?cd_empresa=850&dt_movim_ini=2025-01-01&dt_movim_fim=2025-01-31&limit=50&offset=0

// Com múltiplas contas
GET https://apigestaocrosby-bw2v.onrender.com/api/financial/extrato?nr_ctapes=123,456,789&dt_movim_ini=2025-01-01&dt_movim_fim=2025-01-31
```

### 📋 Extrato TOTVS
```javascript
// Básico
GET https://apigestaocrosby-bw2v.onrender.com/api/financial/extrato-totvs

// Com filtros
GET https://apigestaocrosby-bw2v.onrender.com/api/financial/extrato-totvs?nr_ctapes=123&dt_movim_ini=2025-01-01&dt_movim_fim=2025-01-31&limit=100&offset=0
```

### 💸 Contas a Pagar
```javascript
// Obrigatório: dt_inicio, dt_fim, cd_empresa
GET https://apigestaocrosby-bw2v.onrender.com/api/financial/contas-pagar?dt_inicio=2025-01-01&dt_fim=2025-01-31&cd_empresa=850&limit=50&offset=0
```

### 💰 Contas a Receber
```javascript
// Obrigatório: dt_inicio, dt_fim, cd_empresa
GET https://apigestaocrosby-bw2v.onrender.com/api/financial/contas-receber?dt_inicio=2025-01-01&dt_fim=2025-01-31&cd_empresa=850&limit=50&offset=0
```

---

## 📈 ROTAS DE VENDAS

### 🛍️ Faturamento Geral
```javascript
// Obrigatório: cd_empresa
GET https://apigestaocrosby-bw2v.onrender.com/api/sales/faturamento?dt_inicio=2025-01-01&dt_fim=2025-01-31&cd_empresa=850

// Múltiplas empresas
GET https://apigestaocrosby-bw2v.onrender.com/api/sales/faturamento?dt_inicio=2025-01-01&dt_fim=2025-01-31&cd_empresa=850,851,852
```

### 🏪 Faturamento Franquia
```javascript
// Básico (filtra franquias F%CROSBY% automaticamente)
GET https://apigestaocrosby-bw2v.onrender.com/api/sales/faturamento-franquia?dt_inicio=2025-01-01&dt_fim=2025-01-31&cd_empresa=850

// Com nome fantasia específico
GET https://apigestaocrosby-bw2v.onrender.com/api/sales/faturamento-franquia?dt_inicio=2025-01-01&dt_fim=2025-01-31&cd_empresa=850&nm_fantasia=F%20CROSBY%20EXEMPLO
```

### 🏷️ Faturamento MTM (Marca Terceira Mesa)
```javascript
GET https://apigestaocrosby-bw2v.onrender.com/api/sales/faturamento-mtm?dt_inicio=2025-01-01&dt_fim=2025-01-31&cd_empresa=850
```

### 🔄 Faturamento Revenda
```javascript
GET https://apigestaocrosby-bw2v.onrender.com/api/sales/faturamento-revenda?dt_inicio=2025-01-01&dt_fim=2025-01-31&cd_empresa=850
```

### 🏆 Ranking de Vendedores
```javascript
// Obrigatório: inicio, fim
GET https://apigestaocrosby-bw2v.onrender.com/api/sales/ranking-vendedores?inicio=2025-01-01&fim=2025-01-31&limit=100&offset=0
```

---

## 🏢 ROTAS DE EMPRESAS

### 🏭 Lista de Empresas
```javascript
GET https://apigestaocrosby-bw2v.onrender.com/api/company/empresas
```

### 👥 Grupos de Empresas
```javascript
GET https://apigestaocrosby-bw2v.onrender.com/api/company/grupo-empresas
```

### 🏬 Faturamento por Lojas
```javascript
// Obrigatório: cd_grupoempresa_ini, cd_grupoempresa_fim, dt_inicio, dt_fim
GET https://apigestaocrosby-bw2v.onrender.com/api/company/faturamento-lojas?cd_grupoempresa_ini=1000&cd_grupoempresa_fim=2000&dt_inicio=2025-01-01&dt_fim=2025-01-31
```

### 📦 Expedição
```javascript
// Empresa 850, tabelas de preço 21 e 22
GET https://apigestaocrosby-bw2v.onrender.com/api/company/expedicao
```

### 🔧 PCP (Planejamento e Controle da Produção)
```javascript
// Empresa 111
GET https://apigestaocrosby-bw2v.onrender.com/api/company/pcp?limit=50&offset=0
```

---

## 🏪 ROTAS DE FRANQUIAS

### 📄 Consulta Faturas
```javascript
// Básico (filtra F%CROSBY% automaticamente)
GET https://apigestaocrosby-bw2v.onrender.com/api/franchise/consulta-fatura

// Com filtros específicos
GET https://apigestaocrosby-bw2v.onrender.com/api/franchise/consulta-fatura?dt_inicio=2025-01-01&dt_fim=2025-01-31&cd_empresa=850&cd_cliente=123

// Com nome fantasia específico
GET https://apigestaocrosby-bw2v.onrender.com/api/franchise/consulta-fatura?dt_inicio=2025-01-01&dt_fim=2025-01-31&nm_fantasia=F%20CROSBY%20EXEMPLO
```

### 📢 Fundo de Propaganda
```javascript
// Básico
GET https://apigestaocrosby-bw2v.onrender.com/api/franchise/fundo-propaganda

// Com filtros
GET https://apigestaocrosby-bw2v.onrender.com/api/franchise/fundo-propaganda?dt_inicio=2025-01-01&dt_fim=2025-01-31&cd_empresa=850
```

### 💳 Franquias Crédito/Débito
```javascript
// Básico (padrão: 2025-06-10)
GET https://apigestaocrosby-bw2v.onrender.com/api/franchise/franquias-credev

// Com período específico
GET https://apigestaocrosby-bw2v.onrender.com/api/franchise/franquias-credev?dt_inicio=2025-01-01&dt_fim=2025-01-31
```

---

## 🛠️ ROTAS UTILITÁRIAS

### 🔍 Autocomplete Nome Fantasia
```javascript
GET https://apigestaocrosby-bw2v.onrender.com/api/utils/autocomplete/nm_fantasia?q=CROSBY
```

### 🔍 Autocomplete Grupo Empresa
```javascript
GET https://apigestaocrosby-bw2v.onrender.com/api/utils/autocomplete/nm_grupoempresa?q=MATRIZ
```

### 📊 Estatísticas do Sistema
```javascript
GET https://apigestaocrosby-bw2v.onrender.com/api/utils/stats
```

### 🧪 Teste API Externa (apenas desenvolvimento)
```javascript
GET https://apigestaocrosby-bw2v.onrender.com/api/utils/external-test
```

---

## 🔗 ROTAS DE COMPATIBILIDADE (Versão Anterior)

```javascript
// Redirecionam automaticamente para as novas rotas
GET https://apigestaocrosby-bw2v.onrender.com/extrato        → /api/financial/extrato
GET https://apigestaocrosby-bw2v.onrender.com/faturamento    → /api/sales/faturamento
GET https://apigestaocrosby-bw2v.onrender.com/empresas       → /api/company/empresas
```

---

## 💻 EXEMPLOS PRÁTICOS PARA JAVASCRIPT/REACT

### 🔧 Configuração Base
```javascript
// config/api.js
const API_BASE_URL = 'https://apigestaocrosby-bw2v.onrender.com';

export const api = {
  baseURL: API_BASE_URL,
  
  // Helper para construir URLs
  buildURL: (endpoint, params = {}) => {
    const url = new URL(endpoint, API_BASE_URL);
    Object.keys(params).forEach(key => {
      if (params[key] !== null && params[key] !== undefined) {
        url.searchParams.append(key, params[key]);
      }
    });
    return url.toString();
  }
};
```

### 📊 Exemplo: Buscar Extrato
```javascript
// services/financialService.js
import { api } from '../config/api.js';

export const getExtrato = async (filters = {}) => {
  const url = api.buildURL('/api/financial/extrato', {
    cd_empresa: filters.empresa,
    dt_movim_ini: filters.dataInicio,
    dt_movim_fim: filters.dataFim,
    limit: filters.limit || 50,
    offset: filters.offset || 0
  });
  
  const response = await fetch(url);
  return response.json();
};

// Uso no componente React
const ExtratoComponent = () => {
  const [extrato, setExtrato] = useState([]);
  
  useEffect(() => {
    const fetchExtrato = async () => {
      const data = await getExtrato({
        empresa: '850',
        dataInicio: '2025-01-01',
        dataFim: '2025-01-31',
        limit: 100
      });
      setExtrato(data.data);
    };
    
    fetchExtrato();
  }, []);
  
  return (
    <div>
      {extrato.map(item => (
        <div key={item.id}>{item.ds_histbco}</div>
      ))}
    </div>
  );
};
```

### 📈 Exemplo: Buscar Faturamento
```javascript
// services/salesService.js
export const getFaturamento = async (empresas, dataInicio, dataFim) => {
  const empresasParam = Array.isArray(empresas) ? empresas.join(',') : empresas;
  
  const url = api.buildURL('/api/sales/faturamento', {
    cd_empresa: empresasParam,
    dt_inicio: dataInicio,
    dt_fim: dataFim
  });
  
  const response = await fetch(url);
  return response.json();
};

// Uso
const faturamento = await getFaturamento(['850', '851'], '2025-01-01', '2025-01-31');
```

### 🔍 Exemplo: Autocomplete
```javascript
// components/AutocompleteFantasia.jsx
import { useState, useEffect } from 'react';

const AutocompleteFantasia = ({ onSelect }) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  
  useEffect(() => {
    if (query.length > 0) {
      const fetchSuggestions = async () => {
        const url = api.buildURL('/api/utils/autocomplete/nm_fantasia', { q: query });
        const response = await fetch(url);
        const data = await response.json();
        setSuggestions(data.data || []);
      };
      
      const debounceTimer = setTimeout(fetchSuggestions, 300);
      return () => clearTimeout(debounceTimer);
    } else {
      setSuggestions([]);
    }
  }, [query]);
  
  return (
    <div>
      <input 
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Digite o nome da franquia..."
      />
      <ul>
        {suggestions.map((item, index) => (
          <li key={index} onClick={() => onSelect(item)}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
};
```

---

## 🎯 DICAS IMPORTANTES

### ✅ Boas Práticas
1. **Sempre use HTTPS** - a API já está configurada
2. **Implemente loading states** - algumas consultas podem demorar
3. **Use debounce** para autocomplete (300ms recomendado)
4. **Implemente paginação** para listas grandes
5. **Trate erros** adequadamente

### ⚠️ Limitações
- **Rate Limit**: 500 requisições por 15 minutos em produção
- **Timeout**: Requisições podem demorar em consultas grandes
- **CORS**: Já configurado para permitir requisições do frontend

### 🚀 Performance
- Use `limit` e `offset` para paginação
- Filtre por datas para reduzir dados
- Cache resultados quando possível

---

## 🔍 Testando as URLs

Você pode testar qualquer URL diretamente no navegador ou usar ferramentas como:
- **Postman**
- **Insomnia**
- **curl**
- **DevTools do navegador**

Exemplo de teste:
```bash
curl "https://apigestaocrosby-bw2v.onrender.com/api/utils/health"
```

---

**🎉 Sua API está rodando e pronta para uso!**

Todas as rotas são **públicas** e não requerem autenticação, pois o controle de acesso está sendo feito no frontend via Supabase.