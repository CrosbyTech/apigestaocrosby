# Documentação - Sistema de Permissões Customizadas

## 📁 Estrutura criada

```
src/
├── services/
│   └── permissionsService.js    # Serviço de API para permissões
├── hooks/
│   └── usePermissions.js        # Hook customizado React
└── supabase/
    └── migrations/
        └── create_user_page_permissions.sql  # Migration do banco
```

## 🔧 Como usar o permissionsService

### Importar o serviço

```javascript
import * as permissionsService from '../services/permissionsService';
```

### Funções disponíveis

#### 1. `getAllUsers()`

Busca todos os usuários do sistema.

```javascript
const { data: users, error } = await permissionsService.getAllUsers();

// Retorno:
// users = [
//   { id: 'uuid', email: 'user@email.com', name: 'Nome', role: 'admin', created_at: '...' }
// ]
```

#### 2. `getUserPermissions(userId)`

Busca as páginas permitidas para um usuário.

```javascript
const { data: pages, error } = await permissionsService.getUserPermissions(
  userId,
);

// Retorno:
// pages = ['/home', '/dashboard-faturamento', '/contas-a-pagar']
```

#### 3. `saveUserPermissions(userId, pagePaths)`

Salva permissões de um usuário (remove antigas e cria novas).

```javascript
const pages = ['/home', '/dashboard-faturamento', '/contas-a-pagar'];
const { data: success, error } = await permissionsService.saveUserPermissions(
  userId,
  pages,
);
```

#### 4. `saveBulkPermissions(userIds, pagePaths)`

Salva as mesmas permissões para múltiplos usuários.

```javascript
const userIds = ['uuid1', 'uuid2', 'uuid3'];
const pages = ['/home', '/dashboard-faturamento'];
const { data: success, error } = await permissionsService.saveBulkPermissions(
  userIds,
  pages,
);
```

#### 5. `addUserPermission(userId, pagePath)`

Adiciona UMA permissão sem remover as existentes.

```javascript
const { data: success, error } = await permissionsService.addUserPermission(
  userId,
  '/nova-pagina',
);
```

#### 6. `removeUserPermission(userId, pagePath)`

Remove uma permissão específica.

```javascript
const { data: success, error } = await permissionsService.removeUserPermission(
  userId,
  '/dashboard-faturamento',
);
```

#### 7. `clearUserPermissions(userId)`

Remove todas as permissões de um usuário.

```javascript
const { data: success, error } = await permissionsService.clearUserPermissions(
  userId,
);
```

#### 8. `copyPermissions(fromUserId, toUserId)`

Copia permissões de um usuário para outro.

```javascript
const { data: success, error } = await permissionsService.copyPermissions(
  'user-origem-id',
  'user-destino-id',
);
```

#### 9. `getAllUsersWithPermissions()`

Busca todos os usuários já com suas permissões carregadas.

```javascript
const { data: users, error } =
  await permissionsService.getAllUsersWithPermissions();

// Retorno:
// users = [
//   {
//     id: 'uuid',
//     email: 'user@email.com',
//     name: 'Nome',
//     role: 'admin',
//     permissions: ['/home', '/dashboard'],
//     permissionsCount: 2
//   }
// ]
```

#### 10. `checkUserPermission(userId, pagePath)`

Verifica se um usuário tem permissão para uma página.

```javascript
const { data: hasPermission, error } =
  await permissionsService.checkUserPermission(
    userId,
    '/dashboard-faturamento',
  );

// hasPermission = true ou false
```

#### 11. `getPermissionsCountByPage()`

Conta quantos usuários têm acesso a cada página.

```javascript
const { data: counts, error } =
  await permissionsService.getPermissionsCountByPage();

// Retorno:
// counts = {
//   '/home': 5,
//   '/dashboard-faturamento': 3,
//   '/contas-a-pagar': 2
// }
```

---

## 🎣 Como usar o hook usePermissions

### Importar o hook

```javascript
import { usePermissions } from '../hooks/usePermissions';
```

### Exemplo de uso em um componente

