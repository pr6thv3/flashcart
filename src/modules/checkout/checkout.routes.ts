import { Router } from 'express';
import { CheckoutController } from './checkout.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { createCheckoutSchema } from './checkout.schemas.js';

import { PaymentController } from '../payments/payments.routes.js';

const router = Router();
const controller = new CheckoutController();
const paymentController = new PaymentController();

router.use(requireAuth as any);

router.post(
  '/reserve',
  validate({ body: createCheckoutSchema }),
  controller.reserve.bind(controller) as any
);

router.post(
  '/pay',
  paymentController.pay.bind(paymentController) as any
);

// Direct POST / (when mounted at /api/v1/checkouts or /api/v1/checkout)
router.post(
  '/',
  validate({ body: createCheckoutSchema }),
  controller.reserve.bind(controller) as any
);

router.get('/:id', controller.getCheckout.bind(controller) as any);

export const checkoutRoutes = router;
