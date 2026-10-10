import { Response, NextFunction } from 'express';
import { CheckoutService } from './checkout.service.js';
import { CreateCheckoutInput } from './checkout.schemas.js';
import { AuthenticatedRequest } from '../../common/types.js';

const checkoutService = new CheckoutService();

export class CheckoutController {
  async reserve(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const idempotencyKey =
        (req.headers['idempotency-key'] as string) ||
        (req.headers['Idempotency-Key'] as string);

      const input = req.body as CreateCheckoutInput;
      const customerId = req.user!.id;

      const result = await checkoutService.reserveCheckout(
        customerId,
        idempotencyKey,
        input
      );

      const statusCode = result.isIdempotentReplay ? 200 : 201;
      res.status(statusCode).json(result);
    } catch (err) {
      next(err);
    }
  }

  async getCheckout(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const checkoutId = req.params.id as string;
      const customerId = req.user!.id;

      const result = await checkoutService.getCheckoutById(customerId, checkoutId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
