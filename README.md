# Tech Tees Admin API

API HTTP em TypeScript para substituir o `localStorage` do admin de camisetas mantendo o contrato atual de `Product`.

## Requisitos

- Node.js 20+
- MongoDB

## Rodando

```bash
npm install
npm run dev
```

Para rodar a versao compilada:

```bash
npm run build
npm start
```

Por padrao, a API sobe em `http://127.0.0.1:3000` e usa `mongodb://127.0.0.1:27017`.

Variaveis disponiveis:

- `PORT`: porta HTTP.
- `HOST`: host HTTP. Padrao: `127.0.0.1`.
- `MONGODB_URI`: URI de conexao com MongoDB. Padrao: `mongodb://127.0.0.1:27017`.
- `MONGODB_DB`: banco de dados. Padrao: `tech-tees-admin`.
- `MONGODB_COLLECTION`: colecao de produtos. Padrao: `products`.

Exemplo:

```bash
MONGODB_URI="mongodb://127.0.0.1:27017" npm run dev
```

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

Os payloads preservam os campos descritos em `docs/localstorage-contracts.md` do frontend.
# tech-tees-admin-api
