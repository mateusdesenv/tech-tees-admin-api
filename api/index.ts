import { createRequestHandler } from '../src/app.js';
import { getProductsServiceLazy } from '../src/products-service-factory.js';

export default createRequestHandler(getProductsServiceLazy);
