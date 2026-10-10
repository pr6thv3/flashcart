import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { query, pool } from '../../src/db/pool.js';
import { AuthRepository } from '../../src/modules/auth/auth.repository.js';

describe('Auth & RBAC Unit / Integration Tests', () => {
  const authRepo = new AuthRepository();

  beforeAll(async () => {
    await authRepo.ensureDefaultRoles();
  });

  afterAll(async () => {
    // cleanup
  });

  it('registers a new user and strictly defaults to customer role', async () => {
    const email = `customer_test_${Date.now()}@example.com`;
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: 'Test Customer',
        role: 'admin', // Malicious attempt to self-escalate role
      });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(email);
    expect(res.body.token).toBeDefined();
    // Verify role is strictly 'customer'
    expect(res.body.user.roles).toEqual(['customer']);

    // Check cookie
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain('flashcart_session');

    // Verify DB record
    const dbRoles = await query(
      `SELECT r.name FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN users u ON u.id = ur.user_id
       WHERE u.email = $1`,
      [email]
    );
    expect(dbRoles.rows.map((r) => r.name)).toEqual(['customer']);
  });

  it('registers a user when submitting snake_case full_name from frontend forms', async () => {
    const email = `snake_case_${Date.now()}@example.com`;
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        full_name: 'Frank Castle',
      });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.fullName).toBe('Frank Castle');
    expect(res.body.user.full_name).toBe('Frank Castle');
  });

  it('rejects registration with duplicate email with HTTP 409', async () => {
    const email = `dup_user_${Date.now()}@example.com`;
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: 'First Register',
      });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: 'Second Register',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.requestId).toBeDefined();
  });

  it('logs in successfully and returns session token and user profile', async () => {
    const email = `login_user_${Date.now()}@example.com`;
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'ValidPassword123!',
        fullName: 'Login User',
      });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email,
        password: 'ValidPassword123!',
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.roles).toContain('customer');

    // Verify /me endpoint with Bearer token
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(email);
  });

  it('rejects login with invalid password with HTTP 401', async () => {
    const email = `wrong_pw_${Date.now()}@example.com`;
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'CorrectPassword123!',
        fullName: 'Wrong PW User',
      });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email,
        password: 'IncorrectPassword',
      });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('logs out and revokes active session', async () => {
    const email = `logout_user_${Date.now()}@example.com`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'Password123!',
        fullName: 'Logout User',
      });

    const token = regRes.body.token;

    // Logout
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(logoutRes.status).toBe(200);

    // Subsequent authenticated request using revoked token must fail with 401
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(meRes.status).toBe(401);
  });
});
