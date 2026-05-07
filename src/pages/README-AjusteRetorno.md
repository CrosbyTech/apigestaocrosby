# Ajuste de Arquivo .RET

## 📄 Descrição

Página criada para ajustar arquivos de retorno bancário (.ret), permitindo modificar a sequência numérica dos registros de forma automatizada.

## 🎯 Objetivo

Facilitar o processo de ajuste de arquivos de retorno bancário antes da importação no ERP, alterando a sequência numérica dos campos que identificam cada registro.

## 🚀 Funcionalidades

### 1. Upload de Arquivo

- Suporta arquivos `.txt` e `.ret`
- Leitura automática do conteúdo
- Validação do formato do arquivo

### 2. Detecção Automática de Sequência

- Identifica automaticamente a sequência atual (ex: `012`, `015`)
- Reconhece o padrão `XXX000YYY` onde:
  - `XXX` = Prefixo de 3 dígitos (sequência)
  - `000` = Zeros fixos
  - `YYY` = Número sequencial (001, 002, 003...)

### 3. Ajuste de Sequência

- Input para definir a sequência correta
- Processamento em tempo real
- Substituição de todas as ocorrências no arquivo

### 4. Download do Arquivo Ajustado

- Gera arquivo com extensão `.ret`
- Mantém o nome original com sufixo `_ajustado`
- Preserva toda a estrutura do arquivo original

### 5. Preview do Resultado

- Visualização das primeiras linhas do arquivo ajustado
- Confirmação visual antes do download

## 📋 Como Usar

1. **Selecione o arquivo**: Clique em "Selecionar Arquivo" e escolha o arquivo `.txt` ou `.ret`

2. **Verifique a sequência atual**: A sequência será detectada automaticamente (ex: `012`)

3. **Defina a sequência correta**: Digite a nova sequência desejada (ex: `015`)

4. **Processe o ajuste**: Clique em "Processar Ajuste" para aplicar as mudanças

5. **Baixe o arquivo**: Clique em "Baixar Arquivo .RET" para obter o arquivo ajustado

6. **Limpar e recomeçar**: Use "Limpar Tudo" para processar um novo arquivo

## 🔍 Exemplo de Uso

### Antes do Ajuste

```
02RETORNO01COBRANCA... 012000001
1026270166400013... 012000002
1025905429800016... 012000003
```

### Após o Ajuste (012 → 015)

```
02RETORNO01COBRANCA... 015000001
1026270166400013... 015000002
1025905429800016... 015000003
```

## 🎨 Interface

- **Design limpo e intuitivo**: Interface moderna com Tailwind CSS
- **Feedback visual**: Mensagens de sucesso, erro e informação
- **Responsivo**: Funciona em diferentes tamanhos de tela
- **Instruções claras**: Guia passo a passo integrado

## 🔒 Permissões de Acesso

A página está disponível para os seguintes perfis:

- Owner (Proprietário)
- Admin (Administrador)
- Manager (Gerente)
- User (Usuário)

## 📍 Localização no Sistema

- **Menu**: Financeiro → Ajuste de .RET
- **Rota**: `/ajuste-retorno`
- **Ícone**: 📄 (Roxo)

## ⚙️ Tecnologias Utilizadas

- **React**: Framework principal
- **Lucide Icons**: Ícones modernos
- **Tailwind CSS**: Estilização
- **FileReader API**: Leitura de arquivos
- **Blob API**: Download de arquivos

## 🔧 Manutenção

### Arquivo Principal

- **Componente**: `src/pages/AjusteRetorno.jsx`
- **Rota**: Configurada em `src/App.jsx`
- **Menu**: Configurado em `src/components/Sidebar.jsx`

### Validações Implementadas

- ✅ Validação de extensão de arquivo (.txt ou .ret)
- ✅ Validação de sequência (3 dígitos numéricos)
- ✅ Verificação de arquivo carregado antes do processamento
- ✅ Tratamento de erros de leitura

## 📝 Notas Técnicas

- A sequência deve ter exatamente 3 dígitos numéricos
- O padrão reconhecido é `XXX000YYY` (ex: `012000001`, `015000005`)
- O arquivo original não é modificado, apenas uma nova versão é gerada
- O processamento é feito no navegador (client-side), sem envio de dados ao servidor

## 🐛 Troubleshooting

**Problema**: Sequência não detectada automaticamente

- **Solução**: Digite manualmente a sequência atual e a correta

**Problema**: Arquivo não baixa

- **Solução**: Verifique se o processamento foi executado antes de tentar baixar

**Problema**: Formato não reconhecido

- **Solução**: Certifique-se de que o arquivo segue o padrão de retorno bancário

## 🔄 Próximas Melhorias Possíveis

- [ ] Validação de formato CNAB (240/400)
- [ ] Histórico de arquivos processados
- [ ] Comparação lado a lado (antes/depois)
- [ ] Suporte a múltiplos arquivos em lote
- [ ] Backup automático antes do ajuste
- [ ] Log de alterações realizadas

---

**Data de Criação**: 01/12/2025
**Versão**: 1.0.0
