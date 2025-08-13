# 📁 Sistema de Upload de Arquivos de Retorno Bancário

## Descrição
Sistema completo para processamento de arquivos de retorno bancário (.RET) do Itaú, convertendo dados CNAB400 para JSON estruturado.

## 🚀 Como Funcionar

### 1. Backend (API)
- **Rota:** `POST /api/financial/upload-retorno`
- **Porta:** 4000
- **URL completa:** `http://localhost:4000/api/financial/upload-retorno`

### 2. Frontend (Interface de Teste)
- Abra o arquivo `test-upload.html` no navegador
- Arraste e solte um arquivo .RET ou clique para selecionar
- Visualize os dados processados em formato JSON

## 📋 Estrutura do Sistema

### Arquivos Criados/Modificados:
1. **`utils/bankReturnParser.js`** - Parser principal para arquivos CNAB400
2. **`routes/financial.routes.js`** - Nova rota de upload
3. **`test-upload.html`** - Interface de teste
4. **`index.js`** - Documentação atualizada

### Dependências Adicionadas:
- `multer` - Para upload de arquivos

## 🔧 Configuração

### 1. Instalar Dependências
```bash
npm install multer
```

### 2. Iniciar o Servidor
```bash
npm start
# ou
node index.js
```

### 3. Testar o Sistema
1. Abra `test-upload.html` no navegador
2. Faça upload do arquivo `EXT_341_6530_27061_12082500.RET`
3. Visualize os dados processados

## 📊 Estrutura de Dados Retornada

### Resposta da API:
```json
{
  "success": true,
  "arquivo": {
    "nome": "CROSBY DIST CONFEC EIRELI ME",
    "banco": "BANCO ITAU S/A",
    "dataGeracao": "2025-08-12",
    "horaGeracao": "04:24:14",
    "versaoLayout": "040",
    "nomeOriginal": "EXT_341_6530_27061_12082500.RET",
    "tamanho": 12345,
    "dataUpload": "2025-01-27T10:30:00.000Z"
  },
  "resumo": {
    "totalTransacoes": 52,
    "totalCreditos": 150000.50,
    "totalDebitos": 50000.25,
    "saldo": 100000.25,
    "quantidadeLotes": 1,
    "quantidadeRegistros": 52
  },
  "transacoes": [
    {
      "codigoBanco": "341",
      "nomeFavorecido": "CROSBY DIST CONFEC EIRELI ME",
      "valorPagamento": 53261.72,
      "dataPagamento": "2025-08-08",
      "numeroDocumento": "DPBRL01238",
      "tipoOperacao": "D",
      "descricaoTipoOperacao": "Débito",
      "descricaoOcorrencia": "Pagamento efetuado"
    }
  ],
  "header": { /* dados do header */ },
  "trailer": { /* dados do trailer */ },
  "errors": []
}
```

## 🎯 Funcionalidades

### ✅ Implementadas:
- ✅ Upload de arquivos .RET
- ✅ Parser CNAB400 para Itaú
- ✅ Validação de arquivos
- ✅ Conversão para JSON estruturado
- ✅ Interface de teste com drag & drop
- ✅ Cálculo de totais (créditos/débitos)
- ✅ Tratamento de erros
- ✅ Limpeza automática de arquivos temporários

### 📋 Campos Processados:
- **Header:** Dados da empresa, banco, datas
- **Transações:** Valores, datas, favorecidos, documentos
- **Trailer:** Totais e contadores
- **Cálculos:** Saldos, totais de créditos/débitos

## 🔒 Segurança

- Validação de tipos de arquivo (.RET apenas)
- Limite de tamanho (10MB)
- Sanitização de entrada
- Limpeza automática de arquivos temporários
- Tratamento de erros robusto

## 🧪 Teste

### Arquivo de Teste Incluído:
- `EXT_341_6530_27061_12082500.RET` - Arquivo real do Itaú

### Como Testar:
1. Inicie o servidor: `npm start`
2. Abra `test-upload.html` no navegador
3. Faça upload do arquivo .RET
4. Verifique os dados processados

## 📝 Notas Técnicas

### Layout CNAB400 Itaú:
- **Header:** Linha 0 (registro tipo 0)
- **Transações:** Linhas 1-N (registro tipo 3)
- **Trailer:** Última linha (registro tipo 9)

### Codificação:
- Arquivos em ASCII
- Campos de valor em centavos
- Datas no formato DDMMAAAA
- Horas no formato HHMMSS

## 🚨 Limitações Atuais

- Suporte apenas para Itaú (código 341)
- Layout CNAB400 específico
- Processamento síncrono (para arquivos grandes)

## 🔄 Próximos Passos

- [ ] Suporte para outros bancos
- [ ] Processamento assíncrono
- [ ] Salvamento no banco de dados
- [ ] Interface administrativa
- [ ] Relatórios e exportação
