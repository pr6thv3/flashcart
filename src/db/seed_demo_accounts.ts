import bcrypt from 'bcryptjs';
import { query } from './pool.js';

export async function seedDemoAccounts() {
  console.log('[Seed] Seeding fixed presentation demo accounts and products...');

  // Ensure base roles
  await query(`
    INSERT INTO roles (name, description) VALUES
      ('customer', 'Customer'),
      ('vendor', 'Vendor'),
      ('admin', 'Admin')
    ON CONFLICT (name) DO NOTHING;
  `);

  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 1. Customer: customer@example.com
  let custRes = await query<{ id: string }>(`SELECT id FROM users WHERE email = 'customer@example.com'`);
  let custId: string;
  if (custRes.rows.length === 0) {
    const res = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('customer@example.com', $1, 'Alice Customer') RETURNING id`,
      [passwordHash]
    );
    custId = res.rows[0].id;
  } else {
    custId = custRes.rows[0].id;
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, custId]);
  }
  await query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE name = 'customer'
     ON CONFLICT DO NOTHING`,
    [custId]
  );

  // 1b. Customer: frankdspunisher@gmail.com
  let frankRes = await query<{ id: string }>(`SELECT id FROM users WHERE email = 'frankdspunisher@gmail.com'`);
  let frankId: string;
  if (frankRes.rows.length === 0) {
    const res = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('frankdspunisher@gmail.com', $1, 'Frank Castle') RETURNING id`,
      [passwordHash]
    );
    frankId = res.rows[0].id;
  } else {
    frankId = frankRes.rows[0].id;
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, frankId]);
  }
  await query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE name = 'customer'
     ON CONFLICT DO NOTHING`,
    [frankId]
  );

  // 2. Admin: admin@example.com
  let adminRes = await query<{ id: string }>(`SELECT id FROM users WHERE email = 'admin@example.com'`);
  let adminId: string;
  if (adminRes.rows.length === 0) {
    const res = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('admin@example.com', $1, 'Platform Administrator') RETURNING id`,
      [passwordHash]
    );
    adminId = res.rows[0].id;
  } else {
    adminId = adminRes.rows[0].id;
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, adminId]);
  }
  await query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE name = 'admin'
     ON CONFLICT DO NOTHING`,
    [adminId]
  );

  // 3. Vendor 1: apex@example.com ("Apex Gear")
  let apexUserRes = await query<{ id: string }>(`SELECT id FROM users WHERE email = 'apex@example.com'`);
  let apexUserId: string;
  if (apexUserRes.rows.length === 0) {
    const res = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('apex@example.com', $1, 'Apex Gear Vendor') RETURNING id`,
      [passwordHash]
    );
    apexUserId = res.rows[0].id;
  } else {
    apexUserId = apexUserRes.rows[0].id;
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, apexUserId]);
  }
  await query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE name = 'vendor'
     ON CONFLICT DO NOTHING`,
    [apexUserId]
  );

  let apexProfileRes = await query<{ id: string }>(`SELECT id FROM vendor_profiles WHERE user_id = $1`, [apexUserId]);
  let apexProfileId: string;
  if (apexProfileRes.rows.length === 0) {
    const res = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Apex Gear', 'apex-gear', 'approved') RETURNING id`,
      [apexUserId]
    );
    apexProfileId = res.rows[0].id;
  } else {
    apexProfileId = apexProfileRes.rows[0].id;
  }

  // 4. Vendor 2: nova@example.com ("Nova Sound")
  let novaUserRes = await query<{ id: string }>(`SELECT id FROM users WHERE email = 'nova@example.com'`);
  let novaUserId: string;
  if (novaUserRes.rows.length === 0) {
    const res = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('nova@example.com', $1, 'Nova Sound Vendor') RETURNING id`,
      [passwordHash]
    );
    novaUserId = res.rows[0].id;
  } else {
    novaUserId = novaUserRes.rows[0].id;
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, novaUserId]);
  }
  await query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE name = 'vendor'
     ON CONFLICT DO NOTHING`,
    [novaUserId]
  );

  let novaProfileRes = await query<{ id: string }>(`SELECT id FROM vendor_profiles WHERE user_id = $1`, [novaUserId]);
  let novaProfileId: string;
  if (novaProfileRes.rows.length === 0) {
    const res = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Nova Sound', 'nova-sound', 'approved') RETURNING id`,
      [novaUserId]
    );
    novaProfileId = res.rows[0].id;
  } else {
    novaProfileId = novaProfileRes.rows[0].id;
  }

  // Seed standard products for Apex Gear
  let p1Res = await query<{ id: string }>(`SELECT id FROM products WHERE sku = 'SKU-APEX-KB-RGB'`);
  let p1Id: string;
  if (p1Res.rows.length === 0) {
    const res = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, title, slug, sku, description, price_minor, currency, status)
       VALUES ($1, 'Mechanical Gaming Keyboard RGB', 'apex-rgb-keyboard', 'SKU-APEX-KB-RGB',
               'Tactile mechanical switches with per-key RGB backlighting and aluminum frame', 4500, 'INR', 'published')
       RETURNING id`,
      [apexProfileId]
    );
    p1Id = res.rows[0].id;
    await query(`INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 50, 0)`, [p1Id]);
  } else {
    p1Id = p1Res.rows[0].id;
    await query(`UPDATE inventory SET on_hand_qty = GREATEST(on_hand_qty, 50) WHERE product_id = $1`, [p1Id]);
  }

  // Seed standard products for Nova Sound
  let p2Res = await query<{ id: string }>(`SELECT id FROM products WHERE sku = 'SKU-NOVA-ANC-PRO'`);
  let p2Id: string;
  if (p2Res.rows.length === 0) {
    const res = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, title, slug, sku, description, price_minor, currency, status)
       VALUES ($1, 'ANC Wireless Headphones Pro', 'nova-anc-headphones', 'SKU-NOVA-ANC-PRO',
               'Active Noise Cancelling 40mm hi-res drivers with 30-hour battery life', 2200, 'INR', 'published')
       RETURNING id`,
      [novaProfileId]
    );
    p2Id = res.rows[0].id;
    await query(`INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 50, 0)`, [p2Id]);
  } else {
    p2Id = p2Res.rows[0].id;
    await query(`UPDATE inventory SET on_hand_qty = GREATEST(on_hand_qty, 50) WHERE product_id = $1`, [p2Id]);
  }

  // Seed an active flash sale for a 10-unit limited item under Apex Gear
  let flashPRes = await query<{ id: string }>(`SELECT id FROM products WHERE sku = 'SKU-CYBER-MONITOR-4K'`);
  let flashPId: string;
  if (flashPRes.rows.length === 0) {
    const res = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, title, slug, sku, description, price_minor, currency, status)
       VALUES ($1, 'Cyberpunk Studio Monitor 4K', 'cyber-monitor-4k', 'SKU-CYBER-MONITOR-4K',
               'Ultra-HD 144Hz IPS display with 99% DCI-P3 color gamut - Limited Flash Edition', 9900, 'INR', 'published')
       RETURNING id`,
      [apexProfileId]
    );
    flashPId = res.rows[0].id;
    await query(`INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 50, 0)`, [flashPId]);
  } else {
    flashPId = flashPRes.rows[0].id;
    await query(`UPDATE inventory SET on_hand_qty = GREATEST(on_hand_qty, 50) WHERE product_id = $1`, [flashPId]);
  }

  // Check or create active flash sale
  let fsRes = await query<{ id: string }>(
    `SELECT id FROM flash_sales WHERE title = 'Cyberpunk Studio Monitor 4K Flash Sale' AND is_active = true`
  );
  if (fsRes.rows.length === 0) {
    const startsAt = new Date(Date.now() - 30 * 60 * 1000); // started 30 min ago
    const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // ends in 24 hours
    await query(
      `INSERT INTO flash_sales (product_id, vendor_id, title, sale_price_minor, quantity_limit, quantity_reserved, quantity_sold, starts_at, ends_at, is_active)
       VALUES ($1, $2, 'Cyberpunk Studio Monitor 4K Flash Sale', 4900, 10, 0, 0, $3, $4, true)`,
      [flashPId, apexProfileId, startsAt, endsAt]
    );
    console.log('[Seed] Created active 10-unit flash sale for "Cyberpunk Studio Monitor 4K"');
  }

  console.log('[Seed] ✓ All presentation demo accounts, products, and flash sales successfully seeded:');
  console.log('  - Customer: customer@example.com / Password123!');
  console.log('  - Customer: frankdspunisher@gmail.com / Password123!');
  console.log('  - Vendor 1: apex@example.com / Password123! ("Apex Gear")');
  console.log('  - Vendor 2: nova@example.com / Password123! ("Nova Sound")');
  console.log('  - Admin:    admin@example.com / Password123!');
}

if (process.argv[1]?.endsWith('seed_demo_accounts.ts')) {
  seedDemoAccounts()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Seed] Error:', err);
      process.exit(1);
    });
}
