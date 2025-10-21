/**
 * Middleware de validação de parâmetros de entrada
 */

// Validar parâmetros obrigatórios
export const validateRequired = (requiredFields) => {
  return (req, res, next) => {
    const data = { ...req.body, ...req.query, ...req.params };
    const missingFields = [];

    requiredFields.forEach(field => {
      if (!data[field] || data[field] === '') {
        missingFields.push(field);
      }
    });

    if (missingFields.length > 0) {
      return res.status(400).json({
        message: 'Parâmetros obrigatórios não fornecidos',
        missingFields,
        error: 'VALIDATION_ERROR'
      });
    }

    next();
  };
};

// Validar formato de data (YYYY-MM-DD)
export const validateDateFormat = (dateFields) => {
  return (req, res, next) => {
    const data = { ...req.body, ...req.query };
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const invalidDates = [];

    dateFields.forEach(field => {
      if (data[field] && !dateRegex.test(data[field])) {
        invalidDates.push(field);
      }
    });

    if (invalidDates.length > 0) {
      return res.status(400).json({
        message: 'Formato de data inválido. Use YYYY-MM-DD',
        invalidFields: invalidDates,
        error: 'VALIDATION_ERROR'
      });
    }

    next();
  };
};

// Validar tipos de dados
export const validateTypes = (fieldTypes) => {
  return (req, res, next) => {
    const data = { ...req.body, ...req.query, ...req.params };
    const errors = [];

    Object.entries(fieldTypes).forEach(([field, type]) => {
      if (data[field] !== undefined) {
        switch (type) {
          case 'number':
            if (isNaN(Number(data[field]))) {
              errors.push(`${field} deve ser um número`);
            }
            break;
          case 'email':
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(data[field])) {
              errors.push(`${field} deve ser um email válido`);
            }
            break;
          case 'array':
            if (!Array.isArray(data[field]) && typeof data[field] === 'string') {
              // Tentar converter string separada por vírgula em array
              data[field] = data[field].split(',').map(item => item.trim());
            }
            break;
        }
      }
    });

    if (errors.length > 0) {
      return res.status(400).json({
        message: 'Erro de validação de tipos',
        errors,
        error: 'VALIDATION_ERROR'
      });
    }

    next();
  };
};

// Sanitizar entrada para prevenir SQL injection
export const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      // Remove caracteres perigosos para SQL
      return obj.replace(/[<>'"]/g, '');
    }
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    if (typeof obj === 'object' && obj !== null) {
      const sanitized = {};
      Object.keys(obj).forEach(key => {
        sanitized[key] = sanitize(obj[key]);
      });
      return sanitized;
    }
    return obj;
  };

  req.body = sanitize(req.body);
  req.query = sanitize(req.query);
  req.params = sanitize(req.params);

  next();
};

// Validar paginação
export const validatePagination = (req, res, next) => {
  const { limit, offset } = req.query;

  if (limit) {
    const limitNum = parseInt(limit, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100000000) {
      return res.status(400).json({
        message: 'Parâmetro limit deve ser um número entre 1 e 100000000',
        error: 'VALIDATION_ERROR'
      });
    }
  }

  if (offset) {
    const offsetNum = parseInt(offset, 10);
    if (isNaN(offsetNum) || offsetNum < 0) {
      return res.status(400).json({
        message: 'Parâmetro offset deve ser um número maior ou igual a 0',
        error: 'VALIDATION_ERROR'
      });
    }
  }

  next();
};