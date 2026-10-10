import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { AuthRepository } from './auth.repository.js';
import { RegisterInput, LoginInput } from './auth.schemas.js';
import { ConflictError, UnauthorizedError } from '../../common/errors.js';
import { AuthUser } from '../../common/types.js';
import { config } from '../../config/index.js';

export interface AuthResponseDTO {
  user: AuthUser;
  token: string;
}

export class AuthService {
  private repo = new AuthRepository();

  async register(
    input: RegisterInput,
    ipAddress?: string,
    userAgent?: string
  ): Promise<AuthResponseDTO> {
    const existing = await this.repo.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('A user with this email address already exists.');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(input.password, salt);

    const { user, roles } = await this.repo.createUserWithCustomerRole({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      phoneNumber: input.phoneNumber,
    });

    // Create session
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + config.sessionExpiryDays * 24 * 60 * 60 * 1000);

    await this.repo.createSession({
      userId: user.id,
      tokenHash,
      ipAddress,
      userAgent,
      expiresAt,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        roles,
      },
      token: rawToken,
    };
  }

  async login(
    input: LoginInput,
    ipAddress?: string,
    userAgent?: string
  ): Promise<AuthResponseDTO> {
    const user = await this.repo.findByEmail(input.email);
    if (!user || !user.is_active) {
      throw new UnauthorizedError('Invalid email or password.');
    }

    const isMatch = await bcrypt.compare(input.password, user.password_hash);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid email or password.');
    }

    const roles = await this.repo.getUserRoles(user.id);

    // Create session
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + config.sessionExpiryDays * 24 * 60 * 60 * 1000);

    await this.repo.createSession({
      userId: user.id,
      tokenHash,
      ipAddress,
      userAgent,
      expiresAt,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        roles,
      },
      token: rawToken,
    };
  }

  async logout(sessionId?: string): Promise<void> {
    if (sessionId) {
      await this.repo.revokeSession(sessionId);
    }
  }

  async getCurrentUser(userId: string): Promise<AuthUser> {
    const user = await this.repo.findById(userId);
    if (!user || !user.is_active) {
      throw new UnauthorizedError('User not found or inactive');
    }
    const roles = await this.repo.getUserRoles(user.id);
    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      roles,
    };
  }
}
