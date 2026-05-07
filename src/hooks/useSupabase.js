import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { supabaseCrud } from '../lib/supabaseCrud'

// Hook para operações CRUD básicas
export const useSupabaseCrud = (table) => {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Buscar todos os registros
  const fetchData = async (options = {}) => {
    setLoading(true)
    setError(null)
    
    try {
      const { data: result, error: fetchError } = await supabaseCrud.read(table, options)
      
      if (fetchError) throw fetchError
      
      setData(result || [])
    } catch (err) {
      setError(err.message)
      console.error(`Erro ao buscar dados da tabela ${table}:`, err)
    } finally {
      setLoading(false)
    }
  }

  // Criar novo registro
  const createRecord = async (newData) => {
    setLoading(true)
    setError(null)
    
    try {
      const { data: result, error: createError } = await supabaseCrud.create(table, newData)
      
      if (createError) throw createError
      
      setData(prev => [...prev, ...result])
      return { success: true, data: result }
    } catch (err) {
      setError(err.message)
      console.error(`Erro ao criar registro na tabela ${table}:`, err)
      return { success: false, error: err.message }
    } finally {
      setLoading(false)
    }
  }

  // Atualizar registro
  const updateRecord = async (id, updates) => {
    setLoading(true)
    setError(null)
    
    try {
      const { data: result, error: updateError } = await supabaseCrud.update(table, id, updates)
      
      if (updateError) throw updateError
      
      setData(prev => prev.map(item => item.id === id ? { ...item, ...result[0] } : item))
      return { success: true, data: result }
    } catch (err) {
      setError(err.message)
      console.error(`Erro ao atualizar registro na tabela ${table}:`, err)
      return { success: false, error: err.message }
    } finally {
      setLoading(false)
    }
  }

  // Deletar registro
  const deleteRecord = async (id) => {
    setLoading(true)
    setError(null)
    
    try {
      const { error: deleteError } = await supabaseCrud.delete(table, id)
      
      if (deleteError) throw deleteError
      
      setData(prev => prev.filter(item => item.id !== id))
      return { success: true }
    } catch (err) {
      setError(err.message)
      console.error(`Erro ao deletar registro na tabela ${table}:`, err)
      return { success: false, error: err.message }
    } finally {
      setLoading(false)
    }
  }

  // Buscar registro por ID
  const fetchById = async (id) => {
    setLoading(true)
    setError(null)
    
    try {
      const { data: result, error: fetchError } = await supabaseCrud.readById(table, id)
      
      if (fetchError) throw fetchError
      
      return { success: true, data: result }
    } catch (err) {
      setError(err.message)
      console.error(`Erro ao buscar registro por ID na tabela ${table}:`, err)
      return { success: false, error: err.message }
    } finally {
      setLoading(false)
    }
  }

  return {
    data,
    loading,
    error,
    fetchData,
    createRecord,
    updateRecord,
    deleteRecord,
    fetchById
  }
}

// Hook para autenticação (DEPRECATED - usar AuthContext)
// export const useAuth = () => {
//   const [user, setUser] = useState(null)
//   const [loading, setLoading] = useState(true)

//   useEffect(() => {
//     // Verificar sessão atual
//     const getSession = async () => {
//       const { data: { session } } = await supabase.auth.getSession()
//       setUser(session?.user ?? null)
//       setLoading(false)
//     }

//     getSession()

//     // Escutar mudanças na autenticação
//     const { data: { subscription } } = supabase.auth.onAuthStateChange(
//       async (event, session) => {
//         setUser(session?.user ?? null)
//         setLoading(false)
//       }
//     )

//     return () => subscription.unsubscribe()
//   }, [])

//   const signIn = async (email, password) => {
//     const { data, error } = await supabase.auth.signInWithPassword({
//       email,
//       password
//     })
//     return { data, error }
//   }

//   const signUp = async (email, password) => {
//     const { data, error } = await supabase.auth.signUp({
//       email,
//       password
//     })
//     return { data, error }
//   }

//   const signOut = async () => {
//     const { error } = await supabase.auth.signOut()
//     return { error }
//   }

//   return {
//     user,
//     loading,
//     signIn,
//     signUp,
//     signOut
//   }
// }

// Hook para real-time subscriptions
export const useRealtimeSubscription = (table, callback) => {
  useEffect(() => {
    const subscription = supabaseCrud.subscribeToChanges(table, callback)
    
    return () => {
      subscription.unsubscribe()
    }
  }, [table, callback])
} 

export const useSupabase = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const executeQuery = useCallback(async (queryFn) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await queryFn();
      setData(result);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    data,
    loading,
    error,
    executeQuery,
    supabase
  };
}; 