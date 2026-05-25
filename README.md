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

Se `ADMIN_API_TOKEN` estiver configurado, os endpoints de `/products` exigem autenticação:

```bash
curl http://127.0.0.1:3000/products \
  -H "Authorization: Bearer SEU_TOKEN"
```

Também é aceito:

```bash
curl http://127.0.0.1:3000/products \
  -H "X-Admin-Token: SEU_TOKEN"
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
api/index.ts
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
ADMIN_API_TOKEN=gere-um-token-forte-aqui
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

- Em produção/Vercel, `ADMIN_API_TOKEN` é obrigatório para acessar `/products`.
- `GET /health` não exige token.
- `CORS_ORIGIN` aceita uma ou mais origens separadas por vírgula.
- `AUTO_SEED=false` impede a API de recriar o produto seed quando a coleção estiver vazia.
- `MAX_BODY_BYTES` limita o tamanho do JSON recebido. A recomendação é não enviar imagens grandes em base64.

## Endpoints

- `GET /health`
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

- Token administrativo via `Authorization: Bearer <token>` ou `X-Admin-Token`.
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
