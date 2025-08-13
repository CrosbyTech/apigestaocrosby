# Solução para Erro Multer no Deploy

## Problema
O erro `ERR_MODULE_NOT_FOUND: Cannot find package 'multer'` ocorre porque o pacote `multer` não está instalado no ambiente de produção.

## Solução

### 1. Atualizar package.json
O arquivo `package.json` já foi atualizado com a dependência do `multer`:
```json
"multer": "^1.4.5-lts.1"
```

### 2. Fazer Deploy das Alterações

#### Opção A: Se estiver usando Render.com
1. Faça commit das alterações:
```bash
git add .
git commit -m "Adiciona multer para upload de arquivos"
git push origin main
```

2. O Render deve detectar automaticamente as mudanças e executar `npm install` durante o build.

#### Opção B: Deploy Manual
Se precisar fazer deploy manual:
```bash
# No servidor de produção
cd /opt/render/project/src
npm install
npm start
```

### 3. Verificar se o Deploy Funcionou
Após o deploy, teste a rota:
```
POST https://apigestaocrosby-bw2v.onrender.com/api/financial/upload-retorno
```

### 4. Estrutura de Pastas Necessária
Certifique-se de que a pasta `uploads` existe no servidor:
```bash
mkdir uploads
```

### 5. Permissões de Arquivo
Se houver problemas de permissão:
```bash
chmod 755 uploads
```

## URLs das Rotas

### Rotas Disponíveis:
- **Contas a Pagar**: `GET https://apigestaocrosby-bw2v.onrender.com/api/financial/contas-pagar`
- **Saldo Conta**: `GET https://apigestaocrosby-bw2v.onrender.com/api/financial/saldo-conta`
- **Upload Retorno**: `POST https://apigestaocrosby-bw2v.onrender.com/api/financial/upload-retorno`

### Documentação da API:
- **Docs**: `GET https://apigestaocrosby-bw2v.onrender.com/api/docs`

## Teste da Funcionalidade
Use o arquivo `test-upload.html` para testar o upload de arquivos `.RET`.

## Observações
- O `multer` versão 1.x tem algumas vulnerabilidades conhecidas, mas é estável para uso em produção
- Para maior segurança, considere atualizar para a versão 2.x no futuro
- O arquivo temporário é automaticamente deletado após o processamento
