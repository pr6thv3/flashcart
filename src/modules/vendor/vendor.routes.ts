import { Router } from 'express';
import { VendorController } from './vendor.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { requireVendor } from '../../middleware/vendor.js';
import { validate } from '../../middleware/validation.js';
import {
  createProductSchema,
  updateProductSchema,
  updateInventorySchema,
  fulfillOrderSchema,
} from './vendor.schemas.js';

const router = Router();
const controller = new VendorController();

// Apply auth + vendor RBAC + vendor profile context to ALL vendor routes
router.use(requireAuth as any);
router.use(requireRole('vendor') as any);
router.use(requireVendor as any);

router.get('/profile', controller.getProfile.bind(controller) as any);
router.get('/products', controller.listProducts.bind(controller) as any);
router.post(
  '/products',
  validate({ body: createProductSchema }),
  controller.createProduct.bind(controller) as any
);
router.put(
  '/products/:id',
  validate({ body: updateProductSchema }),
  controller.updateProduct.bind(controller) as any
);
router.put(
  '/inventory/:productId',
  validate({ body: updateInventorySchema }),
  controller.updateInventory.bind(controller) as any
);

router.get('/orders', controller.listOrders.bind(controller) as any);
router.get('/orders/:id', controller.getOrder.bind(controller) as any);
router.put(
  '/orders/:id/fulfill',
  validate({ body: fulfillOrderSchema }),
  controller.fulfillOrder.bind(controller) as any
);
router.patch(
  '/orders/:id/fulfillment',
  validate({ body: fulfillOrderSchema }),
  controller.fulfillOrder.bind(controller) as any
);

export const vendorRoutes = router;
