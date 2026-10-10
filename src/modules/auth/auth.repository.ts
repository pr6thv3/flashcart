import { query, withTransaction } from '../../db/pool.js';
import { UserRole } from '../../common/types.js';

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  phone_number: string | null;
  is_active: boolean;
  is_email_verified: boolean;
  created_at: Date;
  updated_at: Date;
}

export class AuthRepository {
  async ensureDefaultRoles(): Promise<void> {
    await query(`
      INSERT INTO roles (name, description)
      VALUES
        ('customer', 'Customer role for purchasing products'),
        ('vendor', 'Vendor role for managing merchant products and fulfillment'),
        ('admin', 'Administrator role for platform governance')
      ON CONFLICT (name) DO NOTHING;
    `);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const res = await query<UserRecord>(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    return res.rows[0] || null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const res = await query<UserRecord>(
      `SELECT * FROM users WHERE id = $1`,
      [id]
    );
    return res.rows[0] || null;
  }

  async createUserWithCustomerRole(params: {
    email: string;
    passwordHash: string;
    fullName: string;
    phoneNumber?: string;
  }): Promise<{ user: UserRecord; roles: UserRole[] }> {
    return await withTransaction(async (client) => {
      // 1. Insert user
      const userRes = await client.query<UserRecord>(
        `INSERT INTO users (email, password_hash, full_name, phone_number, is_active, is_email_verified)
         VALUES ($1, $2, $3, $4, true, false)
         RETURNING *`,
        [params.email, params.passwordHash, params.fullName, params.phoneNumber || null]
      );
      const user = userRes.rows[0];

      // 2. Fetch customer role id
      const roleRes = await client.query<{ id: string }>(
        `SELECT id FROM roles WHERE name = 'customer'`
      );
      if (roleRes.rows.length === 0) {
        // Fallback insert if not yet seeded
        const newRoleRes = await client.query<{ id: string }>(
          `INSERT INTO roles (name, description) VALUES ('customer', 'Customer role') RETURNING id`
        );
        await client.query(
          `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
          [user.id, newRoleRes.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
          [user.id, roleRes.rows[0].id]
        );
      }

      return { user, roles: ['customer'] };
    });
  }

  async getUserRoles(userId: string): Promise<UserRole[]> {
    const res = await query<{ name: string }>(
      `SELECT r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1`,
      [userId]
    );
    return res.rows.map((r) => r.name as UserRole);
  }

  async createSession(params: {
    userId: string;
    tokenHash: string;
    ipAddress?: string;
    userAgent?: string;
    expiresAt: Date;
  }): Promise<{ id: string }> {
    const res = await query<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        params.userId,
        params.tokenHash,
        params.ipAddress || null,
        params.userAgent || null,
        params.expiresAt,
      ]
    );
    return res.rows[0];
  }

  async revokeSession(sessionId: string): Promise<void> {
    await query(
      `UPDATE sessions SET revoked_at = clock_timestamp() WHERE id = $1`,
      [sessionId]
    );
  }
}
