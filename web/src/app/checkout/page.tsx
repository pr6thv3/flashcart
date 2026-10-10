'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCart } from '@/lib/cart-context';
import { useAuth } from '@/lib/auth-context';
import { api, formatPrice, ApiError } from '@/lib/api';
import {
  Lock,
  ShieldCheck,
  Store,
  ArrowRight,
  AlertCircle,
  Clock,
  Sparkles,
  KeyRound,
} from 'lucide-react';

export default function CheckoutPage() {
  const router = useRouter();
  const { cart, fetchCart } = useCart();
  const { user } = useAuth();

  const [address, setAddress] = useState({
    fullName: '',
    street: '123 Market St',
    city: 'Bengaluru',
    postalCode: '560001',
    country: 'India',
  });

  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Generate fresh idempotency key
    const newKey = `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    setIdempotencyKey(newKey);
    if (user?.full_name) {
      setAddress((prev) => ({ ...prev, fullName: user.full_name }));
    }
  }, [user]);

  if (!user) {
    return (
      <div className="max-w-md mx-auto py-16 text-center bg-white p-8 rounded-2xl border border-slate-200 space-y-4">
        <Lock className="w-10 h-10 text-slate-400 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">Sign in to complete checkout</h2>
        <Link
          href="/login"
          className="inline-block bg-orange-600 hover:bg-orange-700 text-white font-bold px-6 py-2.5 rounded-xl shadow transition-all"
        >
          Sign In
        </Link>
      </div>
    );
  }

  const hasItems = cart && cart.items && cart.items.length > 0;

  if (!hasItems) {
    return (
      <div className="max-w-md mx-auto py-16 text-center bg-white p-8 rounded-2xl border border-slate-200 space-y-4">
        <h2 className="text-xl font-bold text-slate-900">No items to checkout</h2>
        <p className="text-sm text-slate-500">Your cart is empty.</p>
        <Link
          href="/"
          className="inline-block bg-orange-600 text-white font-bold px-6 py-2.5 rounded-xl shadow"
        >
          Browse Marketplace
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      // 1. Call /api/v1/checkout/reserve with unique idempotency key
      const result = await api.checkout.reserve(
        {
          cartId: cart.cart_id,
        },
        idempotencyKey
      );

      // Refresh cart state since items are now reserved and cart cleared
      await fetchCart();

      const reservationId = result.reservationId || result.reservation_id || result.checkoutId;
      // 2. Redirect to decoupled payment simulation page
      router.push(`/checkout/payment/${reservationId}`);
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.code === 'INVENTORY_UNAVAILABLE') {
          setError('Inventory Unavailable: An item in your cart sold out or cannot be reserved.');
        } else {
          setError(err.message || 'Checkout reservation failed.');
        }
      } else {
        setError(err.message || 'Checkout reservation failed.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Multi-Vendor Checkout</h1>
        <p className="text-sm text-slate-500">
          Phase A: Secure Two-Phase Atomic Inventory Reservation
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center space-x-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Shipping Form & Idempotency Header (Left 2 Columns) */}
        <div className="md:col-span-2 space-y-6">
          {/* Shipping Address */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-bold text-slate-900">1. Shipping Destination</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs font-bold text-slate-600">Full Name</label>
                <input
                  type="text"
                  required
                  value={address.fullName}
                  onChange={(e) => setAddress({ ...address, fullName: e.target.value })}
                  placeholder="Recipient Name"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
                />
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs font-bold text-slate-600">Street Address</label>
                <input
                  type="text"
                  required
                  value={address.street}
                  onChange={(e) => setAddress({ ...address, street: e.target.value })}
                  placeholder="123 Street Name"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-600">City</label>
                <input
                  type="text"
                  required
                  value={address.city}
                  onChange={(e) => setAddress({ ...address, city: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-600">Postal Code</label>
                <input
                  type="text"
                  required
                  value={address.postalCode}
                  onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Idempotency Key Info */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-2">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-700">
              <KeyRound className="w-4 h-4 text-orange-600" />
              <span>Request Idempotency Key (Generated)</span>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                readOnly
                value={idempotencyKey}
                className="w-full font-mono text-xs bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-600 select-all"
              />
              <button
                type="button"
                onClick={() =>
                  setIdempotencyKey(`idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`)
                }
                className="text-xs text-orange-600 font-bold hover:underline whitespace-nowrap px-2"
              >
                Regenerate
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Header `Idempotency-Key` guarantees duplicate submissions return the exact same reservation
              without double-reserving or double-charging.
            </p>
          </div>

          {/* Vendor Split Review */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-bold text-slate-900">2. Multi-Vendor Sub-Orders Breakdown</h2>
            <div className="space-y-3">
              {cart.items_by_vendor.map((v) => (
                <div key={v.vendor_id} className="border border-slate-100 rounded-xl p-3.5 bg-slate-50/50 space-y-2">
                  <div className="flex justify-between items-center text-xs font-bold text-slate-700">
                    <span className="flex items-center space-x-1.5">
                      <Store className="w-3.5 h-3.5 text-orange-600" />
                      <span>{v.vendor_store_name}</span>
                    </span>
                    <span>Subtotal: {formatPrice(v.subtotal_minor)}</span>
                  </div>
                  <ul className="text-xs text-slate-500 space-y-1 pl-5 list-disc">
                    {v.items.map((i) => (
                      <li key={i.id}>
                        {i.quantity}x {i.title} — {formatPrice(i.line_total_minor)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right 1 Column: Reservation Summary & Action */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6 sticky top-24">
            <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3">
              Reservation Total
            </h2>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Items ({cart.item_count})</span>
                <span className="font-semibold text-slate-800">{formatPrice(cart.subtotal_minor)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Delivery</span>
                <span className="text-emerald-600 font-semibold text-xs">FREE</span>
              </div>
              <div className="border-t border-slate-100 pt-3 flex justify-between items-baseline">
                <span className="font-bold text-slate-900 text-base">Total to Authorize</span>
                <span className="font-black text-slate-900 text-2xl">
                  {formatPrice(cart.subtotal_minor)}
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full py-4 px-4 rounded-xl font-bold text-sm text-white transition-all shadow-md flex items-center justify-center space-x-2 ${
                isSubmitting
                  ? 'bg-orange-400 cursor-not-allowed'
                  : 'bg-orange-600 hover:bg-orange-700 active:scale-95'
              }`}
            >
              <Lock className="w-4 h-4" />
              <span>{isSubmitting ? 'Acquiring DB Locks...' : 'Lock Stock & Continue →'}</span>
            </button>

            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-[11px] text-slate-500 space-y-1.5">
              <div className="flex items-center space-x-1.5 font-bold text-slate-700">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Deterministic Sorted Locking</span>
              </div>
              <p>
                Products are locked in ascending ID order (`ORDER BY product_id ASC FOR UPDATE`),
                completely preventing deadlocks.
              </p>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
