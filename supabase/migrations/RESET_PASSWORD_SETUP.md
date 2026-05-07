# Configuração do Sistema de Redefinição de Senha

## 📋 Visão Geral

O sistema de redefinição de senha foi implementado com 3 etapas:

1. **Solicitação**: Usuário informa o email
2. **Verificação**: Usuário recebe e insere código de 6 dígitos
3. **Redefinição**: Usuário define nova senha

## ⚙️ Configuração no Supabase

### 1. Configurar Email Templates

Acesse o Supabase Dashboard:

1. Vá para **Authentication** → **Email Templates**
2. Selecione **Reset Password**
3. Configure o template com o seguinte conteúdo:

```html
<h2>Redefinir Senha - HeadCoach Crosby</h2>
<p>Você solicitou a redefinição de senha.</p>
<p>Seu código de verificação é:</p>
<h1 style="font-size: 32px; letter-spacing: 8px; font-family: monospace;">
  {{ .Token }}
</h1>
<p>Este código expira em 60 minutos.</p>
<p>Se você não solicitou esta redefinição, ignore este email.</p>
```

### 2. Configurar URL de Redirecionamento

No Dashboard do Supabase:

1. Vá para **Authentication** → **URL Configuration**
2. Adicione às **Redirect URLs**:
   - `http://localhost:5173/reset-password` (desenvolvimento)
   - `https://seudominio.com/reset-password` (produção)

### 3. Configurar Email Provider

#### Opção A: Usar Email Provider do Supabase (Padrão)

O Supabase oferece um serviço gratuito limitado:

- **Authentication** → **Providers** → **Email**
- Ative **Enable Email Provider**
- Configure **Enable Email Confirmations** se necessário

#### Opção B: Configurar SMTP Customizado (Recomendado para Produção)

1. Vá para **Project Settings** → **Auth** → **SMTP Settings**
2. Configure seu servidor SMTP:
   ```
   Host: smtp.gmail.com (ou outro)
   Port: 587
   Sender Email: noreply@crosbytech.com.br
   Sender Name: HeadCoach Crosby
   Username: seu-email@gmail.com
   Password: sua-senha-de-app
   ```

### 4. Configurações de Segurança

No **Authentication** → **Settings**:

```json
{
  "MAILER_AUTOCONFIRM": false,
  "MAILER_OTP_EXP": 3600,
  "PASSWORD_MIN_LENGTH": 6,
  "SECURITY_REFRESH_TOKEN_REUSE_INTERVAL": 10
}
```

## 🔐 Segurança Implementada

- ✅ Token OTP de 6 dígitos
- ✅ Expiração de 60 minutos
- ✅ Validação de senha mínima (6 caracteres)
- ✅ Confirmação de senha
- ✅ Proteção contra múltiplas tentativas
- ✅ Sessão segura após redefinição

## 🎨 Componentes Criados

### ForgotPasswordModal.jsx

Modal com 3 etapas:

- **Step 1**: Entrada de email
- **Step 2**: Verificação do código
- **Step 3**: Definição de nova senha

### LoginForm.jsx (Atualizado)

- Botão "Esqueceu a senha?" conectado ao modal
- Integração completa com o fluxo de recuperação

## 🚀 Como Usar

### Para o Usuário:

1. Clicar em "Esqueceu a senha?" na tela de login
2. Digitar o email cadastrado
3. Verificar o email e copiar o código de 6 dígitos
4. Inserir o código no modal
5. Definir nova senha
6. Fazer login com a nova senha

### Para o Desenvolvedor:

```jsx
import ForgotPasswordModal from './components/ForgotPasswordModal';

// No componente
const [showModal, setShowModal] = useState(false);

<ForgotPasswordModal isOpen={showModal} onClose={() => setShowModal(false)} />;
```

## 🧪 Testando o Sistema

### 1. Teste Local

```bash
npm run dev
```

### 2. Fluxo de Teste

- [ ] Abrir página de login
- [ ] Clicar em "Esqueceu a senha?"
- [ ] Digitar email válido
- [ ] Verificar recebimento do email
- [ ] Inserir código de 6 dígitos
- [ ] Definir nova senha
- [ ] Fazer login com nova senha

### 3. Verificar Logs

```javascript
// Console do navegador mostrará:
// - Solicitação de reset
// - Verificação de token
// - Atualização de senha
```

## 📧 Configuração Gmail (SMTP)

Se estiver usando Gmail como SMTP:

1. Ativar autenticação de 2 fatores na conta Google
2. Gerar senha de app:
   - Ir em https://myaccount.google.com/security
   - Senhas de app → Gerar nova senha
   - Usar essa senha no SMTP do Supabase

## 🐛 Troubleshooting

### Email não chega

- Verificar configuração SMTP
- Checar pasta de spam
- Confirmar que o email está cadastrado no sistema

### Código inválido

- Verificar se o código foi digitado corretamente
- Confirmar se não expirou (60 minutos)
- Solicitar novo código

### Erro ao redefinir senha

- Verificar se as senhas coincidem
- Confirmar senha mínima de 6 caracteres
- Verificar sessão do Supabase

## 📱 Responsividade

O modal é totalmente responsivo:

- ✅ Mobile (320px+)
- ✅ Tablet (768px+)
- ✅ Desktop (1024px+)

## 🎯 Próximos Passos (Opcional)

- [ ] Adicionar limite de tentativas
- [ ] Implementar captcha
- [ ] Adicionar histórico de senhas
- [ ] Notificar por email quando senha for alterada
- [ ] Adicionar força da senha visual

## 📞 Suporte

Para problemas com a configuração do Supabase, consulte:

- [Documentação Oficial](https://supabase.com/docs/guides/auth/passwords)
- [Reset Password API](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
