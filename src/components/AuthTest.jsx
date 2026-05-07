import React, { useState } from 'react';
import { migrateUsersToAuth, createTestUser, listAuthUsers, deleteAuthUser, createDefaultProfiles } from '../lib/migrateUsers';

const AuthTest = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    name: '',
    role: 'admin'
  });

  const handleCreateProfiles = async () => {
    setLoading(true);
    setResult(null);
    
    try {
      const profilesResult = await createDefaultProfiles();
      setResult(profilesResult);
    } catch (error) {
      setResult({
        success: false,
        error: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMigrateUsers = async () => {
    setLoading(true);
    setResult(null);
    
    try {
      const migrationResult = await migrateUsersToAuth();
      setResult(migrationResult);
    } catch (error) {
      setResult({
        success: false,
        error: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async () => {
    setLoading(true);
    setResult(null);
    
    try {
      const createResult = await createTestUser(
        newUser.email,
        newUser.password,
        newUser.name,
        newUser.role
      );
      setResult(createResult);
      
      if (createResult.success) {
        setNewUser({
          email: '',
          password: '',
          name: '',
          role: 'admin'
        });
      }
    } catch (error) {
      setResult({
        success: false,
        error: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleListUsers = async () => {
    setLoading(true);
    setResult(null);
    
    try {
      const listResult = await listAuthUsers();
      setResult(listResult);
    } catch (error) {
      setResult({
        success: false,
        error: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Teste de Autenticação - Auth.Users</h1>
      
      {/* Criar Perfis Padrão */}
      <div className="bg-white p-6 rounded-lg shadow-md mb-6">
        <h2 className="text-xl font-semibold mb-4">Criar Perfis Padrão</h2>
        <p className="text-gray-600 mb-4">
          Cria os perfis padrão (owner, admin, manager, user, guest) na tabela user_profiles
        </p>
        <button
          onClick={handleCreateProfiles}
          disabled={loading}
          className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? 'Criando...' : 'Criar Perfis Padrão'}
        </button>
      </div>

      {/* Migração de Usuários */}
      <div className="bg-white p-6 rounded-lg shadow-md mb-6">
        <h2 className="text-xl font-semibold mb-4">Migração de Usuários</h2>
        <p className="text-gray-600 mb-4">
          Migra usuários da tabela user_profiles_antiga para o sistema auth.users do Supabase
        </p>
        <button
          onClick={handleMigrateUsers}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Migrando...' : 'Migrar Usuários'}
        </button>
      </div>

      {/* Criar Novo Usuário */}
      <div className="bg-white p-6 rounded-lg shadow-md mb-6">
        <h2 className="text-xl font-semibold mb-4">Criar Novo Usuário</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <input
            type="email"
            placeholder="Email"
            value={newUser.email}
            onChange={(e) => setNewUser({...newUser, email: e.target.value})}
            className="border border-gray-300 rounded px-3 py-2"
          />
          <input
            type="password"
            placeholder="Senha"
            value={newUser.password}
            onChange={(e) => setNewUser({...newUser, password: e.target.value})}
            className="border border-gray-300 rounded px-3 py-2"
          />
          <input
            type="text"
            placeholder="Nome"
            value={newUser.name}
            onChange={(e) => setNewUser({...newUser, name: e.target.value})}
            className="border border-gray-300 rounded px-3 py-2"
          />
          <select
            value={newUser.role}
            onChange={(e) => setNewUser({...newUser, role: e.target.value})}
            className="border border-gray-300 rounded px-3 py-2"
          >
            <option value="owner">Proprietário</option>
            <option value="admin">Administrador</option>
            <option value="manager">Gerente</option>
            <option value="user">Usuário</option>
            <option value="guest">Convidado</option>
          </select>
        </div>
        <button
          onClick={handleCreateUser}
          disabled={loading || !newUser.email || !newUser.password || !newUser.name}
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? 'Criando...' : 'Criar Usuário'}
        </button>
      </div>

      {/* Listar Usuários */}
      <div className="bg-white p-6 rounded-lg shadow-md mb-6">
        <h2 className="text-xl font-semibold mb-4">Listar Usuários</h2>
        <button
          onClick={handleListUsers}
          disabled={loading}
          className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 disabled:opacity-50"
        >
          {loading ? 'Listando...' : 'Listar Usuários'}
        </button>
      </div>

      {/* Resultado */}
      {result && (
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">Resultado</h2>
          <div className={`p-4 rounded ${result.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {result.success ? (
              <div>
                <p className="font-semibold">✅ Sucesso!</p>
                {result.summary && (
                  <div className="mt-2">
                    <p>Total: {result.summary.total}</p>
                    <p>Sucessos: {result.summary.success}</p>
                    <p>Erros: {result.summary.errors}</p>
                    <p>Pulados: {result.summary.skipped}</p>
                  </div>
                )}
                {result.profilesResult && (
                  <div className="mt-2">
                    <p className="font-semibold">Perfis criados:</p>
                    <p>Total: {result.profilesResult.summary.total}</p>
                    <p>Sucessos: {result.profilesResult.summary.success}</p>
                    <p>Erros: {result.profilesResult.summary.errors}</p>
                    <p>Pulados: {result.profilesResult.summary.skipped}</p>
                  </div>
                )}
                {result.users && (
                  <div className="mt-2">
                    <p className="font-semibold">Usuários encontrados:</p>
                    <ul className="list-disc list-inside">
                      {result.users.map((user, index) => (
                        <li key={index}>
                          {user.email} ({user.user_metadata?.role || 'sem role'})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.user && (
                  <div className="mt-2">
                    <p>Usuário criado: {result.user.email}</p>
                    <p>ID: {result.user.id}</p>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <p className="font-semibold">❌ Erro!</p>
                <p>{result.error}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthTest;
