# Sistema de Avisos - Controle de Permissões

## 📋 Visão Geral

O sistema de avisos possui dois níveis de acesso que podem ser gerenciados através do **Gerenciador de Acessos**:

## 🔐 Níveis de Permissão

### 1. **Visualizar Avisos** (NoticesModal)

- **Caminho Virtual**: `/visualizar-avisos`
- **Componentes**: NotificationBell, NoticesModal, LoginNoticesModal
- **Quem tem acesso**: TODOS os usuários autenticados automaticamente
- **Não requer permissão no Gerenciador de Acessos**
- **Funcionalidades**:
  - ✅ Ver sino de notificações no header
  - ✅ Ver badge com número de avisos não lidos
  - ✅ Abrir modal com lista de avisos
  - ✅ Marcar avisos como lidos
  - ✅ Ver modal automático ao fazer login

### 2. **Gerenciar Avisos** (GerenciadorAvisos)

- **Caminho Real**: `/gerenciador-avisos`
- **Componente**: GerenciadorAvisos
- **Quem tem acesso**: Usuários com permissão liberada no Gerenciador de Acessos
- **Funcionalidades**:
  - ✅ Criar novos avisos
  - ✅ Editar avisos existentes
  - ✅ Excluir avisos
  - ✅ Selecionar destinatários (por role ou individual)
  - ✅ Formatar texto (negrito, itálico, sublinhado, cores, links)
  - ✅ Ver estatísticas de leitura
  - ✅ Ver lista de avisos enviados
  - ✅ Ver detalhes de cada aviso

## 🎯 Como Liberar Acesso ao Gerenciador de Avisos

### Passo a Passo:

1. **Acesse o Gerenciador de Acessos**

   - Rota: `/gerenciador-acessos`
   - Requisito: Usuário com role `owner`

2. **Selecione o Usuário**

   - Busque pelo nome, email ou role
   - Selecione o usuário desejado

3. **Marque a Permissão**

   - Procure a categoria **"Avisos"**
   - Marque a página **"Gerenciador de Avisos"**

4. **Salve as Permissões**
   - Clique em "Salvar Permissões"

### Liberação em Massa:

Para liberar para vários usuários de uma vez:

1. Mude o modo para **"Em Massa"**
2. Selecione múltiplos usuários
3. Marque **"Gerenciador de Avisos"** na categoria Avisos
4. Clique em **"Salvar Permissões"**

## 📊 Categorias no Gerenciador de Acessos

As páginas de avisos estão organizadas na categoria **"Avisos"**:

```
📁 Avisos
  ├── Gerenciador de Avisos (/gerenciador-avisos)
  │   └── Criar, editar e gerenciar avisos
  │
  └── Visualizar Avisos (/visualizar-avisos)
      └── Ver avisos recebidos (não requer permissão)
```

## 🔄 Fluxo de Trabalho

### Para Usuários Comuns:

1. Usuário faz login → ✅ Acesso automático ao NoticesModal
2. Vê sino no header com badge de não lidos
3. Clica no sino → Abre modal com lista de avisos
4. Lê os avisos e marca como lido

### Para Gestores de Avisos:

1. Usuário com permissão acessa `/gerenciador-avisos`
2. Cria novo aviso com título e conteúdo formatado
3. Seleciona destinatários (roles ou usuários específicos)
4. Envia o aviso
5. Acompanha estatísticas de leitura

## 🎨 Estrutura de Arquivos

```
src/
├── components/
│   ├── NotificationBell.jsx        (Sino no header - todos)
│   ├── NoticesModal.jsx             (Modal de visualização - todos)
│   ├── LoginNoticesModal.jsx        (Modal ao login - todos)
│   ├── NoticeEditor.jsx             (Editor - gestores)
│   ├── NoticesList.jsx              (Lista admin - gestores)
│   └── NoticeDetailsModal.jsx       (Detalhes - gestores)
│
├── pages/
│   └── GerenciadorAvisos.jsx        (Página principal - gestores)
│
└── hooks/
    └── useNotices.js                (Hook com funções CRUD)
```

## 🔒 Validações de Segurança

### No Frontend:

- ✅ GerenciadorAvisos verifica autenticação do usuário
- ✅ Acesso controlado pelo sistema de rotas e permissões
- ✅ NoticesModal não requer validação extra (todos têm acesso)

### No Backend (Supabase):

- ✅ RLS (Row Level Security) nas tabelas
- ✅ Usuários só veem avisos destinados a eles
- ✅ Apenas criadores podem editar/deletar avisos
- ✅ Funções RPC protegidas com políticas

## 📝 Exemplos de Uso

### Liberar para um Gerente:

```
1. Gerenciador de Acessos
2. Buscar usuário: "gerente@crosby.com"
3. Categoria "Avisos" → "Gerenciador de Avisos" ✓
4. Salvar
```

### Liberar para Toda Equipe de Marketing:

```
1. Gerenciador de Acessos → Modo "Em Massa"
2. Filtrar por role: "manager"
3. "Marcar Todos"
4. Categoria "Avisos" → "Gerenciador de Avisos" ✓
5. Salvar Permissões
```

### Copiar Permissões:

```
1. "Copiar Permissões De" → Selecionar usuário modelo
2. Selecionar usuários destino
3. Clicar em "Copiar"
```

## 🚀 Benefícios do Sistema

✅ **Flexível**: Qualquer usuário pode receber permissão  
✅ **Seguro**: Controle granular de acesso  
✅ **Escalável**: Liberação em massa para times  
✅ **Rastreável**: Estatísticas de leitura completas  
✅ **Universal**: Todos veem notificações recebidas

## 📞 Suporte

Para dúvidas sobre permissões de avisos:

1. Consulte a documentação completa em `SISTEMA_AVISOS_README.md`
2. Verifique as políticas RLS no Supabase
3. Confira os logs do console para debug
