'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, CustomerOrder, formatPrice, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  Package,
  Store,
  Clock,
  CheckCircle2,
  AlertCircle,
  ShoppingBag,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';

export default function CustomerOrdersPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadOrders() {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const data = await api.orders.list();
        setOrders(data);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch customer orders.');
      } finally {
        setLoading(false);
      }
    }
    loadOrders();
  }, [user]);

  if (!user) {
    return (
      <div className="max-w-md mx-auto py-16 text-center bg-white rounded-2xl border border-slate-200 p-8 space-y-4">
        <Package className="w-12 h-12 text-slate-300 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">Sign in to view orders</h2>
        <p className="text-sm text-slate-500">Access your historical orders and tracking statuses.</p>
        <Link
          href="/login"
          className="inline-block bg-orange-600 hover:bg-orange-700 text-white font-bold px-6 py-2.5 rounded-xl shadow"
        >
          Sign In
        </Link>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'shipped':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'delivered':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'cancelled':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Customer Order History</h1>
        <p className="text-sm text-slate-500">
          Showing verified vendor sub-orders associated with your account
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center space-x-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {loading && (
        <div className="space-y-4 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 h-40" />
          ))}
        </div>
      )}

      {!loading && orders.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300 p-8 space-y-4">
          <ShoppingBag className="w-12 h-12 text-slate-300 mx-auto" />
          <h2 className="text-xl font-bold text-slate-800">No orders placed yet</h2>
          <p className="text-sm text-slate-500">
            When you complete a purchase, your vendor sub-orders will be tracked here.
          </p>
          <Link
            href="/"
            className="inline-flex items-center space-x-2 bg-orange-600 hover:bg-orange-700 text-white font-bold px-6 py-2.5 rounded-xl shadow"
          >
            <span>Start Shopping</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}

      {!loading && orders.length > 0 && (
        <div className="space-y-6">
          {orders.map((order) => (
            <div
              key={order.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
            >
              {/* Order Header */}
              <div className="bg-slate-50/80 px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center space-x-3">
                    <span className="font-bold text-slate-900 text-base">{order.order_number}</span>
                    <span
                      className={`text-xs font-bold uppercase px-2.5 py-0.5 rounded-full border ${getStatusColor(
                        order.status
                      )}`}
                    >
                      {order.status}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-xs text-slate-500">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Placed on {new Date(order.created_at).toLocaleString()}</span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs text-slate-400">Order Sub-Total</span>
                  <div className="text-lg font-black text-slate-900">
                    {formatPrice(order.total_minor, order.currency)}
                  </div>
                </div>
              </div>

              {/* Vendor & Items */}
              <div className="p-6 space-y-4">
                <div className="flex items-center space-x-2 text-xs font-semibold text-slate-600">
                  <Store className="w-4 h-4 text-orange-600" />
                  <span>Vendor Store: {order.vendor?.store_name || 'Independent Merchant'}</span>
                </div>

                <div className="divide-y divide-slate-100">
                  {order.items.map((item) => (
                    <div key={item.id} className="py-3 flex items-center justify-between text-sm">
                      <div className="space-y-0.5">
                        <span className="font-bold text-slate-800">{item.title}</span>
                        <div className="text-xs text-slate-400 font-mono">
                          SKU: {item.sku} • Qty: {item.quantity}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-slate-900">
                          {formatPrice(item.total_minor, order.currency)}
                        </span>
                        <div className="text-[11px] text-slate-400">
                          ({formatPrice(item.unit_price_minor, order.currency)} each)
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Shipping address snapshot if available */}
                {order.shipping_address_snapshot && (
                  <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-500 border border-slate-100">
                    <span className="font-bold text-slate-700">Delivery Address: </span>
                    <span>
                      {order.shipping_address_snapshot.full_name || 'Customer'},{' '}
                      {order.shipping_address_snapshot.street_line1 || order.shipping_address_snapshot.street || 'Address'},{' '}
                      {order.shipping_address_snapshot.city || 'City'},{' '}
                      {order.shipping_address_snapshot.postal_code || order.shipping_address_snapshot.postalCode || 'Postal'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
