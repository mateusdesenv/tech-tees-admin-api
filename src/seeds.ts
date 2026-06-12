import { generateId } from './product-contract.js';
import type { Product } from './product-contract.js';

export function createSeedProducts(): Product[] {
  const now = new Date().toISOString();

  return [
    {
      id: generateId(),
      name: 'Camiseta Não é Bug, é Feature',
      slug: 'camiseta-nao-e-bug-e-feature',
      category: 'Dev',
      categories: ['Dev'],
      price: 89.9,
      compareAtPrice: 119.9,
      cost: 42,
      stock: 32,
      sku: 'TT-DEV-001',
      color: 'Preta',
      sizes: ['P', 'M', 'G', 'GG'],
      genders: ['Masculino', 'Feminino'],
      image: 'assets/products/nao-e-bug-feature.webp',
      description: 'Camiseta preta com frase dev para quem transforma problemas em funcionalidades.',
      tags: ['dev', 'programação', 'humor'],
      rating: 4.9,
      sales: 128,
      featured: true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
  ];
}
