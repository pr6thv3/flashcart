import { describe, it, expect } from 'vitest';
import { runMarketplaceWorkflowDemo } from './demo_1_marketplace_flow.js';

describe('Demonstration 1: Multi-Vendor Marketplace Workflow Integration Test', () => {
  it('executes full end-to-end customer journey, order splitting, payment and vendor isolation', async () => {
    const result = await runMarketplaceWorkflowDemo();
    expect(result.passed).toBe(true);
    expect(result.checkoutId).toBeDefined();
    expect(result.vendor1OrderId).toBeDefined();
    expect(result.vendor2OrderId).toBeDefined();
    expect(result.sanitizedRecords.tables.checkouts.length).toBe(1);
    expect(result.sanitizedRecords.tables.orders.length).toBe(2);
    expect(result.sanitizedRecords.tables.payment_attempts.length).toBe(1);
  }, 30000);
});
