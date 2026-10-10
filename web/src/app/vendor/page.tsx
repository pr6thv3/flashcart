'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { api, formatPrice, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  Store,
  Package,
  Boxes,
  PlusCircle,
  Truck,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  RefreshCw,
  Clock,
} from 'lucide-react';

export default function VendorPortalPage() {
  const { user, isVendor } = useAuth();

  const [activeTab, setActiveTab] = useState<'products' | 'create' | 'orders'>('products');
  const [vendorProfile, setVendorProfile] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // New product form state
  const [newProduct, setNewProduct] = useState({
    title: '',
    description: '',
    priceMajor: '25.00',
    sku: `SKU-${Date.now().toString().slice(-6)}`,
    initialOnHandQty: 50,
  });

  // Stock edit state
  const [stockEdits, setStockEdits] = useState<Record<string, number>>({});

  const loadData = async () => {
    if (!user || !isVendor) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [profile, prods, ords] = await Promise.all([
        api.vendor.getProfile().catch(() => null),
        api.vendor.getProducts().catch(() => []),
        api.vendor.getOrders().catch(() => []),
      ]);
      const prodsList = Array.isArray(prods) ? prods : (prods?.products || []);
      const ordsList = Array.isArray(ords) ? ords : (ords?.orders || []);
      setVendorProfile(profile);
      setProducts(prodsList);
      setOrders(ordsList);

      const initialEdits: Record<string, number> = {};
      prodsList.forEach((p: any) => {
        initialEdits[p.id] = p.on_hand_qty;
      });
      setStockEdits(initialEdits);
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || 'Failed to load vendor data' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user, isVendor]);

  const handleUpdateStock = async (productId: string) => {
    const newQty = stockEdits[productId];
    if (newQty === undefined || newQty < 0) {
      alert('Please enter a valid stock quantity.');
      return;
    }
    setActionLoading(`stock_${productId}`);
    try {
      await api.vendor.updateInventory(productId, newQty);
      setNotice({ type: 'success', message: 'Warehouse inventory updated successfully!' });
      await loadData();
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || 'Failed to update stock' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading('create_product');
    setNotice(null);

    const priceMinor = Math.round(parseFloat(newProduct.priceMajor) * 100);
    if (isNaN(priceMinor) || priceMinor <= 0) {
      alert('Please enter a valid product price.');
      setActionLoading(null);
      return;
    }

    try {
      await api.vendor.createProduct({
        title: newProduct.title,
        description: newProduct.description,
        priceMinor,
        sku: newProduct.sku,
        initialOnHandQty: Number(newProduct.initialOnHandQty),
      });

      setNotice({ type: 'success', message: 'New product published to marketplace catalog!' });
      setNewProduct({
        title: '',
        description: '',
        priceMajor: '25.00',
        sku: `SKU-${Date.now().toString().slice(-6)}`,
        initialOnHandQty: 50,
      });
      setActiveTab('products');
      await loadData();
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || 'Failed to create product' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleFulfillOrder = async (orderId: string) => {
    setActionLoading(`fulfill_${orderId}`);
    try {
      await api.vendor.fulfillOrder(orderId, 'BlueDart Express', `TRK-${Date.now().toString().slice(-8)}`);
      setNotice({ type: 'success', message: `Order marked as fulfilled and shipped!` });
      await loadData();
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || 'Failed to fulfill order' });
    } finally {
      setActionLoading(null);
    }
  };

  if (!user || !isVendor) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center bg-white rounded-3xl border border-slate-200 p-8 space-y-4 shadow-sm">
        <Store className="w-12 h-12 text-slate-300 mx-auto" />
        <h2 className="text-2xl font-black text-slate-900">Vendor Portal Access Required</h2>
        <p className="text-sm text-slate-500">
          This dashboard is strictly isolated to registered and approved vendor merchants.
        </p>
        <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-800 text-left space-y-1">
          <div className="font-bold">Tenant Isolation Notice:</div>
          <p>
            Customer roles cannot access vendor endpoints. If you are testing vendor workflows, log in
            with an approved vendor merchant account.
          </p>
        </div>
        <Link
          href="/login"
          className="inline-block bg-orange-600 hover:bg-orange-700 text-white font-bold px-6 py-2.5 rounded-xl shadow transition-all"
        >
          Sign In as Vendor
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Vendor Header */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Store className="w-6 h-6 text-orange-600" />
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {vendorProfile?.store_name || 'Vendor Merchant Portal'}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            Tenant ID: <span className="font-mono text-slate-700">{vendorProfile?.id || user.id}</span> • Status:{' '}
            <span className="font-bold uppercase text-emerald-600">Approved</span>
          </p>
        </div>

        <div className="flex items-center space-x-2 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 px-3.5 py-1.5 rounded-full">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Server-Enforced Multi-Tenant Isolation</span>
        </div>
      </div>

      {/* Global Notice */}
      {notice && (
        <div
          className={`p-4 rounded-2xl flex items-center justify-between border ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <div className="flex items-center space-x-2 text-sm font-semibold">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600" />
            )}
            <span>{notice.message}</span>
          </div>
          <button
            onClick={() => setNotice(null)}
            className="text-xs font-bold text-slate-400 hover:text-slate-600"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 space-x-6 text-sm font-bold">
        <button
          onClick={() => setActiveTab('products')}
          className={`pb-3 flex items-center space-x-2 transition-colors relative ${
            activeTab === 'products'
              ? 'text-orange-600 border-b-2 border-orange-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Boxes className="w-4 h-4" />
          <span>Inventory & Products ({products.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('create')}
          className={`pb-3 flex items-center space-x-2 transition-colors relative ${
            activeTab === 'create'
              ? 'text-orange-600 border-b-2 border-orange-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <PlusCircle className="w-4 h-4" />
          <span>Publish New Product</span>
        </button>

        <button
          onClick={() => setActiveTab('orders')}
          className={`pb-3 flex items-center space-x-2 transition-colors relative ${
            activeTab === 'orders'
              ? 'text-orange-600 border-b-2 border-orange-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Truck className="w-4 h-4" />
          <span>Fulfillment & Sub-Orders ({orders.length})</span>
        </button>
      </div>

      {/* Tab 1: Products & Stock Management */}
      {activeTab === 'products' && (
        <div className="space-y-6">
          {products.length === 0 && !loading && (
            <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300 p-8 space-y-3">
              <Package className="w-10 h-10 text-slate-300 mx-auto" />
              <h3 className="text-lg font-bold text-slate-700">No products published yet</h3>
              <button
                onClick={() => setActiveTab('create')}
                className="text-sm font-bold text-orange-600 hover:underline"
              >
                Publish your first product →
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4">
            {products.map((product) => (
              <div
                key={product.id}
                className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6"
              >
                <div className="space-y-1 flex-1">
                  <div className="flex items-center space-x-2">
                    <h3 className="font-bold text-slate-900 text-base">{product.title}</h3>
                    <span className="text-[10px] font-bold uppercase bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                      {product.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 font-mono">SKU: {product.sku}</div>
                  <div className="text-sm font-black text-slate-800">
                    {formatPrice(product.price_minor, product.currency)}
                  </div>
                  <div className="text-xs text-slate-500 pt-1">
                    On-Hand: <span className="font-bold text-slate-700">{product.on_hand_qty}</span> • Reserved:{' '}
                    <span className="font-bold text-amber-600">{product.reserved_qty}</span> • Available:{' '}
                    <span className="font-bold text-emerald-600">{product.available_qty}</span>
                  </div>
                </div>

                {/* Stock Adjustment Controls */}
                <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Set Stock</label>
                    <input
                      type="number"
                      min="0"
                      value={stockEdits[product.id] ?? product.on_hand_qty}
                      onChange={(e) =>
                        setStockEdits({
                          ...stockEdits,
                          [product.id]: parseInt(e.target.value) || 0,
                        })
                      }
                      className="w-24 px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-bold text-slate-800 text-center"
                    />
                  </div>

                  <button
                    onClick={() => handleUpdateStock(product.id)}
                    disabled={actionLoading === `stock_${product.id}`}
                    className="mt-4 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs py-2 px-4 rounded-lg shadow-sm transition-all flex items-center space-x-1"
                  >
                    {actionLoading === `stock_${product.id}` ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <span>Save</span>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2: Create Product Form */}
      {activeTab === 'create' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm space-y-6 max-w-2xl">
          <h2 className="text-xl font-bold text-slate-900">Publish New Marketplace Product</h2>

          <form onSubmit={handleCreateProduct} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Product Title</label>
              <input
                type="text"
                required
                value={newProduct.title}
                onChange={(e) => setNewProduct({ ...newProduct, title: e.target.value })}
                placeholder="e.g. Ultra HD Noise Cancelling Headphones"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Description</label>
              <textarea
                required
                rows={3}
                value={newProduct.description}
                onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
                placeholder="Detailed product features and specifications..."
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Price (INR)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={newProduct.priceMajor}
                  onChange={(e) => setNewProduct({ ...newProduct, priceMajor: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Initial Stock (Units)</label>
                <input
                  type="number"
                  min="0"
                  required
                  value={newProduct.initialOnHandQty}
                  onChange={(e) =>
                    setNewProduct({ ...newProduct, initialOnHandQty: parseInt(e.target.value) || 0 })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">SKU Code</label>
                <input
                  type="text"
                  required
                  value={newProduct.sku}
                  onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-orange-500 focus:outline-none font-mono uppercase"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={actionLoading === 'create_product'}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3.5 px-6 rounded-xl shadow-md transition-all flex items-center justify-center space-x-2"
            >
              <PlusCircle className="w-5 h-5" />
              <span>
                {actionLoading === 'create_product' ? 'Publishing...' : 'Publish Product to Store'}
              </span>
            </button>
          </form>
        </div>
      )}

      {/* Tab 3: Vendor Orders & Fulfillment */}
      {activeTab === 'orders' && (
        <div className="space-y-6">
          {orders.length === 0 && !loading && (
            <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300 p-8 space-y-3">
              <Truck className="w-10 h-10 text-slate-300 mx-auto" />
              <h3 className="text-lg font-bold text-slate-700">No orders received yet</h3>
              <p className="text-sm text-slate-400">
                Customer purchases involving your products will automatically appear here.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4">
            {orders.map((order) => {
              const canFulfill = order.status === 'paid' || order.status === 'processing';

              return (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center space-x-3">
                      <span className="font-bold text-slate-900 text-base">{order.order_number}</span>
                      <span
                        className={`text-xs font-bold uppercase px-2.5 py-0.5 rounded-full ${
                          order.status === 'paid'
                            ? 'bg-emerald-100 text-emerald-800'
                            : order.status === 'shipped'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {order.status}
                      </span>
                    </div>

                    <div className="text-xs text-slate-400">
                      Created: {new Date(order.created_at).toLocaleString()}
                    </div>

                    <div className="text-sm font-black text-slate-900">
                      Sub-Order Total: {formatPrice(order.total_minor)}
                    </div>

                    {order.shipping_address_snapshot && (
                      <div className="text-xs text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        Deliver to: {order.shipping_address_snapshot.full_name},{' '}
                        {order.shipping_address_snapshot.street_line1 || order.shipping_address_snapshot.street},{' '}
                        {order.shipping_address_snapshot.city}
                      </div>
                    )}
                  </div>

                  {/* Fulfillment Action */}
                  <div>
                    {canFulfill ? (
                      <button
                        onClick={() => handleFulfillOrder(order.id)}
                        disabled={actionLoading === `fulfill_${order.id}`}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2.5 px-5 rounded-xl shadow-sm transition-all flex items-center space-x-1.5"
                      >
                        <Truck className="w-4 h-4" />
                        <span>
                          {actionLoading === `fulfill_${order.id}` ? 'Dispatching...' : 'Fulfill & Dispatch'}
                        </span>
                      </button>
                    ) : (
                      <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-3 py-1.5 rounded-lg">
                        Dispatched
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
