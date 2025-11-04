# 🔧 Configuração de Variáveis de Ambiente no Render

## ⚠️ Erro ECONNREFUSED no Render

Se você está vendo este erro no Render:
```
⚠️  Tentativa 13 falhou: connect ECONNREFUSED 186.251.27.57:20187
```

Isso significa que a aplicação **não consegue conectar ao banco de dados PostgreSQL**.

## 📋 Checklist de Diagnóstico

### 1. **Verificar Variáveis de Ambiente no Render**

No painel do Render, vá em **Environment** e verifique se estas variáveis estão configuradas:

```bash
PGHOST=dbexp.vcenter.com.br
PGPORT=20187
PGDATABASE=crosby
PGUSER=crosby_ro_geo
PGPASSWORD=fJioqw9I2@wqwc
NODE_ENV=production
```

### 2. **Verificar IP do Banco de Dados**

O IP `186.251.27.57` está correto? Verifique se:
- O servidor do banco está ligado
- O IP não mudou
- O hostname resolve corretamente

**Teste local:**
```bash
ping dbexp.vcenter.com.br
nslookup dbexp.vcenter.com.br
```

### 3. **Verificar Firewall**

O servidor do banco precisa **permitir conexões** do Render.

**IPs do Render que precisam ser liberados:**
- Render usa IPs dinâmicos
- Você pode precisar liberar um range de IPs
- Ou configurar o banco para aceitar conexões de qualquer origem (menos seguro)

**No PostgreSQL (pg_hba.conf):**
```
# Permitir conexões de qualquer IP (ajuste conforme necessário)
host    all             all             0.0.0.0/0               md5
```

**No firewall do servidor:**
```bash
# Liberar porta 20187 para conexões externas
sudo ufw allow 20187/tcp
```

### 4. **Verificar Configuração do PostgreSQL**

**No arquivo postgresql.conf:**
```
listen_addresses = '*'  # Aceitar conexões de qualquer IP
port = 20187
max_connections = 100   # Garantir que há conexões disponíveis
```

**Reiniciar PostgreSQL após mudanças:**
```bash
sudo systemctl restart postgresql
```

### 5. **Testar Conexão Manualmente**

**Do seu computador local:**
```bash
psql -h dbexp.vcenter.com.br -p 20187 -U crosby_ro_geo -d crosby
```

Se isso funcionar localmente mas não no Render, o problema é **firewall**.

**Usando telnet para testar porta:**
```bash
telnet dbexp.vcenter.com.br 20187
```

Se não conectar, a porta está fechada ou o serviço não está rodando.

## 🚀 Soluções Rápidas

### Solução 1: Usar DATABASE_URL

O Render prefere usar uma única variável `DATABASE_URL`:

```bash
# Formato
DATABASE_URL=postgresql://usuario:senha@host:porta/database

# Exemplo
DATABASE_URL=postgresql://crosby_ro_geo:fJioqw9I2@wqwc@dbexp.vcenter.com.br:20187/crosby
```

**Modificar `config/database.js` para usar DATABASE_URL:**
```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`,
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false,
});
```

### Solução 2: IP Fixo no Render

Se o banco está em uma rede privada, você pode precisar de:
- **VPN** entre Render e seu servidor
- **IP fixo** no Render (plano pago)
- **Túnel SSH** para conexão

### Solução 3: Usar Banco Gerenciado

Considere usar um banco gerenciado que já funciona com Render:
- Render PostgreSQL (nativo)
- Supabase (PostgreSQL gratuito)
- Neon (PostgreSQL serverless)
- Railway
- ElephantSQL

## 🔍 Logs para Verificar no Render

**No painel do Render, veja os logs de inicialização:**

✅ **Se estiver tudo certo, você verá:**
```
📊 Configuração do Banco de Dados:
   Host: dbexp.vcenter.com.br
   Port: 20187
   Database: crosby
   User: crosby_ro_geo
   Password: ***
   SSL: Habilitado

🔌 Testando conexão com banco de dados...
✅ Teste de conexão bem-sucedido!
   Tempo de resposta: 250ms
   Hora do servidor: 2025-11-04 15:30:00
   Versão PostgreSQL: PostgreSQL 15.3
```

❌ **Se houver erro, você verá o diagnóstico:**
```
❌ FALHA NO TESTE DE CONEXÃO

Erro: connect ECONNREFUSED 186.251.27.57:20187
Código: ECONNREFUSED

🔧 DIAGNÓSTICO:
   • O banco de dados não está respondendo na porta especificada
   • Verifique se o IP e porta estão corretos
   • Verifique se o firewall permite conexões
   • Verifique as variáveis de ambiente no Render
```

## 📞 Suporte

Se nada funcionar:

1. **Verifique com o administrador do banco:**
   - O banco está online?
   - O firewall está liberado?
   - Há limite de conexões?

2. **Teste a conexão do Render:**
   ```bash
   # Crie um script de teste no Render
   curl -v telnet://dbexp.vcenter.com.br:20187
   ```

3. **Verifique logs do PostgreSQL:**
   ```bash
   tail -f /var/log/postgresql/postgresql-*.log
   ```

## 🔐 Segurança

⚠️ **IMPORTANTE**: Não commite senhas no código!

Sempre use variáveis de ambiente:
```bash
# .env (local apenas - não commitar)
PGHOST=dbexp.vcenter.com.br
PGPORT=20187
PGDATABASE=crosby
PGUSER=crosby_ro_geo
PGPASSWORD=sua_senha_aqui
```

No Render, configure estas variáveis no painel **Environment**.

---

**Última atualização**: 04/11/2025
