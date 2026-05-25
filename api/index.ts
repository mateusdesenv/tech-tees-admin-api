// Vercel compiles TypeScript functions directly and resolves these source imports.
// @ts-expect-error TS NodeNext wants emitted .js paths, which break Vercel source bundling here.
import { createRequestHandler } from '../src/app';
// @ts-expect-error TS NodeNext wants emitted .js paths, which break Vercel source bundling here.
import { getProductsService } from '../src/products-service-factory';

export default createRequestHandler(getProductsService);
