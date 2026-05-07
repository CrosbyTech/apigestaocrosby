import { supabase, supabaseAdmin } from './supabase';
import { createUserProfile } from './userProfiles';

// Script para criar perfis padrão na tabela user_profiles
export const createDefaultProfiles = async () => {
  try {
    console.log('🔄 Criando perfis padrão...');

    const defaultProfiles = [
      {
        name: 'owner',
        label: 'Proprietário',
        color: '#4a59ff',
        description: 'Acesso proprietário',
        level: 1
      },
      {
        name: 'admin',
        label: 'Administrador',
        color: '#ff4747',
        description: 'Acesso total ao sistema',
        level: 2
      },
      {
        name: 'manager',
        label: 'Gerente',
        color: '#59b65e',
        description: 'Acesso a recursos de gestão',
        level: 3
      },
      {
        name: 'user',
        label: 'Usuário',
        color: '#f5b14c',
        description: 'Acesso básico ao sistema',
        level: 4
      },
      {
        name: 'guest',
        label: 'Convidado',
        color: '#757575',
        description: 'Acesso limitado para convidados',
        level: 5
      }
    ];

    const results = {
      success: [],
      errors: [],
      skipped: []
    };

    for (const profile of defaultProfiles) {
      try {
        console.log(`🔄 Criando perfil: ${profile.name}`);
        
        const result = await createUserProfile(profile);
        results.success.push({
          name: profile.name,
          action: 'created',
          id: result.id
        });
        
        console.log(`✅ Perfil ${profile.name} criado com sucesso`);
      } catch (error) {
        if (error.message.includes('duplicate key')) {
          console.log(`⚠️ Perfil ${profile.name} já existe, pulando...`);
          results.skipped.push({
            name: profile.name,
            reason: 'já existe'
          });
        } else {
          console.error(`❌ Erro ao criar perfil ${profile.name}:`, error);
          results.errors.push({
            name: profile.name,
            error: error.message
          });
        }
      }
    }

    console.log('\n📋 Relatório de Criação de Perfis:');
    console.log(`✅ Sucessos: ${results.success.length}`);
    console.log(`❌ Erros: ${results.errors.length}`);
    console.log(`⏭️ Pulados: ${results.skipped.length}`);

    return {
      success: true,
      results,
      summary: {
        total: defaultProfiles.length,
        success: results.success.length,
        errors: results.errors.length,
        skipped: results.skipped.length
      }
    };

  } catch (error) {
    console.error('❌ Erro na criação de perfis:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Script para migrar usuários da tabela user_profiles_antiga para auth.users
export const migrateUsersToAuth = async () => {
  try {
    console.log('🔄 Iniciando migração de usuários...');

    // 1. Primeiro, criar os perfis padrão
    console.log('📋 Criando perfis padrão primeiro...');
    const profilesResult = await createDefaultProfiles();
    if (!profilesResult.success) {
      console.warn('⚠️ Erro ao criar perfis padrão, mas continuando...');
    }

    // 2. Buscar todos os usuários da tabela antiga
    const { data: oldUsers, error: fetchError } = await supabaseAdmin
      .from('user_profiles_antiga')
      .select('*')
      .eq('active', true);

    if (fetchError) {
      throw new Error(`Erro ao buscar usuários: ${fetchError.message}`);
    }

    console.log(`📊 Encontrados ${oldUsers.length} usuários para migrar`);

    const results = {
      success: [],
      errors: [],
      skipped: []
    };

    // 3. Migrar cada usuário
    for (const oldUser of oldUsers) {
      try {
        console.log(`🔄 Migrando usuário: ${oldUser.email}`);

        // Verificar se o usuário já existe no auth.users
        const { data: existingUser } = await supabaseAdmin.auth.admin.getUserByEmail(oldUser.email);

        if (existingUser.user) {
          console.log(`⚠️ Usuário ${oldUser.email} já existe no auth.users, atualizando metadata...`);
          
          // Atualizar metadata do usuário existente
          const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
            existingUser.user.id,
            {
              user_metadata: {
                name: oldUser.name,
                role: oldUser.role
              }
            }
          );

          if (updateError) {
            results.errors.push({
              email: oldUser.email,
              error: `Erro ao atualizar metadata: ${updateError.message}`
            });
          } else {
            results.success.push({
              email: oldUser.email,
              action: 'updated'
            });
          }
        } else {
          // Criar novo usuário no auth.users
          const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email: oldUser.email,
            password: oldUser.password || 'senha123', // Senha padrão se não existir
            email_confirm: true, // Confirmar email automaticamente
            user_metadata: {
              name: oldUser.name,
              role: oldUser.role
            }
          });

          if (createError) {
            results.errors.push({
              email: oldUser.email,
              error: `Erro ao criar usuário: ${createError.message}`
            });
          } else {
            results.success.push({
              email: oldUser.email,
              action: 'created',
              id: newUser.user.id
            });
          }
        }
      } catch (error) {
        console.error(`❌ Erro ao migrar usuário ${oldUser.email}:`, error);
        results.errors.push({
          email: oldUser.email,
          error: error.message
        });
      }
    }

    // 4. Relatório final
    console.log('\n📋 Relatório de Migração:');
    console.log(`✅ Sucessos: ${results.success.length}`);
    console.log(`❌ Erros: ${results.errors.length}`);
    console.log(`⏭️ Pulados: ${results.skipped.length}`);

    if (results.errors.length > 0) {
      console.log('\n❌ Erros detalhados:');
      results.errors.forEach(error => {
        console.log(`  - ${error.email}: ${error.error}`);
      });
    }

    return {
      success: true,
      results,
      profilesResult,
      summary: {
        total: oldUsers.length,
        success: results.success.length,
        errors: results.errors.length,
        skipped: results.skipped.length
      }
    };

  } catch (error) {
    console.error('❌ Erro na migração:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Função para criar um usuário de teste no auth.users
export const createTestUser = async (email, password, name, role = 'admin') => {
  try {
    console.log(`🔄 Criando usuário de teste: ${email}`);

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
        role
      }
    });

    if (error) {
      throw error;
    }

    console.log('✅ Usuário criado com sucesso:', data.user.id);
    return {
      success: true,
      user: data.user
    };

  } catch (error) {
    console.error('❌ Erro ao criar usuário:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Função para listar todos os usuários do auth.users
export const listAuthUsers = async () => {
  try {
    console.log('📋 Listando usuários do auth.users...');

    const { data, error } = await supabaseAdmin.auth.admin.listUsers();

    if (error) {
      throw error;
    }

    console.log(`✅ Encontrados ${data.users.length} usuários:`);
    data.users.forEach(user => {
      console.log(`  - ${user.email} (${user.user_metadata?.role || 'sem role'})`);
    });

    return {
      success: true,
      users: data.users
    };

  } catch (error) {
    console.error('❌ Erro ao listar usuários:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Função para deletar um usuário do auth.users
export const deleteAuthUser = async (userId) => {
  try {
    console.log(`🗑️ Deletando usuário: ${userId}`);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (error) {
      throw error;
    }

    console.log('✅ Usuário deletado com sucesso');
    return {
      success: true
    };

  } catch (error) {
    console.error('❌ Erro ao deletar usuário:', error);
    return {
      success: false,
      error: error.message
    };
  }
};
