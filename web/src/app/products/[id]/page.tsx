'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { api, Product, FlashSale, formatPrice } from '@/lib/api';
import { useCart } from '@/lib/cart-context';
import { useAuth } from '@/lib/auth-context';
import { CountdownTimer } from '@/components/countdown-timer';
import {
  ShieldCheck,
  Store,
  Tag,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Package,
} from 'lucide-react';

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const productId = resolvedParams.id;

  const [product, setProduct] = useState<Product | null>(null);
  const [flashSale, setFlashSale] = useState<FlashSale | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [addedNotice, setAddedNotice] = useState<boolean>(false);

  const { addToCart } = useCart();
  const { user } = useAuth();

  useEffect(() => {
    async function loadProduct() {
      try {
        setLoading(true);
        const data = await api.catalog.getProduct(productId);
        setProduct(data);

        // Check if there is an active flash sale for this product
        try {
          const sales = await api.catalog.getActiveFlashSales();
          const match = sales.find((s) => s.product_id === productId);
          if (match) {
            setFlashSale(match);
          }
        } catch {
          // Flash sale fetch is optional
        }
      } catch (err: any) {
        setError(err.message || 'Product not found');
      } finally {
        setLoading(false);
      }
    }
    loadProduct();
  }, [productId]);

  const handleAdd = async () => {
    if (!user) {
      window.location.href = '/login';
      return;
    }
    setIsSubmitting(true);
    try {
      await addToCart(productId, quantity);
      setAddedNotice(true);
      setTimeout(() => setAddedNotice(false), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to add product to cart');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-12 animate-pulse space-y-6">
        <div className="h-6 w-32 bg-slate-200 rounded" />
        <div className="h-80 bg-white rounded-2xl border border-slate-200 p-8 space-y-4">
          <div className="h-8 w-3/4 bg-slate-200 rounded" />
          <div className="h-6 w-1/4 bg-slate-200 rounded" />
          <div className="h-24 bg-slate-200 rounded" />
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-800">{error || 'Product Not Found'}</h2>
        <Link
          href="/"
          className="inline-flex items-center space-x-2 text-orange-600 font-semibold hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Marketplace</span>
        </Link>
      </div>
    );
  }

  const isOutOfStock = product.available_qty <= 0;
  const maxAllowed = Math.min(product.available_qty, 10);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back button */}
      <Link
        href="/"
        className="inline-flex items-center space-x-2 text-sm font-semibold text-slate-600 hover:text-orange-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to catalog</span>
      </Link>

      {/* Product Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Flash Sale Banner if applicable */}
        {flashSale && (
          <div className="bg-gradient-to-r from-red-600 to-orange-600 text-white p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <Zap className="w-5 h-5 fill-amber-300 text-amber-300 animate-bounce" />
              <span className="font-bold text-sm tracking-wide uppercase">
                Active Flash Sale Special
              </span>
            </div>
            <div className="flex items-center space-x-3">
              <CountdownTimer endsAt={flashSale.ends_at} />
              <span className="text-xs bg-white/20 backdrop-blur px-2.5 py-1 rounded font-semibold">
                Limit: {flashSale.quantity_limit} units
              </span>
            </div>
          </div>
        )}

        <div className="p-6 sm:p-10 space-y-8">
          {/* Header & Vendor */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center space-x-1 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1 rounded-full">
                <Store className="w-3.5 h-3.5" />
                <span>Vendor: {product.vendor_store_name || 'Verified Merchant'}</span>
              </span>
              <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
                SKU: {product.sku}
              </span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tight">
              {product.title}
            </h1>
          </div>

          {/* Pricing & Stock Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-slate-50 p-6 rounded-2xl border border-slate-100">
            <div>
              <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">
                Price
              </span>
              <div className="flex items-baseline space-x-3 mt-1">
                {flashSale ? (
                  <>
                    <span className="text-3xl font-black text-red-600">
                      {formatPrice(flashSale.sale_price_minor, flashSale.currency)}
                    </span>
                    <span className="text-lg text-slate-400 line-through">
                      {formatPrice(product.price_minor, product.currency)}
                    </span>
                  </>
                ) : (
                  <span className="text-3xl font-black text-slate-900">
                    {formatPrice(product.price_minor, product.currency)}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">Inclusive of applicable taxes</p>
            </div>

            <div>
              <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">
                Stock Availability
              </span>
              <div className="mt-1 flex items-center space-x-2">
                <span
                  className={`inline-block w-3 h-3 rounded-full ${
                    isOutOfStock ? 'bg-red-500' : 'bg-emerald-500'
                  }`}
                />
                <span className="font-bold text-slate-800">
                  {isOutOfStock ? 'Currently Out of Stock' : `${product.available_qty} units available`}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                On-hand: {product.on_hand_qty} • Reserved: {product.reserved_qty}
              </p>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
              Description & Specifications
            </h3>
            <div className="text-slate-700 leading-relaxed whitespace-pre-line text-sm sm:text-base">
              {product.description || 'No detailed description provided.'}
            </div>
          </div>

          {/* Add to Cart Actions */}
          <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
            {!isOutOfStock && (
              <div className="flex items-center border border-slate-300 rounded-xl bg-white overflow-hidden shadow-sm">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="px-4 py-3 text-slate-600 hover:bg-slate-100 font-bold"
                >
                  -
                </button>
                <span className="px-4 py-3 font-bold text-slate-800 w-12 text-center text-sm">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(maxAllowed, q + 1))}
                  className="px-4 py-3 text-slate-600 hover:bg-slate-100 font-bold"
                >
                  +
                </button>
              </div>
            )}

            <button
              onClick={handleAdd}
              disabled={isOutOfStock || isSubmitting}
              className={`flex-1 py-3.5 px-6 rounded-xl font-bold text-base text-white transition-all shadow-md flex items-center justify-center space-x-2 ${
                isOutOfStock
                  ? 'bg-slate-300 cursor-not-allowed'
                  : 'bg-orange-600 hover:bg-orange-700 active:scale-95'
              }`}
            >
              <Package className="w-5 h-5" />
              <span>
                {isOutOfStock
                  ? 'Out of Stock'
                  : isSubmitting
                  ? 'Adding to Cart...'
                  : `Add ${quantity > 1 ? `${quantity} Units` : ''} to Multi-Vendor Cart`}
              </span>
            </button>
          </div>

          {/* Added Notice */}
          {addedNotice && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span className="text-sm font-semibold">Added to cart successfully!</span>
              </div>
              <Link href="/cart" className="text-sm font-bold text-orange-600 hover:underline">
                View Cart & Checkout →
              </Link>
            </div>
          )}

          {/* Invariant guarantee banner */}
          <div className="bg-slate-50 rounded-xl p-4 flex items-center space-x-3 text-xs text-slate-500 border border-slate-200">
            <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span>
              <strong>Zero Overselling Guarantee:</strong> All reservations undergo database-level
              sorted row locking (`SELECT FOR UPDATE`) and atomic conditional checks at checkout.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
