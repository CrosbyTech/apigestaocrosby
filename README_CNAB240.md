# Suporte ao Formato CNAB240

## ✅ Atualização Implementada

O sistema agora suporta **três formatos** de arquivo de retorno bancário:

1. **CNAB400** (400 caracteres por linha) - Formato tradicional
2. **CNAB240** (240 caracteres por linha) - Formato mais moderno
3. **Arquivos Genéricos** - Qualquer formato de texto

## 🔍 Detecção Automática

O parser detecta automaticamente o formato do arquivo baseado no tamanho da primeira linha:

- **≥ 400 caracteres**: Processado como CNAB400
- **≥ 240 caracteres**: Processado como CNAB240  
- **< 240 caracteres**: Processado como arquivo genérico

## 📋 Estrutura CNAB240

### Header (Primeira Linha)
- **Posições 0-3**: Código do banco
- **Posições 72-102**: Nome da empresa
- **Posições 102-132**: Nome do banco
- **Posições 143-151**: Data de geração
- **Posições 151-157**: Hora de geração

### Transações (Linhas do Meio)
- **Posições 0-1**: Tipo de registro
- **Posições 43-73**: Nome do favorecido
- **Posições 73-93**: Número do documento
- **Posições 93-101**: Data do pagamento
- **Posições 9-25**: Valor do pagamento
- **Posições 255-257**: Código da ocorrência

### Trailer (Última Linha)
- **Posições 17-23**: Total de registros
- **Posições 23-41**: Total de créditos
- **Posições 41-59**: Total de débitos
- **Posições 59-77**: Saldo

## 🚀 Como Usar

### 1. Upload via API
```bash
POST https://apigestaocrosby-bw2v.onrender.com/api/financial/upload-retorno
```

### 2. Upload via Interface Web
Use o arquivo `test-upload.html` para testar o upload.

### 3. Formato da Resposta
```json
{
  "success": true,
  "message": "Arquivo de retorno processado com sucesso",
  "data": {
    "arquivo": {
      "nome": "Nome da Empresa",
      "banco": "Nome do Banco",
      "dataGeracao": "2025-01-13",
      "horaGeracao": "14:30:00",
      "nomeOriginal": "arquivo.RET",
      "tamanho": 1234,
      "dataUpload": "2025-01-13T18:03:16.192Z"
    },
    "resumo": {
      "totalTransacoes": 10,
      "totalCreditos": 15000.00,
      "totalDebitos": 5000.00,
      "saldo": 10000.00
    },
    "transacoes": [
      {
        "nomeFavorecido": "João Silva",
        "valorPagamento": 1500.00,
        "dataPagamento": "2025-01-13",
        "numeroDocumento": "DOC001",
        "tipoOperacao": "C",
        "descricaoOcorrencia": "Pagamento efetuado"
      }
    ]
  }
}
```

## 🔧 Códigos de Ocorrência CNAB240

- **00**: Pagamento efetuado
- **01**: Pagamento não autorizado
- **02**: Pagamento não confirmado
- **03**: Erro no processamento
- **04**: Pagamento cancelado
- **05**: Pagamento em processamento
- **06**: Pagamento rejeitado
- **07**: Pagamento pendente
- **08**: Pagamento confirmado
- **09**: Pagamento parcial

## 📊 Logs de Processamento

O sistema agora exibe logs detalhados durante o processamento:

```
📄 Processando arquivo com 15 linhas
📏 Primeira linha tem 240 caracteres
🔍 Detectado formato CNAB240
```

## 🎯 Benefícios

1. **Compatibilidade**: Suporta tanto CNAB400 quanto CNAB240
2. **Detecção Automática**: Não precisa especificar o formato
3. **Processamento Robusto**: Trata erros graciosamente
4. **Logs Detalhados**: Facilita o debug
5. **Fallback Genérico**: Processa qualquer arquivo de texto

## 🔄 Próximos Passos

1. **Aguarde o deploy** no Render.com (automático após push)
2. **Teste o upload** com seu arquivo CNAB240
3. **Verifique os logs** no console do navegador
4. **Confirme os dados** processados

## 📞 Suporte

Se encontrar problemas:
1. Verifique se o arquivo tem extensão `.RET`
2. Confirme que o arquivo não está corrompido
3. Verifique os logs no console do navegador
4. Teste com um arquivo de exemplo válido
