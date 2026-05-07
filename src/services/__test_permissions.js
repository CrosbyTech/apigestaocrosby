/**
 * ARQUIVO DE TESTE MANUAL - Sistema de Permissões
 *
 * Como usar:
 * 1. Execute a migration no Supabase primeiro
 * 2. Importe este arquivo em qualquer componente React
 * 3. Chame testPermissions() dentro de um useEffect ou botão
 * 4. Veja os resultados no console
 *
 * IMPORTANTE: Você precisa estar logado como OWNER para executar os testes
 */

import * as permissionsService from './permissionsService';

/**
 * Função principal de testes
 */
export const testPermissions = async () => {
  console.log('🧪 ======= INICIANDO TESTES DE PERMISSÕES =======\n');

  try {
    // =========================================
    // TESTE 1: Buscar todos os usuários
    // =========================================
    console.log('📋 TESTE 1: Buscar todos os usuários');
    const { data: users, error: usersError } =
      await permissionsService.getAllUsers();

    if (usersError) {
      console.error('❌ Erro ao buscar usuários:', usersError);
      return;
    }

    console.log(`✅ ${users.length} usuários encontrados:`);
    users.forEach((user) => {
      console.log(`  - ${user.email} (${user.role})`);
    });
    console.log('\n');

    // Usar o primeiro usuário que não é owner para testes
    const testUser = users.find((u) => u.role !== 'owner');

    if (!testUser) {
      console.warn('⚠️ Nenhum usuário não-owner encontrado para teste');
      return;
    }

    console.log(`🎯 Usando usuário de teste: ${testUser.email}\n`);

    // =========================================
    // TESTE 2: Buscar permissões do usuário
    // =========================================
    console.log('📋 TESTE 2: Buscar permissões do usuário');
    const { data: initialPermissions, error: permError1 } =
      await permissionsService.getUserPermissions(testUser.id);

    if (permError1) {
      console.error('❌ Erro ao buscar permissões:', permError1);
    } else {
      console.log(
        `✅ Permissões iniciais: ${initialPermissions.length} páginas`,
      );
      if (initialPermissions.length > 0) {
        initialPermissions.forEach((page) => console.log(`  - ${page}`));
      }
    }
    console.log('\n');

    // =========================================
    // TESTE 3: Adicionar permissões
    // =========================================
    console.log('📋 TESTE 3: Adicionar permissões');
    const testPages = [
      '/home',
      '/dashboard-faturamento',
      '/contas-a-pagar',
      '/contas-a-receber',
    ];

    const { data: saveSuccess, error: saveError } =
      await permissionsService.saveUserPermissions(testUser.id, testPages);

    if (saveError) {
      console.error('❌ Erro ao salvar permissões:', saveError);
    } else {
      console.log(`✅ ${testPages.length} permissões salvas com sucesso!`);
      testPages.forEach((page) => console.log(`  - ${page}`));
    }
    console.log('\n');

    // =========================================
    // TESTE 4: Verificar se permissões foram salvas
    // =========================================
    console.log('📋 TESTE 4: Verificar permissões salvas');
    const { data: savedPermissions, error: permError2 } =
      await permissionsService.getUserPermissions(testUser.id);

    if (permError2) {
      console.error('❌ Erro ao verificar permissões:', permError2);
    } else {
      console.log(
        `✅ Permissões verificadas: ${savedPermissions.length} páginas`,
      );
      savedPermissions.forEach((page) => console.log(`  - ${page}`));
    }
    console.log('\n');

    // =========================================
    // TESTE 5: Adicionar UMA permissão
    // =========================================
    console.log('📋 TESTE 5: Adicionar uma permissão extra');
    const { data: addSuccess, error: addError } =
      await permissionsService.addUserPermission(
        testUser.id,
        '/dashboard-varejo',
      );

    if (addError) {
      console.error('❌ Erro ao adicionar permissão:', addError);
    } else {
      console.log('✅ Permissão /dashboard-varejo adicionada!');
    }
    console.log('\n');

    // =========================================
    // TESTE 6: Verificar permissão específica
    // =========================================
    console.log('📋 TESTE 6: Verificar permissão específica');
    const { data: hasPermission, error: checkError } =
      await permissionsService.checkUserPermission(
        testUser.id,
        '/dashboard-varejo',
      );

    if (checkError) {
      console.error('❌ Erro ao verificar permissão:', checkError);
    } else {
      console.log(
        `✅ Tem permissão para /dashboard-varejo? ${
          hasPermission ? 'SIM' : 'NÃO'
        }`,
      );
    }
    console.log('\n');

    // =========================================
    // TESTE 7: Remover UMA permissão
    // =========================================
    console.log('📋 TESTE 7: Remover uma permissão');
    const { data: removeSuccess, error: removeError } =
      await permissionsService.removeUserPermission(
        testUser.id,
        '/contas-a-pagar',
      );

    if (removeError) {
      console.error('❌ Erro ao remover permissão:', removeError);
    } else {
      console.log('✅ Permissão /contas-a-pagar removida!');
    }
    console.log('\n');

    // =========================================
    // TESTE 8: Verificar permissões após remoção
    // =========================================
    console.log('📋 TESTE 8: Verificar após remoção');
    const { data: afterRemove, error: permError3 } =
      await permissionsService.getUserPermissions(testUser.id);

    if (permError3) {
      console.error('❌ Erro ao verificar permissões:', permError3);
    } else {
      console.log(`✅ Permissões após remoção: ${afterRemove.length} páginas`);
      afterRemove.forEach((page) => console.log(`  - ${page}`));
    }
    console.log('\n');

    // =========================================
    // TESTE 9: Contagem de permissões por página
    // =========================================
    console.log('📋 TESTE 9: Contagem de permissões por página');
    const { data: counts, error: countError } =
      await permissionsService.getPermissionsCountByPage();

    if (countError) {
      console.error('❌ Erro ao buscar contagens:', countError);
    } else {
      console.log('✅ Contagem por página:');
      Object.entries(counts).forEach(([page, count]) => {
        console.log(`  - ${page}: ${count} usuário(s)`);
      });
    }
    console.log('\n');

    // =========================================
    // TESTE 10: Copiar permissões (se houver outro usuário)
    // =========================================
    if (users.length > 1) {
      const targetUser = users.find(
        (u) => u.id !== testUser.id && u.role !== 'owner',
      );

      if (targetUser) {
        console.log('📋 TESTE 10: Copiar permissões entre usuários');
        const { data: copySuccess, error: copyError } =
          await permissionsService.copyPermissions(testUser.id, targetUser.id);

        if (copyError) {
          console.error('❌ Erro ao copiar permissões:', copyError);
        } else {
          console.log(
            `✅ Permissões copiadas de ${testUser.email} para ${targetUser.email}`,
          );

          // Verificar
          const { data: copiedPerms } =
            await permissionsService.getUserPermissions(targetUser.id);
          console.log(`  ${copiedPerms.length} páginas copiadas`);
        }
        console.log('\n');
      }
    }

    // =========================================
    // TESTE 11: Teste em massa (se houver múltiplos usuários)
    // =========================================
    const nonOwnerUsers = users.filter((u) => u.role !== 'owner');
    if (nonOwnerUsers.length >= 2) {
      console.log('📋 TESTE 11: Salvar permissões em massa');
      const userIds = nonOwnerUsers.slice(0, 2).map((u) => u.id);
      const bulkPages = ['/home', '/crosby-bot', '/ranking-faturamento'];

      const { data: bulkSuccess, error: bulkError } =
        await permissionsService.saveBulkPermissions(userIds, bulkPages);

      if (bulkError) {
        console.error('❌ Erro ao salvar em massa:', bulkError);
      } else {
        console.log(
          `✅ Permissões salvas em massa para ${userIds.length} usuários`,
        );
        bulkPages.forEach((page) => console.log(`  - ${page}`));
      }
      console.log('\n');
    }

    // =========================================
    // TESTE 12: Buscar usuários com permissões
    // =========================================
    console.log('📋 TESTE 12: Buscar todos os usuários com permissões');
    const { data: usersWithPerms, error: usersPermsError } =
      await permissionsService.getAllUsersWithPermissions();

    if (usersPermsError) {
      console.error(
        '❌ Erro ao buscar usuários com permissões:',
        usersPermsError,
      );
    } else {
      console.log(`✅ ${usersWithPerms.length} usuários com permissões:`);
      usersWithPerms.forEach((user) => {
        console.log(`  - ${user.email}: ${user.permissionsCount} página(s)`);
      });
    }
    console.log('\n');

    // =========================================
    // TESTE 13: Limpar permissões do usuário de teste
    // =========================================
    console.log('📋 TESTE 13: Limpar permissões do usuário de teste');
    const { data: clearSuccess, error: clearError } =
      await permissionsService.clearUserPermissions(testUser.id);

    if (clearError) {
      console.error('❌ Erro ao limpar permissões:', clearError);
    } else {
      console.log(`✅ Todas as permissões removidas de ${testUser.email}`);

      // Verificar
      const { data: finalPerms } = await permissionsService.getUserPermissions(
        testUser.id,
      );
      console.log(`  Permissões restantes: ${finalPerms.length}`);
    }
    console.log('\n');

    console.log('🎉 ======= TESTES CONCLUÍDOS COM SUCESSO! =======\n');
  } catch (error) {
    console.error('💥 ERRO GERAL NOS TESTES:', error);
  }
};

