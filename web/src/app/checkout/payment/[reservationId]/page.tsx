'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, formatPrice, ApiError } from '@/lib/api';
import {
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ArrowRight,
  RefreshCw,
  PackageCheck,
  ExternalLink,
} from 'lucide-react';

export default function PaymentSimulationPage({
  params,
}: {
  params: Promise<{ reservationId: string }>;
}) {
  const resolvedParams = use(params);
  const reservationId = resolvedParams.reservationId;
  const router = useRouter();

  const [checkoutData, setCheckoutData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [simulateStatus, setSimulateStatus] = useState<'success' | 'failure' | 'timeout'>('success');
  const [testCardToken, setTestCardToken] = useState<string>('tok_visa_success');
  const [processing, setProcessing] = useState<boolean>(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadReservation() {
      try {
        setLoading(true);
        const data = await api.checkout.getCheckout(reservationId);
        setCheckoutData(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load reservation details.');
      } finally {
        setLoading(false);
      }
    }
    loadReservation();
  }, [reservationId]);

  const handleExecutePayment = async () => {
    setError(null);
    setProcessing(true);
    setResult(null);

    try {
      // Calls /api/v1/checkout/pay with simulateStatus
      const response = await api.payment.pay({
        checkoutId: reservationId,
        reservationId: reservationId,
        simulateStatus,
        testCardToken,
        paymentMethod: 'sandbox',
      });

      setResult(response);
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.code === 'RESERVATION_EXPIRED') {
          setError(
            'Reservation Expired: The stock lock expired before payment completed. Safe refund initiated.'
          );
        } else {
          setError(err.message || 'Payment processing failed.');
        }
      } else {
        setError(err.message || 'Payment processing failed.');
      }
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-16 animate-pulse space-y-4">
        <div className="h-8 w-64 bg-slate-200 rounded" />
        <div className="h-64 bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="h-6 w-1/3 bg-slate-200 rounded" />
          <div className="h-12 bg-slate-100 rounded" />
        </div>
      </div>
    );
  }

  // Payment Settlement Success View
  if (result && result.status === 'paid') {
    return (
      <div className="max-w-2xl mx-auto space-y-8 py-6">
        <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-lg text-center space-y-6">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-black text-slate-900">Payment Captured!</h1>
            <p className="text-sm text-slate-500">
              Transaction settled. Reserved stock has been permanently converted to sold.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 text-left space-y-4">
            <div className="flex justify-between items-center text-xs font-mono text-slate-500 border-b border-slate-200 pb-2">
              <span>Checkout ID: {result.checkoutId}</span>
              <span className="font-bold text-emerald-600 uppercase bg-emerald-50 px-2 py-0.5 rounded">
                PAID
              </span>
            </div>

            <h3 className="font-bold text-sm text-slate-800">Generated Vendor Sub-Orders:</h3>
            <div className="space-y-2">
              {result.orders?.map((ord: any) => (
                <div
                  key={ord.orderId || ord.orderNumber}
                  className="flex items-center justify-between text-xs bg-white p-3 rounded-xl border border-slate-200 shadow-sm"
                >
                  <div className="space-y-0.5">
                    <span className="font-bold text-slate-800">{ord.orderNumber}</span>
                    <div className="text-slate-400 font-mono text-[10px]">Vendor: {ord.vendorId}</div>
                  </div>
                  <div className="text-right">
                    <span className="font-black text-slate-900">
                      {formatPrice(ord.totalMinor)}
                    </span>
                    <div className="text-[10px] text-emerald-600 font-semibold uppercase">Confirmed</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <Link
              href="/orders"
              className="w-full sm:w-auto bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-6 rounded-xl shadow transition-all flex items-center justify-center space-x-2"
            >
              <PackageCheck className="w-4 h-4" />
              <span>View All My Orders</span>
            </Link>
            <Link
              href="/"
              className="w-full sm:w-auto bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 px-6 rounded-xl transition-all"
            >
              Continue Shopping
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Payment Failure or Timeout View
  if (result && result.status !== 'paid') {
    return (
      <div className="max-w-2xl mx-auto space-y-8 py-6">
        <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 shadow-lg text-center space-y-6">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
            <XCircle className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-black text-slate-900">Payment {result.status}</h1>
            <p className="text-sm text-slate-500">
              The sandbox gateway returned a simulated failure or timeout.
            </p>
          </div>

          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-left text-xs space-y-1">
            <div className="font-bold">Failure Details:</div>
            <p>{result.failureReason || 'Declined by card issuer / gateway simulation.'}</p>
            <p className="text-slate-500 pt-1">
              Note: Unpaid reservations are released back to available inventory without stock loss.
            </p>
          </div>

          <div className="flex gap-4 justify-center">
            <button
              onClick={() => setResult(null)}
              className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-2.5 px-6 rounded-xl shadow transition-all"
            >
              Try Again
            </button>
            <Link
              href="/cart"
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2.5 px-6 rounded-xl transition-all"
            >
              Back to Cart
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Title */}
      <div className="border-b border-slate-200 pb-4">
        <div className="inline-flex items-center space-x-2 bg-amber-50 text-amber-800 text-xs font-semibold px-2.5 py-1 rounded-md mb-2">
          <CreditCard className="w-3.5 h-3.5" />
          <span>Phase B & C: Decoupled Payment Simulator</span>
        </div>
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Authorize Payment</h1>
        <p className="text-sm text-slate-500">
          Simulate payment outcome with zero active database lock contention.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center space-x-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Reservation Details Box */}
      {checkoutData && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <div className="flex justify-between items-baseline border-b border-slate-100 pb-3">
            <div>
              <span className="text-xs uppercase font-bold text-slate-400">Total Amount</span>
              <div className="text-2xl font-black text-slate-900">
                {formatPrice(checkoutData.totalMinor || checkoutData.total_minor)}
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400">Reservation Status</span>
              <div className="font-bold text-xs uppercase text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                {checkoutData.status}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-mono">Reservation: {reservationId.substring(0, 18)}...</span>
            <div className="flex items-center space-x-1 text-slate-600 font-semibold">
              <Clock className="w-3.5 h-3.5 text-orange-600" />
              <span>Expires at: {new Date(checkoutData.expiresAt).toLocaleTimeString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Simulation Radio Options */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
        <h2 className="text-base font-bold text-slate-900">Choose Gateway Simulation Outcome:</h2>

        <div className="space-y-3">
          {/* Option 1: Success */}
          <label
            className={`flex items-start space-x-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
              simulateStatus === 'success'
                ? 'border-emerald-500 bg-emerald-50/30'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="simulateStatus"
              value="success"
              checked={simulateStatus === 'success'}
              onChange={() => {
                setSimulateStatus('success');
                setTestCardToken('tok_visa_success');
              }}
              className="mt-1 text-emerald-600 focus:ring-emerald-500"
            />
            <div className="space-y-1">
              <div className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                <span>Authorize & Capture (Success)</span>
                <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded">
                  HTTP 200
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Simulates successful card authorization. Transitions reserved inventory to sold, sets
                sub-orders to paid, and emits outbox events.
              </p>
            </div>
          </label>

          {/* Option 2: Decline */}
          <label
            className={`flex items-start space-x-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
              simulateStatus === 'failure'
                ? 'border-red-500 bg-red-50/30'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="simulateStatus"
              value="failure"
              checked={simulateStatus === 'failure'}
              onChange={() => {
                setSimulateStatus('failure');
                setTestCardToken('tok_card_declined');
              }}
              className="mt-1 text-red-600 focus:ring-red-500"
            />
            <div className="space-y-1">
              <div className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                <span>Decline / Insufficient Funds (Failure)</span>
                <span className="bg-red-100 text-red-800 text-[10px] font-bold px-2 py-0.5 rounded">
                  Declined
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Simulates issuer card decline. Automatically rolls back reserved units back to available stock.
              </p>
            </div>
          </label>

          {/* Option 3: Timeout */}
          <label
            className={`flex items-start space-x-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
              simulateStatus === 'timeout'
                ? 'border-amber-500 bg-amber-50/30'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="simulateStatus"
              value="timeout"
              checked={simulateStatus === 'timeout'}
              onChange={() => {
                setSimulateStatus('timeout');
                setTestCardToken('tok_timeout');
              }}
              className="mt-1 text-amber-600 focus:ring-amber-500"
            />
            <div className="space-y-1">
              <div className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                <span>Gateway Timeout</span>
                <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded">
                  Timeout
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Simulates an external gateway timeout. Tests idempotency and safe recovery.
              </p>
            </div>
          </label>
        </div>

        {/* Action Button */}
        <button
          onClick={handleExecutePayment}
          disabled={processing}
          className={`w-full py-4 px-6 rounded-xl font-bold text-base text-white transition-all shadow-md flex items-center justify-center space-x-2 ${
            processing
              ? 'bg-slate-400 cursor-not-allowed'
              : 'bg-orange-600 hover:bg-orange-700 active:scale-95'
          }`}
        >
          {processing ? (
            <>
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span>Simulating Sandbox Payment...</span>
            </>
          ) : (
            <>
              <CreditCard className="w-5 h-5" />
              <span>Submit Sandbox Payment</span>
            </>
          )}
        </button>

        {/* Decoupling Invariant Note */}
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-xs text-slate-500 space-y-1">
          <div className="font-bold text-slate-700 flex items-center space-x-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Decoupled Payment Architecture (ADR-005)</span>
          </div>
          <p>
            Database transactions holding inventory locks NEVER span external payment calls.
            The reservation was already locked and committed in Phase A; payment interacts with the
            sandbox gateway outside any DB transaction, followed by a quick 2ms Phase C capture transaction.
          </p>
        </div>
      </div>
    </div>
  );
}
