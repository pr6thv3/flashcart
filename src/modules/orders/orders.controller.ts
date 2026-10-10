import { Response, NextFunction } from 'express';
import { OrdersRepository } from './orders.repository.js';
import { AuthenticatedRequest } from '../../common/types.js';
import { NotFoundError } from '../../common/errors.js';

const repo = new OrdersRepository();

export class OrdersController {
  async listOrders(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const orders = await repo.listOrdersByCustomer(req.user!.id);
      res.status(200).json(orders);
    } catch (err) {
      next(err);
    }
  }

  async getOrder(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const order = await repo.getOrderById(req.user!.id, req.params.id as string);
      if (!order) {
        throw new NotFoundError('Order not found');
      }
      res.status(200).json(order);
    } catch (err) {
      next(err);
    }
  }
}
