import { createRequestHandler } from '../src/app.js';
import { getProductsService } from '../src/products-service-factory.js';

export default createRequestHandler(getProductsService);
