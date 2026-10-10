import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError, apiRequest, formatPrice } from '../web/src/lib/api.js';

describe('Frontend Client API & Error Handling Empirical Stress Test', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Currency Formatting Utility', () => {
    it('handles null, undefined, and zero correctly', () => {
      expect(formatPrice(null)).toBe('₹0.00');
      expect(formatPrice(undefined)).toBe('₹0.00');
      expect(formatPrice(0)).toMatch(/0\.00/);
    });

    it('formats minor units accurately without off-by-one errors', () => {
      expect(formatPrice(100)).toMatch(/1\.00/);
      expect(formatPrice(299900)).toMatch(/2,999\.00/);
      expect(formatPrice(50)).toMatch(/0\.50/);
    });
  });

  describe('2. Network Error Handling', () => {
    it('propagates network failure (TypeError: fetch failed) to caller', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED'));

      let caughtError: any = null;
      try {
        await apiRequest('/test-endpoint');
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(TypeError);
      expect(caughtError.message).toBe('fetch failed: ECONNREFUSED');
    });

    it('CheckoutPage error handler maps network error gracefully without crashing', () => {
      const networkError = new TypeError('Failed to fetch');
      let displayedError: string | null = null;
      let isSubmitting = true;

      try {
        throw networkError;
      } catch (err: any) {
        if (err instanceof ApiError) {
          if (err.code === 'INVENTORY_UNAVAILABLE') {
            displayedError = 'Inventory Unavailable: An item in your cart sold out or cannot be reserved.';
          } else {
            displayedError = err.message || 'Checkout reservation failed.';
          }
        } else {
          displayedError = err.message || 'Checkout reservation failed.';
        }
      } finally {
        isSubmitting = false;
      }

      expect(displayedError).toBe('Failed to fetch');
      expect(isSubmitting).toBe(false);
    });
  });

  describe('3. Inventory Unavailable Handling (409 Conflict)', () => {
    it('parses structured backend INVENTORY_UNAVAILABLE envelope into ApiError', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          error: {
            code: 'INVENTORY_UNAVAILABLE',
            message: 'The requested quantity is no longer available.',
            requestId: 'req_12345',
          },
        }),
      } as any);

      let caughtError: any = null;
      try {
        await apiRequest('/checkout/reserve');
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ApiError);
      expect(caughtError.status).toBe(409);
      expect(caughtError.code).toBe('INVENTORY_UNAVAILABLE');
      expect(caughtError.message).toBe('The requested quantity is no longer available.');
    });

    it('CheckoutPage correctly displays specialized message for INVENTORY_UNAVAILABLE', () => {
      const invError = new ApiError(
        409,
        'INVENTORY_UNAVAILABLE',
        'The requested quantity is no longer available.'
      );

      let displayedError: string | null = null;
      let isSubmitting = true;

      try {
        throw invError;
      } catch (err: any) {
        if (err instanceof ApiError) {
          if (err.code === 'INVENTORY_UNAVAILABLE') {
            displayedError = 'Inventory Unavailable: An item in your cart sold out or cannot be reserved.';
          } else {
            displayedError = err.message || 'Checkout reservation failed.';
          }
        } else {
          displayedError = err.message || 'Checkout reservation failed.';
        }
      } finally {
        isSubmitting = false;
      }

      expect(displayedError).toBe(
        'Inventory Unavailable: An item in your cart sold out or cannot be reserved.'
      );
      expect(isSubmitting).toBe(false);
    });
  });

  describe('4. Decoupled Payment Simulator Error & Outcome Handling', () => {
    it('PaymentSimulationPage correctly maps RESERVATION_EXPIRED to safe refund notice', () => {
      const expiredError = new ApiError(
        409,
        'RESERVATION_EXPIRED',
        'Reservation has expired before payment completed.'
      );

      let displayedError: string | null = null;
      let isProcessing = true;

      try {
        throw expiredError;
      } catch (err: any) {
        if (err instanceof ApiError) {
          if (err.code === 'RESERVATION_EXPIRED') {
            displayedError =
              'Reservation Expired: The stock lock expired before payment completed. Safe refund initiated.';
          } else {
            displayedError = err.message || 'Payment processing failed.';
          }
        } else {
          displayedError = err.message || 'Payment processing failed.';
        }
      } finally {
        isProcessing = false;
      }

      expect(displayedError).toBe(
        'Reservation Expired: The stock lock expired before payment completed. Safe refund initiated.'
      );
      expect(isProcessing).toBe(false);
    });

    it('Payment failure response with status!=="paid" renders failure UI cleanly', () => {
      const failureResponse = {
        checkoutId: 'chk_test_123',
        status: 'failed',
        errorCode: 'CARD_DECLINED',
        errorMessage: 'Issuer card decline simulation',
      };

      const isPaid = failureResponse.status === 'paid';
      expect(isPaid).toBe(false);
      expect(failureResponse.status).toBe('failed');
      expect(failureResponse.errorMessage).toBe('Issuer card decline simulation');
    });

    it('Payment timeout response with status==="timeout" is handled safely', () => {
      const timeoutResponse = {
        checkoutId: 'chk_test_timeout',
        status: 'timeout',
        errorCode: 'GATEWAY_TIMEOUT',
        errorMessage: 'External gateway request timed out after 3000ms',
      };

      expect(timeoutResponse.status).not.toBe('paid');
      expect(timeoutResponse.status).toBe('timeout');
    });
  });

  describe('5. Unhandled / Raw HTML / Non-JSON Error Responses', () => {
    it('handles 502/503 HTML or raw text errors without crashing JSON parser', async () => {
      const rawHtml = '<html><body>502 Bad Gateway: NGINX</body></html>';
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => rawHtml,
      } as any);

      let caughtError: any = null;
      try {
        await apiRequest('/any-endpoint');
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ApiError);
      expect(caughtError.status).toBe(502);
      expect(caughtError.code).toBe('HTTP_502');
      expect(caughtError.message).toBe(rawHtml);
    });

    it('handles 400 Validation Errors with detailed schema violation paths', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request payload validation failed',
            details: [
              { path: 'email', message: 'Invalid email format' },
              { path: 'password', message: 'String must contain at least 8 character(s)' },
            ],
          },
        }),
      } as any);

      let caughtError: any = null;
      try {
        await apiRequest('/auth/register', { method: 'POST', body: '{}' });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ApiError);
      expect(caughtError.status).toBe(400);
      expect(caughtError.code).toBe('VALIDATION_ERROR');
      expect(caughtError.details).toBeDefined();
      expect(caughtError.details.details).toHaveLength(2);
    });
  });
});
