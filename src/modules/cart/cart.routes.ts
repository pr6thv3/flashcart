import { Router } from 'express';
import { CartController } from './cart.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validation.js';
import { addCartItemSchema, updateCartItemSchema } from './cart.schemas.js';

const router = Router();
const controller = new CartController();

router.use(requireAuth as any);

router.get('/', controller.getCart.bind(controller) as any);
router.post(
  '/items',
  validate({ body: addCartItemSchema }),
  controller.addItem.bind(controller) as any
);
router.put(
  '/items/:productId',
  validate({ body: updateCartItemSchema }),
  controller.updateItem.bind(controller) as any
);
router.delete('/items/:productId', controller.removeItem.bind(controller) as any);
router.delete('/', controller.clearCart.bind(controller) as any);

export const cartRoutes = router;