```javascript
function GerenciadorAcessos() {
  const {
    loading,
    error,
    users,
    selectedUser,
    userPermissions,
    isOwner,
    loadUsersWithPermissions,
    selectUser,
    savePermissions,
    saveBulkPermissions,
  } = usePermissions();

  useEffect(() => {
    loadUsersWithPermissions();
  }, [loadUsersWithPermissions]);

  const handleSelectUser = async (user) => {
    await selectUser(user); // Carrega automaticamente as permissões
  };

  const handleSave = async () => {
    const pages = ['/home', '/dashboard-faturamento'];
    const result = await savePermissions(selectedUser.id, pages);

    if (result.success) {
      alert('Permissões salvas com sucesso!');
    } else {
      alert('Erro ao salvar: ' + result.error);
    }
  };

  if (!isOwner) {
    return <div>Acesso negado. Apenas owners podem gerenciar permissões.</div>;
  }

  return (
    <div>
      <h1>Gerenciador de Acessos</h1>

      {loading && <p>Carregando...</p>}
      {error && <p>Erro: {error}</p>}

      <ul>
        {users.map((user) => (
          <li key={user.id} onClick={() => handleSelectUser(user)}>
            {user.email} - {user.permissionsCount} páginas
          </li>
        ))}
      </ul>

      {selectedUser && (
        <div>
          <h2>Permissões de {selectedUser.email}</h2>
          <ul>
            {userPermissions.map((page) => (
              <li key={page}>{page}</li>
            ))}
          </ul>
          <button onClick={handleSave}>Salvar</button>
        </div>
      )}
    </div>
  );
}
```

### Estados disponíveis no hook

```javascript
{
  loading: boolean,              // Indica se está carregando
  error: string | null,          // Mensagem de erro
  users: Array,                  // Lista de usuários
  selectedUser: Object | null,   // Usuário selecionado
  userPermissions: Array,        // Permissões do usuário selecionado
  isOwner: boolean,              // Se o usuário atual é owner
}
```

### Funções disponíveis no hook

```javascript
{
  // Carregamento
  loadUsers(); // Carrega lista de usuários
  loadUsersWithPermissions(); // Carrega usuários com permissões
  loadUserPermissions(userId); // Carrega permissões de um usuário

  // Modificação
  savePermissions(userId, pages); // Salva permissões
  saveBulkPermissions(userIds, pages); // Salva em massa
  addPermission(userId, page); // Adiciona uma permissão
  removePermission(userId, page); // Remove uma permissão
  clearPermissions(userId); // Remove todas
  copyPermissions(fromId, toId); // Copia permissões

  // Verificação
  checkPermission(userId, page); // Verifica permissão
  getPermissionsCount(); // Conta por página

  // Seleção
  selectUser(user); // Seleciona e carrega permissões
  clearSelection(); // Limpa seleção

  // Estado
  setError(message); // Define erro manualmente
}
```

---

## 🧪 Testando as funções

### Teste rápido no Console do navegador

Abra o DevTools e execute:

```javascript
// Importar serviço (no contexto do React)
import * as permissionsService from './services/permissionsService';

// Teste 1: Buscar usuários
const { data: users } = await permissionsService.getAllUsers();
console.log('Usuários:', users);

// Teste 2: Buscar permissões de um usuário
const userId = users[0].id;
const { data: permissions } = await permissionsService.getUserPermissions(
  userId,
);
console.log('Permissões:', permissions);

// Teste 3: Salvar permissões
const pages = ['/home', '/dashboard-faturamento'];
await permissionsService.saveUserPermissions(userId, pages);

// Teste 4: Verificar se salvou
const { data: newPermissions } = await permissionsService.getUserPermissions(
  userId,
);
console.log('Novas permissões:', newPermissions);
```

---

## ⚠️ Importante

1. **Apenas owners podem gerenciar permissões** devido às políticas RLS no Supabase
2. **Todas as funções retornam** `{ data, error }` no padrão Supabase
3. **Use try/catch** ou verifique `error` para tratamento de erros
4. **Owner sempre tem acesso total** - verificação hardcoded no código

---

## 🔄 Próximos passos

Após implementar a Fase 1:

- ✅ Banco de dados criado
- ✅ Serviços de API criados
- ✅ Hook customizado criado

Próxima fase:

- [ ] Criar página de Gerenciador de Acessos
- [ ] Integrar com AuthContext
- [ ] Atualizar PrivateRoute
- [ ] Refatorar Sidebar
