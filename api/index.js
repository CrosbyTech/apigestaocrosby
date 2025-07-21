import express from 'express';
import axios from 'axios';
import cors from 'cors';
import pkg from 'pg';
const { Pool } = pkg;

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Mini banco de dados em memória
const users = [
  {
    id: 1,
    name: 'Administrador',
    email: 'admin',
    password: 'admin123', // Em produção, nunca armazene senhas em texto puro!
    role: 'ADM', // O ADM é o colaborador
    active: true,
  },
  {
    id: 2,
    name: 'Usuário Exemplo',
    email: 'user',
    password: 'user123',
    role: 'USER',
    active: true,
  },
];

const pool = new Pool({
  user: process.env.PGUSER || 'crosby_ro',
  host: process.env.PGHOST || 'dbexp.vcenter.com.br',
  database: process.env.PGDATABASE || 'crosby',
  password: process.env.PGPASSWORD || 'wKspo98IU2eswq',
  port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 20187,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export { pool };

// Autenticação simples
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email && u.password === password && u.active);
  if (!user) {
    return res.status(401).json({ message: 'Credenciais inválidas ou usuário inativo.' });
  }
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

// Listar todos os usuários (apenas ADM)
app.get('/users', (req, res) => {
  const { role } = req.query;
  if (role !== 'ADM') {
    return res.status(403).json({ message: 'Acesso restrito ao ADM.' });
  }
  res.json(users);
});

// Criar novo usuário (apenas ADM)
app.post('/users', (req, res) => {
  const { name, email, password, role, active, requesterRole } = req.body;
  if (requesterRole !== 'ADM') {
    return res.status(403).json({ message: 'Apenas o ADM pode criar usuários.' });
  }
  if (users.find(u => u.email === email)) {
    return res.status(400).json({ message: 'E-mail já cadastrado.' });
  }
  const newUser = {
    id: users.length + 1,
    name,
    email,
    password,
    role: role || 'USER',
    active: active !== undefined ? active : true,
  };
  users.push(newUser);
  res.status(201).json(newUser);
});

// Exemplo de uso do axios para consumir uma API externa (mock)
app.get('/external', async (req, res) => {
  try {
    const response = await axios.get('https://jsonplaceholder.typicode.com/todos/1');
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar dados externos.' });
  }
});

// Extrato financeiro - GET com filtros e paginação
app.get('/extrato', async (req, res) => {
  try {
    const { cd_empresa, nr_ctapes, dt_movim_ini, dt_movim_fim } = req.query;
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    let baseQuery = ` from fcc_extratbco fe where 1=1`;
    const params = [];
    let idx = 1;
    // ... restante do código ...
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar extrato.' });
  }
});

export default app; 