/**
 * Teste rápido - Apenas buscar usuários e suas permissões
 */
export const quickTest = async () => {
  console.log('🚀 TESTE RÁPIDO\n');

  const { data: users } = await permissionsService.getAllUsersWithPermissions();

  console.log('Usuários e suas permissões:');
  users?.forEach((user) => {
    console.log(`\n${user.email} (${user.role}):`);
    console.log(`  Total: ${user.permissionsCount} páginas`);
    if (user.permissions.length > 0) {
      user.permissions.forEach((page) => console.log(`  - ${page}`));
    }
  });
};

/**
 * Teste individual - Verificar um usuário específico
 */
export const testSpecificUser = async (userEmail) => {
  console.log(`🔍 Testando usuário: ${userEmail}\n`);

  const { data: users } = await permissionsService.getAllUsers();
  const user = users?.find((u) => u.email === userEmail);

  if (!user) {
    console.error('❌ Usuário não encontrado');
    return;
  }

  const { data: permissions } = await permissionsService.getUserPermissions(
    user.id,
  );

  console.log(`Usuário: ${user.email}`);
  console.log(`Role: ${user.role}`);
  console.log(`Permissões: ${permissions.length} páginas`);
  permissions.forEach((page) => console.log(`  - ${page}`));
};

// Exportar para uso no console do navegador
if (typeof window !== 'undefined') {
  window.testPermissions = testPermissions;
  window.quickTest = quickTest;
  window.testSpecificUser = testSpecificUser;
  console.log('✅ Funções de teste disponíveis no console:');
  console.log('  - testPermissions() - Executa todos os testes');
  console.log('  - quickTest() - Teste rápido');
  console.log(
    '  - testSpecificUser("email@exemplo.com") - Teste de usuário específico',
  );
}
