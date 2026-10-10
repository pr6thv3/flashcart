import { Response, NextFunction } from 'express';
import { CartRepository } from './cart.repository.js';
import { AddCartItemInput, UpdateCartItemInput } from './cart.schemas.js';
import { AuthenticatedRequest } from '../../common/types.js';
import { query } from '../../db/pool.js';
import { NotFoundError } from '../../common/errors.js';

const repo = new CartRepository();

export class CartController {
  async getCart(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const cartId = await repo.getOrCreateCart(req.user!.id);
      const cart = await repo.getCartDetails(cartId);
      res.status(200).json(cart);
    } catch (err) {
      next(err);
    }
  }

  async addItem(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = req.body as AddCartItemInput;

      // Verify product is published
      const prodCheck = await query(
        `SELECT id, status FROM products WHERE id = $1`,
        [input.productId]
      );
      if (prodCheck.rows.length === 0 || prodCheck.rows[0].status !== 'published') {
        throw new NotFoundError('Product not found or not published');
      }

      const cartId = await repo.getOrCreateCart(req.user!.id);
      await repo.upsertCartItem(cartId, input.productId, input.quantity);

      const cart = await repo.getCartDetails(cartId);
      res.status(200).json(cart);
    } catch (err) {
      next(err);
    }
  }

  async updateItem(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = req.params.productId as string;
      const input = req.body as UpdateCartItemInput;

      const cartId = await repo.getOrCreateCart(req.user!.id);
      await repo.updateCartItemQuantity(cartId, productId, input.quantity);

      const cart = await repo.getCartDetails(cartId);
      res.status(200).json(cart);
    } catch (err) {
      next(err);
    }
  }

  async removeItem(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const productId = req.params.productId as string;
      const cartId = await repo.getOrCreateCart(req.user!.id);
      await repo.deleteCartItem(cartId, productId);

      const cart = await repo.getCartDetails(cartId);
      res.status(200).json(cart);
    } catch (err) {
      next(err);
    }
  }

  async clearCart(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const cartId = await repo.getOrCreateCart(req.user!.id);
      await repo.clearCart(cartId);
      res.status(200).json({ message: 'Cart cleared', cart_id: cartId, items: [] });
    } catch (err) {
      next(err);
    }
  }
}
