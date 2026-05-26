# Tech Tees Admin API

API HTTP em TypeScript para substituir o `localStorage` do admin de camisetas mantendo o contrato atual de `Product`.

## Requisitos

- Node.js 20+
- MongoDB local ou MongoDB Atlas

## Rodando localmente

```bash
npm ci
cp .env.example .env
npm run dev
```

Por padrão, a API sobe em:

```txt
http://127.0.0.1:3000
```

Health check:

```bash
curl http://127.0.0.1:3000/health
```

Crie uma conta administrativa e use o token retornado para as ações de escrita:

```bash
curl -X POST http://127.0.0.1:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"admin@techtees.com","password":"senha123"}'
```

Login:

```bash
curl -X POST http://127.0.0.1:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@techtees.com","password":"senha123"}'
```

## Scripts

```bash
npm run dev        # servidor local em TypeScript
npm run dev:watch  # servidor local com watch
npm run build      # compila para dist/
npm start          # roda a versão compilada
npm test           # executa testes
```

## Deploy na Vercel

O projeto já possui:

```txt
api/index.js
vercel.json
```

A Vercel deve publicar os endpoints na raiz do domínio:

```txt
https://sua-api.vercel.app/health
https://sua-api.vercel.app/products
```

Configuração recomendada na Vercel:

- Framework Preset: `Other`
- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: vazio

## Variáveis de ambiente

Configure estas variáveis na Vercel:

```txt
MONGODB_URI=mongodb+srv://USUARIO:SENHA@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=tech-tees-admin
MONGODB_COLLECTION=products
MONGODB_USERS_COLLECTION=users
MONGODB_STORES_COLLECTION=stores
AUTH_SECRET=gere-um-segredo-forte-aqui
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-ou-TEST-...
API_BASE_URL=https://sua-api.vercel.app
APP_BASE_URL=https://sua-api.vercel.app
ECOMMERCE_BASE_URL=https://sua-loja.vercel.app
CORS_ORIGIN=https://url-do-admin.vercel.app
```

Variáveis opcionais:

```txt
PORT=3000
HOST=127.0.0.1
AUTO_SEED=true
MAX_BODY_BYTES=1000000
MAX_IMPORT_PRODUCTS=1000
```

### Observações importantes

- `GET /products` é público para o e-commerce.
- Criar, editar, excluir, importar, exportar, duplicar e alterar status exigem `Authorization: Bearer <token>`.
- `GET /health` não exige token.
- `CORS_ORIGIN` aceita uma ou mais origens separadas por vírgula.
- `AUTO_SEED=false` impede a API de recriar o produto seed quando a coleção estiver vazia.
- `MAX_BODY_BYTES` limita o tamanho do JSON recebido. A recomendação é não enviar imagens grandes em base64.

## Endpoints

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `GET /stores`
- `POST /stores`
- `PUT /stores/:id`
- `PATCH /stores/:id`
- `DELETE /stores/:id`
- `POST /checkout/create-preference`
- `POST /checkout/process-payment`
- `POST /webhooks/mercado-pago`
- `GET /products`
- `POST /products`
- `GET /products/export`
- `POST /products/import`
- `POST /products/reset-seed`
- `GET /products/:id`
- `PUT /products/:id`
- `PATCH /products/:id`
- `DELETE /products/:id`
- `POST /products/:id/duplicate`
- `PATCH /products/:id/status`

## Segurança aplicada nesta versão

- Login/cadastro com senha hasheada usando PBKDF2.
- Token assinado via `Authorization: Bearer <token>`.
- CORS configurável por ambiente.
- Limite de tamanho do body JSON.
- Validação contra números negativos em preço, custo, estoque e vendas.
- Correção do bug `Boolean('false') === true`.
- Validação de duplicidade em `id`, `slug` e `sku` antes de criar/importar produtos.
- Correção do script `npm start` para `dist/src/server.js`.

## Contrato de importação/exportação

Exportação:

```json
{
  "version": 1,
  "exportedAt": "2026-05-24T12:00:00.000Z",
  "products": []
}
```

Importação aceita tanto o envelope acima quanto um array puro de produtos.
