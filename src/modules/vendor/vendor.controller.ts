import { Response, NextFunction } from 'express';
import { VendorRepository } from './vendor.repository.js';
import { CreateProductInput, UpdateProductInput, UpdateInventoryInput, FulfillOrderInput } from './vendor.schemas.js';
import { NotFoundError } from '../../common/errors.js';
import { AuthenticatedRequest } from '../../common/types.js';

const repo = new VendorRepository();

export class VendorController {
  async getProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const profile = await repo.getProfile(req.vendorId!);
      if (!profile) throw new NotFoundError('Vendor profile not found');
      res.status(200).json({ profile });
    } catch (err) {
      next(err);
    }
  }

  async listProducts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const products = await repo.listProducts(req.vendorId!);
      res.status(200).json({ products });
    } catch (err) {
      next(err);
    }
  }

  async createProduct(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = req.body as CreateProductInput;
      const product = await repo.createProduct(req.vendorId!, input);
      res.status(201).json({ product });
    } catch (err) {
      next(err);
    }
  }

  async updateProduct(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = req.params.id as string;
      const input = req.body as UpdateProductInput;
      const product = await repo.updateProduct(req.vendorId!, productId, input);
      if (!product) {
        throw new NotFoundError(`Product not found`);
      }
      res.status(200).json({ product });
    } catch (err) {
      next(err);
    }
  }

  async updateInventory(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = req.params.productId as string;
      const input = req.body as UpdateInventoryInput;
      const inv = await repo.updateInventory(req.vendorId!, productId, input.onHandQty);
      if (!inv) {
        throw new NotFoundError(`Product not found`);
      }
      res.status(200).json({ inventory: inv });
    } catch (err) {
      next(err);
    }
  }

  async listOrders(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const orders = await repo.listOrders(req.vendorId!);
      res.status(200).json({ orders });
    } catch (err) {
      next(err);
    }
  }

  async getOrder(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const orderId = req.params.id as string;
      const order = await repo.getOrderById(req.vendorId!, orderId);
      if (!order) {
        throw new NotFoundError(`Order not found`);
      }
      res.status(200).json({ order });
    } catch (err) {
      next(err);
    }
  }

  async fulfillOrder(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const orderId = req.params.id as string;
      const input = req.body as FulfillOrderInput;
      const order = await repo.updateOrderStatus(req.vendorId!, orderId, input.status);
      if (!order) {
        throw new NotFoundError(`Order not found`);
      }
      res.status(200).json({ order, message: `Order status updated to ${input.status}` });
    } catch (err) {
      next(err);
    }
  }
}
