import { supabase } from './supabase'

// Funções genéricas para CRUD
export const supabaseCrud = {
  // CREATE - Inserir dados
  async create(table, data) {
    try {
      // Remove o campo id se estiver presente (para evitar erro de NOT NULL)
      const { id, ...dataWithoutId } = data;
      
      const { data: result, error } = await supabase
        .from(table)
        .insert(dataWithoutId)
        .select()
      
      if (error) throw error
      return { data: result, error: null }
    } catch (error) {
      console.error('Erro ao criar registro:', error)
      return { data: null, error }
    }
  },

  // READ - Buscar dados
  async read(table, options = {}) {
    try {
      let query = supabase.from(table).select(options.select || '*')
      
      // Aplicar filtros se fornecidos
      if (options.filters) {
        Object.entries(options.filters).forEach(([column, value]) => {
          query = query.eq(column, value)
        })
      }
      
      // Aplicar ordenação se fornecida
      if (options.orderBy) {
        query = query.order(options.orderBy.column, { 
          ascending: options.orderBy.ascending !== false 
        })
      }
      
      // Aplicar paginação se fornecida
      if (options.range) {
        query = query.range(options.range.from, options.range.to)
      }
      
      const { data, error } = await query
      
      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Erro ao buscar registros:', error)
      return { data: null, error }
    }
  },

  // READ BY ID - Buscar registro específico
  async readById(table, id) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('id', id)
        .single()
      
      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Erro ao buscar registro por ID:', error)
      return { data: null, error }
    }
  },

  // UPDATE - Atualizar dados
  async update(table, id, updates) {
    try {
      // Remove o campo id dos dados de atualização (não deve ser atualizado)
      const { id: _, ...updatesWithoutId } = updates;
      
      const { data, error } = await supabase
        .from(table)
        .update(updatesWithoutId)
        .eq('id', id)
        .select()
      
      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Erro ao atualizar registro:', error)
      return { data: null, error }
    }
  },

  // DELETE - Deletar dados
  async delete(table, id) {
    try {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', id)
      
      if (error) throw error
      return { data: { success: true }, error: null }
    } catch (error) {
      console.error('Erro ao deletar registro:', error)
      return { data: null, error }
    }
  },

  // Real-time subscriptions
  subscribeToChanges(table, callback) {
    return supabase
      .channel(`${table}_changes`)
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: table }, 
        callback
      )
      .subscribe()
  }
}

// Funções específicas para tabelas comuns (você pode adicionar mais conforme necessário)
export const userCrud = {
  async createUser(userData) {
    return await supabaseCrud.create('users', userData)
  },

  async getUserById(id) {
    return await supabaseCrud.readById('users', id)
  },

  async updateUser(id, updates) {
    return await supabaseCrud.update('users', id, updates)
  },

  async deleteUser(id) {
    return await supabaseCrud.delete('users', id)
  },

  async getAllUsers() {
    return await supabaseCrud.read('users')
  }
}

export const transactionCrud = {
  async createTransaction(transactionData) {
    return await supabaseCrud.create('transactions', transactionData)
  },

  async getTransactionById(id) {
    return await supabaseCrud.readById('transactions', id)
  },

  async updateTransaction(id, updates) {
    return await supabaseCrud.update('transactions', id, updates)
  },

  async deleteTransaction(id) {
    return await supabaseCrud.delete('transactions', id)
  },

  async getTransactionsByDateRange(startDate, endDate) {
    return await supabaseCrud.read('transactions', {
      filters: {
        created_at: `gte.${startDate},lte.${endDate}`
      }
    })
  }
} 