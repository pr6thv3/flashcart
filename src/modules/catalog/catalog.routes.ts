import { Router } from 'express';
import { CatalogController } from './catalog.controller.js';

const controller = new CatalogController();

// Products router
export const productRoutes = Router();
productRoutes.get('/', controller.listProducts.bind(controller) as any);
productRoutes.get('/:id', controller.getProduct.bind(controller) as any);

// Flash sales router
export const flashSaleRoutes = Router();
flashSaleRoutes.get('/active', controller.listActiveFlashSales.bind(controller) as any);
flashSaleRoutes.get('/:id', controller.getFlashSale.bind(controller) as any);
