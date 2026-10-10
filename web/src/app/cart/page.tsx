'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useCart } from '@/lib/cart-context';
import { useAuth } from '@/lib/auth-context';
import { formatPrice } from '@/lib/api';
import {
  ShoppingCart,
  Trash2,
  Store,
  ArrowRight,
  ShieldAlert,
  Zap,
  ShoppingBag,
  ArrowLeft,
} from 'lucide-react';

export default function CartPage() {
  const { cart, isLoading, fetchCart, updateQuantity, removeFromCart, clearCart } = useCart();
  const { user } = useAuth();

  useEffect(() => {
    fetchCart();
  }, [user]);

  if (!user) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center bg-white rounded-2xl border border-slate-200 p-8 space-y-4">
        <ShoppingCart className="w-12 h-12 text-slate-300 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">Sign in to view your cart</h2>
        <p className="text-sm text-slate-500">
          Your cart items are securely tied to your customer account for cross-device checkout.
        </p>
        <Link
          href="/login"
          className="inline-block bg-orange-600 hover:bg-orange-700 text-white font-bold px-6 py-2.5 rounded-xl shadow transition-all"
        >
          Sign In
        </Link>
      </div>
    );
  }

  if (isLoading && !cart) {
    return (
      <div className="max-w-4xl mx-auto py-12 animate-pulse space-y-6">
        <div className="h-8 w-48 bg-slate-200 rounded" />
        <div className="h-64 bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="h-6 w-1/3 bg-slate-200 rounded" />
          <div className="h-20 bg-slate-100 rounded" />
        </div>
      </div>
    );
  }

  const hasItems = cart && cart.items && cart.items.length > 0;

  if (!hasItems) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center bg-white rounded-2xl border border-dashed border-slate-300 p-8 space-y-4">
        <ShoppingBag className="w-12 h-12 text-slate-300 mx-auto" />
        <h2 className="text-2xl font-bold text-slate-900">Your cart is empty</h2>
        <p className="text-sm text-slate-500">
          Explore our marketplace catalog and active flash sales to add items.
        </p>
        <Link
          href="/"
          className="inline-flex items-center space-x-2 bg-orange-600 hover:bg-orange-700 text-white font-bold px-6 py-3 rounded-xl shadow transition-all"
        >
          <span>Browse Marketplace</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Title */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Multi-Vendor Cart</h1>
          <p className="text-sm text-slate-500">
            {cart.item_count} items across {cart.items_by_vendor?.length || 1} vendor(s)
          </p>
        </div>
        <button
          onClick={() => clearCart()}
          className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors flex items-center space-x-1"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear All Items</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Items Grouped By Vendor (Left 2 Columns) */}
        <div className="lg:col-span-2 space-y-6">
          {cart.items_by_vendor.map((group) => (
            <div
              key={group.vendor_id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
            >
              {/* Vendor Header */}
              <div className="bg-slate-50 px-6 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Store className="w-4 h-4 text-orange-600" />
                  <span className="font-bold text-slate-800 text-sm">{group.vendor_store_name}</span>
                </div>
                <span className="text-xs font-semibold text-slate-500">
                  Subtotal: {formatPrice(group.subtotal_minor)}
                </span>
              </div>

              {/* Vendor Item Rows */}
              <div className="divide-y divide-slate-100 p-4 sm:p-6 space-y-4 divide-y-0">
                {group.items.map((item) => {
                  const isFlash = !!item.flash_sale_id;

                  return (
                    <div
                      key={item.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center space-x-2">
                          <Link
                            href={`/products/${item.product_id}`}
                            className="font-bold text-slate-900 hover:text-orange-600 transition-colors text-sm sm:text-base line-clamp-1"
                          >
                            {item.title}
                          </Link>
                          {isFlash && (
                            <span className="inline-flex items-center space-x-1 bg-red-100 text-red-700 text-[10px] font-black uppercase px-2 py-0.5 rounded">
                              <Zap className="w-3 h-3 fill-red-600" />
                              <span>Flash Deal</span>
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-mono text-slate-400">SKU: {item.sku}</div>
                        <div className="text-xs text-slate-500">
                          Unit Price: <span className="font-semibold text-slate-700">{formatPrice(item.unit_price_minor)}</span>
                        </div>
                      </div>

                      {/* Quantity & Line Total */}
                      <div className="flex items-center justify-between sm:justify-end space-x-4">
                        <div className="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden shadow-sm">
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.product_id, item.quantity - 1)}
                            className="px-2.5 py-1 text-slate-600 hover:bg-slate-100 font-bold text-xs"
                          >
                            -
                          </button>
                          <span className="px-3 py-1 font-bold text-slate-800 text-xs w-8 text-center">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.product_id, item.quantity + 1)}
                            className="px-2.5 py-1 text-slate-600 hover:bg-slate-100 font-bold text-xs"
                          >
                            +
                          </button>
                        </div>

                        <div className="text-right min-w-20">
                          <span className="font-black text-slate-900 text-sm">
                            {formatPrice(item.line_total_minor)}
                          </span>
                        </div>

                        <button
                          onClick={() => removeFromCart(item.product_id)}
                          className="text-slate-400 hover:text-red-600 p-1 rounded transition-colors"
                          title="Remove item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Order Summary & Checkout (Right 1 Column) */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6 sticky top-24">
            <h2 className="text-lg font-black text-slate-900 border-b border-slate-100 pb-3">
              Order Summary
            </h2>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Items ({cart.item_count})</span>
                <span className="font-semibold text-slate-800">{formatPrice(cart.subtotal_minor)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Shipping</span>
                <span className="text-emerald-600 font-semibold text-xs uppercase">Calculated at checkout</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Estimated Tax</span>
                <span className="text-xs text-slate-400">Included</span>
              </div>

              <div className="border-t border-slate-100 pt-3 flex justify-between items-baseline">
                <span className="font-bold text-slate-900 text-base">Estimated Total</span>
                <span className="font-black text-slate-900 text-2xl">
                  {formatPrice(cart.subtotal_minor)}
                </span>
              </div>
            </div>

            <Link
              href="/checkout"
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-md transition-all flex items-center justify-center space-x-2 text-center"
            >
              <span>Proceed to Checkout</span>
              <ArrowRight className="w-4 h-4" />
            </Link>

            <div className="bg-amber-50 rounded-xl p-3 border border-amber-200 text-[11px] text-amber-800 space-y-1">
              <div className="font-bold flex items-center space-x-1">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                <span>Authoritative Pricing Policy</span>
              </div>
              <p>
                Client prices are never trusted. All totals, promotions, and flash sale discounts are
                strictly revalidated by the PostgreSQL database upon reservation.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
