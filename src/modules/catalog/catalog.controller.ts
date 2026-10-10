import { Request, Response, NextFunction } from 'express';
import { CatalogRepository } from './catalog.repository.js';
import { NotFoundError } from '../../common/errors.js';

const repo = new CatalogRepository();

export class CatalogController {
  async listProducts(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const products = await repo.listProducts();
      res.status(200).json(products);
    } catch (err) {
      next(err);
    }
  }

  async getProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const product = await repo.getProductById(req.params.id as string);
      if (!product) {
        throw new NotFoundError('Product not found');
      }
      res.status(200).json(product);
    } catch (err) {
      next(err);
    }
  }

  async listActiveFlashSales(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sales = await repo.listActiveFlashSales();
      res.status(200).json(sales);
    } catch (err) {
      next(err);
    }
  }

  async getFlashSale(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sale = await repo.getFlashSaleById(req.params.id as string);
      if (!sale) {
        throw new NotFoundError('Flash sale not found');
      }
      res.status(200).json(sale);
    } catch (err) {
      next(err);
    }
  }
}
