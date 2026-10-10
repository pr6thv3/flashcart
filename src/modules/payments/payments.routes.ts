import { Router, Response, NextFunction } from 'express';
import { PaymentService } from './payment_service.js';
import { handleWebhook } from './webhook_handler.js';
import { requireAuth } from '../../middleware/auth.js';
import { AuthenticatedRequest } from '../../common/types.js';

const paymentService = new PaymentService();

export class PaymentController {
  async pay(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const checkoutId =
        req.body.checkoutId ||
        req.body.checkout_id ||
        req.body.reservationId ||
        req.body.reservation_id;
      const simulateStatus = req.body.simulateStatus || req.body.simulate_status || 'success';
      const paymentMethod = req.body.paymentMethod || req.body.payment_method || 'sandbox';
      const testCardToken = req.body.testCardToken || req.body.test_card_token;

      const idempotencyKey =
        (req.headers['idempotency-key'] as string) ||
        (req.headers['Idempotency-Key'] as string) ||
        req.body.idempotencyKey ||
        req.body.idempotency_key;

      const customerId = req.user!.id;

      const result = await paymentService.processPayment({
        customerId,
        checkoutId,
        idempotencyKey,
        paymentMethod,
        simulateStatus,
        testCardToken,
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

const controller = new PaymentController();

export const webhookRoutes = Router();
webhookRoutes.post('/:provider', handleWebhook);

export const paymentRoutes = Router();
paymentRoutes.post('/pay', requireAuth as any, controller.pay.bind(controller) as any);
