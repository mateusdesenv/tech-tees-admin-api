import { createRequestHandler } from '../dist/src/app.js';
import { getProductsServiceLazy } from '../dist/src/products-service-factory.js';

export default createRequestHandler(getProductsServiceLazy);
