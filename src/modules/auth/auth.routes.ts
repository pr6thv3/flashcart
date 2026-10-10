import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { validate } from '../../middleware/validation.js';
import { registerSchema, loginSchema } from './auth.schemas.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();
const controller = new AuthController();

router.post(
  '/register',
  validate({ body: registerSchema }),
  controller.register.bind(controller) as any
);

router.post(
  '/login',
  validate({ body: loginSchema }),
  controller.login.bind(controller) as any
);

router.post(
  '/logout',
  requireAuth as any,
  controller.logout.bind(controller) as any
);

router.get(
  '/me',
  requireAuth as any,
  controller.getMe.bind(controller) as any
);

export const authRoutes = router;
