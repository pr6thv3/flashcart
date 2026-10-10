import { Response, NextFunction } from 'express';
import { AuthService } from './auth.service.js';
import { RegisterInput, LoginInput } from './auth.schemas.js';
import { AuthenticatedRequest } from '../../common/types.js';

const authService = new AuthService();

export class AuthController {
  async register(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const input = req.body as RegisterInput;
      const ipAddress = req.ip;
      const userAgent = req.headers['user-agent'];

      const result = await authService.register(input, ipAddress, userAgent);

      res.cookie('flashcart_session', result.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.status(201).json({
        user: result.user,
        token: result.token,
        user_id: result.user.id,
        email: result.user.email,
        role: result.user.roles[0],
      });
    } catch (err) {
      next(err);
    }
  }

  async login(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const input = req.body as LoginInput;
      const ipAddress = req.ip;
      const userAgent = req.headers['user-agent'];

      const result = await authService.login(input, ipAddress, userAgent);

      res.cookie('flashcart_session', result.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.status(200).json({
        user: result.user,
        token: result.token,
        user_id: result.user.id,
        email: result.user.email,
        role: result.user.roles[0],
      });
    } catch (err) {
      next(err);
    }
  }

  async logout(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (req.sessionId) {
        await authService.logout(req.sessionId);
      }
      res.clearCookie('flashcart_session', { path: '/' });
      res.status(200).json({ message: 'Logged out successfully' });
    } catch (err) {
      next(err);
    }
  }

  async getMe(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not logged in' } });
        return;
      }
      const user = await authService.getCurrentUser(req.user.id);
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  }
}
