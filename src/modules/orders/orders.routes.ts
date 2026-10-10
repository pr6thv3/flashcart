import { Router } from 'express';
import { OrdersController } from './orders.controller.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();
const controller = new OrdersController();

router.use(requireAuth as any);

router.get('/', controller.listOrders.bind(controller) as any);
router.get('/:id', controller.getOrder.bind(controller) as any);

export const orderRoutes = router;
